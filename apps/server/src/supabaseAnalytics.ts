import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type FeatureUsageEvent,
  type GameMode,
  type GameSettings,
  type MixModifiers,
  type RoomPhase
} from '@wow/shared';

/**
 * Words of Word — product analytics, event-sourced into Supabase.
 *
 * Every tracked behaviour is one row in public.analytics_event. The game server
 * is the author of game lifecycle events (rooms, games, words, emotes, bets,
 * teams, departures, feature usage); the web/native client authors page/UI/click
 * events directly. Aggregation happens on demand over a [from, to) window via
 * the SQL RPC functions defined in supabase/migrations/..._analytics_events.sql,
 * so ANY metric can be filtered by any time duration.
 *
 * This replaces the old aggregate JSON/delta persistence entirely. The store
 * keeps only lightweight in-memory state (connected sockets, live games, and the
 * per-socket visitor mapping needed to attribute events) and flushes event rows
 * to Supabase in batches with the service-role client.
 *
 * Live counters (public stats / "x playing · y rooms live") stay in memory so
 * they never depend on query latency; everything historical reads from Supabase.
 */

export type AnalyticsVisitorIdentity = {
  visitorId: string;
  sessionId: string;
};

export type AnalyticsReportWindow = {
  /** UTC ISO timestamp, inclusive. */
  from: string;
  /** UTC ISO timestamp, exclusive. */
  to: string;
};

export type DepartureReason = 'leave' | 'switch' | 'disconnect';

export type PlayerDeparture = {
  roomId: string;
  socketId: string;
  phase: RoomPhase;
  currentRound: number;
  durationMs: number;
  reason: DepartureReason;
};

export type PublicGameStats = {
  activePlayers: number;
  activeGames: number;
  wordsFound: number;
};

const BATCH_FLUSH_MS = 1_000;
const MAX_PENDING = 500;
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
const DEPARTURE_REASONS = ['leave', 'switch', 'disconnect'] as const satisfies readonly DepartureReason[];
const DEPARTURE_PHASES = ['lobby', 'betting', 'round', 'betweenRounds', 'gameOver'] as const satisfies readonly RoomPhase[];

type ActiveGame = {
  startedAt: number;
  gameMode: GameMode;
  participantSocketIds: Set<string>;
  joinedAtBySocket: Map<string, number>;
  visitorBySocket: Map<string, string>;
  roundsBySocket: Map<string, number>;
  recordedDurationSockets: Set<string>;
};

type PendingEvent = {
  event: string;
  kind: string;
  visitor_id: string | null;
  session_id: string | null;
  page: string | null;
  props: Record<string, unknown>;
  source: 'server';
};

function roomSizeBucket(playerCount: number): string {
  if (playerCount <= 1) return '1';
  if (playerCount === 2) return '2';
  if (playerCount <= 4) return '3_4';
  if (playerCount <= 6) return '5_6';
  if (playerCount <= 10) return '7_10';
  return '11_plus';
}

function fillRateBucket(playerCount: number, maxPlayers: number): string {
  const fill = maxPlayers > 0 ? playerCount / maxPlayers : 0;
  if (fill < 0.5) return 'under_50';
  if (fill < 0.75) return '50_74';
  if (fill < 1) return '75_99';
  return 'full';
}

function durationBucket(durationMs: number): string {
  if (durationMs < 60_000) return 'under_1m';
  if (durationMs < 3 * 60_000) return '1_3m';
  if (durationMs < 7 * 60_000) return '3_7m';
  if (durationMs < 15 * 60_000) return '7_15m';
  return '15m_plus';
}

function roundDepthBucket(rounds: number): string {
  if (rounds <= 0) return '0';
  if (rounds === 1) return '1';
  if (rounds <= 3) return '2_3';
  if (rounds <= 5) return '4_5';
  return '6_plus';
}

