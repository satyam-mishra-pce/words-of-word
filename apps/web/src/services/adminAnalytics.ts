import { getGameServerUrl } from './platform';

export type CounterMap = Record<string, number>;

export interface AnalyticsReport {
  version: number;
  updatedAt: string;
  totals: CounterMap;
  byGameMode: Record<string, {
    roomsCreated: number;
    gamesStarted: number;
    gamesFinished: number;
    gamesAbandoned: number;
    participantSlots: number;
    completedParticipantSlots: number;
    playerRounds: number;
  }>;
  modeAdoption: CounterMap;
  settings: Record<string, CounterMap>;
  featureUsage: CounterMap;
  featureAdoption: CounterMap;
  engagement: {
    participantsInStartedGames: number;
    participantsInCompletedGames: number;
    playerRounds: number;
    playerDepartures: number;
    activeGameDepartures: number;
    gameDurationMs: { completed: number; abandoned: number };
    playerPresenceDurationMs: number;
    playerGameDurationMs: number;
    roomSizeAtGameStart: CounterMap;
    roomFillAtGameStart: CounterMap;
    gameDuration: CounterMap;
    playerPresenceDuration: CounterMap;
    playerGameDuration: CounterMap;
    playerRoundDepth: CounterMap;
    departuresByPhase: CounterMap;
    departuresByReason: CounterMap;
    activeGameDropoffByRound: CounterMap;
  };
  audience: {
    knownVisitors: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    newToday: number;
    returningToday: number;
    sessionsToday: number;
    retention: {
      day1: RetentionMetric;
      day7: RetentionMetric;
      day30: RetentionMetric;
    };
  };
  trends: {
    daily: Array<DailyMetric>;
    hourOfWeek: Array<HourOfWeekMetric>;
  };
  live: {
    connectedSockets: number;
    activeGames: number;
  };
}

export interface RetentionMetric {
  eligible: number;
  returned: number;
  rate: number;
}

export interface DailyMetric {
  date: string;
  uniqueVisitors: number;
  newVisitors: number;
  returningVisitors: number;
  sessions: number;
  roomsCreated: number;
  roomsJoined: number;
  roomsPlayable: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
  roundsCompleted: number;
  participantSlots: number;
  playerRounds: number;
  playerDepartures: number;
  wordsAccepted: number;
  featureEvents: number;
  peakConnectedSockets: number;
  peakActiveGames: number;
}

export interface HourOfWeekMetric {
  weekday: number;
  hour: number;
  sessions: number;
  roomsJoined: number;
  gamesStarted: number;
  participantSlots: number;
  peakConnectedSockets: number;
  peakActiveGames: number;
}

export class AnalyticsUnauthorizedError extends Error {
  public constructor() {
    super('Unauthorized');
  }
}

function analyticsUrl(path = ''): string {
  return `${getGameServerUrl()}/admin/analytics${path}`;
}

async function parsePayload(response: Response): Promise<{ ok?: boolean; data?: AnalyticsReport; error?: string }> {
  try {
    return await response.json() as { ok?: boolean; data?: AnalyticsReport; error?: string };
  } catch {
    return {};
  }
}

export async function loadAnalyticsReport(): Promise<AnalyticsReport> {
  const response = await fetch(analyticsUrl(), {
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
