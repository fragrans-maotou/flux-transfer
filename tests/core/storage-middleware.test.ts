// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStorageMiddleware } from '../../src/core/storage-middleware';
import { TransferStore } from '../../src/core/store';
import type { IStorageAdapter } from '../../src/core/types';

describe('StorageMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('应该在 store 状态改变时将数据持久化到 adapter', async () => {
    const store = new TransferStore();
    const mockAdapter: IStorageAdapter = {
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    const unsubscribe = createStorageMiddleware(store, mockAdapter, 'test-key');

    store.dispatch({
      type: 'ADD_TASK',
      payload: { id: 'test-id', progress: 50, status: 'paused' } as any
    });

    // 触发 debounce timeout
    vi.runAllTimers();

    expect(mockAdapter.set).toHaveBeenCalledWith('test-key', expect.arrayContaining([
      expect.objectContaining({ id: 'test-id', progress: 50, status: 'paused' })
    ]));

    unsubscribe();
  });
});
