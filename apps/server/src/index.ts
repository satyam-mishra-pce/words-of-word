import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  CheckRoomPayloadSchema,
  ClientToServerEvents,
  CreateRoomPayloadSchema,
  EmptyResult,
  Emote,
  EmotePlayedPayload,
  GameOverPayload,
  GameRestartedPayload,
  GameSettings,
  BingoTask,
  LeaveRoomPayloadSchema,
  HostChangedPayload,
  JoinRoomPayloadSchema,
  QuickJoinRoomPayloadSchema,
  Player,
  PlayerAvatar,
  OnlineRoomSummary,
  PlayerBustedPayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PushPlatform,
  RegisterPushTokenPayloadSchema,
  RecordFeatureUsagePayloadSchema,
  SetAppActivityPayloadSchema,
  RestartGamePayloadSchema,
  RoomSnapshot,
  RoundEndedPayload,
  RoundResultPlayer,
  RoundStartedPayload,
  SendEmotePayloadSchema,
  ServerAck,
  ScoresUpdatedPayload,
  ServerToClientEvents,
  StartGamePayloadSchema,
  SubmitWordPayloadSchema,
  UpdateBetPayloadSchema,
  UpdateSettingsPayloadSchema,
  UpdateTeamPayloadSchema,
  WordAcceptedPayload,
  WordRejectedPayload
} from '@wow/shared';
import { AggregateAnalyticsStore, type AnalyticsVisitorIdentity } from './aggregateAnalytics.js';
import { createAnalyticsPersistence } from './analyticsPersistence.js';
import {
  canMakeWord,
  chooseSourceWord,
  createValidWordIndex,
  createValidWordsFromIndex,
  DUPLICATE_WORD_PENALTY,
  evaluateSubmission,
  isAlphabeticWord,
  MINIMUM_ACCEPTED_WORD_LENGTH,
  normalizeWord,
  POINTS_PER_WORD,
  scoreWord,
  type ValidWordIndex
} from '@wow/game-engine';

const PORT = Number(process.env.PORT ?? 4000);
const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
const ANALYTICS_AGGREGATE_FILE = process.env.ANALYTICS_AGGREGATE_FILE?.trim() || join(process.cwd(), 'logs', 'aggregate-analytics.json');
const ANALYTICS_DATABASE_URL = process.env.ANALYTICS_DATABASE_URL?.trim();
const ANALYTICS_MIGRATION_FILE = process.env.ANALYTICS_MIGRATION_FILE?.trim() || ANALYTICS_AGGREGATE_FILE;
const REQUIRE_DURABLE_ANALYTICS = process.env.REQUIRE_DURABLE_ANALYTICS === 'true';
const WAIT_BETWEEN_ROUNDS_SECONDS = 10;
const BETTING_SECONDS = 15;
const LIGHTNING_SECONDS = 10;
const FASTEST_N_BONUS = 10;
const BETTING_BASE_POINTS = 10;
const BETTING_EXTRA_WORD_POINTS = 3;
const COMMON_RARE_WORD_POINTS = 5;
const COMMON_RARE_WORD_MIN_LENGTH = 5;
const BINGO_TASK_POINTS = 10;
const BINGO_TASK_COUNT = 7;
const BINGO_FULL_BOARD_BONUS = 100;
const EMOTE_COOLDOWN_MS = 750;
const SCORE_UPDATE_BATCH_MS = 50;
const TEAM_NAMES: Record<'red' | 'blue', string> = { red: 'Red Team', blue: 'Blue Team' };
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MOBILE_RECONNECT_GRACE_MS = 90_000;

function mobileReconnectGraceMs(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  const value = Number.isFinite(parsed) ? parsed : DEFAULT_MOBILE_RECONNECT_GRACE_MS;
  return Math.min(Math.max(value, 10_000), 5 * 60 * 1000);
}

const MOBILE_RECONNECT_GRACE_MS = mobileReconnectGraceMs(process.env.MOBILE_RECONNECT_GRACE_MS);
const MOBILE_APP_ID = process.env.MOBILE_APP_ID ?? 'com.wordsofword.game';
const IOS_APP_TEAM_ID = process.env.IOS_APP_TEAM_ID;
const ANDROID_APP_LINK_CERTIFICATES = (process.env.ANDROID_APP_LINK_CERTIFICATES ?? '')
  .split(',')
  .map((certificate) => certificate.trim())
  .filter(Boolean);
const PUSH_RELAY_URL = process.env.PUSH_RELAY_URL;
const PUSH_RELAY_TOKEN = process.env.PUSH_RELAY_TOKEN;
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '');
const ClientIdSchema = z.string().uuid();
const AnalyticsPasswordPayloadSchema = z.object({
  password: z.string().min(1).max(512)
}).strict();
const AnalyticsReportQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.from) !== Boolean(value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Both from and to are required for a report window.' });
    return;
  }
  if (value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The report window must end after it starts.' });
  }
});
const AnalyticsVisitorIdentitySchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid()
}).strict();
const DailyWordValidationPayloadSchema = z.object({
  sourceWord: z.string().trim().min(1).max(40),
  word: z.string().trim().min(1).max(40)
}).strict();
const ONLINE_ROOM_SETTINGS: GameSettings = {
  minWordLength: 5,
  timePerRound: 30,
  rounds: 5,
  maxPlayers: 10,
  gameMode: 'classic',
  fastestWordTarget: 5,
  eliminationsPerRound: 1,
  wordCategory: 'general',
  customWordList: '',
  mixScoringMode: 'classic',
  mixModifiers: {
    teams: false,
    wordSprint: false,
    blind: false,
    claim: false,
    busted: false,
    intuition: false,
    lightning: false
  }
};
const CATEGORY_WORDS: Record<string, string[]> = {
  genz: ['aesthetic', 'maincharacter', 'delulu', 'bussin', 'cringe', 'glowup', 'stan', 'vibing', 'rizzler', 'brainrot'],
  sports: ['football', 'cricket', 'tennis', 'basketball', 'baseball', 'hockey', 'soccer', 'badminton', 'volleyball', 'athletics'],
  food: ['sandwich', 'pizza', 'burger', 'noodles', 'pancake', 'biryani', 'taco', 'sushi', 'pasta', 'cupcake'],
  slangs: ['awesome', 'savage', 'hangout', 'chilling', 'goofy', 'legend', 'hustle', 'lowkey', 'highkey', 'wilding'],
  vehicles: ['airplane', 'bicycle', 'scooter', 'motorcycle', 'tractor', 'submarine', 'helicopter', 'rickshaw', 'truck', 'sedan'],
  technology: ['computer', 'keyboard', 'internet', 'software', 'hardware', 'database', 'network', 'algorithm', 'processor', 'smartphone'],
  finance: ['banking', 'invoice', 'interest', 'budget', 'revenue', 'capital', 'savings', 'credit', 'portfolio', 'dividend'],
  medical: ['hospital', 'doctor', 'nursing', 'therapy', 'vaccine', 'surgery', 'clinic', 'patient', 'medicine', 'diagnosis']
};
const createRoomId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const requireDictionary = createRequire(import.meta.url);
const rawWords: unknown = requireDictionary('an-array-of-english-words');
const words = z.array(z.string()).parse(rawWords);
const validWordIndex = createValidWordIndex(words);
const dictionaryWordSet = new Set(validWordIndex.words);

/**
 * A deterministic source word is available only to the local capacity harness.
 * It keeps tournament cells repeatable without changing a deployed game's
 * ordinary random source-word selection.
 */
function localLoadTestSourceWord(): string | undefined {
  if (process.env.LOCAL_LOAD_TEST !== '1') return undefined;

  const sourceWord = process.env.LOCAL_LOAD_TEST_SOURCE_WORD?.trim().toLowerCase();
  if (!sourceWord || !/^[a-z]+$/.test(sourceWord) || sourceWord.length < 5) {
    throw new Error('LOCAL_LOAD_TEST_SOURCE_WORD must be an alphabetic word with at least five letters when LOCAL_LOAD_TEST=1.');
  }
  return sourceWord;
}

const LOCAL_LOAD_TEST_SOURCE_WORD = localLoadTestSourceWord();

interface DailyWordValidationResult {
  isValid: boolean;
  normalizedWord: string;
  message: string;
}

function evaluateDailyWordSubmission(sourceWord: string, word: string): DailyWordValidationResult {
  const normalizedSource = normalizeWord(sourceWord);
  const normalizedWord = normalizeWord(word);

  if (!normalizedWord) {
    return { isValid: false, normalizedWord, message: 'Enter a word first.' };
  }

  if (!isAlphabeticWord(normalizedWord)) {
    return { isValid: false, normalizedWord, message: 'Words can only contain letters.' };
  }

  if (!isAlphabeticWord(normalizedSource)) {
    return { isValid: false, normalizedWord, message: 'The daily word is unavailable right now.' };
  }

  if (normalizedWord.length < MINIMUM_ACCEPTED_WORD_LENGTH) {
    return { isValid: false, normalizedWord, message: `Words must be at least ${MINIMUM_ACCEPTED_WORD_LENGTH} letters.` };
  }

  if (!canMakeWord(normalizedWord, normalizedSource)) {
    return { isValid: false, normalizedWord, message: 'That word cannot be made from the daily word.' };
  }

  if (!dictionaryWordSet.has(normalizedWord)) {
    return { isValid: false, normalizedWord, message: 'That is not in the word list.' };
  }

  return { isValid: true, normalizedWord, message: 'Word accepted!' };
}

type TypedIo = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

type ManagerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
type PlayerRemovalReason = 'leave' | 'switch' | 'disconnect';

interface InternalRoom {
  id: string;
  players: Player[];
  settings: GameSettings;
  hostId: string;
  isPublic: boolean;
  phase: RoomSnapshot['phase'];
  currentWord: string;
  timeLeft: number;
  lightningTimeLeft: Map<string, number>;
  currentRound: number;
  validWords: Set<string>;
  acceptedWords: Map<string, Set<string>>;
  roundPenalties: Map<string, number>;
  negativeWords: Map<string, Array<{ word: string; penalty: number }>>;
  bustWords: Map<string, string>;
  bustedPlayers: Set<string>;
  currentBets: Map<string, number>;
  bettingWordCounts: Map<string, number[]>;
  bingoTasks: BingoTask[];
  bingoProgress: Map<string, Set<string>>;
  bingoCompletedBoards: Set<string>;
  lastEmoteAt: Map<string, number>;
  playerJoinedAt: Map<string, number>;
  /** Baseline for compact, incremental scoresUpdated broadcasts. */
  lastEmittedScores: Map<string, number>;
  playableRecorded: boolean;
  tickTimer: NodeJS.Timeout | undefined;
  nextRoundTimer: NodeJS.Timeout | undefined;
  emptyCleanupTimer: NodeJS.Timeout | undefined;
  scoreUpdateTimer: NodeJS.Timeout | undefined;
  waitingSeconds: number;
}

interface ReconnectSession {
  socketId: string;
  removalTimer: NodeJS.Timeout | undefined;
}

interface RegisteredPushToken {
  clientId: string;
  platform: PushPlatform;
  token: string;
  updatedAt: string;
}

const reconnectSessions = new Map<string, ReconnectSession>();
const clientIdBySocketId = new Map<string, string>();
const inactiveClientIds = new Set<string>();
const reboundSocketIds = new Set<string>();
/** Sockets from the current web/mobile build that understand compact score patches. */
const compactScoreUpdateSocketIds = new Set<string>();
const pushTokensByClientId = new Map<string, RegisteredPushToken>();

function roomLink(roomId: string): string {
  return PUBLIC_WEB_URL ? `${PUBLIC_WEB_URL}/join/${encodeURIComponent(roomId)}` : `wordsofword://join/${encodeURIComponent(roomId)}`;
}

function dispatchPush(clientId: string, title: string, body: string, data: Record<string, string>): void {
  const registration = pushTokensByClientId.get(clientId);
  if (!registration || !PUSH_RELAY_URL) return;

  void fetch(PUSH_RELAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(PUSH_RELAY_TOKEN ? { Authorization: `Bearer ${PUSH_RELAY_TOKEN}` } : {})
    },
    body: JSON.stringify({
      token: registration.token,
      platform: registration.platform,
      notification: { title, body, channelId: 'game-alerts' },
      data
    })
  }).then(async (response) => {
    if (response.ok) return;
    if (response.status === 404 || response.status === 410) {
      const current = pushTokensByClientId.get(clientId);
      if (current?.token === registration.token) pushTokensByClientId.delete(clientId);
    }
    fastify.log.warn({ statusCode: response.status }, 'push relay rejected a notification');
  }).catch((error: unknown) => {
    fastify.log.warn({ error }, 'push relay delivery failed');
  });
}

class GameRoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  public constructor(
    private readonly io: TypedIo,
    private readonly dictionary: readonly string[],
    private readonly validWordIndex: ValidWordIndex,
    private readonly analytics: AggregateAnalyticsStore
  ) {}

  private isMixMode(settings: GameSettings): boolean {
    return settings.gameMode === 'mix';
  }

  private hasModifier(settings: GameSettings, modifier: keyof GameSettings['mixModifiers']): boolean {
    if (!this.isMixMode(settings)) {
      return false;
    }
    return Boolean(settings.mixModifiers[modifier]);
  }

  private scoringMode(settings: GameSettings): GameSettings['gameMode'] {
    return this.isMixMode(settings) ? settings.mixScoringMode : settings.gameMode;
  }

  private usesTeams(settings: GameSettings): boolean {
    return settings.gameMode === 'teams' || this.hasModifier(settings, 'teams');
  }

  private usesWordSprint(settings: GameSettings): boolean {
    return settings.gameMode === 'fastestNWords' || this.hasModifier(settings, 'wordSprint');
  }

  private usesBlindType(settings: GameSettings): boolean {
    return settings.gameMode === 'typist' || this.hasModifier(settings, 'blind');
  }

  private usesClaim(settings: GameSettings): boolean {
    return settings.gameMode === 'oneWordForAll' || this.hasModifier(settings, 'claim');
  }

  private usesBusted(settings: GameSettings): boolean {
    return settings.gameMode === 'busted' || this.hasModifier(settings, 'busted');
  }

  private usesIntuition(settings: GameSettings): boolean {
    return settings.gameMode === 'intuition' || this.hasModifier(settings, 'intuition');
  }

  private usesLightning(settings: GameSettings): boolean {
    return settings.gameMode === 'lightning' || this.hasModifier(settings, 'lightning');
  }

  private usesKnockout(settings: GameSettings): boolean {
    return settings.gameMode === 'battleRoyale';
  }

  private roundSecondsFor(settings: GameSettings): number {
    return this.usesLightning(settings) ? LIGHTNING_SECONDS : settings.timePerRound;
  }

  private sourceDictionaryFor(room: InternalRoom): readonly string[] {
    if (room.settings.gameMode !== 'category') {
      return this.dictionary;
    }

    if (room.settings.wordCategory === 'custom') {
      const customWords = room.settings.customWordList
        .split(/[\n,]+/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean);
      return customWords.length > 0 ? customWords : this.dictionary;
    }

    if (room.settings.wordCategory === 'general') {
      return this.dictionary;
    }

    return CATEGORY_WORDS[room.settings.wordCategory] ?? this.dictionary;
  }

  private activePlayers(room: InternalRoom): Player[] {
    return room.players.filter((player) => !player.isEliminated);
  }

  private teamAcceptedWordCount(room: InternalRoom, teamId: 'red' | 'blue'): number {
    return room.players
      .filter((player) => player.teamId === teamId && !player.isEliminated && !room.bustedPlayers.has(player.id))
      .reduce((total, player) => total + (room.acceptedWords.get(player.id)?.size ?? 0), 0);
  }

  private sprintTargetReached(room: InternalRoom, player: Player, playerWords: ReadonlySet<string>): boolean {
    if (!this.usesWordSprint(room.settings)) {
      return false;
    }
    if (this.usesTeams(room.settings) && player.teamId) {
      return this.teamAcceptedWordCount(room, player.teamId) >= room.settings.fastestWordTarget;
    }
    return playerWords.size >= room.settings.fastestWordTarget;
  }

  private bingoTemplateTasks(sourceWord: string): BingoTask[] {
    const sourceLetters = sourceWord.split('');
    const letters = Array.from(new Set(sourceLetters));
    const rareOrder = 'qzxjkvbpygfwmucldrhsnioate';
    const rareLetters = [...rareOrder].filter((letter) => letters.includes(letter));
    const vowels = letters.filter((letter) => 'aeiou'.includes(letter));
    const rarest = rareLetters[0] ?? letters[0] ?? 'a';
    const letterCounts = sourceLetters.reduce<Record<string, number>>((counts, letter) => {
      counts[letter] = (counts[letter] ?? 0) + 1;
      return counts;
    }, {});
    const repeated = Object.entries(letterCounts).find(([, count]) => count >= 2)?.[0];
    const pick = (index: number) => letters[index % Math.max(1, letters.length)] ?? 'a';
    const rarePick = (index: number) => rareLetters[index % Math.max(1, rareLetters.length)] ?? pick(index);
    const sourcePairs = Array.from(new Set(sourceLetters.slice(0, -1).map((letter, index) => `${letter}${sourceLetters[index + 1]}`)));
    const middleLetters = Array.from(new Set(sourceLetters.filter((_, index) => index > 0 && index < sourceLetters.length - 1)));
    const tasks: BingoTask[] = [
      { id: 'same-edge', label: 'Find a word with the same first and last letter' },
      { id: 'exactly-2-vowels', label: 'Find a word with exactly 2 vowels' },
      { id: 'no-repeats', label: 'Find a word with no repeated letters' },
      { id: `ends-${rarest}`, label: `Find a word ending in rare letter ${rarest.toUpperCase()}` },
      { id: `pos-2-${pick(1)}`, label: `Find a word whose 2nd letter is ${pick(1).toUpperCase()}` },
      { id: `middle-${pick(Math.floor(sourceLetters.length / 2))}`, label: `Find a word whose middle letter is ${pick(Math.floor(sourceLetters.length / 2)).toUpperCase()}` },
      { id: 'len6plus', label: 'Find a 6+ letter word' },
      { id: 'len7plus', label: 'Find a 7+ letter word' },
      { id: 'len5exact', label: 'Find exactly a 5-letter word' },
      { id: `starts-${rarest}`, label: `Find a word starting with rare letter ${rarest.toUpperCase()}` },
      { id: `has-${rarePick(0)}-${rarePick(1)}`, label: `Use both ${rarePick(0).toUpperCase()} and ${rarePick(1).toUpperCase()}` },
      { id: `has3-${rarePick(0)}-${rarePick(1)}-${rarePick(2)}`, label: `Use ${rarePick(0).toUpperCase()}, ${rarePick(1).toUpperCase()} and ${rarePick(2).toUpperCase()}` },
      { id: `edge-${pick(0)}-${pick(letters.length - 1)}`, label: `Find a word starting with ${pick(0).toUpperCase()} and ending with ${pick(letters.length - 1).toUpperCase()}` },
      { id: `pos-3-${pick(2)}`, label: `Find a word whose 3rd letter is ${pick(2).toUpperCase()}` },
      { id: `penultimate-${pick(3)}`, label: `Find a word whose 2nd last letter is ${pick(3).toUpperCase()}` },
      { id: `no-${rarest}`, label: `Find a word without ${rarest.toUpperCase()}` },
      { id: 'one-vowel-total', label: 'Find a word with exactly 1 vowel' },
      { id: 'three-vowels', label: 'Find a word with 3 different vowels' },
      { id: 'consecutive-start', label: 'Submit 2 words in a row starting with the same letter' },
      { id: 'personal-best-6', label: 'First make a 6+ letter word, then make an even longer word' }
    ];

    for (const pair of sourcePairs) {
      tasks.push({ id: `contains-pair-${pair}`, label: `Find a word containing the hidden pair ${pair.toUpperCase()}` });
      tasks.push({ id: `adjacent-source-pair-${pair}`, label: `Find a word with source-neighbor letters ${pair.toUpperCase()} together` });
    }

    if (sourceLetters.length >= 5) {
      const [first, third, fifth] = [sourceLetters[0], sourceLetters[2], sourceLetters[4]];
      if (first && third && fifth) {
        tasks.push({ id: `source-positions-1-3-5-${first}-${third}-${fifth}`, label: `Use source letters #1, #3 and #5: ${first.toUpperCase()}, ${third.toUpperCase()}, ${fifth.toUpperCase()}` });
      }
    }

    if (repeated) {
      tasks.push({ id: `twice-${repeated}`, label: `Use ${repeated.toUpperCase()} twice in one word` });
    }

    const firstVowel = vowels[0];
    if (firstVowel) {
      tasks.push({ id: `vowel-edge-${firstVowel}`, label: `Start or end with vowel ${firstVowel.toUpperCase()}` });
    }

    for (const letter of middleLetters) {
      tasks.push({ id: `middle-${letter}`, label: `Find a word whose middle letter is ${letter.toUpperCase()}` });
    }

    return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
  }

  private bingoTaskMatches(task: BingoTask, word: string, previousWord?: string, previousLongest = 0, submittedWords: string[] = [word], sourceWord?: string): boolean {
    if (sourceWord && word === sourceWord) return false;
    if (task.id === 'len3') return word.length === 3;
    if (task.id === 'len4') return word.length === 4;
    if (task.id === 'len5' || task.id === 'len5exact') return word.length === 5;
    if (task.id === 'len6plus') return word.length >= 6;
    if (task.id === 'len7plus') return word.length >= 7;
    if (task.id === 'no-vowels') return !/[aeiou]/.test(word);
    if (task.id === 'one-vowel' || task.id === 'one-vowel-total') return (word.match(/[aeiou]/g) ?? []).length === 1;
    if (task.id === 'exactly-2-vowels') return (word.match(/[aeiou]/g) ?? []).length === 2;
    if (task.id === 'same-edge') return word.length >= 2 && word[0] === word[word.length - 1];
    if (task.id === 'palindrome') return word.length >= 3 && word === word.split('').reverse().join('');
    if (task.id === 'longest') return word.length === Math.max(...submittedWords.map((submitted) => submitted.length));
    if (task.id === 'personal-best-6') return previousLongest >= 6 && word.length > previousLongest;
    if (task.id === 'three-vowels') return new Set(word.match(/[aeiou]/g) ?? []).size >= 3;
    if (task.id === 'no-repeats') return new Set(word).size === word.length;
    if (task.id === 'consecutive-start') return Boolean(previousWord && previousWord[0] === word[0]);
    if (task.id.startsWith('starts-')) return word.startsWith(task.id.slice(7));
    if (task.id.startsWith('ends-')) return word.endsWith(task.id.slice(5));
    if (task.id.startsWith('twice-')) {
      const letter = task.id.slice(6);
      return word.split('').filter((char) => char === letter).length >= 2;
    }
    if (task.id.startsWith('contains-pair-')) return word.includes(task.id.slice(14));
    if (task.id.startsWith('adjacent-source-pair-')) return word.includes(task.id.slice(21));
    if (task.id.startsWith('middle-')) {
      const letter = task.id.slice(7);
      return word.length % 2 === 1 && word[Math.floor(word.length / 2)] === letter;
    }
    if (task.id.startsWith('source-positions-1-3-5-')) return task.id.slice(23).split('-').every((letter) => word.includes(letter));
    if (task.id.startsWith('pos-')) {
      const [, position, letter] = task.id.split('-');
      return Boolean(position && letter && word[Number(position) - 1] === letter);
    }
    if (task.id.startsWith('penultimate-')) return word.length >= 2 && word[word.length - 2] === task.id.slice(12);
    if (task.id.startsWith('edge-')) {
      const [, start, end] = task.id.split('-');
      return Boolean(start && end && word.startsWith(start) && word.endsWith(end));
    }
    if (task.id.startsWith('vowel-edge-')) {
      const vowel = task.id.slice(11);
      return word.startsWith(vowel) || word.endsWith(vowel);
    }
    if (task.id.startsWith('has3-')) return task.id.slice(5).split('-').every((letter) => word.includes(letter));
    if (task.id.startsWith('no-')) return !word.includes(task.id.slice(3));
    if (task.id.startsWith('vowel-')) return word.includes(task.id.slice(6));
    if (task.id.startsWith('has-')) return task.id.slice(4).split('-').every((letter) => word.includes(letter));
    return false;
  }

  private bingoTaskIsPossible(task: BingoTask, validWords: ReadonlySet<string>, sourceWord: string): boolean {
    const words = Array.from(validWords).filter((word) => word !== sourceWord);
    if (task.id === 'consecutive-start') {
      const startCounts = new Map<string, number>();
      for (const word of words) {
        const start = word[0];
        if (!start) continue;
        const count = (startCounts.get(start) ?? 0) + 1;
        if (count >= 2) return true;
        startCounts.set(start, count);
      }
      return false;
    }

    if (task.id === 'personal-best-6') {
      const sixPlusLengths = Array.from(new Set(words.filter((word) => word.length >= 6).map((word) => word.length)));
      return sixPlusLengths.length >= 2;
    }

    return words.some((word) => this.bingoTaskMatches(task, word, undefined, 0, [word], sourceWord));
  }

  private createBingoTasks(sourceWord: string, validWords: ReadonlySet<string>): BingoTask[] {
    const possibleTasks = this.bingoTemplateTasks(sourceWord)
      .filter((task) => this.bingoTaskIsPossible(task, validWords, sourceWord))
      .sort(() => Math.random() - 0.5);
    const sourceNeighborTasks = possibleTasks.filter((task) => task.id.startsWith('adjacent-source-pair-')).slice(0, 1);
    const hiddenPairTasks = possibleTasks.filter((task) => task.id.startsWith('contains-pair-')).slice(0, 1);
    const otherTasks = possibleTasks.filter((task) => !task.id.startsWith('adjacent-source-pair-') && !task.id.startsWith('contains-pair-'));

    return [...sourceNeighborTasks, ...hiddenPairTasks, ...otherTasks]
      .sort(() => Math.random() - 0.5)
      .slice(0, BINGO_TASK_COUNT);
  }

  private completedBingoTasks(tasks: BingoTask[], word: string, playerWords: ReadonlySet<string>, sourceWord: string): string[] {
    const submittedWords = Array.from(playerWords);
    const previousWord = submittedWords.length >= 2 ? submittedWords[submittedWords.length - 2] : undefined;
    const previousLongest = submittedWords.slice(0, -1).reduce((longest, submitted) => Math.max(longest, submitted.length), 0);
    return tasks
      .filter((task) => this.bingoTaskMatches(task, word, previousWord, previousLongest, submittedWords, sourceWord))
      .map((task) => task.id);
  }

  private validateBattleRoyale(settings: GameSettings, playerCount: number): string | undefined {
    if (!this.usesKnockout(settings)) {
      return undefined;
    }

    if (settings.eliminationsPerRound * settings.rounds >= playerCount) {
      return 'Knockout would finish before all rounds are played. Lower eliminations, lower rounds, or add more players.';
    }

    return undefined;
  }

  private validateTeams(room: InternalRoom): string | undefined {
    if (!this.usesTeams(room.settings)) {
      return undefined;
    }

    const teamsWithPlayers = new Set(room.players.map((player) => player.teamId));
    if (!teamsWithPlayers.has('red') || !teamsWithPlayers.has('blue')) {
      return 'Team mode needs at least one player on Red Team and one player on Blue Team.';
    }

    return undefined;
  }

  private movePlayerMapEntry<T>(map: Map<string, T>, previousSocketId: string, nextSocketId: string): void {
    if (!map.has(previousSocketId)) return;
    const value = map.get(previousSocketId);
    map.delete(previousSocketId);
    if (value !== undefined) map.set(nextSocketId, value);
  }

  private movePlayerSetEntry(set: Set<string>, previousSocketId: string, nextSocketId: string): void {
    if (!set.delete(previousSocketId)) return;
    set.add(nextSocketId);
  }

  private queueRoundReminders(room: InternalRoom): void {
    for (const player of room.players) {
      const clientId = clientIdBySocketId.get(player.id);
      if (!clientId) continue;
      const isDisconnected = !this.io.sockets.sockets.has(player.id);
      if (!isDisconnected && !inactiveClientIds.has(clientId)) continue;

      dispatchPush(
        clientId,
        'Your Words of Word round is live',
        `Round ${room.currentRound} has started. Jump back into room ${room.id}.`,
        {
          kind: 'round-started',
          roomId: room.id,
          url: roomLink(room.id)
        }
      );
    }
  }

  private defaultTeamId(room: InternalRoom): 'red' | 'blue' {
    const redCount = room.players.filter((player) => player.teamId === 'red').length;
    const blueCount = room.players.filter((player) => player.teamId === 'blue').length;
    return redCount <= blueCount ? 'red' : 'blue';
  }

  public findRoomIdForSocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  /** Atomically preserve a player's game state when a mobile reconnection gets a new socket ID. */
  public rebindPlayerSocket(previousSocketId: string, nextSocketId: string): ManagerResult<{ roomId: string; snapshot: RoomSnapshot }> {
    const roomId = this.socketToRoom.get(previousSocketId);
    if (!roomId) {
      return { ok: false, error: 'Player was not in a room.' };
    }

    if (this.socketToRoom.has(nextSocketId)) {
      return { ok: false, error: 'Replacement socket is already in a room.' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    const player = room.players.find((candidate) => candidate.id === previousSocketId);
    if (!player) {
      return { ok: false, error: 'Player not found in room.' };
    }

    player.id = nextSocketId;
    if (room.hostId === previousSocketId) room.hostId = nextSocketId;

    this.movePlayerMapEntry(room.acceptedWords, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.roundPenalties, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.negativeWords, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.bustWords, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.currentBets, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.bettingWordCounts, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.bingoProgress, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.lastEmoteAt, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.playerJoinedAt, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.lastEmittedScores, previousSocketId, nextSocketId);
    this.movePlayerMapEntry(room.lightningTimeLeft, previousSocketId, nextSocketId);
    this.movePlayerSetEntry(room.bustedPlayers, previousSocketId, nextSocketId);
    this.movePlayerSetEntry(room.bingoCompletedBoards, previousSocketId, nextSocketId);

    this.socketToRoom.delete(previousSocketId);
    this.socketToRoom.set(nextSocketId, roomId);

    return { ok: true, data: { roomId, snapshot: this.toSnapshot(room) } };
  }

  public createRoom(socketId: string, username: string, avatar: PlayerAvatar, settings: GameSettings, isPublic = false): ManagerResult<RoomSnapshot> {
    const battleRoyaleError = this.validateBattleRoyale(settings, settings.maxPlayers);
    if (battleRoyaleError) {
      return { ok: false, error: battleRoyaleError };
    }

    let roomId = createRoomId();
    while (this.rooms.has(roomId)) {
      roomId = createRoomId();
    }

    const player: Player = {
      id: socketId,
      name: username,
      avatar,
      score: 0,
      isHost: true,
      ...(this.usesTeams(settings) ? { teamId: 'red' as const } : {})
    };

    const room: InternalRoom = {
      id: roomId,
      players: [player],
      settings,
      hostId: socketId,
      isPublic,
      phase: 'lobby',
      currentWord: '',
      timeLeft: this.roundSecondsFor(settings),
      lightningTimeLeft: new Map<string, number>(),
      currentRound: 0,
      validWords: new Set<string>(),
      acceptedWords: new Map([[socketId, new Set<string>()]]),
      roundPenalties: new Map([[socketId, 0]]),
      negativeWords: new Map([[socketId, []]]),
      bustWords: new Map<string, string>(),
      bustedPlayers: new Set<string>(),
      currentBets: new Map<string, number>(),
      bettingWordCounts: new Map([[socketId, []]]),
      bingoTasks: [],
      bingoProgress: new Map([[socketId, new Set<string>()]]),
      bingoCompletedBoards: new Set<string>(),
      lastEmoteAt: new Map<string, number>(),
      playerJoinedAt: new Map([[socketId, Date.now()]]),
      lastEmittedScores: new Map([[socketId, 0]]),
      playableRecorded: false,
      tickTimer: undefined,
      nextRoundTimer: undefined,
      emptyCleanupTimer: undefined,
      scoreUpdateTimer: undefined,
      waitingSeconds: 0
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    this.analytics.recordRoomCreated(settings, socketId);

    return { ok: true, data: this.toSnapshot(room) };
  }

  public listOnlineRooms(): OnlineRoomSummary[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.isPublic && room.phase !== 'gameOver' && room.players.length > 0 && room.players.length < room.settings.maxPlayers)
      .sort((left, right) => right.players.length - left.players.length || left.id.localeCompare(right.id))
      .slice(0, 9)
      .map((room) => ({
        roomId: room.id,
        hostName: room.players.find((player) => player.id === room.hostId)?.name ?? room.players[0]?.name ?? 'Host',
        gameMode: room.settings.gameMode,
        phase: room.phase,
        currentPlayers: room.players.length,
        maxPlayers: room.settings.maxPlayers,
        currentRound: room.currentRound,
        rounds: room.settings.rounds,
        timePerRound: this.roundSecondsFor(room.settings),
        minWordLength: room.settings.minWordLength
      }));
  }

  public checkRoom(roomId: string): RoomSnapshot | undefined {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      return undefined;
    }
    return this.toSnapshot(room);
  }

  private findOpenOnlineRoom(): InternalRoom | undefined {
    return Array.from(this.rooms.values())
      .filter((room) => room.isPublic && room.phase === 'lobby' && room.players.length < room.settings.maxPlayers)
      .sort((left, right) => right.players.length - left.players.length || left.id.localeCompare(right.id))[0];
  }

  public hasOpenOnlineRoom(): boolean {
    return Boolean(this.findOpenOnlineRoom());
  }

  public quickJoinRoom(socketId: string, username: string, avatar: PlayerAvatar): ManagerResult<{ snapshot: RoomSnapshot; player: Player; created: boolean }> {
    const openRoom = this.findOpenOnlineRoom();
    if (openRoom) {
      const joined = this.joinRoom(socketId, username, avatar, openRoom.id);
      if (!joined.ok) return joined;
      this.analytics.recordQuickJoin(false, socketId);
      return { ok: true, data: { ...joined.data, created: false } };
    }

    const created = this.createRoom(socketId, username, avatar, ONLINE_ROOM_SETTINGS, true);
    if (!created.ok) return created;
    const player = created.data.players.find((candidate) => candidate.id === socketId);
    if (!player) return { ok: false, error: 'Unable to create online room.' };
    this.analytics.recordQuickJoin(true, socketId);
    return { ok: true, data: { snapshot: created.data, player, created: true } };
  }

  public joinRoom(socketId: string, username: string, avatar: PlayerAvatar, roomId: string): ManagerResult<{ snapshot: RoomSnapshot; player: Player }> {
    roomId = roomId.toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    const existingPlayer = room.players.find((player) => player.id === socketId);
    if (existingPlayer) {
      return { ok: true, data: { snapshot: this.toSnapshot(room), player: existingPlayer } };
    }

    if (room.players.length >= room.settings.maxPlayers) {
      return { ok: false, error: 'Room is full.' };
    }

    if (room.phase === 'gameOver') {
      return { ok: false, error: 'This game has ended.' };
    }

    if (room.emptyCleanupTimer) {
      clearTimeout(room.emptyCleanupTimer);
      room.emptyCleanupTimer = undefined;
    }

    const isFirstPlayerBack = room.players.length === 0;
    const player: Player = {
      id: socketId,
      name: username,
      avatar,
      score: 0,
      isHost: isFirstPlayerBack,
      ...(this.usesTeams(room.settings) ? { teamId: this.defaultTeamId(room) } : {})
    };

    if (isFirstPlayerBack) {
      room.hostId = socketId;
    }

    room.players.push(player);
    room.playerJoinedAt.set(socketId, Date.now());
    room.lastEmittedScores.set(socketId, player.score);
    if (!room.playableRecorded && room.players.length >= 2) {
      room.playableRecorded = true;
      this.analytics.recordRoomBecamePlayable();
    }
    // Players who join during an active round are added to the room immediately,
    // but they start participating from the next round. Not adding them to
    // acceptedWords marks them as a non-participant for the current round.
    if (room.phase !== 'round') {
      room.acceptedWords.set(socketId, new Set<string>());
      room.roundPenalties.set(socketId, 0);
      room.negativeWords.set(socketId, []);
      room.bingoProgress.set(socketId, new Set<string>());
    }
    room.bettingWordCounts.set(socketId, []);
    this.socketToRoom.set(socketId, roomId);
    if (room.phase === 'round' || room.phase === 'betweenRounds' || room.phase === 'betting') {
      this.analytics.recordPlayerJoinedActiveGame(room.id, socketId);
    }
    this.analytics.recordRoomJoined(socketId);

    return { ok: true, data: { snapshot: this.toSnapshot(room), player } };
  }

  public updateTeam(socketId: string, roomId: string, teamId: 'red' | 'blue'): ManagerResult<EmptyResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    if (!this.usesTeams(room.settings)) {
      return { ok: false, error: 'Teams are only available in Team mode.' };
    }

    if (room.phase !== 'lobby') {
      return { ok: false, error: 'Teams are locked once the game starts.' };
    }

    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      return { ok: false, error: 'Player not found in this room.' };
    }

    const teamChanged = player.teamId !== teamId;
    player.teamId = teamId;
    if (teamChanged) this.analytics.recordTeamChanged(socketId);
    this.io.to(room.id).emit('roomSnapshot', { snapshot: this.toSnapshot(room) });
    return { ok: true, data: { ok: true } };
  }

  public updateSettings(socketId: string, roomId: string, settings: GameSettings): ManagerResult<EmptyResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    if (room.hostId !== socketId) {
      return { ok: false, error: 'Only the host can change settings.' };
    }

    if (room.phase !== 'lobby' && room.phase !== 'gameOver') {
      return { ok: false, error: 'Settings can only be changed before a game or after it ends.' };
    }

    if (settings.maxPlayers < room.players.length) {
      return { ok: false, error: `Max players cannot be lower than the ${room.players.length} players already in the room.` };
    }

    const battleRoyaleError = this.validateBattleRoyale(settings, room.players.length);
    if (battleRoyaleError) {
      return { ok: false, error: battleRoyaleError };
    }

    room.settings = settings;
    room.phase = 'lobby';
    room.timeLeft = this.roundSecondsFor(settings);
    room.lightningTimeLeft.clear();
    room.currentRound = 0;
    room.currentWord = '';
    room.validWords = new Set<string>();
    room.waitingSeconds = 0;
    room.players = room.players.map((player, index) => {
      const { teamId: _teamId, ...rest } = player;
      return {
        ...rest,
        score: 0,
        isEliminated: false,
        isHost: player.id === room.hostId,
        ...(this.usesTeams(settings)
          ? { teamId: player.teamId ?? (index % 2 === 0 ? 'red' as const : 'blue' as const) }
          : {})
      };
    });
    this.resetScores(room);
    this.analytics.recordSettingsUpdated(socketId);

    this.io.to(room.id).emit('roomSnapshot', { snapshot: this.toSnapshot(room) });
    this.io.to(room.id).emit('notice', { message: 'Settings updated by the host.' });
    return { ok: true, data: { ok: true } };
  }

  public updateBet(socketId: string, roomId: string, bet: number): ManagerResult<EmptyResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    if (room.settings.gameMode !== 'betting') {
      return { ok: false, error: 'Bets are only available in Betting mode.' };
    }

    if (room.phase !== 'betting') {
      return { ok: false, error: 'Betting is not open right now.' };
    }

    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player || player.isEliminated) {
      return { ok: false, error: 'Player not found in this room.' };
    }

    const minimumBet = this.minimumBetFor(room, socketId);
    if (bet < minimumBet) {
      return { ok: false, error: `Your minimum bet is ${minimumBet} word${minimumBet !== 1 ? 's' : ''}.` };
    }

    const previousBet = room.currentBets.get(socketId);
    room.currentBets.set(socketId, bet);
    if (previousBet !== bet) this.analytics.recordBetPlaced(socketId);
    this.io.to(room.id).emit('roomSnapshot', { snapshot: this.toSnapshot(room) });

    if (this.allActivePlayersBet(room)) {
      this.io.to(room.id).emit('notice', { message: 'All bets are locked. Revealing the word!' });
      setTimeout(() => {
        if (room.phase === 'betting') {
          this.startRound(room);
        }
      }, 500);
    }

    return { ok: true, data: { ok: true } };
  }

  public removePlayer(socketId: string, reason: PlayerRemovalReason = 'leave'): ManagerResult<{ roomId: string; snapshot: RoomSnapshot | undefined; hostChanged: boolean }> {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return { ok: false, error: 'Player was not in a room.' };
    }

    const room = this.rooms.get(roomId);
    this.socketToRoom.delete(socketId);

    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      return { ok: false, error: 'Player not found in room.' };
    }

    const joinedAt = room.playerJoinedAt.get(socketId) ?? Date.now();
    this.analytics.recordPlayerLeft({
      roomId,
      socketId,
      phase: room.phase,
      currentRound: room.currentRound,
      durationMs: Date.now() - joinedAt,
      reason
    });

    const wasHost = room.hostId === socketId;
    room.players = room.players.filter((candidate) => candidate.id !== socketId);
    room.acceptedWords.delete(socketId);
    room.roundPenalties.delete(socketId);
    room.negativeWords.delete(socketId);
    room.bustWords.delete(socketId);
    room.bustedPlayers.delete(socketId);
    room.bingoProgress.delete(socketId);
    room.bingoCompletedBoards.delete(socketId);
    room.lastEmoteAt.delete(socketId);
    room.playerJoinedAt.delete(socketId);
    room.lastEmittedScores.delete(socketId);
    room.lightningTimeLeft.delete(socketId);

    if (room.players.length === 0) {
      if (room.phase === 'round' || room.phase === 'betweenRounds' || room.phase === 'betting') {
        this.analytics.recordGameAbandoned(room.id, room.settings);
      }
      this.clearTickTimer(room);
      this.clearQueuedScoreUpdate(room);
      if (room.nextRoundTimer) {
        clearTimeout(room.nextRoundTimer);
        room.nextRoundTimer = undefined;
      }
      room.phase = 'lobby';
      room.currentWord = '';
      room.currentRound = 0;
      room.timeLeft = this.roundSecondsFor(room.settings);
      room.lightningTimeLeft.clear();
      room.waitingSeconds = 0;
      room.validWords.clear();
      room.acceptedWords.clear();
      room.roundPenalties.clear();
      room.negativeWords.clear();
      room.bustWords.clear();
      room.bustedPlayers.clear();
      room.bingoTasks = [];
      room.bingoProgress.clear();
      room.bingoCompletedBoards.clear();
      room.lastEmoteAt.clear();
      room.playerJoinedAt.clear();
      room.lastEmittedScores.clear();
      room.playableRecorded = false;
      room.emptyCleanupTimer = setTimeout(() => {
        this.clearTimers(room);
        this.rooms.delete(roomId);
      }, EMPTY_ROOM_TTL_MS);
      return { ok: true, data: { roomId, snapshot: undefined, hostChanged: false } };
    }

    let hostChanged = false;
    if (wasHost) {
      const nextHost = room.players[0];
      if (nextHost) {
        room.hostId = nextHost.id;
        hostChanged = true;
      }
    }

    room.players = room.players.map((player) => ({
      ...player,
      isHost: player.id === room.hostId
    }));

    return { ok: true, data: { roomId, snapshot: this.toSnapshot(room), hostChanged } };
  }

  public startGame(socketId: string, roomId: string): ManagerResult<EmptyResult> {
    roomId = roomId.toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    if (room.hostId !== socketId) {
      return { ok: false, error: 'Only the host can start the game.' };
    }

    if (room.players.length < 2) {
      return { ok: false, error: 'At least two players are required.' };
    }

    if (room.phase === 'round' || room.phase === 'betweenRounds' || room.phase === 'betting') {
      return { ok: false, error: 'A game is already in progress.' };
    }

    const teamsError = this.validateTeams(room);
    if (teamsError) {
      return { ok: false, error: teamsError };
    }

    const battleRoyaleError = this.validateBattleRoyale(room.settings, room.players.length);
    if (battleRoyaleError) {
      return { ok: false, error: battleRoyaleError };
    }

    this.resetScores(room);
    room.currentRound = 0;
    room.currentWord = '';
    room.timeLeft = this.roundSecondsFor(room.settings);
    room.validWords = new Set<string>();
    room.waitingSeconds = 0;
    this.analytics.recordGameStarted(room.id, room.settings, room.isPublic, room.players.map((player) => player.id));
    if (room.settings.gameMode === 'betting') {
      this.startBetting(room);
    } else {
      this.startRound(room);
    }

    return { ok: true, data: { ok: true } };
  }

  public submitWord(socketId: string, roomId: string, submittedWord: string): ManagerResult<EmptyResult> {
    roomId = roomId.toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    if (room.phase !== 'round') {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: 'Round is not active.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      return { ok: false, error: 'Player not found in this room.' };
    }

    if (player.isEliminated) {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: 'You have been eliminated from Knockout.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    if (this.usesBusted(room.settings) && room.bustedPlayers.has(socketId)) {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: 'You are busted for this round.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    const playerWords = room.acceptedWords.get(socketId);
    if (!playerWords) {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: 'You joined during this round and will play from the next round.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    if (this.usesLightning(room.settings) && (room.lightningTimeLeft.get(socketId) ?? 0) <= 0) {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: 'Your lightning timer is out for this round.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    const evaluation = evaluateSubmission(submittedWord, room.validWords, playerWords);
    if (!evaluation.isValid) {
      const penalty = this.applyPrecisionPenalty(room, player, evaluation.normalizedWord || submittedWord, playerWords.has(evaluation.normalizedWord) ? DUPLICATE_WORD_PENALTY : -scoreWord(evaluation.normalizedWord, 'precision'));
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: penalty < 0 ? `${evaluation.message} (${penalty} pts)` : evaluation.message,
        ...(penalty < 0 ? { penalty } : {})
      } satisfies WordRejectedPayload);
      this.emitScoresUpdated(room);
      return { ok: true, data: { ok: true } };
    }

    if (this.usesBusted(room.settings) && room.bustWords.has(socketId) && this.wordBustsPlayer(room, socketId, evaluation.normalizedWord)) {
      this.bustPlayer(room, player, evaluation.normalizedWord);
      return { ok: true, data: { ok: true } };
    }

    if (this.usesClaim(room.settings) && this.wordWasTakenByAnotherPlayer(room, socketId, evaluation.normalizedWord)) {
      const penalty = this.applyPrecisionPenalty(room, player, evaluation.normalizedWord, DUPLICATE_WORD_PENALTY);
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: penalty < 0 ? `That word was already made by someone else. (${penalty} pts)` : 'That word was already made by someone else.',
        ...(penalty < 0 ? { penalty } : {})
      } satisfies WordRejectedPayload);
      this.emitScoresUpdated(room);
      return { ok: true, data: { ok: true } };
    }

    if (this.usesBusted(room.settings) && !room.bustWords.has(socketId)) {
      room.bustWords.set(socketId, evaluation.normalizedWord);
    }

    const scoreBeforeWord = player.score;
    playerWords.add(evaluation.normalizedWord);
    let acceptedMessage = room.settings.gameMode === 'commonWord'
      ? this.applyCommonWordScore(room, player, evaluation.normalizedWord)
      : evaluation.message;
    if (room.settings.gameMode !== 'betting' && room.settings.gameMode !== 'commonWord' && room.settings.gameMode !== 'bingo') {
      player.score += scoreWord(evaluation.normalizedWord, this.scoringMode(room.settings));
    }
    if (room.settings.gameMode === 'bingo') {
      const progress = room.bingoProgress.get(socketId) ?? new Set<string>();
      room.bingoProgress.set(socketId, progress);

      if (room.bingoCompletedBoards.has(socketId)) {
        player.score += POINTS_PER_WORD;
        acceptedMessage = `${evaluation.message} +${POINTS_PER_WORD}`;
      } else {
        const newlyCompleted = this.completedBingoTasks(room.bingoTasks, evaluation.normalizedWord, playerWords, room.currentWord)
          .filter((taskId) => !progress.has(taskId));
        for (const taskId of newlyCompleted) {
          progress.add(taskId);
          player.score += BINGO_TASK_POINTS;
        }
        if (progress.size >= room.bingoTasks.length && room.bingoTasks.length > 0) {
          room.bingoCompletedBoards.add(socketId);
          player.score += BINGO_FULL_BOARD_BONUS;
          acceptedMessage = `${evaluation.message} Bingo board complete! +${BINGO_FULL_BOARD_BONUS}`;
        } else if (newlyCompleted.length > 0) {
          acceptedMessage = `${evaluation.message} Bingo task complete! +${newlyCompleted.length * BINGO_TASK_POINTS}`;
        }
      }
    }
    const hitSprintTarget = this.sprintTargetReached(room, player, playerWords);
    if (hitSprintTarget) {
      player.score += FASTEST_N_BONUS;
    }

    this.analytics.recordWordAccepted(socketId);

    this.io.to(socketId).emit('wordAccepted', {
      playerId: socketId,
      word: evaluation.normalizedWord,
      words: Array.from(playerWords).sort(),
      message: acceptedMessage,
      score: player.score,
      scoreDelta: player.score - scoreBeforeWord
    } satisfies WordAcceptedPayload);
    this.emitScoresUpdated(room);

    if (this.usesLightning(room.settings)) {
      room.lightningTimeLeft.set(socketId, (room.lightningTimeLeft.get(socketId) ?? 0) + 1);
      room.timeLeft = Math.max(0, ...Array.from(room.lightningTimeLeft.values()));
      this.io.to(room.id).emit('timeUpdate', { timeLeft: room.timeLeft, lightningTimeLeft: Object.fromEntries(room.lightningTimeLeft) });
    }

    if (hitSprintTarget) {
      const message = this.usesTeams(room.settings) && player.teamId
        ? `${TEAM_NAMES[player.teamId]} reached ${room.settings.fastestWordTarget} words first. ${player.name} earned a ${FASTEST_N_BONUS} point sprint bonus!`
        : `${player.name} reached ${room.settings.fastestWordTarget} words first and earned a ${FASTEST_N_BONUS} point bonus!`;
      this.io.to(room.id).emit('notice', { message });
      this.finishRound(room);
    }

    return { ok: true, data: { ok: true } };
  }

  public sendEmote(socketId: string, roomId: string, emote: Emote): ManagerResult<EmptyResult> {
    roomId = roomId.toUpperCase();
    if (this.socketToRoom.get(socketId) !== roomId) {
      return { ok: false, error: 'You are no longer in this room.' };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) {
      return { ok: false, error: 'Player not found in this room.' };
    }

    const now = Date.now();
    const lastEmoteAt = room.lastEmoteAt.get(socketId) ?? 0;
    if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) {
      return { ok: false, error: 'Give your last emote a moment.' };
    }

    room.lastEmoteAt.set(socketId, now);
    this.analytics.recordEmoteSent(socketId);
    this.io.to(room.id).emit('emotePlayed', {
      playerId: player.id,
      playerName: player.name,
      emote
    } satisfies EmotePlayedPayload);

    return { ok: true, data: { ok: true } };
  }

  public restartGame(socketId: string, roomId: string, autoStart: boolean): ManagerResult<EmptyResult> {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    if (room.hostId !== socketId) {
      return { ok: false, error: 'Only the host can restart the game.' };
    }

    if (autoStart) {
      if (room.players.length < 2) {
        return { ok: false, error: 'At least two players are required.' };
      }
      const teamsError = this.validateTeams(room);
      if (teamsError) {
        return { ok: false, error: teamsError };
      }
      const battleRoyaleError = this.validateBattleRoyale(room.settings, room.players.length);
      if (battleRoyaleError) {
        return { ok: false, error: battleRoyaleError };
      }
    }

    const wasActiveGame = room.phase === 'round' || room.phase === 'betweenRounds' || room.phase === 'betting';
    if (wasActiveGame) this.analytics.recordGameAbandoned(room.id, room.settings, room.players.map((player) => player.id));
    this.analytics.recordGameRestarted(socketId);

    this.clearTimers(room);
    this.resetScores(room);
    room.phase = 'lobby';
    room.currentWord = '';
    room.currentRound = 0;
    room.timeLeft = this.roundSecondsFor(room.settings);
    room.lightningTimeLeft.clear();
    room.validWords = new Set<string>();
    room.waitingSeconds = 0;

    this.io.to(roomId).emit('gameRestarted', {
      snapshot: this.toSnapshot(room),
      autoStart
    } satisfies GameRestartedPayload);

    if (autoStart && room.players.length >= 2) {
      setTimeout(() => {
        this.analytics.recordGameStarted(room.id, room.settings, room.isPublic, room.players.map((player) => player.id));
        if (room.settings.gameMode === 'betting') {
          this.startBetting(room);
        } else {
          this.startRound(room);
        }
      }, 500);
    }

    return { ok: true, data: { ok: true } };
  }

  private recentAverageWordsFor(room: InternalRoom, playerId: string): number {
    const counts = room.bettingWordCounts.get(playerId) ?? [];
    if (counts.length === 0) {
      return 0;
    }

    return counts.reduce((total, count) => total + count, 0) / counts.length;
  }

  private minimumBetFor(room: InternalRoom, playerId: string): number {
    const average = this.recentAverageWordsFor(room, playerId);
    if (average <= 0) {
      return 3;
    }

    return Math.max(3, Math.floor(average) + 1);
  }

  private allActivePlayersBet(room: InternalRoom): boolean {
    return this.activePlayers(room).every((player) => room.currentBets.has(player.id));
  }

  private automaticBetFor(room: InternalRoom, playerId: string): number {
    return this.minimumBetFor(room, playerId);
  }

  private lockMissingBets(room: InternalRoom): void {
    for (const player of this.activePlayers(room)) {
      if (!room.currentBets.has(player.id)) {
        room.currentBets.set(player.id, this.automaticBetFor(room, player.id));
      }
    }
  }

  private startBetting(room: InternalRoom): void {
    this.clearTimers(room);

    if (room.currentRound >= room.settings.rounds) {
      this.finishGame(room);
      return;
    }

    room.phase = 'betting';
    room.currentWord = '';
    room.timeLeft = BETTING_SECONDS;
    room.lightningTimeLeft.clear();
    room.validWords = new Set<string>();
    room.waitingSeconds = 0;
    room.currentBets = new Map<string, number>();
    room.bingoTasks = [];
    room.bingoProgress = this.emptyBingoProgress(room);
    room.bingoCompletedBoards = new Set<string>();
    room.acceptedWords = this.emptyAcceptedWords(room);
    room.roundPenalties = this.emptyRoundPenalties(room);
    room.negativeWords = this.emptyNegativeWords(room);
    room.bustWords = new Map<string, string>();
    room.bustedPlayers = new Set<string>();

    this.io.to(room.id).emit('roomSnapshot', { snapshot: this.toSnapshot(room) });
    this.io.to(room.id).emit('notice', { message: `Place your bet for round ${room.currentRound + 1}. You have ${BETTING_SECONDS} seconds.` });

    room.tickTimer = setInterval(() => {
      if (room.phase !== 'betting') {
        this.clearTickTimer(room);
        return;
      }

      room.timeLeft -= 1;
      this.io.to(room.id).emit('timeUpdate', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        this.lockMissingBets(room);
        this.io.to(room.id).emit('roomSnapshot', { snapshot: this.toSnapshot(room) });
        this.io.to(room.id).emit('notice', { message: 'Time up. Missing bets were locked automatically.' });
        setTimeout(() => {
          if (room.phase === 'betting') {
            this.startRound(room);
          }
        }, 500);
      }
    }, 1000);
  }

  private startRound(room: InternalRoom): void {
    this.clearTimers(room);

    if (room.currentRound >= room.settings.rounds || (this.usesKnockout(room.settings) && this.activePlayers(room).length <= 1)) {
      this.finishGame(room);
      return;
    }

    const sourceDictionary = this.sourceDictionaryFor(room);
    const sourceWord = LOCAL_LOAD_TEST_SOURCE_WORD ?? chooseSourceWord(sourceDictionary, room.settings.minWordLength);
    if (!sourceWord) {
      this.io.to(room.id).emit('notice', { message: 'No source words are available for these settings.' });
      return;
    }

    room.currentRound += 1;
    room.phase = 'round';
    room.currentWord = sourceWord.toLowerCase();
    room.timeLeft = this.roundSecondsFor(room.settings);
    room.lightningTimeLeft = this.usesLightning(room.settings)
      ? new Map(this.activePlayers(room).map((player) => [player.id, LIGHTNING_SECONDS]))
      : new Map<string, number>();
    room.validWords = createValidWordsFromIndex(room.currentWord, this.validWordIndex);
    room.waitingSeconds = 0;
    room.acceptedWords = this.emptyAcceptedWords(room);
    room.roundPenalties = this.emptyRoundPenalties(room);
    room.negativeWords = this.emptyNegativeWords(room);
    room.bustWords = new Map<string, string>();
    room.bustedPlayers = new Set<string>();
    room.bingoTasks = room.settings.gameMode === 'bingo' ? this.createBingoTasks(room.currentWord, room.validWords) : [];
    room.bingoProgress = this.emptyBingoProgress(room);
    room.bingoCompletedBoards = new Set<string>();
    room.lastEmittedScores = new Map(room.players.map((player) => [player.id, player.score]));
    this.analytics.recordRoundStarted(room.id, this.activePlayers(room).map((player) => player.id));

    this.io.to(room.id).emit('roundStarted', {
      currentWord: room.currentWord,
      timeLeft: room.timeLeft,
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds,
      snapshot: this.toSnapshot(room)
    } satisfies RoundStartedPayload);
    this.queueRoundReminders(room);

    room.tickTimer = setInterval(() => {
      if (room.phase !== 'round') {
        this.clearTickTimer(room);
        return;
      }

      if (this.usesLightning(room.settings)) {
        for (const player of this.activePlayers(room)) {
          const current = room.lightningTimeLeft.get(player.id);
          if (current !== undefined && current > 0) {
            room.lightningTimeLeft.set(player.id, Math.max(0, current - 1));
          }
        }
        room.timeLeft = Math.max(0, ...Array.from(room.lightningTimeLeft.values()));
        this.io.to(room.id).emit('timeUpdate', { timeLeft: room.timeLeft, lightningTimeLeft: Object.fromEntries(room.lightningTimeLeft) });

        const activeTimers = this.activePlayers(room).map((player) => room.lightningTimeLeft.get(player.id) ?? 0);
        if (activeTimers.length === 0 || activeTimers.every((timeLeft) => timeLeft <= 0)) {
          this.finishRound(room);
        }
        return;
      }

      room.timeLeft -= 1;
      this.io.to(room.id).emit('timeUpdate', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        this.finishRound(room);
      }
    }, 1000);
  }

  private finishRound(room: InternalRoom): void {
    if (room.phase !== 'round') {
      return;
    }

    this.clearTickTimer(room);
    this.clearQueuedScoreUpdate(room);

    const playerWords = this.acceptedWordsRecord(room);
    if (room.settings.gameMode === 'betting') {
      this.applyBettingScores(room, playerWords);
    }
    const results = this.roundResults(room, playerWords);
    this.analytics.recordRoundCompleted(room.id);

    if (this.usesKnockout(room.settings)) {
      this.eliminateLowestScorers(room);
    }
    const isGameOver = room.currentRound >= room.settings.rounds;

    if (isGameOver) {
      this.finishGame(room, {
        playerWords,
        validWords: Array.from(room.validWords).sort(),
        results,
        currentRound: room.currentRound
      });
      return;
    }

    room.phase = 'betweenRounds';
    room.waitingSeconds = WAIT_BETWEEN_ROUNDS_SECONDS;

    this.io.to(room.id).emit('roundEnded', {
      scores: this.scoreEntries(room),
      playerWords,
      validWords: Array.from(room.validWords).sort(),
      isGameOver: false,
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds,
      nextRoundStartsIn: WAIT_BETWEEN_ROUNDS_SECONDS,
      results,
      snapshot: this.toSnapshot(room)
    } satisfies RoundEndedPayload);

    room.nextRoundTimer = setTimeout(() => {
      room.waitingSeconds = 0;
      if (room.settings.gameMode === 'betting') {
        this.startBetting(room);
      } else {
        this.startRound(room);
      }
    }, WAIT_BETWEEN_ROUNDS_SECONDS * 1000);
  }

  private finishGame(room: InternalRoom, finalRound?: { playerWords: Record<string, string[]>; validWords: string[]; results: RoundResultPlayer[]; currentRound: number }): void {
    this.clearTimers(room);
    room.phase = 'gameOver';
    room.waitingSeconds = 0;

    const playerWords = finalRound?.playerWords ?? this.acceptedWordsRecord(room);
    let previousScore: number | undefined;
    let currentRank = 0;

    const finalScores = [...room.players]
      .sort((left, right) => right.score - left.score)
      .map((player) => {
        if (previousScore === undefined || player.score !== previousScore) {
          currentRank += 1;
          previousScore = player.score;
        }

        return {
          playerId: player.id,
          playerName: player.name,
          score: player.score,
          rank: currentRank
        };
      });

    this.analytics.recordGameFinished(room.id, room.settings, room.players.map((player) => player.id));

    const payload: GameOverPayload = {
      finalScores,
      playerWords,
      snapshot: this.toSnapshot(room)
    };

    if (finalRound) {
      payload.currentRound = finalRound.currentRound;
      payload.validWords = finalRound.validWords;
      payload.results = finalRound.results;
    }

    this.io.to(room.id).emit('gameOver', payload);
  }

  private resetScores(room: InternalRoom): void {
    room.players = room.players.map((player) => ({
      ...player,
      score: 0,
      isHost: player.id === room.hostId,
      isEliminated: false
    }));
    room.acceptedWords = this.emptyAcceptedWords(room);
    room.roundPenalties = this.emptyRoundPenalties(room);
    room.negativeWords = this.emptyNegativeWords(room);
    room.bustWords = new Map<string, string>();
    room.bustedPlayers = new Set<string>();
    room.currentBets = new Map<string, number>();
    room.bettingWordCounts = new Map(room.players.map((player) => [player.id, []]));
    room.bingoTasks = [];
    room.bingoProgress = this.emptyBingoProgress(room);
    room.bingoCompletedBoards = new Set<string>();
    room.lastEmoteAt = new Map<string, number>();
    room.lastEmittedScores = new Map(room.players.map((player) => [player.id, player.score]));
  }

  private emptyAcceptedWords(room: InternalRoom): Map<string, Set<string>> {
    const acceptedWords = new Map<string, Set<string>>();
    for (const player of room.players) {
      acceptedWords.set(player.id, new Set<string>());
    }
    return acceptedWords;
  }

  private emptyRoundPenalties(room: InternalRoom): Map<string, number> {
    return new Map(room.players.map((player) => [player.id, 0]));
  }

  private emptyBingoProgress(room: InternalRoom): Map<string, Set<string>> {
    return new Map(room.players.map((player) => [player.id, new Set<string>()]));
  }

  private emptyNegativeWords(room: InternalRoom): Map<string, Array<{ word: string; penalty: number }>> {
    return new Map(room.players.map((player) => [player.id, []]));
  }

  private applyPrecisionPenalty(room: InternalRoom, player: Player, word: string, penalty: number): number {
    if (room.settings.gameMode !== 'precision') {
      return 0;
    }

    const normalizedWord = word.trim().toLowerCase() || word;
    player.score += penalty;
    room.roundPenalties.set(player.id, (room.roundPenalties.get(player.id) ?? 0) + penalty);
    room.negativeWords.set(player.id, [...(room.negativeWords.get(player.id) ?? []), { word: normalizedWord, penalty }]);
    return penalty;
  }

  private emitScoresUpdated(room: InternalRoom): void {
    // A burst of simultaneous submissions should result in one compact update
    // per room per short window, not one room-wide network fanout per word.
    if (room.scoreUpdateTimer) return;
    room.scoreUpdateTimer = setTimeout(() => {
      room.scoreUpdateTimer = undefined;
      this.sendScoresUpdated(room);
    }, SCORE_UPDATE_BATCH_MS);
  }

  private sendScoresUpdated(room: InternalRoom): void {
    const compactSocketIds = room.players
      .map((player) => player.id)
      .filter((socketId) => this.io.sockets.sockets.has(socketId) && compactScoreUpdateSocketIds.has(socketId));
    const legacySocketIds = room.players
      .map((player) => player.id)
      .filter((socketId) => this.io.sockets.sockets.has(socketId) && !compactScoreUpdateSocketIds.has(socketId));
    const changedScores = this.changedScoreEntries(room);

    if (compactSocketIds.length > 0) {
      // This event can fire frequently. Keep it incremental rather than
      // serializing every player avatar and every accepted word to every socket.
      const payload: ScoresUpdatedPayload = { scores: changedScores };

      if (this.usesTeams(room.settings)) {
        payload.teamScores = this.teamScores(room);
      }
      if (room.settings.gameMode === 'betting') {
        payload.acceptedWordCounts = this.acceptedWordCountsRecord(room);
        payload.bettingBets = Object.fromEntries(room.currentBets);
        payload.bettingAverages = Object.fromEntries(room.players.map((player) => [player.id, this.recentAverageWordsFor(room, player.id)]));
        payload.minimumBets = Object.fromEntries(room.players.map((player) => [player.id, this.minimumBetFor(room, player.id)]));
      }
      if (room.settings.gameMode === 'bingo') {
        payload.bingoProgress = Object.fromEntries(Array.from(room.bingoProgress.entries()).map(([playerId, tasks]) => [playerId, Array.from(tasks)]));
      }

      this.io.to(compactSocketIds).emit('scoresUpdated', payload);
    }

    if (legacySocketIds.length > 0) {
      // Keep previously released browser and Capacitor bundles working while
      // newly connected clients use the compact protocol above.
      this.io.to(legacySocketIds).emit('scoresUpdated', {
        scores: this.scoreEntries(room),
        snapshot: this.toSnapshot(room)
      } satisfies ScoresUpdatedPayload);
    }
  }

  private wordWasTakenByAnotherPlayer(room: InternalRoom, playerId: string, word: string): boolean {
    for (const [acceptedPlayerId, words] of room.acceptedWords.entries()) {
      if (acceptedPlayerId !== playerId && words.has(word)) {
        return true;
      }
    }
    return false;
  }

  private applyCommonWordScore(room: InternalRoom, player: Player, word: string): string {
    const matchingPlayers = room.players.filter((candidate) => candidate.id !== player.id && (room.acceptedWords.get(candidate.id) ?? new Set<string>()).has(word));
    const uniquePoints = this.commonUniquePoints(word);

    if (matchingPlayers.length === 0) {
      player.score += uniquePoints;
      return uniquePoints === COMMON_RARE_WORD_POINTS ? 'Rare unique word! +5 points' : 'Unique word! +3 points';
    }

    player.score += DUPLICATE_WORD_PENALTY;
    room.negativeWords.set(player.id, [...(room.negativeWords.get(player.id) ?? []), { word, penalty: DUPLICATE_WORD_PENALTY }]);

    for (const matchingPlayer of matchingPlayers) {
      const negativeWords = room.negativeWords.get(matchingPlayer.id) ?? [];
      if (!negativeWords.some((entry) => entry.word === word)) {
        matchingPlayer.score -= uniquePoints - DUPLICATE_WORD_PENALTY;
        room.negativeWords.set(matchingPlayer.id, [...negativeWords, { word, penalty: DUPLICATE_WORD_PENALTY }]);
      }
    }

    const names = matchingPlayers.map((matchingPlayer) => matchingPlayer.name).join(', ');
    this.io.to(room.id).emit('notice', { message: `Common word: "${word}" matched with ${names}. Everyone using it gets -3.` });
    return 'Common word! -3 points';
  }

  private commonUniquePoints(word: string): number {
    return word.length >= COMMON_RARE_WORD_MIN_LENGTH ? COMMON_RARE_WORD_POINTS : POINTS_PER_WORD;
  }

  private wordBustsPlayer(room: InternalRoom, playerId: string, word: string): boolean {
    const playerBustWord = room.bustWords.get(playerId);
    if (playerBustWord === word) {
      return false;
    }

    for (const [ownerId, bustWord] of room.bustWords.entries()) {
      if (ownerId !== playerId && bustWord === word) {
        return true;
      }
    }

    return false;
  }

  private bustPlayer(room: InternalRoom, player: Player, word: string): void {
    const playerWords = room.acceptedWords.get(player.id) ?? new Set<string>();
    const roundScore = Array.from(playerWords).reduce((total, acceptedWord) => total + scoreWord(acceptedWord, room.settings.gameMode), 0);
    player.score -= roundScore;
    room.bustedPlayers.add(player.id);

    const message = `💣 BOOM! ${player.name} is busted for typing "${word}".`;
    this.io.to(room.id).emit('playerBusted', {
      playerId: player.id,
      playerName: player.name,
      word,
      message,
      snapshot: this.toSnapshot(room)
    } satisfies PlayerBustedPayload);
    this.emitScoresUpdated(room);
  }

  private eliminateLowestScorers(room: InternalRoom): void {
    const activePlayers = this.activePlayers(room).filter((player) => room.acceptedWords.has(player.id));
    const eliminationCount = Math.min(room.settings.eliminationsPerRound, Math.max(0, activePlayers.length - 1));
    if (eliminationCount <= 0) {
      return;
    }

    const eliminatedPlayers = [...activePlayers]
      .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
      .slice(0, eliminationCount);
    const eliminatedIds = new Set(eliminatedPlayers.map((player) => player.id));

    room.players = room.players.map((player) => ({
      ...player,
      isEliminated: player.isEliminated || eliminatedIds.has(player.id)
    }));

    if (eliminatedPlayers.length > 0) {
      this.io.to(room.id).emit('notice', {
        message: `${eliminatedPlayers.map((player) => player.name).join(', ')} eliminated from Knockout.`
      });
    }
  }

  private toSnapshot(room: InternalRoom): RoomSnapshot {
    const players = room.players.map((player) => ({
      ...player,
      isHost: player.id === room.hostId
    }));

    return {
      roomId: room.id,
      players,
      settings: room.settings,
      hostId: room.hostId,
      status: {
        isFull: room.players.length >= room.settings.maxPlayers,
        maxPlayers: room.settings.maxPlayers,
        currentPlayers: room.players.length,
        message: `${room.players.length}/${room.settings.maxPlayers} players`
      },
      phase: room.phase,
      currentWord: room.currentWord,
      timeLeft: room.timeLeft,
      lightningTimeLeft: Object.fromEntries(room.lightningTimeLeft),
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds,
      acceptedWords: this.acceptedWordsRecord(room),
      acceptedWordCounts: this.acceptedWordCountsRecord(room),
      teamScores: this.teamScores(room),
      bettingBets: Object.fromEntries(room.currentBets),
      bettingAverages: Object.fromEntries(room.players.map((player) => [player.id, this.recentAverageWordsFor(room, player.id)])),
      minimumBets: Object.fromEntries(room.players.map((player) => [player.id, this.minimumBetFor(room, player.id)])),
      waitingSeconds: room.waitingSeconds,
      bustWords: Object.fromEntries(room.bustWords),
      bustedPlayers: Object.fromEntries(room.players.map((player) => [player.id, room.bustedPlayers.has(player.id)])),
      bingoTasks: room.bingoTasks,
      bingoProgress: Object.fromEntries(Array.from(room.bingoProgress.entries()).map(([playerId, tasks]) => [playerId, Array.from(tasks)]))
    };
  }

  private teamScores(room: InternalRoom): RoomSnapshot['teamScores'] {
    if (!this.usesTeams(room.settings)) {
      return [];
    }

    return (['red', 'blue'] as const).map((teamId) => {
      const players = room.players.filter((player) => player.teamId === teamId);
      return {
        teamId,
        teamName: TEAM_NAMES[teamId],
        score: players.reduce((total, player) => total + player.score, 0),
        players: players.map((player) => player.id)
      };
    });
  }

  private applyBettingScores(room: InternalRoom, playerWords: Record<string, string[]>): void {
    for (const player of room.players) {
      if (!room.acceptedWords.has(player.id)) {
        continue;
      }
      const bet = room.currentBets.get(player.id) ?? this.minimumBetFor(room, player.id);
      const actualWords = playerWords[player.id]?.length ?? 0;
      const extraWords = Math.max(0, actualWords - bet);
      const roundScore = actualWords >= bet
        ? bet * BETTING_BASE_POINTS + extraWords * BETTING_EXTRA_WORD_POINTS
        : -(bet * BETTING_BASE_POINTS);

      player.score += roundScore;
      const history = room.bettingWordCounts.get(player.id) ?? [];
      history.push(actualWords);
      room.bettingWordCounts.set(player.id, history);
    }
  }

  private roundResults(room: InternalRoom, playerWords: Record<string, string[]>): RoundResultPlayer[] {
    const commonWordCounts = new Map<string, number>();
    if (room.settings.gameMode === 'commonWord') {
      for (const words of Object.values(playerWords)) {
        for (const word of words) {
          commonWordCounts.set(word, (commonWordCounts.get(word) ?? 0) + 1);
        }
      }
    }

    return room.players.map((player) => {
      const words = playerWords[player.id] ?? [];
      const participatedThisRound = room.acceptedWords.has(player.id);
      const bet = room.currentBets.get(player.id) ?? this.minimumBetFor(room, player.id);
      const wordScore = room.settings.gameMode === 'betting' && !participatedThisRound
        ? 0
        : room.settings.gameMode === 'betting'
        ? words.length >= bet
          ? bet * BETTING_BASE_POINTS + Math.max(0, words.length - bet) * BETTING_EXTRA_WORD_POINTS
          : -(bet * BETTING_BASE_POINTS)
        : room.settings.gameMode === 'commonWord'
          ? words.reduce((total, word) => total + ((commonWordCounts.get(word) ?? 0) > 1 ? DUPLICATE_WORD_PENALTY : this.commonUniquePoints(word)), 0)
          : room.settings.gameMode === 'bingo'
            ? (room.bingoProgress.get(player.id)?.size ?? 0) * BINGO_TASK_POINTS + (room.bingoCompletedBoards.has(player.id) ? BINGO_FULL_BOARD_BONUS : 0)
            : words.reduce((total, word) => total + scoreWord(word, this.scoringMode(room.settings)), 0);
      const bustedScoreOverride = this.usesBusted(room.settings) && room.bustedPlayers.has(player.id);
      const fastestBonus = this.usesWordSprint(room.settings) && words.length >= room.settings.fastestWordTarget
        ? FASTEST_N_BONUS
        : 0;

      const precisionPenalty = room.settings.gameMode === 'precision'
        ? room.roundPenalties.get(player.id) ?? 0
        : 0;
      const showNegativeWords = room.settings.gameMode === 'precision' || room.settings.gameMode === 'commonWord';

      return {
        playerId: player.id,
        playerName: player.name,
        score: bustedScoreOverride ? 0 : wordScore + fastestBonus + precisionPenalty,
        words,
        negativeWords: showNegativeWords ? room.negativeWords.get(player.id) ?? [] : [],
        ...(room.settings.gameMode === 'betting' ? {
          bettingBet: bet,
          bettingHit: words.length >= bet
        } : {})
      };
    });
  }

  private acceptedWordsRecord(room: InternalRoom): Record<string, string[]> {
    const record: Record<string, string[]> = {};
    for (const [playerId, playerWords] of room.acceptedWords.entries()) {
      record[playerId] = Array.from(playerWords).sort();
    }
    return record;
  }

  private acceptedWordCountsRecord(room: InternalRoom): Record<string, number> {
    return Object.fromEntries(Array.from(room.acceptedWords.entries()).map(([playerId, playerWords]) => [playerId, playerWords.size]));
  }

  private scoreEntries(room: InternalRoom): Array<[string, number]> {
    return room.players.map((player) => [player.id, player.score]);
  }

  private changedScoreEntries(room: InternalRoom): Array<[string, number]> {
    const changed = room.players
      .filter((player) => room.lastEmittedScores.get(player.id) !== player.score)
      .map((player) => [player.id, player.score] as [string, number]);
    room.lastEmittedScores = new Map(room.players.map((player) => [player.id, player.score]));
    return changed;
  }

  private clearTimers(room: InternalRoom): void {
    this.clearTickTimer(room);
    this.clearQueuedScoreUpdate(room);
    if (room.nextRoundTimer) {
      clearTimeout(room.nextRoundTimer);
      room.nextRoundTimer = undefined;
    }
    if (room.emptyCleanupTimer) {
      clearTimeout(room.emptyCleanupTimer);
      room.emptyCleanupTimer = undefined;
    }
  }

  private clearTickTimer(room: InternalRoom): void {
    if (room.tickTimer) {
      clearInterval(room.tickTimer);
      room.tickTimer = undefined;
    }
  }

  private clearQueuedScoreUpdate(room: InternalRoom): void {
    if (room.scoreUpdateTimer) {
      clearTimeout(room.scoreUpdateTimer);
      room.scoreUpdateTimer = undefined;
    }
  }
}

