import assert from 'node:assert/strict';
import test from 'node:test';
import { DictionaryLookupPayloadSchema } from '@wow/shared';
import type { DefinitionLookup } from '@wow/lexicon';
import {
  DictionaryEntryCache,
  firstSourceDefinition,
  FixedWindowRateLimiter,
  lookupDictionaryEntries,
  publicDictionaryEntry
} from './dictionaryDefinitions.js';

const lookup: DefinitionLookup = {
  word: 'bank',
  display: { pos: 'multiple', shortGloss: 'land beside a river', conciseGloss: 'land beside a river' },
  wordNetSenses: [
    { senseKey: 'bank%1', synsetKey: 'n:1', lemma: 'bank', matchKind: 'exact', senseNumber: 1, pos: 'n', definition: 'land beside a river', examples: ['we sat on the bank'] },
    { senseKey: 'bank%2', synsetKey: 'v:1', lemma: 'bank', matchKind: 'exact', senseNumber: 1, pos: 'v', definition: 'to rely on something', examples: [] }
  ],
  generatedSenses: []
};

const reader = { lookup: (word: string) => word === 'bank' || word === 'constructor' ? { ...lookup, word } : null };

test('source definition uses the first available display/sense meaning', () => {
  assert.deepEqual(firstSourceDefinition(reader, 'bank'), {
    definition: 'land beside a river'
  });
  assert.equal(firstSourceDefinition(reader, 'missing'), undefined);
});

test('public entries expose grouped-ready senses and a stable missing shape', () => {
  assert.deepEqual(publicDictionaryEntry(lookup).senses.map(({ partOfSpeech, definition }) => ({ partOfSpeech, definition })), [
    { partOfSpeech: 'noun', definition: 'land beside a river' },
    { partOfSpeech: 'verb', definition: 'to rely on something' }
  ]);
  assert.deepEqual({ ...lookupDictionaryEntries(reader, [' BANK ', 'missing', 'bank']) }, {
    bank: publicDictionaryEntry(lookup),
    missing: { word: 'missing', senses: [] }
  });
});

test('prototype-key words are returned as own response properties', () => {
  const entries = lookupDictionaryEntries(reader, ['constructor']);
  assert.equal(Object.hasOwn(entries, 'constructor'), true);
  assert.equal(entries['constructor']?.word, 'constructor');
});

test('dictionary entry cache is bounded, caches misses, and refreshes recent entries', () => {
  let lookups = 0;
  const countingReader = { lookup(word: string) { lookups += 1; return reader.lookup(word); } };
  const cache = new DictionaryEntryCache(2);
  lookupDictionaryEntries(countingReader, ['missing'], cache);
  lookupDictionaryEntries(countingReader, ['missing'], cache);
  assert.equal(lookups, 1);
  lookupDictionaryEntries(countingReader, ['bank'], cache);
  lookupDictionaryEntries(countingReader, ['constructor'], cache);
  assert.equal(cache.size, 2);
  lookupDictionaryEntries(countingReader, ['missing'], cache);
  assert.equal(lookups, 4);
});

test('fixed-window limiter resets and reports retry delay', () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000, 10);
  assert.equal(limiter.consume('ip', 0).allowed, true);
  assert.equal(limiter.consume('ip', 100).allowed, true);
  assert.deepEqual(limiter.consume('ip', 200), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(limiter.consume('ip', 1_001).allowed, true);
  assert.equal(limiter.consume('another', 1_001).allowed, true);
});

test('dictionary batch input is bounded and alphabetic', () => {
  assert.equal(DictionaryLookupPayloadSchema.safeParse({ words: ['bank'] }).success, true);
  assert.equal(DictionaryLookupPayloadSchema.safeParse({ words: [] }).success, false);
  assert.equal(DictionaryLookupPayloadSchema.safeParse({ words: Array.from({ length: 101 }, () => 'bank') }).success, false);
  assert.equal(DictionaryLookupPayloadSchema.safeParse({ words: ['not-a-word'] }).success, false);
  assert.equal(DictionaryLookupPayloadSchema.safeParse({ words: ['a'.repeat(41)] }).success, false);
});
