import type { FeatureUsageEvent } from '@wow/shared';
import { track, trackPage, isAnalyticsEnabled } from './analytics';

/**
 * Compatibility facade for the client analytics surface.
 *
 * `trackFeatureUsage` / `trackFeatureRoute` are the original socket-based API
 * used by pages and the route tracker. They now delegate to the Supabase-backed
 * client tracker in `./analytics.ts` (which writes directly to
 * public.analytics_event through the anon/authenticated client). No page needs
 * to change; the feature events land in the same event stream as game events so
 * the admin dashboard sees them over any time window.
 */

/** A strict enum-only feature event (page view / action). */
export function trackFeatureUsage(event: FeatureUsageEvent): void {
  track(`feature:${event}`, { feature: event }, 'feature');
}

/** Records the current route as a page view (with its fixed enum name too). */
export function trackFeatureRoute(pathname: string): void {
  trackPage(pathname);
  const enumName = routeEventForPathname(pathname);
  if (enumName) track(`feature:${enumName}`, { feature: enumName }, 'feature');
}

/** Backwards-compatible: enables when tracking is allowed (never privacy-gated). */
export function isFirstPartyAnalyticsEnabled(): boolean {
  return isAnalyticsEnabled();
}

function routeEventForPathname(pathname: string): FeatureUsageEvent | undefined {
  if (pathname === '/') return 'page_home_viewed';
  if (pathname === '/settings') return 'page_settings_viewed';
  if (pathname === '/online') return 'page_online_viewed';
  if (pathname === '/daily') return 'page_daily_viewed';
  if (pathname === '/join' || pathname.startsWith('/join/')) return 'page_join_viewed';
  if (pathname.startsWith('/room/')) return 'page_room_viewed';
  return undefined;
}
