import type {
  INetworkAdapter,
  INetworkRequestConfig,
  INetworkResponse,
} from '../core/types';
import { HTTPError, NetworkError, NetworkTimeoutError } from './errors';

export class FetchAdapter implements INetworkAdapter {
  async request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    config.signal?.addEventListener('abort', abort, { once: true });
    if (config.signal?.aborted) controller.abort();

    const timeout = config.timeout ?? 30_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(config.url, {
        method: config.method ?? 'GET',
        headers: config.headers,
        body: config.body,
        credentials: config.credentials ?? 'same-origin',
        signal: controller.signal,
      });
      const result: INetworkResponse<T> = {
        data: await readBody(response, config) as T,
        status: response.status,
        statusText: response.statusText,
        headers: readHeaders(response.headers),
      };

      if (!response.ok) throw new HTTPError(result);
      return result;
    } catch (error) {
      if (timedOut && isAbort(error)) throw new NetworkTimeoutError(timeout, error);
      if (error instanceof HTTPError || config.signal?.aborted) throw error;
      if (error instanceof TypeError) throw new NetworkError(error.message, error);
      throw error;
    } finally {
      clearTimeout(timer);
      config.signal?.removeEventListener('abort', abort);
    }
  }
}

function readHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
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

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
