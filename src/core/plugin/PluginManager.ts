/**
 * Plugin Manager
 * Manages plugin registration and hook execution
 */
import type { IPlugin, IPluginContext } from './types';
import type { INetworkRequestConfig } from '../types';

export class PluginManager {
  private plugins: IPlugin[] = [];

  constructor(plugins: IPlugin[] = []) {
    this.plugins = plugins;
  }

  /**
   * Register a new plugin
   */
  register(plugin: IPlugin): void {
    if (this.plugins.some(p => p.name === plugin.name)) {
      console.warn(`Plugin "${plugin.name}" is already registered.`);
      return;
    }
    this.plugins.push(plugin);
  }

  /**
   * Execute a synchronous/asynchronous hook
   * Runs sequentially
   */
  async runHook(
    hookName: keyof IPlugin,
    context: IPluginContext,
    ...args: any[]
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin[hookName];
      if (typeof hook === 'function') {
        try {
          await (hook as Function).apply(plugin, [context, ...args]);
        } catch (error) {
          console.error(`Error in plugin "${plugin.name}" hook "${hookName}":`, error);
          // We generally continue executing other plugins even if one fails
          // Unless it's a critical error handling decision
        }
      }
    }
  }

  /**
   * Execute a hook in parallel (no waiting for each other)
   * Good for 'onProgress'
   */
  runHookParallel(
    hookName: keyof IPlugin,
    context: IPluginContext,
    ...args: any[]
  ): void {
    this.plugins.forEach(plugin => {
      const hook = plugin[hookName];
      if (typeof hook === 'function') {
        try {
          (hook as Function).apply(plugin, [context, ...args]);
        } catch (error) {
          console.error(`Error in plugin "${plugin.name}" hook "${hookName}":`, error);
        }
      }
    });
  }

  /**
   * Transform request config through middleware chain
   */
  async transformRequest(config: INetworkRequestConfig): Promise<INetworkRequestConfig> {
    let currentConfig = { ...config };

    for (const plugin of this.plugins) {
      if (plugin.transformRequest) {
        try {
          currentConfig = await plugin.transformRequest(currentConfig);
        } catch (error) {
          console.error(`Error in plugin "${plugin.name}" transformRequest:`, error);
          // If transform fails, should we stop or continue? 
          // Usually failure here is critical (e.g. auth signature)
          throw error;
        }
      }
    }

    return currentConfig;
  }
}
