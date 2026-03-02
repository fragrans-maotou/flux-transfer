# Flux Transfer SDK

一个功能强大、健壮且框架无关的浏览器文件传输 SDK。

[English](./README.md)

## 特性

- **健壮的持久化**：自动保存进度到 `IndexedDB`。如果不可用（例如隐私模式），则优雅降级到 `LocalStorage`。
- **断点续传恢复**：页面刷新后调用 `manager.restore()` 即可恢复中断的上传任务——IndexedDB 可以持久化 `File` 对象，无需用户重新选择文件。
- **高性能**：
    - **Web Worker 哈希计算**：将 MD5 计算任务卸载到后台 Worker，防止 UI 冻结。
    - **自适应分片**：根据实时网络速度动态调整分片大小（目标：每片 2 秒），以最大化吞吐量。当用户显式设置了 `chunkSize` 时，自适应会被禁用。
- **智能重试**：实现指数退避算法，增强应对网络波动的能力。
- **插件系统**：可扩展的架构，允许在不修改核心代码的情况下添加自定义逻辑（如日志记录、鉴权等）。
- **框架适配器**：提供 Vue 2、Vue 3、React 开箱即用的响应式适配。

---

## 安装

```bash
npm install flux-transfer
```

---

## 快速开始

### 上传文件

```typescript
import { TransferManager, FetchAdapter } from 'flux-transfer';

// 1. 初始化管理器
const manager = new TransferManager({
  maxConcurrent: 3,       // 最多 3 个并发任务
  enableCheckpoint: true, // 启用持久化 (IndexedDB / LocalStorage)
});

// 2. 处理文件输入
document.getElementById('fileInput').addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files.length) return;

  // 3. 创建上传器并开始
  const uploader = manager.createUploader(files[0], {
    uploadUrl: 'https://api.example.com/upload/chunk',
    mergeUrl: 'https://api.example.com/upload/merge',
    networkAdapter: new FetchAdapter(),
    maxConcurrentChunks: 3, // 分片并发数
  });

  // 4. 监听事件
  uploader.on('progress', (data) => {
    console.log(`进度: ${data.progress}% | 速度: ${(data.speed / 1024).toFixed(1)} KB/s`);
  });

  uploader.on('statusChange', ({ status }) => {
    console.log(`状态变更: ${status}`);
  });

  uploader.on('completed', () => console.log('上传完成!'));
  uploader.on('error', (err) => console.error('上传失败:', err));

  uploader.start();
});

// 批量上传
const uploaders = manager.uploadBatch(files, {
  uploadUrl: 'https://api.example.com/upload/chunk',
  mergeUrl: 'https://api.example.com/upload/merge',
  networkAdapter: new FetchAdapter(),
}, 'batch-group-1');
```

### 下载文件

```typescript
import { TransferManager } from 'flux-transfer';

const manager = new TransferManager({ maxConcurrent: 3 });

// 创建下载器
const downloader = manager.createDownloader('https://example.com/file.zip', {
  fileName: 'my-file.zip',     // 可选：自定义文件名
  strategy: 'auto',            // 可选：'auto' | 'fetch-blob' | 'stream-saver' | 'direct-link'
  enableResume: true,          // 可选：启用断点续传
});

// 监听事件
downloader.on('progress', (data) => {
  console.log(`下载进度: ${data.progress}%`);
});

downloader.on('completed', () => console.log('下载完成!'));

downloader.start();

// 批量下载
const downloaders = manager.downloadBatch([
  'https://example.com/file1.zip',
  'https://example.com/file2.zip',
], { strategy: 'auto' }, 'download-group-1');
```

### 断点续传恢复

```typescript
// 页面加载时恢复中断的上传
window.addEventListener('load', async () => {
  const restored = await manager.restore({
    // 可选：覆盖配置（如重新指定 networkAdapter）
    networkAdapter: new FetchAdapter(),
  });

  console.log(`恢复了 ${restored.length} 个中断任务`);

  restored.forEach(uploader => {
    const task = uploader.getTask();
    console.log(`恢复: ${task.fileName}, 进度: ${task.progress}%`);
    // 恢复后的任务状态为 Paused，由用户决定是否继续
    uploader.resume();
  });
});
```

配置合并优先级：`管理器全局配置 < checkpoint 中保存的配置 < configOverrides 参数`

---

## Vue 2 适配器

为 Vue 2 项目提供基于 `Vue.observable()` 的响应式能力。

```javascript
// main.js - 初始化（只需一次）
import Vue from 'vue';
import { setVue } from 'flux-transfer/vue2';
setVue(Vue);
```

```javascript
// 组件中使用
import { FetchAdapter, TransferManager } from 'flux-transfer';
import { useUpload, wrapUploader } from 'flux-transfer/vue2';

export default {
  data() {
    return { manager: null, uploads: [] };
  },
  async created() {
    this.manager = new TransferManager({ enableCheckpoint: true });

    // 恢复中断的任务
    const restored = await this.manager.restore({ networkAdapter: new FetchAdapter() });
    restored.forEach(uploader => {
      const ctrl = wrapUploader(uploader); // 包装成响应式
      this.uploads.push({
        fileName: uploader.getTask().fileName,
        fileSize: uploader.getTask().fileSize,
        ctrl,
      });
    });
  },
  methods: {
    addFile(file) {
      // 创建新上传，自动包含响应式 state
      const ctrl = useUpload(this.manager, file, {
        uploadUrl: '/api/upload',
        networkAdapter: new FetchAdapter(),
      });
      this.uploads.push({ fileName: file.name, fileSize: file.size, ctrl });
      ctrl.start();
    },
  },
  beforeDestroy() {
    this.uploads.forEach(item => item.ctrl.cleanup());
  },
};
```

