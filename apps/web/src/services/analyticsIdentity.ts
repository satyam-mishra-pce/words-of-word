import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let sessionId: string | undefined;

export type AnalyticsIdentity = {
  visitorId: string;
  sessionId: string;
};

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Explicit browser-wide privacy signals remain an opt-out for optional measurement. */
export function isFirstPartyAnalyticsEnabled(): boolean {
  if (!import.meta.env.PROD || typeof navigator === 'undefined') return false;

  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return !privacyNavigator.globalPrivacyControl && navigator.doNotTrack !== '1' && navigator.doNotTrack !== 'yes';
}

/**
 * A random, pseudonymous installation identifier plus a per-app-session ID.
 * Neither value includes a name, room code, device metadata, or gameplay data.
 */
export function getAnalyticsIdentity(): AnalyticsIdentity | undefined {
  if (!isFirstPartyAnalyticsEnabled()) return undefined;

  const storedVisitorId = readStoredValue(STORAGE_KEYS.analyticsVisitorId);
  const visitorId = storedVisitorId && UUID_PATTERN.test(storedVisitorId)
    ? storedVisitorId
    : createId();
  if (visitorId !== storedVisitorId) writeStoredValue(STORAGE_KEYS.analyticsVisitorId, visitorId);

  sessionId ??= createId();
  return { visitorId, sessionId };
}
