import { z } from 'zod';

export const UsernameSchema = z.string().trim().min(1).max(20);
export const RoomIdSchema = z.string().trim().toUpperCase().min(3).max(16);

/**
 * A compact Pipoya recipe. The browser composes these layer IDs from the same
 * atlas-based pixel-character system used by Simocracy, rather than sending
 * image blobs through room events.
 */
export const PlayerAvatarCharacterSetSchema = z.enum(['adult', 'oldman', 'nekonin', 'children']);
export const PlayerAvatarPartSchema = z.number().int().min(0).max(70);

export const DEFAULT_PLAYER_AVATAR = {
  engine: 'pipoya',
  characterSet: 'adult',
  skin: 1,
  clothes: 1,
  eyes: 1,
  hair: 1,
  hairadd: 0,
  hat: 0,
  glasses: 0,
  cloak: 0,
  makeup: 0,
  beard: 0,
  ear: 0,
  tail: 0,
  item: 0
} as const;

export const PlayerAvatarSchema = z.object({
  engine: z.literal('pipoya'),
  characterSet: PlayerAvatarCharacterSetSchema,
  skin: PlayerAvatarPartSchema.refine((value) => value > 0, 'A skin is required'),
  clothes: PlayerAvatarPartSchema,
  eyes: PlayerAvatarPartSchema.refine((value) => value > 0, 'Eyes are required'),
  hair: PlayerAvatarPartSchema,
  hairadd: PlayerAvatarPartSchema,
  hat: PlayerAvatarPartSchema,
  glasses: PlayerAvatarPartSchema,
  cloak: PlayerAvatarPartSchema,
  makeup: PlayerAvatarPartSchema,
  beard: PlayerAvatarPartSchema,
  ear: PlayerAvatarPartSchema,
  tail: PlayerAvatarPartSchema,
  item: PlayerAvatarPartSchema
});

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
  minWordLength: z.number().int().min(5).max(18),
  timePerRound: z.number().int().min(5).max(300),
  rounds: z.number().int().min(1).max(20),
  // Tournament-safe production ceiling, based on the Battle Royale capacity
  // validation on 2026-08-05. Raise only after another controlled test window.
  maxPlayers: z.number().int().min(2).max(60),
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
  avatar: PlayerAvatarSchema.default(DEFAULT_PLAYER_AVATAR),
  settings: GameSettingsSchema,
  isPublic: z.boolean().default(false)
});

export const CheckRoomPayloadSchema = z.object({
  roomId: RoomIdSchema
});

export const JoinRoomPayloadSchema = z.object({
  roomId: RoomIdSchema,
  username: UsernameSchema,
  avatar: PlayerAvatarSchema.default(DEFAULT_PLAYER_AVATAR)
});

export const QuickJoinRoomPayloadSchema = z.object({
  username: UsernameSchema,
  avatar: PlayerAvatarSchema.default(DEFAULT_PLAYER_AVATAR)
});

export const StartGamePayloadSchema = z.object({
  roomId: RoomIdSchema
});

export const SubmitWordPayloadSchema = z.object({
  roomId: RoomIdSchema,
  word: z.string().trim().min(1).max(40)
});

export const EmoteSchema = z.enum(['fire', 'clap', 'mindBlown', 'laugh', 'sweat', 'party', 'sideEye', 'taunt']);

// These legacy transport IDs stay stable so the visual tray can evolve without
// changing socket validation.
export const EMOTE_OPTIONS = [
  { id: 'fire', emoji: '🔥', label: 'On fire' },
  { id: 'clap', emoji: '🧠', label: 'Big brain' },
  { id: 'mindBlown', emoji: '👀', label: 'Watching' },
  { id: 'laugh', emoji: '💀', label: 'Dead' },
  { id: 'sweat', emoji: '😈', label: 'Menace' },
  { id: 'party', emoji: '🤡', label: 'Clown' },
  { id: 'sideEye', emoji: '🐐', label: 'GOAT' },
  { id: 'taunt', emoji: '🫡', label: 'Respect' }
] as const;

