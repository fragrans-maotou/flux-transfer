import { describe, expect, it, vi } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
import { STORAGE_KEY, type StoredTask } from '../../src/core/storage-middleware';
import { computeFileHash } from '../../src/core/utils/hash';
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

  it('rejects a restored file whose content does not match the saved hash', async () => {
    const original = new File([new Uint8Array(2048)], 'a.bin', { lastModified: 123 });
    const expectedHash = await computeFileHash(original, 1024);
    const stored: StoredTask = {
      id: 'saved',
      type: 'upload',
      status: 'paused',
      fileName: original.name,
      fileHash: expectedHash,
      url: '/upload',
      progress: 50,
      transferredBytes: 1024,
      totalBytes: original.size,
      speed: 0,
      remainingTime: 0,
      data: {},
      session: { uploadedChunks: [0] },
      resumeDescriptor: {
        version: 1,
        file: {
          name: original.name,
          size: original.size,
          lastModified: original.lastModified,
          hash: expectedHash,
        },
        chunkSize: 1024,
        uploadUrl: '/upload',
        chunkUrl: '/chunk',
        completeUrl: false,
        protocolId: 'default-v1',
      },
    };
    const storage: IStorageAdapter = {
      get: async () => [stored],
      set: async () => {},
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    };
    const request = vi.fn().mockResolvedValue(ok());
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkUrl: '/chunk',
      chunkSize: 1024,
      storageAdapter: storage,
      networkAdapter: { request },
    });
    await engine.init();

    const wrongFile = new File([new Uint8Array(2048).fill(1)], 'a.bin', { lastModified: 123 });
    engine.resume('saved', { file: wrongFile });
    const failed = await waitFor(engine, 'saved', 'failed');

    expect(failed.error?.message).toContain('does not match');
    expect(request).not.toHaveBeenCalled();
  });

  it('restarts legacy snapshots instead of reusing unsafe chunks', async () => {
    const request = vi.fn().mockResolvedValue(ok());
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      networkAdapter: { request },
    });
    engine.store.dispatch({
      type: 'ADD_TASK',
      payload: {
        id: 'legacy',
        type: 'upload',
        status: 'paused',
        file: null,
        fileName: 'a.bin',
        fileHash: 'unsafe-old-hash',
        url: '/upload',
        progress: 50,
        transferredBytes: 1024,
        totalBytes: 2048,
        speed: 0,
        remainingTime: 0,
        data: {},
        session: { uploadedChunks: [0] },
      },
    });

    engine.resume('legacy', { file: new File([new Uint8Array(2048)], 'a.bin') });
    const completed = await waitFor(engine, 'legacy', 'completed');

    expect(request).toHaveBeenCalledTimes(2);
    expect(completed.resumeDescriptor).toMatchObject({ version: 1, chunkSize: 1024 });
  });

  it('rejects restored uploads with a different chunk layout or protocol', () => {
    const file = new File([new Uint8Array(2048)], 'a.bin', { lastModified: 123 });
    const descriptor = {
      version: 1 as const,
      file: { name: file.name, size: file.size, lastModified: file.lastModified },
      chunkSize: 1024,
      uploadUrl: '/upload',
      chunkUrl: '/chunk',
      completeUrl: false as const,
      protocolId: 'backend-v1',
    };
    const task: ITransferTask = {
      id: 'saved',
      type: 'upload',
      status: 'paused',
      file: null,
      fileName: file.name,
      url: '/upload',
      progress: 0,
      transferredBytes: 0,
      totalBytes: file.size,
      speed: 0,
      remainingTime: 0,
      data: {},
      session: {},
      resumeDescriptor: descriptor,
    };

    const wrongChunkSize = new TransferEngine({ chunkSize: 2048, protocolId: 'backend-v1' });
    wrongChunkSize.store.dispatch({ type: 'ADD_TASK', payload: task });
    expect(() => wrongChunkSize.resume('saved', { file })).toThrow('chunkSize');

    const wrongProtocol = new TransferEngine({ chunkSize: 1024, protocolId: 'backend-v2' });
    wrongProtocol.store.dispatch({ type: 'ADD_TASK', payload: task });
    expect(() => wrongProtocol.resume('saved', { file })).toThrow('protocolId');
  });
});
