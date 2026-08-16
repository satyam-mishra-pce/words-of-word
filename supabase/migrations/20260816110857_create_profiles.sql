-- Player profiles that link a Google account to a Words of Word identity.
--
-- Scope (per AGENTS/product decision): profile only — username + avatar. The
-- game server stays anonymous; this table exists purely so a signed-in player's
-- name and pixel character follow them across devices. Anonymous play is
-- unaffected and never touches this table.

create table if not exists public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  username    text        not null default '' check (char_length(username) <= 20),
  -- Mirrors @wow/shared PlayerAvatarSchema (a compact Pipoya recipe, not an image).
  avatar      jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Signed-in player profile (username + avatar recipe) keyed to auth.users. Profile-only sync; game server remains anonymous.';

-- Keep updated_at honest on every write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Row Level Security: a user may only see and mutate their own profile row.
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-provision a profile row the moment a Google user first signs up, seeding
-- the username from the Google display name / email local-part when available.
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
