/**
 * Flux Transfer SDK 核心类型和接口
 */

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  /** 任务创建但未开始 */
  Idle = 'idle',
  /** 任务正在准备（例如，计算哈希，检查文件大小） */
  Processing = 'processing',
  /** 任务正在传输数据 */
  Transferring = 'transferring',
  /** 任务暂停 */
  Paused = 'paused',
  /** 任务完成 */
  Completed = 'completed',
  /** 任务失败 */
  Failed = 'failed',
  /** 任务被用户取消 */
  Cancelled = 'cancelled',
}

/**
 * 传输类型枚举
 */
export enum TransferType {
  /** 上传 */
  Upload = 'upload',
  /** 下载 */
  Download = 'download',
}


/**
 * 错误代码枚举
 */
export enum ErrorCode {
  /** 网络超时 */
  NetworkTimeout = 'NETWORK_TIMEOUT',
  /** 网络断开 */
  NetworkOffline = 'NETWORK_OFFLINE',
  /** 服务器错误（5xx） */
  ServerError = 'SERVER_ERROR',
  /** 客户端错误（4xx） */
  ClientError = 'CLIENT_ERROR',
  /** 认证失败 */
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  /** 文件未找到 */
  FileNotFound = 'FILE_NOT_FOUND',
  /** 文件太大 */
  FileTooLarge = 'FILE_TOO_LARGE',
  /** 不支持的文件类型 */
  UnsupportedFileType = 'UNSUPPORTED_FILE_TYPE',
  /** 存储配额已用尽 */
  QuotaExceeded = 'QUOTA_EXCEEDED',
  /** 哈希计算失败 */
  HashCalculationFailed = 'HASH_CALCULATION_FAILED',
  /** 分块上传失败 */
  ChunkUploadFailed = 'CHUNK_UPLOAD_FAILED',
  /** 分块合并失败 */
  ChunkMergeFailed = 'CHUNK_MERGE_FAILED',
  /** 浏览器不支持 */
  BrowserNotSupported = 'BROWSER_NOT_SUPPORTED',
  /** 未知错误 */
  Unknown = 'UNKNOWN',
}

/**
 * 传输错误接口
 */
export interface ITransferError {
  /** 错误代码 */
  code: ErrorCode;
  /** 错误消息 */
  message: string;
  /** 原始错误对象 */
  originalError?: Error;
  /** 错误发生的时间戳 */
  timestamp: number;
  /** 是否可重试 */
  retryable: boolean;
}

/**
 * 用于断点续传的传输检查点
 */
export interface ITransferCheckpoint {
  /** 任务ID */
  taskId: string;
  /** 已上传的分块（上传）或已下载的字节数（下载） */
  completedChunks?: number[];
  /** 总传输字节数 */
  transferredBytes: number;
  /** 文件哈希（用于验证） */
  fileHash?: string;
  /** 最后更新时间戳 */
  timestamp: number;
  /** 文件指纹（md5(name+size+mtime+path)） */
  fingerprint?: string;
  /** 文件名 */
  fileName?: string;
  /** 文件大小 */
  fileSize?: number;
  /** 文件最后修改时间戳 */
  lastModified?: number;
  /** 文件相对路径 */
  path?: string;
  /** 文件对象（如果存储支持） */
  file?: File;
  /** 分块布局（用于动态分块） */
  chunkLayout?: { index: number; start: number; end: number }[];
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 传输任务接口
 */
export interface ITransferTask {
  /** 任务ID */
  id: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 文件名 */
  fileName: string;
  /** 文件大小 */
  fileSize: number;
  /** 文件类型（MIME类型） */
  fileType: string;
  /** 相对路径（用于文件夹上传） */
  path?: string;
  /** 传输进度（0-100） */
  progress: number;
  /** 传输速度（字节/秒） */
  speed: number;
  /** 剩余时间（秒） */
  remainingTime: number;
  /** 错误信息（如果失败） */
  error?: ITransferError;
  /** 恢复检查点 */
  checkpoint?: ITransferCheckpoint;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** 批量任务ID */
  groupId?: string;
  /** 文件哈希 */
  hash?: string;
  /** 传输类型（上传/下载） */
  transferType?: TransferType;
}

/**
 * 网络请求配置
 */
export interface INetworkRequestConfig {
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体 */
  body?: Blob | FormData | string | ArrayBuffer;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否包含凭据 */
  withCredentials?: boolean;
  /** 进度回调 */
  onProgress?: (loaded: number, total: number) => void;
  /** 响应类型 */
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
  /** 用于取消请求的 Abort 信号 */
  signal?: AbortSignal;
}

/**
 * 网络响应接口
 */
export interface INetworkResponse<T = unknown> {
  /** 响应数据 */
  data: T;
  /** 响应状态码 */
  status: number;
  /** 响应状态文本 */
  statusText: string;
  /** 响应头 */
  headers: Record<string, string>;
}

/**
 * 网络适配器接口
 */
export interface INetworkAdapter {
  /**
   * 执行网络请求
   * @param config 请求配置
   * @returns 返回响应的 Promise
   */
  request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>>;

