/**
 * Core Types and Interfaces for Flux Transfer SDK
 */

/**
 * Task status enumeration
 */
export enum TaskStatus {
  /** Task is created but not started */
  Idle = 'idle',
  /** Task is being prepared (e.g., calculating hash, checking file size) */
  Processing = 'processing',
  /** Task is actively transferring data */
  Transferring = 'transferring',
  /** Task is paused by user */
  Paused = 'paused',
  /** Task completed successfully */
  Completed = 'completed',
  /** Task failed with error */
  Failed = 'failed',
  /** Task was cancelled by user */
  Cancelled = 'cancelled',
}

/**
 * Error code enumeration
 */
export enum ErrorCode {
  /** Network timeout error */
  NetworkTimeout = 'NETWORK_TIMEOUT',
  /** Network disconnected */
  NetworkOffline = 'NETWORK_OFFLINE',
  /** Server error (5xx) */
  ServerError = 'SERVER_ERROR',
  /** Client error (4xx) */
  ClientError = 'CLIENT_ERROR',
  /** Authentication failed */
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  /** File not found */
  FileNotFound = 'FILE_NOT_FOUND',
  /** File too large */
  FileTooLarge = 'FILE_TOO_LARGE',
  /** Unsupported file type */
  UnsupportedFileType = 'UNSUPPORTED_FILE_TYPE',
  /** Storage quota exceeded */
  QuotaExceeded = 'QUOTA_EXCEEDED',
  /** Hash calculation failed */
  HashCalculationFailed = 'HASH_CALCULATION_FAILED',
  /** Chunk upload failed */
  ChunkUploadFailed = 'CHUNK_UPLOAD_FAILED',
  /** Chunk merge failed */
  ChunkMergeFailed = 'CHUNK_MERGE_FAILED',
  /** Browser not supported */
  BrowserNotSupported = 'BROWSER_NOT_SUPPORTED',
  /** Unknown error */
  Unknown = 'UNKNOWN',
}

/**
 * Transfer error interface
 */
export interface ITransferError {
  /** Error code */
  code: ErrorCode;
  /** Error message */
  message: string;
  /** Original error object */
  originalError?: Error;
  /** Timestamp when error occurred */
  timestamp: number;
  /** Whether the error is retryable */
  retryable: boolean;
}

/**
 * Transfer checkpoint for resume capability
 */
export interface ITransferCheckpoint {
  /** Task ID */
  taskId: string;
  /** Uploaded chunks (for upload) or downloaded bytes (for download) */
  completedChunks?: number[];
  /** Total transferred bytes */
  transferredBytes: number;
  /** File hash (for verification) */
  fileHash?: string;
  /** Last update timestamp */
  timestamp: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Transfer task interface
 */
export interface ITransferTask {
  /** Unique task ID */
  id: string;
  /** Task status */
  status: TaskStatus;
  /** File name */
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  /** File type (MIME type) */
  fileType: string;
  /** Transfer progress (0-100) */
  progress: number;
  /** Transfer speed in bytes per second */
  speed: number;
  /** Remaining time in seconds */
  remainingTime: number;
  /** Error information if failed */
  error?: ITransferError;
  /** Checkpoint for resume */
  checkpoint?: ITransferCheckpoint;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Network request configuration
 */
export interface INetworkRequestConfig {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: Blob | FormData | string | ArrayBuffer;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Whether to include credentials */
  withCredentials?: boolean;
  /** Progress callback */
  onProgress?: (loaded: number, total: number) => void;
  /** Response type */
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
}

/**
 * Network response interface
 */
export interface INetworkResponse<T = unknown> {
  /** Response data */
  data: T;
  /** Response status code */
  status: number;
  /** Response status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
}

/**
 * Network adapter interface
 */
export interface INetworkAdapter {
  /**
   * Execute network request
   * @param config Request configuration
   * @returns Promise resolving to response
   */
  request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>>;