### Vue 2 适配器 API

| 函数 | 描述 |
|------|------|
| `setVue(Vue)` | 注入 Vue 2 构造函数（使用前调用一次） |
| `useUpload(manager, file, config, groupId?)` | 创建上传器并返回响应式状态 |
| `useDownload(manager, url, config, groupId?)` | 创建下载器并返回响应式状态 |
| `wrapUploader(uploader)` | 将已有的 Uploader（如 `restore()` 恢复的）包装为响应式结构 |
| `useTransferList(manager)` | 所有任务的响应式视图 |
| `fluxTransferMixin` | Vue mixin，在 `beforeDestroy` 时自动清理 |

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

**为什么使用插件而不是全局事件监听？（跨页面上传的最佳实践）**
当用户在页面 A 发起上传，随后跳转到页面 B 时，页面 A 的 UI 组件会被销毁。如果依赖组件内的事件监听，不仅可能内存泄露，还会因为尝试更新已销毁的 UI 而报错。
而**插件是直接绑定在底层的传输任务上的**。无论前端路由怎么跳，只要在单页应用内，文件在后台默默传完后，插件内部的代码一定会完美、无感知地自动执行。

```typescript
import { TransferManager } from 'flux-transfer';

// 示例：用户离开页面后，依然能在后台静默调用业务接口
const SyncRecordPlugin = {
  name: 'SyncRecordPlugin',
  onSuccess: async (context) => {
    // 这里的代码脱离了 UI 组件生命周期，极其安全
    console.log(`后台静默通知: 任务 ${context.task.id} 上传完毕`);
    await fetch('/api/file/notify-update', {
      method: 'POST',
      body: JSON.stringify({ fileId: context.task.id, status: 'DONE' })
    });
  }
};

const manager = new TransferManager({
  plugins: [SyncRecordPlugin]
});
```

---

## 架构详情

### 存储策略 ("用完即删")
- **首选**：`IndexedDB` (异步，支持 Blob/File 对象)。
- **降级**：`LocalStorage` (同步，仅字符串，有大小限制)。如果 IndexedDB 被阻止（例如无痕模式），会自动启用。
- **清理**：上传成功（或取消）后，检查点会被**自动删除**，确保不残留陈旧数据。

### 性能优化
- **Web Worker**：哈希计算在单独的线程中进行。如果浏览器不支持 Worker，则优雅降级到主线程。
- **自适应分片**：SDK 会测量上传速度并动态调整分片大小。
    - 慢速网络 → 更小的分片 (最小 256KB) → 更可靠。
    - 快速网络 → 更大的分片 (最大 50MB) → 更少开销。
    - **注意**：当用户显式设置了 `chunkSize` 时，自适应分片会被禁用，严格按照用户指定的大小分片。

---

## API 参考

### `TransferManager`

| 方法 | 描述 |
|------|------|
| `createUploader(file, config, groupId?)` | 创建上传任务 |
| `createDownloader(url, config, groupId?)` | 创建下载任务 |
| `restore(configOverrides?)` | 从存储中恢复中断的上传任务，返回 `Uploader[]`（状态为 Paused） |
| `getRecoverableSessions()` | 获取存储中的原始检查点数据 |
| `uploadBatch(files, config, groupId?)` | 批量上传并自动入队 |
| `downloadBatch(urls, config, groupId?)` | 批量下载并自动入队 |
| `getTask(taskId)` | 获取任务实例 |
| `getAllTasks()` | 获取所有任务 |
| `getTasksByGroup(groupId)` | 获取分组内的任务 |
| `getGroupStatus(groupId)` | 获取分组状态 |

### `Uploader`

| 方法 | 描述 |
|------|------|
| `start()` | 开始上传 (计算哈希 → 上传分片 → 合并) |
| `pause()` | 暂停上传 (中止当前请求，保存状态) |
| `resume()` | 恢复上传 (重新加载状态，验证哈希/分片) |
| `cancel()` | 取消上传并清除检查点 |
| `restoreFromStorage()` | 从存储恢复进度（内部由 `manager.restore()` 调用） |
| `getTask()` | 获取任务信息 |
| `on(event, callback)` | 订阅事件 |

### `Downloader`

| 方法 | 描述 |
|------|------|
| `start()` | 开始下载 |
| `pause()` | 暂停下载 |
| `resume()` | 恢复下载 |
| `cancel()` | 取消下载并清除检查点 |
| `getStrategyName()` | 获取当前下载策略名称 |
| `getDownloadedBytes()` | 获取已下载字节数 |
| `on(event, callback)` | 订阅事件 |

### 事件

| 事件 | 数据 | 描述 |
|------|------|------|
| `progress` | `{ progress, speed, remainingTime }` | 进度更新 |
| `statusChange` | `{ status, prevStatus, taskId }` | 状态变更 |
| `completed` | `{ taskId }` | 任务完成 |
| `error` | `{ code, message, original? }` | 任务失败 |

### 状态枚举 `TaskStatus`

```typescript
enum TaskStatus {
  Idle = 'idle',           // 等待中
  Processing = 'processing', // 处理中 (计算哈希等)
  Transferring = 'transferring', // 传输中
  Paused = 'paused',       // 已暂停
  Completed = 'completed', // 已完成
  Failed = 'failed',       // 已失败
  Cancelled = 'cancelled', // 已取消
}
```
