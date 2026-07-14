import type {
  INetworkAdapter,
  INetworkRequestConfig,
  INetworkResponse,
} from '../core/types';

export class FetchAdapter implements INetworkAdapter {
  async request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    config.signal?.addEventListener('abort', abort, { once: true });
    if (config.signal?.aborted) controller.abort();

    const timer = setTimeout(abort, config.timeout ?? 30_000);

    try {
      const response = await fetch(config.url, {
        method: config.method ?? 'GET',
        headers: config.headers,
        body: config.body,
        credentials: config.credentials ?? 'same-origin',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      }

      const data = await readBody(response, config) as T;
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers,
      };
    } finally {
      clearTimeout(timer);
      config.signal?.removeEventListener('abort', abort);
    }
  }
}

async function readBody(
  response: Response,
  config: INetworkRequestConfig,
): Promise<unknown> {
  if (config.responseType === 'arraybuffer') return response.arrayBuffer();
  if (config.responseType === 'text') return response.text();

  if (config.responseType === 'blob') {
    if (!response.body || !config.onDownloadProgress) return response.blob();

    const total = Number(response.headers.get('content-length')) || 0;
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let loaded = 0;

    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      loaded += part.value.byteLength;
      config.onDownloadProgress(loaded, total);
    }
    return new Blob(chunks as BlobPart[], {
      type: response.headers.get('content-type') ?? 'application/octet-stream',
    });
  }

  const text = await response.text();
  if (!text) return null;
  if (config.responseType === 'json') return JSON.parse(text);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
