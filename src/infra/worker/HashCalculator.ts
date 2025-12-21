/**
 * Hash Calculator Utility
 * Simple hash calculation for files (main thread version)
 * For production, consider using Web Worker for large files
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
   * Calculate file hash
   * @param file File to calculate hash for
   * @param options Calculation options
   * @returns Hash result
   */
  static async calculateHash(
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

      // Read chunk as ArrayBuffer
      const arrayBuffer = await chunk.arrayBuffer();
      spark.append(arrayBuffer);

      // Report progress
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
   * Calculate hash for multiple files
   * @param files Files to calculate
   * @param options Calculation options
   * @returns Array of hash results
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
   * Faster but less accurate, good for duplicate detection
   */
  static async calculateQuickHash(file: File): Promise<string> {
    const chunkSize = 1024 * 1024; // 1MB
    const spark = new SparkMD5.ArrayBuffer();

    // Add file size
    spark.append(new TextEncoder().encode(file.size.toString()));

    // First chunk
    if (file.size > 0) {
      const firstChunk = file.slice(0, Math.min(chunkSize, file.size));
      spark.append(await firstChunk.arrayBuffer());
    }

    // Last chunk (if file is large enough)
    if (file.size > chunkSize) {
      const lastChunk = file.slice(Math.max(0, file.size - chunkSize));
      spark.append(await lastChunk.arrayBuffer());
    }

    return spark.end();
  }
}
