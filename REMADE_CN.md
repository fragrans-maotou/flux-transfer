# Flux Transfer SDK

一个功能强大、健壮且框架无关的浏览器文件上传 SDK。

## 特性

- **健壮的持久化**：自动保存进度到 `IndexedDB`。如果不可用（例如隐私模式），则优雅降级到 `LocalStorage`。
- **自动恢复**：页面刷新后自动恢复中断的上传会话（包括 `File` 对象），无需用户重新选择文件。
- **高性能**：
    - **Web Worker 哈希计算**：将 MD5 计算任务卸载到后台 Worker，防止 UI 冻结。
    - **自适应分片**：根据实时网络速度动态调整分片大小（目标：每片 2 秒），以最大化吞吐量。
- **智能重试**：实现指数退避算法，增强应对网络波动的能力。
- **插件系统**：可扩展的架构，允许在不修改核心代码的情况下添加自定义逻辑（如日志记录、鉴权等）。

---

## 安装

```bash
npm install flux-transfer
```

---

## 快速开始

```typescript
import { TransferManager, Uploader } from 'flux-transfer';

// 1. 初始化管理器
const manager = new TransferManager({
  maxConcurrent: 3,    // 最多 3 个并发上传
  enableCheckpoint: true, // 启用持久化 (IndexedDB / LocalStorage)
  enableHash: true,    // 启用 MD5 校验
});

// 2. 处理文件输入
document.getElementById('fileInput').addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files.length) return;

  // 3. 创建上传器并开始
  const uploader = manager.createUploader(files[0], {
    uploadUrl: 'https://api.example.com/upload/chunk',
    mergeUrl: 'https://api.example.com/upload/merge',
  });

  // 4. 监听事件
  uploader.on('progress', (data) => {
    console.log(`进度: ${data.progress}% (${data.speed} bytes/s)`);
  });

  uploader.on('completed', () => {
    console.log('上传完成!');
  });

  uploader.start();
});

// 5. 自动恢复 (页面加载时)
window.addEventListener('load', async () => {
    const sessions = await manager.getRecoverableSessions();
    // 包含已保存 File 对象的会话会在管理器内部自动恢复，
    // 或者你可以手动恢复它们:
    /*
    sessions.forEach(session => {
        if (session.file) {
             const uploader = manager.createUploader(session.file, { ...config }, session.groupId);
             uploader.restoreFromStorage();
        }
    });
    */
});
```

---

## 插件系统

SDK 支持插件架构，允许你通过钩子函数介入上传生命周期。

### 创建插件

实现 `IPlugin` 接口：

```typescript
import { IPlugin, IPluginContext } from 'flux-transfer/core/plugin/types';

export class LoggerPlugin implements IPlugin {
  name = 'LoggerPlugin';

  onTaskCreated(context: IPluginContext) {
    console.log(`任务创建: ${context.task.id}`);
  }

  beforeStart(context: IPluginContext) {
    console.log('上传开始...');
  }

  onProgress(context: IPluginContext, progress: number) {
    console.log(`上传进度: ${progress}%`);
  }

  onSuccess(context: IPluginContext) {
    console.log('上传成功!');
  }

  onError(context: IPluginContext, error: Error) {
    console.error('上传失败:', error);
  }
  
  // 中间件：转换请求（例如添加认证头）
  async transformRequest(config) {
      config.headers['Authorization'] = 'Bearer token';
      return config;
  }
}
```

### 使用插件

在 SDK 配置中注册插件：

```typescript
import { TransferManager } from 'flux-transfer';
import { LoggerPlugin } from './plugins/LoggerPlugin';

const manager = new TransferManager({
  // ... 其他配置
  plugins: [
    new LoggerPlugin(),
    // new S3SignerPlugin(),
    // new ImageCompressorPlugin()
  ]
});
```

---

## 架构详情

### 存储策略 ("用完即删")
- **首选**：`IndexedDB` (异步，支持 Blob/File 对象)。
- **降级**：`LocalStorage` (同步，仅字符串，有大小限制)。如果 IndexedDB 被阻止（例如无痕模式），会自动启用。
- **清理**：上传成功（或取消）后，检查点会被**自动删除**，确保不残留陈旧数据。

### 性能优化 V1.5
- **Web Worker**：哈希计算在单独的线程中进行。如果浏览器不支持 Worker，则优雅降级到主线程。
- **自适应分片**：SDK 会测量上传速度。
    - 慢速网络 -> 更小的分片 (最小 256KB) -> 更可靠。
    - 快速网络 -> 更大的分片 (最大 50MB) -> 更少开销。

---

## API 参考

### `TransferManager`
- `createUploader(file, config)`: 创建新的上传任务。
- `getRecoverableSessions()`: 返回中断的会话列表。

### `Uploader`
- `start()`: 开始上传 (计算哈希 -> 上传分片 -> 合并)。
- `pause()`: 暂停上传 (中止当前请求，保存状态)。
- `resume()`: 恢复上传 (重新加载状态，验证哈希/分片)。
- `cancel()`: 取消上传并清除检查点。
- `on(event, callback)`: 订阅事件 (`progress`, `statusChange`, `completed`, `error`)。
