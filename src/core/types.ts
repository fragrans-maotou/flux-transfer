/**
 * Flux Transfer SDK 核心类型和接口
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  NetworkTimeout = 'NETWORK_TIMEOUT',
  NetworkOffline = 'NETWORK_OFFLINE',
  ServerError = 'SERVER_ERROR',
  ClientError = 'CLIENT_ERROR',
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  FileNotFound = 'FILE_NOT_FOUND',
  FileTooLarge = 'FILE_TOO_LARGE',
  UnsupportedFileType = 'UNSUPPORTED_FILE_TYPE',
  QuotaExceeded = 'QUOTA_EXCEEDED',
  HashCalculationFailed = 'HASH_CALCULATION_FAILED',
  ChunkUploadFailed = 'CHUNK_UPLOAD_FAILED',
  ChunkMergeFailed = 'CHUNK_MERGE_FAILED',
  BrowserNotSupported = 'BROWSER_NOT_SUPPORTED',
  Unknown = 'UNKNOWN',
}

/**
 * 传输错误接口
 */
export interface ITransferError {
  code: ErrorCode;
  message: string;
  originalError?: Error;
  timestamp: number;
  retryable: boolean;
}

/**
 * 任务状态类型
 */
export type TaskStatus = 'idle' | 'processing' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * 传输类型
 */
export type TransferType = 'upload' | 'download';

/**
 * 统一的传输任务数据模型
 */
export interface ITransferTask {
  id: string;              // 唯一任务ID
  type: TransferType; 
  status: TaskStatus;
  file: File | null;       // 原始文件对象（上传时）
  url: string | null;      // 目标URL（下载时）
  
  // 进度相关
  progress: number;        // 0-100
  uploadedBytes: number;
  totalBytes: number;
  speed: number;           // bytes per second
  remainingTime: number;   // 预估剩余时间 (ms)
  
  // 策略专用元数据 (如：分片信息、MD5、存储的 checkpoint ID 等)
  meta: Record<string, any>; 
  
  error?: Error | ITransferError;
}

/**
 * 传输选项，用于向任务注入业务层面的额外数据与行为元信息
 */
export interface ITransferOptions {
  data?: Record<string, any>; // 随同文件发送给后端的额外表单数据
  meta?: Record<string, any>; // 存在客户端 Store 中的自定义元数据 (例如触发什么 Hook 的标识 action)
  uploadUrl?: string;         // 针对单个任务覆盖的上传 URL
  mergeUrl?: string | false;  // 针对单个任务覆盖的合并 URL (或者 false 禁用)
}

/**
 * 全局插件机制，用于拦截生命周期事件
 */
export interface ITransferPlugin {
  name: string;
  onTaskCreated?: (task: ITransferTask) => void | Promise<void>;
  onTaskProgress?: (task: ITransferTask) => void | Promise<void>;
  onTaskCompleted?: (task: ITransferTask) => void | Promise<void>;
  onTaskFailed?: (task: ITransferTask) => void | Promise<void>;
}


/**
 * Store 的状态模型
 */
export interface IStoreState {
  tasks: Record<string, ITransferTask>;
  globalProgress: number;
}

/**
 * Store 的 Action 类型
 */
export type StoreActionType = 'ADD_TASK' | 'UPDATE_TASK' | 'REMOVE_TASK';

export interface IStoreAction {
  type: StoreActionType;
  payload: any;
}

/**
 * Store 接口设计，提供发布-订阅模型
 */
export interface IStore {
  getState(): IStoreState;
  getTask(id: string): ITransferTask | undefined;
  
  dispatch(action: IStoreAction): void;
  subscribe(listener: (state: IStoreState) => void): () => void;
}

/**
 * 网络请求配置
 */
export interface INetworkRequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: Blob | FormData | string | ArrayBuffer;
  timeout?: number;
  withCredentials?: boolean;
  onProgress?: (loaded: number, total: number) => void;
  onUploadProgress?: (loaded: number, total: number) => void;
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
  signal?: AbortSignal;
}

/**
 * 网络响应接口
 */
export interface INetworkResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/**
 * 网络适配器接口
 */
export interface INetworkAdapter {
  request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>>;
  abort(requestId?: string): void;
}

/**
 * 用于持久化的存储适配器接口
 */
export interface IStorageAdapter {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export interface ISequentialUploadConfig {
  offsetParamName?: string; // 请求时表示位置的字段名，默认为 'position'
  offsetLocation?: 'body' | 'query'; // position 字段存放的位置，默认 'body' (即 FormData 中)
  fileParamName?: string;   // 请求时表示文件的字段名，默认为 'file'
  getOffsetFromResponse?: (response: any) => number | undefined; // 提取下一个游标位置
  getSessionDataFromResponse?: (response: any) => Record<string, any> | undefined; // 提取 session 态数据（如 document_id）
}

/**
 * SDK 配置接口 
 */
export interface ISDKConfig {
  maxConcurrent?: number;
  chunkSize?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  autoRetry?: boolean;
  enableCheckpoint?: boolean;
  storageAdapter?: IStorageAdapter;
  networkAdapter?: INetworkAdapter;
  headers?: Record<string, string>;
  baseURL?: string;
  enableHash?: boolean;
  maxFileSize?: number;
  plugins?: ITransferPlugin[];
  customUploadStrategies?: ITransferStrategy[];
  customDownloadStrategies?: ITransferStrategy[];
  uploadUrl?: string;
  mergeUrl?: string | false;
  useSequentialChunking?: boolean; // 是否默认开启串行游标分块模式
  sequentialConfig?: ISequentialUploadConfig;
}

/**
 * 默认 SDK 配置
 */
export const DEFAULT_SDK_CONFIG: Required<Omit<ISDKConfig, 'storageAdapter' | 'networkAdapter' | 'allowedFileTypes' | 'plugins' | 'customUploadStrategies' | 'customDownloadStrategies' | 'uploadUrl' | 'mergeUrl' | 'useSequentialChunking' | 'sequentialConfig'>> = {
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
 */
export function validateConfig(config: ISDKConfig = {}): ISDKConfig {
  const merged = { ...DEFAULT_SDK_CONFIG, ...config };

  if (merged.maxConcurrent < 1) throw new Error('maxConcurrent must be at least 1');
  if (merged.chunkSize < 1024) throw new Error('chunkSize must be at least 1KB');
  if (merged.chunkSize > 100 * 1024 * 1024) throw new Error('chunkSize must not exceed 100MB');
  if (merged.maxRetries < 0) throw new Error('maxRetries must be non-negative');
  if (merged.retryDelay < 0) throw new Error('retryDelay must be non-negative');
  if (merged.timeout < 1000) throw new Error('timeout must be at least 1000ms');
  if (merged.maxFileSize < 0) throw new Error('maxFileSize must be non-negative');

  return merged;
}

/**
 * 引擎上下文环境
 */
export interface ITransferContext {
  task: ITransferTask;
  store: IStore;
  network?: INetworkAdapter;
  config: ISDKConfig;
  abortController: AbortController;
}

/**
 * 传输策略接口
 */
export interface ITransferStrategy {
  canHandle(task: ITransferTask, config: ISDKConfig): boolean; 
  execute(context: ITransferContext): Promise<void>;           
}
