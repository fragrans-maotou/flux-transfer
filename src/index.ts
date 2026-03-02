/**
 * Flux Transfer SDK - Entry Point
 * Production-grade file transfer SDK
 */

// Core exports will be added as modules are implemented
export { BaseTransfer } from './core/BaseTransfer';
export { Downloader, type IDownloadConfig } from './core/downloader/Downloader';
export type { IGroupStatus, IPlugin, IPluginContext, ITransferManagerRef } from './core/plugin/types';
export { TaskPriority, TaskQueue } from './core/TaskQueue';
export { TransferManager } from './core/TransferManager';
export * from './core/types';
export { Uploader, type IUploadConfig } from './core/uploader/Uploader';

// Infrastructure
export { EventEmitter } from './infra/EventEmitter';
export { FetchAdapter } from './infra/network/FetchAdapter';
export {
  NetworkAdapterFactory,
  type INetworkAdapterOptions,
  type NetworkAdapterType
} from './infra/network/NetworkAdapterFactory';
export { XHRAdapter } from './infra/network/XHRAdapter';
export { IndexedDBStorage } from './infra/storage/IndexedDBStorage';
export {
  HashCalculator,
  type IHashOptions,
  type IHashResult
} from './infra/worker/HashCalculator';

// Uploader utilities
export { ChunkManager, type IChunk } from './core/uploader/ChunkManager';

// Download strategies
export {
  DirectLinkStrategy,
  DownloadStrategyFactory,
  FetchBlobStrategy,
  StreamSaverStrategy,
  type DownloadStrategyType,
  type IDownloadProgress,
  type IDownloadResult,
  type IDownloadStrategy,
  type IDownloadStrategyConfig,
  type IStreamSaverConfig
} from './strategies';

// Version
export const VERSION = '0.1.0';
