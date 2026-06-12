import { shallowRef, onUnmounted, readonly, ShallowRef } from 'vue';
import type { TransferEngine } from '../core/engine';
import type { ITransferTask } from '../core/types';

/**
 * Vue 3 组合式函数 (Composable)
 * 用于在 Vue 组件中响应式地获取和追踪文件传输任务的状态
 * 
 * @param engine TransferEngine 实例
 * @param taskId 任务 ID
 * @returns 响应式的任务状态 (只读)
 */
export function useTransferTask(
  engine: TransferEngine,
  taskId: string
): Readonly<ShallowRef<ITransferTask | undefined>> {
  // 获取初始状态并使用 shallowRef 包裹。
  // 使用 shallowRef 而非 ref 是为了避免 Vue 对任务对象进行深度响应式代理，
  // 从而提高性能，因为我们的 Store 会在数据更新时产生全新的不可变对象 (Immutable)。
  const task = shallowRef<ITransferTask | undefined>(engine.store.getTask(taskId));

  // 注册订阅，当 Store 中的状态发生变更时，触发回调
  const unsubscribe = engine.store.subscribe((state) => {
    const latestTask = state.tasks[taskId];
    // 只有当任务引用发生变化时才更新（Immutable 保证了引用的唯一性），触发组件重新渲染
    if (task.value !== latestTask) {
      task.value = latestTask;
    }
  });

  // 在组件卸载时自动清理订阅，防止内存泄漏
  onUnmounted(() => {
    unsubscribe();
  });

  // 返回只读引用，严格保证单向数据流（状态只能通过引擎层改变，UI 层不能直接修改）
  return readonly(task) as Readonly<ShallowRef<ITransferTask | undefined>>;
}
