/**
 * Flux Transfer - Vue 2 Adapter
 * 
 * 为 Vue 2 提供响应式的文件传输能力
 * 使用 Vue.observable() 包装状态，自动同步 SDK 事件
 * 
 * @example
 * ```js
 * import Vue from 'vue';
 * import { TransferManager } from 'flux-transfer';
 * import { setVue, useUpload } from 'flux-transfer/vue2';
 * 
 * // 在使用前先注入 Vue
 * setVue(Vue);
 * 
 * const manager = new TransferManager({ maxConcurrent: 3 });
 * const { state, start, pause, resume, cancel } = useUpload(manager, file, {
 *   uploadUrl: '/api/upload',
 * });
 * ```
 */

import type { Downloader, IDownloadConfig } from '../core/downloader/Downloader';
import type { TransferManager } from '../core/TransferManager';
import type { ITransferError, ITransferTask, TaskStatus } from '../core/types';
import type { IUploadConfig, Uploader } from '../core/uploader/Uploader';

// Vue 2 类型声明
interface IVue2Constructor {
  observable: <T extends object>(obj: T) => T;
  [key: string]: unknown;
}

// 模块级别保存用户注入的 Vue 实例
let _Vue: IVue2Constructor | null = null;

/**
 * 注入 Vue 2 实例，必须在使用 useUpload / useDownload / useTransferList 之前调用
 *
 * @param Vue - 用户项目中的 Vue 构造函数
 *
 * @example
 * ```js
 * import Vue from 'vue';
 * import { setVue } from 'flux-transfer/vue2';
 * setVue(Vue);
 * ```
 */
export function setVue(Vue: IVue2Constructor): void {
  _Vue = Vue;
}

function getVue(): IVue2Constructor {
  if (!_Vue) {
    throw new Error(
      '[flux-transfer] Vue is not set. Please call setVue(Vue) before using Vue 2 adapters.\n' +
      'Example:\n' +
      '  import Vue from "vue";\n' +
      '  import { setVue } from "flux-transfer/vue2";\n' +
      '  setVue(Vue);',
    );
  }
  return _Vue;
}

// ============================================================
// Types
// ============================================================

/** 上传状态 */
export interface IUploadState {
  /** 任务状态 */
  status: TaskStatus | string;
  /** 上传进度 (0-100) */
  progress: number;
  /** 传输速度 (bytes/sec) */
  speed: number;
  /** 剩余时间 (秒) */
  remainingTime: number;
  /** 错误信息 */
  error: ITransferError | null;
  /** 完整任务对象 */
  task: ITransferTask | null;
  /** 便捷标记 */
  isUploading: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  isFailed: boolean;
}

/** 下载状态 */
export interface IDownloadState {
  /** 任务状态 */
  status: TaskStatus | string;
  /** 下载进度 (0-100) */
  progress: number;
  /** 传输速度 (bytes/sec) */
  speed: number;
  /** 剩余时间 (秒) */
  remainingTime: number;
  /** 错误信息 */
  error: ITransferError | null;
  /** 完整任务对象 */
  task: ITransferTask | null;
  /** 便捷标记 */
  isDownloading: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  isFailed: boolean;
}

/** useUpload 返回值 */
export interface IUseUploadReturn {
  /** 响应式状态 */
  state: IUploadState;
  /** 开始上传 */
  start: () => Promise<void>;
  /** 暂停上传 */
  pause: () => void;
  /** 恢复上传 */
  resume: () => Promise<void>;
  /** 取消上传 */
  cancel: () => void;
  /** 上传器实例（用于高级操作） */
  uploader: Uploader;
  /** 手动清理所有事件订阅 */
  cleanup: () => void;
}

/** useDownload 返回值 */
export interface IUseDownloadReturn {
  /** 响应式状态 */
  state: IDownloadState;
  /** 开始下载 */
  start: () => Promise<void>;
  /** 暂停下载 */
  pause: () => void;
  /** 恢复下载 */
  resume: () => Promise<void>;
  /** 取消下载 */
  cancel: () => void;
  /** 下载器实例（用于高级操作） */
  downloader: Downloader;
  /** 手动清理所有事件订阅 */
  cleanup: () => void;
}

/** useTransferList 返回值 */
export interface IUseTransferListReturn {
  /** 响应式任务列表 */
  state: { tasks: ITransferTask[] };
  /** 手动刷新列表 */
  refresh: () => void;
}

