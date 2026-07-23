import { performance } from 'node:perf_hooks';
import { TransferEngine } from '../dist/index.js';

const MIB = 1024 * 1024;
const CHUNK_SIZE = 5 * MIB;
const SAMPLE_COUNT = 5;
const scenarios = [
  { label: '100 MiB', size: 100 * MIB },
  { label: '1 GiB', size: 1024 * MIB },
];
const results = [];

// Warm up the engine and JavaScript runtime before collecting samples.
await runScenario({ label: 'warm-up', size: 20 * MIB });

for (const scenario of scenarios) {
  const samples = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    samples.push(await runScenario(scenario));
  }

  results.push({
    scenario: scenario.label,
    chunks: Math.ceil(scenario.size / CHUNK_SIZE),
    requests: samples[0].requests,
    medianMs: round(median(samples.map((sample) => sample.elapsedMs))),
    medianHeapMiB: round(median(samples.map((sample) => sample.heapDeltaMiB))),
    samples: SAMPLE_COUNT,
  });
}

console.table(results);
console.log('Values are medians after one warm-up run.');
console.log('This measures client scheduling overhead with virtual files and an in-memory adapter.');
console.log('It does not measure hashing, browser Blob allocation, disk I/O or network throughput.');

async function runScenario(scenario) {
  global.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  let requests = 0;
  const engine = new TransferEngine({
    uploadUrl: '/virtual-upload',
    chunkSize: CHUNK_SIZE,
    concurrency: 4,
    maxActiveTasks: 1,
    hash: false,
    networkAdapter: {
      async request() {
        requests += 1;
        return { data: null, status: 200, statusText: 'OK', headers: {} };
      },
    },
    protocol: {
      createChunkRequest() {
        return { url: '/virtual-chunk', method: 'POST' };
      },
      createCompleteRequest() {
        return null;
      },
    },
  });

  try {
    const file = createVirtualFile(scenario.size, scenario.label + '.bin');
    const taskId = engine.upload(file);
    await waitForCompletion(engine, taskId);
    return {
      requests,
      elapsedMs: performance.now() - startedAt,
      heapDeltaMiB: (process.memoryUsage().heapUsed - beforeHeap) / MIB,
    };
  } finally {
    await engine.destroy();
  }
}

function createVirtualFile(size, name) {
  return {
    name,
    size,
    lastModified: 0,
    slice(start, end) {
      return { size: Math.max(0, Math.min(size, end) - start) };
    },
  };
}

function waitForCompletion(engine, taskId) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    stop = engine.subscribe(taskId, (task) => {
      if (task?.status === 'completed') {
        stop();
        resolve(task);
      } else if (task?.status === 'failed') {
        stop();
        reject(task.error);
      }
    });
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value) {
  return Number(value.toFixed(2));
}
