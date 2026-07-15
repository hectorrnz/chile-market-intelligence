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

## Phase 8C.2 — CMF/XBRL Automated Financials Ingestion (LIVE) ✓ COMPLETE (2026-07-08)

Turns the 8C.1 proof-of-concept into a working end-to-end automated financials pipeline. The one blocker in
8C.1 — no ZIP extraction — is removed with a **dependency-free ZIP reader** (`src/lib/financials/xbrl/unzip.ts`)
built on Node's built-in `node:zlib` (`inflateRawSync`; ZIP entries are raw DEFLATE). Automated official CMF
XBRL is now the **preferred** source for mapped Chile issuers; manual CSV is a genuine fallback.

- **Full pipeline** (`cmfXbrlProvider.ts` + `runCmfXbrlIngestion.ts`): entidad.php page → parse XBRL href →
  download ZIP → unzip (reject taxonomy-only) → parse `.xbrl` → **period-match** → normalize → validate →
  persist via the same source-agnostic repository upsert manual CSV uses. `xbrl` (priority 210) supersedes
  `manual_csv` (100).
- **Honest period handling** (`periodClassify.ts`): matches facts to the current period's contexts only
  (excludes prior-year comparatives); labels `annual`/`quarterly_discrete`/`year_to_date`/`instant`.
  `period_type` stays quarterly/annual so supersession still groups an XBRL period with a manual one. Default
  ingestion is **annual filings only** (unambiguous); interim is supported but not default.
- **Extended concept map** (~24 ifrs-full concepts, each `high`/`medium`/`low`/`review_required` confidence;
  EBITDA never fabricated) + **validation** (`validateFinancials.ts`: balance-sheet identity, chronology,
  non-finite, currency/unit, YTD-derived, unmapped — status valid/valid_with_warnings/review_required/invalid).
- **No migration**: honest-period metadata + raw fact provenance reuse the existing `metadata` jsonb columns
  (mirrors 9D/9E). **No new dependency, no new env var.**
- **Cron route** `GET /api/cron/financials/cmf-xbrl` (Bearer `CRON_SECRET`) — **not on a Vercel schedule**
  (undocumented HTML surface; manual/reviewable). **Status** `GET /api/financials/cmf-xbrl/status` (public
  read-only). Charting badge shows "CMF XBRL" when data is XBRL-sourced.
- **Live validation**: COPEC FY2025 written (24 rows, USD, valid_with_warnings, balance-sheet identity exact);
  SQM-B + COPEC FY2025/FY2024 dry-run clean; **supersession proven live** (a synthetic manual_csv FY row was
  demoted by the XBRL row, then cleaned up). Read path confirms `sourceType: xbrl`.
- **Tests**: `tests/financialsCmfXbrl.test.ts` (41 new — unzip round-trip/taxonomy-rejection/path-traversal,
  period classification, concept map, validation, provider normalize against the synthetic fixture, route
  hygiene). ZIP fixtures are built in-memory (deflate), no binaries committed. Existing 113 CMF/financials
  tests still pass. Build 0 errors, lint 0, tests 975/975.

Scope limits: CMF/XBRL only; 2 issuers mapped (SQM-B, COPEC); annual default; not scheduled; no
CAPTCHA/scraping of Hechos Esenciales; News/FX/calendar untouched; macro/market/auth/portfolio/structured-notes
untouched.

Next: expand the verified issuer map (per-issuer RUT verification); revisit interim-filing ingestion with
clear YTD handling; consider a conservative schedule once the surface's stability is observed — or **Phase 8D**
(FX/rates + economic calendar live source completion).

---

## Phase 8C.3 — CMF/XBRL Issuer Coverage Expansion ✓ COMPLETE (2026-07-08)

Expands CMF/XBRL issuer coverage from 2 to 5 using a conservative, verified, issuer-by-issuer process — no
architecture changes, just careful, evidence-based issuer/concept additions on top of the 8C.2 pipeline.

- **Enabled:** ENELCHILE (RUT 76536353), CMPC (RUT 90222000), CENCOSUD (RUT 93834000) — joining SQM-B and
  COPEC. **Skipped (documented, not guessed):** BSANTANDER and CHILE (Banco de Chile) — confirmed absent from
  both CMF registry groups (RVEMI, RGEIN) this discovery tool exposes; banks are supervised under a separate
  CMF track this public XBRL search surface does not cover.