// ============================================================
// Status helpers
// ============================================================

function isStatusUploading(status: string): boolean {
  return status === 'transferring' || status === 'processing';
}

function isStatusDownloading(status: string): boolean {
  return status === 'transferring' || status === 'processing';
}

function isStatusPaused(status: string): boolean {
  return status === 'paused';
}

function isStatusCompleted(status: string): boolean {
  return status === 'completed';
}

function isStatusFailed(status: string): boolean {
  return status === 'failed';
}

// ============================================================
// Sync helpers
// ============================================================

function syncUploadState(state: IUploadState, uploader: Uploader): void {
  const task = uploader.getTask();
  state.status = task.status;
  state.progress = task.progress;
  state.speed = task.speed;
  state.remainingTime = task.remainingTime;
  state.error = task.error || null;
  state.task = { ...task };
  state.isUploading = isStatusUploading(task.status);
  state.isPaused = isStatusPaused(task.status);
  state.isCompleted = isStatusCompleted(task.status);
  state.isFailed = isStatusFailed(task.status);
}

function syncDownloadState(state: IDownloadState, downloader: Downloader): void {
  const task = downloader.getTask();
  state.status = task.status;
  state.progress = task.progress;
  state.speed = task.speed;
  state.remainingTime = task.remainingTime;
  state.error = task.error || null;
  state.task = { ...task };
  state.isDownloading = isStatusDownloading(task.status);
  state.isPaused = isStatusPaused(task.status);
  state.isCompleted = isStatusCompleted(task.status);
  state.isFailed = isStatusFailed(task.status);
}

// ============================================================
// useUpload
// ============================================================

/**
 * Vue 2 文件上传 composable
 * 
 * @param manager - TransferManager 实例
 * @param file - 要上传的文件
 * @param config - 上传配置
 * @param groupId - 可选的分组 ID
 * @returns 响应式状态和控制方法
 * 
 * @example
 * ```js
 * export default {
 *   data() {
 *     return { uploadCtrl: null };
 *   },
 *   methods: {
 *     handleFileChange(e) {
 *       const file = e.target.files[0];
 *       this.uploadCtrl = useUpload(this.manager, file, {
 *         uploadUrl: '/api/upload',
 *       });
 *     },
 *   },
 *   beforeDestroy() {
 *     this.uploadCtrl?.cleanup();
 *   },
 * };
 * ```
 */
export function useUpload(
  manager: TransferManager,
  file: File,
  config: IUploadConfig,
  groupId?: string,
): IUseUploadReturn {
  // 创建 uploader
  const uploader = manager.createUploader(file, config, groupId);
  return wrapUploader(uploader);
}

/**
 * 将已有的 Uploader 实例包装为 Vue 2 响应式结构
 * 
 * 适用于从 `manager.restore()` 恢复的 uploader，
 * 将其包装成和 `useUpload` 相同的响应式返回值。
 * 
 * @param uploader - Uploader 实例
 * @returns 响应式状态和控制方法
 * 
 * @example
 * ```js
 * const restored = await manager.restore({ networkAdapter });
 * restored.forEach(uploader => {
 *   const ctrl = wrapUploader(uploader);
 *   this.uploads.push({ fileName: uploader.getTask().fileName, ctrl });
 * });
 * ```
 */
export function wrapUploader(uploader: Uploader): IUseUploadReturn {
  const initialTask = uploader.getTask();

  // 使用 Vue.observable 创建响应式状态
  const state: IUploadState = getVue().observable({
    status: initialTask.status as string,
    progress: initialTask.progress,
    speed: initialTask.speed,
    remainingTime: initialTask.remainingTime,
    error: null as ITransferError | null,
    task: { ...initialTask } as ITransferTask | null,
    isUploading: isStatusUploading(initialTask.status),
    isPaused: isStatusPaused(initialTask.status),
    isCompleted: isStatusCompleted(initialTask.status),
    isFailed: isStatusFailed(initialTask.status),
  });

  // 事件订阅，收集取消函数
  const unsubscribes: (() => void)[] = [];

  // 监听状态变化
  unsubscribes.push(
    uploader.on('statusChange', () => {
      syncUploadState(state, uploader);
    }),
  );

  // 监听进度更新
  unsubscribes.push(
    uploader.on('progress', () => {
      syncUploadState(state, uploader);
    }),
  );

  // 监听错误
  unsubscribes.push(
    uploader.on('error', () => {
      syncUploadState(state, uploader);
    }),
  );

  // 清理函数
  const cleanup = () => {
    unsubscribes.forEach((unsub) => unsub());
    unsubscribes.length = 0;
  };

  return {
    state,
    start: () => uploader.start(),
    pause: () => uploader.pause(),
    resume: () => uploader.resume(),
    cancel: () => uploader.cancel(),
    uploader,
    cleanup,
  };
}

