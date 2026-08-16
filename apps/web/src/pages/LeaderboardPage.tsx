import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button } from '../components/ui';
import { AuthControl } from '../components/AuthControl';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchGlobalLeaderboard,
  fetchMyStats,
  fetchWeeklyLeaderboard,
  type LeaderboardEntry,
  type PlayerStats
} from '../services/stats';

type Tab = 'global' | 'weekly';

export default function LeaderboardPage(): JSX.Element {
  const navigate = useNavigate();
  const { enabled, user } = useAuth();
  const [tab, setTab] = useState<Tab>('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = tab === 'global' ? fetchGlobalLeaderboard : fetchWeeklyLeaderboard;
    void load(100).then((rows) => {
      if (cancelled) return;
      setEntries(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setMyStats(null); return; }
    void fetchMyStats(user.id).then((stats) => { if (!cancelled) setMyStats(stats); });
    return () => { cancelled = true; };
  }, [user]);

  return (
    <main className="page-shell leaderboard-shell">
      <section className="panel-card">
        <div className="leaderboard-head">
          <div>
            <p className="eyebrow">compete</p>
            <h1>Leaderboard</h1>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>← Home</Button>
        </div>

        {!enabled && (
          <p className="muted">Leaderboards are unavailable right now.</p>
        )}

        {enabled && (
          <>
            {user && myStats ? (
              <div className="leaderboard-me">
                <div className="leaderboard-me__stat"><strong>{myStats.eloRating}</strong><span>ELO</span></div>
                <div className="leaderboard-me__stat"><strong>🔥 {myStats.currentStreak}</strong><span>streak</span></div>
                <div className="leaderboard-me__stat"><strong>{myStats.wins}</strong><span>wins</span></div>
                <div className="leaderboard-me__stat"><strong>{myStats.gamesPlayed}</strong><span>games</span></div>
              </div>
            ) : (
              <div className="leaderboard-signin">
                <p className="muted">Sign in to appear on the leaderboard and track your ELO &amp; streak.</p>
                <AuthControl />
              </div>
            )}

            <div className="leaderboard-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'global'}
                className={`leaderboard-tab${tab === 'global' ? ' is-active' : ''}`}
                onClick={() => setTab('global')}
              >
                Global · ELO
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'weekly'}
                className={`leaderboard-tab${tab === 'weekly' ? ' is-active' : ''}`}
                onClick={() => setTab('weekly')}
              >
                This week · Points
              </button>
            </div>

            {loading ? (
              <p className="muted">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="muted">No entries yet — play a ranked online match or the daily to get on the board.</p>
            ) : (
              <ol className="leaderboard-list">
                {entries.map((entry) => {
                  const isMe = user?.id === entry.userId;
                  const metric = tab === 'global'
                    ? `${entry.eloRating} ELO`
                    : `${entry.weeklyPoints ?? 0} pts`;
                  return (
                    <li key={entry.userId} className={`leaderboard-row${isMe ? ' is-me' : ''}`}>
                      <span className="leaderboard-rank">{entry.rank}</span>
                      <Avatar name={entry.username} avatar={entry.avatar ?? undefined} size="sm" />
                      <span className="leaderboard-name">{entry.username}{isMe ? ' (you)' : ''}</span>
                      <span className="leaderboard-sub">🔥 {entry.currentStreak}</span>
                      <span className="leaderboard-metric">{metric}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </section>
    </main>
  );
}