function reply<T>(ack: ((response: ServerAck<T>) => void) | undefined, response: ServerAck<T>): void {
  if (ack) {
    ack(response);
  }
}

function validationMessage(errorMessage: string): string {
  return errorMessage || 'Invalid request.';
}

// Do not let framework request logs turn connection metadata into analytics.
const fastify = Fastify({ logger: true, disableRequestLogging: true });

const configuredOrigin = process.env.CLIENT_ORIGIN;
const clientOrigins: string[] | boolean = configuredOrigin
  ? configuredOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  : true;

await fastify.register(cors, {
  origin: clientOrigins,
  methods: ['GET', 'POST']
});

const analyticsPersistence = createAnalyticsPersistence({
  filePath: ANALYTICS_AGGREGATE_FILE,
  ...(ANALYTICS_DATABASE_URL ? { databaseUrl: ANALYTICS_DATABASE_URL } : {}),
  requireDurableStorage: REQUIRE_DURABLE_ANALYTICS
});
const analytics = new AggregateAnalyticsStore(
  analyticsPersistence,
  (message, error) => fastify.log.warn({ error }, message),
  ANALYTICS_MIGRATION_FILE
);
await analytics.load();
fastify.log.info({ storage: analyticsPersistence.kind }, 'product analytics storage ready');

