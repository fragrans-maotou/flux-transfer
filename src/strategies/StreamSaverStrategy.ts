/**
 * StreamSaver Download Strategy
 * Uses Service Worker for streaming large file downloads to disk
 * without memory limitations
 */

import type {
  IDownloadStrategy,
  IDownloadStrategyConfig,
  IDownloadResult,
} from './IDownloadStrategy';

/**
 * Configuration for StreamSaver strategy
 */
export interface IStreamSaverConfig {
  /** Path to the Service Worker script (defaults to '/sw.js') */
  swPath?: string;
  /** Scope for the Service Worker (defaults to '/') */
  swScope?: string;
}

/**
 * MessageChannel port holder for SW communication
 */
interface StreamHandle {
  port: MessagePort;
  filename: string;
  size?: number;
}

/**
 * StreamSaver Strategy - streams downloads directly to disk via Service Worker
 * 
 * This strategy bypasses browser memory limits by using a Service Worker
 * as a MITM (man-in-the-middle) to intercept a synthetic request and
 * stream the response directly to a file download.
 */
export class StreamSaverStrategy implements IDownloadStrategy {
  readonly name = 'stream-saver';

  private config: IStreamSaverConfig;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private abortController: AbortController | null = null;
  private streamHandle: StreamHandle | null = null;

  constructor(config: IStreamSaverConfig = {}) {
    this.config = {
      swPath: config.swPath || '/flux-transfer-sw.js',
      swScope: config.swScope || '/',
    };
  }

  /**
   * Check if Service Worker and required APIs are available
   */
  canUse(): boolean {
    // Check for secure context (required for Service Worker)
    if (typeof window === 'undefined') return false;
    if (!window.isSecureContext) return false;

    // Check for Service Worker support
    if (!('serviceWorker' in navigator)) return false;

    // Check for TransformStream/WritableStream support
    if (typeof WritableStream === 'undefined') return false;
    if (typeof ReadableStream === 'undefined') return false;
    if (typeof MessageChannel === 'undefined') return false;

    return true;
  }

  /**
   * Execute streaming download
   */
  async download(config: IDownloadStrategyConfig): Promise<IDownloadResult> {
    if (!this.canUse()) {
      return {
        success: false,
        error: 'StreamSaver strategy not available in this environment',
        bytesDownloaded: 0,
      };
    }

    this.abortController = new AbortController();

    // Handle external abort signal
    if (config.signal) {
      if (config.signal.aborted) {
        return {
          success: false,
          error: 'Download aborted',
          bytesDownloaded: 0,
        };
      }
      config.signal.addEventListener('abort', () => this.abort());
    }

    let bytesDownloaded = 0;

    try {
      // Step 1: Register Service Worker if not already registered
      await this.ensureServiceWorker();

      // Step 2: Create a stream handle with the SW
      const streamHandle = await this.createStreamHandle(config.fileName);
      this.streamHandle = streamHandle;

      // Step 3: Fetch the file
      const headers: Record<string, string> = { ...config.headers };
      if (config.resumeFrom && config.resumeFrom > 0) {
        headers['Range'] = `bytes=${config.resumeFrom}-`;
        bytesDownloaded = config.resumeFrom;
      }

      const response = await fetch(config.url, {
        method: 'GET',
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok && response.status !== 206) {
        this.closeStream(true);
        return {
          success: false,
          error: `HTTP Error: ${response.status} ${response.statusText}`,
          bytesDownloaded: 0,
        };
      }

      if (!response.body) {
        this.closeStream(true);
        return {
          success: false,
          error: 'Response body is null',
          bytesDownloaded: 0,
        };
      }

      // Step 4: Pipe the response to the SW stream
      const contentLength = Number(response.headers.get('content-length')) || 0;
      const total = contentLength + (config.resumeFrom || 0);

      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          if (value) {
            // Write to SW stream via MessagePort
            this.writeToStream(value);
            bytesDownloaded += value.length;

            if (config.onProgress) {
              config.onProgress({
                loaded: bytesDownloaded,
                total: total || bytesDownloaded,
                percent: total > 0 ? Math.round((bytesDownloaded / total) * 100) : 0,
              });
            }
          }
        }

        // Close the stream successfully
        this.closeStream(false);

        return {
          success: true,
          bytesDownloaded,
        };
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      this.closeStream(true);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Download aborted',
            bytesDownloaded,
          };
        }
        return {
          success: false,
          error: error.message,
          bytesDownloaded,
        };
      }
      return {
        success: false,
        error: 'Unknown error',
        bytesDownloaded,
      };
    }
  }

  /**
   * Abort the current download
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.closeStream(true);
  }

  /**
   * Ensure Service Worker is registered and active
   */
  private async ensureServiceWorker(): Promise<void> {
    if (this.swRegistration?.active) {
      return;
    }

    // Check if already registered
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      if (reg.active?.scriptURL.includes('flux-transfer-sw')) {
        this.swRegistration = reg;
        return;
      }
    }

    // Register new Service Worker
    this.swRegistration = await navigator.serviceWorker.register(
      this.config.swPath!,
      { scope: this.config.swScope }
    );

    // Wait for activation
    if (this.swRegistration.installing || this.swRegistration.waiting) {
      await new Promise<void>((resolve) => {
        const sw = this.swRegistration!.installing || this.swRegistration!.waiting;
        sw?.addEventListener('statechange', function onStateChange() {
          if (sw.state === 'activated') {
            sw.removeEventListener('statechange', onStateChange);
            resolve();
          }
        });
      });
    }
  }

  /**
   * Create a stream handle with the Service Worker
   */
  private async createStreamHandle(filename: string): Promise<StreamHandle> {
    const channel = new MessageChannel();

    // Send the port to the SW
    const sw = this.swRegistration?.active || navigator.serviceWorker.controller;
    if (!sw) {
      throw new Error('No active Service Worker');
    }

    // Create a unique download ID
    const downloadId = `download-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Send message to SW to prepare for download
    sw.postMessage(
      {
        type: 'STREAM_DOWNLOAD_INIT',
        downloadId,
        filename,
      },
      [channel.port2]
    );

    return {
      port: channel.port1,
      filename,
    };
  }

  /**
   * Write data to the stream via MessagePort
   */
  private writeToStream(data: Uint8Array): void {
    if (this.streamHandle) {
      this.streamHandle.port.postMessage({ type: 'WRITE', data });
    }
  }

  /**
   * Close the stream
   */
  private closeStream(abort: boolean): void {
    if (this.streamHandle) {
      this.streamHandle.port.postMessage({ type: abort ? 'ABORT' : 'CLOSE' });
      this.streamHandle.port.close();
      this.streamHandle = null;
    }
  }

  /**
   * Unregister the Service Worker
   */
  async unregister(): Promise<boolean> {
    if (this.swRegistration) {
      return await this.swRegistration.unregister();
    }
    return false;
  }
}
