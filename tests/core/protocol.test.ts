import { describe, expect, it } from 'vitest';
import {
  createChunkRequest,
  createCompleteRequest,
  createDirectRequest,
} from '../../src/core/protocol';
import { resolveConfig } from '../../src/core/types';
import type { ITransferTask, IUploadProtocolContext } from '../../src/core/types';

function context(): IUploadProtocolContext {
  const config = resolveConfig({
    uploadUrl: '/upload',
    chunkUrl: '/chunk',
    completeUrl: '/complete',
  });
  const file = new File(['abc'], 'a.txt');
  const task: ITransferTask = {
    id: 'a',
    type: 'upload',
    status: 'transferring',
    file,
    fileName: 'renamed.txt',
    fileHash: 'hash',
    url: '/upload',
    progress: 0,
    transferredBytes: 0,
    totalBytes: file.size,
    speed: 0,
    remainingTime: 0,
    data: {
      text: 'value',
      number: 1,
      object: { a: 1 },
      blob: new Blob(['b']),
      empty: null,
    },
    session: { uploadId: 'u1' },
  };
  return {
    task,
    file,
    chunk: file.slice(0, 2),
    chunkIndex: 0,
    totalChunks: 2,
    fields: config.fields,
    indexBase: 1,
    uploadUrl: config.uploadUrl,
    chunkUrl: config.chunkUrl,
    completeUrl: config.completeUrl,
    headers: config.headers,
    timeout: config.timeout,
    credentials: config.credentials,
    idempotencyHeader: config.idempotencyHeader,
  };
}

describe('default upload protocol', () => {
  it('builds direct and chunk FormData requests', () => {
    const direct = createDirectRequest(context());
    const chunk = createChunkRequest(context());
    const chunkBody = chunk.body as FormData;

    expect(direct.url).toBe('/upload');
    expect((direct.body as FormData).get('file')).toMatchObject({ name: 'renamed.txt' });
    expect(chunk.url).toBe('/chunk');
    expect(chunkBody.get('chunkIndex')).toBe('1');
    expect(chunkBody.get('filename')).toBe('renamed.txt');
    expect(chunkBody.get('text')).toBe('value');
    expect(chunkBody.get('number')).toBe('1');
    expect(chunkBody.get('object')).toBe('{"a":1}');
    expect(chunkBody.get('blob')).toBeInstanceOf(Blob);
    expect(chunkBody.has('empty')).toBe(false);
  });

  it('builds completion JSON or skips it when disabled', () => {
    const upload = context();
    upload.task.data.fileHash = 'must-not-override';
    const request = createCompleteRequest(upload);
    expect(request?.url).toBe('/complete');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      fileHash: 'hash',
      uploadId: 'u1',
      totalChunks: 2,
      filename: 'renamed.txt',
    });

    expect(createCompleteRequest({ ...context(), completeUrl: false })).toBeNull();
  });

  it('rejects incomplete chunk context', () => {
    expect(() =>
      createChunkRequest({
        ...context(),
        chunk: undefined,
        chunkIndex: undefined,
      }),
    ).toThrow('incomplete');
  });

  it('creates stable operation-specific idempotency keys when enabled', () => {
    const configured = { ...context(), idempotencyHeader: 'Idempotency-Key' };

    expect(createDirectRequest(configured).headers?.['Idempotency-Key']).toBe('a:direct');
    expect(createChunkRequest(configured).headers?.['Idempotency-Key']).toBe('a:chunk:0');
    expect(createCompleteRequest(configured)?.headers?.['Idempotency-Key']).toBe('a:complete');
  });

  it('uses configured field names in the completion payload', () => {
    const configured = {
      ...context(),
      fields: {
        file: 'binary',
        chunkIndex: 'part',
        totalChunks: 'partCount',
        fileHash: 'checksum',
        fileName: 'name',
      },
    };
    const request = createCompleteRequest(configured);

    expect(JSON.parse(String(request?.body))).toMatchObject({
      checksum: 'hash',
      name: 'renamed.txt',
      partCount: 2,
    });
  });
});
