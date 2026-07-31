import { Capacitor } from '@capacitor/core';

const ROOM_ID_PATTERN = /^[A-Z0-9]{3,16}$/;

export const isNativeApp = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform();

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function configuredUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimTrailingSlash(trimmed) : undefined;
}

export function getGameServerUrl(): string {
  const configured = configuredUrl(import.meta.env.VITE_SOCKET_URL);
  if (configured) return configured;

  if (!isNativeApp) return window.location.origin;

  // Native release builds are blocked by the mobile build script if this is missing.
  // Keep a clear, non-local fallback so we never accidentally target capacitor://localhost.
  return 'https://unconfigured.words-of-word.invalid';
}

export function getCanonicalWebUrl(): string | undefined {
  const configured = configuredUrl(import.meta.env.VITE_PUBLIC_WEB_URL);
  if (configured) return configured;
  return isNativeApp ? undefined : window.location.origin;
}

export function getRoomInviteUrl(roomId: string): string {
  const safeRoomId = roomId.trim().toUpperCase();
  const canonicalWebUrl = getCanonicalWebUrl();

  if (canonicalWebUrl) {
    return `${canonicalWebUrl}/join/${encodeURIComponent(safeRoomId)}`;
  }

  return `wordsofword://join/${encodeURIComponent(safeRoomId)}`;
}

export function getDailyChallengeUrl(): string {
  const canonicalWebUrl = getCanonicalWebUrl();
  return canonicalWebUrl ? `${canonicalWebUrl}/daily` : 'wordsofword://daily';
}

export function routeFromExternalUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const isAppScheme = url.protocol === 'wordsofword:' || url.protocol === 'com.wordsofword.game:';
    const pathSegments = url.pathname.split('/').filter(Boolean);
    if ((isAppScheme && url.hostname === 'daily') || url.pathname === '/daily') {
      return '/daily';
    }

    const roomId = isAppScheme && url.hostname === 'join'
      ? pathSegments[0]
      : url.pathname.startsWith('/join/')
        ? pathSegments[1]
        : undefined;

    const normalizedRoomId = roomId?.trim().toUpperCase();
    if (!normalizedRoomId || !ROOM_ID_PATTERN.test(normalizedRoomId)) return undefined;

    return `/join/${encodeURIComponent(normalizedRoomId)}`;
  } catch {
    return undefined;
  }
}
