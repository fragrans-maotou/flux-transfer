import { ITransferStrategy, ITransferContext, ISDKConfig, ITransferTask } from '../types';

/**
 * 大文件流式下载策略 (Stream Download)
 * 采用 File System Access API 实现流式写入硬盘，防止浏览器 OOM。
 */
export class StreamDownloadStrategy implements ITransferStrategy {
  public canHandle(task: ITransferTask, _config: ISDKConfig): boolean {
    if (task.type !== 'download') return false;
    
    // 检查是否支持 showSaveFilePicker API 且用户明确要求开启流式下载
    // 因为 showSaveFilePicker 必须在用户交互（如点击按钮）的上下文中调用
    const isSupported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
    return isSupported && task.meta?.forceStream === true;
  }

  public async execute(context: ITransferContext): Promise<void> {
    const { task, store, config, abortController } = context;
    const { id: taskId, url } = task;

    if (!url) throw new Error('Download URL is required');

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'processing' } }
    });

    try {
      // 1. 让用户选择保存路径
      // @ts-ignore - TS dom lib doesn't include File System Access API out of the box yet
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: task.meta?.filename || 'downloaded_file',
      });
      const writableStream = await fileHandle.createWritable();

      // 2. 开始请求网络
      store.dispatch({
        type: 'UPDATE_TASK',
        payload: { id: taskId, updates: { status: 'transferring' } }
      });

      const response = await fetch(url, {
        method: 'GET',
        headers: config.headers,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Download failed with status: ${response.status}`);
      }

      const contentLength = Number(response.headers.get('content-length')) || 0;
      let loaded = 0;
      const startTime = Date.now();

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          // 直接写入硬盘，避免内存累积
          await writableStream.write(value);
          loaded += value.length;
          
          // 更新进度
          const progress = contentLength > 0 ? Math.round((loaded / contentLength) * 100) : 0;
          const elapsedTime = (Date.now() - startTime) / 1000;
          const speed = elapsedTime > 0 ? Math.round(loaded / elapsedTime) : 0;
          const remainingTime = speed > 0 && contentLength > 0 ? Math.round((contentLength - loaded) / speed) * 1000 : 0;

          store.dispatch({
            type: 'UPDATE_TASK',
            payload: {
              id: taskId,
              updates: {
                progress,
                uploadedBytes: loaded, 
                totalBytes: contentLength || loaded,
                speed,
                remainingTime
              }
            }
          });
        }
      }

      // 关闭文件流
      await writableStream.close();

      store.dispatch({
        type: 'UPDATE_TASK',
        payload: {
          id: taskId,
          updates: { 
            status: 'completed',
            progress: 100,
          }
        }
      });

    } catch (error: any) {
      if (error.name === 'AbortError') {
        store.dispatch({
          type: 'UPDATE_TASK',
          payload: { id: taskId, updates: { status: 'cancelled' } }
        });
        return;
      }
      throw error;
    }
  }
}
