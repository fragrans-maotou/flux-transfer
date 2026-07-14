export type TaskStatus =
  | 'idle'
  | 'hashing'
  | 'transferring'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TransferType = 'upload' | 'download';

export interface ITransferTask {
  id: string;
  type: TransferType;
  status: TaskStatus;
  file: File | null;
  fileName: string;
  fileHash?: string;
  url: string;
  progress: number;
  transferredBytes: number;
  totalBytes: number;
  speed: number;
  remainingTime: number;
  data: Record<string, unknown>;
  session: Record<string, unknown>;
  error?: Error;
  result?: unknown;
}

export interface IStoreState {
  tasks: Record<string, ITransferTask>;
  globalProgress: number;
}

export type IStoreAction =
  | { type: 'ADD_TASK'; payload: ITransferTask }
  | { type: 'UPDATE_TASK'; payload: { id: string; updates: Partial<ITransferTask> } }
  | { type: 'REMOVE_TASK'; payload: { id: string } };

export interface IStore {
  getState(): IStoreState;
  getTask(id: string): ITransferTask | undefined;
  dispatch(action: IStoreAction): void;
  subscribe(listener: (state: IStoreState) => void): () => void;
}

export interface INetworkRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: BodyInit | null;
  timeout?: number;
  credentials?: RequestCredentials;
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
  signal?: AbortSignal;
  onDownloadProgress?: (loaded: number, total: number) => void;
}

export interface INetworkResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface INetworkAdapter {
  request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>>;
}

export interface IStorageAdapter {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export interface IUploadFields {
  file: string;
  chunkIndex: string;
  totalChunks: string;
  fileHash: string;
  fileName: string;
}

export type UploadPhase = 'direct' | 'chunk' | 'complete';

export interface IUploadProtocolContext {
  task: ITransferTask;
  file: File;
  chunk?: Blob;
  chunkIndex?: number;
  totalChunks?: number;
  fields: IUploadFields;
  indexBase: 0 | 1;
  uploadUrl: string;
  chunkUrl: string;
  completeUrl: string | false;
  headers: Record<string, string>;
  timeout: number;
  credentials: RequestCredentials;
}

export interface IUploadProtocol {
  createDirectRequest?(context: IUploadProtocolContext): INetworkRequestConfig;
  createChunkRequest?(context: IUploadProtocolContext): INetworkRequestConfig;
  createCompleteRequest?(context: IUploadProtocolContext): INetworkRequestConfig | null;
  parseResponse?(
    phase: UploadPhase,
    response: INetworkResponse,
    context: IUploadProtocolContext,
  ): Record<string, unknown> | void;
}

export interface ISDKConfig {
  uploadUrl?: string;
  chunkUrl?: string;
  completeUrl?: string | false;
  chunkSize?: number;
  concurrency?: number;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  hash?: boolean;
  maxFileSize?: number;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  fields?: Partial<IUploadFields>;
  chunkIndexBase?: 0 | 1;
  protocol?: IUploadProtocol;
  networkAdapter?: INetworkAdapter;
  storageAdapter?: IStorageAdapter;
}

export interface ITransferOptions {
  url?: string;
  chunkUrl?: string;
  completeUrl?: string | false;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
  filename?: string;
  protocol?: IUploadProtocol;
}

export interface IResumeOptions extends ITransferOptions {
  file?: File;
}

export interface IResolvedSDKConfig {
  uploadUrl: string;
  chunkUrl: string;
  completeUrl: string | false;
  chunkSize: number;
  concurrency: number;
  retries: number;
  retryDelay: number;
  timeout: number;
  hash: boolean;
  maxFileSize: number;
  headers: Record<string, string>;
  credentials: RequestCredentials;
  fields: IUploadFields;
  chunkIndexBase: 0 | 1;
  protocol?: IUploadProtocol;
  networkAdapter?: INetworkAdapter;
  storageAdapter?: IStorageAdapter;
}

const DEFAULT_FIELDS: IUploadFields = {
  file: 'file',
  chunkIndex: 'chunkIndex',
  totalChunks: 'totalChunks',
  fileHash: 'fileHash',
  fileName: 'filename',
};

export function resolveConfig(config: ISDKConfig = {}): IResolvedSDKConfig {
  const resolved: IResolvedSDKConfig = {
    uploadUrl: config.uploadUrl ?? '',
    chunkUrl: config.chunkUrl ?? config.uploadUrl ?? '',
    completeUrl: config.completeUrl ?? false,
    chunkSize: config.chunkSize ?? 5 * 1024 * 1024,
    concurrency: config.concurrency ?? 3,
    retries: config.retries ?? 2,
    retryDelay: config.retryDelay ?? 500,
    timeout: config.timeout ?? 30_000,
    hash: config.hash ?? true,
    maxFileSize: config.maxFileSize ?? 0,
    headers: { ...config.headers },
    credentials: config.credentials ?? 'same-origin',
    fields: { ...DEFAULT_FIELDS, ...config.fields },
    chunkIndexBase: config.chunkIndexBase ?? 0,
    protocol: config.protocol,
    networkAdapter: config.networkAdapter,
    storageAdapter: config.storageAdapter,
  };

  if (resolved.chunkSize < 1024) throw new Error('chunkSize must be at least 1KB');
  if (resolved.concurrency < 1) throw new Error('concurrency must be at least 1');
  if (resolved.retries < 0) throw new Error('retries must be non-negative');
  if (resolved.retryDelay < 0) throw new Error('retryDelay must be non-negative');
  if (resolved.timeout < 1) throw new Error('timeout must be positive');
  if (resolved.maxFileSize < 0) throw new Error('maxFileSize must be non-negative');

  return resolved;
}
