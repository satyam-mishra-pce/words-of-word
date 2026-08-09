import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayerAvatarEditor } from '../components/PlayerAvatarEditor';
import { NativeNotificationPrompt } from '../components/NativeNotificationPrompt';
import { ThemePicker } from '../components/ThemePicker';
import { Alert, Avatar, Button, Input } from '../components/ui';
import { loadPlayerAvatar, loadUsername, savePlayerAvatar, saveUsername } from '../services/session';
import { getGameServerUrl } from '../services/platform';
import { trackFeatureUsage } from '../services/aggregateAnalytics';

const FLOAT_CHARS = ['W', 'O', 'R', 'D', 'S', '?'];
const statsUrl = `${getGameServerUrl()}/stats`;

interface PublicStats {
  activePlayers: number;
  activeGames: number;
  wordsFound: number;
}

function ArrowIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 9h11M10 4l5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function EditIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="m11.8 3.2 3 3M3.5 14.5l2.4-.5 8.5-8.5-2-2L3.9 12l-.4 2.5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  );
}

function DailyWordIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <rect x="3" y="3.5" width="12" height="11.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2v3M12 2v3M3.5 7h11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="m9 9 .55 1.45L11 11l-1.45.55L9 13l-.55-1.45L7 11l1.45-.55L9 9Z" fill="currentColor" />
    </svg>
  );
}

export default function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loadUsername());
  const [avatar, setAvatar] = useState(loadPlayerAvatar());
  const [error, setError] = useState('');
  const [stats, setStats] = useState<PublicStats | undefined>();
  const [isAvatarEditorOpen, setAvatarEditorOpen] = useState(false);

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

  function updateAvatar(nextAvatar: typeof avatar): void {
    setAvatar(nextAvatar);
    savePlayerAvatar(nextAvatar);
  }

  function requireUsername(): string | undefined {
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Choose a player name to enter the room.');
      return undefined;
    }
    saveUsername(trimmed);
    savePlayerAvatar(avatar);
    return trimmed;
  }

  function createRoom(): void {
    if (!requireUsername()) return;
    trackFeatureUsage('home_create_private_selected');
    navigate('/settings');
  }

  function onlineRoom(): void {
    if (!requireUsername()) return;
    trackFeatureUsage('home_online_multiplayer_selected');
    navigate('/online');
  }

  function joinRoom(): void {
    if (!requireUsername()) return;
    trackFeatureUsage('home_join_private_selected');
    navigate('/join');
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onlineRoom();
  }

  return (
    <main className="starter-shell">
      <div className="starter-letter-field" aria-hidden="true">
        {FLOAT_CHARS.map((char, index) => <span key={`${char}-${index}`}>{char}</span>)}
      </div>

      <header className="starter-header">
        <a className="starter-brand" href="/" aria-label="Words of Word home">
          words <i>of</i> word
        </a>
        <div className="starter-header__actions">
          {stats && (
            <span className="starter-live-count" title={`${stats.activeGames} live rooms`}>
              <i /> {stats.activePlayers} playing
            </span>
          )}
          <button type="button" className="starter-daily-link" onClick={() => navigate('/about')} aria-label="Open the Words of Word mode guide">
            <span><b>About</b> <em>modes</em></span>
            <ArrowIcon />
          </button>
          <button type="button" className="starter-daily-link" onClick={() => navigate('/daily')} aria-label="Play the Daily Word challenge">
            <span className="starter-daily-link__icon"><DailyWordIcon /></span>
            <span><b>Daily</b> <em>word</em></span>
            <ArrowIcon />
          </button>
        </div>
      </header>

      <div className="starter-center">
        <section className="starter-stage" aria-labelledby="starter-title">
          <div className="starter-intro">
            <p className="starter-kicker">word battle · real-time</p>
            <h1 id="starter-title">words of word</h1>
            <p>One enormous word. Hundreds hiding inside it. Race your friends to find them all before the clock hits zero.</p>
            {stats && (
              <div className="starter-proof" aria-label="Live game stats">
                <span><strong>{stats.activeGames}</strong> rooms live</span>
                <span><strong>{stats.wordsFound.toLocaleString()}</strong> words found</span>
              </div>
            )}
          </div>

          <form className="starter-console" onSubmit={submit}>
            <div className="starter-profile">
              <button
                type="button"
                className="starter-avatar-button"
                onClick={() => { trackFeatureUsage('avatar_editor_opened'); setAvatarEditorOpen(true); }}
                aria-label="Customize your player character"
              >
                <span className="starter-avatar-frame">
                  <Avatar name={username} avatar={avatar} size="lg" />
                  <span className="starter-avatar-edit"><EditIcon /></span>
                </span>
              </button>

              <div className="starter-name-field">
                <Input
                  id="username"
                  aria-label="Player name"
                  value={username}
                  onChange={(event) => { setUsername(event.currentTarget.value); setError(''); }}
                  placeholder="Player name"
                  maxLength={20}
                  autoComplete="nickname"
                  hasError={Boolean(error)}
                />
              </div>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <Button variant="primary" size="lg" fullWidth type="submit" className="starter-primary-action">
              Online Multiplayer <ArrowIcon />
            </Button>

            <div className="starter-private-actions" aria-label="Private room actions">
              <Button variant="secondary" size="md" type="button" onClick={createRoom}>
                Create Private Room
              </Button>
              <Button variant="secondary" size="md" type="button" onClick={joinRoom}>
                Join Private Room
              </Button>
            </div>

            <NativeNotificationPrompt />
          </form>
        </section>
      </div>

      <footer className="home-theme-footer home-theme-footer--starter">
        <ThemePicker />
      </footer>

      <PlayerAvatarEditor
        open={isAvatarEditorOpen}
        onClose={() => setAvatarEditorOpen(false)}
        avatar={avatar}
        name={username}
        onChange={updateAvatar}
      />
    </main>
  );
}
