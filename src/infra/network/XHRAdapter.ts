/**
 * XMLHttpRequest Network Adapter
 * Fallback HTTP client for older browsers or specific use cases
 * Provides upload progress monitoring (which Fetch API lacks)
 */

import type { INetworkAdapter, INetworkRequestConfig, INetworkResponse } from '../../core/types';

/**
 * XHR-based network adapter
 * Better for upload progress monitoring than Fetch
 */
export class XHRAdapter implements INetworkAdapter {
  private activeRequests: Map<string, XMLHttpRequest> = new Map();
  private requestIdCounter: number = 0;

  /**
   * Execute network request using XMLHttpRequest
   */
  async request<T = unknown>(config: INetworkRequestConfig): Promise<INetworkResponse<T>> {
    const requestId = `xhr_${++this.requestIdCounter}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.activeRequests.set(requestId, xhr);

      // Handle abort signal
      if (config.signal) {
        if (config.signal.aborted) {
          this.activeRequests.delete(requestId);
          reject(new Error('Request aborted'));
          return;
        }
        config.signal.addEventListener('abort', () => {
          xhr.abort();
        });
      }

      // Set timeout
      xhr.timeout = config.timeout || 30000;

      // Configure response type
      if (config.responseType === 'blob') {
        xhr.responseType = 'blob';
      } else if (config.responseType === 'arraybuffer') {
        xhr.responseType = 'arraybuffer';
      } else if (config.responseType === 'text') {
        xhr.responseType = 'text';
      } else {
        xhr.responseType = 'text'; // We'll parse JSON manually
      }

      // Open request
      xhr.open(config.method, config.url, true);

      // Set headers
      if (config.headers) {
        Object.entries(config.headers).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value);
        });
      }

      // Set credentials
      xhr.withCredentials = config.withCredentials || false;

      // Upload progress
      if (xhr.upload && config.onUploadProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            config.onUploadProgress!(event.loaded, event.total);
          }
        };
      }

      // Download progress
      if (config.onProgress) {
        xhr.onprogress = (event) => {
          if (event.lengthComputable) {
            config.onProgress!(event.loaded, event.total);
          }
        };
      }

      // Handle load
      xhr.onload = () => {
        this.activeRequests.delete(requestId);

        // Build response headers
        const responseHeaders: Record<string, string> = {};
        const headerString = xhr.getAllResponseHeaders();
        if (headerString) {
          const headerPairs = headerString.trim().split(/[\r\n]+/);
          headerPairs.forEach((line) => {
            const parts = line.split(': ');
            const key = parts.shift();
            if (key) {
              responseHeaders[key.toLowerCase()] = parts.join(': ');
            }
          });
        }

        // Check for HTTP errors
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`HTTP Error: ${xhr.status} ${xhr.statusText}`));
          return;
        }

        // Parse response
        let data: T;
        if (config.responseType === 'blob' || config.responseType === 'arraybuffer') {
          data = xhr.response as T;
        } else {
          // Try to parse as JSON
          const text = xhr.responseText;
          try {
            data = text ? JSON.parse(text) : ({} as T);
          } catch {
            data = text as T;
          }
        }

        resolve({
          data,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: responseHeaders,
        });
      };

      // Handle errors
      xhr.onerror = () => {
        this.activeRequests.delete(requestId);
        reject(new Error('Network error'));
      };

      xhr.ontimeout = () => {
        this.activeRequests.delete(requestId);
        reject(new Error('Request timeout'));
      };

      xhr.onabort = () => {
        this.activeRequests.delete(requestId);
        reject(new Error('Request aborted'));
      };

      // Send request
      if (config.body) {
        xhr.send(config.body as XMLHttpRequestBodyInit);
      } else {
        xhr.send();
      }
    });
  }

  /**
   * Abort ongoing request(s)
   */
  abort(requestId?: string): void {
    if (requestId) {
      const xhr = this.activeRequests.get(requestId);
      if (xhr) {
        xhr.abort();
        this.activeRequests.delete(requestId);
      }
    } else {
      // Abort all requests
      this.activeRequests.forEach((xhr) => xhr.abort());
      this.activeRequests.clear();
    }
  }

  /**
   * Get active request count
   */
  getActiveRequestCount(): number {
    return this.activeRequests.size;
  }
}
