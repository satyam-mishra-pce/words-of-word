#!/usr/bin/env node
/**
 * Builds and runs one local tournament capacity cell in a container constrained
 * to the documented Render Free allocation: 0.1 CPU and 512 MiB memory.
 *
 * This script always targets a loopback-only container. It never sends game
 * traffic to Render or any public origin.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const hostPort = Number(process.env.HOST_PORT ?? 4100);
const imageTag = process.env.RENDER_FREE_IMAGE ?? 'words-of-word-render-free-local:latest';
const cellName = (process.env.CELL_NAME ?? 'render-free-cell').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
const sourceWord = (process.env.SOURCE_WORD ?? 'pneumonoultramicroscopicsilicovolcanoconiosis').trim().toLowerCase();
const fixedSource = process.env.FIXED_SOURCE !== '0';
const suffix = `${Date.now()}-${process.pid}`;
const containerName = `wow-render-free-${suffix}`;
const reportPath = process.env.REPORT_PATH
  ? resolve(repoRoot, process.env.REPORT_PATH)
  : resolve(repoRoot, 'logs', `render-free-cell-${cellName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

if (!Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535) {
  throw new Error(`HOST_PORT must be an integer from 1024 to 65535; received ${process.env.HOST_PORT}.`);
}
if (!/^[a-z]+$/.test(sourceWord) || sourceWord.length < 5) {
  throw new Error('SOURCE_WORD must be alphabetic and at least five characters long.');
}

function run(command, args, { env = process.env, quiet = false, allowFailure = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    let stdout = '';
    let stderr = '';
    if (quiet) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      const result = { code: code ?? 1, signal, stdout, stderr };
      if ((code ?? 1) !== 0 && !allowFailure) {
        rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal ?? 'an unknown error'}${stderr ? `: ${stderr.trim()}` : ''}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

async function dockerJson(args) {
  const result = await run('docker', args, { quiet: true, allowFailure: true });
  if (result.code !== 0) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

async function dockerText(args) {
  const result = await run('docker', args, { quiet: true, allowFailure: true });
  return result.code === 0 ? result.stdout : result.stderr;
}

async function waitForHealth(targetOrigin, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'No response received.';
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(`${targetOrigin}/health`, { signal: controller.signal });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Local Render-Free container did not become healthy within ${timeoutMs} ms: ${lastError}`);
}

async function appendContainerEvidence() {
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    return;
  }

  const inspect = await dockerJson(['inspect', containerName]);
  const logs = await dockerText(['logs', '--tail', '500', containerName]);
  report.container = {
    imageTag,
    name: containerName,
    targetOrigin: `http://127.0.0.1:${hostPort}`,
    documentedRenderFreeEnvelope: { cpu: 0.1, memoryBytes: 512 * 1024 * 1024 },
    dockerLimits: { cpus: 0.1, memory: '512m', memorySwap: '512m' },
    inspect: Array.isArray(inspect) ? inspect[0] : inspect,
    logsTail: logs.slice(-32_000)
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

let containerStarted = false;
let childResult = { code: 1 };
try {
  if (process.env.SKIP_IMAGE_BUILD !== '1') {
    console.log(`Building ${imageTag} from Dockerfile.render-free…`);
    await run('docker', ['build', '--file', 'Dockerfile.render-free', '--tag', imageTag, '.']);
  }

  console.log(`Starting ${containerName} at http://127.0.0.1:${hostPort} with --cpus=0.1 --memory=512m…`);
  await run('docker', [
    'run', '--detach', '--name', containerName,
    '--cpus=0.1', '--memory=512m', '--memory-swap=512m',
    '--publish', `127.0.0.1:${hostPort}:4000`,
    '--env', 'NODE_ENV=production',
    '--env', 'PORT=4000',
    ...(fixedSource ? ['--env', 'LOCAL_LOAD_TEST=1', '--env', `LOCAL_LOAD_TEST_SOURCE_WORD=${sourceWord}`] : []),
    '--env', 'ANALYTICS_AGGREGATE_FILE=/tmp/wow-analytics/aggregate-analytics.json',
    imageTag
  ]);
  containerStarted = true;

  await waitForHealth(`http://127.0.0.1:${hostPort}`);
  console.log('Container is healthy. Launching the loopback-only capacity cell…');

  childResult = await run(process.execPath, ['apps/web/scripts/render-free-capacity-cell.mjs'], {
    env: {
      ...process.env,
      TARGET_URL: `http://127.0.0.1:${hostPort}`,
      CONTAINER_NAME: containerName,
      SOURCE_WORD: sourceWord,
      FIXED_SOURCE: fixedSource ? '1' : '0',
      LEXICON_DB_PATH: process.env.LEXICON_DB_PATH ?? 'packages/lexicon/artifacts/words-of-word-lexicon-v0.1.0.sqlite',
      LEXICON_MANIFEST_PATH: process.env.LEXICON_MANIFEST_PATH ?? 'packages/lexicon/artifacts/manifest.json',
      REPORT_PATH: reportPath
    },
    allowFailure: true
  });
} finally {
  if (containerStarted) {
    // Capture the terminal state after a graceful stop: this is where Docker
    // records an OOM kill or abnormal exit that the client may only see as a
    // socket disconnect.
    await run('docker', ['stop', '--time', '10', containerName], { quiet: true, allowFailure: true });
    await appendContainerEvidence();
    await run('docker', ['rm', '--force', containerName], { quiet: true, allowFailure: true });
  }
}

console.log(`Cell report: ${reportPath}`);
process.exitCode = childResult.code === 0 ? 0 : 1;
