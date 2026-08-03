import type { FeatureUsageEvent } from '@wow/shared';
import socket from './socket';

type AnalyticsRoute = 'home' | 'settings' | 'online' | 'daily' | 'join' | 'room';

const ROUTE_EVENTS: Record<AnalyticsRoute, FeatureUsageEvent> = {
  home: 'page_home_viewed',
  settings: 'page_settings_viewed',
  online: 'page_online_viewed',
  daily: 'page_daily_viewed',
  join: 'page_join_viewed',
  room: 'page_room_viewed'
};

let lastRouteEvent: FeatureUsageEvent | undefined;
let lastRouteAt = 0;

function isOptionalClientMeasurementAllowed(): boolean {
  if (!import.meta.env.PROD || typeof navigator === 'undefined') return false;

  const privacyNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return !privacyNavigator.globalPrivacyControl && navigator.doNotTrack !== '1' && navigator.doNotTrack !== 'yes';
}

/**
 * Sends a strict enum only—never names, room IDs, words, scores, routes, or
 * custom settings. The server persists only a counter for each enum value.
 */
export function trackFeatureUsage(event: FeatureUsageEvent): void {
  if (!isOptionalClientMeasurementAllowed()) return;
  socket.emit('recordFeatureUsage', { event });
}

export function trackFeatureRoute(pathname: string): void {
  const route = routeForPathname(pathname);
  if (!route) return;

  const event = ROUTE_EVENTS[route];
  const now = Date.now();

  // React Strict Mode replays effects in development. Keep a normal back/forward
  // visit, but discard an immediate duplicate signal from one route render.
  if (event === lastRouteEvent && now - lastRouteAt < 500) return;
  lastRouteEvent = event;
  lastRouteAt = now;
  trackFeatureUsage(event);
}

function routeForPathname(pathname: string): AnalyticsRoute | undefined {
  if (pathname === '/') return 'home';
  if (pathname === '/settings') return 'settings';
  if (pathname === '/online') return 'online';
  if (pathname === '/daily') return 'daily';
  if (pathname === '/join' || pathname.startsWith('/join/')) return 'join';
  if (pathname.startsWith('/room/')) return 'room';
  return undefined;
}
