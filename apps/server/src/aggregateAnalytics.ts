import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  FeatureUsageEventSchema,
  GameModeSchema,
  type FeatureUsageEvent,
  type GameMode,
  type GameSettings,
  type MixModifiers,
  type RoomPhase
} from '@wow/shared';
import { FileAnalyticsPersistence, type AnalyticsMetricDelta, type AnalyticsPersistence } from './analyticsPersistence.js';

const PERSIST_DEBOUNCE_MS = 1_000;
const PERSISTENCE_VERSION = 3;
const SESSION_DEDUPLICATION_MS = 12 * 60 * 60 * 1_000;
const MAX_RECENT_SESSIONS = 100_000;
const MIX_MODIFIER_KEYS = [
  'teams',
  'wordSprint',
  'blind',
  'claim',
  'busted',
  'intuition',
  'lightning'
] as const satisfies ReadonlyArray<keyof MixModifiers>;
const ROOM_SIZE_BUCKETS = ['1', '2', '3_4', '5_6', '7_10', '11_plus'] as const;
const FILL_RATE_BUCKETS = ['under_50', '50_74', '75_99', 'full'] as const;
const DURATION_BUCKETS = ['under_1m', '1_3m', '3_7m', '7_15m', '15m_plus'] as const;
const ROUND_DEPTH_BUCKETS = ['0', '1', '2_3', '4_5', '6_plus'] as const;
const EXIT_ROUND_BUCKETS = ['before_r1', 'r1', 'r2_3', 'r4_5', 'r6_plus'] as const;
const DEPARTURE_PHASES = ['lobby', 'betting', 'round', 'betweenRounds', 'gameOver'] as const satisfies readonly RoomPhase[];
const DEPARTURE_REASONS = ['leave', 'switch', 'disconnect'] as const;
const HOUR_OF_WEEK_KEYS = Array.from({ length: 7 }, (_, weekday) => (
  Array.from({ length: 24 }, (_, hour) => `${weekday}-${hour}`)
)).flat();
const GAME_MODE_METRIC_KEYS = [
  'roomsCreated', 'gamesStarted', 'gamesFinished', 'gamesAbandoned',
  'participantSlots', 'completedParticipantSlots', 'playerRounds'
] as const;
const LEGACY_GAME_MODE_METRIC_KEYS = [
  'roomsCreated', 'gamesStarted', 'gamesFinished', 'gamesAbandoned'
] as const;
const DAILY_METRIC_KEYS = [
  'uniqueVisitors', 'newVisitors', 'returningVisitors', 'sessions', 'roomsCreated',
  'roomsJoined', 'roomsPlayable', 'gamesStarted', 'gamesFinished', 'gamesAbandoned',
  'roundsCompleted', 'participantSlots', 'playerRounds', 'playerDepartures',
  'wordsAccepted', 'featureEvents', 'peakConnectedSockets', 'peakActiveGames'
] as const;
const HOUR_METRIC_KEYS = [
  'sessions', 'roomsJoined', 'gamesStarted', 'participantSlots', 'peakConnectedSockets', 'peakActiveGames'
] as const;
const SETTINGS_KEYS = [
  'roomVisibility', 'wordCategory', 'minWordLength', 'timePerRound', 'rounds',
  'maxPlayers', 'fastestWordTarget', 'eliminationsPerRound', 'mixScoringMode', 'mixModifiers'
] as const;

type CounterMap = Record<string, number>;
type TotalKey =
  | 'roomsCreated'
  | 'roomsJoined'
  | 'roomsPlayable'
  | 'quickJoinCreated'
  | 'quickJoinJoined'
  | 'settingsUpdated'
  | 'gamesStarted'
  | 'gamesFinished'
  | 'gamesAbandoned'
  | 'gamesRestarted'
  | 'roundsCompleted'
  | 'wordsAccepted'
  | 'teamChanges'
  | 'betsPlaced'
  | 'emotesSent'
  | 'visitorSessions'
  | 'playerDepartures';
type RoomSizeBucket = (typeof ROOM_SIZE_BUCKETS)[number];
type FillRateBucket = (typeof FILL_RATE_BUCKETS)[number];
type DurationBucket = (typeof DURATION_BUCKETS)[number];
type RoundDepthBucket = (typeof ROUND_DEPTH_BUCKETS)[number];
type ExitRoundBucket = (typeof EXIT_ROUND_BUCKETS)[number];
type DepartureReason = (typeof DEPARTURE_REASONS)[number];
type HourOfWeekKey = string;

type GameModeMetrics = {
  roomsCreated: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
  participantSlots: number;
  completedParticipantSlots: number;
  playerRounds: number;
};

type DailyMetrics = {
  uniqueVisitors: number;
  newVisitors: number;
  returningVisitors: number;
  sessions: number;
  roomsCreated: number;
  roomsJoined: number;
  roomsPlayable: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
  roundsCompleted: number;
  participantSlots: number;
  playerRounds: number;
  playerDepartures: number;
  wordsAccepted: number;
  featureEvents: number;
  peakConnectedSockets: number;
  peakActiveGames: number;
};

type HourOfWeekMetrics = {
  sessions: number;
  roomsJoined: number;
  gamesStarted: number;
  participantSlots: number;
  peakConnectedSockets: number;
  peakActiveGames: number;
};

type EngagementMetrics = {
  participantsInStartedGames: number;
  participantsInCompletedGames: number;
  playerRounds: number;
  playerDepartures: number;
  activeGameDepartures: number;
  gameDurationMs: {
    completed: number;
    abandoned: number;
  };
  playerPresenceDurationMs: number;
  playerGameDurationMs: number;
  roomSizeAtGameStart: Record<RoomSizeBucket, number>;
  roomFillAtGameStart: Record<FillRateBucket, number>;
  gameDuration: Record<DurationBucket, number>;
  playerPresenceDuration: Record<DurationBucket, number>;
  playerGameDuration: Record<DurationBucket, number>;
  playerRoundDepth: Record<RoundDepthBucket, number>;
  departuresByPhase: Record<RoomPhase, number>;
  departuresByReason: Record<DepartureReason, number>;
  activeGameDropoffByRound: Record<ExitRoundBucket, number>;
};

type VisitorProfile = {
  firstSeenDay: string;
  lastSeenDay: string;
  activeDays: string[];
  sessions: number;
  roomsJoined: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
  playerRounds: number;
  wordsAccepted: number;
  featureEvents: number;
  gameModes: GameMode[];
  featuresUsed: FeatureUsageEvent[];
};

type AggregateAnalyticsData = {
  version: typeof PERSISTENCE_VERSION;
  updatedAt: string;
  /** Timestamp from which durable, timestamp-filterable metric deltas exist. */
  metricsRecordedFrom: string;
  /** Private HMAC key. It is never included in a report response. */
  identitySalt: string;
  totals: Record<TotalKey, number>;
  byGameMode: Record<GameMode, GameModeMetrics>;
  modeAdoption: Record<GameMode, number>;
  settings: {
    roomVisibility: CounterMap;
    wordCategory: CounterMap;
    minWordLength: CounterMap;
    timePerRound: CounterMap;
    rounds: CounterMap;
    maxPlayers: CounterMap;
    fastestWordTarget: CounterMap;
    eliminationsPerRound: CounterMap;
    mixScoringMode: CounterMap;
    mixModifiers: CounterMap;
  };
  featureUsage: Record<FeatureUsageEvent, number>;
  featureAdoption: Record<FeatureUsageEvent, number>;
  engagement: EngagementMetrics;
  daily: Record<string, DailyMetrics>;
  hourOfWeek: Record<HourOfWeekKey, HourOfWeekMetrics>;
  /** Pseudonymous profiles are private working data for exact retention only. */
  visitors: Record<string, VisitorProfile>;
};

type CumulativeAnalyticsMetrics = Pick<AggregateAnalyticsData,
  'totals' | 'byGameMode' | 'modeAdoption' | 'settings' | 'featureUsage' | 'featureAdoption' | 'engagement' | 'hourOfWeek'
>;

type AnalyticsLedgerPayload = {
  metrics?: CumulativeAnalyticsMetrics;
  /** HMAC visitor keys only; raw browser IDs never enter the ledger. */
  visitorKeys?: string[];
};

export type AnalyticsReportWindow = {
  /** UTC ISO timestamp, inclusive. */
  from: string;
  /** UTC ISO timestamp, exclusive. */
  to: string;
};

type RetentionMetric = {
  eligible: number;
  returned: number;
  rate: number;
};

export type AggregateAnalyticsReport = {
  version: typeof PERSISTENCE_VERSION;
  updatedAt: string;
  window: {
    from: string;
    to: string;
    isAllTime: boolean;
    exactMetricsAvailable: boolean;
    metricsRecordedFrom: string;
  };
  totals: Record<TotalKey, number>;
  byGameMode: Record<GameMode, GameModeMetrics>;
  modeAdoption: Record<GameMode, number>;
  settings: AggregateAnalyticsData['settings'];
  featureUsage: Record<FeatureUsageEvent, number>;
  featureAdoption: Record<FeatureUsageEvent, number>;
  engagement: EngagementMetrics;
  audience: {
    knownVisitors: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    newToday: number;
    returningToday: number;
    sessionsToday: number;
    retention: {
      day1: RetentionMetric;
      day7: RetentionMetric;
      day30: RetentionMetric;
    };
  };
  trends: {
    daily: Array<{ date: string } & DailyMetrics>;
    hourOfWeek: Array<{ weekday: number; hour: number } & HourOfWeekMetrics>;
  };
  live: {
    connectedSockets: number;
    activeGames: number;
  };
};

export type PublicGameStats = {
  activePlayers: number;
  activeGames: number;
  wordsFound: number;
};

export type AnalyticsVisitorIdentity = {
  visitorId: string;
  sessionId: string;
};

export type PlayerDeparture = {
  roomId: string;
  socketId: string;
  phase: RoomPhase;
  currentRound: number;
  durationMs: number;
  reason: DepartureReason;
};

