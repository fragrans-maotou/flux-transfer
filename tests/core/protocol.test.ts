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
    fileName: file.name,
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
  };
}

describe('default upload protocol', () => {
  it('builds direct and chunk FormData requests', () => {
    const direct = createDirectRequest(context());
    const chunk = createChunkRequest(context());
    const chunkBody = chunk.body as FormData;

    expect(direct.url).toBe('/upload');
    expect(chunk.url).toBe('/chunk');
    expect(chunkBody.get('chunkIndex')).toBe('1');
    expect(chunkBody.get('text')).toBe('value');
    expect(chunkBody.get('number')).toBe('1');
    expect(chunkBody.get('object')).toBe('{"a":1}');
    expect(chunkBody.get('blob')).toBeInstanceOf(Blob);
    expect(chunkBody.has('empty')).toBe(false);
  });

  it('builds completion JSON or skips it when disabled', () => {
    const request = createCompleteRequest(context());
    expect(request?.url).toBe('/complete');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      fileHash: 'hash',
      uploadId: 'u1',
      totalChunks: 2,
    });

    expect(createCompleteRequest({ ...context(), completeUrl: false })).toBeNull();
  });

  it('rejects incomplete chunk context', () => {
    expect(() => createChunkRequest({
      ...context(),
      chunk: undefined,
      chunkIndex: undefined,
    })).toThrow('incomplete');
  });
});