function exitRoundBucket(round: number): string {
  if (round <= 0) return 'before_r1';
  if (round === 1) return 'r1';
  if (round <= 3) return 'r2_3';
  if (round <= 5) return 'r4_5';
  return 'r6_plus';
}

function mixModifierList(modifiers: MixModifiers): string[] {
  return MIX_MODIFIER_KEYS.filter((modifier) => modifiers[modifier]);
}

function settingsProps(settings: GameSettings, isPublic: boolean): Record<string, unknown> {
  return {
    mode: settings.gameMode,
    isPublic,
    visibility: isPublic ? 'public' : 'private',
    minWordLength: settings.minWordLength,
    timePerRound: settings.timePerRound,
    rounds: settings.rounds,
    maxPlayers: settings.maxPlayers,
    fastestWordTarget: settings.fastestWordTarget,
    eliminationsPerRound: settings.eliminationsPerRound,
    wordCategory: settings.gameMode === 'category' ? settings.wordCategory : undefined,
    mixScoringMode: settings.gameMode === 'mix' ? settings.mixScoringMode : undefined,
    mixModifiers: settings.gameMode === 'mix' ? mixModifierList(settings.mixModifiers) : undefined,
    hasCustomList: Boolean(settings.customWordList)
  };
}

export interface SupabaseAnalyticsReport {
  version: number;
  updatedAt: string;
  window: { from: string; to: string; isAllTime: boolean };
  headline: {
    events: number;
    uniqueVisitors: number;
    uniqueSessions: number;
    signedInEvents: number;
    uniqueUsers: number;
    firstEvent: string | null;
    lastEvent: string | null;
    byKind: Record<string, number>;
  };
  totals: Record<string, number>;
  byEvent: Array<{ event: string; count: number }>;
  trends: {
    daily: Array<{ day: string; counts: Record<string, number> }>;
    hourOfWeek: Array<{ weekday: number; hour: number; count: number }>;
  };
  breakdowns: Record<string, Array<{ value: string; count: number }>>;
  audience: {
    uniqueVisitors: number;
    uniqueSessions: number;
    uniqueUsers: number;
    signedInEvents: number;
  };
  topEmoters: Array<{ visitorId: string; count: number }>;
  activeUsers: Array<{ userId: string; username: string | null; eventCount: number; lastTs: string | null }>;
  live: { connectedSockets: number; activeGames: number };
}

type GroupedRow = { value: string; count: number };

/**
 * Server-authoritative, Supabase-backed analytics store. Write path is
 * batched + idempotent; read path queries the SQL aggregates over a window.
 */
