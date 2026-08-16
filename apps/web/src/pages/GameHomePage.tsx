import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayerAvatarEditor } from '../components/PlayerAvatarEditor';
import { NativeNotificationPrompt } from '../components/NativeNotificationPrompt';
import { ThemePicker } from '../components/ThemePicker';
import { Alert, Avatar, Button, Input } from '../components/ui';
import { loadPlayerAvatar, loadUsername, savePlayerAvatar, saveUsername } from '../services/session';
import { getGameApiUrl } from '../services/platform';
import { trackFeatureUsage } from '../services/aggregateAnalytics';
import { ProfileMenu } from '../components/ProfileMenu';
import { StreakDailyPill } from '../components/StreakDailyPill';
import { fetchMyStats, type PlayerStats } from '../services/stats';
import { isTodayDailyDone } from '../services/dailyStatus';
import { IDENTITY_CHANGE_EVENT, useAuth } from '../auth/AuthProvider';

const FLOAT_CHARS = ['W', 'O', 'R', 'D', 'S', '?'];
const statsUrl = getGameApiUrl('/api/stats');

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

function TrophyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M5 3h8v3a4 4 0 0 1-8 0V3Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5 4H3v1.5A2.5 2.5 0 0 0 5 8M13 4h2v1.5A2.5 2.5 0 0 1 13 8M7 11h4M9 10v2M6.5 15h5M8 13h2l.4 2h-2.8L8 13Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { persistIdentity, user } = useAuth();
  const [username, setUsername] = useState(loadUsername());
  const [avatar, setAvatar] = useState(loadPlayerAvatar());
  const [error, setError] = useState('');
  const [stats, setStats] = useState<PublicStats | undefined>();
  const [isAvatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);
  const [dailyDone, setDailyDone] = useState(false);

  // When a sign-in adopts a durable identity, refresh the fields from storage.
  useEffect(() => {
    function onIdentityChange(): void {
      setUsername(loadUsername());
      setAvatar(loadPlayerAvatar());
    }
    window.addEventListener(IDENTITY_CHANGE_EVENT, onIdentityChange);
    return () => window.removeEventListener(IDENTITY_CHANGE_EVENT, onIdentityChange);
  }, []);

  useEffect(() => { setDailyDone(isTodayDailyDone()); }, []);

  // The signed-in player's competitive stats power the header streak + menu.
  useEffect(() => {
    let cancelled = false;
    if (!user) { setMyStats(null); return; }
    void fetchMyStats(user.id).then((stats) => { if (!cancelled) setMyStats(stats); });
    return () => { cancelled = true; };
  }, [user]);

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
    persistIdentity({ avatar: nextAvatar });
  }

  function requireUsername(): string | undefined {
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Choose a player name to enter the room.');
      return undefined;
    }
    saveUsername(trimmed);
    savePlayerAvatar(avatar);
    persistIdentity({ username: trimmed, avatar });
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
          <StreakDailyPill streak={user ? (myStats?.currentStreak ?? 0) : null} done={dailyDone} />
          <button type="button" className="header-leaderboard" onClick={() => navigate('/leaderboard')} aria-label="View the leaderboard">
            <TrophyIcon />
            <span className="header-leaderboard__label">Leaderboard</span>
          </button>
          <ProfileMenu
            username={username}
            avatar={avatar}
            myStats={myStats}
            onEditIdentity={() => { trackFeatureUsage('avatar_editor_opened'); setAvatarEditorOpen(true); }}
          />
        </div>
      </header>

      <div className="starter-center">
        <section className="starter-stage" aria-labelledby="starter-title">
          <div className="starter-intro">
            <h1 id="starter-title">words of word</h1>
            <div className="starter-quicklinks">
              <button type="button" className="starter-quicklink" onClick={() => navigate('/about')}>How to play</button>
              <span aria-hidden="true">·</span>
              <button type="button" className="starter-quicklink" onClick={() => navigate('/about')}>About modes →</button>
            </div>
          </div>

          <form className="starter-console" onSubmit={submit}>
            <div className="identity-box">
              <button
                type="button"
                className="identity-box__avatar"
                onClick={() => { trackFeatureUsage('avatar_editor_opened'); setAvatarEditorOpen(true); }}
                aria-label="Edit your character"
              >
                <Avatar name={username} avatar={avatar} size="lg" />
                <span className="identity-box__edit"><EditIcon /></span>
              </button>

              <div className="identity-box__fields">
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
                {user
                  ? (myStats && <span className="identity-box__meta">⚔ {myStats.eloRating} · 🔥 {myStats.currentStreak}</span>)
                  : <span className="identity-box__meta muted">Guest · sign in to rank</span>}
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

            {stats && (
              <p className="starter-live" aria-label="Live game stats">
                <b>{stats.activePlayers}</b> playing · <b>{stats.activeGames}</b> rooms live
              </p>
            )}
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
