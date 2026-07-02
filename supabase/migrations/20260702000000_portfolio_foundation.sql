-- Phase 6C — Portfolio Positions Foundation
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- Adds user-scoped portfolios + positions. No transaction history yet —
-- average_cost is stored directly on the position (Phase 6D adds a ledger).

-- ── portfolios ──────────────────────────────────────────────────────────────────
create table if not exists portfolios (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  base_currency text not null default 'CLP',
  is_default    boolean not null default false,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── portfolio_positions ─────────────────────────────────────────────────────────
create table if not exists portfolio_positions (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references portfolios(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker        text not null references companies(ticker) on delete restrict,
  quantity      numeric not null,
  average_cost  numeric,
  cost_currency text not null default 'CLP',
  opened_at     date,
  notes         text,
  tags          text[] not null default '{}',
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (portfolio_id, ticker)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────
create index if not exists portfolios_user_id_idx             on portfolios (user_id);
create index if not exists portfolios_user_default_idx        on portfolios (user_id, is_default);
create index if not exists portfolio_positions_user_id_idx    on portfolio_positions (user_id);
create index if not exists portfolio_positions_portfolio_idx  on portfolio_positions (portfolio_id);
create index if not exists portfolio_positions_ticker_idx     on portfolio_positions (ticker);

-- ── updated_at triggers (reuses set_updated_at() from the 6A migration) ─────────
drop trigger if exists set_portfolios_updated_at on portfolios;
create trigger set_portfolios_updated_at
  before update on portfolios
  for each row execute function set_updated_at();

drop trigger if exists set_portfolio_positions_updated_at on portfolio_positions;
create trigger set_portfolio_positions_updated_at
  before update on portfolio_positions
  for each row execute function set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────────
alter table portfolios          enable row level security;
alter table portfolio_positions enable row level security;

do $$ begin
  drop policy if exists "users_own_portfolios_select" on portfolios;
  drop policy if exists "users_own_portfolios_insert" on portfolios;
  drop policy if exists "users_own_portfolios_update" on portfolios;
  drop policy if exists "users_own_portfolios_delete" on portfolios;

  drop policy if exists "users_own_positions_select" on portfolio_positions;
  drop policy if exists "users_own_positions_insert" on portfolio_positions;
  drop policy if exists "users_own_positions_update" on portfolio_positions;
  drop policy if exists "users_own_positions_delete" on portfolio_positions;
end $$;

-- portfolios: strictly own-row only, no public read/write
create policy "users_own_portfolios_select" on portfolios
  for select using (auth.uid() = user_id);

create policy "users_own_portfolios_insert" on portfolios
  for insert with check (auth.uid() = user_id);

create policy "users_own_portfolios_update" on portfolios
  for update using (auth.uid() = user_id);

create policy "users_own_portfolios_delete" on portfolios
  for delete using (auth.uid() = user_id);

-- portfolio_positions: strictly own-row only, no public read/write
create policy "users_own_positions_select" on portfolio_positions
  for select using (auth.uid() = user_id);

create policy "users_own_positions_insert" on portfolio_positions
  for insert with check (auth.uid() = user_id);

create policy "users_own_positions_update" on portfolio_positions
  for update using (auth.uid() = user_id);

create policy "users_own_positions_delete" on portfolio_positions
  for delete using (auth.uid() = user_id);
