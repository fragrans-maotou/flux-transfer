import { describe, expect, it, vi } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
import { HTTPError, NetworkError, NetworkTimeoutError } from '../../src/network/errors';
import type {
  INetworkAdapter,
  INetworkRequestConfig,
  INetworkResponse,
  ITransferTask,
} from '../../src/core/types';

const response = (data: unknown = { ok: true }): INetworkResponse => ({
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
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for ' + status));
    }, 2_000);
    const unsubscribe = engine.subscribe(taskId, (task) => {
      if (task?.status === status) {
        clearTimeout(timer);
        unsubscribe();
        resolve(task);
      }
    });
  });
}

describe('TransferEngine', () => {
  it('uploads a small file directly', async () => {
    const requests: INetworkRequestConfig[] = [];
    const network: INetworkAdapter = {
      async request(config) {
        requests.push(config);
        return response();
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      networkAdapter: network,
    });

    const id = engine.upload(new File(['abc'], 'a.txt'), { data: { folder: 1 } });
    const task = await waitFor(engine, id, 'completed');

    expect(requests).toHaveLength(1);
    expect(requests[0].body).toBeInstanceOf(FormData);
    expect((requests[0].body as FormData).get('folder')).toBe('1');
    expect(task.transferredBytes).toBe(3);
    expect(task.progressSource).toBe('confirmed');
  });

  it('enforces chunk concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const network: INetworkAdapter = {
      async request() {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return response();
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      concurrency: 2,
      hash: false,
      networkAdapter: network,
    });

    const id = engine.upload(new File([new Uint8Array(4096)], 'large.bin'));
    await waitFor(engine, id, 'completed');

    expect(calls).toBe(4);
    expect(maxActive).toBe(2);
  });

  it('retries transient request failures', async () => {
    let calls = 0;
    const network: INetworkAdapter = {
      async request() {
        calls += 1;
        if (calls < 3) throw new NetworkError('temporary');
        return response();
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      retries: 2,
      retryDelay: 0,
      networkAdapter: network,
    });

    const id = engine.upload(new File(['abc'], 'a.txt'));
    await waitFor(engine, id, 'completed');

    expect(calls).toBe(3);
  });

  it('supports custom protocol requests and response sessions', async () => {
    const network: INetworkAdapter = {
      async request(config) {
        expect(config.url).toBe('/custom');
        return response({ uploadId: 'u1' });
      },
    };
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      networkAdapter: network,
      protocol: {
        createDirectRequest(context) {
          return { url: '/custom', method: 'PUT', body: context.file };
        },
        parseResponse(_phase, result) {
          return { uploadId: (result.data as { uploadId: string }).uploadId };
        },
      },
    });

    const id = engine.upload(new File(['abc'], 'a.txt'));
    const task = await waitFor(engine, id, 'completed');

    expect(task.session).toEqual({ uploadId: 'u1' });
  });

  it('retries timeouts but not permanent client errors', async () => {
    let timeoutCalls = 0;
    const timeoutEngine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      retries: 1,
      retryDelay: 0,
      networkAdapter: {
        async request() {
          timeoutCalls += 1;
          if (timeoutCalls === 1) throw new NetworkTimeoutError(10);
          return response();
        },
      },
    });

    const timeoutId = timeoutEngine.upload(new File(['abc'], 'a.txt'));
    await waitFor(timeoutEngine, timeoutId, 'completed');
    expect(timeoutCalls).toBe(2);

    let clientErrorCalls = 0;
    const clientErrorEngine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      retries: 2,
      retryDelay: 0,
      networkAdapter: {
        async request() {
          clientErrorCalls += 1;
          throw new HTTPError({
            data: { message: 'invalid' },
            status: 400,
            statusText: 'Bad Request',
            headers: {},
          });
        },
      },
    });

    const clientErrorId = clientErrorEngine.upload(new File(['abc'], 'a.txt'));
    await waitFor(clientErrorEngine, clientErrorId, 'failed');
    expect(clientErrorCalls).toBe(1);
  });

  it('uses server reconciliation as the source of uploaded chunks', async () => {
    const requests: INetworkRequestConfig[] = [];
    const reconcileUpload = vi.fn().mockResolvedValue({
      uploadedChunks: [0, 1],
      session: { uploadId: 'server-session' },
    });
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkUrl: '/chunk',
      chunkSize: 1024,
      hash: false,
      networkAdapter: {
        async request(config) {
          requests.push(config);
          return response();
        },
      },
      protocol: { reconcileUpload },
    });

    const id = engine.upload(new File([new Uint8Array(3072)], 'a.bin'));
    const task = await waitFor(engine, id, 'completed');

    expect(reconcileUpload).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    expect((requests[0].body as FormData).get('chunkIndex')).toBe('2');
    expect(task.session).toMatchObject({
      uploadId: 'server-session',
      uploadedChunks: [0, 1, 2],
    });
  });

  it('honors Retry-After and allows an explicit retry policy', async () => {
    let rateLimitCalls = 0;
    const rateLimitEngine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      retries: 1,
      retryDelay: 1000,
      networkAdapter: {
        async request() {
          rateLimitCalls += 1;
          if (rateLimitCalls === 1) {
            throw new HTTPError({
              data: null,
              status: 429,
              statusText: 'Too Many Requests',
              headers: { 'retry-after': '0' },
            });
          }
          return response();
        },
      },
    });
    const rateLimitId = rateLimitEngine.upload(new File(['abc'], 'a.txt'));
    await waitFor(rateLimitEngine, rateLimitId, 'completed');
    expect(rateLimitCalls).toBe(2);

    const shouldRetry = vi.fn().mockReturnValue(true);
    let customCalls = 0;
    const customEngine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      retries: 1,
      retryDelay: 0,
      shouldRetry,
      networkAdapter: {
        async request() {
          customCalls += 1;
          if (customCalls === 1) throw new Error('adapter-specific transient error');
          return response();
        },
      },
    });
    const customId = customEngine.upload(new File(['abc'], 'a.txt'));
    await waitFor(customEngine, customId, 'completed');

    expect(shouldRetry).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ attempt: 0, phase: 'direct' }),
    );
    expect(customCalls).toBe(2);
  });

  it('uses a task upload URL as the default chunk URL', async () => {
    const urls: string[] = [];
    const engine = new TransferEngine({
      chunkSize: 1024,
      hash: false,
      networkAdapter: {
        async request(config) {
          urls.push(config.url);
          return response();
        },
      },
    });

    const id = engine.upload(new File([new Uint8Array(2048)], 'a.bin'), { url: '/task-upload' });
    await waitFor(engine, id, 'completed');

    expect(urls).toEqual(['/task-upload', '/task-upload']);
  });

  it('limits concurrency across multiple transfer tasks', async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;
    const engine = new TransferEngine({
      uploadUrl: '/upload',
      chunkSize: 1024,
      hash: false,
      maxActiveTasks: 2,
      networkAdapter: {
        async request() {
          activeTasks += 1;
          maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeTasks -= 1;
          return response();
        },
      },
    });

    const ids = Array.from({ length: 4 }, (_, index) =>
      engine.upload(new File(['abc'], index + '.txt')),
    );
    await Promise.all(ids.map((id) => waitFor(engine, id, 'completed')));

    expect(maxActiveTasks).toBe(2);
  });
});
