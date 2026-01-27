/**
 * Download Strategy Factory
 * Automatically selects the best available download strategy
 */

import type { IDownloadStrategy, DownloadStrategyType } from './IDownloadStrategy';
import { FetchBlobStrategy } from './FetchBlobStrategy';
import { DirectLinkStrategy } from './DirectLinkStrategy';
import { StreamSaverStrategy } from './StreamSaverStrategy';

/**
 * Factory for creating download strategies
 */
export class DownloadStrategyFactory {
  private static strategies: Map<string, () => IDownloadStrategy> = new Map();

  static {
    // Initialize strategies
    this.strategies.set('stream-saver', () => new StreamSaverStrategy());
    this.strategies.set('fetch-blob', () => new FetchBlobStrategy());
    this.strategies.set('direct-link', () => new DirectLinkStrategy());
  }

  /**
   * Get the best available strategy based on environment
   * @param preferredType Preferred strategy type (default: 'auto')
   * @returns Best available download strategy
   */
  static getStrategy(preferredType: DownloadStrategyType = 'auto'): IDownloadStrategy {
    // If specific strategy requested, try to use it
    if (preferredType !== 'auto') {
      const factory = this.strategies.get(preferredType);
      if (factory) {
        const strategy = factory();
        if (strategy.canUse()) {
          return strategy;
        }
        console.warn(`Requested strategy "${preferredType}" not available, falling back to auto`);
      }
    }

    // Auto-select: try strategies in order of capability
    const priorityOrder: DownloadStrategyType[] = [
      'stream-saver', // Best for large files (no memory limit)
      'fetch-blob',   // Good for medium files (with progress)
      'direct-link',  // Fallback (no progress)
    ];

    for (const type of priorityOrder) {
      const factory = this.strategies.get(type);
      if (factory) {
        const strategy = factory();
        if (strategy.canUse()) {
          return strategy;
        }
      }
    }

    // Fallback to direct link (should always work in browser)
    return new DirectLinkStrategy();
  }

  /**
   * Check if a specific strategy is available
   * @param type Strategy type to check
   * @returns true if strategy is available
   */
  static isStrategyAvailable(type: DownloadStrategyType): boolean {
    if (type === 'auto') return true;

    const factory = this.strategies.get(type);
    if (!factory) return false;

    const strategy = factory();
    return strategy.canUse();
  }

  /**
   * Get list of all available strategies
   * @returns Array of available strategy names
   */
  static getAvailableStrategies(): string[] {
    const available: string[] = [];

    this.strategies.forEach((factory, name) => {
      const strategy = factory();
      if (strategy.canUse()) {
        available.push(name);
      }
    });

    return available;
  }

  /**
   * Register a custom strategy
   * @param name Strategy name
   * @param factory Factory function to create the strategy
   */
  static registerStrategy(name: string, factory: () => IDownloadStrategy): void {
    this.strategies.set(name, factory);
  }
}
