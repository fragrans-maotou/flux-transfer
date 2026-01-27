/**
 * Downloader Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Downloader, type IDownloadConfig } from '../../src/core/Downloader';
import { TaskStatus, type ITransferTask } from '../../src/core/types';

describe('Downloader', () => {
  let mockTask: ITransferTask;
  let mockConfig: IDownloadConfig;

  beforeEach(() => {
    mockTask = {
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

    mockConfig = {
      downloadUrl: 'https://example.com/file.txt',
      fileName: 'file.txt',
      enableCheckpoint: false,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create downloader with config', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      const task = downloader.getTask();

      expect(task.id).toBe('test-download-1');
      expect(task.fileName).toBe('file.txt');
    });

    it('should extract file name from URL if not provided', () => {
      const configWithoutFileName: IDownloadConfig = {
        downloadUrl: 'https://example.com/path/to/document.pdf',
      };

      const downloader = new Downloader(mockTask, configWithoutFileName);
      const task = downloader.getTask();

      expect(task.fileName).toBe('document.pdf');
    });

    it('should set transferType to Download', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      const task = downloader.getTask();

      expect(task.transferType).toBe('download');
    });
  });

  describe('getStrategyName', () => {
    it('should return selected strategy name', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      const strategyName = downloader.getStrategyName();

      expect(['fetch-blob', 'direct-link'].includes(strategyName)).toBe(true);
    });

    it('should use specified strategy', () => {
      const configWithStrategy: IDownloadConfig = {
        ...mockConfig,
        strategy: 'direct-link',
      };

      const downloader = new Downloader(mockTask, configWithStrategy);
      expect(downloader.getStrategyName()).toBe('direct-link');
    });
  });

  describe('getDownloadedBytes', () => {
    it('should return 0 initially', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      expect(downloader.getDownloadedBytes()).toBe(0);
    });
  });

  describe('pause', () => {
    it('should do nothing if not transferring', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      downloader.pause();

      const task = downloader.getTask();
      expect(task.status).toBe(TaskStatus.Idle);
    });
  });

  describe('cancel', () => {
    it('should set status to cancelled', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      downloader.cancel();

      const task = downloader.getTask();
      expect(task.status).toBe(TaskStatus.Cancelled);
    });
  });

  describe('events', () => {
    it('should emit statusChange event', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      const statusHandler = vi.fn();

      downloader.on('statusChange', statusHandler);
      downloader.cancel();

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'test-download-1',
          oldStatus: TaskStatus.Idle,
          newStatus: TaskStatus.Cancelled,
        })
      );
    });

    it('should emit cancelled event', () => {
      const downloader = new Downloader(mockTask, mockConfig);
      const cancelHandler = vi.fn();

      downloader.on('cancelled', cancelHandler);
      downloader.cancel();

      expect(cancelHandler).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('should not start if already transferring', async () => {
      // Create a task that's already transferring
      const transferringTask = {
        ...mockTask,
        status: TaskStatus.Transferring,
      };

      const downloader = new Downloader(transferringTask, mockConfig);
      await downloader.start();

      // Should remain in Transferring state, not change to Processing
      expect(downloader.getTask().status).toBe(TaskStatus.Transferring);
    });

    it('should set status to Processing when starting', async () => {
      // Mock fetch to hang
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => { }));

      const downloader = new Downloader(mockTask, mockConfig);

      // Start in background, don't await
      const startPromise = downloader.start();

      // Small delay to let status change
      await new Promise(resolve => setTimeout(resolve, 10));

      const task = downloader.getTask();
      expect([TaskStatus.Processing, TaskStatus.Transferring].includes(task.status)).toBe(true);

      // Cleanup
      downloader.cancel();
    });

    it('should handle network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const downloader = new Downloader(mockTask, mockConfig);
      await downloader.start();

      const task = downloader.getTask();
      expect(task.status).toBe(TaskStatus.Failed);
      expect(task.error?.message).toContain('Network error');
    });

    it('should handle HTTP errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 404, statusText: 'Not Found' })
      );

      const downloader = new Downloader(mockTask, mockConfig);
      await downloader.start();

      const task = downloader.getTask();
      expect(task.status).toBe(TaskStatus.Failed);
    });

    it('should complete successfully', async () => {
      const testContent = 'Hello, World!';
      const blob = new Blob([testContent]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(blob, {
          status: 200,
          headers: { 'content-length': blob.size.toString() },
        })
      );

      // Mock document methods
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

      const downloader = new Downloader(mockTask, mockConfig);
      await downloader.start();

      const task = downloader.getTask();
      expect(task.status).toBe(TaskStatus.Completed);
      expect(task.progress).toBe(100);
    });
  });

  describe('resume', () => {
    it('should restart from idle if enableResume is false', async () => {
      const pausedTask = {
        ...mockTask,
        status: TaskStatus.Paused,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new Blob(['test']), {
          status: 200,
          headers: { 'content-length': '4' },
        })
      );

      // Mock document methods
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

      const downloader = new Downloader(pausedTask, {
        ...mockConfig,
        enableResume: false,
      });

      await downloader.resume();

      expect(downloader.getTask().status).toBe(TaskStatus.Completed);
    });
  });

  describe('file name extraction', () => {
    it('should extract file name from complex URL', () => {
      const config: IDownloadConfig = {
        downloadUrl: 'https://cdn.example.com/files/2024/report.pdf?token=abc&expires=123',
      };

      const downloader = new Downloader(mockTask, config);
      expect(downloader.getTask().fileName).toBe('report.pdf');
    });

    it('should handle URL without file extension', () => {
      const config: IDownloadConfig = {
        downloadUrl: 'https://api.example.com/download/12345',
      };

      const downloader = new Downloader(mockTask, config);
      // Should default to 'download' or the last path segment
      expect(downloader.getTask().fileName).toBeTruthy();
    });

    it('should handle encoded file names', () => {
      const config: IDownloadConfig = {
        downloadUrl: 'https://example.com/files/%E6%96%87%E4%BB%B6.pdf',
      };

      const downloader = new Downloader(mockTask, config);
      expect(downloader.getTask().fileName).toBe('文件.pdf');
    });
  });
});