type ActiveGame = {
  startedAt: number;
  gameMode: GameMode;
  participantSockets: Set<string>;
  joinedAtBySocket: Map<string, number>;
  visitorBySocket: Map<string, string>;
  roundsBySocket: Map<string, number>;
  finalizedDepthSockets: Set<string>;
  recordedDurationSockets: Set<string>;
};

const TOTAL_KEYS: readonly TotalKey[] = [
  'roomsCreated',
  'roomsJoined',
  'roomsPlayable',
  'quickJoinCreated',
  'quickJoinJoined',
  'settingsUpdated',
  'gamesStarted',
  'gamesFinished',
  'gamesAbandoned',
  'gamesRestarted',
  'roundsCompleted',
  'wordsAccepted',
  'teamChanges',
  'betsPlaced',
  'emotesSent',
  'visitorSessions',
  'playerDepartures'
];
const LEGACY_TOTAL_KEYS = [
  'roomsCreated', 'roomsJoined', 'quickJoinCreated', 'quickJoinJoined',
  'settingsUpdated', 'gamesStarted', 'gamesFinished', 'gamesAbandoned',
  'gamesRestarted', 'roundsCompleted', 'wordsAccepted', 'teamChanges',
  'betsPlaced', 'emotesSent'
] as const;

function createCounterMap(): CounterMap {
  return {};
}

function createFixedCounter<Key extends string>(keys: readonly Key[]): Record<Key, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>;
}

function createGameModeMetrics(): GameModeMetrics {
  return {
    roomsCreated: 0,
    gamesStarted: 0,
    gamesFinished: 0,
    gamesAbandoned: 0,
    participantSlots: 0,
    completedParticipantSlots: 0,
    playerRounds: 0
  };
}

function createDailyMetrics(): DailyMetrics {
  return {
    uniqueVisitors: 0,
    newVisitors: 0,
    returningVisitors: 0,
    sessions: 0,
    roomsCreated: 0,
    roomsJoined: 0,
    roomsPlayable: 0,
    gamesStarted: 0,
    gamesFinished: 0,
    gamesAbandoned: 0,
    roundsCompleted: 0,
    participantSlots: 0,
    playerRounds: 0,
    playerDepartures: 0,
    wordsAccepted: 0,
    featureEvents: 0,
    peakConnectedSockets: 0,
    peakActiveGames: 0
  };
}

function createHourOfWeekMetrics(): HourOfWeekMetrics {
  return {
    sessions: 0,
    roomsJoined: 0,
    gamesStarted: 0,
    participantSlots: 0,
    peakConnectedSockets: 0,
    peakActiveGames: 0
  };
}

function createHourOfWeekMetricsMap(): Record<HourOfWeekKey, HourOfWeekMetrics> {
  return Object.fromEntries(HOUR_OF_WEEK_KEYS.map((key) => [key, createHourOfWeekMetrics()]));
}

function createEngagementMetrics(): EngagementMetrics {
  return {
    participantsInStartedGames: 0,
    participantsInCompletedGames: 0,
    playerRounds: 0,
    playerDepartures: 0,
    activeGameDepartures: 0,
    gameDurationMs: {
      completed: 0,
      abandoned: 0
    },
    playerPresenceDurationMs: 0,
    playerGameDurationMs: 0,
    roomSizeAtGameStart: createFixedCounter(ROOM_SIZE_BUCKETS),
    roomFillAtGameStart: createFixedCounter(FILL_RATE_BUCKETS),
    gameDuration: createFixedCounter(DURATION_BUCKETS),
    playerPresenceDuration: createFixedCounter(DURATION_BUCKETS),
    playerGameDuration: createFixedCounter(DURATION_BUCKETS),
    playerRoundDepth: createFixedCounter(ROUND_DEPTH_BUCKETS),
    departuresByPhase: createFixedCounter(DEPARTURE_PHASES),
    departuresByReason: createFixedCounter(DEPARTURE_REASONS),
    activeGameDropoffByRound: createFixedCounter(EXIT_ROUND_BUCKETS)
  };
}

function createIdentitySalt(): string {
  return randomBytes(32).toString('base64url');
}

function createData(): AggregateAnalyticsData {
  return {
    version: PERSISTENCE_VERSION,
    updatedAt: new Date().toISOString(),
    metricsRecordedFrom: new Date().toISOString(),
    identitySalt: createIdentitySalt(),
    totals: createFixedCounter(TOTAL_KEYS),
    byGameMode: Object.fromEntries(GameModeSchema.options.map((mode) => [mode, createGameModeMetrics()])) as Record<GameMode, GameModeMetrics>,
    modeAdoption: createFixedCounter(GameModeSchema.options),
    settings: {
      roomVisibility: createCounterMap(),
      wordCategory: createCounterMap(),
      minWordLength: createCounterMap(),
      timePerRound: createCounterMap(),
      rounds: createCounterMap(),
      maxPlayers: createCounterMap(),
      fastestWordTarget: createCounterMap(),
      eliminationsPerRound: createCounterMap(),
      mixScoringMode: createCounterMap(),
      mixModifiers: createCounterMap()
    },
    featureUsage: createFixedCounter(FeatureUsageEventSchema.options),
    featureAdoption: createFixedCounter(FeatureUsageEventSchema.options),
    engagement: createEngagementMetrics(),
    daily: {},
    hourOfWeek: createHourOfWeekMetricsMap(),
    visitors: {}
  };
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function asNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function restoreFixedCounter<Key extends string>(keys: readonly Key[], value: unknown): Record<Key, number> {
  const source = asRecord(value);
  return Object.fromEntries(keys.map((key) => [key, asNonNegativeInteger(source[key])])) as Record<Key, number>;
}

function restoreCounterMap(value: unknown): CounterMap {
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .filter(([key]) => /^[a-zA-Z0-9_+-]{1,32}$/.test(key))
      .map(([key, count]) => [key, asNonNegativeInteger(count)])
  );
}

function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function shiftDay(day: string, amount: number): string {
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  return utcDay(timestamp + amount * 24 * 60 * 60 * 1_000);
}

function restoreDaily(value: unknown, now: number): Record<string, DailyMetrics> {
  const restored: Record<string, DailyMetrics> = {};
  for (const [day, rawMetrics] of Object.entries(asRecord(value))) {
    if (!isDayKey(day) || day > utcDay(now)) continue;
    const metrics = asRecord(rawMetrics);
    restored[day] = {
      uniqueVisitors: asNonNegativeInteger(metrics.uniqueVisitors),
      newVisitors: asNonNegativeInteger(metrics.newVisitors),
      returningVisitors: asNonNegativeInteger(metrics.returningVisitors),
      sessions: asNonNegativeInteger(metrics.sessions),
      roomsCreated: asNonNegativeInteger(metrics.roomsCreated),
      roomsJoined: asNonNegativeInteger(metrics.roomsJoined),
      roomsPlayable: asNonNegativeInteger(metrics.roomsPlayable),
      gamesStarted: asNonNegativeInteger(metrics.gamesStarted),
      gamesFinished: asNonNegativeInteger(metrics.gamesFinished),
      gamesAbandoned: asNonNegativeInteger(metrics.gamesAbandoned),
      roundsCompleted: asNonNegativeInteger(metrics.roundsCompleted),
      participantSlots: asNonNegativeInteger(metrics.participantSlots),
      playerRounds: asNonNegativeInteger(metrics.playerRounds),
      playerDepartures: asNonNegativeInteger(metrics.playerDepartures),
      wordsAccepted: asNonNegativeInteger(metrics.wordsAccepted),
      featureEvents: asNonNegativeInteger(metrics.featureEvents),
      peakConnectedSockets: asNonNegativeInteger(metrics.peakConnectedSockets),
      peakActiveGames: asNonNegativeInteger(metrics.peakActiveGames)
    };
  }
  return restored;
}

function restoreHourOfWeek(value: unknown): Record<HourOfWeekKey, HourOfWeekMetrics> {
  const source = asRecord(value);
  return HOUR_OF_WEEK_KEYS.reduce<Record<HourOfWeekKey, HourOfWeekMetrics>>((result, key) => {
    const metrics = asRecord(source[key]);
    result[key] = {
      sessions: asNonNegativeInteger(metrics.sessions),
      roomsJoined: asNonNegativeInteger(metrics.roomsJoined),
      gamesStarted: asNonNegativeInteger(metrics.gamesStarted),
      participantSlots: asNonNegativeInteger(metrics.participantSlots),
      peakConnectedSockets: asNonNegativeInteger(metrics.peakConnectedSockets),
      peakActiveGames: asNonNegativeInteger(metrics.peakActiveGames)
    };
    return result;
  }, {});
}

function restoreEngagement(value: unknown): EngagementMetrics {
  const source = asRecord(value);
  const duration = asRecord(source.gameDurationMs);
  return {
    participantsInStartedGames: asNonNegativeInteger(source.participantsInStartedGames),
    participantsInCompletedGames: asNonNegativeInteger(source.participantsInCompletedGames),
    playerRounds: asNonNegativeInteger(source.playerRounds),
    playerDepartures: asNonNegativeInteger(source.playerDepartures),
    activeGameDepartures: asNonNegativeInteger(source.activeGameDepartures),
    gameDurationMs: {
      completed: asNonNegativeNumber(duration.completed),
      abandoned: asNonNegativeNumber(duration.abandoned)
    },
    playerPresenceDurationMs: asNonNegativeNumber(source.playerPresenceDurationMs),
    playerGameDurationMs: asNonNegativeNumber(source.playerGameDurationMs),
    roomSizeAtGameStart: restoreFixedCounter(ROOM_SIZE_BUCKETS, source.roomSizeAtGameStart),
    roomFillAtGameStart: restoreFixedCounter(FILL_RATE_BUCKETS, source.roomFillAtGameStart),
    gameDuration: restoreFixedCounter(DURATION_BUCKETS, source.gameDuration),
    playerPresenceDuration: restoreFixedCounter(DURATION_BUCKETS, source.playerPresenceDuration),
    playerGameDuration: restoreFixedCounter(DURATION_BUCKETS, source.playerGameDuration),
    playerRoundDepth: restoreFixedCounter(ROUND_DEPTH_BUCKETS, source.playerRoundDepth),
    departuresByPhase: restoreFixedCounter(DEPARTURE_PHASES, source.departuresByPhase),
    departuresByReason: restoreFixedCounter(DEPARTURE_REASONS, source.departuresByReason),
    activeGameDropoffByRound: restoreFixedCounter(EXIT_ROUND_BUCKETS, source.activeGameDropoffByRound)
  };
}

function isStrictCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasStrictCounters(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => isStrictCounter(value[key]));
}

function isStrictCounterMap(value: unknown): boolean {
  return isRecord(value) && Object.entries(value)
    .every(([key, count]) => /^[a-zA-Z0-9_+-]{1,32}$/.test(key) && isStrictCounter(count));
}

function isStrictEngagement(value: unknown): boolean {
  if (!isRecord(value) || !hasStrictCounters(value, [
    'participantsInStartedGames', 'participantsInCompletedGames', 'playerRounds',
    'playerDepartures', 'activeGameDepartures', 'playerPresenceDurationMs', 'playerGameDurationMs'
  ])) return false;
  if (!isRecord(value.gameDurationMs)
    || !isStrictCounter(value.gameDurationMs.completed)
    || !isStrictCounter(value.gameDurationMs.abandoned)) return false;
  return hasStrictCounters(value.roomSizeAtGameStart, ROOM_SIZE_BUCKETS)
    && hasStrictCounters(value.roomFillAtGameStart, FILL_RATE_BUCKETS)
    && hasStrictCounters(value.gameDuration, DURATION_BUCKETS)
    && hasStrictCounters(value.playerPresenceDuration, DURATION_BUCKETS)
    && hasStrictCounters(value.playerGameDuration, DURATION_BUCKETS)
    && hasStrictCounters(value.playerRoundDepth, ROUND_DEPTH_BUCKETS)
    && hasStrictCounters(value.departuresByPhase, DEPARTURE_PHASES)
    && hasStrictCounters(value.departuresByReason, DEPARTURE_REASONS)
    && hasStrictCounters(value.activeGameDropoffByRound, EXIT_ROUND_BUCKETS);
}

function isStrictVisitorProfile(value: unknown): boolean {
  if (!isRecord(value)
    || !isDayKey(value.firstSeenDay)
    || !isDayKey(value.lastSeenDay)
    || !Array.isArray(value.activeDays)
    || !value.activeDays.every(isDayKey)
    || !hasStrictCounters(value, [
      'sessions', 'roomsJoined', 'gamesStarted', 'gamesFinished', 'gamesAbandoned',
      'playerRounds', 'wordsAccepted', 'featureEvents'
    ])
    || !Array.isArray(value.gameModes)
    || !value.gameModes.every((mode) => typeof mode === 'string' && GameModeSchema.options.includes(mode as GameMode))
    || !Array.isArray(value.featuresUsed)
    || !value.featuresUsed.every((event) => typeof event === 'string' && FeatureUsageEventSchema.options.includes(event as FeatureUsageEvent))) return false;
  return true;
}

function assertStrictAnalyticsState(stored: Record<string, unknown>): void {
  if (typeof stored.updatedAt !== 'string' || Number.isNaN(Date.parse(stored.updatedAt))) {
    throw new Error('Stored analytics state has an invalid update timestamp.');
  }
  const totalKeys = stored.version === 1 ? LEGACY_TOTAL_KEYS : TOTAL_KEYS;
  if (!hasStrictCounters(stored.totals, totalKeys)) {
    throw new Error('Stored analytics state has invalid total counters.');
  }
  const byGameMode = asRecord(stored.byGameMode);
  const gameModeKeys = stored.version === 1 ? LEGACY_GAME_MODE_METRIC_KEYS : GAME_MODE_METRIC_KEYS;
  if (!isRecord(stored.byGameMode) || !GameModeSchema.options.every((mode) => hasStrictCounters(byGameMode[mode], gameModeKeys))) {
    throw new Error('Stored analytics state has invalid game-mode counters.');
  }
  const settings = asRecord(stored.settings);
  if (!isRecord(stored.settings) || !SETTINGS_KEYS.every((key) => isStrictCounterMap(settings[key]))) {
    throw new Error('Stored analytics state has invalid settings counters.');
  }
  if (!hasStrictCounters(stored.featureUsage, FeatureUsageEventSchema.options)) {
    throw new Error('Stored analytics state has invalid feature-use counters.');
  }

  if (stored.version === 1) return;
  if (typeof stored.identitySalt !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(stored.identitySalt)) {
    throw new Error('Stored analytics state has an invalid identity salt.');
  }
  if (!hasStrictCounters(stored.modeAdoption, GameModeSchema.options)
    || !hasStrictCounters(stored.featureAdoption, FeatureUsageEventSchema.options)
    || !isStrictEngagement(stored.engagement)) {
    throw new Error('Stored analytics state has invalid derived counters.');
  }
  if (!isRecord(stored.daily) || !Object.entries(stored.daily)
    .every(([day, metrics]) => isDayKey(day) && hasStrictCounters(metrics, DAILY_METRIC_KEYS))) {
    throw new Error('Stored analytics state has invalid daily metrics.');
  }
  const hourOfWeek = asRecord(stored.hourOfWeek);
  if (!isRecord(stored.hourOfWeek) || !HOUR_OF_WEEK_KEYS
    .every((key) => hasStrictCounters(hourOfWeek[key], HOUR_METRIC_KEYS))) {
    throw new Error('Stored analytics state has invalid hourly metrics.');
  }
  if (!isRecord(stored.visitors) || !Object.entries(stored.visitors)
    .every(([visitorKey, profile]) => /^[A-Za-z0-9_-]{32,128}$/.test(visitorKey) && isStrictVisitorProfile(profile))) {
    throw new Error('Stored analytics state has invalid visitor profiles.');
  }
  if (stored.version === PERSISTENCE_VERSION && (
    typeof stored.metricsRecordedFrom !== 'string'
    || Number.isNaN(Date.parse(stored.metricsRecordedFrom))
  )) {
    throw new Error('Stored analytics state has an invalid metric-ledger start time.');
  }
}

function restoreVisitors(value: unknown, now: number): Record<string, VisitorProfile> {
  const source = asRecord(value);
  const restored: Record<string, VisitorProfile> = {};
  const featureValues = new Set<string>(FeatureUsageEventSchema.options);
  const gameModes = new Set<string>(GameModeSchema.options);

  for (const [visitorKey, rawProfile] of Object.entries(source)) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(visitorKey)) continue;
    const profile = asRecord(rawProfile);
    const activeDays = Array.from(new Set(
      (Array.isArray(profile.activeDays) ? profile.activeDays : [])
        .filter(isDayKey)
        .filter((day) => day <= utcDay(now))
    )).sort();
    const firstSeenDay = isDayKey(profile.firstSeenDay) ? profile.firstSeenDay : activeDays[0];
    const lastSeenDay = isDayKey(profile.lastSeenDay) ? profile.lastSeenDay : activeDays.at(-1);
    if (!firstSeenDay || !lastSeenDay || activeDays.length === 0) continue;

    restored[visitorKey] = {
      firstSeenDay,
      lastSeenDay,
      activeDays,
      sessions: asNonNegativeInteger(profile.sessions),
      roomsJoined: asNonNegativeInteger(profile.roomsJoined),
      gamesStarted: asNonNegativeInteger(profile.gamesStarted),
      gamesFinished: asNonNegativeInteger(profile.gamesFinished),
      gamesAbandoned: asNonNegativeInteger(profile.gamesAbandoned),
      playerRounds: asNonNegativeInteger(profile.playerRounds),
      wordsAccepted: asNonNegativeInteger(profile.wordsAccepted),
      featureEvents: asNonNegativeInteger(profile.featureEvents),
      gameModes: Array.from(new Set((Array.isArray(profile.gameModes) ? profile.gameModes : [])
        .filter((mode): mode is GameMode => typeof mode === 'string' && gameModes.has(mode)))) as GameMode[],
      featuresUsed: Array.from(new Set((Array.isArray(profile.featuresUsed) ? profile.featuresUsed : [])
        .filter((event): event is FeatureUsageEvent => typeof event === 'string' && featureValues.has(event)))) as FeatureUsageEvent[]
    };

  }

  return restored;
}

function restoreData(value: unknown, now: number, strict = false): AggregateAnalyticsData {
  if (!isRecord(value)) {
    if (strict) throw new Error('Stored analytics state is not an object.');
    return createData();
  }
  const stored = value;
  if (stored.version !== 1 && stored.version !== 2 && stored.version !== PERSISTENCE_VERSION) {
    if (strict) throw new Error(`Unsupported analytics state version: ${String(stored.version)}.`);
    return createData();
  }
  if (strict) assertStrictAnalyticsState(stored);

  const data = createData();
  data.updatedAt = typeof stored.updatedAt === 'string' ? stored.updatedAt : data.updatedAt;
  data.metricsRecordedFrom = stored.version === PERSISTENCE_VERSION
    && typeof stored.metricsRecordedFrom === 'string'
    && !Number.isNaN(Date.parse(stored.metricsRecordedFrom))
    ? stored.metricsRecordedFrom
    : new Date(now).toISOString();
  const totals = asRecord(stored.totals);
  for (const key of TOTAL_KEYS) data.totals[key] = asNonNegativeInteger(totals[key]);

  const byGameMode = asRecord(stored.byGameMode);
  for (const mode of GameModeSchema.options) {
    const metrics = asRecord(byGameMode[mode]);
    data.byGameMode[mode] = {
      roomsCreated: asNonNegativeInteger(metrics.roomsCreated),
      gamesStarted: asNonNegativeInteger(metrics.gamesStarted),
      gamesFinished: asNonNegativeInteger(metrics.gamesFinished),
      gamesAbandoned: asNonNegativeInteger(metrics.gamesAbandoned),
      participantSlots: asNonNegativeInteger(metrics.participantSlots),
      completedParticipantSlots: asNonNegativeInteger(metrics.completedParticipantSlots),
      playerRounds: asNonNegativeInteger(metrics.playerRounds)
    };
  }

  const settings = asRecord(stored.settings);
  data.settings = {
    roomVisibility: restoreCounterMap(settings.roomVisibility),
    wordCategory: restoreCounterMap(settings.wordCategory),
    minWordLength: restoreCounterMap(settings.minWordLength),
    timePerRound: restoreCounterMap(settings.timePerRound),
    rounds: restoreCounterMap(settings.rounds),
    maxPlayers: restoreCounterMap(settings.maxPlayers),
    fastestWordTarget: restoreCounterMap(settings.fastestWordTarget),
    eliminationsPerRound: restoreCounterMap(settings.eliminationsPerRound),
    mixScoringMode: restoreCounterMap(settings.mixScoringMode),
    mixModifiers: restoreCounterMap(settings.mixModifiers)
  };

  const featureUsage = asRecord(stored.featureUsage);
  for (const event of FeatureUsageEventSchema.options) {
    data.featureUsage[event] = asNonNegativeInteger(featureUsage[event]);
  }

  if (stored.version === 2 || stored.version === PERSISTENCE_VERSION) {
    data.identitySalt = typeof stored.identitySalt === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(stored.identitySalt)
      ? stored.identitySalt
      : data.identitySalt;
    data.modeAdoption = restoreFixedCounter(GameModeSchema.options, stored.modeAdoption);
    data.featureAdoption = restoreFixedCounter(FeatureUsageEventSchema.options, stored.featureAdoption);
    data.engagement = restoreEngagement(stored.engagement);
    data.daily = restoreDaily(stored.daily, now);
    data.hourOfWeek = restoreHourOfWeek(stored.hourOfWeek);
    data.visitors = restoreVisitors(stored.visitors, now);
  }

  return data;
}

