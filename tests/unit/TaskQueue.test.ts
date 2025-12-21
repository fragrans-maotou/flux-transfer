import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskQueue, TaskPriority } from '../../src/core/TaskQueue';
import { BaseTransfer } from '../../src/core/BaseTransfer';
import { TaskStatus, type ITransferTask, type ISDKConfig } from '../../src/core/types';

// Mock transfer task for testing
class MockTransfer extends BaseTransfer {
  private shouldFail: boolean = false;
  private startDelay: number = 0;

  constructor(task: ITransferTask, config: ISDKConfig, startDelay: number = 0, shouldFail: boolean = false) {
    super(task, config);
    this.startDelay = startDelay;
    this.shouldFail = shouldFail;
  }

  async start(): Promise<void> {
    this.initializeTransfer();
    this.setStatus(TaskStatus.Transferring);

    await new Promise((resolve) => setTimeout(resolve, this.startDelay));

    if (this.shouldFail) {
      this.setStatus(TaskStatus.Failed);
      throw new Error('Task failed');
    } else {
      this.setStatus(TaskStatus.Completed);
    }
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

  protected setStatus(status: TaskStatus): void {
    super['setStatus'](status);
  }
}

function createMockTask(id: string): ITransferTask {
  return {
    id,
    status: TaskStatus.Idle,
    fileName: `file-${id}.pdf`,
    fileSize: 1024,
    fileType: 'application/pdf',
    progress: 0,
    speed: 0,
    remainingTime: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('TaskQueue', () => {
  let mockConfig: ISDKConfig;

  beforeEach(() => {
    mockConfig = {
      maxRetries: 3,
      retryDelay: 100,
      autoRetry: false,
      enableCheckpoint: false,
    };
  });

  describe('Constructor', () => {
    it('should initialize with default maxConcurrent', () => {
      const queue = new TaskQueue();
      expect(queue.getMaxConcurrent()).toBe(3);
    });

    it('should initialize with custom maxConcurrent', () => {
      const queue = new TaskQueue(5);
      expect(queue.getMaxConcurrent()).toBe(5);
    });

    it('should throw error for invalid maxConcurrent', () => {
      expect(() => new TaskQueue(0)).toThrow('maxConcurrent must be at least 1');
      expect(() => new TaskQueue(-1)).toThrow('maxConcurrent must be at least 1');
    });
  });

  describe('enqueue()', () => {
    it('should add task to queue', () => {
      const queue = new TaskQueue(1);
      const task = new MockTransfer(createMockTask('1'), mockConfig, 50);

      queue.enqueue(task);

      expect(queue.getTotalCount()).toBe(1);
    });

    it('should respect priority order', async () => {
      const queue = new TaskQueue(1);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 50);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 50);
      const task3 = new MockTransfer(createMockTask('3'), mockConfig, 50);

      // Add tasks with different priorities
      queue.enqueue(task1, TaskPriority.Normal);
      queue.enqueue(task2, TaskPriority.High);
      queue.enqueue(task3, TaskPriority.Low);

      // High priority task should be in queue first (after currently running)
      const queuedIds = queue.getQueuedTaskIds();
      expect(queuedIds[0]).toBe('2'); // High priority
      expect(queuedIds[1]).toBe('3'); // Low priority (added before Normal in this case)
    });

    it('should automatically start task if capacity available', async () => {
      const queue = new TaskQueue(2);
      const task = new MockTransfer(createMockTask('1'), mockConfig, 10);

      queue.enqueue(task);

      // Task should be running immediately
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(queue.getRunningCount()).toBe(1);
    });
  });

  describe('dequeue()', () => {
    it('should remove task from queue', async () => {
      const queue = new TaskQueue(1);
      // Create tasks with long delay so none complete during test
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 1000);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 1000);

      queue.enqueue(task1);
      queue.enqueue(task2);

      // Wait for first task to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now task1 is running, task2 in queue
      const removed = queue.dequeue('2');

      expect(removed).toBe(true);
      expect(queue.getTotalCount()).toBe(1); // Only task1 remains
    });

    it('should return false for non-existent task', () => {
      const queue = new TaskQueue();
      const removed = queue.dequeue('non-existent');

      expect(removed).toBe(false);
    });
  });

