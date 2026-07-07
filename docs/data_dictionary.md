# Data Dictionary — Chile Market Intelligence

This file defines the data entities, their fields, and where each field comes from — the authoritative reference for the database/API schema. Some entities are now live/Supabase-persisted (macro, market snapshots, auth/watchlist/portfolio); others remain static JSON by design or because a live path is blocked (CMF). **For current runtime status per page/module** (live vs. persisted vs. static vs. blocked), see [`docs/data_source_status.md`](data_source_status.md) — this file describes schema, not live status.

---

## Entity: Company

Represents a Chilean listed company tracked by the family office.

| Field | Type | Description | Source |
|---|---|---|---|
| `ticker` | string | CMF/Bolsa ticker symbol (e.g., `BSANTANDER`) | Manual / Bolsa de Santiago |
| `name` | string | Official registered name | CMF company registry |
| `short_name` | string | Display name used in tables | Manual |
| `sector` | string | Sector classification (e.g., Banking, Mining, Retail) | Manual |
| `industry` | string | Sub-sector or industry | Manual |
| `exchange` | string | Always `BCS` (Bolsa de Comercio de Santiago) for now | Manual |
| `isin` | string | ISIN identifier | CMF |
| `rut` | string | Chilean tax ID of the issuer | CMF |
| `cmf_id` | string | CMF internal entity ID | CMF |
| `website` | string | Company investor relations URL | Manual |
| `description` | text | Short business description | Manual |
| `is_tracked` | boolean | Whether the office actively monitors this company | Internal |
| `updated_at` | timestamp | Last data refresh | System |

---

## Entity: StockPrice

Daily closing price record for a company.

| Field | Type | Description | Source |
|---|---|---|---|
| `ticker` | string | FK → Company.ticker | |
| `date` | date | Trading date | Bolsa de Santiago, via Yahoo Finance (unofficial) |
| `open` | decimal | Opening price (CLP) | Market data |
| `high` | decimal | Daily high (CLP) | Market data |
| `low` | decimal | Daily low (CLP) | Market data |
| `close` | decimal | Closing price (CLP) | Market data |
| `volume` | bigint | Shares traded | Market data |
| `adjusted_close` | decimal | Close adjusted for dividends/splits | Market data |

Note: In MVP, only the latest `close` is stored as a static value per company.

**Phase 8B — CompareEntry (derived, not persisted):** `src/lib/compare/compareTypes.ts` defines a request-time-only shape assembled by `resolveCompareData()` for the Compare page — it is not its own database table, just a normalized merge of `Company`, `StockPrice`/`stock_snapshots`, and `stock_snapshots` history, each field tagged with a `CompareFieldSource` (`live` / `persisted` / `static_fallback` / `temporary_static` / `unavailable`) so the UI never has to guess a field's provenance. See `docs/data_source_status.md`'s Compare section for current field-by-field status.

---

## Entity: EarningsRelease

One row per quarterly or annual earnings report.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `ticker` | string | FK → Company.ticker | |
| `period` | string | Reporting period (e.g., `2024-Q3`, `2024-FY`) | Manual |
| `period_end_date` | date | Last day of the reporting period | CMF / manual |
| `release_date` | date | Date results were published | CMF / manual |
| `revenue_clp` | bigint | Total revenue in CLP millions | Company filing |
| `ebitda_clp` | bigint | EBITDA in CLP millions | Company filing |
| `net_income_clp` | bigint | Net income in CLP millions | Company filing |
| `eps_clp` | decimal | Earnings per share in CLP | Company filing |
| `revenue_yoy_pct` | decimal | YoY revenue growth (%) | Calculated |
| `net_income_yoy_pct` | decimal | YoY net income growth (%) | Calculated |
| `consensus_eps` | decimal | Bloomberg/FactSet consensus EPS | Future |
| `beat_miss` | string | `beat`, `miss`, or `in-line` vs. consensus | Calculated |
| `cmf_filing_url` | string | Link to CMF FECU filing | CMF |
| `notes` | text | Analyst notes | Internal |

