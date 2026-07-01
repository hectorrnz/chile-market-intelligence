-- Phase 6A — Auth and Watchlist Foundation
-- Apply via Supabase Dashboard → SQL Editor.
-- Idempotent: all DDL uses IF NOT EXISTS / OR REPLACE patterns.

-- ── user_profiles ───────────────────────────────────────────────────────────────
create table if not exists user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'user',
  preferences  jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── watchlists ──────────────────────────────────────────────────────────────────
create table if not exists watchlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── watchlist_items ─────────────────────────────────────────────────────────────
create table if not exists watchlist_items (
  id            uuid primary key default gen_random_uuid(),
  watchlist_id  uuid not null references watchlists(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  ticker        text not null,
  notes         text,
  tags          text[] not null default '{}',
  added_at      timestamptz not null default now(),
  metadata      jsonb not null default '{}',
  unique (watchlist_id, ticker)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────
create index if not exists user_profiles_id_idx            on user_profiles (id);
create index if not exists watchlists_user_id_idx          on watchlists (user_id);
create index if not exists watchlists_user_default_idx     on watchlists (user_id, is_default);
create index if not exists watchlist_items_user_id_idx     on watchlist_items (user_id);
create index if not exists watchlist_items_watchlist_idx   on watchlist_items (watchlist_id);
create index if not exists watchlist_items_ticker_idx      on watchlist_items (ticker);

-- ── updated_at trigger function (reuse if already present) ──────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_user_profiles_updated_at on user_profiles;
create trigger set_user_profiles_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

drop trigger if exists set_watchlists_updated_at on watchlists;
create trigger set_watchlists_updated_at
  before update on watchlists
  for each row execute function set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────────
alter table user_profiles  enable row level security;
alter table watchlists     enable row level security;
alter table watchlist_items enable row level security;

-- Drop then recreate policies idempotently
do $$ begin

  -- user_profiles
  drop policy if exists "users_own_profile_select" on user_profiles;
  drop policy if exists "users_own_profile_insert" on user_profiles;
  drop policy if exists "users_own_profile_update" on user_profiles;

  -- watchlists
  drop policy if exists "users_own_watchlists_select" on watchlists;
  drop policy if exists "users_own_watchlists_insert" on watchlists;
  drop policy if exists "users_own_watchlists_update" on watchlists;
  drop policy if exists "users_own_watchlists_delete" on watchlists;

  -- watchlist_items
  drop policy if exists "users_own_items_select" on watchlist_items;
  drop policy if exists "users_own_items_insert" on watchlist_items;
  drop policy if exists "users_own_items_update" on watchlist_items;
  drop policy if exists "users_own_items_delete" on watchlist_items;

end $$;

-- user_profiles
create policy "users_own_profile_select" on user_profiles
  for select using (auth.uid() = id);

create policy "users_own_profile_insert" on user_profiles
  for insert with check (auth.uid() = id);

create policy "users_own_profile_update" on user_profiles
  for update using (auth.uid() = id);

-- watchlists
create policy "users_own_watchlists_select" on watchlists
  for select using (auth.uid() = user_id);

create policy "users_own_watchlists_insert" on watchlists
  for insert with check (auth.uid() = user_id);

create policy "users_own_watchlists_update" on watchlists
  for update using (auth.uid() = user_id);

create policy "users_own_watchlists_delete" on watchlists
  for delete using (auth.uid() = user_id);

-- watchlist_items
create policy "users_own_items_select" on watchlist_items
  for select using (auth.uid() = user_id);

create policy "users_own_items_insert" on watchlist_items
  for insert with check (auth.uid() = user_id);

create policy "users_own_items_update" on watchlist_items
  for update using (auth.uid() = user_id);

create policy "users_own_items_delete" on watchlist_items
  for delete using (auth.uid() = user_id);
