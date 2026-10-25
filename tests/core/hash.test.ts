import { describe, expect, it, vi, afterEach } from 'vitest';
import { computeFileHash } from '../../src/core/utils/hash';

describe('computeFileHash', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hashes incrementally and reports progress', async () => {
    const progress = vi.fn();
    const hash = await computeFileHash(new File(['abc'], 'a.txt'), 2, undefined, progress);

    expect(hash).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      computeFileHash(new File(['abc'], 'a.txt'), 2, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('falls back to the main-thread path when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const progress = vi.fn();
    const hash = await computeFileHash(new File(['abc'], 'a.txt'), 2, undefined, progress);

    expect(hash).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it('falls back when the Worker constructor throws', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker unsupported');
        }
      },
    );

    const hash = await computeFileHash(new File(['abc'], 'a.txt'), 1);
    expect(hash).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});
