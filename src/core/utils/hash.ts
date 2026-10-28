import SparkMD5 from 'spark-md5';
import { SPARK_MD5_MIN } from './spark-md5.min';

export async function computeFileHash(
  file: File,
  chunkSize: number,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<string> {
  if (canUseWorker()) {
    try {
      return await computeFileHashInWorker(file, chunkSize, signal, onProgress);
    } catch (error) {
      if (isAbort(error)) throw error;
      // Worker unavailable or failed — fall back to the main-thread path.
    }
  }
  return computeFileHashMainThread(file, chunkSize, signal, onProgress);
}

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
}

async function computeFileHashInWorker(
  file: File,
  chunkSize: number,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<string> {
  throwIfAborted(signal);

  const worker = createHashWorker();
  const workerUrl = (worker as Worker & { __url?: string }).__url;

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      worker.postMessage({ type: 'abort' });
      settle(() => reject(new DOMException('The operation was aborted', 'AbortError')));
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'progress'; progress: number }
        | { type: 'done'; hash: string }
        | { type: 'error'; message: string };

      if (data.type === 'progress') {
        onProgress?.(data.progress);
        return;
      }
      if (data.type === 'done') {
        settle(() => resolve(data.hash));
        return;
      }
      if (data.message === 'The operation was aborted') {
        settle(() => reject(new DOMException('The operation was aborted', 'AbortError')));
        return;
      }
      settle(() => reject(new Error(data.message || 'Hash worker failed')));
    };

    const onError = () => {
      settle(() => reject(new Error('Hash worker failed')));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
      return;
    }

    worker.postMessage({ type: 'start', file, chunkSize });
  });
}

function createHashWorker(): Worker {
  const source = `${SPARK_MD5_MIN}
(${hashWorkerBootstrap.toString()})();`;
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  (worker as Worker & { __url?: string }).__url = url;
  return worker;
}

/** Runs inside the Worker blob; closed over nothing from the module scope. */
/* v8 ignore start -- executed only after toString() inside the Worker blob */
function hashWorkerBootstrap(): void {
  const ctx = self as unknown as Worker;

  ctx.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { type: 'start'; file: File; chunkSize: number }
      | { type: 'abort' };

    if (data.type === 'abort') {
      (ctx as unknown as { __aborted?: boolean }).__aborted = true;
      return;
    }
    if (data.type !== 'start') return;

    void (async () => {
      try {
        const Spark = (self as unknown as { SparkMD5: { ArrayBuffer: new () => {
          append(buffer: ArrayBuffer): void;
          end(): string;
        } } }).SparkMD5;
        const hash = new Spark.ArrayBuffer();
        const { file, chunkSize } = data;
        const chunkCount = Math.max(1, Math.ceil(file.size / chunkSize));

        for (let index = 0; index < chunkCount; index += 1) {
          if ((ctx as unknown as { __aborted?: boolean }).__aborted) {
            throw new DOMException('The operation was aborted', 'AbortError');
          }
          const start = index * chunkSize;
          const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
          const buffer = await readBlobInWorker(chunk);
          if ((ctx as unknown as { __aborted?: boolean }).__aborted) {
            throw new DOMException('The operation was aborted', 'AbortError');
          }
          hash.append(buffer);
          ctx.postMessage({
            type: 'progress',
            progress: Math.round(((index + 1) / chunkCount) * 100),
          });
        }

        ctx.postMessage({ type: 'done', hash: hash.end() });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Hash worker failed';
        const name = error instanceof DOMException ? error.name : '';
        ctx.postMessage({
          type: 'error',
          message: name === 'AbortError' ? 'The operation was aborted' : message,
        });
      }
    })();
  };

  function readBlobInWorker(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.onabort = () =>
        reject(new DOMException('The operation was aborted', 'AbortError'));
      reader.readAsArrayBuffer(blob);
    });
  }
}

/* v8 ignore stop */

async function computeFileHashMainThread(
  file: File,
  chunkSize: number,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const hash = new SparkMD5.ArrayBuffer();
  const chunkCount = Math.max(1, Math.ceil(file.size / chunkSize));

  for (let index = 0; index < chunkCount; index += 1) {
    throwIfAborted(signal);
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    const buffer = await readBlob(chunk, signal);
    throwIfAborted(signal);
    hash.append(buffer);
    onProgress?.(Math.round(((index + 1) / chunkCount) * 100));
    // Yield so long hashes do not monopolize the event loop when Workers are unavailable.
    if (index + 1 < chunkCount) await yieldMacrotask();
  }

  return hash.end();
}

function readBlob(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();

    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.onabort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    reader.readAsArrayBuffer(blob);
  });
}

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
