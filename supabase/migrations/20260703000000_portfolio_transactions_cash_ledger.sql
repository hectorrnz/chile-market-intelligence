-- Phase 6D — Transaction History and Cash Ledger Foundation
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- Adds a transaction ledger (buy/sell) and a cash ledger (deposit/withdrawal/
-- fee/tax/adjustment/trade cash flows) so positions can eventually be derived
-- from real lots instead of a manually entered quantity + average cost.
--
-- Compatibility with portfolio_positions (Phase 6C):
--   portfolio_positions remains the current-state table — unchanged schema.
--   No new columns are added to it. Instead this phase reuses its existing
--   `metadata jsonb` column to record provenance:
--     metadata.positionSource   = 'manual' | 'transactions'
--     metadata.lastReconciledAt = ISO timestamp of the last rebuild
--   This was chosen over an ALTER TABLE + new columns because it is one JSON
--   field, queried rarely (only when rendering the position row), and keeps
--   this migration additive-only — no changes to an existing table's shape.
--   A manually-entered position (no metadata.positionSource, or 'manual')
--   is left untouched by the transaction flow; the repository blocks adding
--   the first transaction for a ticker that already has such a manual
--   position, rather than silently overwriting it (see portfolioTransactionRepository.ts).

-- ── portfolio_transactions ──────────────────────────────────────────────────────
create table if not exists portfolio_transactions (
  id                uuid primary key default gen_random_uuid(),
  portfolio_id      uuid not null references portfolios(id) on delete cascade,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker            text not null references companies(ticker) on delete restrict,
  transaction_type  text not null,
  trade_date        date not null,
  settlement_date   date,
  quantity          numeric not null,
  price             numeric not null,
  gross_amount      numeric,
  fees              numeric not null default 0,
  taxes             numeric not null default 0,
  net_amount        numeric,
  currency          text not null default 'CLP',
  realized_pnl      numeric,
  notes             text,
  tags              text[] not null default '{}',
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint portfolio_transactions_type_check check (transaction_type in ('buy', 'sell')),
  constraint portfolio_transactions_quantity_check check (quantity > 0),
  constraint portfolio_transactions_price_check check (price >= 0),
  constraint portfolio_transactions_fees_check check (fees >= 0),
  constraint portfolio_transactions_taxes_check check (taxes >= 0)
);

-- ── portfolio_cash_ledger ────────────────────────────────────────────────────────
create table if not exists portfolio_cash_ledger (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references portfolios(id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid references portfolio_transactions(id) on delete set null,
  ledger_date    date not null,
  currency       text not null default 'CLP',
  entry_type     text not null,
  amount         numeric not null,
  description    text,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  constraint portfolio_cash_ledger_entry_type_check
    check (entry_type in ('deposit', 'withdrawal', 'buy_cash_outflow', 'sell_cash_inflow', 'fee', 'tax', 'adjustment'))
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────
create index if not exists portfolio_transactions_user_id_idx      on portfolio_transactions (user_id);
create index if not exists portfolio_transactions_portfolio_idx    on portfolio_transactions (portfolio_id);
create index if not exists portfolio_transactions_portfolio_ticker_idx on portfolio_transactions (portfolio_id, ticker);
create index if not exists portfolio_transactions_trade_date_idx   on portfolio_transactions (portfolio_id, trade_date desc);

create index if not exists portfolio_cash_ledger_user_id_idx       on portfolio_cash_ledger (user_id);
create index if not exists portfolio_cash_ledger_portfolio_idx     on portfolio_cash_ledger (portfolio_id);
create index if not exists portfolio_cash_ledger_date_idx          on portfolio_cash_ledger (portfolio_id, ledger_date desc);
create index if not exists portfolio_cash_ledger_transaction_idx   on portfolio_cash_ledger (transaction_id);

-- ── updated_at trigger (reuses set_updated_at() from the 6A migration) ───────────
drop trigger if exists set_portfolio_transactions_updated_at on portfolio_transactions;
create trigger set_portfolio_transactions_updated_at
  before update on portfolio_transactions
  for each row execute function set_updated_at();

-- portfolio_cash_ledger has no updated_at column — ledger entries are
-- append-only/correctable via new adjustment entries, not edited in place.

-- ── Cross-table ownership guard ──────────────────────────────────────────────────
-- RLS alone only checks auth.uid() = user_id on the ROW being written; it does
-- not stop a caller from pointing portfolio_id at a portfolio owned by someone
-- else while setting user_id to their own uid. This trigger closes that gap by
-- verifying the referenced portfolio actually belongs to the same user_id.
create or replace function check_portfolio_ownership()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from portfolios
    where id = new.portfolio_id and user_id = new.user_id
  ) then
    raise exception 'portfolio_id does not belong to user_id';
  end if;
  return new;
end;
$$;

drop trigger if exists check_portfolio_transactions_ownership on portfolio_transactions;
create trigger check_portfolio_transactions_ownership
  before insert or update on portfolio_transactions
  for each row execute function check_portfolio_ownership();

drop trigger if exists check_portfolio_cash_ledger_ownership on portfolio_cash_ledger;
create trigger check_portfolio_cash_ledger_ownership
  before insert or update on portfolio_cash_ledger
  for each row execute function check_portfolio_ownership();

-- ── RLS ─────────────────────────────────────────────────────────────────────────
alter table portfolio_transactions enable row level security;
alter table portfolio_cash_ledger  enable row level security;

do $$ begin
  drop policy if exists "users_own_transactions_select" on portfolio_transactions;
  drop policy if exists "users_own_transactions_insert" on portfolio_transactions;
  drop policy if exists "users_own_transactions_update" on portfolio_transactions;
  drop policy if exists "users_own_transactions_delete" on portfolio_transactions;

  drop policy if exists "users_own_cash_ledger_select" on portfolio_cash_ledger;
  drop policy if exists "users_own_cash_ledger_insert" on portfolio_cash_ledger;
  drop policy if exists "users_own_cash_ledger_update" on portfolio_cash_ledger;
  drop policy if exists "users_own_cash_ledger_delete" on portfolio_cash_ledger;
end $$;

-- portfolio_transactions: strictly own-row only, no public read/write
create policy "users_own_transactions_select" on portfolio_transactions
  for select using (auth.uid() = user_id);

create policy "users_own_transactions_insert" on portfolio_transactions
  for insert with check (auth.uid() = user_id);

create policy "users_own_transactions_update" on portfolio_transactions
  for update using (auth.uid() = user_id);

create policy "users_own_transactions_delete" on portfolio_transactions
  for delete using (auth.uid() = user_id);

-- portfolio_cash_ledger: strictly own-row only, no public read/write
create policy "users_own_cash_ledger_select" on portfolio_cash_ledger
  for select using (auth.uid() = user_id);

create policy "users_own_cash_ledger_insert" on portfolio_cash_ledger
  for insert with check (auth.uid() = user_id);

create policy "users_own_cash_ledger_update" on portfolio_cash_ledger
  for update using (auth.uid() = user_id);

create policy "users_own_cash_ledger_delete" on portfolio_cash_ledger
  for delete using (auth.uid() = user_id);
