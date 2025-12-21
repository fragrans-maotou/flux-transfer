import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkManager } from '../../src/core/uploader/ChunkManager';

describe('ChunkManager', () => {
  let file: File;
  const MB = 1024 * 1024;

  beforeEach(() => {
    // Create a mock file (10MB)
    const buffer = new ArrayBuffer(10 * MB);
    file = new File([buffer], 'test.bin', { type: 'application/octet-stream' });
  });

  describe('Constructor', () => {
    it('should create chunks from file', () => {
      const manager = new ChunkManager(file, 5 * MB);
      expect(manager.getTotalChunks()).toBe(2); // 10MB / 5MB = 2 chunks
    });

    it('should throw error for invalid chunk size', () => {
      expect(() => new ChunkManager(file, 512)).toThrow('Chunk size must be at least 1KB');
    });

    it('should use default chunk size', () => {
      const manager = new ChunkManager(file); // Default 5MB
      expect(manager.getTotalChunks()).toBe(2);
    });

    it('should handle file size not divisible by chunk size', () => {
      const smallFile = new File([new ArrayBuffer(7 * MB)], 'small.bin');
      const manager = new ChunkManager(smallFile, 5 * MB);
      expect(manager.getTotalChunks()).toBe(2); // 7MB / 5MB = 1.4 → 2 chunks
    });
  });

  describe('getChunks()', () => {
    it('should return all chunks', () => {
      const manager = new ChunkManager(file, 5 * MB);
      const chunks = manager.getChunks();

      expect(chunks.length).toBe(2);
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].start).toBe(0);
      expect(chunks[0].end).toBe(5 * MB);
      expect(chunks[0].size).toBe(5 * MB);
      expect(chunks[0].status).toBe('pending');
    });

    it('should return immutable copies', () => {
      const manager = new ChunkManager(file, 5 * MB);
      const chunks = manager.getChunks();

      // Modify returned chunk
      chunks[0].status = 'completed';

      // Original should not be affected
      expect(manager.getChunk(0)?.status).toBe('pending');
    });
  });

  describe('getChunk()', () => {
    it('should return specific chunk', () => {
      const manager = new ChunkManager(file, 5 * MB);
      const chunk = manager.getChunk(1);

      expect(chunk).toBeDefined();
      expect(chunk?.index).toBe(1);
      expect(chunk?.start).toBe(5 * MB);
      expect(chunk?.end).toBe(10 * MB);
    });

    it('should return undefined for invalid index', () => {
      const manager = new ChunkManager(file, 5 * MB);
      expect(manager.getChunk(10)).toBeUndefined();
    });
  });

  describe('Chunk Status Management', () => {
    it('should mark chunk as uploading', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkUploading(0);

      expect(manager.getChunk(0)?.status).toBe('uploading');
    });

    it('should mark chunk as completed', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkComplete(0);

      expect(manager.getChunk(0)?.status).toBe('completed');
    });

    it('should mark chunk as failed', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkFailed(0);

      expect(manager.getChunk(0)?.status).toBe('failed');
      expect(manager.getChunk(0)?.retryCount).toBe(1);
    });

    it('should increment retry count on failure', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkFailed(0);
      manager.markChunkFailed(0);

      expect(manager.getChunk(0)?.retryCount).toBe(2);
    });

    it('should reset retry count on completion', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkFailed(0);
      manager.markChunkComplete(0);

      expect(manager.getChunk(0)?.retryCount).toBe(0);
    });
  });

  describe('getPendingChunks()', () => {
    it('should return only pending chunks', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkComplete(0);

      const pending = manager.getPendingChunks();
      expect(pending.length).toBe(1);
      expect(pending[0].index).toBe(1);
    });
  });

  describe('getFailedChunks()', () => {
    it('should return only failed chunks', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkFailed(0);

      const failed = manager.getFailedChunks();
      expect(failed.length).toBe(1);
      expect(failed[0].index).toBe(0);
    });
  });

  describe('getCompletedChunks()', () => {
    it('should return only completed chunks', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkComplete(0);
      manager.markChunkComplete(1);

      const completed = manager.getCompletedChunks();
      expect(completed.length).toBe(2);
    });
  });

  describe('getNextBatch()', () => {
    it('should return batch of pending chunks', () => {
      const manager = new ChunkManager(file, 2 * MB); // 5 chunks
      const batch = manager.getNextBatch(3);

      expect(batch.length).toBe(3);
      expect(batch[0].index).toBe(0);
      expect(batch[1].index).toBe(1);
      expect(batch[2].index).toBe(2);
    });

    it('should respect concurrency limit', () => {
      const manager = new ChunkManager(file, 5 * MB);
      const batch = manager.getNextBatch(1);

      expect(batch.length).toBe(1);
    });

    it('should skip non-pending chunks', () => {
      const manager = new ChunkManager(file, 2 * MB); // 5 chunks
      manager.markChunkComplete(0);
      manager.markChunkUploading(1);

      const batch = manager.getNextBatch(3);
      expect(batch.length).toBe(3);
      expect(batch[0].index).toBe(2);
    });
  });

  describe('Progress Tracking', () => {
    it('should calculate progress correctly', () => {
      const manager = new ChunkManager(file, 5 * MB); // 2 chunks
      expect(manager.getProgress()).toBe(0);

      manager.markChunkComplete(0);
      expect(manager.getProgress()).toBe(50);

      manager.markChunkComplete(1);
      expect(manager.getProgress()).toBe(100);
    });

    it('should calculate uploaded bytes', () => {
      const manager = new ChunkManager(file, 5 * MB);
      expect(manager.getUploadedBytes()).toBe(0);

      manager.markChunkComplete(0);
      expect(manager.getUploadedBytes()).toBe(5 * MB);

      manager.markChunkComplete(1);
      expect(manager.getUploadedBytes()).toBe(10 * MB);
    });
  });

  describe('Completion Status', () => {
    it('should detect when all chunks are completed', () => {
      const manager = new ChunkManager(file, 5 * MB);
      expect(manager.isComplete()).toBe(false);

      manager.markChunkComplete(0);
      expect(manager.isComplete()).toBe(false);

      manager.markChunkComplete(1);
      expect(manager.isComplete()).toBe(true);
    });

    it('should detect failed chunks', () => {
      const manager = new ChunkManager(file, 5 * MB);
      expect(manager.hasFailed()).toBe(false);

      manager.markChunkFailed(0);
      expect(manager.hasFailed()).toBe(true);
    });
  });

  describe('Retry Functionality', () => {
    it('should retry failed chunk', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkFailed(0);

      expect(manager.getChunk(0)?.status).toBe('failed');

      manager.retryChunk(0);
      expect(manager.getChunk(0)?.status).toBe('pending');
    });

    it('should not retry non-failed chunks', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkComplete(0);
      manager.retryChunk(0);

      expect(manager.getChunk(0)?.status).toBe('completed');
    });
  });

  describe('Reset', () => {
    it('should reset all chunks to pending', () => {
      const manager = new ChunkManager(file, 5 * MB);
      manager.markChunkComplete(0);
      manager.markChunkFailed(1);

      manager.reset();

      expect(manager.getChunk(0)?.status).toBe('pending');
      expect(manager.getChunk(1)?.status).toBe('pending');
      expect(manager.getChunk(0)?.retryCount).toBe(0);
      expect(manager.getChunk(1)?.retryCount).toBe(0);
    });
  });

  describe('Checkpoint Restore', () => {
    it('should get completed indices for checkpoint', () => {
      const manager = new ChunkManager(file, 2 * MB); // 5 chunks
      manager.markChunkComplete(0);
      manager.markChunkComplete(2);
      manager.markChunkComplete(4);

      const indices = manager.getCompletedIndices();
      expect(indices).toEqual([0, 2, 4]);
    });

    it('should restore from checkpoint', () => {
      const manager = new ChunkManager(file, 2 * MB); // 5 chunks
      manager.restoreFromCheckpoint([0, 1, 3]);

      expect(manager.getChunk(0)?.status).toBe('completed');
      expect(manager.getChunk(1)?.status).toBe('completed');
      expect(manager.getChunk(2)?.status).toBe('pending');
      expect(manager.getChunk(3)?.status).toBe('completed');
      expect(manager.getChunk(4)?.status).toBe('pending');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file', () => {
      const emptyFile = new File([], 'empty.txt');
      const manager = new ChunkManager(emptyFile, 5 * MB);

      expect(manager.getTotalChunks()).toBe(0);
      expect(manager.isComplete()).toBe(true);
      expect(manager.getProgress()).toBe(0);
    });

    it('should handle file smaller than chunk size', () => {
      const smallFile = new File([new ArrayBuffer(1 * MB)], 'small.bin');
      const manager = new ChunkManager(smallFile, 5 * MB);

      expect(manager.getTotalChunks()).toBe(1);
      expect(manager.getChunk(0)?.size).toBe(1 * MB);
    });

    it('should handle exact chunk size boundary', () => {
      const exactFile = new File([new ArrayBuffer(10 * MB)], 'exact.bin');
      const manager = new ChunkManager(exactFile, 5 * MB);

      expect(manager.getTotalChunks()).toBe(2);
      expect(manager.getChunk(0)?.size).toBe(5 * MB);
      expect(manager.getChunk(1)?.size).toBe(5 * MB);
    });
  });
});