const ANALYTICS_SESSION_COOKIE = 'wow_analytics_session';
const ANALYTICS_SESSION_CONTEXT = 'words-of-word:analytics-admin-session:v1';

function secretsMatch(providedValue: string | undefined, expectedValue: string): boolean {
  if (!providedValue) return false;

  const provided = Buffer.from(providedValue);
  const expected = Buffer.from(expectedValue);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function hasAnalyticsAdminAccess(authorization: string | undefined): boolean {
  const configuredToken = process.env.ANALYTICS_TOKEN;
  if (!configuredToken || !authorization?.startsWith('Bearer ')) return false;

  return secretsMatch(authorization.slice('Bearer '.length), configuredToken);
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;

  for (const segment of cookieHeader.split(';')) {
    const [cookieName, ...valueParts] = segment.trim().split('=');
    if (cookieName === name) return valueParts.join('=');
  }

  return undefined;
}

function analyticsSessionValue(analyticsToken: string): string {
  return createHmac('sha256', analyticsToken)
    .update(ANALYTICS_SESSION_CONTEXT)
    .digest('base64url');
}

function hasAnalyticsSessionAccess(cookieHeader: string | undefined): boolean {
  const configuredToken = process.env.ANALYTICS_TOKEN;
  if (!configuredToken) return false;

  return secretsMatch(
    cookieValue(cookieHeader, ANALYTICS_SESSION_COOKIE),
    analyticsSessionValue(configuredToken)
  );
}

function prefersHtml(accept: string | undefined): boolean {
  if (!accept) return false;

  return accept.split(',').some((value) => {
    const [mediaType = '', ...parameters] = value.split(';').map((part) => part.trim());
    if (mediaType.toLowerCase() !== 'text/html') return false;

    const qualityParameter = parameters.find((parameter) => parameter.toLowerCase().startsWith('q='));
    if (!qualityParameter) return true;

    const quality = Number(qualityParameter.slice(2));
    return Number.isFinite(quality) && quality > 0;
  });
}

function isSecureRequest(forwardedProtocol: string | string[] | undefined): boolean {
  const values = Array.isArray(forwardedProtocol) ? forwardedProtocol : [forwardedProtocol];
  return process.env.NODE_ENV === 'production'
    || values.some((value) => value?.split(',').some((protocol) => protocol.trim() === 'https'));
}

function analyticsSessionCookie(value: string, secure: boolean, clear = false): string {
  return [
    `${ANALYTICS_SESSION_COOKIE}=${value}`,
    'Path=/admin/analytics',
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
    ...(clear ? ['Max-Age=0'] : [])
  ].join('; ');
}

function analyticsAppCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join('; ');
}

