/**
 * Uploader - 文件上传，支持分片和断点续传
 */

import { HashCalculator } from '../../infra/worker/HashCalculator';
import { BaseTransfer } from '../BaseTransfer';
import { PluginManager } from '../plugin/PluginManager';
import { IPluginContext } from '../plugin/types';
import { ErrorCode, TaskStatus, type ISDKConfig, type ITransferTask } from '../types';
import { ChunkManager } from './ChunkManager';

/**
 * 上传配置接口
 */
export interface IUploadConfig extends ISDKConfig {
  /** 上传URL */
  uploadUrl?: string;
  /** 合并分片URL */
  mergeUrl?: string;
  /** 检查文件是否存在URL */
  checkUrl?: string;
  /** 最大并发分片上传数 */
  maxConcurrentChunks?: number;
  /** FormData 中文件的字段名 (默认: 'file') */
  fileFieldName?: string;
  /** 额外参数 */
  extraParams?: Record<string, string> | ((chunkIndex: number, totalChunks: number, taskId: string) => Record<string, string>);
}

/**
 * 文件上传类
 */
export class Uploader extends BaseTransfer {
  private file: File;
  private uploadConfig: IUploadConfig;
  private chunkManager?: ChunkManager;
  private uploadingChunks: Set<number> = new Set();
  private abortController: AbortController | null = null;
  private pluginManager: PluginManager;

  constructor(task: ITransferTask, file: File, config: IUploadConfig) {
    super(task, config);
    this.file = file;
    this.uploadConfig = config;
    // 插件管理器 - 装载插件
    this.pluginManager = new PluginManager(config.plugins || []);

    // Hook: onTaskCreated
    this.pluginManager.runHook('onTaskCreated', this.getPluginContext());
  }

  private getPluginContext(): IPluginContext {
    return {
      task: this.task,
      uploader: this
    };
  }

  /**
   * 开始上传
   */
  async start(): Promise<void> {
    if (this.task.status !== TaskStatus.Idle && this.task.status !== TaskStatus.Failed) {
      return;
    }
    try {
      this.abortController = new AbortController();
      this.initializeTransfer();

      // Hook: beforeStart
      await this.pluginManager.runHook('beforeStart', this.getPluginContext());

      this.setStatus(TaskStatus.Processing);

      // 加载检查点
      // 初始化分片管理器
      this.chunkManager = new ChunkManager(this.file, this.config.chunkSize || 5 * 1024 * 1024);
      const fingerprint = this.getFingerprint();
      const checkpoint = await this.loadCheckpoint(fingerprint);

      // 从检查点恢复
      if (checkpoint) {
        if (checkpoint.fileHash) {
          this.task.hash = checkpoint.fileHash;
        }
        // 先恢复布局
        if (checkpoint.chunkLayout && this.chunkManager.restoreLayout) {
          this.chunkManager.restoreLayout(checkpoint.chunkLayout);
        }
        if (checkpoint.completedChunks) {
          // 如果恢复了布局，则现有分片与检查点索引匹配
          this.chunkManager.restoreFromCheckpoint(checkpoint.completedChunks);
          const uploadedBytes = this.chunkManager.getUploadedBytes();
          this.updateProgress(uploadedBytes, this.file.size);
        }
      }

      // Hash 计算
      if (this.config.enableHash && !this.task.hash) {
        this.setStatus(TaskStatus.Processing);
        try {
          const result = await HashCalculator.calculateHash(this.file, {
            onProgress: (_progress) => {
              // Optional: emit hash progress
            }
          });
          this.task.hash = result.hash;
          // 立即保存 hash 到检查点
          await this.saveCheckpoint();

          // 预检 (即时上传)
          if (this.uploadConfig.checkUrl) {
            // TODO: 实现即时上传检查
          }
        } catch (error) {
          this.setError({
            code: ErrorCode.HashCalculationFailed,
            message: 'Hash calculation failed',
            originalError: error as Error,
            timestamp: Date.now(),
            retryable: false
          });
          return;
        }
      }

      // if (this.task.status !== TaskStatus.Processing && this.task.status !== TaskStatus.Idle) {
      //   // Check cancellation during hash
      //   return;
      // }
      this.setStatus(TaskStatus.Transferring);

      // Hook: afterStart
      await this.pluginManager.runHook('afterStart', this.getPluginContext());

      // 开始上传
      await this.uploadChunks();

      // 如果我们不在 Transferring 状态 (例如 Paused, Failed, Cancelled)，则在此停止
      if ((this.task.status as TaskStatus) !== TaskStatus.Transferring) {
        return;
      }

      // 合并分片
      if (this.uploadConfig.mergeUrl) {
        await this.mergeChunks();
      }

      this.setStatus(TaskStatus.Completed);
      await this.deleteCheckpoint();

      // Hook: onSuccess
      await this.pluginManager.runHook('onSuccess', this.getPluginContext());

    } catch (error) {
      const transferError = this.createTransferError(
        ErrorCode.ChunkUploadFailed,
        error instanceof Error ? error.message : 'Upload failed',
        error instanceof Error ? error : undefined,
      );
      this.setError(transferError);

      // Hook: onError
      await this.pluginManager.runHook('onError', this.getPluginContext(), error);
    }
  }

