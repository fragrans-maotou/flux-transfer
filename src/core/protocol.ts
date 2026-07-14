import type {
  INetworkRequestConfig,
  IUploadProtocolContext,
} from './types';

export function createDirectRequest(
  context: IUploadProtocolContext,
): INetworkRequestConfig {
  const body = new FormData();
  body.append(context.fields.file, context.file);
  appendData(body, context.task.data);

  return baseRequest(context.uploadUrl, context, body);
}

export function createChunkRequest(
  context: IUploadProtocolContext,
): INetworkRequestConfig {
  if (!context.chunk || context.chunkIndex === undefined || context.totalChunks === undefined) {
    throw new Error('Chunk request context is incomplete');
  }

  const body = new FormData();
  body.append(context.fields.file, context.chunk);
  body.append(context.fields.chunkIndex, String(context.chunkIndex + context.indexBase));
  body.append(context.fields.totalChunks, String(context.totalChunks));
  body.append(context.fields.fileHash, context.task.fileHash ?? '');
  body.append(context.fields.fileName, context.file.name);
  appendData(body, context.task.data);

  return baseRequest(context.chunkUrl, context, body);
}

export function createCompleteRequest(
  context: IUploadProtocolContext,
): INetworkRequestConfig | null {
  if (!context.completeUrl) return null;

  return {
    ...baseRequest(context.completeUrl, context),
    headers: { 'Content-Type': 'application/json', ...context.headers },
    body: JSON.stringify({
      fileHash: context.task.fileHash,
      filename: context.file.name,
      totalChunks: context.totalChunks,
      ...context.task.data,
      ...context.task.session,
    }),
  };
}

function baseRequest(
  url: string,
  context: IUploadProtocolContext,
  body?: BodyInit,
): INetworkRequestConfig {
  return {
    url,
    method: 'POST',
    headers: context.headers,
    body,
    timeout: context.timeout,
    credentials: context.credentials,
  };
}

function appendData(body: FormData, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Blob) body.append(key, value);
    else if (typeof value === 'object') body.append(key, JSON.stringify(value));
    else body.append(key, String(value));
  }
}
