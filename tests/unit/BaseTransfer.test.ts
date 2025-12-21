import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseTransfer } from '../../src/core/BaseTransfer';
import {
  TaskStatus,
  ErrorCode,
  type ITransferTask,
  type ISDKConfig,
  type IStorageAdapter,
  type ITransferCheckpoint,
} from '../../src/core/types';

// Concrete implementation for testing
class TestTransfer extends BaseTransfer {
  async start(): Promise<void> {
    this.initializeTransfer();
    this.setStatus(TaskStatus.Transferring);
  }

  pause(): void {
    this.setStatus(TaskStatus.Paused);
  }

  async resume(): Promise<void> {
    this.setStatus(TaskStatus.Transferring);
  }

  cancel(): void {
    this.setStatus(TaskStatus.Cancelled);
  }

  // Expose protected methods for testing
  public testSetStatus(status: TaskStatus): void {
    this.setStatus(status);
  }

  public testUpdateProgress(transferred: number, total: number): void {
    this.updateProgress(transferred, total);
  }

  public async testExecuteWithRetry<T>(
    operation: () => Promise<T>,
    errorCode: ErrorCode,
  ): Promise<T> {
    return this.executeWithRetry(operation, errorCode);
  }

  public testCreateTransferError(...args: Parameters<typeof this.createTransferError>) {
    return this.createTransferError(...args);
  }

  public async testSaveCheckpoint(): Promise<void> {
    return this.saveCheckpoint();
  }

  public async testLoadCheckpoint() {
    return this.loadCheckpoint();
  }

  public testIsTerminalState(): boolean {
    return this.isTerminalState();
  }
}

