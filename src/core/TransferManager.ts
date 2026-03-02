/**
 * 入口方法
 */

import { EventEmitter } from '../infra/EventEmitter';
import { IndexedDBStorage } from '../infra/storage/IndexedDBStorage';
import { LocalStorageAdapter } from '../infra/storage/LocalStorageAdapter';
import { BaseTransfer } from './BaseTransfer';
import { Downloader, type IDownloadConfig } from './downloader/Downloader';
import type { IGroupStatus } from './plugin/types';
import { TaskQueue } from './TaskQueue';
import { TaskStatus, TransferType, type ISDKConfig, type ITransferTask } from './types';
import { Uploader, type IUploadConfig } from './uploader/Uploader';

/**
 * TransferManager - 高级API，用于管理文件传输
 */
export class TransferManager extends EventEmitter {
  private queue: TaskQueue;
  private tasks: Map<string, BaseTransfer> = new Map();
  private config: ISDKConfig;

  constructor(config: ISDKConfig = { maxConcurrent: 3 }) {
    super();
    this.config = config;
    this.queue = new TaskQueue(config.maxConcurrent || 3);

    // 自动初始化存储适配器
    if (this.config.enableCheckpoint !== false && !this.config.storageAdapter) {
      this.initDefaultStorage();
    }
  }

  private initDefaultStorage(): void {
    // 采用那种存储方式
    if (typeof window !== 'undefined' && window.indexedDB) {
      this.config.storageAdapter = new IndexedDBStorage();
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.config.storageAdapter = new LocalStorageAdapter();
    }
  }

  /**
   * 创建一个上传器
   * @param file 文件
   * @param config 上传配置
   * @param groupId 可选组ID
   * @returns Uploader实例
   */
  createUploader(file: File, config: IUploadConfig, groupId?: string): Uploader {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const task: ITransferTask = {
      id: taskId,
      status: TaskStatus.Idle,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      path: (file as any).webkitRelativePath || undefined,
      groupId,
      transferType: TransferType.Upload,
      progress: 0,
      speed: 0,
      remainingTime: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 合并管理器配置和任务配置，特别注意合并 plugins
    const finalConfig = {
      ...this.config,
      ...config,
      plugins: [...(this.config.plugins || []), ...(config.plugins || [])]
    };
    const uploader = new Uploader(task, file, finalConfig);
    this.tasks.set(taskId, uploader);

    // 注入 manager 引用，供插件访问分组状态
    uploader.setManagerRef(this);

    // 接管子任务事件，向外层广播
    this.bindTaskEvents(uploader);

    return uploader;
  }

  /**
   * 创建一个下载器
   * @param url 下载地址
   * @param config 下载配置
   * @param groupId 可选组ID
   * @returns Downloader实例
   */
  createDownloader(url: string, config: Omit<IDownloadConfig, 'downloadUrl'>, groupId?: string): Downloader {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 从URL中提取文件名
    const fileName = config.fileName || this.extractFileNameFromUrl(url);

    const task: ITransferTask = {
      id: taskId,
      status: TaskStatus.Idle,
      fileName,
      fileSize: config.fileSize || 0, // Will be determined during download
      fileType: 'application/octet-stream',
      groupId,
      transferType: TransferType.Download,
      progress: 0,
      speed: 0,
      remainingTime: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 合并管理器配置和任务配置，特别注意合并 plugins
    const finalConfig: IDownloadConfig = {
      ...this.config,
      ...config,
      downloadUrl: url,
      plugins: [...(this.config.plugins || []), ...(config.plugins || [])]
    };
    const downloader = new Downloader(task, finalConfig);
    this.tasks.set(taskId, downloader);

    // 接管子任务事件，向外层广播
    this.bindTaskEvents(downloader);

    return downloader;
  }

  /**
   * 从URL中提取文件名
   */
  private extractFileNameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.substring(pathname.lastIndexOf('/') + 1);
      return fileName || 'download';
    } catch {
      return 'download';
    }
  }

  /**
   * 添加多个上传任务到队列并自动开始
   * @param files 文件列表（来自输入或数组）
   * @param config 上传配置
   * @param groupId 可选组ID
   * @returns Uploader实例数组
   */
  uploadBatch(files: FileList | File[], config: IUploadConfig, groupId?: string): Uploader[] {
    const fileList = Array.from(files);
    return fileList.map(file => {
      const uploader = this.createUploader(file, config, groupId);
      this.queue.enqueue(uploader);
      return uploader;
    });
  }

  /**
   * 添加多个下载任务到队列并自动开始
   * @param urls 下载地址列表
   * @param config 下载配置
   * @param groupId 可选组ID
   * @returns Downloader实例数组
   */
  downloadBatch(urls: string[], config: Omit<IDownloadConfig, 'downloadUrl'>, groupId?: string): Downloader[] {
    return urls.map(url => {
      const downloader = this.createDownloader(url, config, groupId);
      this.queue.enqueue(downloader);
      return downloader;
    });
  }

