# Nevada Market Intelligence (NMI)

An internal buyside web terminal for Nevada Inversiones, a Chilean family office. Tracks Chilean listed equities, macroeconomic indicators, CMF filings (Hechos Esenciales), and earnings releases.

**Current phase:** Phase 8D.3 complete — **economic-calendar actual/previous enrichment**. The US
`/macro/calendar` release rows now show **real `actual` and `previous` values** alongside the release dates:
release *dates* come from FRED's release calendar, actual/previous *values* from FRED **time-series** (the
keyless CSV endpoint, transformed via the shared `transforms.ts`) — two distinct, honestly-labeled sources.
11 curated US releases are mapped to verified FRED series (each tagged with its originating agency —
BLS/BEA/Census/Fed — for provenance; the value is always fetched from FRED and labeled as such). A new
`level-diff` transform derives the headline Nonfarm Payrolls month-over-month change from `PAYEMS` (never the
raw level). **Consensus/forecast/surprise are never shown** — no free official source provides them. ADP
(stale FRED series) and Existing Home Sales (NAR, non-govt) are excluded, not fabricated. Direct BLS/BEA/
Census API integration was assessed and deferred (FRED-normalized sourcing, per the never-guess-an-identifier
rule). A weekday post-close cron (`/api/cron/refresh-calendar-enrichment`, `30 22 * * 1-5`) recomputes the
enrichment; it is stateless (no persistence this phase). See
[`docs/macro_market_source_coverage.md`](docs/macro_market_source_coverage.md) §11 for the full mapping +
decision record.

**Phase 8D.2** (prior) — a calendar production-integrity fix. A read-only audit of
`/macro/calendar` found a real bug: the page rendered a **synthetic, deterministic-pseudo-random table**
(`src/lib/data/calendar.ts`) above the real FRED dates-only calendar, including Chile rows that named
BCCh/INE despite having zero actual BCCh/INE backing — easily mistaken for real data given the identical
table styling. **Removed from production**: `/macro/calendar` now shows only the real FRED dates-only
calendar plus a new honest "Chile release calendar: deferred" state (no fabricated rows); the Macro page's
"today's releases" preview widget (same synthetic source) was replaced with a plain link to the full
calendar. The synthetic module is retained for its own test coverage but explicitly marked
test/demo-only and verified (via a new regression test) to be unreachable from any production route or
page. See [`docs/macro_market_source_coverage.md`](docs/macro_market_source_coverage.md) §10 for full
details. Phase 8D.1 (macro category fix, EUR/CLP live via BCCh, BCCh-only FX panel, the FRED calendar
itself) and every prior phase remain live in production, unchanged.

---

## Features (as of Phase 2H)

| Module | Description |
|---|---|
| **Home / Market Overview** | Macro dashboard (Chile + US), tracked stocks, FX rates, sector heat map, index changes, Chilean rates, Hechos Esenciales feed, Earnings feed |
| **Stocks** | Full IPSA universe table with sort, filter by sector, search, CSV export |
| **Company Detail** | KPI strip, stock price chart (1D–5Y, daily/weekly series), earnings history with beat/miss vs consensus, valuation grid, Hechos Esenciales, News, document links, print tearsheet |
| **Macro** | Chile and US indicators grouped by category; clickable popup chart (1Y–10Y); yield curves; FX depth table; economic calendar |
| **Macro Calendar** | Real FRED US release calendar with actual/previous values enriched from FRED time-series (11 mapped releases, agency-labeled, no consensus); honest Chile-deferred state (no fabricated rows) |
| **Earnings** | Upcoming calendar + recent results with revenue surprise column; CSV export |
| **Hechos Esenciales** | Full CMF filings table with type/materiality filter and search; CSV export |
| **Compare** | Market Data panel (price, day change, market cap, sector, currency, 1D–1Y performance) wired to persisted/live Supabase market data; Bloomberg COMP-style comparative return chart for up to 6 tickers (static sample); fundamentals comparison table (temporary static); vs-IPSA benchmark; CSV export |
| **Graph Fundamentals** | Bloomberg GF-style fundamentals grapher — income statement, cash flow, balance sheet metrics; Indexed mode; two-company overlay |
| **Documents** | CMF filing/earnings drill-down viewer with structured facts, assessment chip, and source link |
| **Watchlist** (auth required) | Personal tracked-tickers list; add/remove; persisted to Supabase, protected by RLS |
| **Portfolio** (auth required) | Personal holdings — manual positions or transaction-derived (weighted-average cost); live market value, unrealized + realized P&L, sector exposure, cash ledger (deposits/withdrawals/buy-sell cash flows) |
| **News** | Institutional monitoring feed with materiality badge and Bloomberg NH-style high-impact highlight |
| **Command Palette** | ⌘K / Ctrl-K stock search with recent-search persistence |
| **Dark mode** | Toggled by user, persisted to localStorage, applied before paint (no flash) |
| **EN / ES toggle** | All UI labels translated; Chilean locale for numbers and dates |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 — configured via `@theme` in `globals.css` |
| Data | Static JSON files in `src/data/` (MVP) |
| Charts | Pure SVG — no chart library |
| Tests | Node.js built-in test runner (`node:test`) |
| Deployment | Vercel |

