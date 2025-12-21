import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchAdapter } from '../../src/infra/network/FetchAdapter';
import type { INetworkRequestConfig } from '../../src/core/types';

// Mock fetch globally
global.fetch = vi.fn();

describe('FetchAdapter', () => {
  let adapter: FetchAdapter;

  beforeEach(() => {
    adapter = new FetchAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    adapter.abort(); // Clean up any pending requests
  });

  describe('request()', () => {
    it('should make successful GET request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ data: 'test' }),
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/data',
        method: 'GET',
      };

      const response = await adapter.request(config);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ data: 'test' });
    });

    it('should make POST request with body', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ id: 1 }),
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/data',
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      };

      const response = await adapter.request(config);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/data',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );
      expect(response.status).toBe(201);
    });

    it('should handle HTTP errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map(),
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/notfound',
        method: 'GET',
      };

      await expect(adapter.request(config)).rejects.toThrow('HTTP Error: 404');
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/data',
        method: 'GET',
      };

      await expect(adapter.request(config)).rejects.toThrow();
    });

    it('should respect timeout', async () => {
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({} as Response), 5000);
          })
      );

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/slow',
        method: 'GET',
        timeout: 100,
      };

      await expect(adapter.request(config)).rejects.toThrow();
    }, 10000);

    it('should include custom headers', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => '{}',
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/data',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom': 'value',
        },
      };

      await adapter.request(config);

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Headers;

      expect(headers.get('Authorization')).toBe('Bearer token123');
      expect(headers.get('X-Custom')).toBe('value');
    });

    it('should handle text response type', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => 'plain text response',
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/text',
        method: 'GET',
        responseType: 'text',
      };

      const response = await adapter.request(config);

      expect(response.data).toBe('plain text response');
    });
  });

  describe('abort()', () => {
    it('should abort specific request', async () => {
      const mockAbortError = new Error('Aborted');
      mockAbortError.name = 'AbortError';

      vi.mocked(fetch).mockRejectedValue(mockAbortError);

      const config: INetworkRequestConfig = {
        url: 'https://api.test.com/data',
        method: 'GET',
      };

      const requestPromise = adapter.request(config);

      // Abort immediately
      adapter.abort();

      await expect(requestPromise).rejects.toThrow('Request aborted');
    });

    it('should track active requests', () => {
      expect(adapter.getActiveRequestCount()).toBe(0);
    });
  });

  describe('Response Headers', () => {
    it('should return response headers', async () => {
      const mockHeaders = new Map([
        ['content-type', 'application/json'],
        ['x-custom-header', 'custom-value'],
      ]);

      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        text: async () => '{}',
      };

      // Mock the forEach method
      mockResponse.headers.forEach = function (callback: any) {
        callback('application/json', 'content-type');
        callback('custom-value', 'x-custom-header');
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      const response = await adapter.request({
        url: 'https://api.test.com/data',
        method: 'GET',
      });

      expect(response.headers).toHaveProperty('content-type');
      expect(response.headers['content-type']).toBe('application/json');
    });
  });

  describe('Credentials', () => {
    it('should include credentials when withCredentials is true', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: async () => '{}',
      };

      vi.mocked(fetch).mockResolvedValue(mockResponse as any);

      await adapter.request({
        url: 'https://api.test.com/data',
        method: 'GET',
        withCredentials: true,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'include',
        })
      );
    });
  });
});
