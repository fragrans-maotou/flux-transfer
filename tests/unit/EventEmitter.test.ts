import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/infra/EventEmitter';

describe('EventEmitter', () => {
  describe('on()', () => {
    it('should register event listener', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      emitter.on('test', listener);
      emitter.emit('test', 'arg1', 'arg2');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should support multiple listeners for same event', () => {
      const emitter = new EventEmitter();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.emit('test', 'data');

      expect(listener1).toHaveBeenCalledWith('data');
      expect(listener2).toHaveBeenCalledWith('data');
    });

    it('should return unsubscribe function', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      const unsubscribe = emitter.on('test', listener);
      emitter.emit('test');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      emitter.emit('test');
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe('once()', () => {
    it('should trigger listener only once', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      emitter.once('test', listener);
      emitter.emit('test', 'first');
      emitter.emit('test', 'second');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('first');
    });

    it('should return unsubscribe function', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      const unsubscribe = emitter.once('test', listener);
      unsubscribe(); // Unsubscribe before emit
      emitter.emit('test');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('off()', () => {
    it('should remove specific listener', () => {
      const emitter = new EventEmitter();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.off('test', listener1);
      emitter.emit('test');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should handle removing non-existent listener gracefully', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      expect(() => emitter.off('test', listener)).not.toThrow();
    });
  });

  describe('emit()', () => {
    it('should pass multiple arguments to listeners', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      emitter.on('test', listener);
      emitter.emit('test', 1, 'two', { three: 3 }, [4]);

      expect(listener).toHaveBeenCalledWith(1, 'two', { three: 3 }, [4]);
    });

    it('should handle non-existent event gracefully', () => {
      const emitter = new EventEmitter();
      expect(() => emitter.emit('nonexistent')).not.toThrow();
    });

    it('should isolate errors - one listener error should not affect others', () => {
      const emitter = new EventEmitter();
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      emitter.on('test', errorListener);
      emitter.on('test', normalListener);
      emitter.emit('test');

      expect(errorListener).toHaveBeenCalled();
      expect(normalListener).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should emit error event when listener throws', () => {
      const emitter = new EventEmitter();
      const errorListener = vi.fn(() => {
        throw new Error('Test error');
      });
      const errorHandler = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      emitter.on('test', errorListener);
      emitter.on('error', errorHandler);
      emitter.emit('test');

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorHandler.mock.calls[0][1]).toBe('test');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('removeAllListeners()', () => {
    it('should remove all listeners for specific event', () => {
      const emitter = new EventEmitter();
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const otherListener = vi.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.on('other', otherListener);

      emitter.removeAllListeners('test');
      emitter.emit('test');
      emitter.emit('other');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(otherListener).toHaveBeenCalled();
    });

    it('should remove all listeners for all events', () => {
      const emitter = new EventEmitter();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('test1', listener1);
      emitter.on('test2', listener2);

      emitter.removeAllListeners();
      emitter.emit('test1');
      emitter.emit('test2');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount()', () => {
    it('should return correct listener count', () => {
      const emitter = new EventEmitter();

      expect(emitter.listenerCount('test')).toBe(0);

      emitter.on('test', () => { });
      expect(emitter.listenerCount('test')).toBe(1);

      emitter.on('test', () => { });
      expect(emitter.listenerCount('test')).toBe(2);
    });
  });

  describe('eventNames()', () => {
    it('should return all event names', () => {
      const emitter = new EventEmitter();

      expect(emitter.eventNames()).toEqual([]);

      emitter.on('test1', () => { });
      emitter.on('test2', () => { });

      const names = emitter.eventNames();
      expect(names).toContain('test1');
      expect(names).toContain('test2');
      expect(names.length).toBe(2);
    });
  });

  describe('Memory leak prevention', () => {
    it('should clean up empty event set when last listener is removed', () => {
      const emitter = new EventEmitter();
      const listener = vi.fn();

      const unsubscribe = emitter.on('test', listener);
      expect(emitter.eventNames()).toContain('test');

      unsubscribe();
      expect(emitter.eventNames()).not.toContain('test');
    });
  });
});
