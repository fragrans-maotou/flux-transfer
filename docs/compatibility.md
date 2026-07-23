# 兼容性与证据边界

本文档区分“已经由自动化验证的能力”和“尚未验证、不能对外承诺的能力”。

## 已验证

| 能力 | 证据 |
|---|---|
| 浏览器式 `multipart/form-data` 直传 | 默认协议单元测试 |
| 索引分片上传 | 单元测试与真实 HTTP 集成测试 |
| 并发、暂停、取消、超时重试 | 生命周期与网络测试 |
| 服务端分片对账 `reconcileUpload` | 单元测试与真实 HTTP 集成测试 |
| complete JSON 请求 | 单元测试与真实 HTTP 集成测试 |
| 页面刷新后的文件身份校验 | 恢复生命周期测试 |
| ESM、CJS、TypeScript 声明 | 发布构建与 pack 检查 |

真实 HTTP 集成测试位于 `tests/integration/http-backend.test.ts`。它会启动本机 HTTP 服务，使用默认 `FetchAdapter` 发送真正的 multipart 请求，不使用 mock 网络适配器。

## 尚未验证

以下能力不能因为“协议钩子理论上可以实现”就声称已经支持：

- Amazon S3 Multipart Upload
- 阿里云 OSS、腾讯云 COS
- tus 协议
- 每个分片动态刷新签名 URL
- Service Worker 后台续传
- 浏览器关闭后的自动上传
- 超大文件流式下载到磁盘

要把其中任何一项列为支持，至少需要对应适配器、真实服务集成测试和可运行示例。

## 环境要求

库面向具有以下 API 的现代浏览器：`File`、`Blob`、`FormData`、`fetch`、`AbortController`、`ReadableStream`、`crypto.randomUUID`（缺失时有任务 ID 回退）。

npm 包声明 Node.js >=18，主要用于构建工具或同构项目依赖解析。仓库当前开发工具链 Vitest 4 和 jsdom 27 要求 Node 20.19+、22.12+ 或 24+，CI 使用这三个版本验证。

## 性能证据的限制

`npm run benchmark` 使用虚拟 100MiB 和 1GiB 文件，测量分片规划、任务状态和调度开销。它不分配等量文件内存，也不测量 Hash、Blob 复制、磁盘或网络吞吐，因此不能用来宣称“1GiB 文件上传速度”。

真实浏览器性能仍需要按浏览器、设备、分片大小、并发数和后端分别测试。

## 示例后端的限制

`npm run example` 启动的后端只在内存中记录每个分片的大小，用于证明协议交互。它没有认证、持久化、恶意文件防护、跨进程一致性或生产级错误处理，不能直接部署到生产环境。
