import { IStore, IStoreState, IStoreAction, ITransferTask } from './types';

/**
 * 核心状态管理器 (Store)
 * 采用单一数据源和发布-订阅模式，抛弃传统的 EventEmitter 和 OOP 继承冒泡
 */
export class TransferStore implements IStore {
  // 维护不可变的 state
  private state: IStoreState = {
    tasks: {},
    globalProgress: 0,
  };
  
  // 订阅者集合
  private listeners: Set<(state: IStoreState) => void> = new Set();

  /**
   * 获取当前的完整状态快照
   */
  public getState(): IStoreState {
    return this.state;
  }

  /**
   * 根据 ID 获取单个任务的状态快照
   */
  public getTask(id: string): ITransferTask | undefined {
    return this.state.tasks[id];
  }

  /**
   * 派发 Action 以更新状态
   * 采用 Immutable 模式返回全新状态对象
   */
  public dispatch(action: IStoreAction): void {
    const { type, payload } = action;
    
    // 浅拷贝 tasks
    const nextTasks = { ...this.state.tasks };

    switch (type) {
      case 'ADD_TASK': {
        const task = payload as ITransferTask;
        nextTasks[task.id] = task;
        break;
      }
      case 'UPDATE_TASK': {
        const { id, updates } = payload as { id: string; updates: Partial<ITransferTask> };
        if (nextTasks[id]) {
          nextTasks[id] = { ...nextTasks[id], ...updates };
        }
        break;
      }
      case 'REMOVE_TASK': {
        const { id } = payload as { id: string };
        delete nextTasks[id];
        break;
      }
      default:
        // 未知 Action 不做处理
        return; 
    }

    // 更新 state 并重新计算全局进度
    this.state = {
      ...this.state,
      tasks: nextTasks,
      globalProgress: this.calculateGlobalProgress(nextTasks)
    };

    // 状态变更，通知所有订阅者
    this.notify();
  }

  /**
   * 注册状态变更监听器
   * @returns 返回取消订阅的函数
   */
  public subscribe(listener: (state: IStoreState) => void): () => void {
    this.listeners.add(listener);
    // 返回 unsubscribe 函数，防止内存泄漏
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 内部触发器，遍历执行 listeners
   */
  private notify(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * 简单计算全局进度
   */
  private calculateGlobalProgress(tasks: Record<string, ITransferTask>): number {
    const taskList = Object.values(tasks);
    if (taskList.length === 0) return 0;
    
    let totalProgress = 0;
    taskList.forEach(t => {
      totalProgress += (t.progress || 0);
    });
    return Math.round(totalProgress / taskList.length);
  }
}
