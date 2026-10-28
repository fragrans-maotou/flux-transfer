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

  it('uses a Worker when available and reports progress', async () => {
    class FakeWorker {
      listeners = new Map<string, Set<(event: any) => void>>();
      addEventListener(type: string, fn: (event: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      }
      removeEventListener(type: string, fn: (event: any) => void) {
        this.listeners.get(type)?.delete(fn);
      }
      postMessage(data: any) {
        if (data?.type === 'start') {
          queueMicrotask(() => {
            this.emit('message', { data: { type: 'progress', progress: 50 } });
            this.emit('message', { data: { type: 'done', hash: '900150983cd24fb0d6963f7d28e17f72' } });
          });
        }
      }
      terminate() {}
      emit(type: string, event: any) {
        for (const fn of this.listeners.get(type) ?? []) fn(event);
      }
    }
    vi.stubGlobal('Worker', FakeWorker as any);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: vi.fn(),
    });

    const progress = vi.fn();
    const hash = await computeFileHash(new File(['abc'], 'a.txt'), 2, undefined, progress);
    expect(hash).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(progress).toHaveBeenCalledWith(50);
  });

  it('falls back when the Worker posts an error', async () => {
    class FakeWorker {
      listeners = new Map<string, Set<(event: any) => void>>();
      addEventListener(type: string, fn: (event: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      }
      removeEventListener(type: string, fn: (event: any) => void) {
        this.listeners.get(type)?.delete(fn);
      }
      postMessage(data: any) {
        if (data?.type === 'start') {
          queueMicrotask(() => {
            this.emit('message', { data: { type: 'error', message: 'boom' } });
          });
        }
      }
      terminate() {}
      emit(type: string, event: any) {
        for (const fn of this.listeners.get(type) ?? []) fn(event);
      }
    }
    vi.stubGlobal('Worker', FakeWorker as any);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: vi.fn(),
    });

    const hash = await computeFileHash(new File(['abc'], 'a.txt'), 1);
    expect(hash).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});
