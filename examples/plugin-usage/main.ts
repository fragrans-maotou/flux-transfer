
import { TransferManager } from '../../src/core/TransferManager';
import { LoggerPlugin } from './LoggerPlugin';

// Mock File object for node environment (if needed, or just browser usage)
// In a real browser app, this would be:
// const file = input.files[0];

// Example usage
async function main() {
  const manager = new TransferManager({
    maxConcurrent: 1,
    // Register the plugin here
    plugins: [new LoggerPlugin()]
  });

  console.log('TransferManager initialized with LoggerPlugin.');

  // This is just a compilation check and robust example structure
  // We can't easily run this in Node without polyfilling File/Blob/IndexedDB/Worker
  // But this code serves as the documentation example.
}

main().catch(console.error);
