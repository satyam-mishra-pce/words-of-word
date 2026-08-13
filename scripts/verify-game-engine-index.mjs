#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import {
  createValidWordIndex,
  createValidWords,
  createValidWordsFromIndex
} from '../packages/game-engine/dist/index.js';
import { loadPlayableWordsFromManifest } from '../packages/lexicon/dist/index.js';
import { localLexiconOptions } from './lexicon-path.mjs';

const { manifestPath, artifactPath } = localLexiconOptions(import.meta.url);
const dictionary = loadPlayableWordsFromManifest({ manifestPath, artifactPath });
const sources = [
  'astronaut',
  'transformation',
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
  const oneLetterWords = [...actual].filter((word) => word.length === 1);
  if (oneLetterWords.length > 0) {
    throw new Error(`Indexed lookup should not accept one-letter submissions for ${source}: ${oneLetterWords.join(', ')}`);
  }
  console.log(`${source}: ${actual.size} valid words (match, no one-letter words).`);
}
