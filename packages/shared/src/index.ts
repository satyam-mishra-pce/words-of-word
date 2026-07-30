import { z } from 'zod';

export const UsernameSchema = z.string().trim().min(1).max(20);
export const RoomIdSchema = z.string().trim().toUpperCase().min(3).max(16);

export const GameModeSchema = z.enum([
  'classic',
  'arcade',
  'precision',
  'teams',
  'betting',
  'fastestNWords',
  'battleRoyale',
  'typist',
  'category',
  'oneWordForAll',
  'busted',
  'commonWord',
  'intuition',
  'lightning',
  'bingo',
  'mix'
]);

export const WordCategorySchema = z.enum([
  'general',
  'genz',
  'sports',
  'food',
  'slangs',
  'custom',
  'vehicles',
  'technology',
  'finance',
  'medical'
]);

export const MixScoringModeSchema = z.enum(['classic', 'arcade']);

export const MixModifiersSchema = z.object({
  teams: z.boolean().default(false),
  wordSprint: z.boolean().default(false),
  blind: z.boolean().default(false),
  claim: z.boolean().default(false),
  busted: z.boolean().default(false),
  intuition: z.boolean().default(false),
  lightning: z.boolean().default(false)
});

export const GameSettingsSchema = z.object({
  minWordLength: z.number().int().min(4).max(18),
  timePerRound: z.number().int().min(5).max(300),
  rounds: z.number().int().min(1).max(20),
  maxPlayers: z.number().int().min(2).max(50),
  gameMode: GameModeSchema.default('classic'),
  fastestWordTarget: z.number().int().min(3).max(10).default(5),
  eliminationsPerRound: z.number().int().min(1).max(10).default(1),
  wordCategory: WordCategorySchema.default('general'),
  customWordList: z.string().max(2000).default(''),
  mixScoringMode: MixScoringModeSchema.default('classic'),
  mixModifiers: MixModifiersSchema.default({})
});

export const CreateRoomPayloadSchema = z.object({
  username: UsernameSchema,
  settings: GameSettingsSchema,
  isPublic: z.boolean().default(false)
});

export const CheckRoomPayloadSchema = z.object({
  roomId: RoomIdSchema
});

export const JoinRoomPayloadSchema = z.object({
  roomId: RoomIdSchema,
  username: UsernameSchema
});

export const QuickJoinRoomPayloadSchema = z.object({
  username: UsernameSchema
});

export const StartGamePayloadSchema = z.object({
  roomId: RoomIdSchema
});

export const SubmitWordPayloadSchema = z.object({
  roomId: RoomIdSchema,
  word: z.string().trim().min(1).max(40)
});

export const UpdateTeamPayloadSchema = z.object({
  roomId: RoomIdSchema,
  teamId: z.enum(['red', 'blue'])
});

export const UpdateBetPayloadSchema = z.object({
  roomId: RoomIdSchema,
  bet: z.number().int().min(1).max(50)
});

export const RestartGamePayloadSchema = z.object({
  roomId: RoomIdSchema,
  autoStart: z.boolean().default(true)
});

export const UpdateSettingsPayloadSchema = z.object({
  roomId: RoomIdSchema,
  settings: GameSettingsSchema
});

export type GameMode = z.infer<typeof GameModeSchema>;
export type MixScoringMode = z.infer<typeof MixScoringModeSchema>;
export type MixModifiers = z.infer<typeof MixModifiersSchema>;
export type WordCategory = z.infer<typeof WordCategorySchema>;
export type GameSettings = z.infer<typeof GameSettingsSchema>;
export type CreateRoomPayload = z.infer<typeof CreateRoomPayloadSchema>;
export type CheckRoomPayload = z.infer<typeof CheckRoomPayloadSchema>;
export type JoinRoomPayload = z.infer<typeof JoinRoomPayloadSchema>;
export type QuickJoinRoomPayload = z.infer<typeof QuickJoinRoomPayloadSchema>;
export type StartGamePayload = z.infer<typeof StartGamePayloadSchema>;
export type SubmitWordPayload = z.infer<typeof SubmitWordPayloadSchema>;
export type UpdateTeamPayload = z.infer<typeof UpdateTeamPayloadSchema>;
export type UpdateBetPayload = z.infer<typeof UpdateBetPayloadSchema>;
export type RestartGamePayload = z.infer<typeof RestartGamePayloadSchema>;
export type UpdateSettingsPayload = z.infer<typeof UpdateSettingsPayloadSchema>;

export type RoomPhase = 'lobby' | 'betting' | 'round' | 'betweenRounds' | 'gameOver';

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isEliminated?: boolean;
  teamId?: 'red' | 'blue';
}

export interface RoomStatus {
  isFull: boolean;
  maxPlayers: number;
  currentPlayers: number;
  message: string;
}

export interface TeamScore {
  teamId: 'red' | 'blue';
  teamName: string;
  score: number;
  players: string[];
}

export interface BingoTask {
  id: string;
  label: string;
}

export interface RoomSnapshot {
  roomId: string;
  players: Player[];
  settings: GameSettings;
  hostId: string;
  status: RoomStatus;
  phase: RoomPhase;
  currentWord: string;
  timeLeft: number;
  currentRound: number;
  totalRounds: number;
  acceptedWords: Record<string, string[]>;
  teamScores: TeamScore[];
  bettingBets: Record<string, number>;
  bettingAverages: Record<string, number>;
  minimumBets: Record<string, number>;
  waitingSeconds: number;
  bustWords: Record<string, string>;
  bustedPlayers: Record<string, boolean>;
  bingoTasks: BingoTask[];
  bingoProgress: Record<string, string[]>;
}

