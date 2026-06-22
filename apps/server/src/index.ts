import cors from '@fastify/cors';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
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
  PlayerJoinedPayload,
  PlayerLeftPayload,
  RestartGamePayloadSchema,
  RoomSnapshot,
  RoundEndedPayload,
  RoundResultPlayer,
  RoundStartedPayload,
  ServerAck,
  ServerToClientEvents,
  StartGamePayloadSchema,
  SubmitWordPayloadSchema,
  WordAcceptedPayload,
  WordRejectedPayload
} from '@wow/shared';
import {
  chooseSourceWord,
  createValidWords,
  evaluateSubmission,
  scoreWord
} from '@wow/game-engine';

const PORT = Number(process.env.PORT ?? 4000);
const WAIT_BETWEEN_ROUNDS_SECONDS = 10;
const FASTEST_N_BONUS = 10;
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
  tickTimer: NodeJS.Timeout | undefined;
  nextRoundTimer: NodeJS.Timeout | undefined;
  waitingSeconds: number;
}

class GameRoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  public constructor(private readonly io: TypedIo, private readonly dictionary: readonly string[]) {}

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
      return 'Battle Royale would finish before all rounds are played. Lower eliminations, lower rounds, or add more players.';
    }

    return undefined;
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
      isHost: true
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
      tickTimer: undefined,
      nextRoundTimer: undefined,
      waitingSeconds: 0
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);

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

    if (room.phase !== 'lobby') {
      return { ok: false, error: 'This game has already started.' };
    }

    const player: Player = {
      id: socketId,
      name: username,
      score: 0,
      isHost: false
    };

    room.players.push(player);
    room.acceptedWords.set(socketId, new Set<string>());
    this.socketToRoom.set(socketId, roomId);

    return { ok: true, data: { snapshot: this.toSnapshot(room), player } };
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

    if (room.players.length === 0) {
      this.clearTimers(room);
      this.rooms.delete(roomId);
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

    const battleRoyaleError = this.validateBattleRoyale(room.settings, room.players.length);
    if (battleRoyaleError) {
      return { ok: false, error: battleRoyaleError };
    }

    this.resetScores(room);
    this.startRound(room);

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
        message: 'You have been eliminated from this Battle Royale.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    const playerWords = room.acceptedWords.get(socketId) ?? new Set<string>();
    room.acceptedWords.set(socketId, playerWords);

    const evaluation = evaluateSubmission(submittedWord, room.validWords, playerWords);
    if (!evaluation.isValid) {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: evaluation.message
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    if (room.settings.gameMode === 'oneWordForAll' && this.wordWasTakenByAnotherPlayer(room, socketId, evaluation.normalizedWord)) {
      this.io.to(socketId).emit('wordRejected', {
        word: submittedWord,
        message: 'That word was already made by someone else.'
      } satisfies WordRejectedPayload);
      return { ok: true, data: { ok: true } };
    }

    playerWords.add(evaluation.normalizedWord);
    player.score += scoreWord(evaluation.normalizedWord, room.settings.gameMode);

    this.io.to(socketId).emit('wordAccepted', {
      playerId: socketId,
      word: evaluation.normalizedWord,
      words: Array.from(playerWords).sort(),
      message: evaluation.message,
      score: player.score
    } satisfies WordAcceptedPayload);

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
      setTimeout(() => this.startRound(room), 500);
    }

    return { ok: true, data: { ok: true } };
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
    const results: RoundResultPlayer[] = room.players.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      score: player.score,
      words: playerWords[player.id] ?? []
    }));

    if (room.settings.gameMode === 'battleRoyale') {
      this.eliminateLowestScorers(room);
    }

    const isGameOver = room.currentRound >= room.settings.rounds;

    if (isGameOver) {
      this.finishGame(room);
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
      this.startRound(room);
    }, WAIT_BETWEEN_ROUNDS_SECONDS * 1000);
  }

  private finishGame(room: InternalRoom): void {
    this.clearTimers(room);
    room.phase = 'gameOver';
    room.waitingSeconds = 0;

    const playerWords = this.acceptedWordsRecord(room);
    const finalScores = [...room.players]
      .sort((left, right) => right.score - left.score)
      .map((player, index) => ({
        playerId: player.id,
        playerName: player.name,
        score: player.score,
        rank: index + 1
      }));

    this.io.to(room.id).emit('gameOver', {
      finalScores,
      playerWords,
      snapshot: this.toSnapshot(room)
    } satisfies GameOverPayload);
  }

  private resetScores(room: InternalRoom): void {
    room.players = room.players.map((player) => ({
      ...player,
      score: 0,
      isHost: player.id === room.hostId,
      isEliminated: false
    }));
    room.acceptedWords = this.emptyAcceptedWords(room);
  }

  private emptyAcceptedWords(room: InternalRoom): Map<string, Set<string>> {
    const acceptedWords = new Map<string, Set<string>>();
    for (const player of room.players) {
      acceptedWords.set(player.id, new Set<string>());
    }
    return acceptedWords;
  }

  private wordWasTakenByAnotherPlayer(room: InternalRoom, playerId: string, word: string): boolean {
    for (const [acceptedPlayerId, words] of room.acceptedWords.entries()) {
      if (acceptedPlayerId !== playerId && words.has(word)) {
        return true;
      }
    }
    return false;
  }

  private eliminateLowestScorers(room: InternalRoom): void {
    const activePlayers = this.activePlayers(room);
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
        message: `${eliminatedPlayers.map((player) => player.name).join(', ')} eliminated from Battle Royale.`
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
      waitingSeconds: room.waitingSeconds
    };
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
const clientOrigins = configuredOrigin
  ? configuredOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

await fastify.register(cors, {
  origin: clientOrigins,
  methods: ['GET', 'POST']
});

fastify.get('/health', async () => ({ ok: true }));

const io: TypedIo = new Server(fastify.server, {
  cors: {
    origin: clientOrigins,
    methods: ['GET', 'POST']
  }
});

const manager = new GameRoomManager(io, words);

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