  /**
   * 暂停上传
   */
  pause(): void {
    if (this.task.status === TaskStatus.Transferring) {
      this.setStatus(TaskStatus.Paused);
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }
  }

  /**
   * 恢复上传
   */
  async resume(): Promise<void> {
    if (this.task.status === TaskStatus.Paused || this.task.status === TaskStatus.Failed) {
      this.abortController = new AbortController();

      // 重置失败的分片 (例如从 abort) 为 pending，以便被拾取
      const failedChunks = this.chunkManager?.getFailedChunks() || [];
      failedChunks.forEach(chunk => this.chunkManager?.retryChunk(chunk.index));

      this.setStatus(TaskStatus.Transferring);
      await this.uploadChunks();

      // 如果我们不在 Transferring 状态 (例如 Paused, Failed, Cancelled)，则在此停止
      if ((this.task.status as TaskStatus) !== TaskStatus.Transferring) {
        return;
      }

      // 合并分片
      if (this.chunkManager?.isComplete() && this.uploadConfig.mergeUrl) {
        await this.mergeChunks();
      }

      if (this.chunkManager?.isComplete()) {
        this.setStatus(TaskStatus.Completed);
        await this.deleteCheckpoint();
      }
    }
  }

  /**
   * 取消上传
   */
  cancel(): void {
    this.setStatus(TaskStatus.Cancelled);
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 上传分片
   */
  private async uploadChunks(): Promise<void> {
    if (!this.chunkManager) {
      throw new Error('ChunkManager not initialized');
    }

    const maxConcurrent = this.uploadConfig.maxConcurrentChunks || 3;

    while (!this.chunkManager.isComplete() && this.task.status === TaskStatus.Transferring) {
      const batch = this.chunkManager.getNextBatch(maxConcurrent - this.uploadingChunks.size);

      if (batch.length === 0) {
        // 等待正在进行的上传完成
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // 并发上传分片
      const uploadPromises = batch.map((chunk) => this.uploadChunk(chunk.index));
      await Promise.allSettled(uploadPromises);

      // 更新进度
      const uploadedBytes = this.chunkManager.getUploadedBytes();
      this.updateProgress(uploadedBytes, this.file.size);

      // Hook: onProgress
      this.pluginManager.runHookParallel('onProgress', this.getPluginContext(), this.task.progress);

      // 保存检查点
      if (this.config.enableCheckpoint) {
        await this.saveCheckpoint();
      }
    }
  }

  /**
   * 上传单个分片
   */
  private async uploadChunk(index: number): Promise<void> {
    if (!this.chunkManager) return;

    this.chunkManager.markChunkUploading(index);
    this.uploadingChunks.add(index);
    const startTime = Date.now();

    try {
      const chunk = this.chunkManager.getChunk(index);
      if (!chunk) return;

      const uploadUrl = this.uploadConfig.uploadUrl || '/api/upload/chunk';
      const fileFieldName = this.uploadConfig.fileFieldName || 'file';

      // 创建表单数据
      const formData = new FormData();
      formData.append(fileFieldName, chunk.blob, this.file.name);

      // 添加额外参数
      const extraParams = typeof this.uploadConfig.extraParams === 'function'
        ? this.uploadConfig.extraParams(index, this.chunkManager.getTotalChunks(), this.task.id)
        : this.uploadConfig.extraParams || {
          chunkIndex: index.toString(),
          totalChunks: this.chunkManager.getTotalChunks().toString(),
          fileName: this.file.name,
          taskId: this.task.id,
          path: this.task.path || '',
        };

      Object.entries(extraParams).forEach(([key, value]) => {
        formData.append(key, value);
      });

      // 带重试的上传
      await this.executeWithRetry(async () => {
        if (!this.config.networkAdapter) {
          throw new Error('Network adapter not configured');
        }

        let requestConfig: import('../types').INetworkRequestConfig = {
          url: uploadUrl,
          method: 'POST',
          body: formData,
          timeout: this.config.timeout,
          signal: this.abortController?.signal,
        };

        // Hook: transformRequest (Middleware)
        requestConfig = await this.pluginManager.transformRequest(requestConfig);

        await this.config.networkAdapter.request(requestConfig);
      }, ErrorCode.ChunkUploadFailed);

      this.chunkManager.markChunkComplete(index);

      // 自适应分块：根据速度调整大小
      if (this.chunkManagerHasAdaptiveSizing()) {
        const duration = Date.now() - startTime;
        if (duration > 0) {
          const speed = chunk.size / (duration / 1000); // 字节每秒
          // 简单的移动平均以保持稳定
          this.task.speed = this.task.speed === 0 ? speed : (this.task.speed * 0.7) + (speed * 0.3);

          // 目标 2 秒每个分片
          const TARGET_TIME = 2000;
          const idealSize = Math.floor(this.task.speed * (TARGET_TIME / 1000));

          // 限制大小 (最小 256KB, 最大 50MB)
          const newSize = Math.max(256 * 1024, Math.min(idealSize, 50 * 1024 * 1024));

          // 仅当差异显著 (> 20%) 时才调整大小
          const currentSize = (this.chunkManager as any).chunkSize;
          if (Math.abs(newSize - currentSize) / currentSize > 0.2) {
            this.chunkManager.resizeRemaining(newSize);
          }
        }
      }

    } catch (error) {
      this.chunkManager?.markChunkFailed(index);
      throw error;
    } finally {
      this.uploadingChunks.delete(index);
    }
  }

  private chunkManagerHasAdaptiveSizing(): boolean {
    // 用户显式设置了 chunkSize (> 0) → 尊重用户的固定分块，禁用自适应
    // 用户未设置 chunkSize (undefined) 或设为 0 → 启用自适应分块
    console.log(this.uploadConfig.chunkSize);
    if (this.uploadConfig.chunkSize && this.uploadConfig.chunkSize > 0) {
      return false;
    }
    return !!this.chunkManager && typeof this.chunkManager.resizeRemaining === 'function';
  }

  /**
   * 合并分片
   */
  private async mergeChunks(): Promise<void> {
    if (!this.uploadConfig.mergeUrl || !this.config.networkAdapter) {
      return;
    }

    await this.executeWithRetry(async () => {
      if (!this.config.networkAdapter) throw new Error('Network adapter not configured');

      await this.config.networkAdapter.request({
        url: this.uploadConfig.mergeUrl!,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: this.task.id,
          fileName: this.file.name,
          totalChunks: this.chunkManager!.getTotalChunks(),
        }),
        timeout: this.config.timeout,
        signal: this.abortController?.signal,
      });
    }, ErrorCode.ChunkMergeFailed);
  }

