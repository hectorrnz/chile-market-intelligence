# Chile Market Intelligence (CMI)

An internal buyside web terminal for a Chilean family office. Tracks Chilean listed equities, macroeconomic indicators, CMF filings (Hechos Esenciales), and earnings releases.

**Current phase:** Phase 2H complete — pre-deployment polish (Phase 3) in progress.

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
| **Watchlist** | Phase 6 placeholder with mock preview table |
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
npm run build      # must exit 0 with 12 routes and 0 TypeScript errors
npm run lint       # must exit 0
npm test           # 13/13 must pass
```

---

## Data Sources

**All data is currently static MVP sample data.** Values are realistic but not live-sourced.

| Data | Planned live source | Phase |
|---|---|---|
| Macro indicators | Banco Central BDE API | Phase 4 |
| Stock prices | Bolsa de Santiago / Brain Data | Phase 7 |
| CMF filings | CMF API | Phase 4 |
| Earnings | CMF FECU | Phase 4 |
| FX rates | Bloomberg / FRED | Phase 4 |
| News | Aggregation service (emol, df.cl, CMF, BCCh) | Future |

---

## Current Limitations

- **No live data** — all figures are static sample values as of approximately June 2025
- **No authentication** — the app is publicly accessible once deployed (Phase 6 adds auth)
- **No database** — Supabase integration is Phase 5
- **No watchlist persistence** — requires authentication
- **Desktop-only layout** — minimum comfortable viewport is ~1280px wide; 1440px recommended

---

## Next Phases

| Phase | Goal |
|---|---|
| **Phase 3** | Production polish + Vercel deployment |
| **Phase 4** | Python data ingestion scripts (Banco Central, CMF, FX) |
| **Phase 5** | Supabase database integration |
| **Phase 6** | Authentication + Watchlist |
| **Phase 7** | Live stock price feed (Bolsa de Santiago / Brain Data) |

See `docs/implementation_plan.md` for full detail.

---

## Project Structure

```
src/app/              — Next.js App Router pages (12 routes)
src/components/
  layout/             — AppShell, Sidebar, TopBar
  providers/          — LangProvider (EN/ES context)
  ui/                 — SectionHeader, StatusPill, AsOfBadge, CommandPalette, …
  charts/             — LineChart, CompareChart, FundamentalsChart, YieldCurveChart
src/data/             — Static JSON data files (MVP)
src/lib/
  data/               — Typed accessor helpers (one per entity)
  i18n.ts             — EN/ES translation dictionary
  formatters.ts       — Chilean locale formatting
  navigation.ts       — Nav config
  usePersistentState.ts — localStorage hook (useSyncExternalStore)
  export.ts           — CSV export utility
  returns.ts          — Return math (tested)
src/types/index.ts    — TypeScript interfaces for all entities
scripts/              — Node.js data generation scripts
tests/                — Node built-in test files
docs/                 — Project documentation
```
