import { ITransferStrategy, ITransferContext, ISDKConfig, ITransferTask } from '../types';

/**
 * 小文件直传策略 (Direct Upload)
 * 适用于体积较小、不需要分片和断点续传的文件。
 */
export class DirectUploadStrategy implements ITransferStrategy {
  // 5MB 作为小文件界限
  private static readonly MAX_DIRECT_SIZE = 5 * 1024 * 1024;

  /**
   * 判断是否能处理该任务
   */
  public canHandle(task: ITransferTask, config: ISDKConfig): boolean {
    if (task.type !== 'upload') return false;
    if (!task.file) return false;
    
    // 如果用户配置了 chunkSize，以此为准，否则使用默认的 5MB
    const limit = config.chunkSize || DirectUploadStrategy.MAX_DIRECT_SIZE;
    return task.file.size <= limit;
  }

  /**
   * 执行主体上传逻辑
   */
  public async execute(context: ITransferContext): Promise<void> {
    const { task, store, network, config, abortController } = context;
    const { id: taskId, file } = task;

    if (!file) {
      throw new Error('No file provided for upload');
    }

    // 更新任务状态为处理中（准备网络请求）
    store.dispatch({
      type: 'UPDATE_TASK',
      payload: {
        id: taskId,
        updates: { status: 'processing' }
      }
    });

    const url = task.url || config.uploadUrl || (config.baseURL ? `${config.baseURL}/upload` : '/upload');
    
    try {
      // 更新状态为传输中
      store.dispatch({
        type: 'UPDATE_TASK',
        payload: {
          id: taskId,
          updates: { status: 'transferring' }
        }
      });

      // 组装 FormData
      const formData = new FormData();
      formData.append('file', file);
      
      // 附加额外的参数
      if (task.meta?.formData) {
        Object.entries(task.meta.formData).forEach(([key, value]) => {
          if (value instanceof Blob) {
            formData.append(key, value);
          } else {
            formData.append(key, String(value));
          }
        });
      }
      
      const startTime = Date.now();

      // 如果有注入的 network adapter，则优先使用它，否则降级使用原生 fetch
      if (network) {
        await network.request({
          url,
          method: 'POST',
          body: formData,
          headers: config.headers,
          signal: abortController.signal,
          onUploadProgress: (loaded: number, total: number) => {
            this.updateProgress(taskId, loaded, total, startTime, store);
          }
        });
      } else {
        // 使用原生 fetch（注意原生的 fetch 没法原生拿到 upload progress，只能拿到整个请求结束或者用 XMLHttpRequest，
        // 这里假设使用 fetch 时由于文件小，进度直接走 0 -> 100）
        const response = await fetch(url, {
          method: 'POST',
          body: formData,
          headers: config.headers,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status: ${response.status}`);
        }

        // 强行设为 100%
        this.updateProgress(taskId, file.size, file.size, startTime, store);
      }

      // 上传成功，更新任务状态为 completed
      store.dispatch({
        type: 'UPDATE_TASK',
        payload: {
          id: taskId,
          updates: { 
            status: 'completed',
            progress: 100,
            uploadedBytes: file.size
          }
        }
      });

    } catch (error: any) {
      // 处理被取消的情况
      if (error.name === 'AbortError') {
        store.dispatch({
          type: 'UPDATE_TASK',
          payload: {
            id: taskId,
            updates: { status: 'cancelled' }
          }
        });
        return;
      }

      // 重新抛出异常，交由外层 engine 捕获并设置为 failed
      throw error;
    }
  }

  /**
   * 内部进度更新辅助方法
   */
  private updateProgress(taskId: string, loaded: number, total: number, startTime: number, store: ITransferContext['store']) {
    const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
    
    const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
    const speed = elapsedTime > 0 ? Math.round(loaded / elapsedTime) : 0; // bytes per second
    const remainingBytes = total - loaded;
    const remainingTime = speed > 0 ? Math.round(remainingBytes / speed) * 1000 : 0; // in ms

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: {
        id: taskId,
        updates: {
          progress,
          uploadedBytes: loaded,
          speed,
          remainingTime
        }
      }
    });
  }
}
