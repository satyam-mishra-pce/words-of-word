import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Single Supabase client for the whole web app, used here for product
 * analytics (writing rows to public.analytics_event). Auth is *optional* and
 * out of scope on this branch: the game plays fully anonymously. When the
 * project isn't configured, `supabase` is null and every analytics surface
 * hides itself.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;
