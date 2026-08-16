import { supabase } from './supabase';
import type { PlayerAvatar } from '@wow/shared';

export interface PlayerStats {
  eloRating: number;
  gamesPlayed: number;
  wins: number;
  currentStreak: number;
  longestStreak: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: PlayerAvatar | null;
  eloRating: number;
  currentStreak: number;
  /** Present on the global board. */
  wins?: number;
  gamesPlayed?: number;
  longestStreak?: number;
  /** Present on the weekly board. */
  weeklyPoints?: number;
}

/** The signed-in player's own competitive stats (RLS-scoped to their row). */
export async function fetchMyStats(userId: string): Promise<PlayerStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('player_stats')
    .select('elo_rating, games_played, wins, current_streak, longest_streak')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    eloRating: data.elo_rating ?? 1000,
    gamesPlayed: data.games_played ?? 0,
    wins: data.wins ?? 0,
    currentStreak: data.current_streak ?? 0,
    longestStreak: data.longest_streak ?? 0
  };
}

/** The signed-in player's leaderboard ranks (null when unranked / not present). */
export async function fetchMyRanks(userId: string): Promise<{ global: number | null; weekly: number | null }> {
  if (!supabase) return { global: null, weekly: null };
  const [globalRow, weeklyRow] = await Promise.all([
    supabase.from('leaderboard_global').select('rank').eq('user_id', userId).maybeSingle(),
    supabase.from('leaderboard_weekly').select('rank').eq('user_id', userId).maybeSingle()
  ]);
  return { global: globalRow.data?.rank ?? null, weekly: weeklyRow.data?.rank ?? null };
}

export async function fetchGlobalLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('leaderboard_global')
    .select('rank, user_id, username, avatar, elo_rating, games_played, wins, current_streak, longest_streak')
    .order('rank', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    rank: row.rank,
    userId: row.user_id,
    username: row.username || 'Player',
    avatar: (row.avatar as PlayerAvatar | null) ?? null,
    eloRating: row.elo_rating,
    wins: row.wins,
    gamesPlayed: row.games_played,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak
  }));
}

export async function fetchWeeklyLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('leaderboard_weekly')
    .select('rank, user_id, username, avatar, weekly_points, elo_rating, current_streak')
    .order('rank', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data.map((row) => ({
    rank: row.rank,
    userId: row.user_id,
    username: row.username || 'Player',
    avatar: (row.avatar as PlayerAvatar | null) ?? null,
    eloRating: row.elo_rating,
    currentStreak: row.current_streak,
    weeklyPoints: row.weekly_points
  }));
}