async function sendAnalyticsApplication(reply: import('fastify').FastifyReply): Promise<import('fastify').FastifyReply> {
  const indexFile = join(WEB_DIST_DIR, 'index.html');
  if (!existsSync(indexFile)) {
    return reply.code(404).send({ ok: false, error: 'Web build not found. Run pnpm build first.' });
  }

  return reply
    .header('Cache-Control', 'no-store')
    .header('Content-Security-Policy', analyticsAppCsp())
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Content-Type-Options', 'nosniff')
    .header('X-Frame-Options', 'DENY')
    .header('Vary', 'Accept')
    .type('text/html; charset=utf-8')
    .send(await readFile(indexFile));
}

fastify.get('/health', async () => ({ ok: true }));

fastify.get('/stats', async () => ({ ok: true, data: analytics.publicStats() }));

fastify.post('/api/daily/validate-word', async (request, reply) => {
  const payload = DailyWordValidationPayloadSchema.safeParse(request.body);
  if (!payload.success) {
    return reply
      .header('Cache-Control', 'no-store')
      .code(400)
      .send({ ok: false, error: validationMessage(payload.error.issues[0]?.message ?? 'Invalid daily word validation request.') });
  }

  return reply
    .header('Cache-Control', 'no-store')
    .send({ ok: true, data: evaluateDailyWordSubmission(payload.data.sourceWord, payload.data.word) });
});

