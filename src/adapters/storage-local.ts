import type { IStorageAdapter } from '../core/types';

export class LocalStorageAdapter implements IStorageAdapter {
  constructor(private readonly prefix = 'flux-transfer:') {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const value = localStorage.getItem(this.key(key));
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    localStorage.setItem(this.key(key), JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.key(key));
  }

  async clear(): Promise<void> {
    for (const key of await this.keys()) localStorage.removeItem(this.key(key));
  }

  async keys(): Promise<string[]> {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length));
  }

  private key(key: string): string {
    return key.startsWith(this.prefix) ? key : this.prefix + key;
  }
}
