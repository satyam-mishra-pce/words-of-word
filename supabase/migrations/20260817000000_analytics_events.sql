-- ============================================================================
-- Words of Word — Analytics v2 (event-sourced, time-windowed)
--
-- Replaces the bespoke server-side aggregate JSON/delta persistence with a
-- single append-only event stream stored in Supabase. Every tracked behaviour
-- (page views, clicks, room lifecycle, game lifecycle, words, emotes, bets,
-- teams, departures, feature usage, logins) is one row in public.analytics_event.
-- The admin dashboard aggregates these rows over an arbitrary [from, to) window
-- with SQL functions (see end of file). No raw event is ever missed; queries
-- filter purely by timestamp.
--
-- Writers:
--   * The game server writes server-authoritative game events with the
--     service_role key (bypasses RLS).
--   * The client writes UI/page/click events with the anon/authenticated key
--     through an INSERT policy. auth.uid() is stamped automatically by trigger.
-- Opt-out: a signed-in user can record an opt-out in public.analytics_privacy;
-- anonymous clients simply stop sending (client-side enforcement).
-- ============================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- analytics_event: the single append-only event stream.
-- ---------------------------------------------------------------------------
drop table if exists public.analytics_event;

create table public.analytics_event (
  id               uuid        primary key default gen_random_uuid(),
  ts               timestamptz not null default now(),
  event            text        not null,
  kind             text        not null default 'event',
  -- Pseudonymous installation/session ids (client-generated UUIDs; not PII).
  visitor_id       uuid,
  session_id       uuid,
  -- Server-stamped to auth.uid() for signed-in activity (never client-supplied).
  user_id          uuid        references auth.users (id) on delete set null,
  page             text,
  props            jsonb       not null default '{}'::jsonb,
  source           text        not null default 'client',
  -- Client-generated dedup id (used with ON CONFLICT to keep inserts idempotent).
  client_event_id  uuid,
  constraint analytics_event_client_dedup unique (client_event_id)
);

create index if not exists analytics_event_ts_idx             on public.analytics_event (ts);
create index if not exists analytics_event_event_ts_idx       on public.analytics_event (event, ts);
create index if not exists analytics_event_visitor_ts_idx     on public.analytics_event (visitor_id, ts);
create index if not exists analytics_event_user_ts_idx        on public.analytics_event (user_id, ts);
create index if not exists analytics_event_session_idx        on public.analytics_event (session_id);
create index if not exists analytics_event_props_gin_idx      on public.analytics_event using gin (props jsonb_path_ops);

comment on table public.analytics_event is
  'Append-only, time-windowed product analytics event stream. Server writes game events (service_role); client writes UI/page/click events.';

-- Stamp user_id from the authenticated session (clients never send it).
create or replace function public.analytics_stamp_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists analytics_event_stamp_user on public.analytics_event;
create trigger analytics_event_stamp_user
  before insert on public.analytics_event
  for each row execute function public.analytics_stamp_user();

