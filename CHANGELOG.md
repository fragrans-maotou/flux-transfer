# Changelog

## [0.1.6]

- 将 `package-lock.json` 中的内网 npm registry 全部替换为 `https://registry.npmjs.org/`，确保公网 `npm ci` / CI 可用
- 补充 `package.json` 元数据（author、repository、bugs、homepage、publishConfig）并将版本升至 0.1.6
- 改进浏览器 `saveBlob`：先挂到 DOM 再触发下载，并用 `setTimeout` 延后 `revokeObjectURL`，避免部分浏览器下载未开始就失效；非浏览器环境跳过触发下载

## [0.1.5]

- 发布可用的核心传输引擎：分片上传、断点续传、重试、下载 Blob，以及消费者包冒烟与真实 HTTP 证据测试
