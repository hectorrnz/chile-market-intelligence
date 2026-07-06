# Implementation Plan — Chile Market Intelligence

This document defines the build sequence. Each phase has a clear deliverable and a definition of "done." No phase should begin until the prior phase is confirmed complete by the user.

---

## Phase 0 — Project Foundation (current)

**Goal:** Establish the project skeleton before writing any application code.

Tasks:
- [x] Write `docs/product_spec.md`
- [x] Write `docs/data_dictionary.md`
- [x] Write `docs/design_principles.md`
- [x] Write `docs/implementation_plan.md`
- [x] Write `CLAUDE.md`

**Done when:** User has reviewed and approved these documents.

---

## Phase 1 — Next.js Scaffold ✓ COMPLETE

**Goal:** Create a working, empty Next.js application that matches the target stack.

Stack note: Next.js 16 + Tailwind CSS v4 was installed (not v3). In Tailwind v4, the
color palette and fonts are configured via `@theme` blocks in `globals.css` rather than
`tailwind.config.ts`. All design principles still apply — only the configuration location changed.

Tasks:
- [x] Initialize Next.js 16 project with TypeScript and Tailwind CSS v4.
- [x] Configure system fonts and dark base styles in `globals.css` via `@theme` (Tailwind v4).
- [x] Set up full folder structure per plan.
- [x] Create `Sidebar`, `TopBar`, `AppShell` layout components.
- [x] Create `SectionHeader` and `StatusPill` UI components.
- [x] Create `src/lib/navigation.ts`, `src/lib/formatters.ts`, `src/types/index.ts`.
- [x] Create stub pages: Home, Stocks, Macro, Earnings, Hechos Esenciales, Company Detail, Watchlist.
- [x] Create empty `src/data/*.json` stubs for all five entities.
- [x] Create `scripts/README.md` and `.env.local.example`.
- [x] Verify app builds without errors: `npm run build` → 0 errors, 0 warnings.

**Done.**

