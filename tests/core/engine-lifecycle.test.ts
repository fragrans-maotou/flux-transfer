import { describe, expect, it, vi } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
import { STORAGE_KEY, type StoredTask } from '../../src/core/storage-middleware';
import type {
  INetworkAdapter,
  INetworkRequestConfig,
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
      reject(new Error('Timed out waiting for ' + status));
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

function abortableResponse(config: INetworkRequestConfig, delay = 20): Promise<INetworkResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(ok()), delay);
    config.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

describe('TransferEngine lifecycle', () => {
  it('pauses and immediately resumes a chunked upload', async () => {
    let calls = 0;
    const network: INetworkAdapter = {
      async request(config) {
        calls += 1;
        return abortableResponse(config, 5);
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      concurrency: 1,
      hash: false,
      networkAdapter: network,
    });
    const id = engine.upload(new File([new Uint8Array(2048)], 'a.bin'));

    let stop = () => {};
    stop = engine.subscribe(id, (task) => {
      const chunks = task?.session.uploadedChunks;
      if (Array.isArray(chunks) && chunks.length === 1 && task?.status === 'transferring') {
        stop();
        engine.pause(id);
        engine.resume(id);
      }
    });

    const task = await waitFor(engine, id, 'completed');
    expect(task.session.uploadedChunks).toEqual([0, 1]);
    expect(calls).toBe(2);
  });

  it('cancels an active request without turning it into failure', async () => {
    const network: INetworkAdapter = { request: (config) => abortableResponse(config, 100) };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      networkAdapter: network,
    });
    const id = engine.upload(new File(['abc'], 'a.txt'));
    await waitFor(engine, id, 'transferring');

    engine.cancel(id);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.store.getTask(id)?.status).toBe('cancelled');
  });

  it('restores persisted tasks as paused', async () => {
    const stored: StoredTask = {
      id: 'saved',
      type: 'upload',
      status: 'transferring',
      fileName: 'a.bin',
      fileHash: 'hash',
      url: '/upload',
      progress: 50,
      transferredBytes: 1024,
      totalBytes: 2048,
      speed: 100,
      remainingTime: 10,
      data: {},
      session: { uploadedChunks: [0] },
    };
    const storage: IStorageAdapter = {
      get: vi.fn().mockResolvedValue([stored]),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
    };
    const engine = new TransferEngine({ storageAdapter: storage });
    await engine.init();

    expect(storage.get).toHaveBeenCalledWith(STORAGE_KEY);
    expect(engine.store.getTask('saved')).toMatchObject({
      status: 'paused',
      file: null,
      fileHash: 'hash',
    });
    engine.destroy();
  });

  it('downloads a Blob through the same network boundary', async () => {
    const blob = new Blob(['abc']);
    const network: INetworkAdapter = {
      async request(config) {
        config.onDownloadProgress?.(3, 3);
        return ok(blob);
      },
    };
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const engine = new TransferEngine({ networkAdapter: network });
    const id = engine.download('/file', { filename: 'a.txt' });
    const task = await waitFor(engine, id, 'completed');

    expect(task.result).toBe(blob);
    expect(task.transferredBytes).toBe(3);
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('rejects files over the configured limit', () => {
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      maxFileSize: 2,
    });

    expect(() => engine.upload(new File(['abc'], 'a.txt'))).toThrow('maxFileSize');
  });
});
