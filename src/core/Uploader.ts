/**
 * Uploader - File upload with chunking and resume support
 */

import { BaseTransfer } from './BaseTransfer';
import { ChunkManager } from './uploader/ChunkManager';
import { TaskStatus, ErrorCode, type ITransferTask, type ISDKConfig } from './types';

/**
 * Upload configuration interface
 */
export interface IUploadConfig extends ISDKConfig {
  /** Upload URL */
  uploadUrl?: string;
  /** Merge chunks URL */
  mergeUrl?: string;
  /** Check file exists URL */
  checkUrl?: string;
  /** Max concurrent chunk uploads */
  maxConcurrentChunks?: number;
}

/**
 * Uploader class for file uploads
 */
export class Uploader extends BaseTransfer {
  private file: File;
  private uploadConfig: IUploadConfig;
  private chunkManager?: ChunkManager;
  private uploadingChunks: Set<number> = new Set();

  constructor(task: ITransferTask, file: File, config: IUploadConfig) {
    super(task, config);
    this.file = file;
    this.uploadConfig = config;
  }

  /**
   * Start upload
   */
  async start(): Promise<void> {
    try {
      this.initializeTransfer();
      this.setStatus(TaskStatus.Processing);

      // Load checkpoint if available
      const checkpoint = await this.loadCheckpoint();

      // Initialize chunk manager
      this.chunkManager = new ChunkManager(this.file, this.config.chunkSize || 5 * 1024 * 1024);

      // Restore from checkpoint
      if (checkpoint?.completedChunks) {
        this.chunkManager.restoreFromCheckpoint(checkpoint.completedChunks);
      }

      // Check instant upload (if configured)
      if (this.uploadConfig.checkUrl && this.config.enableHash) {
        this.setStatus(TaskStatus.Processing);
        // In production, calculate hash and check server
        // For now, skip to uploading
      }

      // Start uploading
      this.setStatus(TaskStatus.Transferring);
      await this.uploadChunks();

      // Merge chunks
      if (this.uploadConfig.mergeUrl) {
        await this.mergeChunks();
      }

      this.setStatus(TaskStatus.Completed);
      await this.deleteCheckpoint();
    } catch (error) {
      const transferError = this.createTransferError(
        ErrorCode.ChunkUploadFailed,
        error instanceof Error ? error.message : 'Upload failed',
        error instanceof Error ? error : undefined,
      );
      this.setError(transferError);
    }
  }

  /**
   * Pause upload
   */
  pause(): void {
    if (this.task.status === TaskStatus.Transferring) {
      this.setStatus(TaskStatus.Paused);
      // Network adapter will handle aborting requests
    }
  }

  /**
   * Resume upload
   */
  async resume(): Promise<void> {
    if (this.task.status === TaskStatus.Paused) {
      this.setStatus(TaskStatus.Transferring);
      await this.uploadChunks();

      if (this.chunkManager?.isComplete() && this.uploadConfig.mergeUrl) {
        await this.mergeChunks();
      }

      if (this.chunkManager?.isComplete()) {
        this.setStatus(TaskStatus.Completed);
        await this.deleteCheckpoint();
      }
    }
  }

  /**
   * Cancel upload
   */
  cancel(): void {
    this.setStatus(TaskStatus.Cancelled);
    if (this.config.networkAdapter) {
      this.config.networkAdapter.abort();
    }
  }

  /**
   * Upload chunks
   */
  private async uploadChunks(): Promise<void> {
    if (!this.chunkManager) {
      throw new Error('ChunkManager not initialized');
    }

    const maxConcurrent = this.uploadConfig.maxConcurrentChunks || 3;

    while (!this.chunkManager.isComplete() && this.task.status === TaskStatus.Transferring) {
      const batch = this.chunkManager.getNextBatch(maxConcurrent - this.uploadingChunks.size);

      if (batch.length === 0) {
        // Wait for ongoing uploads to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // Upload batch concurrently
      const uploadPromises = batch.map((chunk) => this.uploadChunk(chunk.index));
      await Promise.allSettled(uploadPromises);

      // Update progress
      const uploadedBytes = this.chunkManager.getUploadedBytes();
      this.updateProgress(uploadedBytes, this.file.size);

      // Save checkpoint
      if (this.config.enableCheckpoint) {
        await this.saveCheckpoint();
      }
    }
  }

  /**
   * Upload single chunk
   */
  private async uploadChunk(index: number): Promise<void> {
    if (!this.chunkManager) return;

    this.chunkManager.markChunkUploading(index);
    this.uploadingChunks.add(index);

    try {
      const chunk = this.chunkManager.getChunk(index);
      if (!chunk) return;

      const uploadUrl = this.uploadConfig.uploadUrl || '/api/upload/chunk';

      // Create form data
      const formData = new FormData();
      formData.append('file', chunk.blob, this.file.name);
      formData.append('chunkIndex', index.toString());
      formData.append('totalChunks', this.chunkManager.getTotalChunks().toString());
      formData.append('fileName', this.file.name);
      formData.append('taskId', this.task.id);

      // Upload with retry
      await this.executeWithRetry(async () => {
        if (!this.config.networkAdapter) {
          throw new Error('Network adapter not configured');
        }

        await this.config.networkAdapter.request({
          url: uploadUrl,
          method: 'POST',
          body: formData,
          timeout: this.config.timeout,
        });
      }, ErrorCode.ChunkUploadFailed);

      this.chunkManager.markChunkComplete(index);
    } catch (error) {
      this.chunkManager?.markChunkFailed(index);
      throw error;
    } finally {
      this.uploadingChunks.delete(index);
    }
  }

  /**
   * Merge chunks on server
   */
  private async mergeChunks(): Promise<void> {
    if (!this.uploadConfig.mergeUrl || !this.config.networkAdapter) {
      return;
    }

    await this.executeWithRetry(async () => {
      if (!this.config.networkAdapter) throw new Error('Network adapter not configured');

      await this.config.networkAdapter.request({
        url: this.uploadConfig.mergeUrl!,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: this.task.id,
          fileName: this.file.name,
          totalChunks: this.chunkManager!.getTotalChunks(),
        }),
        timeout: this.config.timeout,
      });
    }, ErrorCode.ChunkMergeFailed);
  }

  /**
   * Save checkpoint override
   */
  protected async saveCheckpoint(): Promise<void> {
    if (!this.storageAdapter || !this.config.enableCheckpoint || !this.chunkManager) {
      return;
    }

    const checkpoint = {
      taskId: this.task.id,
      transferredBytes: this.chunkManager.getUploadedBytes(),
      completedChunks: this.chunkManager.getCompletedIndices(),
      timestamp: Date.now(),
    };

    const key = `checkpoint_${this.task.id}`;
    await this.storageAdapter.set(key, checkpoint);
  }
}
