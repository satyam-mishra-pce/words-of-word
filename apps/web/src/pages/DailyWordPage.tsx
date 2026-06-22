import { FormEvent, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Input, Label, Separator, TimerRing } from '../components/ui';

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

function dayIndex(): number {
  return Math.floor(Date.now() / 86_400_000) % DAILY_WORDS.length;
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

export default function DailyWordPage(): JSX.Element {
  const sourceWord = useMemo(() => DAILY_WORDS[dayIndex()] ?? 'extraordinary', []);
  const [timeLeft, setTimeLeft] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [inputWord, setInputWord] = useState('');
  const [words, setWords] = useState<string[]>([]);
  const [message, setMessage] = useState('Press start, then make as many words as possible in 30 seconds.');
  const timerRef = useRef<number | undefined>();

  function start(): void {
    window.clearInterval(timerRef.current);
    setWords([]);
    setInputWord('');
    setTimeLeft(30);
    setIsFinished(false);
    setIsRunning(true);
    setMessage('Go!');

    let remaining = 30;
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timerRef.current);
        setIsRunning(false);
        setIsFinished(true);
        setMessage('Time! Daily run complete.');
      }
    }, 1000);
  }

  function submitWord(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isRunning) return;

    const word = inputWord.trim().toLowerCase();
    setInputWord('');

    if (!word) return;
    if (!/^[a-z]+$/.test(word)) {
      setMessage('Words can only contain letters.');
      return;
    }
    if (words.includes(word)) {
      setMessage('You already made that word.');
      return;
    }
    if (!canMakeWord(word, sourceWord)) {
      setMessage('That word cannot be made from the daily word.');
      return;
    }

    setWords((prev) => [...prev, word].sort());
    setMessage(`Accepted: ${word}`);
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">daily word</p>
        <h1>Daily Word</h1>
        <p className="muted">Everyone gets the same daily source word. You get 30 seconds.</p>

        <div className="current-word-card" style={{ margin: '18px 0' }}>
          <span className="current-word-label">Today&apos;s word</span>
          <span className="current-word-text">{sourceWord}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <TimerRing timeLeft={timeLeft} totalTime={30} size={96} />
        </div>

        <form className="word-form" onSubmit={submitWord}>
          <div>
            <Label htmlFor="daily-word-input">Your word</Label>
            <Input
              id="daily-word-input"
              value={inputWord}
              onChange={(e) => setInputWord(e.currentTarget.value)}
              placeholder={isRunning ? 'Type and press Enter' : 'Start the timer first'}
              disabled={!isRunning}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <Button variant="primary" type="submit" disabled={!isRunning || !inputWord.trim()}>Submit</Button>
        </form>

        <Alert variant={isFinished ? 'success' : 'notice'} style={{ marginTop: 16 }}>{message}</Alert>

        <Separator style={{ margin: '18px 0' }} />

        <div className="words-card">
          <div className="words-header">
            <h3>Your Daily Score: {words.length * 3}</h3>
            <span className="words-count">{words.length} words</span>
          </div>
          <div className="word-chip-list">
            {words.length > 0 ? words.map((word) => <Badge key={word} variant="word">{word} +3</Badge>) : <em>No words yet.</em>}
          </div>
        </div>

        <div className="button-row" style={{ marginTop: 20 }}>
          <Link to="/"><Button variant="secondary">← Home</Button></Link>
          <Button variant="primary" onClick={start}>{isRunning ? 'Restart' : isFinished ? 'Try Again' : 'Start 30s'}</Button>
        </div>
      </section>
    </main>
  );
}
