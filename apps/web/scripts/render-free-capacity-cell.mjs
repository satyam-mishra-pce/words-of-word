#!/usr/bin/env node
/**
 * Local-only Socket.IO tournament capacity cell.
 *
 * It refuses non-loopback targets so it cannot accidentally load production.
 * Run it through scripts/run-render-free-cell.mjs to get the documented Render
 * Free cgroup limits (0.1 CPU / 512 MiB) and Docker resource samples.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { io } from 'socket.io-client';

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const rawDictionary = serverRequire('an-array-of-english-words');
const dictionary = rawDictionary.filter((word) => typeof word === 'string' && /^[a-z]+$/.test(word));

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PLAYABLE_MODES = new Set([
  'classic', 'arcade', 'precision', 'battleRoyale', 'typist', 'category',
  'oneWordForAll', 'busted', 'commonWord', 'intuition', 'bingo', 'mix'
]);
const DEFAULT_SOURCE_WORD = 'pneumonoultramicroscopicsilicovolcanoconiosis';

function fail(message) {
  throw new Error(message);
}

function envInteger(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer from ${min} to ${max}; received ${raw}.`);
  }
  return value;
}

function envNumber(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be a number from ${min} to ${max}; received ${raw}.`);
  }
  return value;
}

function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  fail(`${name} must be 1/0 or true/false; received ${raw}.`);
}

function localOrigin(rawTarget) {
  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    fail(`TARGET_URL must be a valid URL; received ${rawTarget}.`);
  }

  if (target.protocol !== 'http:') {
    fail(`TARGET_URL must use http for this local-only runner; received ${target.protocol}.`);
  }
  if (!LOOPBACK_HOSTS.has(target.hostname)) {
    fail(`Refusing non-loopback TARGET_URL (${target.origin}). This runner is local-only.`);
  }
  return target.origin;
}

function timestamp() {
  return new Date().toISOString();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function elapsed(startedAt) {
  return Number((performance.now() - startedAt).toFixed(2));
}

function percentile(values, percentage) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

function distribution(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  }
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

function stringifyError(error) {
  return error instanceof Error ? error.message : String(error);
}

function jsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return null;
  }
}

function parseDockerBytes(value) {
  const match = String(value).trim().match(/^([\d.]+)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    b: 1,
    kb: 1_000,
    kib: 1_024,
    mb: 1_000_000,
    mib: 1_048_576,
    gb: 1_000_000_000,
    gib: 1_073_741_824
  }[unit];
  return multiplier ? Math.round(amount * multiplier) : null;
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

const targetOrigin = localOrigin(process.env.TARGET_URL ?? 'http://127.0.0.1:4100');
const gameMode = process.env.GAME_MODE ?? 'battleRoyale';
if (!PLAYABLE_MODES.has(gameMode)) {
  fail(`GAME_MODE=${gameMode} is not supported by this valid-word cell. Supported modes: ${[...PLAYABLE_MODES].join(', ')}.`);
}

const config = Object.freeze({
  targetOrigin,
  cellName: process.env.CELL_NAME ?? `${gameMode}-local-cell`,
  gameMode,
  rooms: envInteger('ROOMS', 1, { min: 1, max: 100 }),
  playersPerRoom: envInteger('PLAYERS_PER_ROOM', 4, { min: 2, max: 60 }),
  rounds: envInteger('ROUNDS', 1, { min: 1, max: 20 }),
  roundSeconds: envInteger('ROUND_SECONDS', 10, { min: 5, max: 300 }),
  eliminationsPerRound: envInteger('ELIMINATIONS_PER_ROUND', 1, { min: 1, max: 10 }),
  actionsPerPlayer: envInteger('ACTIONS_PER_PLAYER', 4, { min: 1, max: 100 }),
  actionIntervalMs: envInteger('ACTION_INTERVAL_MS', 750, { min: 25, max: 60_000 }),
  actionStaggerMs: envInteger('ACTION_STAGGER_MS', 0, { min: 0, max: 60_000 }),
  actionWarmupMs: envInteger('ACTION_WARMUP_MS', 750, { min: 0, max: 60_000 }),
  startSpacingMs: envInteger('START_SPACING_MS', 0, { min: 0, max: 60_000 }),
  synchronizeRoomActions: envBoolean('SYNCHRONIZE_ROOM_ACTIONS', false),
  maxLocalPlayers: envInteger('MAX_LOCAL_PLAYERS', 500, { min: 1, max: 10_000 }),
  connectConcurrency: envInteger('CONNECT_CONCURRENCY', 20, { min: 1, max: 500 }),
  setupConcurrency: envInteger('SETUP_CONCURRENCY', 20, { min: 1, max: 500 }),
  connectTimeoutMs: envInteger('CONNECT_TIMEOUT_MS', 10_000, { min: 250, max: 120_000 }),
  ackTimeoutMs: envInteger('ACK_TIMEOUT_MS', 30_000, { min: 250, max: 120_000 }),
  eventTimeoutMs: envInteger('EVENT_TIMEOUT_MS', 30_000, { min: 250, max: 120_000 }),
  healthTimeoutMs: envInteger('HEALTH_TIMEOUT_MS', 3_000, { min: 250, max: 120_000 }),
  healthPollMs: envInteger('HEALTH_POLL_MS', 1_000, { min: 100, max: 60_000 }),
  deliverySettleMs: envInteger('DELIVERY_SETTLE_MS', 1_500, { min: 0, max: 60_000 }),
  waitForGameOver: envBoolean('WAIT_FOR_GAME_OVER', false),
  allowCrossPlayerWordReuse: envBoolean('ALLOW_CROSS_PLAYER_WORD_REUSE', false),
  fixedSource: envBoolean('FIXED_SOURCE', true),
  sourceWord: (process.env.SOURCE_WORD ?? DEFAULT_SOURCE_WORD).trim().toLowerCase(),
  containerName: process.env.CONTAINER_NAME?.trim() || undefined,
  slo: {
    actionP95Ms: envInteger('SLO_ACTION_P95_MS', 1_000, { min: 1, max: 120_000 }),
    roundStartP95Ms: envInteger('SLO_ROUND_START_P95_MS', 3_000, { min: 1, max: 120_000 }),
    healthP95Ms: envInteger('SLO_HEALTH_P95_MS', 3_000, { min: 1, max: 120_000 }),
    minimumAcceptanceRate: envNumber('SLO_MIN_ACCEPTANCE_RATE', 1, { min: 0, max: 1 }),
    minimumScoreDeliveryRate: envNumber('SLO_MIN_SCORE_DELIVERY_RATE', 0.99, { min: 0, max: 1 })
  }
});

if (!/^[a-z]+$/.test(config.sourceWord)) {
  fail('SOURCE_WORD must contain only lowercase English letters.');
}
if (config.sourceWord.length < 5) {
  fail('SOURCE_WORD must have at least five letters.');
}
if (config.gameMode === 'battleRoyale' && config.eliminationsPerRound * config.rounds >= config.playersPerRoom) {
  fail('Knockout requires ELIMINATIONS_PER_ROUND × ROUNDS to be less than PLAYERS_PER_ROOM.');
}

const finalActionDueMs = config.actionWarmupMs
  + (config.actionsPerPlayer - 1) * config.actionIntervalMs
  + (config.playersPerRoom - 1) * config.actionStaggerMs;
if (finalActionDueMs + 3_000 >= config.roundSeconds * 1_000) {
  fail('The configured action schedule leaves less than 3 seconds before the round ends. Increase ROUND_SECONDS or reduce action cadence/count/stagger.');
}
if (config.rounds > 1 && !config.waitForGameOver) {
  fail('WAIT_FOR_GAME_OVER=1 is required when ROUNDS is greater than 1.');
}
if (config.synchronizeRoomActions && config.rounds !== 1) {
  fail('SYNCHRONIZE_ROOM_ACTIONS currently supports one-round cells only.');
}

const totalPlayers = config.rooms * config.playersPerRoom;
if (totalPlayers > config.maxLocalPlayers) {
  fail(`This cell requests ${totalPlayers} virtual players, above MAX_LOCAL_PLAYERS=${config.maxLocalPlayers}. Increase that explicit local safety limit only after confirming the load generator can handle it.`);
}
const activePlayersAcrossRounds = config.gameMode === 'battleRoyale'
  ? Array.from({ length: config.rounds }, (_, roundIndex) => config.playersPerRoom - roundIndex * config.eliminationsPerRound)
  : Array.from({ length: config.rounds }, () => config.playersPerRoom);
const plannedActions = config.rooms * config.actionsPerPlayer * activePlayersAcrossRounds.reduce((total, players) => total + players, 0);
const reportPath = process.env.REPORT_PATH
  ? resolve(repoRoot, process.env.REPORT_PATH)
  : resolve(repoRoot, 'logs', `render-free-cell-${config.cellName.replace(/[^a-z0-9_-]+/gi, '-')}-${timestamp().replace(/[:.]/g, '-')}.json`);

const metrics = {
  schemaVersion: 1,
  kind: 'local-render-free-tournament-capacity-cell',
  startedAt: timestamp(),
  targetOrigin,
  config: {
    ...config,
    totalPlayers,
    plannedActions,
    activePlayersAcrossRounds,
    finalActionDueMs
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    dictionaryWords: dictionary.length
  },
  connections: [],
  acknowledgements: [],
  rounds: [],
  actions: [],
  health: [],
  resources: [],
  errors: [],
  cleanup: {},
  status: 'running',
  verdict: null,
  summary: null,
  finishedAt: null
};

const state = {
  intentionalShutdown: false,
  monitoring: false,
  monitorTask: undefined,
  clients: [],
  rooms: [],
  firstFailure: undefined
};

function recordError(kind, error, detail = {}) {
  const entry = {
    at: timestamp(),
    kind,
    message: stringifyError(error),
    ...detail
  };
  metrics.errors.push(entry);
  state.firstFailure ??= entry.message;
  return entry;
}

function scoreSettings() {
  return {
    minWordLength: 5,
    timePerRound: config.roundSeconds,
    rounds: config.rounds,
    maxPlayers: config.playersPerRoom,
    gameMode: config.gameMode,
    fastestWordTarget: 10,
    eliminationsPerRound: config.eliminationsPerRound,
    wordCategory: 'custom',
    customWordList: config.sourceWord,
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

function candidateWords(sourceWord, needed) {
  const sourceCounts = new Map();
  for (const letter of sourceWord) sourceCounts.set(letter, (sourceCounts.get(letter) ?? 0) + 1);
  const candidates = dictionary.includes(sourceWord) ? [sourceWord] : [];
  const seen = new Set(candidates);

  for (const candidate of dictionary) {
    if (seen.has(candidate)) continue;
    const candidateCounts = new Map();
    for (const letter of candidate) candidateCounts.set(letter, (candidateCounts.get(letter) ?? 0) + 1);
    let possible = true;
    for (const [letter, count] of candidateCounts) {
      if ((sourceCounts.get(letter) ?? 0) < count) {
        possible = false;
        break;
      }
    }
    if (!possible) continue;
    seen.add(candidate);
    candidates.push(candidate);
    if (candidates.length >= needed) return candidates;
  }
  return candidates;
}

function createClient(index) {
  const socket = io(targetOrigin, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    auth: { scoreUpdateProtocol: 2 },
    timeout: config.connectTimeoutMs
  });
  const client = {
    id: `RF-${String(index + 1).padStart(4, '0')}`,
    socket,
    roomId: undefined,
    intentionalDisconnect: false,
    scoresUpdated: 0,
    scorePayloadBytes: [],
    unexpectedDisconnects: 0
  };

  socket.on('scoresUpdated', (payload) => {
    client.scoresUpdated += 1;
    const bytes = jsonSize(payload);
    if (bytes !== null) client.scorePayloadBytes.push(bytes);
  });

  socket.on('disconnect', (reason) => {
    if (state.intentionalShutdown || client.intentionalDisconnect) return;
    client.unexpectedDisconnects += 1;
    recordError('unexpected_socket_disconnect', new Error(String(reason)), { clientId: client.id });
  });

  return client;
}

async function connectClient(client) {
  const startedAt = performance.now();
  await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.socket.off('connect', onConnect);
      client.socket.off('connect_error', onError);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onConnect = () => finish();
    const onError = (error) => finish(error instanceof Error ? error : new Error(String(error)));
    const timer = setTimeout(() => finish(new Error(`Socket did not connect within ${config.connectTimeoutMs} ms.`)), config.connectTimeoutMs);
    client.socket.once('connect', onConnect);
    client.socket.once('connect_error', onError);
    client.socket.connect();
  });

  metrics.connections.push({
    at: timestamp(),
    clientId: client.id,
    latencyMs: elapsed(startedAt),
    transport: client.socket.io.engine?.transport?.name ?? 'unknown'
  });
}

function emitAck(client, eventName, payload, { timeoutMs = config.ackTimeoutMs, phase = 'gameplay' } = {}) {
  const startedAt = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (response, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const latencyMs = elapsed(startedAt);
      const ok = !error && Boolean(response?.ok);
      const entry = {
        at: timestamp(),
        phase,
        clientId: client.id,
        eventName,
        ok,
        latencyMs,
        ...(ok ? {} : { error: error?.message ?? response?.error ?? 'Acknowledgement failed.' })
      };
      metrics.acknowledgements.push(entry);
      if (ok) {
        resolvePromise(response.data);
      } else {
        rejectPromise(new Error(entry.error));
      }
    };
    const timer = setTimeout(() => finish(undefined, new Error(`${eventName} acknowledgement timed out after ${timeoutMs} ms.`)), timeoutMs);
    client.socket.emit(eventName, payload, (response) => finish(response));
  });
}

function waitForWordResolution(client, word) {
  const startedAt = performance.now();
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (outcome, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.socket.off('wordAccepted', onAccepted);
      client.socket.off('wordRejected', onRejected);
      resolvePromise({ outcome, payload, latencyMs: elapsed(startedAt) });
    };
    const onAccepted = (payload) => {
      if (payload?.playerId === client.socket.id && payload?.word === word) finish('accepted', payload);
    };
    const onRejected = (payload) => {
      if (payload?.word === word) finish('rejected', payload);
    };
    const timer = setTimeout(() => finish('timeout'), config.eventTimeoutMs);
    client.socket.on('wordAccepted', onAccepted);
    client.socket.on('wordRejected', onRejected);
  });
}

function waitForEvent(client, eventName, predicate, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = performance.now();
    let settled = false;
    const finish = (payload, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.socket.off(eventName, handler);
      if (error) rejectPromise(error);
      else resolvePromise({ payload, latencyMs: elapsed(startedAt) });
    };
    const handler = (payload) => {
      if (predicate && !predicate(payload)) return;
      finish(payload);
    };
    const timer = setTimeout(() => finish(undefined, new Error(`${eventName} was not received within ${timeoutMs} ms.`)), timeoutMs);
    client.socket.on(eventName, handler);
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      }
    );
  });
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await operation(items[index], index) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: stringifyError(error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function captureHealth(label) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.healthTimeoutMs);
  try {
    const response = await fetch(`${targetOrigin}/health`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      signal: controller.signal
    });
    const observation = {
      at: timestamp(),
      label,
      ok: response.ok,
      status: response.status,
      latencyMs: elapsed(startedAt)
    };
    metrics.health.push(observation);
    return observation;
  } catch (error) {
    const observation = {
      at: timestamp(),
      label,
      ok: false,
      status: null,
      latencyMs: elapsed(startedAt),
      error: stringifyError(error)
    };
    metrics.health.push(observation);
    return observation;
  } finally {
    clearTimeout(timer);
  }
}

async function captureDockerStats() {
  if (!config.containerName) return;
  try {
    const { stdout } = await execFileAsync('docker', [
      'stats', '--no-stream', '--format', '{{json .}}', config.containerName
    ], { timeout: config.healthTimeoutMs });
    const raw = JSON.parse(stdout.trim());
    const [usedMemory] = String(raw.MemUsage ?? '').split(' / ');
    metrics.resources.push({
      at: timestamp(),
      cpuPercent: Number.parseFloat(String(raw.CPUPerc ?? '').replace('%', '')) || 0,
      memoryBytes: parseDockerBytes(usedMemory),
      memoryLimitBytes: parseDockerBytes(String(raw.MemUsage ?? '').split(' / ')[1]),
      pids: Number.parseInt(raw.PIDs, 10) || null,
      netIo: raw.NetIO ?? null,
      blockIo: raw.BlockIO ?? null,
      raw
    });
  } catch (error) {
    recordError('docker_stats_failed', error, { nonFatal: true });
  }
}

function startMonitoring() {
  state.monitoring = true;
  state.monitorTask = (async () => {
    while (state.monitoring) {
      await Promise.all([captureHealth('monitor'), captureDockerStats()]);
      if (state.monitoring) await sleep(config.healthPollMs);
    }
  })();
}

async function stopMonitoring() {
  state.monitoring = false;
  await state.monitorTask;
  state.monitorTask = undefined;
}

async function submitAction(room, client, word, roundNumber, dueAt) {
  await sleep(Math.max(0, dueAt - performance.now()));
  const dispatchAt = performance.now();
  const resolution = waitForWordResolution(client, word);
  const acknowledgement = emitAck(client, 'submitWord', { roomId: room.roomId, word }, { phase: 'action' })
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, error: stringifyError(error) }));
  const [event, ack] = await Promise.all([resolution, acknowledgement]);
  const action = {
    at: timestamp(),
    roomId: room.roomId,
    round: roundNumber,
    clientId: client.id,
    playersInRoom: room.clients.length,
    word,
    dispatchDelayMs: Number(Math.max(0, dispatchAt - dueAt).toFixed(2)),
    eventOutcome: event.outcome,
    completionLatencyMs: event.latencyMs,
    acknowledgementOk: ack.ok,
    acknowledgementError: ack.error ?? null,
    ...(event.payload?.message ? { message: event.payload.message } : {})
  };
  metrics.actions.push(action);
  return action;
}

async function scheduleRoundActions(room, payload, actionBaseAt = performance.now() + config.actionWarmupMs) {
  const roundNumber = payload.currentRound;
  const activeClients = config.gameMode === 'battleRoyale'
    ? room.clients.filter((client) => !payload.snapshot?.players.find((player) => player.id === client.socket.id)?.isEliminated)
    : room.clients;
  const requiredCandidates = config.allowCrossPlayerWordReuse
    ? config.actionsPerPlayer
    : activeClients.length * config.actionsPerPlayer;
  const candidates = candidateWords(payload.currentWord, requiredCandidates);
  if (candidates.length < requiredCandidates) {
    throw new Error(`Room ${room.roomId} round ${roundNumber} has ${candidates.length}/${requiredCandidates} valid candidate words.`);
  }

  const roundStartedAt = performance.now();
  const roundMetric = {
    at: timestamp(),
    roomId: room.roomId,
    round: roundNumber,
    sourceWord: payload.currentWord,
    validCandidatesAvailable: candidates.length,
    plannedActions: requiredCandidates,
    actionRunDurationMs: null
  };
  metrics.rounds.push(roundMetric);

  const jobs = [];
  for (let playerIndex = 0; playerIndex < activeClients.length; playerIndex += 1) {
    const client = activeClients[playerIndex];
    for (let actionIndex = 0; actionIndex < config.actionsPerPlayer; actionIndex += 1) {
      const candidateIndex = config.allowCrossPlayerWordReuse
        ? actionIndex
        : playerIndex * config.actionsPerPlayer + actionIndex;
      const dueAt = actionBaseAt
        + actionIndex * config.actionIntervalMs
        + playerIndex * config.actionStaggerMs;
      jobs.push(submitAction(room, client, candidates[candidateIndex], roundNumber, dueAt));
    }
  }

  await Promise.all(jobs);
  roundMetric.actionRunDurationMs = elapsed(roundStartedAt);
}

async function connectPlayers() {
  state.clients = Array.from({ length: totalPlayers }, (_, index) => createClient(index));
  const results = await mapWithConcurrency(state.clients, config.connectConcurrency, connectClient);
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    throw new Error(`${failed.length}/${totalPlayers} virtual players failed to connect: ${failed[0]?.reason}`);
  }
}

async function createRooms() {
  state.rooms = Array.from({ length: config.rooms }, (_, index) => {
    const clients = state.clients.slice(index * config.playersPerRoom, (index + 1) * config.playersPerRoom);
    return {
      index,
      clients,
      host: clients[0],
      roomId: undefined,
      firstRound: deferred(),
      gameOver: undefined,
      roundActionRuns: [],
      pendingRoundPayloads: [],
      firstRoundStartLatencyMs: null,
      startAttemptAt: null,
      onRoundStarted: undefined
    };
  });

  const created = await mapWithConcurrency(state.rooms, config.setupConcurrency, async (room) => {
    const data = await emitAck(room.host, 'createRoom', {
      username: room.host.id,
      settings: scoreSettings(),
      isPublic: false
    }, { phase: 'setup' });
    room.roomId = data.roomId;
    room.host.roomId = data.roomId;
  });
  const failedCreation = created.find((result) => result.status === 'rejected');
  if (failedCreation) throw new Error(`Room creation failed: ${failedCreation.reason}`);

  const joins = state.rooms.flatMap((room) => room.clients.slice(1).map((client) => ({ room, client })));
  const joined = await mapWithConcurrency(joins, config.setupConcurrency, async ({ room, client }) => {
    await emitAck(client, 'joinRoom', { roomId: room.roomId, username: client.id }, { phase: 'setup' });
    client.roomId = room.roomId;
  });
  const failedJoin = joined.find((result) => result.status === 'rejected');
  if (failedJoin) throw new Error(`Room join failed: ${failedJoin.reason}`);
}

function attachRoomGameHandlers(room) {
  if (config.waitForGameOver) {
    room.gameOver = waitForEvent(
      room.host,
      'gameOver',
      () => true,
      config.rounds * (config.roundSeconds * 1_000 + 12_000) + 20_000
    );
    // Attach immediately so a failure cannot become an unhandled rejection.
    void room.gameOver.catch(() => undefined);
  }

  room.onRoundStarted = (payload) => {
    if (room.startAttemptAt !== null && room.firstRoundStartLatencyMs === null) {
      room.firstRoundStartLatencyMs = elapsed(room.startAttemptAt);
    }
    if (config.synchronizeRoomActions) {
      room.pendingRoundPayloads.push(payload);
      if (payload?.currentRound === 1) room.firstRound.resolve(payload);
      return;
    }

    const actionRun = scheduleRoundActions(room, payload).catch((error) => {
      recordError('round_action_scheduler_failed', error, { roomId: room.roomId, round: payload?.currentRound });
      return [];
    });
    room.roundActionRuns.push(actionRun);
    if (payload?.currentRound === 1) room.firstRound.resolve(payload);
  };
  room.host.socket.on('roundStarted', room.onRoundStarted);
}

async function startGames() {
  for (const room of state.rooms) attachRoomGameHandlers(room);
  const starts = [];
  for (const room of state.rooms) {
    room.startAttemptAt = performance.now();
    starts.push(emitAck(room.host, 'startGame', { roomId: room.roomId }, { phase: 'start' }));
    if (config.startSpacingMs > 0) await sleep(config.startSpacingMs);
  }
  const results = await Promise.allSettled(starts);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw new Error(`Game start failed: ${stringifyError(failure.reason)}`);

  const firstRounds = await Promise.allSettled(state.rooms.map((room) => withTimeout(
    room.firstRound.promise,
    config.eventTimeoutMs,
    `Room ${room.roomId} did not start a round within ${config.eventTimeoutMs} ms.`
  )));
  const firstRoundFailure = firstRounds.find((result) => result.status === 'rejected');
  if (firstRoundFailure?.status === 'rejected') throw new Error(stringifyError(firstRoundFailure.reason));

  if (config.synchronizeRoomActions) {
    const actionBaseAt = performance.now() + config.actionWarmupMs;
    for (const room of state.rooms) {
      const payload = room.pendingRoundPayloads.shift();
      if (!payload) throw new Error(`Room ${room.roomId} started without a round payload.`);
      const actionRun = scheduleRoundActions(room, payload, actionBaseAt).catch((error) => {
        recordError('round_action_scheduler_failed', error, { roomId: room.roomId, round: payload.currentRound });
        return [];
      });
      room.roundActionRuns.push(actionRun);
    }
  }

  if (config.waitForGameOver) {
    const games = await Promise.allSettled(state.rooms.map((room) => room.gameOver));
    const gameFailure = games.find((result) => result.status === 'rejected');
    if (gameFailure?.status === 'rejected') throw new Error(`Game completion failed: ${stringifyError(gameFailure.reason)}`);
  }

  await Promise.all(state.rooms.flatMap((room) => room.roundActionRuns));
}

async function disconnectClients() {
  state.intentionalShutdown = true;
  for (const room of state.rooms) {
    if (room.onRoundStarted) room.host.socket.off('roundStarted', room.onRoundStarted);
  }
  for (const client of state.clients) {
    client.intentionalDisconnect = true;
    if (client.socket.connected) client.socket.disconnect();
  }
  await sleep(300);
  metrics.cleanup = {
    at: timestamp(),
    requestedSocketCloses: state.clients.length,
    socketsStillConnected: state.clients.filter((client) => client.socket.connected).length,
    unexpectedDisconnects: state.clients.reduce((total, client) => total + client.unexpectedDisconnects, 0)
  };
}

function summarize() {
  const accepted = metrics.actions.filter((action) => action.eventOutcome === 'accepted');
  const rejected = metrics.actions.filter((action) => action.eventOutcome === 'rejected');
  const timedOut = metrics.actions.filter((action) => action.eventOutcome === 'timeout');
  const acknowledgementFailures = metrics.actions.filter((action) => !action.acknowledgementOk);
  // Score broadcasts are intentionally batched by room. Every room that
  // accepted at least one word must still reach every member at least once.
  const roomIdsWithAcceptedWords = new Set(accepted.map((action) => action.roomId));
  const expectedScoreUpdateClients = state.rooms
    .filter((room) => room.roomId && roomIdsWithAcceptedWords.has(room.roomId))
    .flatMap((room) => room.clients);
  const clientsWithScoreUpdate = expectedScoreUpdateClients.filter((client) => client.scoresUpdated > 0);
  const observedScoreUpdates = state.clients.reduce((total, client) => total + client.scoresUpdated, 0);
  const allScorePayloadBytes = state.clients.flatMap((client) => client.scorePayloadBytes);
  const healthSuccesses = metrics.health.filter((entry) => entry.ok);
  const resourceMemory = metrics.resources.map((entry) => entry.memoryBytes).filter((value) => value !== null);
  const resourceCpu = metrics.resources.map((entry) => entry.cpuPercent).filter(Number.isFinite);
  const attempted = metrics.actions.length;
  const acceptanceRate = plannedActions === 0 ? 0 : accepted.length / plannedActions;
  const scoreDeliveryRate = expectedScoreUpdateClients.length === 0 ? 0 : clientsWithScoreUpdate.length / expectedScoreUpdateClients.length;

  metrics.summary = {
    plannedActions,
    attemptedActions: attempted,
    acceptedActions: accepted.length,
    rejectedActions: rejected.length,
    timedOutActions: timedOut.length,
    acknowledgementFailures: acknowledgementFailures.length,
    acceptanceRate: Number(acceptanceRate.toFixed(4)),
    actionCompletionLatencyMs: distribution(accepted.map((action) => action.completionLatencyMs)),
    acknowledgementLatencyMs: distribution(metrics.acknowledgements.filter((ack) => ack.ok).map((ack) => ack.latencyMs)),
    firstRoundStartLatencyMs: distribution(state.rooms.map((room) => room.firstRoundStartLatencyMs)),
    scoreUpdates: {
      expectedRecipients: expectedScoreUpdateClients.length,
      recipientsWithAtLeastOne: clientsWithScoreUpdate.length,
      observedEvents: observedScoreUpdates,
      deliveryRate: Number(scoreDeliveryRate.toFixed(4)),
      payloadBytes: distribution(allScorePayloadBytes)
    },
    healthLatencyMs: distribution(healthSuccesses.map((entry) => entry.latencyMs)),
    healthFailures: metrics.health.filter((entry) => !entry.ok).length,
    resources: {
      samples: metrics.resources.length,
      maxMemoryBytes: resourceMemory.length > 0 ? Math.max(...resourceMemory) : null,
      maxCpuPercent: resourceCpu.length > 0 ? Number(Math.max(...resourceCpu).toFixed(2)) : null
    },
    unexpectedDisconnects: metrics.cleanup.unexpectedDisconnects ?? 0
  };

  const reasons = [];
  const actionP95 = metrics.summary.actionCompletionLatencyMs.p95;
  const healthP95 = metrics.summary.healthLatencyMs.p95;
  if (attempted !== plannedActions) reasons.push(`Only ${attempted}/${plannedActions} actions were attempted.`);
  if (acceptanceRate < config.slo.minimumAcceptanceRate) reasons.push(`Acceptance rate ${(acceptanceRate * 100).toFixed(2)}% is below ${(config.slo.minimumAcceptanceRate * 100).toFixed(2)}%.`);
  if (actionP95 === null || actionP95 > config.slo.actionP95Ms) reasons.push(`Accepted-word p95 ${actionP95 ?? 'n/a'} ms exceeds ${config.slo.actionP95Ms} ms.`);
  if (metrics.summary.firstRoundStartLatencyMs.p95 === null || metrics.summary.firstRoundStartLatencyMs.p95 > config.slo.roundStartP95Ms) reasons.push(`Round-start p95 ${metrics.summary.firstRoundStartLatencyMs.p95 ?? 'n/a'} ms exceeds ${config.slo.roundStartP95Ms} ms.`);
  if (scoreDeliveryRate < config.slo.minimumScoreDeliveryRate) reasons.push(`scoresUpdated delivery ${(scoreDeliveryRate * 100).toFixed(2)}% is below ${(config.slo.minimumScoreDeliveryRate * 100).toFixed(2)}%.`);
  if (metrics.summary.healthFailures > 0) reasons.push(`${metrics.summary.healthFailures} health check(s) failed.`);
  if (healthP95 === null || healthP95 > config.slo.healthP95Ms) reasons.push(`Health p95 ${healthP95 ?? 'n/a'} ms exceeds ${config.slo.healthP95Ms} ms.`);
  if (metrics.summary.unexpectedDisconnects > 0) reasons.push(`${metrics.summary.unexpectedDisconnects} unexpected socket disconnect(s) occurred.`);

  metrics.verdict = {
    result: metrics.status === 'completed' ? (reasons.length === 0 ? 'pass' : 'fail') : 'inconclusive',
    reasons
  };
}

async function writeReport() {
  metrics.finishedAt = timestamp();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  return reportPath;
}

process.on('SIGINT', () => {
  recordError('interrupted', new Error('Received SIGINT.'));
  state.intentionalShutdown = true;
});
process.on('SIGTERM', () => {
  recordError('interrupted', new Error('Received SIGTERM.'));
  state.intentionalShutdown = true;
});

let report;
try {
  console.log(`Render-Free local cell: ${config.cellName}`);
  console.log(`${config.rooms} room(s) × ${config.playersPerRoom} player(s); ${plannedActions} planned valid words; mode=${config.gameMode}.`);
  console.log(`SLO: p95 accepted word ≤${config.slo.actionP95Ms} ms; round-start p95 ≤${config.slo.roundStartP95Ms} ms; health p95 ≤${config.slo.healthP95Ms} ms; acceptance ≥${config.slo.minimumAcceptanceRate * 100}%; score delivery ≥${config.slo.minimumScoreDeliveryRate * 100}%.`);

  const baseline = await captureHealth('baseline');
  if (!baseline.ok) throw new Error(`Target did not pass the baseline health check: ${baseline.error ?? `HTTP ${baseline.status}`}.`);
  startMonitoring();
  await connectPlayers();
  await createRooms();
  await startGames();
  await sleep(config.deliverySettleMs);
  metrics.status = 'completed';
} catch (error) {
  metrics.status = 'failed';
  recordError('cell_failed', error);
  console.error(`Cell failed: ${stringifyError(error)}`);
} finally {
  // Disconnect cleanup can trigger hundreds of normal server-side leave
  // handlers. It is reported separately and must not contaminate the live
  // gameplay health/SLO measurements.
  await stopMonitoring();
  await disconnectClients();
  summarize();
  report = await writeReport();
  console.log(`Report: ${report}`);
  console.log(`Result: ${metrics.verdict.result}${metrics.verdict.reasons.length > 0 ? ` — ${metrics.verdict.reasons.join(' ')}` : ''}`);
}

if (metrics.verdict.result !== 'pass') process.exitCode = 1;
