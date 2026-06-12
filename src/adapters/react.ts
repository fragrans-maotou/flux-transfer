import { useSyncExternalStore, useCallback } from 'react';
import type { TransferEngine } from '../core/engine';
import type { ITransferTask } from '../core/types';

/**
 * React 自定义 Hook
 * 用于在 React 组件中响应式地获取和追踪文件传输任务的状态
 * 
 * @param engine TransferEngine 实例
 * @param taskId 任务 ID
 * @returns 响应式的任务状态
 */
export function useTransferTask(
  engine: TransferEngine,
  taskId: string
): ITransferTask | undefined {
  // 订阅函数：绑定到 store.subscribe，当有状态变更时通知 React 重新渲染
  const subscribe = useCallback(
    (onStoreChange: () => void) => engine.store.subscribe(onStoreChange),
    [engine.store]
  );

  // 获取状态快照：返回特定任务的状态
  const getSnapshot = useCallback(
    () => engine.store.getTask(taskId),
    [engine.store, taskId]
  );

  // 使用 React 18 的 useSyncExternalStore 接入外部数据源
  // 因为我们的 Store 原生保证了 Immutable，所以非常契合此 Hook，不会造成额外重渲染
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
