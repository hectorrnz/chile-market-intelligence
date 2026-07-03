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

### Financials tables (Phase 8C)

Migration file: [`20260704000000_financials_foundation.sql`](../supabase/migrations/20260704000000_financials_foundation.sql)

| Table | Description |
|-------|-------------|
| `company_reporting_periods` | One row per (ticker, fiscal_year, fiscal_period, period_type, source_type) — the reporting "shell" other tables hang off. `source_type` is `manual_csv` today; `xbrl`/`cmf_fecu` reserved for future automation. Optional `filing_id` FKs to `cmf_filings(id)`. |
| `financial_statement_items` | Line-item detail (revenue, EBITDA, net income, EPS, cash, total debt, etc.) — `statement_type` ∈ `income/cash/balance/returns`, `line_item_code` is the stable key other code reads (e.g. `'revenue'`, `'ebitda'`). |
| `financial_metrics` | Calculated ratios (EBITDA margin, FCF, net debt, net debt/EBITDA, gross/op margin). `source_type` is `manual_csv` (imported directly) or `derived` (computed by the ingestion script from statement items) — manual takes precedence when both exist for the same `metric_code` + period. |
| `earnings_events` | One row per reporting event (upcoming or reported) — same shape as `earnings.json` but real. `status` ∈ `expected/reported/preliminary/missing`. No consensus/estimate fields — beat/miss language is never shown for these rows. |

Like the tables above, all four have an anon-read policy and **no public write policy** — only the admin client (service-role key), invoked exclusively from `scripts/ingest/financialsCsv.ts`, can write. Read helpers live in `src/lib/db/repositories/financialsRepository.ts` and use the public/anon server client, same as `macroRepository.ts`/`marketRepository.ts`.

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

## Financial-Statement Ingestion (Phase 8C — automation-first, manual CSV as interim bridge)

Manual CSV import is the **first real-data path**, not the final architecture, for Charting, Compare's
Fundamentals table, and Earnings — replacing the static `fundamentals.json`/`stockPrices.json`/`earnings.json`
terminal-static state with persisted (and, for a handful of ratios, derived) data, per ticker, as CSVs are
imported. The schema, repository, and ingestion-run logging were designed **automation-first**: every table,
column, and code path is source-agnostic so that a future automated CMF FECU/XBRL parser, a licensed vendor
data feed, a broker-supplied statement feed, or a document-ingestion (PDF/filing) pipeline can write into the
exact same 4 tables through the exact same `financialsRepository.ts` upsert functions — no redesign required.
Manual CSV must never be treated as a terminal state; see `docs/data_source_status.md`'s "Automation-first
source architecture" section and "Conversion Paths" section for the full design rationale and verification.

**Phase 8C.1 update:** the first real automated-source candidate for the `source_type: 'xbrl'` slot was built
and verified this phase. `docs/cmf_xbrl_provider_discovery.md` documents a real, CAPTCHA-free public path to
CMF's filed XBRL financial statements (verdict: `feasible_with_mapping`) and
`src/lib/financials/providers/cmfXbrlProvider.ts` implements it against the exact same 4 tables and the exact
same `financialsRepository.ts` upsert functions described below — proving the automation-first design here
isn't merely theoretical. The provider is not yet wired to complete a full write (no zip-extraction dependency
was added this phase — see the discovery doc), so manual CSV remains the only source that has actually
persisted data as of this phase.

**CSV templates** (safe to commit; contain only synthetic sample data): `data/import_templates/`
- `financial_reporting_periods.template.csv` — one row per (ticker, fiscal_year, fiscal_period, period_type)
- `financial_statement_items.template.csv` — one row per line item per period (`line_item_code`: `revenue`, `ebitda`, `net_income`, `eps`, `gross_profit`, `operating_income`, `rd_expense`, `sga_expense`, `sbc_expense`, `dep_amort`, `ocf`, `capex`, `cash`, `total_debt`, `total_assets`, `shares_out`, `dividends_paid`, `buybacks`)
- `financial_metrics.template.csv` — optional manually-supplied ratios (most are auto-derived — see below)
- `earnings_events.template.csv` — one row per reporting event, `status` ∈ `expected/reported/preliminary/missing`

Every template also carries **provenance columns** — `source_name`, `source_url`, `source_file` (bare filename
only, never a path), `source_as_of` (ISO timestamp) — so imported rows can be audited or reconciled by a later
automated ingestion run.

**Never commit a real/private CSV** — only the `.template.csv` files (synthetic data) belong in the repo. Real imports are run locally from a file outside version control.