// ============================================================
// useDownload
// ============================================================

/**
 * Vue 2 文件下载 composable
 * 
 * @param manager - TransferManager 实例
 * @param url - 下载地址
 * @param config - 下载配置
 * @param groupId - 可选的分组 ID
 * @returns 响应式状态和控制方法
 */
export function useDownload(
  manager: TransferManager,
  url: string,
  config: Omit<IDownloadConfig, 'downloadUrl'>,
  groupId?: string,
): IUseDownloadReturn {
  // 创建 downloader
  const downloader = manager.createDownloader(url, config, groupId);
  const initialTask = downloader.getTask();

  // 使用 Vue.observable 创建响应式状态
  const state: IDownloadState = getVue().observable({
    status: initialTask.status as string,
    progress: initialTask.progress,
    speed: initialTask.speed,
    remainingTime: initialTask.remainingTime,
    error: null as ITransferError | null,
    task: { ...initialTask } as ITransferTask | null,
    isDownloading: false,
    isPaused: false,
    isCompleted: false,
    isFailed: false,
  });

  // 事件订阅
  const unsubscribes: (() => void)[] = [];

  unsubscribes.push(
    downloader.on('statusChange', () => {
      syncDownloadState(state, downloader);
    }),
  );

  unsubscribes.push(
    downloader.on('progress', () => {
      syncDownloadState(state, downloader);
    }),
  );

  unsubscribes.push(
    downloader.on('error', () => {
      syncDownloadState(state, downloader);
    }),
  );

  const cleanup = () => {
    unsubscribes.forEach((unsub) => unsub());
    unsubscribes.length = 0;
  };

  return {
    state,
    start: () => downloader.start(),
    pause: () => downloader.pause(),
    resume: () => downloader.resume(),
    cancel: () => downloader.cancel(),
    downloader,
    cleanup,
  };
}

// ============================================================
// useTransferList
// ============================================================

/**
 * Vue 2 任务列表 composable
 * 
 * 提供对 TransferManager 中所有任务的响应式视图。
 * 调用 `refresh()` 手动刷新任务列表。
 * 
 * @param manager - TransferManager 实例
 * @returns 响应式任务列表和刷新方法
 */
export function useTransferList(
  manager: TransferManager,
): IUseTransferListReturn {
  const state = getVue().observable({
    tasks: manager.getAllTasks() as ITransferTask[],
  });

  const refresh = () => {
    // Vue.observable 的数组需要通过 splice 来触发响应式更新
    const newTasks = manager.getAllTasks();
    state.tasks.splice(0, state.tasks.length, ...newTasks);
  };

  return {
    state,
    refresh,
  };
}

// ============================================================
// Vue 2 Mixin (便捷方式)
// ============================================================

/**
 * Vue 2 Mixin - 在 beforeDestroy 生命周期内自动清理
 * 
 * @example
 * ```js
 * import { fluxTransferMixin, useUpload } from 'flux-transfer/vue2';
 * 
 * export default {
 *   mixins: [fluxTransferMixin],
 *   methods: {
 *     handleUpload(file) {
 *       const ctrl = useUpload(this.manager, file, config);
 *       this.$fluxCleanups.push(ctrl.cleanup);
 *       this.uploadState = ctrl.state;
 *     },
 *   },
 * };
 * ```
 */
export const fluxTransferMixin = {
  beforeCreate(this: { $fluxCleanups: (() => void)[] }) {
    this.$fluxCleanups = [];
  },
  beforeDestroy(this: { $fluxCleanups: (() => void)[] }) {
    if (this.$fluxCleanups) {
      this.$fluxCleanups.forEach((fn) => fn());
      this.$fluxCleanups.length = 0;
    }
  },
};
