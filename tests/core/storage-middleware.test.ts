import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageMiddleware } from '../../src/core/storage-middleware';
import { TransferStore } from '../../src/core/store';
import type { IStorageAdapter, ITransferTask } from '../../src/core/types';

function task(progress: number): ITransferTask {
  return {
    id: 'task',
    type: 'upload',
    status: 'transferring',
    file: null,
    fileName: 'a.bin',
    url: '/upload',
    progress,
    transferredBytes: progress,
    totalBytes: 100,
    speed: 0,
    remainingTime: 0,
    data: {},
    session: {},
  };
}

describe('storage middleware', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('persists the fields required for resume and omits File', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const storage: IStorageAdapter = {
      get: vi.fn().mockResolvedValue(null),
      set,
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
    };
    const store = new TransferStore();
    const persistence = createStorageMiddleware(store, storage, 'tasks');

    const upload = {
      id: 'a',
      type: 'upload',
      status: 'paused',
      file: new File(['abc'], 'a.txt'),
      fileName: 'a.txt',
      fileHash: 'hash',
      url: '/upload',
      progress: 50,
      transferredBytes: 3,
      totalBytes: 6,
      speed: 0,
      remainingTime: 0,
      data: { folder: 1 },
      session: { uploadedChunks: [0] },
      resumeDescriptor: {
        version: 1,
        file: { name: 'a.txt', size: 6, lastModified: 1, hash: 'hash' },
        chunkSize: 1024,
        uploadUrl: '/upload',
        chunkUrl: '/chunk',
        completeUrl: false,
        protocolId: 'default-v1',
      },
    } satisfies ITransferTask;

    store.dispatch({ type: 'ADD_TASK', payload: upload });
    await vi.advanceTimersByTimeAsync(250);

    const snapshot = set.mock.calls[0][1][0];
    expect(snapshot).toMatchObject({
      id: 'a',
      fileHash: 'hash',
      url: '/upload',
      session: { uploadedChunks: [0] },
      resumeDescriptor: { chunkSize: 1024, protocolId: 'default-v1' },
    });
    expect(snapshot).not.toHaveProperty('file');
    await persistence.stop();
  });

  it('serializes async writes so an older snapshot cannot overwrite a newer one', async () => {
    let finishFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
    const set = vi.fn().mockReturnValueOnce(firstWrite).mockResolvedValue(undefined);
    const storage: IStorageAdapter = {
      get: async () => null,
      set,
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    };
    const store = new TransferStore();
    const persistence = createStorageMiddleware(store, storage);

    store.dispatch({ type: 'ADD_TASK', payload: task(10) });
    await vi.advanceTimersByTimeAsync(250);
    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: 'task', updates: { progress: 20 } },
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(set).toHaveBeenCalledTimes(1);
    finishFirstWrite();
    await persistence.flush();

    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls[0][1][0].progress).toBe(10);
    expect(set.mock.calls[1][1][0].progress).toBe(20);
    await persistence.stop();
  });

  it('flushes the latest pending snapshot when stopped', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const storage: IStorageAdapter = {
      get: async () => null,
      set,
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    };
    const store = new TransferStore();
    const persistence = createStorageMiddleware(store, storage);

    store.dispatch({ type: 'ADD_TASK', payload: task(25) });
    await persistence.stop();

    expect(set).toHaveBeenCalledOnce();
    expect(set.mock.calls[0][1][0].progress).toBe(25);
  });

  it('reports storage failures and keeps the write queue usable', async () => {
    const failure = new Error('quota exceeded');
    const onError = vi.fn();
    const set = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const storage: IStorageAdapter = {
      get: async () => null,
      set,
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    };
    const store = new TransferStore();
    const persistence = createStorageMiddleware(store, storage, 'tasks', onError);

    store.dispatch({ type: 'ADD_TASK', payload: task(10) });
    await vi.advanceTimersByTimeAsync(250);
    expect(onError).toHaveBeenCalledWith(failure);

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: 'task', updates: { progress: 20 } },
    });
    await vi.advanceTimersByTimeAsync(250);
    await persistence.stop();

    expect(set).toHaveBeenCalledTimes(2);
  });
});
