import { Uploader, type IUploadConfig } from './Uploader';
import { Downloader, type IDownloadConfig } from './Downloader';
import { BaseTransfer } from './BaseTransfer';
import { TaskStatus, TransferType, type ITransferTask, type ISDKConfig } from './types';
import { TaskQueue } from './TaskQueue';
import { IndexedDBStorage } from '../infra/storage/IndexedDBStorage';
import { LocalStorageAdapter } from '../infra/storage/LocalStorageAdapter';

/**
 * TransferManager - 高级API，用于管理文件传输
 */
export class TransferManager {
  private queue: TaskQueue;
  private tasks: Map<string, BaseTransfer> = new Map();
  private config: ISDKConfig;

  constructor(config: ISDKConfig = { maxConcurrent: 3 }) {
    this.config = config;
    this.queue = new TaskQueue(config.maxConcurrent || 3);

    // Auto-initialize storage adapter if not provided
    if (this.config.enableCheckpoint !== false && !this.config.storageAdapter) {
      this.initDefaultStorage();
    }
  }

  private initDefaultStorage(): void {
    if (typeof window !== 'undefined' && window.indexedDB) {
      this.config.storageAdapter = new IndexedDBStorage();
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.config.storageAdapter = new LocalStorageAdapter();
    }
  }

  /**
   * Create an uploader for a file
   * @param file File to upload
   * @param config Upload configuration
   * @param groupId Optional group ID
   * @returns Uploader instance
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

    // Merge manager config with task config
    const finalConfig = { ...this.config, ...config };
    const uploader = new Uploader(task, file, finalConfig);
    this.tasks.set(taskId, uploader);

    // If queue is configured, we could auto-enqueue, but for now let's just return it
    // to give user full control over start/pause/cancel.

    return uploader;
  }

  /**
   * Create a downloader for a URL
   * @param url URL to download
   * @param config Download configuration
   * @param groupId Optional group ID
   * @returns Downloader instance
   */
  createDownloader(url: string, config: IDownloadConfig, groupId?: string): Downloader {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Extract filename from URL
    const fileName = config.saveAs || this.extractFileNameFromUrl(url);
    
    const task: ITransferTask = {
      id: taskId,
      status: TaskStatus.Idle,
      fileName,
      fileSize: 0, // Will be determined during download
      fileType: 'application/octet-stream',
      groupId,
      transferType: TransferType.Download,
      progress: 0,
      speed: 0,
      remainingTime: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Merge manager config with task config
    const finalConfig = { ...this.config, ...config };
    const downloader = new Downloader(task, url, finalConfig);
    this.tasks.set(taskId, downloader);

    return downloader;
  }

  /**
   * Extract file name from URL
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
   * Add multiple upload tasks to queue and start automatically
   * @param files List of files (from input or array)
   * @param config Upload configuration
   * @param groupId Optional group ID
   * @returns Array of Uploader instances
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
   * Add multiple download tasks to queue and start automatically
   * @param urls List of URLs to download
   * @param config Download configuration
   * @param groupId Optional group ID
   * @returns Array of Downloader instances
   */
  downloadBatch(urls: string[], config: IDownloadConfig, groupId?: string): Downloader[] {
    return urls.map(url => {
      const downloader = this.createDownloader(url, config, groupId);
      this.queue.enqueue(downloader);
      return downloader;
    });
  }

  /**
   * Get transfer task by task ID (uploader or downloader)
   */
  getTask(taskId: string): BaseTransfer | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get uploader by task ID
   * @deprecated Use getTask() instead
   */
  getUploader(taskId: string): BaseTransfer | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ITransferTask[] {
    return Array.from(this.tasks.values()).map(u => u.getTask());
  }

  /**
   * Get tasks by group ID
   */
  getTasksByGroup(groupId: string): ITransferTask[] {
    return this.getAllTasks().filter(t => t.groupId === groupId);
  }

  /**
   * Get status of a group of tasks
   */
  getGroupStatus(groupId: string): { total: number, completed: number, progress: number, status: TaskStatus } {
    const tasks = this.getTasksByGroup(groupId);
    if (tasks.length === 0) {
      return { total: 0, completed: 0, progress: 0, status: TaskStatus.Idle };
    }

    const completed = tasks.filter(t => t.status === TaskStatus.Completed).length;
    const totalProgress = tasks.reduce((sum, t) => sum + t.progress, 0);
    const progress = Math.round(totalProgress / tasks.length);

    let status = TaskStatus.Transferring;
    if (completed === tasks.length) {
      status = TaskStatus.Completed;
    } else if (tasks.some(t => t.status === TaskStatus.Failed)) {
      status = TaskStatus.Failed;
    } else if (tasks.every(t => t.status === TaskStatus.Idle)) {
      status = TaskStatus.Idle;
    } else if (tasks.every(t => t.status === TaskStatus.Paused)) {
      status = TaskStatus.Paused;
    }

    return { total: tasks.length, completed, progress, status };
  }

  /**
   * Get all recoverable sessions from storage
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
}
