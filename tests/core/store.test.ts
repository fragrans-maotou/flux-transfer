import { describe, it, expect, beforeEach } from 'vitest';
import { TransferStore } from '../../src/core/store'; 

describe('TransferStore', () => {
  let store: TransferStore;

  beforeEach(() => {
    store = new TransferStore();
  });

  it('应该以空的 tasks 记录作为初始状态', () => {
    const state = store.getState();
    expect(state.tasks).toEqual({});
  });

  it('应该能够正确添加一个任务', () => {
    const mockTask = {
      id: 'test-id',
      fileName: 'test.zip',
      fileSize: 1000,
      status: 'idle',
      progress: 0,
    } as any; 

    store.dispatch({ type: 'ADD_TASK', payload: mockTask });
    
    expect(store.getState().tasks['test-id']).toBeDefined();
    expect(store.getState().tasks['test-id'].fileName).toBe('test.zip');
  });
});