**Phase 8C note:** this table describes an idealized future schema (including `consensus_eps`/`beat_miss`,
which are explicitly out of scope — no analyst-estimates source is ingested). The actual persisted table
is the leaner `earnings_events` (see "Entity: Financial Statements" below) — no consensus/beat-miss field
exists there by design, since fabricating one without a real estimates source would violate the
no-fake-values rule. The static `earnings.json`/`EarningsRelease` TypeScript interface (with its synthetic,
clearly-labeled consensus fields) remains the fallback for any ticker with no persisted earnings event.

---

## Entity: HechoEsencial

A CMF material disclosure filing.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `cmf_id` | string | CMF filing reference number | CMF |
| `ticker` | string | FK → Company.ticker | CMF |
| `company_name` | string | Issuer name as registered with CMF | CMF |
| `filing_type` | string | `hecho_esencial`, `informacion_interes`, `other` | CMF |
| `received_at` | timestamp | CMF receipt timestamp | CMF |
| `title` | string | Short description or subject line | CMF |
| `body_text` | text | Full text of the filing | CMF |
| `pdf_url` | string | Direct link to the CMF PDF | CMF |
| `tags` | string[] | Internal classification tags | Internal |

---

## Entity: MacroIndicator

One row per data point for a macroeconomic time series.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `series_code` | string | Identifier for the series (e.g., `TPM`, `IPC`, `IMACEC`) | Banco Central |
| `series_name` | string | Human-readable name | Manual |
| `date` | date | Observation date | Banco Central BDE API |
| `value` | decimal | Numeric value | Banco Central BDE API |
| `unit` | string | Unit of measure (e.g., `%`, `CLP`, `index`) | Manual |
| `frequency` | string | `daily`, `monthly`, `quarterly`, `annual` | Manual |
| `source` | string | Source institution (e.g., `Banco Central`, `CMF`) | Manual |

Key series to track:

| `series_code` | Description | Frequency |
|---|---|---|
| `TPM` | Tasa de Política Monetaria | Per meeting |
| `IPC` | Índice de Precios al Consumidor (monthly change %) | Monthly |
| `IPC_YOY` | IPC YoY % | Monthly |
| `UF` | Unidad de Fomento daily value | Daily |
| `USD_CLP` | USD/CLP spot rate | Daily |
| `EUR_CLP` | EUR/CLP spot rate | Daily |
| `IMACEC` | Monthly Economic Activity Index (% change) | Monthly |
| `GDP_QOQ` | GDP quarter-on-quarter growth | Quarterly |
| `COPPER_LME` | Copper price LME (USD/lb) | Daily |

---

## Entity: NewsItem

A Chilean market or macro news item with buyside-oriented AI summary.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | string | Unique identifier | System / scraper |
| `headline` | string | News headline | Source publication |
| `source` | string | Publication or institution name (e.g., `df.cl`, `BCCh`, `CMF`) | Source |
| `timestamp` | string (ISO 8601) | Publication datetime | Source |
| `category` | enum | `Macro` \| `Company` \| `Regulation` \| `Earnings` \| `Market` | Classified |
| `summary` | string | 2–3 sentence buyside summary: what happened · why it matters · what is affected | AI-generated (future) |
| `affectedTickers` | string[] | Bolsa tickers directly referenced or likely affected | Analyst / AI |
| `affectedMacroVariables` | string[] | Macro series codes affected (e.g., `TPM`, `UF`, `IPC_YOY`) | Analyst / AI |
| `materiality` | enum | `High` \| `Medium` \| `Low` — investor relevance rating | Analyst / AI |
| `url` | string | Source URL (may be placeholder in MVP) | Source |

**MVP status:** Populated from static mock array in `src/data/news_mock.ts`. Live ingestion is future work.

**Future sources:** emol.com, df.cl, diarioestrategia.cl, CMF API, BCCh communications, company IR pages.

---

## Entity: DocumentRecord

