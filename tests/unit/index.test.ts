import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/index';

describe('SDK Entry Point', () => {
  it('should export VERSION', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('should have a defined version', () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe('string');
  });
});
