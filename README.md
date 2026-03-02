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

### Decoupling Plugins and UI with Global Events

In real applications (e.g. Vue/React components), it is highly recommended to **write common logic (like authentication, logging) in plugins**, while **binding page UI logic (like refreshing a list) to global events**.

If you pass component references (`this`) into plugins and the user navigates away, it can cause memory leaks or errors. Instead, the underlying `TransferManager` acts as a global `EventEmitter`.

```typescript
import { TransferManager } from 'flux-transfer';

// 1. Define global plugin (e.g. in your main.ts or store)
const GlobalNotifyPlugin = {
  name: 'GlobalNotifyPlugin',
  onProgress(context, progress) {
    console.log(`[Global] ${context.task.fileName} progress: ${progress}%`);
  }
};

const manager = new TransferManager({
  plugins: [GlobalNotifyPlugin] // Register globally
});

export default manager;
```

In your specific page component, listen to events to refresh the UI:

```typescript
// AnyComponent.vue
import manager from '@/store/transfer';

export default {
  created() {
    // Listen to global completion event
    this.handleTaskComplete = (task) => {
      // Check if this task belongs to the current page using groupId
      if (task.groupId === 'my-page-group') {
        const group = manager.getGroupStatus(task.groupId);
        // group includes: { total, completed, failed, progress, isAllCompleted }
        if (group.isAllCompleted) {
            this.fetchTableData(); // Refresh the table on this page
        }
      }
    };
    manager.on('taskCompleted', this.handleTaskComplete);
  },
  beforeDestroy() {
    manager.off('taskCompleted', this.handleTaskComplete); // Safely detach
  },
  methods: {
    uploadFile(file) {
      // Start upload from component, no need to pass verbose plugin array
      manager.createUploader(file, { uploadUrl: '/api/upload' }, 'my-page-group').start();
    }
  }
}
```

### Why use Plugins for Background Tasks?

**Plugins are bound to the underlying transfer tasks**, ignoring frontend routing. Even if the user leaves the page, tasks running in the background will still perfectly and silently execute plugin code (like notifying your backend).

```typescript
import { TransferManager } from 'flux-transfer';

// Example: Safely notify backend after user leaves the page
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
| `getGroupStatus(groupId)` | Get aggregated group status (returns `{ total, completed, failed, progress, isAllCompleted }`) |
| `on(event, callback)` | Subscribe to global events (e.g. `taskCompleted`, `taskProgress`) |

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

### Global Events (TransferManager)

| Event | Data | Description |
|-------|------|-------------|
| `taskProgress` | `{ taskId, progress, speed, remainingTime }` | Any subtask progress update |
| `taskStatusChange` | `{ taskId, status, prevStatus }` | Any subtask status change |
| `taskCompleted` | `ITransferTask` | Any subtask completed |
| `taskError` | `ITransferTask['error']` | Any subtask failed |
| `taskCancelled` | `ITransferTask` | Any subtask cancelled |

### Task Events (Uploader/Downloader)

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
