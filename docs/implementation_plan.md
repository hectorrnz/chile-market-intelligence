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
