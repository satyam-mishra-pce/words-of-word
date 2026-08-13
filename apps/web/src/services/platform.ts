import { Capacitor } from '@capacitor/core';

const ROOM_ID_PATTERN = /^[A-Z0-9]{3,16}$/;
const PRODUCTION_WEB_ORIGIN = 'https://wordsofword.in';
const PRODUCTION_SERVER_ORIGIN = 'https://words-of-word.onrender.com';

export const isNativeApp = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform();

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function configuredUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimTrailingSlash(trimmed) : undefined;
}

/**
 * Socket.IO always needs an origin. A configured game-server origin is
 * authoritative for split web deployments and native apps.
 */
export function getGameSocketUrl(): string {
  const configured = configuredUrl(import.meta.env.VITE_GAME_SERVER_URL)
    ?? configuredUrl(import.meta.env.VITE_SOCKET_URL);
  if (configured) return configured;

  if (!isNativeApp) {
    const hostname = window.location.hostname;
    if (hostname === 'wordsofword.in' || hostname.endsWith('.vercel.app')) return PRODUCTION_SERVER_ORIGIN;
    return window.location.origin;
  }

  // Native release builds are blocked by the mobile build script if this is missing.
  // Keep a clear, non-local fallback so we never target capacitor://localhost.
  return 'https://unconfigured.words-of-word.invalid';
}

/**
 * Browser HTTP calls stay same-origin so Vite/Vercel can proxy them and strict
 * admin cookies work. Native apps have no same-origin server, so use the
 * configured HTTPS game-server origin there.
 */
export function getGameApiUrl(path: `/api/${string}`): string {
  if (!isNativeApp) return path;
  return `${getGameSocketUrl()}${path}`;
}

export function getCanonicalWebUrl(): string | undefined {
  const configured = configuredUrl(import.meta.env.VITE_PUBLIC_WEB_URL);
  if (configured) return configured;
  if (isNativeApp) return undefined;
  return window.location.hostname === 'wordsofword.in' || window.location.hostname.endsWith('.vercel.app')
    ? PRODUCTION_WEB_ORIGIN
    : window.location.origin;
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
    if (url.username || url.password || url.search || url.hash) return undefined;

    const isAppScheme = url.protocol === 'wordsofword:' || url.protocol === 'com.wordsofword.game:';
    const canonicalWebUrl = getCanonicalWebUrl();
    const isApprovedWebUrl = url.protocol === 'https:'
      && Boolean(canonicalWebUrl)
      && url.origin === new URL(canonicalWebUrl as string).origin;
    if (!isAppScheme && !isApprovedWebUrl) return undefined;

    const pathSegments = url.pathname.split('/').filter(Boolean);
    if (
      (isAppScheme && url.hostname === 'daily' && pathSegments.length === 0)
      || (isApprovedWebUrl && url.hostname && pathSegments.length === 1 && pathSegments[0] === 'daily')
    ) {
      return '/daily';
    }

    const roomId = isAppScheme && url.hostname === 'join' && pathSegments.length === 1
      ? pathSegments[0]
      : isApprovedWebUrl && pathSegments.length === 2 && pathSegments[0] === 'join'
        ? pathSegments[1]
        : undefined;

    const normalizedRoomId = roomId?.trim().toUpperCase();
    if (!normalizedRoomId || !ROOM_ID_PATTERN.test(normalizedRoomId)) return undefined;

    return `/join/${encodeURIComponent(normalizedRoomId)}`;
  } catch {
    return undefined;
  }
}
