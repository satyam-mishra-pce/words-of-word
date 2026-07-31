import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Label } from '../components/ui';
import { NativeNotificationPrompt } from '../components/NativeNotificationPrompt';
import { loadUsername, saveUsername } from '../services/session';
import { getGameServerUrl } from '../services/platform';

const FLOAT_CHARS = ['W', 'O', 'R', 'D', 'S', '?'];
const statsUrl = `${getGameServerUrl()}/stats`;

interface PublicStats {
  activePlayers: number;
  activeGames: number;
  uniqueDevices: number;
  gamesPlayed: number;
  wordsFound: number;
}

export default function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loadUsername());
  const [error, setError] = useState('');
  const [stats, setStats] = useState<PublicStats | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function loadStats(): Promise<void> {
      try {
        const response = await fetch(statsUrl);
        const payload = await response.json() as { ok: boolean; data?: PublicStats };
        if (!cancelled && payload.ok) setStats(payload.data);
      } catch {
        // Stats are only social proof; never block the home page.
      }
    }

    void loadStats();
    const timer = window.setInterval(loadStats, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function requireUsername(): string | undefined {
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Please enter a username.');
      return undefined;
    }
    saveUsername(trimmed);
    return trimmed;
  }

  function createRoom(): void {
    if (requireUsername()) navigate('/settings');
  }

  function onlineRoom(): void {
    if (requireUsername()) navigate('/online');
  }

  function joinRoom(): void {
    if (requireUsername()) navigate('/join');
  }

  function dailyWord(): void {
    if (requireUsername()) navigate('/daily');
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onlineRoom();
  }

  return (
    <main className="page-shell">
      <div className="float-letters" aria-hidden="true">
        {FLOAT_CHARS.map((char) => (
          <span key={char} className="float-letter">{char}</span>
        ))}
      </div>

      <section className="hero-card">
        <p className="eyebrow">word battle · real-time</p>
        <h1>Words of Word</h1>
        <p className="hero-copy">
          One enormous word. Hundreds hiding inside it. Race your friends to find them all before the clock hits zero.
        </p>

        {stats && (
          <div className="public-stats" aria-label="Live game stats">
            <span><strong>{stats.activePlayers}</strong> playing now</span>
            <span><strong>{stats.activeGames}</strong> live rooms</span>
            <span><strong>{stats.uniqueDevices}</strong> unique players</span>
          </div>
        )}

        <form className="entry-panel" onSubmit={submit}>
          <div>
            <Label htmlFor="username">Player name</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => { setUsername(e.currentTarget.value); setError(''); }}
              placeholder="e.g. Lexicon Larry"
              maxLength={20}
              autoComplete="nickname"
              hasError={Boolean(error)}
            />
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="button-stack" style={{ marginTop: 4 }}>
            <Button variant="primary" size="lg" fullWidth type="button" onClick={onlineRoom}>
              Online Multiplayer
            </Button>
            <Button variant="secondary" size="lg" fullWidth type="button" onClick={createRoom}>
              Create Private Room
            </Button>
            <Button variant="secondary" size="lg" fullWidth type="button" onClick={joinRoom}>
              Join Private Room
            </Button>
            <Button className="daily-word-cta" variant="ghost" size="lg" fullWidth type="button" onClick={dailyWord}>
              Daily Word
            </Button>
          </div>
        </form>
        <NativeNotificationPrompt />
      </section>
    </main>
  );
}
