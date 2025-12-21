/**
 * Chunk Manager - File chunking and upload management
 */

/**
 * Chunk metadata interface
 */
export interface IChunk {
  /** Chunk index (0-based) */
  index: number;
  /** Start byte position */
  start: number;
  /** End byte position */
  end: number;
  /** Chunk size in bytes */
  size: number;
  /** Chunk blob */
  blob: Blob;
  /** Upload status */
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  /** Retry count */
  retryCount: number;
}

/**
 * ChunkManager handles file chunking and upload tracking
 */
export class ChunkManager {
  private chunks: IChunk[] = [];
  private file: File;
  private chunkSize: number;

  constructor(file: File, chunkSize: number = 5 * 1024 * 1024) {
    if (chunkSize < 1024) {
      throw new Error('Chunk size must be at least 1KB');
    }

    this.file = file;
    this.chunkSize = chunkSize;
    this.createChunks();
  }

  /**
   * Create chunks from file
   */
  private createChunks(): void {
    const totalChunks = Math.ceil(this.file.size / this.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.file.size);
      const blob = this.file.slice(start, end);

      this.chunks.push({
        index: i,
        start,
        end,
        size: end - start,
        blob,
        status: 'pending',
        retryCount: 0,
      });
    }
  }

  /**
   * Get all chunks
   */
  getChunks(): Readonly<IChunk>[] {
    return this.chunks.map((chunk) => ({ ...chunk }));
  }

  /**
   * Get chunk by index
   */
  getChunk(index: number): IChunk | undefined {
    return this.chunks[index] ? { ...this.chunks[index] } : undefined;
  }

  /**
   * Get total chunk count
   */
  getTotalChunks(): number {
    return this.chunks.length;
  }

  /**
   * Get pending chunks
   */
  getPendingChunks(): IChunk[] {
    return this.chunks
      .filter((chunk) => chunk.status === 'pending')
      .map((chunk) => ({ ...chunk }));
  }

  /**
   * Get failed chunks
   */
  getFailedChunks(): IChunk[] {
    return this.chunks
      .filter((chunk) => chunk.status === 'failed')
      .map((chunk) => ({ ...chunk }));
  }

  /**
   * Get completed chunks
   */
  getCompletedChunks(): IChunk[] {
    return this.chunks
      .filter((chunk) => chunk.status === 'completed')
      .map((chunk) => ({ ...chunk }));
  }

  /**
   * Get next batch of chunks for upload
   * @param concurrency Maximum number of chunks to return
   */
  getNextBatch(concurrency: number = 3): IChunk[] {
    const batch: IChunk[] = [];

    for (const chunk of this.chunks) {
      if (chunk.status === 'pending' && batch.length < concurrency) {
        batch.push({ ...chunk });
      }
      if (batch.length >= concurrency) {
        break;
      }
    }

    return batch;
  }

  /**
   * Mark chunk as uploading
   */
  markChunkUploading(index: number): void {
    if (this.chunks[index]) {
      this.chunks[index].status = 'uploading';
    }
  }

  /**
   * Mark chunk as completed
   */
  markChunkComplete(index: number): void {
    if (this.chunks[index]) {
      this.chunks[index].status = 'completed';
      this.chunks[index].retryCount = 0;
    }
  }

  /**
   * Mark chunk as failed
   */
  markChunkFailed(index: number): void {
    if (this.chunks[index]) {
      this.chunks[index].status = 'failed';
      this.chunks[index].retryCount++;
    }
  }

  /**
   * Retry failed chunk (reset to pending)
   */
  retryChunk(index: number): void {
    if (this.chunks[index] && this.chunks[index].status === 'failed') {
      this.chunks[index].status = 'pending';
    }
  }

  /**
   * Get upload progress (0-100)
   */
  getProgress(): number {
    if (this.chunks.length === 0) return 0;

    const completedCount = this.chunks.filter((c) => c.status === 'completed').length;
    return Math.round((completedCount / this.chunks.length) * 100);
  }

  /**
   * Get uploaded bytes
   */
  getUploadedBytes(): number {
    return this.chunks
      .filter((c) => c.status === 'completed')
      .reduce((sum, chunk) => sum + chunk.size, 0);
  }

  /**
   * Check if all chunks are completed
   */
  isComplete(): boolean {
    return this.chunks.every((chunk) => chunk.status === 'completed');
  }

  /**
   * Check if any chunk has failed
   */
  hasFailed(): boolean {
    return this.chunks.some((chunk) => chunk.status === 'failed');
  }

  /**
   * Reset all chunks to pending
   */
  reset(): void {
    this.chunks.forEach((chunk) => {
      chunk.status = 'pending';
      chunk.retryCount = 0;
    });
  }

  /**
   * Get chunk indices for checkpoint (completed chunks)
   */
  getCompletedIndices(): number[] {
    return this.chunks
      .filter((chunk) => chunk.status === 'completed')
      .map((chunk) => chunk.index);
  }

  /**
   * Restore from checkpoint (mark chunks as completed)
   */
  restoreFromCheckpoint(completedIndices: number[]): void {
    completedIndices.forEach((index) => {
      if (this.chunks[index]) {
        this.chunks[index].status = 'completed';
      }
    });
  }
}
