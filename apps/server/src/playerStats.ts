import { supabaseAdmin } from './supabaseAdmin.js';

const ELO_K = 32;
const ELO_FLOOR = 100;

export interface RankedParticipant {
  userId: string;
  /** Final score in the room. */
  score: number;
  /** 1-based rank within the room (1 = winner; ties share a rank). */
  rank: number;
}

interface StatsRow {
  user_id: string;
  elo_rating: number;
  games_played: number;
  wins: number;
}

/**
 * Multiplayer ELO via averaged pairwise expectation. Each player is compared to
 * every other signed-in player; a better room-rank counts as a win, worse as a
 * loss, equal as a draw. The summed delta is normalised by (n-1) so a single
 * match can only move a rating by about ±K.
 */
function computeEloDeltas(ratings: number[], ranks: number[]): number[] {
  const n = ratings.length;
  return ratings.map((ri, i) => {
    const rankI = ranks[i] ?? 0;
    let delta = 0;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const rj = ratings[j] ?? 1000;
      const rankJ = ranks[j] ?? 0;
      const actual = rankI < rankJ ? 1 : rankI > rankJ ? 0 : 0.5;
      const expected = 1 / (1 + 10 ** ((rj - ri) / 400));
      delta += actual - expected;
    }
    return Math.round((ELO_K * delta) / (n - 1));
  });
}

function dedupeParticipants(participants: readonly RankedParticipant[]): RankedParticipant[] {
  const byUser = new Map<string, RankedParticipant>();
  for (const participant of participants) {
    // Keep the best (lowest) rank if a user somehow appears twice.
    const existing = byUser.get(participant.userId);
    if (!existing || participant.rank < existing.rank) byUser.set(participant.userId, participant);
  }
  return Array.from(byUser.values());
}

/**
 * Record a ranked (online public) match: compute ELO changes among the
 * signed-in participants, append an auditable match_results row per player, and
 * update player_stats. No-op unless at least two signed-in players took part.
 */
export async function recordRankedMatch(match: {
  roomId: string;
  gameMode: string;
  playersCount: number;
  participants: readonly RankedParticipant[];
}): Promise<void> {
  if (!supabaseAdmin) return;

  const participants = dedupeParticipants(match.participants);
  if (participants.length < 2) return;

  const ids = participants.map((participant) => participant.userId);

  const { data: statsRows, error } = await supabaseAdmin
    .from('player_stats')
    .select('user_id, elo_rating, games_played, wins')
    .in('user_id', ids);
  if (error) {
    console.warn('recordRankedMatch: failed to read stats', error.message);
    return;
  }

  const statsByUser = new Map<string, StatsRow>((statsRows ?? []).map((row) => [row.user_id, row as StatsRow]));
  const ratings = participants.map((participant) => statsByUser.get(participant.userId)?.elo_rating ?? 1000);
  const ranks = participants.map((participant) => participant.rank);
  const deltas = computeEloDeltas(ratings, ranks);

  const matchRows = participants.map((participant, index) => {
    const before = ratings[index] ?? 1000;
    const after = Math.max(ELO_FLOOR, before + (deltas[index] ?? 0));
    return {
      user_id: participant.userId,
      room_id: match.roomId,
      game_mode: match.gameMode,
      score: participant.score,
      rank: participant.rank,
      players: match.playersCount,
      elo_before: before,
      elo_after: after,
      elo_delta: after - before
    };
  });

  const statUpserts = participants.map((participant, index) => {
    const current = statsByUser.get(participant.userId);
    const before = ratings[index] ?? 1000;
    const after = Math.max(ELO_FLOOR, before + (deltas[index] ?? 0));
    return {
      user_id: participant.userId,
      elo_rating: after,
      games_played: (current?.games_played ?? 0) + 1,
      wins: (current?.wins ?? 0) + (participant.rank === 1 ? 1 : 0)
    };
  });

  const [{ error: matchError }, { error: statError }] = await Promise.all([
    supabaseAdmin.from('match_results').insert(matchRows),
    supabaseAdmin.from('player_stats').upsert(statUpserts, { onConflict: 'user_id' })
  ]);
  if (matchError) console.warn('recordRankedMatch: failed to insert match rows', matchError.message);
  if (statError) console.warn('recordRankedMatch: failed to update stats', statError.message);
}

/**
 * Record a completed daily run and advance the streak. Idempotent per day: the
 * first run of a given day advances/continues the streak; later runs the same
 * day only refresh the stored words/score, never the streak.
 */
export async function recordDailyPlay(play: {
  userId: string;
  day: number;
  wordsCount: number;
  score: number;
}): Promise<void> {
  if (!supabaseAdmin) return;

  const { data: existing } = await supabaseAdmin
    .from('daily_results')
    .select('day')
    .eq('user_id', play.userId)
    .eq('day', play.day)
    .maybeSingle();

  const { error: upsertError } = await supabaseAdmin
    .from('daily_results')
    .upsert(
      { user_id: play.userId, day: play.day, words_count: play.wordsCount, score: play.score },
      { onConflict: 'user_id,day' }
    );
  if (upsertError) {
    console.warn('recordDailyPlay: failed to upsert daily result', upsertError.message);
    return;
  }

  // Streak only advances on the first counted run of the day.
  if (existing) return;

  const { data: stats } = await supabaseAdmin
    .from('player_stats')
    .select('current_streak, longest_streak, last_daily_day')
    .eq('user_id', play.userId)
    .maybeSingle();

  const lastDay = stats?.last_daily_day ?? null;
  if (lastDay === play.day) return;

  const nextStreak = lastDay === play.day - 1 ? (stats?.current_streak ?? 0) + 1 : 1;
  const longest = Math.max(stats?.longest_streak ?? 0, nextStreak);

  const { error: streakError } = await supabaseAdmin
    .from('player_stats')
    .update({ current_streak: nextStreak, longest_streak: longest, last_daily_day: play.day })
    .eq('user_id', play.userId);
  if (streakError) console.warn('recordDailyPlay: failed to update streak', streakError.message);
}
