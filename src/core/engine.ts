import { FetchAdapter } from '../network/fetch-adapter';
import {
  createChunkRequest,
  createCompleteRequest,
  createDirectRequest,
} from './protocol';
import { createStorageMiddleware, STORAGE_KEY, type StoredTask } from './storage-middleware';
import { TransferStore } from './store';
import type {
  INetworkAdapter,
  INetworkRequestConfig,
  INetworkResponse,
  IResolvedSDKConfig,
  IResumeOptions,
  ISDKConfig,
  IStore,
  ITransferOptions,
  ITransferTask,
  IUploadProtocol,
  IUploadProtocolContext,
  UploadPhase,
} from './types';
import { resolveConfig } from './types';
import { computeFileHash } from './utils/hash';

export class TransferEngine {
  readonly store: IStore;
  readonly config: IResolvedSDKConfig;

  private readonly network: INetworkAdapter;
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Set<string>();
  private readonly options = new Map<string, ITransferOptions>();
  private readonly stopPersistence?: () => void;

  constructor(config: ISDKConfig = {}) {
    this.config = resolveConfig(config);
    this.store = new TransferStore();
    this.network = this.config.networkAdapter ?? new FetchAdapter();

    if (this.config.storageAdapter) {
      this.stopPersistence = createStorageMiddleware(this.store, this.config.storageAdapter);
    }
  }

  async init(): Promise<void> {
    if (!this.config.storageAdapter) return;

    const stored = await this.config.storageAdapter.get<StoredTask[]>(STORAGE_KEY);
    if (!Array.isArray(stored)) return;

    for (const task of stored) {
      this.store.dispatch({
        type: 'ADD_TASK',
        payload: {
          ...task,
          file: null,
          status: isTerminal(task.status) ? task.status : 'paused',
          speed: 0,
          remainingTime: 0,
        },
      });
    }
  }

  destroy(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.running.clear();
    this.options.clear();
    this.stopPersistence?.();
  }

  upload(file: File, options: ITransferOptions = {}): string {
    if (this.config.maxFileSize > 0 && file.size > this.config.maxFileSize) {
      throw new Error('File exceeds maxFileSize');
    }

    const url = options.url ?? this.config.uploadUrl;
    if (!url) throw new Error('uploadUrl is required');

    const id = createId();
    this.options.set(id, options);
    this.store.dispatch({
      type: 'ADD_TASK',
      payload: {
        id,
        type: 'upload',
        status: 'idle',
        file,
        fileName: options.filename ?? file.name,
        url,
        progress: 0,
        transferredBytes: 0,
        totalBytes: file.size,
        speed: 0,
        remainingTime: 0,
        data: { ...options.data },
        session: {},
      },
    });
    this.start(id);
    return id;
  }

  download(url: string, options: ITransferOptions = {}): string {
    if (!url) throw new Error('Download URL is required');

    const id = createId();
    this.options.set(id, options);
    this.store.dispatch({
      type: 'ADD_TASK',
      payload: {
        id,
        type: 'download',
        status: 'idle',
        file: null,
        fileName: options.filename ?? 'download',
        url,
        progress: 0,
        transferredBytes: 0,
        totalBytes: 0,
        speed: 0,
        remainingTime: 0,
        data: { ...options.data },
        session: {},
      },
    });
    this.start(id);
    return id;
  }

  subscribe(taskId: string, listener: (task: ITransferTask | undefined) => void): () => void {
    let previous = this.store.getTask(taskId);
    listener(previous);

    return this.store.subscribe((state) => {
      const current = state.tasks[taskId];
      if (current !== previous) {
        previous = current;
        listener(current);
      }
    });
  }

