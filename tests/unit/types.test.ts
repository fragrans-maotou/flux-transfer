import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  ErrorCode,
  validateConfig,
  DEFAULT_SDK_CONFIG,
  type ISDKConfig,
} from '../../src/core/types';

describe('Core Types', () => {
  describe('TaskStatus Enum', () => {
    it('should have all required statuses', () => {
      expect(TaskStatus.Idle).toBe('idle');
      expect(TaskStatus.Processing).toBe('processing');
      expect(TaskStatus.Transferring).toBe('transferring');
      expect(TaskStatus.Paused).toBe('paused');
      expect(TaskStatus.Completed).toBe('completed');
      expect(TaskStatus.Failed).toBe('failed');
      expect(TaskStatus.Cancelled).toBe('cancelled');
    });
  });

  describe('ErrorCode Enum', () => {
    it('should have all required error codes', () => {
      expect(ErrorCode.NetworkTimeout).toBe('NETWORK_TIMEOUT');
      expect(ErrorCode.ServerError).toBe('SERVER_ERROR');
      expect(ErrorCode.FileNotFound).toBe('FILE_NOT_FOUND');
    });
  });

  describe('validateConfig', () => {
    it('should return default config when no config provided', () => {
      const config = validateConfig();
      expect(config.maxConcurrent).toBe(3);
      expect(config.chunkSize).toBe(5 * 1024 * 1024);
      expect(config.maxRetries).toBe(3);
    });

    it('should merge user config with defaults', () => {
      const userConfig: ISDKConfig = {
        maxConcurrent: 5,
        chunkSize: 10 * 1024 * 1024,
      };
      const config = validateConfig(userConfig);
      expect(config.maxConcurrent).toBe(5);
      expect(config.chunkSize).toBe(10 * 1024 * 1024);
      expect(config.maxRetries).toBe(3); // from default
    });

    it('should throw error for invalid maxConcurrent', () => {
      expect(() => validateConfig({ maxConcurrent: 0 })).toThrow(
        'maxConcurrent must be at least 1'
      );
      expect(() => validateConfig({ maxConcurrent: -1 })).toThrow(
        'maxConcurrent must be at least 1'
      );
    });

    it('should throw error for invalid chunkSize', () => {
      expect(() => validateConfig({ chunkSize: 512 })).toThrow(
        'chunkSize must be at least 1KB'
      );
      expect(() => validateConfig({ chunkSize: 200 * 1024 * 1024 })).toThrow(
        'chunkSize must not exceed 100MB'
      );
    });

    it('should throw error for invalid maxRetries', () => {
      expect(() => validateConfig({ maxRetries: -1 })).toThrow(
        'maxRetries must be non-negative'
      );
    });

    it('should throw error for invalid retryDelay', () => {
      expect(() => validateConfig({ retryDelay: -1 })).toThrow(
        'retryDelay must be non-negative'
      );
    });

    it('should throw error for invalid timeout', () => {
      expect(() => validateConfig({ timeout: 500 })).toThrow(
        'timeout must be at least 1000ms'
      );
    });

    it('should throw error for invalid maxFileSize', () => {
      expect(() => validateConfig({ maxFileSize: -1 })).toThrow(
        'maxFileSize must be non-negative'
      );
    });

    it('should accept valid edge case values', () => {
      const config = validateConfig({
        maxConcurrent: 1,
        chunkSize: 1024,
        maxRetries: 0,
        retryDelay: 0,
        timeout: 1000,
        maxFileSize: 0,
      });
      expect(config.maxConcurrent).toBe(1);
      expect(config.chunkSize).toBe(1024);
      expect(config.maxRetries).toBe(0);
    });
  });

  describe('DEFAULT_SDK_CONFIG', () => {
    it('should have sensible default values', () => {
      expect(DEFAULT_SDK_CONFIG.maxConcurrent).toBe(3);
      expect(DEFAULT_SDK_CONFIG.chunkSize).toBe(5 * 1024 * 1024);
      expect(DEFAULT_SDK_CONFIG.autoRetry).toBe(true);
      expect(DEFAULT_SDK_CONFIG.enableCheckpoint).toBe(true);
      expect(DEFAULT_SDK_CONFIG.enableHash).toBe(true);
    });
  });
});
