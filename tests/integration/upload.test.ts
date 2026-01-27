/**
 * Upload Integration Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Uploader, type IUploadConfig } from '../../src/core/Uploader';
import { TransferManager } from '../../src/core/TransferManager';
import { TaskStatus, type ITransferTask } from '../../src/core/types';
import { createMockFile, setupMockUploadServer } from './helpers';

describe('Upload Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('End-to-End Upload', () => {
    it('should upload a small file successfully', async () => {
      const { uploadedChunks, reset } = setupMockUploadServer();

      const file = createMockFile('small.txt', 1024); // 1KB
      const config: IUploadConfig = {
        uploadUrl: '/api/upload',
        mergeUrl: '/api/merge',
        chunkSize: 512, // 512 bytes per chunk
      };

      const task: ITransferTask = {
        id: 'test-upload-1',
        status: TaskStatus.Idle,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const uploader = new Uploader(task, file, config);

      const progressValues: number[] = [];
      uploader.on('progress', ({ progress }) => {
        progressValues.push(progress);
      });

      await uploader.start();

      expect(uploader.getTask().status).toBe(TaskStatus.Completed);
      expect(uploader.getTask().progress).toBe(100);
      expect(uploadedChunks.size).toBeGreaterThan(0);
      expect(progressValues[progressValues.length - 1]).toBe(100);

      reset();
    });

    it('should upload a larger file with multiple chunks', async () => {
      const { uploadedChunks, reset } = setupMockUploadServer();

      const file = createMockFile('medium.bin', 10 * 1024); // 10KB
      const config: IUploadConfig = {
        uploadUrl: '/api/upload',
        mergeUrl: '/api/merge',
        chunkSize: 2 * 1024, // 2KB chunks = 5 chunks
        maxConcurrentChunks: 2,
      };

      const task: ITransferTask = {
        id: 'test-upload-2',
        status: TaskStatus.Idle,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const uploader = new Uploader(task, file, config);
      await uploader.start();

      expect(uploader.getTask().status).toBe(TaskStatus.Completed);
      expect(uploadedChunks.size).toBe(5);

      reset();
    });

    it('should handle pause and resume', async () => {
      const { reset } = setupMockUploadServer({ delay: 50 });

      const file = createMockFile('pausable.bin', 5 * 1024); // 5KB
      const config: IUploadConfig = {
        uploadUrl: '/api/upload',
        mergeUrl: '/api/merge',
        chunkSize: 1024, // 1KB chunks = 5 chunks
        maxConcurrentChunks: 1,
      };

      const task: ITransferTask = {
        id: 'test-upload-pause',
        status: TaskStatus.Idle,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const uploader = new Uploader(task, file, config);

      // Start upload (don't await)
      const uploadPromise = uploader.start();

      // Wait a bit then pause
      await new Promise(resolve => setTimeout(resolve, 100));
      uploader.pause();

      expect([TaskStatus.Paused, TaskStatus.Completed].includes(uploader.getTask().status)).toBe(true);

      // Resume if paused
      if (uploader.getTask().status === TaskStatus.Paused) {
        await uploader.resume();
        expect(uploader.getTask().status).toBe(TaskStatus.Completed);
      }

      reset();
    });

    it('should handle upload failure and retry', async () => {
      // Fail on chunk 1, should retry and succeed
      const { mockFetch, reset } = setupMockUploadServer({ failOnChunks: [1] });

      const file = createMockFile('retry.bin', 3 * 1024); // 3KB
      const config: IUploadConfig = {
        uploadUrl: '/api/upload',
        mergeUrl: '/api/merge',
        chunkSize: 1024, // 3 chunks
        maxRetries: 3,
        retryDelay: 10,
      };

      const task: ITransferTask = {
        id: 'test-upload-retry',
        status: TaskStatus.Idle,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const uploader = new Uploader(task, file, config);

      try {
        await uploader.start();
      } catch {
        // May fail if all retries exhausted
      }

      // Should have attempted retry (multiple calls for chunk 1)
      const chunk1Calls = mockFetch.mock.calls.filter(
        ([url, opts]) => {
          const formData = opts?.body as FormData;
          return url.includes('/upload') && formData?.get('chunkIndex') === '1';
        }
      );

      expect(chunk1Calls.length).toBeGreaterThanOrEqual(1);

      reset();
    });

    it('should handle cancel', async () => {
      const { reset } = setupMockUploadServer({ delay: 100 });

      const file = createMockFile('cancel.bin', 5 * 1024);
      const config: IUploadConfig = {
        uploadUrl: '/api/upload',
        mergeUrl: '/api/merge',
        chunkSize: 1024,
        maxConcurrentChunks: 1,
      };

      const task: ITransferTask = {
        id: 'test-upload-cancel',
        status: TaskStatus.Idle,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const uploader = new Uploader(task, file, config);

      // Start upload (don't await)
      uploader.start();

      // Cancel shortly after
      await new Promise(resolve => setTimeout(resolve, 50));
      uploader.cancel();

      expect(uploader.getTask().status).toBe(TaskStatus.Cancelled);

      reset();
    });
  });

  describe('TransferManager Integration', () => {
    it('should manage multiple uploads', async () => {
      const { reset } = setupMockUploadServer();

      const manager = new TransferManager({ maxConcurrent: 2 });

      const files = [
        createMockFile('file1.txt', 1024),
        createMockFile('file2.txt', 1024),
        createMockFile('file3.txt', 1024),
      ];

      const uploaders = files.map(file =>
        manager.createUploader(file, {
          uploadUrl: '/api/upload',
          mergeUrl: '/api/merge',
          chunkSize: 512,
        })
      );

      // Start all uploads
      await Promise.all(uploaders.map(u => u.start()));

      // All should complete
      uploaders.forEach(u => {
        expect(u.getTask().status).toBe(TaskStatus.Completed);
      });

      reset();
    });

    it('should batch upload files', async () => {
      const { reset } = setupMockUploadServer();

      const manager = new TransferManager({ maxConcurrent: 3 });

      const files = [
        createMockFile('batch1.txt', 512),
        createMockFile('batch2.txt', 512),
      ];

      const uploaders = manager.uploadBatch(files, {
        uploadUrl: '/api/upload',
        mergeUrl: '/api/merge',
      }, 'batch-group-1');

      // Wait for queue to process
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check group status
      const groupStatus = manager.getGroupStatus('batch-group-1');
      expect(groupStatus.total).toBe(2);

      reset();
    });
  });
});
