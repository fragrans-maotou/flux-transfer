
import { IPlugin, IPluginContext } from '../../src/core/plugin/types';

export class LoggerPlugin implements IPlugin {
  name = 'LoggerPlugin';
  version = '1.0.0';

  onTaskCreated(context: IPluginContext) {
    console.log(`[LoggerPlugin] Task created: ${context.task.fileName} (${context.task.id})`);
  }

  beforeStart(context: IPluginContext) {
    console.log(`[LoggerPlugin] Upload starting for ${context.task.fileName}`);
  }

  onProgress(context: IPluginContext, progress: number) {
    // Log only every 10%
    if (progress % 10 === 0) {
      console.log(`[LoggerPlugin] Progress: ${progress}%`);
    }
  }

  onSuccess(context: IPluginContext) {
    console.log(`[LoggerPlugin] Upload completed successfully!`);
  }

  onError(context: IPluginContext, error: Error) {
    console.error(`[LoggerPlugin] Upload failed: ${error.message}`);
  }
}
