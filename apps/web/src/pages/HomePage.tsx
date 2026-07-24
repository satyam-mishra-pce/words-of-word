import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Label } from '../components/ui';
import { loadUsername, saveUsername } from '../services/session';

const FLOAT_CHARS = ['W', 'O', 'R', 'D', 'S', '?'];

export default function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loadUsername());
  const [error, setError] = useState('');

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

  function joinRoom(): void {
    if (requireUsername()) navigate('/join');
  }

  function dailyWord(): void {
    if (requireUsername()) navigate('/daily');
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createRoom();
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
            <Button variant="primary" size="lg" fullWidth type="button" onClick={createRoom}>
              Create New Room
            </Button>
            <Button variant="secondary" size="lg" fullWidth type="button" onClick={joinRoom}>
              Join Existing Game
            </Button>
            <Button variant="ghost" size="lg" fullWidth type="button" onClick={dailyWord}>
              Daily Word
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