export const SendEmotePayloadSchema = z.object({
  roomId: RoomIdSchema,
  emote: EmoteSchema
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

export const LeaveRoomPayloadSchema = z.object({
  roomId: RoomIdSchema
});

export const PushPlatformSchema = z.enum(['android', 'ios']);

export const RegisterPushTokenPayloadSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  platform: PushPlatformSchema
});

export const SetAppActivityPayloadSchema = z.object({
  isActive: z.boolean()
});

/**
 * Strict, content-free signals for features that are entirely client-side.
 * Multiplayer gameplay itself is measured authoritatively by the server.
 */
export const FeatureUsageEventSchema = z.enum([
  'page_home_viewed',
  'page_settings_viewed',
  'page_online_viewed',
  'page_daily_viewed',
  'page_join_viewed',
  'page_room_viewed',
  'home_create_private_selected',
  'home_online_multiplayer_selected',
  'home_join_private_selected',
  'avatar_editor_opened',
  'theme_changed',
  'daily_started',
  'daily_completed',
  'daily_shared',
  'daily_share_copied',
  'invite_copied',
  'rules_opened',
  'round_history_opened'
]);

export const RecordFeatureUsagePayloadSchema = z.object({
  event: FeatureUsageEventSchema
});

export const UpdateSettingsPayloadSchema = z.object({
  roomId: RoomIdSchema,
  settings: GameSettingsSchema
});

export type GameMode = z.infer<typeof GameModeSchema>;
export type PlayerAvatar = z.infer<typeof PlayerAvatarSchema>;
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
export type Emote = z.infer<typeof EmoteSchema>;
export type SendEmotePayload = z.infer<typeof SendEmotePayloadSchema>;
export type UpdateTeamPayload = z.infer<typeof UpdateTeamPayloadSchema>;
export type UpdateBetPayload = z.infer<typeof UpdateBetPayloadSchema>;
export type RestartGamePayload = z.infer<typeof RestartGamePayloadSchema>;
export type LeaveRoomPayload = z.infer<typeof LeaveRoomPayloadSchema>;
export type PushPlatform = z.infer<typeof PushPlatformSchema>;
export type RegisterPushTokenPayload = z.infer<typeof RegisterPushTokenPayloadSchema>;
export type SetAppActivityPayload = z.infer<typeof SetAppActivityPayloadSchema>;
export type FeatureUsageEvent = z.infer<typeof FeatureUsageEventSchema>;
export type RecordFeatureUsagePayload = z.infer<typeof RecordFeatureUsagePayloadSchema>;
export type UpdateSettingsPayload = z.infer<typeof UpdateSettingsPayloadSchema>;

export type RoomPhase = 'lobby' | 'betting' | 'round' | 'betweenRounds' | 'gameOver';

export interface Player {
  id: string;
  name: string;
  avatar: PlayerAvatar;
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
  lightningTimeLeft: Record<string, number>;
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
  lightningTimeLeft?: Record<string, number>;
}

export interface WordAcceptedPayload {
  playerId: string;
  word: string;
  words: string[];
  message: string;
  score: number;
  /** Points gained or lost by this submitted word. */
  scoreDelta: number;
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

/** A transient room-wide reaction, relayed by the server without altering game state. */
export interface EmotePlayedPayload {
  playerId: string;
  playerName: string;
  emote: Emote;
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
  emotePlayed: (payload: EmotePlayedPayload) => void;
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
  sendEmote: (payload: SendEmotePayload, ack?: Ack<EmptyResult>) => void;
  restartGame: (payload: RestartGamePayload, ack?: Ack<EmptyResult>) => void;
  leaveRoom: (payload: LeaveRoomPayload, ack?: Ack<EmptyResult>) => void;
  registerPushToken: (payload: RegisterPushTokenPayload, ack?: Ack<EmptyResult>) => void;
  setAppActivity: (payload: SetAppActivityPayload, ack?: Ack<EmptyResult>) => void;
  recordFeatureUsage: (payload: RecordFeatureUsagePayload) => void;
}
