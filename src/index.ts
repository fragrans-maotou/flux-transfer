/**
 * Flux Transfer SDK - Entry Point
 * Production-grade file transfer SDK
 */

// Core exports will be added as modules are implemented
export * from './core/types';
export { BaseTransfer } from './core/BaseTransfer';
export { Uploader, type IUploadConfig } from './core/Uploader';
export { Downloader, type IDownloadConfig } from './core/Downloader';
export { TaskQueue, TaskPriority } from './core/TaskQueue';
export { TransferManager } from './core/TransferManager';

// Infrastructure
export { EventEmitter } from './infra/EventEmitter';
export { IndexedDBStorage } from './infra/storage/IndexedDBStorage';
export { FetchAdapter } from './infra/network/FetchAdapter';
export { XHRAdapter } from './infra/network/XHRAdapter';
export { NetworkAdapterFactory, type NetworkAdapterType, type INetworkAdapterOptions } from './infra/network/NetworkAdapterFactory';
export { HashCalculator, type IHashResult, type IHashOptions } from './infra/worker/HashCalculator';

// Uploader utilities
export { ChunkManager, type IChunk } from './core/uploader/ChunkManager';

// Download strategies
export {
  type IDownloadStrategy,
  type IDownloadStrategyConfig,
  type IDownloadResult,
  type IDownloadProgress,
  type DownloadStrategyType,
  type IStreamSaverConfig,
  FetchBlobStrategy,
  DirectLinkStrategy,
  StreamSaverStrategy,
  DownloadStrategyFactory,
} from './strategies';

// Version
export const VERSION = '0.1.0';
