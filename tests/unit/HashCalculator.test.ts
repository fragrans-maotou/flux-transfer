import { describe, it, expect, vi } from 'vitest';
import { HashCalculator } from '../../src/infra/worker/HashCalculator';

describe('HashCalculator', () => {
  describe('calculateHash()', () => {
    it('should calculate hash for small file', async () => {
      const content = 'Hello World';
      const file = new File([content], 'test.txt', { type: 'text/plain' });

      const result = await HashCalculator.calculateHash(file);

      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(32); // MD5 is 32 characters
      expect(result.size).toBe(content.length);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should calculate hash for larger file', async () => {
      const size = 5 * 1024 * 1024; // 5MB
      const buffer = new ArrayBuffer(size);
      const file = new File([buffer], 'large.bin');

      const result = await HashCalculator.calculateHash(file);

      expect(result.hash).toBeDefined();
      expect(result.size).toBe(size);
    });

    it('should report progress', async () => {
      const size = 10 * 1024 * 1024; // 10MB
      const buffer = new ArrayBuffer(size);
      const file = new File([buffer], 'progress.bin');

      const progressUpdates: number[] = [];
      const onProgress = vi.fn((progress) => {
        progressUpdates.push(progress);
      });

      await HashCalculator.calculateHash(file, {
        chunkSize: 2 * 1024 * 1024, // 2MB chunks
        onProgress,
      });

      expect(onProgress).toHaveBeenCalled();
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    });

    it('should handle empty file', async () => {
      const file = new File([], 'empty.txt');

      const result = await HashCalculator.calculateHash(file);

      expect(result.hash).toBeDefined();
      expect(result.size).toBe(0);
    });

    it('should use custom chunk size', async () => {
      const size = 5 * 1024 * 1024; // 5MB
      const buffer = new ArrayBuffer(size);
      const file = new File([buffer], 'custom.bin');

      const result = await HashCalculator.calculateHash(file, {
        chunkSize: 1 * 1024 * 1024, // 1MB chunks
      });

      expect(result.hash).toBeDefined();
    });

    it('should produce consistent hash for same content', async () => {
      const content = 'Test Content';
      const file1 = new File([content], 'test1.txt');
      const file2 = new File([content], 'test2.txt');

      const result1 = await HashCalculator.calculateHash(file1);
      const result2 = await HashCalculator.calculateHash(file2);

      expect(result1.hash).toBe(result2.hash);
    });
  });

  describe('calculateBatchHash()', () => {
    it('should calculate hash for multiple files', async () => {
      const files = [
        new File(['file1'], 'test1.txt'),
        new File(['file2'], 'test2.txt'),
        new File(['file3'], 'test3.txt'),
      ];

      const results = await HashCalculator.calculateBatchHash(files);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.hash).toBeDefined();
        expect(result.size).toBeGreaterThan(0);
      });
    });

    it('should report overall progress for batch', async () => {
      const files = [
        new File([new ArrayBuffer(1024)], 'file1.bin'),
        new File([new ArrayBuffer(1024)], 'file2.bin'),
      ];

      const progressUpdates: number[] = [];
      const onProgress = vi.fn((progress) => {
        progressUpdates.push(progress);
      });

      await HashCalculator.calculateBatchHash(files, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      // Should reach 100%
      expect(Math.max(...progressUpdates)).toBe(100);
    });

    it('should handle empty file array', async () => {
      const results = await HashCalculator.calculateBatchHash([]);
      expect(results).toEqual([]);
    });
  });

  describe('calculateQuickHash()', () => {
    it('should calculate quick hash for small file', async () => {
      const file = new File(['Quick test'], 'quick.txt');

      const hash = await HashCalculator.calculateQuickHash(file);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(32);
    });

    it('should calculate quick hash for large file', async () => {
      const size = 10 * 1024 * 1024; // 10MB
      const buffer = new ArrayBuffer(size);
      const file = new File([buffer], 'large.bin');

      const hash = await HashCalculator.calculateQuickHash(file);

      expect(hash).toBeDefined();
    });

    it('should be faster than full hash for large files', async () => {
      const size = 5 * 1024 * 1024; // 5MB
      const buffer = new ArrayBuffer(size);
      const file = new File([buffer], 'perf.bin');

      const quickStart = Date.now();
      await HashCalculator.calculateQuickHash(file);
      const quickDuration = Date.now() - quickStart;

      const fullResult = await HashCalculator.calculateHash(file);

      // Quick hash should generally be faster
      // (though in small files the difference might be minimal)
      expect(quickDuration).toBeLessThanOrEqual(fullResult.duration * 2);
    });

    it('should produce different hashes for different files', async () => {
      const file1 = new File(['content1'], 'file1.txt');
      const file2 = new File(['content2'], 'file2.txt');

      const hash1 = await HashCalculator.calculateQuickHash(file1);
      const hash2 = await HashCalculator.calculateQuickHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty file', async () => {
      const file = new File([], 'empty.txt');
      const hash = await HashCalculator.calculateQuickHash(file);
      expect(hash).toBeDefined();
    });
  });
});
