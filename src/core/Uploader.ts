/**
 * Uploader - File upload with chunking and resume support
 */

import { BaseTransfer } from './BaseTransfer';
import { ChunkManager } from './uploader/ChunkManager';
import { TaskStatus, ErrorCode, type ITransferTask, type ISDKConfig } from './types';
import { HashCalculator } from '../infra/worker/HashCalculator';
import { PluginManager } from './plugin/PluginManager';
import { IPluginContext } from './plugin/types';

/**
 * Upload configuration interface
 */
export interface IUploadConfig extends ISDKConfig {
  /** Upload URL */
  uploadUrl?: string;
  /** Merge chunks URL */
  mergeUrl?: string;
  /** Check file exists URL */
  checkUrl?: string;
  /** Max concurrent chunk uploads */
  maxConcurrentChunks?: number;
  /** Field name for the file in FormData (default: 'file') */
  fileFieldName?: string;
  /** Extra parameters to include in FormData */
  extraParams?: Record<string, string> | ((chunkIndex: number, totalChunks: number, taskId: string) => Record<string, string>);
}

/**
 * Uploader class for file uploads
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
   * Start upload
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

      // Load checkpoint if available
      // Initialize chunk manager early
      this.chunkManager = new ChunkManager(this.file, this.config.chunkSize || 5 * 1024 * 1024);
      const fingerprint = this.getFingerprint();
      const checkpoint = await this.loadCheckpoint(fingerprint);

      // Restore from checkpoint
      if (checkpoint) {
        if (checkpoint.fileHash) {
          this.task.hash = checkpoint.fileHash;
        }
        // Restore layout first if available
        if (checkpoint.chunkLayout && this.chunkManager.restoreLayout) {
          this.chunkManager.restoreLayout(checkpoint.chunkLayout);
        }
        if (checkpoint.completedChunks) {
          // If layout was restored, existing chunks match the checkpoint indices
          this.chunkManager.restoreFromCheckpoint(checkpoint.completedChunks);
          const uploadedBytes = this.chunkManager.getUploadedBytes();
          this.updateProgress(uploadedBytes, this.file.size);
        }
      }

      // Hash Calculation
      if (this.config.enableHash && !this.task.hash) {
        this.setStatus(TaskStatus.Processing);
        try {
          const result = await HashCalculator.calculateHash(this.file, {
            onProgress: (progress) => {
              // Optional: emit hash progress
            }
          });
          this.task.hash = result.hash;
          // Save hash to checkpoint immediately
          await this.saveCheckpoint();

          // Pre-check (Instant Upload)
          if (this.uploadConfig.checkUrl) {
            // TODO: Implement instant upload check
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

      if (this.task.status !== TaskStatus.Processing && this.task.status !== TaskStatus.Idle) {
        // Check cancellation during hash
        return;
      }
      this.setStatus(TaskStatus.Transferring);

      // Hook: afterStart
      await this.pluginManager.runHook('afterStart', this.getPluginContext());

      // Start uploading
      await this.uploadChunks();

      // If we are not in Transferring state (e.g. Paused, Failed, Cancelled), stop here
      if ((this.task.status as TaskStatus) !== TaskStatus.Transferring) {
        return;
      }

      // Merge chunks
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
   * Pause upload
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
   * Resume upload
   */
  async resume(): Promise<void> {
    if (this.task.status === TaskStatus.Paused || this.task.status === TaskStatus.Failed) {
      this.abortController = new AbortController();

      // Reset failed chunks (e.g. from abort) to pending so they are picked up
      const failedChunks = this.chunkManager?.getFailedChunks() || [];
      failedChunks.forEach(chunk => this.chunkManager?.retryChunk(chunk.index));

      this.setStatus(TaskStatus.Transferring);
      await this.uploadChunks();

      // If we are not in Transferring state (e.g. Paused, Failed, Cancelled), stop here
      if ((this.task.status as TaskStatus) !== TaskStatus.Transferring) {
        return;
      }

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
   * Cancel upload
   */
  cancel(): void {
    this.setStatus(TaskStatus.Cancelled);
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Upload chunks
   */
  private async uploadChunks(): Promise<void> {
    if (!this.chunkManager) {
      throw new Error('ChunkManager not initialized');
    }

    const maxConcurrent = this.uploadConfig.maxConcurrentChunks || 3;

    while (!this.chunkManager.isComplete() && this.task.status === TaskStatus.Transferring) {
      const batch = this.chunkManager.getNextBatch(maxConcurrent - this.uploadingChunks.size);

      if (batch.length === 0) {
        // Wait for ongoing uploads to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // Upload batch concurrently
      const uploadPromises = batch.map((chunk) => this.uploadChunk(chunk.index));
      await Promise.allSettled(uploadPromises);

      // Update progress
      const uploadedBytes = this.chunkManager.getUploadedBytes();
      this.updateProgress(uploadedBytes, this.file.size);

      // Hook: onProgress
      this.pluginManager.runHookParallel('onProgress', this.getPluginContext(), this.task.progress);

      // Save checkpoint
      if (this.config.enableCheckpoint) {
        await this.saveCheckpoint();
      }
    }
  }

  /**
   * Upload single chunk
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

      // Create form data
      const formData = new FormData();
      formData.append(fileFieldName, chunk.blob, this.file.name);

      // Add extra parameters
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

      // Upload with retry
      await this.executeWithRetry(async () => {
        if (!this.config.networkAdapter) {
          throw new Error('Network adapter not configured');
        }

        let requestConfig: import('./types').INetworkRequestConfig = {
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

      // Adaptive Chunking: Adjust size based on speed
      if (this.chunkManagerHasAdaptiveSizing()) {
        const duration = Date.now() - startTime;
        if (duration > 0) {
          const speed = chunk.size / (duration / 1000); // bytes per second
          // Simple moving average for stability
          this.task.speed = this.task.speed === 0 ? speed : (this.task.speed * 0.7) + (speed * 0.3);

          // Target 2 seconds per chunk
          const TARGET_TIME = 2000;
          const idealSize = Math.floor(this.task.speed * (TARGET_TIME / 1000));

          // Clamp size (MIN 256KB, MAX 50MB)
          const newSize = Math.max(256 * 1024, Math.min(idealSize, 50 * 1024 * 1024));

          // Only resize if difference is significant (> 20%)
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
    return !!this.chunkManager && typeof this.chunkManager.resizeRemaining === 'function';
  }

  /**
   * Merge chunks on server
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
   * Restore state from storage without starting upload
   */
  async restoreFromStorage(): Promise<boolean> {
    try {
      const fingerprint = this.getFingerprint();
      const checkpoint = await this.loadCheckpoint(fingerprint);

      if (!checkpoint || !checkpoint.completedChunks) {
        return false;
      }

      // Initialize chunk manager
      this.chunkManager = new ChunkManager(this.file, this.config.chunkSize || 5 * 1024 * 1024);
      this.chunkManager.restoreFromCheckpoint(checkpoint.completedChunks);

      // Update task status and progress
      const uploadedBytes = this.chunkManager.getUploadedBytes();
      this.updateProgress(uploadedBytes, this.file.size);

      // Restore hash if available
      if (checkpoint.fileHash) {
        this.task.hash = checkpoint.fileHash;
      }

      // Update internal state
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
   * Get deterministic file fingerprint
   */
  private getFingerprint(): string {
    const parts = [
      this.file.name,
      this.file.size.toString(),
      this.file.lastModified.toString(),
      this.task.path || '',
    ];
    // Simple string hash for browser compatibility without external deps
    // In production, you might want to use a proper hash function
    return parts.join('|');
  }

  /**
   * Save checkpoint override
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

    // Use fingerprint as key primarily, or associate both
    const key = `checkpoint_${fingerprint}`;
    await this.storageAdapter.set(key, checkpoint);
  }

  /**
   * Load checkpoint override
   */
  protected async loadCheckpoint(fingerprint?: string): Promise<any> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return null;
    }

    const key = `checkpoint_${fingerprint || this.getFingerprint()}`;
    return await this.storageAdapter.get(key);
  }

  /**
   * Delete checkpoint override
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
