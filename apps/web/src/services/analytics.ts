import { supabase, isSupabaseConfigured } from './supabase';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

/**
 * Words of Word — client-side analytics (event-sourced into Supabase).
 *
 * Every page view, meaningful click, and explicit feature action is written as a
 * row in public.analytics_event through the anon/authenticated client. The
 * server is the authority for game lifecycle events; this module covers the UI
 * surface. Rows are batched and deduplicated (client_event_id) so nothing is
 * missed and retries cannot double count.
 *
 * Privacy: users are OPTED IN by default (per product decision). A signed-in or
 * anonymous user can opt out via the privacy shield in the home footer; opting
 * out stops all future client tracking on this installation.
 */

const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_THRESHOLD = 40;
const MAX_TEXT_LENGTH = 80;
const OPT_OUT_KEY = STORAGE_KEYS.analyticsOptedOut;

type PendingEvent = {
  event: string;
  kind: string;
  visitor_id: string | null;
  session_id: string | null;
  page: string | null;
  props: Record<string, unknown>;
  client_event_id?: string;
};

let visitorId: string | null = null;
let sessionId: string | null = null;
let initialized = false;
let pending: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = Promise.resolve();

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] ?? 0 & 0x0f) | 0x40;
  bytes[8] = (bytes[8] ?? 0 & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidPattern(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readOptOut(): boolean {
  const raw = readStoredValue(OPT_OUT_KEY);
  return raw !== null && raw !== 'false' && raw !== '';
}

/** Whether client tracking is allowed on this installation (default: on). */
export function isAnalyticsEnabled(): boolean {
  return isSupabaseConfigured && !readOptOut();
}

export function isAnalyticsOptedOut(): boolean {
  return readOptOut();
}

/** Opt in/out for this installation. Returns the new state. */
export function setAnalyticsOptOut(optedOut: boolean): boolean {
  writeStoredValue(OPT_OUT_KEY, optedOut ? '1' : '0');
  if (optedOut) pending = [];
  return optedOut;
}

export function getVisitorId(): string {
  if (visitorId) return visitorId;
  const stored = readStoredValue(STORAGE_KEYS.analyticsVisitorId);
  visitorId = stored && uuidPattern(stored) ? stored : createId();
  if (visitorId !== stored) writeStoredValue(STORAGE_KEYS.analyticsVisitorId, visitorId);
  return visitorId;
}

export function getSessionId(): string {
  if (sessionId) return sessionId;
  const stored = readStoredValue(STORAGE_KEYS.analyticsSessionId);
  sessionId = stored && uuidPattern(stored) ? stored : createId();
  if (sessionId !== stored) writeStoredValue(STORAGE_KEYS.analyticsSessionId, sessionId);
  return sessionId;
}

function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.length > 500) clean[key] = value.slice(0, 500);
    else clean[key] = value;
  }
  return clean;
}

/** Record a tracked event. Returns a promise that resolves once queued. */
export function track(
  event: string,
  props: Record<string, unknown> = {},
  kind = 'event'
): void {
  if (!isAnalyticsEnabled()) return;
  pending.push({
    event,
    kind,
    visitor_id: getVisitorId(),
    session_id: getSessionId(),
    page: typeof window !== 'undefined' ? window.location.pathname : null,
    props: sanitizeProps(props),
    client_event_id: createId()
  });
  if (pending.length >= FLUSH_THRESHOLD) void flush();
  else scheduleFlush();
}

/** Record a page view (deduplicated against rapid re-renders). */
const lastPage = { path: '', at: 0 };
export function trackPage(path: string): void {
  if (!isAnalyticsEnabled()) return;
  const now = Date.now();
  if (path === lastPage.path && now - lastPage.at < 500) return;
  lastPage.path = path;
  lastPage.at = now;
  const segments = path.split('/').filter(Boolean);
  track('page_view', { path, section: segments[0] ?? 'home', depth: segments.length }, 'page');
}

/** Record a UI interaction (button/link click, menu open, etc.). */
export function trackUi(action: string, extra: Record<string, unknown> = {}): void {
  track('ui_click', { action, ...extra }, 'click');
}

/** %-quoted component label a developer can tag with data-analytics="...". */
function elementLabel(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  const interactive = target.closest<HTMLElement>('[data-analytics], button, a, [role="button"], select, input[type="submit"]');
  if (!interactive) return null;
  const explicit = interactive.getAttribute('data-analytics');
  if (explicit) return explicit;
  const tag = interactive.tagName.toLowerCase();
  const text = (interactive.textContent ?? '').trim().slice(0, MAX_TEXT_LENGTH);
  return text ? `${tag}:${text}` : tag;
}

/** Auto-capture clicks on interactive elements (see clip notes in AGENTS.md). */
function installClickCapture(): void {
  if (typeof document === 'undefined') return;
  let last: { key: string; at: number } | undefined;
  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const label = elementLabel(event.target);
      if (!label) return;
      const now = Date.now();
      // De-duplicate rapid double-clicks on the same target within 1s.
      if (last && last.key === label && now - last.at < 1_000) return;
      last = { key: label, at: now };
      track('ui_click', { action: label }, 'click');
    },
    true
  );
}

/** One-time init: mark the session + start auto-capture. Call from App mount. */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  if (!isAnalyticsEnabled()) return;
  track('session_start', { first_visit: !readStoredValue(STORAGE_KEYS.analyticsVisitorId) }, 'session');
  installClickCapture();
}

export async function flush(): Promise<void> {
  const batch = pending;
  pending = [];
  if (batch.length === 0 || !supabase) return;
  const client = supabase;

  flushing = flushing
    .catch(() => undefined)
    .then(async () => {
      const { error } = await client.from('analytics_event').insert(batch);
      if (error) throw error;
    })
    .catch(() => {
      // Re-queue on transient failure; bounded to avoid unbounded growth.
      pending = [...batch, ...pending].slice(0, FLUSH_THRESHOLD * 4);
    });
  await flushing;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

void (typeof window !== 'undefined' ? window.addEventListener('pagehide', () => { void flush(); }) : null);
