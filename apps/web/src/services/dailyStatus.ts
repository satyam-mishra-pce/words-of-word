import { dailyDayNumber } from '@wow/shared';
import { readStoredValue } from './storage';

/**
 * Whether the player has already finished (or run out the clock on) today's
 * Daily Word. Read from the same local attempt the Daily page writes, so the
 * header can decide whether to nudge without a network call.
 */
export function isTodayDailyDone(): boolean {
  try {
    const raw = readStoredValue(`wow.daily.${dailyDayNumber()}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { finished?: boolean; endsAt?: number };
    return Boolean(parsed.finished) || (typeof parsed.endsAt === 'number' && parsed.endsAt <= Date.now());
  } catch {
    return false;
  }
}
