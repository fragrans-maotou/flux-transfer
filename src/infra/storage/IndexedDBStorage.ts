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

  /**
   * Get multiple values by keys (batch get)
   */
  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T | null>> {
    const result = new Map<string, T | null>();

    if (keys.length === 0) return result;

    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        let completed = 0;

        for (const key of keys) {
          const request = store.get(key);

          request.onsuccess = () => {
            result.set(key, request.result ?? null);
            completed++;
            if (completed === keys.length) {
              resolve(result);
            }
          };

          request.onerror = () => {
            result.set(key, null);
            completed++;
            if (completed === keys.length) {
              resolve(result);
            }
          };
        }

        transaction.onerror = () => {
          reject(new Error(`Batch get failed: ${transaction.error?.message || 'Unknown error'}`));
        };
      });
    } catch (error) {
      console.error('Error in batch get:', error);
      // Return nulls for all keys on error
      keys.forEach(key => result.set(key, null));
      return result;
    }
  }

  /**
   * Set multiple key-value pairs (batch set)
   */
  async setMany<T = unknown>(entries: Array<{ key: string; value: T }>): Promise<void> {
    if (entries.length === 0) return;

    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      for (const { key, value } of entries) {
        store.put(value, key);
      }

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(new Error(`Batch set failed: ${transaction.error?.message || 'Unknown error'}`));
      };
    });
  }

  /**
   * Remove multiple keys (batch remove)
   */
  async removeMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      for (const key of keys) {
        store.delete(key);
      }

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(new Error(`Batch remove failed: ${transaction.error?.message || 'Unknown error'}`));
      };
    });
  }

  /**
   * Get all stored data
   */
  async getAll<T = unknown>(): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();

        let keys: IDBValidKey[] = [];
        let values: T[] = [];
        let keysLoaded = false;
        let valuesLoaded = false;

        const tryResolve = () => {
          if (keysLoaded && valuesLoaded) {
            for (let i = 0; i < keys.length; i++) {
              result.set(String(keys[i]), values[i]);
            }
            resolve(result);
          }
        };

        keysRequest.onsuccess = () => {
          keys = keysRequest.result;
          keysLoaded = true;
          tryResolve();
        };

        valuesRequest.onsuccess = () => {
          values = valuesRequest.result;
          valuesLoaded = true;
          tryResolve();
        };

        transaction.onerror = () => {
          reject(new Error(`Get all failed: ${transaction.error?.message || 'Unknown error'}`));
        };
      });
    } catch (error) {
      console.error('Error getting all data:', error);
      return result;
    }
  }
}
