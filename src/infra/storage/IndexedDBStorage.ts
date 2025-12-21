/**
 * IndexedDB Storage Adapter
 * Provides persistent storage for transfer checkpoints
 */

import type { IStorageAdapter } from '../../core/types.ts';

const DB_NAME = 'FluxTransferDB';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';

/**
 * IndexedDB storage adapter for checkpoint persistence
 */
export class IndexedDBStorage implements IStorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    this.dbPromise = this.openDatabase();
  }

  /**
   * Open IndexedDB database
   */
  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this environment'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message || 'Unknown error'}`));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  /**
   * Get database instance
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDatabase();
    }
    return this.dbPromise;
  }

  /**
   * Get value by key
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result ?? null);
        };

        request.onerror = () => {
          reject(new Error(`Failed to get key "${key}": ${request.error?.message || 'Unknown error'}`));
        };
      });
    } catch (error) {
      console.error(`Error getting key "${key}":`, error);
      return null;
    }
  }

  /**
   * Set value by key
   */
  async set<T = unknown>(key: string, value: T): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to set key "${key}": ${request.error?.message || 'Unknown error'}`));
      };
    });
  }

  /**
   * Update vakye by key
   */
  async update<T = unknown>(key: string, value: T): Promise<void> {
    return this.set(key, value);
  }


  /**
   * Remove value by key
   */
  async remove(key: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to remove key "${key}": ${request.error?.message || 'Unknown error'}`));
      };
    });
  }

  /**
   * Clear all stored values
   */
  async clear(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to clear store: ${request.error?.message || 'Unknown error'}`));
      };
    });
  }

  /**
   * Get all keys
   */
  async keys(): Promise<string[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => {
          resolve(request.result as string[]);
        };

        request.onerror = () => {
          reject(new Error(`Failed to get keys: ${request.error?.message || 'Unknown error'}`));
        };
      });
    } catch (error) {
      console.error('Error getting keys:', error);
      return [];
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }
}
