import { describe, expect, it, vi } from 'vitest';
import { computeFileHash } from '../../src/core/utils/hash';

describe('computeFileHash', () => {
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
});
