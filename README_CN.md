# flux-transfer

一个小而明确的浏览器文件传输引擎。

核心只负责直传、分片、并发、重试、暂停与恢复、进度和任务状态。不同后端的字段、请求格式与响应结构通过协议边界适配，不进入传输算法。

## 安装

~~~bash
npm install flux-transfer
~~~

## 基础使用

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

小于或等于 `chunkSize` 的文件直接上传，大文件自动分片。`concurrency` 只表示单个文件的分片并发数。

## 兼容不同后端

常见差异使用声明式配置，例如字段名和分片序号：

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

单个任务可以覆盖 URL、请求头和业务参数：

~~~ts
transfer.upload(file, {
  url: '/tenant-a/upload',
  chunkUrl: '/tenant-a/upload/part',
  headers: {
    'X-Tenant-ID': 'tenant-a',
  },
  data: {
    folderId: 42,
    documentType: 'contract',
  },
});
~~~

特殊后端协议只需要改写 HTTP 边界：

~~~ts
const transfer = new TransferEngine({
  uploadUrl: '/upload',
  protocol: {
    createChunkRequest(context) {
      return {
        url: '/signed-part?index=' + context.chunkIndex,
        method: 'PUT',
        body: context.chunk,
      };
    },

    parseResponse(_phase, response) {
      return {
        uploadId: (response.data as { uploadId: string }).uploadId,
      };
    },
  },
});
~~~

可覆盖的协议钩子只有：

- `createDirectRequest`
- `createChunkRequest`
- `createCompleteRequest`
- `reconcileUpload`
- `parseResponse`

常见差异用配置，特殊差异用协议钩子，核心传输流程始终保持一致。

## 暂停、恢复与取消

~~~ts
transfer.pause(taskId);
transfer.resume(taskId);
transfer.cancel(taskId);
transfer.retry(taskId);
~~~

暂停和取消会中断正在进行的 Hash 或网络请求。恢复时会继续使用已经完成的分片信息。

## 页面刷新后恢复

~~~ts
import { LocalStorageAdapter, TransferEngine } from 'flux-transfer';

const transfer = new TransferEngine({
  uploadUrl: '/upload',
  storageAdapter: new LocalStorageAdapter(),
});

await transfer.init();

const restoredTask = transfer.store.getTask(taskId);
if (restoredTask?.status === 'paused') {
  transfer.resume(taskId, { file });
}
~~~

浏览器无法安全持久化原始 `File` 对象，因此页面刷新后需要用户重新选择文件。任务 Hash、上传地址、业务数据、会话数据和已完成分片会继续使用。

恢复描述会保存文件名、大小、修改时间、Hash、分片大小、端点和 `protocolId`。重新选择文件后会先验证身份；旧版本快照缺少这些信息时会从头上传，不会复用不安全的分片。请求头不会持久化，临时凭据应在 `resume` 时重新传入。

生产后端可以通过服务端对账覆盖本地分片记录：

~~~ts
const transfer = new TransferEngine({
  uploadUrl: '/upload',
  protocolId: 'my-backend-v1',
  protocol: {
    async reconcileUpload(context) {
      const state = await queryUpload(context.task.session.uploadId);
      return {
        uploadedChunks: state.uploadedChunks,
        session: { uploadId: state.uploadId },
      };
    },
  },
});
~~~

未提供 `reconcileUpload` 时，本地 `uploadedChunks` 仍是乐观缓存，后端分片接口必须幂等。

## 重试与幂等

默认只重试网络错误、超时、408、429 和 5xx。400、401、403 等确定性错误不会重试。自定义网络适配器应抛出导出的 `NetworkError`、`NetworkTimeoutError` 或 `HTTPError`；特殊策略可以通过 `shouldRetry` 覆盖。

需要重试 POST 时，可以让默认协议生成稳定的幂等键：

~~~ts
const transfer = new TransferEngine({
  uploadUrl: '/upload',
  idempotencyHeader: 'Idempotency-Key',
});
~~~

该配置默认关闭，避免无意改变跨域请求头。后端必须按此请求头实现去重。

## 任务调度、进度和销毁

`concurrency` 控制单个文件同时上传的分片数，`maxActiveTasks` 控制整个引擎同时运行的任务数，默认都是 3。等待中的任务保持 `idle`，有空位时按加入顺序启动。

上传任务的 `progressSource` 是 `confirmed`：进度表示服务端已经确认的分片字节，不包含正在传输的字节。下载任务是 `streamed`，表示浏览器已经读取的响应字节。

不再使用引擎时应等待销毁完成：

~~~ts
await transfer.destroy();
~~~

销毁会把未完成任务转成 `cancelled`，中断请求，等待运行协程退出，并将最终状态写入存储。销毁后的引擎不能再次启动任务。

持久化写入严格按顺序执行，`destroy()` 会 flush 尚未写入的最新快照。可以通过 `onStorageError` 接收配额、权限等存储失败：

~~~ts
const transfer = new TransferEngine({
  storageAdapter: new LocalStorageAdapter(),
  onStorageError(error) {
    reportError(error);
  },
});
~~~

## 下载

~~~ts
const taskId = transfer.download('/api/files/1', {
  filename: 'report.pdf',
  headers: {
    Authorization: 'Bearer token',
  },
});
~~~

下载采用 Blob 模式。超大文件流式写盘不属于核心能力，可以在独立扩展中实现。

## 设计原则

- 核心只有一条传输主链。
- 后端差异停留在 HTTP 边界。
- 配置项必须真实生效。
- 不为了“可能有用”而增加功能。
- 优先保证正确性、可测试性和可理解性。