  /**
   * 中止正在进行的请求
   * @param requestId 可选的请求 ID，用于中止特定请求
   */
  abort(requestId?: string): void;
}

/**
 * 用于持久化的存储适配器接口
 */
export interface IStorageAdapter {
  /**
   * 根据键获取值
   * @param key 存储键
   * @returns 返回存储值或 null 的 Promise
   */
  get<T = unknown>(key: string): Promise<T | null>;

  /**
   * 根据键设置值
   * @param key 存储键
   * @param value 要存储的值
   * @returns 完成时的 Promise
   */
  set<T = unknown>(key: string, value: T): Promise<void>;

  /**
   * 根据键移除值
   * @param key 存储键
   * @returns 完成时的 Promise
   */
  remove(key: string): Promise<void>;

  /**
   * 清除所有存储的值
   * @returns 完成时的 Promise
   */
  clear(): Promise<void>;

  /**
   * 获取所有键
   * @returns 返回键数组的 Promise
   */
  keys(): Promise<string[]>;
}

/**
 * SDK 配置接口 
 */
export interface ISDKConfig {
  /** 最大并发任务数 */
  maxConcurrent?: number;
  /** 文件上传分片大小（默认：5MB） */
  chunkSize?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试延迟时间（毫秒） */
  retryDelay?: number;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用自动重试 */
  autoRetry?: boolean;
  /** 是否启用检查点/恢复 */
  enableCheckpoint?: boolean;
  /** 用于检查点持久化的存储适配器 */
  storageAdapter?: IStorageAdapter;
  /** 用于 HTTP 请求的网络适配器 */
  networkAdapter?: INetworkAdapter;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** API 端点的基础 URL */
  baseURL?: string;
  /** 是否计算文件哈希 */
  enableHash?: boolean;
  /** 最大文件大小（字节，0 表示不限制） */
  maxFileSize?: number;
  /** 允许的文件类型（MIME 类型或扩展名） */
  allowedFileTypes?: string[];
  /** 用于 SDK 扩展的插件 */
  plugins?: import('./plugin/types').IPlugin[];
}

/**
 * 默认 SDK 配置
 */
export const DEFAULT_SDK_CONFIG: Required<Omit<ISDKConfig, 'storageAdapter' | 'networkAdapter' | 'allowedFileTypes' | 'plugins'>> = {
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
 * 验证 SDK 配置
 * @param config 用户提供的配置
 * @returns 验证并合并后的配置
 * @throws 如果配置无效则抛出错误
 */
export function validateConfig(config: ISDKConfig = {}): ISDKConfig {
  const merged = { ...DEFAULT_SDK_CONFIG, ...config };

  // 验证 maxConcurrent
  if (merged.maxConcurrent < 1) {
    throw new Error('maxConcurrent must be at least 1');
  }

  // 验证 chunkSize
  if (merged.chunkSize < 1024) {
    throw new Error('chunkSize must be at least 1KB');
  }

  if (merged.chunkSize > 100 * 1024 * 1024) {
    throw new Error('chunkSize must not exceed 100MB');
  }

  // 验证 maxRetries
  if (merged.maxRetries < 0) {
    throw new Error('maxRetries must be non-negative');
  }

  // 验证 retryDelay
  if (merged.retryDelay < 0) {
    throw new Error('retryDelay must be non-negative');
  }

  // 验证 timeout
  if (merged.timeout < 1000) {
    throw new Error('timeout must be at least 1000ms');
  }

  // 验证 maxFileSize
  if (merged.maxFileSize < 0) {
    throw new Error('maxFileSize must be non-negative');
  }

  return merged;
}

/**
 * 传输任务的事件类型
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
 * 事件数据接口
 */
export interface ITransferEventData {
  /** 任务 ID */
  taskId: string;
  /** 事件类型 */
  type: TransferEventType;
  /** 事件负载 */
  payload?: unknown;
  /** 事件时间戳 */
  timestamp: number;
}
