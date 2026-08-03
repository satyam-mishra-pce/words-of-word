import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  FeatureUsageEventSchema,
  GameModeSchema,
  type FeatureUsageEvent,
  type GameMode,
  type GameSettings,
  type MixModifiers
} from '@wow/shared';

const PERSIST_DEBOUNCE_MS = 1_000;
const MIX_MODIFIER_KEYS = [
  'teams',
  'wordSprint',
  'blind',
  'claim',
  'busted',
  'intuition',
  'lightning'
] as const satisfies ReadonlyArray<keyof MixModifiers>;

type CounterMap = Record<string, number>;
type TotalKey =
  | 'roomsCreated'
  | 'roomsJoined'
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
  | 'emotesSent';

type GameModeMetrics = {
  roomsCreated: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
};

type AggregateAnalyticsData = {
  version: 1;
  updatedAt: string;
  totals: Record<TotalKey, number>;
  byGameMode: Record<GameMode, GameModeMetrics>;
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
};

export type AggregateAnalyticsReport = AggregateAnalyticsData & {
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

const TOTAL_KEYS: readonly TotalKey[] = [
  'roomsCreated',
  'roomsJoined',
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
  'emotesSent'
];

function createCounterMap(): CounterMap {
  return {};
}

function createGameModeMetrics(): GameModeMetrics {
  return {
    roomsCreated: 0,
    gamesStarted: 0,
    gamesFinished: 0,
    gamesAbandoned: 0
  };
}

function createData(): AggregateAnalyticsData {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totals: Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0])) as Record<TotalKey, number>,
    byGameMode: Object.fromEntries(GameModeSchema.options.map((mode) => [mode, createGameModeMetrics()])) as Record<GameMode, GameModeMetrics>,
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
    featureUsage: Object.fromEntries(FeatureUsageEventSchema.options.map((event) => [event, 0])) as Record<FeatureUsageEvent, number>
  };
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function restoreCounterMap(value: unknown): CounterMap {
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .filter(([key]) => /^[a-zA-Z0-9_+-]{1,32}$/.test(key))
      .map(([key, count]) => [key, asNonNegativeInteger(count)])
  );
}

