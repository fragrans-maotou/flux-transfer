import { ITransferStrategy, ITransferContext, ISDKConfig, ITransferTask } from '../types';

/**
 * 小文件内存下载策略 (Blob Download)
 * 适用于无需防 OOM 的小文件下载。
 */
export class BlobDownloadStrategy implements ITransferStrategy {
  public canHandle(task: ITransferTask, _config: ISDKConfig): boolean {
    // 默认拦截所有非流式下载任务
    return task.type === 'download' && task.meta?.forceStream !== true;
  }

  public async execute(context: ITransferContext): Promise<void> {
    const { task, store, config, abortController } = context;
    const { id: taskId, url } = task;

    if (!url) throw new Error('Download URL is required');

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'transferring' } }
    });

    try {
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

      const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            chunks.push(value);
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
                  uploadedBytes: loaded, // 复用该字段表示下载量
                  totalBytes: contentLength || loaded,
                  speed,
                  remainingTime
                }
              }
            });
          }
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') || 'application/octet-stream' });
      
      // 触发原生下载
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      
      // 从 headers 中提取 filename，如果没有则默认 fallback
      const contentDisposition = response.headers.get('content-disposition');
      let filename = task.meta?.filename || 'downloaded_file';
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (matches != null && matches[1]) { 
          filename = matches[1].replace(/['"]/g, '');
        }
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      // 标记完成
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
