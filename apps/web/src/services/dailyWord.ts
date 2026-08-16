import { getGameApiUrl } from './platform';
import { supabase } from './supabase';

export interface DailyWordValidationResult {
  isValid: boolean;
  normalizedWord: string;
  message: string;
}

interface DailyWordValidationResponse {
  ok: boolean;
  data?: DailyWordValidationResult;
  error?: string;
}

function isDailyWordValidationResult(value: unknown): value is DailyWordValidationResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DailyWordValidationResult>;
  return (
    typeof candidate.isValid === 'boolean' &&
    typeof candidate.normalizedWord === 'string' &&
    typeof candidate.message === 'string'
  );
}

const DAILY_WORD_VALIDATION_TIMEOUT_MS = 10_000;

export interface DailyCompletionResult {
  counted: boolean;
  wordsCount: number;
  score?: number;
  day?: number;
}

/**
 * Report a finished daily run to the server so it can advance the signed-in
 * player's streak. The server re-validates the words and derives today's word
 * itself, so this is trust-free. No-op (returns null) when signed out.
 */
export async function completeDailyRun(words: string[]): Promise<DailyCompletionResult | null> {
  if (!supabase || words.length === 0) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  try {
    const response = await fetch(getGameApiUrl('/api/daily/complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words })
    });
    const payload = await response.json().catch(() => undefined) as { ok?: boolean; data?: DailyCompletionResult } | undefined;
    if (!response.ok || !payload?.ok || !payload.data) return null;
    return payload.data;
  } catch {
    return null;
  }
}

export async function validateDailyWord(sourceWord: string, word: string): Promise<DailyWordValidationResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DAILY_WORD_VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch(getGameApiUrl('/api/daily/validate-word'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceWord, word }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => undefined) as DailyWordValidationResponse | undefined;
    if (!response.ok || !payload?.ok || !isDailyWordValidationResult(payload.data)) {
      throw new Error(payload?.error ?? 'Unable to validate the word.');
    }

    return payload.data;
  } finally {
    window.clearTimeout(timeout);
  }
}
