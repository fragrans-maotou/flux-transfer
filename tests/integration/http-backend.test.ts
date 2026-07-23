// @vitest-environment node

import { File } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { TransferEngine } from '../../src/core/engine';
import { startDemoServer } from '../../examples/demo-server.mjs';
import type { ITransferTask } from '../../src/core/types';

describe('real HTTP backend integration', () => {
  let engine: TransferEngine | undefined;
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await engine?.destroy();
    await closeServer?.();
  });

  it('uploads chunks, reconciles server state and completes over fetch', async () => {
    const server = await startDemoServer();
    closeServer = server.close;
    engine = new TransferEngine({
      uploadUrl: server.baseUrl + '/upload',
      chunkUrl: server.baseUrl + '/upload/chunk',
      completeUrl: server.baseUrl + '/upload/complete',
      chunkSize: 1024,
      concurrency: 2,
      hash: false,
      protocolId: 'integration-backend-v1',
      protocol: {
        async reconcileUpload(context) {
          const url = new URL(server.baseUrl + '/upload/status');
          url.searchParams.set('filename', context.task.fileName);
          const response = await fetch(url);
          return response.json() as Promise<{ uploadedChunks: number[] }>;
        },
      },
    });

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
    expect(server.requests.filter((request) => request.path === '/upload/status')).toHaveLength(1);
    expect(server.requests.filter((request) => request.path === '/upload/chunk')).toHaveLength(3);
    expect(server.requests.at(-1)).toEqual({ method: 'POST', path: '/upload/complete' });
  });
});

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
    }, 5_000);
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