---

## Running Locally

```bash
npm install
npm run dev        # http://localhost:3000
```

## Building

```bash
npm run build      # must exit 0 with 0 TypeScript errors
npm run lint       # must exit 0
npm test           # all tests must pass
```

---

## Data Sources

Sourcing varies by module — every page shows a subtle source badge/footer
naming its actual status. **Full page-by-page detail:**
[`docs/data_source_status.md`](docs/data_source_status.md).

| Data | Source | Status |
|---|---|---|
| Macro indicators (Chile) | Banco Central de Chile (BDE API) | **Live/persisted** — falls back to static if BCCh is unreachable |
| Macro indicators (US) | FRED (Federal Reserve Bank of St. Louis, public CSV, no API key) | **Live/persisted** (Phase 8D) — 9 series (Fed Funds, US 3M/2Y/10Y/20Y/30Y Treasury yields, US Unemployment, US CPI m/m and y/y); falls back to static if FRED is unreachable |
| Copper | Banco Central de Chile (`F019.PPB.PRE.40.M`, monthly, USD/lb) | **Live/persisted** (Phase 8D) |
| Stock prices | Yahoo Finance (unofficial) + Supabase persistence | **Live/persisted** — static baseline, Supabase auto-load, live overlay on refresh |
| Compare — market data (price, day change, market cap, sector, currency, short-term performance) | Same Supabase/Yahoo Finance chain as Stocks/Home/Company (Phase 8B) | **Live/persisted** where sufficient history exists — static fallback otherwise, with an explicit reason (`insufficient_supabase_history`) |
| Compare — historical returns chart/table | `stockHistory.json` | **Temporary static** — needs years of daily Supabase history (Phase 8B), not yet accumulated |
| Compare — fundamentals (P/E, EV/EBITDA, margins, FCF/dividend yield) | **Phase 8C (automation-first, manual CSV interim bridge):** persisted `financial_metrics`/`financial_statement_items` — source-agnostic schema, manual CSV is the only populated source today, automated CMF FECU/XBRL/vendor ingestion can write into the same tables later — derived field-by-field where imported | **Persisted/derived** per ticker where imported — static fallback otherwise (P/S fwd, ROE, P/B always static — no forward estimates or book value imported) |
| Charting (`/chart-builder`) | **Phase 8C (automation-first, manual CSV interim bridge):** persisted `financial_statement_items`/`financial_metrics` where imported | **Persisted** per ticker where imported — static `fundamentals.json` fallback otherwise |
| Earnings | **Phase 8C (automation-first, manual CSV interim bridge):** persisted `earnings_events` where imported | **Persisted** per ticker where imported (no fabricated consensus/surprise) — static `earnings.json` fallback otherwise |
| CMF filings (Hechos Esenciales) | CMF public portal | **Blocked** — the portal requires a CAPTCHA; confirmed via a real discovery run, not merely unimplemented. See `docs/cmf_provider_discovery.md` |
| FX panel (Home page) | Banco Central de Chile — BCCh-only (Phase 8D.1) | **Live/persisted** — USD/CLP + EUR/CLP, both BCCh-verified |
| FX rates / Chilean rates (Macro page depth table) | Copper + EUR/CLP live via BCCh; BTP-10/BCU-5/PDBC-90d/TPM-TNA re-confirmed no live series exists | **Mostly temporary static** — see `docs/macro_market_source_coverage.md` |
| News | — | **Temporary static** — candidate sources named in-app (Phase 8E) |
| Economic calendar — US | FRED Releases API (dates) + FRED time-series (actual/previous), `FRED_API_KEY`, Phase 8D.3 | **Live** — 11 curated releases with real actual/previous (agency-labeled); no consensus/forecast/surprise |
| Economic calendar — Chile | — (no free/stable/structured official BCCh/INE release-date source verified) | **Unavailable** — honest deferred state, no fabricated rows (Phase 8D.2) |
| Watchlist / Portfolio / Transactions / Cash | Supabase, user-scoped | **Persisted** (auth required) |

