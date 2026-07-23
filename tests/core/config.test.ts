import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/core/types';

describe('resolveConfig', () => {
  it('resolves explicit transport and protocol values', () => {
    const protocol = {};
    const networkAdapter = { request: async () => ({ data: null, status: 200, statusText: 'OK', headers: {} }) };
    const storageAdapter = {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    };
    const config = resolveConfig({
      uploadUrl: '/upload',
      chunkUrl: '/chunk',
      completeUrl: '/complete',
      chunkSize: 2048,
      concurrency: 4,
      retries: 4,
      retryDelay: 10,
      timeout: 100,
      hash: false,
      maxFileSize: 1000,
      headers: { A: 'b' },
      credentials: 'include',
      fields: { file: 'binary' },
      chunkIndexBase: 1,
      protocol,
      networkAdapter,
      storageAdapter,
    });

    expect(config).toMatchObject({
      chunkUrl: '/chunk',
      completeUrl: '/complete',
      concurrency: 4,
      hash: false,
      credentials: 'include',
      fields: { file: 'binary', chunkIndex: 'chunkIndex' },
      protocol,
      networkAdapter,
      storageAdapter,
    });
  });

  it.each([
    [{ chunkSize: 1 }, 'chunkSize'],
    [{ concurrency: 0 }, 'concurrency'],
    [{ retries: -1 }, 'retries'],
    [{ retryDelay: -1 }, 'retryDelay'],
    [{ timeout: 0 }, 'timeout'],
    [{ maxFileSize: -1 }, 'maxFileSize'],
    [{ chunkSize: Number.NaN }, 'chunkSize'],
    [{ concurrency: Number.POSITIVE_INFINITY }, 'concurrency'],
    [{ retries: 1.5 }, 'retries'],
  ])('rejects invalid config %o', (config, message) => {
    expect(() => resolveConfig(config)).toThrow(message);
  });
});