  /**
   * Abort ongoing request
   * @param requestId Optional request ID to abort specific request
   */
  abort(requestId?: string): void;
}

/**
 * Storage adapter interface for persistence
 */
export interface IStorageAdapter {
  /**
   * Get value by key
   * @param key Storage key
   * @returns Promise resolving to stored value or null
   */
  get<T = unknown>(key: string): Promise<T | null>;

  /**
   * Set value by key
   * @param key Storage key
   * @param value Value to store
   * @returns Promise resolving when complete
   */
  set<T = unknown>(key: string, value: T): Promise<void>;

  /**
   * Remove value by key
   * @param key Storage key
   * @returns Promise resolving when complete
   */
  remove(key: string): Promise<void>;

  /**
   * Clear all stored values
   * @returns Promise resolving when complete
   */
  clear(): Promise<void>;

  /**
   * Get all keys
   * @returns Promise resolving to array of keys
   */
  keys(): Promise<string[]>;
}

/**
 * SDK configuration interface
 */
export interface ISDKConfig {
  /** Maximum concurrent tasks */
  maxConcurrent?: number;
  /** Chunk size for file upload in bytes (default: 5MB) */
  chunkSize?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Whether to enable auto-retry on failure */
  autoRetry?: boolean;
  /** Whether to enable checkpoint/resume */
  enableCheckpoint?: boolean;
  /** Storage adapter for checkpoint persistence */
  storageAdapter?: IStorageAdapter;
  /** Network adapter for HTTP requests */
  networkAdapter?: INetworkAdapter;
  /** Custom headers for all requests */
  headers?: Record<string, string>;
  /** Base URL for API endpoints */
  baseURL?: string;
  /** Whether to calculate file hash */
  enableHash?: boolean;
  /** Maximum file size in bytes (0 = unlimited) */
  maxFileSize?: number;
  /** Allowed file types (MIME types or extensions) */
  allowedFileTypes?: string[];
}

/**
 * Default SDK configuration
 */
export const DEFAULT_SDK_CONFIG: Required<Omit<ISDKConfig, 'storageAdapter' | 'networkAdapter' | 'allowedFileTypes'>> = {
  maxConcurrent: 3,
  chunkSize: 5 * 1024 * 1024, // 5MB
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  timeout: 30000, // 30 seconds
  autoRetry: true,
  enableCheckpoint: true,
  headers: {},
  baseURL: '',
  enableHash: true,
  maxFileSize: 0, // unlimited
};

/**
 * Validate SDK configuration
 * @param config User-provided configuration
 * @returns Validated and merged configuration
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: ISDKConfig = {}): ISDKConfig {
  const merged = { ...DEFAULT_SDK_CONFIG, ...config };

  // Validate maxConcurrent
  if (merged.maxConcurrent < 1) {
    throw new Error('maxConcurrent must be at least 1');
  }

  // Validate chunkSize
  if (merged.chunkSize < 1024) {
    throw new Error('chunkSize must be at least 1KB');
  }

  if (merged.chunkSize > 100 * 1024 * 1024) {
    throw new Error('chunkSize must not exceed 100MB');
  }

  // Validate maxRetries
  if (merged.maxRetries < 0) {
    throw new Error('maxRetries must be non-negative');
  }

  // Validate retryDelay
  if (merged.retryDelay < 0) {
    throw new Error('retryDelay must be non-negative');
  }

  // Validate timeout
  if (merged.timeout < 1000) {
    throw new Error('timeout must be at least 1000ms');
  }

  // Validate maxFileSize
  if (merged.maxFileSize < 0) {
    throw new Error('maxFileSize must be non-negative');
  }

  return merged;
}

/**
 * Event types for transfer tasks
 */
export type TransferEventType =
  | 'statusChange'
  | 'progress'
  | 'error'
  | 'completed'
  | 'cancelled'
  | 'paused'
  | 'resumed';

/**
 * Event data interface
 */
export interface ITransferEventData {
  /** Task ID */
  taskId: string;
  /** Event type */
  type: TransferEventType;
  /** Event payload */
  payload?: unknown;
  /** Event timestamp */
  timestamp: number;
}
