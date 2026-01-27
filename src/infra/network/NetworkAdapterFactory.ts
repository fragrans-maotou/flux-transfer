/**
 * Network Adapter Factory
 * Automatically selects the best available network adapter
 */

import type { INetworkAdapter } from '../../core/types';
import { FetchAdapter } from './FetchAdapter';
import { XHRAdapter } from './XHRAdapter';

/**
 * Network adapter type
 */
export type NetworkAdapterType = 'auto' | 'fetch' | 'xhr';

/**
 * Network adapter factory options
 */
export interface INetworkAdapterOptions {
  /** Preferred adapter type */
  preferredAdapter?: NetworkAdapterType;
  /** Whether upload progress is required (XHR is better for this) */
  requireUploadProgress?: boolean;
}

/**
 * Factory for creating network adapters
 */
export class NetworkAdapterFactory {
  /**
   * Check if Fetch API is available
   */
  static isFetchAvailable(): boolean {
    return typeof fetch !== 'undefined';
  }

  /**
   * Check if XMLHttpRequest is available
   */
  static isXHRAvailable(): boolean {
    return typeof XMLHttpRequest !== 'undefined';
  }

  /**
   * Create the best available network adapter
   * @param options Factory options
   * @returns Network adapter instance
   */
  static create(options: INetworkAdapterOptions = {}): INetworkAdapter {
    const { preferredAdapter = 'auto', requireUploadProgress = false } = options;

    // If specific adapter requested
    if (preferredAdapter === 'fetch') {
      if (this.isFetchAvailable()) {
        return new FetchAdapter();
      }
      console.warn('Fetch API not available, falling back to XHR');
    }

    if (preferredAdapter === 'xhr') {
      if (this.isXHRAvailable()) {
        return new XHRAdapter();
      }
      console.warn('XMLHttpRequest not available, falling back to Fetch');
    }

    // Auto-select based on requirements
    if (requireUploadProgress) {
      // XHR provides better upload progress monitoring
      if (this.isXHRAvailable()) {
        return new XHRAdapter();
      }
      // Fallback to Fetch if XHR not available
      if (this.isFetchAvailable()) {
        return new FetchAdapter();
      }
    }

    // Default: prefer Fetch for modern features
    if (this.isFetchAvailable()) {
      return new FetchAdapter();
    }

    if (this.isXHRAvailable()) {
      return new XHRAdapter();
    }

    throw new Error('No network adapter available in this environment');
  }

  /**
   * Get list of available adapters
   */
  static getAvailableAdapters(): NetworkAdapterType[] {
    const available: NetworkAdapterType[] = [];

    if (this.isFetchAvailable()) {
      available.push('fetch');
    }

    if (this.isXHRAvailable()) {
      available.push('xhr');
    }

    return available;
  }
}
