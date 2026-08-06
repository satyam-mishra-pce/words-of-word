#!/usr/bin/env node
/**
 * Supervised, deliberately bounded production Socket.IO capacity test.
 *
 * This script is locked to the approved Words of Word production origin and
 * requires an explicit environment-variable acknowledgement before it sends
 * any traffic. It never exceeds 100 simultaneously connected virtual players
 * or 15 minutes of wall-clock runtime.
 *
 * Example (run only with an approved production window):
 * LIVE_LOAD_TEST_AUTHORIZATION=I_UNDERSTAND_PRODUCTION_IMPACT \
 *   node apps/web/scripts/live-production-load-test.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const PRODUCTION_ORIGIN = 'https://words-of-word.onrender.com';
const REQUIRED_AUTHORIZATION = 'I_UNDERSTAND_PRODUCTION_IMPACT';
const MAX_VIRTUAL_USERS = 100;
const MAX_RUNTIME_MS = 15 * 60 * 1_000;
const CLEANUP_RESERVE_MS = 45 * 1_000;
const CONNECT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 8_000;
const EVENT_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 5_000;
const COLD_START_TIMEOUT_MS = 30_000;
const HEALTH_SLOW_MS = 3_000;
const MAX_CRITICAL_ERRORS = 3;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const outputDirectory = resolve(repoRoot, 'logs');

const requestedOrigin = new URL(process.env.TARGET_URL ?? PRODUCTION_ORIGIN).origin;
if (process.env.LIVE_LOAD_TEST_AUTHORIZATION !== REQUIRED_AUTHORIZATION) {
  throw new Error(
    `Refusing to run. Set LIVE_LOAD_TEST_AUTHORIZATION=${REQUIRED_AUTHORIZATION} after approving production impact.`
  );
}
if (requestedOrigin !== PRODUCTION_ORIGIN) {
  throw new Error(`This production harness is intentionally locked to ${PRODUCTION_ORIGIN}.`);
}

const targetOrigin = requestedOrigin;
const hardDeadline = Date.now() + MAX_RUNTIME_MS;
const deadline = hardDeadline - CLEANUP_RESERVE_MS;
const startedAt = new Date().toISOString();

const stages = [
  { name: 'smoke-1-room-x-2-players', rooms: 1, playersPerRoom: 2, holdSeconds: 20, startSpacingMs: 150 },
  { name: 'room-count-10-rooms-x-2-players', rooms: 10, playersPerRoom: 2, holdSeconds: 30, startSpacingMs: 120 },
  { name: 'room-count-25-rooms-x-2-players', rooms: 25, playersPerRoom: 2, holdSeconds: 45, startSpacingMs: 120 },
  { name: 'room-count-50-rooms-x-2-players', rooms: 50, playersPerRoom: 2, holdSeconds: 60, startSpacingMs: 150 },
  { name: 'full-room-1-room-x-50-players', rooms: 1, playersPerRoom: 50, holdSeconds: 90, startSpacingMs: 0 },
  { name: 'full-rooms-2-rooms-x-50-players', rooms: 2, playersPerRoom: 50, holdSeconds: 240, startSpacingMs: 500 }
];

for (const stage of stages) {
  if (stage.rooms * stage.playersPerRoom > MAX_VIRTUAL_USERS) {
    throw new Error(`Unsafe stage ${stage.name}: it exceeds ${MAX_VIRTUAL_USERS} virtual players.`);
  }
}

const metrics = {
  schemaVersion: 1,
  targetOrigin,
  startedAt,
  limits: {
    maxVirtualUsers: MAX_VIRTUAL_USERS,
    maxRuntimeMs: MAX_RUNTIME_MS,
    cleanupReserveMs: CLEANUP_RESERVE_MS,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    ackTimeoutMs: ACK_TIMEOUT_MS,
    eventTimeoutMs: EVENT_TIMEOUT_MS,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
    coldStartTimeoutMs: COLD_START_TIMEOUT_MS,
    healthSlowMs: HEALTH_SLOW_MS,
    maxCriticalErrors: MAX_CRITICAL_ERRORS
  },
  plan: stages,
  baseline: {},
  connections: [],
  acknowledgements: [],
  events: [],
  health: [],
  stats: [],
  errors: [],
  stages: [],
  cleanup: {},
  status: 'running',
  abortReason: null,
  finishedAt: null
};

const state = {
  abortReason: null,
  stage: 'preflight',
  pool: [],
  intentionalShutdown: false
};

// Last-resort fuse: even a stalled cleanup cannot keep production test traffic
// alive beyond the user-approved 15-minute wall-clock envelope. Closing a
// Socket.IO client immediately closes its transport; the server removes these
// non-mobile sockets from rooms through its normal disconnect handler.
const hardStopTimer = setTimeout(() => {
  state.intentionalShutdown = true;
  for (const client of state.pool) {
    client.intentionalDisconnect = true;
    client.socket.disconnect();
  }
  console.error('\nHARD SAFETY FUSE: 15-minute production-test limit reached; closing all test sockets now.');
  process.exit(2);
}, MAX_RUNTIME_MS);
hardStopTimer.unref();

function nowIso() {
  return new Date().toISOString();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const finite = values.filter((value) => Number.isFinite(value));
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

function compactError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requestStop(reason) {
  if (state.abortReason) return;
  state.abortReason = reason;
  metrics.abortReason = reason;
  console.error(`\nSTOP REQUESTED: ${reason}`);
}

function ensureRunning() {
  if (Date.now() >= deadline) {
    requestStop('The 15-minute runtime ceiling is approaching; preserving time for cleanup.');
  }
  if (state.abortReason) throw new Error(state.abortReason);
}

function recordError(kind, error, { critical = true, clientId, stage = state.stage, detail } = {}) {
  const item = {
    at: nowIso(),
    kind,
    stage,
    critical,
    clientId,
    detail,
    message: compactError(error)
  };
  metrics.errors.push(item);
  console.error(`[${stage}] ${kind}${clientId ? ` (${clientId})` : ''}: ${item.message}`);

  if (!critical) return;
  const criticalErrors = metrics.errors.filter((entry) => entry.critical).length;
  if (criticalErrors >= MAX_CRITICAL_ERRORS) {
    requestStop(`${criticalErrors} critical client/operation failures observed.`);
  }
}

function makeClient(index, socket) {
  const client = {
    id: `LT-${String(index + 1).padStart(3, '0')}`,
    index,
    socket,
    roomId: undefined,
    intentionalDisconnect: false,
    eventCounts: Object.create(null),
    eventPayloadSizes: Object.create(null),
    unexpectedDisconnects: 0
  };

  const observedEvents = [
    'roomSnapshot', 'playerJoined', 'playerLeft', 'hostChanged', 'roundStarted',
    'timeUpdate', 'wordAccepted', 'wordRejected', 'scoresUpdated', 'roundEnded',
    'gameOver', 'gameRestarted', 'playerBusted', 'emotePlayed', 'notice'
  ];

  for (const eventName of observedEvents) {
    socket.on(eventName, (payload) => {
      client.eventCounts[eventName] = (client.eventCounts[eventName] ?? 0) + 1;
      if (eventName === 'scoresUpdated') {
        try {
          const size = JSON.stringify(payload).length;
          const sizes = client.eventPayloadSizes[eventName] ?? [];
          sizes.push(size);
          client.eventPayloadSizes[eventName] = sizes;
        } catch {
          // Payload sizing is supplemental telemetry, never a test failure.
        }
      }
    });
  }

  socket.on('disconnect', (reason) => {
    if (client.intentionalDisconnect || state.intentionalShutdown) return;
    client.unexpectedDisconnects += 1;
    recordError('unexpected_socket_disconnect', reason, { clientId: client.id, detail: { reason } });
  });

  return client;
}

async function connectVirtualUser(index) {
  ensureRunning();
  const started = performance.now();
  const socket = io(targetOrigin, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS,
    auth: { scoreUpdateProtocol: 2 }
  });
  const client = makeClient(index, socket);

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        cleanup();
        rejectPromise(new Error(`Socket did not connect within ${CONNECT_TIMEOUT_MS} ms.`));
      }, CONNECT_TIMEOUT_MS);

      const onConnect = () => {
        cleanup();
        resolvePromise();
      };
      const onError = (error) => {
        cleanup();
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };

      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      socket.connect();
    });
  } catch (error) {
    client.intentionalDisconnect = true;
    socket.disconnect();
    recordError('socket_connect_failed', error, { clientId: client.id });
    throw error;
  }

  const latencyMs = elapsedMilliseconds(started);
  metrics.connections.push({ at: nowIso(), clientId: client.id, latencyMs, transport: socket.io.engine.transport.name });
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
        results[index] = { status: 'rejected', reason: compactError(error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function emitAck(client, eventName, payload, { timeoutMs = ACK_TIMEOUT_MS, critical = true } = {}) {
  ensureRunning();
  const started = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(`${eventName} acknowledgement timed out after ${timeoutMs} ms.`);
      metrics.acknowledgements.push({
        at: nowIso(), stage: state.stage, clientId: client.id, eventName, ok: false,
        latencyMs: elapsedMilliseconds(started), error: error.message
      });
      recordError('socket_ack_timeout', error, { critical, clientId: client.id, detail: { eventName } });
      rejectPromise(error);
    }, timeoutMs);

    client.socket.emit(eventName, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const latencyMs = elapsedMilliseconds(started);
      const ok = Boolean(response?.ok);
      metrics.acknowledgements.push({
        at: nowIso(), stage: state.stage, clientId: client.id, eventName, ok, latencyMs,
        ...(ok ? {} : { error: response?.error ?? 'Unknown server acknowledgement error.' })
      });
      if (!ok) {
        const error = new Error(response?.error ?? `${eventName} failed without an error message.`);
        recordError('socket_ack_rejected', error, { critical, clientId: client.id, detail: { eventName } });
        rejectPromise(error);
        return;
      }
      resolvePromise(response.data);
    });
  });
}

function waitForEvent(client, eventName, predicate, { timeoutMs = EVENT_TIMEOUT_MS, critical = true } = {}) {
  const started = performance.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const handler = (payload) => {
      if (predicate && !predicate(payload)) return;
      cleanup();
      const latencyMs = elapsedMilliseconds(started);
      metrics.events.push({ at: nowIso(), stage: state.stage, clientId: client.id, eventName, latencyMs, ok: true });
      resolvePromise(payload);
    };
    const timer = setTimeout(() => {
      cleanup();
      const error = new Error(`${eventName} was not received within ${timeoutMs} ms.`);
      metrics.events.push({ at: nowIso(), stage: state.stage, clientId: client.id, eventName, latencyMs: elapsedMilliseconds(started), ok: false, error: error.message });
      recordError('socket_event_timeout', error, { critical, clientId: client.id, detail: { eventName } });
      rejectPromise(error);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off(eventName, handler);
    };
    client.socket.on(eventName, handler);
  });
}

async function fetchJson(pathname, timeoutMs) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${targetOrigin}${pathname}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      redirect: 'error',
      signal: controller.signal
    });
    const latencyMs = elapsedMilliseconds(started);
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, latencyMs, body };
  } catch (error) {
    return { ok: false, status: null, latencyMs: elapsedMilliseconds(started), error: compactError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function captureHealth(label, { critical = false, timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const result = await fetchJson('/health', timeoutMs);
  const observation = { at: nowIso(), label, timeoutMs, ...result };
  metrics.health.push(observation);
  if (!result.ok && critical) {
    requestStop(`Health endpoint failed during ${label}: ${result.error ?? `HTTP ${result.status}`}.`);
  }
  return observation;
}

async function captureStats(label, { timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  const result = await fetchJson('/stats', timeoutMs);
  const observation = { at: nowIso(), label, timeoutMs, ...result };
  metrics.stats.push(observation);
  return observation;
}

async function warmService() {
  const attempts = [];
  // A Render Free service may be suspended. This is a low-rate readiness probe,
  // not load: it permits one cold start to finish, records its latency separately,
  // and does not begin socket traffic until both public endpoints are healthy.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    ensureRunning();
    const health = await captureHealth(`warmup:${attempt}`, { timeoutMs: COLD_START_TIMEOUT_MS });
    const stats = health.ok
      ? await captureStats(`warmup:${attempt}`, { timeoutMs: HEALTH_TIMEOUT_MS })
      : undefined;
    attempts.push({ health, stats });
    if (health.ok && stats?.ok) return { health, stats, attempts };
    if (attempt < 2) await sleep(2_000);
  }
  const last = attempts.at(-1);
  throw new Error(`Service did not become ready after warmup: ${last?.health.error ?? `HTTP ${last?.health.status}`}.`);
}

function startMonitoring() {
  let stopped = false;
  let consecutiveSlowHealthChecks = 0;

  const loop = async () => {
    while (!stopped && !state.abortReason) {
      const health = await captureHealth(`monitor:${state.stage}`, { critical: true });
      await captureStats(`monitor:${state.stage}`);
      if (!health.ok) break;

      if (health.latencyMs > HEALTH_SLOW_MS) {
        consecutiveSlowHealthChecks += 1;
        if (consecutiveSlowHealthChecks >= 2) {
          requestStop(`${consecutiveSlowHealthChecks} consecutive health responses exceeded ${HEALTH_SLOW_MS} ms.`);
          break;
        }
      } else {
        consecutiveSlowHealthChecks = 0;
      }
      await sleep(5_000);
    }
  };

  void loop().catch((error) => recordError('monitor_failed', error));
  return () => { stopped = true; };
}

function gameSettings(playersPerRoom) {
  return {
    minWordLength: 5,
    timePerRound: 300,
    rounds: 1,
    maxPlayers: playersPerRoom,
    gameMode: 'classic',
    fastestWordTarget: 5,
    eliminationsPerRound: 1,
    wordCategory: 'general',
    customWordList: '',
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

async function createStageRooms(stage, clients) {
  const rooms = Array.from({ length: stage.rooms }, (_, index) => {
    const players = clients.slice(index * stage.playersPerRoom, (index + 1) * stage.playersPerRoom);
    return { index, host: players[0], players, roomId: undefined, currentWord: undefined };
  });

  const hostResults = await mapWithConcurrency(rooms, 5, async (room) => {
    const data = await emitAck(room.host, 'createRoom', {
      username: room.host.id,
      settings: gameSettings(stage.playersPerRoom),
      isPublic: false
    });
    room.roomId = data.roomId;
    room.host.roomId = data.roomId;
    return room.roomId;
  });
  if (hostResults.some((result) => result.status !== 'fulfilled')) {
    throw new Error('One or more room hosts could not create a room.');
  }

  const joinJobs = rooms.flatMap((room) => room.players.slice(1).map((client) => ({ room, client })));
  const joinResults = await mapWithConcurrency(joinJobs, 10, async ({ room, client }) => {
    const data = await emitAck(client, 'joinRoom', { roomId: room.roomId, username: client.id });
    client.roomId = room.roomId;
    return data;
  });
  if (joinResults.some((result) => result.status !== 'fulfilled')) {
    throw new Error('One or more virtual players could not join their assigned room.');
  }

  return rooms;
}

async function startStageGames(stage, rooms) {
  for (const room of rooms) {
    ensureRunning();
    // Register before the ack-producing request: startRound emits synchronously.
    // Waiting per room keeps this latency a true start-to-event measurement rather
    // than charging later rooms for an intentional ramp delay.
    const roundWait = waitForEvent(room.host, 'roundStarted', () => true);
    try {
      await emitAck(room.host, 'startGame', { roomId: room.roomId });
      const round = await roundWait;
      const currentWord = round?.currentWord;
      if (!currentWord) throw new Error(`Room ${room.roomId} started without a source word.`);
      room.currentWord = currentWord;
    } catch (error) {
      await Promise.allSettled([roundWait]);
      throw error;
    }
    if (stage.startSpacingMs > 0) await sleep(stage.startSpacingMs);
  }
}

async function submitOneWordPerPlayer(rooms) {
  const submissions = rooms.flatMap((room) => room.players.map((client) => ({ client, roomId: room.roomId, word: room.currentWord })));
  const scoreCountsBefore = new Map(submissions.map(({ client }) => [client, client.eventCounts.scoresUpdated ?? 0]));
  const wordAcceptedWaits = submissions.map(({ client, word }) => (
    waitForEvent(client, 'wordAccepted', (payload) => payload?.playerId === client.socket.id && payload?.word === word)
  ));

  const submitResults = await mapWithConcurrency(submissions, 10, async ({ client, roomId, word }) => (
    emitAck(client, 'submitWord', { roomId, word })
  ));
  const acceptedResults = await Promise.allSettled(wordAcceptedWaits);
  await sleep(1_500);

  const expectedScoreUpdates = rooms.reduce((total, room) => total + room.players.length * room.players.length, 0);
  const observedScoreUpdates = submissions.reduce((total, { client }) => (
    total + ((client.eventCounts.scoresUpdated ?? 0) - (scoreCountsBefore.get(client) ?? 0))
  ), 0);

  return {
    submitted: submissions.length,
    acceptedEvents: acceptedResults.filter((result) => result.status === 'fulfilled').length,
    submitAcks: submitResults.filter((result) => result.status === 'fulfilled').length,
    expectedScoreUpdates,
    observedScoreUpdates,
    scoreUpdateDeliveryPercent: expectedScoreUpdates === 0
      ? null
      : Number(((observedScoreUpdates / expectedScoreUpdates) * 100).toFixed(2))
  };
}

async function holdStage(seconds) {
  const until = Date.now() + seconds * 1_000;
  while (Date.now() < until) {
    ensureRunning();
    await sleep(Math.min(1_000, until - Date.now()));
  }
}

async function leaveStageRooms(rooms) {
  const players = rooms.flatMap((room) => room.players);
  // Cap normal-stage cleanup to at most five 2-second batches. If an ack is
  // absent, the next create/join will detach that socket; final cleanup always
  // closes every remaining transport.
  const leaveResults = await mapWithConcurrency(players, 20, async (client) => {
    if (!client.roomId) return;
    const roomId = client.roomId;
    try {
      await emitAck(client, 'leaveRoom', { roomId }, { timeoutMs: 2_000, critical: false });
    } finally {
      client.roomId = undefined;
    }
  });
  return leaveResults;
}

function stageSummary(stage, marker, activity) {
  const acknowledgements = metrics.acknowledgements.slice(marker.acknowledgements);
  const events = metrics.events.slice(marker.events);
  const health = metrics.health.slice(marker.health);
  const stats = metrics.stats.slice(marker.stats);
  const errors = metrics.errors.slice(marker.errors);
  const clients = marker.clients;
  const timeUpdates = clients.reduce((total, client) => total + ((client.eventCounts.timeUpdate ?? 0) - (marker.timeUpdates.get(client) ?? 0)), 0);
  const scorePayloadSizes = clients.flatMap((client) => (client.eventPayloadSizes.scoresUpdated ?? []).slice(marker.scorePayloadCounts.get(client) ?? 0));

  const eventLatencyByName = Object.fromEntries(
    [...new Set(events.map((entry) => entry.eventName))].map((eventName) => [
      eventName,
      distribution(events.filter((entry) => entry.ok && entry.eventName === eventName).map((entry) => entry.latencyMs))
    ])
  );

  return {
    name: stage.name,
    rooms: stage.rooms,
    playersPerRoom: stage.playersPerRoom,
    activeVirtualPlayers: stage.rooms * stage.playersPerRoom,
    requestedHoldSeconds: stage.holdSeconds,
    actualDurationMs: Number((performance.now() - marker.started).toFixed(2)),
    activity,
    acknowledgementLatencyMs: distribution(acknowledgements.filter((entry) => entry.ok).map((entry) => entry.latencyMs)),
    eventLatencyByName,
    healthLatencyMs: distribution(health.filter((entry) => entry.ok).map((entry) => entry.latencyMs)),
    timeUpdateEventsObserved: timeUpdates,
    scoresUpdatedPayloadBytes: distribution(scorePayloadSizes),
    errors,
    stats
  };
}

async function runStage(stage) {
  ensureRunning();
  state.stage = stage.name;
  const activePlayers = stage.rooms * stage.playersPerRoom;
  const clients = state.pool.slice(0, activePlayers);
  const marker = {
    started: performance.now(),
    acknowledgements: metrics.acknowledgements.length,
    events: metrics.events.length,
    health: metrics.health.length,
    stats: metrics.stats.length,
    errors: metrics.errors.length,
    clients,
    timeUpdates: new Map(clients.map((client) => [client, client.eventCounts.timeUpdate ?? 0])),
    scorePayloadCounts: new Map(clients.map((client) => [client, (client.eventPayloadSizes.scoresUpdated ?? []).length]))
  };
  let rooms = [];
  let activity = {};

  console.log(`\n=== ${stage.name}: ${stage.rooms} room(s) × ${stage.playersPerRoom} players (${activePlayers} active) ===`);
  try {
    rooms = await createStageRooms(stage, clients);
    await captureStats(`stage-start:${stage.name}`);
    await startStageGames(stage, rooms);
    activity = await submitOneWordPerPlayer(rooms);
    await holdStage(stage.holdSeconds);
    await captureHealth(`stage-end:${stage.name}`, { critical: true });
    await captureStats(`stage-end:${stage.name}`);
    ensureRunning();
  } finally {
    if (rooms.length > 0) await leaveStageRooms(rooms);
  }

  const summary = stageSummary(stage, marker, activity);
  metrics.stages.push(summary);
  console.log(`${stage.name}: ${summary.activity.acceptedEvents ?? 0}/${summary.activity.submitted ?? 0} accepted, ` +
    `ack p95 ${summary.acknowledgementLatencyMs.p95 ?? 'n/a'} ms, ` +
    `word-accepted p95 ${summary.eventLatencyByName.wordAccepted?.p95 ?? 'n/a'} ms, ` +
    `score-update delivery ${summary.activity.scoreUpdateDeliveryPercent ?? 'n/a'}%.`);
}

async function cleanupAllClients() {
  state.intentionalShutdown = true;
  const clients = state.pool;
  // Final cleanup intentionally does not wait on acknowledgements. It finishes
  // in one synchronous pass and the server's disconnect handler removes every
  // non-mobile test player even if it was still assigned to a room.
  for (const client of clients) {
    client.roomId = undefined;
    client.intentionalDisconnect = true;
    if (client.socket.connected) client.socket.disconnect();
  }
  await sleep(500);
  metrics.cleanup = {
    at: nowIso(),
    poolSize: clients.length,
    socketsStillConnected: clients.filter((client) => client.socket.connected).length,
    unexpectedDisconnects: clients.reduce((total, client) => total + client.unexpectedDisconnects, 0)
  };
}

async function writeReport() {
  metrics.finishedAt = nowIso();
  const suffix = metrics.finishedAt.replace(/[:.]/g, '-');
  await mkdir(outputDirectory, { recursive: true });
  const filename = resolve(outputDirectory, `production-load-test-${suffix}.json`);
  await writeFile(filename, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  return filename;
}

process.on('SIGINT', () => requestStop('Interrupted by operator (SIGINT).'));
process.on('SIGTERM', () => requestStop('Interrupted by operator (SIGTERM).'));

let stopMonitoring = () => {};
let reportPath;
try {
  console.log(`Controlled production load test starting against ${targetOrigin}`);
  console.log(`Hard limits: ≤${MAX_VIRTUAL_USERS} simultaneously connected virtual players; ≤15 minutes wall-clock; stop after ${MAX_CRITICAL_ERRORS} critical failures.`);

  const warmed = await warmService();
  metrics.baseline.health = warmed.health;
  metrics.baseline.stats = warmed.stats;
  metrics.baseline.warmupAttempts = warmed.attempts;

  stopMonitoring = startMonitoring();
  state.stage = 'connect-100-virtual-users';
  const connectionResults = await mapWithConcurrency(
    Array.from({ length: MAX_VIRTUAL_USERS }, (_, index) => index),
    10,
    async (index) => connectVirtualUser(index)
  );
  state.pool = connectionResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);

  if (state.pool.length !== MAX_VIRTUAL_USERS) {
    throw new Error(`Only ${state.pool.length}/${MAX_VIRTUAL_USERS} virtual users connected; not proceeding with gameplay stages.`);
  }
  await captureStats('after-connect-100');

  for (const stage of stages) {
    await runStage(stage);
  }

  metrics.status = 'completed';
} catch (error) {
  if (state.abortReason) {
    metrics.status = 'aborted-safely';
  } else {
    metrics.status = 'failed';
    recordError('test_failed', error, { critical: false });
  }
  console.error(`\nTest ${metrics.status}: ${state.abortReason ?? compactError(error)}`);
} finally {
  stopMonitoring();
  await cleanupAllClients();
  state.stage = 'post-test';
  if (hardDeadline - Date.now() > 12_000) {
    metrics.postTest = {
      health: await captureHealth('after-test'),
      stats: await captureStats('after-test')
    };
  } else {
    metrics.postTest = { skipped: 'Skipped to preserve the hard 15-minute safety ceiling.' };
  }
  reportPath = await writeReport();
  clearTimeout(hardStopTimer);
  console.log(`\nReport written to ${reportPath}`);
  console.log(`Final status: ${metrics.status}`);
}

if (metrics.status !== 'completed') process.exitCode = 2;