  describe('Concurrent Execution', () => {
    it('should limit concurrent running tasks', async () => {
      const queue = new TaskQueue(2);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);
      const task3 = new MockTransfer(createMockTask('3'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);
      queue.enqueue(task3);

      // Wait a bit for tasks to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Only 2 should be running
      expect(queue.getRunningCount()).toBe(2);
      expect(queue.getQueuedCount()).toBe(1);
    });

    it('should automatically start next task when one completes', async () => {
      const queue = new TaskQueue(1);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 50);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 50);

      queue.enqueue(task1);
      queue.enqueue(task2);

      // Initially, task1 running, task2 queued
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queue.getRunningCount()).toBe(1);
      expect(queue.getQueuedCount()).toBe(1);

      // After task1 completes, task2 should start
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(queue.getRunningCount()).toBeLessThanOrEqual(1);
      expect(queue.getQueuedCount()).toBe(0);
    });
  });

  describe('Queue State', () => {
    it('should return correct counts', async () => {
      const queue = new TaskQueue(2);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);
      const task3 = new MockTransfer(createMockTask('3'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);
      queue.enqueue(task3);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(queue.getRunningCount()).toBe(2);
      expect(queue.getQueuedCount()).toBe(1);
      expect(queue.getTotalCount()).toBe(3);
    });

    it('should identify empty queue', () => {
      const queue = new TaskQueue();
      expect(queue.isEmpty()).toBe(true);

      const task = new MockTransfer(createMockTask('1'), mockConfig);
      queue.enqueue(task);
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should clear all tasks', async () => {
      const queue = new TaskQueue(2);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);

      await new Promise((resolve) => setTimeout(resolve, 20));

      queue.clear();

      expect(queue.isEmpty()).toBe(true);
      expect(queue.getRunningCount()).toBe(0);
      expect(queue.getQueuedCount()).toBe(0);
    });
  });

  describe('setMaxConcurrent()', () => {
    it('should update max concurrent count', () => {
      const queue = new TaskQueue(3);
      queue.setMaxConcurrent(5);

      expect(queue.getMaxConcurrent()).toBe(5);
    });

    it('should throw error for invalid value', () => {
      const queue = new TaskQueue();
      expect(() => queue.setMaxConcurrent(0)).toThrow('maxConcurrent must be at least 1');
    });

    it('should start queued tasks when increasing limit', async () => {
      const queue = new TaskQueue(1);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queue.getRunningCount()).toBe(1);

      queue.setMaxConcurrent(2);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queue.getRunningCount()).toBe(2);
    });
  });

  describe('Task ID Queries', () => {
    it('should return all task IDs', async () => {
      const queue = new TaskQueue(2);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);
      const task3 = new MockTransfer(createMockTask('3'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);
      queue.enqueue(task3);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const allIds = queue.getAllTaskIds();
      expect(allIds).toContain('1');
      expect(allIds).toContain('2');
      expect(allIds).toContain('3');
      expect(allIds.length).toBe(3);
    });

    it('should return running task IDs', async () => {
      const queue = new TaskQueue(2);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);
      const task3 = new MockTransfer(createMockTask('3'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);
      queue.enqueue(task3);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const runningIds = queue.getRunningTaskIds();
      expect(runningIds.length).toBe(2);
    });

    it('should return queued task IDs', async () => {
      const queue = new TaskQueue(1);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 100);
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 100);

      queue.enqueue(task1);
      queue.enqueue(task2);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const queuedIds = queue.getQueuedTaskIds();
      expect(queuedIds).toContain('2');
      expect(queuedIds.length).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle task failure and continue processing', async () => {
      const queue = new TaskQueue(1);
      const task1 = new MockTransfer(createMockTask('1'), mockConfig, 50, true); // Will fail
      const task2 = new MockTransfer(createMockTask('2'), mockConfig, 50);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      queue.enqueue(task1);
      queue.enqueue(task2);

      // Wait for both tasks to process
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(consoleSpy).toHaveBeenCalled();
      expect(queue.isEmpty()).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