function roomSizeBucket(playerCount: number): RoomSizeBucket {
  if (playerCount <= 1) return '1';
  if (playerCount === 2) return '2';
  if (playerCount <= 4) return '3_4';
  if (playerCount <= 6) return '5_6';
  if (playerCount <= 10) return '7_10';
  return '11_plus';
}

function fillRateBucket(playerCount: number, maxPlayers: number): FillRateBucket {
  const fill = maxPlayers > 0 ? playerCount / maxPlayers : 0;
  if (fill < 0.5) return 'under_50';
  if (fill < 0.75) return '50_74';
  if (fill < 1) return '75_99';
  return 'full';
}

function durationBucket(durationMs: number): DurationBucket {
  if (durationMs < 60_000) return 'under_1m';
  if (durationMs < 3 * 60_000) return '1_3m';
  if (durationMs < 7 * 60_000) return '3_7m';
  if (durationMs < 15 * 60_000) return '7_15m';
  return '15m_plus';
}

function roundDepthBucket(rounds: number): RoundDepthBucket {
  if (rounds <= 0) return '0';
  if (rounds === 1) return '1';
  if (rounds <= 3) return '2_3';
  if (rounds <= 5) return '4_5';
  return '6_plus';
}

function exitRoundBucket(round: number): ExitRoundBucket {
  if (round <= 0) return 'before_r1';
  if (round === 1) return 'r1';
  if (round <= 3) return 'r2_3';
  if (round <= 5) return 'r4_5';
  return 'r6_plus';
}

/** The allowlisted, non-identifying counters that can be replayed by time window. */
function createCumulativeMetrics(): CumulativeAnalyticsMetrics {
  return {
    totals: createFixedCounter(TOTAL_KEYS),
    byGameMode: Object.fromEntries(GameModeSchema.options.map((mode) => [mode, createGameModeMetrics()])) as Record<GameMode, GameModeMetrics>,
    modeAdoption: createFixedCounter(GameModeSchema.options),
    settings: {
      roomVisibility: createCounterMap(),
      wordCategory: createCounterMap(),
      minWordLength: createCounterMap(),
      timePerRound: createCounterMap(),
      rounds: createCounterMap(),
      maxPlayers: createCounterMap(),
      fastestWordTarget: createCounterMap(),
      eliminationsPerRound: createCounterMap(),
      mixScoringMode: createCounterMap(),
      mixModifiers: createCounterMap()
    },
    featureUsage: createFixedCounter(FeatureUsageEventSchema.options),
    featureAdoption: createFixedCounter(FeatureUsageEventSchema.options),
    engagement: createEngagementMetrics(),
    hourOfWeek: createHourOfWeekMetricsMap()
  };
}

function captureCumulativeMetrics(data: AggregateAnalyticsData): CumulativeAnalyticsMetrics {
  return {
    totals: structuredClone(data.totals),
    byGameMode: structuredClone(data.byGameMode),
    modeAdoption: structuredClone(data.modeAdoption),
    settings: structuredClone(data.settings),
    featureUsage: structuredClone(data.featureUsage),
    featureAdoption: structuredClone(data.featureAdoption),
    engagement: structuredClone(data.engagement),
    hourOfWeek: structuredClone(data.hourOfWeek)
  };
}

function restoreLedgerPayload(value: unknown): { metrics: CumulativeAnalyticsMetrics; visitorKeys: string[] } {
  const source = asRecord(value);
  const visitorKeys = Array.isArray(source.visitorKeys)
    ? source.visitorKeys.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value))
    : [];
  return {
    metrics: restoreCumulativeMetrics(source.metrics),
    visitorKeys: Array.from(new Set(visitorKeys))
  };
}

function restoreCumulativeMetrics(value: unknown): CumulativeAnalyticsMetrics {
  const source = asRecord(value);
  const metrics = createCumulativeMetrics();
  metrics.totals = restoreFixedCounter(TOTAL_KEYS, source.totals);
  const byGameMode = asRecord(source.byGameMode);
  for (const mode of GameModeSchema.options) {
    const current = asRecord(byGameMode[mode]);
    metrics.byGameMode[mode] = {
      roomsCreated: asNonNegativeInteger(current.roomsCreated),
      gamesStarted: asNonNegativeInteger(current.gamesStarted),
      gamesFinished: asNonNegativeInteger(current.gamesFinished),
      gamesAbandoned: asNonNegativeInteger(current.gamesAbandoned),
      participantSlots: asNonNegativeInteger(current.participantSlots),
      completedParticipantSlots: asNonNegativeInteger(current.completedParticipantSlots),
      playerRounds: asNonNegativeInteger(current.playerRounds)
    };
  }
  metrics.modeAdoption = restoreFixedCounter(GameModeSchema.options, source.modeAdoption);
  const settings = asRecord(source.settings);
  metrics.settings = {
    roomVisibility: restoreCounterMap(settings.roomVisibility),
    wordCategory: restoreCounterMap(settings.wordCategory),
    minWordLength: restoreCounterMap(settings.minWordLength),
    timePerRound: restoreCounterMap(settings.timePerRound),
    rounds: restoreCounterMap(settings.rounds),
    maxPlayers: restoreCounterMap(settings.maxPlayers),
    fastestWordTarget: restoreCounterMap(settings.fastestWordTarget),
    eliminationsPerRound: restoreCounterMap(settings.eliminationsPerRound),
    mixScoringMode: restoreCounterMap(settings.mixScoringMode),
    mixModifiers: restoreCounterMap(settings.mixModifiers)
  };
  metrics.featureUsage = restoreFixedCounter(FeatureUsageEventSchema.options, source.featureUsage);
  metrics.featureAdoption = restoreFixedCounter(FeatureUsageEventSchema.options, source.featureAdoption);
  metrics.engagement = restoreEngagement(source.engagement);
  metrics.hourOfWeek = restoreHourOfWeek(source.hourOfWeek);
  return metrics;
}

function counterDelta(after: CounterMap, before: CounterMap): CounterMap {
  const delta: CounterMap = {};
  for (const key of new Set([...Object.keys(after), ...Object.keys(before)])) {
    const value = Math.max(0, (after[key] ?? 0) - (before[key] ?? 0));
    if (value > 0) delta[key] = value;
  }
  return delta;
}

function fixedCounterDelta<Key extends string>(keys: readonly Key[], after: Record<Key, number>, before: Record<Key, number>): Record<Key, number> {
  return Object.fromEntries(keys.map((key) => [key, Math.max(0, after[key] - before[key])])) as Record<Key, number>;
}

function addCounter(target: CounterMap, delta: CounterMap): void {
  for (const [key, value] of Object.entries(delta)) {
    if (value > 0) target[key] = (target[key] ?? 0) + value;
  }
}

function addFixedCounter<Key extends string>(keys: readonly Key[], target: Record<Key, number>, delta: Record<Key, number>): void {
  for (const key of keys) target[key] += delta[key];
}

function gameModeDelta(after: GameModeMetrics, before: GameModeMetrics): GameModeMetrics {
  return {
    roomsCreated: Math.max(0, after.roomsCreated - before.roomsCreated),
    gamesStarted: Math.max(0, after.gamesStarted - before.gamesStarted),
    gamesFinished: Math.max(0, after.gamesFinished - before.gamesFinished),
    gamesAbandoned: Math.max(0, after.gamesAbandoned - before.gamesAbandoned),
    participantSlots: Math.max(0, after.participantSlots - before.participantSlots),
    completedParticipantSlots: Math.max(0, after.completedParticipantSlots - before.completedParticipantSlots),
    playerRounds: Math.max(0, after.playerRounds - before.playerRounds)
  };
}

function addGameModeMetrics(target: GameModeMetrics, delta: GameModeMetrics): void {
  target.roomsCreated += delta.roomsCreated;
  target.gamesStarted += delta.gamesStarted;
  target.gamesFinished += delta.gamesFinished;
  target.gamesAbandoned += delta.gamesAbandoned;
  target.participantSlots += delta.participantSlots;
  target.completedParticipantSlots += delta.completedParticipantSlots;
  target.playerRounds += delta.playerRounds;
}

