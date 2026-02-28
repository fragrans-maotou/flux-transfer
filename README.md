# Flux Transfer SDK

A powerful, robust, and framework-agnostic file transfer SDK for the browser.

## Features

- **Robust Persistence**: Automatically saves progress to `IndexedDB`. If unavailable, gracefully falls back to `LocalStorage`.
- **Automatic Recovery**: Automatically restores interrupted upload sessions (including `File` objects) on page reload.
- **High Performance**:
    - **Web Worker Hashing**: Offloads MD5 calculation to a background worker to prevent UI freezing.
    - **Adaptive Chunking**: Dynamically adjusts chunk size based on network speed (target: 2s/chunk) to maximize throughput.
- **Smart Retries**: Implements exponential backoff for resilience against network glitches.
- **Plugin System**: Extendable architecture to add custom logic (logging, authentication, etc.) without modifying the core.

---

## Installation

```bash
npm install flux-transfer
```

---

## Quick Start

```typescript
import { TransferManager, Uploader } from 'flux-transfer';

// 1. Initialize the Manager
const manager = new TransferManager({
  maxConcurrent: 3,    // Max 3 concurrent uploads
  enableCheckpoint: true, // Enable persistence (IndexedDB / LocalStorage)
  enableHash: true,    // Enable MD5 verification
});

// 2. Handle File Input
document.getElementById('fileInput').addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files.length) return;

  // 3. Create Uploader & Start
  const uploader = manager.createUploader(files[0], {
    uploadUrl: 'https://api.example.com/upload/chunk',
    mergeUrl: 'https://api.example.com/upload/merge',
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

// 5. Automatic Recovery (On Page Load)
window.addEventListener('load', async () => {
    const sessions = await manager.getRecoverableSessions();
    // Sessions with saved File objects are auto-restored inside manager if logic exists,
    // or you can manually restore them:
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
  // ... other config
  plugins: [
    SyncRecordPlugin
  ]
});
```

---

## Architecture details

### Storage Strategy ("Use and Delete")
- **Primary**: `IndexedDB` (Async, handles blobs/files).
- **Fallback**: `LocalStorage` (Sync, string-only, size limits). Used automatically if IndexedDB is blocked (e.g. Incognito mode).
- **Cleanup**: Checkpoints are **automatically deleted** after the upload completes successfully (or is cancelled), ensuring no stale data remains.

### Performance V1.5
- **Web Worker**: Hash calculation happens in a separate thread. If the browser doesn't support Workers, it gracefully falls back to the main thread.
- **Adaptive Chunking**: The SDK measures upload speed.
    - Slow network -> Smaller chunks (min 256KB) -> More reliable.
    - Fast network -> Larger chunks (max 50MB) -> Less overhead.

---

## API Reference

### `TransferManager`
- `createUploader(file, config)`: Creates a new upload task.
- `getRecoverableSessions()`: Returns a list of interrupted sessions.

### `Uploader`
- `start()`: Begin upload (Hash -> Upload -> Merge).
- `pause()`: Pause upload (aborts current request, saves state).
- `resume()`: Resume upload (reloads state, verifies hash/chunks).
- `cancel()`: Cancel upload and clear checkpoint.
- `on(event, callback)`: Subscribe to events (`progress`, `statusChange`, `completed`, `error`).
