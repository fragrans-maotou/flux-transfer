import type { IStorageAdapter, IStore, ITransferTask } from './types';

export const STORAGE_KEY = 'flux-transfer:tasks';

export type StoredTask = Omit<ITransferTask, 'file' | 'error' | 'result'>;

export interface StorageMiddlewareController {
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export function createStorageMiddleware(
  store: IStore,
  storage: IStorageAdapter,
  storageKey: string = STORAGE_KEY,
  onError?: (error: unknown) => void,
): StorageMiddlewareController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSnapshot: StoredTask[] | undefined;
  // Chaining writes prevents a slow old snapshot from finishing after a newer one.
  let writeQueue = Promise.resolve();

  const enqueuePendingWrite = (): Promise<void> => {
    if (!pendingSnapshot) return writeQueue;
    const snapshot = pendingSnapshot;
    pendingSnapshot = undefined;

    writeQueue = writeQueue
      .then(() => storage.set(storageKey, snapshot))
      .catch((error: unknown) => reportStorageError(error, onError));
    return writeQueue;
  };

  const unsubscribe = store.subscribe((state) => {
    pendingSnapshot = Object.values(state.tasks).map(toStoredTask);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void enqueuePendingWrite();
    }, 250);
  });

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    await enqueuePendingWrite();
  };

  return {
    flush,
    async stop() {
      unsubscribe();
      await flush();
    },
  };
}

function reportStorageError(error: unknown, onError?: (error: unknown) => void): void {
  if (!onError) {
    console.error('[flux-transfer] Failed to persist tasks', error);
    return;
  }

  try {
    onError(error);
  } catch (callbackError) {
    console.error('[flux-transfer] Storage error handler failed', callbackError);
  }
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
    progressSource: task.progressSource,
    transferredBytes: task.transferredBytes,
    totalBytes: task.totalBytes,
    speed: task.speed,
    remainingTime: task.remainingTime,
    data: task.data,
    session: task.session,
    resumeDescriptor: task.resumeDescriptor,
  };
}
