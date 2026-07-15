# Data Source Status Matrix — Phase 8A / 8B / 8C / 8C.1 / 8C.2 / 8C.3 / 8C.4 / 8C.5 / 8C.6 / 8C.7 / 8C.8

Audit date: 2026-07-02 (Phase 8A) · updated 2026-07-02 (Phase 8B — Compare
real-data wiring + no-static-terminal-state policy) · updated 2026-07-03
(Phase 8C — manual CSV financial-statement ingestion: Charting, Compare
fundamentals, and Earnings now read persisted data where imported; upgraded
same day to an automation-first schema) · updated 2026-07-03 (Phase 8C.1 —
CMF/XBRL automated-provider discovery: found and verified a working,
CAPTCHA-free public path to real financial-statement XBRL filings) · updated
2026-07-08 (Phase 8C.2 — **CMF/XBRL automated financials ingestion is now
LIVE**: the download→unzip→parse→normalize→validate→persist pipeline works end
to end for SQM-B and COPEC; automated `xbrl` financials supersede manual CSV
for the same period. Manual CSV is now a genuine fallback, no longer the only
populated source.) · updated 2026-07-08 (Phase 8C.3 — **issuer coverage
expanded from 2 to 5** (added ENELCHILE, CMPC, CENCOSUD) via a conservative,
verified, issuer-by-issuer process against CMF's own official issuer
directory; banks (BSANTANDER, CHILE) confirmed structurally unmappable via
this tool, not merely unresearched) · updated 2026-07-08 (Phase 8C.4 — full
coverage sweep, enabled issuers 5→15, coverage funnel classifies every stock)
· updated 2026-07-09 (Phase 8C.5 — **every one of the 25 app stocks now has
real quarterly + annual fundamentals**: Yahoo Finance added as a universal,
honestly-labeled `yahoo_finance` (priority 80) fallback source, covering the
4 banks and other tickers CMF/XBRL structurally cannot reach; CMF/XBRL annual
still supersedes Yahoo annual for the 15 filed issuers. See
`docs/cmf_xbrl_financials_ingestion.md` §13) · updated 2026-07-09 (Phase 8C.6 —
non-bank CMF/XBRL coverage completed: 21/25 stocks enabled, 3 eligible issuers
promoted, 2 new XBRL parser dialects) · updated 2026-07-09 (Phase 8C.7 — a
real, official, non-XBRL bank filing path discovered and a dry-run-only
concept map/prototype built for the 4 remaining banks) · updated 2026-07-09
(Phase 8C.8 — **official CMF bank financials now live for all 4 banks**:
`cmf_bank` (priority 180) persisted for BSANTANDER/CHILE/BCI/ITAUCL FY2025
annual, superseding Yahoo's matching annual period; Yahoo remains active for
quarterly/TTM/earlier years/unmapped fields. Pillar 3 (capital/risk ratios)
investigated and correctly classified `deferred` — a per-bank PDF link
directory, not a structured file. See `docs/bank_financials_ingestion.md`).
This is the canonical truth-layer reference for what each visible module's
data source actually is, versus what its UI label says.

## Phase 8C.8 — Official CMF bank financials persistence + Pillar 3 discovery

- **`cmf_bank` is now a live, persisted source_type** (migration
  `20260712000000_financials_cmf_bank_source_type.sql`, priority 180 — above `yahoo_finance` (80), below
  `cmf_fecu`/`xbrl` (200/210)). `src/lib/financials/banks/runCmfBankFinancialsIngestion.ts` orchestrates all 4
  banks, writing only payloads that clear both a minimum-mapped-field guard and a minimum-validation guard —
  never a silently-degraded partial parse.
- **Production result: all 4 banks succeeded** — 60 rows written (15/bank: 1 reporting period + 14 statement
  items), 56 fields mapped, 0 failures, all `valid`. Verified live: BSANTANDER/CHILE/BCI/ITAUCL's FY2025 annual
  `cmf_bank` reporting period now supersedes the prior `yahoo_finance` FY2025 annual period; Yahoo's
  quarterly/other-year data is untouched. BCI's two independently-sourced `net_income` figures cross-validate
  within ~0.02%.
- **A real bug was caught and fixed during production validation**: the ingestion CLI was missing the
  `@next/env` env-loading call every other ingestion script in this project has, so `--write` silently ran
  with no Supabase credentials and both upserts failed closed — surfaced only as a generic row-count error.
  Fixed, verified with a single-bank write before the full run, and guarded by a new regression test.
- **`resolveFinancials.ts`'s `summarizeSource()`** now recognizes `cmf_bank` and labels it "Official CMF bank
  regulatory filing" — deliberately distinct from "Persisted financials via CMF XBRL" so a bank's official
  fields are never mistaken for the industrial pipeline.
- **Pillar 3 (capital/risk ratios) investigated, correctly classified `deferred`.** CMF's own "Divulgación de
  Pilar 3 de Basilea" page is not a structured file — each quarterly release is a PDF whose entire content is
  a link directory to each bank's own investor-relations website (self-hosted, per-bank format, mostly PDF).
  None of the 4 app banks link to a direct structured file. No ingestion prototype was built for a
  confirmed-non-viable source — documented in `src/lib/financials/banks/pillar3Discovery.ts` and surfaced via
  `bankTrack.pillar3` on the status endpoint. CET1/RWA/NPL/coverage remain structurally unavailable, never
  fabricated.
- Bank cron (`/api/cron/financials/cmf-bank`) stays unscheduled — manually-triggered and reviewable, same
  policy as the non-bank CMF/XBRL cron.

## Phase 8C.7 — Bank-specific CMF discovery (dry-run only, not enabled)

- **No XBRL path exists for banks** (confirmed absent from the securities-issuer directory under every
  registry group — none was expected, since banks are not part of the XBRL-tagged regime). A **separate,
  official, non-XBRL, public, no-CAPTCHA monthly regulatory data feed** was discovered instead: CMF's "Balance
  y Estado de Situación Bancos" — plain tab-delimited TXT files (not XBRL) with a stable per-bank 3-digit CMF
  code (BSANTANDER=037, CHILE=001, BCI=016, ITAUCL=039), documented in the release's own bundled
  `plan_de_cuentas.txt`/`documentacion.pdf`.
- A conservative **14-field account-code map** (`src/lib/financials/banks/bankConceptMap.ts`) was built and
  verified: `total_assets == total_liabilities + total_equity` and
  `profit_before_tax + tax_expense == net_income` both hold **exactly** for all 4 banks, confirmed against two
  separate real monthly releases (May 2026 and the actual target December 2025 annual release — 14/14 fields,
  0 validation warnings both times).
- **Nothing is production-ingested.** `src/lib/financials/providers/cmfBankProvider.ts` has no `writeImport` —
  it is discovery/dry-run only (`npm run discover:cmf-bank -- --live`). Yahoo Finance remains the sole active
  fundamentals source for all 4 banks, unchanged. A future migration would be needed to add `cmf_bank` as a
  `source_type` before any real write.
- Capital/regulatory ratios (CET1, RWA, NPL, coverage) do not exist anywhere in this feed — confirmed by
  exhaustive search of the account-code dictionary; they live in a separate, not-yet-investigated quarterly
  Pillar 3 disclosure. Deposits/borrowings also stay unmapped (ambiguous sub-code split, no single top-level
  total). Both documented in `docs/bank_financials_ingestion.md`, never fabricated.
- Status surfaced via a new `bankTrack` field on `GET /api/financials/cmf-xbrl/status`, separate from the
  existing `coverageFunnel` (banks stay `bank_track_required` there, unchanged).

## Phase 8C.5 — Universal fundamentals: every stock has quarterly + annual data

- **All 25 app stocks** (including the 4 banks CMF/XBRL cannot reach) now have persisted quarterly + annual
  fundamentals, so Charting's Quarterly/TTM/Annual toggle works for every ticker. Source: Yahoo Finance
  (`source_type: 'yahoo_finance'`, priority 80 — below `manual_csv` and every official/vendor source, above
  `derived`/`static_seed`). Badge: "Fundamentals via Yahoo Finance (unofficial)" — never claims official status.
