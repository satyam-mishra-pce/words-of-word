import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlayerAvatar } from '@wow/shared';
import { Avatar } from './ui';
import { useAuth } from '../auth/AuthProvider';
import type { PlayerStats } from '../services/stats';

interface ProfileMenuProps {
  username: string;
  avatar: PlayerAvatar;
  myStats: PlayerStats | null;
  onEditIdentity: () => void;
  onOpenSettings?: () => void;
}

function GoogleGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * The single, scalable home for everything personal. Same container for guests
 * and members — only the contents adapt. Dropdown on desktop, bottom-sheet on
 * phone (see styles). New account features hang off here, never the header.
 */
export function ProfileMenu({ username, avatar, myStats, onEditIdentity, onOpenSettings }: ProfileMenuProps): JSX.Element {
  const navigate = useNavigate();
  const { enabled, loading, user, signInWithGoogle, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isMember = Boolean(user);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function handleSignIn(): Promise<void> {
    setBusy(true);
    const result = await signInWithGoogle();
    if (result.error) setBusy(false); // otherwise the browser redirects away
  }

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    await signOut();
    setBusy(false);
    setOpen(false);
  }

  function go(path: string): void {
    setOpen(false);
    navigate(path);
  }

  const losses = myStats ? Math.max(0, myStats.gamesPlayed - myStats.wins) : 0;

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className={`profile-menu__trigger${isMember ? ' is-member' : ' is-guest'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={username} avatar={avatar} size="sm" />
        {!isMember && <span className="profile-menu__guest-label">Guest</span>}
        <span className="profile-menu__caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <>
          <div className="profile-menu__scrim" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="profile-menu__panel" role="menu">
            <div className="profile-menu__grip" aria-hidden="true" />
            <div className="profile-menu__head">
              <Avatar name={username} avatar={avatar} size="md" />
              <div className="profile-menu__id">
                <strong>{username || 'Player'}</strong>
                {isMember && myStats ? (
                  <span>⚔ {myStats.eloRating} · 🔥 {myStats.currentStreak} · {myStats.wins}–{losses}</span>
                ) : (
                  <span className="muted">Playing as guest</span>
                )}
              </div>
            </div>

            {!isMember && enabled && !loading && (
              <button type="button" className="profile-menu__item profile-menu__item--primary" role="menuitem" onClick={handleSignIn} disabled={busy}>
                <GoogleGlyph /> Sign in with Google
              </button>
            )}
            {!isMember && enabled && (
              <p className="profile-menu__hint">Save your streak, ELO &amp; leaderboard rank.</p>
            )}

            {isMember && (
              <button type="button" className="profile-menu__item" role="menuitem" onClick={() => go('/profile')}>
                <span className="profile-menu__icon">👤</span> My profile
              </button>
            )}
            <button type="button" className="profile-menu__item" role="menuitem" onClick={() => { setOpen(false); onEditIdentity(); }}>
              <span className="profile-menu__icon">🎨</span> Edit character
            </button>
            {onOpenSettings && (
              <button type="button" className="profile-menu__item" role="menuitem" onClick={() => { setOpen(false); onOpenSettings(); }}>
                <span className="profile-menu__icon">⚙</span> Settings
              </button>
            )}
            <button type="button" className="profile-menu__item" role="menuitem" onClick={() => go('/about')}>
              <span className="profile-menu__icon">❔</span> How to play
            </button>

            {isMember && (
              <button type="button" className="profile-menu__item profile-menu__item--danger" role="menuitem" onClick={handleSignOut} disabled={busy}>
                <span className="profile-menu__icon">↪</span> Sign out
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
