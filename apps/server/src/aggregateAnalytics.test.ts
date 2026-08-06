import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GameSettings } from '@wow/shared';
import { AggregateAnalyticsStore } from './aggregateAnalytics.js';
import type { AnalyticsMetricDelta, AnalyticsPersistence } from './analyticsPersistence.js';

class MemoryAnalyticsPersistence implements AnalyticsPersistence {
  public readonly kind = 'postgres' as const;
  public readonly supportsMetricWindows = true;
  public state: unknown;
  public readonly deltas = new Map<string, AnalyticsMetricDelta>();

  public async load(): Promise<unknown | undefined> {
    return this.state;
  }

  public async save(data: unknown, deltas: readonly AnalyticsMetricDelta[]): Promise<void> {
    this.state = structuredClone(data);
    for (const delta of deltas) this.deltas.set(delta.id, structuredClone(delta));
  }

  public async readMetricDeltas(from: string, to: string): Promise<AnalyticsMetricDelta[]> {
    return Array.from(this.deltas.values())
      .filter((delta) => delta.occurredAt >= from && delta.occurredAt < to)
      .map((delta) => structuredClone(delta));
  }

  public async close(): Promise<void> {}
}

const settings: GameSettings = {
  minWordLength: 5,
  timePerRound: 30,
  rounds: 5,
  maxPlayers: 4,
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

test('persists sanitized deltas and replays an exact metric window', async () => {
  const persistence = new MemoryAnalyticsPersistence();
  const store = new AggregateAnalyticsStore(persistence, () => undefined);
  await store.load();
  const from = new Date().toISOString();

  store.recordSocketConnected('socket-one', {
    visitorId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222'
  });
  store.recordRoomCreated(settings, 'socket-one');
  store.recordGameStarted('private-room-code', settings, true, ['socket-one']);
  store.recordWordAccepted('socket-one');
  await store.flush();

  const to = new Date(Date.now() + 1_000).toISOString();
  const scoped = await store.report({ from, to });
  assert.equal(scoped.window.exactMetricsAvailable, true);
  assert.equal(scoped.totals.roomsCreated, 1);
  assert.equal(scoped.totals.gamesStarted, 1);
  assert.equal(scoped.totals.wordsAccepted, 1);
  assert.equal(scoped.audience.knownVisitors, 1);
  assert.equal(scoped.byGameMode.classic.gamesStarted, 1);
  assert.equal(scoped.settings.roomVisibility.public, 1);

  const persistedDeltaText = JSON.stringify(Array.from(persistence.deltas.values()));
  assert.doesNotMatch(persistedDeltaText, /socket-one|private-room-code|11111111-1111-4111-8111-111111111111/);

  const reloaded = new AggregateAnalyticsStore(persistence, () => undefined);
  await reloaded.load();
  const allTime = await reloaded.report();
  assert.equal(allTime.totals.gamesStarted, 1);
  assert.equal(allTime.totals.wordsAccepted, 1);
});

test('uses only ledger events inside a partial-day window for metrics and traffic', { concurrency: false }, async () => {
  const originalNow = Date.now;
  const base = originalNow();
  let current = base;
  Date.now = () => current;

  try {
    const persistence = new MemoryAnalyticsPersistence();
    const store = new AggregateAnalyticsStore(persistence, () => undefined);
    await store.load();
    store.recordRoomCreated(settings);

    current = base + 2 * 60 * 60_000;
    store.recordWordAccepted();
    await store.flush();

    const report = await store.report({
      from: new Date(base + 60 * 60_000).toISOString(),
      to: new Date(base + 3 * 60 * 60_000).toISOString()
    });
    assert.equal(report.window.exactMetricsAvailable, true);
    assert.equal(report.totals.roomsCreated, 0);
    assert.equal(report.totals.wordsAccepted, 1);
    assert.equal(report.trends.daily.length, 1);
    assert.equal(report.trends.daily[0]?.roomsCreated, 0);
    assert.equal(report.trends.daily[0]?.wordsAccepted, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('imports an available file-backed state before a durable database starts writing', async () => {
  const sourcePersistence = new MemoryAnalyticsPersistence();
  const source = new AggregateAnalyticsStore(sourcePersistence, () => undefined);
  await source.load();
  source.recordRoomCreated(settings);
  await source.flush();

  const directory = await mkdtemp(join(tmpdir(), 'wow-analytics-migration-'));
  const filePath = join(directory, 'aggregate-analytics.json');
  await writeFile(filePath, JSON.stringify(sourcePersistence.state), 'utf8');

  try {
    const durablePersistence = new MemoryAnalyticsPersistence();
    const migrated = new AggregateAnalyticsStore(durablePersistence, () => undefined, filePath);
    await migrated.load();
    const report = await migrated.report();
    assert.equal(report.totals.roomsCreated, 1);
    assert.notEqual(durablePersistence.state, undefined);
    const beforeDurableLedger = await migrated.report({
      from: '2000-01-01T00:00:00.000Z',
      to: new Date().toISOString()
    });
    assert.equal(beforeDurableLedger.window.exactMetricsAvailable, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects corrupt durable state instead of overwriting it with empty analytics', async () => {
  const persistence = new MemoryAnalyticsPersistence();
  persistence.state = { version: 999 };
  const store = new AggregateAnalyticsStore(persistence, () => undefined);

  await assert.rejects(store.load(), /Unsupported analytics state version/);
  assert.equal(persistence.deltas.size, 0);
});

test('rejects malformed counters in an otherwise versioned durable state', async () => {
  const sourcePersistence = new MemoryAnalyticsPersistence();
  const source = new AggregateAnalyticsStore(sourcePersistence, () => undefined);
  await source.load();
  source.recordRoomCreated(settings);
  await source.flush();

  const persistence = new MemoryAnalyticsPersistence();
  const malformed = structuredClone(sourcePersistence.state) as { totals: unknown };
  malformed.totals = [];
  persistence.state = malformed;
  const store = new AggregateAnalyticsStore(persistence, () => undefined);

  await assert.rejects(store.load(), /invalid total counters/);
  assert.equal(persistence.deltas.size, 0);
});