An internal registry entry that represents a source document (CMF filing, earnings release, etc.) and stores a buyside-oriented AI-generated summary. This is a local abstraction — it does not download or cache actual PDF/HTML files in MVP.

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | string | Unique identifier (e.g., `doc-he-001`, `doc-earn-3`) | System |
| `type` | enum | `hecho_esencial` \| `earnings_release` \| `financial_statement` \| `news_source` | Manual |
| `ticker` | string | FK → Company.ticker | Manual |
| `companyName` | string | Display name of the issuing company | Manual |
| `title` | string | Filing or document title | Manual / CMF |
| `date` | string | Publication or filing date (YYYY-MM-DD) | CMF / company |
| `source` | string | Source institution (e.g., `CMF`, `Bolsa de Santiago`) | Manual |
| `sourceUrl` | string | URL of the original document on the external source | CMF / company |
| `localStatus` | enum | `external_only` \| `placeholder` \| `synced_future` — tracks sync state | System |
| `summary` | string | Short plain-language summary (1–2 sentences) | Manual (MVP) |
| `aiSummary` | string | Buyside-oriented 4-element summary: event → relevance → price implication → watch item | AI-generated (future) / manual (MVP) |
| `keyPoints` | string[] | 3–5 structured bullet points for buyside analysis | Manual (MVP) |
| `relatedRecordId` | string | ID of the linked HechoEsencial or EarningsRelease record | Manual |
| `fileType` | enum | `pdf` \| `html` \| `xbrl` \| `press_release` \| `unknown` | Manual |

**`localStatus` values:**
- `external_only` — only the source URL is available; no local copy or sync planned yet (current MVP state for all records)
- `placeholder` — a local copy slot exists but is not yet populated
- `synced_future` — full local sync planned for a future phase

**MVP status:** 24 records in `src/data/documents.json`. All are `external_only`. No PDF download, scraping, or sync happens in MVP. The `sourceUrl` links to real CMF document pages.

**Accessor helpers:** `src/lib/data/documents.ts` exports `getAllDocuments()`, `getDocumentById()`, `getDocumentsByTicker()`, `getDocumentByRelatedId()`, `getDocumentsByType()`.

---

## Entity: Watchlist / WatchlistItem (Phase 6A)

Associates a signed-in user with a set of tracked tickers — no position size or cost basis (see Portfolio below for that). One or more watchlists per user; the first is auto-created (`is_default: true`, name "Default").

**`watchlists`**

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → `auth.users`, defaults to `auth.uid()` |
| `name` | text | e.g. "Default" |
| `is_default` | boolean | |
| `created_at` / `updated_at` | timestamptz | |

**`watchlist_items`**

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `watchlist_id` | uuid | FK → `watchlists.id` |
| `user_id` | uuid | FK → `auth.users`, defaults to `auth.uid()` |
| `ticker` | text | FK → `companies.ticker`; validated against the covered universe |
| `notes` | text \| null | |
| `added_at` | timestamptz | |

Unique on `(watchlist_id, ticker)`. RLS: `auth.uid() = user_id` on every operation — no public read/write.

---

## Entity: Portfolio / PortfolioPosition (Phase 6C)

A signed-in user's holdings, with cost basis and live unrealized P&L. One or more portfolios per user; the first is auto-created (`is_default: true`, name "Default", `base_currency: 'CLP'`) on first visit to `/portfolio`.

**`portfolios`**

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK → `auth.users`, defaults to `auth.uid()` |
| `name` | text | e.g. "Default" |
| `base_currency` | text | Default `'CLP'` — no FX conversion yet (see Limitations) |
| `is_default` | boolean | |
| `created_at` / `updated_at` | timestamptz | |

**`portfolio_positions`**

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `portfolio_id` | uuid | FK → `portfolios.id` |
| `user_id` | uuid | FK → `auth.users`, defaults to `auth.uid()` |
| `ticker` | text | FK → `companies.ticker` (restrict on delete); validated against the covered universe |
| `quantity` | numeric | Must be > 0 |
| `average_cost` | numeric \| null | Per-share cost; must be ≥ 0 when present |
| `cost_currency` | text | Default `'CLP'` |
| `opened_at` | date \| null | Reserved; not yet set by the UI |
| `notes` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

