# Data Source Status Matrix — Phase 8A / 8B

Audit date: 2026-07-02 (Phase 8A) · updated 2026-07-02 (Phase 8B — Compare
real-data wiring + no-static-terminal-state policy). This is the canonical
truth-layer reference for what each visible module's data source actually is,
versus what its UI label says. Update this file whenever a module's data
source changes (new ingestion, provider swap, or label fix) — it is the
single source of truth other docs (`CLAUDE.md`, `README.md`) summarize from.

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
| Fundamentals table (P/E, margins, ROE, FCF yield, etc.) | `stockPrices.json` static valuation snapshot | `temporary_static` | Table header shows "(Temporary static · pending financials/FECU ingestion (Phase 8C))" inline | ✅ New explicit label in 8B — was previously just implied by the page-level footer | — | **P2** — see Phase 8C plan below |

---

## Charting (`/chart-builder`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Fundamentals chart | `fundamentals.json` (FECU line items) only | `static_mvp` | Chart footnote: "Source: CMF FECU — Static MVP sample" (unchanged, already honest) + bottom `SourceNote`: was "future source: CMF · manual CSV", now "static MVP sample" (dropped the presumptive future-source claim per the CMF-wording rule) | ✅ Fixed 8A | — | **P2** — see Phase 8C plan below |

**Recommended Phase 8C plan (not implemented this phase):**
- Needs a real financial-statement ingestion layer: `financial_statements`, `financial_metrics`, `company_reporting_periods` tables (Supabase), sourced from either (a) a CMF FECU parser once a CAPTCHA-free CMF path exists, or (b) manual CSV import as a nearer-term unblock.
- Manual CSV first is the pragmatic starting point — it needs no new external dependency and directly replaces the static JSON with persisted, still-manually-curated data.

---

## Earnings (`/earnings`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Upcoming + recent results | `earnings.json` only | `static_mvp` | Generic `common.mvpNote` footer, now "Data sourcing varies by section — see the source label/badge above" (was "Static MVP · sample data · live sources in Phase 4", which named a phase this page has no relationship to) | ✅ Fixed 8A | — | **P2** — see below |
| Revenue-surprise / consensus | Synthetic, deterministically generated (`genEarningsConsensus.mjs`), not real analyst estimates | `static_mvp` | (no separate label; covered by the page-level note) | ✅ Accurate by omission — the surprise % is clearly derived, not claimed as real consensus data anywhere in the UI copy | — | P3 — do not add a "surprise" claim without a real estimates source (per project rule) |

**Recommended next step:** same manual-CSV-first path as Charting (Phase 8C) — a real reporting calendar + normalized results needs the same `financial_statements`/`company_reporting_periods` schema, plus a `result_quality` classification rule and an explicit "estimates source" field before any beat/miss language can be shown as real.

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

### Fundamentals / Charting

- **Current static fields:** `fundamentals.json` (FECU line items — Income Statement, Cash Flow, Balance Sheet, Returns to Shareholders) and Compare's Fundamentals table (P/E, margins, ROE, FCF yield, etc. from `stockPrices.json`).
- **Target source:** CMF FECU filings (ideal, but blocked — see Hechos Relevantes below) or manual CSV import as the pragmatic first step.
- **Conversion path:** new `financial_statements`, `financial_metrics`, `company_reporting_periods` Supabase tables; manual CSV import script populates them quarter-by-quarter; Charting and Compare's Fundamentals table both read from the same tables once populated, replacing `fundamentals.json`/the static valuation fields in `stockPrices.json`.
- **Blocker:** CMF FECU parsing is blocked the same way Hechos Esenciales is (CAPTCHA) — manual CSV is the only near-term unblock.
- **Next phase:** **Phase 8C**.
- **Priority:** P2.

### Earnings

- **Current static fields:** `earnings.json` (upcoming + recent results), synthetic revenue-surprise/consensus fields (`genEarningsConsensus.mjs`).
- **Target source:** same `financial_statements`/`company_reporting_periods` schema as Fundamentals/Charting (Phase 8C), plus a genuine analyst-estimates source before any real "surprise" language is shown (current synthetic consensus is clearly derived, never claimed as real — do not change that until a real estimates source exists).
- **Conversion path:** same manual-CSV-first path as Charting; a `result_quality` classification rule and an explicit "estimates source" field are required before beat/miss language can be labeled as real (not synthetic).
- **Blocker:** same CMF CAPTCHA block for the ideal source; no analyst-estimates vendor currently in scope.
- **Next phase:** **Phase 8C**.
- **Priority:** P2 (financials) / P3 (real consensus estimates — separate, larger scope).

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
