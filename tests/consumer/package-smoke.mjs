import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const typescriptCli = fileURLToPath(
  new URL('../../node_modules/typescript/bin/tsc', import.meta.url),
);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this smoke test through npm so npm_execpath is available');

const temporaryRoot = await mkdtemp(join(tmpdir(), 'flux-transfer-consumer-'));
const consumerRoot = join(temporaryRoot, 'consumer');

try {
  await mkdir(consumerRoot);
  await writeJson(join(consumerRoot, 'package.json'), {
    name: 'flux-transfer-consumer-smoke',
    private: true,
    type: 'module',
  });

  const pack = await runNpm(
    ['pack', '--ignore-scripts', '--json', '--pack-destination', temporaryRoot],
    projectRoot,
  );
  const [{ filename }] = JSON.parse(pack.stdout);
  const tarball = join(temporaryRoot, filename);

  await runNpm(
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball],
    consumerRoot,
  );

  await writeFile(
    join(consumerRoot, 'consumer.mjs'),
    `import { FetchAdapter, TransferEngine } from 'flux-transfer';
if (typeof TransferEngine !== 'function' || typeof FetchAdapter !== 'function') {
  throw new Error('ESM exports are unavailable');
}
const engine = new TransferEngine({ hash: false });
await engine.destroy();
`,
  );
  await run(process.execPath, ['consumer.mjs'], consumerRoot);
  console.log('[ok] ESM import');

  await writeFile(
    join(consumerRoot, 'consumer.cjs'),
    `const { FetchAdapter, TransferEngine } = require('flux-transfer');
if (typeof TransferEngine !== 'function' || typeof FetchAdapter !== 'function') {
  throw new Error('CommonJS exports are unavailable');
}
const engine = new TransferEngine({ hash: false });
void engine.destroy();
`,
  );
  await run(process.execPath, ['consumer.cjs'], consumerRoot);
  console.log('[ok] CommonJS require');

  await writeFile(
    join(consumerRoot, 'consumer.ts'),
    `import { TransferEngine, type ISDKConfig, type ITransferTask } from 'flux-transfer';
const config: ISDKConfig = { uploadUrl: '/upload', hash: false };
const engine = new TransferEngine(config);
const readStatus = (task: ITransferTask): string => task.status;
void readStatus;
await engine.destroy();
`,
  );
  await run(
    process.execPath,
    [
      typescriptCli,
      '--noEmit',
      '--strict',
      '--target',
      'ES2020',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--lib',
      'ES2020,DOM',
      'consumer.ts',
    ],
    consumerRoot,
  );
  console.log('[ok] TypeScript declarations');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function runNpm(args, cwd) {
  return run(process.execPath, [npmCli, ...args], cwd);
}

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (error.stdout) console.error(error.stdout);
    if (error.stderr) console.error(error.stderr);
    throw error;
  }
}

function writeJson(path, value) {
  return writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
