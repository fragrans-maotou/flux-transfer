/**
 * Integration Test Helpers
 * Mock server and utilities for end-to-end testing
 */

import { vi } from 'vitest';

/**
 * Mock File Creator - creates mock File objects for testing
 */
export function createMockFile(
  name: string,
  size: number,
  type: string = 'application/octet-stream'
): File {
  const content = new Uint8Array(size);
  // Fill with random-ish data to make it more realistic
  for (let i = 0; i < size; i++) {
    content[i] = i % 256;
  }

  const blob = new Blob([content], { type });
  return new File([blob], name, { type, lastModified: Date.now() });
}

/**
 * Mock Server Response
 */
export interface IMockResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
}

/**
 * Mock Upload Endpoint Configuration
 */
export interface IMockUploadConfig {
  /** Should fail on specific chunk indices */
  failOnChunks?: number[];
  /** Delay in ms for each request */
  delay?: number;
  /** Return specific file hash */
  fileHash?: string;
}

/**
 * Setup mock fetch for upload testing
 */
export function setupMockUploadServer(config: IMockUploadConfig = {}) {
  const uploadedChunks = new Map<string, Blob>();
  const { failOnChunks = [], delay = 0, fileHash = 'mock-hash-12345' } = config;

  const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
    // Simulate network delay
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const formData = options?.body as FormData;

    // Parse URL to determine endpoint type
    if (url.includes('/upload') || url.includes('/chunk')) {
      // Chunk upload endpoint
      const chunkIndex = parseInt(formData?.get('chunkIndex') as string ?? '0');

      // Simulate failure for specific chunks
      if (failOnChunks.includes(chunkIndex)) {
        return new Response(JSON.stringify({ error: 'Simulated chunk upload failure' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Store the chunk
      const file = formData?.get('file') as Blob;
      if (file) {
        uploadedChunks.set(`chunk_${chunkIndex}`, file);
      }

      return new Response(JSON.stringify({
        success: true,
        chunkIndex,
        received: file?.size ?? 0,
      }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/merge')) {
      // Merge endpoint
      return new Response(JSON.stringify({
        success: true,
        fileId: 'file-' + Date.now(),
        fileHash,
        totalChunks: uploadedChunks.size,
      }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/check')) {
      // Check file exists endpoint (for resume)
      return new Response(JSON.stringify({
        exists: false,
        uploadedChunks: [],
      }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default 404
    return new Response('Not Found', {
      status: 404,
      statusText: 'Not Found',
    });
  });

  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

  return {
    mockFetch,
    uploadedChunks,
    reset: () => {
      uploadedChunks.clear();
      mockFetch.mockClear();
    },
  };
}

/**
 * Setup mock fetch for download testing
 */
export function setupMockDownloadServer(fileContent: Uint8Array) {
  const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
    const headers = options?.headers as Record<string, string> ?? {};
    const rangeHeader = headers['Range'];

    let start = 0;
    let end = fileContent.length - 1;
    let status = 200;

    // Handle Range requests for resume
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        start = parseInt(match[1]);
        end = match[2] ? parseInt(match[2]) : fileContent.length - 1;
        status = 206;
      }
    }

    const slice = fileContent.slice(start, end + 1);

    return new Response(slice, {
      status,
      statusText: status === 206 ? 'Partial Content' : 'OK',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': slice.length.toString(),
        'Content-Range': status === 206 ? `bytes ${start}-${end}/${fileContent.length}` : '',
        'Accept-Ranges': 'bytes',
      },
    });
  });

  vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

  return {
    mockFetch,
    reset: () => mockFetch.mockClear(),
  };
}
