import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchAdapter } from '../../src/network/fetch-adapter';

describe('FetchAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends config and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FetchAdapter().request<{ id: number }>({
      url: '/items',
      method: 'POST',
      body: 'value',
      credentials: 'include',
    });

    expect(result.data).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/items', expect.objectContaining({
      method: 'POST',
      body: 'value',
      credentials: 'include',
    }));
  });

  it('reports streamed Blob download progress', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': '3',
        },
      }),
    ));
    const progress = vi.fn();

    const result = await new FetchAdapter().request<Blob>({
      url: '/file',
      responseType: 'blob',
      onDownloadProgress: progress,
    });

    expect(result.data.size).toBe(3);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it('rejects HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('no', { status: 500, statusText: 'Server Error' }),
    ));

    await expect(new FetchAdapter().request({ url: '/fail' }))
      .rejects.toThrow('HTTP 500 Server Error');
  });

  it('links the external abort signal', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    })));
    const controller = new AbortController();
    const request = new FetchAdapter().request({ url: '/slow', signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
