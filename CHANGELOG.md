# Changelog

## [0.2.0]

- **产品目标收口**：定位为浏览器上传（直传 + 按 `chunkSize` 自动切片，任务异步调度不挡 UI）+ 简单 a 标签下载；不再扩展 Range / 流式下载叙事
- **Hash Web Worker**：MD5（spark-md5）在有 `Worker` 时迁到 Worker；无 Worker / Worker 失败 / 测试环境回退主线程分片 FileReader，暂停与取消仍可 abort
- **下载 a 标签优先**：无自定义 headers 且 credentials 为默认 `same-origin` 时直接 `<a href download target=_blank rel=noopener>`，不把整文件读进内存；需要自定义 headers 时仍走 fetch→Blob→`<a download>`
- 分片上传调度间隙 `setTimeout(0)` 让出事件循环
- 文档（README / README_CN / compatibility）与版本叙事同步更新

## [0.1.6]

- 将 `package-lock.json` 中的内网 npm registry 全部替换为 `https://registry.npmjs.org/`，确保公网 `npm ci` / CI 可用
- 补充 `package.json` 元数据（author、repository、bugs、homepage、publishConfig）并将版本升至 0.1.6
- 改进浏览器 `saveBlob`：先挂到 DOM 再触发下载，并用 `setTimeout` 延后 `revokeObjectURL`，避免部分浏览器下载未开始就失效；非浏览器环境跳过触发下载

## [0.1.5]

- 发布可用的核心传输引擎：分片上传、断点续传、重试、下载 Blob，以及消费者包冒烟与真实 HTTP 证据测试
