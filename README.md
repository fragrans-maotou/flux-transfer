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
  maxActiveTasks: 3,
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

Restored files are checked against a persisted resume descriptor. If a legacy snapshot has no descriptor, flux-transfer restarts it instead of reusing unsafe chunk state. Headers are not persisted; pass refreshed credentials to `resume`. Set a stable `protocolId` for custom protocols. A protocol can implement async `reconcileUpload` to make server-side uploaded chunks authoritative.

## Retry and idempotency

The default policy retries network errors, timeouts, 408, 429 and 5xx responses. Exported `NetworkError`, `NetworkTimeoutError` and `HTTPError` let custom adapters keep the same semantics. Use `shouldRetry` for a custom policy. Set `idempotencyHeader: 'Idempotency-Key'` to add stable operation-specific keys to default protocol requests; this is off by default and requires server-side deduplication.

## Scheduling, progress and disposal

`concurrency` limits chunks within one file. `maxActiveTasks` limits running tasks across the engine and defaults to 3. Queued tasks remain `idle` until a slot is free.

Upload tasks report `progressSource: 'confirmed'`: progress counts chunks confirmed by the server, not bytes currently in flight. Download tasks report `progressSource: 'streamed'`.

Call `await transfer.destroy()` when finished. It marks unfinished tasks as cancelled, aborts requests, waits for runners to exit and flushes the final persisted snapshot. The engine rejects new work after destruction. Persistence writes are serialized; use `onStorageError` to observe quota or permission failures.

## Download

transfer.download(url, { filename, headers }) downloads to a Blob. Large-file disk streaming is intentionally outside the core.