function restoreData(value: unknown): AggregateAnalyticsData {
  const stored = asRecord(value);
  const data = createData();
  if (stored.version !== 1) return data;

  data.updatedAt = typeof stored.updatedAt === 'string' ? stored.updatedAt : data.updatedAt;

  const totals = asRecord(stored.totals);
  for (const key of TOTAL_KEYS) data.totals[key] = asNonNegativeInteger(totals[key]);

  const byGameMode = asRecord(stored.byGameMode);
  for (const mode of GameModeSchema.options) {
    const metric = asRecord(byGameMode[mode]);
    data.byGameMode[mode] = {
      roomsCreated: asNonNegativeInteger(metric.roomsCreated),
      gamesStarted: asNonNegativeInteger(metric.gamesStarted),
      gamesFinished: asNonNegativeInteger(metric.gamesFinished),
      gamesAbandoned: asNonNegativeInteger(metric.gamesAbandoned)
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

  return data;
}

/**
 * First-party product counters. The persisted document contains aggregate counts
 * only: no users, devices, IP addresses, names, rooms, words, scores, or event
 * history. Socket/room IDs are held only long enough to display live totals.
 */
export class AggregateAnalyticsStore {
  private data = createData();
  private readonly connectedSocketIds = new Set<string>();
  private readonly activeGameRoomIds = new Set<string>();
  private persistTimer: NodeJS.Timeout | undefined;
  private pendingWrite = Promise.resolve();
  private dirty = false;
  private writeSequence = 0;

  public constructor(
    private readonly filePath: string,
    private readonly warn: (message: string, error?: unknown) => void
  ) {}

  public async load(): Promise<void> {
    try {
      this.data = restoreData(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown);
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined;
      if (code !== 'ENOENT') this.warn('Could not read aggregate analytics; starting with empty counters.', error);
    }
  }

  public recordSocketConnected(socketId: string): void {
    this.connectedSocketIds.add(socketId);
  }

  public recordSocketDisconnected(socketId: string): void {
    this.connectedSocketIds.delete(socketId);
  }

  public rebindSocket(previousSocketId: string, nextSocketId: string): void {
    this.connectedSocketIds.delete(previousSocketId);
    this.connectedSocketIds.add(nextSocketId);
  }

  public recordRoomCreated(settings: GameSettings): void {
    this.incrementTotal('roomsCreated');
    this.data.byGameMode[settings.gameMode].roomsCreated += 1;
  }

  public recordRoomJoined(): void {
    this.incrementTotal('roomsJoined');
  }

  public recordQuickJoin(created: boolean): void {
    this.incrementTotal(created ? 'quickJoinCreated' : 'quickJoinJoined');
  }

  public recordSettingsUpdated(): void {
    this.incrementTotal('settingsUpdated');
  }

  public recordGameStarted(roomId: string, settings: GameSettings, isPublic: boolean): void {
    if (this.activeGameRoomIds.has(roomId)) return;

    this.activeGameRoomIds.add(roomId);
    this.incrementTotal('gamesStarted');
    this.data.byGameMode[settings.gameMode].gamesStarted += 1;
    this.recordSettingsUsed(settings, isPublic);
  }

  public recordGameFinished(roomId: string, settings: GameSettings): void {
    if (!this.activeGameRoomIds.delete(roomId)) return;

    this.incrementTotal('gamesFinished');
    this.data.byGameMode[settings.gameMode].gamesFinished += 1;
  }

  public recordGameAbandoned(roomId: string, settings: GameSettings): void {
    if (!this.activeGameRoomIds.delete(roomId)) return;

    this.incrementTotal('gamesAbandoned');
    this.data.byGameMode[settings.gameMode].gamesAbandoned += 1;
  }

  public recordGameRestarted(): void {
    this.incrementTotal('gamesRestarted');
  }

  public recordRoundCompleted(): void {
    this.incrementTotal('roundsCompleted');
  }

  public recordWordAccepted(): void {
    this.incrementTotal('wordsAccepted');
  }

  public recordTeamChanged(): void {
    this.incrementTotal('teamChanges');
  }

  public recordBetPlaced(): void {
    this.incrementTotal('betsPlaced');
  }

  public recordEmoteSent(): void {
    this.incrementTotal('emotesSent');
  }

  public recordFeatureUsage(event: FeatureUsageEvent): void {
    this.data.featureUsage[event] += 1;
    this.touch();
  }

  public publicStats(): PublicGameStats {
    return {
      activePlayers: this.connectedSocketIds.size,
      activeGames: this.activeGameRoomIds.size,
      wordsFound: this.data.totals.wordsAccepted
    };
  }

  public report(): AggregateAnalyticsReport {
    return {
      ...structuredClone(this.data),
      live: {
        connectedSockets: this.connectedSocketIds.size,
        activeGames: this.activeGameRoomIds.size
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

  private recordSettingsUsed(settings: GameSettings, isPublic: boolean): void {
    // Explicitly select bounded, gameplay-relevant fields. customWordList and
    // all player-provided text are deliberately absent from this report.
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

  private incrementTotal(key: TotalKey): void {
    this.data.totals[key] += 1;
    this.touch();
  }

  private incrementCounter(counter: CounterMap, key: string): void {
    counter[key] = (counter[key] ?? 0) + 1;
    this.touch();
  }

  private touch(): void {
    this.data.updatedAt = new Date().toISOString();
    this.dirty = true;
    if (this.persistTimer) return;

    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.enqueueWrite();
    }, PERSIST_DEBOUNCE_MS);
  }

  private enqueueWrite(): void {
    if (!this.dirty) return;
    this.dirty = false;

    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const directory = dirname(this.filePath);
        const temporaryFile = `${this.filePath}.${process.pid}.${Date.now()}.${++this.writeSequence}.tmp`;
        const contents = `${JSON.stringify(this.data, null, 2)}\n`;
        await mkdir(directory, { recursive: true });
        await writeFile(temporaryFile, contents, 'utf8');
        await rename(temporaryFile, this.filePath);
      })
      .catch((error: unknown) => {
        this.dirty = true;
        this.warn('Could not persist aggregate analytics.', error);
        this.touch();
      });
  }
}
