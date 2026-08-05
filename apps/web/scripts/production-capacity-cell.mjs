#!/usr/bin/env node
/**
 * One-factor-at-a-time, user-authorized production capacity cell.
 *
 * This runner is deliberately locked to Words of Word production. It tests
 * exactly one cell per invocation, never opens more than 100 virtual sockets,
 * and force-closes every socket at the 15-minute wall-clock ceiling.
 *
 * Examples (dry-run sends no traffic):
 *   CAPACITY_DRY_RUN=1 CAPACITY_FACTOR=rooms CAPACITY_LEVEL=10 \
 *     node apps/web/scripts/production-capacity-cell.mjs
 *
 *   LIVE_CAPACITY_AUTHORIZATION=I_UNDERSTAND_PRODUCTION_CAPACITY_TEST \
 *   CAPACITY_FACTOR=rooms CAPACITY_LEVEL=10 \
 *     node apps/web/scripts/production-capacity-cell.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const PRODUCTION_ORIGIN = 'https://words-of-word.onrender.com';
const REQUIRED_AUTHORIZATION = 'I_UNDERSTAND_PRODUCTION_CAPACITY_TEST';
const MAX_SOCKETS = 100;
const MAX_RUNTIME_MS = 15 * 60 * 1_000;
const CLEANUP_RESERVE_MS = 45 * 1_000;
const CONNECT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 8_000;
const EVENT_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 5_000;
const COLD_START_TIMEOUT_MS = 30_000;
const HEALTH_SLOW_MS = 3_000;
const MAX_CRITICAL_ERRORS = 3;
const ACTION_SLO_P95_MS = 1_000;
const ACTION_SLO_SUCCESS_RATE = 0.99;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const outputDirectory = resolve(repoRoot, 'logs');
const serverRequire = createRequire(new URL('../../server/src/index.ts', import.meta.url));
const rawDictionary = serverRequire('an-array-of-english-words');
const dictionary = rawDictionary.filter((word) => typeof word === 'string' && /^[a-z]+$/.test(word));

const dryRun = process.env.CAPACITY_DRY_RUN === '1';
const requestedOrigin = new URL(process.env.TARGET_URL ?? PRODUCTION_ORIGIN).origin;
const factor = (process.env.CAPACITY_FACTOR ?? '').trim();
const level = Number(process.env.CAPACITY_LEVEL ?? '');

if (requestedOrigin !== PRODUCTION_ORIGIN) {
  throw new Error(`This runner is intentionally locked to ${PRODUCTION_ORIGIN}.`);
}
if (!dryRun && process.env.LIVE_CAPACITY_AUTHORIZATION !== REQUIRED_AUTHORIZATION) {
  throw new Error(
    `Refusing to run. Set LIVE_CAPACITY_AUTHORIZATION=${REQUIRED_AUTHORIZATION} after approving production impact.`
  );
}
if (!Number.isFinite(level) || level <= 0) {
  throw new Error('CAPACITY_LEVEL must be a positive number.');
}

const CASUAL_BASELINE = Object.freeze({
  playersPerRoom: 4,
  rooms: 1,
  rounds: 5,
  timePerRoundSeconds: 30,
  actionCadenceMs: 5_000,
  gameMode: 'classic'
});

function resolveCell() {
  if (factor === 'rooms') {
    if (!Number.isInteger(level) || level > 25) throw new Error('rooms level must be an integer from 1 to 25.');
    return {
      factor,
      level,
      roomCount: level,
      playersPerRoom: CASUAL_BASELINE.playersPerRoom,
      rounds: CASUAL_BASELINE.rounds,
      timePerRoundSeconds: CASUAL_BASELINE.timePerRoundSeconds,
      actionCadenceMs: CASUAL_BASELINE.actionCadenceMs,
      gameCycles: 1,
      wordProfile: 'general'
    };
  }

  if (factor === 'players') {
    if (!Number.isInteger(level) || level < 2 || level > 50) throw new Error('players level must be an integer from 2 to 50.');
    return {
      factor,
      level,
      roomCount: 1,
      playersPerRoom: level,
      rounds: CASUAL_BASELINE.rounds,
      timePerRoundSeconds: CASUAL_BASELINE.timePerRoundSeconds,
      actionCadenceMs: CASUAL_BASELINE.actionCadenceMs,
      gameCycles: 1,
      wordProfile: 'general'
    };
  }

  if (factor === 'rate') {
    if (![10_000, 5_000, 2_500, 1_000, 500, 250, 100].includes(level)) {
      throw new Error('rate level must be one of 10000, 5000, 2500, 1000, 500, 250, or 100 milliseconds.');
    }
    return {
      factor,
      level,
      roomCount: 1,
      playersPerRoom: CASUAL_BASELINE.playersPerRoom,
      rounds: CASUAL_BASELINE.rounds,
      timePerRoundSeconds: CASUAL_BASELINE.timePerRoundSeconds,
      actionCadenceMs: level,
      gameCycles: 1,
      // A deterministic long source word ensures enough unique valid words for
      // high-rate valid-submission tests; it is documented in the report.
      wordProfile: 'high-candidate-custom'
    };
  }

  if (factor === 'duration') {
    if (!Number.isInteger(level) || level < 1 || level > 3) {
      throw new Error('duration level is the number of complete casual games and must be 1, 2, or 3.');
    }
    return {
      factor,
      level,
      roomCount: 1,
      playersPerRoom: CASUAL_BASELINE.playersPerRoom,
      rounds: CASUAL_BASELINE.rounds,
      timePerRoundSeconds: CASUAL_BASELINE.timePerRoundSeconds,
      actionCadenceMs: CASUAL_BASELINE.actionCadenceMs,
      gameCycles: level,
      wordProfile: 'general'
    };
  }

  if (factor === 'battleRoyale') {
    // Five rounds with one knockout per round requires at least six players.
    // The 100-player upper bound mirrors the deployed shared settings schema.
    if (!Number.isInteger(level) || level < 6 || level > 100) {
      throw new Error('battleRoyale level must be an integer from 6 to 100.');
    }
    return {
      factor,
      level,
      roomCount: 1,
      playersPerRoom: level,
      rounds: CASUAL_BASELINE.rounds,
      timePerRoundSeconds: CASUAL_BASELINE.timePerRoundSeconds,
      actionCadenceMs: CASUAL_BASELINE.actionCadenceMs,
      gameCycles: 1,
      wordProfile: 'general',
      gameMode: 'battleRoyale',
      eliminationsPerRound: 1,
      strictActionSuccess: true
    };
  }

  throw new Error('CAPACITY_FACTOR must be one of: rooms, players, rate, duration, battleRoyale.');
}

const cell = {
  ...resolveCell(),
  // Room-count tests isolate steady active-game capacity; start games at a
  // realistic 0.2 games/sec rather than creating an artificial synchronized
  // dictionary-build burst. Game-start throughput is a separate factor.
  startSpacingMs: factor === 'rooms' ? 5_000 : 0
};
const activeSockets = cell.roomCount * cell.playersPerRoom;
if (activeSockets > MAX_SOCKETS) {
  throw new Error(`Cell would open ${activeSockets} sockets, above the ${MAX_SOCKETS}-socket ceiling.`);
}

const expectedSingleGameMs = (cell.rounds * cell.timePerRoundSeconds + (cell.rounds - 1) * 10) * 1_000;
const expectedCellMs = (expectedSingleGameMs + (cell.roomCount - 1) * cell.startSpacingMs) * cell.gameCycles;
if (expectedCellMs + CLEANUP_RESERVE_MS >= MAX_RUNTIME_MS) {
  throw new Error('Cell cannot finish within the 15-minute safety envelope.');
}

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    targetOrigin: PRODUCTION_ORIGIN,
    baseline: CASUAL_BASELINE,
    cell: { ...cell, activeSockets, expectedSingleGameMs, expectedCellMs },
    hardLimits: { maxSockets: MAX_SOCKETS, maxRuntimeMs: MAX_RUNTIME_MS, actionP95Ms: ACTION_SLO_P95_MS, successRate: ACTION_SLO_SUCCESS_RATE }
  }, null, 2));
  process.exit(0);
}

const hardDeadline = Date.now() + MAX_RUNTIME_MS;
const cleanupDeadline = hardDeadline - CLEANUP_RESERVE_MS;
const startedAt = new Date().toISOString();
const state = {
  abortReason: null,
  sloBreach: null,
  stage: 'preflight',
  clients: [],
  activeBattleRounds: new Map(),
  intentionalShutdown: false
};
const testAbortController = new AbortController();

const metrics = {
  schemaVersion: 1,
  startedAt,
  targetOrigin: PRODUCTION_ORIGIN,
  baseline: CASUAL_BASELINE,
  cell: { ...cell, activeSockets, expectedSingleGameMs, expectedCellMs },
  limits: {
    maxSockets: MAX_SOCKETS,
    maxRuntimeMs: MAX_RUNTIME_MS,
    cleanupReserveMs: CLEANUP_RESERVE_MS,
    actionSloP95Ms: ACTION_SLO_P95_MS,
    actionSloSuccessRate: ACTION_SLO_SUCCESS_RATE,
    healthSlowMs: HEALTH_SLOW_MS
  },
  connections: [],
  acknowledgements: [],
  actions: [],
  rounds: [],
  health: [],
  stats: [],
  errors: [],
  cleanupAcknowledgementFailures: [],
  ...(cell.gameMode === 'battleRoyale' ? {
    battleRoyale: {
      expectedEliminationsPerRound: cell.eliminationsPerRound,
      expectedRounds: cell.rounds,
      expectedPlayers: cell.playersPerRoom,
      plannedActions: 0,
      roundChecks: [],
      violations: [],
      gameOver: null,
      roomFullSnapshot: null,
      roomFullProbe: null,
      scoreFanout: null
    }
  } : {}),
  status: 'running',
  abortReason: null,
  cleanup: null,
  finishedAt: null
};

const hardStopTimer = setTimeout(() => {
  state.intentionalShutdown = true;
  for (const client of state.clients) {
    client.intentionalDisconnect = true;
    client.socket.disconnect();
  }
  console.error('\nHARD SAFETY FUSE: 15-minute limit reached; all test sockets closed.');
  process.exit(2);
}, MAX_RUNTIME_MS);
hardStopTimer.unref();

function nowIso() {
  return new Date().toISOString();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function elapsedMilliseconds(start) {
  return Number((performance.now() - start).toFixed(2));
}

function percentile(values, value) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((value / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: Number(Math.min(...finite).toFixed(2)),
    p50: percentile(finite, 50),
    p95: percentile(finite, 95),
    p99: percentile(finite, 99),
    max: Number(Math.max(...finite).toFixed(2)),
    mean: Number((sum / finite.length).toFixed(2))
  };
}

function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestStop(reason) {
  if (state.abortReason) return;
  state.abortReason = reason;
  metrics.abortReason = reason;
  testAbortController.abort(reason);
  console.error(`\nSTOP REQUESTED: ${reason}`);
}

function ensureRunning() {
  if (Date.now() >= cleanupDeadline) {
    requestStop('Approaching the 15-minute safety ceiling; preserving cleanup time.');
  }
  if (state.abortReason) throw new Error(state.abortReason);
}

function recordError(kind, error, { critical = true, clientId, detail } = {}) {
  const entry = {
    at: nowIso(),
    stage: state.stage,
    kind,
    critical,
    clientId,
    detail,
    message: asErrorMessage(error)
  };
  metrics.errors.push(entry);
  console.error(`[${state.stage}] ${kind}${clientId ? ` (${clientId})` : ''}: ${entry.message}`);
  if (!critical) return;
  const criticalCount = metrics.errors.filter((item) => item.critical).length;
  if (criticalCount >= MAX_CRITICAL_ERRORS) requestStop(`${criticalCount} critical failures observed.`);
}

function letterCounts(word) {
  const counts = new Map();
  for (const letter of word) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return counts;
}

function canMakeWord(candidate, sourceCounts) {
  const candidateCounts = letterCounts(candidate);
  for (const [letter, required] of candidateCounts) {
    if ((sourceCounts.get(letter) ?? 0) < required) return false;
  }
  return true;
}

function validCandidates(sourceWord, required) {
  const sourceCounts = letterCounts(sourceWord.toLowerCase());
  const candidates = [];
  for (const word of dictionary) {
    if (!canMakeWord(word, sourceCounts)) continue;
    candidates.push(word);
    if (candidates.length >= required) return candidates;
  }
  return candidates;
}

function createClient(index, socket) {
  const client = {
    id: `CM-${String(index + 1).padStart(3, '0')}`,
    socket,
    roomId: undefined,
    intentionalDisconnect: false,
    unexpectedDisconnects: 0,
    scoresUpdatedCount: 0,
    transportHistory: []
  };

  socket.on('scoresUpdated', () => {
    client.scoresUpdatedCount += 1;
  });

  socket.on('disconnect', (reason) => {
    if (client.intentionalDisconnect || state.intentionalShutdown) return;
    client.unexpectedDisconnects += 1;
    recordError('unexpected_socket_disconnect', reason, { clientId: client.id, detail: { reason } });
    requestStop(`Unexpected socket disconnect for ${client.id}.`);
  });

  return client;
}

async function connectClient(index) {
  ensureRunning();
  const started = performance.now();
  const socket = io(PRODUCTION_ORIGIN, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS
  });
  const client = createClient(index, socket);

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        testAbortController.signal.removeEventListener('abort', onAbort);
      };
      const onConnect = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise();
      };
      const onError = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      };
      const onAbort = () => onError(new Error('Test stopped while socket connection was pending.'));
      const timer = setTimeout(() => onError(new Error(`Socket did not connect within ${CONNECT_TIMEOUT_MS} ms.`)), CONNECT_TIMEOUT_MS);
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      testAbortController.signal.addEventListener('abort', onAbort, { once: true });
      if (testAbortController.signal.aborted) {
        onAbort();
        return;
      }
      socket.connect();
    });
  } catch (error) {
    client.intentionalDisconnect = true;
    socket.disconnect();
    recordError('socket_connect_failed', error, { clientId: client.id });
    throw error;
  }

  client.transportHistory.push({ at: nowIso(), transport: socket.io.engine?.transport?.name ?? 'unknown' });
  socket.io.engine?.on('upgrade', (transport) => {
    client.transportHistory.push({ at: nowIso(), transport: transport?.name ?? 'unknown' });
  });
  metrics.connections.push({ at: nowIso(), clientId: client.id, latencyMs: elapsedMilliseconds(started), transport: client.transportHistory[0].transport });
  return client;
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      if (state.abortReason) {
        results[index] = { status: 'skipped', reason: state.abortReason };
        continue;
      }
      try {
        results[index] = { status: 'fulfilled', value: await operation(items[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: asErrorMessage(error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function emitAck(client, eventName, payload, { timeoutMs = ACK_TIMEOUT_MS, critical = true, recordFailure = true } = {}) {
  ensureRunning();
  const started = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      testAbortController.signal.removeEventListener('abort', onAbort);
    };
    const finish = (response, error, { silent = false } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      const latencyMs = elapsedMilliseconds(started);
      const ok = !error && Boolean(response?.ok);
      metrics.acknowledgements.push({
        at: nowIso(), stage: state.stage, clientId: client.id, eventName, ok, latencyMs,
        ...(ok ? {} : { error: error?.message ?? response?.error ?? 'Unknown acknowledgement error.' })
      });
      if (!ok) {
        const failure = error ?? new Error(response?.error ?? `${eventName} failed without an error message.`);
        if (!silent && recordFailure) recordError('socket_ack_failure', failure, { critical, clientId: client.id, detail: { eventName } });
        rejectPromise(failure);
        return;
      }
      resolvePromise(response.data);
    };
    const onAbort = () => finish(undefined, new Error(`Test stopped before ${eventName} acknowledgement.`), { silent: true });
    const timer = setTimeout(() => finish(undefined, new Error(`${eventName} acknowledgement timed out after ${timeoutMs} ms.`)), timeoutMs);
    testAbortController.signal.addEventListener('abort', onAbort, { once: true });
    if (testAbortController.signal.aborted) {
      onAbort();
      return;
    }
    client.socket.emit(eventName, payload, (response) => finish(response));
  });
}

function emitExpectedRejectedAck(client, eventName, payload, { timeoutMs = ACK_TIMEOUT_MS } = {}) {
  ensureRunning();
  const started = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      testAbortController.signal.removeEventListener('abort', onAbort);
    };
    const finish = (response, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const latencyMs = elapsedMilliseconds(started);
      const unexpectedlySucceeded = !error && Boolean(response?.ok);
      const expectedRejection = !error && response?.ok === false;
      metrics.acknowledgements.push({
        at: nowIso(), stage: state.stage, clientId: client.id, eventName,
        ok: expectedRejection, latencyMs, expectedRejection: true,
        ...(expectedRejection ? { error: response.error } : { error: error?.message ?? (unexpectedlySucceeded ? 'Operation unexpectedly succeeded.' : 'Expected rejection response was missing.') })
      });
      if (error) {
        rejectPromise(error);
        return;
      }
      if (unexpectedlySucceeded) {
        rejectPromise(new Error(`${eventName} unexpectedly succeeded for the full-room probe.`));
        return;
      }
      if (!expectedRejection) {
        rejectPromise(new Error(`${eventName} did not return the expected full-room rejection.`));
        return;
      }
      resolvePromise(response.error);
    };
    const onAbort = () => finish(undefined, new Error(`Test stopped before ${eventName} acknowledgement.`));
    const timer = setTimeout(() => finish(undefined, new Error(`${eventName} acknowledgement timed out after ${timeoutMs} ms.`)), timeoutMs);
    testAbortController.signal.addEventListener('abort', onAbort, { once: true });
    if (testAbortController.signal.aborted) {
      onAbort();
      return;
    }
    client.socket.emit(eventName, payload, (response) => finish(response));
  });
}

function waitForEvent(client, eventName, predicate, { timeoutMs = EVENT_TIMEOUT_MS, critical = true } = {}) {
  const started = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off(eventName, handler);
      testAbortController.signal.removeEventListener('abort', onAbort);
    };
    const finish = (payload, error, { silent = false } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        if (!silent) recordError('socket_event_timeout', error, { critical, clientId: client.id, detail: { eventName } });
        rejectPromise(error);
        return;
      }
      resolvePromise(payload);
    };
    const handler = (payload) => {
      if (predicate && !predicate(payload)) return;
      finish(payload);
    };
    const onAbort = () => finish(undefined, new Error(`Test stopped while waiting for ${eventName}.`), { silent: true });
    const timer = setTimeout(() => finish(undefined, new Error(`${eventName} was not received within ${timeoutMs} ms.`)), timeoutMs);
    testAbortController.signal.addEventListener('abort', onAbort, { once: true });
    if (testAbortController.signal.aborted) {
      onAbort();
      return;
    }
    client.socket.on(eventName, handler);
  });
}

async function fetchJson(pathname, timeoutMs) {
  const started = performance.now();
  const controller = new AbortController();
  const abortOnTestStop = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    testAbortController.signal.addEventListener('abort', abortOnTestStop, { once: true });
    if (testAbortController.signal.aborted) controller.abort();
    const response = await fetch(`${PRODUCTION_ORIGIN}${pathname}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      redirect: 'error',
      signal: controller.signal
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, latencyMs: elapsedMilliseconds(started), body };
  } catch (error) {
    return { ok: false, status: null, latencyMs: elapsedMilliseconds(started), error: asErrorMessage(error) };
  } finally {
    clearTimeout(timer);
    // The one-shot listener is harmless after an already-fired abort, and this
    // removal prevents listener accumulation during normal monitoring.
    testAbortController.signal.removeEventListener('abort', abortOnTestStop);
  }
}

async function captureHealth(label, { critical = false, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const result = await fetchJson('/health', timeoutMs);
  const observation = { at: nowIso(), label, timeoutMs, ...result };
  metrics.health.push(observation);
  if (!result.ok && critical) requestStop(`Health failed during ${label}: ${result.error ?? `HTTP ${result.status}`}.`);
  return observation;
}

async function captureStats(label) {
  const result = await fetchJson('/stats', HEALTH_TIMEOUT_MS);
  const observation = { at: nowIso(), label, timeoutMs: HEALTH_TIMEOUT_MS, ...result };
  metrics.stats.push(observation);
  return observation;
}

async function warmService() {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    ensureRunning();
    const health = await captureHealth(`warmup:${attempt}`, { timeoutMs: COLD_START_TIMEOUT_MS });
    const stats = health.ok ? await captureStats(`warmup:${attempt}`) : undefined;
    attempts.push({ health, stats });
    if (health.ok && stats?.ok) return { health, stats, attempts };
    if (attempt < 2) await sleep(2_000);
  }
  const last = attempts.at(-1);
  throw new Error(`Service did not become ready after warmup: ${last?.health.error ?? `HTTP ${last?.health.status}`}.`);
}

function startMonitoring() {
  let stopped = false;
  let consecutiveSlow = 0;
  const loop = async () => {
    while (!stopped && !state.abortReason) {
      const health = await captureHealth(`monitor:${state.stage}`, { critical: true });
      await captureStats(`monitor:${state.stage}`);
      if (!health.ok) break;
      if (health.latencyMs > HEALTH_SLOW_MS) {
        consecutiveSlow += 1;
        if (consecutiveSlow >= 2) {
          requestStop(`${consecutiveSlow} consecutive health responses exceeded ${HEALTH_SLOW_MS} ms.`);
          break;
        }
      } else {
        consecutiveSlow = 0;
      }
      await sleep(5_000);
    }
  };
  void loop().catch((error) => recordError('monitor_failure', error));
  return () => { stopped = true; };
}

function gameSettings() {
  const custom = cell.wordProfile === 'high-candidate-custom';
  const gameMode = cell.gameMode ?? (custom ? 'category' : 'classic');
  return {
    minWordLength: 5,
    timePerRound: cell.timePerRoundSeconds,
    rounds: cell.rounds,
    maxPlayers: cell.playersPerRoom,
    gameMode,
    fastestWordTarget: 5,
    eliminationsPerRound: cell.eliminationsPerRound ?? 1,
    wordCategory: custom ? 'custom' : 'general',
    customWordList: custom ? 'uncharacteristically' : '',
    mixScoringMode: 'classic',
    mixModifiers: {
      teams: false,
      wordSprint: false,
      blind: false,
      claim: false,
      busted: false,
      intuition: false,
      lightning: false
    }
  };
}

async function createRooms(clients) {
  const rooms = Array.from({ length: cell.roomCount }, (_, index) => {
    const players = clients.slice(index * cell.playersPerRoom, (index + 1) * cell.playersPerRoom);
    return { index, players, host: players[0], roomId: undefined };
  });

  const hosts = await mapWithConcurrency(rooms, 5, async (room) => {
    const result = await emitAck(room.host, 'createRoom', {
      username: room.host.id,
      settings: gameSettings(),
      isPublic: false
    });
    room.roomId = result.roomId;
    room.host.roomId = result.roomId;
    return result;
  });
  if (hosts.some((result) => result.status !== 'fulfilled')) throw new Error('One or more room creations failed.');

  const joins = rooms.flatMap((room) => room.players.slice(1).map((client) => ({ room, client })));
  const joined = await mapWithConcurrency(joins, 10, async ({ room, client }) => {
    const result = await emitAck(client, 'joinRoom', { roomId: room.roomId, username: client.id });
    client.roomId = room.roomId;
    return result;
  });
  if (joined.some((result) => result.status !== 'fulfilled')) throw new Error('One or more room joins failed.');

  if (isBattleRoyaleCell()) {
    const snapshots = joined
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value.snapshot)
      .sort((left, right) => right.players.length - left.players.length);
    const snapshot = snapshots[0];
    if (!snapshot || snapshot.players.length !== cell.playersPerRoom || snapshot.status.currentPlayers !== cell.playersPerRoom || !snapshot.status.isFull) {
      throw battleRoyaleViolation('Battle Royale room did not reach and report its requested full capacity.', {
        expectedPlayers: cell.playersPerRoom,
        observedPlayers: snapshot?.players.length,
        observedStatus: snapshot?.status
      });
    }
    if (snapshot.settings.gameMode !== 'battleRoyale' || snapshot.settings.maxPlayers !== cell.playersPerRoom) {
      throw battleRoyaleViolation('Battle Royale settings were not preserved in the full-room snapshot.', {
        gameMode: snapshot.settings.gameMode,
        maxPlayers: snapshot.settings.maxPlayers
      });
    }
    metrics.battleRoyale.roomFullSnapshot = {
      at: nowIso(), currentPlayers: snapshot.status.currentPlayers,
      maxPlayers: snapshot.status.maxPlayers, isFull: snapshot.status.isFull
    };
    await probeBattleRoyaleRoomFull(rooms[0]);
  }

  return rooms;
}

async function probeBattleRoyaleRoomFull(room) {
  if (activeSockets >= MAX_SOCKETS) {
    metrics.battleRoyale.roomFullProbe = {
      skipped: 'Skipped because the 100-player cell already uses the 100-socket production safety ceiling.'
    };
    return;
  }

  const probe = await connectClient(state.clients.length);
  try {
    const error = await emitExpectedRejectedAck(probe, 'joinRoom', {
      roomId: room.roomId,
      username: `${probe.id}-FULL-PROBE`
    });
    if (error !== 'Room is full.') {
      throw battleRoyaleViolation('Full-room probe was rejected for an unexpected reason.', { error });
    }
    metrics.battleRoyale.roomFullProbe = { at: nowIso(), result: 'rejected-as-full', error };
  } finally {
    probe.intentionalDisconnect = true;
    probe.socket.disconnect();
  }
}

function actionSlots(timePerRoundSeconds, cadenceMs) {
  const firstActionMs = 2_000;
  const lastActionMs = timePerRoundSeconds * 1_000 - 4_000;
  const slots = [];
  for (let dueMs = firstActionMs; dueMs <= lastActionMs; dueMs += cadenceMs) slots.push(dueMs);
  return slots;
}

function evaluateActionSafety() {
  const completed = metrics.actions.filter((action) => action.outcome !== 'pending' && action.outcome !== 'aborted');
  if (completed.length < 100 || state.sloBreach) return;
  const accepted = completed.filter((action) => action.outcome === 'accepted');
  const failureRate = 1 - accepted.length / completed.length;
  const recentLatencies = accepted.slice(-100).map((action) => action.completionLatencyMs);
  const actionP95 = recentLatencies.length === 100 ? percentile(recentLatencies, 95) : null;

  // The practical SLO is evaluated from the complete cell report. A transient
  // 100-action window above one second is retained as a warning, not used to
  // truncate the sample and falsely label a borderline cell as a hard cap.
  if (actionP95 !== null && actionP95 > ACTION_SLO_P95_MS) {
    metrics.sloWarnings ??= [];
    metrics.sloWarnings.push({ at: nowIso(), rollingWindow: 100, p95ActionCompletionMs: actionP95 });
  }

  if (failureRate > 0.01) {
    state.sloBreach = `Valid-action failure rate ${(failureRate * 100).toFixed(2)}% exceeded the 1% SLO threshold.`;
    requestStop(state.sloBreach);
    return;
  }

  if (actionP95 !== null && actionP95 > 5_000) {
    state.sloBreach = 'Rolling action p95 exceeded the 5-second safety threshold.';
    requestStop(state.sloBreach);
  }
}

async function submitAction({ room, client, word, round }) {
  ensureRunning();
  const started = performance.now();
  const action = {
    at: nowIso(),
    stage: state.stage,
    roomId: room.roomId,
    round,
    clientId: client.id,
    word,
    outcome: 'pending',
    acknowledgementLatencyMs: null,
    completionLatencyMs: null
  };
  metrics.actions.push(action);

  let settled = false;
  const response = new Promise((resolvePromise) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off('wordAccepted', onAccepted);
      client.socket.off('wordRejected', onRejected);
      testAbortController.signal.removeEventListener('abort', onAbort);
    };
    const finish = (outcome, payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise({ outcome, payload, completionLatencyMs: elapsedMilliseconds(started) });
    };
    const onAccepted = (payload) => {
      if (payload?.playerId !== client.socket.id || payload?.word !== word) return;
      finish('accepted', payload);
    };
    const onRejected = (payload) => {
      if (payload?.word !== word) return;
      finish('rejected', payload);
    };
    const onAbort = () => finish('aborted');
    const timer = setTimeout(() => finish('timeout'), EVENT_TIMEOUT_MS);
    testAbortController.signal.addEventListener('abort', onAbort, { once: true });
    if (testAbortController.signal.aborted) {
      onAbort();
      return;
    }
    client.socket.on('wordAccepted', onAccepted);
    client.socket.on('wordRejected', onRejected);
  });

  const acknowledgementStartedAt = performance.now();
  const acknowledgement = emitAck(client, 'submitWord', { roomId: room.roomId, word }, { critical: false })
    .then((value) => ({ ok: true, value, latencyMs: elapsedMilliseconds(acknowledgementStartedAt) }))
    .catch((error) => ({ ok: false, error, latencyMs: elapsedMilliseconds(acknowledgementStartedAt) }));
  const [responseResult, acknowledgementResult] = await Promise.all([response, acknowledgement]);
  action.outcome = responseResult.outcome;
  action.completionLatencyMs = responseResult.completionLatencyMs;
  action.acknowledgementLatencyMs = acknowledgementResult.latencyMs;
  if (responseResult.outcome !== 'accepted' && responseResult.outcome !== 'aborted') {
    recordError('valid_action_not_accepted', new Error(responseResult.payload?.message ?? responseResult.outcome), {
      critical: false,
      clientId: client.id,
      detail: { roomId: room.roomId, round, word, acknowledgementOk: acknowledgementResult.ok }
    });
  }
  evaluateActionSafety();
  return action;
}

function isBattleRoyaleCell() {
  return cell.gameMode === 'battleRoyale';
}

function battleRoyaleViolation(message, detail) {
  const entry = { at: nowIso(), message, detail };
  metrics.battleRoyale.violations.push(entry);
  return new Error(message);
}

function activePlayersForRound(room, payload) {
  if (!isBattleRoyaleCell()) return room.players;

  const snapshot = payload?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.players)) {
    throw battleRoyaleViolation('Battle Royale roundStarted payload did not include a player snapshot.', {
      currentRound: payload?.currentRound
    });
  }

  const eliminatedPlayers = snapshot.players.filter((player) => player.isEliminated);
  const activeIds = new Set(snapshot.players.filter((player) => !player.isEliminated).map((player) => player.id));
  const expectedEliminated = Math.min(
    (payload.currentRound - 1) * cell.eliminationsPerRound,
    cell.playersPerRoom - 1
  );
  const check = {
    at: nowIso(), phase: 'roundStarted', currentRound: payload.currentRound,
    totalPlayers: snapshot.players.length, activePlayers: activeIds.size,
    eliminatedPlayers: eliminatedPlayers.length, expectedEliminated
  };
  metrics.battleRoyale.roundChecks.push(check);

  if (
    snapshot.phase !== 'round'
    || snapshot.settings.gameMode !== 'battleRoyale'
    || snapshot.settings.maxPlayers !== cell.playersPerRoom
    || snapshot.players.length !== cell.playersPerRoom
    || eliminatedPlayers.length !== expectedEliminated
  ) {
    throw battleRoyaleViolation('Battle Royale state was incorrect at round start.', {
      ...check,
      phase: snapshot.phase,
      gameMode: snapshot.settings.gameMode,
      maxPlayers: snapshot.settings.maxPlayers
    });
  }

  const activeClients = room.players.filter((client) => activeIds.has(client.socket.id));
  if (activeClients.length !== activeIds.size) {
    throw battleRoyaleViolation('Battle Royale snapshot contained an active player without a connected test client.', {
      ...check,
      matchedClients: activeClients.length
    });
  }
  return activeClients;
}

function verifyBattleRoyaleElimination(payload, phase) {
  if (!isBattleRoyaleCell()) return;
  const snapshot = payload?.snapshot;
  if (!snapshot || !Array.isArray(snapshot.players)) {
    throw battleRoyaleViolation(`Battle Royale ${phase} payload did not include a player snapshot.`, {
      currentRound: payload?.currentRound
    });
  }

  const currentRound = payload.currentRound;
  const eliminatedPlayers = snapshot.players.filter((player) => player.isEliminated);
  const expectedEliminated = Math.min(currentRound * cell.eliminationsPerRound, cell.playersPerRoom - 1);
  const check = {
    at: nowIso(), phase, currentRound, totalPlayers: snapshot.players.length,
    activePlayers: snapshot.players.length - eliminatedPlayers.length,
    eliminatedPlayers: eliminatedPlayers.length, expectedEliminated
  };
  metrics.battleRoyale.roundChecks.push(check);
  const expectedPhase = phase === 'roundEnded' ? 'betweenRounds' : 'gameOver';
  if (
    currentRound < 1
    || currentRound > cell.rounds
    || snapshot.phase !== expectedPhase
    || snapshot.players.length !== cell.playersPerRoom
    || eliminatedPlayers.length !== expectedEliminated
  ) {
    throw battleRoyaleViolation(`Battle Royale elimination state was incorrect at ${phase}.`, {
      ...check,
      observedPhase: snapshot.phase,
      expectedPhase
    });
  }
}

async function scheduleRound(room, payload) {
  const activePlayers = activePlayersForRound(room, payload);
  const slots = actionSlots(payload.timeLeft, cell.actionCadenceMs);
  const candidates = validCandidates(payload.currentWord, slots.length);
  if (candidates.length < slots.length) {
    const error = new Error(`Only ${candidates.length}/${slots.length} valid candidates for source word ${payload.currentWord}.`);
    recordError('insufficient_valid_candidates', error, { clientId: room.host.id, detail: { roomId: room.roomId, round: payload.currentRound } });
    requestStop(error.message);
    throw error;
  }

  const roundStartedAt = performance.now();
  const plannedActions = slots.length * activePlayers.length;
  metrics.rounds.push({
    at: nowIso(), roomId: room.roomId, currentRound: payload.currentRound,
    sourceWord: payload.currentWord, activePlayers: activePlayers.length, plannedActions
  });
  if (isBattleRoyaleCell()) metrics.battleRoyale.plannedActions += plannedActions;

  const jobs = [];
  for (let playerIndex = 0; playerIndex < activePlayers.length; playerIndex += 1) {
    const client = activePlayers[playerIndex];
    const staggerWindowMs = isBattleRoyaleCell()
      ? cell.actionCadenceMs * 0.8
      : Math.min(cell.actionCadenceMs * 0.8, 1_000);
    const staggerMs = Math.floor((playerIndex / activePlayers.length) * staggerWindowMs);
    for (let actionIndex = 0; actionIndex < slots.length; actionIndex += 1) {
      const dueMs = slots[actionIndex] + staggerMs;
      const word = candidates[actionIndex];
      jobs.push((async () => {
        const waitMs = Math.max(0, dueMs - (performance.now() - roundStartedAt));
        await sleep(waitMs);
        if (state.abortReason) return;
        if (isBattleRoyaleCell() && state.activeBattleRounds.get(room.roomId) !== payload.currentRound) return;
        await submitAction({ room, client, word, round: payload.currentRound });
      })());
    }
  }
  const results = await Promise.allSettled(jobs);
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}

async function playGame(room, cycle) {
  ensureRunning();
  const gameStartedAt = performance.now();
  const scheduledRounds = [];
  const roundEndedChecks = [];
  let observedRounds = 0;
  // Node's one-second room timers and 10-second inter-round timers can drift
  // materially under load. Allow a full extra minute before calling a complete
  // lifecycle a failure; the outer 15-minute fuse remains authoritative.
  const gameOver = waitForEvent(room.host, 'gameOver', () => true, {
    timeoutMs: expectedSingleGameMs + 60_000
  });
  // The start/restart acknowledgement can still be pending if a safety abort
  // arrives. Attach a rejection observer immediately so Node never treats the
  // event wait as unhandled before playGame reaches `await gameOver`.
  void gameOver.catch(() => {});
  const onRoundStarted = (payload) => {
    observedRounds += 1;
    if (isBattleRoyaleCell()) state.activeBattleRounds.set(room.roomId, payload.currentRound);
    const scheduled = scheduleRound(room, payload);
    void scheduled.catch((error) => {
      if (!state.abortReason) recordError('round_scheduler_failed', error, { clientId: room.host.id });
    });
    scheduledRounds.push(scheduled);
  };
  const onRoundEnded = (payload) => {
    state.activeBattleRounds.delete(room.roomId);
    const check = Promise.resolve().then(() => verifyBattleRoyaleElimination(payload, 'roundEnded'));
    void check.catch((error) => recordError('battle_royale_lifecycle_failed', error, { clientId: room.host.id }));
    roundEndedChecks.push(check);
  };
  room.host.socket.on('roundStarted', onRoundStarted);
  if (isBattleRoyaleCell()) room.host.socket.on('roundEnded', onRoundEnded);

  try {
    if (cycle === 1) {
      await emitAck(room.host, 'startGame', { roomId: room.roomId });
    } else {
      await emitAck(room.host, 'restartGame', { roomId: room.roomId, autoStart: true });
    }
    const gameOverPayload = await gameOver;
    state.activeBattleRounds.delete(room.roomId);
    verifyBattleRoyaleElimination(gameOverPayload, 'gameOver');
    if (isBattleRoyaleCell()) {
      const finalScoreIds = new Set((gameOverPayload.finalScores ?? []).map((score) => score.playerId));
      const expectedPlayerIds = new Set(room.players.map((client) => client.socket.id));
      if (finalScoreIds.size !== cell.playersPerRoom || [...expectedPlayerIds].some((playerId) => !finalScoreIds.has(playerId))) {
        throw battleRoyaleViolation('Battle Royale gameOver did not retain every original player in final scores.', {
          expectedPlayers: cell.playersPerRoom,
          finalScoreCount: gameOverPayload.finalScores?.length,
          uniqueFinalScoreIds: finalScoreIds.size
        });
      }
      metrics.battleRoyale.gameOver = {
        at: nowIso(), currentRound: gameOverPayload.currentRound,
        finalScores: gameOverPayload.finalScores?.length,
        eliminatedPlayers: gameOverPayload.snapshot?.players?.filter((player) => player.isEliminated).length
      };
    }
    const schedulingResults = await Promise.allSettled([...scheduledRounds, ...roundEndedChecks]);
    const rejected = schedulingResults.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    if (observedRounds !== cell.rounds) {
      throw new Error(`Room ${room.roomId} observed ${observedRounds}/${cell.rounds} rounds.`);
    }
    if (isBattleRoyaleCell() && roundEndedChecks.length !== cell.rounds - 1) {
      throw battleRoyaleViolation(`Battle Royale observed ${roundEndedChecks.length}/${cell.rounds - 1} non-final roundEnded events.`, {
        observedRounds, roundEndedEvents: roundEndedChecks.length
      });
    }
    if (isBattleRoyaleCell()) {
      const expectedScoreEvents = metrics.actions.filter((action) => action.roomId === room.roomId && action.outcome === 'accepted').length;
      const scoreEventCounts = room.players.map((client) => ({ clientId: client.id, count: client.scoresUpdatedCount }));
      const mismatchedClients = scoreEventCounts.filter((client) => client.count !== expectedScoreEvents);
      metrics.battleRoyale.scoreFanout = { expectedScoreEvents, scoreEventCounts, mismatchedClients };
      if (mismatchedClients.length > 0) {
        throw battleRoyaleViolation('Battle Royale score updates were not delivered to every player.', {
          expectedScoreEvents,
          mismatchedClients
        });
      }
    }
    return { roomId: room.roomId, cycle, durationMs: elapsedMilliseconds(gameStartedAt), observedRounds };
  } finally {
    room.host.socket.off('roundStarted', onRoundStarted);
    room.host.socket.off('roundEnded', onRoundEnded);
  }
}

async function leaveRooms(rooms) {
  const players = rooms.flatMap((room) => room.players);
  await mapWithConcurrency(players, isBattleRoyaleCell() ? 5 : 20, async (client) => {
    const roomId = client.roomId;
    if (!roomId) return;
    try {
      await emitAck(client, 'leaveRoom', { roomId }, { timeoutMs: 2_000, critical: false, recordFailure: false });
    } catch (error) {
      // Teardown uses a bounded, intentionally low-priority leave burst. A
      // disconnect immediately follows, so record a warning without calling a
      // completed game unhealthy solely for its cleanup acknowledgement.
      metrics.cleanupAcknowledgementFailures.push({ at: nowIso(), clientId: client.id, eventName: 'leaveRoom', message: asErrorMessage(error) });
    } finally {
      client.roomId = undefined;
    }
  });
}

async function cleanupAll() {
  state.intentionalShutdown = true;
  for (const client of state.clients) {
    client.roomId = undefined;
    client.intentionalDisconnect = true;
    if (client.socket.connected) client.socket.disconnect();
  }
  await sleep(500);
  metrics.cleanup = {
    at: nowIso(),
    socketsRequested: state.clients.length,
    socketsStillConnected: state.clients.filter((client) => client.socket.connected).length,
    unexpectedDisconnects: state.clients.reduce((total, client) => total + client.unexpectedDisconnects, 0),
    transportHistory: state.clients.map((client) => ({ clientId: client.id, transports: client.transportHistory }))
  };
}

function summarize() {
  const accepted = metrics.actions.filter((action) => action.outcome === 'accepted');
  const attempted = metrics.actions.length;
  const successRate = attempted === 0 ? 0 : accepted.length / attempted;
  const actionLatency = distribution(accepted.map((action) => action.completionLatencyMs));
  const acknowledgementLatency = distribution(metrics.acknowledgements.filter((ack) => ack.ok).map((ack) => ack.latencyMs));
  const healthLatency = distribution(metrics.health.filter((health) => health.ok).map((health) => health.latencyMs));
  const requiredSuccessRate = cell.strictActionSuccess ? 1 : ACTION_SLO_SUCCESS_RATE;
  const battleRoyale = metrics.battleRoyale;
  const plannedActions = battleRoyale?.plannedActions ?? metrics.rounds.reduce((total, round) => total + round.plannedActions, 0);
  const allPlannedActionsAccepted = attempted === plannedActions && accepted.length === plannedActions;
  const postTestHealthy = !metrics.postTest?.health || metrics.postTest.health.ok;
  const lifecycleComplete = !battleRoyale || (
    battleRoyale.violations.length === 0
    && battleRoyale.roundChecks.filter((check) => check.phase === 'roundStarted').length === cell.rounds
    && battleRoyale.roundChecks.filter((check) => check.phase === 'roundEnded').length === cell.rounds - 1
    && battleRoyale.roundChecks.filter((check) => check.phase === 'gameOver').length === 1
    && battleRoyale.roomFullSnapshot?.isFull === true
    && (battleRoyale.roomFullProbe?.result === 'rejected-as-full' || Boolean(battleRoyale.roomFullProbe?.skipped))
    && battleRoyale.scoreFanout?.mismatchedClients?.length === 0
    && battleRoyale.gameOver?.currentRound === cell.rounds
    && battleRoyale.gameOver?.finalScores === cell.playersPerRoom
    && battleRoyale.gameOver?.eliminatedPlayers === Math.min(cell.rounds * cell.eliminationsPerRound, cell.playersPerRoom - 1)
  );
  const tournamentReady = !battleRoyale || (
    lifecycleComplete
    && allPlannedActionsAccepted
    && metrics.errors.length === 0
    && metrics.cleanup?.unexpectedDisconnects === 0
    && postTestHealthy
  );
  const passing = metrics.status === 'completed'
    && successRate >= requiredSuccessRate
    && actionLatency.p95 !== null
    && actionLatency.p95 <= ACTION_SLO_P95_MS
    && tournamentReady;
  metrics.summary = {
    attemptedActions: attempted,
    plannedActions,
    acceptedActions: accepted.length,
    actionSuccessRate: Number(successRate.toFixed(4)),
    actionCompletionLatencyMs: actionLatency,
    acknowledgementLatencyMs: acknowledgementLatency,
    healthLatencyMs: healthLatency,
    observedRounds: metrics.rounds.length,
    ...(battleRoyale ? {
      battleRoyale: {
        lifecycleComplete,
        allPlannedActionsAccepted,
        postTestHealthy,
        unexpectedDisconnects: metrics.cleanup?.unexpectedDisconnects ?? null,
        violations: battleRoyale.violations.length,
        cleanupAcknowledgementFailures: metrics.cleanupAcknowledgementFailures.length,
        result: tournamentReady ? 'pass' : 'fail'
      }
    } : {}),
    practicalSlo: {
      p95ActionCompletionMs: ACTION_SLO_P95_MS,
      minimumActionSuccessRate: requiredSuccessRate,
      result: metrics.status === 'slo-breached' ? 'fail' : metrics.status !== 'completed' ? 'inconclusive' : passing ? 'pass' : 'fail'
    }
  };
}

async function writeReport() {
  metrics.finishedAt = nowIso();
  summarize();
  const suffix = metrics.finishedAt.replace(/[:.]/g, '-');
  await mkdir(outputDirectory, { recursive: true });
  const path = resolve(outputDirectory, `capacity-cell-${cell.factor}-${cell.level}-${suffix}.json`);
  await writeFile(path, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  return path;
}

process.on('SIGINT', () => requestStop('Interrupted by operator (SIGINT).'));
process.on('SIGTERM', () => requestStop('Interrupted by operator (SIGTERM).'));

let stopMonitoring = () => {};
let rooms = [];
try {
  console.log(`Capacity cell: ${cell.factor}=${cell.level}; ${cell.roomCount} room(s) × ${cell.playersPerRoom} players (${activeSockets} sockets).`);
  console.log(`SLO: p95 valid-action completion ≤${ACTION_SLO_P95_MS} ms and ≥${ACTION_SLO_SUCCESS_RATE * 100}% acceptance.`);

  state.stage = 'warmup';
  metrics.baseline = await warmService();
  stopMonitoring = startMonitoring();

  state.stage = 'connect';
  const connections = await mapWithConcurrency(
    Array.from({ length: activeSockets }, (_, index) => index),
    10,
    (index) => connectClient(index)
  );
  state.clients = connections.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (state.clients.length !== activeSockets) throw new Error(`Only ${state.clients.length}/${activeSockets} sockets connected.`);
  await captureStats('after-connect');

  state.stage = 'create-and-join';
  rooms = await createRooms(state.clients);
  await captureStats('after-create-and-join');

  for (let cycle = 1; cycle <= cell.gameCycles; cycle += 1) {
    state.stage = `game-${cycle}`;
    console.log(`Starting game cycle ${cycle}/${cell.gameCycles}.`);
    // Stagger starts to model ordinary room creation rather than manufacture a
    // synchronized dictionary-building burst that is not part of this factor.
    const games = [];
    for (const room of rooms) {
      ensureRunning();
      const game = playGame(room, cycle);
      // The aggregate allSettled handler is installed after this short launch
      // ramp, so observe rejections immediately as well.
      void game.catch(() => {});
      games.push(game);
      if (cell.startSpacingMs > 0) await sleep(cell.startSpacingMs);
    }
    const results = await Promise.allSettled(games);
    if (results.some((result) => result.status !== 'fulfilled')) {
      throw new Error(`One or more rooms failed during game cycle ${cycle}.`);
    }
    await captureHealth(`after-game-${cycle}`, { critical: true });
    await captureStats(`after-game-${cycle}`);
    ensureRunning();
  }

  state.stage = 'leave';
  await leaveRooms(rooms);
  metrics.status = 'completed';
} catch (error) {
  if (state.sloBreach) {
    metrics.status = 'slo-breached';
  } else if (state.abortReason) {
    metrics.status = 'aborted-safely';
  } else {
    metrics.status = 'failed';
    recordError('cell_failed', error, { critical: false });
  }
  console.error(`Cell ${metrics.status}: ${state.abortReason ?? asErrorMessage(error)}`);
} finally {
  stopMonitoring();
  await cleanupAll();
  state.stage = 'post-test';
  if (hardDeadline - Date.now() > 12_000) {
    metrics.postTest = {
      health: await captureHealth('after-test'),
      stats: await captureStats('after-test')
    };
  } else {
    metrics.postTest = { skipped: 'Skipped to preserve the 15-minute hard ceiling.' };
  }
  const reportPath = await writeReport();
  clearTimeout(hardStopTimer);
  console.log(`Report: ${reportPath}`);
  console.log(`Final status: ${metrics.status}; SLO: ${metrics.summary.practicalSlo.result}.`);
}

if (metrics.status !== 'completed' && metrics.status !== 'slo-breached') process.exitCode = 2;
