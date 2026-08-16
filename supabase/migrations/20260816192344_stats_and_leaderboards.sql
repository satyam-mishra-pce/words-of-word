-- Streak, ELO rating, and leaderboards.
--
-- Trust model (product decision): these are competitive stats, so they are
-- SERVER-AUTHORITATIVE. The game server writes them with the service_role key
-- (which bypasses RLS). Clients get READ-ONLY access to their own rows via RLS,
-- and everyone can read the public leaderboard VIEWS (username/avatar/elo/streak
-- only — never emails). No client can write a rating or a streak.

-- ---------------------------------------------------------------------------
-- player_stats: one server-owned row per user (mirrors profiles 1:1).
-- ---------------------------------------------------------------------------
create table if not exists public.player_stats (
  user_id         uuid        primary key references auth.users (id) on delete cascade,
  elo_rating      integer     not null default 1000,
  games_played    integer     not null default 0,
  wins            integer     not null default 0,
  current_streak  integer     not null default 0,
  longest_streak  integer     not null default 0,
  -- Day number (floor(epoch_ms / 86_400_000)) of the last counted daily run.
  last_daily_day  bigint,
  updated_at      timestamptz not null default now()
);

comment on table public.player_stats is
  'Server-authoritative competitive stats (ELO, streak, wins). Written only via service_role; clients read own row.';

drop trigger if exists player_stats_set_updated_at on public.player_stats;
create trigger player_stats_set_updated_at
  before update on public.player_stats
  for each row execute function public.set_updated_at();

alter table public.player_stats enable row level security;

-- Read-only for the owner. Deliberately NO insert/update/delete policies, so
-- authenticated clients can never mutate their own rating/streak.
drop policy if exists "Players can read their own stats" on public.player_stats;
create policy "Players can read their own stats"
  on public.player_stats for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- match_results: append-only audit of ranked (online public) matches.
-- Powers the weekly window and makes ELO changes explainable.
-- ---------------------------------------------------------------------------
create table if not exists public.match_results (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  room_id     text        not null,
  game_mode   text        not null default 'classic',
  score       integer     not null default 0,
  rank        integer     not null default 0,
  players     integer     not null default 0,
  elo_before  integer     not null default 1000,
  elo_after   integer     not null default 1000,
  elo_delta   integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists match_results_user_idx on public.match_results (user_id);
create index if not exists match_results_created_idx on public.match_results (created_at);

alter table public.match_results enable row level security;

drop policy if exists "Players can read their own match history" on public.match_results;
create policy "Players can read their own match history"
  on public.match_results for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- daily_results: one row per (user, day). Idempotent per day; powers streaks
-- and the weekly window.
-- ---------------------------------------------------------------------------
create table if not exists public.daily_results (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  day          bigint      not null,
  words_count  integer     not null default 0,
  score        integer     not null default 0,
  created_at   timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists daily_results_created_idx on public.daily_results (created_at);

alter table public.daily_results enable row level security;

drop policy if exists "Players can read their own daily runs" on public.daily_results;
create policy "Players can read their own daily runs"
  on public.daily_results for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-provision player_stats alongside the profile on signup, and backfill
-- rows for any users that already exist.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  seed_name text;
begin
  seed_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, ''), '@', 1),
    ''
  );

  insert into public.profiles (id, username)
  values (new.id, left(seed_name, 20))
  on conflict (id) do nothing;

  insert into public.player_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

insert into public.player_stats (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Public leaderboard VIEWS. Owned by postgres (which owns the tables), so they
-- bypass RLS and can rank ALL players, while exposing only safe public columns.
-- security_invoker stays OFF (default) on purpose.
-- ---------------------------------------------------------------------------
create or replace view public.leaderboard_global as
select
  row_number() over (order by ps.elo_rating desc, ps.wins desc, pr.username asc) as rank,
  pr.id            as user_id,
  pr.username,
  pr.avatar,
  ps.elo_rating,
  ps.games_played,
  ps.wins,
  ps.current_streak,
  ps.longest_streak
from public.player_stats ps
join public.profiles pr on pr.id = ps.user_id
where ps.games_played > 0;

comment on view public.leaderboard_global is 'Public all-time leaderboard ranked by ELO. Safe columns only.';

create or replace view public.leaderboard_weekly as
with weekly_points as (
  select user_id, sum(score) as pts
  from public.match_results
  where created_at >= now() - interval '7 days'
  group by user_id
  union all
  select user_id, sum(score) as pts
  from public.daily_results
  where created_at >= now() - interval '7 days'
  group by user_id
),
totals as (
  select user_id, sum(pts)::int as weekly_points
  from weekly_points
  group by user_id
)
select
  row_number() over (order by t.weekly_points desc, pr.username asc) as rank,
  pr.id           as user_id,
  pr.username,
  pr.avatar,
  t.weekly_points,
  ps.elo_rating,
  ps.current_streak
from totals t
join public.profiles pr on pr.id = t.user_id
join public.player_stats ps on ps.user_id = t.user_id
where t.weekly_points > 0;

comment on view public.leaderboard_weekly is 'Public rolling-7-day leaderboard by points earned (matches + daily). Safe columns only.';

-- Anyone (signed in or not) may read the leaderboards.
grant select on public.leaderboard_global to anon, authenticated;
grant select on public.leaderboard_weekly to anon, authenticated;