function engagementDelta(after: EngagementMetrics, before: EngagementMetrics): EngagementMetrics {
  return {
    participantsInStartedGames: Math.max(0, after.participantsInStartedGames - before.participantsInStartedGames),
    participantsInCompletedGames: Math.max(0, after.participantsInCompletedGames - before.participantsInCompletedGames),
    playerRounds: Math.max(0, after.playerRounds - before.playerRounds),
    playerDepartures: Math.max(0, after.playerDepartures - before.playerDepartures),
    activeGameDepartures: Math.max(0, after.activeGameDepartures - before.activeGameDepartures),
    gameDurationMs: {
      completed: Math.max(0, after.gameDurationMs.completed - before.gameDurationMs.completed),
      abandoned: Math.max(0, after.gameDurationMs.abandoned - before.gameDurationMs.abandoned)
    },
    playerPresenceDurationMs: Math.max(0, after.playerPresenceDurationMs - before.playerPresenceDurationMs),
    playerGameDurationMs: Math.max(0, after.playerGameDurationMs - before.playerGameDurationMs),
    roomSizeAtGameStart: fixedCounterDelta(ROOM_SIZE_BUCKETS, after.roomSizeAtGameStart, before.roomSizeAtGameStart),
    roomFillAtGameStart: fixedCounterDelta(FILL_RATE_BUCKETS, after.roomFillAtGameStart, before.roomFillAtGameStart),
    gameDuration: fixedCounterDelta(DURATION_BUCKETS, after.gameDuration, before.gameDuration),
    playerPresenceDuration: fixedCounterDelta(DURATION_BUCKETS, after.playerPresenceDuration, before.playerPresenceDuration),
    playerGameDuration: fixedCounterDelta(DURATION_BUCKETS, after.playerGameDuration, before.playerGameDuration),
    playerRoundDepth: fixedCounterDelta(ROUND_DEPTH_BUCKETS, after.playerRoundDepth, before.playerRoundDepth),
    departuresByPhase: fixedCounterDelta(DEPARTURE_PHASES, after.departuresByPhase, before.departuresByPhase),
    departuresByReason: fixedCounterDelta(DEPARTURE_REASONS, after.departuresByReason, before.departuresByReason),
    activeGameDropoffByRound: fixedCounterDelta(EXIT_ROUND_BUCKETS, after.activeGameDropoffByRound, before.activeGameDropoffByRound)
  };
}

function addEngagement(target: EngagementMetrics, delta: EngagementMetrics): void {
  target.participantsInStartedGames += delta.participantsInStartedGames;
  target.participantsInCompletedGames += delta.participantsInCompletedGames;
  target.playerRounds += delta.playerRounds;
  target.playerDepartures += delta.playerDepartures;
  target.activeGameDepartures += delta.activeGameDepartures;
  target.gameDurationMs.completed += delta.gameDurationMs.completed;
  target.gameDurationMs.abandoned += delta.gameDurationMs.abandoned;
  target.playerPresenceDurationMs += delta.playerPresenceDurationMs;
  target.playerGameDurationMs += delta.playerGameDurationMs;
  addFixedCounter(ROOM_SIZE_BUCKETS, target.roomSizeAtGameStart, delta.roomSizeAtGameStart);
  addFixedCounter(FILL_RATE_BUCKETS, target.roomFillAtGameStart, delta.roomFillAtGameStart);
  addFixedCounter(DURATION_BUCKETS, target.gameDuration, delta.gameDuration);
  addFixedCounter(DURATION_BUCKETS, target.playerPresenceDuration, delta.playerPresenceDuration);
  addFixedCounter(DURATION_BUCKETS, target.playerGameDuration, delta.playerGameDuration);
  addFixedCounter(ROUND_DEPTH_BUCKETS, target.playerRoundDepth, delta.playerRoundDepth);
  addFixedCounter(DEPARTURE_PHASES, target.departuresByPhase, delta.departuresByPhase);
  addFixedCounter(DEPARTURE_REASONS, target.departuresByReason, delta.departuresByReason);
  addFixedCounter(EXIT_ROUND_BUCKETS, target.activeGameDropoffByRound, delta.activeGameDropoffByRound);
}

function differenceCumulativeMetrics(after: CumulativeAnalyticsMetrics, before: CumulativeAnalyticsMetrics): CumulativeAnalyticsMetrics {
  const delta = createCumulativeMetrics();
  delta.totals = fixedCounterDelta(TOTAL_KEYS, after.totals, before.totals);
  for (const mode of GameModeSchema.options) delta.byGameMode[mode] = gameModeDelta(after.byGameMode[mode], before.byGameMode[mode]);
  delta.modeAdoption = fixedCounterDelta(GameModeSchema.options, after.modeAdoption, before.modeAdoption);
  delta.settings = {
    roomVisibility: counterDelta(after.settings.roomVisibility, before.settings.roomVisibility),
    wordCategory: counterDelta(after.settings.wordCategory, before.settings.wordCategory),
    minWordLength: counterDelta(after.settings.minWordLength, before.settings.minWordLength),
    timePerRound: counterDelta(after.settings.timePerRound, before.settings.timePerRound),
    rounds: counterDelta(after.settings.rounds, before.settings.rounds),
    maxPlayers: counterDelta(after.settings.maxPlayers, before.settings.maxPlayers),
    fastestWordTarget: counterDelta(after.settings.fastestWordTarget, before.settings.fastestWordTarget),
    eliminationsPerRound: counterDelta(after.settings.eliminationsPerRound, before.settings.eliminationsPerRound),
    mixScoringMode: counterDelta(after.settings.mixScoringMode, before.settings.mixScoringMode),
    mixModifiers: counterDelta(after.settings.mixModifiers, before.settings.mixModifiers)
  };
  delta.featureUsage = fixedCounterDelta(FeatureUsageEventSchema.options, after.featureUsage, before.featureUsage);
  delta.featureAdoption = fixedCounterDelta(FeatureUsageEventSchema.options, after.featureAdoption, before.featureAdoption);
  delta.engagement = engagementDelta(after.engagement, before.engagement);
  for (const key of HOUR_OF_WEEK_KEYS) {
    const current = after.hourOfWeek[key] ?? createHourOfWeekMetrics();
    const previous = before.hourOfWeek[key] ?? createHourOfWeekMetrics();
    delta.hourOfWeek[key] = {
      sessions: Math.max(0, current.sessions - previous.sessions),
      roomsJoined: Math.max(0, current.roomsJoined - previous.roomsJoined),
      gamesStarted: Math.max(0, current.gamesStarted - previous.gamesStarted),
      participantSlots: Math.max(0, current.participantSlots - previous.participantSlots),
      // Peaks are not additive; live peaks intentionally remain all-time only.
      peakConnectedSockets: 0,
      peakActiveGames: 0
    };
  }
  return delta;
}

function addCumulativeMetrics(target: CumulativeAnalyticsMetrics, delta: CumulativeAnalyticsMetrics): void {
  addFixedCounter(TOTAL_KEYS, target.totals, delta.totals);
  for (const mode of GameModeSchema.options) addGameModeMetrics(target.byGameMode[mode], delta.byGameMode[mode]);
  addFixedCounter(GameModeSchema.options, target.modeAdoption, delta.modeAdoption);
  addCounter(target.settings.roomVisibility, delta.settings.roomVisibility);
  addCounter(target.settings.wordCategory, delta.settings.wordCategory);
  addCounter(target.settings.minWordLength, delta.settings.minWordLength);
  addCounter(target.settings.timePerRound, delta.settings.timePerRound);
  addCounter(target.settings.rounds, delta.settings.rounds);
  addCounter(target.settings.maxPlayers, delta.settings.maxPlayers);
  addCounter(target.settings.fastestWordTarget, delta.settings.fastestWordTarget);
  addCounter(target.settings.eliminationsPerRound, delta.settings.eliminationsPerRound);
  addCounter(target.settings.mixScoringMode, delta.settings.mixScoringMode);
  addCounter(target.settings.mixModifiers, delta.settings.mixModifiers);
  addFixedCounter(FeatureUsageEventSchema.options, target.featureUsage, delta.featureUsage);
  addFixedCounter(FeatureUsageEventSchema.options, target.featureAdoption, delta.featureAdoption);
  addEngagement(target.engagement, delta.engagement);
  for (const key of HOUR_OF_WEEK_KEYS) {
    const targetHour = target.hourOfWeek[key] ?? (target.hourOfWeek[key] = createHourOfWeekMetrics());
    const deltaHour = delta.hourOfWeek[key] ?? createHourOfWeekMetrics();
    targetHour.sessions += deltaHour.sessions;
    targetHour.roomsJoined += deltaHour.roomsJoined;
    targetHour.gamesStarted += deltaHour.gamesStarted;
    targetHour.participantSlots += deltaHour.participantSlots;
  }
}

function dailyMetricsFromCumulative(metrics: CumulativeAnalyticsMetrics, uniqueVisitors: number): DailyMetrics {
  const participantSlots = Object.values(metrics.byGameMode)
    .reduce((total, mode) => total + mode.participantSlots, 0);
  const featureEvents = Object.values(metrics.featureUsage)
    .reduce((total, count) => total + count, 0);
  return {
    uniqueVisitors,
    newVisitors: 0,
    returningVisitors: 0,
    sessions: metrics.totals.visitorSessions,
    roomsCreated: metrics.totals.roomsCreated,
    roomsJoined: metrics.totals.roomsJoined,
    roomsPlayable: metrics.totals.roomsPlayable,
    gamesStarted: metrics.totals.gamesStarted,
    gamesFinished: metrics.totals.gamesFinished,
    gamesAbandoned: metrics.totals.gamesAbandoned,
    roundsCompleted: metrics.totals.roundsCompleted,
    participantSlots,
    playerRounds: metrics.engagement.playerRounds,
    playerDepartures: metrics.engagement.playerDepartures,
    wordsAccepted: metrics.totals.wordsAccepted,
    featureEvents,
    peakConnectedSockets: 0,
    peakActiveGames: 0
  };
}

/**
 * First-party product analytics. Persisted reports contain rich aggregate data,
 * while a private, HMAC-pseudonymous visitor ledger powers exact return/retention
 * calculations. Names, room codes, words, custom lists, scores, IP addresses,
 * user agents, raw socket IDs, and raw client identifiers are never persisted or
 * exposed by report().
 */
