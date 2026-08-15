import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EMOTE_OPTIONS, FinalScore, GameSettings, type EmotePlayedPayload, type PlayerAvatar, RoomSnapshot, type RoundStartedPayload, RoundResultPlayer, TeamScore } from '@wow/shared';
import socket from '../services/socket';
import { loadUsername } from '../services/session';
import { hapticError, hapticLight, hapticMedium, hapticSelection, hapticSuccess, hapticWarning } from '../services/nativeFeedback';
import { getRoomInviteUrl } from '../services/platform';
import { copyTextToClipboard } from '../services/nativeShare';
import { trackFeatureUsage } from '../services/aggregateAnalytics';
import { WordDefinitionSheet } from '../components/WordDefinitionSheet';
import { SoundLabDialog } from '../components/SoundLabDialog';
import {
  classifyNoticeSound,
  stopGameAudio,
  suspendGameAudio
} from '../services/gameAudio';
import { createSoundBus } from '../game/soundBus';
import { useGameSounds } from '../game/useGameSounds';
import { useWordDefinitions } from '../game/useWordDefinitions';
import '../styles/game-score-feedback.css';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Dialog,
  Input,
  Label,
  Select,
  Separator,
  Spinner,
  Textarea,
  Progress,
  Tooltip,
} from '../components/ui';

const RANK_ICONS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

type GameActionIconName = 'share' | 'check' | 'rules' | 'sound' | 'stop' | 'exit';

function GameActionIcon({ name }: { name: GameActionIconName }): JSX.Element {
  const svgProps = {
    width: 18,
    height: 18,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'share':
      return <svg {...svgProps}><path d="M10 11V2.5" /><path d="m6.5 6 3.5-3.5L13.5 6" /><path d="M4 10.5v5h12v-5" /></svg>;
    case 'check':
      return <svg {...svgProps}><path d="m4 10 3.75 3.75L16 5.5" /></svg>;
    case 'rules':
      return <svg {...svgProps}><path d="M3.5 3.5h5a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2h-5Z" /><path d="M16.5 3.5h-5a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h5Z" /></svg>;
    case 'sound':
      return <svg {...svgProps}><path d="M4 8h3l4-3v10l-4-3H4Z" /><path d="M14 7.25a4 4 0 0 1 0 5.5" /><path d="M16 5a7 7 0 0 1 0 10" /></svg>;
    case 'stop':
      return <svg {...svgProps}><rect x="5" y="5" width="10" height="10" rx="1.5" /></svg>;
    case 'exit':
      return <svg {...svgProps}><path d="M8 3H4v14h4" /><path d="m11 6 4 4-4 4" /><path d="M7 10h8" /></svg>;
  }
}

const GAME_MODE_OPTIONS: Array<{ value: GameSettings['gameMode']; label: string; description: string }> = [
  { value: 'classic', label: 'Classic', description: 'Standard rules: every accepted word gives 3 points.' },
  { value: 'arcade', label: 'Score Attack', description: 'Reward bigger finds: every word gives 3 points plus bonus points equal to word length.' },
  { value: 'precision', label: 'Precision', description: 'Accepted words score 3 plus word length, wrong words lose 3 plus word length, and duplicates lose 3 points.' },
  { value: 'teams', label: 'Teams', description: 'Players pick Red or Blue before the game. Team totals and individual scores are both shown.' },
  { value: 'betting', label: 'Betting', description: 'Before each round, bet how many words you will make. Hit it for big points, miss it and lose the stake.' },
  { value: 'fastestNWords', label: 'Word Sprint', description: 'First player to reach the target word count ends the round and earns a 10 point bonus.' },
  { value: 'battleRoyale', label: 'Knockout', description: 'Lowest scoring players are eliminated after each round until a winner emerges.' },
  { value: 'typist', label: 'Blind Type', description: 'Your typed word stays hidden until you submit it.' },
  { value: 'category', label: 'Theme Challenge', description: 'Source words come from the selected theme or your custom list.' },
  { value: 'oneWordForAll', label: 'Claim Mode', description: 'Once any player claims a word, no one else can use it.' },
  { value: 'busted', label: 'Busted Mode', description: 'Each player’s first word becomes their bust word. Type another player’s bust word and your round score explodes to 0. Matching first words are safe.' },
  { value: 'commonWord', label: 'Common Word', description: 'Unique words score +3, rare unique words with 5+ letters score +5. If two or more players make the same word, everyone who used it gets -3 for that word.' },
  { value: 'intuition', label: 'Intuition Mode', description: 'The source word starts hidden and unlocks one random letter at a time over the round. You can guess words from the hidden letters before they appear.' },
  { value: 'lightning', label: 'Lightning Mode', description: 'Each player gets their own 10-second timer. Your valid words add 1 second to your timer. If your timer hits zero, you are out for that round.' },
  { value: 'bingo', label: 'Bingo Board', description: 'Everyone gets the same 7 hard tasks from a bigger pool: Pictureka-style word hunts plus rare letters, lengths, exact positions, edge letters, vowel traps, and pattern challenges. Every task is validated to be possible without using the source word itself. Each task gives 10 points; one word can complete multiple matching tasks. Complete all 7 for a 100 point bonus, then every extra valid word scores 3 points.' },
  { value: 'mix', label: 'Mix Mode', description: 'Choose Classic or Score Attack scoring, then stack compatible modifiers: Teams, Word Sprint, Blind Type, Claim, Busted, Intuition, and Lightning.' },
];

const PLAYER_FINAL_TITLES = [
  { title: '🧙 Word Wizard', meaning: 'Made big brain words with impressive length.' },
  { title: '🔤 Alphabet Assassin', meaning: 'Kept attacking with words that started the same way.' },
  { title: '🛡️ Vowel Viking', meaning: 'Raided the round with lots of vowel-starting words.' },
  { title: '🤠 Consonant Cowboy', meaning: 'Wrangled mostly consonant-starting words.' },
  { title: '🎒 5th Grader With Wi‑Fi', meaning: 'Survived on tiny, suspiciously efficient words.' },
  { title: '🌪️ Typo Tornado', meaning: 'Created a chaotic mix that refused to fit one pattern.' },
  { title: '👺 Dictionary Goblin', meaning: 'Found weird words with rare letters like j, q, x, or z.' },
  { title: '🎯 Syllable Sniper', meaning: 'Mostly hit clean medium-length words.' },
  { title: '⌨️ Keyboard Gremlin', meaning: 'Mashed around with double letters or barely landed words.' },
  { title: '🍲 Alphabet Soup Chef', meaning: 'Mixed words from many different starting letters.' },
];

interface RoundEntry {
  round: number;
  word: string;
  results: RoundResultPlayer[];
  validWordCount: number;
}

interface NegativeMarkedWord {
  word: string;
  penalty: number;
}

interface ScoreBurst {
  id: number;
  delta: number;
}

interface EmoteBurst {
  id: number;
  playerId: string;
  playerName: string;
  emoji: string;
  label: string;
  originBottom: number;
}

interface PlayerFinalAward {
  title: string;
  meaning: string;
}

interface FinalPodiumProps {
  players: FinalScore[];
  avatarsByPlayerId: ReadonlyMap<string, PlayerAvatar>;
  currentPlayerId: string | undefined;
  getAward: (player: FinalScore) => PlayerFinalAward;
}

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;

  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