  /**
   * 根据任务ID获取传输任务（上传器或下载器）
   */
  getTask(taskId: string): BaseTransfer | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 根据任务ID获取上传器
   * @deprecated Use getTask() instead
   */
  getUploader(taskId: string): BaseTransfer | undefined {
    return this.tasks.get(taskId);
  }

  // 私有：绑定任务事件
  private bindTaskEvents(transfer: BaseTransfer): void {
    transfer.on('statusChange', (data) => this.emit('taskStatusChange', data));
    transfer.on('progress', (data) => this.emit('taskProgress', data));
    transfer.on('error', (error) => this.emit('taskError', error));
    transfer.on('completed', (task) => this.emit('taskCompleted', task));
    transfer.on('cancelled', (task) => this.emit('taskCancelled', task));
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): ITransferTask[] {
    return Array.from(this.tasks.values()).map(u => u.getTask());
  }

  /**
   * 获取组ID的任务
   */
  getTasksByGroup(groupId: string): ITransferTask[] {
    return this.getAllTasks().filter(t => t.groupId === groupId);
  }

  /**
   * 获取组任务的状态
   */
  getGroupStatus(groupId: string): IGroupStatus {
    const tasks = this.getTasksByGroup(groupId);
    if (tasks.length === 0) {
      return { total: 0, completed: 0, failed: 0, progress: 0, isAllCompleted: false };
    }

    const completed = tasks.filter(t => t.status === TaskStatus.Completed).length;
    const failed = tasks.filter(t => t.status === TaskStatus.Failed).length;
    const totalProgress = tasks.reduce((sum, t) => sum + t.progress, 0);
    const progress = Math.round(totalProgress / tasks.length);
    const isAllCompleted = completed === tasks.length;

    return { total: tasks.length, completed, failed, progress, isAllCompleted };
  }

  /**
   * 获取所有可恢复的会话
   */
  async getRecoverableSessions(): Promise<any[]> {
    if (!this.config.storageAdapter || !this.config.enableCheckpoint) {
      return [];
    }

    try {
      const keys = await this.config.storageAdapter.keys();
      const checkpoints = [];

      for (const key of keys) {
        if (key.startsWith('checkpoint_')) {
          const data = await this.config.storageAdapter.get(key);
          if (data) checkpoints.push(data);
        }
      }

      return checkpoints.sort((a: any, b: any) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to scan recoverable sessions:', error);
      return [];
    }
  }

  /**
   * 从存储中恢复中断的上传任务
   * 
   * 扫描 IndexedDB/LocalStorage 中保存的 checkpoint，
   * 对包含有效 File 对象的记录重建 Uploader 并恢复进度。
   * 恢复后的任务状态为 Paused，由用户决定是否 resume()。
   * 
   * @param configOverrides - 可选的配置覆盖（如更换 uploadUrl、添加 networkAdapter）
   * @returns 恢复的 Uploader 数组
   * 
   * @example
   * ```js
   * const manager = new TransferManager({ enableCheckpoint: true });
   * 
   * // 页面加载后恢复中断的任务
   * const restored = await manager.restore({
   *   networkAdapter: new FetchAdapter(),
   * });
   * 
   * restored.forEach(uploader => {
   *   console.log(`恢复: ${uploader.getTask().fileName}, 进度: ${uploader.getTask().progress}%`);
   *   // 自动继续或由用户决定
   *   uploader.resume();
   * });
   * ```
   */
  async restore(configOverrides?: Partial<IUploadConfig>): Promise<Uploader[]> {
    if (!this.config.storageAdapter || !this.config.enableCheckpoint) {
      return [];
    }

    const restored: Uploader[] = [];

    try {
      const checkpoints = await this.getRecoverableSessions();

      for (const checkpoint of checkpoints) {
        // 必须含有有效的 File 对象（IndexedDB 可以持久化 File/Blob）
        if (!checkpoint.file || !(checkpoint.file instanceof File)) {
          continue;
        }

        const file: File = checkpoint.file;
        const savedConfig: IUploadConfig = checkpoint.uploadConfig || {};

        // 合并配置优先级：管理器全局配置 < checkpoint 保存的配置 < 用户覆盖
        const finalConfig: IUploadConfig = {
          ...this.config,
          ...savedConfig,
          ...configOverrides,
        };

        // 重建 Uploader
        const uploader = this.createUploader(file, finalConfig, checkpoint.groupId);

        // 从存储中恢复进度和状态
        const success = await uploader.restoreFromStorage();
        if (success) {
          restored.push(uploader);
        }
      }
    } catch (error) {
      console.error('Failed to restore sessions:', error);
    }

    return restored;
  }
}
