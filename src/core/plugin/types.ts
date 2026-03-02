/**
 * Plugin System Interfaces
 */
import type { INetworkRequestConfig, ITransferTask } from '../types';
import type { Uploader } from '../uploader/Uploader';

/** 分组状态 */
export interface IGroupStatus {
  /** 总任务数 */
  total: number;
  /** 已完成数 */
  completed: number;
  /** 失败数 */
  failed: number;
  /** 聚合进度 (0-100) */
  progress: number;
  /** 是否全部完成 */
  isAllCompleted: boolean;
}

/**
 * TransferManager 引用接口（避免循环依赖）
 * 
 * 插件通过此接口查询分组状态等信息
 */
export interface ITransferManagerRef {
  getGroupStatus(groupId: string): IGroupStatus;
  getAllTasks(): ITransferTask[];
  getTasksByGroup(groupId: string): ITransferTask[];
}

/**
 * Context passed to plugin hooks
 */
export interface IPluginContext {
  /** The current transfer task */
  task: ITransferTask;
  /** Uploader instance (restricted access in future, full access for now) */
  uploader: Uploader;
  /** TransferManager 引用，可用于查询分组状态等 */
  manager?: ITransferManagerRef;
}

/**
 * Plugin Interface
 * Plugins can hook into various lifecycle events of the upload process.
 */
export interface IPlugin {
  /** Unique name of the plugin */
  name: string;
  /** Plugin version */
  version?: string;

  /**
   * Called when a task is created
   */
  onTaskCreated?(context: IPluginContext): void | Promise<void>;

  /**
   * Called before upload starts
   */
  beforeStart?(context: IPluginContext): void | Promise<void>;

  /**
   * Called after upload successfully starts
   */
  afterStart?(context: IPluginContext): void | Promise<void>;

  /**
   * Called on upload progress
   */
  onProgress?(context: IPluginContext, progress: number): void;

  /**
   * Called when upload completes successfully
   */
  onSuccess?(context: IPluginContext): void | Promise<void>;

  /**
   * Called when upload fails
   */
  onError?(context: IPluginContext, error: Error): void | Promise<void>;

  /**
   * Called when upload is cancelled
   */
  onCancel?(context: IPluginContext): void | Promise<void>;

  /**
   * Middleware hook: Transform network request before it is sent
   * Useful for adding custom headers, authentication signatures, etc.
   */
  transformRequest?(config: INetworkRequestConfig): Promise<INetworkRequestConfig>;
}
