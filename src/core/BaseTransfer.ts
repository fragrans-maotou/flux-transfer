/**
 * Base Transfer Class
 * Provides common functionality for upload and download tasks
 */

import { EventEmitter } from '../infra/EventEmitter';
import type {
  TaskStatus,
  ITransferTask,
  ITransferError,
  ITransferCheckpoint,
  ISDKConfig,
  IStorageAdapter,
  ErrorCode,
} from './types';
import { TaskStatus as TaskStatusEnum } from './types';

/**
 * Abstract base class for file transfer operations
 */
export abstract class BaseTransfer extends EventEmitter {
  protected task: ITransferTask;
  protected config: ISDKConfig;
  protected storageAdapter?: IStorageAdapter;
  protected retryCount: number = 0;
  protected startTime: number = 0;
  protected lastProgressTime: number = 0;
  protected lastTransferredBytes: number = 0;

  constructor(task: ITransferTask, config: ISDKConfig) {
    super();
    this.task = task;
    this.config = config;
    this.storageAdapter = config.storageAdapter;
  }

  /**
   * Start the transfer
   */
  abstract start(): Promise<void>;

  /**
   * Pause the transfer
   */
  abstract pause(): void;

  /**
   * Resume the transfer
   */
  abstract resume(): Promise<void>;

  /**
   * Cancel the transfer
   */
  abstract cancel(): void;

  /**
   * Get current task state
   */
  getTask(): Readonly<ITransferTask> {
    return { ...this.task };
  }

  /**
   * Update task status and trigger events
   */
  protected setStatus(status: TaskStatus): void {
    if (this.task.status === status) {
      return;
    }

    const oldStatus = this.task.status;
    this.task.status = status;
    this.task.updatedAt = Date.now();

    // Emit status change event
    this.emit('statusChange', {
      taskId: this.task.id,
      oldStatus,
      newStatus: status,
      timestamp: this.task.updatedAt,
    });

    // Emit specific status events
    if (status === TaskStatusEnum.Completed) {
      this.emit('completed', this.task);
    } else if (status === TaskStatusEnum.Failed) {
      this.emit('error', this.task.error);
    } else if (status === TaskStatusEnum.Paused) {
      this.emit('paused', this.task);
    } else if (status === TaskStatusEnum.Cancelled) {
      this.emit('cancelled', this.task);
    } else if (status === TaskStatusEnum.Transferring) {
      this.emit('resumed', this.task);
    }

    // Auto-save checkpoint on status change
    if (this.config.enableCheckpoint && this.storageAdapter) {
      this.saveCheckpoint().catch((error) => {
        console.error('Failed to save checkpoint:', error);
      });
    }
  }

  /**
   * Set error and update task status
   */
  protected setError(error: ITransferError): void {
    this.task.error = error;
    this.setStatus(TaskStatusEnum.Failed);
  }

  /**
   * Update transfer progress
   */
  protected updateProgress(transferredBytes: number, totalBytes: number): void {
    const now = Date.now();

    // Calculate progress percentage
    this.task.progress = totalBytes > 0 ? Math.round((transferredBytes / totalBytes) * 100) : 0;

    // Calculate transfer speed (bytes per second)
    const timeDelta = now - this.lastProgressTime;
    if (timeDelta > 0) {
      const bytesDelta = transferredBytes - this.lastTransferredBytes;
      this.task.speed = Math.round((bytesDelta / timeDelta) * 1000); // Convert to bytes/s

      // Calculate remaining time
      const remainingBytes = totalBytes - transferredBytes;
      this.task.remainingTime =
        this.task.speed > 0 ? Math.round(remainingBytes / this.task.speed) : 0;
    }

    this.lastProgressTime = now;
    this.lastTransferredBytes = transferredBytes;
    this.task.updatedAt = now;

    // Emit progress event (throttled to avoid excessive updates)
    if (timeDelta > 100 || this.task.progress === 100) {
      this.emit('progress', {
        taskId: this.task.id,
        progress: this.task.progress,
        speed: this.task.speed,
        remainingTime: this.task.remainingTime,
        transferredBytes,
        totalBytes,
      });
    }
  }

  /**
   * Execute operation with exponential backoff retry
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    errorCode: ErrorCode,
  ): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelay ?? 1000;

    while (this.retryCount <= maxRetries) {
      try {
        const result = await operation();
        this.retryCount = 0; // Reset on success
        return result;
      } catch (error) {
        this.retryCount++;

        if (this.retryCount > maxRetries || !this.config.autoRetry) {
          // Max retries exceeded, throw error
          throw this.createTransferError(
            errorCode,
            error instanceof Error ? error.message : 'Unknown error',
            error instanceof Error ? error : undefined,
            false,
          );
        }

        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, this.retryCount - 1);
        await this.sleep(delay);
      }
    }

    throw this.createTransferError(errorCode, 'Max retries exceeded', undefined, false);
  }

  /**
   * Create transfer error object
   */
  protected createTransferError(
    code: ErrorCode,
    message: string,
    originalError?: Error,
    retryable: boolean = true,
  ): ITransferError {
    return {
      code,
      message,
      originalError,
      timestamp: Date.now(),
      retryable,
    };
  }

  /**
   * Save checkpoint for resume capability
   */
  protected async saveCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return;
    }

    const checkpoint: ITransferCheckpoint = {
      taskId: this.task.id,
      transferredBytes: this.lastTransferredBytes,
      timestamp: Date.now(),
      ...(this.task.checkpoint || {}),
    };

    const key = `checkpoint_${this.task.id}`;
    await this.storageAdapter.set(key, checkpoint);
  }

  /**
   * Load checkpoint from storage
   */
  protected async loadCheckpoint(): Promise<ITransferCheckpoint | null> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return null;
    }

    const key = `checkpoint_${this.task.id}`;
    return await this.storageAdapter.get<ITransferCheckpoint>(key);
  }

  /**
   * Delete checkpoint from storage
   */
  protected async deleteCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint) {
      return;
    }

    const key = `checkpoint_${this.task.id}`;
    await this.storageAdapter.remove(key);
  }

  /**
   * Sleep utility for retry delay
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if task is in a terminal state
   */
  protected isTerminalState(): boolean {
    return [
      TaskStatusEnum.Completed,
      TaskStatusEnum.Failed,
      TaskStatusEnum.Cancelled,
    ].includes(this.task.status as TaskStatusEnum);
  }

  /**
   * Initialize transfer (called at start)
   */
  protected initializeTransfer(): void {
    this.startTime = Date.now();
    this.lastProgressTime = this.startTime;
    this.lastTransferredBytes = 0;
    this.retryCount = 0;
  }
}
