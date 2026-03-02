# Flux Transfer SDK

A powerful, robust, and framework-agnostic file transfer SDK for the browser.

[中文文档](./README_CN.md)

## Features

- **Robust Persistence**: Automatically saves progress to `IndexedDB`. If unavailable, gracefully falls back to `LocalStorage`.
- **Automatic Recovery**: Call `manager.restore()` on page reload to recover interrupted uploads—including `File` objects persisted via IndexedDB.
- **High Performance**:
    - **Web Worker Hashing**: Offloads MD5 calculation to a background worker to prevent UI freezing.
    - **Adaptive Chunking**: Dynamically adjusts chunk size based on network speed (target: 2s/chunk) to maximize throughput. Disabled when a fixed `chunkSize` is specified.
- **Smart Retries**: Implements exponential backoff for resilience against network glitches.
- **Plugin System**: Extendable architecture to add custom logic (logging, authentication, etc.) without modifying the core.
- **Framework Adapters**: First-class support for Vue 2, Vue 3, and React.

---

## Installation

```bash
npm install flux-transfer
```

---

## Quick Start

```typescript
import { TransferManager, FetchAdapter } from 'flux-transfer';

// 1. Initialize the Manager
const manager = new TransferManager({
  maxConcurrent: 3,       // Max 3 concurrent uploads
  enableCheckpoint: true, // Enable persistence (IndexedDB / LocalStorage)
  enableHash: true,       // Enable MD5 verification
});

// 2. Handle File Input
document.getElementById('fileInput').addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files.length) return;

  // 3. Create Uploader & Start
  const uploader = manager.createUploader(files[0], {
    uploadUrl: 'https://api.example.com/upload/chunk',
    mergeUrl: 'https://api.example.com/upload/merge',
    networkAdapter: new FetchAdapter(),
  });

  // 4. Listen to Events
  uploader.on('progress', (data) => {
    console.log(`Progress: ${data.progress}% (${data.speed} bytes/s)`);
  });

  uploader.on('completed', () => {
    console.log('Upload finished!');
  });

  uploader.start();
});

// 5. Restore interrupted uploads on page reload
window.addEventListener('load', async () => {
  const restored = await manager.restore({
    networkAdapter: new FetchAdapter(),
  });

  restored.forEach(uploader => {
    console.log(`Restored: ${uploader.getTask().fileName}, progress: ${uploader.getTask().progress}%`);
    // Restored tasks are in Paused state — resume or let user decide
    uploader.resume();
  });
});
```

---

## Vue 2 Adapter

For Vue 2 projects, the SDK provides reactive composables powered by `Vue.observable()`.

```javascript
import Vue from 'vue';
import { FetchAdapter, TransferManager } from 'flux-transfer';
import { setVue, useUpload, wrapUploader } from 'flux-transfer/vue2';

// Inject Vue instance (required once before using any composable)
setVue(Vue);

const manager = new TransferManager({ enableCheckpoint: true });

// Create a new upload with reactive state
const { state, start, pause, resume, cancel, cleanup } = useUpload(manager, file, {
  uploadUrl: '/api/upload',
  networkAdapter: new FetchAdapter(),
});

// state.progress, state.status, etc. are reactive

// Wrap a restored uploader with reactive state
const restored = await manager.restore({ networkAdapter: new FetchAdapter() });
restored.forEach(uploader => {
  const ctrl = wrapUploader(uploader);
  // ctrl.state is reactive, same interface as useUpload()
});
```

### Vue 2 API

| Function | Description |
|----------|-------------|
| `setVue(Vue)` | Inject Vue 2 constructor (call once before using composables) |
| `useUpload(manager, file, config, groupId?)` | Create uploader with reactive state |
| `useDownload(manager, url, config, groupId?)` | Create downloader with reactive state |
| `wrapUploader(uploader)` | Wrap an existing Uploader (e.g. from `restore()`) with reactive state |
| `useTransferList(manager)` | Reactive view of all tasks |
| `fluxTransferMixin` | Vue mixin for automatic cleanup on `beforeDestroy` |

---

## Plugin System

The SDK supports a plugin architecture, allowing you to hook into the upload lifecycle.

### Creating a Plugin

Implement the `IPlugin` interface:

