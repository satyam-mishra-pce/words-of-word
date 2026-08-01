import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function newInstallationId(): string {
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

  // Last-resort UUIDv4-shaped fallback for restricted WebViews. It is continuity,
  // not authentication, and the server accepts only this UUID format.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * A per-installation ID—not an account or secret. It lets a Capacitor player
 * reclaim a Socket.IO session after a mobile app is briefly suspended.
 */
export function getInstallationId(): string {
  const existing = readStoredValue(STORAGE_KEYS.installationId);
  if (existing && UUID_PATTERN.test(existing)) return existing;

  const installationId = newInstallationId();
  writeStoredValue(STORAGE_KEYS.installationId, installationId);
  return installationId;
}