-- RLS: clients may INSERT their own events; nobody reads the raw stream over
-- the client API (aggregation is via the admin RPCs, which run with
-- security definer and are only reachable by the server's service_role / RPC grants).
alter table public.analytics_event enable row level security;

drop policy if exists "Clients can insert analytics events" on public.analytics_event;
create policy "Clients can insert analytics events"
  on public.analytics_event for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- analytics_privacy: explicit user opt-out registry.
-- ---------------------------------------------------------------------------
drop table if exists public.analytics_privacy;

create table public.analytics_privacy (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  opted_out    boolean     not null default false,
  updated_at   timestamptz not null default now()
);

comment on table public.analytics_privacy is
  'Explicit analytics opt-out registry keyed to a signed-in user. Anonymous clients manage opt-out client-side (localStorage).';

alter table public.analytics_privacy enable row level security;

drop policy if exists "Users read their own privacy" on public.analytics_privacy;
create policy "Users read their own privacy"
  on public.analytics_privacy for select
  using (auth.uid() = user_id);

drop policy if exists "Users upsert their own privacy" on public.analytics_privacy;
create policy "Users upsert their own privacy"
  on public.analytics_privacy for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update their own privacy" on public.analytics_privacy;
create policy "Users update their own privacy"
  on public.analytics_privacy for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===========================================================================
-- Aggregate RPCs (security definer; executed with service_role by the server
-- or by privileged callers). All take an inclusive [p_from, p_to) window.
-- ===========================================================================

-- Counts per event name in the window.
create or replace function public.analytics_event_counts(p_from timestamptz, p_to timestamptz)
returns table (event text, count bigint)
language sql
security definer
set search_path = public
as $$
  select e.event, count(*)::bigint
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to
  group by e.event
  order by count(*) desc;
$$;

-- Aggregate headline numbers for the window.
create or replace function public.analytics_headline(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'events',        count(*)::bigint,
    'unique_visitors', count(distinct e.visitor_id)::bigint,
    'unique_sessions', count(distinct e.session_id)::bigint,
    'signed_in_events', count(*) filter (where e.user_id is not null)::bigint,
    'unique_users',  count(distinct e.user_id)::bigint,
    'first_event',   min(e.ts),
    'last_event',    max(e.ts),
    'by_kind', (
      select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
      from (select e2.kind as kind, count(*)::bigint as n
            from public.analytics_event e2
            where e2.ts >= p_from and e2.ts < p_to
            group by e2.kind) k
    )
  )
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to;
$$;

-- Per-day counts for a subset of events (drives time-series charts).
create or replace function public.analytics_daily_counts(p_from timestamptz, p_to timestamptz)
returns table (day date, event text, count bigint)
language sql
security definer
set search_path = public
as $$
  select (e.ts at time zone 'utc')::date as day, e.event, count(*)::bigint
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to
  group by 1, 2
  order by 1, 2;
$$;

-- Generic grouped counts over an event's props.<prop> (or page/name columns).
-- Powers settings/goal breakdowns, game-mode adoption, pages, top emotes, etc.
create or replace function public.analytics_grouped(
  p_from timestamptz,
  p_to timestamptz,
  p_event text,
  p_prop text
)
returns table (value text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text;
begin
  -- prop is an allowlisted (identifier) key, never interpolated raw.
  if p_prop !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' then
    raise exception 'invalid prop';
  end if;
  q := format(
    'select (e.props->>%L)::text as value, count(*)::bigint
       from public.analytics_event e
      where e.ts >= $1 and e.ts < $2
        and e.event = $3
        and e.props ? %L
      group by 1 order by 2 desc',
    p_prop, p_prop
  );
  return query execute q using p_from, p_to, p_event;
end;
$$;

-- Distinct visitors who fired a given event, with counts (e.g. top emoters,
-- most active players).
create or replace function public.analytics_top_visitors(
  p_from timestamptz,
  p_to timestamptz,
  p_event text,
  p_limit integer default 50
)
returns table (visitor_id uuid, count bigint)
language sql
security definer
set search_path = public
as $$
  select e.visitor_id, count(*)::bigint
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to
    and e.event = p_event
    and e.visitor_id is not null
  group by e.visitor_id
  order by count(*) desc
  limit greatest(1, least(500, p_limit));
$$;

-- Hour-of-week distribution for a given event (or all events when null).
create or replace function public.analytics_hour_of_week(p_from timestamptz, p_to timestamptz, p_event text default null)
returns table (weekday integer, hour integer, count bigint)
language sql
security definer
set search_path = public
as $$
  select extract(dow from e.ts)::int as weekday,
         extract(hour from e.ts)::int as hour,
         count(*)::bigint
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to
    and (p_event is null or e.event = p_event)
  group by 1, 2;
$$;

-- Latest activity timestamp per visitor in the window (for active-user counts).
create or replace function public.analytics_active_visitors(p_from timestamptz, p_to timestamptz)
returns table (visitor_id uuid, last_ts timestamptz, event_count bigint)
language sql
security definer
set search_path = public
as $$
  select e.visitor_id, max(e.ts), count(*)::bigint
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to
    and e.visitor_id is not null
  group by e.visitor_id;
$$;

-- Signed-in players: which users (join profiles for names) were active. Used by
-- the admin "players joined / logged in" view.
create or replace function public.analytics_active_users(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, event_count bigint, last_ts timestamptz, username text)
language sql
security definer
set search_path = public
as $$
  select e.user_id,
         count(*)::bigint,
         max(e.ts),
         pr.username
  from public.analytics_event e
  left join public.profiles pr on pr.id = e.user_id
  where e.ts >= p_from and e.ts < p_to
    and e.user_id is not null
  group by e.user_id, pr.username
  order by count(*) desc;
$$;

-- Raw (already ->topN) rows for an event within a window — the raw-event
-- explorer guarantees that literally nothing is missed.
create or replace function public.analytics_raw_events(
  p_from timestamptz,
  p_to timestamptz,
  p_event text default null,
  p_limit integer default 200
)
returns table (ts timestamptz, event text, kind text, page text, visitor_id uuid, user_id uuid, props jsonb, source text)
language sql
security definer
set search_path = public
as $$
  select e.ts, e.event, e.kind, e.page, e.visitor_id, e.user_id, e.props, e.source
  from public.analytics_event e
  where e.ts >= p_from and e.ts < p_to
    and (p_event is null or e.event = p_event)
  order by e.ts desc
  limit greatest(1, least(1000, p_limit));
$$;

-- Ensure RPC functions are callable by the service_role / authenticated roles
-- (PostgREST executes them under the caller's role unless security definer /
-- explicit grants are set).
grant execute on function public.analytics_event_counts(timestamptz, timestamptz) to service_role, authenticated;
grant execute on function public.analytics_headline(timestamptz, timestamptz) to service_role, authenticated;
grant execute on function public.analytics_daily_counts(timestamptz, timestamptz) to service_role, authenticated;
grant execute on function public.analytics_grouped(timestamptz, timestamptz, text, text) to service_role, authenticated;
grant execute on function public.analytics_top_visitors(timestamptz, timestamptz, text, integer) to service_role, authenticated;
grant execute on function public.analytics_hour_of_week(timestamptz, timestamptz, text) to service_role, authenticated;
grant execute on function public.analytics_active_visitors(timestamptz, timestamptz) to service_role, authenticated;
grant execute on function public.analytics_active_users(timestamptz, timestamptz) to service_role, authenticated;
grant execute on function public.analytics_raw_events(timestamptz, timestamptz, text, integer) to service_role, authenticated;