### Live macro architecture (Phase 4A; dual-provider since Phase 8D)

Macro data flows through a provider abstraction so components never call APIs
directly. Since Phase 8D, the orchestrator queries **two** providers — BCCh
for Chile series, FRED for US series — and merges/dispatches between them:

```
DATA_MODE = static | live | hybrid   (default: hybrid if BCCh creds exist, else static)

page  →  src/lib/data (static, instant)         ← initial render
      →  fetchMacroIndicators / fetchMacroHistory → /api/macro* (server)
            → macroProvider → bcchMacroProvider  → BCCh (server-only credentials, Chile series)
                             → fredMacroProvider  → FRED (no credentials needed, US series)
            → staticMacroProvider (fallback)     ← always available
```

- **Static fallback is mandatory** — with no env vars the app runs entirely on JSON.
- BCCh credentials are **server-only** (read in `/api/macro*` route handlers); FRED needs no credentials at all.
- Each series' `sourceProvider` field (`'BCCh' | 'FRED'`) determines which provider's manual map and client it uses — a series can never be routed to the wrong provider.
- A subtle `DataSourceBadge` shows: Static MVP · Live BCCh/FRED · Hybrid fallback · Live unavailable.

### Environment setup

Copy `.env.example` → `.env.local`. All variables are optional; the app works
with none set. To enable live macro later:

```
DATA_MODE=hybrid
BCCH_API_USER=...
BCCH_API_PASSWORD=...     # server-only — never NEXT_PUBLIC
```

See `docs/deployment.md` for Vercel env-var setup.

### BCCh series mapping workflow (Phase 4B)

Official BCCh BDE series codes are **verified by a human, never guessed**. The
controlled mapping lives in `src/config/bcchSeriesManualMap.ts` (all entries are
currently `null`/unverified → static fallback everywhere).

```
npm run bcch:search     # discover candidates via official SearchSeries → tmp/bcch-series-candidates.json
# review candidates, confirm codes, set them in src/config/bcchSeriesManualMap.ts (verified: true)
npm run bcch:validate   # GetSeries + plausibility + frequency checks for verified series
```

Both scripts need `BCCH_API_USER` / `BCCH_API_PASSWORD` and **fail gracefully
without them** (they never run during build). Full guide:
[`docs/bcch_series_mapping.md`](docs/bcch_series_mapping.md).

---

## Current Limitations

- **Desktop-only layout** — minimum comfortable viewport is ~1280px wide; 1440px recommended (mobile-responsive is a planned future phase)
- **Portfolio average cost is weighted-average only** — no FIFO/LIFO or specific-lot selection
- **Portfolio has no FX conversion, dividends, or performance attribution** (time/money-weighted returns) — those remain planned
- **Some data is still static** — macro (BCCh for Chile, FRED for US) and market (Yahoo Finance) are live with Supabase persistence; company financials are automated from **CMF XBRL**/`cmf_bank` filings for mapped issuers with Yahoo Finance/manual CSV as fallback; CMF *Hechos Esenciales*, news, and most FX/Chilean-rates rows remain static/blocked sample data. The US economic calendar is real (FRED release dates + actual/previous from FRED time-series, agency-labeled, no consensus) and honestly deferred/unavailable for Chile — never fabricated sample data