**Parser/validation:** `src/lib/financials/csvFinancials.ts` — pure functions (`parseCsvRows`, `validateReportingPeriodRow`, `validateStatementItemRow`, `validateFinancialMetricRow`, `validateEarningsEventRow`, `buildFinancialImportPayload`, `normalizeSourceMetadata`, `findDuplicates`). Every row is validated before any write: ticker must be in the covered universe, fiscal year/period/dates must be well-formed, numeric cells are NaN/Infinity-guarded (empty cell → `null`, never `NaN`), a value with no explicit `scale` is rejected as ambiguous, `source_file` is rejected if it looks like a path (forward slash, backslash, or a Windows drive letter), duplicate rows sharing the same logical key within one CSV are rejected, and errors carry the originating CSV line number.

**Auto-derived metrics:** `deriveFinancialMetrics()` computes `ebitda_margin`, `gross_margin`, `op_margin`, `fcf` (`ocf − capex`), `net_debt` (`total_debt − cash`), and `net_debt_ebitda` directly from imported statement items after each import — no need to supply these manually unless overriding.

**Source priority and supersession (automation-first mechanism):** every row in all 4 tables carries `source_type`, `source_priority` (integer, higher = more authoritative, auto-derived from `source_type` via `DEFAULT_SOURCE_PRIORITY` in `financialsRepository.ts` — never hand-set by ingestion callers), `is_superseded`, and `superseded_by`. Priority convention: `static_seed`(10) < `derived`(50) < `manual_csv`(100) < `document_ingestion`(120) < `broker_feed`(140) < `vendor_feed`(150) < `cmf_fecu`(200) < `xbrl`(210). After every upsert, `reconcileSupersession()` groups rows sharing a logical key (ticker + fiscal_year + fiscal_period [+ period_type]) across different `source_type`s, and marks every row but the highest-priority one `is_superseded = true` pointing `superseded_by` at the winner. The read path (`getReportingPeriods`, `getCanonicalReportingPeriods`, `getStatementItems`, `getFinancialMetrics`, `getEarningsEvents`) always filters `is_superseded = false` and additionally dedupes defensively by picking the highest-priority row per logical group. This means a future `cmf_fecu` or `xbrl` ingestion run automatically outranks and supersedes an existing `manual_csv` row for the same period **with zero code changes** — verified end-to-end with a live throwaway test against Production Supabase (insert a synthetic `cmf_fecu` row for a period that already had a `manual_csv` row → the manual row was automatically marked superseded and `getCanonicalReportingPeriods()` switched to the new row → cleanup reverted state correctly).

**Ingestion script:** `scripts/ingest/financialsCsv.ts`
```bash
npm run ingest:financials:dry -- --reporting-periods path.csv --statement-items path.csv --metrics path.csv --earnings path.csv
npm run ingest:financials -- --reporting-periods path.csv --statement-items path.csv --write
```
Dry-run by default (no `--write` flag needed); aborts before any write if any row fails validation, unless `--allow-partial` is passed (invalid rows are then skipped, not written). Creates the `ingestion_runs` row **first** (`provider: 'Manual CSV'`, `job_type: 'financials_csv_import'`, `status: 'running'`, `metadata: { ingestionVersion: '8C', sourceType: 'manual_csv', automationReadiness: 'interim_bridge' }`), threads that run's `id` as `ingestion_run_id` through every upserted row, then updates the same row with final `rows_seen`/`rows_inserted`/`rows_failed`/status. Never echoes full CSV row contents to logs — only counts and line-numbered reasons.

**Read path:** `src/lib/db/repositories/financialsRepository.ts` exposes `getReportingPeriods`, `getCanonicalReportingPeriods`, `getStatementItems`, `getFinancialMetrics`, `getLatestFinancialMetrics`, `getLatestStatementItems`, `getEarningsEvents`, `getFinancialsCoverage` — all source-agnostic (never hardcode `manual_csv` in a read/write path). Server-only resolvers (`src/lib/financials/resolveFinancials.ts`) shape this into the exact `FundamentalRecord[]` type Charting already knows how to aggregate, so the UI's quarterly/TTM/annual logic is unchanged regardless of source.

**Limitations (Phase 8C, explicit):**
- Manual CSV is the only source populated **today** — no automated CMF FECU/XBRL parsing yet (CMF's public portal is CAPTCHA-blocked, same constraint as Hechos Esenciales) — but the schema/repository already support it as a drop-in `source_type` with automatic supersession, so this is an ingestion-coverage gap, not an architecture gap.
- No consensus/analyst-estimates ingestion — persisted (imported) earnings rows never show a beat/miss surprise percentage.
- No dividends beyond what's imported as a raw `dividends_paid` line item (used only to derive dividend yield on Compare).
- No FX conversion.
- No cross-period YoY derivation for persisted records (Charting/Earnings YoY columns show `—` for imported data until a prior-year lookup is built).
- No AI summaries.

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
