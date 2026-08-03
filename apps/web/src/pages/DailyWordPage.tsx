import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Input, Label, Progress } from '../components/ui';
import { readStoredValue, writeStoredValue } from '../services/storage';
import { getDailyChallengeUrl } from '../services/platform';
import { shareContent } from '../services/nativeShare';
import { trackDailyCompleted, trackDailyStarted, trackHotjarEvent } from '../services/hotjar';

const DAILY_SECONDS = 30;
const DAILY_WORDS = [
  'extraordinary',
  'communication',
  'transformation',
  'imagination',
  'celebration',
  'architecture',
  'conversation',
  'technology',
  'friendship',
  'adventure'
];

interface DailyAttempt {
  day: number;
  sourceWord: string;
  startedAt: number;
  endsAt: number;
  finished: boolean;
  words: string[];
}

function currentDayNumber(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function dayIndex(day = currentDayNumber()): number {
  return day % DAILY_WORDS.length;
}

function dailyStorageKey(day = currentDayNumber()): string {
  return `wow.daily.${day}`;
}

function loadDailyAttempt(day = currentDayNumber()): DailyAttempt | undefined {
  try {
    const raw = readStoredValue(dailyStorageKey(day));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<DailyAttempt>;
    if (
      parsed.day !== day ||
      typeof parsed.sourceWord !== 'string' ||
      typeof parsed.startedAt !== 'number' ||
      typeof parsed.endsAt !== 'number' ||
      typeof parsed.finished !== 'boolean' ||
      !Array.isArray(parsed.words)
    ) {
      return undefined;
    }

    return {
      day: parsed.day,
      sourceWord: parsed.sourceWord,
      startedAt: parsed.startedAt,
      endsAt: parsed.endsAt,
      finished: parsed.finished,
      words: parsed.words.filter((word): word is string => typeof word === 'string')
    };
  } catch {
    return undefined;
  }
}

function saveDailyAttempt(attempt: DailyAttempt): void {
  writeStoredValue(dailyStorageKey(attempt.day), JSON.stringify(attempt));
}

function letterCounts(word: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const letter of word) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return counts;
}

function canMakeWord(candidate: string, source: string): boolean {
  const sourceCounts = letterCounts(source);
  const candidateCounts = letterCounts(candidate);
  for (const [letter, needed] of candidateCounts) {
    if ((sourceCounts.get(letter) ?? 0) < needed) return false;
  }
  return true;
}

function pluralizeWords(count: number): string {
  return `${count} word${count === 1 ? '' : 's'}`;
}

