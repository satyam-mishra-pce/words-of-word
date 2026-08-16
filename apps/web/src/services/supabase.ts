import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isNativeApp } from './platform';

/**
 * Single Supabase client for the whole web/native app. Auth is *optional*: the
 * game plays fully anonymously without any of these env vars set, so we never
 * throw at import time. When the project isn't configured, `supabase` is null
 * and every auth surface hides itself.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * The custom scheme the OS routes back into the Capacitor app after Google
 * sign-in. Registered in ios/App/App/Info.plist and android intent filters, and
 * allow-listed in supabase/config.toml + the hosted project's redirect URLs.
 */
export const NATIVE_AUTH_CALLBACK_URL = 'wordsofword://auth/callback';

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        // PKCE is required for the native deep-link flow and is safe on web too.
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        // On web, let supabase-js parse the OAuth response from the URL it was
        // redirected back to. On native we intercept the wordsofword:// deep
        // link ourselves and call exchangeCodeForSession manually.
        detectSessionInUrl: !isNativeApp
      }
    })
  : null;
