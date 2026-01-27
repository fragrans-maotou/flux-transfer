/**
 * Fetch + Blob Download Strategy
 * Uses Fetch API to download file and create a Blob for saving
 * Best for medium-sized files, widely supported
 */

import type {
  IDownloadStrategy,
  IDownloadStrategyConfig,
  IDownloadResult,
  IDownloadProgress,
} from './IDownloadStrategy';

/**
 * Fetch + Blob based download strategy
 */
export class FetchBlobStrategy implements IDownloadStrategy {
  readonly name = 'fetch-blob';
  private abortController: AbortController | null = null;

  /**
   * Check if Fetch API is available
   */
  canUse(): boolean {
    return typeof fetch !== 'undefined' && typeof Blob !== 'undefined';
  }

  /**
   * Execute download using Fetch API
   */
  async download(config: IDownloadStrategyConfig): Promise<IDownloadResult> {
    this.abortController = new AbortController();

    // Handle external abort signal
    if (config.signal) {
      if (config.signal.aborted) {
        this.abortController.abort();
      } else {
        config.signal.addEventListener('abort', () => this.abortController?.abort());
      }
    }

    try {
      const headers: Record<string, string> = { ...config.headers };

      // Add Range header for resume support
      if (config.resumeFrom && config.resumeFrom > 0) {
        headers['Range'] = `bytes=${config.resumeFrom}-`;
      }

      // Set timeout
      const timeout = config.timeout || 30000;
      const timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, timeout);

      // Execute fetch
      const response = await fetch(config.url, {
        method: 'GET',
        headers,
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 206) {
        return {
          success: false,
          error: `HTTP Error: ${response.status} ${response.statusText}`,
          bytesDownloaded: 0,
        };
      }

      // Get content length for progress
      const contentLength = Number(response.headers.get('content-length')) || 0;

      // Read response body with progress
      const blob = await this.readResponseWithProgress(
        response,
        contentLength,
        config.resumeFrom || 0,
        config.onProgress,
      );

      // Trigger browser download
      this.triggerDownload(blob, config.fileName);

      return {
        success: true,
        blob,
        bytesDownloaded: blob.size,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Download aborted',
            bytesDownloaded: 0,
          };
        }
        return {
          success: false,
          error: error.message,
          bytesDownloaded: 0,
        };
      }
      return {
        success: false,
        error: 'Unknown error',
        bytesDownloaded: 0,
      };
    }
  }

  /**
   * Abort current download
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Read response body with progress reporting
   */
  private async readResponseWithProgress(
    response: Response,
    contentLength: number,
    resumeOffset: number,
    onProgress?: (progress: IDownloadProgress) => void,
  ): Promise<Blob> {
    const chunks: ArrayBuffer[] = [];
    let loaded = 0;

    if (!response.body) {
      // Fallback for browsers without streaming support
      const arrayBuffer = await response.arrayBuffer();
      return new Blob([arrayBuffer]);
    }

    const reader = response.body.getReader();
    const total = contentLength + resumeOffset;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          // Convert Uint8Array to ArrayBuffer slice for Blob compatibility
          const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
          chunks.push(buffer);
          loaded += value.length;

          if (onProgress) {
            const currentLoaded = loaded + resumeOffset;
            onProgress({
              loaded: currentLoaded,
              total: total || currentLoaded,
              percent: total > 0 ? Math.round((currentLoaded / total) * 100) : 0,
            });
          }
        }
      }

      return new Blob(chunks);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Trigger browser download dialog
   */
  private triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Clean up
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }
}
