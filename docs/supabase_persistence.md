# Supabase Persistence — Phase 5B

This document describes the database layer added in Phase 5B. No production behavior changed — the app continues to run on static data until `DB_MODE` is set.

---

## Architecture Overview

```
UI / Pages
    ↓
src/lib/data/*   (existing, static-first, unchanged)
    ↓
src/lib/db/repositories/*   (NEW — repository layer, static or Supabase)
    ↓
src/lib/supabase/*          (NEW — Supabase client utilities, server-only except client.ts)
    ↓
Supabase Postgres           (only when DB_MODE=supabase or hybrid)
```

The repository layer sits between the existing data helpers and Supabase. In Phase 5B it is not yet wired into the UI — that happens in Phase 5B.1 when credentials are available.

---

## DB Mode (`DB_MODE` env var)

| Value | Behaviour |
|-------|-----------|
| `static` (default) | All repositories return static JSON data. Supabase is never called. |
| `supabase` | Repositories call Supabase. If the call fails, the error is returned (no silent fallback). |
| `hybrid` | Repositories call Supabase and fall back to static data on error/timeout. |

Set in `.env.local`:
```
DB_MODE=static
```

---

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | When DB_MODE ≠ static | Project API URL from Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | When DB_MODE ≠ static | `anon` key — safe to expose to browser |
| `SUPABASE_SERVICE_ROLE_KEY` | For admin/ingestion | **Server-only** — bypasses RLS |
| `SUPABASE_DATABASE_URL` | For `psql` seed/migration | `postgresql://...` connection string |
| `DB_MODE` | No (defaults to `static`) | `static` \| `supabase` \| `hybrid` |

`NEXT_PUBLIC_SUPABASE_SECRET_KEY` is not used — the naming follows Supabase's 2025 `publishableKey`/`secretKey` convention.

---

## Database Schema

Migration file: [`supabase/migrations/20260625000000_create_market_intelligence_core.sql`](../supabase/migrations/20260625000000_create_market_intelligence_core.sql)

### Tables

| Table | Description |
|-------|-------------|
| `data_sources` | Registry of upstream providers (BCCh, CMF, Brain Data, static) |
| `companies` | Chilean listed companies, mirrors `companies.json` |
| `macro_indicators` | Macro series definitions, mirrors `macroSeries.ts` ids |
| `macro_observations` | Timestamped macro values from BCCh or static |
| `stock_snapshots` | Latest price/change snapshot per ticker |
| `stock_ohlcv` | OHLCV bars (daily, weekly) per ticker |
| `index_snapshots` | Index levels and day/YTD changes |
| `sector_performance` | Sector heat-map data |
| `cmf_filings` | CMF Hechos Esenciales parsed from live or static |
| `documents` | Document registry (HE PDFs, earnings releases) |
| `ingestion_runs` | Audit log of provider ingestion runs |

All tables have RLS enabled with an anon-read policy. No public write policies exist until Phase 6 auth.

### User-scoped tables (Phase 6A, 6C, 6D)

Migration files: [`20260701000000_auth_watchlist_foundation.sql`](../supabase/migrations/20260701000000_auth_watchlist_foundation.sql), [`20260702000000_portfolio_foundation.sql`](../supabase/migrations/20260702000000_portfolio_foundation.sql), [`20260703000000_portfolio_transactions_cash_ledger.sql`](../supabase/migrations/20260703000000_portfolio_transactions_cash_ledger.sql)

| Table | Description |
|-------|-------------|
| `user_profiles` | Mirrors `auth.users`; username, display name, recovery email |
| `watchlists` | One or more per user; `is_default` flag |
| `watchlist_items` | Ticker + notes; unique per `(watchlist_id, ticker)` |
| `portfolios` | One or more per user; `base_currency` (CLP), `is_default` flag |
| `portfolio_positions` | **Current-state table.** Ticker + quantity + average_cost + cost_currency; unique per `(portfolio_id, ticker)`; `ticker` FKs to `companies(ticker)`. Its existing `metadata jsonb` column additionally records `positionSource: 'manual' \| 'transactions'` and `lastReconciledAt` (Phase 6D — no schema change) |
| `portfolio_transactions` | **Phase 6D.** One row per buy/sell lot: ticker, `transaction_type` (buy/sell), trade_date, quantity, price, fees, taxes, gross/net amount, `realized_pnl` (sells only) |
| `portfolio_cash_ledger` | **Phase 6D.** One row per cash movement: deposit, withdrawal, buy_cash_outflow, sell_cash_inflow, fee, tax, adjustment; `transaction_id` links buy/sell-generated entries back to their transaction |

