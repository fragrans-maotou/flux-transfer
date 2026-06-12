// @ts-ignore
import * as Vue from 'vue';
import type { TransferEngine } from '../core/engine';
import type { ITransferTask } from '../core/types';

/**
 * Vue 2 适配器
 * 用于在 Vue 2 中提供响应式的任务状态
 */
export function createVue2TransferTask(engine: TransferEngine, taskId: string) {
  // @ts-ignore - Vue 3 typings do not have observable
  const state = Vue.observable({
    task: engine.store.getTask(taskId) as ITransferTask | undefined
  });

  const unsubscribe = engine.store.subscribe((storeState) => {
    const latestTask = storeState.tasks[taskId];
    if (state.task !== latestTask) {
      state.task = latestTask;
    }
  });

  return {
    get task() {
      return state.task;
    },
    destroy() {
      unsubscribe();
    }
  };
}
