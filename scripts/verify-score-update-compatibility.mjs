#!/usr/bin/env node

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { io } = require('socket.io-client');
const { loadPlayableWordsFromManifest } = await import('../packages/lexicon/dist/index.js');
const { localLexiconOptions } = await import('./lexicon-path.mjs');
const { manifestPath, artifactPath } = localLexiconOptions(import.meta.url);
const dictionary = loadPlayableWordsFromManifest({ manifestPath, artifactPath });
const target = new URL(process.env.TARGET_URL ?? 'http://127.0.0.1:4100');

if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
  throw new Error(`Refusing non-loopback target: ${target.origin}`);
}

const timeoutMs = 15_000;

function connect(auth) {
  const socket = io(target.origin, { autoConnect: false, forceNew: true, reconnection: false, auth, timeout: timeoutMs });
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('Socket connection timed out.')), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolvePromise(socket); });
    socket.once('connect_error', (error) => { clearTimeout(timer); rejectPromise(error); });
    socket.connect();
  });
}

function ack(socket, event, payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`${event} acknowledgement timed out.`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.ok) resolvePromise(response.data);
      else rejectPromise(new Error(response?.error ?? `${event} failed.`));
    });
  });
}

function once(socket, event, predicate = () => true) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      rejectPromise(new Error(`${event} was not received.`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolvePromise(payload);
    };
    socket.on(event, handler);
  });
}

function findValidSubmission(sourceWord) {
  const sourceCounts = new Map();
  for (const letter of sourceWord.toLowerCase()) sourceCounts.set(letter, (sourceCounts.get(letter) ?? 0) + 1);
  const candidate = dictionary.find((word) => {
    if (typeof word !== 'string' || !/^[a-z]+$/.test(word) || word.length < 2 || word.length > 40) return false;
    const counts = new Map();
    for (const letter of word) counts.set(letter, (counts.get(letter) ?? 0) + 1);
    return [...counts].every(([letter, count]) => (sourceCounts.get(letter) ?? 0) >= count);
  });
  if (!candidate) throw new Error(`No valid <=40-character submission for ${sourceWord}.`);
  return candidate;
}

const settings = {
  minWordLength: 5,
  timePerRound: 10,
  rounds: 1,
  maxPlayers: 2,
  gameMode: 'classic',
  fastestWordTarget: 10,
  eliminationsPerRound: 1,
  wordCategory: 'general',
  customWordList: '',
  mixScoringMode: 'classic',
  mixModifiers: { teams: false, wordSprint: false, blind: false, claim: false, busted: false, intuition: false, lightning: false }
};

let modern;
let legacy;
try {
  modern = await connect({ scoreUpdateProtocol: 2 });
  legacy = await connect({});
  const created = await ack(modern, 'createRoom', { username: 'modern', settings, isPublic: false });
  await ack(legacy, 'joinRoom', { roomId: created.roomId, username: 'legacy' });

  const started = once(modern, 'roundStarted');
  await ack(modern, 'startGame', { roomId: created.roomId });
  const round = await started;
  const modernScores = once(modern, 'scoresUpdated');
  const legacyScores = once(legacy, 'scoresUpdated');
  await ack(modern, 'submitWord', { roomId: created.roomId, word: findValidSubmission(round.currentWord) });
  const [compactPayload, legacyPayload] = await Promise.all([modernScores, legacyScores]);

  if (compactPayload.snapshot !== undefined) throw new Error('Current client unexpectedly received a legacy score snapshot.');
  if (!Array.isArray(compactPayload.scores) || !compactPayload.scores.some(([id, score]) => id === modern.id && score === 3)) {
    throw new Error('Current client did not receive its compact changed-score patch.');
  }
  if (!legacyPayload.snapshot || !legacyPayload.snapshot.players.some((player) => player.id === modern.id && player.score === 3)) {
    throw new Error('Legacy client did not receive a compatible full score snapshot.');
  }

  console.log(`Score-update compatibility passed in ${Math.round(performance.now())} ms.`);
} finally {
  modern?.disconnect();
  legacy?.disconnect();
}