export interface NegativeMarkedWord {
  word: string;
  penalty: number;
}

export interface RoundResultPlayer {
  playerId: string;
  playerName: string;
  score: number;
  words: string[];
  negativeWords: NegativeMarkedWord[];
  bettingBet?: number;
  bettingHit?: boolean;
}

export interface FinalScore {
  playerId: string;
  playerName: string;
  score: number;
  rank: number;
}

export interface CreateRoomResult {
  roomId: string;
  snapshot: RoomSnapshot;
}

export interface CheckRoomResult {
  exists: boolean;
  snapshot?: RoomSnapshot;
}

export interface JoinRoomResult {
  snapshot: RoomSnapshot;
}

export interface QuickJoinRoomResult {
  roomId: string;
  snapshot: RoomSnapshot;
  created: boolean;
}

export interface OnlineRoomSummary {
  roomId: string;
  hostName: string;
  gameMode: GameMode;
  phase: RoomPhase;
  currentPlayers: number;
  maxPlayers: number;
  currentRound: number;
  rounds: number;
  timePerRound: number;
  minWordLength: number;
}

export interface ListOnlineRoomsResult {
  rooms: OnlineRoomSummary[];
}

export interface EmptyResult {
  ok: true;
}

export type ServerAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type Ack<T> = (response: ServerAck<T>) => void;

export interface RoomSnapshotPayload {
  snapshot: RoomSnapshot;
}

export interface PlayerJoinedPayload {
  player: Player;
  snapshot: RoomSnapshot;
}

export interface PlayerLeftPayload {
  playerId: string;
  snapshot: RoomSnapshot;
}

export interface HostChangedPayload {
  hostId: string;
  snapshot: RoomSnapshot;
}

export interface RoundStartedPayload {
  currentWord: string;
  timeLeft: number;
  currentRound: number;
  totalRounds: number;
  snapshot: RoomSnapshot;
}

export interface TimeUpdatedPayload {
  timeLeft: number;
}

export interface WordAcceptedPayload {
  playerId: string;
  word: string;
  words: string[];
  message: string;
  score: number;
}

export interface WordRejectedPayload {
  word: string;
  message: string;
  penalty?: number;
}

export interface ScoresUpdatedPayload {
  scores: Array<[string, number]>;
  snapshot: RoomSnapshot;
}

export interface RoundEndedPayload {
  scores: Array<[string, number]>;
  playerWords: Record<string, string[]>;
  validWords: string[];
  isGameOver: boolean;
  currentRound: number;
  totalRounds: number;
  nextRoundStartsIn: number;
  results: RoundResultPlayer[];
  snapshot: RoomSnapshot;
}

export interface GameOverPayload {
  finalScores: FinalScore[];
  playerWords: Record<string, string[]>;
  snapshot: RoomSnapshot;
  currentRound?: number;
  validWords?: string[];
  results?: RoundResultPlayer[];
}

export interface GameRestartedPayload {
  snapshot: RoomSnapshot;
  autoStart: boolean;
}

export interface NoticePayload {
  message: string;
}

export interface PlayerBustedPayload {
  playerId: string;
  playerName: string;
  word: string;
  message: string;
  snapshot: RoomSnapshot;
}

export interface ServerToClientEvents {
  roomSnapshot: (payload: RoomSnapshotPayload) => void;
  playerJoined: (payload: PlayerJoinedPayload) => void;
  playerLeft: (payload: PlayerLeftPayload) => void;
  hostChanged: (payload: HostChangedPayload) => void;
  roundStarted: (payload: RoundStartedPayload) => void;
  timeUpdate: (payload: TimeUpdatedPayload) => void;
  wordAccepted: (payload: WordAcceptedPayload) => void;
  wordRejected: (payload: WordRejectedPayload) => void;
  scoresUpdated: (payload: ScoresUpdatedPayload) => void;
  roundEnded: (payload: RoundEndedPayload) => void;
  gameOver: (payload: GameOverPayload) => void;
  gameRestarted: (payload: GameRestartedPayload) => void;
  playerBusted: (payload: PlayerBustedPayload) => void;
  notice: (payload: NoticePayload) => void;
}

export interface ClientToServerEvents {
  createRoom: (payload: CreateRoomPayload, ack?: Ack<CreateRoomResult>) => void;
  checkRoom: (payload: CheckRoomPayload, ack?: Ack<CheckRoomResult>) => void;
  joinRoom: (payload: JoinRoomPayload, ack?: Ack<JoinRoomResult>) => void;
  quickJoinRoom: (payload: QuickJoinRoomPayload, ack?: Ack<QuickJoinRoomResult>) => void;
  listOnlineRooms: (ack?: Ack<ListOnlineRoomsResult>) => void;
  updateTeam: (payload: UpdateTeamPayload, ack?: Ack<EmptyResult>) => void;
  updateBet: (payload: UpdateBetPayload, ack?: Ack<EmptyResult>) => void;
  updateSettings: (payload: UpdateSettingsPayload, ack?: Ack<EmptyResult>) => void;
  startGame: (payload: StartGamePayload, ack?: Ack<EmptyResult>) => void;
  submitWord: (payload: SubmitWordPayload, ack?: Ack<EmptyResult>) => void;
  restartGame: (payload: RestartGamePayload, ack?: Ack<EmptyResult>) => void;
}
