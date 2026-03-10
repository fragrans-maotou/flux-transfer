/**
 * Direct Link Download Strategy
 * Uses native browser download via <a download> element
 * Fallback strategy with maximum compatibility but no progress monitoring
 */

import type {
  IDownloadResult,
  IDownloadStrategy,
  IDownloadStrategyConfig,
} from './IDownloadStrategy';

/**
 * Direct link download strategy
 * Most compatible, but no progress monitoring or resume support
 */
export class DirectLinkStrategy implements IDownloadStrategy {
  readonly name = 'direct-link';
  private downloadLink: HTMLAnchorElement | null = null;

  /**
   * Check if DOM is available
   */
  canUse(): boolean {
    return typeof document !== 'undefined' && typeof HTMLAnchorElement !== 'undefined';
  }

  /**
   * Execute download using native link click
   */
  async download(config: IDownloadStrategyConfig): Promise<IDownloadResult> {
    return new Promise((resolve) => {
      try {
        // Check for abort before starting
        if (config.signal?.aborted) {
          resolve({
            success: false,
            error: 'Download aborted',
            bytesDownloaded: 0,
          });
          return;
        }

        // Create download link
        this.downloadLink = document.createElement('a');
        this.downloadLink.href = config.url;
        this.downloadLink.download = config.fileName;
        this.downloadLink.style.display = 'none';

        // Add query parameters for headers if needed (workaround for auth)
        // Note: This is a limitation - direct download cannot set custom headers

        document.body.appendChild(this.downloadLink);

        // Listen for abort
        if (config.signal) {
          config.signal.addEventListener('abort', () => {
            this.abort();
            resolve({
              success: false,
              error: 'Download aborted',
              bytesDownloaded: 0,
            });
          });
        }

        // Trigger download
        this.downloadLink.click();

        // Clean up after a short delay
        setTimeout(() => {
          if (this.downloadLink && this.downloadLink.parentNode) {
            document.body.removeChild(this.downloadLink);
          }
          this.downloadLink = null;

          // Note: We cannot know if download succeeded with direct link
          // We assume success if no abort signal was received
          resolve({
            success: true,
            bytesDownloaded: 0, // Cannot track with direct link
          });
        }, 1000);
      } catch (error) {
        resolve({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          bytesDownloaded: 0,
        });
      }
    });
  }

  /**
   * Abort current download (limited support)
   */
  abort(): void {
    if (this.downloadLink && this.downloadLink.parentNode) {
      document.body.removeChild(this.downloadLink);
    }
    this.downloadLink = null;
    // Note: Cannot actually abort a native download in progress
  }
}
