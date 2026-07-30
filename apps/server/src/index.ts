import cors from '@fastify/cors';
import Fastify from 'fastify';
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
  GameOverPayload,
  GameRestartedPayload,
  GameSettings,
  BingoTask,
  HostChangedPayload,
  JoinRoomPayloadSchema,
  QuickJoinRoomPayloadSchema,
  Player,
  OnlineRoomSummary,
  PlayerBustedPayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  RestartGamePayloadSchema,
  RoomSnapshot,
  RoundEndedPayload,
  RoundResultPlayer,
  RoundStartedPayload,
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
import {
  chooseSourceWord,
  createValidWords,
  DUPLICATE_WORD_PENALTY,
  evaluateSubmission,
  POINTS_PER_WORD,
  scoreWord
} from '@wow/game-engine';

const PORT = Number(process.env.PORT ?? 4000);
const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
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
const TEAM_NAMES: Record<'red' | 'blue', string> = { red: 'Red Team', blue: 'Blue Team' };
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const ONLINE_ROOM_SETTINGS: GameSettings = {
  minWordLength: 7,
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

type TypedIo = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

type ManagerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface InternalRoom {
  id: string;
  players: Player[];
  settings: GameSettings;
  hostId: string;
  isPublic: boolean;
  phase: RoomSnapshot['phase'];
  currentWord: string;
  timeLeft: number;
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
  tickTimer: NodeJS.Timeout | undefined;
  nextRoundTimer: NodeJS.Timeout | undefined;
  emptyCleanupTimer: NodeJS.Timeout | undefined;
  waitingSeconds: number;
}

interface AnalyticsPlayer {
  socketId: string;
  name: string | undefined;
  connectedAt: string;
  disconnectedAt: string | undefined;
  lastRoomId: string | undefined;
  roomsCreated: string[];
  roomsJoined: string[];
  wordsAccepted: number;
}

interface AnalyticsGame {
  id: string;
  roomId: string;
  gameMode: GameSettings['gameMode'];
  wordCategory: GameSettings['wordCategory'];
  startedAt: string;
  endedAt: string | undefined;
  players: Array<{ playerId: string; playerName: string }>;
  finalScores: GameOverPayload['finalScores'] | undefined;
  totalWordsAccepted: number;
}

class AnalyticsStore {
  private readonly players = new Map<string, AnalyticsPlayer>();
  private readonly recentPlayers: AnalyticsPlayer[] = [];
  private readonly activeGamesByRoom = new Map<string, AnalyticsGame>();
  private readonly recentGames: AnalyticsGame[] = [];
  private readonly maxEntries = 250;

  public recordConnect(socketId: string): void {
    const player: AnalyticsPlayer = {
      socketId,
      name: undefined,
      connectedAt: new Date().toISOString(),
      disconnectedAt: undefined,
      lastRoomId: undefined,
      roomsCreated: [],
      roomsJoined: [],
      wordsAccepted: 0
    };
    this.players.set(socketId, player);
    this.pushRecent(this.recentPlayers, player);
  }

  public recordDisconnect(socketId: string): void {
    const player = this.players.get(socketId);
    if (!player) return;
    player.disconnectedAt = new Date().toISOString();
    this.players.delete(socketId);
  }

  public recordRoomCreated(socketId: string, username: string, roomId: string): void {
    const player = this.ensurePlayer(socketId);
    player.name = username;
    player.lastRoomId = roomId;
    player.roomsCreated.push(roomId);
  }

  public recordRoomJoined(socketId: string, username: string, roomId: string): void {
    const player = this.ensurePlayer(socketId);
    player.name = username;
    player.lastRoomId = roomId;
    player.roomsJoined.push(roomId);
  }

  public recordGameStarted(room: InternalRoom): void {
    const game: AnalyticsGame = {
      id: `${room.id}-${Date.now()}`,
      roomId: room.id,
      gameMode: room.settings.gameMode,
      wordCategory: room.settings.wordCategory,
      startedAt: new Date().toISOString(),
      endedAt: undefined,
      players: room.players.map((player) => ({ playerId: player.id, playerName: player.name })),
      finalScores: undefined,
      totalWordsAccepted: 0
    };
    this.activeGamesByRoom.set(room.id, game);
    this.pushRecent(this.recentGames, game);
  }

  public recordWordAccepted(room: InternalRoom, socketId: string): void {
    const player = this.ensurePlayer(socketId);
    player.wordsAccepted += 1;
    const game = this.activeGamesByRoom.get(room.id);
    if (game) game.totalWordsAccepted += 1;
  }

  public recordGameFinished(room: InternalRoom, finalScores: GameOverPayload['finalScores'], playerWords: Record<string, string[]>): void {
    const game = this.activeGamesByRoom.get(room.id) ?? {
      id: `${room.id}-${Date.now()}`,
      roomId: room.id,
      gameMode: room.settings.gameMode,
      wordCategory: room.settings.wordCategory,
      startedAt: new Date().toISOString(),
      endedAt: undefined,
      players: room.players.map((player) => ({ playerId: player.id, playerName: player.name })),
      finalScores: undefined,
      totalWordsAccepted: 0
    };
    game.endedAt = new Date().toISOString();
    game.finalScores = finalScores;
    game.totalWordsAccepted = Object.values(playerWords).reduce((total, wordsForPlayer) => total + wordsForPlayer.length, 0);
    this.activeGamesByRoom.delete(room.id);
    if (!this.recentGames.includes(game)) this.pushRecent(this.recentGames, game);
  }

  public snapshot(): { activePlayers: AnalyticsPlayer[]; recentPlayers: AnalyticsPlayer[]; activeGames: AnalyticsGame[]; recentGames: AnalyticsGame[] } {
    return {
      activePlayers: Array.from(this.players.values()).sort((left, right) => left.connectedAt.localeCompare(right.connectedAt)),
      recentPlayers: [...this.recentPlayers].reverse(),
      activeGames: Array.from(this.activeGamesByRoom.values()),
      recentGames: [...this.recentGames].reverse()
    };
  }

  private ensurePlayer(socketId: string): AnalyticsPlayer {
    let player = this.players.get(socketId);
    if (!player) {
      this.recordConnect(socketId);
      player = this.players.get(socketId);
    }
    if (!player) throw new Error('Unable to create analytics player.');
    return player;
  }

  private pushRecent<T>(items: T[], item: T): void {
    items.push(item);
    if (items.length > this.maxEntries) items.shift();
  }
}

class GameRoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  public constructor(private readonly io: TypedIo, private readonly dictionary: readonly string[], private readonly analytics: AnalyticsStore) {}

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

  private defaultTeamId(room: InternalRoom): 'red' | 'blue' {
    const redCount = room.players.filter((player) => player.teamId === 'red').length;
    const blueCount = room.players.filter((player) => player.teamId === 'blue').length;
    return redCount <= blueCount ? 'red' : 'blue';
  }

  public findRoomIdForSocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  public createRoom(socketId: string, username: string, settings: GameSettings, isPublic = false): ManagerResult<RoomSnapshot> {
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
      tickTimer: undefined,
      nextRoundTimer: undefined,
      emptyCleanupTimer: undefined,
      waitingSeconds: 0
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    this.analytics.recordRoomCreated(socketId, username, roomId);

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

  public quickJoinRoom(socketId: string, username: string): ManagerResult<{ snapshot: RoomSnapshot; player: Player; created: boolean }> {
    const openRoom = this.findOpenOnlineRoom();
    if (openRoom) {
      const joined = this.joinRoom(socketId, username, openRoom.id);
      if (!joined.ok) return joined;
      return { ok: true, data: { ...joined.data, created: false } };
    }

    const created = this.createRoom(socketId, username, ONLINE_ROOM_SETTINGS, true);
    if (!created.ok) return created;
    const player = created.data.players.find((candidate) => candidate.id === socketId);
    if (!player) return { ok: false, error: 'Unable to create online room.' };
    return { ok: true, data: { snapshot: created.data, player, created: true } };
  }

  public joinRoom(socketId: string, username: string, roomId: string): ManagerResult<{ snapshot: RoomSnapshot; player: Player }> {
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
      score: 0,
      isHost: isFirstPlayerBack,
      ...(this.usesTeams(room.settings) ? { teamId: this.defaultTeamId(room) } : {})
    };

    if (isFirstPlayerBack) {
      room.hostId = socketId;
    }

    room.players.push(player);
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
    this.analytics.recordRoomJoined(socketId, username, roomId);

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

    player.teamId = teamId;
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

    room.currentBets.set(socketId, bet);
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

  public removePlayer(socketId: string): ManagerResult<{ roomId: string; snapshot: RoomSnapshot | undefined; hostChanged: boolean }> {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return { ok: false, error: 'Player was not in a room.' };
    }

    const room = this.rooms.get(roomId);
    this.socketToRoom.delete(socketId);

    if (!room) {
      return { ok: false, error: 'Room not found.' };
    }

    const wasHost = room.hostId === socketId;
    room.players = room.players.filter((player) => player.id !== socketId);
    room.acceptedWords.delete(socketId);
    room.roundPenalties.delete(socketId);
    room.negativeWords.delete(socketId);
    room.bustWords.delete(socketId);
    room.bustedPlayers.delete(socketId);
    room.bingoProgress.delete(socketId);
    room.bingoCompletedBoards.delete(socketId);

    if (room.players.length === 0) {
      this.clearTickTimer(room);
      if (room.nextRoundTimer) {
        clearTimeout(room.nextRoundTimer);
        room.nextRoundTimer = undefined;
      }
      room.phase = 'lobby';
      room.currentWord = '';
      room.currentRound = 0;
      room.timeLeft = this.roundSecondsFor(room.settings);
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
    this.analytics.recordGameStarted(room);
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
    this.analytics.recordWordAccepted(room, socketId);

    this.io.to(socketId).emit('wordAccepted', {
      playerId: socketId,
      word: evaluation.normalizedWord,
      words: Array.from(playerWords).sort(),
      message: acceptedMessage,
      score: player.score
    } satisfies WordAcceptedPayload);
    this.emitScoresUpdated(room);

    if (this.usesLightning(room.settings)) {
      room.timeLeft += 1;
      this.io.to(room.id).emit('timeUpdate', { timeLeft: room.timeLeft });
    }

    if (this.sprintTargetReached(room, player, playerWords)) {
      player.score += FASTEST_N_BONUS;
      const message = this.usesTeams(room.settings) && player.teamId
        ? `${TEAM_NAMES[player.teamId]} reached ${room.settings.fastestWordTarget} words first. ${player.name} earned a ${FASTEST_N_BONUS} point sprint bonus!`
        : `${player.name} reached ${room.settings.fastestWordTarget} words first and earned a ${FASTEST_N_BONUS} point bonus!`;
      this.io.to(room.id).emit('notice', { message });
      this.finishRound(room);
    }

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

    this.clearTimers(room);
    this.resetScores(room);
    room.phase = 'lobby';
    room.currentWord = '';
    room.currentRound = 0;
    room.timeLeft = this.roundSecondsFor(room.settings);
    room.validWords = new Set<string>();
    room.waitingSeconds = 0;

    this.io.to(roomId).emit('gameRestarted', {
      snapshot: this.toSnapshot(room),
      autoStart
    } satisfies GameRestartedPayload);

    if (autoStart && room.players.length >= 2) {
      setTimeout(() => {
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
    const sourceWord = chooseSourceWord(sourceDictionary, room.settings.minWordLength);
    if (!sourceWord) {
      this.io.to(room.id).emit('notice', { message: 'No source words are available for these settings.' });
      return;
    }

    room.currentRound += 1;
    room.phase = 'round';
    room.currentWord = sourceWord.toLowerCase();
    room.timeLeft = this.roundSecondsFor(room.settings);
    room.validWords = createValidWords(room.currentWord, this.dictionary);
    room.waitingSeconds = 0;
    room.acceptedWords = this.emptyAcceptedWords(room);
    room.roundPenalties = this.emptyRoundPenalties(room);
    room.negativeWords = this.emptyNegativeWords(room);
    room.bustWords = new Map<string, string>();
    room.bustedPlayers = new Set<string>();
    room.bingoTasks = room.settings.gameMode === 'bingo' ? this.createBingoTasks(room.currentWord, room.validWords) : [];
    room.bingoProgress = this.emptyBingoProgress(room);
    room.bingoCompletedBoards = new Set<string>();

    this.io.to(room.id).emit('roundStarted', {
      currentWord: room.currentWord,
      timeLeft: room.timeLeft,
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds,
      snapshot: this.toSnapshot(room)
    } satisfies RoundStartedPayload);

    room.tickTimer = setInterval(() => {
      if (room.phase !== 'round') {
        this.clearTickTimer(room);
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

    const playerWords = this.acceptedWordsRecord(room);
    if (room.settings.gameMode === 'betting') {
      this.applyBettingScores(room, playerWords);
    }
    const results = this.roundResults(room, playerWords);

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

    this.analytics.recordGameFinished(room, finalScores, playerWords);

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
    this.io.to(room.id).emit('scoresUpdated', {
      scores: this.scoreEntries(room),
      snapshot: this.toSnapshot(room)
    } satisfies ScoresUpdatedPayload);
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
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds,
      acceptedWords: this.acceptedWordsRecord(room),
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

  private scoreEntries(room: InternalRoom): Array<[string, number]> {
    return room.players.map((player) => [player.id, player.score]);
  }

  private clearTimers(room: InternalRoom): void {
    this.clearTickTimer(room);
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
}

function reply<T>(ack: ((response: ServerAck<T>) => void) | undefined, response: ServerAck<T>): void {
  if (ack) {
    ack(response);
  }
}

function validationMessage(errorMessage: string): string {
  return errorMessage || 'Invalid request.';
}

const fastify = Fastify({ logger: true });

const configuredOrigin = process.env.CLIENT_ORIGIN;
const clientOrigins: string[] | boolean = configuredOrigin
  ? configuredOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  : true;

await fastify.register(cors, {
  origin: clientOrigins,
  methods: ['GET', 'POST']
});

const analytics = new AnalyticsStore();

fastify.get('/health', async () => ({ ok: true }));

fastify.get('/analytics', async (request, reply) => {
  const configuredToken = process.env.ANALYTICS_TOKEN;
  if (configuredToken) {
    const token = (request.query as { token?: string }).token;
    if (token !== configuredToken) {
      return reply.code(401).send({ ok: false, error: 'Unauthorized.' });
    }
  }

  return { ok: true, data: analytics.snapshot() };
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
  }
});

const manager = new GameRoomManager(io, words, analytics);

function roomLogContext(snapshot: RoomSnapshot): Record<string, unknown> {
  return {
    roomId: snapshot.roomId,
    phase: snapshot.phase,
    players: snapshot.players.length,
    maxPlayers: snapshot.status.maxPlayers,
    hostId: snapshot.hostId,
    gameMode: snapshot.settings.gameMode,
    currentRound: snapshot.currentRound,
    totalRounds: snapshot.totalRounds
  };
}

function detachSocketFromCurrentRoom(socket: TypedSocket): void {
  const previousRoomId = manager.findRoomIdForSocket(socket.id);
  if (!previousRoomId) {
    return;
  }

  fastify.log.info({ socketId: socket.id, previousRoomId }, 'socket leaving previous room before room change');
  socket.leave(previousRoomId);
  const removal = manager.removePlayer(socket.id);
  if (!removal.ok) {
    fastify.log.warn({ socketId: socket.id, previousRoomId, error: removal.error }, 'failed to remove socket from previous room');
    return;
  }

  const snapshot = removal.data.snapshot;
  fastify.log.info({
    socketId: socket.id,
    roomId: removal.data.roomId,
    hostChanged: removal.data.hostChanged,
    roomClosed: !snapshot,
    ...(snapshot ? roomLogContext(snapshot) : {})
  }, 'socket removed from previous room');

  if (!snapshot) {
    return;
  }

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

io.on('connection', (socket) => {
  analytics.recordConnect(socket.id);
  fastify.log.info({ socketId: socket.id }, 'socket connected');

  socket.on('createRoom', (payload, ack) => {
    const parsed = CreateRoomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    fastify.log.info({
      socketId: socket.id,
      username: parsed.data.username,
      gameMode: parsed.data.settings.gameMode,
      maxPlayers: parsed.data.settings.maxPlayers,
      rounds: parsed.data.settings.rounds,
      timePerRound: parsed.data.settings.timePerRound
    }, 'createRoom requested');

    detachSocketFromCurrentRoom(socket);
    const result = manager.createRoom(socket.id, parsed.data.username, parsed.data.settings, parsed.data.isPublic);
    if (!result.ok) {
      fastify.log.warn({ socketId: socket.id, username: parsed.data.username, error: result.error }, 'createRoom failed');
      reply(ack, result);
      return;
    }

    socket.join(result.data.roomId);
    fastify.log.info({ socketId: socket.id, username: parsed.data.username, ...roomLogContext(result.data) }, 'room created and socket joined');
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

    fastify.log.info({ socketId: socket.id, username: parsed.data.username, roomId: parsed.data.roomId }, 'joinRoom requested');

    detachSocketFromCurrentRoom(socket);
    const result = manager.joinRoom(socket.id, parsed.data.username, parsed.data.roomId);
    if (!result.ok) {
      fastify.log.warn({ socketId: socket.id, username: parsed.data.username, roomId: parsed.data.roomId, error: result.error }, 'joinRoom failed');
      reply(ack, result);
      return;
    }

    socket.join(parsed.data.roomId);
    fastify.log.info({
      socketId: socket.id,
      username: parsed.data.username,
      playerId: result.data.player.id,
      ...roomLogContext(result.data.snapshot)
    }, 'player joined room');
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

    fastify.log.info({ socketId: socket.id, username: parsed.data.username }, 'quickJoinRoom requested');

    detachSocketFromCurrentRoom(socket);
    const result = manager.quickJoinRoom(socket.id, parsed.data.username);
    if (!result.ok) {
      fastify.log.warn({ socketId: socket.id, username: parsed.data.username, error: result.error }, 'quickJoinRoom failed');
      reply(ack, result);
      return;
    }

    const roomId = result.data.snapshot.roomId;
    socket.join(roomId);
    fastify.log.info({
      socketId: socket.id,
      username: parsed.data.username,
      playerId: result.data.player.id,
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

  socket.on('restartGame', (payload, ack) => {
    const parsed = RestartGamePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      reply(ack, { ok: false, error: validationMessage(parsed.error.message) });
      return;
    }

    const result = manager.restartGame(socket.id, parsed.data.roomId, parsed.data.autoStart);
    reply(ack, result);
  });

  socket.on('disconnect', (reason) => {
    analytics.recordDisconnect(socket.id);
    const roomId = manager.findRoomIdForSocket(socket.id);
    fastify.log.info({ socketId: socket.id, roomId, reason }, 'socket disconnected');
    const removal = manager.removePlayer(socket.id);
    if (!roomId || !removal.ok) {
      if (roomId || !removal.ok) {
        fastify.log.warn({ socketId: socket.id, roomId, error: removal.ok ? undefined : removal.error }, 'disconnect room cleanup skipped');
      }
      return;
    }

    const snapshot = removal.data.snapshot;
    fastify.log.info({
      socketId: socket.id,
      roomId,
      hostChanged: removal.data.hostChanged,
      roomClosed: !snapshot,
      ...(snapshot ? roomLogContext(snapshot) : {})
    }, 'player removed after disconnect');

    if (!snapshot) {
      return;
    }

    io.to(roomId).emit('playerLeft', {
      playerId: socket.id,
      snapshot
    } satisfies PlayerLeftPayload);

    if (removal.data.hostChanged) {
      io.to(roomId).emit('hostChanged', {
        hostId: snapshot.hostId,
        snapshot
      } satisfies HostChangedPayload);
    }
  });
});

await fastify.listen({ port: PORT, host: '0.0.0.0' });
