#!/usr/bin/env node
/**
 * Repeats local Render-Free capacity cells at explicit levels and summarizes
 * the first level that fails a majority of repetitions. Levels are explicit so
 * an "exact" threshold is only claimed when adjacent integer levels are used.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const variable = process.env.SWEEP_VARIABLE ?? 'players';
const repeats = Number(process.env.REPEATS ?? 3);
const rawLevels = process.env.SWEEP_LEVELS ?? '';
const runLabel = (process.env.SWEEP_NAME ?? `${variable}-sweep`).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = process.env.SWEEP_REPORT_PATH
  ? resolve(repoRoot, process.env.SWEEP_REPORT_PATH)
  : resolve(repoRoot, 'logs', `render-free-sweep-${runLabel}-${timestamp}.json`);

if (!['players', 'rooms', 'actionInterval', 'actionsPerPlayer'].includes(variable)) {
  throw new Error('SWEEP_VARIABLE must be players, rooms, actionInterval, or actionsPerPlayer.');
}
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) {
  throw new Error('REPEATS must be an integer from 1 to 10.');
}
const levels = [...new Set(rawLevels.split(',').map((item) => Number(item.trim())).filter(Number.isFinite))]
  .sort((left, right) => left - right);
if (levels.length === 0 || levels.some((level) => !Number.isInteger(level) || level <= 0)) {
  throw new Error('SWEEP_LEVELS must be a comma-separated list of positive integers.');
}

function run(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => resolvePromise({ code: code ?? 1, signal }));
  });
}

function cellEnvironment(level, repetition, reportPath, shouldBuild) {
  const env = {
    ...process.env,
    CELL_NAME: `${runLabel}-${variable}-${level}-r${repetition}`,
    REPORT_PATH: reportPath,
    // Builds are cached by Docker, but skipping after the first run avoids
    // spending time checking the context between neighboring exact levels.
    SKIP_IMAGE_BUILD: shouldBuild ? (process.env.SKIP_IMAGE_BUILD ?? '0') : '1'
  };
  if (variable === 'players') env.PLAYERS_PER_ROOM = String(level);
  if (variable === 'rooms') env.ROOMS = String(level);
  if (variable === 'actionInterval') env.ACTION_INTERVAL_MS = String(level);
  if (variable === 'actionsPerPlayer') env.ACTIONS_PER_PLAYER = String(level);
  return env;
}

function majorityResult(runs) {
  const passing = runs.filter((run) => run.result === 'pass').length;
  const failing = runs.filter((run) => run.result === 'fail').length;
  const inconclusive = runs.length - passing - failing;
  const threshold = Math.floor(runs.length / 2) + 1;
  return {
    passCount: passing,
    failCount: failing,
    inconclusiveCount: inconclusive,
    majority: passing >= threshold ? 'pass' : failing >= threshold ? 'fail' : 'inconclusive'
  };
}

const report = {
  schemaVersion: 1,
  kind: 'local-render-free-capacity-sweep',
  startedAt: new Date().toISOString(),
  variable,
  levels,
  repeats,
  inheritedCellConfiguration: {
    gameMode: process.env.GAME_MODE ?? 'battleRoyale',
    rooms: process.env.ROOMS ?? '1',
    playersPerRoom: process.env.PLAYERS_PER_ROOM ?? '4',
    actionsPerPlayer: process.env.ACTIONS_PER_PLAYER ?? '4',
    actionIntervalMs: process.env.ACTION_INTERVAL_MS ?? '750',
    roundSeconds: process.env.ROUND_SECONDS ?? '10'
  },
  levels: [],
  threshold: null,
  finishedAt: null
};

let hasBuilt = false;
for (const level of levels) {
  const runs = [];
  for (let repetition = 1; repetition <= repeats; repetition += 1) {
    const cellReportPath = resolve(repoRoot, 'logs', `render-free-sweep-cell-${runLabel}-${variable}-${level}-r${repetition}-${timestamp}.json`);
    console.log(`\n=== ${variable}=${level}, repetition ${repetition}/${repeats} ===`);
    const result = await run(process.execPath, ['scripts/run-render-free-cell.mjs'], cellEnvironment(level, repetition, cellReportPath, !hasBuilt));
    hasBuilt = true;
    let cell;
    try {
      cell = JSON.parse(await readFile(cellReportPath, 'utf8'));
    } catch (error) {
      runs.push({
        repetition,
        processExitCode: result.code,
        reportPath: cellReportPath,
        result: 'inconclusive',
        reason: `Could not read cell report: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }
    runs.push({
      repetition,
      processExitCode: result.code,
      reportPath: cellReportPath,
      result: cell.verdict?.result ?? 'inconclusive',
      reasons: cell.verdict?.reasons ?? [],
      summary: cell.summary ?? null,
      containerState: cell.container?.inspect?.State ?? null
    });
  }
  report.levels.push({ level, runs, ...majorityResult(runs) });
}

const firstMajorityFailureIndex = report.levels.findIndex((level) => level.majority === 'fail');
report.threshold = {
  firstMajorityFailure: firstMajorityFailureIndex === -1 ? null : report.levels[firstMajorityFailureIndex],
  lastMajorityPassBeforeFailure: firstMajorityFailureIndex <= 0 ? null : report.levels
    .slice(0, firstMajorityFailureIndex)
    .reverse()
    .find((level) => level.majority === 'pass') ?? null,
  exactness: 'A threshold is exact only if the supplied SWEEP_LEVELS include every integer between the adjacent pass and fail levels.'
};
report.finishedAt = new Date().toISOString();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nSweep report: ${outputPath}`);
if (report.threshold.firstMajorityFailure) {
  console.log(`First majority failure: ${variable}=${report.threshold.firstMajorityFailure.level}`);
}