---

## Next Phases

| Phase | Goal | Status |
|---|---|---|
| **Phase 4A–5D** | Live macro (BCCh) + market (Yahoo Finance) data, Supabase persistence, scheduled ingestion, health monitoring | ✓ Complete |
| **Phase 6A/6B** | Authentication (username + password) + personal Watchlist | ✓ Complete |
| **Phase 6C** | Portfolio positions foundation | ✓ Complete |
| **Phase 6D** | Transaction history + cash ledger | ✓ Complete |
| **Phase 8A** | Data-source audit — corrected stale/misleading source labels app-wide | ✓ Complete |
| **Phase 8B** | Compare page real-data wiring + no-static-terminal-state policy | ✓ Complete |
| **Phase 8C** | Financial-statement ingestion, automation-first architecture with manual CSV as an interim bridge, for Charting, Compare fundamentals, and Earnings | ✓ Complete |
| **Phase 8C.1** | CMF/XBRL automated-provider discovery + proof of concept — found a real, CAPTCHA-free path to CMF's XBRL filings and built a working provider against the Phase 8C schema | ✓ Complete |
| **Phase 8C.2** | CMF/XBRL automated financials ingestion — dependency-free ZIP reader, honest period-matching, extended concept map + validation, orchestrator + reviewable cron; automated `xbrl` financials (SQM-B, COPEC) supersede manual CSV. Manual CSV is now a fallback, not the only source | ✓ Complete |
| **Phase 8C.3** | CMF/XBRL issuer coverage expansion — 2 → 5 mapped issuers (added ENELCHILE, CMPC, CENCOSUD) via CMF's own official issuer directory; concept map extended (~24→~31); banks confirmed structurally unmappable via this discovery surface | ✓ Complete |
| **Phase 8C.4** | Full CMF/XBRL coverage discovery sweep over all 25 stocks — enabled coverage 5 → 15 issuers (+10), 3 eligible-verified deferred, 3 unsupported XBRL dialects, 4 banks on a separate track; coverage funnel exposed via the status endpoint | ✓ Complete |
| **Phase 8C.5** | Universal fundamentals via Yahoo Finance (`yahoo_finance`, priority 80) — quarterly + annual data for all 25 stocks incl. the 4 banks; CMF/XBRL annual still supersedes; fixes the Quarterly/TTM/Annual toggle everywhere | ✓ Complete |
| **Phase 8C.6** | CMF/XBRL non-bank completion — promoted the 3 deferred issuers + added XBRL parser support for 2 real dialects (default-namespace, CTI-Service ISO-8859-1); all 21 non-bank stocks now on authoritative CMF/XBRL; funnel 21 enabled + 4 bank | ✓ Complete |
| **Phase 8C.7** | Bank-specific CMF discovery — no XBRL path for banks (none expected); discovered CMF's monthly non-XBRL "Balance y Estado de Situación Bancos" regulatory feed instead; conservative 14-field account-code map + dry-run-only prototype verified against real data for all 4 banks; nothing production-ingested, Yahoo Finance remains the active fallback | ✓ Complete |
| **Phase 8C.8** | Official CMF bank financials persistence — `cmf_bank` source type (priority 180) live for all 4 banks, 60 rows written, 0 failures, supersedes Yahoo's matching annual period; Pillar 3 capital/risk-ratio discovery investigated and correctly deferred (per-bank self-hosted PDF directory, not a structured file) | ✓ Complete |
| **Phase 9A** | Structured Notes module — automation-first term-sheet PDF extraction (Citi CGMFL family), workbook audit, normalized schema, barrier/worst-of/exposure calculations, Yahoo live levels (replacing Bloomberg BDP) | ✓ Complete |
| **Phase 9B/9B.1/9B.2** | Structured Notes — HSBC parser generalization, shared book-level dashboard, Called/Archived flow, allocation-by-entity grid, issuer/entity charts, dashboard sorting/filtering/legend UX | ✓ Complete |
| **Phase 9C** | Structured Notes — parser expansion to Crédit Agricole, BNP Paribas, Barclays, and BBVA via a new issuer-detection router; 4-state confidence/review-state model | ✓ Complete |
| **Phase 9D** | Structured Notes — scheduled price-snapshot persistence + observation-event automation (daily cron, conservative autocall status transition, monitoring-status endpoint) | ✓ Complete |
| **Phase 9E** | Structured Notes — free market-data provider abstraction + fallback/sanity-check orchestrator + quote-quality rules (staleness, large-move, cross-provider disagreement); Yahoo remains the sole active provider after a documented free-provider discovery pass | ✓ Complete |
| **Phase 8D** | FX/rates + US macro + economic calendar live source completion — copper live via BCCh, 9 US macro series live via FRED (no API key), dual-provider macro orchestrator; economic calendar/EUR-CLP/BTP-10/BCU-5/PDBC-90d/TPM-TNA all re-investigated and documented as deferred | ✓ Complete |
| **Phase 8D.1** | Macro category bug fix, EUR/CLP wired, Home FX panel cleaned up to BCCh-only, dates-only FRED release calendar (13 curated releases); Nonfarm Payrolls investigated and deferred | ✓ Complete |
| **Phase 8D.2** | Calendar production-integrity fix — removed the synthetic forecast/actual/prior table (including fabricated Chile/BCCh/INE-named rows) from `/macro/calendar` and the Macro page; real FRED dates-only calendar preserved; honest Chile-deferred state added | ✓ Complete |
| **Phase 8D.3** | Economic-calendar actual/previous enrichment — US release rows enriched with real actual/previous from verified FRED time-series (11 mapped releases, agency-labeled); `level-diff` transform for headline NFP; no consensus/forecast/surprise; ADP/Existing Home Sales excluded (stale/non-govt); weekday post-close refresh cron | ✓ Complete |
| **Phase 8E** | Hechos Relevantes + News ingestion workaround | Planned |
| **Phase 6E** | Portfolio analytics / performance attribution | Planned |
| **Phase 7A** | Mobile-responsive foundation — intentionally after data-credibility phases (8B–8E) unless a UX emergency arises | Planned |