fastify.post('/admin/analytics/session', async (request, reply) => {
  const configuredToken = process.env.ANALYTICS_TOKEN;
  if (!configuredToken) return reply.code(404).send({ ok: false, error: 'Not found.' });

  const payload = AnalyticsPasswordPayloadSchema.safeParse(request.body);
  if (!payload.success || !secretsMatch(payload.data.password, configuredToken)) {
    return reply
      .header('Cache-Control', 'no-store')
      .code(401)
      .send({ ok: false, error: 'Unauthorized.' });
  }

  return reply
    .header('Cache-Control', 'no-store')
    .header('Set-Cookie', analyticsSessionCookie(
      analyticsSessionValue(configuredToken),
      isSecureRequest(request.headers['x-forwarded-proto'])
    ))
    .send({ ok: true });
});

fastify.post('/admin/analytics/session/logout', async (request, reply) => {
  if (!process.env.ANALYTICS_TOKEN) return reply.code(404).send({ ok: false, error: 'Not found.' });

  return reply
    .header('Cache-Control', 'no-store')
    .header('Set-Cookie', analyticsSessionCookie(
      '',
      isSecureRequest(request.headers['x-forwarded-proto']),
      true
    ))
    .send({ ok: true });
});

async function handleAnalyticsReport(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const configuredToken = process.env.ANALYTICS_TOKEN;
  if (!configuredToken) {
    return reply.code(404).send({ ok: false, error: 'Not found.' });
  }

  // The browser view is the existing React application. Its own private route
  // handles the session prompt, while JSON clients retain bearer/session access.
  if (prefersHtml(request.headers.accept)) return sendAnalyticsApplication(reply);

  const hasAccess = hasAnalyticsAdminAccess(request.headers.authorization)
    || hasAnalyticsSessionAccess(request.headers.cookie);
  if (!hasAccess) {
    return reply
      .header('Cache-Control', 'no-store')
      .code(401)
      .send({ ok: false, error: 'Unauthorized.' });
  }

  const query = AnalyticsReportQuerySchema.safeParse(request.query);
  if (!query.success) {
    return reply
      .header('Cache-Control', 'no-store')
      .code(400)
      .send({ ok: false, error: query.error.issues[0]?.message ?? 'Invalid analytics report window.' });
  }
  const window = query.data.from && query.data.to
    ? { from: query.data.from, to: query.data.to }
    : undefined;

  return reply
    .header('Cache-Control', 'no-store')
    .header('Vary', 'Accept, Cookie')
    .send({ ok: true, data: await analytics.report(window) });
}