function FinalPodium({ players, avatarsByPlayerId, currentPlayerId, getAward }: FinalPodiumProps): JSX.Element | null {
  const slots: Array<{ player: FinalScore; place: 1 | 2 | 3 }> = [];
  const runnerUp = players[1];
  const winner = players[0];
  const thirdPlace = players[2];

  if (runnerUp) slots.push({ player: runnerUp, place: 2 });
  if (winner) slots.push({ player: winner, place: 1 });
  if (thirdPlace) slots.push({ player: thirdPlace, place: 3 });
  if (slots.length === 0) return null;

  return (
    <section className="final-podium" aria-label="Top three players">
      <div className="final-podium__heading">
        <span>Top players</span>
        <span>Final score</span>
      </div>
      <div className="final-podium__stage">
        {slots.map(({ player, place }) => {
          const award = getAward(player);
          const isCurrentPlayer = player.playerId === currentPlayerId;
          return (
            <article
              key={player.playerId}
              className={`podium-player podium-player--${place}${isCurrentPlayer ? ' podium-player--self' : ''}`}
              data-rank={player.rank}
              aria-label={`${ordinal(player.rank)}, ${player.playerName}, ${player.score} points`}
            >
              <div className="podium-player__profile">
                <span className="podium-player__medal" aria-hidden="true">{RANK_ICONS[player.rank] ?? `#${player.rank}`}</span>
                <Avatar name={player.playerName} avatar={avatarsByPlayerId.get(player.playerId)} colorIndex={place - 1} size="lg" className="podium-player__avatar" />
                <div className="podium-player__identity">
                  <strong title={player.playerName}>{player.playerName}</strong>
                  <span>{isCurrentPlayer ? 'You · ' : ''}{ordinal(player.rank)}</span>
                </div>
                <span className="podium-player__award" title={award.meaning}>{award.title}</span>
                <span className="podium-player__score"><strong>{player.score}</strong><small>pts</small></span>
              </div>
              <div className="podium-player__plinth" aria-hidden="true"><span>{player.rank}</span></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface PlayersPanelProps {
  className: string;
  snapshot: RoomSnapshot;
  currentPlayerId: string | undefined;
  currentPlayerTeamId: 'red' | 'blue' | undefined;
  isTeamsMode: boolean;
  isBettingMode: boolean;
  needsRejoin: boolean;
  error: string;
  onChooseTeam: (teamId: 'red' | 'blue') => void;
}

function PlayersPanel({
  className,
  snapshot,
  currentPlayerId,
  currentPlayerTeamId,
  isTeamsMode,
  isBettingMode,
  needsRejoin,
  error,
  onChooseTeam
}: PlayersPanelProps): JSX.Element {
  return (
    <aside className={className} aria-label="Players">
      <p className="eyebrow" style={{ marginBottom: 10 }}>Players</p>

      <div className="player-list">
        {snapshot.players.map((player, index) => (
          <div
            key={player.id}
            className={`player-row ${player.id === currentPlayerId ? 'self' : ''}`}
          >
            <div className="player-row__info">
              <Avatar name={player.name} avatar={player.avatar} colorIndex={index} size="sm" />
              <div className="player-row__text">
                <div className="player-row__name">{player.name}</div>
                <span className="player-row__tag">
                  {snapshot.bustedPlayers[player.id] ? '💣 Busted' : player.isEliminated ? 'Out' : `${player.isHost ? '★ Host' : player.id === currentPlayerId ? 'You' : 'Player'}${isTeamsMode && player.teamId ? ` · ${player.teamId === 'red' ? 'Red' : 'Blue'}` : ''}`}
                </span>
              </div>
            </div>
            <span className="player-row__score">{player.score}</span>
          </div>
        ))}
      </div>

      {isTeamsMode && snapshot.teamScores.length > 0 && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <p className="eyebrow" style={{ marginBottom: 0 }}>Team scores</p>
          {snapshot.teamScores.map((team) => (
            <div key={team.teamId} className="player-row" style={{ borderColor: team.teamId === 'red' ? 'rgba(255,90,90,0.35)' : 'rgba(90,160,255,0.35)' }}>
              <div className="player-row__text">
                <div className="player-row__name">{team.teamName}</div>
                <span className="player-row__tag">{team.players.length} player{team.players.length !== 1 ? 's' : ''}</span>
              </div>
              <span className="player-row__score">{team.score}</span>
            </div>
          ))}
        </div>
      )}

      {isBettingMode && snapshot.phase !== 'lobby' && snapshot.phase !== 'gameOver' && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <p className="eyebrow" style={{ marginBottom: 0 }}>Bets</p>
          {snapshot.players.map((player, playerIndex) => {
            const bet = snapshot.bettingBets[player.id];
            const words = snapshot.acceptedWordCounts[player.id] ?? snapshot.acceptedWords[player.id]?.length ?? 0;
            return (
              <div key={player.id} className="player-row">
                <div className="player-row__info">
                  <Avatar name={player.name} avatar={player.avatar} colorIndex={playerIndex} size="sm" />
                  <div className="player-row__text">
                    <div className="player-row__name">{player.name}</div>
                    <span className="player-row__tag">{bet ? `${words} / ${bet} words` : 'Choosing bet'}</span>
                  </div>
                </div>
                <span className="player-row__score">{bet ? (words >= bet ? '✅' : '🎲') : '—'}</span>
              </div>
            );
          })}
        </div>
      )}

      {isTeamsMode && snapshot.phase === 'lobby' && !needsRejoin && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Button variant={currentPlayerTeamId === 'red' ? 'primary' : 'secondary'} size="sm" onClick={() => onChooseTeam('red')}>Red Team</Button>
          <Button variant={currentPlayerTeamId === 'blue' ? 'primary' : 'secondary'} size="sm" onClick={() => onChooseTeam('blue')}>Blue Team</Button>
        </div>
      )}

      <div className="room-status">{snapshot.status.message}</div>

      {error && <Alert variant="error" style={{ marginTop: 8, fontSize: '0.80rem' }}>{error}</Alert>}
    </aside>
  );
}

interface GameToolsProps {
  className?: string;
  onSendEmote: (emote: EmotePlayedPayload['emote']) => void;
}

function GameTools({ className, onSendEmote }: GameToolsProps): JSX.Element {
  return (
    <div className={`game-tools${className ? ` ${className}` : ''}`} aria-label="Emotes">
      <div className="game-tools__emotes">
        {EMOTE_OPTIONS.map((option) => (
          <Tooltip key={option.id} content={`Send ${option.label}`}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="game-tool game-tool--emote"
              title={option.label}
              aria-label={`Send ${option.label} emote`}
              onClick={() => onSendEmote(option.id)}
            >
              <span aria-hidden="true">{option.emoji}</span>
            </Button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export default function RoomPage(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const roomId = (params.roomId ?? '').toUpperCase();

  const [snapshot, setSnapshot] = useState<RoomSnapshot | undefined>();
  const [inputWord, setInputWord] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [inputFeedback, setInputFeedback] = useState<'success' | 'error' | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResultPlayer[] | undefined>();
  const [finalScores, setFinalScores] = useState<FinalScore[]>([]);
  const [finalTeamScores, setFinalTeamScores] = useState<TeamScore[]>([]);
  const [showRoundHistory, setShowRoundHistory] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showSoundLab, setShowSoundLab] = useState(false);
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [isStoppingGame, setIsStoppingGame] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [validWordCount, setValidWordCount] = useState(0);
  const [roundHistory, setRoundHistory] = useState<RoundEntry[]>([]);
  const [negativeMarkedWords, setNegativeMarkedWords] = useState<NegativeMarkedWord[]>([]);
  const [isWordInputFocused, setIsWordInputFocused] = useState(false);
  const [betInput, setBetInput] = useState('');
  const [bustFlash, setBustFlash] = useState<{ playerId: string; playerName: string; word: string; message: string } | undefined>();
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [draftSettings, setDraftSettings] = useState<GameSettings | undefined>();
  const [infoMode, setInfoMode] = useState<(typeof GAME_MODE_OPTIONS)[number] | undefined>();
  const [scoreBursts, setScoreBursts] = useState<ScoreBurst[]>([]);
  const [emoteBursts, setEmoteBursts] = useState<EmoteBurst[]>([]);
  const [isInviteCopied, setIsInviteCopied] = useState(false);
  const [sourceDefinition, setSourceDefinition] = useState<RoundStartedPayload['sourceDefinition']>();
  // Shared game core: one sound stream + one definition behaviour, identical to
  // the single-player daily surface. Build a round feature here once and both get it.
  const soundBus = useMemo(createSoundBus, []);
  const definitions = useWordDefinitions();
  const { openWordDefinition, closeDefinitionSheet, prefetchDefinitions } = definitions;
  useGameSounds(soundBus);
  const shouldReduceMotion = useReducedMotion();

  // Keep a ref to the word input so we can restore focus after submit
  const inputRef = useRef<HTMLInputElement>(null);
  // Track the source word at round-end time for history labelling
  const currentWordRef = useRef('');
  const previousPhaseRef = useRef<RoomSnapshot['phase'] | undefined>();
  const audioSnapshotRef = useRef<RoomSnapshot>();
  const playedTimerSoundsRef = useRef<Set<string>>(new Set());
  const intuitionRevealedRef = useRef(0);
  const sprintEndedRef = useRef(false);
  const scoreBurstIdRef = useRef(0);
  const scoreBurstTimersRef = useRef<Map<number, number>>(new Map());
  const emoteBurstIdRef = useRef(0);
  const emoteBurstTimersRef = useRef<Map<number, number>>(new Map());
  const inviteCopiedTimerRef = useRef<number | undefined>();

  const currentPlayerId = socket.id;
  const currentPlayer = useMemo(
    () => snapshot?.players.find((p) => p.id === currentPlayerId),
    [currentPlayerId, snapshot]
  );
  const avatarsByPlayerId = useMemo<ReadonlyMap<string, PlayerAvatar>>(
    () => new Map((snapshot?.players ?? []).map((player) => [player.id, player.avatar])),
    [snapshot?.players]
  );
  const isHost = Boolean(currentPlayer?.isHost);
  const myWords = currentPlayerId && snapshot ? snapshot.acceptedWords[currentPlayerId] ?? [] : [];
  const canStart = isHost && snapshot &&
    (snapshot.phase === 'lobby' || snapshot.phase === 'gameOver') &&
    snapshot.players.length >= 2;
  const canStopToLobby = isHost && snapshot && ['round', 'betweenRounds', 'betting'].includes(snapshot.phase);
  const isCurrentPlayerBusted = Boolean(currentPlayerId && snapshot?.bustedPlayers[currentPlayerId]);
  const isMixMode = snapshot?.settings.gameMode === 'mix';
  const isArcadeMode = snapshot?.settings.gameMode === 'arcade' || (isMixMode && snapshot?.settings.mixScoringMode === 'arcade');
  const isPrecisionMode = snapshot?.settings.gameMode === 'precision';
  const isCommonWordMode = snapshot?.settings.gameMode === 'commonWord';
  const showsNegativeWords = isPrecisionMode || isCommonWordMode;
  const isTeamsMode = snapshot?.settings.gameMode === 'teams' || Boolean(isMixMode && snapshot?.settings.mixModifiers.teams);
  const isLengthBonusMode = isArcadeMode || isPrecisionMode;
  const isTypistMode = snapshot?.settings.gameMode === 'typist' || Boolean(isMixMode && snapshot?.settings.mixModifiers.blind);
  const isFastestNMode = snapshot?.settings.gameMode === 'fastestNWords' || Boolean(isMixMode && snapshot?.settings.mixModifiers.wordSprint);
  const isBettingMode = snapshot?.settings.gameMode === 'betting';
  const isBustedMode = snapshot?.settings.gameMode === 'busted' || Boolean(isMixMode && snapshot?.settings.mixModifiers.busted);
  const isIntuitionMode = snapshot?.settings.gameMode === 'intuition' || Boolean(isMixMode && snapshot?.settings.mixModifiers.intuition);
  const isLightningMode = snapshot?.settings.gameMode === 'lightning' || Boolean(isMixMode && snapshot?.settings.mixModifiers.lightning);
  const isBingoMode = snapshot?.settings.gameMode === 'bingo';
  const displayedTimeLeft = isLightningMode && currentPlayerId && snapshot?.phase === 'round'
    ? snapshot.lightningTimeLeft[currentPlayerId] ?? 0
    : snapshot?.timeLeft ?? 0;
  const canSubmit = snapshot?.phase === 'round' && Boolean(currentPlayer) && !currentPlayer?.isEliminated && !isCurrentPlayerBusted && (!isLightningMode || displayedTimeLeft > 0);
  const isUrgent = Boolean(snapshot?.phase === 'round' && displayedTimeLeft <= 10);
  const hasGameplayChrome = snapshot?.phase === 'round' || snapshot?.phase === 'betweenRounds';
  const timerTotal = isLightningMode ? Math.max(10, displayedTimeLeft) : snapshot?.settings.timePerRound ?? 1;
  const timerProgress = Math.max(0, Math.min(100, (displayedTimeLeft / Math.max(1, timerTotal)) * 100));
  const timerLabel = displayedTimeLeft >= 60
    ? `${Math.floor(displayedTimeLeft / 60)}:${(displayedTimeLeft % 60).toString().padStart(2, '0')}`
    : String(displayedTimeLeft);
  const timerState = isUrgent ? 'urgent' : displayedTimeLeft <= 20 ? 'warn' : 'ok';
  const currentBet = currentPlayerId && snapshot ? snapshot.bettingBets[currentPlayerId] : undefined;
  const minimumBet = currentPlayerId && snapshot ? snapshot.minimumBets[currentPlayerId] ?? 3 : 3;
  const finalTeamStandings = useMemo(() => {
    const teams = finalTeamScores.length > 0
      ? finalTeamScores
      : snapshot?.phase === 'gameOver'
        ? snapshot.teamScores
        : [];

    let previousScore: number | undefined;
    let currentRank = 0;

    return [...teams]
      .sort((left, right) => right.score - left.score)
      .map((team) => {
        if (previousScore === undefined || team.score !== previousScore) {
          currentRank += 1;
          previousScore = team.score;
        }

        return { ...team, rank: currentRank };
      });
  }, [finalTeamScores, snapshot]);
  const finalPlayerStandings = useMemo<FinalScore[]>(() => {
    if (finalScores.length > 0) return finalScores;
    if (snapshot?.phase !== 'gameOver') return [];

    let previousScore: number | undefined;
    let currentRank = 0;
    return [...snapshot.players]
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
  }, [finalScores, snapshot]);

  function wordPoints(word: string): number {
    if (isBingoMode) {
      return 0;
    }
    if (isCommonWordMode) {
      return word.length >= 5 ? 5 : 3;
    }
    return 3 + (isLengthBonusMode ? word.length : 0);
  }

  function finalPlayerAward(player: FinalScore): { title: string; meaning: string } {
    const fallback = PLAYER_FINAL_TITLES[5] ?? { title: '🌪️ Typo Tornado', meaning: 'Created a chaotic mix that refused to fit one pattern.' };
    const awardAt = (index: number): { title: string; meaning: string } => PLAYER_FINAL_TITLES[index] ?? fallback;
    const words = roundHistory.flatMap((entry) => entry.results.find((result) => result.playerId === player.playerId)?.words ?? []);

    if (words.length === 0) {
      return awardAt(8);
    }

    const startingLetters = words.map((word) => word[0]?.toLowerCase()).filter(Boolean);
    const uniqueStartingLetters = new Set(startingLetters).size;
    const mostCommonStartingLetterCount = Math.max(
      ...Array.from(new Set(startingLetters)).map((letter) => startingLetters.filter((candidate) => candidate === letter).length)
    );
    const averageLength = words.reduce((total, word) => total + word.length, 0) / words.length;
    const rareLetterWords = words.filter((word) => /[jqxz]/i.test(word)).length;
    const longWords = words.filter((word) => word.length >= 7).length;
    const mediumWords = words.filter((word) => word.length >= 4 && word.length <= 6).length;
    const shortWords = words.filter((word) => word.length <= 3).length;
    const vowelStarters = words.filter((word) => /^[aeiou]/i.test(word)).length;
    const consonantStarters = words.filter((word) => /^[bcdfghjklmnpqrstvwxyz]/i.test(word)).length;
    const doubleLetterWords = words.filter((word) => /(.)\1/i.test(word)).length;

    if (rareLetterWords / words.length >= 0.25) return awardAt(6);
    if (averageLength >= 7 || longWords / words.length >= 0.35) return awardAt(0);
    if (uniqueStartingLetters >= 5 || uniqueStartingLetters / words.length >= 0.65) return awardAt(9);
    if (vowelStarters / words.length >= 0.45) return awardAt(2);
    if (consonantStarters / words.length >= 0.8) return awardAt(3);
    if (shortWords / words.length >= 0.5) return awardAt(4);
    if (doubleLetterWords / words.length >= 0.3) return awardAt(8);
    if (mediumWords / words.length >= 0.7) return awardAt(7);
    if (mostCommonStartingLetterCount / words.length >= 0.4) return awardAt(1);

    return fallback;
  }

  function renderWordBadge(word: string, style?: CSSProperties): JSX.Element {
    const pointsTitle = isBingoMode ? 'Bingo words only score when they complete a task' : `${wordPoints(word)} points`;
    return (
      <button
        key={word}
        type="button"
        className="accepted-word-button"
        style={style}
        title={`${pointsTitle}. View definition`}
        aria-label={`${word}. ${pointsTitle}. View definition`}
        onClick={() => { void openWordDefinition(word); }}
      >
        <Badge variant="word" className="scored-word-badge">
          <span>{word}</span>
          {isBingoMode ? null : isLengthBonusMode ? (
            <span className="word-score-formula" aria-label={`3 plus ${word.length} equals ${wordPoints(word)} points`}>
              <strong>3+{word.length}</strong>
              <span>= {wordPoints(word)}</span>
            </span>
          ) : isCommonWordMode && word.length >= 5 ? (
            <span className="word-score-formula">+5</span>
          ) : (
            <span className="word-score-formula">+3</span>
          )}
        </Badge>
      </button>
    );
  }

  function intuitionUnlockOrder(word: string): number[] {
    let seed = Array.from(word).reduce((hash, letter) => ((hash << 5) - hash + letter.charCodeAt(0)) | 0, 0) || 1;
    const order = Array.from({ length: word.length }, (_, index) => index);

    for (let index = order.length - 1; index > 0; index -= 1) {
      seed = (seed * 1664525 + 1013904223) | 0;
      const swapIndex = Math.abs(seed) % (index + 1);
      const currentIndex = order[index] as number;
      order[index] = order[swapIndex] as number;
      order[swapIndex] = currentIndex;
    }

    return order;
  }

  function renderIntuitionWord(word: string): JSX.Element {
    const shouldUnlock = isIntuitionMode && snapshot?.phase === 'round';
    const totalTime = Math.max(1, snapshot?.settings.timePerRound ?? 1);
    const elapsed = Math.max(0, totalTime - (snapshot?.timeLeft ?? totalTime));
    const revealedLetters = shouldUnlock ? Math.min(word.length, Math.floor((elapsed * word.length) / totalTime)) : word.length;
    const unlockedIndexes = shouldUnlock
      ? new Set(intuitionUnlockOrder(word).slice(0, revealedLetters))
      : new Set(Array.from({ length: word.length }, (_, index) => index));

    return (
      <span
        key={word}
        className={`current-word-text${shouldUnlock ? ' current-word-text--intuition' : ''}`}
        aria-label={shouldUnlock ? `${revealedLetters} of ${word.length} letters unlocked randomly` : word}
      >
        {Array.from(word).map((letter, index) => (
          <span key={`${letter}-${index}`} className={unlockedIndexes.has(index) ? 'intuition-letter unlocked' : 'intuition-letter locked'}>
            {unlockedIndexes.has(index) ? letter : '•'}
          </span>
        ))}
      </span>
    );
  }

  function renderNegativeWordBadge(entry: NegativeMarkedWord, index: number): JSX.Element {
    return (
      <Badge
        key={`${entry.word}-${index}`}
        variant="word"
        className="scored-word-badge"
        style={{ borderColor: 'rgba(255, 90, 90, 0.45)', color: 'var(--error)', background: 'rgba(255, 90, 90, 0.08)' }}
        title={`${entry.penalty} points`}
      >
        <span>{entry.word}</span>
        <span className="word-score-formula"><strong>{entry.penalty}</strong></span>
      </Badge>
    );
  }

  // Auto-dismiss notice after 3 s
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Auto-clear input feedback after 600 ms
  useEffect(() => {
    if (!inputFeedback) return;
    const t = window.setTimeout(() => setInputFeedback(null), 600);
    return () => window.clearTimeout(t);
  }, [inputFeedback]);

  useEffect(() => {
    if (!bustFlash) return;
    const t = window.setTimeout(() => setBustFlash(undefined), 2600);
    return () => window.clearTimeout(t);
  }, [bustFlash]);

  useEffect(() => () => {
    scoreBurstTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    scoreBurstTimersRef.current.clear();
    emoteBurstTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    emoteBurstTimersRef.current.clear();
    if (inviteCopiedTimerRef.current !== undefined) window.clearTimeout(inviteCopiedTimerRef.current);
  }, []);

  useEffect(() => () => suspendGameAudio(), []);

  /* ── socket setup ── */
  useEffect(() => {
    if (!roomId) return;

    function loadRoom(): void {
      socket.emit('checkRoom', { roomId }, (response) => {
        if (!response.ok) { setError(response.error); return; }
        if (!response.data.exists || !response.data.snapshot) {
          setError('Room not found.');
          return;
        }
        setSnapshot(response.data.snapshot);
        setSourceDefinition(response.data.snapshot.sourceDefinition);
        audioSnapshotRef.current = response.data.snapshot;
        previousPhaseRef.current = response.data.snapshot.phase;
        currentWordRef.current = response.data.snapshot.currentWord;
        setWaitingSeconds(response.data.snapshot.waitingSeconds);
      });
    }

    loadRoom();
    socket.on('connect', loadRoom);
    return () => {
      socket.off('connect', loadRoom);
    };
  }, [roomId]);

  useEffect(() => {
    const onSnapshot = (payload: { snapshot: RoomSnapshot }): void => {
      const previousPhase = previousPhaseRef.current;
      const isNewBettingGame = payload.snapshot.phase === 'betting' && payload.snapshot.currentRound === 0 && previousPhase !== 'betting';
      if (isNewBettingGame) {
        resetClientGameState();
      }
      if (payload.snapshot.phase === 'betting' && previousPhase !== 'betting') {
        setShowSoundLab(false);
        soundBus.play('bettingStart');
      }
      previousPhaseRef.current = payload.snapshot.phase;
      audioSnapshotRef.current = payload.snapshot;
      setSnapshot(payload.snapshot);
      setSourceDefinition(payload.snapshot.sourceDefinition);
      currentWordRef.current = payload.snapshot.currentWord;
      setWaitingSeconds(payload.snapshot.waitingSeconds);
    };

    const onEmotePlayed = (payload: EmotePlayedPayload): void => queueEmoteBurst(payload);

    socket.on('roomSnapshot', onSnapshot);
    socket.on('playerJoined', (p) => {
      audioSnapshotRef.current = p.snapshot;
      setSnapshot(p.snapshot);
      setNotice(`${p.player.name} joined.`);
      soundBus.play('playerJoin');
    });
    socket.on('playerLeft', (p) => {
      audioSnapshotRef.current = p.snapshot;
      setSnapshot(p.snapshot);
      setNotice('A player left.');
      soundBus.play('playerLeave');
    });
    socket.on('hostChanged', (p) => {
      audioSnapshotRef.current = p.snapshot;
      setSnapshot(p.snapshot);
      setNotice(p.hostId === socket.id ? 'You are now the host.' : 'Host changed.');
    });
    socket.on('roundStarted', (p) => {
      closeDefinitionSheet();
      if (p.currentRound === 1) {
        resetClientGameState();
      }
      setSourceDefinition(p.sourceDefinition);
      previousPhaseRef.current = p.snapshot.phase;
      audioSnapshotRef.current = p.snapshot;
      playedTimerSoundsRef.current.clear();
      intuitionRevealedRef.current = 0;
      sprintEndedRef.current = false;
      setShowSoundLab(false);
      setSnapshot(p.snapshot);
      currentWordRef.current = p.currentWord;
      setRoundResults(undefined);
      setInputWord('');
      setNotice(`Round ${p.currentRound} started.`);
      setWaitingSeconds(0);
      setValidWordCount(0);
      setNegativeMarkedWords([]);
      setBetInput('');
      setBustFlash(undefined);
      soundBus.emit({ type: 'roundStart' });
      void hapticMedium();
      // Restore keyboard focus when a new round begins
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    socket.on('timeUpdate', (p) => {
      const audioSnapshot = audioSnapshotRef.current;
      if (audioSnapshot?.phase === 'round') {
        const usesLightning = audioSnapshot.settings.gameMode === 'lightning'
          || (audioSnapshot.settings.gameMode === 'mix' && audioSnapshot.settings.mixModifiers.lightning);
        const playerId = socket.id;
        const previousPersonalTime = playerId ? audioSnapshot.lightningTimeLeft[playerId] : undefined;
        const audibleTime = usesLightning && playerId
          ? p.lightningTimeLeft?.[playerId] ?? previousPersonalTime ?? 0
          : p.timeLeft;
        const warningAt = usesLightning ? 5 : 10;
        // The shared useGameSounds hook owns the tick cadence and per-second
        // dedup (a calm tick through the warning window, the urgent tick for
        // 3-2-1), so the room and the daily surface stay identical.
        soundBus.emit({ type: 'timerTick', secondsLeft: audibleTime, warnAt: warningAt, roundKey: audioSnapshot.currentRound });
        if (usesLightning && previousPersonalTime !== undefined && previousPersonalTime > 0 && audibleTime <= 0) {
          const timeoutKey = `${audioSnapshot.currentRound}:lightning-timeout`;
          if (!playedTimerSoundsRef.current.has(timeoutKey)) {
            playedTimerSoundsRef.current.add(timeoutKey);
            soundBus.play('lightningTimeout');
          }
        }

        const usesIntuition = audioSnapshot.settings.gameMode === 'intuition'
          || (audioSnapshot.settings.gameMode === 'mix' && audioSnapshot.settings.mixModifiers.intuition);
        if (usesIntuition && audioSnapshot.currentWord) {
          const total = Math.max(1, audioSnapshot.settings.timePerRound);
          // Monotonic per round: only fire when more letters than ever are shown,
          // so a Lightning timer gain cannot replay an already-heard reveal.
          const nextRevealed = Math.floor(((total - p.timeLeft) * audioSnapshot.currentWord.length) / total);
          if (nextRevealed > intuitionRevealedRef.current && nextRevealed <= audioSnapshot.currentWord.length) {
            intuitionRevealedRef.current = nextRevealed;
            soundBus.play('intuitionReveal');
          }
        }
      }
      setSnapshot((s) => {
        if (!s) return s;
        const next = { ...s, timeLeft: p.timeLeft, lightningTimeLeft: p.lightningTimeLeft ?? s.lightningTimeLeft };
        audioSnapshotRef.current = next;
        return next;
      });
    });
    socket.on('wordAccepted', (p) => {
      setInputFeedback('success');
      if (p.playerId === socket.id && typeof p.scoreDelta === 'number') queueScoreBurst(p.scoreDelta);
      const audioSnapshot = audioSnapshotRef.current;
      const usesLightning = audioSnapshot?.settings.gameMode === 'lightning'
        || (audioSnapshot?.settings.gameMode === 'mix' && audioSnapshot.settings.mixModifiers.lightning);
      soundBus.emit({ type: 'wordAccepted', message: p.message, lightning: Boolean(usesLightning) });
      void hapticLight();
      if (p.message) setNotice(p.message);
      if (p.message.includes('-3')) {
        setNegativeMarkedWords((current) => [
          ...current,
          { word: p.word.trim().toLowerCase() || p.word, penalty: -3 },
        ]);
      }
      setSnapshot((s) => {
        if (!s) return s;
        return {
          ...s,
          acceptedWords: { ...s.acceptedWords, [p.playerId]: p.words },
          acceptedWordCounts: { ...s.acceptedWordCounts, [p.playerId]: p.words.length },
        };
      });
    });
    socket.on('wordRejected', (p) => {
      setInputFeedback('error');
      if (p.penalty) queueScoreBurst(p.penalty);
      soundBus.emit({ type: 'wordRejected', message: p.message, penalty: p.penalty });
      void hapticError();
      setNotice(p.message);
      if (p.penalty && p.penalty < 0) {
        setNegativeMarkedWords((current) => [
          ...current,
          { word: p.word.trim().toLowerCase() || p.word, penalty: p.penalty as number },
        ]);
      }
    });
    socket.on('scoresUpdated', (p) => {
      setSnapshot((s) => {
        if (p.snapshot) {
          audioSnapshotRef.current = p.snapshot;
          return p.snapshot;
        }
        if (!s) return s;
        const scoreByPlayer = new Map(p.scores);
        return {
          ...s,
          players: s.players.map((player) => ({
            ...player,
            score: scoreByPlayer.get(player.id) ?? player.score,
          })),
          ...(p.acceptedWordCounts ? { acceptedWordCounts: p.acceptedWordCounts } : {}),
          ...(p.teamScores ? { teamScores: p.teamScores } : {}),
          ...(p.bettingBets ? { bettingBets: p.bettingBets } : {}),
          ...(p.bettingAverages ? { bettingAverages: p.bettingAverages } : {}),
          ...(p.minimumBets ? { minimumBets: p.minimumBets } : {}),
          ...(p.bingoProgress ? { bingoProgress: p.bingoProgress } : {}),
        };
      });
    });
    socket.on('roundEnded', (p) => {
      void prefetchDefinitions(p.results.flatMap((result) => result.words));
      previousPhaseRef.current = p.snapshot.phase;
      audioSnapshotRef.current = p.snapshot;
      if (p.snapshot.settings.gameMode === 'betting') {
        const localResult = p.results.find((result) => result.playerId === socket.id);
        soundBus.play(localResult?.bettingHit ? 'bettingWin' : 'bettingLoss');
      } else if (!sprintEndedRef.current) {
        soundBus.emit({ type: 'roundEnd' });
      }
      sprintEndedRef.current = false;
      setSnapshot(p.snapshot);
      setRoundResults(p.results);
      setWaitingSeconds(p.nextRoundStartsIn);
      setValidWordCount(p.validWords.length);
      setNotice('Round ended.');
      // Accumulate history
      setRoundHistory((prev) => [
        ...prev,
        {
          round: p.currentRound,
          word: currentWordRef.current,
          results: p.results,
          validWordCount: p.validWords.length,
        },
      ]);
    });
    socket.on('gameOver', (p) => {
      if (p.results) void prefetchDefinitions(p.results.flatMap((result) => result.words));
      previousPhaseRef.current = p.snapshot.phase;
      audioSnapshotRef.current = p.snapshot;
      const isTeamsGame = p.snapshot.settings.gameMode === 'teams'
        || (p.snapshot.settings.gameMode === 'mix' && p.snapshot.settings.mixModifiers.teams);
      let localWon: boolean;
      if (isTeamsGame && p.snapshot.teamScores.length > 0) {
        const me = p.snapshot.players.find((player) => player.id === socket.id);
        const topTeamScore = Math.max(...p.snapshot.teamScores.map((team) => team.score));
        const myTeam = me?.teamId ? p.snapshot.teamScores.find((team) => team.teamId === me.teamId) : undefined;
        localWon = Boolean(myTeam && myTeam.score === topTeamScore);
      } else {
        localWon = p.finalScores.find((score) => score.playerId === socket.id)?.rank === 1;
      }
      stopGameAudio();
      soundBus.play(localWon ? 'victory' : 'gameOver');
      setSnapshot(p.snapshot);
      setFinalScores(p.finalScores);
      setFinalTeamScores(p.snapshot.teamScores);
      setRoundResults(p.results);
      setWaitingSeconds(0);
      if (p.results && p.currentRound) {
        const finalRound = p.currentRound;
        const finalRoundResults = p.results;
        const finalRoundValidWordCount = p.validWords?.length ?? 0;

        setRoundHistory((prev) => {
          if (prev.some((entry) => entry.round === finalRound)) {
            return prev;
          }

          return [
            ...prev,
            {
              round: finalRound,
              word: currentWordRef.current || p.snapshot.currentWord,
              results: finalRoundResults,
              validWordCount: finalRoundValidWordCount,
            },
          ];
        });
      }
      setNotice('Game over!');
      void hapticSuccess();
    });
    socket.on('playerBusted', (p) => {
      audioSnapshotRef.current = p.snapshot;
      setSnapshot(p.snapshot);
      setInputFeedback(p.playerId === socket.id ? 'error' : null);
      soundBus.play(p.playerId === socket.id ? 'bombSelf' : 'bomb');
      setNotice(p.message);
      setBustFlash({ playerId: p.playerId, playerName: p.playerName, word: p.word, message: p.message });
      void hapticWarning();
    });
    socket.on('emotePlayed', onEmotePlayed);
    socket.on('gameRestarted', (p) => {
      closeDefinitionSheet();
      stopGameAudio();
      setSourceDefinition(undefined);
      previousPhaseRef.current = p.snapshot.phase;
      audioSnapshotRef.current = p.snapshot;
      playedTimerSoundsRef.current.clear();
      intuitionRevealedRef.current = 0;
      setSnapshot(p.snapshot);
      resetClientGameState();
      setNotice(p.autoStart ? 'New round incoming.' : 'Reset to lobby.');
    });
    socket.on('notice', (p) => {
      setNotice(p.message);
      const sound = classifyNoticeSound(p.message);
      if (sound) {
        if (sound === 'sprintWin' || sound === 'elimination') sprintEndedRef.current = true;
        soundBus.play(sound);
      }
    });

    return () => {
      socket.off('roomSnapshot', onSnapshot);
      socket.off('playerJoined');
      socket.off('playerLeft');
      socket.off('hostChanged');
      socket.off('roundStarted');
      socket.off('timeUpdate');
      socket.off('wordAccepted');
      socket.off('wordRejected');
      socket.off('scoresUpdated');
      socket.off('roundEnded');
      socket.off('gameOver');
      socket.off('gameRestarted');
      socket.off('playerBusted');
      socket.off('emotePlayed', onEmotePlayed);
      socket.off('notice');
    };
  }, []);

  useEffect(() => {
    if (waitingSeconds <= 0) return;
    const t = window.setInterval(() => {
      setWaitingSeconds((n) => Math.max(0, n - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [waitingSeconds]);

  /* ── actions ── */
  async function copyInvite(): Promise<void> {
    const copied = await copyTextToClipboard(getRoomInviteUrl(roomId));
    if (!copied) {
      void hapticError();
      return;
    }

    if (inviteCopiedTimerRef.current !== undefined) {
      window.clearTimeout(inviteCopiedTimerRef.current);
    }
    trackFeatureUsage('invite_copied');
    setIsInviteCopied(true);
    inviteCopiedTimerRef.current = window.setTimeout(() => {
      setIsInviteCopied(false);
      inviteCopiedTimerRef.current = undefined;
    }, 1600);
    void hapticLight();
  }

  function startGame(): void {
    closeDefinitionSheet();
    socket.emit('startGame', { roomId }, (r) => {
      if (!r.ok) setError(r.error);
      else setError('');
    });
  }

  function submitWord(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const word = inputWord.trim();
    if (!word || !canSubmit) return;
    socket.emit('submitWord', { roomId, word }, (r) => {
      if (!r.ok) setError(r.error);
    });
    setInputWord('');
    // Keep the keyboard up — restore focus after React flushes the state update
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function sendEmote(emote: EmotePlayedPayload['emote']): void {
    socket.emit('sendEmote', { roomId, emote }, (response) => {
      if (!response.ok) {
        void hapticError();
        return;
      }

      void hapticSelection();
    });
    if (canSubmit) requestAnimationFrame(() => inputRef.current?.focus());
  }

  function submitBet(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const bet = Number(betInput);
    if (!Number.isInteger(bet)) return;
    socket.emit('updateBet', { roomId, bet }, (r) => {
      if (!r.ok) setError(r.error);
      else {
        setError('');
        soundBus.play('betLocked');
      }
    });
  }

  function restartGame(): void {
    closeDefinitionSheet();
    socket.emit('restartGame', { roomId, autoStart: true }, (r) => {
      if (!r.ok) setError(r.error);
    });
  }

  function openHowToPlay(): void {
    trackFeatureUsage('rules_opened');
    inputRef.current?.blur();
    setShowHowToPlay(true);
  }

  function openStopConfirmation(): void {
    inputRef.current?.blur();
    setError('');
    setShowStopConfirmation(true);
  }

  function exitRoom(): void {
    if (isExiting) return;

    inputRef.current?.blur();
    if (!currentPlayer) {
      navigate('/', { replace: true });
      return;
    }

    setIsExiting(true);
    socket.emit('leaveRoom', { roomId }, (response) => {
      setIsExiting(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }

      void hapticLight();
      navigate('/', { replace: true });
    });
  }

  function stopToLobby(): void {
    if (isStoppingGame) return;

    setIsStoppingGame(true);
    socket.emit('restartGame', { roomId, autoStart: false }, (r) => {
      setIsStoppingGame(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }

      setError('');
      setShowStopConfirmation(false);
    });
  }

  function openSettingsDialog(): void {
    setDraftSettings(snapshot?.settings);
    setInfoMode(undefined);
    setShowSettingsDialog(true);
  }

  function setDraft<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    setDraftSettings((prev) => prev ? {
      ...prev,
      [key]: value,
      ...(key === 'gameMode' && value === 'lightning' ? { timePerRound: 10 } : {})
    } : prev);
  }

  function setDraftMixModifier(key: keyof GameSettings['mixModifiers'], value: boolean): void {
    setDraftSettings((prev) => prev ? {
      ...prev,
      timePerRound: key === 'lightning' && value ? 10 : prev.timePerRound,
      mixModifiers: {
        ...prev.mixModifiers,
        [key]: value
      }
    } : prev);
  }

  function saveSettings(): void {
    if (!draftSettings) return;
    const playerCount = snapshot?.players.length ?? 0;
    if (draftSettings.maxPlayers < playerCount) {
      setError(`Max players cannot be lower than the ${playerCount} players already in the room.`);
      return;
    }
    if (draftSettings.gameMode === 'battleRoyale' && draftSettings.eliminationsPerRound * draftSettings.rounds >= playerCount) {
      setError('Knockout would finish before all rounds are played. Lower eliminations, lower rounds, or increase players.');
      return;
    }

    socket.emit('updateSettings', { roomId, settings: draftSettings }, (r) => {
      if (!r.ok) { setError(r.error); return; }
      setError('');
      setShowSettingsDialog(false);
    });
  }

  function queueScoreBurst(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;

    const id = scoreBurstIdRef.current;
    scoreBurstIdRef.current += 1;
    setScoreBursts((current) => [...current, { id, delta }].slice(-3));

    const timer = window.setTimeout(() => {
      scoreBurstTimersRef.current.delete(id);
      setScoreBursts((current) => current.filter((burst) => burst.id !== id));
    }, 1000);
    scoreBurstTimersRef.current.set(id, timer);
  }

  function clearScoreBursts(): void {
    scoreBurstTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    scoreBurstTimersRef.current.clear();
    setScoreBursts([]);
  }

  function queueEmoteBurst(payload: EmotePlayedPayload): void {
    const option = EMOTE_OPTIONS.find((candidate) => candidate.id === payload.emote);
    if (!option) return;

    const id = emoteBurstIdRef.current;
    emoteBurstIdRef.current += 1;
    const inputTop = inputRef.current?.getBoundingClientRect().top;
    const distanceAboveInput = 52 + Math.round(Math.random() * 72);
    const originBottom = inputTop === undefined
      ? 232
      : Math.max(120, window.innerHeight - inputTop + distanceAboveInput + 20);
    setEmoteBursts((current) => [
      ...current,
      { id, playerId: payload.playerId, playerName: payload.playerName, emoji: option.emoji, label: option.label, originBottom }
    ].slice(-3));

    const timer = window.setTimeout(() => {
      emoteBurstTimersRef.current.delete(id);
      setEmoteBursts((current) => current.filter((burst) => burst.id !== id));
    }, 2200);
    emoteBurstTimersRef.current.set(id, timer);
  }

  function clearEmoteBursts(): void {
    emoteBurstTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    emoteBurstTimersRef.current.clear();
    setEmoteBursts([]);
  }

  function resetClientGameState(): void {
    closeDefinitionSheet();
    setSourceDefinition(undefined);
    clearScoreBursts();
    clearEmoteBursts();
    setRoundResults(undefined);
    setFinalScores([]);
    setFinalTeamScores([]);
    setShowRoundHistory(false);
    setRoundHistory([]);
    setWaitingSeconds(0);
    setValidWordCount(0);
    setNegativeMarkedWords([]);
    setInputWord('');
    setBetInput('');
    setBustFlash(undefined);
  }

  function chooseTeam(teamId: 'red' | 'blue'): void {
    socket.emit('updateTeam', { roomId, teamId }, (r) => {
      if (!r.ok) setError(r.error);
      else setError('');
    });
  }

  /* ── error / loading states ── */
  if (!roomId) {
    return (
      <main className="page-shell">
        <section className="panel-card">
          <p className="eyebrow">Oops</p>
          <h1>Missing room</h1>
          <Link to="/"><Button variant="secondary">← Go Home</Button></Link>
        </section>
      </main>
    );
  }

  if (error && !snapshot) {
    return (
      <main className="page-shell">
        <section className="panel-card">
          <p className="eyebrow">Not found</p>
          <h1>Room unavailable</h1>
          <Alert variant="error" style={{ marginBottom: 20 }}>{error}</Alert>
          <Button variant="primary" onClick={() => navigate('/join')}>Try Another Room</Button>
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="page-shell">
        <section className="panel-card loading-card">
          <Spinner size="lg" />
          <div>
            <h1>Opening room…</h1>
            <p className="muted centered">Connecting to the table</p>
          </div>
        </section>
      </main>
    );
  }

  const needsRejoin = !currentPlayer;
  const roomPhase = snapshot.phase;
  const currentModeLabel = GAME_MODE_OPTIONS.find((mode) => mode.value === snapshot.settings.gameMode)?.label ?? snapshot.settings.gameMode;
  const mixModifierLabels = snapshot.settings.gameMode === 'mix'
    ? [
      snapshot.settings.mixModifiers.teams && 'Teams',
      snapshot.settings.mixModifiers.wordSprint && `Word Sprint: ${snapshot.settings.mixModifiers.teams ? 'first team' : 'first player'} to ${snapshot.settings.fastestWordTarget}`,
      snapshot.settings.mixModifiers.blind && 'Blind Type',
      snapshot.settings.mixModifiers.claim && 'Claim: words are global',
      snapshot.settings.mixModifiers.busted && 'Busted',
      snapshot.settings.mixModifiers.intuition && 'Intuition reveal',
      snapshot.settings.mixModifiers.lightning && 'Lightning: +1s per word'
    ].filter((label): label is string => Boolean(label))
    : [];
  const mixScoringLabel = snapshot.settings.mixScoringMode === 'arcade' ? 'Score Attack' : 'Classic';
  const stageCtas = (needsRejoin || canStart ||
    (!needsRejoin && (
      (snapshot.phase === 'lobby' && (!isHost || snapshot.players.length < 2)) ||
      (snapshot.phase === 'gameOver' && !isHost)
    ))) ? (
      <div className="stage-ctas">
        {needsRejoin && (
          <div className="rejoin-card" style={{ marginBottom: 0 }}>
            <p>You're watching but not seated.</p>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => navigate(`/join/${roomId}`)}
            >
              Rejoin as {loadUsername() || 'player'}
            </Button>
          </div>
        )}
        {canStart && (
          <>
            <Button variant="primary" size="lg" fullWidth onClick={snapshot.phase === 'gameOver' ? restartGame : startGame}>
              {snapshot.phase === 'gameOver' ? 'Play Again' : 'Start Game'}
            </Button>
            <Button variant="secondary" size="sm" fullWidth onClick={openSettingsDialog}>
              Change Settings
            </Button>
          </>
        )}
        {!isHost && snapshot.phase === 'lobby' && snapshot.players.length >= 2 && !needsRejoin && (
          <p className="muted centered" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
            Waiting for the host to start.
          </p>
        )}
        {!isHost && snapshot.phase === 'gameOver' && !needsRejoin && (
          <p className="muted centered" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
            Waiting for the host to play again.
          </p>
        )}
        {snapshot.players.length < 2 && !needsRejoin && (
          <p className="muted centered" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
            Waiting for one more player.
          </p>
        )}
      </div>
    ) : null;
  const mobilePlayersPanel = (
    <PlayersPanel
      className="mobile-players-panel"
      snapshot={snapshot}
      currentPlayerId={currentPlayerId}
      currentPlayerTeamId={currentPlayer?.teamId}
      isTeamsMode={isTeamsMode}
      isBettingMode={isBettingMode}
      needsRejoin={needsRejoin}
      error={error}
      onChooseTeam={chooseTeam}
    />
  );

  function renderGameFooter(): JSX.Element {
    return (
      <div className="gameplay-footer">
        {!needsRejoin && <GameTools onSendEmote={sendEmote} />}
        <form className="word-form word-form--entry" onSubmit={submitWord}>
          <div className="word-form__input-wrap">
            <Input
              ref={inputRef}
              type={isTypistMode ? 'password' : 'text'}
              className="word-entry-input"
              aria-label="Word entry"
              value={inputWord}
              onChange={(e) => setInputWord(e.currentTarget.value)}
              onFocus={() => setIsWordInputFocused(true)}
              onBlur={() => setIsWordInputFocused(false)}
              placeholder={isCurrentPlayerBusted ? 'You are busted this round 💣' : canSubmit ? (isTypistMode ? 'Blind Type: hidden word' : 'Type a word…') : needsRejoin ? 'Rejoin to submit' : roomPhase === 'betweenRounds' ? `Next round in ${waitingSeconds}s` : roomPhase === 'gameOver' ? 'Game over — waiting for restart' : 'Waiting for the round'}
              disabled={!canSubmit}
              hasError={inputFeedback === 'error'}
              hasSuccess={inputFeedback === 'success'}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
            />
            <span className="word-score-float-layer" aria-live="polite" aria-atomic="false">
              {scoreBursts.map((burst) => (
                <span
                  key={burst.id}
                  className={`word-score-float${burst.delta < 0 ? ' word-score-float--negative' : ''}`}
                  aria-label={`${burst.delta > 0 ? 'plus' : 'minus'} ${Math.abs(burst.delta)} points`}
                >
                  {burst.delta > 0 ? `+${burst.delta}` : `−${Math.abs(burst.delta)}`}
                </span>
              ))}
            </span>
          </div>
        </form>
      </div>
    );
  }

  /* ── main game view ── */
  return (
    <main className={`game-shell${hasGameplayChrome ? ' has-gameplay-chrome' : ''}${isWordInputFocused ? ' is-typing' : ''}`}>
      <div className="emote-burst-layer" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false}>
          {emoteBursts.map((burst) => {
            const senderName = burst.playerId === currentPlayerId ? 'You' : burst.playerName;
            return (
              <motion.div
                key={burst.id}
                className={`emote-burst-slot emote-burst-slot--${burst.id % 3}`}
                role="status"
                aria-label={`${senderName} sent ${burst.label}`}
                style={{ bottom: `${burst.originBottom}px`, transformOrigin: '0 50%' }}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.46, y: 20, rotate: -7 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: -140, rotate: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.62, y: -190, rotate: 6, transition: { duration: 0.28, ease: 'easeIn' } }}
                transition={shouldReduceMotion ? { duration: 0.12 } : {
                  opacity: { duration: 0.18, ease: 'easeOut' },
                  scale: { type: 'spring', stiffness: 420, damping: 29, mass: 0.7 },
                  y: { duration: 2.1, ease: 'linear' },
                  rotate: { type: 'spring', stiffness: 420, damping: 29, mass: 0.7 }
                }}
              >
                <div className="emote-burst">
                  <span className="emote-burst__emoji" aria-hidden="true">{burst.emoji}</span>
                  <span className="emote-burst__sender">{senderName}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {bustFlash && (
        <div className={`bust-overlay ${bustFlash.playerId === currentPlayerId ? 'self' : ''}`} role="status" aria-live="assertive">
          <div className="bomb-blast" aria-hidden="true">💣</div>
          <div className="blast-ring" aria-hidden="true" />
          <div className="bust-card">
            <Avatar name={bustFlash.playerName} avatar={avatarsByPlayerId.get(bustFlash.playerId)} size="lg" className="bust-avatar" />
            <div className="bust-title">BOOOOM!</div>
            <div className="bust-message">{bustFlash.playerName} is BUSTED</div>
            <div className="bust-word">typed “{bustFlash.word}” · round score 0</div>
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <header className="game-header">
        <div className="game-header__left">
          <span className="game-header__label">room</span>
          <span className="game-header__roomid">{snapshot.roomId.toLowerCase()}</span>
          <span className="game-header__dot">·</span>
          <span className="game-header__mode" aria-label={`Current mode: ${currentModeLabel}`}>{currentModeLabel}</span>
          <span className="game-header__dot">·</span>
          <span className="game-header__count">
            {snapshot.players.length} player{snapshot.players.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="game-header__right">
          <Tooltip content={isInviteCopied ? 'copied' : 'Copy invite link'} className="ui-tooltip-down">
            <Button
              variant="mini"
              size="sm"
              type="button"
              className="game-header__action"
              onClick={() => { void copyInvite(); }}
              aria-label={isInviteCopied ? 'Invite link copied' : 'Copy invite link'}
            >
              <GameActionIcon name={isInviteCopied ? 'check' : 'share'} />
              <span className="game-header__action-label">Invite</span>
            </Button>
          </Tooltip>
          {['lobby', 'betweenRounds', 'gameOver'].includes(roomPhase) && (
            <Tooltip content="Sound settings" className="ui-tooltip-down">
              <Button variant="mini" size="sm" type="button" className="game-header__action" onClick={() => setShowSoundLab(true)} aria-label="Sound settings and preview">
                <GameActionIcon name="sound" />
                <span className="game-header__action-label">Sound</span>
              </Button>
            </Tooltip>
          )}
          <Tooltip content="How to play" className="ui-tooltip-down">
            <Button variant="mini" size="sm" type="button" className="game-header__action" onClick={openHowToPlay} aria-label="How to play">
              <GameActionIcon name="rules" />
              <span className="game-header__action-label">Rules</span>
            </Button>
          </Tooltip>
          {canStopToLobby && (
            <Tooltip content="Stop game for everyone and return to the lobby" className="ui-tooltip-down">
              <Button variant="mini" size="sm" type="button" className="game-header__action game-header__action--stop" onClick={openStopConfirmation} aria-label="Stop game for everyone and return to the lobby">
                <GameActionIcon name="stop" />
                <span className="game-header__action-label">Stop</span>
              </Button>
            </Tooltip>
          )}
          <Tooltip content={needsRejoin ? 'Exit room' : 'Leave this room'} className="ui-tooltip-down ui-tooltip-end">
            <Button variant="mini" size="sm" type="button" className="game-header__action game-header__action--exit" onClick={exitRoom} disabled={isExiting} aria-busy={isExiting} aria-label={needsRejoin ? 'Exit room' : 'Leave this room'}>
              <GameActionIcon name="exit" />
              <span className="game-header__action-label">Exit</span>
            </Button>
          </Tooltip>
        </div>
      </header>

      {snapshot.settings.gameMode === 'mix' && (
        <section className="mix-config-banner" aria-label="Mix mode configuration">
          <div>
            <span className="mix-config-banner__kicker">Mix Mode active</span>
            <strong>{mixScoringLabel} scoring</strong>
          </div>
          <div className="mix-config-banner__chips">
            {mixModifierLabels.length > 0
              ? mixModifierLabels.map((label) => <span key={label}>{label}</span>)
              : <span>No modifiers</span>}
          </div>
          {(snapshot.settings.mixModifiers.claim || snapshot.settings.mixModifiers.busted) && (
            <p>Priority: valid word → busted check → claim check → score.</p>
          )}
        </section>
      )}

      {/* ── LEFT: Players ── */}
      <PlayersPanel
        className="players-panel glass-panel"
        snapshot={snapshot}
        currentPlayerId={currentPlayerId}
        currentPlayerTeamId={currentPlayer?.teamId}
        isTeamsMode={isTeamsMode}
        isBettingMode={isBettingMode}
        needsRejoin={needsRejoin}
        error={error}
        onChooseTeam={chooseTeam}
      />

      {/* ── CENTER: Word Stage ── */}
      <section className={`word-stage glass-panel${isBingoMode ? ' bingo-stage' : ''}${hasGameplayChrome ? ' word-stage--active' : ''}`}>

        {/* Stage notice — fixed height, opacity-only, no layout jump */}
        <div className={`stage-notice-bar${notice ? ' active' : ''}`} aria-live="polite">
          {notice || snapshot.status.message}
        </div>

        {(snapshot.phase === 'gameOver' || snapshot.phase === 'betting') && stageCtas}

        {snapshot.phase === 'gameOver' ? (
          <>
          <div className="game-over-panel">
            <div>
              <p className="eyebrow">Game over</p>
              <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.2rem)', lineHeight: 1, marginBottom: (isTeamsMode ? finalTeamStandings.length : finalPlayerStandings.length) > 0 ? 4 : 0 }}>
                Final Standings
              </h2>
              {(isTeamsMode ? finalTeamStandings.length : finalPlayerStandings.length) > 0 && (
                <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 16 }}>
                  {isTeamsMode ? `${finalTeamStandings[0]?.teamName ?? 'A team'} takes the crown.` : `${finalPlayerStandings[0]?.playerName ?? 'Someone'} takes the crown.`}
                </p>
              )}
            </div>
            {finalPlayerStandings.length > 0 && (
              <FinalPodium
                players={finalPlayerStandings}
                avatarsByPlayerId={avatarsByPlayerId}
                currentPlayerId={currentPlayerId}
                getAward={finalPlayerAward}
              />
            )}
            {isTeamsMode ? (
              finalTeamStandings.length > 0 ? (
                <div className="standings-list">
                  {finalTeamStandings.map((team) => (
                    <div key={team.teamId} className={`standing-row rank-${team.rank}`}>
                      <span className="standing-rank">{RANK_ICONS[team.rank] ?? `#${team.rank}`}</span>
                      <div>
                        <div className="standing-name">
                          {team.teamName}
                          {currentPlayer?.teamId === team.teamId && (
                            <Badge variant="ink" style={{ marginLeft: 8, fontSize: '0.72rem', padding: '3px 8px' }}>Your team</Badge>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: '0.76rem' }}>{team.players.length} player{team.players.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="standing-score">{team.score}</div>
                        <div className="standing-pts">pts</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Waiting for team scores…</p>
              )
            ) : finalPlayerStandings.length > 0 ? (
              <div className="standings-list">
                {finalPlayerStandings.map((player) => (
                  <div key={player.playerId} className={`standing-row rank-${player.rank}`}>
                    <span className="standing-rank">{RANK_ICONS[player.rank] ?? `#${player.rank}`}</span>
                    <div className="standing-player-identity">
                      <Avatar name={player.playerName} avatar={avatarsByPlayerId.get(player.playerId)} colorIndex={player.rank - 1} size="sm" className="standing-player-avatar" />
                      <div>
                        <div className="standing-name">
                          {player.playerName}
                          {player.playerId === currentPlayerId && (
                            <Badge variant="ink" style={{ marginLeft: 8, fontSize: '0.72rem', padding: '3px 8px' }}>You</Badge>
                          )}
                        </div>
                        <div className="standing-title">{finalPlayerAward(player).title}</div>
                        <div className="standing-title-meaning">{finalPlayerAward(player).meaning}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="standing-score">{player.score}</div>
                      <div className="standing-pts">pts</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Waiting for scores…</p>
            )}
            {isTeamsMode && finalPlayerStandings.length > 0 && (
              <div className="player-awards">
                <p className="eyebrow" style={{ marginBottom: 8 }}>Player titles</p>
                <div className="standings-list">
                  {finalPlayerStandings.map((player) => (
                    <div key={player.playerId} className="standing-row">
                      <span className="standing-rank">🏷️</span>
                      <div className="standing-player-identity">
                        <Avatar name={player.playerName} avatar={avatarsByPlayerId.get(player.playerId)} colorIndex={player.rank - 1} size="sm" className="standing-player-avatar" />
                        <div>
                          <div className="standing-name">{player.playerName}</div>
                          <div className="standing-title">{finalPlayerAward(player).title}</div>
                          <div className="standing-title-meaning">{finalPlayerAward(player).meaning}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="standing-score">{player.score}</div>
                        <div className="standing-pts">pts</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {roundHistory.length > 0 && (
              <Button variant="ghost" fullWidth onClick={() => { trackFeatureUsage('round_history_opened'); setShowRoundHistory(true); }}>
                See all words by round →
              </Button>
            )}
          </div>
          {mobilePlayersPanel}
          </>
        ) : (
          <>
            {isBettingMode && snapshot.phase === 'betting' && (
              <div className="game-over-panel">
                <div>
                  <p className="eyebrow">Betting open</p>
                  <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.2rem)', lineHeight: 1, marginBottom: 8 }}>
                    Round {snapshot.currentRound + 1}: predict your words
                  </h2>
                  <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 16 }}>
                    {snapshot.timeLeft}s left. Recent average: {(snapshot.bettingAverages[currentPlayerId ?? ''] ?? 0).toFixed(1)} words. Minimum bet: {minimumBet}.
                  </p>
                </div>

                {!needsRejoin && (
                  <form className="word-form" onSubmit={submitBet}>
                    <Input
                      type="number"
                      min={minimumBet}
                      max={50}
                      value={betInput}
                      onChange={(e) => setBetInput(e.currentTarget.value)}
                      placeholder={currentBet ? `Locked: ${currentBet} words` : `Bet at least ${minimumBet}`}
                      disabled={Boolean(currentBet)}
                    />
                    <Button variant="primary" type="submit" disabled={Boolean(currentBet) || Number(betInput) < minimumBet}>
                      {currentBet ? 'Bet Locked' : 'Lock Bet'}
                    </Button>
                  </form>
                )}

                <div className="standings-list">
                  {snapshot.players.map((player, playerIndex) => {
                    const bet = snapshot.bettingBets[player.id];
                    const average = snapshot.bettingAverages[player.id] ?? 0;
                    return (
                      <div key={player.id} className={`standing-row ${player.id === currentPlayerId ? 'self' : ''}`}>
                        <span className="standing-rank">🎲</span>
                        <div className="standing-player-identity">
                          <Avatar name={player.name} avatar={player.avatar} colorIndex={playerIndex} size="sm" className="standing-player-avatar" />
                          <div>
                            <div className="standing-name">{player.name}{player.id === currentPlayerId ? ' (You)' : ''}</div>
                            <div className="muted" style={{ fontSize: '0.76rem' }}>avg {average.toFixed(1)} · min {snapshot.minimumBets[player.id] ?? 3}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="standing-score">{bet ?? '—'}</div>
                          <div className="standing-pts">{bet ? 'words' : 'choosing'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {snapshot.phase === 'betting' && mobilePlayersPanel}

            {snapshot.phase !== 'betting' && (
              <div className="gameplay-layout">
                <div className="gameplay-header">
                  {/* Current word display */}
            <div className="current-word-card">
              <span className="current-word-label">Current Word</span>
              {snapshot.currentWord
                ? renderIntuitionWord(snapshot.currentWord)
                : <span className="current-word-waiting">Waiting to start…</span>
              }
              {sourceDefinition && snapshot.currentWord && (
                <p className="current-word-definition" title={sourceDefinition.definition}>
                  {sourceDefinition.definition}
                </p>
              )}
              {isIntuitionMode && snapshot.phase === 'round' && snapshot.currentWord && (
                <span className="intuition-unlock-note">
                  Unlocking randomly: one letter every {(snapshot.settings.timePerRound / snapshot.currentWord.length).toFixed(1)}s
                </span>
              )}
            </div>

            {/* Timer */}
            {snapshot.phase === 'round' && (
              <div className={`timer-section ${isUrgent ? 'urgent' : ''}`}>
                <div className="round-timer">
                  <Progress
                    value={timerProgress}
                    state={timerState}
                    aria-label="Round time remaining"
                    aria-valuetext={`${timerLabel} remaining`}
                  />
                  <span className="round-timer__label" aria-hidden="true">{timerLabel}</span>
                </div>
              </div>
            )}

                </div>

                <div className="gameplay-scroll">
                  {stageCtas}

                  {/* Round progress strip */}
                  <div className="round-strip">
                    <span>Round {Math.max(snapshot.currentRound, 1)} / {snapshot.totalRounds}</span>
                    <div className="round-dots" aria-label="Round progress">
                      {Array.from({ length: snapshot.totalRounds }, (_, i) => {
                        const roundNum = i + 1;
                        const current = Math.max(snapshot.currentRound, 1);
                        const cls = roundNum < current
                          ? 'round-dot round-dot-done'
                          : roundNum === current
                            ? 'round-dot round-dot-current'
                            : 'round-dot';
                        return <span key={i} className={cls} />;
                      })}
                    </div>
                  </div>

                  {/* Bingo board */}
            {isBingoMode && snapshot.bingoTasks.length > 0 && (
              <div className="words-card bingo-board">
                <div className="words-header bingo-board__header">
                  <h3>Bingo Board</h3>
                  <Badge>{snapshot.bingoProgress[currentPlayerId ?? '']?.length ?? 0}/{snapshot.bingoTasks.length}</Badge>
                </div>
                <div className="bingo-task-grid">
                  {snapshot.bingoTasks.map((task) => {
                    const done = Boolean(snapshot.bingoProgress[currentPlayerId ?? '']?.includes(task.id));
                    return (
                      <div key={task.id} className={`bingo-task${done ? ' bingo-task--done' : ''}`}>
                        <span className="bingo-task__check" aria-label={done ? 'completed' : 'not completed'}>{done ? '✓' : '□'}</span>
                        <strong>{task.label}</strong>
                        <span className="bingo-task__points">+10</span>
                      </div>
                    );
                  })}
                </div>
                <p className="muted bingo-board__note">Full board: +100. Source word does not count. After bingo, extras are +3.</p>
              </div>
            )}

            {/* Between rounds countdown */}
            {snapshot.phase === 'betweenRounds' && (
              <div className="between-rounds">
                <span className="between-rounds__label">Next round in</span>
                <span className="between-rounds__countdown">{waitingSeconds}</span>
                {validWordCount > 0 && (
                  <span className="between-rounds__note">
                    {validWordCount} possible words were hiding in there.
                  </span>
                )}
              </div>
            )}

            {/* Your words */}
            <div className="words-card">
              <div className="words-header">
                <h3>Your Words</h3>
                <span className="words-count">{myWords.length} found</span>
              </div>
              <div className="word-chip-list">
                {myWords.length > 0
                  ? myWords.map((word) => renderWordBadge(word))
                  : <em>No words yet.</em>}
              </div>
              {isBustedMode && snapshot.bustWords[currentPlayerId ?? ''] && (
                <p className="muted" style={{ fontSize: '0.78rem', marginTop: 10, marginBottom: 0 }}>
                  Your bust word: <strong style={{ color: 'var(--main)' }}>{snapshot.bustWords[currentPlayerId ?? '']}</strong>. Matching first words are safe.
                </p>
              )}
              {showsNegativeWords && negativeMarkedWords.length > 0 && (
                <>
                  <div className="words-header" style={{ marginTop: 14 }}>
                    <h3>Negative Marking</h3>
                    <span className="words-count">{negativeMarkedWords.reduce((total, entry) => total + entry.penalty, 0)} pts</span>
                  </div>
                  <div className="word-chip-list">
                    {negativeMarkedWords.map((entry, index) => renderNegativeWordBadge(entry, index))}
                  </div>
                </>
              )}
            </div>

            {/* Round results */}
            {roundResults && (
              <div className="results-card">
                <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>Round Results</h2>
                <Separator />
                {roundResults.map((result, i) => (
                  <article
                    key={result.playerId}
                    className={`result-row ${result.playerId === currentPlayerId ? 'self' : ''}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="result-header">
                      <div className="result-player-identity">
                        <Avatar name={result.playerName} avatar={avatarsByPlayerId.get(result.playerId)} colorIndex={i} size="sm" className="result-player-avatar" />
                        <strong>
                          {result.playerName}
                          {result.playerId === currentPlayerId && ' (You)'}
                        </strong>
                      </div>
                      <span className="result-score">
                        {isFastestNMode && result.words.length >= snapshot.settings.fastestWordTarget && (
                          <Badge variant="gold" style={{ marginRight: 8 }}>+10 winner bonus</Badge>
                        )}
                        {isBettingMode && result.bettingBet !== undefined && (
                          <Badge variant={result.bettingHit ? 'gold' : 'ink'} style={{ marginRight: 8 }}>
                            bet {result.bettingBet} · {result.words.length}/{result.bettingBet} {result.bettingHit ? 'hit' : 'miss'}
                          </Badge>
                        )}
                        {result.score} pts
                      </span>
                    </div>
                    <div className="word-chip-list">
                      {result.words.length > 0
                        ? result.words.map((w) => renderWordBadge(w, { fontSize: '0.76rem', padding: '4px 9px' }))
                        : <em>No words found.</em>}
                    </div>
                    {showsNegativeWords && result.negativeWords.length > 0 && (
                      <>
                        <div className="words-header" style={{ marginTop: 10 }}>
                          <h3>Negative words</h3>
                          <span className="words-count">{result.negativeWords.reduce((total, entry) => total + entry.penalty, 0)} pts</span>
                        </div>
                        <div className="word-chip-list">
                          {result.negativeWords.map((entry, index) => renderNegativeWordBadge(entry, index))}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}

                  {mobilePlayersPanel}
                </div>

                {hasGameplayChrome && renderGameFooter()}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── RIGHT: Info panel ── */}
      <aside className="info-panel glass-panel">
        <p className="eyebrow">How to play</p>
        <h2 style={{ fontSize: '1.1rem', lineHeight: 1.3, marginBottom: 14 }}>
          Make words from the big word.
        </h2>
        <Separator />
        <ul>
          <li>{isTeamsMode ? <>Teams: choose Red or Blue in the lobby. Individual points add into the cumulative team score.</> : isPrecisionMode ? <>Precision scores <strong>3 + word length</strong>, wrong words cost <strong>-(3 + word length)</strong>, duplicates cost <strong>-3</strong>.</> : isArcadeMode ? <>Score Attack scores <strong>3 + word length</strong>.</> : isBettingMode ? <>Betting: lock a word-count bet before the word appears. Hit it for <strong>bet × 10</strong>, extra words give <strong>3</strong>, miss it and lose <strong>bet × 10</strong>.</> : isBustedMode ? <>Busted: your first accepted word becomes your bust word. Type someone else’s bust word and your round score becomes <strong>0</strong>. Same first words are safe.</> : isCommonWordMode ? <>Common Word: unique words score <strong>+3</strong>, rare unique words with <strong>5+ letters</strong> score <strong>+5</strong>. If another player also makes that word, every player who used it gets <strong>-3</strong> for it.</> : isLightningMode ? <>Lightning Mode gives each player their own <strong>10 seconds</strong>. Your valid words add <strong>1 second</strong> to your timer; when your timer hits zero, you are out for that round.</> : isBingoMode ? <>Bingo Board gives everyone the same <strong>7 Pictureka-style word hunt tasks</strong> from the source word. Each task is <strong>+10</strong>; finish all 7 for <strong>+100</strong>. The source word itself does not count for bingo tasks; then extra valid words score <strong>+3</strong>.</> : isIntuitionMode ? <>Intuition Mode unlocks the source word letter by letter over the round. You can still guess hidden words early.</> : snapshot.settings.gameMode === 'fastestNWords' ? <>Word Sprint: first to <strong>{snapshot.settings.fastestWordTarget} words</strong> ends the round and gets a highlighted <strong>10 point bonus</strong>.</> : snapshot.settings.gameMode === 'battleRoyale' ? <>Knockout: lowest scoring <strong>{snapshot.settings.eliminationsPerRound}</strong> player(s) are eliminated each round.</> : snapshot.settings.gameMode === 'typist' ? <>Blind Type hides your input until you submit.</> : snapshot.settings.gameMode === 'oneWordForAll' ? <>Claim Mode: once any player finds a word, nobody else can use it. If it is taken, you will be told clearly.</> : <>Each accepted word scores <strong>3 points</strong>.</>}</li>
          <li>Letters must come from the source word.</li>
          <li>Only real words of at least 2 letters count.</li>
          <li>No reusing the same word in a round.</li>
          <li>The host controls start and restart.</li>
          <li>Rooms close when everyone leaves.</li>
        </ul>
      </aside>

      {!hasGameplayChrome && (
        <div className="room-footer-slot">
          {renderGameFooter()}
        </div>
      )}

      <SoundLabDialog open={showSoundLab} onClose={() => setShowSoundLab(false)} />

      {/* ── STOP GAME CONFIRMATION ── */}
      <Dialog
        open={showStopConfirmation}
        onClose={() => { if (!isStoppingGame) setShowStopConfirmation(false); }}
        size="sm"
        ariaLabel="Stop game confirmation"
        className="stop-confirmation-dialog"
      >
        <p className="eyebrow">Host control</p>
        <h1 id="stop-game-title" style={{ fontSize: 'clamp(1.6rem,5vw,2.35rem)', lineHeight: 0.96, marginBottom: 12 }}>
          Stop this game?
        </h1>
        <p className="stop-confirmation-dialog__copy">
          Everyone will return to the lobby and the current game progress will be lost.
        </p>
        {error && <Alert variant="error" style={{ marginBottom: 16 }}>{error}</Alert>}
        <div className="stop-confirmation-dialog__actions">
          <Button variant="secondary" onClick={() => setShowStopConfirmation(false)} disabled={isStoppingGame}>
            Keep playing
          </Button>
          <Button variant="danger" onClick={stopToLobby} isLoading={isStoppingGame}>
            Stop game
          </Button>
        </div>
      </Dialog>

      {/* ── HOW TO PLAY MODAL ── */}
      <Dialog
        open={showHowToPlay}
        onClose={() => setShowHowToPlay(false)}
        size="sm"
        ariaLabel="How to play"
      >
        <p className="eyebrow">How to play</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.8rem)', lineHeight: 0.94, marginBottom: 16 }}>
          Make words.
        </h1>
        <ul style={{ paddingLeft: 14, lineHeight: 2.1, color: 'var(--sub)', fontSize: '0.88rem', marginBottom: 20 }}>
          <li>Find words hidden inside the big word.</li>
          <li>{isTeamsMode ? <>Teams: choose Red or Blue in the lobby. Individual points add into the cumulative team score.</> : isPrecisionMode ? <>Precision scores <strong style={{ color: 'var(--text)' }}>3 + word length</strong>, wrong words cost <strong style={{ color: 'var(--text)' }}>-(3 + word length)</strong>, duplicates cost <strong style={{ color: 'var(--text)' }}>-3</strong>.</> : isArcadeMode ? <>Score Attack scores <strong style={{ color: 'var(--text)' }}>3 + word length</strong>.</> : isBettingMode ? <>Betting: lock a word-count bet before the word appears. Hit it for <strong style={{ color: 'var(--text)' }}>bet × 10</strong>, extra words give <strong style={{ color: 'var(--text)' }}>3</strong>, miss it and lose <strong style={{ color: 'var(--text)' }}>bet × 10</strong>.</> : isBustedMode ? <>Busted: your first word is your bust word. Type someone else’s bust word and your round score becomes <strong style={{ color: 'var(--text)' }}>0</strong>. Matching first words are safe.</> : isCommonWordMode ? <>Common Word: unique words score <strong style={{ color: 'var(--text)' }}>+3</strong>, rare unique words with <strong style={{ color: 'var(--text)' }}>5+ letters</strong> score <strong style={{ color: 'var(--text)' }}>+5</strong>. Shared words score <strong style={{ color: 'var(--text)' }}>-3</strong> for everyone who used them.</> : isLightningMode ? <>Lightning Mode gives every player their own <strong style={{ color: 'var(--text)' }}>10 seconds</strong>. Your valid words add <strong style={{ color: 'var(--text)' }}>1 second</strong> to your timer; hit zero and you are out for that round.</> : isBingoMode ? <>Bingo Board gives everyone the same <strong style={{ color: 'var(--text)' }}>7 Pictureka-style word hunt tasks</strong> generated from the source word. Tasks give <strong style={{ color: 'var(--text)' }}>+10</strong>; full board gives <strong style={{ color: 'var(--text)' }}>+100</strong>. The source word itself does not count for bingo tasks; after bingo, extra valid words give <strong style={{ color: 'var(--text)' }}>+3</strong>.</> : isIntuitionMode ? <>Intuition Mode reveals the source word evenly over time. Guess from hidden letters whenever your gut says go.</> : snapshot.settings.gameMode === 'fastestNWords' ? <>Word Sprint: first to <strong style={{ color: 'var(--text)' }}>{snapshot.settings.fastestWordTarget} words</strong> ends the round and gets a highlighted <strong style={{ color: 'var(--text)' }}>10 point bonus</strong>.</> : snapshot.settings.gameMode === 'battleRoyale' ? <>Knockout: lowest scoring <strong style={{ color: 'var(--text)' }}>{snapshot.settings.eliminationsPerRound}</strong> player(s) are eliminated each round.</> : snapshot.settings.gameMode === 'typist' ? <>Blind Type hides your input until you submit.</> : snapshot.settings.gameMode === 'oneWordForAll' ? <>Claim Mode: once any player finds a word, nobody else can use it. If it is taken, you will be told clearly.</> : <>Each accepted word scores <strong style={{ color: 'var(--text)' }}>3 points</strong>.</>}</li>
          <li>Letters must come from the source word.</li>
          <li>Only real words of at least 2 letters count.</li>
          <li>No reusing the same word in a round.</li>
          <li>The host controls start and restart.</li>
          <li>Rooms close when everyone leaves.</li>
        </ul>
        <Button variant="secondary" fullWidth onClick={() => setShowHowToPlay(false)}>Got it</Button>
      </Dialog>

      {/* ── SETTINGS MODAL ── */}
      <Dialog open={showSettingsDialog && !infoMode} onClose={() => setShowSettingsDialog(false)} size="lg" ariaLabel="Change settings">
        <p className="eyebrow">same room, new rules</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,3rem)', lineHeight: 0.9, marginBottom: 12 }}>Change Settings</h1>
        <p className="muted" style={{ marginBottom: 18 }}>Everyone stays seated. Saving resets scores and returns the room to the lobby, where the host can start when everyone is ready.</p>

        {draftSettings && (
          <div className="settings-grid">
            <div className="setting-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <Label htmlFor="room-game-mode">Game mode</Label>
                <button
                  type="button"
                  onClick={() => setInfoMode(GAME_MODE_OPTIONS.find((mode) => mode.value === draftSettings.gameMode))}
                  title="About selected game mode"
                  aria-label="About selected game mode"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '999px',
                    border: '1px solid var(--sub-2)',
                    background: 'var(--main-10)',
                    color: 'var(--main)',
                    font: 'inherit',
                    fontWeight: 800,
                    cursor: 'pointer',
                    lineHeight: 1
                  }}
                >
                  i
                </button>
              </div>
              <Select id="room-game-mode" value={draftSettings.gameMode} onChange={(e) => setDraft('gameMode', e.currentTarget.value as GameSettings['gameMode'])}>
                {GAME_MODE_OPTIONS.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </Select>
            </div>

            {draftSettings.gameMode === 'mix' && (
              <>
                <div className="setting-group">
                  <Label htmlFor="room-mix-scoring">Mix scoring</Label>
                  <Select id="room-mix-scoring" value={draftSettings.mixScoringMode} onChange={(e) => setDraft('mixScoringMode', e.currentTarget.value as GameSettings['mixScoringMode'])}>
                    <option value="classic">Classic</option>
                    <option value="arcade">Score Attack</option>
                  </Select>
                </div>
                <div className="setting-group" style={{ gridColumn: '1 / -1' }}>
                  <Label>Mix modifiers</Label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    {([
                      ['teams', 'Teams'],
                      ['wordSprint', 'Word Sprint'],
                      ['blind', 'Blind'],
                      ['claim', 'Claim'],
                      ['busted', 'Busted'],
                      ['intuition', 'Intuition'],
                      ['lightning', 'Lightning']
                    ] as const).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                        <input type="checkbox" checked={draftSettings.mixModifiers[key]} onChange={(e) => setDraftMixModifier(key, e.currentTarget.checked)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {(draftSettings.gameMode === 'fastestNWords' || (draftSettings.gameMode === 'mix' && draftSettings.mixModifiers.wordSprint)) && (
              <div className="setting-group">
                <Label htmlFor="room-fastest-target">Words to win</Label>
                <Select id="room-fastest-target" value={draftSettings.fastestWordTarget} onChange={(e) => setDraft('fastestWordTarget', Number(e.currentTarget.value))}>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>First {n} words</option>)}
                </Select>
              </div>
            )}

            {draftSettings.gameMode === 'battleRoyale' && (
              <div className="setting-group">
                <Label htmlFor="room-eliminations">Eliminations per round</Label>
                <Select id="room-eliminations" value={draftSettings.eliminationsPerRound} onChange={(e) => setDraft('eliminationsPerRound', Number(e.currentTarget.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} player{n !== 1 ? 's' : ''}</option>)}
                </Select>
              </div>
            )}

            {draftSettings.gameMode === 'category' && (
              <>
                <div className="setting-group">
                  <Label htmlFor="room-word-category">Source word category</Label>
                  <Select id="room-word-category" value={draftSettings.wordCategory} onChange={(e) => setDraft('wordCategory', e.currentTarget.value as GameSettings['wordCategory'])}>
                    <option value="general">General dictionary</option>
                    <option value="genz">Gen Z</option>
                    <option value="sports">Sports</option>
                    <option value="food">Food</option>
                    <option value="slangs">Slangs</option>
                    <option value="custom">Custom word list</option>
                    <option value="vehicles">Vehicle names</option>
                    <option value="technology">Technology</option>
                    <option value="finance">Finances</option>
                    <option value="medical">Medical</option>
                  </Select>
                </div>
                {draftSettings.wordCategory === 'custom' && (
                  <div className="setting-group">
                    <Label htmlFor="room-custom-words">Custom source words</Label>
                    <Textarea id="room-custom-words" value={draftSettings.customWordList} onChange={(e) => setDraft('customWordList', e.currentTarget.value)} placeholder="Comma or line separated source words" rows={4} />
                  </div>
                )}
              </>
            )}

            <div className="setting-group">
              <Label htmlFor="room-max-players">Max players</Label>
              <Select id="room-max-players" value={draftSettings.maxPlayers} onChange={(e) => setDraft('maxPlayers', Number(e.currentTarget.value))}>
                {[2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50, 55, 60].map((n) => <option key={n} value={n}>{n} players</option>)}
              </Select>
            </div>
            <div className="setting-group">
              <Label htmlFor="room-time-per-round">Time per round</Label>
              <Select id="room-time-per-round" value={(draftSettings.gameMode === 'lightning' || (draftSettings.gameMode === 'mix' && draftSettings.mixModifiers.lightning)) ? 10 : draftSettings.timePerRound} onChange={(e) => setDraft('timePerRound', Number(e.currentTarget.value))} disabled={draftSettings.gameMode === 'lightning' || (draftSettings.gameMode === 'mix' && draftSettings.mixModifiers.lightning)}>
                {[5, 10, 20, 30, 40, 50, 60, 90, 120].map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </Select>
            </div>
            <div className="setting-group">
              <Label htmlFor="room-word-length">Source word length</Label>
              <Select id="room-word-length" value={draftSettings.minWordLength} onChange={(e) => setDraft('minWordLength', Number(e.currentTarget.value))}>
                {[5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => <option key={n} value={n}>{n}+ letters</option>)}
              </Select>
            </div>
            <div className="setting-group">
              <Label htmlFor="room-rounds">Number of rounds</Label>
              <Select id="room-rounds" value={draftSettings.rounds} onChange={(e) => setDraft('rounds', Number(e.currentTarget.value))}>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} round{n !== 1 ? 's' : ''}</option>)}
              </Select>
            </div>
          </div>
        )}

        <div className="button-row">
          <Button variant="secondary" onClick={() => setShowSettingsDialog(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveSettings}>Save settings</Button>
        </div>
      </Dialog>

      <Dialog open={Boolean(infoMode)} onClose={() => setInfoMode(undefined)} size="sm" ariaLabel="Game mode information">
        <p className="eyebrow">game mode info</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)', lineHeight: 0.94, marginBottom: 16 }}>
          {infoMode?.label}
        </h1>
        <p className="muted" style={{ lineHeight: 1.8, marginBottom: 20 }}>
          {infoMode?.description}
        </p>
        <Button variant="secondary" fullWidth onClick={() => setInfoMode(undefined)}>Got it</Button>
      </Dialog>

      <WordDefinitionSheet {...definitions.sheetProps} />

      {/* ── ROUND HISTORY MODAL ── */}
      <Dialog
        open={showRoundHistory && !definitions.isOpen}
        onClose={() => setShowRoundHistory(false)}
        size="lg"
        ariaLabel="Round history"
      >
        <p className="eyebrow">All rounds</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,3rem)', lineHeight: 0.9, marginBottom: 20 }}>
          Word History
        </h1>

        {roundHistory.map((entry) => (
          <div key={entry.round} className="history-round">
            <div className="history-round-header">
              <span className="history-round-label">Round {entry.round}</span>
              <span className="history-round-word">{entry.word}</span>
              <span className="history-round-meta">{entry.validWordCount} possible words</span>
            </div>
            <div className="history-players">
              {entry.results.map((result, resultIndex) => (
                <div key={result.playerId} className={`history-player ${result.playerId === currentPlayerId ? 'self' : ''}`}>
                  <div className="history-player-header">
                    <div className="history-player-identity">
                      <Avatar name={result.playerName} avatar={avatarsByPlayerId.get(result.playerId)} colorIndex={resultIndex} size="sm" className="history-player-avatar" />
                      <strong>{result.playerName}{result.playerId === currentPlayerId ? ' (You)' : ''}</strong>
                    </div>
                    <span className="result-score">
                      {isFastestNMode && result.words.length >= snapshot.settings.fastestWordTarget && (
                        <Badge variant="gold" style={{ marginRight: 8 }}>+10 winner bonus</Badge>
                      )}
                      {isBettingMode && result.bettingBet !== undefined && (
                        <Badge variant={result.bettingHit ? 'gold' : 'ink'} style={{ marginRight: 8 }}>
                          bet {result.bettingBet} · {result.words.length}/{result.bettingBet} {result.bettingHit ? 'hit' : 'miss'}
                        </Badge>
                      )}
                      {result.score} pts
                    </span>
                  </div>
                  <div className="word-chip-list" style={{ marginTop: 6 }}>
                    {result.words.length > 0
                      ? result.words.map((w) => renderWordBadge(w, { fontSize: '0.76rem', padding: '4px 9px' }))
                      : <em style={{ fontSize: '0.82rem', color: 'var(--sub)' }}>No words found.</em>}
                  </div>
                  {showsNegativeWords && result.negativeWords.length > 0 && (
                    <>
                      <div className="words-header" style={{ marginTop: 10 }}>
                        <h3>Negative words</h3>
                        <span className="words-count">{result.negativeWords.reduce((total, entry) => total + entry.penalty, 0)} pts</span>
                      </div>
                      <div className="word-chip-list" style={{ marginTop: 6 }}>
                        {result.negativeWords.map((entry, index) => renderNegativeWordBadge(entry, index))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <Separator style={{ marginTop: 20 }} />
        <div className="button-row">
          <Button variant="secondary" onClick={() => setShowRoundHistory(false)}>
            ← Back to Standings
          </Button>
          {isHost && (
            <Button variant="primary" onClick={() => { restartGame(); setShowRoundHistory(false); }}>
              Play Again
            </Button>
          )}
        </div>
      </Dialog>
    </main>
  );
}
