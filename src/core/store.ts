import type { IStore, IStoreAction, IStoreState, ITransferTask } from './types';

export class TransferStore implements IStore {
  private state: IStoreState = { tasks: {}, globalProgress: 0 };
  private readonly listeners = new Set<(state: IStoreState) => void>();

  getState(): IStoreState {
    return this.state;
  }

  getTask(id: string): ITransferTask | undefined {
    return this.state.tasks[id];
  }

  dispatch(action: IStoreAction): void {
    const tasks = { ...this.state.tasks };

    if (action.type === 'ADD_TASK') {
      tasks[action.payload.id] = action.payload;
    } else if (action.type === 'UPDATE_TASK') {
      const current = tasks[action.payload.id];
      if (!current) return;
      tasks[action.payload.id] = { ...current, ...action.payload.updates };
    } else {
      delete tasks[action.payload.id];
    }

    this.state = { tasks, globalProgress: calculateGlobalProgress(tasks) };
    for (const listener of [...this.listeners]) listener(this.state);
  }

  subscribe(listener: (state: IStoreState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function calculateGlobalProgress(tasks: Record<string, ITransferTask>): number {
  const values = Object.values(tasks);
  if (values.length === 0) return 0;

  const totalBytes = values.reduce((sum, task) => sum + task.totalBytes, 0);
  if (totalBytes === 0) {
    return Math.round(values.reduce((sum, task) => sum + task.progress, 0) / values.length);
  }

  const completedBytes = values.reduce(
    (sum, task) => sum + (task.totalBytes * task.progress) / 100,
    0,
  );
  return Math.round((completedBytes / totalBytes) * 100);
}
