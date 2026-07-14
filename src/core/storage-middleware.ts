import type { IStorageAdapter, IStore, ITransferTask } from './types';

export const STORAGE_KEY = 'flux-transfer:tasks';

export type StoredTask = Omit<ITransferTask, 'file' | 'error' | 'result'>;

export function createStorageMiddleware(
  store: IStore,
  storage: IStorageAdapter,
  storageKey: string = STORAGE_KEY,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const unsubscribe = store.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const snapshot = Object.values(state.tasks).map(toStoredTask);
      void storage.set(storageKey, snapshot).catch((error: unknown) => {
        console.error('[flux-transfer] Failed to persist tasks', error);
      });
    }, 250);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

function toStoredTask(task: ITransferTask): StoredTask {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    fileName: task.fileName,
    fileHash: task.fileHash,
    url: task.url,
    progress: task.progress,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes,
    speed: task.speed,
    remainingTime: task.remainingTime,
    data: task.data,
    session: task.session,
  };
}