```typescript
import { IPlugin, IPluginContext } from 'flux-transfer/core/plugin/types';

export class LoggerPlugin implements IPlugin {
  name = 'LoggerPlugin';

  onTaskCreated(context: IPluginContext) {
    console.log(`Task created: ${context.task.id}`);
  }

  beforeStart(context: IPluginContext) {
    console.log('Upload starting...');
  }

  onProgress(context: IPluginContext, progress: number) {
    console.log(`Upload progress: ${progress}%`);
  }

  onSuccess(context: IPluginContext) {
    console.log('Upload success!');
  }

  onError(context: IPluginContext, error: Error) {
    console.error('Upload failed:', error);
  }
  
  // Middleware: Transform request (e.g., add Auth headers)
  async transformRequest(config) {
      config.headers['Authorization'] = 'Bearer token';
      return config;
  }
}
```

### Using a Plugin

Register plugins in the SDK configuration.

**Why use Plugins instead of global event listeners?**
Plugins are ideal for cross-page scenarios. When a user starts an upload on Page A and navigates away, Page A's UI components are destroyed (which would kill local event listeners and cause errors if they try to update the UI). 
However, Plugins are bound to the `TransferManager` and the specific upload task. They will survive page navigation and execute reliably in the background once the upload completes.

```typescript
import { TransferManager } from 'flux-transfer';

// Example: Safely update business status after user leaves the page
const SyncRecordPlugin = {
  name: 'SyncRecordPlugin',
  onSuccess: async (context) => {
    // This executes safely in the background even if the UI page is gone
    console.log(`Task ${context.task.id} finished. Silently notifying backend...`);
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

## Architecture Details

### Storage Strategy ("Use and Delete")
- **Primary**: `IndexedDB` (Async, handles blobs/files).
- **Fallback**: `LocalStorage` (Sync, string-only, size limits). Used automatically if IndexedDB is blocked (e.g. Incognito mode).
- **Cleanup**: Checkpoints are **automatically deleted** after the upload completes successfully (or is cancelled), ensuring no stale data remains.

### Performance
- **Web Worker**: Hash calculation happens in a separate thread. If the browser doesn't support Workers, it gracefully falls back to the main thread.
- **Adaptive Chunking**: The SDK measures upload speed and dynamically adjusts chunk size.
    - Slow network → Smaller chunks (min 256KB) → More reliable.
    - Fast network → Larger chunks (max 50MB) → Less overhead.
    - **Note**: When a fixed `chunkSize` is specified in the config, adaptive chunking is disabled and the specified size is used strictly.

---

## API Reference

### `TransferManager`

| Method | Description |
|--------|-------------|
| `createUploader(file, config, groupId?)` | Create an upload task |
| `createDownloader(url, config, groupId?)` | Create a download task |
| `restore(configOverrides?)` | Restore interrupted uploads from storage, returns `Uploader[]` (Paused state) |
| `getRecoverableSessions()` | Get raw checkpoint data from storage |
| `uploadBatch(files, config, groupId?)` | Batch upload with auto-enqueue |
| `downloadBatch(urls, config, groupId?)` | Batch download with auto-enqueue |
| `getTask(taskId)` | Get a task instance by ID |
| `getAllTasks()` | Get all task snapshots |
| `getTasksByGroup(groupId)` | Get tasks in a group |
| `getGroupStatus(groupId)` | Get aggregated group status |

### `Uploader`

| Method | Description |
|--------|-------------|
| `start()` | Begin upload (Hash → Upload → Merge) |
| `pause()` | Pause upload (aborts current request, saves state) |
| `resume()` | Resume upload (reloads state, verifies hash/chunks) |
| `cancel()` | Cancel upload and clear checkpoint |
| `restoreFromStorage()` | Restore progress from storage (called internally by `manager.restore()`) |
| `getTask()` | Get task snapshot |
| `on(event, callback)` | Subscribe to events |

### `Downloader`

| Method | Description |
|--------|-------------|
| `start()` | Begin download |
| `pause()` | Pause download |
| `resume()` | Resume download |
| `cancel()` | Cancel download and clear checkpoint |
| `getStrategyName()` | Get current download strategy name |
| `getDownloadedBytes()` | Get downloaded bytes count |
| `on(event, callback)` | Subscribe to events |

### Events

| Event | Data | Description |
|-------|------|-------------|
| `progress` | `{ progress, speed, remainingTime }` | Progress update |
| `statusChange` | `{ status, prevStatus, taskId }` | Status change |
| `completed` | `{ taskId }` | Task completed |
| `error` | `{ code, message, original? }` | Task failed |

### `TaskStatus` Enum

```typescript
enum TaskStatus {
  Idle = 'idle',               // Waiting
  Processing = 'processing',   // Processing (hashing, etc.)
  Transferring = 'transferring', // Transferring
  Paused = 'paused',           // Paused
  Completed = 'completed',     // Completed
  Failed = 'failed',           // Failed
  Cancelled = 'cancelled',     // Cancelled
}
```
