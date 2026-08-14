import type {
  DictionaryEntry,
  DictionaryPartOfSpeech,
  DictionarySense
} from '@wow/shared';
import type { DefinitionLookup, GeneratedPos, WordNetPos } from '@wow/lexicon';

export interface DefinitionReader {
  lookup(word: string): DefinitionLookup | null;
}

const MAX_PUBLIC_SENSES = 64;
const MAX_PUBLIC_EXAMPLES_PER_SENSE = 4;

export function dictionaryPartOfSpeech(pos: WordNetPos | GeneratedPos | string): DictionaryPartOfSpeech {
  if (pos === 'n' || pos === 'noun') return 'noun';
  if (pos === 'v' || pos === 'verb') return 'verb';
  if (pos === 'a' || pos === 's' || pos === 'adjective') return 'adjective';
  if (pos === 'r' || pos === 'adverb') return 'adverb';
  if (pos === 'unknown') return 'unknown';
  return 'other';
}

function allSenses(lookup: DefinitionLookup): { senses: DictionarySense[]; truncated: boolean } {
  const sourceSenses: DictionarySense[] = [
    ...lookup.wordNetSenses.map((sense) => ({
      partOfSpeech: dictionaryPartOfSpeech(sense.pos),
      definition: sense.definition,
      examples: sense.examples
    })),
    ...lookup.generatedSenses.map((sense) => ({
      partOfSpeech: dictionaryPartOfSpeech(sense.pos),
      definition: sense.definition,
      examples: sense.examples
    }))
  ];

  const seen = new Set<string>();
  const unique: DictionarySense[] = [];
  let truncated = false;
  for (const sense of sourceSenses) {
    const key = `${sense.partOfSpeech}\u0000${sense.definition.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (unique.length >= MAX_PUBLIC_SENSES) {
      truncated = true;
      continue;
    }
    if (sense.examples.length > MAX_PUBLIC_EXAMPLES_PER_SENSE) truncated = true;
    unique.push({ ...sense, examples: sense.examples.slice(0, MAX_PUBLIC_EXAMPLES_PER_SENSE) });
  }
  return { senses: unique, truncated };
}

export function publicDictionaryEntry(lookup: DefinitionLookup): DictionaryEntry {
  const { senses, truncated } = allSenses(lookup);
  const firstSense = senses[0];
  const displayPos = lookup.display?.pos === 'multiple'
    ? firstSense?.partOfSpeech
    : lookup.display
      ? dictionaryPartOfSpeech(lookup.display.pos)
      : firstSense?.partOfSpeech;

  const shortDefinition = lookup.display?.shortGloss || firstSense?.definition;
  return {
    word: lookup.word,
    ...(shortDefinition ? { shortDefinition } : {}),
    ...(displayPos ? { shortPartOfSpeech: displayPos } : {}),
    senses,
    ...(truncated ? { truncated: true } : {})
  };
}

export class DictionaryEntryCache {
  private readonly entries = new Map<string, DictionaryEntry>();

  public constructor(private readonly capacity = 2_000) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Dictionary cache capacity must be positive.');
  }

  public get(word: string): DictionaryEntry | undefined {
    const entry = this.entries.get(word);
    if (!entry) return undefined;
    this.entries.delete(word);
    this.entries.set(word, entry);
    return entry;
  }

  public set(word: string, entry: DictionaryEntry): void {
    this.entries.delete(word);
    this.entries.set(word, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  public get size(): number { return this.entries.size; }
}

export function lookupDictionaryEntries(reader: DefinitionReader, words: readonly string[], cache?: DictionaryEntryCache): Record<string, DictionaryEntry> {
  const entries = Object.create(null) as Record<string, DictionaryEntry>;
  for (const input of words) {
    const word = input.trim().toLowerCase();
    if (Object.hasOwn(entries, word)) continue;
    const cached = cache?.get(word);
    if (cached) {
      entries[word] = cached;
      continue;
    }
    const lookup = reader.lookup(word);
    const entry = lookup ? publicDictionaryEntry(lookup) : { word, senses: [] };
    cache?.set(word, entry);
    entries[word] = entry;
  }
  return entries;
}

export function firstSourceDefinition(reader: DefinitionReader, word: string): { definition: string } | undefined {
  const lookup = reader.lookup(word);
  if (!lookup) return undefined;
  const entry = publicDictionaryEntry(lookup);
  const definition = entry.shortDefinition ?? entry.senses[0]?.definition;
  return definition ? { definition } : undefined;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();
  private lastCleanupAt = 0;

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 10_000
  ) {
    if (limit < 1 || windowMs < 1 || maxBuckets < 1) throw new Error('Invalid rate-limit configuration.');
  }

  public consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    if (now - this.lastCleanupAt >= this.windowMs || this.buckets.size >= this.maxBuckets) this.cleanup(now);
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (current.count <= this.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + this.windowMs - now) / 1_000)) };
  }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets) if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.buckets.delete(oldest);
    }
    this.lastCleanupAt = now;
  }
}
