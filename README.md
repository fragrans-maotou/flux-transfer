# flux-transfer

A small browser file-transfer engine.

The core owns one transfer pipeline: direct upload, chunking, concurrency, retry, pause/resume, progress and state. Backend-specific fields and response shapes stay at the protocol boundary.

## Usage

~~~ts
import { TransferEngine } from 'flux-transfer';

const transfer = new TransferEngine({
  uploadUrl: '/api/upload',
  chunkUrl: '/api/upload/chunk',
  completeUrl: '/api/upload/complete',
  chunkSize: 5 * 1024 * 1024,
  concurrency: 3,
  retries: 2,
});

const taskId = transfer.upload(file, {
  data: { folderId: 'docs' },
});

const unsubscribe = transfer.subscribe(taskId, (task) => {
  console.log(task?.status, task?.progress);
});

transfer.pause(taskId);
transfer.resume(taskId);
transfer.cancel(taskId);
~~~

Files up to chunkSize use direct upload. Larger files use chunked upload. concurrency is the number of chunks uploaded in parallel for one file.

## Backend compatibility

Common differences are declarative:

~~~ts
const transfer = new TransferEngine({
  uploadUrl: '/upload',
  chunkUrl: '/upload/part',
  fields: {
    file: 'uploadFile',
    chunkIndex: 'partNumber',
    totalChunks: 'partCount',
    fileHash: 'md5',
    fileName: 'name',
  },
  chunkIndexBase: 1,
});
~~~

Per-task URL, headers and data override global values. Unusual protocols can implement createDirectRequest, createChunkRequest, createCompleteRequest, or parseResponse.

## Resume

Provide a storageAdapter, call await transfer.init(), then resume a restored upload with transfer.resume(taskId, { file }). Browsers cannot persist the original File, so the user must select it again after a page reload.

## Download

transfer.download(url, { filename, headers }) downloads to a Blob. Large-file disk streaming is intentionally outside the core.
