import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS and
 * is the ONLY writer of competitive stats (ELO, streak, match/daily results).
 *
 * Optional: if the env vars are absent the server still runs fully (anonymous
 * play, analytics, etc.) — stats writing simply becomes a no-op. Never expose
 * the service role key to a client; it stays on the server.
 */
const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const isSupabaseAdminConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

export const supabaseAdmin: SupabaseClient | null = isSupabaseAdminConfigured
  ? createClient(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

/** Short-lived cache so reconnect storms don't re-hit the Auth API per socket. */
const tokenCache = new Map<string, { userId: string | null; expires: number }>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Verify a Supabase access token and return the authenticated user id, or null
 * if the token is missing/invalid or Supabase isn't configured. Never throws.
 */
export async function verifyAccessToken(token: string | undefined): Promise<string | null> {
  if (!supabaseAdmin || !token) return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.userId;

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    const userId = error ? null : data.user?.id ?? null;
    tokenCache.set(token, { userId, expires: Date.now() + TOKEN_CACHE_TTL_MS });
    return userId;
  } catch {
    return null;
  }
}
