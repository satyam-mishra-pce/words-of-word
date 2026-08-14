import type { DictionaryEntry, DictionaryLookupResponse } from '@wow/shared';
import { getGameApiUrl } from './platform';

interface ApiResponse {
  ok: boolean;
  data?: DictionaryLookupResponse;
  error?: string;
}

const MAX_BATCH_SIZE = 100;
const entryCache = new Map<string, DictionaryEntry>();
const inFlightByWord = new Map<string, Promise<DictionaryEntry>>();

function ownEntry(entries: Record<string, DictionaryEntry>, word: string): DictionaryEntry {
  return Object.hasOwn(entries, word) ? entries[word] as DictionaryEntry : { word, senses: [] };
}

async function requestDictionaryWords(words: string[], signal?: AbortSignal): Promise<Record<string, DictionaryEntry>> {
  const response = await fetch(getGameApiUrl('/api/dictionary/lookup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
    ...(signal ? { signal } : {})
  });
  const payload = await response.json().catch(() => undefined) as ApiResponse | undefined;
  if (!response.ok || !payload?.ok || !payload.data?.entries) throw new Error(payload?.error ?? 'Unable to load definitions.');
  return payload.data.entries;
}

export async function lookupDictionaryWords(words: readonly string[], signal?: AbortSignal): Promise<Record<string, DictionaryEntry>> {
  const normalized = Array.from(new Set(words.map((word) => word.trim().toLowerCase()).filter((word) => /^[a-z]+$/.test(word))));
  if (normalized.length === 0) return Object.create(null) as Record<string, DictionaryEntry>;
  if (normalized.length > MAX_BATCH_SIZE) throw new Error(`Dictionary lookup is limited to ${MAX_BATCH_SIZE} words.`);

  const uncached = normalized.filter((word) => !entryCache.has(word) && !inFlightByWord.has(word));
  if (uncached.length > 0) {
    const batchPromise = requestDictionaryWords(uncached, signal);
    for (const word of uncached) {
      const wordPromise = batchPromise.then((entries) => {
        const entry = ownEntry(entries, word);
        entryCache.set(word, entry);
        return entry;
      }).finally(() => {
        if (inFlightByWord.get(word) === wordPromise) inFlightByWord.delete(word);
      });
      inFlightByWord.set(word, wordPromise);
    }
  }

  const result = Object.create(null) as Record<string, DictionaryEntry>;
  await Promise.all(normalized.map(async (word) => {
    const cached = entryCache.get(word);
    result[word] = cached ?? await (inFlightByWord.get(word) as Promise<DictionaryEntry>);
  }));
  return result;
}
