// @vitest-environment node

import { File } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
import { startDemoServer } from '../../examples/demo-server.mjs';
import type { ISDKConfig, ITransferTask } from '../../src/core/types';

describe('real HTTP backend integration', () => {
  let engine: TransferEngine | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await engine?.destroy();
    await closeServer?.();
    engine = undefined;
    closeServer = undefined;
  });

  it('uploads a small file directly over multipart HTTP', async () => {
    const server = await startDemoServer();
    closeServer = server.close;
    engine = createEngine(server.baseUrl);

    const taskId = engine.upload(new File(['hello'], 'direct.txt'));
    const task = await waitForTask(engine, taskId, 'completed');

    expect(task.result).toEqual({ filename: 'direct.txt', size: 5, direct: true });
    expect(server.requests).toEqual([{ method: 'POST', path: '/upload' }]);
  });

  it('uploads chunks, reconciles server state and completes over fetch', async () => {
    const server = await startDemoServer();
    closeServer = server.close;
    engine = createEngine(server.baseUrl, { concurrency: 2 });

    const file = new File([new Uint8Array(3 * 1024)], 'integration.bin');
    const taskId = engine.upload(file);
    const task = await waitForTask(engine, taskId, 'completed');

    expect(task.result).toEqual({
      filename: 'integration.bin',
      totalChunks: 3,
      receivedChunks: 3,
      size: 3 * 1024,
      complete: true,
    });
    expect(server.getUpload('integration.bin')).toEqual({
      totalChunks: 3,
      uploadedChunks: [0, 1, 2],
      size: 3 * 1024,
    });
    expect(requestCount(server, '/upload/status')).toBe(1);
    expect(requestCount(server, '/upload/chunk')).toBe(3);
    expect(server.requests.at(-1)).toEqual({ method: 'POST', path: '/upload/complete' });
  });

  it('pauses an active request and resumes from backend-confirmed chunks', async () => {
    const server = await startDemoServer({ chunkDelayMs: 100 });
    closeServer = server.close;
    engine = createEngine(server.baseUrl, { concurrency: 1 });

    const file = new File([new Uint8Array(3 * 1024)], 'pause-resume.bin');
    const taskId = engine.upload(file);
    await waitUntil(() => requestCount(server, '/upload/chunk') >= 2);

    engine.pause(taskId);
    await waitForTask(engine, taskId, 'paused');
    await delay(150);

    expect(server.getUpload('pause-resume.bin')?.uploadedChunks).toEqual([0]);
    expect(requestCount(server, '/upload/complete')).toBe(0);

    engine.resume(taskId);
    const completed = await waitForTask(engine, taskId, 'completed');

    expect(completed.session.uploadedChunks).toEqual([0, 1, 2]);
    expect(server.getUpload('pause-resume.bin')?.uploadedChunks).toEqual([0, 1, 2]);
    expect(requestCount(server, '/upload/status')).toBe(2);
  });

  it('cancels an active request without committing or completing it', async () => {
    const server = await startDemoServer({ chunkDelayMs: 150 });
    closeServer = server.close;
    engine = createEngine(server.baseUrl, { concurrency: 1 });

    const file = new File([new Uint8Array(2 * 1024)], 'cancel.bin');
    const taskId = engine.upload(file);
    await waitUntil(() => requestCount(server, '/upload/chunk') === 1);

    engine.cancel(taskId);
    const cancelled = await waitForTask(engine, taskId, 'cancelled');
    await delay(200);

    expect(cancelled.status).toBe('cancelled');
    expect(server.getUpload('cancel.bin')).toBeUndefined();
    expect(requestCount(server, '/upload/complete')).toBe(0);
  });

  it('retries a transient backend failure and commits each chunk once', async () => {
    const server = await startDemoServer({ failChunkAttempts: 1 });
    closeServer = server.close;
    engine = createEngine(server.baseUrl, { concurrency: 1, retries: 1, retryDelay: 0 });

    const file = new File([new Uint8Array(3 * 1024)], 'retry.bin');
    const taskId = engine.upload(file);
    const completed = await waitForTask(engine, taskId, 'completed');

    expect(completed.result).toMatchObject({ complete: true, receivedChunks: 3 });
    expect(server.getUpload('retry.bin')?.uploadedChunks).toEqual([0, 1, 2]);
    expect(requestCount(server, '/upload/chunk')).toBe(4);
  });
});

function createEngine(baseUrl: string, overrides: Partial<ISDKConfig> = {}): TransferEngine {
  return new TransferEngine({
    uploadUrl: baseUrl + '/upload',
    chunkUrl: baseUrl + '/upload/chunk',
    completeUrl: baseUrl + '/upload/complete',
    chunkSize: 1024,
    concurrency: 1,
    hash: false,
    protocolId: 'integration-backend-v1',
    protocol: {
      async reconcileUpload(context) {
        const url = new URL(baseUrl + '/upload/status');
        url.searchParams.set('filename', context.task.fileName);
        const response = await fetch(url);
        return response.json() as Promise<{ uploadedChunks: number[] }>;
      },
    },
    ...overrides,
  });
}

function requestCount(server: { requests: Array<{ path: string }> }, path: string): number {
  return server.requests.filter((request) => request.path === path).length;
}

function waitForTask(
  transfer: TransferEngine,
  taskId: string,
  status: ITransferTask['status'],
): Promise<ITransferTask> {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(new Error('Timed out waiting for ' + status));
    }, 8_000);
    stop = transfer.subscribe(taskId, (task) => {
      if (task?.status === status) {
        clearTimeout(timer);
        stop();
        resolve(task);
      } else if (task?.status === 'failed') {
        clearTimeout(timer);
        stop();
        reject(task.error);
      }
    });
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for backend activity');
    await delay(10);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