- **CMF/XBRL remains authoritative where it exists**: for the 15 XBRL-enabled issuers, the filed annual period
  still shows `sourceType: xbrl` (Yahoo's matching annual row is automatically superseded); Yahoo fills the
  quarterly/other-year gaps around it. Verified live for CCU, SQM-B, and others.
- **Production state**: 2,921 rows written across all 25 tickers, 0 failures. The 3 tickers that previously
  carried stale synthetic `manual_csv` sample data (SQM-B, COPEC, BSANTANDER, from the original Phase 8C CSV
  templates) had that fabricated data deleted — nothing fake remains persisted.
- **A real library bug was caught and fixed during validation**: `yahoo-finance2`'s `fundamentalsTimeSeries`
  intermittently fails non-deterministically (same ticker, same call, sometimes succeeds/sometimes fails) —
  the original silent `.catch(() => [])` would have persisted an honestly-empty-looking but actually-wrong
  partial history. Fixed with retries + loud failure on exhaustion (never silently degrades).

## Phase 8C.2 / 8C.3 / 8C.4 / 8C.6 — Financials source is now automated (CMF/XBRL), 21 non-bank issuers enabled

- **Charting / Compare fundamentals / Earnings** read persisted financials. For an enabled issuer with a filed
  CMF XBRL statement — **21 issuers as of Phase 8C.6 (every non-bank app stock)** — the persisted data is
  **automated `xbrl`** (priority 210), which **supersedes** both `manual_csv` (100) and `yahoo_finance` (80)
  for the same period. The Charting badge shows "Persisted financials via CMF XBRL". Banks + earlier years +
  all quarters use the Yahoo fallback.
- **Full coverage funnel (Phase 8C.6):** every app stock is classified — **21 `enabled`** (all 15 from 8C.4 +
  the 3 promoted CONCHATORO/FALABELLA/MALLPLAZA + the 3 dialect issuers SONDA/ANDINA-B/VAPORES), **0
  `eligible_verified`, 0 `unsupported_page_shape`**, 4 `bank_track_required` (BSANTANDER, CHILE, BCI, ITAUCL —
  separate CMF banking track). Surfaced via `/api/financials/cmf-xbrl/status` (`coverageFunnel`) and
  `npm run discover:cmf-coverage`.
- **XBRL parser now reads three dialects (Phase 8C.6):** standard `xbrli:`-prefixed; default/unprefixed
  namespace (SONDA); CTI-Service single-quoted ISO-8859-1 (ANDINA-B, VAPORES) — verified byte-identical for the
  15 pre-existing issuers. VAPORES legitimately files no revenue line; it stays honestly missing (Yahoo fills
  it), never fabricated.
- **Ingestion**: manually-triggered, reviewable cron route `GET /api/cron/financials/cmf-xbrl` (Bearer
  `CRON_SECRET`) — **not on an unattended schedule** (undocumented HTML surface; Phase 8C.3 keeps this
  unscheduled — issuer coverage is still narrow, not yet a stable basis for unattended runs). Status:
  `GET /api/financials/cmf-xbrl/status` (public read-only) — now reports `enabledIssuers` (with
  verification status/date) and `notConfiguredIssuers` (with a documented reason) explicitly.
- **Honesty guarantees**: currency read per-fact (SQM-B/COPEC/CMPC file in USD; CENCOSUD in CLP; ENELCHILE
  changed CLP→USD between FY2024 and FY2025 — a genuine real-world change, verified via entity-identifier
  cross-check across both filings, not a bug); period nature labeled (annual / year_to_date / instant);
  missing concepts stay missing (never zero); balance-sheet identity validated; taxonomy-only ZIPs rejected;
  no raw XBRL ever exposed. **No migration** in either phase — reuses the existing `metadata` jsonb columns.
- **Phase 8C.3 issuer verification method**: RUTs verified against CMF's own official `sociedad[]` issuer
  directory (embedded in its public XBRL search form, `sa_eeff_ifrs_index.php`), a stronger source than
  search-engine snippets (the method that produced a wrong RUT in Phase 8C.1). CMPC and CENCOSUD required
  disambiguation from similarly-named but distinct directory entries. **Banks (BSANTANDER, CHILE) are
  confirmed absent from both CMF registry groups (RVEMI, RGEIN)** this tool exposes — not merely
  unresearched — and remain on manual CSV / static fallback. See `docs/cmf_xbrl_financials_ingestion.md` §4a.
Update this file whenever a module's data source changes (new ingestion,
provider swap, or label fix) — it is the single source of truth other docs
(`CLAUDE.md`, `README.md`) summarize from.

## No-static-terminal-state policy (Phase 8B)

**No visible module may remain static as a terminal state.** Static data is
permitted only as one of:

1. **Fallback** — a live/persisted path exists and is preferred; static serves
   only when the live/persisted path is unavailable (e.g. macro, market data).
2. **Seed/reference layer** — data that legitimately doesn't change from a
   live feed (e.g. static company reference metadata such as sector labels).
3. **Temporary placeholder with a defined conversion path** — the module is
   static today, but a specific next phase and target source are documented
   below; the module must never be presented as "live" while in this state.
