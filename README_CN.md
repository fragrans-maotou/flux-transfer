# flux-transfer

[English](./README.md)

浏览器端 **上传**（按 `chunkSize` 直传或自动切片）+ 简单 **`<a>` 标签下载**。

这不是万能传输引擎：Range / 流式写盘等下载能力交给后端（签权 URL、`Content-Disposition` 等）。已验证与未验证边界见 [compatibility.md](docs/compatibility.md)。

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
  chunkSize: 5 * 1024 * 1024, // ≤ 阈值直传；更大自动切片
  concurrency: 3,
  maxActiveTasks: 3,
  retries: 2,
});

// 立刻返回 taskId；Hash / 上传在引擎调度里异步跑，不阻塞 UI。
const taskId = transfer.upload(file, { data: { folderId: 'docs' } });

transfer.subscribe(taskId, (task) => {
  console.log(task?.status, task?.progress);
});

// 无自定义 headers 时优先 <a href> 点击下载（不把整文件读进 JS 内存）
transfer.download('https://cdn.example/report.pdf', { filename: 'report.pdf' });
~~~

小于或等于 `chunkSize` 的文件一次请求直传，更大文件自动分片并支持暂停恢复与重试。启用 Hash 时，有 **Web Worker** 则在 Worker 里算 MD5，否则回退主线程分片 `FileReader`（测试环境同样走回退）。

## 下载

~~~ts
// 默认：直接 <a> 落地
transfer.download(url, { filename: 'report.pdf' });

// 需要自定义 headers（如 Authorization）时：fetch → Blob → <a download>
transfer.download(url, {
  filename: 'report.pdf',
  headers: { Authorization: 'Bearer token' },
});
~~~

鉴权与大文件策略由后端提供可直链的 URL（或 `Content-Disposition`）。本库 **不做** Range、分片下载或流式写盘。

## 兼容不同后端

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

任务级 URL / headers / data 可覆盖全局配置。特殊上传协议可实现 `createDirectRequest`、`createChunkRequest`、`createCompleteRequest`、`reconcileUpload`、`parseResponse`。

## 暂停、恢复与刷新后恢复

~~~ts
transfer.pause(taskId);
transfer.resume(taskId);
transfer.cancel(taskId);
transfer.retry(taskId);
~~~

提供 `storageAdapter` 并 `await transfer.init()` 后，刷新页面用 `transfer.resume(taskId, { file })` 恢复。浏览器无法持久化原始 `File`；请求头不落盘，凭据请在 `resume` 时重新传入。

## 重试、调度与销毁

默认重试网络错误、超时、408、429、5xx。`concurrency` 控制单文件分片并发，`maxActiveTasks` 控制引擎同时运行任务数（默认 3）。`upload()` / `download()` 只入队并返回 taskId，调用瞬间不阻塞 UI。

~~~ts
await transfer.destroy();
~~~

## 验证

`npm run example` · `npm run test:consumer` · [兼容性与证据边界](docs/compatibility.md)
