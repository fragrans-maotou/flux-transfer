# flux-transfer

[中文文档](./README_CN.md)

Browser **upload** (direct or auto-chunked by `chunkSize`) plus simple **`<a>` tag download**.

This is not a general-purpose transfer engine: Range / streamed-to-disk download stay with your backend (signed URLs, `Content-Disposition`, etc.). Verified vs unverified capabilities: [compatibility.md](docs/compatibility.md).

## Install

~~~bash
npm install flux-transfer
~~~

## Usage

~~~ts
import { TransferEngine } from 'flux-transfer';

const transfer = new TransferEngine({
  uploadUrl: '/api/upload',
  chunkUrl: '/api/upload/chunk',
  completeUrl: '/api/upload/complete',
  chunkSize: 5 * 1024 * 1024, // ≤ this → direct; larger → auto slice
  concurrency: 3,
  maxActiveTasks: 3,
  retries: 2,
});

// Returns taskId immediately — hashing/upload run on the engine scheduler (does not block UI).
const taskId = transfer.upload(file, { data: { folderId: 'docs' } });

transfer.subscribe(taskId, (task) => {
  console.log(task?.status, task?.progress);
});

// Prefer a plain <a href> click when no custom headers are needed (file is not loaded into JS memory).
transfer.download('https://cdn.example/report.pdf', { filename: 'report.pdf' });
~~~

Files up to `chunkSize` use a single request. Larger files are sliced and uploaded with resume / retry. MD5 hashing (when enabled) runs in a **Web Worker** when available, with a main-thread fallback for tests and older environments.

## Download

~~~ts
// Direct <a> download (default when headers/credentials stay at defaults)
transfer.download(url, { filename: 'report.pdf' });

// fetch → Blob → <a download> only when you need custom headers (e.g. Authorization)
transfer.download(url, {
  filename: 'report.pdf',
  headers: { Authorization: 'Bearer token' },
});
~~~

Auth and large-file strategy belong on the server: issue a directly navigable URL (or set `Content-Disposition`). This library does **not** implement Range, chunked download, or streamed write-to-disk.

## Backend compatibility

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

Per-task URL, headers and data override global values. Unusual upload protocols can implement `createDirectRequest`, `createChunkRequest`, `createCompleteRequest`, `reconcileUpload`, or `parseResponse`.

## Resume

Provide a `storageAdapter`, call `await transfer.init()`, then `transfer.resume(taskId, { file })` after reload. Browsers cannot persist the original `File`. Headers are not persisted — pass refreshed credentials to `resume`.

## Retry, scheduling, disposal

Default retries: network errors, timeouts, 408, 429, 5xx. `concurrency` limits chunks within one file; `maxActiveTasks` limits running tasks (default 3). `upload()` / `download()` only enqueue work — they return a taskId without blocking the UI thread.

Call `await transfer.destroy()` when finished.

## Evidence

`npm run example` · `npm run test:consumer` · [compatibility.md](docs/compatibility.md)
