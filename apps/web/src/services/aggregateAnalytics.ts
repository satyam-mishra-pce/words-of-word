import type { FeatureUsageEvent } from '@wow/shared';
import { isFirstPartyAnalyticsEnabled } from './analyticsIdentity';
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

/**
 * Sends a strict enum only—never names, room IDs, words, scores, routes, or
 * custom settings. The server aggregates it with the pseudonymous visitor
 * identity carried by the socket and respects explicit browser privacy signals.
 */
export function trackFeatureUsage(event: FeatureUsageEvent): void {
  if (!isFirstPartyAnalyticsEnabled()) return;
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