export class AggregateAnalyticsStore {
  private data = createData();
  private readonly connectedSocketIds = new Set<string>();
  private readonly socketVisitorKeys = new Map<string, string>();
  private readonly socketSessionKeys = new Map<string, string>();
  private readonly recentlySeenSessions = new Map<string, number>();
  private readonly activeGames = new Map<string, ActiveGame>();
  private persistTimer: NodeJS.Timeout | undefined;
  private pendingWrite = Promise.resolve();
  private dirty = false;
  private pendingMetricDeltas: AnalyticsMetricDelta[] = [];
  private lastMetricSnapshot = captureCumulativeMetrics(this.data);

  public constructor(
    private readonly persistence: AnalyticsPersistence,
    private readonly warn: (message: string, error?: unknown) => void,
    private readonly migrationFilePath?: string
  ) {}

  public async load(): Promise<void> {
    try {
      const stored = await this.persistence.load();
      if (stored !== undefined) {
        this.data = restoreData(stored, Date.now(), this.persistence.kind === 'postgres');
      } else if (this.persistence.kind === 'postgres' && this.migrationFilePath) {
        const legacy = await new FileAnalyticsPersistence(this.migrationFilePath).load();
        if (legacy !== undefined) {
          this.data = restoreData(legacy, Date.now(), true);
          // File storage never retained metric deltas, even for a v3 state.
          // Its prior history is an all-time opening balance, not range-ready data.
          const migratedAt = new Date().toISOString();
          this.data.metricsRecordedFrom = migratedAt;
          this.data.updatedAt = migratedAt;
          this.lastMetricSnapshot = captureCumulativeMetrics(this.data);
          this.dirty = true;
          this.enqueueWrite();
          await this.pendingWrite;
          this.warn('Imported existing file-backed analytics into durable storage.');
        }
      }
      this.lastMetricSnapshot = captureCumulativeMetrics(this.data);
    } catch (error: unknown) {
      this.warn('Could not load product analytics.', error);
      // A durable database must never silently reset into a fresh state.
      if (this.persistence.kind === 'postgres') throw error;
    }
  }

  public recordSocketConnected(socketId: string, identity?: AnalyticsVisitorIdentity): void {
    const now = Date.now();
    this.connectedSocketIds.add(socketId);

    if (identity) {
      const visitorKey = this.pseudonym(`visitor:${identity.visitorId}`);
      const sessionKey = this.pseudonym(`session:${identity.visitorId}:${identity.sessionId}`);
      this.socketVisitorKeys.set(socketId, visitorKey);
      this.socketSessionKeys.set(socketId, sessionKey);
      const profile = this.recordVisitorActivity(visitorKey, now);
      this.queueVisitorActivity(visitorKey, now);

      this.pruneRecentlySeenSessions(now);
      if (!this.recentlySeenSessions.has(sessionKey)) {
        this.recentlySeenSessions.set(sessionKey, now + SESSION_DEDUPLICATION_MS);
        profile.sessions += 1;
        this.data.totals.visitorSessions += 1;
        this.daily(now).sessions += 1;
        this.hour(now).sessions += 1;
      }
    }

    this.recordLivePeaks(now);
    this.touch(now);
  }

  public recordSocketDisconnected(socketId: string): void {
    this.connectedSocketIds.delete(socketId);
    this.socketVisitorKeys.delete(socketId);
    this.socketSessionKeys.delete(socketId);
  }

  public rebindSocket(previousSocketId: string, nextSocketId: string): void {
    this.connectedSocketIds.delete(previousSocketId);
    this.connectedSocketIds.add(nextSocketId);
    this.moveMapEntry(this.socketVisitorKeys, previousSocketId, nextSocketId);
    this.moveMapEntry(this.socketSessionKeys, previousSocketId, nextSocketId);

    for (const game of this.activeGames.values()) {
      if (game.participantSockets.delete(previousSocketId)) game.participantSockets.add(nextSocketId);
      this.moveMapEntry(game.joinedAtBySocket, previousSocketId, nextSocketId);
      this.moveMapEntry(game.visitorBySocket, previousSocketId, nextSocketId);
      this.moveMapEntry(game.roundsBySocket, previousSocketId, nextSocketId);
      if (game.finalizedDepthSockets.delete(previousSocketId)) game.finalizedDepthSockets.add(nextSocketId);
      if (game.recordedDurationSockets.delete(previousSocketId)) game.recordedDurationSockets.add(nextSocketId);
    }
  }

  public recordRoomCreated(settings: GameSettings, socketId?: string): void {
    const now = Date.now();
    this.data.totals.roomsCreated += 1;
    this.data.byGameMode[settings.gameMode].roomsCreated += 1;
    this.daily(now).roomsCreated += 1;
    this.profileForSocket(socketId, now);
    this.touch();
  }

  public recordRoomJoined(socketId?: string): void {
    const now = Date.now();
    this.data.totals.roomsJoined += 1;
    this.daily(now).roomsJoined += 1;
    this.hour(now).roomsJoined += 1;
    const profile = this.profileForSocket(socketId, now);
    if (profile) profile.roomsJoined += 1;
    this.touch();
  }

  public recordRoomBecamePlayable(): void {
    const now = Date.now();
    this.data.totals.roomsPlayable += 1;
    this.daily(now).roomsPlayable += 1;
    this.touch();
  }

  public recordQuickJoin(created: boolean, socketId?: string): void {
    const now = Date.now();
    this.data.totals[created ? 'quickJoinCreated' : 'quickJoinJoined'] += 1;
    this.profileForSocket(socketId, now);
    this.touch();
  }

  public recordSettingsUpdated(socketId?: string): void {
    this.data.totals.settingsUpdated += 1;
    this.profileForSocket(socketId, Date.now());
    this.touch();
  }

  public recordGameStarted(
    roomId: string,
    settings: GameSettings,
    isPublic: boolean,
    playerSocketIds: readonly string[]
  ): void {
    if (this.activeGames.has(roomId)) return;

    const now = Date.now();
    const playerIds = Array.from(new Set(playerSocketIds));
    const visitorBySocket = new Map<string, string>();
    for (const socketId of playerIds) {
      const visitorKey = this.socketVisitorKeys.get(socketId);
      if (visitorKey) visitorBySocket.set(socketId, visitorKey);
    }

    this.activeGames.set(roomId, {
      startedAt: now,
      gameMode: settings.gameMode,
      participantSockets: new Set(playerIds),
      joinedAtBySocket: new Map(playerIds.map((socketId) => [socketId, now])),
      visitorBySocket,
      roundsBySocket: new Map<string, number>(),
      finalizedDepthSockets: new Set<string>(),
      recordedDurationSockets: new Set<string>()
    });
    this.data.totals.gamesStarted += 1;
    this.data.byGameMode[settings.gameMode].gamesStarted += 1;
    this.data.byGameMode[settings.gameMode].participantSlots += playerIds.length;
    this.data.engagement.participantsInStartedGames += playerIds.length;
    this.data.engagement.roomSizeAtGameStart[roomSizeBucket(playerIds.length)] += 1;
    this.data.engagement.roomFillAtGameStart[fillRateBucket(playerIds.length, settings.maxPlayers)] += 1;
    this.daily(now).gamesStarted += 1;
    this.daily(now).participantSlots += playerIds.length;
    this.hour(now).gamesStarted += 1;
    this.hour(now).participantSlots += playerIds.length;
    this.recordSettingsUsed(settings, isPublic);

    for (const visitorKey of new Set(visitorBySocket.values())) {
      const profile = this.recordVisitorActivity(visitorKey, now);
      profile.gamesStarted += 1;
      if (!profile.gameModes.includes(settings.gameMode)) {
        profile.gameModes.push(settings.gameMode);
        this.data.modeAdoption[settings.gameMode] += 1;
      }
    }

    this.recordLivePeaks(now);
    this.touch();
  }

  public recordPlayerJoinedActiveGame(roomId: string, socketId: string): void {
    const game = this.activeGames.get(roomId);
    if (!game || game.joinedAtBySocket.has(socketId)) return;

    const now = Date.now();
    game.joinedAtBySocket.set(socketId, now);
    const visitorKey = this.socketVisitorKeys.get(socketId);
    if (visitorKey) {
      game.visitorBySocket.set(socketId, visitorKey);
      this.profileForVisitorKey(visitorKey, now);
    }
    this.touch();
  }

  public recordRoundStarted(roomId: string, activeSocketIds: readonly string[]): void {
    const game = this.activeGames.get(roomId);
    if (!game) return;

    const now = Date.now();
    const players = Array.from(new Set(activeSocketIds));
    this.data.engagement.playerRounds += players.length;
    this.data.byGameMode[game.gameMode].playerRounds += players.length;
    this.daily(now).playerRounds += players.length;

    for (const socketId of players) {
      game.participantSockets.add(socketId);
      if (!game.joinedAtBySocket.has(socketId)) game.joinedAtBySocket.set(socketId, now);
      const visitorKey = this.socketVisitorKeys.get(socketId);
      if (visitorKey) game.visitorBySocket.set(socketId, visitorKey);
      game.roundsBySocket.set(socketId, (game.roundsBySocket.get(socketId) ?? 0) + 1);
      const profile = this.profileForVisitorKey(game.visitorBySocket.get(socketId), now);
      if (profile) profile.playerRounds += 1;
    }

    this.touch();
  }

  public recordRoundCompleted(_roomId: string): void {
    const now = Date.now();
    this.data.totals.roundsCompleted += 1;
    this.daily(now).roundsCompleted += 1;
    this.touch();
  }

  public recordGameFinished(roomId: string, settings: GameSettings, remainingSocketIds: readonly string[]): void {
    const game = this.activeGames.get(roomId);
    if (!game) return;

    const now = Date.now();
    const remaining = Array.from(new Set(remainingSocketIds));
    const completedParticipants = remaining.filter((socketId) => game.participantSockets.has(socketId) || game.roundsBySocket.has(socketId));
    this.activeGames.delete(roomId);
    this.data.totals.gamesFinished += 1;
    this.data.byGameMode[settings.gameMode].gamesFinished += 1;
    this.data.byGameMode[settings.gameMode].completedParticipantSlots += completedParticipants.length;
    this.data.engagement.participantsInCompletedGames += completedParticipants.length;
    this.daily(now).gamesFinished += 1;
    this.recordGameDuration(game, now, 'completed');

    for (const socketId of completedParticipants) {
      this.recordPlayerGameDuration(game, socketId, now);
      const profile = this.profileForVisitorKey(game.visitorBySocket.get(socketId) ?? this.socketVisitorKeys.get(socketId), now);
      if (profile) profile.gamesFinished += 1;
    }
    this.finalizeGameDepth(game, now);
    this.touch();
  }

