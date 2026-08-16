import { useState } from 'react';
import { Button } from './ui';
import { useAuth } from '../auth/AuthProvider';

function GoogleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Optional Google sign-in. Renders nothing when Supabase isn't configured, so
 * anonymous play is never affected. `variant="compact"` fits the home header;
 * the default fits the settings-style panels.
 */
export function AuthControl({ variant = 'default' }: { variant?: 'default' | 'compact' }): JSX.Element | null {
  const { enabled, loading, user, signInWithGoogle, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!enabled || loading) return null;

  async function handleSignIn(): Promise<void> {
    setBusy(true);
    setError('');
    const result = await signInWithGoogle();
    if (result.error) setError(result.error);
    // On success the browser redirects (web) or opens the OAuth sheet (native),
    // so we only clear busy on failure.
    if (result.error) setBusy(false);
  }

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  if (user) {
    const label = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Signed in';
    if (variant === 'compact') {
      return (
        <button
          type="button"
          className="starter-daily-link"
          onClick={handleSignOut}
          disabled={busy}
          aria-label={`Signed in as ${label}. Sign out.`}
          title={`Signed in as ${label}`}
        >
          <span><b>Sign</b> <em>out</em></span>
        </button>
      );
    }
    return (
      <div className="auth-control">
        <span className="auth-control__who" title={String(label)}>Signed in as {String(label)}</span>
        <Button variant="secondary" size="sm" onClick={handleSignOut} isLoading={busy}>Sign out</Button>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        className="starter-daily-link"
        onClick={handleSignIn}
        disabled={busy}
        aria-label="Sign in with Google"
      >
        <span className="starter-daily-link__icon"><GoogleIcon /></span>
        <span><b>Sign in</b> <em>Google</em></span>
      </button>
    );
  }

  return (
    <div className="auth-control">
      <Button variant="secondary" size="md" onClick={handleSignIn} isLoading={busy} className="auth-control__google">
        <GoogleIcon /> Sign in with Google
      </Button>
      {error && <span className="auth-control__error">{error}</span>}
    </div>
  );
}
