#!/usr/bin/env node

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import {
  createValidWordIndex,
  createValidWords,
  createValidWordsFromIndex
} from '../packages/game-engine/dist/index.js';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const dictionary = require('an-array-of-english-words');
const sources = [
  'astronaut',
  'characteristically',
  'counterrevolutionaries',
  'pneumonoultramicroscopicsilicovolcanoconiosis',
  'uncharacteristically'
];

const startedAt = performance.now();
const index = createValidWordIndex(dictionary);
console.log(`Indexed ${index.words.length} dictionary words in ${(performance.now() - startedAt).toFixed(1)} ms.`);

for (const source of sources) {
  const expected = createValidWords(source, dictionary);
  const actual = createValidWordsFromIndex(source, index);
  const equivalent = expected.size === actual.size && [...expected].every((word) => actual.has(word));
  if (!equivalent) {
    throw new Error(`Indexed lookup disagrees with the compatibility path for ${source}.`);
  }
  console.log(`${source}: ${actual.size} valid words (match).`);
}