export default function DailyWordPage(): JSX.Element {
  const day = useMemo(() => currentDayNumber(), []);
  const sourceWord = useMemo(() => DAILY_WORDS[dayIndex(day)] ?? 'extraordinary', [day]);
  const existingAttempt = useMemo(() => loadDailyAttempt(day), [day]);
  const initialRemaining = existingAttempt ? Math.max(0, Math.ceil((existingAttempt.endsAt - Date.now()) / 1000)) : DAILY_SECONDS;
  const initialFinished = Boolean(existingAttempt?.finished || (existingAttempt && initialRemaining <= 0));

  const [timeLeft, setTimeLeft] = useState(initialFinished ? 0 : initialRemaining);
  const [isRunning, setIsRunning] = useState(Boolean(existingAttempt && !initialFinished));
  const [isFinished, setIsFinished] = useState(initialFinished);
  const [inputWord, setInputWord] = useState('');
  const [words, setWords] = useState<string[]>(existingAttempt?.words ?? []);
  const [message, setMessage] = useState(
    existingAttempt
      ? initialFinished
        ? 'Your daily run is complete. Share it and challenge a friend.'
        : 'Daily run in progress. Keep going!'
      : 'Press Start to begin your daily run.'
  );
  const [shareStatus, setShareStatus] = useState('');
  const [isWordInputFocused, setIsWordInputFocused] = useState(false);
  const timerRef = useRef<number | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const attemptRef = useRef<DailyAttempt | undefined>(existingAttempt);
  const dailyCompletionTrackedRef = useRef(Boolean(existingAttempt?.finished));

  function finishAttempt(finalWords = words): void {
    const wasFinished = Boolean(attemptRef.current?.finished);
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    setIsRunning(false);
    setIsFinished(true);
    setTimeLeft(0);
    setMessage('Time! Daily run complete.');

    if (attemptRef.current) {
      attemptRef.current = {
        ...attemptRef.current,
        finished: true,
        words: finalWords
      };
      saveDailyAttempt(attemptRef.current);
    }

    if (!wasFinished && !dailyCompletionTrackedRef.current) {
      dailyCompletionTrackedRef.current = true;
      trackDailyCompleted(finalWords.length);
    }
  }

  useEffect(() => {
    if (!attemptRef.current) return undefined;

    if (attemptRef.current.finished || attemptRef.current.endsAt <= Date.now()) {
      finishAttempt(attemptRef.current.words);
      return undefined;
    }

    timerRef.current = window.setInterval(() => {
      if (!attemptRef.current) return;
      const remaining = Math.max(0, Math.ceil((attemptRef.current.endsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        finishAttempt(attemptRef.current.words);
      }
    }, 250);

    return () => window.clearInterval(timerRef.current);
    // Run once on mount. finishAttempt reads the latest ref when the interval fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start(): void {
    if (isRunning) return;

    const isRetry = Boolean(attemptRef.current);
    const now = Date.now();
    const attempt: DailyAttempt = {
      day,
      sourceWord,
      startedAt: now,
      endsAt: now + DAILY_SECONDS * 1000,
      finished: false,
      words: []
    };

    attemptRef.current = attempt;
    dailyCompletionTrackedRef.current = false;
    saveDailyAttempt(attempt);
    trackDailyStarted(isRetry);
    setWords([]);
    setInputWord('');
    setTimeLeft(DAILY_SECONDS);
    setIsFinished(false);
    setIsRunning(true);
    setShareStatus('');
    setMessage('Go!');

    window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((attempt.endsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        finishAttempt(attemptRef.current?.words ?? []);
      }
    }, 250);
  }

  function submitWord(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isRunning || !attemptRef.current) return;

    const word = inputWord.trim().toLowerCase();
    setInputWord('');

    if (!word) return;
    if (!/^[a-z]+$/.test(word)) {
      trackHotjarEvent('daily_word_rejected');
      setMessage('Words can only contain letters.');
      return;
    }
    if (attemptRef.current.words.includes(word)) {
      trackHotjarEvent('daily_word_rejected');
      setMessage('You already made that word.');
      return;
    }
    if (!canMakeWord(word, sourceWord)) {
      trackHotjarEvent('daily_word_rejected');
      setMessage('That word cannot be made from the daily word.');
      return;
    }

    const nextWords = [...attemptRef.current.words, word].sort();
    attemptRef.current = { ...attemptRef.current, words: nextWords };
    saveDailyAttempt(attemptRef.current);
    trackHotjarEvent('daily_word_accepted');
    setWords(nextWords);
    setMessage(`Accepted: ${word}`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function shareScore(): Promise<void> {
    const dailyUrl = getDailyChallengeUrl();
    const text = `I made ${pluralizeWords(words.length)} from "${sourceWord}" in 30 seconds on Words of Word. I challenge you to make more.`;
    const method = await shareContent({
      title: 'Words of Word Daily Challenge',
      text,
      url: dailyUrl,
      dialogTitle: 'Share daily challenge'
    });

    if (method === 'unavailable') {
      trackHotjarEvent('daily_share_unavailable');
      setShareStatus(`${text} ${dailyUrl}`);
      return;
    }

    trackHotjarEvent(method === 'clipboard' ? 'daily_share_copied' : 'daily_shared');
    setShareStatus(method === 'clipboard' ? 'Challenge copied. Paste it anywhere.' : 'Shared!');
  }

  const timerProgress = Math.max(0, Math.min(100, (timeLeft / DAILY_SECONDS) * 100));
  const timerState = timeLeft <= 5 ? 'urgent' : timeLeft <= 10 ? 'warn' : 'ok';

  return (
    <main className={`game-shell daily-shell${isWordInputFocused ? ' is-typing' : ''}`} data-hj-suppress>
      <header className="game-header daily-game-header">
        <div className="game-header__left">
          <span className="game-header__label">daily</span>
          <span className="game-header__roomid">daily word</span>
          <span className="game-header__dot">·</span>
          <span className="game-header__count">new word every day</span>
        </div>
        <div className="game-header__right">
          <Link to="/"><Button variant="mini" size="sm" type="button" className="game-header__action daily-game-header__home">Home</Button></Link>
        </div>
      </header>

      <aside className="players-panel glass-panel daily-run-panel">
        <p className="eyebrow">Today&apos;s run</p>
        <div className="daily-run-panel__metric">
          <strong>{words.length}</strong>
          <span>{pluralizeWords(words.length)}</span>
        </div>
        <p className="daily-run-panel__copy">{isFinished ? 'Final result saved for today.' : isRunning ? 'Clock is running.' : 'Thirty seconds. One source word.'}</p>
      </aside>

      <section className="word-stage glass-panel daily-stage">
        <div className="stage-notice-bar active" aria-live="polite">{shareStatus || message}</div>

        <div className="current-word-card">
          <span className="current-word-label">Today&apos;s word</span>
          <span className="current-word-text" title={sourceWord}>{sourceWord}</span>
        </div>

        <div className={`timer-section${timeLeft <= 5 && isRunning ? ' urgent' : ''}`}>
          <div className="round-timer">
            <Progress
              value={timerProgress}
              state={timerState}
              aria-label="Daily run time remaining"
              aria-valuetext={`${timeLeft} seconds remaining`}
            />
            <span className="round-timer__label" aria-hidden="true">{timeLeft}</span>
          </div>
        </div>

        <form className="word-form daily-word-form" onSubmit={submitWord}>
          <div>
            <Label htmlFor="daily-word-input">Your word</Label>
            <Input
              ref={inputRef}
              id="daily-word-input"
              value={inputWord}
              onChange={(e) => setInputWord(e.currentTarget.value)}
              onFocus={() => setIsWordInputFocused(true)}
              onBlur={() => setIsWordInputFocused(false)}
              placeholder={isRunning ? 'Type a word…' : 'Start the timer first'}
              disabled={!isRunning}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
            />
          </div>
          <Button variant="primary" type="submit" disabled={!isRunning || !inputWord.trim()}>Go</Button>
        </form>

        <div className="words-card daily-result-card">
          <div className="words-header">
            <h3>Your Words</h3>
            <span className="words-count">{pluralizeWords(words.length)}</span>
          </div>
          <div className="word-chip-list">
            {words.length > 0 ? words.map((word) => <Badge key={word} variant="word">{word}</Badge>) : <em>No words yet.</em>}
          </div>
        </div>

        {isFinished && (
          <div className="daily-share-card">
            <p>I made <strong>{pluralizeWords(words.length)}</strong> in 30 seconds.</p>
            <p>I challenge you to make more.</p>
          </div>
        )}

        <div className="button-row daily-stage__actions">
          {isFinished && <Button variant="secondary" onClick={start}>Try Again</Button>}
          {isFinished ? (
            <Button variant="primary" onClick={shareScore}>Share Challenge</Button>
          ) : (
            <Button variant="primary" onClick={start} disabled={isRunning}>
              {isRunning ? 'Running…' : 'Start 30s'}
            </Button>
          )}
        </div>
      </section>

      <aside className="info-panel glass-panel daily-info-panel">
        <p className="eyebrow">How it works</p>
        <h2>Make words from the big word.</h2>
        <ul>
          <li>Everyone gets the same source word.</li>
          <li>Use each letter no more than it appears.</li>
          <li>Find as many words as you can in 30 seconds.</li>
          <li>Resubmit anytime to beat your score.</li>
        </ul>
      </aside>
    </main>
  );
}
