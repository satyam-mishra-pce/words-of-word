import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { track as trackAuth } from '../services/analytics';
import { Browser } from '@capacitor/browser';
import type { Session, User } from '@supabase/supabase-js';
import type { PlayerAvatar } from '@wow/shared';
import { isSupabaseConfigured, NATIVE_AUTH_CALLBACK_URL, supabase } from '../services/supabase';
import { saveProfile, syncProfileOnSignIn } from '../services/profile';
import { isNativeApp } from '../services/platform';
import { setSupabaseAuthToken } from '../services/socket';

/** Fired after a sign-in adopts a durable identity so anonymous surfaces refresh. */
export const IDENTITY_CHANGE_EVENT = 'wow:identity-change';

interface AuthContextValue {
  /** True only when Supabase is configured — every auth surface hides itself otherwise. */
  enabled: boolean;
  /** Still resolving the initial session. */
  loading: boolean;
  user: User | null;
  session: Session | null;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /** Push the current username/avatar to the signed-in profile (no-op when signed out). */
  persistIdentity: (fields: { username?: string; avatar?: PlayerAvatar }) => void;
  /** Called by the native bridge when the wordsofword://auth/callback deep link arrives. */
  completeNativeOAuth: (callbackUrl: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function emitIdentityChange(): void {
  window.dispatchEvent(new CustomEvent(IDENTITY_CHANGE_EVENT));
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const syncedUserId = useRef<string | null>(null);

  const reconcile = useCallback(async (nextSession: Session | null) => {
    const userId = nextSession?.user?.id ?? null;
    if (userId && syncedUserId.current !== userId) {
      syncedUserId.current = userId;
      try {
        await syncProfileOnSignIn(userId);
        emitIdentityChange();
      } catch (error) {
        console.warn('Profile sync failed', error);
      }
    }
    if (!userId) syncedUserId.current = null;
  }, []);

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      setSupabaseAuthToken(data.session?.access_token ?? null);
      void reconcile(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      // Keep the game server's ranked-identity token current on sign-in,
      // sign-out, and silent token refreshes.
      setSupabaseAuthToken(nextSession?.access_token ?? null);
      void reconcile(nextSession);
      if (_event === 'SIGNED_IN' || _event === 'TOKEN_REFRESHED') trackAuth('auth_login', {});
      else if (_event === 'SIGNED_OUT') trackAuth('auth_logout', {});
    });

    return () => subscription.subscription.unsubscribe();
  }, [reconcile]);

  const signInWithGoogle = useCallback(async (): Promise<{ error?: string }> => {
    if (!supabase) return { error: 'Sign-in is not available right now.' };

    // Native: skip the automatic redirect, open the provider URL in the system
    // browser, and let the wordsofword:// deep link hand control back to the app.
    if (isNativeApp) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: NATIVE_AUTH_CALLBACK_URL, skipBrowserRedirect: true }
      });
      if (error) return { error: error.message };
      if (data?.url) await Browser.open({ url: data.url, presentationStyle: 'popover' });
      return {};
    }

    // Web/PWA: full-page redirect back to the current origin+path.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    return error ? { error: error.message } : {};
  }, []);

  const completeNativeOAuth = useCallback(async (callbackUrl: string): Promise<void> => {
    if (!supabase) return;
    try {
      await supabase.auth.exchangeCodeForSession(callbackUrl);
    } catch (error) {
      console.warn('Native OAuth exchange failed', error);
    } finally {
      await Browser.close().catch(() => undefined);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    if (!supabase) return;
    await supabase.auth.signOut();
    syncedUserId.current = null;
  }, []);

  const persistIdentity = useCallback((fields: { username?: string; avatar?: PlayerAvatar }) => {
    const userId = syncedUserId.current;
    if (!userId) return;
    void saveProfile(userId, fields);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    enabled: isSupabaseConfigured,
    loading,
    user: session?.user ?? null,
    session,
    signInWithGoogle,
    signOut,
    persistIdentity,
    completeNativeOAuth
  }), [loading, session, signInWithGoogle, signOut, persistIdentity, completeNativeOAuth]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
