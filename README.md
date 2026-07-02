# Nevada Market Intelligence (NMI)

An internal buyside web terminal for Nevada Inversiones, a Chilean family office. Tracks Chilean listed equities, macroeconomic indicators, CMF filings (Hechos Esenciales), and earnings releases.

**Current phase:** Phase 6C complete — authentication (username + password), personal watchlist, and a portfolio-positions foundation with live unrealized P&L are all live in production, alongside the Phase 4A–5D live macro/market data stack.

---

## Features (as of Phase 2H)

| Module | Description |
|---|---|
| **Home / Market Overview** | Macro dashboard (Chile + US), tracked stocks, FX rates, sector heat map, index changes, Chilean rates, Hechos Esenciales feed, Earnings feed |
| **Stocks** | Full IPSA universe table with sort, filter by sector, search, CSV export |
| **Company Detail** | KPI strip, stock price chart (1D–5Y, daily/weekly series), earnings history with beat/miss vs consensus, valuation grid, Hechos Esenciales, News, document links, print tearsheet |
| **Macro** | Chile and US indicators grouped by category; clickable popup chart (1Y–10Y); yield curves; FX depth table; economic calendar |
| **Macro Calendar** | Week-by-week release calendar with search and high-impact highlighting |
| **Earnings** | Upcoming calendar + recent results with revenue surprise column; CSV export |
| **Hechos Esenciales** | Full CMF filings table with type/materiality filter and search; CSV export |
| **Compare** | Bloomberg COMP-style comparative return chart for up to 6 tickers; fundamentals comparison table; vs-IPSA benchmark; CSV export |
| **Graph Fundamentals** | Bloomberg GF-style fundamentals grapher — income statement, cash flow, balance sheet metrics; Indexed mode; two-company overlay |
| **Documents** | CMF filing/earnings drill-down viewer with structured facts, assessment chip, and source link |
| **Watchlist** (auth required) | Personal tracked-tickers list; add/remove; persisted to Supabase, protected by RLS |
| **Portfolio** (auth required) | Personal holdings with quantity/cost basis; live market value, unrealized P&L, sector exposure; add/edit/remove positions |
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

**Default is static MVP sample data.** Phase 4A adds a live-data architecture for
macro (Banco Central de Chile) that is opt-in via env vars and always falls back
to static.

| Data | Live source | Status |
|---|---|---|
| Macro indicators | Banco Central BDE API | **Architecture ready (Phase 4A)** — live disabled until series codes mapped (4B) |
| Stock prices | Bolsa de Santiago / Brain Data | Static (Phase 4C) |
| CMF filings | CMF API | Static (later) |
| Earnings | CMF FECU | Static (later) |
| FX rates | Bloomberg / FRED | Static (later) |
| News | Aggregation service (emol, df.cl, CMF, BCCh) | Static (later) |

### Live macro architecture (Phase 4A)

Macro data flows through a provider abstraction so components never call APIs
directly:

```
DATA_MODE = static | live | hybrid   (default: hybrid if BCCh creds exist, else static)

page  →  src/lib/data (static, instant)         ← initial render
      →  fetchMacroIndicators / fetchMacroHistory → /api/macro* (server)
            → macroProvider → bcchMacroProvider → BCCh (server-only credentials)
            → staticMacroProvider (fallback)     ← always available
```

- **Static fallback is mandatory** — with no env vars the app runs entirely on JSON.
- BCCh credentials are **server-only** (read in `/api/macro*` route handlers).
- A subtle `DataSourceBadge` shows: Static MVP · Live BCCh · Hybrid fallback · Live unavailable.

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
- **Portfolio has no transaction history** — average cost is entered directly, not derived from buy/sell lots
- **Portfolio has no realized P&L, cash balance, FX conversion, or performance attribution** — valuation-only in this phase
- **Some data is still static** — macro (BCCh) and market (Yahoo Finance) are live with Supabase persistence; CMF filings, earnings, and news remain static sample data

---

## Next Phases

| Phase | Goal | Status |
|---|---|---|
| **Phase 4A–5D** | Live macro (BCCh) + market (Yahoo Finance) data, Supabase persistence, scheduled ingestion, health monitoring | ✓ Complete |
| **Phase 6A/6B** | Authentication (username + password) + personal Watchlist | ✓ Complete |
| **Phase 6C** | Portfolio positions foundation (this phase) | ✓ Complete |
| **Phase 6D** | Transaction history + cash ledger | Planned |
| **Phase 7A** | Mobile-responsive foundation | Planned |

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