describe('BaseTransfer', () => {
  let mockTask: ITransferTask;
  let mockConfig: ISDKConfig;
  let mockStorage: IStorageAdapter;

  beforeEach(() => {
    mockTask = {
      id: 'test-task-1',
      status: TaskStatus.Idle,
      fileName: 'test.pdf',
      fileSize: 1024 * 1024, // 1MB
      fileType: 'application/pdf',
      progress: 0,
      speed: 0,
      remainingTime: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    mockStorage = {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      keys: vi.fn(),
    };

    mockConfig = {
      maxRetries: 3,
      retryDelay: 100,
      autoRetry: true,
      enableCheckpoint: true,
      storageAdapter: mockStorage,
    };
  });

  describe('Constructor', () => {
    it('should initialize with task and config', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const task = transfer.getTask();
      expect(task.id).toBe('test-task-1');
      expect(task.status).toBe(TaskStatus.Idle);
    });
  });

  describe('Status Management', () => {
    it('should update status and emit event', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const listener = vi.fn();
      transfer.on('statusChange', listener);

      transfer.testSetStatus(TaskStatus.Transferring);

      expect(transfer.getTask().status).toBe(TaskStatus.Transferring);
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0]).toMatchObject({
        taskId: 'test-task-1',
        oldStatus: TaskStatus.Idle,
        newStatus: TaskStatus.Transferring,
      });
    });

    it('should not emit event when status unchanged', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const listener = vi.fn();
      transfer.on('statusChange', listener);

      transfer.testSetStatus(TaskStatus.Idle);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit completed event', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const listener = vi.fn();
      transfer.on('completed', listener);

      transfer.testSetStatus(TaskStatus.Completed);

      expect(listener).toHaveBeenCalledWith(transfer.getTask());
    });

    it('should emit paused event', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const listener = vi.fn();
      transfer.on('paused', listener);

      transfer.testSetStatus(TaskStatus.Paused);

      expect(listener).toHaveBeenCalled();
    });

    it('should emit cancelled event', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const listener = vi.fn();
      transfer.on('cancelled', listener);

      transfer.testSetStatus(TaskStatus.Cancelled);

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Progress Tracking', () => {
    it('should calculate progress percentage', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      transfer.testUpdateProgress(512 * 1024, 1024 * 1024); // 50%

      expect(transfer.getTask().progress).toBe(50);
    });

    it('should calculate transfer speed', async () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      transfer.testUpdateProgress(0, 1024 * 1024);

      await new Promise(resolve => setTimeout(resolve, 150));
      transfer.testUpdateProgress(100 * 1024, 1024 * 1024); // 100KB

      const task = transfer.getTask();
      expect(task.speed).toBeGreaterThan(0);
    });

    it('should emit progress event', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const listener = vi.fn();
      transfer.on('progress', listener);

      transfer.testUpdateProgress(512 * 1024, 1024 * 1024);

      expect(listener).toHaveBeenCalled();
      const progressData = listener.mock.calls[0][0];
      expect(progressData.progress).toBe(50);
      expect(progressData.transferredBytes).toBe(512 * 1024);
      expect(progressData.totalBytes).toBe(1024 * 1024);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      let attemptCount = 0;
      const operation = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Temporary error');
        }
        return 'success';
      });

      const result = await transfer.testExecuteWithRetry(operation, ErrorCode.NetworkTimeout);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      const transfer = new TestTransfer(mockTask, { ...mockConfig, maxRetries: 2, retryDelay: 10 });
      const operation = vi.fn(async () => {
        throw new Error('Persistent error');
      });

      await expect(
        transfer.testExecuteWithRetry(operation, ErrorCode.NetworkTimeout)
      ).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry when autoRetry is false', async () => {
      const transfer = new TestTransfer(mockTask, { ...mockConfig, autoRetry: false });
      const operation = vi.fn(async () => {
        throw new Error('Error');
      });

      await expect(
        transfer.testExecuteWithRetry(operation, ErrorCode.NetworkTimeout)
      ).rejects.toThrow();

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff', async () => {
      const transfer = new TestTransfer(mockTask, { ...mockConfig, retryDelay: 10 });
      const operation = vi.fn(async () => {
        throw new Error('Error');
      });

      const startTime = Date.now();
      await expect(
        transfer.testExecuteWithRetry(operation, ErrorCode.NetworkTimeout)
      ).rejects.toThrow();
      const duration = Date.now() - startTime;

      // Should take at least 10 + 20 + 40 = 70ms with exponential backoff
      expect(duration).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Checkpoint Management', () => {
    it('should save checkpoint', async () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      await transfer.testSaveCheckpoint();

      expect(mockStorage.set).toHaveBeenCalledWith(
        'checkpoint_test-task-1',
        expect.objectContaining({
          taskId: 'test-task-1',
          transferredBytes: 0,
        })
      );
    });

    it('should load checkpoint', async () => {
      const checkpoint: ITransferCheckpoint = {
        taskId: 'test-task-1',
        transferredBytes: 512 * 1024,
        timestamp: Date.now(),
      };
      vi.mocked(mockStorage.get).mockResolvedValue(checkpoint);

      const transfer = new TestTransfer(mockTask, mockConfig);
      const loaded = await transfer.testLoadCheckpoint();

      expect(loaded).toEqual(checkpoint);
      expect(mockStorage.get).toHaveBeenCalledWith('checkpoint_test-task-1');
    });

    it('should not save checkpoint when disabled', async () => {
      const transfer = new TestTransfer(mockTask, { ...mockConfig, enableCheckpoint: false });
      await transfer.testSaveCheckpoint();

      expect(mockStorage.set).not.toHaveBeenCalled();
    });
  });

  describe('Error Creation', () => {
    it('should create transfer error with all fields', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      const originalError = new Error('Original error');
      const error = transfer.testCreateTransferError(
        ErrorCode.NetworkTimeout,
        'Network timeout',
        originalError,
        true
      );

      expect(error.code).toBe(ErrorCode.NetworkTimeout);
      expect(error.message).toBe('Network timeout');
      expect(error.originalError).toBe(originalError);
      expect(error.retryable).toBe(true);
      expect(error.timestamp).toBeGreaterThan(0);
    });
  });

  describe('Terminal State Check', () => {
    it('should identify terminal states', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);

      transfer.testSetStatus(TaskStatus.Completed);
      expect(transfer.testIsTerminalState()).toBe(true);

      transfer.testSetStatus(TaskStatus.Failed);
      expect(transfer.testIsTerminalState()).toBe(true);

      transfer.testSetStatus(TaskStatus.Cancelled);
      expect(transfer.testIsTerminalState()).toBe(true);
    });

    it('should identify non-terminal states', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);

      transfer.testSetStatus(TaskStatus.Transferring);
      expect(transfer.testIsTerminalState()).toBe(false);

      transfer.testSetStatus(TaskStatus.Paused);
      expect(transfer.testIsTerminalState()).toBe(false);
    });
  });

  describe('Abstract Methods', () => {
    it('should start transfer', async () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      await transfer.start();

      expect(transfer.getTask().status).toBe(TaskStatus.Transferring);
    });

    it('should pause transfer', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      transfer.pause();

      expect(transfer.getTask().status).toBe(TaskStatus.Paused);
    });

    it('should resume transfer', async () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      await transfer.resume();

      expect(transfer.getTask().status).toBe(TaskStatus.Transferring);
    });

    it('should cancel transfer', () => {
      const transfer = new TestTransfer(mockTask, mockConfig);
      transfer.cancel();

      expect(transfer.getTask().status).toBe(TaskStatus.Cancelled);
    });
  });
});
