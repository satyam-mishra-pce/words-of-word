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
  HostChangedPayload,
  JoinRoomPayloadSchema,
  Player,
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
const FASTEST_N_BONUS = 10;
const BETTING_BASE_POINTS = 10;
const BETTING_EXTRA_WORD_POINTS = 3;
const COMMON_RARE_WORD_POINTS = 5;
const COMMON_RARE_WORD_MIN_LENGTH = 5;
const TEAM_NAMES: Record<'red' | 'blue', string> = { red: 'Red Team', blue: 'Blue Team' };
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
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

  private validateBattleRoyale(settings: GameSettings, playerCount: number): string | undefined {
    if (settings.gameMode !== 'battleRoyale') {
      return undefined;
    }

    if (settings.eliminationsPerRound * settings.rounds >= playerCount) {
      return 'Knockout would finish before all rounds are played. Lower eliminations, lower rounds, or add more players.';
    }

    return undefined;
  }

  private validateTeams(room: InternalRoom): string | undefined {
    if (room.settings.gameMode !== 'teams') {
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

  public createRoom(socketId: string, username: string, settings: GameSettings): ManagerResult<RoomSnapshot> {
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
      ...(settings.gameMode === 'teams' ? { teamId: 'red' as const } : {})
    };

    const room: InternalRoom = {
      id: roomId,
      players: [player],
      settings,
      hostId: socketId,
      phase: 'lobby',
      currentWord: '',
      timeLeft: settings.timePerRound,
      currentRound: 0,
      validWords: new Set<string>(),
      acceptedWords: new Map([[socketId, new Set<string>()]]),
      roundPenalties: new Map([[socketId, 0]]),
      negativeWords: new Map([[socketId, []]]),
      bustWords: new Map<string, string>(),
      bustedPlayers: new Set<string>(),
      currentBets: new Map<string, number>(),
      bettingWordCounts: new Map([[socketId, []]]),
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

  public checkRoom(roomId: string): RoomSnapshot | undefined {
    const room = this.rooms.get(roomId);
    if (!room) {
      return undefined;
    }
    return this.toSnapshot(room);
  }

  public joinRoom(socketId: string, username: string, roomId: string): ManagerResult<{ snapshot: RoomSnapshot; player: Player }> {
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
      ...(room.settings.gameMode === 'teams' ? { teamId: this.defaultTeamId(room) } : {})
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

    if (room.settings.gameMode !== 'teams') {
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
    room.timeLeft = settings.timePerRound;
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
        ...(settings.gameMode === 'teams'
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
      setTimeout(() => this.startRound(room), 500);
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

    if (room.players.length === 0) {
      this.clearTickTimer(room);
      if (room.nextRoundTimer) {
        clearTimeout(room.nextRoundTimer);
        room.nextRoundTimer = undefined;
      }
      room.phase = 'lobby';
      room.currentWord = '';
      room.currentRound = 0;
      room.timeLeft = room.settings.timePerRound;
      room.waitingSeconds = 0;
      room.validWords.clear();
      room.acceptedWords.clear();
      room.roundPenalties.clear();
      room.negativeWords.clear();
      room.bustWords.clear();
      room.bustedPlayers.clear();
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

    if (room.phase === 'round' || room.phase === 'betweenRounds') {
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
    this.analytics.recordGameStarted(room);
    if (room.settings.gameMode === 'betting') {
      this.startBetting(room);
    } else {
      this.startRound(room);
    }

    return { ok: true, data: { ok: true } };
  }

  public submitWord(socketId: string, roomId: string, submittedWord: string): ManagerResult<EmptyResult> {
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

    if (room.settings.gameMode === 'busted' && room.bustedPlayers.has(socketId)) {
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

    if (room.settings.gameMode === 'oneWordForAll' && this.wordWasTakenByAnotherPlayer(room, socketId, evaluation.normalizedWord)) {
      const penalty = this.applyPrecisionPenalty(room, player, evaluation.normalizedWord, DUPLICATE_WORD_PENALTY);
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: penalty < 0 ? `That word was already made by someone else. (${penalty} pts)` : 'That word was already made by someone else.',
        ...(penalty < 0 ? { penalty } : {})
      } satisfies WordRejectedPayload);
      this.emitScoresUpdated(room);
      return { ok: true, data: { ok: true } };
    }

    if (room.settings.gameMode === 'busted') {
      if (!room.bustWords.has(socketId)) {
        room.bustWords.set(socketId, evaluation.normalizedWord);
      } else if (this.wordBustsPlayer(room, socketId, evaluation.normalizedWord)) {
        this.bustPlayer(room, player, evaluation.normalizedWord);
        return { ok: true, data: { ok: true } };
      }
    }

    playerWords.add(evaluation.normalizedWord);
    const acceptedMessage = room.settings.gameMode === 'commonWord'
      ? this.applyCommonWordScore(room, player, evaluation.normalizedWord)
      : evaluation.message;
    if (room.settings.gameMode !== 'betting' && room.settings.gameMode !== 'commonWord') {
      player.score += scoreWord(evaluation.normalizedWord, room.settings.gameMode);
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

    if (room.settings.gameMode === 'fastestNWords' && playerWords.size >= room.settings.fastestWordTarget) {
      player.score += FASTEST_N_BONUS;
      this.io.to(room.id).emit('notice', { message: `${player.name} reached ${room.settings.fastestWordTarget} words first and earned a ${FASTEST_N_BONUS} point bonus!` });
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
    room.timeLeft = room.settings.timePerRound;
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

    const recentCounts = counts.slice(-2);
    return recentCounts.reduce((total, count) => total + count, 0) / recentCounts.length;
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
        setTimeout(() => this.startRound(room), 500);
      }
    }, 1000);
  }

  private startRound(room: InternalRoom): void {
    this.clearTimers(room);

    if (room.currentRound >= room.settings.rounds || (room.settings.gameMode === 'battleRoyale' && this.activePlayers(room).length <= 1)) {
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
    room.timeLeft = room.settings.timePerRound;
    room.validWords = createValidWords(room.currentWord, this.dictionary);
    room.waitingSeconds = 0;
    room.acceptedWords = this.emptyAcceptedWords(room);
    room.roundPenalties = this.emptyRoundPenalties(room);
    room.negativeWords = this.emptyNegativeWords(room);
    room.bustWords = new Map<string, string>();
    room.bustedPlayers = new Set<string>();

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
    this.clearTickTimer(room);

    const playerWords = this.acceptedWordsRecord(room);
    if (room.settings.gameMode === 'betting') {
      this.applyBettingScores(room, playerWords);
    }
    const results = this.roundResults(room, playerWords);

    if (room.settings.gameMode === 'battleRoyale') {
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
    const finalScores = [...room.players]
      .sort((left, right) => right.score - left.score)
      .map((player, index) => ({
        playerId: player.id,
        playerName: player.name,
        score: player.score,
        rank: index + 1
      }));

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
      bustedPlayers: Object.fromEntries(room.players.map((player) => [player.id, room.bustedPlayers.has(player.id)]))
    };
  }

  private teamScores(room: InternalRoom): RoomSnapshot['teamScores'] {
    if (room.settings.gameMode !== 'teams') {
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
          : words.reduce((total, word) => total + scoreWord(word, room.settings.gameMode), 0);
      const bustedScoreOverride = room.settings.gameMode === 'busted' && room.bustedPlayers.has(player.id);
      const fastestBonus = room.settings.gameMode === 'fastestNWords' && words.length >= room.settings.fastestWordTarget
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

function detachSocketFromCurrentRoom(socket: TypedSocket): void {
  const previousRoomId = manager.findRoomIdForSocket(socket.id);
  if (!previousRoomId) {
    return;
  }

  socket.leave(previousRoomId);
  const removal = manager.removePlayer(socket.id);
  if (!removal.ok) {
    return;
  }

  const snapshot = removal.data.snapshot;
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

    detachSocketFromCurrentRoom(socket);
    const result = manager.createRoom(socket.id, parsed.data.username, parsed.data.settings);
    if (!result.ok) {
      reply(ack, result);
      return;
    }

    socket.join(result.data.roomId);
    socket.emit('roomSnapshot', { snapshot: result.data });
    reply(ack, { ok: true, data: { roomId: result.data.roomId, snapshot: result.data } });
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

    detachSocketFromCurrentRoom(socket);
    const result = manager.joinRoom(socket.id, parsed.data.username, parsed.data.roomId);
    if (!result.ok) {
      reply(ack, result);
      return;
    }

    socket.join(parsed.data.roomId);
    io.to(parsed.data.roomId).emit('playerJoined', {
      player: result.data.player,
      snapshot: result.data.snapshot
    } satisfies PlayerJoinedPayload);
    socket.emit('roomSnapshot', { snapshot: result.data.snapshot });
    reply(ack, { ok: true, data: { snapshot: result.data.snapshot } });
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

  socket.on('disconnect', () => {
    analytics.recordDisconnect(socket.id);
    fastify.log.info({ socketId: socket.id }, 'socket disconnected');
    const roomId = manager.findRoomIdForSocket(socket.id);
    const removal = manager.removePlayer(socket.id);
    if (!roomId || !removal.ok) {
      return;
    }

    const snapshot = removal.data.snapshot;
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