Unlike the public tables above, these have **no anon-read policy**. Every policy is `auth.uid() = user_id` for select/insert/update/delete — a row is invisible and unwritable to anyone but its owner. `user_id` also defaults to `auth.uid()` at the column level (defense in depth: even if a caller omitted it, the DB fills in the correct value; RLS's `with check` then still rejects any explicit mismatched value). Repository code (`watchlistRepository.ts`, `portfolioRepository.ts`, `portfolioTransactionRepository.ts`) never sets `user_id` in an insert/update payload — ownership is established solely by the database, never trusted from the client.

**Cross-table ownership guard (Phase 6D):** RLS alone only checks `auth.uid() = user_id` on the row being written — it doesn't stop a caller from pointing `portfolio_id` at a portfolio owned by someone else while setting `user_id` to their own uid. A `before insert or update` trigger (`check_portfolio_ownership()`) on both `portfolio_transactions` and `portfolio_cash_ledger` closes that gap by verifying the referenced `portfolio_id` actually belongs to `user_id`, raising an exception otherwise.

Route handlers use `getSupabaseUserClient()` (cookie-aware, ties to the signed-in session), never the service-role admin client, so RLS is always enforced on these tables' public-facing read/write paths.

---

## Supabase Client Files

| File | Client type | Notes |
|------|-------------|-------|
| `src/lib/supabase/env.ts` | — | Pure env detection; no side effects |
| `src/lib/supabase/types.ts` | — | `SupabaseConfig`, `SupabaseAdminConfig` |
| `src/lib/supabase/database.types.ts` | — | Provisional manual types; replace with `npx supabase gen types` after linking |
| `src/lib/supabase/client.ts` | Browser (singleton) | `'use client'`; uses `NEXT_PUBLIC_*` vars only |
| `src/lib/supabase/server.ts` | Server | For route handlers + Server Components; no cookie management until Phase 6 |
| `src/lib/supabase/admin.ts` | Admin (server-only) | Uses `SUPABASE_SERVICE_ROLE_KEY`; bypasses RLS; ingestion scripts only |

---

## Repository Layer (`src/lib/db/`)

| File | Purpose |
|------|---------|
| `dbMode.ts` | `parseDbMode()`, `getDbMode()`, `decideDbSource()` |
| `types.ts` | `DbMode`, `DbResult<T>`, `DbListResult<T>`, `DbConfig` |
| `repositories/companiesRepository.ts` | `getCompanies()`, `getCompanyByTicker()` |
| `repositories/macroRepository.ts` | `getMacroIndicators()`, `getMacroHistory()` |
| `repositories/marketRepository.ts` | `getStockSnapshots()`, `getIndexSnapshots()`, `getSectorPerformance()` |
| `repositories/cmfRepository.ts` | `getCmfFilings()`, `getCmfFiling()` |
| `repositories/documentsRepository.ts` | `getDocuments()`, `getDocumentById()` |
| `repositories/ingestionRunsRepository.ts` | `getIngestionRuns()`, `createIngestionRun()` |

All repositories are **server-only** — never import from `'use client'` files.

---

## Scripts

```bash
# Check Supabase connectivity (needs NEXT_PUBLIC_* vars in .env.local)
npm run supabase:check

# Regenerate supabase/seed.sql from src/data/*.json
npm run supabase:generate-seed

# Apply migration to a linked project
npx supabase db push

# Or apply directly via psql
psql $SUPABASE_DATABASE_URL -f supabase/migrations/20260625000000_create_market_intelligence_core.sql

# Seed reference data
psql $SUPABASE_DATABASE_URL -f supabase/seed.sql
```

---

## Setup (Phase 5B.1)

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Copy the Project URL and anon key from **Settings → API**.
3. Copy the service-role key from **Settings → API → service_role**.
4. Copy the database password from **Settings → Database**.
5. Add to `.env.local`:
   ```
   DB_MODE=hybrid
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   SUPABASE_DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
   ```
6. Apply the migration: `psql $SUPABASE_DATABASE_URL -f supabase/migrations/20260625000000_create_market_intelligence_core.sql`
7. Seed reference data: `psql $SUPABASE_DATABASE_URL -f supabase/seed.sql`
8. Test: `npm run supabase:check`
9. Replace provisional DB types: `npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts`

---

## Portfolio Valuation (Phase 6C)

`src/lib/portfolio/valuation.ts` — pure functions, no I/O:

- `calculatePositionMarketValue` = `quantity × latestPrice` (from the latest deduplicated `stock_snapshots` row, via `getLatestStockSnapshots()` in `marketRepository.ts` — the same accumulated-snapshot table the company-page charts read from).
- `calculateCostBasis` = `quantity × averageCost`.
- `calculateUnrealizedPnL` = `marketValue − costBasis`; `calculateUnrealizedPnLPct` = `pnl / costBasis × 100`, guarded against a zero/null cost basis (returns `null`, never `Infinity`/`NaN`).
- `calculatePortfolioTotals` sums market value and cost basis across positions.
- `calculateSectorExposure` groups by each position's sector (from `companies.json`) and computes a weight.

**Limitations that still stand (Phase 6D adds transaction history, cash ledger, and realized P&L — see below; everything else is unchanged):**
- No FX conversion — `base_currency` is CLP and the covered universe is Chilean equities priced in CLP. If a position's `cost_currency` ever differs from the live price currency, it is flagged `mixedCurrency: true` in the UI instead of silently mixing amounts.
- No performance attribution (time-weighted/money-weighted returns) — this remains valuation + realized/unrealized P&L only.

---

## Transaction History and Cash Ledger (Phase 6D)

`src/lib/portfolio/transactions.ts` — pure functions, no I/O. `portfolio_positions` stays the **current-state table** (unchanged schema from 6C); `portfolio_transactions` becomes the source of truth for any ticker managed by lots, and each mutation **reconciles** `portfolio_positions` from the full replayed history rather than patching it incrementally.

**Average cost methodology — weighted average, no FIFO/LIFO:**
- A **buy** blends into the existing position: `newAverageCost = (existingQty × existingAvgCost + buyQty × buyPrice + fees + taxes) / (existingQty + buyQty)`. Fees and taxes are folded into the cost basis.
- A **sell** reduces quantity only — the average cost on the remaining shares is unaffected (this is what "weighted average" means in practice: there is only one cost basis per ticker, not per lot).
- There is no tax-lot selection (FIFO/LIFO/specific-lot) in this phase — every sell is priced against the single blended average cost.

**Realized P&L methodology:**
- `realizedPnl = (sellQty × sellPrice − fees − taxes) − (sellQty × averageCostAtTimeOfSale)`.
- A sell is rejected if `sellQty` exceeds the quantity derived from the transaction history up to that point (`insufficient_quantity`) — checked **before** any write, so an invalid history is never persisted.
- `rebuildPositionFromTransactions()` replays a ticker's full transaction list (sorted by `trade_date`) and returns both the final `{quantity, averageCost, realizedPnlTotal}` and a per-transaction `steps[]` array. This lets the repository recalculate and write back `realized_pnl` for every affected transaction after an edit or delete earlier in the history — not just the one row being changed.
- Editing or deleting a transaction re-validates the **entire resulting history** first (via the same replay) and rejects the change if it would leave a later sell oversold, rather than silently corrupting the ledger.

**Cash ledger:**
- Every buy/sell transaction automatically creates exactly one linked cash-ledger entry: `buy_cash_outflow` (negative, gross + fees + taxes) or `sell_cash_inflow` (positive, gross − fees − taxes). Fees/taxes are not split into their own ledger rows in this phase — they stay visible on the transaction record itself.
- Users can also add manual `deposit` / `withdrawal` / `adjustment` entries (`POST /api/portfolios/[id]/cash`). Deposit and withdrawal are entered as a plain positive magnitude and normalized to +/− internally; adjustment keeps whatever signed value is entered.
- `calculateCashBalance` sums all signed amounts; `calculatePortfolioCashSummary` breaks the total down by entry type for the Cash tab's summary cards.

**Manual-position compatibility (no silent conversion):** a ticker that already has a manually-entered `portfolio_positions` row (created via the 6C "Add position" flow, or any pre-6D row with no `metadata.positionSource`) is left completely alone by the transaction flow. Adding the **first** transaction for that ticker is blocked with `manual_position_conflict` — the user must remove the manual position first. Once a ticker has any transaction history, its position is `positionSource: 'transactions'` and the Positions-tab manual edit/remove controls are disabled for that row (the UI directs the user to the Transactions tab instead), preventing a manual edit from silently diverging from the reconciled state.

**Limitations (Phase 6D, explicit):**
- No FIFO/LIFO or specific-lot selection — weighted average only.
- No dividends.
- No time-weighted or money-weighted performance attribution.
- No broker/CSV import — transactions are entered manually one at a time.
- No automated cash reconciliation against a real brokerage statement.
- Multi-step writes (transaction insert → cash-ledger insert → position reconcile) are sequential, not wrapped in a single DB transaction — the Supabase JS client does not expose multi-statement transactions. Pre-validation before every write (checked via the same replay logic used to reconcile) keeps the ledger internally consistent in practice, but a mid-sequence failure (e.g. a dropped connection) could in principle leave a transaction row without its cash-ledger entry. Acceptable for this foundation phase; a Postgres RPC would remove the gap if needed later.

---

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — never expose to the browser or log it.
- `NEXT_PUBLIC_*` vars are bundled into the client; they are safe because RLS restricts what the anon key can do.
- Supabase is not a dependency for local dev, build, or Vercel deploy — all fallback to static when vars are absent.

---

## URL Format Requirement

`NEXT_PUBLIC_SUPABASE_URL` must be the **base project URL**, not the REST endpoint:

```
# Correct
NEXT_PUBLIC_SUPABASE_URL=https://abc123.supabase.co

# Wrong — Supabase Dashboard "REST URL" field shows this, do NOT use it
NEXT_PUBLIC_SUPABASE_URL=https://abc123.supabase.co/rest/v1
```

The Supabase JS client appends `/rest/v1` itself. If the URL already contains the suffix, the client constructs double-path URLs (`/rest/v1/rest/v1/table`) which PostgREST rejects with PGRST125 "Invalid path specified in request URL".

`src/lib/supabase/env.ts` — `normalizeProjectUrl()` — strips the suffix defensively from both `getSupabasePublicConfig()` and `getSupabaseAdminConfig()`, but the canonical value in `.env.local` and Vercel should be the base URL without the suffix.
