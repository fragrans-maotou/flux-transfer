/**
 * LocalStorage Adapter
 * Fallback storage for environments without IndexedDB
 */

import type { IStorageAdapter } from '../../core/types';

export class LocalStorageAdapter implements IStorageAdapter {
  private prefix: string;

  constructor(prefix: string = 'flux_ransfer_') {
    this.prefix = prefix;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const value = localStorage.getItem(this.prefix + key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('LocalStorage get error:', error);
      return null;
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (error) {
      console.error('LocalStorage set error:', error);
      // Handle quota exceeded
      if (this.isQuotaExceededError(error)) {
        throw new Error('LocalStorage quota exceeded');
      }
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.error('LocalStorage remove error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.keys();
      keys.forEach(key => localStorage.removeItem(this.prefix + key));
    } catch (error) {
      console.error('LocalStorage clear error:', error);
    }
  }

  async keys(): Promise<string[]> {
    try {
      return Object.keys(localStorage)
        .filter(key => key.startsWith(this.prefix))
        .map(key => key.slice(this.prefix.length));
    } catch (error) {
      console.error('LocalStorage keys error:', error);
      return [];
    }
  }

  private isQuotaExceededError(e: unknown): boolean {
    return (
      e instanceof DOMException &&
      // everything except Firefox
      (e.code === 22 ||
        // Firefox
        e.code === 1014 ||
        // test name field too, because code might not be present
        // everything except Firefox
        e.name === 'QuotaExceededError' ||
        // Firefox
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
      // acknowledge QuotaExceededError only if there's something already stored
      localStorage.length !== 0
    );
  }
}
