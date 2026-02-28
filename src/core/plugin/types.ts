/**
 * Plugin System Interfaces
 */
import type { INetworkRequestConfig, ITransferTask } from '../types';
import type { Uploader } from '../uploader/Uploader';

/**
 * Context passed to plugin hooks
 */
export interface IPluginContext {
  /** The current transfer task */
  task: ITransferTask;
  /** Uploader instance (restricted access in future, full access for now) */
  uploader: Uploader;
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
   * Middleware hook: Transform network request before it is sent
   * Useful for adding custom headers, authentication signatures, etc.
   */
  transformRequest?(config: INetworkRequestConfig): Promise<INetworkRequestConfig>;
}
