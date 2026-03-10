/**
 * Vue 2 Adapter - Unit Tests
 *
 * 通过 mock Vue.observable 来测试核心适配逻辑，无需真实 Vue 依赖
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferManager } from '../../src/core/TransferManager';
import { TaskStatus } from '../../src/core/types';

// Mock Vue.observable - 直接返回原对象（模拟 Vue 2 行为）
// 在真实 Vue 2 中，Vue.observable 会让对象的属性变成响应式的
const mockObservable = vi.fn(<T extends object>(obj: T): T => obj);

vi.stubGlobal('Vue', {
  observable: mockObservable,
});

// 动态导入 adapter（在 Vue 全局 mock 之后）
const { setVue, useUpload, useDownload, useTransferList, fluxTransferMixin } = await import(
  '../../src/adapters/vue2'
);

describe('Vue 2 Adapter', () => {
  let manager: TransferManager;
  let mockFile: File;

  beforeEach(() => {
    // 注入 mock Vue 实例，使适配器可以使用 Vue.observable
    setVue({ observable: mockObservable });
    manager = new TransferManager({ maxConcurrent: 3 });
    mockFile = new File(['hello world test content'], 'test.txt', {
      type: 'text/plain',
    });
    mockObservable.mockClear();
  });

  // ==========================
  // useUpload
  // ==========================
  describe('useUpload', () => {
    it('should return correct structure', () => {
      const result = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('pause');
      expect(result).toHaveProperty('resume');
      expect(result).toHaveProperty('cancel');
      expect(result).toHaveProperty('uploader');
      expect(result).toHaveProperty('cleanup');
      expect(typeof result.start).toBe('function');
      expect(typeof result.pause).toBe('function');
      expect(typeof result.resume).toBe('function');
      expect(typeof result.cancel).toBe('function');
      expect(typeof result.cleanup).toBe('function');
    });

    it('should call Vue.observable to create reactive state', () => {
      useUpload(manager, mockFile, { uploadUrl: '/api/upload' });
      expect(mockObservable).toHaveBeenCalled();
    });

    it('should initialize state with idle status', () => {
      const { state } = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      expect(state.status).toBe(TaskStatus.Idle);
      expect(state.progress).toBe(0);
      expect(state.speed).toBe(0);
      expect(state.remainingTime).toBe(0);
      expect(state.error).toBeNull();
      expect(state.isUploading).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.isCompleted).toBe(false);
      expect(state.isFailed).toBe(false);
    });

    it('should have task info in state', () => {
      const { state } = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      expect(state.task).not.toBeNull();
      expect(state.task!.fileName).toBe('test.txt');
      expect(state.task!.fileSize).toBe(mockFile.size);
    });

    it('should create uploader through manager', () => {
      const spy = vi.spyOn(manager, 'createUploader');
      const config = { uploadUrl: '/api/upload' };

      useUpload(manager, mockFile, config, 'group1');

      expect(spy).toHaveBeenCalledWith(mockFile, config, 'group1');
    });

    it('should sync state on statusChange event', () => {
      const { state, uploader } = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      // 模拟 uploader 发射事件
      // BaseTransfer.setStatus 内部会 emit statusChange
      // 我们直接 emit 来模拟
      (uploader as any).task.status = TaskStatus.Processing;
      uploader.emit('statusChange', {
        taskId: (uploader as any).task.id,
        oldStatus: TaskStatus.Idle,
        newStatus: TaskStatus.Processing,
      });

      expect(state.status).toBe(TaskStatus.Processing);
    });

    it('should sync state on progress event', () => {
      const { state, uploader } = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      // 修改 uploader 任务进度并发射事件
      (uploader as any).task.progress = 50;
      (uploader as any).task.speed = 1024;
      (uploader as any).task.status = TaskStatus.Transferring;
      uploader.emit('progress', {
        taskId: (uploader as any).task.id,
        progress: 50,
        speed: 1024,
      });

      expect(state.progress).toBe(50);
      expect(state.speed).toBe(1024);
      expect(state.isUploading).toBe(true);
    });

    it('should sync state on error event', () => {
      const { state, uploader } = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      const mockError = {
        code: 'UNKNOWN' as const,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: true,
      };
      (uploader as any).task.status = TaskStatus.Failed;
      (uploader as any).task.error = mockError;
      uploader.emit('error', mockError);

      expect(state.isFailed).toBe(true);
      expect(state.error).toEqual(mockError);
    });

    it('should cleanup subscriptions', () => {
      const { state, uploader, cleanup } = useUpload(manager, mockFile, {
        uploadUrl: '/api/upload',
      });

      cleanup();

      // 清理后，事件不应再更新 state
      (uploader as any).task.progress = 99;
      (uploader as any).task.status = TaskStatus.Transferring;
      uploader.emit('progress', { progress: 99 });

      expect(state.progress).toBe(0); // 应保持初始值
    });

    it('should delegate control methods to uploader', () => {
      const { start, pause, resume, cancel, uploader } = useUpload(
        manager,
        mockFile,
        { uploadUrl: '/api/upload' },
      );

      const pauseSpy = vi.spyOn(uploader, 'pause');
      const cancelSpy = vi.spyOn(uploader, 'cancel');

      pause();
      expect(pauseSpy).toHaveBeenCalled();

      cancel();
      expect(cancelSpy).toHaveBeenCalled();
    });
  });

  // ==========================
  // useDownload
  // ==========================
  describe('useDownload', () => {
    it('should return correct structure', () => {
      const result = useDownload(manager, 'https://example.com/file.zip', {});

      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('pause');
      expect(result).toHaveProperty('resume');
      expect(result).toHaveProperty('cancel');
      expect(result).toHaveProperty('downloader');
      expect(result).toHaveProperty('cleanup');
    });

    it('should call Vue.observable to create reactive state', () => {
      mockObservable.mockClear();
      useDownload(manager, 'https://example.com/file.zip', {});
      expect(mockObservable).toHaveBeenCalled();
    });

    it('should initialize state with idle status', () => {
      const { state } = useDownload(
        manager,
        'https://example.com/file.zip',
        {},
      );

      expect(state.status).toBe(TaskStatus.Idle);
      expect(state.progress).toBe(0);
      expect(state.isDownloading).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.isCompleted).toBe(false);
      expect(state.isFailed).toBe(false);
    });

    it('should create downloader through manager', () => {
      const spy = vi.spyOn(manager, 'createDownloader');
      const config = { fileName: 'downloaded.zip' };

      useDownload(
        manager,
        'https://example.com/file.zip',
        config,
        'dlGroup1',
      );

      expect(spy).toHaveBeenCalledWith(
        'https://example.com/file.zip',
        config,
        'dlGroup1',
      );
    });

    it('should sync state on statusChange event', () => {
      const { state, downloader } = useDownload(
        manager,
        'https://example.com/file.zip',
        {},
      );

      (downloader as any).task.status = TaskStatus.Transferring;
      downloader.emit('statusChange', {
        newStatus: TaskStatus.Transferring,
      });

      expect(state.status).toBe(TaskStatus.Transferring);
      expect(state.isDownloading).toBe(true);
    });

    it('should have task info in state', () => {
      const { state } = useDownload(
        manager,
        'https://example.com/file.zip',
        { fileName: 'test-download.zip', fileSize: 1024 * 1024 },
      );

      expect(state.task).not.toBeNull();
      expect(state.task!.fileName).toBe('test-download.zip');
    });

    it('should sync state on progress event', () => {
      const { state, downloader } = useDownload(
        manager,
        'https://example.com/file.zip',
        {},
      );

      (downloader as any).task.progress = 65;
      (downloader as any).task.speed = 2048;
      (downloader as any).task.status = TaskStatus.Transferring;
      downloader.emit('progress', {
        taskId: (downloader as any).task.id,
        progress: 65,
        speed: 2048,
      });

      expect(state.progress).toBe(65);
      expect(state.speed).toBe(2048);
      expect(state.isDownloading).toBe(true);
    });

    it('should sync state on error event', () => {
      const { state, downloader } = useDownload(
        manager,
        'https://example.com/file.zip',
        {},
      );

      const mockError = {
        code: 'UNKNOWN' as const,
        message: 'Download failed',
        timestamp: Date.now(),
        retryable: true,
      };
      (downloader as any).task.status = TaskStatus.Failed;
      (downloader as any).task.error = mockError;
      downloader.emit('error', mockError);

      expect(state.isFailed).toBe(true);
      expect(state.error).toEqual(mockError);
    });

    it('should delegate control methods to downloader', () => {
      const { pause, cancel, downloader } = useDownload(
        manager,
        'https://example.com/file.zip',
        {},
      );

      const pauseSpy = vi.spyOn(downloader, 'pause');
      const cancelSpy = vi.spyOn(downloader, 'cancel');

      pause();
      expect(pauseSpy).toHaveBeenCalled();

      cancel();
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('should cleanup subscriptions', () => {
      const { state, downloader, cleanup } = useDownload(
        manager,
        'https://example.com/file.zip',
        {},
      );

      cleanup();

      // 清理后发射事件不应更新 state
      (downloader as any).task.progress = 75;
      downloader.emit('progress', { progress: 75 });

      expect(state.progress).toBe(0);
    });
  });

  // ==========================
  // useTransferList
  // ==========================
  describe('useTransferList', () => {
    it('should return correct structure', () => {
      const result = useTransferList(manager);

      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('refresh');
      expect(Array.isArray(result.state.tasks)).toBe(true);
    });

    it('should initialize with empty tasks', () => {
      const { state } = useTransferList(manager);
      expect(state.tasks).toHaveLength(0);
    });

    it('should show tasks after creating them', () => {
      // 先创建一些任务
      manager.createUploader(mockFile, { uploadUrl: '/api/upload' });
      manager.createUploader(
        new File(['data'], 'file2.txt'),
        { uploadUrl: '/api/upload' },
      );

      const { state } = useTransferList(manager);
      expect(state.tasks).toHaveLength(2);
    });

    it('should refresh tasks when refresh is called', () => {
      const { state, refresh } = useTransferList(manager);
      expect(state.tasks).toHaveLength(0);

      // 创建新任务后刷新
      manager.createUploader(mockFile, { uploadUrl: '/api/upload' });
      refresh();

      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].fileName).toBe('test.txt');
    });

    it('should splice array in-place on refresh for Vue reactivity', () => {
      const { state, refresh } = useTransferList(manager);
      const spliceSpy = vi.spyOn(state.tasks, 'splice');

      manager.createUploader(mockFile, { uploadUrl: '/api/upload' });
      refresh();

      expect(spliceSpy).toHaveBeenCalled();
    });
  });

  // ==========================
  // fluxTransferMixin
  // ==========================
  describe('fluxTransferMixin', () => {
    it('should have beforeCreate and beforeDestroy hooks', () => {
      expect(fluxTransferMixin).toHaveProperty('beforeCreate');
      expect(fluxTransferMixin).toHaveProperty('beforeDestroy');
      expect(typeof fluxTransferMixin.beforeCreate).toBe('function');
      expect(typeof fluxTransferMixin.beforeDestroy).toBe('function');
    });

    it('should initialize $fluxCleanups array in beforeCreate', () => {
      const ctx: any = {};
      fluxTransferMixin.beforeCreate.call(ctx);
      expect(ctx.$fluxCleanups).toEqual([]);
    });

    it('should call all cleanup functions in beforeDestroy', () => {
      const ctx: any = {};
      fluxTransferMixin.beforeCreate.call(ctx);

      const fn1 = vi.fn();
      const fn2 = vi.fn();
      ctx.$fluxCleanups.push(fn1, fn2);

      fluxTransferMixin.beforeDestroy.call(ctx);

      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
      expect(ctx.$fluxCleanups).toHaveLength(0);
    });
  });
});
