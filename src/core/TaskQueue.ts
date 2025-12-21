/**
 * Task Queue - Manages concurrent transfer tasks
 */

import { BaseTransfer } from './BaseTransfer';
import { TaskStatus } from './types';

/**
 * Priority level for tasks
 */
export enum TaskPriority {
  Low = 0,
  Normal = 1,
  High = 2,
}

/**
 * Queue item interface
 */
interface IQueueItem {
  task: BaseTransfer;
  priority: TaskPriority;
  addedAt: number;
}

/**
 * TaskQueue manages concurrent execution of transfer tasks
 */
export class TaskQueue {
  private queue: IQueueItem[] = [];
  private running: Set<string> = new Set();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    if (maxConcurrent < 1) {
      throw new Error('maxConcurrent must be at least 1');
    }
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Add task to queue
   * @param task Transfer task
   * @param priority Task priority
   */
  enqueue(task: BaseTransfer, priority: TaskPriority = TaskPriority.Normal): void {
    const item: IQueueItem = {
      task,
      priority,
      addedAt: Date.now(),
    };

    // Insert task in priority order
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < priority) {
        this.queue.splice(i, 0, item);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.queue.push(item);
    }

    // Automatically start processing if there's capacity
    this.processQueue();
  }

  /**
   * Remove task from queue
   * @param taskId Task ID to remove
   * @returns true if removed, false if not found
   */
  dequeue(taskId: string): boolean {
    const index = this.queue.findIndex((item) => item.task.getTask().id === taskId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }

    // Also check running tasks
    if (this.running.has(taskId)) {
      this.running.delete(taskId);
      return true;
    }

    return false;
  }

  /**
   * Get number of running tasks
   */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * Get number of queued tasks (not running)
   */
  getQueuedCount(): number {
    return this.queue.length;
  }

  /**
   * Get total task count (running + queued)
   */
  getTotalCount(): number {
    return this.running.size + this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0 && this.running.size === 0;
  }

  /**
   * Clear all tasks (cancel running tasks)
   */
  clear(): void {
    // Cancel all running tasks
    this.running.forEach((taskId) => {
      const item = this.findQueueItem(taskId);
      if (item) {
        item.task.cancel();
      }
    });

    this.queue = [];
    this.running.clear();
  }

  /**
   * Set maximum concurrent tasks
   */
  setMaxConcurrent(maxConcurrent: number): void {
    if (maxConcurrent < 1) {
      throw new Error('maxConcurrent must be at least 1');
    }
    this.maxConcurrent = maxConcurrent;
    // May allow more tasks to start
    this.processQueue();
  }

  /**
   * Get maximum concurrent tasks
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * Process queue and start tasks if there's capacity
   */
  private processQueue(): void {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      const taskId = item.task.getTask().id;
      this.running.add(taskId);

      // Start task and handle completion
      item.task
        .start()
        .then(() => {
          this.handleTaskComplete(taskId);
        })
        .catch((error) => {
          console.error(`Task ${taskId} failed:`, error);
          this.handleTaskComplete(taskId);
        });

      // Listen for status changes
      item.task.on('statusChange', (event: { newStatus: TaskStatus }) => {
        // Remove from running if task reaches terminal state
        if (
          event.newStatus === TaskStatus.Completed ||
          event.newStatus === TaskStatus.Failed ||
          event.newStatus === TaskStatus.Cancelled
        ) {
          this.handleTaskComplete(taskId);
        }
      });
    }
  }

  /**
   * Handle task completion
   */
  private handleTaskComplete(taskId: string): void {
    if (this.running.has(taskId)) {
      this.running.delete(taskId);
      // Process queue to start next task
      this.processQueue();
    }
  }

  /**
   * Find queue item by task ID
   */
  private findQueueItem(taskId: string): IQueueItem | undefined {
    return this.queue.find((item) => item.task.getTask().id === taskId);
  }

  /**
   * Get all task IDs (running + queued)
   */
  getAllTaskIds(): string[] {
    const runningIds = Array.from(this.running);
    const queuedIds = this.queue.map((item) => item.task.getTask().id);
    return [...runningIds, ...queuedIds];
  }

  /**
   * Get running task IDs
   */
  getRunningTaskIds(): string[] {
    return Array.from(this.running);
  }

  /**
   * Get queued task IDs (not running)
   */
  getQueuedTaskIds(): string[] {
    return this.queue.map((item) => item.task.getTask().id);
  }
}
