import { getGameApiUrl } from './platform';

export type AnalyticWindow = {
  /** UTC ISO timestamp, inclusive. */
  from: string;
  /** UTC ISO timestamp, exclusive. */
  to: string;
};

export type MetricBucket = { value: string; count: number };

export interface AnalyticsReport {
  version: number;
  updatedAt: string;
  window: { from: string; to: string; isAllTime: boolean };
  headline: {
    events: number;
    uniqueVisitors: number;
    uniqueSessions: number;
    signedInEvents: number;
    uniqueUsers: number;
    firstEvent: string | null;
    lastEvent: string | null;
    byKind: Record<string, number>;
  };
  totals: Record<string, number>;
  byEvent: Array<{ event: string; count: number }>;
  trends: {
    daily: Array<{ day: string; counts: Record<string, number> }>;
    hourOfWeek: Array<{ weekday: number; hour: number; count: number }>;
  };
  breakdowns: Record<string, MetricBucket[]>;
  audience: {
    uniqueVisitors: number;
    uniqueSessions: number;
    uniqueUsers: number;
    signedInEvents: number;
  };
  topEmoters: Array<{ visitorId: string; count: number }>;
  activeUsers: Array<{ userId: string; username: string | null; eventCount: number; lastTs: string | null }>;
  live: { connectedSockets: number; activeGames: number };
}

export class AnalyticsUnauthorizedError extends Error {
  public constructor() {
    super('Unauthorized');
  }
}

function analyticsUrl(path = '', window?: AnalyticWindow): string {
  const base = getGameApiUrl(`/api/admin/analytics${path}`);
  if (!window) return base;
  const query = new URLSearchParams({ from: window.from, to: window.to });
  return `${base}?${query.toString()}`;
}

async function parsePayload(response: Response): Promise<{ ok?: boolean; data?: AnalyticsReport; error?: string }> {
  try {
    return await response.json() as { ok?: boolean; data?: AnalyticsReport; error?: string };
  } catch {
    return {};
  }
}

export async function loadAnalyticsReport(window?: AnalyticWindow): Promise<AnalyticsReport> {
  const response = await fetch(analyticsUrl('', window), {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (response.status === 401) throw new AnalyticsUnauthorizedError();
  const payload = await parsePayload(response);
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error || 'Could not load analytics.');
  }
  return payload.data;
}

export async function startAnalyticsSession(password: string): Promise<void> {
  const response = await fetch(analyticsUrl('/session'), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password })
  });

  if (response.status === 401) throw new AnalyticsUnauthorizedError();
  if (!response.ok) throw new Error('Could not start the analytics session.');
}

export async function endAnalyticsSession(): Promise<void> {
  const response = await fetch(analyticsUrl('/session/logout'), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) throw new Error('Could not end the analytics session.');
}
