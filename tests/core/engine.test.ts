import { describe, expect, it } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
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
        if (calls < 3) throw new Error('temporary');
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
});