export class SupabaseAnalyticsStore {
  private readonly connectedSocketIds = new Set<string>();
  private readonly socketIdentity = new Map<string, { visitorId: string; sessionId: string }>();
  private readonly activeGames = new Map<string, ActiveGame>();
  private pending: PendingEvent[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private flushChain: Promise<void> = Promise.resolve();
  private wordsFound = 0;

  public constructor(
    private readonly admin: SupabaseClient | null,
    private readonly warn: (message: string, error?: unknown) => void
  ) {}

  public async load(): Promise<void> {
    // No persisted snapshot to hydrate: all historical data lives in Supabase.
    return;
  }

  // -- live -----------------------------------------------------------------

  public recordSocketConnected(socketId: string, identity?: AnalyticsVisitorIdentity): void {
    this.connectedSocketIds.add(socketId);
    if (!identity) return;
    this.socketIdentity.set(socketId, { visitorId: identity.visitorId, sessionId: identity.sessionId });
    this.emit('socket_connected', 'session', identity.visitorId, identity.sessionId, {});
  }

  public recordSocketDisconnected(socketId: string): void {
    this.connectedSocketIds.delete(socketId);
    this.socketIdentity.delete(socketId);
    this.emit('socket_disconnected', 'session', null, null, {});
  }

  public rebindSocket(previousSocketId: string, nextSocketId: string): void {
    this.connectedSocketIds.delete(previousSocketId);
    this.connectedSocketIds.add(nextSocketId);
    const identity = this.socketIdentity.get(previousSocketId);
    if (identity) {
      this.socketIdentity.delete(previousSocketId);
      this.socketIdentity.set(nextSocketId, identity);
    }
    for (const game of this.activeGames.values()) {
      this.moveMapEntry(game.joinedAtBySocket, previousSocketId, nextSocketId);
      this.moveMapEntry(game.visitorBySocket, previousSocketId, nextSocketId);
      this.moveMapEntry(game.roundsBySocket, previousSocketId, nextSocketId);
      if (game.participantSocketIds.delete(previousSocketId)) game.participantSocketIds.add(nextSocketId);
    }
  }

  // -- rooms ----------------------------------------------------------------

  public recordRoomCreated(settings: GameSettings, socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('room_created', 'room', identity?.visitorId ?? null, identity?.sessionId ?? null, settingsProps(settings, false));
  }

  public recordRoomJoined(socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('room_joined', 'room', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  public recordRoomBecamePlayable(): void {
    this.emit('room_playable', 'room', null, null, {});
  }

  public recordQuickJoin(created: boolean, socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit(created ? 'quick_join_created' : 'quick_join_joined', 'room', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  public recordSettingsUpdated(socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('settings_updated', 'room', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  // -- games ----------------------------------------------------------------

  public recordGameStarted(roomId: string, settings: GameSettings, isPublic: boolean, playerSocketIds: readonly string[]): void {
    if (this.activeGames.has(roomId)) return;

    const now = Date.now();
    const playerIds = Array.from(new Set(playerSocketIds));
    const visitorBySocket = new Map<string, string>();
    for (const socketId of playerIds) {
      const visitorId = this.socketIdentity.get(socketId)?.visitorId;
      if (visitorId) visitorBySocket.set(socketId, visitorId);
    }

    this.activeGames.set(roomId, {
      startedAt: now,
      gameMode: settings.gameMode,
      participantSocketIds: new Set(playerIds),
      joinedAtBySocket: new Map(playerIds.map((socketId) => [socketId, now])),
      visitorBySocket,
      roundsBySocket: new Map<string, number>(),
      recordedDurationSockets: new Set<string>()
    });

    this.emit('game_started', 'game', null, null, {
      ...settingsProps(settings, isPublic),
      playerCount: playerIds.length,
      roomSizeBucket: roomSizeBucket(playerIds.length),
      fillRateBucket: fillRateBucket(playerIds.length, settings.maxPlayers)
    });
  }

  public recordPlayerJoinedActiveGame(roomId: string, socketId: string): void {
    const game = this.activeGames.get(roomId);
    if (!game || game.joinedAtBySocket.has(socketId)) return;
    const now = Date.now();
    game.joinedAtBySocket.set(socketId, now);
    const visitorId = this.socketIdentity.get(socketId)?.visitorId;
    if (visitorId) game.visitorBySocket.set(socketId, visitorId);
  }

  public recordRoundStarted(roomId: string, activeSocketIds: readonly string[]): void {
    const game = this.activeGames.get(roomId);
    const players = Array.from(new Set(activeSocketIds));
    const now = Date.now();
    if (game) {
      for (const socketId of players) {
        game.participantSocketIds.add(socketId);
        if (!game.joinedAtBySocket.has(socketId)) game.joinedAtBySocket.set(socketId, now);
        const visitorId = this.socketIdentity.get(socketId)?.visitorId;
        if (visitorId) game.visitorBySocket.set(socketId, visitorId);
        game.roundsBySocket.set(socketId, (game.roundsBySocket.get(socketId) ?? 0) + 1);
      }
    }
    this.emit('round_started', 'game', null, null, { playerCount: players.length });
  }

  public recordRoundCompleted(_roomId: string): void {
    this.emit('round_completed', 'game', null, null, {});
  }

  public recordGameFinished(roomId: string, settings: GameSettings, remainingSocketIds: readonly string[]): void {
    const game = this.activeGames.get(roomId);
    if (!game) return;

    const now = Date.now();
    const remaining = Array.from(new Set(remainingSocketIds));
    const completedParticipants = remaining.filter(
      (socketId) => game.participantSocketIds.has(socketId) || game.roundsBySocket.has(socketId)
    );
    const durationMs = this.safeDuration(now - game.startedAt);
    this.activeGames.delete(roomId);

    this.emit('game_finished', 'game', null, null, {
      mode: settings.gameMode,
      playerCount: game.participantSocketIds.size,
      completedParticipants: completedParticipants.length,
      durationMs,
      durationBucket: durationBucket(durationMs)
    });
  }

  public recordGameAbandoned(roomId: string, settings: GameSettings, remainingSocketIds: readonly string[] = []): void {
    const game = this.activeGames.get(roomId);
    if (!game) return;

    const now = Date.now();
    const durationMs = this.safeDuration(now - game.startedAt);
    this.activeGames.delete(roomId);
    this.emit('game_abandoned', 'game', null, null, {
      mode: settings.gameMode,
      durationMs,
      durationBucket: durationBucket(durationMs),
      remainingPlayers: new Set([...game.participantSocketIds, ...remainingSocketIds]).size
    });
  }

  public recordPlayerLeft(departure: PlayerDeparture): void {
    const identity = this.identityFor(departure.socketId);
    const game = this.activeGames.get(departure.roomId);
    const durationMs = this.safeDuration(departure.durationMs);
    const currentRound = game?.roundsBySocket.get(departure.socketId) ?? departure.currentRound;
    this.emit('player_left', 'game', identity?.visitorId ?? null, identity?.sessionId ?? null, {
      phase: departure.phase,
      reason: departure.reason,
      durationMs,
      presenceDurationBucket: durationBucket(durationMs),
      currentRound,
      roundDepthBucket: roundDepthBucket(currentRound),
      exitRoundBucket: game ? exitRoundBucket(currentRound) : undefined,
      inActiveGame: Boolean(game)
    });
  }

  public recordGameRestarted(socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('game_restarted', 'game', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  // -- in-game actions ------------------------------------------------------

  public recordWordAccepted(socketId?: string): void {
    this.wordsFound += 1;
    const identity = this.identityFor(socketId);
    this.emit('word_accepted', 'game', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  public recordTeamChanged(socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('team_changed', 'game', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  public recordBetPlaced(socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('bet_placed', 'game', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  public recordEmoteSent(socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('emote_sent', 'game', identity?.visitorId ?? null, identity?.sessionId ?? null, {});
  }

  public recordFeatureUsage(event: FeatureUsageEvent, socketId?: string): void {
    const identity = this.identityFor(socketId);
    this.emit('feature_usage', 'feature', identity?.visitorId ?? null, identity?.sessionId ?? null, { event });
  }

  // -- reads ----------------------------------------------------------------

  public publicStats(): PublicGameStats {
    return {
      activePlayers: this.connectedSocketIds.size,
      activeGames: this.activeGames.size,
      wordsFound: this.wordsFound
    };
  }

  public async report(window?: AnalyticsReportWindow): Promise<SupabaseAnalyticsReport> {
    const now = new Date().toISOString();
    const isAllTime = !window;
    const from = window?.from ?? '2000-01-01T00:00:00.000Z';
    const to = window?.to ?? now;

    if (!this.admin) {
      return this.emptyReport(from, to, isAllTime);
    }

    const safe = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

    try {
      const [headline, counts, daily, hourOfWeek, topEmoters, activeUsers] = await Promise.all([
        this.call<{ data: unknown }>('analytics_headline', { p_from: from, p_to: to }),
        this.call<Array<{ event: string; count: number }>>('analytics_event_counts', { p_from: from, p_to: to }),
        this.call<Array<{ day: string; event: string; count: number }>>('analytics_daily_counts', { p_from: from, p_to: to }),
        this.call<Array<{ weekday: number; hour: number; count: number }>>('analytics_hour_of_week', { p_from: from, p_to: to, p_event: null }),
        this.call<Array<{ visitor_id: string; count: number }>>('analytics_top_visitors', { p_from: from, p_to: to, p_event: 'emote_sent', p_limit: 50 }),
        this.call<Array<{ user_id: string; event_count: number; last_ts: string | null; username: string | null }>>(
          'analytics_active_users',
          { p_from: from, p_to: to }
        )
      ]);

      const h = (headline?.data ?? {}) as Record<string, unknown>;
      const totals: Record<string, number> = {};
      for (const row of counts ?? []) totals[row.event] = safe(row.count);

      // Per-day structure from daily rows.
      const dailyMap = new Map<string, Record<string, number>>();
      for (const row of daily ?? []) {
        const bucket = dailyMap.get(row.day) ?? {};
        bucket[row.event] = (bucket[row.event] ?? 0) + safe(row.count);
        dailyMap.set(row.day, bucket);
      }

      const breakdownGroups: Array<[string, string, string | undefined]> = [
        ['gameModes', 'game_started', 'mode'],
        ['pages', 'page_view', 'path'],
        ['minWordLength', 'game_started', 'minWordLength'],
        ['timePerRound', 'game_started', 'timePerRound'],
        ['rounds', 'game_started', 'rounds'],
        ['maxPlayers', 'game_started', 'maxPlayers'],
        ['wordCategory', 'game_started', 'wordCategory'],
        ['fastestWordTarget', 'game_started', 'fastestWordTarget'],
        ['eliminationsPerRound', 'game_started', 'eliminationsPerRound'],
        ['mixModifiers', 'game_started', 'mixModifiers'],
        ['visibility', 'game_started', 'visibility'],
        ['roomSize', 'game_started', 'roomSizeBucket'],
        ['fillRate', 'game_started', 'fillRateBucket'],
        ['gameDuration', 'game_finished', 'durationBucket'],
        ['departurePhase', 'player_left', 'phase'],
        ['departureReason', 'player_left', 'reason']
      ];

      const breakdownResults = await Promise.all(
        breakdownGroups.map(([, event, prop]) =>
          event && prop ? this.call<Array<GroupedRow>>('analytics_grouped', { p_from: from, p_to: to, p_event: event, p_prop: prop }) : Promise.resolve(null)
        )
      );

      const breakdowns: Record<string, Array<{ value: string; count: number }>> = {};
      breakdownGroups.forEach(([key], index) => {
        breakdowns[key] = (breakdownResults[index] ?? []).map((row) => ({
          value: String(row.value),
          count: safe(row.count)
        }));
      });

      return {
        version: 2,
        updatedAt: now,
        window: { from, to, isAllTime },
        headline: {
          events: safe(h.events),
          uniqueVisitors: safe(h.unique_visitors),
          uniqueSessions: safe(h.unique_sessions),
          signedInEvents: safe(h.signed_in_events),
          uniqueUsers: safe(h.unique_users),
          firstEvent: (h.first_event as string | null) ?? null,
          lastEvent: (h.last_event as string | null) ?? null,
          byKind: (h.by_kind as Record<string, number>) ?? {}
        },
        totals,
        byEvent: (counts ?? []).map((row) => ({ event: row.event, count: safe(row.count) })),
        trends: {
          daily: Array.from(dailyMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, counts]) => ({ day, counts })),
          hourOfWeek: (hourOfWeek ?? []).map((row) => ({ weekday: row.weekday, hour: row.hour, count: safe(row.count) }))
        },
        breakdowns,
        audience: {
          uniqueVisitors: safe(h.unique_visitors),
          uniqueSessions: safe(h.unique_sessions),
          uniqueUsers: safe(h.unique_users),
          signedInEvents: safe(h.signed_in_events)
        },
        topEmoters: (topEmoters ?? []).map((row) => ({ visitorId: row.visitor_id, count: safe(row.count) })),
        activeUsers: (activeUsers ?? []).map((row) => ({
          userId: row.user_id,
          username: row.username,
          eventCount: safe(row.event_count),
          lastTs: row.last_ts
        })),
        live: { connectedSockets: this.connectedSocketIds.size, activeGames: this.activeGames.size }
      };
    } catch (error: unknown) {
      this.warn('Could not build Supabase analytics report.', error);
      return this.emptyReport(from, to, isAllTime);
    }
  }

  public async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.drain();
  }

  public async close(): Promise<void> {
    await this.flush();
  }

  // -- internals ------------------------------------------------------------

  private identityFor(socketId: string | undefined): { visitorId: string; sessionId: string } | undefined {
    if (!socketId) return undefined;
    return this.socketIdentity.get(socketId);
  }

  private emit(
    event: string,
    kind: string,
    visitorId: string | null,
    sessionId: string | null,
    props: Record<string, unknown>
  ): void {
    if (!this.admin) return;

    const row: PendingEvent = {
      event,
      kind,
      visitor_id: visitorId,
      session_id: sessionId,
      page: null,
      props: this.sanitizeProps(props),
      source: 'server'
    };
    this.pending.push(row);

    if (this.pending.length >= MAX_PENDING) {
      void this.drain();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.drain();
      }, BATCH_FLUSH_MS);
    }
  }

  /** Drop undefined values (JSONB cannot store them) and cap nesting depth. */
  private sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') {
        clean[key] = JSON.parse(JSON.stringify(value));
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }

  private async drain(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;

    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(async () => {
        const { error } = await (this.admin as SupabaseClient)
          .from('analytics_event')
          .insert(
            batch.map((row) => ({
              event: row.event,
              kind: row.kind,
              visitor_id: row.visitor_id,
              session_id: row.session_id,
              page: row.page,
              props: row.props,
              source: row.source
            }))
          );
        if (error) throw error;
      })
      .catch((error: unknown) => {
        // Never lose events on a transient failure: re-queue at the front and let
        // the next tick drain again (bounded to MAX_PENDING to avoid unbounded growth).
        this.pending = [...batch, ...this.pending].slice(0, MAX_PENDING);
        this.warn('Could not flush analytics events to Supabase.', error);
      });

    await this.flushChain;
  }

  private async call<T>(rpcName: string, args: Record<string, unknown>): Promise<T | undefined> {
    if (!this.admin) return undefined;
    const { data, error } = await this.admin.rpc(rpcName, args);
    if (error) {
      this.warn(`analytics RPC ${rpcName} failed.`, error);
      return undefined;
    }
    return data as T;
  }

  private moveMapEntry<T>(map: Map<string, T>, previousKey: string, nextKey: string): void {
    const value = map.get(previousKey);
    if (value === undefined) return;
    map.delete(previousKey);
    map.set(nextKey, value);
  }

  private safeDuration(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  private emptyReport(from: string, to: string, isAllTime: boolean): SupabaseAnalyticsReport {
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      window: { from, to, isAllTime },
      headline: { events: 0, uniqueVisitors: 0, uniqueSessions: 0, signedInEvents: 0, uniqueUsers: 0, firstEvent: null, lastEvent: null, byKind: {} },
      totals: {},
      byEvent: [],
      trends: { daily: [], hourOfWeek: [] },
      breakdowns: {},
      audience: { uniqueVisitors: 0, uniqueSessions: 0, uniqueUsers: 0, signedInEvents: 0 },
      topEmoters: [],
      activeUsers: [],
      live: { connectedSockets: this.connectedSocketIds.size, activeGames: this.activeGames.size }
    };
  }
}
