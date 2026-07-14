import { describe, expect, it } from 'vitest';
import { TransferStore } from '../../src/core/store';
import type { ITransferTask } from '../../src/core/types';

function task(id: string, totalBytes: number, progress: number): ITransferTask {
  return {
    id,
    type: 'upload',
    status: 'transferring',
    file: null,
    fileName: id,
    url: '/upload',
    progress,
    transferredBytes: (totalBytes * progress) / 100,
    totalBytes,
    speed: 0,
    remainingTime: 0,
    data: {},
    session: {},
  };
}

describe('TransferStore', () => {
  it('adds and immutably updates a task', () => {
    const store = new TransferStore();
    store.dispatch({ type: 'ADD_TASK', payload: task('a', 100, 0) });
    const previous = store.getTask('a');

    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: 'a', updates: { progress: 50 } },
    });

    expect(store.getTask('a')?.progress).toBe(50);
    expect(store.getTask('a')).not.toBe(previous);
  });

  it('weights global progress by bytes', () => {
    const store = new TransferStore();
    store.dispatch({ type: 'ADD_TASK', payload: task('large', 900, 50) });
    store.dispatch({ type: 'ADD_TASK', payload: task('small', 100, 100) });

    expect(store.getState().globalProgress).toBe(55);
  });
});