**Folder structure:**
```
chile-market-intelligence/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout with sidebar
│   │   ├── page.tsx            # Home dashboard
│   │   ├── stocks/
│   │   │   ├── page.tsx        # Stocks table
│   │   │   └── [ticker]/
│   │   │       └── page.tsx    # Company detail
│   │   ├── macro/
│   │   │   └── page.tsx
│   │   ├── earnings/
│   │   │   └── page.tsx
│   │   └── hechos-esenciales/
│   │       └── page.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   └── PageHeader.tsx
│   │   ├── tables/
│   │   │   ├── StocksTable.tsx
│   │   │   ├── EarningsTable.tsx
│   │   │   └── HechosTable.tsx
│   │   └── ui/
│   │       ├── MetricCard.tsx
│   │       ├── Badge.tsx
│   │       └── SortableHeader.tsx
│   ├── data/                   # Static JSON files (MVP)
│   │   ├── companies.json
│   │   ├── stock_prices.json
│   │   ├── earnings.json
│   │   ├── hechos_esenciales.json
│   │   └── macro_indicators.json
│   ├── lib/
│   │   ├── types.ts            # TypeScript interfaces from data_dictionary.md
│   │   └── formatters.ts       # Chilean number/date formatting
│   └── styles/
│       └── globals.css
├── scripts/                    # Python scripts for future data ingestion
│   └── README.md
├── docs/
├── public/
├── .env.local.example          # Template for environment variables
├── CLAUDE.md
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

**Done when:** `npm run dev` shows all five tab pages with sidebar navigation. No real data yet — placeholder text is fine.

---

## Phase 2 — Static Data Layer ✓ COMPLETE

**Goal:** Populate all pages with realistic static data in JSON files. No live APIs.

Tasks:
- [x] Write `src/types/index.ts` with all TypeScript interfaces.
- [x] Write `src/lib/formatters.ts` with Chilean locale formatting functions.
- [x] Populate `src/data/companies.json` with 25 real Chilean companies.
- [x] Populate `src/data/stockPrices.json` with last-known prices for all 25 companies.
- [x] Populate `src/data/macroIndicators.json` with 12 indicators (Rates, Inflation, FX, Activity, Commodities, Labor).
- [x] Populate `src/data/earnings.json` with 14 records including 2 upcoming.
- [x] Populate `src/data/hechosEsenciales.json` with 15 filings.
- [x] Populate `src/data/news.json` with 8 news items.
- [x] Build typed data helpers in `src/lib/data/` (companies, stocks, macro, earnings, hechos, news).
- [x] Build UI components: `MaterialityBadge`, `EmptyState`, `SearchInput`, `SourceNote`.
- [x] Rewrite Home dashboard with real data (macro panel, hechos, earnings, stocks table, news).
- [x] Rewrite Stocks page with full table, sort, sector filter, search.
- [x] Rewrite Macro page grouped by category with real indicators.
- [x] Rewrite Earnings page with upcoming calendar and recent results.
- [x] Rewrite Hechos Esenciales page with search, type filter, category filter.
- [x] Rewrite Company Detail page with KPI strip, earnings, hechos, news.
- [x] Rewrite Watchlist page with Phase 6 notice and mock preview table.
- [x] Add i18n keys: `macro.commodities`, `macro.labor`, all Phase 2 section/column labels.

**Done.** All 9 routes build cleanly (0 errors). `npm run build` passes.

### Data layer architecture
```
src/data/           — Static JSON source files (MVP)
src/lib/data/       — Typed accessor helpers (no direct JSON imports in pages)
src/types/index.ts  — TypeScript interfaces for all entities
```

Page components import from `src/lib/data/*`, never from JSON directly.

---

## Phase 2B — Data/UI Consistency, Document Drill-Down, Layout Density ✓ COMPLETE

**Goal:** Consistency and completeness pass before Vercel deployment. No new data sources.

Tasks:
- [x] Add `.ui-number` CSS utility class in `globals.css` — body font with `tabular-nums`. Use on all numeric cells.
- [x] Remove `font-mono tabular-nums` from all non-ticker cells in all 7 pages.
- [x] All tickers still use `font-mono text-primary`.
- [x] Add `formatMacroValue()` and `formatMacroChange()` to `src/lib/formatters.ts`.
- [x] Normalize `changeLabel` fields in `macroIndicators.json` to consistent `%` format.
- [x] Add `DocumentRecord` interface to `src/types/index.ts`.
- [x] Create `src/data/documents.json` — 24 records (15 HE, 9 earnings), all `localStatus: external_only`.
- [x] Create `src/lib/data/documents.ts` — 5 typed accessor helpers.
- [x] Create `src/app/documents/[id]/page.tsx` — drill-down with AI summary, key points, source link.
- [x] Add "View Summary" column to Hechos Esenciales page (→ `/documents/[id]`).
- [x] Add "View Summary" column to Earnings results table.
- [x] Add `→` drill-down links to Home hechos panel and Home earnings panel.
- [x] News module: internal scroll, High-materiality Bloomberg NH-style red left stripe + tint; no badge text.
- [x] All dashboard/table pages use `w-full` instead of `max-w-screen-xl`.
- [x] Add `documents` section to `src/lib/i18n.ts` in both `en` and `es`.
- [x] Update `docs/data_dictionary.md`, `docs/product_spec.md`, `docs/implementation_plan.md`.

**Done.** All 9 routes (including new `/documents/[id]`) build cleanly. `npm run build` passes 0 errors.

**Key new files:**
- `src/types/index.ts` — added `DocumentRecord` interface
- `src/data/documents.json` — 24 DocumentRecord entries
- `src/lib/data/documents.ts` — typed accessor helpers
- `src/app/documents/[id]/page.tsx` — new document viewer route

**Key modified files:**
- `src/app/globals.css` — added `.ui-number` utility
- `src/lib/formatters.ts` — added `formatMacroValue`, `formatMacroChange`
- `src/lib/i18n.ts` — added `documents.*` keys in `en` and `es`
- `src/data/macroIndicators.json` — normalized `changeLabel` to `%` format
- All 7 page files — `w-full`, `ui-number`, drill-down links

---

## Phase 2C — Charts, Macro Expansion, Market Overview Modules ✓ COMPLETE

**Goal:** Add interactive history charts, US macro section, sector heat map, index changes, stock price chart, and richer company business summaries. All data remains static JSON.

Tasks:
- [x] Fix macro value/change ordering on Home dashboard (value first, change in parens)
- [x] Rename Home page title to "Market Overview"
- [x] Add `MacroHistoryPoint`, `StockHistoryPoint`, `SectorPerformance`, `IndexPerformance` interfaces to `src/types/index.ts`
- [x] Add `region?: 'CL' | 'US' | 'GLOBAL'` and US categories to `MacroIndicator`
- [x] Add `businessModel?`, `keyRevenueDrivers?`, `keyRisks?`, `sourceStatus?` to `Company`
- [x] Enlarge SectionHeader h1 from `text-sm` → `text-xl`
- [x] Create `src/data/macroHistory.json` — 42 quarterly points (2015 Q1 – 2025 Q2) for 18 indicators
- [x] Create `src/data/stockHistory.json` — 22 quarterly points for 8 key tickers
- [x] Create `src/data/sectorPerformance.json` — 10 Chilean GICS sectors
- [x] Create `src/data/indexPerformance.json` — 6 indices (IPSA + 5 LatAm/global)
- [x] Add 6 US macro indicators to `src/data/macroIndicators.json` (fed-funds, us10y, us-cpi-mensual, us-cpi-anual, dxy, bitcoin) with `region: 'US'`
- [x] Add `region: 'CL'` to all 12 Chile indicators
- [x] Add businessModel/keyRevenueDrivers/keyRisks to 7 key companies in `companies.json`
- [x] Create `src/components/charts/LineChart.tsx` — pure SVG chart, no external library
- [x] Create `src/lib/data/macroHistory.ts`, `stockHistory.ts`, `sectorPerformance.ts`, `indexPerformance.ts`
- [x] Update `src/lib/i18n.ts` — add sectorHeatMap, indexChanges, macro US section, company business model keys
- [x] Rewrite `src/app/macro/page.tsx` — clickable rows → SVG chart panel, 1Y/3Y/5Y/10Y toggle, Chile + US sections
- [x] Rewrite `src/app/page.tsx` — fixed macro ordering, sector heat map module, index changes module
- [x] Rewrite `src/app/companies/[ticker]/page.tsx` — LineChart + timeframe toggle, businessModel/keyRevenueDrivers/keyRisks panels, fixed earnings table alignment

**Done.** All 9 routes build cleanly. `npm run build` passes 0 errors.

**New files:**
- `src/data/macroHistory.json` — 756 quarterly macro history records
- `src/data/stockHistory.json` — 176 quarterly stock price records
- `src/data/sectorPerformance.json` — 10 sector entries
- `src/data/indexPerformance.json` — 6 index entries
- `src/components/charts/LineChart.tsx` — SVG line chart component
- `src/lib/data/macroHistory.ts`, `stockHistory.ts`, `sectorPerformance.ts`, `indexPerformance.ts`

**Modified files:**
- `src/types/index.ts` — new interfaces + extended MacroIndicator/Company
- `src/data/macroIndicators.json` — added 6 US indicators, region field on all
- `src/data/companies.json` — businessModel/keyRevenueDrivers/keyRisks for 7 companies
- `src/components/ui/SectionHeader.tsx` — text-xl heading
- `src/lib/i18n.ts` — new keys in both en and es
- `src/app/macro/page.tsx` — full rewrite
- `src/app/page.tsx` — full rewrite
- `src/app/companies/[ticker]/page.tsx` — full rewrite

---

## Phase 3 — Polish and Vercel Deployment ✓ COMPLETE (pre-deploy)

**Goal:** The app looks production-ready and is publicly accessible (with no auth needed for MVP).

Tasks:
- [x] Full build and code audit — lint 0, build 12 routes 0 errors, tests 13/13, no console logs, no external fetches, no hardcoded secrets.
- [x] Responsive layout QA — `min-width: 1200px` on `html` so narrow viewports scroll horizontally; macro chart modal capped at `max-h-[90vh]`.
- [x] Rich page metadata — description, applicationName, keywords, `robots: noindex`, openGraph, `Viewport` export.
- [x] Favicon — `public/favicon.svg` CMI monogram (navy, white text, 32×32).
- [x] Data disclaimer — `AppDisclaimer` footer (11px muted, `no-print`) with EN/ES text via i18n.
- [x] `docs/deployment.md` — prerequisites, local run, Vercel deploy options, rollback, env var table, data source map.
- [x] `README.md` — features, stack, data sources, limitations, next phases.
- [x] `.env.example` — placeholder template; `.gitignore` updated to keep it.
- [x] `public/` cleanup — removed unused default Next.js SVGs.
- [ ] Set up Vercel project (user action).
- [ ] Deploy with `vercel --prod` (user action — see `docs/deployment.md`).
- [ ] Verify all pages work on the deployed URL.

**Done when:** App is live on Vercel. URL shared with user.

---

## Phase 4 — Python Data Ingestion Scripts (parallel track)

**Goal:** Build the data pipeline that will eventually power the live version.

Tasks:
- [ ] `scripts/fetch_bcch.py` — fetch macro series from Banco Central BDE API.
- [ ] `scripts/fetch_cmf_hechos.py` — fetch recent HE filings from CMF.
- [ ] `scripts/fetch_prices.py` — fetch stock prices from Bolsa/Brain Data.
- [ ] Each script outputs a JSON file compatible with `src/data/` format.
- [ ] `scripts/README.md` documents API keys needed and how to run each script.

Note: These scripts run locally for now. They are not called by the Next.js app yet.

**Done when:** Each script runs successfully and produces valid JSON matching the TypeScript types.

---

## Phase 5 — Supabase Integration

**Goal:** Replace static JSON files with a live Supabase Postgres database.

Tasks:
- [ ] Create Supabase project.
- [ ] Define database schema (one table per entity in `data_dictionary.md`).
- [ ] Migrate static JSON data into Supabase.
- [ ] Update Next.js data-fetching functions to query Supabase instead of JSON.
- [ ] Store Supabase keys in `.env.local`.
- [ ] Test all pages against live database.

**Not included in this phase:** authentication, RLS, user-specific data.

**Done when:** All pages load data from Supabase. Static JSON files are archived but not deleted.

---

## Phase 6 — Authentication and Watchlist (future)

**Superseded — see "Phase 6A/6B — Authentication and Watchlist ✓ COMPLETE" and "Phase 6C — Portfolio Positions Foundation ✓ COMPLETE" further down this document.**

---

## Phase 7 — Live Price Integration (future)

Out of scope until Phase 5 is complete. Depends on procurement of a Bolsa de Santiago / Brain Data data subscription.

---

## Conventions for Future Prompts

When starting a new build session, the prompt should specify:
- Which phase we are in.
- Which specific task within that phase.
- Any decisions made since the last session.

Claude Code should:
- Read `CLAUDE.md` and `docs/design_principles.md` before writing any code.
- Confirm the task before starting implementation.
- After completing each task, list changed files and suggest the next task.

---

## Phase 4A — Live Macro Architecture (BCCh foundation) ✓

Builds the live-data ingestion architecture and the first live provider
foundation (Banco Central de Chile macro), without breaking static behavior.

- Data-mode system (`static` / `live` / `hybrid`) with a static-fallback guarantee.
- Provider abstraction (`src/lib/providers/`) — components never call APIs directly.
- BCCh BDE/SieteRestWS client (server-only, credential-safe, timeout-guarded).
- Series registry (`src/config/macroSeries.ts`) — **codes left as TODO until verified (4B)**.
- API routes: `/api/macro`, `/api/macro/history/[indicatorId]`.
- UI: static-first, upgrade-if-live; subtle `DataSourceBadge`.

**Still static in production** until BCCh credentials + verified series codes are added.

### Later phases (not in 4A)

- **Phase 4B** — map & verify official BCCh BDE series codes; enable live macro.
- **Phase 4C** — Chilean stock price provider (Bolsa de Santiago / Brain Data).
- **Later** — CMF Hechos Esenciales ingestion, CMF earnings ingestion, news ingestion.
- **Phase 5** — Supabase persistence. **Phase 6** — authentication + watchlist.

CMF (Hechos Esenciales, earnings), stock prices, and news ingestion are
**explicitly out of scope** until their dedicated phases.

---

## Phase 4B — BCCh Series Mapping & Validation ✓ (workflow)

Reproducible official-catalog workflow + controlled mapping layer + live
validation harness. **No codes verified yet** (no credentials available during
this phase) — all series remain disabled and the app serves static data.

- `npm run bcch:search` — official SearchSeries discovery → `tmp/bcch-series-candidates.json` (gitignored).
- `src/config/bcchSeriesManualMap.ts` — human-verified mapping (all `null`/`verified:false`).
- `npm run bcch:validate` — GetSeries + plausibility + frequency checks for verified series.
- `src/lib/providers/transforms.ts` + `plausibility.ts` — value/change transforms + sanity bands.
- Docs: `docs/bcch_series_mapping.md`.

Next: **Phase 4B.1** — run discovery with credentials, confirm & enable series.
Later phases (CMF, earnings, stock prices, US macro live, news) remain out of scope.

---

## Phase 4C — Chilean Market Data Provider Architecture ✓

Provider abstraction for Chilean equity/index data (Brain Data / Bolsa de Santiago),
mirroring the Phase 4A BCCh pattern. App continues to serve static data in production;
all Brain Data methods return `ok:false` until Phase 4C.1 obtains official credentials.

- `MARKET_DATA_MODE` env var (separate from `DATA_MODE`): `static` / `live` / `hybrid`.
- Provider abstraction: `src/lib/providers/market/` — types, mode, static, brainData, orchestrator.
- 5 API routes: `/api/market/stocks`, `/api/market/stocks/[ticker]`, `/api/market/stocks/[ticker]/history`, `/api/market/indices`, `/api/market/sectors`.
- Client-safe helpers: `src/lib/data/marketData.ts` (`fetchStockSnapshots`, etc.).
- Ticker map: `src/config/tickerMap.ts` — 25 Chilean equities, all `verified:false` / `providerSymbol:null`.
- Config: `src/config/marketDataProviders.ts` — Brain Data endpoints (all `status:'pending'`).
- Discovery doc: `docs/market_data_provider_discovery.md`.
- `MarketDataSourceBadge` component + `marketData.*` i18n keys.
- Tests: `tests/marketDataMode.test.ts` (9), `tests/marketProvider.test.ts` (10). Total suite: 72/72.
- Build: 19 routes · lint 0 · tests 72/72.

---

## Phase 4C.1-alt — Yahoo Finance Live Market Overlay ✓ COMPLETE (2026-06-30)

**Brain Data blocked:** The personal "Personas" account on `marketplace.bolsadesantiago.com`
does not expose the institutional API product. No self-service signup path exists.

**Solution:** Yahoo Finance as free unofficial fallback. Explicit user decision. See
`docs/market_data_provider_discovery.md` for full context and future Brain Data migration path.

### Delivery

- `scripts/refresh/refreshMarketData.py` — Python script using `yfinance`; fetches YTD close prices for all 25 tickers + 11 indices; writes `stockPrices.json`, `sectorPerformance.json`, `indexPerformance.json`, `marketMeta.json`.
- `scripts/refresh/requirements.txt` — `yfinance>=0.2.40`, `pandas>=2.0.0`.
- `.github/workflows/refresh-market-data.yml` — weekday GitHub Actions cron at **13:30 UTC** and **21:30 UTC**; commits only if data changed; `workflow_dispatch` for manual trigger.
- `src/lib/market/liveOverlay.ts` — pure aggregation logic (`TICKER_YF`, `SECTOR_MAP`, `INDEX_YF`, `buildStocks`, `buildSectors`, `buildIndices`); no Next.js imports; testable.
- `src/app/api/market/live-snapshot/route.ts` — GET route using `yahoo-finance2`; 10-second timeout; sanitized error responses; response includes `provider`, `symbolsSucceeded`, `symbolsFailed`.
- `src/lib/data/marketLiveData.ts` — client-safe fetch helper + `formatLiveTimestamp()`.
- `src/lib/data/marketMeta.ts` — `formatMarketLastUpdated()` from static `marketMeta.json`.
- `src/data/marketMeta.json` — static timestamp file (`lastUpdated: null` initially).
- `src/components/ui/MarketRefreshButton.tsx` — 3-state (idle/loading/done) subtle icon button; semantic tokens; no hardcoded colors.
- `src/app/page.tsx` — refresh button on Tracked Stocks and Sector Heat Map; live overlay on stocks, sectors, and indices.
- `src/app/stocks/page.tsx` — refresh button in toolbar; live price/dayPct/marketCap overlay per row.
- `src/app/companies/[ticker]/page.tsx` — refresh button in SectionHeader; live price/dayPct in KPI strip.
- `src/lib/i18n.ts` — `common.marketUpdated` key (en/es).
- `tests/marketLiveOverlay.test.ts` — 20 tests: ticker map invariants, buildStocks, buildSectors, buildIndices; mocked quotes, no live Yahoo calls.

**Build:** 24 routes · lint 0 · tests 234/234 · macro system unaffected.

### Fallback policy

If Yahoo Finance is unavailable:
- GitHub Actions step fails → no commit → last committed JSON remains in production
- `/api/market/live-snapshot` returns 503 → client retains static baseline → UI shows no error

### Known limitations

- Unofficial source; Yahoo may change its API without notice
- Quotes may be delayed 15 min during market hours
- Do not label as "official BCS data"
- No SLA or support

---

## Phase 5A — CMF Filings Provider Architecture ✓

Provider abstraction for CMF Hechos Esenciales, mirroring Phase 4A (BCCh) and Phase 4C (Brain Data) patterns.
App continues to serve static CMF data; live parser returns `ok:false` until Phase 5A.1 validates the
CMF portal HTML structure and confirms safe access.

- Discovery document: `docs/cmf_provider_discovery.md` — page structure, field mapping, robots/rate-limit notes.
- `CMF_DATA_MODE` env var (independent from `DATA_MODE` / `MARKET_DATA_MODE`): `static` / `live` / `hybrid`. Defaults to `static`.
- Provider abstraction: `src/lib/providers/cmf/` — `types.ts`, `cmfDataMode.ts`, `cmfClient.ts`, `staticCmfProvider.ts`, `cmfHechosProvider.ts` (shell, returns `ok:false`), `cmfProvider.ts` (orchestrator).
- HTML parser: `src/lib/providers/cmf/parsers/hechosListParser.ts` — pure regex, no external library; `parserConfidence` 0–1.0 per row; test fixture at `tests/fixtures/cmf/hechos_ultimos_7_dias.html`.
- 3 API routes: `/api/cmf/hechos`, `/api/cmf/hechos/[documentNumber]`, `/api/cmf/documents/[id]` — all return HTTP 200 with static fallback and metadata.
- Client-safe helpers: `src/lib/data/cmfData.ts` (`fetchCmfHechos`, `fetchCmfHecho`, `fetchCmfDocument`).
- Entity map: `src/config/cmfEntityMap.ts` — 25 Chilean tickers, all `verified:false` / `rut:null` / `cmfEntityUrl:null`.
- `CmfDataSourceBadge` component + `cmfData.*` i18n keys (en/es).
- Discovery script: `scripts/cmf/discoverHechos.ts` — one request per run, 10s timeout; `npm run cmf:discover-hechos`.
- Tests: `tests/cmfDataMode.test.ts` (11), `tests/cmfProvider.test.ts` (13), `tests/hechosParser.test.ts` (21). Total suite: 83/83.
- Build: 22 routes · lint 0 · tests 83/83.

Next: **Phase 5A.1** — run `npm run cmf:discover-hechos`, review parser confidence, confirm HTML structure,
update `cmfEntityMap.ts` with verified RUTs and entity URLs from official CMF registros, then enable live ingestion.
Or: **Phase 4C.1** — Brain Data credentials + live market price provider.

---

## Phase 5B — Supabase Persistence Foundation ✓

Schema-first Supabase integration. Static fallback always active. DB_MODE defaults to `static`.
See `docs/supabase_persistence.md` for setup guide.

- 11 tables created via migration `supabase/migrations/20260625000000_create_market_intelligence_core.sql`
- Seed via SQL Editor or `npm run supabase:seed` (reference data: 4 data_sources, 25 companies, 25 macro_indicators)
- Repository layer: `src/lib/db/repositories/` — companies, macro, market, cmf, documents, ingestion runs
- Connection check: `npm run supabase:check`
- Build 22 routes · lint 0 · tests 134/134

## Phase 5B.1 — Supabase Project Link & Seed ✓

Supabase project `nevada-market-intelligence` (cnxfougkpynovlwsmmdz) linked.
Migration applied via SQL Editor (Supabase CLI blocked by Windows AppLocker).
Seed applied. DB_MODE=hybrid active locally. Static fallback confirmed.

Key fixes: URL normalization (`normalizeProjectUrl`), PGRST205 detection, JS-based seed runner.

---

## Phase 5C — BCCh Macro Observations Ingestion ✓

Local ingestion pipeline that fetches all 11 verified BCCh series and persists normalized
observations into the `macro_observations` Supabase table.

### Prerequisites (one-time)
1. Paste `supabase/migrations/20260626000000_macro_obs_constraints.sql` into SQL Editor and run.
   (Adds 3 missing rate indicators + replaces partial index with UNIQUE constraint for upsert.)

### NPM scripts
| Script | Purpose |
|--------|---------|
| `npm run ingest:bcch-macro:dry` | Preview what would be written (no DB writes, --all) |
| `npm run ingest:bcch-macro -- --all --write` | Full 10Y backfill |
| `npm run ingest:bcch-macro -- --indicator tpm --years 1 --write` | Single indicator |
| `npm run ingest:bcch-macro -- --all --years 5 --write` | 5-year write |
| `npm run supabase:check-macro` | Validate DB counts + latest ingestion run |

### Files added/changed
- `supabase/migrations/20260626000000_macro_obs_constraints.sql` — UNIQUE constraint + 3 rate indicators
- `scripts/ingest/bcchMacroCore.ts` — pure testable logic (parseArgs, buildObservationRows, chunk, sanitizeError)
- `scripts/ingest/bcchMacro.ts` — CLI ingestion script (dry-run / write, sequential BCCh requests, 500-row batches, ingestion_runs record)
- `scripts/supabase/checkMacroObservations.ts` — validation script (`npm run supabase:check-macro`)
- `src/lib/db/repositories/macroRepository.ts` — added: upsertMacroObservations, getMacroObservations, getLatestMacroObservation, getMacroObservationSummary, getMacroIngestionStatus
- `src/lib/supabase/database.types.ts` — fixed macro_observations.Insert to include fetched_at
- `package.json` — added ingest:bcch-macro, ingest:bcch-macro:dry, supabase:check-macro scripts
- `tests/bcchMacroIngest.test.ts` — 28 new tests for pure ingestion functions
- Build 22 routes · lint 0 · tests 162/162

### Ingestion flow
1. Loads .env.local via @next/env
2. Validates BCCh credentials + Supabase admin credentials
3. Gets enabled series from getEnabledSeries() (11 series)
4. For each: fetches raw BCCh points (with +1 extra year for yoy context)
5. Applies transformSeries() → filters to requested date window → builds ObservationUpsertRow[]
6. In dry-run: prints preview. In write mode: upserts in 500-row batches
7. Records ingestion_runs row with status (dry_run / success / partial_success / failed)
8. Sequential requests with 200ms delay between indicators

### Security
- BCCh credentials never printed (sanitizeError strips user=, pass=, key=, JWTs)
- Supabase service-role key never printed
- --write flag required for any DB modification (default is dry-run)

Next: **Run the migration in SQL Editor**, then `npm run ingest:bcch-macro:dry`, then `npm run ingest:bcch-macro -- --all --write`.
Or: **Phase 5D** — wire observations into the live macro provider (serve DB values instead of static).

---

## Phase 6A/6B — Authentication and Watchlist ✓ COMPLETE

Supersedes the "Phase 6" placeholder above. Delivered in two parts:
- **6A**: Supabase Auth (originally magic-link email OTP), user-scoped `watchlists`/`watchlist_items` tables + RLS, protected `/watchlist` route and `/api/watchlists*` handlers.
- **6B**: replaced magic-link with **username + password** sign-in after the PKCE code-verifier proved unreliable to persist client-side in testing (see `src/lib/auth/sessionCookies.ts` for the fix — session cookies must be set directly on the response, not via `next/headers`, to survive a redirect in Next.js 16). Username doubles as the display name shown in the sidebar; recovery email is collected but never used for sign-in.

Full detail in `CLAUDE.md` → "Phase 6A" / "Phase 6B" entries. Migration files: `20260701000000_auth_watchlist_foundation.sql`, `20260701120000_username_password_auth.sql`.

---

## Phase 6C — Portfolio Positions Foundation ✓ COMPLETE

Adds the first portfolio-monitoring layer for authenticated users, following the exact pattern established by 6A's watchlist (same middleware protection style, same `getSupabaseUserClient()` + RLS ownership model).

- **Migration** `20260702000000_portfolio_foundation.sql` — `portfolios` + `portfolio_positions` tables, RLS (`auth.uid() = user_id` on every operation, `user_id` also defaults to `auth.uid()` at the column level), FK from `portfolio_positions.ticker` to `companies.ticker`.
- **Repository** `src/lib/db/repositories/portfolioRepository.ts` — CRUD scoped entirely through the session client; never accepts or sets a client-supplied `user_id`.
- **Valuation** `src/lib/portfolio/valuation.ts` — pure functions (market value, cost basis, unrealized P&L, sector exposure), NaN/Infinity-guarded, reading prices from `getLatestStockSnapshots()` (the same deduplicated-latest-snapshot helper the company-page charts already use — no new market ingestion).
- **Routes** `GET/POST /api/portfolios`, `GET /api/portfolios/[id]`, `POST /api/portfolios/[id]/positions`, `PATCH/DELETE /api/portfolios/[id]/positions/[ticker]`.
- **Page** `/portfolio` — summary cards (market value, cost basis, unrealized P&L/%, position count), sector-exposure bars, positions table with inline edit, add/remove.
- **Scope limits (intentional):** no transaction history, no realized P&L, no cash balance, no FX conversion, no performance attribution, no alerts, no AI summaries.

Next: **Phase 6D** — transaction history + cash ledger (to derive average cost from real buy/sell lots instead of a manually entered value), or **Phase 7A** — mobile-responsive foundation.
Or: **Phase 4C.1** — Brain Data credentials + live market price provider.

---

## Phase 6D — Transaction History and Cash Ledger Foundation ✓ COMPLETE

Lets positions be derived from real buy/sell lots instead of a manually entered quantity + average cost, while leaving the 6C manual-position flow fully intact for tickers that don't use it.

- **Migration** `20260703000000_portfolio_transactions_cash_ledger.sql` — `portfolio_transactions` (buy/sell, weighted-avg-cost-relevant fields, `realized_pnl`) + `portfolio_cash_ledger` (deposit/withdrawal/buy_cash_outflow/sell_cash_inflow/fee/tax/adjustment), check constraints on type/quantity/price/fees/taxes, RLS (`auth.uid() = user_id`), and a `check_portfolio_ownership()` trigger closing the gap where RLS alone can't verify a cross-table FK (`portfolio_id`) belongs to the same user. Deliberately does **not** alter `portfolio_positions` — reuses its existing `metadata` column (`positionSource`, `lastReconciledAt`) instead.
- **Math** `src/lib/portfolio/transactions.ts` — pure functions: `calculateTransactionAmounts`, `calculateAverageCostAfterBuy` (weighted average, fees/taxes folded into cost basis), `calculatePositionAfterSell` (quantity down, avg cost unchanged), `calculateRealizedPnl`, `rebuildPositionFromTransactions` (replays a ticker's full history, returns final state **and** per-transaction `steps[]` so realized P&L can be rewritten for every affected row after an edit/delete), `buildCashLedgerEntriesForTransaction`, `calculateCashBalance`, `calculatePortfolioCashSummary`.
- **Repository** `src/lib/db/repositories/portfolioTransactionRepository.ts` — add/update/delete always pre-validate the resulting full history via the replay function **before** writing anything (rejects an oversell, or a delete that would leave a later sell oversold); after a successful write, reconciles by re-fetching the ticker's transactions and writing back `realized_pnl` per step + upserting `portfolio_positions`. Blocks the first transaction for a ticker that already has a manual position (`manual_position_conflict`) — including pre-6D rows with no `metadata.positionSource`, treated as manual for backward compatibility.
- **Routes** `GET/POST /api/portfolios/[id]/transactions`, `PATCH/DELETE /api/portfolios/[id]/transactions/[transactionId]`, `GET/POST /api/portfolios/[id]/cash`. The existing `GET /api/portfolios/[id]` route now also returns `cashSummary` and `realizedPnl` in one response.
- **Page** `/portfolio` gains a tab bar (Positions / Transactions / Cash); the summary strip grows from 5 to 7 cards (added Realized P&L, Cash Balance); a transaction-derived position row shows a "Transactions" badge and its manual edit/remove controls are replaced with a locked indicator (directs the user to add a transaction instead, so a manual edit can never silently diverge from the reconciled state); manual positions show a "Manual" badge and keep full edit/remove.
- **Tests** `tests/portfolioTransactions.test.ts` — 52 tests: migration/RLS/ownership-trigger structural checks, all pure math (weighted average, realized P&L, oversell rejection, per-step realized-P&L replay), and a full add→buy→buy→sell→update→delete integration flow against an in-memory fake Supabase client verifying `portfolio_positions` reconciles correctly at every step.
- **Scope limits (intentional):** no FIFO/LIFO or specific-lot selection (weighted average only), no dividends, no time/money-weighted performance attribution, no broker/CSV import, no automated cash reconciliation. Multi-step writes are sequential (not a single DB transaction) — pre-validation keeps the ledger consistent in practice; documented as an accepted gap for this foundation phase.

Next: **Phase 7A** — mobile-responsive foundation, or **Phase 6E** — portfolio analytics / performance attribution.

---

## Phase 8A — Static MVP Audit and Data Source Truth Layer ✓ COMPLETE

An audit + label-cleanup phase, not a new-provider phase. By this point real live/persisted data exists in several places (BCCh macro, Yahoo Finance/Supabase market, Supabase auth/watchlist/portfolio) alongside modules that are genuinely still static or structurally CAPTCHA-blocked (CMF) — but many UI labels hadn't been touched since the original MVP mockup, so some pages understated what was already live, and others made confident-sounding "Phase N will connect" promises for things that were either already done or can never happen without a new access path.

**Canonical reference:** [`docs/data_source_status.md`](data_source_status.md) — full page-by-page source/status/label/accuracy/priority matrix. Update it whenever a module's source changes; other docs summarize it, they don't duplicate it.

- **New infrastructure:** `src/lib/dataSourceRegistry.ts` (7-state `SourceState` enum + EN/ES label registry) and `src/components/ui/SourceStateBadge.tsx` (shared badge for new call sites, matching the existing `DataSourceBadge`/`MarketDataSourceBadge`/`CmfDataSourceBadge` visual language).
- **P0 fixes:** the global "Static MVP data ... Live data integrations planned" disclaimer (shown on every page); Home's macro/sector/index footers (one conflicted with its own live badge, two claimed pure-static/fabricated-vendor while actually merging live+persisted+static); Stocks' "Brain Data" reference (tried and blocked, never integrated); Company page's dead "+ Watchlist (soon)" pill (Watchlist has worked since Phase 6A) replaced with a real link; Hechos Esenciales' and Home's CMF footers ("Phase 4 will connect CMF API" → "CMF live ingestion not active (CAPTCHA)"); the Macro page's own subtitle contradicting its own live badges a few lines below; Compare/Charting's vague phase promises; Watchlist's footer conflating persisted membership with static prices; Document Viewer's "sync planned for a future phase" (permanent non-goal, not pending).
- **Bug caught mid-fix:** the first pass reused the BCCh-flavored `DataSourceBadge` for the Home sector-heatmap and markets modules, which rendered "BCCh persisted" on market (Yahoo/Supabase) data — wrong attribution. Fixed by switching to `MarketDataSourceBadge`. Caught via direct browser verification, not assumed from the label text alone.
- **Tests:** `tests/dataSourceAudit.test.ts` — 27 tests covering the registry, badge semantic-token compliance, absence of stale phase/future-source/fabricated-vendor copy, CMF-blocked wording precision, the Home badge-component regression guard, and confirmation that portfolio math / middleware / provider orchestrators were untouched.

Build 42 routes · lint 0 · tests 513/513

Next: **Phase 8B** (Compare page real-data wiring, lowest-risk follow-up) · **Phase 8C** (financial-statement ingestion for Charting/Earnings) · **Phase 8D** (FX/rates + economic calendar live source completion) · **Phase 8E** (Hechos Relevantes + News ingestion workaround) · **Phase 7A** (mobile-responsive foundation).

---

## Phase 8B — Compare Real-Data Wiring + No-Static-Terminal-State Policy ✓ COMPLETE

Establishes a durable product rule (see `CLAUDE.md` and `docs/data_source_status.md`):
**no visible module may remain static as a terminal state** — static data is
permitted only as fallback, seed/reference data, a temporary placeholder with
a defined conversion path, or a blocked source with a documented workaround.

**Compare page (`/compare`) wired to persisted/live market data:**
- `src/lib/compare/compareTypes.ts` — the `CompareEntry`/`CompareFieldSource` model (`live` · `persisted` · `static_fallback` · `temporary_static` · `unavailable`), NaN/Infinity-guarded via `safeNumber()`.
- `src/lib/compare/resolveCompareData.ts` (server-only) — reuses the existing `marketProvider.ts` static/supabase/hybrid orchestrator (no new provider). Latest price/day-change/market-cap/currency come from `resolveStockSnapshots()`; short-term performance (1D/5D/1M/YTD/1Y) comes from `resolveStockHistory()` per timeframe, with an explicit `fallbackReason` (`insufficient_supabase_history` / `supabase_unavailable`) whenever Supabase history isn't deep enough yet. Fundamentals (P/E, margins, etc.) always come back `temporary_static` with `conversionPath: 'Phase 8C — financials/FECU/manual CSV ingestion'` — never mislabeled as live.
- `GET /api/compare?tickers=A,B,C` + `src/lib/data/compareData.ts` (`fetchCompareData`) — same static/route/client-fetch-helper separation as the rest of the app.
- Compare page UI: new "Market Data" panel (price, day change, 1D/5D/1M/YTD/1Y performance, market cap, sector) with a dynamic `MarketDataSourceBadge` and "as of" snapshot date; the existing Comparative Returns table/chart and Fundamentals table are unchanged functionally but now carry accurate `temporary_static` labeling instead of a blanket page-level "static" claim.
- **Static-data reference-loading gotcha (same fix as `portfolioRepository.ts`):** `resolveCompareData.ts` cannot import `src/lib/data/companies.ts`/`stocks.ts` (they use the `@/*` path alias, which Node's native test runner — and, it turns out, the initial relative-path attempt — can trip on). Fixed by reading `companies.json`/`stockPrices.json` directly via `fs.readFileSync` + `import.meta.url`, mirroring the established pattern. (First attempt used the wrong relative-path depth — `../../../data/...` instead of `../../data/...`, since this file is 2 directories under `src/lib`, not 3 like `portfolioRepository.ts` — caught immediately by a build error and fixed.)

**No-static-terminal-state policy applied to every remaining static/blocked module:** `docs/data_source_status.md` now has a "Conversion Paths for Remaining Static Modules" section giving FX/Chilean rates, US macro, Economic calendar, Fundamentals/Charting, Earnings, Hechos Relevantes, and News each a target source, conversion path, blocker (if any), next phase, and priority — none left as an open-ended "Static MVP" with no plan.

**Verified locally (`MARKET_DATA_MODE=hybrid`, Supabase snapshots ~2 days accumulated):** `/api/compare?tickers=BSANTANDER,SQM-B,FALABELLA` returned `marketDataStatus: "persisted"`, `marketDataSource: "Persisted Yahoo Finance via Supabase"`, real persisted market-cap/price values differing from the static baseline, 1D/5D performance `source: "persisted"`, and 1M/YTD/1Y correctly `source: "static_fallback"` with `fallbackReason: "insufficient_supabase_history"` (self-resolving as more daily snapshots accumulate — no code change needed later). Confirmed in the running dev server: badge text, dark mode, Spanish translations (`DATOS DE MERCADO`, `1A` for one-year), invalid-ticker handling (`NOTATICKER` correctly excluded and reported in `invalidTickers`), and no-tickers-param edge case all behaved correctly.

Files added/changed in 8B:
- `src/lib/compare/compareTypes.ts` — new
- `src/lib/compare/resolveCompareData.ts` — new
- `src/app/api/compare/route.ts` — new
- `src/lib/data/compareData.ts` — new
- `src/app/compare/page.tsx` — new Market Data panel, fundamentals temporary-static label, wired fetch effect
- `src/lib/i18n.ts` — new `compare.*` keys (`marketDataTitle`, `fundamentalsNote`, `perf1d/5d/1m/Ytd/1y`), corrected `compare.subtitle`/`compare.source` to stop claiming a blanket static state
- `CLAUDE.md` — new "No-static-terminal-state policy (Phase 8B+)" rule
- `docs/data_source_status.md` — no-static-terminal-state policy section, rewritten Compare section, new "Conversion Paths for Remaining Static Modules" section
- `tests/compareResolver.test.ts` — new (mocked, no live Supabase/Yahoo required)

Next: **Phase 8C** (financial-statement ingestion for Charting + Earnings) is the recommended next step. Mobile-responsive work (Phase 7A) intentionally comes after data-credibility phases (8B–8E) unless a UX emergency arises.

---

## Phase 8C — Financial-Statement Ingestion Foundation, Manual CSV First ✓ COMPLETE

Converts Charting, Compare's Fundamentals table, and Earnings from terminal static/sample data into
persisted (or derived) data wherever a ticker's financials have been imported via CSV — the first real
step on the conversion path Phase 8B documented for these three modules. Manual CSV only; no CMF/XBRL
automation (still CAPTCHA-blocked, same as Hechos Esenciales), no consensus/estimates ingestion, no
dividends beyond what's imported, no FX conversion, no AI summaries.

**New schema** (migration `20260704000000_financials_foundation.sql`, 4 tables, public read / admin-only write, same pattern as macro/market tables):
- `company_reporting_periods` — the reporting "shell"; `source_type` is `manual_csv` today, `cmf_fecu`/`xbrl` reserved for future automation
- `financial_statement_items` — line items (`revenue`, `ebitda`, `net_income`, `eps`, `gross_profit`, `operating_income`, `rd_expense`, `sga_expense`, `sbc_expense`, `dep_amort`, `ocf`, `capex`, `cash`, `total_debt`, `total_assets`, `shares_out`, `dividends_paid`, `buybacks`)
- `financial_metrics` — ratios; `source_type` `manual_csv` or `derived` (manual wins ties)
- `earnings_events` — `status` ∈ `expected/reported/preliminary/missing`; **no consensus/estimate field exists** — beat/miss is never fabricated for these rows

**CSV templates** (synthetic sample data, safe to commit): `data/import_templates/*.template.csv` — real/private imports are never committed.

**Parser + validation:** `src/lib/financials/csvFinancials.ts` — pure functions (`parseCsvRows`, 4 row validators, `buildFinancialImportPayload`, `deriveFinancialMetrics`). Every row validated before write: covered-universe ticker check, fiscal year/period/date well-formedness, NaN/Infinity-guarded numerics, line-numbered errors. `deriveFinancialMetrics()` computes `ebitda_margin`/`gross_margin`/`op_margin`/`fcf`/`net_debt`/`net_debt_ebitda` automatically from imported statement items.

**Repository + ingestion script:** `src/lib/db/repositories/financialsRepository.ts` (upsert + read helpers, admin client for writes / public client for reads) and `scripts/ingest/financialsCsv.ts` (`npm run ingest:financials:dry` / `ingest:financials -- --write`, dry-run by default, aborts on validation errors unless `--allow-partial`, records `ingestion_runs` with `provider: 'Manual CSV'`, `job_type: 'financials_csv_import'`, `ingestionVersion: '8C'`).

**Wiring (all field/section-level labeled, never a blanket claim):**
- **Charting** (`src/lib/financials/resolveFinancials.ts` + `GET /api/financials/[ticker]/statements`) — builds the exact `FundamentalRecord[]` shape the existing quarterly/TTM/annual aggregation already knows how to render, so no chart logic changed; falls back to `fundamentals.json` per-ticker when nothing's imported. `SourceStateBadge` (`financialsPersisted`/`fundamentalsStatic`) in the toolbar.
- **Compare fundamentals** (`resolveCompareData.ts` + `compareStatic.ts`'s `buildFundamentals()`) — upgrades P/E (from persisted EPS + market price), EV/EBITDA (net debt + EBITDA + market cap), op/gross margin, FCF yield, dividend yield to `derived` field-by-field via a new `derivedFields: CompareFundamentalKey[]` list on `CompareFundamentals`; P/S fwd, ROE, P/B stay `temporary_static` (no forward estimates or book-value imported — never fabricated). Each derived cell gets a `•` marker in the UI.
- **Earnings** (`GET /api/earnings` + page-level merge) — persisted `earnings_events` take over per-ticker where imported; status pill shows the real `status` instead of a fabricated Clean/Mixed/Weak judgment; Rev. Surprise renders `—` (title: "No estimates source") for persisted rows; non-imported tickers keep the full original static feature set (YoY, synthetic consensus/surprise, quality) unchanged.
- **Optional read APIs:** `GET /api/financials/coverage`, `GET /api/financials/[ticker]/metrics`, `GET /api/financials/[ticker]/statements`, `GET /api/earnings[?ticker=]` — all public, sanitized, no secrets.

**Tests:** `tests/financialsIngest.test.ts` — 49 tests (parser/validators/payload builder against real template CSVs, `deriveFinancialMetrics`, `buildFundamentals` derived-vs-static behavior including a bank-like null-EBITDA case, source-label/hygiene/regression checks). One Phase 8B test (`buildFundamentals`'s removed `source: 'temporary_static'` field) updated to match the new `derivedFields` shape.

**Local validation:** applied the migration via Supabase SQL Editor (same manual process as every prior migration — CLI blocked on this machine); ran `npm run ingest:financials -- --write` against the template CSVs (SQM-B/BSANTANDER/COPEC, synthetic data) — 79 rows upserted (3 reporting periods, 54 statement items, 18 metrics [2 manual + 16 derived], 4 earnings events), 0 errors. Verified in the dev server:
- `/chart-builder` (SQM-B) → "Persisted financials via manual CSV" badge, exact imported Revenue/EBITDA/Net Income values
- `/api/compare?tickers=SQM-B,BSANTANDER,COPEC` → 7 fields derived per ticker; BSANTANDER (bank, blank EBITDA in the CSV) correctly shows `null` for `evEbitda`/`netDebtEbitda` rather than a fabricated ratio
- `/earnings` → persisted rows (SQM-B/BSANTANDER/COPEC) show real revenue/EBITDA/net income/EPS, honest `—` for YoY/surprise, "Reported" status pill; COPEC's Q2 2025 "expected" row correctly appears in Upcoming; non-imported tickers (ENELCHILE, etc.) unchanged
- Dark mode and Spanish ("Reportado" status pill) both correct

Build 46 routes · lint 0 · tests 588/588

Scope limits (this phase, explicit):
- Manual CSV import only — no CMF FECU/XBRL automation (CAPTCHA-blocked)
- No consensus/analyst-estimates ingestion
- No dividends beyond the raw imported `dividends_paid` line item
- No FX conversion
- No cross-period YoY derivation for persisted records
- No AI summaries
- Macro/market/auth/portfolio logic untouched (confirmed by regression tests)
- No mobile-responsive work

Next: **Phase 8D** (FX/rates + economic calendar live source completion) is the recommended next step; growing CSV coverage for Charting/Compare/Earnings beyond the 3-ticker sample is ongoing, low-risk data entry that doesn't require further engineering.

---

## Phase 8C (upgrade) — Automation-First Financials Architecture, Manual CSV as Interim Bridge ✓ COMPLETE

Upgrades the Phase 8C financials foundation above to an explicit **automation-first** design: manual CSV
remains the only populated source today, but the schema, repository, and ingestion-run logging are now
source-agnostic so a future automated CMF FECU/XBRL parser, licensed vendor feed, broker feed, or
document-ingestion pipeline can write into the same 4 tables through the same repository functions with
**zero redesign**. Manual CSV must never be treated as a terminal architecture — every UI label, doc, and
registry entry now says so explicitly.

**New migration** (`20260705000000_financials_automation_ready.sql`, purely additive/idempotent): adds
`source_file`, `source_as_of`, `ingestion_run_id` (FK → `ingestion_runs`), `source_priority` (default 100),
`is_superseded` (default false), `superseded_by` to all 4 financials tables; widens the `source_type` CHECK
constraint on each table to accept `manual_csv`, `cmf_fecu`, `xbrl`, `vendor_feed`, `broker_feed`,
`document_ingestion`, `static_seed`, `derived`; widens `statement_type` to also accept long-form codes
alongside the original `income`/`cash`/`balance`/`returns`; adds indexes on `ingestion_run_id`/`source_type`
and partial canonical indexes `where not is_superseded`.

**Source priority + supersession mechanism** (`financialsRepository.ts`): `DEFAULT_SOURCE_PRIORITY` maps
`source_type` → an integer (higher = more authoritative — `static_seed`(10) < `derived`(50) <
`manual_csv`(100) < `document_ingestion`(120) < `broker_feed`(140) < `vendor_feed`(150) < `cmf_fecu`(200) <
`xbrl`(210)), always auto-derived, never hand-set by a caller. `reconcileSupersession()` runs after every
upsert: groups rows sharing a logical key (ticker + fiscal_year + fiscal_period [+ period_type]) across
different `source_type`s, marks every row but the highest-priority one `is_superseded = true` pointing
`superseded_by` at the winner (and un-supersedes the winner if a corrected re-import changes the outcome).
The read path (`getReportingPeriods`, new `getCanonicalReportingPeriods`, `getStatementItems`,
`getFinancialMetrics`, `getEarningsEvents`) always filters `is_superseded = false` and additionally dedupes
defensively by picking the highest-priority row per logical group.

**Verified end-to-end against Production Supabase** (throwaway test, cleaned up after): inserted a synthetic
`cmf_fecu`-sourced reporting period for a ticker/period that already had a `manual_csv` row via the exact
same `upsertReportingPeriods()` function → the manual row was automatically marked `is_superseded: true` →
`getCanonicalReportingPeriods()` correctly switched to the new row → after deleting the synthetic row and
un-superseding the manual row, the system correctly reverted. Zero code changes were needed to make a
higher-priority source win — proving the design isn't just schematic.

**Human-error controls added to the parser** (`src/lib/financials/csvFinancials.ts`): `normalizeSourceMetadata()`
rejects a `source_file` that looks like a path (forward slash, backslash, or a Windows drive letter — must be
a bare filename) and validates `source_as_of` parses as a real timestamp; `findDuplicates()` rejects rows
sharing the same logical key within a single CSV batch (line-numbered errors); statement-item values with no
explicit `scale` are rejected as ambiguous; dry-run remains the default, `--write` and `--allow-partial` are
explicit opt-ins, and no full CSV row content is ever echoed to logs (counts and line numbers only).

**Ingestion script** (`scripts/ingest/financialsCsv.ts`): now creates the `ingestion_runs` row **first**
(`metadata: { ingestionVersion: '8C', sourceType: 'manual_csv', automationReadiness: 'interim_bridge' }`),
threads that run's `id` as `ingestion_run_id` through every upserted row, then updates the same row with
final counts/status.

**CSV templates** — all 4 gained `source_name`, `source_url`, `source_file`, `source_as_of` columns.
**Found and fixed a real bug** while validating: `earnings_events.template.csv`'s COPEC "expected" row had
one extra comma (17 cells vs. a 16-column header), silently shifting every field after it by one column —
caught by the parser's own strict validation, not manual inspection.

**UI/registry labels** updated everywhere to say "Static fallback · pending automated financials ingestion"
and "manual CSV interim bridge; automated CMF/FECU/XBRL ingestion planned" instead of a bare "Phase 8C"/plain
"manual CSV" reference — `src/lib/dataSourceRegistry.ts` (`fundamentalsStatic`, new
`automatedFinancialsPending`, `sourceAgnosticFinancialsLayer` entries), `src/lib/i18n.ts` (`charting.source`,
`compare.fundamentalsNote`, `compare.derivedFieldTitle`, `earnings.footer`, EN+ES).

**Tests:** `tests/financialsIngest.test.ts` extended from 49 to 73 tests — ambiguous-scale rejection,
provenance preservation, path-rejection for `source_file`, duplicate-row detection (reporting periods and
statement items), `normalizeSourceMetadata` behavior, `VALID_SOURCE_TYPES` completeness, and a dedicated
"Phase 8C automation-first architecture" suite of hygiene checks: migration adds provenance/supersession
columns to all 4 tables via CHECK constraints containing all 8 required `source_type` values; migration is
purely additive; repository derives `source_priority` automatically and never hardcodes it; repository
implements `reconcileSupersession`/`is_superseded`/`superseded_by`; read path filters `is_superseded` and
uses `getCanonicalReportingPeriods`; ingestion script records `automationReadiness: 'interim_bridge'` +
`sourceType` and creates the `ingestion_runs` row up front; no source file frames manual CSV as
final/terminal/permanent; CLAUDE.md and `docs/data_source_status.md` document the automation-first/
interim-bridge constraint.

Build 46 routes · lint 0 · tests 588/588 (baseline) → 612/612 after this upgrade's additions.

Scope limits (this phase, explicit — unchanged from the base Phase 8C):
- Manual CSV is still the only source populated today — automated CMF FECU/XBRL/vendor/broker ingestion is
  designed for, not implemented, in this phase
- No consensus/analyst-estimates ingestion
- No dividends beyond the raw imported `dividends_paid` line item
- No FX conversion
- No cross-period YoY derivation for persisted records
- No AI summaries
- Macro/market/auth/portfolio logic untouched (confirmed by regression tests)
- No mobile-responsive work

Next: **Phase 8D** (FX/rates + economic calendar live source completion), or building an actual automated
`cmf_fecu`/`xbrl` provider that writes into the now-ready schema.

---

## Phase 8C.1 — Automated Financials Provider Discovery + CMF/XBRL Proof of Concept ✓ COMPLETE (2026-07-03)

Determines whether official CMF financial-statement/XBRL filings can be programmatically accessed without
CAPTCHA or brittle scraping, and builds the first real automated-provider scaffolding against the Phase 8C
automation-ready schema. **Verdict: `feasible_with_mapping`** — real XBRL instance documents (not just blank
taxonomy schemas) were downloaded successfully with no CAPTCHA and no login, confirmed for two real companies
including **Empresas Copec, a ticker this app covers**. Full details, exact URLs, and every verification step
in `docs/cmf_xbrl_provider_discovery.md`.

**Discovery:** CMF's taxonomy download pages (`/portal/principal/613/w3-article-*.html`) only provide blank
schema ZIPs for preparers — proves nothing about actual filing access. Separately, `entidad.php?rut=&mm=&aa=&tipo=C&tipo_norma=IFRS...`
was found to resolve deterministically from `rut+mm+aa` alone (the `row`/`auth`/`send` search-form tokens can
be left blank), and its HTML embeds a relative link to a real XBRL ZIP download whose per-request tokens must
be scraped fresh each time (not guessable in advance, but reliably present). Verified end-to-end for RUT
`99530250` (Ripley Chile, 3 periods) and RUT `90690000` (Empresas Copec — genuine ZIP, real `ifrs-full` IFRS
facts). Found a genuine real-world nuance: Copec's 2023 filing reports entirely in **USD**, not CLP —
confirms currency must always be read per-fact from the XBRL unit block, never assumed.

**Issuer mapping** (`src/lib/financials/cmfIssuerMap.ts`): SQM-B (`93007000`) and COPEC (`90690000`) verified
against direct cmfchile.cl URLs. BSANTANDER stays unmapped — a search-engine snippet suggested a RUT that,
when queried directly, returned "Sin información" (confirmed wrong); per the never-guess-a-RUT policy, it's
documented as unmapped with the reason rather than guessed.

**Provider abstraction** (`src/lib/financials/providers/types.ts`): a `FinancialsProvider` interface so
manual CSV, CMF/XBRL, and any future vendor/broker/document-ingestion source all normalize to the identical
`FinancialImportPayload` shape and call the identical `financialsRepository.ts` upsert functions.

**CMF/XBRL provider** (`src/lib/financials/providers/cmfXbrlProvider.ts`): implements the verified two-step
fetch chain for mapped issuers; returns a structured `blocked` result (`issuer_not_mapped`) for unmapped
tickers instead of guessing; honestly reports `not_implemented` at the unzip step (a real ZIP download was
proven to work, but no zip-extraction dependency was added this phase).

**XBRL parser** (`src/lib/financials/xbrl/parseXbrl.ts`) + **concept map**
(`src/lib/financials/xbrl/conceptMap.ts`): a minimal, dependency-free contexts/units/facts extractor plus a
conservative IFRS-concept-to-line-item map built only from concepts actually observed in the two real
filings — never computes EBITDA, documents every deliberately-unmapped concept with a reason. `plainFacts()`
excludes segment/dimensional-breakdown contexts so only the consolidated figure is used — this exact test
suite caught a real bug here (a naive greedy regex was treating the entire XML document as one giant "fact")
before it reached a real filing.

**CLI** (`scripts/discover/cmfXbrlFinancials.ts`): `npm run discover:cmf-financials` (discovery, default),
`npm run ingest:cmf-financials:dry` / `ingest:cmf-financials -- --write` (real fetch attempts, dry-run
default). Sanitized logs only.

**Supersession:** not re-demonstrated with a fresh live write (no real same-period XBRL data exists yet for a
ticker already covered by the manual-CSV sample) — verified instead via the repository's own priority table
(`xbrl: 210 > manual_csv: 100`) plus the already-proven Phase 8C-upgrade live Production supersession test.

**Tests:** `tests/cmfXbrlProvider.test.ts` — 40 new tests (parser against a synthetic fixture modeled on real
structure, concept-map conservatism, issuer-map verification requirements, provider blocked/not-found/parsed
states, no-fabricated-EBITDA/dividends/consensus checks, supersession priority ordering, discovery-output
hygiene, documentation-completeness checks).

**Local validation:** `npm run discover:cmf-financials` run for real — correctly reports SQM-B/COPEC as
`feasible_with_mapping` and BSANTANDER as blocked; `npm run ingest:cmf-financials:dry -- --ticker COPEC` run
against the **live** CMF site — correctly reported `not_found` for the most recent candidate period (not yet
filed) without crashing or fabricating data, proving the honest-failure path works against a real network
call, not just a mock.

Build 46 routes (unchanged — no new API routes this phase) · lint 0 · tests 612 → 652

Scope limits (explicit): no CAPTCHA bypass, no OCR, no AI extraction; only 2 tickers mapped; no zip-extraction
dependency added (real download proven, extraction not wired end-to-end); no scheduled/unattended ingestion;
News/Hechos Relevantes/FX/rates/calendar untouched; macro/market/auth/portfolio logic untouched; no mobile work.

Next: extend the verified issuer map (manually, per issuer, never guessed), add a zip-extraction step, and
exercise the fetch chain against more tickers/periods before considering any scheduled ingestion — or move to
**Phase 8D** (FX/rates + economic calendar live source completion) if CMF/XBRL automation is deprioritized.

---

## Phase 9A — Structured Notes Foundation + Excel Workbook Audit + PDF Extraction MVP ✓ COMPLETE (2026-07-06)

New **Structured Notes** module (`/structured-notes`) — automation-first replacement for the legacy
`NUEVA BASE - Notas Estructuradas.xlsx`. Upload term-sheet PDF → deterministic auto-extraction → review →
import → auto-fetch live underlying levels (Yahoo, replacing the workbook's Bloomberg `BDP`) → auto-compute
barriers / distance to barrier / worst-of risk / current notional / issuer exposure. Manual entry is a
fallback, never the terminal design. See `docs/structured_notes_design.md` and
`docs/structured_notes_workbook_mapping.md`.

- **Schema:** migration `20260706000000_structured_notes_foundation.sql` — 7 user-scoped tables (RLS
  `auth.uid()=user_id`, ownership-guard trigger on child tables).
- **PDF extraction MVP:** `unpdf` text extraction + a deterministic regex/keyword parser for the **Citi CGMFL
  "Memory Coupon Barrier Autocall"** family (no OCR, no AI). Verified end-to-end against the real sample
  `XS3180975347` (confidence 1.0). Per-field confidence + provenance; critical-field validation rejects
  incomplete extractions.
- **Calculations:** pure, NaN/Infinity-guarded, workbook-parity (barrier=strike×pct; Caída=barrier/current−1;
  worst-of coupon/autocall; current notional; issuer/entity exposure). Missing market data → `unavailable`.
- **API + UI:** auth-only routes (`extract`/`import`/list/detail/allocations); list page (upload→review→import)
  + detail page (terms · underlyings · schedule · internal allocations · live levels & distance to barrier ·
  provenance). Full EN/ES i18n; nav item + icon.
- **Tests:** 69 new tests (calculations, extraction against a sanitized fixture, workbook mapping + security +
  no-private-file guards). Build 54 routes · lint 0 · tests 721.

Scope limits: Citi CGMFL family only; no OCR/AI; no scheduled monitoring; price snapshots compute-on-request;
macro/market/auth/watchlist/portfolio/financials untouched; no mobile work.

Next: **Phase 9B** (parser generalization + scheduled monitoring) or **Phase 8C.2** (CMF/XBRL financials ingestion).
