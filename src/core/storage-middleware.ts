import type { IStore, IStorageAdapter } from './types';

/**
 * 存储中间件 (Storage Middleware)
 * 用于将 Store 中的任务状态自动异步持久化，实现与断点续传业务逻辑的解耦。
 *
 * @param store 核心 Store 实例
 * @param storageAdapter 存储适配器 (如 IndexedDB / LocalStorage)
 * @param storageKey 存储用的键名，默认 'flux-transfer-tasks'
 */
export function createStorageMiddleware(
  store: IStore,
  storageAdapter: IStorageAdapter,
  storageKey: string = 'flux-transfer-tasks'
): () => void {
  // 简单的防抖控制，防止状态频繁更新导致磁盘写入过载
  let timeoutId: any = null;

  const unsubscribe = store.subscribe((state) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      // 提取需要持久化的部分数据（可能不需要保存原始 File 对象或报错堆栈）
      const snapshot = Object.values(state.tasks).map(task => ({
        id: task.id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        uploadedBytes: task.uploadedBytes,
        totalBytes: task.totalBytes,
        meta: task.meta,
        // 不要保存 file 对象本身，可以只保存文件名和大小等元数据
      }));

      storageAdapter.set(storageKey, snapshot).catch(err => {
        console.error('Storage Middleware persistence failed:', err);
      });
    }, 500); // 500ms 防抖
  });

  return unsubscribe;
}
