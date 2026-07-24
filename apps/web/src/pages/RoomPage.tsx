import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FinalScore, RoomSnapshot, RoundResultPlayer } from '@wow/shared';
import socket from '../services/socket';
import { loadUsername } from '../services/session';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Dialog,
  Input,
  Separator,
  Spinner,
  TimerRing,
  Tooltip,
} from '../components/ui';

const RANK_ICONS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

interface RoundEntry {
  round: number;
  word: string;
  results: RoundResultPlayer[];
  validWordCount: number;
}

export default function RoomPage(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const roomId = params.roomId ?? '';

  const [snapshot, setSnapshot] = useState<RoomSnapshot | undefined>();
  const [inputWord, setInputWord] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [inputFeedback, setInputFeedback] = useState<'success' | 'error' | null>(null);
  const [showCopied, setShowCopied] = useState(false);
  const [roundResults, setRoundResults] = useState<RoundResultPlayer[] | undefined>();
  const [finalScores, setFinalScores] = useState<FinalScore[]>([]);
  const [showRoundHistory, setShowRoundHistory] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [validWordCount, setValidWordCount] = useState(0);
  const [roundHistory, setRoundHistory] = useState<RoundEntry[]>([]);
  const [isWordInputFocused, setIsWordInputFocused] = useState(false);

  // Keep a ref to the word input so we can restore focus after submit
  const inputRef = useRef<HTMLInputElement>(null);
  // Track the source word at round-end time for history labelling
  const currentWordRef = useRef('');

  const currentPlayerId = socket.id;
  const currentPlayer = useMemo(
    () => snapshot?.players.find((p) => p.id === currentPlayerId),
    [currentPlayerId, snapshot]
  );
  const isHost = Boolean(currentPlayer?.isHost);
  const myWords = currentPlayerId && snapshot ? snapshot.acceptedWords[currentPlayerId] ?? [] : [];
  const canStart = isHost && snapshot &&
    (snapshot.phase === 'lobby' || snapshot.phase === 'gameOver') &&
    snapshot.players.length >= 2;
  const canSubmit = snapshot?.phase === 'round' && Boolean(currentPlayer) && !currentPlayer?.isEliminated;
  const isUrgent = Boolean(snapshot?.phase === 'round' && snapshot.timeLeft <= 10);
  const isArcadeMode = snapshot?.settings.gameMode === 'arcade';
  const isPrecisionMode = snapshot?.settings.gameMode === 'precision';
  const isTeamsMode = snapshot?.settings.gameMode === 'teams';
  const isLengthBonusMode = isArcadeMode || isPrecisionMode;
  const isTypistMode = snapshot?.settings.gameMode === 'typist';
  const isFastestNMode = snapshot?.settings.gameMode === 'fastestNWords';

  function wordPoints(word: string): number {
    return 3 + (isLengthBonusMode ? word.length : 0);
  }

  function renderWordBadge(word: string, style?: CSSProperties): JSX.Element {
    return (
      <Badge key={word} variant="word" className="scored-word-badge" style={style} title={`${wordPoints(word)} points`}>
        <span>{word}</span>
        {isLengthBonusMode ? (
          <span className="word-score-formula" aria-label={`3 plus ${word.length} equals ${wordPoints(word)} points`}>
            <strong>3+{word.length}</strong>
            <span>= {wordPoints(word)}</span>
          </span>
        ) : (
          <span className="word-score-formula">+3</span>
        )}
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

  /* ── socket setup ── */
  useEffect(() => {
    if (!roomId) return;
    socket.emit('checkRoom', { roomId }, (response) => {
      if (!response.ok) { setError(response.error); return; }
      if (!response.data.exists || !response.data.snapshot) {
        setError('Room not found.');
        return;
      }
      setSnapshot(response.data.snapshot);
      currentWordRef.current = response.data.snapshot.currentWord;
      setWaitingSeconds(response.data.snapshot.waitingSeconds);
    });
  }, [roomId]);

  useEffect(() => {
    const onSnapshot = (payload: { snapshot: RoomSnapshot }): void => {
      setSnapshot(payload.snapshot);
      currentWordRef.current = payload.snapshot.currentWord;
      setWaitingSeconds(payload.snapshot.waitingSeconds);
    };

    socket.on('roomSnapshot', onSnapshot);
    socket.on('playerJoined', (p) => { setSnapshot(p.snapshot); setNotice(`${p.player.name} joined.`); });
    socket.on('playerLeft', (p) => { setSnapshot(p.snapshot); setNotice('A player left.'); });
    socket.on('hostChanged', (p) => {
      setSnapshot(p.snapshot);
      setNotice(p.hostId === socket.id ? 'You are now the host.' : 'Host changed.');
    });
    socket.on('roundStarted', (p) => {
      setSnapshot(p.snapshot);
      currentWordRef.current = p.currentWord;
      setRoundResults(undefined);
      setInputWord('');
      setNotice(`Round ${p.currentRound} started.`);
      setWaitingSeconds(0);
      setValidWordCount(0);
      // Restore keyboard focus when a new round begins
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    socket.on('timeUpdate', (p) => {
      setSnapshot((s) => s ? { ...s, timeLeft: p.timeLeft } : s);
    });
    socket.on('wordAccepted', (p) => {
      setInputFeedback('success');
      setSnapshot((s) => {
        if (!s) return s;
        return {
          ...s,
          acceptedWords: { ...s.acceptedWords, [p.playerId]: p.words },
        };
      });
    });
    socket.on('wordRejected', (p) => {
      setInputFeedback('error');
      setNotice(p.message);
    });
    socket.on('scoresUpdated', (p) => {
      setSnapshot((s) => {
        if (!s || s.phase !== 'round') return p.snapshot;
        const scoreByPlayer = new Map(p.scores);
        return {
          ...s,
          players: s.players.map((player) => ({
            ...player,
            score: scoreByPlayer.get(player.id) ?? player.score,
          })),
          teamScores: p.snapshot.teamScores,
        };
      });
    });
    socket.on('roundEnded', (p) => {
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
      setSnapshot(p.snapshot);
      setFinalScores(p.finalScores);
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
    });
    socket.on('gameRestarted', (p) => {
      setSnapshot(p.snapshot);
      setRoundResults(undefined);
      setFinalScores([]);
      setShowRoundHistory(false);
      setRoundHistory([]);
      setWaitingSeconds(0);
      setValidWordCount(0);
      setNotice(p.autoStart ? 'New round incoming.' : 'Reset to lobby.');
    });
    socket.on('notice', (p) => setNotice(p.message));

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
  function copyShareLink(): void {
    navigator.clipboard.writeText(`${window.location.origin}/join/${roomId}`)
      .then(() => {
        setShowCopied(true);
        window.setTimeout(() => setShowCopied(false), 2500);
      })
      .catch(() => setNotice(`Copy: ${window.location.origin}/join/${roomId}`));
  }

  function startGame(): void {
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

  function restartGame(): void {
    socket.emit('restartGame', { roomId, autoStart: true }, (r) => {
      if (!r.ok) setError(r.error);
    });
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

  /* ── main game view ── */
  return (
    <main className={`game-shell ${isWordInputFocused ? 'is-typing' : ''}`}>

      {/* ── HEADER ── */}
      <header className="game-header">
        <div className="game-header__left">
          <span className="game-header__label">room</span>
          <span className="game-header__roomid">{snapshot.roomId.toLowerCase()}</span>
          <span className="game-header__dot">·</span>
          <span className="game-header__count">
            {snapshot.players.length} player{snapshot.players.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="game-header__right">
          <Tooltip content={showCopied ? 'Copied!' : 'Copy invite link'} className="ui-tooltip-down ui-tooltip-end">
            <Button variant="mini" size="sm" onClick={copyShareLink} aria-label={showCopied ? 'Copied!' : 'Copy invite link'} style={{ padding: '7px 10px' }}>
              {showCopied ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 7.5l3 3 7-7"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 8.5a3 3 0 004.24 0l1.5-1.5a3 3 0 00-4.24-4.24l-.86.86"/><path d="M8.5 5.5a3 3 0 00-4.24 0L2.76 7a3 3 0 004.24 4.24l.86-.86"/></svg>
              )}
            </Button>
          </Tooltip>
          <Button variant="mini" size="sm" onClick={() => setShowHowToPlay(true)} aria-label="How to play">
            ?
          </Button>
        </div>
      </header>

      {/* ── LEFT: Players ── */}
      <aside className="players-panel glass-panel">
        <p className="eyebrow" style={{ marginBottom: 10 }}>Players</p>

        <div className="player-list">
          {snapshot.players.map((player, idx) => (
            <div
              key={player.id}
              className={`player-row ${player.id === currentPlayerId ? 'self' : ''}`}
            >
              <div className="player-row__info">
                <Avatar name={player.name} colorIndex={idx} size="sm" />
                <div className="player-row__text">
                  <div className="player-row__name">{player.name}</div>
                  <span className="player-row__tag">
                    {player.isEliminated ? 'Out' : `${player.isHost ? '★ Host' : player.id === currentPlayerId ? 'You' : 'Player'}${isTeamsMode && player.teamId ? ` · ${player.teamId === 'red' ? 'Red' : 'Blue'}` : ''}`}
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

        {isTeamsMode && (snapshot.phase === 'lobby' || snapshot.phase === 'gameOver') && !needsRejoin && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Button variant={currentPlayer?.teamId === 'red' ? 'primary' : 'secondary'} size="sm" onClick={() => chooseTeam('red')}>Red Team</Button>
            <Button variant={currentPlayer?.teamId === 'blue' ? 'primary' : 'secondary'} size="sm" onClick={() => chooseTeam('blue')}>Blue Team</Button>
          </div>
        )}

        <div className="room-status">{snapshot.status.message}</div>

        {error && <Alert variant="error" style={{ marginTop: 8, fontSize: '0.80rem' }}>{error}</Alert>}
      </aside>

      {/* ── CENTER: Word Stage ── */}
      <section className="word-stage glass-panel">

        {/* Stage notice — fixed height, opacity-only, no layout jump */}
        <div className={`stage-notice-bar${notice ? ' active' : ''}`} aria-live="polite">
          {notice || snapshot.status.message}
        </div>

        {/* CTAs — start game, rejoin, waiting (visible on all screen sizes) */}
        {(needsRejoin || canStart ||
          (!needsRejoin && (
            (snapshot.phase === 'lobby' && (!isHost || snapshot.players.length < 2)) ||
            (snapshot.phase === 'gameOver' && !isHost)
          ))) && (
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
              <Button variant="primary" size="lg" fullWidth onClick={snapshot.phase === 'gameOver' ? restartGame : startGame}>
                {snapshot.phase === 'gameOver' ? 'Play Again' : 'Start Game'}
              </Button>
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
        )}

        {snapshot.phase === 'gameOver' ? (
          <div className="game-over-panel">
            <div>
              <p className="eyebrow">Game over</p>
              <h2 style={{ fontSize: 'clamp(1.6rem,4vw,2.2rem)', lineHeight: 1, marginBottom: finalScores.length > 0 ? 4 : 0 }}>
                Final Standings
              </h2>
              {finalScores.length > 0 && (
                <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 16 }}>
                  {finalScores[0]?.playerName ?? 'Someone'} takes the crown.
                </p>
              )}
            </div>
            {finalScores.length > 0 ? (
              <div className="standings-list">
                {finalScores.map((player) => (
                  <div key={player.playerId} className={`standing-row rank-${player.rank}`}>
                    <span className="standing-rank">{RANK_ICONS[player.rank] ?? `#${player.rank}`}</span>
                    <div>
                      <div className="standing-name">
                        {player.playerName}
                        {player.playerId === currentPlayerId && (
                          <Badge variant="ink" style={{ marginLeft: 8, fontSize: '0.72rem', padding: '3px 8px' }}>You</Badge>
                        )}
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
            {roundHistory.length > 0 && (
              <Button variant="ghost" fullWidth onClick={() => setShowRoundHistory(true)}>
                See all words by round →
              </Button>
            )}
          </div>
        ) : (
          <>
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

            {/* Current word display */}
            <div className="current-word-card">
              <span className="current-word-label">Current Word</span>
              {snapshot.currentWord
                ? <span key={snapshot.currentWord} className="current-word-text">{snapshot.currentWord}</span>
                : <span className="current-word-waiting">Waiting to start…</span>
              }
            </div>

            {/* Timer */}
            {snapshot.phase === 'round' && (
              <div className={`timer-section ${isUrgent ? 'urgent' : ''}`}>
                <TimerRing
                  timeLeft={snapshot.timeLeft}
                  totalTime={snapshot.settings.timePerRound}
                  size={96}
                />
              </div>
            )}

            {/* Between rounds countdown */}
            {snapshot.phase === 'betweenRounds' && (
              <div className="between-rounds">
                <span className="between-rounds__label">Next round in</span>
                <span className="between-rounds__countdown">{waitingSeconds}</span>
                {validWordCount > 0 && (
                  <span className="between-rounds__hint">
                    {validWordCount} possible words were hiding in there.
                  </span>
                )}
              </div>
            )}

            {/* Word submit form */}
            {snapshot.phase === 'round' && (
              <form className="word-form" onSubmit={submitWord}>
                <Input
                  ref={inputRef}
                  type={isTypistMode ? 'password' : 'text'}
                  value={inputWord}
                  onChange={(e) => setInputWord(e.currentTarget.value)}
                  onFocus={() => setIsWordInputFocused(true)}
                  onBlur={() => setIsWordInputFocused(false)}
                  placeholder={canSubmit ? (isTypistMode ? 'Blind Type: hidden word' : 'Type a word and press Enter') : 'Rejoin to submit words'}
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
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!canSubmit || !inputWord.trim()}
                >
                  Submit
                </Button>
              </form>
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
                      <strong>
                        {result.playerName}
                        {result.playerId === currentPlayerId && ' (You)'}
                      </strong>
                      <span className="result-score">
                        {isFastestNMode && result.words.length >= snapshot.settings.fastestWordTarget && (
                          <Badge variant="gold" style={{ marginRight: 8 }}>+10 winner bonus</Badge>
                        )}
                        {result.score} pts
                      </span>
                    </div>
                    <div className="word-chip-list">
                      {result.words.length > 0
                        ? result.words.map((w) => renderWordBadge(w, { fontSize: '0.76rem', padding: '4px 9px' }))
                        : <em>No words found.</em>}
                    </div>
                  </article>
                ))}
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
          <li>{isTeamsMode ? <>Teams: choose Red or Blue in the lobby. Individual points add into the cumulative team score.</> : isPrecisionMode ? <>Precision scores <strong>3 + word length</strong>, rejects cost <strong>-2</strong>, duplicates cost <strong>-1</strong>.</> : isArcadeMode ? <>Score Attack scores <strong>3 + word length</strong>.</> : snapshot.settings.gameMode === 'fastestNWords' ? <>Word Sprint: first to <strong>{snapshot.settings.fastestWordTarget} words</strong> ends the round and gets a highlighted <strong>10 point bonus</strong>.</> : snapshot.settings.gameMode === 'battleRoyale' ? <>Knockout: lowest scoring <strong>{snapshot.settings.eliminationsPerRound}</strong> player(s) are eliminated each round.</> : snapshot.settings.gameMode === 'typist' ? <>Blind Type hides your input until you submit.</> : snapshot.settings.gameMode === 'oneWordForAll' ? <>Claim Mode: once any player finds a word, nobody else can use it. If it is taken, you will be told clearly.</> : <>Each accepted word scores <strong>3 points</strong>.</>}</li>
          <li>Letters must come from the source word.</li>
          <li>No reusing the same word in a round.</li>
          <li>The host controls start and restart.</li>
          <li>Rooms close when everyone leaves.</li>
        </ul>
      </aside>

      {/* ── HOW TO PLAY MODAL ── */}
      <Dialog
        open={showHowToPlay}
        onClose={() => setShowHowToPlay(false)}
        size="sm"
      >
        <p className="eyebrow">How to play</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.8rem)', lineHeight: 0.94, marginBottom: 16 }}>
          Make words.
        </h1>
        <ul style={{ paddingLeft: 14, lineHeight: 2.1, color: 'var(--sub)', fontSize: '0.88rem', marginBottom: 20 }}>
          <li>Find words hidden inside the big word.</li>
          <li>{isTeamsMode ? <>Teams: choose Red or Blue in the lobby. Individual points add into the cumulative team score.</> : isPrecisionMode ? <>Precision scores <strong style={{ color: 'var(--text)' }}>3 + word length</strong>, rejects cost <strong style={{ color: 'var(--text)' }}>-2</strong>, duplicates cost <strong style={{ color: 'var(--text)' }}>-1</strong>.</> : isArcadeMode ? <>Score Attack scores <strong style={{ color: 'var(--text)' }}>3 + word length</strong>.</> : snapshot.settings.gameMode === 'fastestNWords' ? <>Word Sprint: first to <strong style={{ color: 'var(--text)' }}>{snapshot.settings.fastestWordTarget} words</strong> ends the round and gets a highlighted <strong style={{ color: 'var(--text)' }}>10 point bonus</strong>.</> : snapshot.settings.gameMode === 'battleRoyale' ? <>Knockout: lowest scoring <strong style={{ color: 'var(--text)' }}>{snapshot.settings.eliminationsPerRound}</strong> player(s) are eliminated each round.</> : snapshot.settings.gameMode === 'typist' ? <>Blind Type hides your input until you submit.</> : snapshot.settings.gameMode === 'oneWordForAll' ? <>Claim Mode: once any player finds a word, nobody else can use it. If it is taken, you will be told clearly.</> : <>Each accepted word scores <strong style={{ color: 'var(--text)' }}>3 points</strong>.</>}</li>
          <li>Letters must come from the source word.</li>
          <li>No reusing the same word in a round.</li>
          <li>The host controls start and restart.</li>
          <li>Rooms close when everyone leaves.</li>
        </ul>
        <Button variant="secondary" fullWidth onClick={() => setShowHowToPlay(false)}>Got it</Button>
      </Dialog>

      {/* ── ROUND HISTORY MODAL ── */}
      <Dialog
        open={showRoundHistory}
        onClose={() => setShowRoundHistory(false)}
        size="lg"
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
              {entry.results.map((result) => (
                <div key={result.playerId} className={`history-player ${result.playerId === currentPlayerId ? 'self' : ''}`}>
                  <div className="history-player-header">
                    <strong>{result.playerName}{result.playerId === currentPlayerId ? ' (You)' : ''}</strong>
                    <span className="result-score">
                      {isFastestNMode && result.words.length >= snapshot.settings.fastestWordTarget && (
                        <Badge variant="gold" style={{ marginRight: 8 }}>+10 winner bonus</Badge>
                      )}
                      {result.score} pts
                    </span>
                  </div>
                  <div className="word-chip-list" style={{ marginTop: 6 }}>
                    {result.words.length > 0
                      ? result.words.map((w) => renderWordBadge(w, { fontSize: '0.76rem', padding: '4px 9px' }))
                      : <em style={{ fontSize: '0.82rem', color: 'var(--sub)' }}>No words found.</em>}
                  </div>
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