Unique on `(portfolio_id, ticker)`. RLS: `auth.uid() = user_id` on every operation — no public read/write.

**Derived (not stored — computed in `src/lib/portfolio/valuation.ts` from the latest `stock_snapshots` price):** `latestPrice`, `marketValue`, `costBasis`, `unrealizedPnL`, `unrealizedPnLPct`, `weight` (% of portfolio market value), `mixedCurrency` (true when `cost_currency` ≠ the live price's currency — no FX conversion is applied).

`metadata.positionSource` (`'manual'` or `'transactions'`, added Phase 6D — see below) and `metadata.lastReconciledAt` record provenance without a schema change; a row with no `positionSource` key (all pre-6D rows) is treated as `'manual'`.

**Limitations (Phase 6C, remaining after 6D):** no FX conversion, no performance attribution. Transaction history, realized P&L, and cash balance are added in Phase 6D below. See `docs/supabase_persistence.md` → "Portfolio Valuation" / "Transaction History and Cash Ledger" for the full methodology notes.

---

## Entity: PortfolioTransaction / CashLedgerEntry (Phase 6D)

Lets a portfolio's positions be **derived** from actual buy/sell lots instead of a manually entered quantity + average cost. `portfolio_positions` (above) remains the current-state table; these two tables are the transaction-managed source of truth for any ticker that uses them.

**`portfolio_transactions`**

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `portfolio_id` | uuid | FK → `portfolios.id` |
| `user_id` | uuid | FK → `auth.users`, defaults to `auth.uid()` |
| `ticker` | text | FK → `companies.ticker` (restrict on delete) |
| `transaction_type` | text | `'buy'` \| `'sell'` (check constraint) |
| `trade_date` | date | |
| `settlement_date` | date \| null | Reserved; not yet set by the UI |
| `quantity` | numeric | Must be > 0 |
| `price` | numeric | Must be ≥ 0 |
| `gross_amount` | numeric \| null | `quantity × price`, computed on write |
| `fees` / `taxes` | numeric | Default 0; must be ≥ 0 |
| `net_amount` | numeric \| null | Gross + fees + taxes (buy) or − fees − taxes (sell) |
| `currency` | text | Default `'CLP'` |
| `realized_pnl` | numeric \| null | Sells only; recalculated whenever the ticker's history changes (edit/delete elsewhere in the same history) |
| `notes` | text \| null | |
| `created_at` / `updated_at` | timestamptz | |

**`portfolio_cash_ledger`**

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `portfolio_id` | uuid | FK → `portfolios.id` |
| `user_id` | uuid | FK → `auth.users`, defaults to `auth.uid()` |
| `transaction_id` | uuid \| null | FK → `portfolio_transactions.id` (set null on delete); null for manual entries |
| `ledger_date` | date | |
| `currency` | text | Default `'CLP'` |
| `entry_type` | text | `'deposit'` \| `'withdrawal'` \| `'buy_cash_outflow'` \| `'sell_cash_inflow'` \| `'fee'` \| `'tax'` \| `'adjustment'` (check constraint) |
| `amount` | numeric | Signed: positive = cash in, negative = cash out |
| `description` | text \| null | |
| `created_at` | timestamptz | |

Both tables: RLS `auth.uid() = user_id` on every operation, plus a `check_portfolio_ownership()` trigger verifying `portfolio_id` actually belongs to `user_id` (RLS alone can't check a cross-table FK). No public read/write.

**Average cost methodology:** weighted average only (no FIFO/LIFO/specific-lot). A buy blends into the existing average, folding in fees/taxes; a sell reduces quantity but leaves the average cost on the remaining shares unchanged.

**Realized P&L methodology:** `(sellQty × sellPrice − fees − taxes) − (sellQty × averageCostAtSaleTime)`, computed via `rebuildPositionFromTransactions()` replaying the ticker's full history — so editing or deleting an earlier transaction correctly recalculates `realized_pnl` on every later sell, not just the row touched.

**Manual-position compatibility:** the first transaction for a ticker that already has a manual `portfolio_positions` row (or any pre-6D row with no `positionSource`) is blocked (`manual_position_conflict`) rather than silently overwritten — the user must remove the manual position first.

**Limitations (Phase 6D):** no FIFO/LIFO or specific-lot selection, no dividends, no time/money-weighted performance attribution, no broker/CSV import, no automated cash reconciliation against a real statement. See `docs/supabase_persistence.md` → "Transaction History and Cash Ledger" for the full note.

---

## Entity: Financial Statements — Reporting Periods / Statement Items / Metrics / Earnings Events (Phase 8C — automation-first, manual CSV as interim bridge)

The real, persisted schema behind Charting, Compare's Fundamentals table, and Earnings — replaces the
static `fundamentals.json`/`stockPrices.json` valuation fields/`earnings.json` wherever a ticker has an
imported record. Populated by manual CSV import today (`scripts/ingest/financialsCsv.ts`), but the schema
is **source-agnostic by design**: every table carries provenance + supersession columns so a future automated
`cmf_fecu`/`xbrl`/`vendor_feed`/`broker_feed`/`document_ingestion` source can write into the same rows without
a redesign. Manual CSV is an interim bridge, not the terminal architecture — see `docs/supabase_persistence.md`
→ "Financial-Statement Ingestion (Phase 8C — automation-first, manual CSV as interim bridge)" for the ingestion
workflow and `docs/data_source_status.md` → "Automation-first source architecture" for the verified supersession
mechanism.

**Phase 8C.1:** the first real candidate for the `xbrl` slot was built (`src/lib/financials/providers/cmfXbrlProvider.ts`)
against exactly this schema, after verifying via `docs/cmf_xbrl_provider_discovery.md` that CMF's filed XBRL
statements are downloadable without CAPTCHA. It normalizes into the identical `FinancialImportPayload` shape
manual CSV produces, so no columns above changed to accommodate it.

**Provenance/supersession columns — present on all 4 tables below** (added by migration
`20260705000000_financials_automation_ready.sql`):

| Field | Type | Description | Source |
|---|---|---|---|
| `source_type` | string | One of `manual_csv`, `cmf_fecu`, `xbrl`, `vendor_feed`, `broker_feed`, `document_ingestion`, `static_seed`, `derived` (CHECK-constrained) | System |
| `source_name` | string | Human-readable provenance label, e.g. `'Company filing (synthetic sample)'` | Manual CSV |
| `source_url` | string | Nullable — link to the originating document, if any | Manual CSV |
| `source_file` | string | Bare filename only (never a path) — rejected by the parser if it contains `/`, `\`, or a Windows drive letter | Manual CSV |
| `source_as_of` | timestamptz | When the source data was as-of, distinct from when it was ingested | Manual CSV |
| `ingestion_run_id` | uuid | FK → `ingestion_runs(id)` — links every row to the exact ingestion run that wrote it | System |
| `source_priority` | integer | Auto-derived from `source_type` (never hand-set) — higher wins on supersession. Convention: `static_seed`(10) < `derived`(50) < `manual_csv`(100) < `document_ingestion`(120) < `broker_feed`(140) < `vendor_feed`(150) < `cmf_fecu`(200) < `xbrl`(210) | System |
| `is_superseded` | boolean | `true` once a higher-priority row exists for the same logical period | System |
| `superseded_by` | uuid | Points at the winning row's `id` when `is_superseded = true` | System |

**CompanyReportingPeriod** — the reporting "shell" every other table hangs off:

| Field | Type | Description | Source |
|---|---|---|---|
| `id` | uuid | Primary key | System |
| `ticker` | string | FK → Company.ticker | |
| `fiscal_year` | integer | e.g. `2025` | Manual CSV |
| `fiscal_period` | string | `Q1`/`Q2`/`Q3`/`Q4`/`FY` | Manual CSV |
| `period_type` | string | `quarterly`/`annual`/`ttm` | Manual CSV |
| `period_end_date` | date | Last day of the reporting period | Manual CSV |
| `report_date` | date | Date results were published (nullable — blank for upcoming periods) | Manual CSV |
| `currency` | string | Defaults `CLP` | Manual CSV |
| `filing_id` | uuid | Optional FK → `cmf_filings(id)` | Manual CSV |
| *(+ provenance/supersession columns above)* | | | |

**FinancialStatementItem** — one row per line item per period:

| Field | Type | Description | Source |
|---|---|---|---|
| `reporting_period_id` | uuid | FK → CompanyReportingPeriod | |
| `ticker` | string | FK → Company.ticker | |
| `statement_type` | string | `income`/`cash`/`balance`/`returns` (long-form `income_statement`/`balance_sheet`/`cash_flow`/`segment`/`other` also accepted) | Manual CSV |
| `line_item_code` | string | Stable key: `revenue`, `ebitda`, `net_income`, `eps`, `gross_profit`, `operating_income`, `rd_expense`, `sga_expense`, `sbc_expense`, `dep_amort`, `ocf`, `capex`, `cash`, `total_debt`, `total_assets`, `shares_out`, `dividends_paid`, `buybacks` | Manual CSV |
| `value` | numeric | Nullable — e.g. banks have no meaningful `ebitda`. A non-null `value` with no explicit `scale` is rejected by the parser as ambiguous | Manual CSV |
| `unit` / `scale` | string | Display hints (`CLP`/`millions`) — not used in calculations | Manual CSV |
| *(+ provenance/supersession columns above)* | | | |

**FinancialMetric** — calculated ratios tied to a reporting period:

| Field | Type | Description | Source |
|---|---|---|---|
| `reporting_period_id` | uuid | FK → CompanyReportingPeriod | |
| `metric_code` | string | `ebitda_margin`, `gross_margin`, `op_margin`, `fcf`, `net_debt`, `net_debt_ebitda`, or any manually-supplied code | Manual CSV or derived |
| `value` | numeric | Nullable | |
| `calculation_method` | string | e.g. `'ebitda / revenue'` — set only for `derived` rows | System |
| *(+ provenance/supersession columns above — `source_type: 'derived'` outranks `'static_seed'` but is outranked by every real ingestion source)* | | | |

**EarningsEvent** — one row per reporting event (replaces `earnings.json` for imported tickers):

| Field | Type | Description | Source |
|---|---|---|---|
| `ticker` | string | FK → Company.ticker | |
| `fiscal_year` / `fiscal_period` / `period_type` | — | Nullable — an "expected" event may not yet have a confirmed period | Manual CSV |
| `report_date` / `event_date` | date | Nullable | Manual CSV |
| `status` | string | `expected`/`reported`/`preliminary`/`missing` — **never** a fabricated quality judgment | Manual CSV |
| `revenue` / `ebitda` / `net_income` / `eps` | numeric | Nullable | Manual CSV |
| *(+ provenance/supersession columns above, including `superseded_by`)* | | | |

**No consensus/estimate fields exist on `EarningsEvent`** — the Rev. Surprise column on `/earnings` renders `—` for every persisted row, by design.

**Supersession in practice:** `reconcileSupersession()` in `financialsRepository.ts` runs after every upsert, grouping rows by logical key (ticker + fiscal_year + fiscal_period [+ period_type]) and marking every row but the highest-`source_priority` one `is_superseded = true`. The read path always filters `is_superseded = false`. This was verified end-to-end against Production Supabase: inserting a synthetic `cmf_fecu` row over an existing `manual_csv` period automatically superseded the manual row with no code changes.

---

## Static Data Files (MVP)

During MVP all entities above are backed by static JSON files located at:

```
src/data/
  companies.json        — Company[]
  stock_prices.json     — StockPrice[] (latest close only)
  earnings.json         — EarningsRelease[]
  hechos_esenciales.json — HechoEsencial[]
  macro_indicators.json  — MacroIndicator[] (latest values per series)
```

These files are the source of truth during MVP. When Supabase is connected, these files are replaced by database queries. The TypeScript types derived from this dictionary must not change between phases — only the data source changes.

---

## Phase 4A — Live-Data Provider Architecture

The MVP serves static JSON. Phase 4A adds a **provider abstraction** that lets
macro data come from a live source (Banco Central de Chile) while always keeping
the static JSON as a fallback. The TypeScript entity types above are unchanged —
only the *source* of a `MacroIndicator` / `MacroHistoryPoint` can change.

### DATA_MODE

A server env var controls sourcing (`src/lib/providers/dataMode.ts`):

| Mode | Behavior |
|---|---|
| `static` | Local JSON only. |
| `live` | Live provider where available; if it fails, serve static and mark `live-unavailable`. |
| `hybrid` | Try live, silently fall back to static (`hybrid-fallback`). |

Default when unset: `hybrid` if BCCh credentials exist, else `static`. **With no
env vars at all the app runs fully on static data** — nothing breaks.

### Provider layer (`src/lib/providers/`)

| File | Role |
|---|---|
| `types.ts` | Types only (erased at compile) — safe to import from client. |
| `dataMode.ts` | `parseDataMode`, `getDataMode`, `decideSource` (pure decision logic). |
| `bcchClient.ts` | **Server-only** BCCh SieteRestWS client (`fetchBcchSeries`) + pure parser `normalizeBcchSeries`. Reads credentials from server env; never logs them. |
| `staticMacroProvider.ts` | Wraps static JSON behind the `MacroProvider` contract. |
| `bcchMacroProvider.ts` | **Server-only** live provider (foundation; disabled until series codes are mapped). |
| `macroProvider.ts` | Orchestrator: applies DATA_MODE, returns `{ data, metadata }`. |

**Rule:** page components never import providers. They call `src/lib/data`
functions (static, synchronous) for the initial render and the client-safe
`fetchMacroIndicators` / `fetchMacroHistory` helpers (which hit `/api` routes)
to optionally upgrade to live. BCCh credentials are server-only.

### Series registry (`src/config/macroSeries.ts`)

One row per indicator: `id`, `displayName`, `region`, `source`,
`sourceProvider`, `providerSeriesCode`, `unit`, `frequency`, `transformation`,
`fallbackStaticId`, `enabled`. **Every `providerSeriesCode` is `null` and
`enabled: false`** until the official BCCh BDE code is verified (Phase 4B). No
guessed codes.

### Response metadata

Both `/api/macro` and `/api/macro/history/[indicatorId]` return:

```
{ data, metadata: { dataModeRequested, dataModeUsed, liveAvailable,
                    status, source, lastUpdated, fallbackReason? } }
```

`status ∈ { static, live, hybrid-fallback, live-unavailable }` drives the
`DataSourceBadge`. Live vs static differ only in `source`/`lastUpdated`/value
freshness — the shape consumed by the UI is identical, so fallback is seamless.

---

## Phase 4B — BCCh Mapping Fields & Transformations

### Controlled mapping (`src/config/bcchSeriesManualMap.ts`)

The human-verified source of truth for live macro. One entry per indicator
keyed by a `manualKey`:

| Field | Meaning |
|---|---|
| `seriesId` | Official BDE code — `null` until verified. **Never guessed.** |
| `verified` | `true` only after a human confirms the code against the catalog. |
| `frequency` | `DAILY` / `MONTHLY` / `QUARTERLY` / `ANNUAL`. |
| `transformation` | How the provider derives value/change (see below). |
| `staticId` | Static JSON id used for the fallback path. |
| `sourceName`, `confidence`, `verificationDate`, `verificationMethod`, `notes` | Provenance. |

`src/config/macroSeries.ts` derives each series' `enabled` / `providerSeriesCode`
/ `transformation` from this map. A series is **live-eligible only when
`verified === true` AND `seriesId !== null`**; otherwise it stays disabled and
the static fallback is served.

### Transformation rules (`src/lib/providers/transforms.ts`)

| transformation | value | change |
|---|---|---|
| `none` | raw latest | delta vs previous observation |
| `mom` | month-over-month % from index level | Δ vs prior m/m |
| `yoy` / `level-to-yoy` | 12-month % from monthly level | Δ vs prior yoy |
| `bp-to-pct` | value ÷ 100 | rescaled delta |

Plausibility bands (`src/lib/providers/plausibility.ts`) reject a mapped series
whose latest value falls outside a broad sanity range (e.g. TPM 0–20%, USD/CLP
300–2000) — this catches a wrong mapping, not normal market moves.

### Live vs static fallback

`/api/macro*` metadata reports `provider` (`"BCCh BDE"` live / `"static"`
fallback) and, for a single live history series, the `seriesId`. The data shape
is identical for live and static, so fallback never changes the UI layout. UI
display convention is unchanged: value first, change second in one pair of
parentheses, no bp/pp suffixes.

---

## Entity: Structured Notes (Phase 9A–9D)

Internal, shared-book structured-note tracking — replaces the legacy `NUEVA BASE - Notas Estructuradas.xlsx`.
Populated automation-first via term-sheet PDF extraction; manual entry is a fallback. Full audit + workbook
mapping in `docs/structured_notes_workbook_mapping.md`; design in `docs/structured_notes_design.md`.

Tables (migrations `20260706000000_structured_notes_foundation.sql` → `20260706120000_*` (shared book) →
`20260707000000_*` (allocation upsert) → `20260708000000_*` (archived_at) → `20260709000000_*` (monitoring),
RLS `auth.uid() is not null` — shared book, `user_id` is an upload/audit stamp only):

- **structured_notes** — note header + terms + barriers + `source_type`/`source_file_name`/`confidence_score`/
  `extraction_run_id` provenance + `archived_at`; `status` ∈ active/autocalled/matured/defaulted/cancelled/draft.
- **structured_note_underlyings** — per-underlying `initial/strike/knock_in/coupon/autocall` levels + pct +
  `yahoo_symbol` (Bloomberg ticker mapped to Yahoo; **no Bloomberg call in the app**).
- **structured_note_observations** — coupon/autocall/final schedule (`observation_type`, `valuation_date`,
  `payment_date`, `status`). Phase 9D adds monitoring-evaluation columns, populated only by the scheduled
  cron and distinct from the extraction-time terms above: `observed_at`, `observed_source`,
  `observed_source_symbol`, `observed_levels` (jsonb), `worst_performer_ticker`, `worst_performer_return`,
  `coupon_eligible`, `autocall_eligible`, `final_barrier_breached`, `review_required` (default `false`),
  `review_reason`.
- **structured_note_allocations** — **internal** entity/sociedad notional split (never extracted from a PDF).
- **structured_note_price_snapshots** — persisted Yahoo levels, now **written on a daily schedule** by the
  Phase 9D cron (upsert on `(underlying_id, price_date, source)` — safe to re-run same-day). `user_id` is
  **nullable** as of Phase 9D (the cron writes via the service-role admin client, which has no session to
  populate `default auth.uid()`).
- **structured_note_extraction_runs** — one audit row per extraction attempt (confidence, warnings, errors, payload).
- **structured_note_extracted_fields** — per-field provenance (raw excerpt, confidence, page, section, warning).
- **structured_note_monitoring_runs** (Phase 9D) — one audit row per scheduled-monitoring run: `run_type` ∈
  scheduled_snapshot/manual_refresh/observation_check/backfill, `status` ∈ running/success/partial_success/failed,
  active-note/underlying/price/observation counts, `warnings`/`errors` (jsonb). No `user_id` (system-level,
  like `structured_note_extraction_runs`); RLS allows `select` for any authenticated user and has **no
  insert/update/delete policy** — writes are service-role only.

**No consensus/estimate fields exist** on any structured-note table. Market levels are always read live from
Yahoo (or reported `unavailable`), never fabricated. Observation `coupon_eligible`/`autocall_eligible`/
`final_barrier_breached` are MONITORING ESTIMATES from the same Yahoo levels — never an official
calculation-agent determination; `review_required` + `review_reason` make that limitation explicit per row.
