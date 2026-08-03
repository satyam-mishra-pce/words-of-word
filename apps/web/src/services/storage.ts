import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const STORAGE_KEYS = {
  installationId: 'wow.installation-id',
  pushRegistration: 'wow.push-registration',
  theme: 'wow-theme',
  username: 'wow.username',
  avatar: 'wow.avatar'
} as const;

const startupKeys = Object.values(STORAGE_KEYS);
const cache = new Map<string, string | null>();

function readBrowserValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeBrowserValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The native Preferences write below still gives Capacitor users durable storage.
  }
}

function removeBrowserValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

/**
 * Read from an in-memory cache first so existing synchronous React state
 * initializers still work. Native values are hydrated before the app mounts.
 */
export function readStoredValue(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;

  const value = readBrowserValue(key);
  cache.set(key, value);
  return value;
}

export async function hydrateStoredValue(key: string): Promise<string | null> {
  const browserValue = readStoredValue(key);
  if (!Capacitor.isNativePlatform()) return browserValue;

  try {
    const { value } = await Preferences.get({ key });
    if (value !== null) {
      cache.set(key, value);
      writeBrowserValue(key, value);
      return value;
    }
  } catch {
    // Keep the browser cache as a graceful fallback when the plugin is unavailable.
  }

  return browserValue;
}

export async function hydrateApplicationStorage(): Promise<void> {
  await Promise.all(startupKeys.map((key) => hydrateStoredValue(key)));
}

export function writeStoredValue(key: string, value: string): void {
  cache.set(key, value);
  writeBrowserValue(key, value);

  if (Capacitor.isNativePlatform()) {
    void Preferences.set({ key, value }).catch(() => {
      // A local browser-cache fallback remains available for this app session.
    });
  }
}

export function removeStoredValue(key: string): void {
  cache.set(key, null);
  removeBrowserValue(key);

  if (Capacitor.isNativePlatform()) {
    void Preferences.remove({ key }).catch(() => {
      // Keep removal best-effort on a device with unavailable native storage.
    });
  }
}
