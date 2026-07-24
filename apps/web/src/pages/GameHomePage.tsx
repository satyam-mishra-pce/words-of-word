import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Label } from '../components/ui';
import { loadUsername, saveUsername } from '../services/session';

export default function GameHomePage(): JSX.Element {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loadUsername());
  const [error, setError] = useState('');

  function continueTo(path: string): void {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Choose a player name first.');
      return;
    }

    saveUsername(trimmedUsername);
    navigate(path);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    continueTo('/settings');
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">words of word</p>
        <h1>Play the game</h1>
        <p className="muted">Create a room, join friends, or try the daily challenge.</p>

        <form className="entry-panel" style={{ marginTop: 18 }} onSubmit={submit}>
          <div>
            <Label htmlFor="home-username">Player name</Label>
            <Input
              id="home-username"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              placeholder="Your player name"
              maxLength={20}
            />
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="button-row" style={{ marginTop: 4 }}>
            <Button variant="primary" type="submit">Create Room</Button>
            <Button variant="secondary" type="button" onClick={() => continueTo('/join')}>Join Room</Button>
          </div>

          <Button variant="ghost" type="button" fullWidth onClick={() => continueTo('/daily')}>
            Try Daily Word
          </Button>

          <Button variant="ghost" type="button" fullWidth onClick={() => navigate('/about')}>
            About / trailer
          </Button>
        </form>
      </section>
    </main>
  );
}
