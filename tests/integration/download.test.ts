/**
 * Download Integration Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Downloader, type IDownloadConfig } from '../../src/core/Downloader';
import { TransferManager } from '../../src/core/TransferManager';
import { TaskStatus, type ITransferTask } from '../../src/core/types';
import { setupMockDownloadServer } from './helpers';

describe('Download Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock DOM elements for download trigger
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
    } as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({} as any));
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({} as any));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('End-to-End Download', () => {
    it('should download a file successfully', async () => {
      const content = new Uint8Array(1024);
      for (let i = 0; i < content.length; i++) {
        content[i] = i % 256;
      }

      const { reset } = setupMockDownloadServer(content);

      const task: ITransferTask = {
        id: 'test-download-1',
        status: TaskStatus.Idle,
        fileName: '',
        fileSize: 0,
        fileType: 'application/octet-stream',
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const config: IDownloadConfig = {
        downloadUrl: 'https://example.com/file.bin',
        fileName: 'downloaded.bin',
        strategy: 'fetch-blob',
      };

      const downloader = new Downloader(task, config);

      const progressValues: number[] = [];
      downloader.on('progress', ({ progress }) => {
        progressValues.push(progress);
      });

      await downloader.start();

      expect(downloader.getTask().status).toBe(TaskStatus.Completed);
      expect(downloader.getTask().progress).toBe(100);
      expect(downloader.getDownloadedBytes()).toBe(content.length);

      reset();
    });

    it('should handle download progress', async () => {
      const content = new Uint8Array(5 * 1024); // 5KB
      const { reset } = setupMockDownloadServer(content);

      const task: ITransferTask = {
        id: 'test-download-progress',
        status: TaskStatus.Idle,
        fileName: '',
        fileSize: 0,
        fileType: 'application/octet-stream',
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const config: IDownloadConfig = {
        downloadUrl: 'https://example.com/large.bin',
        fileName: 'large.bin',
        strategy: 'fetch-blob',
      };

      const downloader = new Downloader(task, config);

      let lastProgress = 0;
      downloader.on('progress', ({ progress }) => {
        expect(progress).toBeGreaterThanOrEqual(lastProgress);
        lastProgress = progress;
      });

      await downloader.start();

      expect(downloader.getTask().progress).toBe(100);

      reset();
    });

    it('should handle cancel during download', async () => {
      const content = new Uint8Array(10 * 1024); // 10KB

      // Slow down the mock to allow time to cancel
      const mockFetch = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

      const task: ITransferTask = {
        id: 'test-download-cancel',
        status: TaskStatus.Idle,
        fileName: '',
        fileSize: 0,
        fileType: 'application/octet-stream',
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const config: IDownloadConfig = {
        downloadUrl: 'https://example.com/cancel.bin',
        fileName: 'cancel.bin',
      };

      const downloader = new Downloader(task, config);

      // Start download (don't await)
      const downloadPromise = downloader.start();

      // Cancel shortly after
      await new Promise(resolve => setTimeout(resolve, 20));
      downloader.cancel();

      expect(downloader.getTask().status).toBe(TaskStatus.Cancelled);
    });

    it('should handle HTTP errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Not Found', { status: 404, statusText: 'Not Found' })
      );

      const task: ITransferTask = {
        id: 'test-download-error',
        status: TaskStatus.Idle,
        fileName: '',
        fileSize: 0,
        fileType: 'application/octet-stream',
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const config: IDownloadConfig = {
        downloadUrl: 'https://example.com/missing.bin',
        fileName: 'missing.bin',
      };

      const downloader = new Downloader(task, config);
      await downloader.start();

      expect(downloader.getTask().status).toBe(TaskStatus.Failed);
      expect(downloader.getTask().error).toBeDefined();
    });
  });

  describe('TransferManager Download Integration', () => {
    it('should create downloader via manager', async () => {
      const content = new Uint8Array(512);
      const { reset } = setupMockDownloadServer(content);

      const manager = new TransferManager({ maxConcurrent: 2 });

      const downloader = manager.createDownloader(
        'https://example.com/file.bin',
        { fileName: 'managed.bin', strategy: 'fetch-blob' }
      );

      await downloader.start();

      expect(downloader.getTask().status).toBe(TaskStatus.Completed);
      expect(downloader.getTask().fileName).toBe('managed.bin');

      reset();
    });

    it('should batch download multiple files', async () => {
      const content = new Uint8Array(256);
      const { reset } = setupMockDownloadServer(content);

      const manager = new TransferManager({ maxConcurrent: 3 });

      const urls = [
        'https://example.com/file1.bin',
        'https://example.com/file2.bin',
        'https://example.com/file3.bin',
      ];

      const downloaders = manager.downloadBatch(urls, {
        strategy: 'fetch-blob',
      }, 'download-batch-1');

      expect(downloaders.length).toBe(3);

      // Wait for queue to process
      await new Promise(resolve => setTimeout(resolve, 500));

      reset();
    });
  });

  describe('Direct Link Strategy', () => {
    it('should use direct link strategy', async () => {
      const task: ITransferTask = {
        id: 'test-direct-link',
        status: TaskStatus.Idle,
        fileName: '',
        fileSize: 0,
        fileType: 'application/octet-stream',
        progress: 0,
        speed: 0,
        remainingTime: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const config: IDownloadConfig = {
        downloadUrl: 'https://example.com/direct.bin',
        fileName: 'direct.bin',
        strategy: 'direct-link',
      };

      const downloader = new Downloader(task, config);
      expect(downloader.getStrategyName()).toBe('direct-link');

      await downloader.start();

      // Direct link should complete (triggers native download)
      expect(downloader.getTask().status).toBe(TaskStatus.Completed);
    });
  });
});
