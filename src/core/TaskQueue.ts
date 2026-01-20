/**
 * Task Queue - 管理并发传输任务
 */

import { BaseTransfer } from './BaseTransfer';
import { TaskStatus } from './types';

/**
 * 任务优先级
 */
export enum TaskPriority {
  Low = 0,
  Normal = 1,
  High = 2,
}

/**
 * 队列项接口
 */
interface IQueueItem {
  task: BaseTransfer;
  priority: TaskPriority;
  addedAt: number;
}

/**
 * TaskQueue 管理并发执行的传输任务
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
   * 添加任务到队列
   * @param task 传输任务
   * @param priority 任务优先级
   */
  enqueue(task: BaseTransfer, priority: TaskPriority = TaskPriority.Normal): void {
    const item: IQueueItem = {
      task,
      priority,
      addedAt: Date.now(),
    };

    // 按优先级插入任务
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

    // 自动开始处理如果还有容量
    this.processQueue();
  }

  /**
   * 从队列中移除任务
   * @param taskId 任务ID
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
   * 获取正在运行的任务数量
   */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * 获取队列中的任务数量（未运行）
   */
  getQueuedCount(): number {
    return this.queue.length;
  }

  /**
   * 获取总任务数量（运行中 + 队列中）
   */
  getTotalCount(): number {
    return this.running.size + this.queue.length;
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.queue.length === 0 && this.running.size === 0;
  }

  /**
   * 清空所有任务（取消运行中的任务）
   */
  clear(): void {
    // 取消所有运行中的任务
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
   * 设置最大并发任务数
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
   * 获取最大并发任务数
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * 处理队列，如果还有容量则开始任务
   */
  private processQueue(): void {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      const taskId = item.task.getTask().id;
      this.running.add(taskId);

      // 开始任务并处理完成
      item.task
        .start()
        .then(() => {
          this.handleTaskComplete(taskId);
        })
        .catch((error) => {
          console.error(`Task ${taskId} failed:`, error);
          this.handleTaskComplete(taskId);
        });

      // 监听状态变化
      item.task.on('statusChange', (arg: unknown) => {
        const event = arg as { newStatus: TaskStatus };
        // 如果任务达到终端状态，从运行中移除
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
   * 处理任务完成
   */
  private handleTaskComplete(taskId: string): void {
    if (this.running.has(taskId)) {
      this.running.delete(taskId);
      // 处理队列，如果还有容量则开始任务
      this.processQueue();
    }
  }

  /**
   * 通过任务ID查找队列项
   */
  private findQueueItem(taskId: string): IQueueItem | undefined {
    return this.queue.find((item) => item.task.getTask().id === taskId);
  }

  /**
   * 获取所有任务ID（运行中 + 队列中）
   */
  getAllTaskIds(): string[] {
    const runningIds = Array.from(this.running);
    const queuedIds = this.queue.map((item) => item.task.getTask().id);
    return [...runningIds, ...queuedIds];
  }

  /**
   * 获取运行中的任务ID
   */
  getRunningTaskIds(): string[] {
    return Array.from(this.running);
  }

  /**
   * 获取队列中的任务ID（未运行）
   */
  getQueuedTaskIds(): string[] {
    return this.queue.map((item) => item.task.getTask().id);
  }
}
