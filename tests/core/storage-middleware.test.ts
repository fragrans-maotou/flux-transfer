import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageMiddleware } from '../../src/core/storage-middleware';
import { TransferStore } from '../../src/core/store';
import type { IStorageAdapter, ITransferTask } from '../../src/core/types';

describe('storage middleware', () => {
  beforeEach(() => vi.useFakeTimers());

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
    const stop = createStorageMiddleware(store, storage, 'tasks');

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
    } satisfies ITransferTask;

    store.dispatch({ type: 'ADD_TASK', payload: upload });
    await vi.advanceTimersByTimeAsync(250);

    const snapshot = set.mock.calls[0][1][0];
    expect(snapshot).toMatchObject({
      id: 'a',
      fileHash: 'hash',
      url: '/upload',
      session: { uploadedChunks: [0] },
    });
    expect(snapshot).not.toHaveProperty('file');
    stop();
  });
});
