/**
 * Downloader - 文件下载，支持断点续传和多策略
 */

import { BaseTransfer } from './BaseTransfer';
import {
  TaskStatus,
  ErrorCode,
  TransferType,
  type ITransferTask,
  type ISDKConfig,
  type ITransferCheckpoint,
} from './types';
import {
  DownloadStrategyFactory,
  type IDownloadStrategy,
  type DownloadStrategyType,
  type IDownloadProgress,
} from '../strategies';

/**
 * Download configuration interface
 */
export interface IDownloadConfig extends ISDKConfig {
  /** Download URL */
  downloadUrl: string;
  /** File name for saving */
  fileName?: string;
  /** Expected file size (for progress calculation) */
  fileSize?: number;
  /** Download strategy */
  strategy?: DownloadStrategyType;
  /** Enable resume support via Range header */
  enableResume?: boolean;
}

/**
 * Download checkpoint for resume support
 */
export interface IDownloadCheckpoint extends ITransferCheckpoint {
  /** Downloaded bytes so far */
  downloadedBytes: number;
  /** Download URL */
  downloadUrl: string;
  /** File name */
  fileName: string;
  /** Expected file size */
  expectedSize?: number;
}

/**
 * Downloader class for file downloads
 */
export class Downloader extends BaseTransfer {
  private downloadConfig: IDownloadConfig;
  private strategy: IDownloadStrategy;
  private abortController: AbortController | null = null;
  private downloadedBytes: number = 0;

  constructor(task: ITransferTask, config: IDownloadConfig) {
    super(task, config);
    this.downloadConfig = config;
    this.task.transferType = TransferType.Download;

    // Select download strategy
    this.strategy = DownloadStrategyFactory.getStrategy(config.strategy || 'auto');

    // Set file name from config or extract from URL
    if (config.fileName) {
      this.task.fileName = config.fileName;
    } else if (!this.task.fileName) {
      this.task.fileName = this.extractFileName(config.downloadUrl);
    }

    // Set file size if known
    if (config.fileSize) {
      this.task.fileSize = config.fileSize;
    }
  }

  /**
   * Start download
   */
  async start(): Promise<void> {
    if (this.task.status !== TaskStatus.Idle && this.task.status !== TaskStatus.Failed) {
      return;
    }

    try {
      this.abortController = new AbortController();
      this.initializeTransfer();

      this.setStatus(TaskStatus.Processing);

      // Load checkpoint if available
      const checkpoint = await this.loadCheckpoint();
      if (checkpoint && this.downloadConfig.enableResume) {
        this.downloadedBytes = (checkpoint as IDownloadCheckpoint).downloadedBytes || 0;
        this.lastTransferredBytes = this.downloadedBytes;
      }

      this.setStatus(TaskStatus.Transferring);

      // Execute download with selected strategy
      const result = await this.strategy.download({
        url: this.downloadConfig.downloadUrl,
        fileName: this.task.fileName,
        headers: this.config.headers,
        timeout: this.config.timeout,
        signal: this.abortController.signal,
        resumeFrom: this.downloadConfig.enableResume ? this.downloadedBytes : undefined,
        onProgress: (progress: IDownloadProgress) => this.handleProgress(progress),
      });

      // Check result
      if (!result.success) {
        if (result.error === 'Download aborted') {
          // User cancelled or paused
          return;
        }
        throw new Error(result.error || 'Download failed');
      }

      // Download completed
      this.downloadedBytes = result.bytesDownloaded;
      this.updateProgress(
        this.downloadedBytes,
        this.task.fileSize || this.downloadedBytes,
      );

      this.setStatus(TaskStatus.Completed);
      await this.deleteCheckpoint();
    } catch (error) {
      const transferError = this.createTransferError(
        ErrorCode.Unknown,
        error instanceof Error ? error.message : 'Download failed',
        error instanceof Error ? error : undefined,
      );
      this.setError(transferError);
    }
  }

  /**
   * Pause download
   */
  pause(): void {
    if (this.task.status === TaskStatus.Transferring) {
      this.setStatus(TaskStatus.Paused);
      this.strategy.abort();
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      // Save checkpoint for resume
      this.saveCheckpoint().catch((error) => {
        console.error('Failed to save download checkpoint:', error);
      });
    }
  }

  /**
   * Resume download
   */
  async resume(): Promise<void> {
    if (this.task.status === TaskStatus.Paused || this.task.status === TaskStatus.Failed) {
      // Check if strategy supports resume
      if (!this.downloadConfig.enableResume) {
        // Cannot resume, restart from beginning
        this.downloadedBytes = 0;
      }

      // Restart download
      this.task.status = TaskStatus.Idle; // Reset to allow start()
      await this.start();
    }
  }

  /**
   * Cancel download
   */
  cancel(): void {
    this.setStatus(TaskStatus.Cancelled);
    this.strategy.abort();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // Clean up checkpoint
    this.deleteCheckpoint().catch((error) => {
      console.error('Failed to delete download checkpoint:', error);
    });
  }

  /**
   * Handle progress updates from strategy
   */
  private handleProgress(progress: IDownloadProgress): void {
    this.downloadedBytes = progress.loaded;

    // Update file size if not known
    if (progress.total > 0 && !this.task.fileSize) {
      this.task.fileSize = progress.total;
    }

    this.updateProgress(progress.loaded, progress.total || this.task.fileSize || progress.loaded);
  }

  /**
   * Extract file name from URL
   */
  private extractFileName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/');
      const lastSegment = segments[segments.length - 1];

      if (lastSegment && lastSegment.includes('.')) {
        return decodeURIComponent(lastSegment);
      }
    } catch {
      // Invalid URL, try simple extraction
      const match = url.match(/\/([^/?#]+)(?:[?#]|$)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }

    return 'download';
  }

  /**
   * Save download checkpoint
   */
  protected async saveCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return;
    }

    const checkpoint: IDownloadCheckpoint = {
      taskId: this.task.id,
      downloadedBytes: this.downloadedBytes,
      transferredBytes: this.downloadedBytes,
      downloadUrl: this.downloadConfig.downloadUrl,
      fileName: this.task.fileName,
      expectedSize: this.task.fileSize,
      timestamp: Date.now(),
    };

    const key = `download_checkpoint_${this.task.id}`;
    await this.storageAdapter.set(key, checkpoint);
  }

  /**
   * Load download checkpoint
   */
  protected async loadCheckpoint(): Promise<IDownloadCheckpoint | null> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return null;
    }

    const key = `download_checkpoint_${this.task.id}`;
    return await this.storageAdapter.get<IDownloadCheckpoint>(key);
  }

  /**
   * Delete download checkpoint
   */
  protected async deleteCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return;
    }

    const key = `download_checkpoint_${this.task.id}`;
    await this.storageAdapter.remove(key);
  }

  /**
   * Get current download strategy name
   */
  getStrategyName(): string {
    return this.strategy.name;
  }

  /**
   * Get downloaded bytes
   */
  getDownloadedBytes(): number {
    return this.downloadedBytes;
  }
}
