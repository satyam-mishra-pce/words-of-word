import type { GameSettings, RoomPhase } from '@wow/shared';
import { isNativeApp, nativePlatform } from './platform';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

type HotjarClient = typeof import('@hotjar/browser').default;
type HotjarValue = string | number | boolean;
type HotjarAttributes = Record<string, HotjarValue>;

type RoomVisibility = 'public' | 'private';
type JoinSource = 'code' | 'invite' | 'online';
type AnalyticsRoute = 'home' | 'settings' | 'online' | 'daily' | 'join' | 'room' | 'other';
type AnalyticsConsent = 'granted' | 'denied';

export type HotjarEvent =
  | 'page_home_viewed'
  | 'page_settings_viewed'
  | 'page_online_viewed'
  | 'page_daily_viewed'
  | 'page_join_viewed'
  | 'page_room_viewed'
  | 'page_other_viewed'
  | 'home_create_private_selected'
  | 'home_online_multiplayer_selected'
  | 'home_join_private_selected'
  | 'daily_opened'
  | 'room_created'
  | 'room_create_failed'
  | 'room_joined'
  | 'room_join_failed'
  | 'room_left'
  | 'room_leave_failed'
  | 'game_started'
  | 'game_start_failed'
  | 'game_restarted'
  | 'game_restart_failed'
  | 'game_stopped'
  | 'game_stop_failed'
  | 'round_started'
  | 'round_completed'
  | 'game_completed'
  | 'word_submitted'
  | 'word_accepted'
  | 'word_rejected'
  | 'word_submission_failed'
  | 'player_busted'
  | 'emote_sent'
  | 'emote_failed'
  | 'bet_updated'
  | 'bet_update_failed'
  | 'team_selected'
  | 'team_selection_failed'
  | 'settings_opened'
  | 'settings_saved'
  | 'settings_save_failed'
  | 'rules_opened'
  | 'round_history_opened'
  | 'invite_copied'
  | 'invite_copy_failed'
  | 'daily_started'
  | 'daily_restarted'
  | 'daily_word_accepted'
  | 'daily_word_rejected'
  | 'daily_completed'
  | 'daily_shared'
  | 'daily_share_copied'
  | 'daily_share_unavailable';

const HOTJAR_EVENT_FOR_ROUTE: Record<AnalyticsRoute, HotjarEvent> = {
  home: 'page_home_viewed',
  settings: 'page_settings_viewed',
  online: 'page_online_viewed',
  daily: 'page_daily_viewed',
  join: 'page_join_viewed',
  room: 'page_room_viewed',
  other: 'page_other_viewed'
};

const MAX_QUEUED_COMMANDS = 120;
const HOTJAR_VERSION = parsePositiveInteger(import.meta.env.VITE_HOTJAR_VERSION) ?? 6;
const HOTJAR_SITE_ID = parsePositiveInteger(import.meta.env.VITE_HOTJAR_SITE_ID);

let hotjar: HotjarClient | undefined;
let initializationScheduled = false;
let lastRoute: AnalyticsRoute | undefined;
let lastRouteAt = 0;
const queuedCommands: Array<(client: HotjarClient) => void> = [];

function parsePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isLocalHost(): boolean {
  if (typeof window === 'undefined') return true;
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

function readAnalyticsConsent(): AnalyticsConsent | undefined {
  const consent = readStoredValue(STORAGE_KEYS.analyticsConsent);
  return consent === 'granted' || consent === 'denied' ? consent : undefined;
}

function isHotjarConfigured(): boolean {
  return Boolean(
    import.meta.env.PROD &&
    HOTJAR_SITE_ID &&
    import.meta.env.VITE_HOTJAR_ENABLED !== 'false' &&
    !isLocalHost() &&
    (!isNativeApp || import.meta.env.VITE_HOTJAR_ENABLE_NATIVE === 'true')
  );
}

function isHotjarEnabled(): boolean {
  return isHotjarConfigured() && readAnalyticsConsent() === 'granted';
}

export function shouldAskForHotjarConsent(): boolean {
  return isHotjarConfigured() && readAnalyticsConsent() === undefined;
}

export function grantHotjarConsent(): void {
  writeStoredValue(STORAGE_KEYS.analyticsConsent, 'granted');
  initializeHotjar();
  if (typeof window !== 'undefined') trackRoute(window.location.pathname);
}

export function declineHotjarConsent(): void {
  queuedCommands.length = 0;
  writeStoredValue(STORAGE_KEYS.analyticsConsent, 'denied');
}

function newAnonymousVisitorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wow_${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  return `wow_${Date.now().toString(36)}_${random}`;
}

function getAnonymousVisitorId(): string {
  const existing = readStoredValue(STORAGE_KEYS.analyticsVisitorId);
  if (existing && /^wow_[a-z0-9_-]{12,80}$/i.test(existing)) return existing;

  const visitorId = newAnonymousVisitorId();
  writeStoredValue(STORAGE_KEYS.analyticsVisitorId, visitorId);
  return visitorId;
}

function baseAttributes(): HotjarAttributes {
  return {
    app_platform: isNativeApp ? `native_${nativePlatform}` : 'web'
  };
}

function enabledMixModifiers(settings: GameSettings): string {
  const enabled = Object.entries(settings.mixModifiers)
    .filter(([, isEnabled]) => isEnabled)
    .map(([modifier]) => modifier);

  return enabled.length > 0 ? enabled.join('_') : 'none';
}

function settingsAttributes(settings: GameSettings): HotjarAttributes {
  return {
    game_mode: settings.gameMode,
    round_seconds: settings.timePerRound,
    round_count: settings.rounds,
    player_capacity: settings.maxPlayers,
    minimum_source_word_length: settings.minWordLength,
    word_category: settings.wordCategory,
    has_custom_source_list: settings.wordCategory === 'custom' && settings.customWordList.trim().length > 0,
    mix_scoring_mode: settings.mixScoringMode,
    mix_modifiers: enabledMixModifiers(settings),
    word_sprint_target: settings.fastestWordTarget,
    eliminations_per_round: settings.eliminationsPerRound
  };
}

function wordCountBucket(wordCount: number): string {
  if (wordCount <= 0) return '0';
  if (wordCount <= 3) return '1_3';
  if (wordCount <= 7) return '4_7';
  return '8_plus';
}

function betBucket(bet: number): string {
  if (bet <= 5) return '1_5';
  if (bet <= 10) return '6_10';
  if (bet <= 20) return '11_20';
  return '21_plus';
}

function scoreBucket(score: number): string {
  if (score < 0) return 'negative';
  if (score === 0) return '0';
  if (score <= 10) return '1_10';
  if (score <= 25) return '11_25';
  if (score <= 50) return '26_50';
  return '51_plus';
}

function queue(command: (client: HotjarClient) => void): void {
  if (!isHotjarEnabled()) return;

  if (hotjar) {
    command(hotjar);
    return;
  }

  if (queuedCommands.length < MAX_QUEUED_COMMANDS) queuedCommands.push(command);
  initializeHotjar();
}

function identify(attributes: HotjarAttributes): void {
  if (!isHotjarEnabled()) return;

  const visitorId = getAnonymousVisitorId();
  const profile = { ...baseAttributes(), ...attributes };
  queue((client) => { client.identify(visitorId, profile); });
}

function flushQueuedCommands(client: HotjarClient): void {
  const commands = queuedCommands.splice(0);
  for (const command of commands) command(client);
}

function scheduleIdle(callback: () => void): void {
  if (typeof window === 'undefined') return;

  const requestIdle = window.requestIdleCallback;
  if (typeof requestIdle === 'function') {
    requestIdle(callback, { timeout: 2500 });
    return;
  }

  window.setTimeout(callback, 0);
}

/**
 * Loads the Hotjar SDK after the app has rendered and a visitor has granted
 * consent. It is intentionally a no-op without a valid public site ID, in
 * local development, and in native shells unless native tracking is explicitly
 * enabled.
 */
export function initializeHotjar(): void {
  if (!isHotjarEnabled() || initializationScheduled || hotjar) return;
  initializationScheduled = true;

  scheduleIdle(() => {
    void import('@hotjar/browser')
      .then(({ default: Hotjar }) => {
        if (!HOTJAR_SITE_ID || !Hotjar.init(HOTJAR_SITE_ID, HOTJAR_VERSION)) return;

        hotjar = Hotjar;
        identify({});
        flushQueuedCommands(Hotjar);
      })
      .catch(() => {
        // Analytics must never affect gameplay if the optional SDK cannot load.
      });
  });
}

export function trackHotjarEvent(event: HotjarEvent): void {
  queue((client) => { client.event(event); });
}

export function trackRoute(pathname: string): void {
  if (!isHotjarEnabled()) return;

  const route = routeForPathname(pathname);
  const now = Date.now();

  // React Strict Mode replays effects in development. Avoid duplicating an
  // immediate route view while still allowing deliberate return navigation.
  if (lastRoute === route && now - lastRouteAt < 500) return;
  lastRoute = route;
  lastRouteAt = now;

  queue((client) => {
    client.stateChange(`/${route}`);
    client.event(HOTJAR_EVENT_FOR_ROUTE[route]);
  });
}

export function trackRoomCreated(settings: GameSettings, visibility: RoomVisibility): void {
  identify({ ...settingsAttributes(settings), room_visibility: visibility, room_role: 'host' });
  trackHotjarEvent('room_created');
}

export function trackRoomJoined(
  settings: GameSettings,
  source: JoinSource,
  phase: RoomPhase,
  playerCount: number
): void {
  identify({
    ...settingsAttributes(settings),
    room_role: 'player',
    join_source: source,
    room_phase: phase,
    room_player_count: playerCount
  });
  trackHotjarEvent('room_joined');
}

export function trackSettingsSaved(settings: GameSettings, playerCount: number): void {
  identify({ ...settingsAttributes(settings), room_player_count: playerCount, settings_context: 'room_host' });
  trackHotjarEvent('settings_saved');
}

export function trackGameStarted(settings: GameSettings, playerCount: number): void {
  identify({ ...settingsAttributes(settings), room_player_count: playerCount, game_state: 'started' });
  trackHotjarEvent('game_started');
}

export function trackRoundStarted(settings: GameSettings, round: number, playerCount: number): void {
  identify({ ...settingsAttributes(settings), current_round: round, room_player_count: playerCount, game_state: 'round' });
  trackHotjarEvent('round_started');
}

export function trackRoundCompleted(
  settings: GameSettings,
  round: number,
  playerCount: number,
  wordCount: number,
  score: number
): void {
  identify({
    ...settingsAttributes(settings),
    current_round: round,
    room_player_count: playerCount,
    round_word_count_bucket: wordCountBucket(wordCount),
    round_score_bucket: scoreBucket(score)
  });
  trackHotjarEvent('round_completed');
}

export function trackGameCompleted(
  settings: GameSettings,
  playerCount: number,
  placement: number | undefined,
  score: number
): void {
  identify({
    ...settingsAttributes(settings),
    room_player_count: playerCount,
    game_placement: placement ?? 'unranked',
    final_score_bucket: scoreBucket(score),
    game_state: 'completed'
  });
  trackHotjarEvent('game_completed');
}

export function trackBetUpdated(bet: number): void {
  identify({ latest_bet_bucket: betBucket(bet) });
  trackHotjarEvent('bet_updated');
}

export function trackTeamSelected(teamId: 'red' | 'blue'): void {
  identify({ latest_team: teamId });
  trackHotjarEvent('team_selected');
}

export function trackDailyStarted(isRetry: boolean): void {
  trackHotjarEvent(isRetry ? 'daily_restarted' : 'daily_started');
}

export function trackDailyCompleted(wordCount: number): void {
  identify({ daily_word_count_bucket: wordCountBucket(wordCount) });
  trackHotjarEvent('daily_completed');
}

function routeForPathname(pathname: string): AnalyticsRoute {
  if (pathname === '/') return 'home';
  if (pathname === '/settings') return 'settings';
  if (pathname === '/online') return 'online';
  if (pathname === '/daily') return 'daily';
  if (pathname === '/join' || pathname.startsWith('/join/')) return 'join';
  if (pathname.startsWith('/room/')) return 'room';
  return 'other';
}
