/**
 * Event Emitter - Generic publish-subscribe pattern implementation
 */

type EventListener = (...args: unknown[]) => void;
type UnsubscribeFn = () => void;

/**
 * EventEmitter class for implementing publish-subscribe pattern
 */
export class EventEmitter {
  private events: Map<string, Set<EventListener>> = new Map();

  /**
   * Subscribe to an event
   * @param event Event name
   * @param listener Event listener function
   * @returns Unsubscribe function
   */
  on(event: string, listener: EventListener): UnsubscribeFn {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }

    const listeners = this.events.get(event)!;
    listeners.add(listener);

    // Return unsubscribe function to prevent memory leaks
    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Subscribe to an event (one-time only)
   * @param event Event name
   * @param listener Event listener function
   * @returns Unsubscribe function
   */
  once(event: string, listener: EventListener): UnsubscribeFn {
    const onceListener: EventListener = (...args: unknown[]) => {
      this.off(event, onceListener);
      listener(...args);
    };

    return this.on(event, onceListener);
  }

  /**
   * Unsubscribe from an event
   * @param event Event name
   * @param listener Event listener function to remove
   */
  off(event: string, listener: EventListener): void {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
      // Clean up empty event set
      if (listeners.size === 0) {
        this.events.delete(event);
      }
    }
  }

  /**
   * Emit an event
   * @param event Event name
   * @param args Arguments to pass to listeners
   */
  emit(event: string, ...args: unknown[]): void {
    const listeners = this.events.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    // Execute listeners with error isolation
    listeners.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        // Error isolation: one listener's error doesn't affect others
        console.error(`Error in event listener for "${event}":`, error);

        // Emit error event for debugging
        const errorListeners = this.events.get('error');
        if (errorListeners && errorListeners.size > 0) {
          errorListeners.forEach((errorListener) => {
            try {
              errorListener(error, event);
            } catch (e) {
              console.error('Error in error listener:', e);
            }
          });
        }
      }
    });
  }

  /**
   * Remove all listeners for a specific event or all events
   * @param event Optional event name. If not provided, removes all listeners
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  /**
   * Get listener count for a specific event
   * @param event Event name
   * @returns Number of listeners
   */
  listenerCount(event: string): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.size : 0;
  }

  /**
   * Get all event names with listeners
   * @returns Array of event names
   */
  eventNames(): string[] {
    return Array.from(this.events.keys());
  }
}