  public recordGameAbandoned(roomId: string, settings: GameSettings, remainingSocketIds: readonly string[] = []): void {
    const game = this.activeGames.get(roomId);
    if (!game) return;

    const now = Date.now();
    this.activeGames.delete(roomId);
    this.data.totals.gamesAbandoned += 1;
    this.data.byGameMode[settings.gameMode].gamesAbandoned += 1;
    this.daily(now).gamesAbandoned += 1;
    this.recordGameDuration(game, now, 'abandoned');

    for (const socketId of new Set([...game.participantSockets, ...game.joinedAtBySocket.keys(), ...remainingSocketIds])) {
      this.recordPlayerGameDuration(game, socketId, now);
    }
    for (const visitorKey of new Set(game.visitorBySocket.values())) {
      const profile = this.profileForVisitorKey(visitorKey, now);
      if (profile) profile.gamesAbandoned += 1;
    }
    this.finalizeGameDepth(game, now);
    this.touch();
  }

  public recordPlayerLeft(departure: PlayerDeparture): void {
    const now = Date.now();
    const durationMs = this.safeDuration(departure.durationMs);
    this.data.totals.playerDepartures += 1;
    this.data.engagement.playerDepartures += 1;
    this.data.engagement.departuresByPhase[departure.phase] += 1;
    this.data.engagement.departuresByReason[departure.reason] += 1;
    this.data.engagement.playerPresenceDurationMs += durationMs;
    this.data.engagement.playerPresenceDuration[durationBucket(durationMs)] += 1;
    this.daily(now).playerDepartures += 1;
    this.profileForSocket(departure.socketId, now);

    const game = this.activeGames.get(departure.roomId);
    if (game) {
      this.data.engagement.activeGameDepartures += 1;
      this.data.engagement.activeGameDropoffByRound[exitRoundBucket(departure.currentRound)] += 1;
      this.recordPlayerGameDuration(game, departure.socketId, now);
      this.finalizePlayerDepth(game, departure.socketId, now);
    }

    this.touch();
  }

  public recordGameRestarted(socketId?: string): void {
    this.data.totals.gamesRestarted += 1;
    this.profileForSocket(socketId, Date.now());
    this.touch();
  }

  public recordWordAccepted(socketId?: string): void {
    const now = Date.now();
    this.data.totals.wordsAccepted += 1;
    this.daily(now).wordsAccepted += 1;
    const profile = this.profileForSocket(socketId, now);
    if (profile) profile.wordsAccepted += 1;
    this.touch();
  }

  public recordTeamChanged(socketId?: string): void {
    this.data.totals.teamChanges += 1;
    this.profileForSocket(socketId, Date.now());
    this.touch();
  }

  public recordBetPlaced(socketId?: string): void {
    this.data.totals.betsPlaced += 1;
    this.profileForSocket(socketId, Date.now());
    this.touch();
  }

  public recordEmoteSent(socketId?: string): void {
    this.data.totals.emotesSent += 1;
    this.profileForSocket(socketId, Date.now());
    this.touch();
  }

  public recordFeatureUsage(event: FeatureUsageEvent, socketId?: string): void {
    const now = Date.now();
    this.data.featureUsage[event] += 1;
    this.daily(now).featureEvents += 1;
    const profile = this.profileForSocket(socketId, now);
    if (profile) {
      profile.featureEvents += 1;
      if (!profile.featuresUsed.includes(event)) {
        profile.featuresUsed.push(event);
        this.data.featureAdoption[event] += 1;
      }
    }
    this.touch();
  }

  public publicStats(): PublicGameStats {
    return {
      activePlayers: this.connectedSocketIds.size,
      activeGames: this.activeGames.size,
      wordsFound: this.data.totals.wordsAccepted
    };
  }

  public async report(window?: AnalyticsReportWindow): Promise<AggregateAnalyticsReport> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const today = utcDay(now);
    const isAllTime = !window;
    const firstDaily = Object.keys(this.data.daily).sort()[0] ?? today;
    const from = window?.from ?? `${firstDaily}T00:00:00.000Z`;
    const to = window?.to ?? nowIso;
    const fromTimestamp = Date.parse(from);
    const toTimestamp = Date.parse(to);
    const metricsRecordedFromTimestamp = Date.parse(this.data.metricsRecordedFrom);
    const exactMetricsAvailable = isAllTime || (
      this.persistence.supportsMetricWindows
      && fromTimestamp >= metricsRecordedFromTimestamp
    );

    let metrics = captureCumulativeMetrics(this.data);
    const windowVisitorKeys = new Set<string>();
    const windowDayMetrics = new Map<string, { metrics: CumulativeAnalyticsMetrics; visitorKeys: Set<string> }>();
    if (!isAllTime) {
      metrics = createCumulativeMetrics();
      if (this.persistence.supportsMetricWindows && toTimestamp > metricsRecordedFromTimestamp) {
        const queryFrom = new Date(Math.max(fromTimestamp, metricsRecordedFromTimestamp)).toISOString();
        const persisted = await this.persistence.readMetricDeltas(queryFrom, to);
        const deltas = new Map<string, AnalyticsMetricDelta>();
        for (const delta of persisted) deltas.set(delta.id, delta);
        for (const delta of this.pendingMetricDeltas) {
          if (delta.occurredAt >= queryFrom && delta.occurredAt < to) deltas.set(delta.id, delta);
        }
        for (const delta of deltas.values()) {
          const payload = restoreLedgerPayload(delta.payload);
          addCumulativeMetrics(metrics, payload.metrics);
          const day = utcDay(Date.parse(delta.occurredAt));
          const dayMetrics = windowDayMetrics.get(day) ?? {
            metrics: createCumulativeMetrics(),
            visitorKeys: new Set<string>()
          };
          addCumulativeMetrics(dayMetrics.metrics, payload.metrics);
          for (const visitorKey of payload.visitorKeys) {
            windowVisitorKeys.add(visitorKey);
            dayMetrics.visitorKeys.add(visitorKey);
          }
          windowDayMetrics.set(day, dayMetrics);
        }
      }
    }

