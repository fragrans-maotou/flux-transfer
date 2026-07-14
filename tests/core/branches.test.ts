import { describe, expect, it, vi } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
import { createStorageMiddleware } from '../../src/core/storage-middleware';
import { TransferStore } from '../../src/core/store';
import { FetchAdapter } from '../../src/network/fetch-adapter';
import type {
  INetworkAdapter,
  INetworkResponse,
  IStorageAdapter,
  ITransferTask,
} from '../../src/core/types';

const ok = (data: unknown = null): INetworkResponse => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
});

async function waitFor(
  engine: TransferEngine,
  taskId: string,
  status: ITransferTask['status'],
): Promise<ITransferTask> {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(new Error('Timed out'));
    }, 2_000);
    stop = engine.subscribe(taskId, (task) => {
      if (task?.status === status) {
        clearTimeout(timer);
        stop();
        resolve(task);
      }
    });
  });
}

describe('remaining core branches', () => {
  it('parses text, array buffers, empty bodies and non-JSON safely', async () => {
    const adapter = new FetchAdapter();

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('text'))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
      .mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response('{bad', {
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1]))));

    expect((await adapter.request({ url: '/text', responseType: 'text' })).data).toBe('text');
    expect((await adapter.request<ArrayBuffer>({
      url: '/buffer',
      responseType: 'arraybuffer',
      timeout: 100,
    })).data.byteLength).toBe(2);
    expect((await adapter.request({ url: '/empty' })).data).toBeNull();
    expect((await adapter.request({ url: '/bad-json' })).data).toBe('{bad');
    expect((await adapter.request<Blob>({ url: '/blob', responseType: 'blob' })).data.size).toBe(1);

    vi.unstubAllGlobals();
  });

  it('marks exhausted requests as failed', async () => {
    const network: INetworkAdapter = {
      async request() {
        throw new Error('permanent');
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      retries: 0,
      networkAdapter: network,
    });

    const id = engine.upload(new File(['abc'], 'a.txt'));
    const task = await waitFor(engine, id, 'failed');

    expect(task.error?.message).toBe('permanent');
    engine.remove(id);
    expect(engine.store.getTask(id)).toBeUndefined();
  });

  it('hashes chunks once and sends the completion request', async () => {
    const urls: string[] = [];
    const network: INetworkAdapter = {
      async request(config) {
        urls.push(config.url);
        return ok({ url: config.url });
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkUrl: '/chunk',
      completeUrl: '/complete',
      chunkSize: 1024,
      concurrency: 1,
      networkAdapter: network,
    });

    const id = engine.upload(new File([new Uint8Array(2048)], 'a.bin'));
    const task = await waitFor(engine, id, 'completed');

    expect(task.fileHash).toHaveLength(32);
    expect(urls).toEqual(['/chunk', '/chunk', '/complete']);
    expect(task.result).toEqual({ url: '/complete' });
  });

  it('handles zero-byte aggregate progress and missing updates', () => {
    const store = new TransferStore();
    const empty: ITransferTask = {
      id: 'empty',
      type: 'upload',
      status: 'idle',
      file: null,
      fileName: 'empty',
      url: '/upload',
      progress: 50,
      transferredBytes: 0,
      totalBytes: 0,
      speed: 0,
      remainingTime: 0,
      data: {},
      session: {},
    };

    store.dispatch({ type: 'ADD_TASK', payload: empty });
    store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: 'missing', updates: { progress: 1 } },
    });
    expect(store.getState().globalProgress).toBe(50);
    store.dispatch({ type: 'REMOVE_TASK', payload: { id: 'empty' } });
    expect(store.getState().globalProgress).toBe(0);
  });

  it('reports persistence failures without throwing into Store', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage: IStorageAdapter = {
      get: async () => null,
      set: async () => {
        throw new Error('quota');
      },
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    };
    const store = new TransferStore();
    const stop = createStorageMiddleware(store, storage);
    const task: ITransferTask = {
      id: 'a',
      type: 'upload',
      status: 'idle',
      file: null,
      fileName: 'a',
      url: '/upload',
      progress: 0,
      transferredBytes: 0,
      totalBytes: 1,
      speed: 0,
      remainingTime: 0,
      data: {},
      session: {},
    };

    store.dispatch({ type: 'ADD_TASK', payload: task });
    await vi.advanceTimersByTimeAsync(250);
    expect(error).toHaveBeenCalled();
    stop();
    error.mockRestore();
    vi.useRealTimers();
  });
});
