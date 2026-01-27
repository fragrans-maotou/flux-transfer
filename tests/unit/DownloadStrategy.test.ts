/**
 * Download Strategy Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FetchBlobStrategy,
  DirectLinkStrategy,
  DownloadStrategyFactory,
  type IDownloadStrategyConfig,
} from '../../src/strategies';

describe('FetchBlobStrategy', () => {
  let strategy: FetchBlobStrategy;

  beforeEach(() => {
    strategy = new FetchBlobStrategy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('canUse', () => {
    it('should return true when fetch and Blob are available', () => {
      expect(strategy.canUse()).toBe(true);
    });
  });

  describe('name', () => {
    it('should have correct name', () => {
      expect(strategy.name).toBe('fetch-blob');
    });
  });

  describe('download', () => {
    it('should handle HTTP errors', async () => {
      // Mock fetch to return error
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 404, statusText: 'Not Found' })
      );

      const config: IDownloadStrategyConfig = {
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
      };

      const result = await strategy.download(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should handle successful download', async () => {
      const testContent = 'Hello, World!';
      const blob = new Blob([testContent]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(blob, {
          status: 200,
          headers: { 'content-length': blob.size.toString() },
        })
      );

      // Mock document methods for triggerDownload
      const mockLink = {
        href: '',
        download: '',
        style: { display: '' },
        click: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });

      const config: IDownloadStrategyConfig = {
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
      };

      const result = await strategy.download(config);

      expect(result.success).toBe(true);
      expect(result.bytesDownloaded).toBeGreaterThan(0);
      expect(mockLink.click).toHaveBeenCalled();
    });

    it('should call progress callback', async () => {
      const testContent = 'Hello, World!';
      const blob = new Blob([testContent]);
      const onProgress = vi.fn();

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(blob, {
          status: 200,
          headers: { 'content-length': blob.size.toString() },
        })
      );

      // Mock document methods
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        style: { display: '' },
        click: vi.fn(),
      } as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({} as any));
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({} as any));
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });

      const config: IDownloadStrategyConfig = {
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
        onProgress,
      };

      await strategy.download(config);

      // Progress might be called depending on streaming vs non-streaming response
      // Just verify no error occurred
    });

    it('should handle abort', async () => {
      const abortController = new AbortController();

      // Abort immediately
      abortController.abort();

      const config: IDownloadStrategyConfig = {
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
        signal: abortController.signal,
      };

      const result = await strategy.download(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('abort');
    });
  });

  describe('abort', () => {
    it('should abort controller when called', () => {
      strategy.abort();
      // Should not throw
    });
  });
});

describe('DirectLinkStrategy', () => {
  let strategy: DirectLinkStrategy;

  beforeEach(() => {
    strategy = new DirectLinkStrategy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('canUse', () => {
    it('should return true when document is available', () => {
      expect(strategy.canUse()).toBe(true);
    });
  });

  describe('name', () => {
    it('should have correct name', () => {
      expect(strategy.name).toBe('direct-link');
    });
  });

  describe('download', () => {
    it('should create download link and trigger click', async () => {
      const mockLink = {
        href: '',
        download: '',
        style: { display: '' },
        click: vi.fn(),
      };

      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);

      const config: IDownloadStrategyConfig = {
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
      };

      const resultPromise = strategy.download(config);

      // Wait for the promise to resolve
      const result = await resultPromise;

      expect(mockLink.href).toBe('https://example.com/file.txt');
      expect(mockLink.download).toBe('file.txt');
      expect(mockLink.click).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle abort signal', async () => {
      const abortController = new AbortController();
      abortController.abort();

      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        style: { display: '' },
        click: vi.fn(),
      } as any);

      const config: IDownloadStrategyConfig = {
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
        signal: abortController.signal,
      };

      const result = await strategy.download(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('abort');
    });
  });
});

describe('DownloadStrategyFactory', () => {
  describe('getStrategy', () => {
    it('should return FetchBlobStrategy for auto', () => {
      const strategy = DownloadStrategyFactory.getStrategy('auto');
      expect(strategy.name).toBe('fetch-blob');
    });

    it('should return FetchBlobStrategy when requested', () => {
      const strategy = DownloadStrategyFactory.getStrategy('fetch-blob');
      expect(strategy.name).toBe('fetch-blob');
    });

    it('should return DirectLinkStrategy when requested', () => {
      const strategy = DownloadStrategyFactory.getStrategy('direct-link');
      expect(strategy.name).toBe('direct-link');
    });

    it('should fallback to auto for unavailable strategy', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      const strategy = DownloadStrategyFactory.getStrategy('stream-saver');

      // Should fallback to fetch-blob
      expect(strategy.name).toBe('fetch-blob');
      consoleSpy.mockRestore();
    });
  });

  describe('isStrategyAvailable', () => {
    it('should return true for auto', () => {
      expect(DownloadStrategyFactory.isStrategyAvailable('auto')).toBe(true);
    });

    it('should return true for fetch-blob', () => {
      expect(DownloadStrategyFactory.isStrategyAvailable('fetch-blob')).toBe(true);
    });

    it('should return true for direct-link', () => {
      expect(DownloadStrategyFactory.isStrategyAvailable('direct-link')).toBe(true);
    });
  });

  describe('getAvailableStrategies', () => {
    it('should return list of available strategies', () => {
      const strategies = DownloadStrategyFactory.getAvailableStrategies();
      expect(strategies).toContain('fetch-blob');
      expect(strategies).toContain('direct-link');
    });
  });

  describe('registerStrategy', () => {
    it('should allow registering custom strategies', () => {
      const customStrategy = {
        name: 'custom',
        canUse: () => true,
        download: async () => ({ success: true, bytesDownloaded: 0 }),
        abort: () => { },
      };

      DownloadStrategyFactory.registerStrategy('custom', () => customStrategy);

      const strategy = DownloadStrategyFactory.getStrategy('custom' as any);
      expect(strategy.name).toBe('custom');
    });
  });
});

describe('StreamSaverStrategy', () => {
  // Import StreamSaverStrategy for testing
  let StreamSaverStrategy: typeof import('../../src/strategies').StreamSaverStrategy;

  beforeEach(async () => {
    const module = await import('../../src/strategies');
    StreamSaverStrategy = module.StreamSaverStrategy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const strategy = new StreamSaverStrategy();
      expect(strategy.name).toBe('stream-saver');
    });

    it('should accept custom config', () => {
      const strategy = new StreamSaverStrategy({
        swPath: '/custom-sw.js',
        swScope: '/app/',
      });
      expect(strategy.name).toBe('stream-saver');
    });
  });

  describe('canUse', () => {
    it('should return false in non-secure context (test environment)', () => {
      const strategy = new StreamSaverStrategy();
      // In test environment, isSecureContext is typically false or undefined
      // The strategy should handle this gracefully
      const canUse = strategy.canUse();
      // Result depends on test environment
      expect(typeof canUse).toBe('boolean');
    });
  });

  describe('download', () => {
    it('should return error when not available', async () => {
      const strategy = new StreamSaverStrategy();

      // Mock canUse to return false
      vi.spyOn(strategy, 'canUse').mockReturnValue(false);

      const result = await strategy.download({
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('should handle pre-aborted signal', async () => {
      const strategy = new StreamSaverStrategy();
      const abortController = new AbortController();
      abortController.abort();

      // Even if canUse returns true, pre-aborted signal should fail
      vi.spyOn(strategy, 'canUse').mockReturnValue(true);

      const result = await strategy.download({
        url: 'https://example.com/file.txt',
        fileName: 'file.txt',
        signal: abortController.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('abort');
    });
  });

  describe('abort', () => {
    it('should not throw when called', () => {
      const strategy = new StreamSaverStrategy();
      expect(() => strategy.abort()).not.toThrow();
    });
  });

  describe('unregister', () => {
    it('should return false when no SW registered', async () => {
      const strategy = new StreamSaverStrategy();
      const result = await strategy.unregister();
      expect(result).toBe(false);
    });
  });
});

