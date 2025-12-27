import { Uploader, type IUploadConfig } from './Uploader';
import { TaskStatus, type ITransferTask } from './types';
import { TaskQueue } from './TaskQueue';

/**
 * TransferManager - High-level API for managing file transfers
 */
export class TransferManager {
  private queue: TaskQueue;
  private tasks: Map<string, Uploader> = new Map();
  private config: IUploadConfig;

  constructor(config: IUploadConfig = { maxConcurrent: 3 }) {
    this.config = config;
    this.queue = new TaskQueue(config.maxConcurrent || 3)
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
      progress: 0,
      speed: 0,
      remainingTime: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Merge manager config with task config
    const finalConfig = { ...this.config, ...config };
    const uploader = new Uploader(task, file, finalConfig);
    console.log("uploaderuploader", uploader);

    this.tasks.set(taskId, uploader);

    // If queue is configured, we could auto-enqueue, but for now let's just return it
    // to give user full control over start/pause/cancel.

    return uploader;
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
   * Get uploader by task ID
   */
  getUploader(taskId: string): Uploader | undefined {
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
    console.log("this.config", this.config);

    if (!this.config.storageAdapter || !this.config.enableCheckpoint) {
      return [];
    }

    console.log("this.config11", this.config);
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
