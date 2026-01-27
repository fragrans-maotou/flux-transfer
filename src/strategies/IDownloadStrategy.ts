/**
 * Download Strategy Interface
 * Defines the contract for different download strategies
 */

/**
 * Download progress information
 */
export interface IDownloadProgress {
  /** Downloaded bytes */
  loaded: number;
  /** Total bytes (0 if unknown) */
  total: number;
  /** Progress percentage (0-100) */
  percent: number;
}

/**
 * Download configuration for strategies
 */
export interface IDownloadStrategyConfig {
  /** Download URL */
  url: string;
  /** File name for saving */
  fileName: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Progress callback */
  onProgress?: (progress: IDownloadProgress) => void;
  /** Resume from byte offset (for Range requests) */
  resumeFrom?: number;
}

/**
 * Download strategy result
 */
export interface IDownloadResult {
  /** Whether download was successful */
  success: boolean;
  /** Downloaded blob (if applicable) */
  blob?: Blob;
  /** Error message (if failed) */
  error?: string;
  /** Total bytes downloaded */
  bytesDownloaded: number;
}

/**
 * Download Strategy Interface
 * All download strategies must implement this interface
 */
export interface IDownloadStrategy {
  /** Strategy name for identification */
  readonly name: string;

  /**
   * Check if this strategy is available in the current environment
   * @returns true if the strategy can be used
   */
  canUse(): boolean;

  /**
   * Execute the download
   * @param config Download configuration
   * @returns Promise that resolves when download completes
   */
  download(config: IDownloadStrategyConfig): Promise<IDownloadResult>;

  /**
   * Abort the current download
   */
  abort(): void;
}

/**
 * Strategy type enumeration
 */
export type DownloadStrategyType = 'auto' | 'fetch-blob' | 'stream-saver' | 'direct-link';
