import { ITransferStrategy, ITransferContext, ISDKConfig, ITransferTask } from '../types';

export class SequentialChunkedUploadStrategy implements ITransferStrategy {
  public canHandle(task: ITransferTask, config: ISDKConfig): boolean {
    if (task.type !== 'upload') return false;
    if (!task.file) return false;
    // 只有在明确配置了 useSequentialChunking 时，才启用此策略
    return !!config.useSequentialChunking;
  }

  public async execute(context: ITransferContext): Promise<void> {
    const { task, store, network, config, abortController } = context;
    const { id: taskId, file } = task;

    if (!file) {
      throw new Error('No file provided for upload');
    }

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'processing' } }
    });

    const chunkSize = config.chunkSize || 5 * 1024 * 1024;
    const seqConfig = config.sequentialConfig || {};
    const offsetParamName = seqConfig.offsetParamName || 'position';
    const offsetLocation = seqConfig.offsetLocation || 'body';
    const fileParamName = seqConfig.fileParamName || 'file';

    let position = 0;
    // 用于保存需要透传的上下文，比如 document_id
    let sessionData: Record<string, any> = {};
    const startTime = Date.now();

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'transferring' } }
    });

    const uploadUrl = task.url || config.uploadUrl || (config.baseURL ? `${config.baseURL}/upload` : '/upload');

    try {
      let isFirst = true;
      while (position < file.size || (isFirst && file.size === 0)) {
        if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        isFirst = false;

        const currentChunkSize = Math.max(0, Math.min(chunkSize, file.size - position));
        const chunk = file.slice(position, position + currentChunkSize);

        const formData = new FormData();
        formData.append(fileParamName, chunk);

        let currentUrl = uploadUrl;
        if (offsetLocation === 'query') {
          const separator = currentUrl.indexOf('?') !== -1 ? '&' : '?';
          currentUrl = `${currentUrl}${separator}${encodeURIComponent(offsetParamName)}=${encodeURIComponent(String(position))}`;
        } else {
          formData.append(offsetParamName, String(position));
        }

        // 追加用户注入的额外数据
        if (task.meta?.formData) {
          Object.entries(task.meta.formData).forEach(([key, value]) => {
            if (value instanceof Blob) {
              formData.append(key, value);
            } else {
              formData.append(key, String(value));
            }
          });
        }

        // 追加服务端的上下文 session data (如 document_id)
        Object.entries(sessionData).forEach(([key, value]) => {
          formData.append(key, String(value));
        });

        let responseData: any;

        if (network) {
          const response = await network.request({
            url: currentUrl,
            method: 'POST',
            body: formData,
            headers: config.headers,
            signal: abortController.signal,
          });
          responseData = response.data;
        } else {
          const res = await fetch(currentUrl, {
            method: 'POST',
            body: formData,
            headers: config.headers,
            signal: abortController.signal,
          });
          if (!res.ok) throw new Error(`Upload failed with status: ${res.status}`);

          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            responseData = await res.json();
          } else {
            responseData = await res.text();
          }
        }

        // 每次发完一段，将这块大小计入 uploadedBytes，并在 store 中更新进度
        // 这里的 uploadedBytes 只是前端估算进度，因为某些后端并不返回真实的 uploadedBytes
        const simulatedUploaded = position + currentChunkSize;
        this.updateProgress(taskId, simulatedUploaded, file.size, startTime, store);

        // 为了在页面上能调试显示最后一次的结果
        store.dispatch({
          type: 'UPDATE_TASK',
          payload: {
            id: taskId,
            updates: {
              meta: {
                ...store.getTask(taskId)?.meta,
                lastResponse: responseData
              }
            }
          }
        });

        // 核心钩子解析下一个 position
        if (seqConfig.getOffsetFromResponse) {
          const nextOffset = seqConfig.getOffsetFromResponse(responseData);
          if (nextOffset !== undefined) {
            position = nextOffset;
          } else {
            // 如果解析失败或没返回，强制加上 chunkSize
            position += currentChunkSize;
          }
        } else {
          // 默认走前端自动累加
          position += currentChunkSize;
        }

        // 核心钩子解析 session data (如 document_id)
        if (seqConfig.getSessionDataFromResponse) {
          const newSessionData = seqConfig.getSessionDataFromResponse(responseData);
          if (newSessionData) {
            sessionData = { ...sessionData, ...newSessionData };
          }
        }

        // 约定的特殊的终止条件：如果 position 变成 0 或者是某些特殊标记，可以由外层决定让 nextOffset 返回一个极大值来终止循环
        // 例如：服务端返回 position: 0 表示结束，getOffsetFromResponse 里返回 Number.MAX_SAFE_INTEGER
      }

      // 如果有单独的合并接口
      const mergeUrl = task.meta?.mergeUrl !== undefined ? task.meta.mergeUrl : config.mergeUrl;

      if (mergeUrl) {
        if (network) {
          await network.request({
            url: mergeUrl as string,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...config.headers },
            body: JSON.stringify({ filename: file.name, ...task.meta?.formData, ...sessionData }),
            signal: abortController.signal,
          });
        } else {
          const res = await fetch(mergeUrl as string, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...config.headers },
            body: JSON.stringify({ filename: file.name, ...task.meta?.formData, ...sessionData }),
            signal: abortController.signal,
          });
          if (!res.ok) throw new Error('Merge failed');
        }
      }

      // 更新任务状态为 completed
      store.dispatch({
        type: 'UPDATE_TASK',
        payload: {
          id: taskId,
          updates: {
            status: 'completed',
            progress: 100,
            uploadedBytes: file.size,
            meta: {
              ...store.getTask(taskId)?.meta,
              finalResult: store.getTask(taskId)?.meta?.lastResponse // 把最后的结构存一下
            }
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

  private updateProgress(taskId: string, loaded: number, total: number, startTime: number, store: ITransferContext['store']) {
    // 强制上限不能超过 100
    const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

    const elapsedTime = (Date.now() - startTime) / 1000;
    const speed = elapsedTime > 0 ? Math.round(loaded / elapsedTime) : 0;
    const remainingBytes = Math.max(0, total - loaded);
    const remainingTime = speed > 0 ? Math.round(remainingBytes / speed) * 1000 : 0;

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: {
        id: taskId,
        updates: {
          progress,
          uploadedBytes: Math.min(loaded, total),
          speed,
          remainingTime
        }
      }
    });
  }
}