See `docs/implementation_plan.md` for full detail.

---

## Project Structure

```
src/app/              — Next.js App Router pages + API routes
src/components/
  layout/             — AppShell, Sidebar, TopBar
  providers/          — LangProvider (EN/ES context), SidebarProvider
  ui/                 — SectionHeader, StatusPill, AsOfBadge, CommandPalette, …
  charts/             — LineChart, CompareChart, FundamentalsChart, YieldCurveChart
src/data/             — Static JSON data files (fallback + not-yet-live entities)
src/lib/
  data/               — Typed accessor helpers (one per entity)
  db/repositories/    — Supabase-backed repositories (macro, market, watchlist, portfolio, …)
  auth/               — Server-side auth helpers, credential validators, session-cookie writer
  portfolio/          — Pure valuation math (market value, P&L, sector exposure)
  providers/          — Live-data provider abstraction (BCCh, market)
  i18n.ts             — EN/ES translation dictionary
  formatters.ts       — Chilean locale formatting
  navigation.ts       — Nav config
  usePersistentState.ts — localStorage hook (useSyncExternalStore)
  export.ts           — CSV export utility
  returns.ts          — Return math (tested)
src/types/index.ts    — TypeScript interfaces for all entities
src/middleware.ts     — Session refresh + route protection (/watchlist, /portfolio)
supabase/migrations/  — SQL migrations (schema, RLS)
scripts/              — Node.js data generation + ingestion scripts
tests/                — Node built-in test files
docs/                 — Project documentation
```
