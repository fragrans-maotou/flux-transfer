/**
 * 事件发射器 - 通用发布-订阅模式实现
 */

type EventListener = (...args: unknown[]) => void;
type UnsubscribeFn = () => void;

/**
 * 事件发射器 - 实现发布-订阅模式
 */
export class EventEmitter {
  private events: Map<string, Set<EventListener>> = new Map();

  /**
   * 订阅事件
   * @param eventName 事件名称
   * @param listener 事件监听函数
   * @returns 取消订阅函数
   */
  on(eventName: string, listener: EventListener): UnsubscribeFn {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }

    const listeners = this.events.get(eventName)!;
    listeners.add(listener);

    // 返回取消订阅函数，防止内存泄漏
    return () => {
      this.off(eventName, listener);
    };
  }

  /**
   * 订阅事件（仅一次）
   * @param eventName 事件名称
   * @param listener 事件监听函数
   * @returns 取消订阅函数
   */
  once(eventName: string, listener: EventListener): UnsubscribeFn {
    const onceListener: EventListener = (...args: unknown[]) => {
      this.off(eventName, onceListener);
      listener(...args);
    };

    return this.on(eventName, onceListener);
  }

  /**
   * 取消订阅事件
   * @param eventName 事件名称
   * @param listener 事件监听函数
   */
  off(eventName: string, listener: EventListener): void {
    const listeners = this.events.get(eventName);
    if (listeners) {
      listeners.delete(listener);
      // 清理空事件集合
      if (listeners.size === 0) {
        this.events.delete(eventName);
      }
    }
  }

  /**
   * 发射事件
   * @param eventName 事件名称
   * @param args 传递给监听器的参数
   */
  emit(eventName: string, ...args: unknown[]): void {
    const listeners = this.events.get(eventName);
    if (!listeners || listeners.size === 0) {
      return;
    }

    // 执行监听器，隔离错误
    listeners.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        // 错误隔离：一个监听器的错误不影响其他监听器
        console.error(`Error in event listener for "${eventName}":`, error);

        // 发射错误事件用于调试
        const errorListeners = this.events.get('error');
        if (errorListeners && errorListeners.size > 0) {
          errorListeners.forEach((errorListener) => {
            try {
              errorListener(error, eventName);
            } catch (e) {
              console.error('Error in error listener:', e);
            }
          });
        }
      }
    });
  }

  /**
   * 移除特定事件的所有监听器或所有事件的所有监听器
   * @param eventName 可选事件名称。如果不提供，则移除所有监听器
   */
  removeAllListeners(eventName?: string): void {
    if (eventName) {
      this.events.delete(eventName);
    } else {
      this.events.clear();
    }
  }

  /**
   * 获取特定事件的监听器数量
   * @param eventName 事件名称
   * @returns 监听器数量
   */
  listenerCount(eventName: string): number {
    const listeners = this.events.get(eventName);
    return listeners ? listeners.size : 0;
  }

  /**
   * 获取所有监听器的事件名称
   * @returns 事件名称数组
   */
  eventNames(): string[] {
    return Array.from(this.events.keys());
  }
}
