import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Input } from '../components/ui';
import { AuthControl } from '../components/AuthControl';
import { PlayerAvatarEditor } from '../components/PlayerAvatarEditor';
import { useAuth } from '../auth/AuthProvider';
import { loadPlayerAvatar, loadUsername, savePlayerAvatar, saveUsername } from '../services/session';
import { saveProfile } from '../services/profile';
import { fetchMyRanks, fetchMyStats, type PlayerStats } from '../services/stats';

export default function ProfilePage(): JSX.Element {
  const navigate = useNavigate();
  const { enabled, loading, user, signOut } = useAuth();
  const [username, setUsername] = useState(loadUsername());
  const [avatar, setAvatar] = useState(loadPlayerAvatar());
  const [editorOpen, setEditorOpen] = useState(false);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [ranks, setRanks] = useState<{ global: number | null; weekly: number | null }>({ global: null, weekly: null });

  useEffect(() => {
    let cancelled = false;
    if (!user) { setStats(null); return; }
    void fetchMyStats(user.id).then((value) => { if (!cancelled) setStats(value); });
    void fetchMyRanks(user.id).then((value) => { if (!cancelled) setRanks(value); });
    return () => { cancelled = true; };
  }, [user]);

  function commitName(): void {
    const trimmed = username.trim();
    if (!trimmed) return;
    saveUsername(trimmed);
    if (user) saveProfile(user.id, { username: trimmed });
  }

  function updateAvatar(next: typeof avatar): void {
    setAvatar(next);
    savePlayerAvatar(next);
    if (user) saveProfile(user.id, { avatar: next });
  }

  const losses = stats ? Math.max(0, stats.gamesPlayed - stats.wins) : 0;

  return (
    <main className="page-shell profile-shell">
      <section className="panel-card">
        <div className="leaderboard-head">
          <div>
            <p className="eyebrow">your profile</p>
            <h1>My Profile</h1>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>← Home</Button>
        </div>

        {(!enabled || (!user && !loading)) ? (
          <div className="leaderboard-signin">
            <p className="muted">Sign in to build your profile — your name, character, ELO and streak, saved across devices.</p>
            {enabled && <AuthControl />}
          </div>
        ) : user ? (
          <>
            <div className="profile-id">
              <button type="button" className="identity-box__avatar" onClick={() => setEditorOpen(true)} aria-label="Edit your character">
                <Avatar name={username} avatar={avatar} size="lg" />
                <span className="identity-box__edit">✎</span>
              </button>
              <div className="profile-id__fields">
                <Input
                  aria-label="Player name"
                  value={username}
                  onChange={(event) => setUsername(event.currentTarget.value)}
                  onBlur={commitName}
                  maxLength={20}
                  placeholder="Player name"
                />
                <span className="profile-id__email">{user.email}</span>
              </div>
            </div>

            <div className="leaderboard-me">
              <div className="leaderboard-me__stat"><strong>{stats?.eloRating ?? 1000}</strong><span>ELO</span></div>
              <div className="leaderboard-me__stat"><strong>🔥 {stats?.currentStreak ?? 0}</strong><span>streak</span></div>
              <div className="leaderboard-me__stat"><strong>{stats?.longestStreak ?? 0}</strong><span>best streak</span></div>
              <div className="leaderboard-me__stat"><strong>{stats?.wins ?? 0}–{losses}</strong><span>W–L</span></div>
              <div className="leaderboard-me__stat"><strong>{stats?.gamesPlayed ?? 0}</strong><span>games</span></div>
              <div className="leaderboard-me__stat"><strong>{ranks.weekly ? `#${ranks.weekly}` : '—'}</strong><span>weekly rank</span></div>
            </div>

            <div className="button-row">
              <Button variant="secondary" onClick={() => navigate('/leaderboard')}>View leaderboard</Button>
              <Button variant="secondary" onClick={() => { void signOut(); navigate('/'); }}>Sign out</Button>
            </div>
          </>
        ) : null}
      </section>

      <PlayerAvatarEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        avatar={avatar}
        name={username}
        onChange={updateAvatar}
      />
    </main>
  );
}