fastify.get('/admin/analytics', handleAnalyticsReport);
fastify.get('/admin/analytics/', handleAnalyticsReport);

fastify.get('/.well-known/apple-app-site-association', async (_request, reply) => {
  if (!IOS_APP_TEAM_ID) {
    return reply.code(404).send({ ok: false, error: 'iOS universal links are not configured.' });
  }

  return reply
    .header('Cache-Control', 'public, max-age=3600')
    .type('application/json')
    .send({
      applinks: {
        apps: [],
        details: [{
          appID: `${IOS_APP_TEAM_ID}.${MOBILE_APP_ID}`,
          components: [{ '/': '/join/*' }, { '/': '/daily' }]
        }]
      }
    });
});

fastify.get('/.well-known/assetlinks.json', async (_request, reply) => {
  if (ANDROID_APP_LINK_CERTIFICATES.length === 0) {
    return reply.code(404).send({ ok: false, error: 'Android app links are not configured.' });
  }

  return reply
    .header('Cache-Control', 'public, max-age=3600')
    .type('application/json')
    .send([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: MOBILE_APP_ID,
        sha256_cert_fingerprints: ANDROID_APP_LINK_CERTIFICATES
      }
    }]);
});

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

fastify.get('/*', async (request, reply) => {
  if (!existsSync(WEB_DIST_DIR)) {
    return reply.code(404).send({ ok: false, error: 'Web build not found. Run pnpm build first.' });
  }

  const requestPath = request.url.split('?')[0] ?? '/';
  const safePath = normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  const requestedFile = join(WEB_DIST_DIR, safePath === '/' ? 'index.html' : safePath);
  const filePath = existsSync(requestedFile) ? requestedFile : join(WEB_DIST_DIR, 'index.html');
  const extension = extname(filePath);
  reply.type(contentTypes[extension] ?? 'application/octet-stream');
  return reply.send(await readFile(filePath));
});

const io: TypedIo = new Server(fastify.server, {
  cors: {
    origin: clientOrigins,
    methods: ['GET', 'POST']
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: MOBILE_RECONNECT_GRACE_MS,
    skipMiddlewares: true
  }
});

const manager = new GameRoomManager(io, words, validWordIndex, analytics);

function clientIdForSocket(socket: TypedSocket): string | undefined {
  const parsed = ClientIdSchema.safeParse(socket.handshake.auth?.clientId);
  return parsed.success ? parsed.data : undefined;
}

function supportsCompactScoreUpdates(socket: TypedSocket): boolean {
  return Number(socket.handshake.auth?.scoreUpdateProtocol) >= 2;
}

function analyticsIdentityForSocket(socket: TypedSocket): AnalyticsVisitorIdentity | undefined {
  const parsed = AnalyticsVisitorIdentitySchema.safeParse(socket.handshake.auth?.analytics);
  return parsed.success ? parsed.data : undefined;
}

function clearReconnectRemoval(clientId: string): void {
  const session = reconnectSessions.get(clientId);
  if (!session?.removalTimer) return;
  clearTimeout(session.removalTimer);
  session.removalTimer = undefined;
}

function removeDisconnectedPlayer(socketId: string, reason: string): void {
  const roomId = manager.findRoomIdForSocket(socketId);
  fastify.log.info({ reason }, 'removing disconnected player');
  const removal = manager.removePlayer(socketId, 'disconnect');
  analytics.recordSocketDisconnected(socketId);
  if (!roomId || !removal.ok) {
    if (roomId || !removal.ok) {
      fastify.log.warn('disconnect room cleanup skipped');
    }
    return;
  }

  const snapshot = removal.data.snapshot;
  fastify.log.info({
    hostChanged: removal.data.hostChanged,
    roomClosed: !snapshot,
    ...(snapshot ? roomLogContext(snapshot) : {})
  }, 'player removed after disconnect');

  if (!snapshot) return;

  io.to(removal.data.roomId).emit('playerLeft', {
    playerId: socketId,
    snapshot
  } satisfies PlayerLeftPayload);

  if (removal.data.hostChanged) {
    io.to(removal.data.roomId).emit('hostChanged', {
      hostId: snapshot.hostId,
      snapshot
    } satisfies HostChangedPayload);
  }
}