    const fromDay = utcDay(fromTimestamp);
    const toDay = utcDay(Math.max(fromTimestamp, toTimestamp - 1));
    const audienceWindow = isAllTime
      ? undefined
      : exactMetricsAvailable
        ? { fromDay, toDay, visitorKeys: windowVisitorKeys, metrics }
        : { fromDay, toDay };
    const audience = this.audienceForWindow(audienceWindow);
    const scopedDaily = Array.from(windowDayMetrics.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, entry]) => ({
        date,
        ...dailyMetricsFromCumulative(entry.metrics, entry.visitorKeys.size)
      }));

    return {
      version: PERSISTENCE_VERSION,
      updatedAt: this.data.updatedAt,
      window: {
        from,
        to,
        isAllTime,
        exactMetricsAvailable,
        metricsRecordedFrom: this.data.metricsRecordedFrom
      },
      totals: metrics.totals,
      byGameMode: metrics.byGameMode,
      modeAdoption: metrics.modeAdoption,
      settings: metrics.settings,
      featureUsage: metrics.featureUsage,
      featureAdoption: metrics.featureAdoption,
      engagement: metrics.engagement,
      audience,
      trends: {
        daily: isAllTime
          ? this.dailyTrend()
          : exactMetricsAvailable
            ? scopedDaily
            : this.dailyTrend({ fromDay, toDay }),
        hourOfWeek: HOUR_OF_WEEK_KEYS.map((key) => {
          const [weekday, hour] = key.split('-').map(Number);
          return {
            weekday: weekday ?? 0,
            hour: hour ?? 0,
            ...structuredClone(metrics.hourOfWeek[key] ?? createHourOfWeekMetrics())
          };
        })
      },
      live: {
        connectedSockets: this.connectedSocketIds.size,
        activeGames: this.activeGames.size
      }
    };
  }

  public async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }

    if (this.dirty) this.enqueueWrite();
    await this.pendingWrite;
  }

  public async close(): Promise<void> {
    await this.flush();
    await this.persistence.close();
  }

  private dailyTrend(window?: { fromDay: string; toDay: string }): AggregateAnalyticsReport['trends']['daily'] {
    return Object.entries(this.data.daily)
      .filter(([day]) => !window || (day >= window.fromDay && day <= window.toDay))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, metrics]) => ({ date, ...structuredClone(metrics) }));
  }

  private audienceForWindow(window?: {
    fromDay: string;
    toDay: string;
    visitorKeys?: ReadonlySet<string>;
    metrics?: CumulativeAnalyticsMetrics;
  }): AggregateAnalyticsReport['audience'] {
    const today = window?.toDay ?? utcDay(Date.now());
    if (!window) {
      return {
        knownVisitors: Object.keys(this.data.visitors).length,
        activeToday: this.activeVisitorCount(today, today),
        active7d: this.activeVisitorCount(shiftDay(today, -6), today),
        active30d: this.activeVisitorCount(shiftDay(today, -29), today),
        newToday: this.data.daily[today]?.newVisitors ?? 0,
        returningToday: this.data.daily[today]?.returningVisitors ?? 0,
        sessionsToday: this.data.daily[today]?.sessions ?? 0,
        retention: {
          day1: this.retention(1, today),
          day7: this.retention(7, today),
          day30: this.retention(30, today)
        }
      };
    }

    if (window.visitorKeys && window.metrics) {
      const knownVisitors = window.visitorKeys.size;
      return {
        // These audience counters are scoped to the exact selected range. Full
        // UTC-day cohorts are deliberately not mixed into a time-of-day report.
        knownVisitors,
        activeToday: knownVisitors,
        active7d: knownVisitors,
        active30d: knownVisitors,
        newToday: 0,
        returningToday: 0,
        sessionsToday: window.metrics.totals.visitorSessions,
        retention: {
          day1: { eligible: 0, returned: 0, rate: 0 },
          day7: { eligible: 0, returned: 0, rate: 0 },
          day30: { eligible: 0, returned: 0, rate: 0 }
        }
      };
    }

    const selectedDaily = this.dailyTrend(window);
    const knownVisitors = Object.values(this.data.visitors)
      .filter((profile) => profile.activeDays.some((day) => day >= window.fromDay && day <= window.toDay))
      .length;
    return {
      knownVisitors,
      activeToday: this.activeVisitorCount(today, today),
      active7d: this.activeVisitorCount(shiftDay(today, -6), today),
      active30d: this.activeVisitorCount(shiftDay(today, -29), today),
      newToday: selectedDaily.reduce((total, point) => total + point.newVisitors, 0),
      returningToday: selectedDaily.reduce((total, point) => total + point.returningVisitors, 0),
      sessionsToday: selectedDaily.reduce((total, point) => total + point.sessions, 0),
      retention: {
        day1: this.retention(1, today, window.fromDay),
        day7: this.retention(7, today, window.fromDay),
        day30: this.retention(30, today, window.fromDay)
      }
    };
  }

  private pseudonym(value: string): string {
    return createHmac('sha256', this.data.identitySalt).update(value).digest('base64url');
  }

  private moveMapEntry<T>(map: Map<string, T>, previousKey: string, nextKey: string): void {
    const value = map.get(previousKey);
    if (value === undefined) return;
    map.delete(previousKey);
    map.set(nextKey, value);
  }

  private daily(now: number): DailyMetrics {
    const day = utcDay(now);
    const existing = this.data.daily[day];
    if (existing) return existing;
    const created = createDailyMetrics();
    this.data.daily[day] = created;
    return created;
  }

  private hour(now: number): HourOfWeekMetrics {
    const date = new Date(now);
    const key = `${date.getUTCDay()}-${date.getUTCHours()}`;
    const existing = this.data.hourOfWeek[key];
    if (existing) return existing;
    const created = createHourOfWeekMetrics();
    this.data.hourOfWeek[key] = created;
    return created;
  }

  private recordLivePeaks(now: number): void {
    const daily = this.daily(now);
    const hourly = this.hour(now);
    daily.peakConnectedSockets = Math.max(daily.peakConnectedSockets, this.connectedSocketIds.size);
    daily.peakActiveGames = Math.max(daily.peakActiveGames, this.activeGames.size);
    hourly.peakConnectedSockets = Math.max(hourly.peakConnectedSockets, this.connectedSocketIds.size);
    hourly.peakActiveGames = Math.max(hourly.peakActiveGames, this.activeGames.size);
  }

  private recordVisitorActivity(visitorKey: string, now: number): VisitorProfile {
    const day = utcDay(now);
    let profile = this.data.visitors[visitorKey];
    if (!profile) {
      profile = {
        firstSeenDay: day,
        lastSeenDay: day,
        activeDays: [],
        sessions: 0,
        roomsJoined: 0,
        gamesStarted: 0,
        gamesFinished: 0,
        gamesAbandoned: 0,
        playerRounds: 0,
        wordsAccepted: 0,
        featureEvents: 0,
        gameModes: [],
        featuresUsed: []
      };
      this.data.visitors[visitorKey] = profile;
    }

    if (!profile.activeDays.includes(day)) {
      const hasPriorActivity = profile.activeDays.length > 0;
      profile.activeDays.push(day);
      profile.activeDays.sort();
      const daily = this.daily(now);
      daily.uniqueVisitors += 1;
      if (hasPriorActivity) daily.returningVisitors += 1;
      else daily.newVisitors += 1;
    }
    profile.lastSeenDay = day;
    return profile;
  }

  private profileForSocket(socketId: string | undefined, now: number): VisitorProfile | undefined {
    if (!socketId) return undefined;
    return this.profileForVisitorKey(this.socketVisitorKeys.get(socketId), now);
  }

  private profileForVisitorKey(visitorKey: string | undefined, now: number): VisitorProfile | undefined {
    if (!visitorKey) return undefined;
    return this.recordVisitorActivity(visitorKey, now);
  }

  private recordSettingsUsed(settings: GameSettings, isPublic: boolean): void {
    this.incrementCounter(this.data.settings.roomVisibility, isPublic ? 'public' : 'private');
    this.incrementCounter(this.data.settings.minWordLength, String(settings.minWordLength));
    this.incrementCounter(this.data.settings.timePerRound, String(settings.timePerRound));
    this.incrementCounter(this.data.settings.rounds, String(settings.rounds));
    this.incrementCounter(this.data.settings.maxPlayers, String(settings.maxPlayers));

    if (settings.gameMode === 'category') {
      this.incrementCounter(this.data.settings.wordCategory, settings.wordCategory);
    }

    const usesWordSprint = settings.gameMode === 'fastestNWords'
      || (settings.gameMode === 'mix' && settings.mixModifiers.wordSprint);
    if (usesWordSprint) this.incrementCounter(this.data.settings.fastestWordTarget, String(settings.fastestWordTarget));

    if (settings.gameMode === 'battleRoyale') {
      this.incrementCounter(this.data.settings.eliminationsPerRound, String(settings.eliminationsPerRound));
    }

    if (settings.gameMode === 'mix') {
      this.incrementCounter(this.data.settings.mixScoringMode, settings.mixScoringMode);
      for (const modifier of MIX_MODIFIER_KEYS) {
        if (settings.mixModifiers[modifier]) this.incrementCounter(this.data.settings.mixModifiers, modifier);
      }
    }
  }

  private recordGameDuration(game: ActiveGame, now: number, outcome: 'completed' | 'abandoned'): void {
    const duration = this.safeDuration(now - game.startedAt);
    this.data.engagement.gameDurationMs[outcome] += duration;
    this.data.engagement.gameDuration[durationBucket(duration)] += 1;
  }

  private recordPlayerGameDuration(game: ActiveGame, socketId: string, now: number): void {
    if (game.recordedDurationSockets.has(socketId)) return;
    game.recordedDurationSockets.add(socketId);
    const duration = this.safeDuration(now - (game.joinedAtBySocket.get(socketId) ?? game.startedAt));
    this.data.engagement.playerGameDurationMs += duration;
    this.data.engagement.playerGameDuration[durationBucket(duration)] += 1;
  }

  private finalizePlayerDepth(game: ActiveGame, socketId: string, now: number): void {
    if (game.finalizedDepthSockets.has(socketId)) return;
    game.finalizedDepthSockets.add(socketId);
    this.data.engagement.playerRoundDepth[roundDepthBucket(game.roundsBySocket.get(socketId) ?? 0)] += 1;
    this.profileForVisitorKey(game.visitorBySocket.get(socketId), now);
  }

  private finalizeGameDepth(game: ActiveGame, now: number): void {
    for (const socketId of new Set([...game.participantSockets, ...game.joinedAtBySocket.keys(), ...game.roundsBySocket.keys()])) {
      this.finalizePlayerDepth(game, socketId, now);
    }
  }

  private activeVisitorCount(cutoffDay: string, endDay: string): number {
    return Object.values(this.data.visitors)
      .filter((profile) => profile.activeDays.some((day) => day >= cutoffDay && day <= endDay))
      .length;
  }

  private retention(offsetDays: number, today: string, earliestFirstSeen?: string): RetentionMetric {
    const eligibleLatestFirstSeen = shiftDay(today, -offsetDays);
    let eligible = 0;
    let returned = 0;

    for (const profile of Object.values(this.data.visitors)) {
      if ((earliestFirstSeen && profile.firstSeenDay < earliestFirstSeen) || profile.firstSeenDay > eligibleLatestFirstSeen) continue;
      eligible += 1;
      if (profile.activeDays.includes(shiftDay(profile.firstSeenDay, offsetDays))) returned += 1;
    }

    return {
      eligible,
      returned,
      rate: eligible === 0 ? 0 : returned / eligible
    };
  }

  private pruneRecentlySeenSessions(now: number): void {
    for (const [sessionKey, expiresAt] of this.recentlySeenSessions) {
      if (expiresAt <= now) this.recentlySeenSessions.delete(sessionKey);
    }
    while (this.recentlySeenSessions.size > MAX_RECENT_SESSIONS) {
      const oldestSession = this.recentlySeenSessions.keys().next().value;
      if (!oldestSession) break;
      this.recentlySeenSessions.delete(oldestSession);
    }
  }

  private incrementCounter(counter: CounterMap, key: string): void {
    counter[key] = (counter[key] ?? 0) + 1;
  }

  private safeDuration(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  private queueVisitorActivity(visitorKey: string, now: number): void {
    this.pendingMetricDeltas.push({
      id: randomUUID(),
      occurredAt: new Date(now).toISOString(),
      payload: { visitorKeys: [visitorKey] } satisfies AnalyticsLedgerPayload
    });
  }

  private touch(now = Date.now()): void {
    this.data.updatedAt = new Date(now).toISOString();
    const currentMetrics = captureCumulativeMetrics(this.data);
    if (JSON.stringify(currentMetrics) !== JSON.stringify(this.lastMetricSnapshot)) {
      this.pendingMetricDeltas.push({
        id: randomUUID(),
        occurredAt: this.data.updatedAt,
        payload: { metrics: differenceCumulativeMetrics(currentMetrics, this.lastMetricSnapshot) } satisfies AnalyticsLedgerPayload
      });
      this.lastMetricSnapshot = currentMetrics;
    }
    this.dirty = true;
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.enqueueWrite();
    }, PERSIST_DEBOUNCE_MS);
  }

  private enqueueWrite(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const data = structuredClone(this.data);
    const deltas = [...this.pendingMetricDeltas];
    const persistedDeltaIds = new Set(deltas.map((delta) => delta.id));

    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        await this.persistence.save(data, deltas);
        this.pendingMetricDeltas = this.pendingMetricDeltas.filter((delta) => !persistedDeltaIds.has(delta.id));
      })
      .catch((error: unknown) => {
        this.dirty = true;
        this.warn('Could not persist product analytics.', error);
        this.schedulePersist();
      });
  }
}
