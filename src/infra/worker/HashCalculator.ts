/**
 * Hash Calculator Utility
 * Supports both Main Thread (Sync) and Web Worker (Async) calculation
 */

import SparkMD5 from 'spark-md5';

/**
 * Hash calculation result
 */
export interface IHashResult {
  /** File hash (MD5) */
  hash: string;
  /** File size */
  size: number;
  /** Calculation time in milliseconds */
  duration: number;
}

/**
 * Hash calculation options
 */
export interface IHashOptions {
  /** Chunk size for incremental calculation (default: 2MB) */
  chunkSize?: number;
  /** Progress callback */
  onProgress?: (progress: number) => void;
}

/**
 * HashCalculator - Calculate file MD5 hash
 */
export class HashCalculator {
  /**
   * Worker code for hash calculation
   * Uses CDN for SparkMD5 to run in isolated worker environment
   */
  private static readonly WORKER_CODE = `
    self.onmessage = function(e) {
      if (e.data.type === 'init') {
        const { file, chunkSize } = e.data;
        try {
          importScripts('https://cdnjs.cloudflare.com/ajax/libs/spark-md5/3.0.2/spark-md5.min.js');
          const spark = new self.SparkMD5.ArrayBuffer();
          const count = Math.ceil(file.size / chunkSize);
          const reader = new FileReaderSync();

          const start = Date.now();

          for (let i = 0; i < count; i++) {
            const begin = i * chunkSize;
            const end = Math.min(begin + chunkSize, file.size);
            const chunk = file.slice(begin, end);
            const buffer = reader.readAsArrayBuffer(chunk);
            spark.append(buffer);

            // Report progress every chunk
            self.postMessage({ type: 'progress', progress: Math.round(((i + 1) / count) * 100) });
          }

          const hash = spark.end();
          self.postMessage({ type: 'complete', hash, duration: Date.now() - start });
        } catch (error) {
          self.postMessage({ type: 'error', error: error.message || 'Unknown worker error' });
        }
      }
    };
  `;

  /**
   * Calculate file hash
   * Automatically selects Worker or Main Thread based on environment
   * @param file File to calculate hash for
   * @param options Calculation options
   * @returns Hash result
   */
  static async calculateHash(
    file: File,
    options: IHashOptions = {},
  ): Promise<IHashResult> {
    // Try using Worker first if available
    try {
      if (typeof Worker !== 'undefined') {
        return await this.calculateHashInWorker(file, options);
      }
    } catch (e) {
      console.warn('Worker hash calculation failed, falling back to main thread', e);
    }

    // Fallback to main thread
    return this.calculateHashSync(file, options);
  }

  /**
   * Calculate hash in Web Worker
   */
  private static calculateHashInWorker(file: File, options: IHashOptions): Promise<IHashResult> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([this.WORKER_CODE], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      const chunkSize = options.chunkSize || 2 * 1024 * 1024;

      worker.onmessage = (e) => {
        const { type } = e.data;
        if (type === 'progress') {
          options.onProgress?.(e.data.progress);
        } else if (type === 'complete') {
          resolve({
            hash: e.data.hash,
            size: file.size,
            duration: e.data.duration
          });
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
        } else if (type === 'error') {
          reject(new Error(e.data.error));
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
        }
      };

      worker.onerror = () => {
        reject(new Error('Worker initialization failed'));
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      };

      worker.postMessage({ type: 'init', file, chunkSize });
    });
  }

  /**
   * Calculate file hash (Main Thread Sync/Async)
   */
  private static async calculateHashSync(
    file: File,
    options: IHashOptions = {},
  ): Promise<IHashResult> {
    const startTime = Date.now();
    const chunkSize = options.chunkSize || 2 * 1024 * 1024; // 2MB default
    const spark = new SparkMD5.ArrayBuffer();
    const chunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const arrayBuffer = await this.blobToArrayBuffer(chunk);
      spark.append(arrayBuffer);

      if (options.onProgress) {
        const progress = Math.round(((i + 1) / chunks) * 100);
        options.onProgress(progress);
      }
    }

    const hash = spark.end();
    const duration = Date.now() - startTime;

    return {
      hash,
      size: file.size,
      duration,
    };
  }

  /**
   * Convert Blob to ArrayBuffer using FileReader
   */
  private static blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Calculate hash for multiple files
   */
  static async calculateBatchHash(
    files: File[],
    options: IHashOptions = {},
  ): Promise<IHashResult[]> {
    const results: IHashResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const result = await this.calculateHash(files[i], {
        ...options,
        onProgress: options.onProgress
          ? (progress) => {
            const totalProgress = Math.round(((i + progress / 100) / files.length) * 100);
            options.onProgress!(totalProgress);
          }
          : undefined,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Quick hash (first chunk + last chunk + size)
   */
  static async calculateQuickHash(file: File): Promise<string> {
    const chunkSize = 1024 * 1024; // 1MB
    const spark = new SparkMD5.ArrayBuffer();

    const sizeBuffer = new TextEncoder().encode(file.size.toString()).buffer;
    spark.append(sizeBuffer);

    if (file.size > 0) {
      const firstChunk = file.slice(0, Math.min(chunkSize, file.size));
      spark.append(await this.blobToArrayBuffer(firstChunk));
    }

    if (file.size > chunkSize) {
      const lastChunk = file.slice(Math.max(0, file.size - chunkSize));
      spark.append(await this.blobToArrayBuffer(lastChunk));
    }

    return spark.end();
  }
}
