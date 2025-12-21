/**
 * Fetch API Network Adapter
 * Modern fetch-based HTTP client with progress monitoring
 */

import type { INetworkAdapter, INetworkRequestConfig, INetworkResponse } from '../../core/types';

/**
 * Fetch-based network adapter
 */
export class FetchAdapter implements INetworkAdapter {
  private abortControllers: Map<string, AbortController> = new Map();
  private requestIdCounter: number = 0;

  /**
   * Execute network request using Fetch API
   */
  async request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>> {
    const requestId = `req_${++this.requestIdCounter}`;
    const abortController = new AbortController();
    this.abortControllers.set(requestId, abortController);

    try {
      const headers = new Headers(config.headers || {});

      // Create fetch request init
      const init: RequestInit = {
        method: config.method,
        headers,
        signal: abortController.signal,
        credentials: config.withCredentials ? 'include' : 'same-origin',
      };

      // Handle request body
      if (config.body) {
        init.body = config.body as BodyInit;
      }

      // Set timeout
      const timeout = config.timeout || 30000;
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeout);

      // Execute fetch
      const response = await fetch(config.url, init);
      clearTimeout(timeoutId);

      // Check for HTTP errors
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      // Parse response based on type
      let data: T;
      const contentType = response.headers.get('content-type');

      if (config.responseType === 'blob' || contentType?.includes('application/octet-stream')) {
        data = (await this.readResponseWithProgress(response, config.onProgress)) as T;
      } else if (config.responseType === 'arraybuffer') {
        data = (await response.arrayBuffer()) as T;
      } else if (config.responseType === 'text') {
        data = (await response.text()) as T;
      } else {
        // Default to JSON
        const text = await response.text();
        try {
          data = text ? JSON.parse(text) : ({} as T);
        } catch {
          data = text as T;
        }
      }

      // Build response object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request aborted');
        }
        if (error.message.includes('fetch')) {
          throw new Error(`Network error: ${error.message}`);
        }
      }
      throw error;
    } finally {
      this.abortControllers.delete(requestId);
    }
  }

  /**
   * Read response body with progress monitoring
   */
  private async readResponseWithProgress(
    response: Response,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Blob> {
    const contentLength = Number(response.headers.get('content-length')) || 0;
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          chunks.push(value);
          loaded += value.length;

          if (onProgress) {
            onProgress(loaded, contentLength || loaded);
          }
        }
      }

      // Combine chunks into blob
      return new Blob(chunks);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Abort ongoing request(s)
   */
  abort(requestId?: string): void {
    if (requestId) {
      const controller = this.abortControllers.get(requestId);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(requestId);
      }
    } else {
      // Abort all requests
      this.abortControllers.forEach((controller) => controller.abort());
      this.abortControllers.clear();
    }
  }

  /**
   * Get active request count
   */
  getActiveRequestCount(): number {
    return this.abortControllers.size;
  }
}
