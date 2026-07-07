# Data Source Status Matrix — Phase 8A / 8B / 8C / 8C.1

Audit date: 2026-07-02 (Phase 8A) · updated 2026-07-02 (Phase 8B — Compare
real-data wiring + no-static-terminal-state policy) · updated 2026-07-03
(Phase 8C — manual CSV financial-statement ingestion: Charting, Compare
fundamentals, and Earnings now read persisted data where imported; upgraded
same day to an automation-first schema) · updated 2026-07-03 (Phase 8C.1 —
CMF/XBRL automated-provider discovery: found and verified a working,
CAPTCHA-free public path to real financial-statement XBRL filings — see the
Fundamentals/Charting and Earnings sections below for the corrected
feasibility assessment). This is the canonical truth-layer reference for what
each visible module's data source actually is, versus what its UI label says.
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
| Macro · US band | `macroIndicators.json`, no live path exists (BCCh has no US series) | `static_mvp` | Own `DataSourceBadge status="static"` next to the US band (was previously sharing Chile's badge — fixed 8A) | ✅ Accurate | — (static only) | Done. P3: a real US macro provider (FRED API) would need Phase 4-style work — not planned |
| Tracked stocks | `stockPrices.json` baseline → Supabase auto-load → Yahoo Finance on refresh click | `hybrid` | Refresh button + timestamp only, no explicit badge | ⚠️ Minor gap — works correctly, just no badge (unlike Stocks/Company pages) | `/api/market/stocks`, `/api/market/live-snapshot` | **P1**: add `MarketDataSourceBadge` next to Tracked Stocks header for parity with Stocks page |
| FX table | `fxRates.json` only, no live/persisted path | `static_mvp` | "Static MVP sample" (fabricated "Source: Bloomberg" removed in 8A) | ✅ Accurate | — | P3: a real FX feed is a new-provider project, not planned |
| Chilean rates | `chileanRates.json` only, no live/persisted path | `static_mvp` | "Source: Banco Central · BCS — Static MVP sample" | ✅ Accurate | — | P3 |
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
| Economic calendar (`/macro/calendar` + Home's "today" widget) | `src/lib/data/calendar.ts` — schedule-driven, deterministic, but **values are synthetic** (not fetched from BCCh/INE) | `static_mvp` | `common.mvpNote`, now "Data sourcing varies by section — see the source label/badge above" | ⚠️ Slightly generic for this specific page — the calendar has no live path at all (unlike Macro's own indicator table), so a calendar-specific note would be more precise. Deferred to Phase 8D (see below) | — | **P3** — see Economic Calendar section |

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

## Structured Notes (`/structured-notes`) — Phase 9A–9C

**Overall module status: `persisted` (terms) + `live`/`unavailable` (levels) — no static-terminal state.**

- **Terms** (ISIN, issuer, dates, barriers, coupon, underlyings, schedules): **persisted** in the 7
  user-scoped `structured_note*` Supabase tables, written automation-first from term-sheet PDF extraction
  (deterministic multi-issuer parser router — Citi, HSBC, Crédit Agricole, BNP Paribas, and Barclays validated
  at confidence 1.0; BBVA extracts cleanly but always forces manual review on the one real draft sample
  available). Provenance + confidence recorded per note and per field.
- **Internal allocations** (entity/sociedad split): **user input** — internal portfolio data, never extracted
  from a PDF.
- **Current underlying levels + distance to barrier + risk status**: **live** via the Yahoo provider
  (`structuredNoteMarketProvider.ts`, reusing the market stack) — **replaces the workbook's Bloomberg `BDP`**.
  An unmapped/unverified underlying reports `unavailable`, never a fabricated level.
- **Conversion path (next):** extend the parser to remaining templates (Santander, older-2024 Citi); persist
  scheduled price snapshots + automate observation-event transitions (coupon-paid / autocalled). See
  `docs/structured_notes_design.md`.
- **Never static-terminal:** the module is either persisted (imported), live (market levels), or explicitly
  `unavailable` — there is no fabricated/static-forever field.

---

## Conversion Paths for Remaining Static Modules (Phase 8B)

Per the no-static-terminal-state policy above, every module still serving
static data has a concrete target source, conversion path, blocker (if any),
next phase, and priority — none is an open-ended "Static MVP" with no plan.

### FX / Chilean rates

- **Current static fields:** all rows in `fxRates.json` and `chileanRates.json` (Key FX, USD-per, per-USD, Yen-per sections; BTU/BTP/BCU/swap/PDBC/TPM-TNA rows).
- **Target source:** Banco Central de Chile BDE API (same provider already live for macro) — several of these rates (BTU 10Y/5Y, Cámara Swap 1Y/2Y, TPM) are **already verified BCCh series** per `src/config/bcchSeriesManualMap.ts`; the remainder (BTP-10, BCU-5, PDBC-90d, most FX crosses) have no confirmed BCCh series yet.
- **Conversion path:** extend `bcchSeriesManualMap.ts` with any additional verified series (`npm run bcch:search` / `npm run bcch:validate` — never hand-guess codes), then persist to `macro_observations` (reusing the existing table) or a dedicated `fx_observations`/`rates_observations` table if the shape doesn't fit. FX crosses without a BCCh series (e.g. EURUSD, USDJPY) would need a separate FX provider — not BCCh.
- **Blocker:** none for the already-verified rate series (BTU/swap/TPM) — this is a P1 wiring task, not new-provider work. FX crosses need a new provider decision.
- **Next phase:** **Phase 8D**.
- **Priority:** P1 for the already-verified BCCh rate series; P2 for FX crosses needing a new provider.

### US macro

- **Current static fields:** all 6 US indicators in `macroIndicators.json` (`region: "US"`) — Fed Funds, US 10Y, US CPI y/y, US GDP, US Unemployment, DXY.
- **Target source:** FRED (Federal Reserve Economic Data) API — free, official, well-documented; or BLS/BEA APIs for CPI/GDP specifically if FRED coverage is insufficient.
- **Conversion path:** mirror the BCCh provider pattern exactly — `usMacroProvider.ts` implementing the same `MacroProvider` contract, a manual series-ID mapping file (same never-guess-codes discipline as `bcchSeriesManualMap.ts`), persistence into `macro_observations` (already supports a `region`/source-agnostic shape).
- **Blocker:** none structural — FRED has a free, immediate-signup API key. This is genuinely new-provider work, not wiring existing data.
- **Next phase:** **Phase 8D**.
- **Priority:** P2.

### Economic calendar

- **Current static fields:** `src/lib/data/calendar.ts` — schedule-driven release dates are deterministic/recurring, but **values are synthetic**.
- **Target source:** BCCh and INE publication calendars (release *dates*) first; real *values* would come from the same BCCh BDE API already integrated once a release date passes.
- **Conversion path:** (1) find/confirm a machine-readable BCCh/INE release-schedule endpoint if one exists (discovery step, not yet done); (2) persist confirmed dates to a `calendar_events` table; (3) backfill actual values from `macro_observations` once a scheduled release date is in the past, replacing the synthetic placeholder for that specific event.
- **Blocker:** unconfirmed whether BCCh/INE publish a machine-readable calendar at all — needs a discovery pass (same rigor as the CMF/Brain Data discovery docs) before implementation starts. No scraping of either site.
- **Next phase:** **Phase 8D**.
- **Priority:** P2 (dates) / P3 (values, depends on dates first).

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
