import { getSessionId, getVisitorId, isAnalyticsEnabled } from './analytics';

export type AnalyticsIdentity = {
  visitorId: string;
  sessionId: string;
};

/**
 * Anonymous, pseudonymous installation identity sent to the socket server so it
 * can attribute server-side game events to the same visitor. Ids come from the
 * unified client analytics module (single source of truth). When the user opts
 * out, no identity is sent (the server still records game events, just without
 * visitor linkage).
 */
export function isFirstPartyAnalyticsEnabled(): boolean {
  return isAnalyticsEnabled();
}

export function getAnalyticsIdentity(): AnalyticsIdentity | undefined {
  if (!isAnalyticsEnabled()) return undefined;
  return { visitorId: getVisitorId(), sessionId: getSessionId() };
}