- **Verification method** (`src/lib/financials/cmfIssuerMap.ts`): RUTs verified against CMF's own official
  `sociedad[]` issuer directory embedded in its public XBRL search form (`sa_eeff_ifrs_index.php`) — an
  authoritative RUT↔legal-name source, stronger than the search-engine snippets used in 8C.1. CMPC and
  CENCOSUD each required disambiguation from a similarly-named but distinct directory entry (e.g. "Inversiones
  CMPC S.A." vs. "Empresas CMPC S.A."). Every new entry carries `verificationStatus: 'verified'` and a
  `verificationMethod` note; `UNMAPPED_TICKERS` documents BSANTANDER/CHILE with the registry-group evidence.
- **Real-world finding:** ENELCHILE's filing currency changed from CLP (FY2024) to USD (FY2025) — verified as
  a genuine change (all 22 mapped facts consistently USD; XBRL `entityIdentifier` confirmed the correct RUT in
  both filings), not a bug — currency is read strictly per-fact, never assumed, confirming the 8C.2 policy.
- **Concept map extended** (~24 → ~31 `ifrs-full` concepts): added `total_debt`/`long_term_debt`/
  `short_term_debt` (only after verifying the additive identity `LongtermBorrowings +
  CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings == Borrowings` held exactly in real filings),
  `shares_outstanding`, and higher-confidence real-world capex/dividend concept variants observed in the new
  filings. Concepts that failed cross-year/cross-issuer consistency (`NetDebt` ≠ gross debt; `ShorttermBorrowings`
  absent in a current-year context; `CurrentPortionOfLongtermBorrowings` diverging from the combined current-debt
  concept) were deliberately left in `KNOWN_UNMAPPED_CONCEPTS` with the numeric evidence documented.
- **Status endpoint rewritten** (`GET /api/financials/cmf-xbrl/status`): now reports `enabledIssuers` (ticker,
  legal name, verification status/date, coverage counts) and `notConfiguredIssuers` (ticker + documented
  reason) explicitly, alongside the prior `coverage`/`mappedIssuers`/`unmappedIssuers` shape kept for backward
  compatibility.
- **No migration, no new dependency, no new env var** — same source-agnostic schema and supersession mechanism
  from 8C.2 handle the 3 new issuers with zero code changes to the provider/orchestrator/repository.
- **Production validation:** real writes for ENELCHILE (26 rows, USD), CMPC (31 rows, USD), CENCOSUD (31 rows,
  CLP) — all `sourceType: xbrl`, `valid_with_warnings`. Charting badge verified live in-browser for CMPC
  (real revenue value, EBITDA correctly `—` where not filed). Pre-existing SQM-B/COPEC mapped-field counts also
  grew (23→29 and 23/24→24 respectively) from the concept-map expansion.
- **Tests:** `tests/financialsCmfXbrl.test.ts` grew from 41 to 53 (new concept-map verification tests + issuer-map
  coverage tests: exactly 5 mapped tickers, correct RUTs, BSANTANDER/CHILE unmapped with registry-referencing
  reasons, never-guesses check). Build 0 errors, lint 0, tests 987/987.
- **Cron remains unscheduled** — issuer coverage is still narrow (5 issuers), not yet a stable basis for an
  unattended Vercel cron run against an undocumented HTML surface.

Scope limits: CMF/XBRL issuer expansion only; annual filings only; no interim/YTD ingestion or charting
support; no new cron schedule; no paid/vendor APIs; no Bloomberg; no CAPTCHA bypass; no Hechos Esenciales
scraping; News/FX/rates/calendar untouched; Structured Notes/auth/watchlist/portfolio untouched; no mobile
work; no new dependency.

Next: continue CMF/XBRL issuer expansion (per-issuer RUT verification against CMF's official directory,
§4a of `docs/cmf_xbrl_financials_ingestion.md`) — or **Phase 8D** (FX/rates + economic calendar live source
completion) — or **Phase 9F** (Santander / older-2024-Citi structured-notes parser expansion).

---

## Phase 8C.4 — Full CMF/XBRL Coverage Discovery Sweep + Controlled Issuer Enablement + Bank Registry Track ✓ COMPLETE (2026-07-08)

Full discovery sweep over the 25-stock app universe; enabled CMF/XBRL coverage 5 → 15 issuers; every stock
classified into a coverage funnel; separate bank track confirmed. No new migration, dependency, or concept-map
change.

- **Sweep:** matched all 25 app legal names against CMF's own RVEMI `sociedad[]` directory (483 entries); each
  non-bank candidate's full entidad.php→XBRL→parse chain exercised live (FY2025). CLI `npm run
  discover:cmf-coverage` (+ `--live`) + pure classifier `src/lib/financials/cmfCoverage.ts`.
- **Enabled (+10):** LAS-CONDES, CAP, ENELAM, COLBUN, AGUAS-A, RIPLEY, PARAUCO, ENTEL, CCU, LTM — RUT-verified
  + clean live dry-run; currency per fact. **Production write: 15 enabled issuers, 422 rows, 0 failures.**
- **Deferred (+3 eligible_verified):** CONCHATORO, FALABELLA, MALLPLAZA. Safety: default ingestion set is now
  `getEnabledTickers()` — deferred issuers never auto-written (explicit `?ticker=` only).
- **Funnel (25):** 15 enabled · 3 eligible_verified · 3 `unsupported_page_shape` (SONDA/ANDINA-B/VAPORES — real
  filings in an XBRL dialect the parser can't read) · 4 `bank_track_required`. Exposed via
  `/api/financials/cmf-xbrl/status` (`coverageFunnel`).
- **Banks:** confirmed absent from the securities XBRL directory under every registry group; separate CMF
  banking track (bank-specific taxonomy, never forced into the industrial map); `bank_track_required`; RUTs not
  guessed; bank ingestion deferred.
- **Tests:** 53→65 in `tests/financialsCmfXbrl.test.ts`; full suite 999/999, lint 0, build 0 errors.
- Cron still unscheduled.

Scope limits: coverage discovery + controlled non-bank enablement only; annual only; no interim/YTD; no cron
schedule; no paid/vendor APIs; no Bloomberg; no CAPTCHA bypass; no Hechos/News/FX/rates/calendar; Structured
Notes/auth/watchlist/portfolio/macro untouched; no UI redesign; no new dependency; no bank ingestion.

Next: promote the 3 eligible_verified; add parser support for the 2 extra XBRL dialects; build a bank-specific
track; or **Phase 8D** / **Phase 9F**.

---

## Phase 8C.8 — Official CMF Bank Financials Persistence + Pillar 3 Discovery ✓ COMPLETE (2026-07-09)

Enables official CMF bank regulatory data as a controlled, production annual source for the 4 bank tickers
(BSANTANDER, CHILE, BCI, ITAUCL) discovered in Phase 8C.7, and investigates whether an official CMF/SBIF
source exists for bank capital/risk metrics (CET1, RWA, NPL, coverage).

**`cmf_bank` source type + priority**: migration `20260712000000_financials_cmf_bank_source_type.sql`
(purely additive/idempotent, mirrors the Phase 8C.5 `yahoo_finance` migration) widens the `source_type` CHECK
constraint on all 4 financials tables. `VALID_SOURCE_TYPES`/`DEFAULT_SOURCE_PRIORITY` gained `cmf_bank` at
**priority 180** — full ordering: `xbrl (210) > cmf_fecu (200) > cmf_bank (180) > vendor_feed (150) >
broker_feed (140) > document_ingestion (120) > manual_csv (100) > yahoo_finance (80) > derived (50) >
static_seed (10)`. Official above unofficial (Yahoo), below full-detail audited statements (XBRL/FECU).

**Ingestion orchestrator** (`src/lib/financials/banks/runCmfBankFinancialsIngestion.ts`) drives all 4 banks
(or an explicit subset) over the most recently completed annual (December) release, with per-bank statuses
(`success`/`partial_success`/`source_unavailable`/`parse_failed`/`mapping_failed`/`validation_failed`/
`persistence_failed`/`deferred_unmapped`) — one bank's failure never aborts the batch, and a payload is only
written once it clears both a minimum-mapped-field guard (default 10/14) and a minimum-validation guard
(default `valid_with_warnings`). `cmfBankProvider.ts` gained a real `writeImport()` calling the identical
`financialsRepository.ts` upsert functions the non-bank provider uses. Cron: `GET /api/cron/financials/cmf-bank`
(Bearer `CRON_SECRET`, same pattern as `/api/cron/financials/cmf-xbrl`) — **not on a Vercel cron schedule**,
manually-triggered and reviewable, same policy as the non-bank cron.

**Production result: all 4 banks succeeded.** `npm run ingest:cmf-bank -- --write` against the December 2025
annual release wrote **60 rows** (15/bank: 1 reporting period + 14 statement items), **56 fields mapped, 0
failures, all `valid`**. Verified live: each bank's FY2025 `cmf_bank` annual reporting period now supersedes
the prior `yahoo_finance` FY2025 annual period (`is_superseded: true` on the Yahoo row); Yahoo's quarterly/
other-year data is untouched. BCI's two independently-sourced `net_income` figures cross-validate within
~0.02% (996,212,126,958 vs 996,006,000,000) — real, consistent data, not a coincidence.

**A real bug was caught and fixed during production validation**: `scripts/discover/cmfBankFinancials.ts` was
missing the `@next/env` `loadEnvConfig(process.cwd())` call every other ingestion CLI in this project has.
Without it, `--write` silently ran with no Supabase credentials in the environment; both repository upserts
failed closed with "Admin Supabase client not configured," surfaced only as a generic "2 row(s) failed to
write" count. Found by reproducing the exact payload directly against the repository functions (which
succeeded), isolating the difference to the CLI wrapper. Fixed, verified with a single-bank write before the
full 4-bank run, and guarded by a new regression test asserting every ingestion CLI in the project loads env
vars consistently.

**Labeling**: `resolveFinancials.ts`'s `summarizeSource()` now recognizes `cmf_bank` and labels it "Official
CMF bank regulatory filing" — deliberately distinct wording from "Persisted financials via CMF XBRL" so a
bank's official annual fields are never mistaken for the industrial pipeline. New Charting badge
(`financialsPersistedCmfBank` in `dataSourceRegistry.ts`).

**Status endpoint**: `bankTrack` (on `GET /api/financials/cmf-xbrl/status`) now overlays live per-bank
`cmf_bank` coverage (`productionIngestion: 'enabled'` once a canonical row exists, period count, latest
ingested release, latest ingestion run) and a `pillar3` field — separate from `coverageFunnel`, which still
classifies banks `bank_track_required` (that funnel is specifically the non-bank securities-issuer pipeline).

**Pillar 3 / regulatory-metrics discovery: `deferred` — not a viable structured source.** CMF's official
"Divulgación de Pilar 3 de Basilea" page (verified live, Q4 2025 release) is a PDF whose entire content is a
**link directory** to each bank's own investor-relations website, where that bank self-publishes dozens of
Basel III disclosure forms in whatever format it chooses. None of the 4 app banks link to a direct structured
file — each resolves to a general IR landing page. Reaching this data would require per-bank website
navigation (unstable, not a documented API) and PDF parsing for these specific banks — both against this app's
standing no-fragile-scraping and no-OCR rules. **No ingestion prototype was built** — the discovery result is
documented in `src/lib/financials/banks/pillar3Discovery.ts` (pure, network-free) and surfaced via the status
endpoint, per the "document the blocker, don't build speculative ingestion" policy. CET1/RWA/NPL/coverage
remain structurally unavailable, never fabricated.

**Tests:** `tests/financialsCmfBank.test.ts` grew with 8C.8 additions — `cmf_bank` source-type/priority/
migration checks, `resolveFinancials.summarizeSource` labeling (incl. priority ordering vs xbrl/manual/yahoo),
orchestrator hygiene (per-bank statuses, write-gating logic), cron route hygiene, `pillar3Discovery` coverage,
`bankCoverageStatus` live-coverage overlay behavior, and a regression test for the env-loading bug. Full suite
1072→1101, lint 0, build 0 errors.

Scope limits: bank official-source persistence + Pillar 3 discovery only; annual (December) only; no non-bank
CMF/XBRL refactor; no Yahoo fundamentals refactor beyond source-priority compatibility; no paid/vendor API; no
Bloomberg; no CAPTCHA bypass; no OCR; Pillar 3 production writes out of scope (source found non-viable);
Structured Notes/auth/watchlist/portfolio/macro untouched; no UI redesign; bank cron stays unscheduled.

Next: a dedicated pass to resolve the deposits/borrowings ambiguity; periodically re-check Pillar 3 for a
future centralized structured file; or **Phase 8D** (FX/rates + economic calendar), or **Phase 9F**
(Santander/older-2024-Citi structured-notes parser).

---

## Phase 8C.7 — Bank-Specific CMF Discovery + Banking Financials Architecture ✓ COMPLETE (2026-07-09)

Investigates and designs a bank-specific CMF ingestion path for BSANTANDER, CHILE, BCI, ITAUCL — the 4
`bank_track_required` tickers Phase 8C.4/8C.6 confirmed structurally unreachable via the non-bank
securities-issuer XBRL directory. Discovery only + dry-run prototype; **no production write**.

**Discovery result: no bank XBRL path exists (none was expected)** — banks are not part of CMF's XBRL-tagged
securities-issuer regime at all, confirmed again live this phase (RVEMI/RGFEN/RGB/RB/BANC all return the
identical non-bank list; RGEIN returns an unrelated fund-manager list). Instead, a **real, official, non-XBRL,
public, no-CAPTCHA monthly regulatory feed** was found: CMF's "Balance y Estado de Situación Bancos" —
tab-delimited TXT files (`b1`=balance consolidated, `r1`=income statement consolidated, etc.), one ZIP per
month back to 2001, each bundling its own official bank-code↔legal-name registry
(`metadata/listado_instituciones.txt`) and a 2,397-entry account-code dictionary
(`metadata/plan_de_cuentas.txt`) under the "Compendio de Normas Contables para Bancos" (Circular N°2.243).
Bank codes verified directly from this official documentation: CHILE=001, BCI=016, BSANTANDER=037, ITAUCL=039.
No RUT is asserted (not independently re-verified this phase — the bank code, not RUT, is this pipeline's
identifier).

**Bank-specific normalized field model** (`src/lib/financials/banks/bankStatementTypes.ts`) — deliberately
separate from the industrial `LineItemCode` union: net interest income, loans/deposits, capital ratios, never
conflated with revenue/current-assets/current-liabilities.

**Conservative 14-field account-code map** (`src/lib/financials/banks/bankConceptMap.ts`) — every entry
verified `high` confidence against two real monthly releases (May 2026 and the target December 2025 annual)
for **all 4 target banks**, via exact additive identities: `total_assets == total_liabilities + total_equity`
and `profit_before_tax + tax_expense == net_income`, both held to the peso for every bank. Deposits, borrowings,
debt securities issued, and all capital/regulatory ratios (CET1, RWA, NPL, coverage) stay deliberately
unmapped — no single unambiguous top-level account exists for the former; the latter don't exist anywhere in
this feed at all (a separate, not-yet-investigated quarterly Pillar 3 disclosure) and are never inferred from
balance-sheet data.

**Dry-run ingestion prototype** (`src/lib/financials/providers/cmfBankProvider.ts`,
`scripts/discover/cmfBankFinancials.ts`, `npm run discover:cmf-bank -- --live`) — discovers the monthly ZIP
link, fetches, unzips (reusing the existing dependency-free `xbrl/unzip.ts` unchanged), parses
(`parseBankAccountFile.ts`), maps, and validates (`validateBankFinancials.ts`, mirroring
`xbrl/validateFinancials.ts`'s severity model). **No `writeImport` exists in this module** — verified live
against the real December-2025 annual release: **all 4 banks, 14/14 fields mapped, validation status `valid`,
0 warnings.** Yahoo Finance remains the sole active fundamentals source for all 4 banks.

**Status endpoint**: `GET /api/financials/cmf-xbrl/status` gained a `bankTrack` field
(`src/lib/financials/banks/bankCoverageStatus.ts`) — a separate field from `coverageFunnel`, which keeps
classifying banks `bank_track_required` unchanged.

**Persistence not enabled**: the existing `financial_statement_items` schema is source-agnostic
(`line_item_code`/`statement_type` are free-text) and needs no migration to *store* bank fields, but
`source_type`'s CHECK constraint has no `cmf_bank` entry and `DEFAULT_SOURCE_PRIORITY` has no priority for it —
both would need a migration before any real write, deliberately deferred.

**Tests:** `tests/financialsCmfBank.test.ts` — 48 new tests (parser, concept map, statement-type model,
registry, validator, provider pure-helpers incl. the HTML zip-link matcher, coverage-status summary) using
small sanitized fictional-value fixtures — no live network in any unit test. Full suite 1024→1072, lint 0,
build 0 errors.

Scope limits: bank-specific discovery + architecture only; annual (December) only; no non-bank refactor; no
production write, no migration, no new cron; no paid/vendor API; no CAPTCHA bypass; Structured Notes/auth/
watchlist/portfolio/macro untouched; no UI redesign.

Next: a dedicated pass on the deposits/borrowings ambiguity; investigate the quarterly Pillar 3 disclosure for
capital ratios; or if mapping/stability confidence grows, add `cmf_bank` to `VALID_SOURCE_TYPES` +
`DEFAULT_SOURCE_PRIORITY` via a migration and wire a real, still-unscheduled, reviewable ingestion — or
**Phase 8D** (FX/rates + economic calendar), or **Phase 9F** (Santander/older-2024-Citi structured-notes
parser).

---

## Phase 8C.6 — CMF/XBRL Non-Bank Completion: Eligible Promotion + XBRL Dialect Support ✓ COMPLETE (2026-07-09)

Finishes the official CMF/XBRL non-bank layer: every non-bank app stock (21 of 25) now has authoritative
annual CMF/XBRL data. The 4 banks remain `bank_track_required` (deferred to a bank-specific phase). Coverage
funnel goes 15/3/3/4 → **21/0/0/4**.

- **Promoted 3 eligible_verified → enabled** (CONCHATORO, FALABELLA, MALLPLAZA) after a re-confirmed clean
  live FY2025 dry-run (29/29/27 mapped, CLP, valid_with_warnings). RUT/legal-identity notes retained.
- **XBRL parser dialect support** (`src/lib/financials/xbrl/parseXbrl.ts`), verified against the real filings,
  byte-identical output for the 15 already-working issuers (CCU regression-checked):
  - **Default/unprefixed-namespace dialect (SONDA):** the xbrli instance namespace is the XML default, so
    `<context>`/`<unit>`/`<identifier>`/`<period>` are unprefixed (facts stay prefixed). Structural regexes now
    accept an OPTIONAL `xbrli:` prefix. SONDA had parsed 0 contexts before; now 2044 contexts / 11756 facts / 30
    mapped.
  - **CTI-Service dialect (ANDINA-B, VAPORES):** `xbrli:`-prefixed but SINGLE-quoted attributes + an
    ISO-8859-1 encoding declaration. Regexes now accept both quote styles; a new `decodeXbrlBytes()` decodes
    per the `<?xml encoding=?>` declaration (ISO-8859-1 → latin1, else UTF-8; unknown → UTF-8 fail-safe).
    ANDINA-B 818 ctx / 4402 facts / 30 mapped; VAPORES 200 ctx / 1024 facts / 23 mapped.
  - Namespace URIs are parsed into `XbrlInstance.namespaces` (never silently dropped). Taxonomy-only ZIP
    rejection unchanged (provider-level, before parsing).
- **No concept-map change** — both dialects use standard `ifrs-full:` for all mapped concepts (verified; the
  `cl-ci:` CMF-extension prefix is only for items we don't map). VAPORES legitimately reports **no**
  `ifrs-full:Revenue` (0 occurrences — a shipping holdco dominated by its Hapag-Lloyd equity stake); that field
  stays honestly missing, never fabricated (Yahoo fills it).
- **Production write:** the 6 newly-enabled issuers, **174 rows, 0 failures**, all `valid_with_warnings`.
- **Precedence + fallback verified live:** for the new issuers, XBRL (priority 210) **supersedes** the Yahoo
  annual (80) for FY2025 (is_superseded flags confirmed in the DB), while Yahoo quarterly/other-year annual
  stays the fallback (all quarters remain `yahoo_finance`). No migration, no source-priority change.
- **Tests:** `tests/financialsCmfXbrl.test.ts` 65→72 (dialect parsing: default-namespace, CTI-Service
  single-quote/ISO-8859-1, `decodeXbrlBytes` incl. unknown-encoding fail-safe, namespace-URI preservation,
  facts-free/taxonomy rejection; funnel 21/0/0/4; all-non-bank-enabled; banks still bank_track_required). Full
  suite 1017→1024/1024, lint 0, build 0 errors.
- **Cron still unscheduled** — the CMF entidad.php surface remains undocumented HTML; runs stay
  manual/reviewable.

Scope limits: non-bank CMF/XBRL completion only; annual filings only; no interim/YTD; no bank ingestion; no
new cron schedule; no paid/vendor APIs; no dependency; Yahoo-priority unchanged; Structured Notes/auth/
watchlist/portfolio/macro untouched; no UI redesign.

Next: bank-specific CMF/XBRL track (separate taxonomy, deferred) — or **Phase 8D** (FX/rates + economic
calendar) — or **Phase 9F** (Santander / older-2024-Citi structured-notes parser).

---

## Phase 8C.5 — Universal Fundamentals Coverage via Yahoo Finance (Quarterly + Annual for All 25 Stocks) ✓ COMPLETE (2026-07-09)

Fixes a real usability gap surfaced by using Charting on the live app: CMF/XBRL issuers only had **one annual
data point**, so the Quarterly/TTM/Annual toggle had nothing to aggregate for 15 stocks, and 10 stocks (the 4
banks + 3 unsupported-XBRL-dialect tickers + 3 synthetic-only tickers) had **no persisted fundamentals at
all**. CMF/XBRL structurally cannot reach the banks (Phase 8C.4 confirmed this), so no amount of CMF work
alone could make every stock's tabs work.

- **Yahoo Finance is the universal fundamentals source** (`src/lib/financials/providers/yahooFundamentalsProvider.ts`):
  fetches real quarterly (discrete, not YTD) + ~4-5 years annual income/balance/cash-flow for all 25 app
  tickers via `fundamentalsTimeSeries`, reading `financialCurrency` per ticker. Missing fields stay missing
  (never coerced to 0); capex/dividends stored as positive magnitudes (Yahoo reports them as negative
  outflows); values stored raw in the native currency, matching how XBRL facts are stored.
- **New source_type `yahoo_finance` at priority 80** — deliberately **below** `manual_csv` (100) and every
  official/vendor source, above `derived`/`static_seed`. This makes CMF/XBRL annual (210) supersede Yahoo
  annual automatically for the same fiscal year (verified live: CCU/SQM-B/CMPC etc. show `sourceType: xbrl`
  for their filed year), while Yahoo quarterly — a different logical period — always shows. Migration
  `20260711000000_financials_yahoo_source_type.sql` widens the `source_type` CHECK (idempotent, additive).
- **Retry-hardened fetch**: `yahoo-finance2`'s `fundamentalsTimeSeries(..., module: 'all')` intermittently
  fails with a "Failed to generate key" error non-deterministically (same ticker succeeds on one call, fails
  on the next — a real library quirk, not "this ticker has no data"). Found live during validation (SQM-B's
  quarterly data was silently empty on the first ingestion run). Fixed with a 3-attempt retry per fetch; a
  fetch that still fails after retries fails the whole ticker loudly (never silently persists a partial/empty
  history) — this is exactly the kind of gap the project's no-silent-fabrication doctrine exists to catch.
- **Ingestion**: `npm run ingest:yahoo-financials[:dry]` (`--ticker` for one, `--write` for real) + cron route
  `GET /api/cron/financials/yahoo` (Bearer `CRON_SECRET`, unscheduled — manual/reviewable like the CMF cron).
- **Honest labeling**: badge reads "Fundamentals via Yahoo Finance (unofficial)" — never claims Yahoo is
  official; `resolveFinancials.ts`'s `summarizeSource` surfaces the authoritative source present (XBRL, if
  any) with a `(+ Yahoo)`/`(+ manual)` nuance rather than a blanket label.
- **Production result**: all 25 tickers ingested, **2,921 rows written, 0 failures**. Every stock now has
  7–10 real reporting periods (1 XBRL-authoritative annual + Yahoo quarterly/annual for the 15 XBRL issuers;
  9-10 pure-Yahoo periods for the other 10). The 3 tickers (SQM-B, COPEC, BSANTANDER) carrying stale synthetic
  `manual_csv` sample rows from the original Phase 8C CSV templates had those rows deleted — no fabricated
  data remains in the database.
- **Charting fix verified live** (dev server, Phase 8C.4's Quarterly/Annual/TTM toggle logic from the prior
  session): BSANTANDER (bank, previously zero data) now renders all 3 frequency modes with real numbers —
  Quarterly shows 9 correctly-sorted periods, Annual correctly groups into 4 real year bars, TTM is enabled
  (≥4 quarters) and renders real rolling-window revenue values, no `—` placeholders.
- **Tests**: 18 new (`tests/yahooFundamentals.test.ts` — period derivation, field mapping incl. sign
  conventions and missing-field skipping, metrics, source registration/priority, migration, cron route
  hygiene) + 1 existing hygiene test corrected (a `/official/` regex false-positive that also matched the
  honest "unofficial" disclaimer — fixed to use a word boundary and assert the disclaimer is present). Full
  suite 999 → 1017/1017, lint 0, build 0 errors.

Scope limits: universal fundamentals coverage only; no new charting features beyond making the existing
toggle work; no paid/vendor API; no changes to CMF/XBRL priority/logic; Structured Notes/auth/watchlist/
portfolio/macro untouched; no UI redesign beyond the existing badge wiring; no mobile work.

Next: **Phase 8D** (FX/rates + economic calendar) — or continue CMF/XBRL issuer expansion (promote the 3
eligible_verified, add the 2 extra XBRL dialects) now that Yahoo backstops every stock regardless.

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

---

## Phase 9B / 9B.1 / 9B.2 — Shared Book Dashboard, Allocation/Archive UX, Dashboard Refinements ✓ COMPLETE (2026-07-06/07)

Generalized the Citi-only parser to also handle HSBC's EU template; converted the module from per-user to a
**shared book** (`auth.uid() is not null` RLS) with a book-level dashboard (live/ITM/near-barrier/autocallable
counts, issuer/entity exposure). Follow-up UX passes (9B.1/9B.2) added: Called→Archived flow with a `Called`
KPI, one-observation-per-valuation-date scheduling, allocation-by-entity grid for the 9 sociedades
(thousand-separator inputs), issuer bar chart + entity donut, an Update button for live refresh, an Issued
date column, an `archived_at` timestamp + "Archived as of" column, sortable/filterable dashboard, plain-English
KPI tooltips + legend, and a delete confirmation dialog. See the `CLAUDE.md` "Current Phase" history for the
full per-sub-phase file list. Migrations: `20260706120000_*` (shared book), `20260707000000_*` (allocation
upsert), `20260708000000_*` (archived_at). Tests 745. Build 56 routes.

Next: **Phase 9C** (parser expansion to Crédit Agricole/BNP Paribas/Barclays/BBVA) or **Phase 9D** (scheduled
price snapshots + observation-event automation).

---

## Phase 9C — Structured Notes: Multi-Issuer Parser Expansion ✓ COMPLETE (2026-07-07)

Extended the deterministic PDF parser from 2 issuer families (Citi/HSBC) to 6, adding **Crédit Agricole,
BNP Paribas, Barclays, and BBVA** as dedicated parser modules behind a new issuer-detection router
(`src/lib/structuredNotes/pdf/parsers/index.ts`). Automation-first: the goal was expanding *deterministic
extraction coverage*, not adding a manual-entry screen (manual entry remains the fallback it always was, for
low-confidence extractions and internal allocations only).

- **Router architecture** (`pdf/parsers/`): `types.ts` (shared contracts), `shared.ts` (pure utilities —
  ordinal-date stripping, wrap-tolerant label lookup, mixed-ticker-cell parsing, barrier-role classification,
  `classifyReviewState`), `citiHsbcParser.ts` (Phase 9B logic relocated verbatim — also the router's safe
  fallback for any undetected issuer), one module per new issuer, and `index.ts` (keyword-based
  `detectIssuer()` + dispatch, never guesses between two issuers).
- **Confidence/review-state model:** `ready` (≥0.90, no low-confidence fields) / `review_recommended` (≥0.70)
  / `review_required` (any critical field missing, or <0.70) / `unsupported` (issuer unidentifiable) — a
  missing critical field always forces review regardless of the numeric score. Surfaced via a new
  `reviewState` field on `POST /api/structured-notes/extract` and a 4-color badge on the upload/review UI.
- **Real-document validation:** all 4 new issuers extract at **confidence 1.0** against their real term
  sheets (Crédit Agricole `XS3306812929`, BNP Paribas `XS2999188746`, Barclays `XS2998054097`); BBVA
  (`XS2958604485`) extracts every field cleanly but is **always** forced to `review_required` because the one
  real sample available is itself an explicit draft ("Subject to completion") — the parser treats that as a
  hard gate, never an optimistic pass-through. The pre-existing Citi and HSBC fixtures continue to extract
  unchanged at confidence 1.0 through the same router (regression-proof).
- **Real-world parsing hazards handled:** BNP's ordinal dates and mid-phrase label wrapping; Barclays' mixed
  Bloomberg/Refinitiv ticker cells and mid-decimal-split price levels in its narrow cover-table layout (a
  digit-fragment reconstruction that only fires when the fragment is entirely alone on its own line, to avoid
  misjoining an unrelated row-index digit); Crédit Agricole's positionally-matched (not name-matched) barrier
  table and non-assumed knock-in-equivalence (only promoted to `high` confidence when the payoff wording
  explicitly confirms it); BBVA's clause-based (not table-based) extraction with two barrier clauses
  disambiguated purely by wording order ("equal to or greater than" vs "greater than or equal to").
- **Fixtures:** four new small, sanitized, fictional-value text fixtures
  (`tests/fixtures/structured-notes/{creditagricole,bnp,barclays,bbva}_sample_terms.txt`) reproducing each
  issuer's real field structure — no real PDFs or full extracted text committed, matching the existing
  Citi/HSBC fixture policy.
- **Tests:** 5 new test files — one per issuer parser plus a router test (issuer detection, safe fallback,
  unsupported-format handling, Citi/HSBC regression). 807 tests total (745 → 807).

Scope limits (explicit): parser expansion only — no dashboard redesign, no scheduled monitoring, no
price-snapshot cron, auth/watchlist/portfolio/macro/market/financials untouched, no mobile work, no
CMF/XBRL work this phase. Santander and older-2024 Citi templates remain unimplemented (flag for review,
never mis-parsed) — the next parser targets if pursued.

Build 56 routes · lint 0 · tests 807/807.

Next: **Phase 9D** (scheduled price snapshots + observation-event automation) or return to **Phase 8C.2**
(CMF/XBRL automated financials ingestion).

---

## Phase 9D — Structured Notes: Scheduled Price Snapshots + Observation Automation ✓ COMPLETE (2026-07-07)

Turns Structured Notes from automated PDF ingestion into **automated monitoring** — the primary requirement
for this phase. A scheduled cron now persists price snapshots for every active note's underlyings, evaluates
due observations (coupon/autocall/final) against those levels, and applies one conservative automatic
status transition. The existing on-demand "Update" button and live dashboard/detail routes are unchanged —
scheduled monitoring is additive, not a replacement.

- **Monitoring policy:** every level is a MONITORING ESTIMATE from Yahoo Finance, never an official
  calculation-agent determination — labeled as such everywhere it's surfaced. Missing/unsupported prices →
  `unavailable`, never fabricated. Coupon/autocall observations can transition deterministically once due
  (the barrier math is exact); final/maturity observations are **always** flagged `reviewRequired` — the
  legal payoff requires manual verification, never auto-finalized. Archived/called notes are never
  reactivated by scheduled monitoring.
- **Migration** `20260709000000_structured_notes_monitoring.sql`: makes
  `structured_note_price_snapshots.user_id` nullable (the cron writes via the service-role admin client, no
  session exists to populate `default auth.uid()`); adds 11 monitoring-evaluation columns to
  `structured_note_observations` (`observed_at`, `observed_source`, `observed_levels`, `coupon_eligible`,
  `autocall_eligible`, `final_barrier_breached`, `review_required`, `review_reason`, etc.); creates
  `structured_note_monitoring_runs` (system-level audit log, no `user_id`, read-only RLS for any
  authenticated user, no insert/update/delete policy — writes are service-role only).
- **Pure calculations** (`src/lib/structuredNotes/monitoring.ts`): `getActiveStructuredNotesForMonitoring`,
  `getUniqueUnderlyingSymbols`, `calculateStructuredNoteSnapshot`, `detectStalePrice`,
  `classifyStructuredNoteRisk` (reuses the Phase 9B severity model so the cron and the on-demand dashboard
  never disagree), `evaluateCouponObservation`/`evaluateAutocallObservation`/`evaluateFinalObservation`,
  `evaluateObservation` (dispatch + due-date gating), `shouldUpdateNoteStatus` (the one conservative
  automatic transition — autocall-eligible + clean data → `autocalled`), `deriveObservationStatus`,
  `calculateDashboardAggregates`.
- **Market provider** (`structuredNoteMonitoringProvider.ts`): wraps the existing batched Yahoo call with
  per-symbol success/failure accounting, so one bad symbol never blocks the rest of the book — the cron
  correctly reports `partial_success` rather than an all-or-nothing pass/fail.
- **Cron route** `GET /api/cron/structured-notes/snapshot` — Bearer `CRON_SECRET` (same pattern as the
  existing macro/health crons), service-role admin client. Vercel schedule `30 21 * * 1-5` (weekdays, 21:30
  UTC — fixed post-US-close across both EDT/EST halves of the year, since Vercel Cron has no timezone
  parameter). **Read endpoint** `GET /api/structured-notes/monitoring-status` — authenticated, latest run +
  stale/unsupported/due-soon/review-required counts.
- **UI:** dashboard shows the last monitoring run + stale/unsupported/due-soon/review-required counts + a
  monitoring-estimate disclaimer, without redesigning the layout; detail page's current-levels table gains a
  "last monitored" column (with a staleness warning), and the observation-schedule table gains Coupon/Autocall
  eligibility columns with a review-required tooltip.
- **Real-data validation:** ran the cron against the live production Supabase book (5 active notes, 2 unique
  underlying symbols) — persisted 10 price-snapshot rows, correctly evaluated 5 already-due Barclays coupon
  observations as `coupon_paid` (both underlyings well above their 65% barrier), recorded a `success`
  monitoring run, and a second run confirmed idempotent upsert (still 10 rows, 0 re-evaluated since those
  observations were no longer `scheduled`).
- **Tests:** 2 new test files, 55 new tests (pure monitoring calculations: worst-of strict eligibility, no
  NaN/Infinity, stale-price detection, archived-note non-reactivation, conservative status transitions; plus
  route/migration hygiene checks: cron auth, no-secret-leakage, RLS structure). 862 tests total (807 → 862).

Scope limits (explicit): scheduled monitoring only — no CMF/XBRL work, no News/Hechos/FX/calendar work, no
mobile work, auth/watchlist/portfolio/macro/market/financials untouched except by reusing the existing
market-provider utilities. No official calculation-agent feed, no paid/vendor data, no Bloomberg. Global
(non-US) underlyings and a robust/official market-data source remain future work (Phase 9E).

Build 59 routes · lint 0 · tests 862/862.

Next: **Phase 9E** (official/robust structured-note market-data provider expansion) or return to
**Phase 8C.2** (CMF/XBRL automated financials ingestion).

---

## Phase 9E — Structured Notes: Free Market-Data Architecture + Observation QA ✓ COMPLETE (2026-07-07)

Hardens Structured Notes monitoring's market-data layer without adding any paid/vendor dependency. Non-goal:
replacing Yahoo. Goal: the best free, resilient architecture — a provider abstraction, a fallback/sanity-check
orchestrator, and structured quote-quality rules — so a future free or licensed provider slots in without
touching the orchestrator, and every observation review-reason is a typed code instead of free text.

- **Free-provider discovery** (`docs/structured_notes_market_data_sources.md`): investigated Stooq (rejected —
  its CSV endpoints now serve a client-side SHA-256 proof-of-work challenge, confirmed live via curl, not a
  stable API; consistent with the project's no-scraping policy and the CMF CAPTCHA precedent), keyed free
  tiers (Alpha Vantage/IEX/Polygon/Twelve Data — rejected, a new secret for no clear benefit over Yahoo), and
  official exchange delayed-quote pages (rejected — JS-rendered, no public endpoint). **Verdict: Yahoo Finance
  remains the only viable free provider this phase** — ships as `implement_now`, everything else is
  `document_for_later` or `reject` with the evidence recorded.
- **Provider abstraction** (`src/lib/structuredNotes/marketData/providers/types.ts`): a
  `StructuredNoteMarketDataProvider` interface (`supportsSymbol`/`fetchQuotes`/`normalizeQuote`/
  `getProviderStatus`) any provider implements; `sourceType` is `free_monitoring_estimate | proxy | unsupported`
  — there is deliberately **no `official` value** in this phase, a structural guard against ever mislabeling
  free data. Yahoo refactored into `yahooStructuredNoteProvider.ts` with zero behavior change.
- **Fallback/sanity-check orchestrator** (`resolveStructuredNoteQuotes.ts`): queries **every** registered
  provider that supports a symbol — not only on failure — so a later provider both fills a gap the primary
  missed (fallback) and gets cross-checked against the primary's price for disagreement (sanity-check) once a
  second provider exists; a provider that throws is caught per-symbol-batch and never takes the rest of the
  book down with it. Runs with exactly one registered provider in production today.
- **Quote-quality rules** (`quoteQuality.ts`, pure): `classifyQuoteQuality` → `ok`/`warning`/`reject` per quote
  (missing/invalid price, unsupported symbol, provider error → reject; stale, large day-over-day move,
  currency mismatch → warning); `compareProviderQuotes`/`detectProviderDisagreement` for cross-provider
  sanity-checking (fully implemented and tested against mocked second providers). Thresholds are named
  constants: stale >3 calendar days (dashboard) / >1 day (a DUE observation), large move >15%, disagreement
  >1%.
- **Symbol mapping hardened** (`underlyingSymbolMap.ts`, additive): `UnderlyingSymbolEntry` gained
  `normalizedCode`, `providerSymbols` (`{ yahoo, stooq: null }`), `currency`, `verifiedAt`, `confidence`,
  `sourceType` — while preserving every pre-9E field name (`bloombergTicker`, `yahooSymbol`, `assetClass`,
  `displayName`, `verified`, `notes`) the 6 issuer parsers + `structuredNoteMarketProvider.ts` already read via
  `.yahooSymbol`/`.assetClass` (verified via grep across all 7 call sites before and after the change).
- **Observation QA** (`monitoring.ts`): `ObservationEvaluation.reviewReasons` is now a typed
  `ReviewRequiredReason[]` (`missing_price`, `stale_price`, `unsupported_symbol`, `provider_error`,
  `large_price_move_warning`, `provider_disagreement`, `final_observation_requires_official_verification`
  always on every final observation, `non_trading_day_or_unavailable_close`, `ambiguous_underlying_mapping`);
  the free-text `reviewReason` is derived from this list, not authored separately. An optional `quoteMeta`
  parameter (additive) enables the richer classification; omitting it preserves the exact pre-9E behavior.
- **No migration needed** — `structured_note_price_snapshots`/`_observations`/`_monitoring_runs` already had a
  `metadata jsonb` column from earlier phases; provider/quality diagnostics are written into it.
- **API additions:** the cron response and `GET /api/structured-notes/monitoring-status` both now include
  `providerSummary`, `unsupportedSymbols`, `staleSymbols`, `reviewRequiredObservations`/`reviewRequiredSymbols`,
  `fallbackProviderUsed`, `providerDisagreement` — all read from the run's `metadata`, absent/empty (never
  fabricated) on a pre-9E run.
- **UI:** subtle additions only — the dashboard's monitoring status line gains a provider-label chip
  ("Yahoo Finance monitoring estimate") and conditional "Free-source fallback used"/"Provider disagreement"
  badges (both inactive today, since only one provider is registered); no redesign.
- **Two real bugs caught by the new tests before they shipped:** (1) the orchestrator didn't catch a provider's
  `fetchQuotes` throwing — a hypothetical misbehaving provider would have crashed the whole batch instead of
  degrading to `provider_error`, now caught per-provider; (2) the no-providers-registered path returned an
  empty `quotes` array instead of one `unsupported` entry per requested symbol — fixed so every symbol always
  gets a quote object, even when zero providers are configured.
- **Tests:** 3 new test files + additions to 2 existing ones — 72 new tests (quote-quality pure functions,
  provider-abstraction shape, orchestrator fallback/disagreement/error-handling against mocked providers,
  observation-QA reason classification, symbol-map hardening, route/discovery-doc hygiene checks). 862 → 934.

**Real cron validation against the live production Supabase book** (no separate staging environment exists):
runId `33125122-b664-4592-ba43-a9b88f1c6b45`, `status: success`, 5 active notes, 2 underlying symbols, 2/2
succeeded, `providerSummary: {"yahoo-finance":{"requested":2,"succeeded":2,"failed":0}}`,
`fallbackProviderUsed: false`, `providerDisagreement: false` (both correctly false/absent with one provider
registered) — confirming the new response shape end-to-end against real data before deploying.

Build (0 errors, `npx tsc --noEmit` clean) · lint 0 · tests 934/934. Regression-checked: `/api/health/ingestion`
healthy, `/api/macro` and `/api/market/stocks` 200, `/structured-notes` still redirects unauthenticated
requests to `/login`, no console errors.

Scope limits (explicit): free-data architecture only — no paid/vendor API, no Bloomberg, no API key required
(none was justified), no claim that any free provider is official, no final/legal payoff determination from
free data, no CMF/XBRL work, no News/Hechos/FX/calendar work, no parser-behavior change beyond the additive
symbol-map metadata, auth/watchlist/portfolio/macro/financials untouched, no mobile work.

Next: extend the parser to Santander/older-2024-Citi templates; revisit free-provider discovery periodically
or evaluate a paid/vendor/official feed if ever authorized; add persisted scheduled snapshots for global
(non-US) underlyings once a note requires one — or return to **Phase 8C.2** (CMF/XBRL automated financials
ingestion).

---

## Phase 8D — FX, Rates, Copper, US Macro, and Economic Calendar Live-Source Completion ✓ COMPLETE (2026-07-10)

Expands live macro/market-source coverage beyond the existing Chile-only BCCh integration, using only
official or stable free sources. See `docs/macro_market_source_coverage.md` for the full discovery record
(every source investigated, implemented, or rejected, with reasons).

**Copper — implemented via BCCh.** The Phase 4B deferral was a genuine unit mismatch (BCCh's daily copper
series publishes USD/oz, the UI expects USD/lb). Re-running BCCh's official SearchSeries catalog surfaced a
second, previously-unnoticed monthly series already in USD/lb: `F019.PPB.PRE.40.M`. Verified live, no unit
conversion, no guessing — cross-checked against Yahoo Finance `HG=F` futures as a sanity check only.

**BTP-10, BCU-5, PDBC-90d, TPM-TNA — re-verified, still deferred.** No new live series exists for any of the
four (same conclusion as Phase 4B, confirmed again against the live catalog this phase).

**EUR/CLP — verified but deliberately not wired.** `F072.CLP.EUR.N.O.D` is confirmed live and correct, but
adding it requires a new `macro_indicators` row + UI card + static fallback, which is UI/data-model scope
beyond this phase's source-discovery scope. Documented for a future phase to wire in directly.

**US macro — implemented via FRED (Federal Reserve Bank of St. Louis).** FRED's public CSV "graph" endpoint
(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>`) requires **no API key** — genuinely free,
official, verified live. 9 series mapped: Fed Funds, US 3M/2Y/10Y/20Y/30Y Treasury yields, US Unemployment,
US CPI m/m and y/y (the last two intentionally share one underlying FRED series, `CPIAUCSL`, with different
derived transforms — mirroring how Chile's IPC mensual/anual both derive from one BCCh level series).
Nonfarm payrolls, ISM/PMI, and a recession-indicator series were considered and deliberately **not** added
this phase (no UI slot, no free reliable source, or doesn't fit the existing indicator value/change model,
respectively).

**Dual-provider architecture.** `src/config/usFredSeriesManualMap.ts` mirrors `bcchSeriesManualMap.ts`'s
human-verification discipline exactly — no code ever guessed. `src/config/macroSeries.ts`'s registry now
dispatches each series definition to the correct manual map based on `sourceProvider`
(`'BCCh' | 'FRED' | ...`); `getEnabledBcchSeries()` / `getEnabledFredSeries()` scope each provider (and each
ingestion script) to only its own series, so a FRED series can never accidentally reach the BCCh client or
vice versa. `src/lib/providers/fredClient.ts` + `fredMacroProvider.ts` implement the same `MacroProvider`
contract as the BCCh equivalents. The orchestrator (`macroProvider.ts`) now queries both providers in
parallel for the indicators list and dispatches per-indicator to the correct provider for history — the
Supabase-persisted read layer and static-fallback layer needed **no changes**, since both already key purely
off `indicator_id`.

**Ingestion:** `scripts/ingest/fredMacroCore.ts` (pure) + `scripts/ingest/fredMacro.ts` (CLI,
`npm run ingest:fred-macro:dry` / `ingest:fred-macro -- --all --write`) + `src/lib/ingestion/fredMacroIngestion.ts`
(shared logic) + `GET /api/cron/ingest-fred-macro` (Bearer `CRON_SECRET`) — **not added to `vercel.json`**,
manual/reviewable trigger only, same policy as the BCCh/CMF-XBRL/Yahoo-financials crons. A real bug was
caught while auditing the existing BCCh scripts during this phase: `getEnabledSeries()` (now returning both
providers' series since the registry merge) was being called unscoped in `scripts/ingest/bcchMacro.ts` and
`src/lib/ingestion/bcchMacroIngestion.ts` — fixed to call `getEnabledBcchSeries()` so the BCCh-only ingestion
path can never accidentally attempt to fetch a FRED series code via the BCCh client.

**Economic calendar — deferred, unchanged.** Re-investigated; no free, structured (non-scraped), stable
calendar source was found (government sites publish only rendered HTML; commercial calendar vendors require
a paid API key). The existing schedule-driven synthetic calendar (`src/lib/data/calendar.ts`) continues
unchanged, honestly labeled as such.

**No schema migration, no new dependency, no new cron schedule.** `macro_observations`/`macro_indicators`
already support an arbitrary `source_provider` + per-row `metadata jsonb` — FRED rows write through the
exact same `upsertMacroObservations()` repository function BCCh rows use.

**Plausibility bands:** 9 new bands added to `src/lib/providers/plausibility.ts` for the FRED series
(`fed-funds`, `us3m`, `us2y`, `us10y`, `us20y`, `us30y`, `us-unemployment`, `us-cpi-mensual`, `us-cpi-anual`).

**Tests:** 5 new test files — `tests/fredMacroIngest.test.ts` (pure core helpers), `tests/fredClient.test.ts`
(CSV parsing), `tests/macroSeriesDualProvider.test.ts` (registry dispatch + manual map verification),
`tests/fredCronIngestion.test.ts` (ingestion result shape + cron route hygiene), plus additions to
`tests/transforms.test.ts` (new plausibility bands) and a correction to `tests/bcchMapping.test.ts` (copper
was hardcoded there as the "known unverified" example — updated to use `btp-10`, still genuinely unverified,
plus a new test asserting copper's verified entry). Full suite 1102 → 1156/1156, lint 0, build 0 errors (new
route `/api/cron/ingest-fred-macro` present, 0 new errors).

**Local validation:** live dry-run of all 9 FRED series (`npm run ingest:fred-macro:dry`) — 12,961 rows
across 9 indicators, all succeeded; live dry-run of all 12 enabled BCCh series including copper
(`npm run ingest:bcch-macro:dry`) — 18,512 rows, copper returned 118 real monthly USD/lb observations
(2016–2026).

Scope limits (explicit): macro/market source-discovery expansion only; no financials refactor; no
Structured Notes/auth/watchlist/portfolio changes; no UI redesign; no paid/vendor APIs; no Bloomberg; no
CAPTCHA bypass; no fragile scraping; no new cron schedule (FRED cron stays unscheduled, same as BCCh's
sibling routes); EUR/CLP and Nonfarm Payrolls documented as ready-to-wire but out of scope this phase
(UI-slot work, not source-discovery work).

Next: wire EUR/CLP (new `macro_indicators` row + UI card); add a Nonfarm Payrolls UI slot if desired;
periodically re-check the economic-calendar source landscape — or return to Structured Notes (Santander/
older-2024-Citi parser templates) or continue CMF/XBRL issuer work.

---

## Phase 8D.1 — Macro Category Fix + BCCh FX Cleanup + FRED Release-Date Calendar ✓ COMPLETE

Follow-up cleanup pass on Phase 8D, using the newly-available `FRED_API_KEY` (server-only, free,
self-service) for a new dates-only release calendar. Full detail in `CLAUDE.md` → "Phase 8D.1" entry;
condensed here.

**Category bug fixed.** `bcchMacroProvider.ts` and `fredMacroProvider.ts` both hardcoded
`category: 'Rates'`/`'US Rates'` for every live indicator — confirmed live (copper, IPC, IMACEC,
unemployment, US CPI, US unemployment all misfiled). Fixed by adding `category: MacroCategory` to
`MacroSeriesDef` (`src/config/macroSeries.ts`), matched against `macroIndicators.json`; both providers now
read `def.category`. Regression test in `tests/macroSeriesDualProvider.test.ts` asserts this can't recur.

**EUR/CLP wired live** (`F072.CLP.EUR.N.O.D`, verified in Phase 8D, wired this phase) — same pattern as
copper: manual map entry, `macroSeries.ts` entry (category `FX`), static fallback row, new `macro_indicators`
DB row (data insert, no migration). 2,486 rows ingested.

**Home page FX panel rebuilt BCCh-only.** Previously rendered 25 static currency pairs across 4 sections
with fabricated "Bloomberg"/"CoinMarketCap" source labels. Now renders directly from the live macro `FX`
category (`getByCategory('FX')`) — exactly 2 verified pairs (USD/CLP, EUR/CLP). Removed: the 4-section
grouping, the "# of currency per USD" helper row, the "Static MVP sample" label. The other 23 pairs are
excluded (`no_verified_bcch_series` — no confirmed live BCCh series exists for them); `fxRates.json`/
`fxRates.ts` untouched, still back the separate Macro-page FX depth table.

**Nonfarm Payrolls — verified live, deliberately deferred.** FRED's `PAYEMS` is a cumulative level, not the
month-over-month change the "NFP" headline means; deriving it needs a new `diff` transform type (none of
`transforms.ts`'s existing transforms fit) — judged not "straightforward," deferred and documented rather
than overbuilt.

**New: dates-only FRED release calendar.** FRED's Releases API (`/fred/release/dates`, distinct from the
public CSV time-series endpoint) requires `FRED_API_KEY`. 13-release curated allowlist
(`src/config/fredReleaseAllowlist.ts`) after excluding 2 releases (FOMC Press Release id 101, H.15 id 18)
found via live testing to return near-daily noise (53/36 hits across every day in a 45-day window) rather
than discrete dates — documented, not shipped. Architecture: `fredReleaseCalendarClient.ts` (server-only) →
`fredReleaseCalendar.ts` (orchestrator, every event `datesOnly: true`, `actual`/`consensus`/`prior` always
`null`) → `GET /api/macro/fred-release-calendar` (public, sanitized) → `fredCalendar.ts` (client fetch
helper) → a new panel on `/macro/calendar`, additive below the unchanged synthetic calendar table. No
persistence, no migration, no new cron — live-queried per request.

**Tests:** `tests/fredReleaseCalendar.test.ts` (18 new — allowlist shape/exclusions, configured/unconfigured
paths, mocked fetch, dates-only invariants, no client-side key exposure) + additions to
`tests/macroSeriesDualProvider.test.ts` (category regression guard, FX-panel cleanup hygiene). Full suite
1156 → 1187/1187, lint 0, build 0 errors.

**Local validation:** `/api/macro/fred-release-calendar` returns 19 clean events; Home FX panel confirmed
showing exactly USD/CLP + EUR/CLP; `/macro/calendar` FRED panel confirmed rendering correctly.

Scope limits (explicit): no Finnhub, Frankfurter, or paid vendors; no full consensus/actual/prior calendar;
financials/Structured Notes/auth/watchlist/portfolio/UI redesign untouched; no new cron schedule.

Next: bring the Macro page's FX depth table to the same BCCh-only standard; add a `diff` transform + UI slot
for Nonfarm Payrolls if desired; consider persistence for the FRED calendar if usage justifies it.

---

## Phase 8D.2 — Calendar Production Integrity Fix ✓ COMPLETE (2026-07-13)

A read-only audit of `/macro/calendar` requested by the user found a real bug: the page rendered a
schedule-driven **synthetic table** (`src/lib/data/calendar.ts` — deterministic pseudo-random forecast/
actual/prior values via `mulberry32(hash(key+date))`) above the real FRED dates-only calendar built in Phase
8D.1. The synthetic table included Chile rows whose event names referenced BCCh/INE by name ("TPM Rate
Decision (BCCh)", "Unemployment Rate (INE)") despite having zero actual BCCh/INE backing, and rendered with
identical table styling to genuinely live data — easily mistaken for real economic figures. The same
synthetic module also powered a "today's releases" preview widget on the Macro page (`/macro`).

**Fix — removed from production, not merely relabeled:**
- `/macro/calendar` no longer imports `src/lib/data/calendar.ts`. The removed synthetic table (week
  navigation, free-text search, forecast/actual/prior columns, Chile + US rows) is gone; the page now shows
  only the real FRED dates-only calendar (unchanged) plus a new honest **Chile release calendar: deferred**
  block — states plainly that no free/stable/structured official Chile release-date source has been
  verified, and that BCCh/INE macro *values* remain available via the app's macro indicators elsewhere,
  separately from release *dates*.
- `/macro` no longer imports `src/lib/data/calendar.ts` either — its "today's releases" synthetic preview
  widget was replaced with a plain link out to `/macro/calendar`, same visual container, no fabricated table.
- `src/lib/data/calendar.ts` itself is **retained, not deleted** — `tests/calendarSchedule.test.ts` (added in
  a prior session after a real user-reported weekend-scheduling bug in this same module) still exercises its
  pure date-scheduling logic as a regression guard. Its file header now explicitly reads "TEST/DEMO-ONLY —
  NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE."
- Removed the now-dead synthetic-table-only i18n keys (`search`/`today`/`next`/`results`/`noResults`/
  `noToday`/`time`/`country`/`event`/`forecast`/`actual`/`prior` in the `cal` block) and added
  `chileTitle`/`chileDeferred`/`chileUnavailable` (EN + ES).

**No new provider, no scraping.** Per the fix's explicit scope: no Finnhub, no Frankfurter, no
Investing.com/ForexPros crawling, no paid vendor calendar, no Chile HTML scraping, no PAYEMS diff-transform
work — all remain out of scope, unchanged from Phase 8D/8D.1's own deferrals.

**Tests:** `tests/calendarProductionIntegrity.test.ts` (20 new) — no file under `src/app/**` imports the
synthetic module; the module is explicitly marked test/demo-only; `/macro/calendar` renders no forecast/
actual/prior columns and no week-nav/search controls; FRED's dates-only/no-consensus labeling is unchanged;
the FRED provider's `actual`/`consensus`/`prior` fields are structurally `null`; the new Chile deferred copy
exists in EN/ES and asserts "no verified official source"; the dead i18n keys are confirmed removed; the
Macro page widget removal is confirmed; `FRED_API_KEY` handling (server-only, never `NEXT_PUBLIC_`, never
echoed in the route's JSON response) is unchanged and re-verified. Full suite 1278 → 1298/1298, lint 0,
build 0 errors.

**Local validation:** `npm run supabase:check` / `supabase:check-macro` unchanged from baseline (22/22 macro
indicators healthy, `eurclp`/`cobre-lme` persisted correctly) — this fix touches only the calendar UI/i18n
layer, no macro ingestion or category logic. See `docs/macro_market_source_coverage.md` §10 for the full
discovery/removal rationale.

Scope limits (explicit): no new economic-calendar provider; no Finnhub, Frankfurter, Investing.com/
ForexPros, or paid vendor sources; no Chile HTML scraping; no NFP PAYEMS diff-transform; no visual redesign
beyond the minimal content swap needed to remove fabricated data; no financials/Structured Notes/auth/
watchlist/portfolio changes; no new cron schedule.

Next: periodically re-check for a real official Chile release-date source; add a `diff` transform + UI slot
for Nonfarm Payrolls if desired; consider persistence for the FRED calendar if usage justifies it — or
return to Structured Notes (Santander/older-2024-Citi parser templates) or CMF/XBRL issuer work.

---

## Phase 8D.3 — Economic Calendar Actual/Previous Enrichment + Weekday Post-Close Refresh ✓ COMPLETE (2026-07-13)

Enriches the FRED dates-only release calendar (Phase 8D.1 / calendar-integrity fix) with **real `actual` and
`previous` values**. Release **dates** still come from FRED's release calendar; actual/previous **values** come
from FRED **time-series** (the keyless CSV endpoint already used for US macro), transformed via the shared
`transforms.ts`. Consensus/forecast/surprise remain **unavailable by design** — this is not a vendor calendar.

**Release-to-source mapping** (`src/config/calendarEnrichmentMap.ts`) — 11 curated US releases → FRED series,
each verified live before mapping (never guessed), tagged with `originatingAgency` (BLS/BEA/Census/Fed) for
provenance: CPI (`CPIAUCSL` y/y+m/m), PPI (`PPIFIS`), PCE + core PCE (`PCEPI`/`PCEPILFE`), Employment Situation
(NFP `PAYEMS` + unemployment `UNRATE`), JOLTS (`JTSJOL`), GDP (`A191RL1Q225SBEA`), Retail Sales (`RSAFS`),
Industrial Production (`INDPRO`), Housing Starts (`HOUST`), New Home Sales (`HSN1F`), Trade Balance (`BOPGSTB`).

**FRED-normalized, direct BLS/BEA/Census deferred.** FRED redistributes the agencies' primary series verbatim;
standing up three keyed agency clients with unverified series/table/line-code mappings was assessed and
deferred (never-guess rule) — the prompt authorized FRED as the normalized source. The fetched source is always
FRED and labeled as such; the UI never claims a direct BLS/BEA/Census call.

**NFP `level-diff` transform** — new `transforms.ts` transform derives the headline Nonfarm Payrolls
month-over-month change from `PAYEMS` (a cumulative level in thousands); the raw level is never the headline.
The `diff`-transform previously deferred in 8D/8D.1 is now implemented, bounded to this use.

**Excluded, not fabricated:** ADP (FRED `NPPTTL` stale since 2022) and Existing Home Sales (NAR, non-govt) —
dates-only, actual/previous unavailable.

**Enrichment semantics** (`src/lib/providers/calendarEnrichment.ts`, server-only): past → published
actual+previous; scheduled → pending actual + last-published previous; failed/insufficient → unavailable (never
zero-filled). Best-effort — any fetch failure degrades that metric only; the dates-only calendar always renders.
Wired into `GET /api/macro/fred-release-calendar` (now `enriched: true`, `consensusAvailable: false`); the UI
(`/macro/calendar`) shows Metric / Actual / Previous / Source (agency chip) / Imp. columns with pending +
unavailable states, and an honest footer naming both sources.

**Weekday post-close cron** `/api/cron/refresh-calendar-enrichment` (Bearer `CRON_SECRET`, `vercel.json`
`30 22 * * 1-5`) recomputes the enrichment ~30 min after the US close and returns a structured
availability/health summary — stateless (`persisted: false`; enrichment is computed live per request, no
migration/persistence this phase).

**Tests:** `tests/calendarEnrichment.test.ts` (22 new — `level-diff` math, map shape/exclusions,
published/pending/unavailable, multi-metric releases, provider-error isolation via injected fetcher, cron
auth/no-key-leak, no forecast/surprise fields, vercel schedule) + `tests/calendarProductionIntegrity.test.ts`
updated for the real actual/previous columns. Full suite 1298 → **1320/1320**, lint 0, build 0 errors.

**Local validation (dev server, real FRED):** `/api/macro/fred-release-calendar?days=45` → `enriched: true`,
22 enriched events; Trade Balance (past) actual −77,585 / previous −54,570 (published, BEA); CPI (upcoming)
pending / previous 4.17% y/y (BLS); NFP previous +57K (level-diff, never the raw level); consensus null and no
forecast/surprise field anywhere. Cron 401 without bearer, authorized run `status: success` (37 metrics, 0
unavailable). `/macro/calendar`, `/macro`, `/api/macro`, `/api/market/stocks`, `/api/health/ingestion` all 200;
`supabase:check-macro` unchanged (22/22 healthy).

Scope limits: actual/previous enrichment for curated US releases only; FRED-normalized sourcing (direct
BLS/BEA/Census deferred); no consensus/forecast/surprise; no Finnhub/Frankfurter/Investing.com/ForexPros/paid
vendor; no Chile HTML scraping (Chile calendar stays deferred); no persistence/migration; no financials/
Structured Notes/auth/watchlist/portfolio changes; no visual redesign beyond the new columns.

Next: add direct BLS/BEA/Census provider clients if warranted; persist enrichment if usage justifies; add a
standalone NFP macro-indicator card; periodically re-check for a real official Chile release-date source.

---

## FX Data Task — Macro / US Forex Table via CurrencyFreaks ✓ COMPLETE (2026-07-14)

Adds a server-side **CurrencyFreaks** provider (unofficial third-party, `sourceType:
'unofficial_third_party_fx'`) for the Macro page's US-region "FX depth" table, which previously read the same
fabricated-"Bloomberg"-sourced static `fxRates.json` the 8D.1 Home-page fix had already retired for Chile.
**Chile FX is entirely untouched** — stays BCCh-official/static via `getFxRates()`/`CL_FX`.

**Architecture:** `currencyFreaksClient.ts` (server-only, reads `CURRENCYFREAKS_API_KEY` only, sanitized
errors, 10s timeout) → `currencyFreaksFxProvider.ts` (server-only — pair methodology + a 6-hour module-scope
cache, fails closed on a non-USD base) → `GET /api/macro/fx/us` (public, sanitized) →
`src/lib/data/currencyFreaksFx.ts` (client-safe fetch helper, type-only import from the provider). Macro page
fetches it lazily only when `region === 'US'`.

**USD-base pair methodology** (verified live, 2026-07-14): 8 **direct** pairs (USD/JPY, USD/CHF, USD/CAD,
USD/MXN, USD/BRL, USD/CNY, USD/KRW, USD/TWD — raw rate) + 4 **inverted** pairs (EUR/USD, GBP/USD, AUD/USD,
NZD/USD — `1/rate`, marked `†` "Derived" in the UI). Day-change/YTD are typed `null` and never rendered — the
source has no such field on the free plan, and it publishes only one snapshot/day (verified via repeated
same-day calls), which is why the 6h cache is conservative rather than a limiting factor (~120 req/month
estimate).

**Tests:** `tests/currencyFreaksFx.test.ts` — 28 new (missing key, no key/URL leakage, symbol filtering,
numeric parsing + invalid-rate rejection, direct/inverted pair math, missing-rate omission, non-USD-base
fail-closed, 6h caching, no raw-payload leakage, Macro-page wiring + Chile-untouched regression, no
`NEXT_PUBLIC_CURRENCYFREAKS_API_KEY`). Full suite 1369 → **1397/1397**, lint 0, build 0 errors.

**Local validation:** `/api/macro/fx/us` → `ok: true`, `source: CurrencyFreaks`, `base: USD`, 12 rows, all
pairs correct against the live endpoint. Macro / US page confirmed rendering the badge, "As of" column, `†`
disclaimer, and no day/YTD columns; Chile region regression-checked unchanged. Confirmed the API key never
appears in the Next.js client bundle (`.next/static`) — only in server-side build cache. `supabase:check` /
`supabase:check-macro` unchanged (no schema touched by this task).

Scope limits (explicit): Macro / US forex table only; Chile FX untouched; no paid CurrencyFreaks tier; no
historical CurrencyFreaks data; no non-USD crosses beyond the 4 documented inverted pairs; no fabricated
day-change/YTD; financials, Structured Notes, the calendar's actual/previous logic, and auth/watchlist/
portfolio untouched. See `docs/macro_market_source_coverage.md` §13 for the full discovery/design record.

---

## FX Integrity Task — Frankfurter FX + 1D/YTD Change + Static FX Cleanup ✓ COMPLETE (2026-07-14)

Replaces CurrencyFreaks (the FX Data Task's source, above) with **Frankfurter** for the Macro / US forex
table — free, open-source, **no API key**, sourcing from 84 central banks (verified live at
`https://frankfurter.dev/`). CurrencyFreaks' free plan had no historical/change data at all, so the prior
table could only ever show a static "last" value. Separately, an audit found the Macro page's **Chile** FX
depth table (`fxRates.json`/`CL_FX`) had **no live or persisted backing whatsoever** — a static/sample table
sitting next to genuinely live BCCh rows — so it was **removed from production** entirely.

**Frankfurter v2 REST API verified live, not assumed:** `https://api.frankfurter.dev/v2/rates` returns a flat
array of `{date, base, quote, rate}` (a different shape from the classic `frankfurter.app` v1 endpoint), using
`quotes=` (not `symbols=`) for currency filtering, plus `date=` (single historical date) and `from=`/`to=`
(time series). All 12 target currencies confirmed present in `/v2/currencies` — no pairs removed. A genuine
data question (weekend queries return slightly different values instead of a frozen prior-business-day rate,
unlike `frankfurter.app`) was investigated and resolved: v2 blends up to 84 real central-bank feeds (confirmed
via `/v2/providers`), so this is real multi-source data, not fabrication — the resolver was designed
accordingly, using bounded windows rather than any date-arithmetic assumption.

**Pair methodology unchanged from the FX Data Task:** 8 direct pairs (USD/JPY, USD/CHF, USD/CAD, USD/MXN,
USD/BRL, USD/CNY, USD/KRW, USD/TWD) + 4 inverted pairs (EUR/USD, GBP/USD, AUD/USD, NZD/USD = `1/rate`, marked
`†`).

**Real 1D and YTD % change — new this task, never fabricated:** two bounded Frankfurter time-series calls
per refresh — a recent 10-day window locates the two most recent distinct dates (`currentDate`/
`previousDate`), and a prior-year-end window (Dec 20-31) locates `ytdBaseDate`. 1D% = (current/previous −
1)×100; YTD% = (current/ytdBase − 1)×100. For inverted pairs, **both snapshots are inverted first**, then the
% change is computed on the inverted values — a wrong-sign bug (using the raw USD-base quote's own change)
this project's tests specifically guard against. A pair whose previous/YTD-base snapshot isn't found in its
bounded window reports `null` for that field (rendered as `—`), never zero-filled or interpolated.

**Chile FX depth table removed from production:** the CL region's grid slot now shows a plain integrity note
("A broader Chilean FX depth table is not shown here — verified BCCh-live pairs are in the table above.")
instead of the removed static table. Chile's genuinely live BCCh pairs (USD/CLP, EUR/CLP) are untouched and
remain visible in the main indicators table. `getFxRates()`/`CL_FX` are no longer referenced in `macro/page.tsx`.

**Static/deprecated modules retained but isolated from production**, mirroring the calendar production-
integrity-fix precedent: `fxRates.ts`/`fxRates.json` are now header-marked "TEST/DEMO-ONLY — NOT IMPORTED BY
ANY PRODUCTION ROUTE OR PAGE"; `currencyFreaksClient.ts`/`currencyFreaksFxProvider.ts`/`currencyFreaksFx.ts`
are header-marked "DEPRECATED ... NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE". `CURRENCYFREAKS_API_KEY`
remains configured in Vercel (never removed, per instruction) but is no longer read by any production code
path. Regression tests walk `src/app`/`src/lib/data` and fail if either module is ever silently re-imported
by a production file.

**Cache policy:** 2 Frankfurter calls per 6-hour cache refresh (unchanged conservative TTL from the prior
task) — an estimated ~240 requests/month, trivial for a free keyless API with no documented rate limit.

**Tests:** `tests/frankfurterFx.test.ts` (new, 42 tests) — Frankfurter response parsing, currency coverage,
direct/inverted pair value + 1D/YTD math (incl. the inverted-sign regression case), weekend/holiday-tolerant
date selection, missing-snapshot → `null`, caching, no-raw-payload leakage, Macro-page wiring, Chile-table-
removal, CurrencyFreaks-production-import guard, `fxRates.ts`-production-import guard.
`tests/currencyFreaksFx.test.ts` retained (25 tests) as regression coverage for the deprecated module. Full
suite 1397 → **1436/1436**, lint 0, build 0 errors.

**Local validation:** `/api/macro/fx/us` → `ok: true`, `source: Frankfurter FX reference`, real distinct
`currentDate`/`previousDate`/`ytdBaseDate`, all 12 pairs with real 1D/YTD percentages. Macro / US page
confirmed rendering Day/YTD columns with real signed percentages; Macro / Chile page confirmed rendering the
integrity note in place of the removed table, live BCCh pairs unaffected. No console errors.
`supabase:check`/`supabase:check-macro` unchanged (no schema touched).

Scope limits (explicit): Macro / US forex table + Chile FX depth table removal only; no CurrencyFreaks
historical workaround; no paid FX API; no Frankfurter MCP server (direct REST API only); no broad FX
architecture refactor; financials, Structured Notes, the calendar's actual/previous logic, and
auth/watchlist/portfolio untouched; `CURRENCYFREAKS_API_KEY` left configured in Vercel, unremoved. See
`docs/macro_market_source_coverage.md` §14 for the full discovery/design record.

---

**Macro UX Task — Live Yield Curves, Update Button, Current-Month Calendar Embed, Badge/Footer Conventions**
✓ COMPLETE (2026-07-14)

Six-part Macro page overhaul requested directly by the user, all implemented and validated live:

1. **Live yield curves (both regions).** New `src/lib/providers/yieldCurveProvider.ts` computes today/1-week-
   ago/prior-year-end using **only already-verified series** (US: 5 FRED tenors 3M/2Y/10Y/20Y/30Y; CL: 5 BCCh
   series TPM/Cámara Swap 1Y/2Y/BTU 5Y/10Y, the BTU tenors labeled `(UF)` since they're real not nominal rates)
   — no new series were guessed or added without live verification (FRED access was unavailable from this
   task's sandbox to verify additional tenors). A tenor missing a usable point for any target date is dropped
   entirely, never fabricated. New `GET /api/macro/yield-curve?region=`, 6h server cache, static-curve fallback
   preserved. Verified live in the dev server: "Live BCCh"/"Live FRED" badges with real values and dates.
2. **"Live" badge wording + `"Source: X as of Mon/DD/YY"` footnote convention.** Fixed `frankfurterLive`/
   `yahooLiveOverlay` registry labels to lead with "Live —". New `formatSourceDate()` (timezone-safe, no
   `Date()` parsing) + shared `<TableSourceFooter>` component, wired into the Macro page's 3 tables,
   `/macro/calendar`, and Home's Macro/FX panels (the sections with a real per-row as-of date).
3. **Update Data button** on the Macro page — refreshes indicators (both regions), the yield curve, and
   (US only) the Frankfurter FX table + current-month calendar in one click. Verified live: every expected
   endpoint re-fetched with no errors.
4. **Current-month economic calendar embedded** on the Macro main tab (US region — real FRED events for the
   current calendar month) with "View full calendar →" for other months; Chile shows the same honest deferred
   message `/macro/calendar` already used. `resolveFredReleaseCalendar` refactored into a thin wrapper over a
   new `resolveFredReleaseCalendarRange(start, end)` (unchanged behavior, regression-tested); the table markup
   was extracted into a shared `EconomicCalendarTable` component reused by both pages.
5. **Region-aware subtitle — a real bug fixed.** The Macro page's subtitle was a single fixed string reading
   "...Banco Central de Chile · INE · **Hacienda** · LME" shown even on the US tab (and Hacienda was never
   actually a real source for any indicator). `clSubtitle`/`usSubtitle` existed in `i18n.ts` but were dead
   code — now correctly wired per region, with the wording corrected (Hacienda removed; US gains BEA).
6. **Market Implication column removed** from the indicators table (both regions) — static editorial
   commentary, never a live/derived field; the underlying JSON field is untouched, only the column dropped.

**Tests:** `tests/yieldCurveProvider.test.ts` (14 new), plus additions to `tests/fredReleaseCalendar.test.ts`
(3) and `tests/formatters.test.ts` (4). Full suite 1436 → **1456/1456**, lint 0, build 0 errors (14 API
routes, new `/api/macro/yield-curve`).

**Local validation (dev server, real BCCh/FRED/Frankfurter):** both regions confirmed correct — no Chilean
agency names on the US tab, no Market Implication column, real "Source: X as of Mon/DD/YY" footers, live
yield curves with real values/dates, current-month FRED calendar embedded with real events, Update button
verified via server logs (every endpoint re-fetched successfully). No console errors on Macro or Home.

Scope limits (explicit): this Macro-page task only. The broader "all tables" footer/badge convention was
applied to the Macro page, `/macro/calendar`, and Home's Macro/FX panels — sections with a genuine per-row
as-of date. Home's sector/rates/index panels and other pages' static-only footers were left unchanged (no
real date to report, would require fabrication or scope beyond this task). US yield curve stays 5 tenors
pending live verification of additional FRED series. No new dependency, no schema change. See
`docs/macro_market_source_coverage.md` §15 for the full record.

Next: verify + add the remaining FRED Treasury tenors (1M/6M/1Y/3Y/5Y/7Y) for a richer US yield curve;
extend the footer convention to Home's sector/rates/index panels if a real as-of date becomes available;
periodically re-check for a live Chile release-date source.

---

**Home Page Overhaul — Real Watchlist, Merged Watchlist+FX Table, Badge/Footer Wording** ✓ COMPLETE (2026-07-15)

Four-part Home page fix requested directly by the user:

1. **"Tracked Stocks" → "Watchlist", wired to the user's real `/watchlist` selection.** Previously the Home
   card just sliced the first 8 companies from the static universe — unrelated to what the user actually
   added on the authenticated `/watchlist` page (Phase 6A). Now fetches `GET /api/watchlists` +
   `/api/watchlists/[id]/items` (Supabase-persisted, auth-gated by middleware) and renders those exact
   tickers, merged with the same static→Supabase→Yahoo-live price cascade the rest of the app uses. A 401
   (not signed in) renders a "Sign in to see your personalized watchlist" prompt linking to `/login` — never
   an error; an authenticated-but-empty watchlist renders a prompt linking to `/watchlist` to add tickers.
2. **Watchlist and FX merged into one table**, band-separated exactly like the Macro card's Chile/US bands
   (`bg-surface-2` + accent-colored `borderLeft` divider rows) — replacing the previous two separate cards.
   Each band carries its own source badge (`MarketDataSourceBadge` for the stock/Yahoo side, `DataSourceBadge`
   for the BCCh FX side) since the two halves have genuinely different sources.
3. **Watchlist columns are now Ticker / Company / Price / Day Chg. / YTD — Market Cap removed**, per explicit
   instruction. FX rows reuse the same 5-column shape (pair name spans Ticker+Company, rate under Price, %
   change under Day Chg., YTD shows `—` since BCCh FX indicators don't carry a YTD figure).
4. **Badge/footer wording fixed.** `marketData.persisted` no longer reads the vague "Persisted market data" —
   it (and `marketData.live`) now names the real source ("Live — Yahoo Finance" / "Persisted — Yahoo
   Finance"), matching the "Live X" / "Persisted X" convention already used for BCCh/FRED/Frankfurter badges.
   `home.sectorSource`/`home.indexSource` dropped "via Yahoo Finance"/"(index proxies noted on /stocks)"
   verbosity — both now read a plain "Yahoo Finance" via the shared `TableSourceFooter`, with a real `asOf`
   date computed from the already-fetched live/Supabase snapshot state (`sectorAsOf`/`indexAsOf`,
   `watchlistAsOf`) rather than left blank.

**Tests:** `tests/homeWatchlistOverhaul.test.ts` (new, 14 tests) — real-watchlist fetch wiring, 401/empty
states, the merged single-table structure, column shape (Price present, Market Cap absent), the corrected
badge/footer i18n strings, and a regression check that status/asOf values are still derived from
already-fetched state (no new provider calls introduced). Full suite 1458 → **1472/1472**, lint 0, build 0
errors.

**Local validation (dev server, real Supabase/BCCh/Yahoo):** confirmed live — unauthenticated view shows
"Sign in to see your personalized watchlist" in the Watchlist band; the FX band renders below it in the same
table with the correct 5-column shape (YTD `—`); Macro card badges "Live BCCh"/"Live FRED" unaffected; sector
heat map and Markets panels now show "Persisted — Yahoo Finance" (not "Persisted market data") with a real
"Source: Yahoo Finance as of Jul/14/26" footer. No console errors.

Scope limits (explicit): this Home-page task only. Did not touch the authenticated `/watchlist` page itself,
Stocks/Company page badges (already correctly wired), or Chilean Rates/Earnings/Hechos footers (genuinely
static/blocked, already honestly labeled). No new dependency, no schema change.

Next: consider extending the "Source: X as of Y" footer convention to the Chilean Rates panel if it ever
gains a live/persisted backing; periodically revisit whether Market Cap should return as an optional column
elsewhere (Stocks page already has it).

---

**Home Page Overhaul Follow-up — Live Chilean Rates, Sortable Watchlist, Live Badges on Load** (2026-07-15)

Follow-up to the Home Page Overhaul above, addressing 4 more explicit gaps found using the merged
Watchlist+FX table in practice.

1. **Chilean Rates now overlay live BCCh values where a verified series exists.** The panel previously always
   rendered the static `chileanRates.json` sample regardless of the fact that 4 of its 8 instruments — BTU 10,
   BTU 5, Cámara Swap 2Y, Cámara Swap 1Y — already have verified live BCCh series wired into `macroSeries.ts`
   (the same instruments the Macro page's own Rates section and the yield-curve chart already use). Each row
   is now overlaid from the already-fetched `liveIndicatorMap` (populated by the existing
   `fetchMacroIndicators('CL')` call — no new fetch) when a live entry exists for that id; a small green live
   dot marks the overlaid rows. The remaining 4 (BTP 10, BCU 5, PDBC 90d, TPM/TNA) stay static — no BCCh
   series exists for them (documented deferred since Phase 4B) — never faked. Panel badge (`DataSourceBadge`)
   and footer (`TableSourceFooter`) now reflect the real live/static status and a real `asOf` date instead of
   a bare "Static MVP sample" line.
2. **Watchlist table is now sortable by Day Chg. or YTD %** — clicking either column header toggles
   descending/ascending (default: watchlist's natural order), with a ▼/▲ arrow indicator on the active column.
   Rows are pre-computed with price/dayPct/ytdPct before sort/render (previously computed inline per row).
3. **Sector heat map, Markets, and Watchlist badges now say "Live" on first page load, not "Persisted" until
   the Update button is clicked.** The mount-time effect that loads the Supabase-persisted baseline
   (stocks/sectors/indices) now also fetches the live Yahoo snapshot in the same `Promise.all` — previously
   `fetchLiveSnapshot()` only ran inside `doRefresh` (the manual Update-button handler), so every fresh page
   load showed "Persisted" until the user clicked Update even though a live Yahoo read was one fetch away.
4. **Update button already covers every data source on the tab** — verified rather than changed. `doRefresh`
   already calls `fetchLiveSnapshot()` (stocks + sectors + indices) and `fetchMacroIndicators('CL'/'US')`
   (which now also drives the Chilean Rates overlay via the shared `liveIndicatorMap`), so a manual refresh
   updates macro, FX, rates, watchlist prices, sector heat map, and markets in one click — no data source on
   the Home tab is left stale after Update.

**Tests:** 8 new tests appended to `tests/homeWatchlistOverhaul.test.ts` — mount-effect live-fetch wiring,
Chilean Rates live-overlay wiring (and a regression guard that no known-unverified rate id is ever
hardcoded into the overlay), the corrected `ratesSource` i18n string, and the sortable-header wiring. Full
suite 1472 → **1479/1479**, lint 0, build 0 errors.

**Local validation (dev server):** confirmed Watchlist/Sector Heat Map/Markets badges all read "Live — Yahoo
Finance" immediately on page load (no click needed); Chilean Rates badge/footer correctly mirrored the Macro
Chile column's live/static status (both "Static MVP" locally, since BCCh credentials aren't present in local
dev — expected, matches existing Macro-card behavior; both would read "Live" in Production where credentials
are configured); clicking the Day Chg. column header toggled the sort arrow and re-ordered rows with no
console errors.

Scope limits (explicit): this Home-page follow-up only. Did not touch the Macro page's own Rates section
(already live where verified), Earnings/Hechos footers (genuinely static/blocked), or add any new BCCh series
— reused only the 4 already-verified rate series. No new dependency, no schema change.