4. **Blocked source with a documented workaround** — a live path was attempted
   and is structurally blocked (e.g. CMF's CAPTCHA gate); the block and any
   workaround options are documented, not silently treated as "just static."

Every visible data field must be classified as one of: `live` · `persisted` ·
`derived` (computed from live/persisted data) · `static_fallback` ·
`temporary_static` (with a conversion path) · `blocked` (with a documented
workaround) · `unavailable` (intentionally hidden/disabled rather than shown
with a fabricated value). See `src/lib/compare/compareTypes.ts` for the first
field-level implementation of this classification (`CompareFieldSource`).
The "Conversion Paths for Remaining Static Modules" section near the end of
this file gives every currently-static/blocked module a concrete target
source, conversion path, blocker (if any), next phase, and priority — no
module is left as an open-ended "Static MVP" with no path forward.

## Automation-first source architecture (Phase 8C upgrade, 2026-07-03)

**Phase 8C.1 note (same day):** the automation-ready design below was proven against a real candidate
automated source, not just a simulation. `docs/cmf_xbrl_provider_discovery.md` documents a verified,
CAPTCHA-free public path to real CMF XBRL financial-statement filings (`feasible_with_mapping`) and a working
provider (`src/lib/financials/providers/cmfXbrlProvider.ts`) built against the exact `source_type: 'xbrl'`
slot this architecture already reserved — no schema change was needed to accommodate it.

**Manual CSV is an interim bridge, not the architecture.** The financials
schema (`company_reporting_periods`, `financial_statement_items`,
`financial_metrics`, `earnings_events` — migration
`20260704000000_financials_foundation.sql` + the automation-ready upgrade
`20260705000000_financials_automation_ready.sql`) is deliberately
source-agnostic:

- Every row on every financials table carries the same provenance columns
  regardless of how it arrived: `source_type`, `source_name`, `source_url`,
  `source_file` (bare filename only — never a local path, since this is
  served in public read APIs), `source_as_of`, `ingestion_run_id` (FK to the
  same `ingestion_runs` table macro/market ingestion already uses),
  `source_priority`, `is_superseded`, `superseded_by`.
- `source_type` is a CHECK-constrained enum: `manual_csv` · `cmf_fecu` ·
  `xbrl` · `vendor_feed` · `broker_feed` · `document_ingestion` ·
  `static_seed` · `derived`. Manual CSV is one value in that set, not a
  special case the schema depends on.
- `source_priority` is derived automatically from `source_type` (see
  `DEFAULT_SOURCE_PRIORITY` in `financialsRepository.ts`: static_seed=10,
  derived=50, manual_csv=100, document_ingestion=120, broker_feed=140,
  vendor_feed=150, cmf_fecu=200, xbrl=210) — a future automated ingestion
  script never has to invent a priority number, just set its `sourceType`.
- **Supersession is real, not cosmetic.** `reconcileSupersession()` in
  `financialsRepository.ts` runs after every write: for the same logical
  period, the highest-`source_priority`, non-superseded row wins; lower-
  priority rows are marked `is_superseded = true` with `superseded_by`
  pointing at the winner. The read path (`getCanonicalReportingPeriods`,
  `getStatementItems`, `getFinancialMetrics`, `getEarningsEvents`) always
  filters `is_superseded = false` and picks the highest-priority row when
  more than one exists — so the UI never needs to know which source
  answered a given field.
- **Verified, not just designed:** a manual validation run (see Phase 8C
  section in `docs/implementation_plan.md`) inserted a synthetic `cmf_fecu`
  row for a period that already had a `manual_csv` row, via the *exact same*
  `upsertReportingPeriods()` function a real future ingestion script would
  call — the manual row was automatically marked superseded, and
  `getCanonicalReportingPeriods()` correctly switched to the `cmf_fecu` row,
  with zero code changes. The synthetic row was removed afterward to restore
  the real (SQM-B/BSANTANDER/COPEC, manual_csv) demo data.
- **Future automated providers reuse the same tables and the same
  `financialsRepository.ts` upsert functions** — a CMF/FECU parser, an XBRL
  parser, a licensed vendor feed, a broker-supplied statement feed, or a
  document-ingestion (PDF/filing) pipeline would each just call
  `upsertReportingPeriods`/`upsertStatementItems`/`upsertFinancialMetrics`/
  `upsertEarningsEvents` with `sourceType` set to their own value. No schema
  change, no new table, no UI rewrite.

**Priority key:** P0 = misleading label or false live claim (fix immediately) ·
P1 = easy wiring from data already in Supabase · P2 = needs a new
ingestion/provider · P3 = optional/future.

**Status key:** `live` (calling a live provider right now) · `persisted`
(reading accumulated Supabase rows written by a prior live run) · `hybrid`
(live attempted, silently falls back to static/persisted) · `static_fallback`
(a live-capable module currently serving its static fallback) · `static_mvp`
(no live path exists at all — sample data by design) · `blocked` (a live path
was attempted and is structurally blocked, e.g. CAPTCHA) · `mixed` (different
fields on the same card have different sources — see notes).

---

## Home (`/`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority / next action |
|---|---|---|---|---|---|---|
| Macro · Chile band | `macroIndicators.json` baseline; `/api/macro` → BCCh live if `DATA_MODE` allows, else static | `hybrid` | `DataSourceBadge` (dynamic: Live BCCh / Persisted BCCh / Static MVP) + footer names Chile sources | ✅ Accurate — badge reflects the real per-request outcome | `GET /api/macro` | Done |
| Macro · US band | `macroIndicators.json` baseline; `/api/macro` → **FRED live for 9 indicators** (Phase 8D), else static | `hybrid` (was `static_mvp`) | Own `DataSourceBadge` next to the US band, now dynamic (Live FRED / Persisted / Static MVP) — no longer permanently static | ✅ Fixed 8D | `GET /api/macro` | Done (Phase 8D) |
| Watchlist (formerly "Tracked Stocks") | The user's real Supabase-persisted `/watchlist` selection (Phase 6A) — `GET /api/watchlists` + `/api/watchlists/[id]/items` — merged with static/Supabase/Yahoo price data (same 3-tier price merge as Stocks/Company) | `hybrid` (or unauthenticated/empty states, never an error) | `MarketDataSourceBadge` in the band row + `TableSourceFooter` ("Source: Yahoo Finance as of …") | ✅ Fixed (Macro/Home overhaul task) — previously a hardcoded first-8-companies list unrelated to the user's actual `/watchlist` selection; merged with FX into one band-separated table (Ticker/Company/Price/Day Chg/YTD — Market Cap column removed) | `/api/watchlists`, `/api/watchlists/[id]/items`, `/api/market/stocks`, `/api/market/live-snapshot` | Done |
| FX table (Home) | Live BCCh FX indicators (`getByCategory('FX')`, same category the Macro page uses — USD/CLP, EUR/CLP), merged with the Watchlist table into one band-separated card | `hybrid` | `DataSourceBadge` (Live BCCh / Persisted / Static) + `TableSourceFooter` | ✅ Accurate (this row was stale — the table moved off `fxRates.json` to live BCCh data back in Phase 8D.1) | `GET /api/macro` | Done |
| Chilean rates | `chileanRates.json` baseline, overlaid with live BCCh values for the 4 rows with a verified series (BTU 10, BTU 5, Cámara Swap 2Y, Cámara Swap 1Y — via the already-fetched `liveIndicatorMap`); BTP 10/BCU 5/PDBC 90d/TPM-TNA stay static (no BCCh series exists, documented deferred since Phase 4B) | `hybrid` (was `static_mvp`) | `DataSourceBadge` (dynamic) + `TableSourceFooter` ("Banco Central de Chile (BCCh) — live where a verified series exists") | ✅ Fixed (Home overhaul follow-up) — was permanently static despite 4 of its 8 instruments already having a verified live BCCh series elsewhere in the app | `GET /api/macro` (same call the Macro card already makes) | Done |
| Earnings (upcoming/recent) | `earnings.json` only | `static_mvp` | "Source: CMF FECU — static sample" (dropped false "Static MVP" phase framing) | ✅ Accurate | — | See Earnings page section — P2 for real ingestion |
| Hechos Esenciales feed | `hechosEsenciales.json` only; live path exists but is CAPTCHA-blocked | `blocked` | "Source: CMF — blocked (CAPTCHA), static sample" | ✅ Accurate, now explains *why* | — | See Hechos page section — P2 pending a CAPTCHA-free path |
| Sector heat map | `sectorPerformance.json` baseline → Supabase auto-load → Yahoo Finance on refresh | `hybrid` | `MarketDataSourceBadge` (dynamic; was wrongly using the BCCh-flavored `DataSourceBadge` until fixed same session) + footer names Yahoo Finance via BCS | ✅ Fixed 8A (was static_mvp-labeled while actually hybrid, and briefly mislabeled "BCCh persisted" from a badge-component mix-up) | `/api/market/sectors`, `/api/market/live-snapshot` | Done |
| Markets / index changes | `indexPerformance.json` baseline → Supabase auto-load → Yahoo Finance on refresh | `hybrid` | `MarketDataSourceBadge` (dynamic) + footer now says Yahoo Finance, not the fabricated "Bloomberg" | ✅ Fixed 8A | `/api/market/indices`, `/api/market/live-snapshot` | Done |
| News | `news.json` only | `static_mvp` | "Live ingestion available in a future phase · Sources: emol.com, df.cl, ..." | ✅ Already honest (names candidate sources, doesn't claim a specific phase) | — | See News section — P2/P3 |

---

## Stocks (`/stocks`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Price table | `stockPrices.json` baseline → Supabase auto-load → Yahoo Finance on refresh | `hybrid` | `MarketDataSourceBadge` (dynamic) added 8A; footer corrected from a false "Brain Data" reference to "Static baseline · Persisted via Supabase · Live overlay via Yahoo Finance" | ✅ Fixed 8A (was P0 — named a provider never actually integrated) | `/api/market/stocks`, `/api/market/live-snapshot` | Done |
| Subtitle | — | — | "Bolsa de Comercio de Santiago via Yahoo Finance" (was "future source: Brain Data / BCS" — Brain Data was tried and blocked per `docs/market_data_provider_discovery.md`, not a real future path) | ✅ Fixed 8A | — | Done |

---

## Compare (`/compare`) — wired to persisted/live market data in Phase 8B

`src/lib/compare/resolveCompareData.ts` (server-only) + `GET /api/compare?tickers=`
reuse the existing static/supabase/hybrid market-data orchestrator
(`marketProvider.ts`) — no new provider was added. `src/lib/compare/compareTypes.ts`
defines the per-field `CompareFieldSource` classification (`live` ·
`persisted` · `static_fallback` · `temporary_static` · `unavailable`) so no
field is ever silently static without a caller-visible label.

| Module | Current source | Status | UI label (after 8B) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Market Data panel — price, day change, market cap, sector, currency | `getLatestStockSnapshots()` via `resolveStockSnapshots()` (static → Supabase-persisted → Yahoo Finance live overlay, same helper Stocks/Home/Company already use) | `hybrid` (persisted in practice today) | New "Market Data" panel with `MarketDataSourceBadge` (dynamic) + "as of" snapshot date | ✅ New in 8B — real per-request status, verified showing "Persisted market data" in hybrid mode locally | `GET /api/compare?tickers=` | Done |
| Short-term performance (1D / 5D) | `resolveStockHistory(ticker, timeframe)` — Supabase `stock_snapshots` history when sufficient | `persisted` when ≥ threshold, else `static_fallback` with explicit `fallbackReason: insufficient_supabase_history` | Per-cell tooltip shows the fallback reason when not persisted | ✅ New in 8B — verified: 1D/5D show `persisted` once ≥2 days of accumulated snapshots exist | same | Done |
| Short-term performance (1M / YTD / 1Y) | Same helper; currently **falls back to static** because Supabase has only accumulated ~2 days of snapshot history so far (Phase 4C.4 started recently) | `static_fallback` (`insufficient_supabase_history`) | Same per-cell tooltip | ✅ Honest — will flip to `persisted` automatically as more daily snapshots accumulate, no code change needed | same | **P1** — self-resolving as ingestion continues; revisit thresholds in `src/lib/market/marketHistory.ts` (`HISTORY_MIN_POINTS`) if they prove too strict/loose |
| Comparative Returns table + chart (custom date range, annualized, benchmark, difference-vs-reference) | `stockHistory.json` only (quarterly/weekly/daily static series through 2025-06-17) | `temporary_static` | Footer: "Historical returns and fundamentals: static MVP sample — see Market Data panel above for persisted/live fields" | ✅ Accurate — this feature (custom ranges, CAGR, benchmark diff) needs years of daily history Supabase hasn't accumulated yet | — | **P2** — revisit once `stock_snapshots` has ≥1Y of daily rows; until then this is a legitimate temporary-static feature, not a mislabel |
| Fundamentals table (P/E, EV/EBITDA, op/gross margin, net debt/EBITDA, FCF yield, dividend yield) — **overall: `hybrid`** | `financial_metrics`/`financial_statement_items` (manual CSV interim bridge — automated CMF/FECU/XBRL/vendor/broker source is the final-state target) via `getLatestFinancialMetrics()`/`getLatestStatementItems()`, combined with market price/cap already resolved above — derived field-by-field in `buildFundamentals()` | `derived` per field when persisted inputs exist, else `static_fallback` | Each derived cell gets a small `•` marker (title references "manual CSV interim bridge; automated ingestion planned"); table header note: "Static unless marked • — derived from persisted financials" | ✅ Fixed 8C — verified: SQM-B/BSANTANDER/COPEC (imported) show 7 derived fields each; a bank ticker with no EBITDA correctly shows `null` (not a fabricated ratio) instead of `evEbitda`/`netDebtEbitda`. Verified end-to-end that a simulated `cmf_fecu` write automatically supersedes the `manual_csv` row for the same period via the same repository function (no code change) | `GET /api/compare?tickers=` | Done |
| Fundamentals fields with no persisted equivalent (P/S fwd, ROE, P/B) | `stockPrices.json` static valuation snapshot | `static_fallback` (pending automated financials ingestion) | No `•` marker — plain static cell | ✅ Accurate — no forward-revenue estimate or book-value/equity line item is imported (out of scope: no estimates/consensus per project rule) | — | P3 — would need a `total_equity` statement-item code + a real estimates source, neither in scope |

---

## Charting (`/chart-builder`) — wired to persisted financials in Phase 8C

**Overall module status: `hybrid`** — persisted/derived per ticker where financials have been imported
(manual CSV today, automated CMF/FECU/XBRL/vendor/broker/document-ingestion sources target — see the
"Automation-first source architecture" section above and the Fundamentals/Charting conversion-path entry
below), `static_fallback` otherwise. Manual CSV is explicitly an interim bridge, never the final source.

`src/lib/financials/resolveFinancials.ts` (server-only) + `GET /api/financials/[ticker]/statements`
build a `FundamentalRecord[]`-shaped series from persisted `financial_statement_items`/`financial_metrics`
(manual CSV import today) so the existing quarterly/TTM/annual aggregation logic works unchanged regardless
of source — a future automated provider writes into the exact same tables via the exact same repository
functions, no UI change required.

| Module | Current source | Status | UI label (after 8C) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Fundamentals chart (per ticker) | Persisted `financial_statement_items`/`financial_metrics` when any reporting period has been imported for that ticker; `fundamentals.json` otherwise | `persisted` or `static_fallback` | `SourceStateBadge` in the toolbar (`financialsPersisted` / `fundamentalsStatic`) + updated subtitle/footer naming both paths | ✅ New in 8C — verified: SQM-B (imported) shows "Persisted financials via manual CSV" with the exact imported Q1 2025 values; any non-imported ticker (e.g. FALABELLA) falls back to `fundamentals.json` unchanged | `GET /api/financials/[ticker]/statements` | Done |
| Two-ticker overlay ("vs" company) | Same resolver, called independently per ticker | Same per-ticker | Same badge reflects ticker A only (each ticker can be in a different state) | ✅ Accurate — a persisted ticker vs. a static-fallback ticker is a legitimate mixed state, not mislabeled | same | Done |

**Remaining limitation (documented, not a defect):** revenue/net-income YoY are always `null` for persisted records — the CSV import model has no cross-period YoY derivation yet (would need a prior-year lookup). Static `fundamentals.json` records still carry precomputed YoY values since those were curated by hand. No fake YoY is ever shown for persisted data.

---

## Earnings (`/earnings`) — wired to earnings_events in Phase 8C

**Overall module status: `hybrid`** — persisted per ticker where an earnings event has been imported
(manual CSV interim bridge; automated CMF/FECU/XBRL/vendor/broker source is the final-state target),
`static_fallback` otherwise.

`GET /api/earnings[?ticker=]` returns persisted `earnings_events` (manual CSV import today — see the
"Automation-first source architecture" section above for why a future automated source needs no schema
or API change). The page merges persisted events (ticker-level: any ticker with ≥1 persisted event uses
persisted rows exclusively for that ticker) with `earnings.json` for every other ticker.

| Module | Current source | Status | UI label (after 8C) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Recent Results / Upcoming (persisted tickers) | `earnings_events` (manual CSV) | `persisted` | `SourceStateBadge` (`earningsPersisted`) next to "Recent Results"; quality-pill column shows the real `status` (Reported/Expected/Preliminary/Missing) instead of a fabricated Clean/Mixed/Weak judgment; Rev. Surprise column shows `—` (title: "No estimates source") since no consensus is imported | ✅ New in 8C — verified: SQM-B/BSANTANDER/COPEC show real imported revenue/EBITDA/net income/EPS, honest `—` for YoY and surprise, "Reported" status pill; COPEC's Q2 2025 "expected" row correctly appears in the Upcoming table | `GET /api/earnings` | Done |
| Recent Results / Upcoming (non-persisted tickers) | `earnings.json` (unchanged) | `static_mvp` | Same page, no badge on these specific rows (page-level footer names both sources) | ✅ Accurate — full original feature set (YoY, consensus/surprise, Clean/Mixed/Weak quality, key driver) preserved exactly for tickers with no import yet | — | Done — see Fundamentals/Charting conversion-path entry below for remaining scope (analyst-estimates source) |

**Never do:** show a "beat/miss" surprise percentage for a persisted (manual-CSV) row — there is no
estimates source for imported data, and the UI explicitly renders `—` rather than inferring one.

---

## Hechos Esenciales (`/hechos-esenciales`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Filings table | `hechosEsenciales.json` only; live provider is a shell (`cmfHechosProvider.getHechos()` always returns `ok:false`) | `blocked` | Subtitle: "Material disclosures filed with CMF" (dropped "future source: CMF API"). Footer: "CMF live ingestion not active (public portal requires CAPTCHA) · static MVP sample" (was "Phase 4 will connect CMF API" — a confirmed-sounding promise for something that is architecturally blocked, not just pending) | ✅ Fixed 8A — this was the clearest P0 in the whole audit | `GET /api/cmf/hechos` (returns static via the orchestrator) | Blocked — see CMF section below |

---

## CMF Live Ingestion — Current State (all consumers)

Confirmed directly from `docs/cmf_provider_discovery.md` (Phase 5A.1 discovery run):

- The CMF Hechos Esenciales public search form (`hechos.php` → `hechos2.php`) requires an **image CAPTCHA** (`/biblioteca/captcha2/captcha_hechos.php`) before returning any results.
- Automated CAPTCHA bypass is prohibited by project rules — this is a **structural block**, not a temporary one.
- `src/lib/providers/cmf/cmfHechosProvider.ts` is an explicit shell: every method returns `{ ok: false, reason: 'NOT_IMPLEMENTED' }`.
- All CMF-sourced UI (Hechos Esenciales page, Home's Hechos feed, Earnings' CMF FECU references, Document Viewer) is static by necessity, not by an unfulfilled "will connect" promise.
- **Do not** phrase any CMF label as "Phase N will connect CMF API" — always use "CMF live ingestion not active" / "blocked (CAPTCHA)" wording (fixed everywhere in 8A).
- Documented future paths (`docs/cmf_provider_discovery.md` §Phase 5A.2-alt), none confirmed: official `api.cmf.cl` (banking/insurance-focused, HE coverage unconfirmed), a licensed CMF data feed, a broker/aggregator feed that might include CMF HE, or manual CSV/PDF ingestion if documents are supplied directly.

---

## Macro (`/macro`, includes Chile/US sub-tabs)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Indicator rows (both regions) | `macroIndicators.json` baseline → `/api/macro` (BCCh live for Chile only) | `hybrid` (Chile) / `static_mvp` (US) | Dynamic `DataSourceBadge` per fetch — already correct pre-8A | ✅ Accurate | `GET /api/macro` | Done (already correct) |
| Chart popup (history) | `macroHistory.json` baseline → `/api/macro/history/[id]` (Supabase persisted, or BCCh live, or static) | `hybrid` | Dynamic `DataSourceBadge` (`histStatus`) + footer, which previously said "Static sample data · Phase 4: BCCh BDE API" **directly under a badge that could say "live" or "persisted"** — fixed to "Historical values via Banco Central de Chile (BCCh)" (source description only, no status claim, since the badge already states status) | ✅ Fixed 8A — this was a real P0 (redundant/conflicting footer under an accurate dynamic badge) | `GET /api/macro/history/[indicatorId]` | Done |
| Economic calendar — US (`/macro/calendar`) | FRED Releases API for **dates** + FRED **time-series** for **actual/previous** (Phase 8D.3), both `FRED_API_KEY`/keyless server-only | `live` (dates + real actual/previous; **no consensus**) | `t.cal.noConsensus` + `t.cal.enrichedNote` (names FRED + BLS/BEA/Census/Fed origins, disclaims consensus/forecast/surprise) | ✅ Accurate — real actual/previous from verified FRED series; consensus structurally `null`; NFP via `level-diff` (never raw level) | `GET /api/macro/fred-release-calendar` (enriched) | Done (8D.3) |
| Economic calendar — Chile (`/macro/calendar`) | None — no free/stable/structured official BCCh/INE release-date source verified | `unavailable` (honest deferred block, no fake rows) | `t.cal.chileUnavailable` | ✅ Accurate — explicit deferred state, never fabricated | — | **P3** — see §5/§10 of `macro_market_source_coverage.md` |
| Home page's "today's releases" widget | *(removed — calendar production-integrity fix)* | — | Replaced with a plain link to `/macro/calendar` | ✅ Fixed — the widget previously rendered fabricated forecast/actual/prior values from `src/lib/data/calendar.ts` | — | Done |
| FX depth table — Chile (`/macro`, CL region) | *(removed from production)* — was `fxRates.json` static sample, `CL_FX` id list | — | Plain integrity note pointing to the live BCCh USD/CLP + EUR/CLP rows in the indicators table above | ✅ Fixed — the table had no live/persisted backing at all; removed rather than left as a fabricated-looking static table, see §14 of `macro_market_source_coverage.md` | — | Done |
| FX depth table — US (`/macro`, US region) | **Frankfurter** (free, no API key, 84 central banks), `GET /api/macro/fx/us`, server-cached 6h | `live` (or `unavailable` if a fetch fails) | `SourceStateBadge` ("Live — Frankfurter FX reference (free third-party)") + explicit disclaimer footer + `†` marker on derived (inverted) pairs | ✅ Replaced CurrencyFreaks this task — 12 USD-base pairs (8 direct + 4 inverted) with **real 1D and YTD % change** computed from Frankfurter time-series, never fabricated (`null` when a snapshot is missing) | `GET /api/macro/fx/us` | Done — see §14 of `macro_market_source_coverage.md` |
| Yield curve chart (both regions) | **US:** 5 already-verified FRED series (3M/2Y/10Y/20Y/30Y) · **CL:** 5 already-verified BCCh series (TPM, Cámara Swap 1Y/2Y, BTU 5Y/10Y) — `GET /api/macro/yield-curve?region=`, server-cached 6h | `live` (or falls back to the static curve if under-populated) | `DataSourceBadge` (Live BCCh / Live FRED / Static MVP) + `TableSourceFooter` | ✅ New this task — today/1-week-ago/prior-year-end computed via bounded date windows on already-verified series (no new/unverified series codes); a tenor with no usable point on/before all 3 target dates is dropped entirely rather than fabricated. CL curve mixes nominal (TPM, swaps) and UF-real (BTU) tenors — labeled `(UF)` on the affected tenors. US curve is 5 tenors (vs. the prior 11-tenor static sample) since FRED's other constant-maturity series (1M/6M/1Y/3Y/5Y/7Y) were not live-verified this task (no network access from the dev sandbox) — candidate for future expansion once verified | `GET /api/macro/yield-curve` | Done — see §15 of `macro_market_source_coverage.md` |
| Economic calendar — current-month embed (`/macro` main tab, US region) | Same FRED release calendar, filtered to `[1st, last day]` of the current calendar month via `GET /api/macro/fred-release-calendar?start=&end=` | `live` (dates + real actual/previous) | Embedded `EconomicCalendarTable` (shared with `/macro/calendar`) + "View full calendar →" link for other months | ✅ New this task — Chile shows the same honest deferred message as `/macro/calendar` (no fabricated Chile rows) | `GET /api/macro/fred-release-calendar?start=&end=` | Done |
| Macro page subtitle (region-aware) | `t.macro.clSubtitle` / `t.macro.usSubtitle` — now actually wired to `SectionHeader` (previously a fixed `t.macro.subtitle` was shown regardless of region, incorrectly naming Banco Central de Chile/INE/**Hacienda** even on the US tab; Hacienda was never actually a data source for any indicator) | — | Region-aware subtitle | ✅ Fixed this task | — | Done |
| Market Implication column (indicators table, both regions) | *(removed)* — was static editorial commentary (`marketImplication` in `macroIndicators.json`), never a real data field | — | Column dropped; `formatMacroValue`/`Value`/`Change`/`Period`/`Source` remain | ✅ Removed per explicit instruction — the underlying `marketImplication` field stays in the data model/type but is no longer rendered as a table column | — | Done |

---

## Company Detail (`/companies/[ticker]`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| KPI strip (current price/day change) | `stockPrices.json` baseline → Supabase auto-load → Yahoo Finance on refresh | `hybrid` | `MarketDataSourceBadge` — **added in 8A** (previously this exact mixed-source pattern had no badge at all on this page, unlike Stocks) | ✅ Fixed 8A | `/api/market/stocks/[ticker]`, `/api/market/live-snapshot` | Done |
| Historical price chart | `stockHistory.json` only, no live/persisted path for the chart series itself | `static_mvp` | "Historical chart: static sample · Current price: see badge above" (was "Static sample data · Phase 7: Bolsa de Comercio de Santiago" — Phase 7 as originally scoped already happened in spirit via 4C.1-alt, and the old wording didn't distinguish the static chart from the now-live current price) | ✅ Fixed 8A — explicit mixed-card wording per the audit rule | — | P1 — see Phase 8B (same short-timeframe Supabase history work) |
| Valuation grid | `stockPrices.json` static snapshot fields | `static_mvp` | (no separate label — same page footer) | ✅ Accurate by omission | — | P2 — needs Phase 8C financials layer |
| "+ Watchlist" action | — (was a purely decorative `StatusPill variant="soon"`, not a real control) | n/a | Now a working link to `/watchlist` (was a dead "coming soon" pill for a feature that has existed since Phase 6A) | ✅ **Fixed 8A — P0.** This was a false "not available yet" claim for a feature that has worked in production since Phase 6A | — | Done. P3 (optional, not this phase): pre-select/pre-add the ticker when landing on `/watchlist` from this link |
| Earnings/valuation footnote | `earnings.json` | `static_mvp` | "MM CLP · EPS in CLP · Static MVP sample" (unchanged, already honest) | ✅ Accurate | — | See Earnings section |

---

## Watchlist (`/watchlist`, auth required)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Watchlist membership (which tickers) | Supabase `watchlist_items` table, user-scoped, RLS-protected | `persisted` | Covered by the corrected footer below | ✅ Accurate | `/api/watchlists`, `/api/watchlists/[id]/items` | Done |
| Prices shown per ticker | `stockPrices.json` only — **no live/persisted overlay on this page** | `static_mvp` | Footer was "Personal watchlist · Supabase" — misleadingly implied prices were Supabase-sourced when only list *membership* is. Fixed to "Watchlist membership: persisted via Supabase · Prices: static sample" | ✅ **Fixed 8A — P0** (mixed-card mislabel: the persisted part and the static part were conflated into one claim) | — | **P1** — trivial to add the same Supabase/Yahoo overlay pattern already used on Stocks/Home/Company |

---

## Portfolio (`/portfolio`, auth required)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Positions, transactions, cash ledger | Supabase (`portfolios`, `portfolio_positions`, `portfolio_transactions`, `portfolio_cash_ledger`), user-scoped, RLS-protected | `persisted` | "Personal portfolio · Supabase · Pricing: latest Supabase market snapshot" | ✅ Already accurate (built correctly in Phase 6C/6D) — no change needed | `/api/portfolios/*` | Done — no action needed |
| Current price used for valuation | `getLatestStockSnapshots()` (Supabase) | `persisted` | Covered by the same footer | ✅ Accurate | — | Done |

---

## Login (`/login`)

No data-source claims on this page (authentication only) — not applicable.

---

## Global elements

| Element | Before 8A | After 8A | Notes |
|---|---|---|---|
| TopBar "MVP" pill (`t.topbar.mvp`) | "Static MVP" | "MVP" | The product is still MVP-stage feature-wise, but "Static" was no longer true for large parts of the app (macro, market, auth, watchlist, portfolio are all live/persisted in places) |
| Footer disclaimer (`t.topbar.disclaimer`, shown on every page via `AppDisclaimer`) | "Static MVP data · Not investment advice · Live data integrations planned" | "Not investment advice · Data sourcing varies by module — see source badges" | **The single highest-impact P0 fix this phase** — this blanket claim appeared on literally every page, including ones with genuinely live/persisted badges directly above it |

---

## Structured Notes (`/structured-notes`) — Phase 9A–9E

**Overall module status: `persisted` (terms + scheduled snapshots) + `live`/`unavailable` (on-demand levels) — no static-terminal state.**

- **Terms** (ISIN, issuer, dates, barriers, coupon, underlyings, schedules): **persisted** in the 7
  user-scoped `structured_note*` Supabase tables, written automation-first from term-sheet PDF extraction
  (deterministic multi-issuer parser router — Citi, HSBC, Crédit Agricole, BNP Paribas, and Barclays validated
  at confidence 1.0; BBVA extracts cleanly but always forces manual review on the one real draft sample
  available). Provenance + confidence recorded per note and per field.
- **Internal allocations** (entity/sociedad split): **user input** — internal portfolio data, never extracted
  from a PDF.
- **Current underlying levels + distance to barrier + risk status**: **live** via the Yahoo provider on every
  page load (`structuredNoteMarketProvider.ts`, "Update" button = immediate refresh) **and now also
  `persisted`** via a daily scheduled cron (`structured_note_price_snapshots`, Phase 9D) — **replaces the
  workbook's Bloomberg `BDP`**, labeled everywhere as a monitoring estimate, never an official
  calculation-agent determination. An unmapped/unverified underlying reports `unavailable`, never a
  fabricated level.
- **Observation status** (coupon/autocall/final): **persisted + automated** (Phase 9D) — a scheduled cron
  evaluates any observation whose valuation date has arrived using worst-of barrier math against the
  persisted levels, and applies the one deterministic automatic transition this module allows (autocall
  eligible + clean data → note `autocalled`). Final/maturity observations are always flagged
  `review_required` — never auto-finalized without an official source.
- **Monitoring health**: `GET /api/structured-notes/monitoring-status` (authenticated) — latest run, latest
  snapshot date, stale/unsupported/review-required/due-soon counts, plus (Phase 9E) `providerSummary`,
  `fallbackProviderUsed`, and `providerDisagreement`.
- **Market-data architecture (Phase 9E):** a provider abstraction + fallback/sanity-check orchestrator +
  quote-quality rule set (staleness, invalid/large-move detection, cross-provider disagreement) now sits in
  front of Yahoo. Free-provider discovery found **no viable secondary source** (Stooq is blocked by a JS
  proof-of-work wall, confirmed live — see `docs/structured_notes_market_data_sources.md`), so Yahoo remains
  the sole active provider; the abstraction is ready for a second provider with zero orchestrator changes.
  Every quote is labeled `free_monitoring_estimate` or `proxy` — never `official`.
- **Conversion path (next):** extend the parser to remaining templates (Santander, older-2024 Citi); revisit
  free-provider discovery periodically (a new no-key source could appear) or evaluate a paid/vendor feed if
  ever authorized; add an official calculation-agent or verified closing-price source for final/maturity
  determinations. See `docs/structured_notes_design.md`.
- **Never static-terminal:** the module is either persisted (imported terms, scheduled snapshots), live
  (on-demand market levels), or explicitly `unavailable`/`review_required` — there is no fabricated/static-forever field.

---

## Conversion Paths for Remaining Static Modules (Phase 8B)

Per the no-static-terminal-state policy above, every module still serving
static data has a concrete target source, conversion path, blocker (if any),
next phase, and priority — none is an open-ended "Static MVP" with no plan.

### FX / Chilean rates — ✓ copper + EUR/CLP live via BCCh (Phase 8D/8D.1); FX panel now BCCh-only

- **Done in Phase 8D:** Copper (`cobre-lme`) is now **live via BCCh** — `F019.PPB.PRE.40.M`, monthly, USD/lb, verified against the official SearchSeries/GetSeries catalog. See `docs/macro_market_source_coverage.md` §1.
- **Re-verified, still deferred (Phase 8D, no live series exists):** BTP-10, BCU-5, PDBC-90d, TPM-TNA. See `docs/macro_market_source_coverage.md` §2.
- **Done in Phase 8D.1:** **EUR/CLP** (`F072.CLP.EUR.N.O.D`) is now **live via BCCh** — verified in Phase 8D, re-confirmed and wired this phase (new `macroSeries.ts`/`bcchSeriesManualMap.ts` entries, `macroIndicators.json` static fallback, `macro_indicators` DB row inserted, 2,486 rows persisted). See `docs/macro_market_source_coverage.md` §3.
- **Done in Phase 8D.1 — FX panel cleaned up to BCCh-only:** the Home page's FX table no longer reads from the static `fxRates.json` (23 fabricated-source rows with fake "Bloomberg"/"CoinMarketCap" attributions). It now renders directly from the live macro `FX` category (2 rows: USD/CLP, EUR/CLP), inheriting the standard `DataSourceBadge` live/persisted/static status automatically. Removed: the sectioned Key-FX/USD-per/per-USD/Yen-per grouping, the "# of currency per USD" helper label, and the "Static MVP sample" footer. See `docs/macro_market_source_coverage.md` §8 for the full per-pair removal reasoning.
- **Done (FX Integrity Task):** the Macro-page FX depth table is resolved for both regions — Chile's table (which had no live/persisted backing at all) was **removed from production**, replaced with a plain integrity note; the US table now uses **Frankfurter** (free, no API key) with real 1D/YTD change. `fxRates.json`/`fxRates.ts` remain in the repo, marked test/demo-only, with a regression test guarding against a production re-import. See `docs/macro_market_source_coverage.md` §14.
- **Target source:** Banco Central de Chile BDE API (same provider already live for macro) for any additional confirmed Chile series; Frankfurter now covers the non-Chile FX crosses BCCh doesn't publish (EUR/USD, GBP/USD, USD/JPY, etc.).
- **Conversion path:** extend `bcchSeriesManualMap.ts` with any additional verified Chile series, then persist to `macro_observations` (already the table copper/EUR-CLP use).
- **Blocker:** none — both the Chile-only and US-cross paths now have a resolved, honest data source (BCCh-live and Frankfurter-live respectively).
- **Next phase:** none — this module is complete (Chile-only + Frankfurter-live).
- **Priority:** Done.

### US macro — ✓ implemented via FRED (Phase 8D); category bug fixed, NFP deferred (Phase 8D.1)

- **Done in Phase 8D:** 9 US indicators are now **live via FRED** (Federal Reserve Bank of St. Louis public CSV endpoint, no API key) — Fed Funds, US 3M/2Y/10Y/20Y/30Y Treasury yields, US Unemployment, US CPI m/m and y/y. See `docs/macro_market_source_coverage.md` §4.
- **Fixed in Phase 8D.1 — category classification bug:** both live providers hardcoded `category: 'Rates'`/`'US Rates'` for every indicator, regardless of its true category (copper/CPI/UF/unemployment all misfiled). `MacroSeriesDef` gained a proper `category` field, matched exactly against `macroIndicators.json`; both providers now read it instead of hardcoding. Regression-tested. See `docs/macro_market_source_coverage.md` §7.
- **NFP `diff` transform — implemented in Phase 8D.3 (was deferred in 8D.1):** the new `level-diff` transform (`transforms.ts`) derives the headline Nonfarm Payrolls month-over-month change from `PAYEMS` (a cumulative employment *level*). It is used by the calendar's actual/previous enrichment (Employment Situation release) — the raw level is never shown as the headline. A standalone NFP *macro indicator* card is still not added (calendar enrichment covers the headline print). See `docs/macro_market_source_coverage.md` §11.
- **Deferred (Phase 8D, considered and rejected):** ISM/PMI (no free FRED series); a recession/leading-indicator series (FRED's `USREC` is a binary dummy, doesn't fit the value/change model).
- **Remaining static fields:** US GDP and DXY (both stay `static_mvp` pending a future phase).
- **Target source:** FRED (done, for the 9 series above + a future `diff` transform for NFP); no free reliable source exists for US GDP/DXY-equivalent releases at the same cadence.
- **Conversion path:** for NFP, add a `diff` transform to `transforms.ts` and thread it through both providers; for GDP, add the FRED series id to `usFredSeriesManualMap.ts`.
- **Next phase:** add a `diff` transform + NFP UI slot if desired; wire US GDP via FRED if desired.
- **Priority:** P2 (NFP `diff` transform + UI slot); done for the 9 series + category fix above.

### Economic calendar — dates-only FRED calendar implemented (Phase 8D.1); synthetic calendar removed from production (calendar production-integrity fix)

- **Done in Phase 8D.1:** a genuine free, official, structured **dates-only** calendar via FRED's Releases API (`https://api.stlouisfed.org/fred/release/dates`, distinct from the CSV graph endpoint), requiring a free server-only `FRED_API_KEY`. 13 curated releases (CPI, PPI, PCE, Employment Situation, JOLTS, ADP, GDP, Retail Sales, Industrial Production, Housing Starts/Sales, Existing Home Sales, International Trade) verified live. **A real data-quality issue was found and excluded**: 2 candidate releases (FOMC Press Release, H.15 Selected Interest Rates) returned near-daily noise rather than discrete dates — confirmed via live testing, removed from the allowlist rather than shipped. No persistence, no migration, no new cron — live-queried on each page load. See `docs/macro_market_source_coverage.md` §9.
- **Done in the calendar production-integrity fix (post-8D.1):** a read-only audit found the schedule-driven synthetic table (`src/lib/data/calendar.ts` — deterministic pseudo-random forecast/actual/prior values, including Chile rows referencing BCCh/INE by name with no actual backing) was sitting in production above the real FRED panel on `/macro/calendar`, plus powering a "today's releases" widget on `/macro`. Both were removed from production. `/macro/calendar` now shows only the real FRED calendar plus an honest Chile-deferred block (no fabricated rows); `/macro` links out to the full calendar instead of rendering a fabricated preview. `src/lib/data/calendar.ts` is retained but explicitly marked test/demo-only, with a regression test (`tests/calendarProductionIntegrity.test.ts`) asserting no production route imports it. See `docs/macro_market_source_coverage.md` §10.
- **Done in Phase 8D.3 (actual/previous enrichment):** each curated US release is now enriched with **real `actual` and `previous` values** derived from verified FRED **time-series** (release dates still from the FRED release calendar — two distinct, honestly-labeled sources). 11 releases mapped (`src/config/calendarEnrichmentMap.ts`), each tagged with its `originatingAgency` (BLS/BEA/Census/Fed) for provenance; the fetched source is always FRED and labeled as such. Consensus/forecast/surprise remain unavailable by design. New `level-diff` transform derives headline NFP from `PAYEMS` (never the raw level). ADP (stale `NPPTTL`) and Existing Home Sales (NAR) excluded — dates-only, not fabricated. Direct BLS/BEA/Census API integration assessed and deferred (FRED normalized sourcing, per never-guess rule). Weekday post-close refresh cron `/api/cron/refresh-calendar-enrichment` (`30 22 * * 1-5`, Bearer `CRON_SECRET`, stateless). See `docs/macro_market_source_coverage.md` §11.
- **Not found (searched, not guessed):** University of Michigan Consumer Sentiment, ISM Manufacturing/Services PMI — no matching FRED release exists.
- **Not found (Chile):** no free, stable, structured official BCCh/INE release-date source — government sites publish only rendered HTML, ruled out by the standing no-scraping policy.
- **Target source:** FRED Releases API (done, for the 13 curated releases above); Chile remains unavailable pending a real official structured source.
- **Conversion path:** if usage justifies it, add persistence (a `calendar_events`-style table) and/or expand the allowlist if new relevant FRED releases are found; periodically re-check for a Chile official calendar source.
- **Blocker:** none for the 13 curated US releases; Consumer Sentiment/ISM PMI have no FRED release-dates source; Chile has no verified free/stable/structured source at all.
- **Next phase:** consider persistence if usage grows; periodically re-check for Consumer Sentiment/ISM PMI and Chile calendar source availability.
- **Priority:** P3 (persistence); done for the dates-only US calendar and the Chile-deferred honesty fix above.

### Fundamentals / Charting — ✓ automation-ready manual-CSV-first step complete (Phase 8C); CMF/XBRL discovery complete, `feasible_with_mapping` (Phase 8C.1)

- **Done in Phase 8C:** `company_reporting_periods`, `financial_statement_items`, `financial_metrics`, `earnings_events` Supabase tables (migration `20260704000000_financials_foundation.sql` + automation-ready upgrade `20260705000000_financials_automation_ready.sql` adding `source_priority`/`is_superseded`/`superseded_by`/`ingestion_run_id`/`source_file`/`source_as_of` to all 4 tables); CSV templates in `data/import_templates/`; parser/validator in `src/lib/financials/csvFinancials.ts`; ingestion script `scripts/ingest/financialsCsv.ts` (`npm run ingest:financials:dry` / `ingest:financials -- --write`); Charting and Compare's Fundamentals table both read from these tables where any data has been imported for a ticker, falling back to `fundamentals.json`/`stockPrices.json` otherwise.
- **Manual CSV is explicitly interim** — every write function in `financialsRepository.ts` accepts `sourceType` as data, not a hardcoded assumption; `source_priority` derives automatically from `source_type`; the supersession mechanism was verified end-to-end (a simulated `cmf_fecu` row automatically superseded a `manual_csv` row for the same period via the same upsert function, zero code change).
- **Corrected in Phase 8C.1 — CMF financial-statement access is NOT CAPTCHA-blocked** (unlike Hechos Esenciales): a real discovery pass (`docs/cmf_xbrl_provider_discovery.md`) found and verified a working two-step public HTTP chain (`entidad.php` by RUT+period → parse the "Estados financieros (XBRL)" href → download) with no CAPTCHA and no login, confirmed by actually downloading genuine XBRL ZIP archives for two real companies (Ripley Chile and Empresas Copec, an app-covered ticker). Feasibility verdict: **`feasible_with_mapping`** — real but unofficial/undocumented, not `feasible_now` like the BCCh API. A provider abstraction (`src/lib/financials/providers/types.ts`), a working `cmfXbrlProvider.ts`, a dependency-free XBRL parser (`src/lib/financials/xbrl/parseXbrl.ts`), and a conservative concept map (`src/lib/financials/xbrl/conceptMap.ts`) were built and tested. The provider honestly reports `not_implemented` at the unzip step (a real ZIP download was proven; no zip-extraction dependency was added this phase) rather than pretending an end-to-end import works.
- **Remaining static fields:** any ticker with no CSV import yet (most of the 25-company universe — only SQM-B/BSANTANDER/COPEC have sample data as of this phase); P/S forward, ROE, P/B on Compare (no forward-revenue estimate or book-value/equity line item is imported); revenue/net-income YoY on Charting for persisted tickers (no cross-period YoY derivation yet).
- **Target source (final state):** the CMF/XBRL provider built this phase, once (a) a zip-extraction step is added, (b) more tickers are verified in `cmfIssuerMap.ts` (only SQM-B and COPEC verified so far; BSANTANDER's RUT could not be confirmed and stays unmapped), and (c) the fetch chain has been exercised enough times to build confidence it's stable — or, alternatively, a licensed vendor-data feed, a broker-supplied statement feed, or a document-ingestion (PDF/filing) pipeline. Any of these write into the *same* 4 tables via the *same* `financialsRepository.ts` upsert functions, just with a different `sourceType`. No schema change, no new table, no UI rewrite.
- **Conversion path (next):** (a) add a zip-extraction dependency and wire `cmfXbrlProvider.fetchFiling` end-to-end; (b) verify more issuer RUTs manually (never guessed); (c) exercise the fetch chain against more tickers/periods and monitor stability over time before considering scheduled ingestion; (d) real company-by-company CSV imports continue in parallel as low-risk data entry; (e) a `total_equity`/`book_value` statement-item code to unlock ROE/P/B derivation.
- **Blocker:** none technical (CAPTCHA claim from before Phase 8C.1 was wrong for this specific surface — corrected here) — the remaining work is engineering (zip extraction) and caution (an undocumented HTML surface should be exercised and monitored before being trusted for unattended ingestion), not a hard block.
- **Next phase:** continue CMF/XBRL automation (zip extraction, more issuers) or **Phase 8D+** (CSV coverage growth continues regardless, as it's pure data entry).
- **Priority:** P1 (more CSV imports, pure data entry — ongoing) / P2 (CMF/XBRL automation — real progress made, not yet production-ready).

### Earnings — ✓ automation-ready manual-CSV-first step complete (Phase 8C); shares the same CMF/XBRL discovery as Fundamentals/Charting (Phase 8C.1)

- **Done in Phase 8C:** `earnings_events` table (with the same provenance/supersession columns as the other 3 financials tables) + `GET /api/earnings`; the page merges persisted events (ticker-level) with `earnings.json` for every other ticker; persisted rows show a real `status` (Reported/Expected/Preliminary/Missing) instead of a synthetic quality judgment, and correctly show `—` for Rev. Surprise (no fabricated consensus for imported data).
- **Remaining static fields:** any ticker with no persisted earnings event yet; the synthetic revenue-surprise/consensus fields (`genEarningsConsensus.mjs`) remain on the static-fallback path only, clearly derived, never claimed as real.
- **Target source (final state):** same CMF/XBRL/vendor/broker/document-ingestion automation path as Fundamentals/Charting (same tables, same repository — see above, feasibility now confirmed `feasible_with_mapping`, not blocked), plus a genuine analyst-estimates source before any real "surprise" language could ever be shown for persisted data (out of scope — no consensus/estimates ingestion planned).
- **Conversion path (next):** more CSV imports (pure data entry, same schema); the same CMF/XBRL provider integration path as Fundamentals/Charting; a real estimates vendor would be a separate, larger scope decision if ever pursued.
- **Blocker:** none technical for the earnings-events schema itself; no analyst-estimates vendor in scope (unchanged).
- **Next phase:** **Phase 8D+** (CSV coverage growth) / continue CMF/XBRL automation / not planned (real consensus estimates — explicitly out of scope per project rules).
- **Priority:** P1 (more CSV imports) / P2 (CMF/XBRL automation) / not planned (real consensus).

### Hechos Relevantes (Hechos Esenciales)

- **Current static fields:** `hechosEsenciales.json` — all filings.
- **Target source options** (none confirmed): (a) an official CMF API if one is ever published (banking/insurance APIs exist at `api.cmf.cl`; HE coverage unconfirmed); (b) a licensed/vendor data feed that redistributes CMF filings; (c) manual upload of filings as they're published; (d) email/PDF ingestion if CMF or the companies themselves can be a direct source.
- **Conversion path:** discovery first for options (a)/(b) — confirm whether either actually covers Hechos Esenciales before building anything; (c)/(d) need no discovery, just a manual intake workflow + a `cmf_filings` table already compatible with the existing `hechosEsenciales.json` shape.
- **Blocker:** the CMF public HTML portal requires an image CAPTCHA — confirmed structurally blocked via a real discovery run (`docs/cmf_provider_discovery.md`, Phase 5A.1). This is a **blocked-with-workaround** state, not a plain static-MVP state — the workaround options above exist and are documented, none implemented yet.
- **Next phase:** **Phase 8E**.
- **Priority:** P2 (manual upload workaround) / P3 (official API or vendor feed, unconfirmed to exist).

### News

- **Current static fields:** `news.json` — all articles, including realistic wire-service attributions (e.g. "Bloomberg / LME") that are part of the mock content itself, not a claim about this app's own data infrastructure (see the News Module Rule in `CLAUDE.md`) — keep this convention for any future sample data, but do not confuse it with a live vendor relationship.
- **Target source options:** (a) curated manual JSON updated periodically; (b) RSS feeds from named outlets (emol.com, df.cl, diarioestrategia.cl); (c) a licensed news API; (d) folding into the Hechos Esenciales pipeline once/if a CAPTCHA-free CMF path exists.
- **Conversion path:** (a) is the zero-infrastructure starting point; (b) needs a scheduled fetch + dedup layer and a content-reproduction review (RSS excerpts only, per the copyright rule); (c) is a real vendor cost/relationship; (d) depends entirely on the Hechos Relevantes blocker above being resolved first.
- **Blocker:** none for (a)/(b) — this is available whenever prioritized, just not started. No aggressive scraping in any option.
- **Next phase:** **Phase 8E**.
- **Priority:** P2 (manual/RSS) / P3 (licensed API).
