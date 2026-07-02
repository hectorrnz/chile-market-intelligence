# Data Source Status Matrix — Phase 8A

Audit date: 2026-07-02. This is the canonical truth-layer reference for what
each visible module's data source actually is, versus what its UI label says.
Update this file whenever a module's data source changes (new ingestion,
provider swap, or label fix) — it is the single source of truth other docs
(`CLAUDE.md`, `README.md`) summarize from.

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

## Compare (`/compare`)

| Module | Current source | Status | UI label (after 8A) | Accuracy | API route | Priority |
|---|---|---|---|---|---|---|
| Returns table + chart | `stockHistory.json` only | `static_mvp` | "Static MVP sample — historical returns and fundamentals" (was vague "live data in Phase 4 / 7") | ✅ Fixed 8A | — | **P1** (see Phase 8B plan below) |
| Fundamentals table | `stockPrices.json` valuation fields (static snapshot) | `static_mvp` | Same footer | ✅ Accurate | — | P1/P2 — see Phase 8B |

**Recommended Phase 8B plan (not implemented this phase):**
- Day change / price already exist live+persisted via `getLatestStockSnapshots()` (Stocks/Home/Company already use it) — wiring the *current-value* row of the Returns table to that same helper is low-risk, no new provider.
- Multi-day/period returns need enough **persisted daily history** in `stock_snapshots` to compute a real return over each timeframe; Phase 4C.4 only started accumulating this recently, so short timeframes (1D/5D) may already have enough rows, longer ones (1Y/3Y) will not yet.
- Benchmark (IPSA) can come from `index_snapshots` the same way.
- Fundamentals (P/E, margins, etc.) remain static-only until a financials ingestion layer exists (see Phase 8C).

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

## News — Source Strategy (Phase 8D candidate, not implemented)

Currently 100% static (`src/data/news.json`). The existing footer already names
candidate future sources without over-promising a specific phase — left as-is.
Recommended options for a future phase, in rough order of effort:
1. **Curated manual JSON**, updated periodically by hand — zero new
   infrastructure, matches the "no aggressive scraping" rule outright.
2. **RSS feeds** from named outlets (emol.com, df.cl, diarioestrategia.cl) —
   low effort, but requires a scheduled fetch + dedup layer and a content
   ownership/reproduction review (RSS excerpts only, never full-article
   reproduction).
3. **Licensed news API** (e.g. a financial news aggregator) — real cost,
   most reliable, but a new vendor relationship to set up.
4. **CMF filings feed** once/if a CAPTCHA-free CMF path exists — would fold
   into the Hechos Esenciales pipeline rather than being a separate "News"
   source.

## Economic Calendar — Source Strategy (Phase 8D candidate, not implemented)

Currently schedule-driven with synthetic values (`src/lib/data/calendar.ts`).
Recommended options:
1. **BCCh publication calendar** — if BCCh publishes a machine-readable release
   schedule (separate from the BDE data API already integrated), this would
   let real release *dates* replace the synthetic ones even before real
   *values* are wired.
2. **INE calendar** — same idea for INE-published series (CPI, unemployment).
3. **Manually maintained JSON**, updated a few times a year as release
   calendars are published — lowest effort, no scraping.
4. **External macro-calendar API** (e.g. a paid economic-calendar vendor) —
   most complete, but a new vendor relationship.

Do not scrape either BCCh's or INE's site aggressively or use undocumented
endpoints — same rule as the CMF portal.
