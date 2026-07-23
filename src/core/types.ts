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
  resumeDescriptor?: IResumeDescriptor;
  error?: Error;
  result?: unknown;
}

export interface IFileIdentity {
  name: string;
  size: number;
  lastModified: number;
  hash?: string;
}

/** Non-sensitive information needed to safely restore an upload. */
export interface IResumeDescriptor {
  version: 1;
  file: IFileIdentity;
  chunkSize: number;
  uploadUrl: string;
  chunkUrl: string;
  completeUrl: string | false;
  protocolId: string;
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
export type TransferPhase = UploadPhase | 'download';

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
  idempotencyHeader: string | false;
}

export interface IUploadProtocol {
  createDirectRequest?(context: IUploadProtocolContext): INetworkRequestConfig;
  createChunkRequest?(context: IUploadProtocolContext): INetworkRequestConfig;
  createCompleteRequest?(context: IUploadProtocolContext): INetworkRequestConfig | null;
  reconcileUpload?(
    context: IUploadProtocolContext,
  ): IUploadReconciliation | Promise<IUploadReconciliation>;
  parseResponse?(
    phase: UploadPhase,
    response: INetworkResponse,
    context: IUploadProtocolContext,
  ): Record<string, unknown> | void;
}

export interface IUploadReconciliation {
  uploadedChunks: number[];
  session?: Record<string, unknown>;
}

export interface IRetryContext {
  attempt: number;
  maxRetries: number;
  phase: TransferPhase;
  request: INetworkRequestConfig;
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
  protocolId?: string;
  idempotencyHeader?: string | false;
  shouldRetry?: (error: unknown, context: IRetryContext) => boolean;
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
  protocolId?: string;
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
  protocolId: string;
  idempotencyHeader: string | false;
  shouldRetry?: (error: unknown, context: IRetryContext) => boolean;
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
    protocolId: config.protocolId ?? (config.protocol ? 'custom' : 'default-v1'),
    idempotencyHeader: config.idempotencyHeader ?? false,
    shouldRetry: config.shouldRetry,
    protocol: config.protocol,
    networkAdapter: config.networkAdapter,
    storageAdapter: config.storageAdapter,
  };

  assertInteger('chunkSize', resolved.chunkSize, 1024);
  assertInteger('concurrency', resolved.concurrency, 1);
  assertInteger('retries', resolved.retries, 0);
  assertFiniteNumber('retryDelay', resolved.retryDelay, 0);
  assertFiniteNumber('timeout', resolved.timeout, 1);
  assertFiniteNumber('maxFileSize', resolved.maxFileSize, 0);
  if (!resolved.protocolId) throw new Error('protocolId must not be empty');

  return resolved;
}

function assertInteger(name: string, value: number, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
}

function assertFiniteNumber(name: string, value: number, minimum: number): void {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a finite number greater than or equal to ${minimum}`);
  }
}