function scheduleReconnectExpiry(clientId: string, socketId: string, reason: string): void {
  const session = reconnectSessions.get(clientId);
  if (!session || session.socketId !== socketId || session.removalTimer) return;

  session.removalTimer = setTimeout(() => {
    const currentSession = reconnectSessions.get(clientId);
    if (!currentSession || currentSession.socketId !== socketId) return;

    reconnectSessions.delete(clientId);
    clientIdBySocketId.delete(socketId);
    inactiveClientIds.delete(clientId);
    removeDisconnectedPlayer(socketId, reason);
  }, MOBILE_RECONNECT_GRACE_MS);
}

function restoreReconnectSession(socket: TypedSocket, clientId: string): boolean {
  const previousSession = reconnectSessions.get(clientId);
  if (!previousSession) {
    reconnectSessions.set(clientId, { socketId: socket.id, removalTimer: undefined });
    clientIdBySocketId.set(socket.id, clientId);
    return true;
  }

  if (previousSession.socketId === socket.id) {
    clearReconnectRemoval(clientId);
    clientIdBySocketId.set(socket.id, clientId);
    return true;
  }

  const previousSocket = io.sockets.sockets.get(previousSession.socketId) as TypedSocket | undefined;
  if (previousSocket?.connected) {
    fastify.log.warn('rejected duplicate reconnect client');
    socket.disconnect(true);
    return false;
  }

  clearReconnectRemoval(clientId);
  const previousSocketId = previousSession.socketId;
  const rebound = manager.rebindPlayerSocket(previousSocketId, socket.id);

  compactScoreUpdateSocketIds.delete(previousSocketId);
  previousSession.socketId = socket.id;
  previousSession.removalTimer = undefined;
  clientIdBySocketId.delete(previousSocketId);
  clientIdBySocketId.set(socket.id, clientId);

  if (!rebound.ok) {
    // The installation may have reconnected after intentionally leaving a room.
    analytics.recordSocketDisconnected(previousSocketId);
    return true;
  }

  analytics.rebindSocket(previousSocketId, socket.id);
  reboundSocketIds.add(socket.id);
  socket.join(rebound.data.roomId);
  io.to(rebound.data.roomId).emit('roomSnapshot', { snapshot: rebound.data.snapshot });
  fastify.log.info(roomLogContext(rebound.data.snapshot), 'mobile player session rebound');
  return true;
}

function roomLogContext(snapshot: RoomSnapshot): Record<string, unknown> {
  return {
    phase: snapshot.phase,
    players: snapshot.players.length,
    maxPlayers: snapshot.status.maxPlayers,
    gameMode: snapshot.settings.gameMode,
    currentRound: snapshot.currentRound,
    totalRounds: snapshot.totalRounds
  };
}

function detachSocketFromCurrentRoom(socket: TypedSocket, reason: PlayerRemovalReason = 'switch'): ServerAck<EmptyResult> {
  const previousRoomId = manager.findRoomIdForSocket(socket.id);
  if (!previousRoomId) {
    return { ok: true, data: { ok: true } };
  }

  fastify.log.info('socket leaving previous room before room change');
  socket.leave(previousRoomId);
  const removal = manager.removePlayer(socket.id, reason);
  if (!removal.ok) {
    fastify.log.warn('failed to remove socket from previous room');
    return { ok: false, error: removal.error };
  }

  const snapshot = removal.data.snapshot;
  fastify.log.info({
    hostChanged: removal.data.hostChanged,
    roomClosed: !snapshot,
    ...(snapshot ? roomLogContext(snapshot) : {})
  }, 'socket removed from previous room');

  if (snapshot) {
    io.to(removal.data.roomId).emit('playerLeft', {
      playerId: socket.id,
      snapshot
    } satisfies PlayerLeftPayload);

    if (removal.data.hostChanged) {
      io.to(removal.data.roomId).emit('hostChanged', {
        hostId: snapshot.hostId,
        snapshot
      } satisfies HostChangedPayload);
    }
  }

  return { ok: true, data: { ok: true } };
}

io.on('connection', (socket) => {
  const clientId = clientIdForSocket(socket);
  const analyticsIdentity = analyticsIdentityForSocket(socket);
  if (clientId && !restoreReconnectSession(socket, clientId)) return;
  if (supportsCompactScoreUpdates(socket)) compactScoreUpdateSocketIds.add(socket.id);

  const wasRebound = reboundSocketIds.delete(socket.id);
  // A Socket.IO recovered connection may have had its previous analytics mapping
  // removed during disconnect cleanup, so re-associate every non-manual rebind.
  // Session deduplication in the store prevents this from inflating sessions.
  if (!wasRebound) analytics.recordSocketConnected(socket.id, analyticsIdentity);
  fastify.log.info({ recovered: socket.recovered }, 'socket connected');

  socket.on('createRoom', (payload, ack) => {
    const parsed = CreateRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    fastify.log.info({
      gameMode: parsed.data.settings.gameMode,
      maxPlayers: parsed.data.settings.maxPlayers,
      rounds: parsed.data.settings.rounds,
      timePerRound: parsed.data.settings.timePerRound
    }, 'createRoom requested');

    detachSocketFromCurrentRoom(socket);
    const result = manager.createRoom(socket.id, parsed.data.username, parsed.data.avatar, parsed.data.settings, parsed.data.isPublic);
    if (!result.ok) {
      fastify.log.warn('createRoom failed');
      reply(ack, result);
      return;
    }

    socket.join(result.data.roomId);
    fastify.log.info(roomLogContext(result.data), 'room created and socket joined');
    socket.emit('roomSnapshot', { snapshot: result.data });
    reply(ack, { ok: true, data: { roomId: result.data.roomId, snapshot: result.data } });
  });

  socket.on('listOnlineRooms', (ack) => {
    reply(ack, { ok: true, data: { rooms: manager.listOnlineRooms() } });
  });

  socket.on('checkRoom', (payload, ack) => {
    const parsed = CheckRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const snapshot = manager.checkRoom(parsed.data.roomId);
    if (!snapshot) {
      reply(ack, { ok: true, data: { exists: false } });
      return;
    }

    reply(ack, { ok: true, data: { exists: true, snapshot } });
  });

  socket.on('joinRoom', (payload, ack) => {
    const parsed = JoinRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    fastify.log.info('joinRoom requested');

    detachSocketFromCurrentRoom(socket);
    const result = manager.joinRoom(socket.id, parsed.data.username, parsed.data.avatar, parsed.data.roomId);
    if (!result.ok) {
      fastify.log.warn('joinRoom failed');
      reply(ack, result);
      return;
    }

    socket.join(parsed.data.roomId);
    fastify.log.info(roomLogContext(result.data.snapshot), 'player joined room');
    io.to(parsed.data.roomId).emit('playerJoined', {
      player: result.data.player,
      snapshot: result.data.snapshot
    } satisfies PlayerJoinedPayload);
    socket.emit('roomSnapshot', { snapshot: result.data.snapshot });
    reply(ack, { ok: true, data: { snapshot: result.data.snapshot } });
  });

  socket.on('quickJoinRoom', (payload, ack) => {
    const parsed = QuickJoinRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    fastify.log.info('quickJoinRoom requested');

    detachSocketFromCurrentRoom(socket);
    const result = manager.quickJoinRoom(socket.id, parsed.data.username, parsed.data.avatar);
    if (!result.ok) {
      fastify.log.warn('quickJoinRoom failed');
      reply(ack, result);
      return;
    }

    const roomId = result.data.snapshot.roomId;
    socket.join(roomId);
    fastify.log.info({
      created: result.data.created,
      ...roomLogContext(result.data.snapshot)
    }, result.data.created ? 'quick match room created and socket joined' : 'quick match player joined room');
    if (result.data.created) {
      socket.emit('roomSnapshot', { snapshot: result.data.snapshot });
      socket.emit('notice', { message: 'Online room created. Waiting for random players to join.' });
    } else {
      io.to(roomId).emit('playerJoined', {
        player: result.data.player,
        snapshot: result.data.snapshot
      } satisfies PlayerJoinedPayload);
      socket.emit('roomSnapshot', { snapshot: result.data.snapshot });
    }

    reply(ack, {
      ok: true,
      data: {
        roomId,
        snapshot: result.data.snapshot,
        created: result.data.created
      }
    });
  });

  socket.on('updateTeam', (payload, ack) => {
    const parsed = UpdateTeamPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.updateTeam(socket.id, parsed.data.roomId, parsed.data.teamId);
    reply(ack, result);
  });

  socket.on('updateBet', (payload, ack) => {
    const parsed = UpdateBetPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.updateBet(socket.id, parsed.data.roomId, parsed.data.bet);
    reply(ack, result);
  });

  socket.on('updateSettings', (payload, ack) => {
    const parsed = UpdateSettingsPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.updateSettings(socket.id, parsed.data.roomId, parsed.data.settings);
    reply(ack, result);
  });

  socket.on('startGame', (payload, ack) => {
    const parsed = StartGamePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.startGame(socket.id, parsed.data.roomId);
    reply(ack, result);
  });

  socket.on('submitWord', (payload, ack) => {
    const parsed = SubmitWordPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.submitWord(socket.id, parsed.data.roomId, parsed.data.word);
    reply(ack, result);
  });

  socket.on('sendEmote', (payload, ack) => {
    const parsed = SendEmotePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.sendEmote(socket.id, parsed.data.roomId, parsed.data.emote);
    reply(ack, result);
  });

  socket.on('restartGame', (payload, ack) => {
    const parsed = RestartGamePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.restartGame(socket.id, parsed.data.roomId, parsed.data.autoStart);
    reply(ack, result);
  });

  socket.on('leaveRoom', (payload, ack) => {
    const parsed = LeaveRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const currentRoomId = manager.findRoomIdForSocket(socket.id);
    if (currentRoomId !== parsed.data.roomId) {
      reply(ack, { ok: false, error: 'You are no longer in this room.' });
      return;
    }

    const result = detachSocketFromCurrentRoom(socket, 'leave');
    if (result.ok && clientId) {
      // Keep the live socket's reconnect session: this player may create or join
      // another room without reconnecting first, and that later room still needs
      // normal disconnect cleanup. A room-less disconnect clears it below.
      clearReconnectRemoval(clientId);
      inactiveClientIds.delete(clientId);
    }
    reply(ack, result);
  });

  socket.on('registerPushToken', (payload, ack) => {
    const parsed = RegisterPushTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    if (!clientId) {
      reply(ack, { ok: false, error: 'A resumable device session is required for notifications.' });
      return;
    }

    pushTokensByClientId.set(clientId, {
      clientId,
      token: parsed.data.token,
      platform: parsed.data.platform,
      updatedAt: new Date().toISOString()
    });
    fastify.log.info({ platform: parsed.data.platform }, 'push token registered');
    reply(ack, { ok: true, data: { ok: true } });
  });

  socket.on('setAppActivity', (payload, ack) => {
    const parsed = SetAppActivityPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    if (!clientId) {
      reply(ack, { ok: true, data: { ok: true } });
      return;
    }

    if (parsed.data.isActive) {
      inactiveClientIds.delete(clientId);
    } else {
      inactiveClientIds.add(clientId);
    }
    reply(ack, { ok: true, data: { ok: true } });
  });

  socket.on('recordFeatureUsage', (payload) => {
    const parsed = RecordFeatureUsagePayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    analytics.recordFeatureUsage(parsed.data.event, socket.id);
  });

  socket.on('disconnect', (reason) => {
    compactScoreUpdateSocketIds.delete(socket.id);
    const roomId = manager.findRoomIdForSocket(socket.id);
    fastify.log.info({ reason }, 'socket disconnected');

    if (!clientId) {
      removeDisconnectedPlayer(socket.id, reason);
      return;
    }

    const reconnectSession = reconnectSessions.get(clientId);
    if (!reconnectSession || reconnectSession.socketId !== socket.id) {
      // A newer socket has already reclaimed this installation's player state.
      return;
    }

    if (!roomId) {
      reconnectSessions.delete(clientId);
      clientIdBySocketId.delete(socket.id);
      inactiveClientIds.delete(clientId);
      analytics.recordSocketDisconnected(socket.id);
      return;
    }

    scheduleReconnectExpiry(clientId, socket.id, reason);
  });
});

let isShuttingDown = false;

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  fastify.log.info({ signal }, 'shutting down');

  try {
    await analytics.close();
    await fastify.close();
  } finally {
    process.exit(0);
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

await fastify.listen({ port: PORT, host: '0.0.0.0' });