  /**
   * 从存储中恢复状态而不启动上传
   */
  async restoreFromStorage(): Promise<boolean> {
    try {
      const fingerprint = this.getFingerprint();
      const checkpoint = await this.loadCheckpoint(fingerprint);

      if (!checkpoint || !checkpoint.completedChunks) {
        return false;
      }

      // 初始化分片管理器
      this.chunkManager = new ChunkManager(this.file, this.config.chunkSize || 5 * 1024 * 1024);
      this.chunkManager.restoreFromCheckpoint(checkpoint.completedChunks);

      // 更新任务状态和进度
      const uploadedBytes = this.chunkManager.getUploadedBytes();
      this.updateProgress(uploadedBytes, this.file.size);

      // 如果有文件哈希，则恢复
      if (checkpoint.fileHash) {
        this.task.hash = checkpoint.fileHash;
      }

      // 更新内部状态
      this.task.status = TaskStatus.Paused;
      this.emit('statusChange', {
        taskId: this.task.id,
        oldStatus: TaskStatus.Idle,
        newStatus: TaskStatus.Paused,
        timestamp: Date.now()
      });

      return true;
    } catch (error) {
      console.error('Failed to restore from storage:', error);
      return false;
    }
  }

  /**
   * 获取确定性的文件指纹
   */
  private getFingerprint(): string {
    const parts = [
      this.file.name,
      this.file.size.toString(),
      this.file.lastModified.toString(),
      this.task.path || '',
    ];
    // 简单的字符串哈希，用于浏览器兼容性
    return parts.join('|');
  }

  /**
   * 保存检查点覆盖
   */
  protected async saveCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint || !this.chunkManager) {
      return;
    }

    const fingerprint = this.getFingerprint();
    const checkpoint = {
      taskId: this.task.id,
      fingerprint,
      fileName: this.file.name,
      fileSize: this.file.size,
      lastModified: this.file.lastModified,
      path: this.task.path,
      file: this.file,
      transferredBytes: this.chunkManager.getUploadedBytes(),
      completedChunks: this.chunkManager.getCompletedIndices(),
      fileHash: this.task.hash,
      timestamp: Date.now(),
      chunkLayout: this.chunkManager.getChunkLayout ? this.chunkManager.getChunkLayout() : undefined,
    };

    // 使用指纹作为键
    const key = `checkpoint_${fingerprint}`;
    await this.storageAdapter.set(key, checkpoint);
  }

  /**
   * 加载检查点覆盖
   */
  protected async loadCheckpoint(fingerprint?: string): Promise<any> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return null;
    }

    const key = `checkpoint_${fingerprint || this.getFingerprint()}`;
    return await this.storageAdapter.get(key);
  }

  /**
   * 删除检查点覆盖
   */
  protected async deleteCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return;
    }

    const fingerprint = this.getFingerprint();
    const key = `checkpoint_${fingerprint}`;
    await this.storageAdapter.remove(key);
  }
}
