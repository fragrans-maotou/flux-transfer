/**
 * NetworkAdapterFactory Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkAdapterFactory } from '../../src/infra/network/NetworkAdapterFactory';
import { FetchAdapter } from '../../src/infra/network/FetchAdapter';
import { XHRAdapter } from '../../src/infra/network/XHRAdapter';

describe('NetworkAdapterFactory', () => {
  describe('isFetchAvailable', () => {
    it('should return true when fetch is available', () => {
      expect(NetworkAdapterFactory.isFetchAvailable()).toBe(true);
    });
  });

  describe('isXHRAvailable', () => {
    it('should return true when XMLHttpRequest is available', () => {
      expect(NetworkAdapterFactory.isXHRAvailable()).toBe(true);
    });
  });

  describe('getAvailableAdapters', () => {
    it('should return list of available adapters', () => {
      const adapters = NetworkAdapterFactory.getAvailableAdapters();

      expect(adapters).toContain('fetch');
      expect(adapters).toContain('xhr');
    });
  });

  describe('create', () => {
    it('should create FetchAdapter by default (auto)', () => {
      const adapter = NetworkAdapterFactory.create();
      expect(adapter).toBeInstanceOf(FetchAdapter);
    });

    it('should create FetchAdapter when requested', () => {
      const adapter = NetworkAdapterFactory.create({ preferredAdapter: 'fetch' });
      expect(adapter).toBeInstanceOf(FetchAdapter);
    });

    it('should create XHRAdapter when requested', () => {
      const adapter = NetworkAdapterFactory.create({ preferredAdapter: 'xhr' });
      expect(adapter).toBeInstanceOf(XHRAdapter);
    });

    it('should create XHRAdapter when upload progress is required', () => {
      const adapter = NetworkAdapterFactory.create({ requireUploadProgress: true });
      expect(adapter).toBeInstanceOf(XHRAdapter);
    });

    it('should fallback gracefully when preferred adapter not available', () => {
      // Mock fetch not available
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = undefined;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

      // Should fallback to XHR
      const adapter = NetworkAdapterFactory.create({ preferredAdapter: 'fetch' });
      expect(adapter).toBeInstanceOf(XHRAdapter);
      expect(consoleSpy).toHaveBeenCalled();

      // Restore
      globalThis.fetch = originalFetch;
      consoleSpy.mockRestore();
    });
  });
});
