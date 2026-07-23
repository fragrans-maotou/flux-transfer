import { File } from 'node:buffer';
import { TransferEngine } from '../dist/index.js';
import { startDemoServer } from './demo-server.mjs';

const server = await startDemoServer();
const engine = new TransferEngine({
  uploadUrl: server.baseUrl + '/upload',
  chunkUrl: server.baseUrl + '/upload/chunk',
  completeUrl: server.baseUrl + '/upload/complete',
  chunkSize: 1024,
  concurrency: 2,
  hash: false,
  protocolId: 'demo-backend-v1',
  protocol: {
    async reconcileUpload(context) {
      const url = new URL(server.baseUrl + '/upload/status');
      url.searchParams.set('filename', context.task.fileName);
      const response = await fetch(url);
      return response.json();
    },
  },
});

try {
  const file = new File([new Uint8Array(3 * 1024)], 'demo.bin');
  const taskId = engine.upload(file);
  let lastProgress = -1;
  const unsubscribe = engine.subscribe(taskId, (task) => {
    if (task && task.progress !== lastProgress) {
      lastProgress = task.progress;
      console.log(task.status.padEnd(12), String(task.progress).padStart(3) + '%');
    }
  });

  const completed = await waitForTask(engine, taskId, 'completed');
  unsubscribe();
  console.log('server result:', completed.result);
  console.log('HTTP requests:', server.requests);
} finally {
  await engine.destroy();
  await server.close();
}

function waitForTask(transfer, taskId, expectedStatus) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    stop = transfer.subscribe(taskId, (task) => {
      if (task?.status === expectedStatus) {
        stop();
        resolve(task);
      } else if (task?.status === 'failed') {
        stop();
        reject(task.error);
      }
    });
  });
}