  pause(taskId: string): void {
    const task = this.store.getTask(taskId);
    if (!task || isTerminal(task.status) || task.status === 'paused') return;

    this.store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'paused', speed: 0, remainingTime: 0 } },
    });
    this.controllers.get(taskId)?.abort();
  }

  resume(taskId: string, options: IResumeOptions = {}): void {
    const task = this.store.getTask(taskId);
    if (!task || isTerminal(task.status) && task.status !== 'failed') return;

    const file = options.file ?? task.file;
    if (task.type === 'upload' && !file) {
      throw new Error('A File is required to resume an upload after page reload');
    }

    const previousOptions = this.options.get(taskId) ?? {};
    this.options.set(taskId, { ...previousOptions, ...options });
    this.store.dispatch({
      type: 'UPDATE_TASK',
      payload: {
        id: taskId,
        updates: {
          file,
          fileName: options.filename ?? task.fileName,
          url: options.url ?? task.url,
          data: options.data ? { ...task.data, ...options.data } : task.data,
          status: 'idle',
          error: undefined,
        },
      },
    });
    this.start(taskId);
  }

  retry(taskId: string, options: IResumeOptions = {}): void {
    const task = this.store.getTask(taskId);
    if (!task || task.status !== 'failed') return;

    this.store.dispatch({
      type: 'UPDATE_TASK',
      payload: {
        id: taskId,
        updates: {
          progress: 0,
          transferredBytes: 0,
          session: {},
          result: undefined,
        },
      },
    });
    this.resume(taskId, options);
  }

  cancel(taskId: string): void {
    const task = this.store.getTask(taskId);
    if (!task || isTerminal(task.status)) return;

    this.store.dispatch({
      type: 'UPDATE_TASK',
      payload: { id: taskId, updates: { status: 'cancelled', speed: 0, remainingTime: 0 } },
    });
    this.controllers.get(taskId)?.abort();
  }

  remove(taskId: string): void {
    this.controllers.get(taskId)?.abort();
    this.options.delete(taskId);
    this.store.dispatch({ type: 'REMOVE_TASK', payload: { id: taskId } });
  }

  private start(taskId: string): void {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    void this.run(taskId).finally(() => {
      this.running.delete(taskId);
      const task = this.store.getTask(taskId);
      if (task?.status === 'idle') {
        this.start(taskId);
      }
    });
  }

  private async run(taskId: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(taskId, controller);

    try {
      const task = this.requireTask(taskId);
      if (task.type === 'upload') await this.runUpload(taskId, controller.signal);
      else await this.runDownload(taskId, controller.signal);
    } catch (error) {
      const task = this.store.getTask(taskId);
      if (!task) return;
      if (
        isAbort(error) &&
        (task.status === 'idle' || task.status === 'paused' || task.status === 'cancelled')
      ) return;

      controller.abort();
      this.store.dispatch({
        type: 'UPDATE_TASK',
        payload: {
          id: taskId,
          updates: {
            status: 'failed',
            speed: 0,
            remainingTime: 0,
            error: error instanceof Error ? error : new Error(String(error)),
          },
        },
      });
    } finally {
      if (this.controllers.get(taskId) === controller) this.controllers.delete(taskId);
    }
  }

  private async runUpload(taskId: string, signal: AbortSignal): Promise<void> {
    let task = this.requireTask(taskId);
    const file = task.file;
    if (!file) throw new Error('Upload file is missing');

    const isChunked = file.size > this.config.chunkSize;
    if (isChunked && this.config.hash && !task.fileHash) {
      this.update(taskId, { status: 'hashing', progress: 0 });
      const fileHash = await computeFileHash(
        file,
        this.config.chunkSize,
        signal,
        (progress) => this.update(taskId, { progress: Math.round(progress * 0.05) }),
      );
      task = this.requireTask(taskId);
      if (task.status === 'paused' || task.status === 'cancelled') return;
      this.update(taskId, { fileHash });
    }

    this.update(taskId, { status: 'transferring' });
    if (isChunked) await this.uploadChunks(taskId, signal);
    else await this.uploadDirect(taskId, signal);
  }

  private async uploadDirect(taskId: string, signal: AbortSignal): Promise<void> {
    const context = this.protocolContext(taskId);
    const protocol = this.protocol(taskId);
    const request = protocol.createDirectRequest?.(context) ?? createDirectRequest(context);
    const response = await this.requestWithRetry({ ...request, signal }, signal);
    this.applyProtocolResponse(taskId, 'direct', response, context, protocol);

    this.update(taskId, {
      status: 'completed',
      progress: 100,
      transferredBytes: context.file.size,
      speed: 0,
      remainingTime: 0,
      result: response.data,
    });
  }

  private async uploadChunks(taskId: string, signal: AbortSignal): Promise<void> {
    const initial = this.requireTask(taskId);
    const file = initial.file;
    if (!file) throw new Error('Upload file is missing');

    const totalChunks = Math.ceil(file.size / this.config.chunkSize);
    const uploaded = new Set(readUploadedChunks(initial.session, totalChunks));
    const pending = Array.from({ length: totalChunks }, (_, index) => index)
      .filter((index) => !uploaded.has(index));
    const startedAt = Date.now();
    let cursor = 0;

    const worker = async () => {
      while (cursor < pending.length) {
        if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
        const index = pending[cursor];
        cursor += 1;

        const start = index * this.config.chunkSize;
        const chunk = file.slice(start, Math.min(start + this.config.chunkSize, file.size));
        const context = this.protocolContext(taskId, chunk, index, totalChunks);
        const protocol = this.protocol(taskId);
        const request = protocol.createChunkRequest?.(context) ?? createChunkRequest(context);
        const response = await this.requestWithRetry({ ...request, signal }, signal);

        uploaded.add(index);
        const session = {
          ...this.requireTask(taskId).session,
          ...this.parseProtocolResponse('chunk', response, context, protocol),
          uploadedChunks: [...uploaded].sort((a, b) => a - b),
        };
        const transferredBytes = bytesForChunks(uploaded, file.size, this.config.chunkSize);
        this.updateProgress(taskId, transferredBytes, file.size, startedAt, session, 5, 95);
      }
    };

    const workerCount = Math.min(this.config.concurrency, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const context = this.protocolContext(taskId, undefined, undefined, totalChunks);
    const protocol = this.protocol(taskId);
    const completeRequest = protocol.createCompleteRequest
      ? protocol.createCompleteRequest(context)
      : createCompleteRequest(context);

    let result: unknown;
    if (completeRequest) {
      const response = await this.requestWithRetry({ ...completeRequest, signal }, signal);
      this.applyProtocolResponse(taskId, 'complete', response, context, protocol);
      result = response.data;
    }

    this.update(taskId, {
      status: 'completed',
      progress: 100,
      transferredBytes: file.size,
      speed: 0,
      remainingTime: 0,
      result,
    });
  }

  private async runDownload(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.requireTask(taskId);
    const options = this.options.get(taskId) ?? {};
    const startedAt = Date.now();
    this.update(taskId, { status: 'transferring' });

    const response = await this.requestWithRetry<Blob>({
      url: task.url,
      method: 'GET',
      headers: { ...this.config.headers, ...options.headers },
      timeout: this.config.timeout,
      credentials: this.config.credentials,
      responseType: 'blob',
      signal,
      onDownloadProgress: (loaded, total) => {
        this.updateProgress(taskId, loaded, total || loaded, startedAt);
      },
    }, signal);

    if (typeof document !== 'undefined') saveBlob(response.data, task.fileName);

    this.update(taskId, {
      status: 'completed',
      progress: 100,
      transferredBytes: response.data.size,
      totalBytes: response.data.size,
      speed: 0,
      remainingTime: 0,
      result: response.data,
    });
  }

  private protocolContext(
    taskId: string,
    chunk?: Blob,
    chunkIndex?: number,
    totalChunks?: number,
  ): IUploadProtocolContext {
    const task = this.requireTask(taskId);
    const file = task.file;
    if (!file) throw new Error('Upload file is missing');
    const options = this.options.get(taskId) ?? {};
    const uploadUrl = options.url ?? task.url ?? this.config.uploadUrl;
    const chunkUrl = options.chunkUrl ?? this.config.chunkUrl ?? uploadUrl;
    const completeUrl = options.completeUrl ?? this.config.completeUrl;

    return {
      task,
      file,
      chunk,
      chunkIndex,
      totalChunks,
      fields: this.config.fields,
      indexBase: this.config.chunkIndexBase,
      uploadUrl,
      chunkUrl,
      completeUrl,
      headers: { ...this.config.headers, ...options.headers },
      timeout: this.config.timeout,
      credentials: this.config.credentials,
    };
  }

  private protocol(taskId: string): IUploadProtocol {
    return this.options.get(taskId)?.protocol ?? this.config.protocol ?? {};
  }

  private applyProtocolResponse(
    taskId: string,
    phase: UploadPhase,
    response: INetworkResponse,
    context: IUploadProtocolContext,
    protocol: IUploadProtocol,
  ): void {
    const session = this.parseProtocolResponse(phase, response, context, protocol);
    if (Object.keys(session).length > 0) {
      this.update(taskId, { session: { ...this.requireTask(taskId).session, ...session } });
    }
  }

  private parseProtocolResponse(
    phase: UploadPhase,
    response: INetworkResponse,
    context: IUploadProtocolContext,
    protocol: IUploadProtocol,
  ): Record<string, unknown> {
    return protocol.parseResponse?.(phase, response, context) ?? {};
  }

  private async requestWithRetry<T = unknown>(
    request: INetworkRequestConfig,
    signal: AbortSignal,
  ): Promise<INetworkResponse<T>> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      try {
        return await this.network.request<T>(request);
      } catch (error) {
        if (signal.aborted || isAbort(error)) throw error;
        lastError = error;
        if (attempt < this.config.retries) {
          await delay(this.config.retryDelay * 2 ** attempt, signal);
        }
      }
    }

    throw lastError;
  }

  private updateProgress(
    taskId: string,
    transferredBytes: number,
    totalBytes: number,
    startedAt: number,
    session?: Record<string, unknown>,
    progressStart = 0,
    progressRange = 100,
  ): void {
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const speed = Math.round(transferredBytes / elapsedSeconds);
    const remainingBytes = Math.max(0, totalBytes - transferredBytes);
    this.update(taskId, {
      progress: Math.min(100, Math.round(progressStart + (transferredBytes / totalBytes) * progressRange)),
      transferredBytes,
      totalBytes,
      speed,
      remainingTime: speed > 0 ? Math.round((remainingBytes / speed) * 1000) : 0,
      ...(session ? { session } : {}),
    });
  }

  private requireTask(taskId: string): ITransferTask {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('Task not found: ' + taskId);
    return task;
  }

  private update(taskId: string, updates: Partial<ITransferTask>): void {
    this.store.dispatch({ type: 'UPDATE_TASK', payload: { id: taskId, updates } });
  }
}

function readUploadedChunks(session: Record<string, unknown>, total: number): number[] {
  const value = session.uploadedChunks;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (index): index is number => Number.isInteger(index) && index >= 0 && index < total,
  );
}

function bytesForChunks(chunks: Set<number>, fileSize: number, chunkSize: number): number {
  let bytes = 0;
  for (const index of chunks) {
    const start = index * chunkSize;
    bytes += Math.max(0, Math.min(chunkSize, fileSize - start));
  }
  return bytes;
}

function isTerminal(status: ITransferTask['status']): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    }, { once: true });
  });
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
}
