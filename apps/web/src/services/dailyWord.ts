import { getGameServerUrl } from './platform';

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

export async function validateDailyWord(sourceWord: string, word: string): Promise<DailyWordValidationResult> {
  const response = await fetch(`${getGameServerUrl()}/api/daily/validate-word`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceWord, word })
  });

  const payload = await response.json().catch(() => undefined) as DailyWordValidationResponse | undefined;
  if (!response.ok || !payload?.ok || !isDailyWordValidationResult(payload.data)) {
    throw new Error(payload?.error ?? 'Unable to validate the word.');
  }

  return payload.data;
}
