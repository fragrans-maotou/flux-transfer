import { TransferStore } from './store';
import { createStorageMiddleware } from './storage-middleware';
import { IStore, ISDKConfig, validateConfig, ITransferStrategy, INetworkAdapter, ITransferOptions, ITransferTask } from './types';
import {
  DirectUploadStrategy,
  ChunkedUploadStrategy,
  SequentialChunkedUploadStrategy,
  BlobDownloadStrategy,
  StreamDownloadStrategy
} from './strategies';

/**
 * Flux Transfer Engine 调度引擎
 * 作为 SDK 的极简门面 (Facade)，负责组合 Store、Network 和 Strategies
 */
export class TransferEngine {
  public readonly store: IStore;
  public readonly config: ISDKConfig;
  private readonly network?: INetworkAdapter;
  
  private uploadStrategies: ITransferStrategy[] = [];
  private downloadStrategies: ITransferStrategy[] = [];

  private previousTasks: Record<string, ITransferTask> = {};

  constructor(config: ISDKConfig = {}) {
    this.config = validateConfig(config);
    this.store = new TransferStore();
    this.network = this.config.networkAdapter;

    // 注册策略（用户自定义策略优先，然后是串行分块策略，接着是普通分块策略，最后是直传）
    this.uploadStrategies = [
      ...(this.config.customUploadStrategies || []),
      new SequentialChunkedUploadStrategy(),
      new DirectUploadStrategy(),
      new ChunkedUploadStrategy(),
    ];
    this.downloadStrategies = [
      ...(this.config.customDownloadStrategies || []),
      new BlobDownloadStrategy(),
      new StreamDownloadStrategy(),
    ];

    // 如果开启断点续传且提供了存储适配器，则挂载持久化中间件
    if (this.config.enableCheckpoint && this.config.storageAdapter) {
      createStorageMiddleware(this.store, this.config.storageAdapter, 'flux-transfer-tasks');
    }

    // 订阅 Store，派发生命周期事件给全局 Plugins
    this.store.subscribe((state) => {
      const plugins = this.config.plugins || [];
      const currentTasks = state.tasks;
      
      for (const taskId in currentTasks) {
        const task = currentTasks[taskId];
        const prevTask = this.previousTasks[taskId];

        if (!prevTask) {
          plugins.forEach(p => p.onTaskCreated?.(task));
        } else {
          if (task.status !== prevTask.status) {
            if (task.status === 'completed') plugins.forEach(p => p.onTaskCompleted?.(task));
            else if (task.status === 'failed') plugins.forEach(p => p.onTaskFailed?.(task));
          } else if (task.progress !== prevTask.progress) {
            plugins.forEach(p => p.onTaskProgress?.(task));
          }
        }
      }
      this.previousTasks = { ...currentTasks };
    });
  }

  /**
   * 极简对外 API：上传文件
   * @param file 要上传的文件对象
   * @returns 唯一的任务 ID
   */
  public upload(file: File, options?: ITransferOptions): string {
    const taskId = this.generateId();
    
    this.store.dispatch({
      type: 'ADD_TASK',
      payload: {
        id: taskId,
        type: 'upload',
        status: 'idle',
        file,
        url: options?.uploadUrl || null,
        progress: 0,
        uploadedBytes: 0,
        totalBytes: file.size,
        speed: 0,
        remainingTime: 0,
        meta: {
          ...options?.meta,
          formData: options?.data,
          mergeUrl: options?.mergeUrl,
        },
      }
    });

    // 异步调度任务执行
    this.scheduleTask(taskId).catch(err => {
      console.error(`Task ${taskId} scheduling failed:`, err);
    });

    return taskId;
  }

  /**
   * 极简对外 API：下载文件
   * @param url 下载目标 URL
   * @returns 唯一的任务 ID
   */
  public download(url: string, options?: ITransferOptions): string {
    const taskId = this.generateId();

    this.store.dispatch({
      type: 'ADD_TASK',
      payload: {
        id: taskId,
        type: 'download',
        status: 'idle',
        file: null,
        url,
        progress: 0,
        uploadedBytes: 0,
        totalBytes: 0, // 下载前通常未知，由策略执行时更新
        speed: 0,
        remainingTime: 0,
        meta: {
          ...options?.meta,
          formData: options?.data, // 如果下载也需要附加参数（如鉴权等），也可以放在这里
        },
      }
    });

    // 异步调度任务执行
    this.scheduleTask(taskId).catch(err => {
      console.error(`Task ${taskId} scheduling failed:`, err);
    });

    return taskId;
  }

  /**
   * 内部策略路由机制
   * 根据任务的上下文，寻找并执行匹配的策略
   */
  private async scheduleTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) return;

    // 选择对应的策略池
    const strategies = task.type === 'upload' ? this.uploadStrategies : this.downloadStrategies;
    
    // 寻找第一个匹配任务的策略
    const strategy = strategies.find(s => s.canHandle(task, this.config));
    
    if (strategy) {
      // 构造上下文并交由策略执行主体逻辑
      const abortController = new AbortController();
      
      try {
        await strategy.execute({
          task,
          store: this.store,
          network: this.network,
          config: this.config,
          abortController
        });
      } catch (error: any) {
        // 如果策略执行抛出异常，更新状态为失败
        this.store.dispatch({
          type: 'UPDATE_TASK',
          payload: {
            id: taskId,
            updates: { 
              status: 'failed',
              error: error instanceof Error ? error : new Error(String(error))
            }
          }
        });
      }
    } else {
      console.warn(`No suitable strategy found for task ${taskId}`);
      this.store.dispatch({
        type: 'UPDATE_TASK',
        payload: {
          id: taskId,
          updates: { 
            status: 'failed',
            error: new Error('No suitable strategy found')
          }
        }
      });
    }
  }

  /**
   * 生成简单的唯一任务 ID
   */
  private generateId(): string {
    return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }
}
