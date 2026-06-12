import { ITransferStrategy, ITransferContext, ISDKConfig, ITransferTask } from '../types';
import { HashCalculator } from '../worker/hash-calculator';

/**
 * 大文件分片上传策略 (Chunked Upload)
 * 适用于体积较大、需要断点续传的文件。
 */
export class ChunkedUploadStrategy implements ITransferStrategy {
  // 默认分片大小: 5MB
  private static readonly DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

  public canHandle(task: ITransferTask, config: ISDKConfig): boolean {
    if (task.type !== 'upload') return false;
    if (!task.file) return false;
    
    // 超过设定大小的文件走分片逻辑
    const limit = config.chunkSize || ChunkedUploadStrategy.DEFAULT_CHUNK_SIZE;
    return task.file.size > limit;
  }

  public async execute(context: ITransferContext): Promise<void> {
    const { task, store, network, config, abortController } = context;
    const { id: taskId, file } = task;

    if (!file) {
      throw new Error('No file provided for upload');
    }

    // 1. 状态变更为 processing (计算 MD5 阶段)
    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'processing' } }
    });

    try {
      // 2. 计算文件 Hash
      // 如果断点续传恢复时已经有 hash 了，就不用重算了
      let fileHash = task.meta?.fileHash;
      if (!fileHash) {
        const hashResult = await HashCalculator.calculateHash(file, {
          onProgress: (p) => {
            // 这里可以把 MD5 计算进度放到 progress 里，或者独立一个 md5Progress
            store.dispatch({
              type: 'UPDATE_TASK',
              payload: { id: taskId, updates: { meta: { ...store.getTask(taskId)?.meta, md5Progress: p } } }
            });
          }
        });
        fileHash = hashResult.hash;
        
        // 存入 meta
        store.dispatch({
          type: 'UPDATE_TASK',
          payload: { id: taskId, updates: { meta: { ...store.getTask(taskId)?.meta, fileHash } } }
        });
      }

      // 如果任务被取消了，直接退出
      if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      // 3. 开始传输
      store.dispatch({
        type: 'UPDATE_TASK',
        payload: { id: taskId, updates: { status: 'transferring' } }
      });

      const chunkSize = config.chunkSize || ChunkedUploadStrategy.DEFAULT_CHUNK_SIZE;
      const totalChunks = Math.ceil(file.size / chunkSize);
      
      // 已上传的分片记录 (从 meta 恢复，实现断点续传)
      const uploadedChunks: number[] = task.meta?.uploadedChunks || [];
      const chunkProgressList: number[] = new Array(totalChunks).fill(0);
      
      // 恢复进度
      uploadedChunks.forEach(index => {
        chunkProgressList[index] = chunkSize; // 粗略估算，最后一块可能不到 chunkSize，但不影响总体 loaded 计算
      });

      const uploadUrl = task.url || config.uploadUrl || (config.baseURL ? `${config.baseURL}/upload/chunk` : '/upload/chunk');
      const mergeUrl = task.meta?.mergeUrl !== undefined ? task.meta.mergeUrl : (config.mergeUrl !== undefined ? config.mergeUrl : (config.baseURL ? `${config.baseURL}/upload/merge` : '/upload/merge'));

      const startTime = Date.now();

      // 定义分片上传任务流
      const uploadTasks: (() => Promise<void>)[] = [];

      for (let i = 0; i < totalChunks; i++) {
        if (uploadedChunks.includes(i)) continue; // 跳过已上传的分片

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkBlob = file.slice(start, end);

        uploadTasks.push(async () => {
          if (abortController.signal.aborted) return;

          const formData = new FormData();
          formData.append('file', chunkBlob);
          formData.append('chunkIndex', String(i));
          formData.append('totalChunks', String(totalChunks));
          formData.append('fileHash', fileHash);
          formData.append('filename', file.name);

          // 附加额外的业务表单参数
          if (task.meta?.formData) {
            Object.entries(task.meta.formData).forEach(([key, value]) => {
              if (value instanceof Blob) {
                formData.append(key, value);
              } else {
                formData.append(key, String(value));
              }
            });
          }

          let response;
          if (network) {
            response = await network.request({
              url: uploadUrl,
              method: 'POST',
              body: formData,
              headers: config.headers,
              signal: abortController.signal,
              onUploadProgress: (loaded) => {
                chunkProgressList[i] = loaded;
                this.updateTotalProgress(taskId, chunkProgressList, file.size, startTime, store);
              }
            });
          } else {
            response = await fetch(uploadUrl, {
              method: 'POST',
              body: formData,
              headers: config.headers,
              signal: abortController.signal,
            });
            if (!response.ok) throw new Error(`Chunk ${i} upload failed`);
            chunkProgressList[i] = chunkBlob.size;
            this.updateTotalProgress(taskId, chunkProgressList, file.size, startTime, store);
          }

          // 记录分片成功
          uploadedChunks.push(i);
          store.dispatch({
            type: 'UPDATE_TASK',
            payload: {
              id: taskId,
              updates: { meta: { ...store.getTask(taskId)?.meta, uploadedChunks: [...uploadedChunks] } }
            }
          });
        });
      }

      // 4. 并发控制执行分片上传
      await this.runWithConcurrency(uploadTasks, config.maxConcurrent || 3);

      if (abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      // 5. 所有分片上传完毕，发送合并请求 (如果有 mergeUrl 的话)
      if (mergeUrl) {
        if (network) {
          await network.request({
            url: mergeUrl as string,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...config.headers },
            body: JSON.stringify({ fileHash, filename: file.name, totalChunks, ...task.meta?.formData }),
            signal: abortController.signal,
          });
        } else {
          const res = await fetch(mergeUrl as string, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...config.headers },
            body: JSON.stringify({ fileHash, filename: file.name, totalChunks, ...task.meta?.formData }),
            signal: abortController.signal,
          });
          if (!res.ok) throw new Error('Merge failed');
        }
      }

      // 6. 标记为完成
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
      if (error.name === 'AbortError') {
        store.dispatch({
          type: 'UPDATE_TASK',
          payload: { id: taskId, updates: { status: 'paused' } } // 分片上传被取消通常认为是暂停，以便后续恢复
        });
        return;
      }
      throw error;
    }
  }

  /**
   * 聚合更新总进度
   */
  private updateTotalProgress(taskId: string, chunkProgressList: number[], totalSize: number, startTime: number, store: ITransferContext['store']) {
    const loaded = chunkProgressList.reduce((acc, val) => acc + val, 0);
    const progress = totalSize > 0 ? Math.round((loaded / totalSize) * 100) : 0;
    
    const elapsedTime = (Date.now() - startTime) / 1000;
    const speed = elapsedTime > 0 ? Math.round(loaded / elapsedTime) : 0;
    const remainingBytes = totalSize - loaded;
    const remainingTime = speed > 0 ? Math.round(remainingBytes / speed) * 1000 : 0;

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: {
        id: taskId,
        updates: {
          progress: Math.min(progress, 100),
          uploadedBytes: Math.min(loaded, totalSize),
          speed,
          remainingTime
        }
      }
    });
  }

  /**
   * 简易异步并发池
   */
  private async runWithConcurrency(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
    const executing: Promise<void>[] = [];
    for (const task of tasks) {
      const p = task();
      executing.push(p);
      const clean = p.then(() => {
        executing.splice(executing.indexOf(clean), 1);
      });
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
  }
}
