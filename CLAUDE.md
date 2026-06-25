# CLAUDE.md — Chile Market Intelligence

This file is the primary instruction set for Claude Code working on this project. Read it before writing any code.

---

## Project Summary

Chile Market Intelligence is an internal buyside web terminal for a Chilean family office. It tracks Chilean listed equities, macroeconomic indicators, CMF filings (Hechos Esenciales), and earnings releases.

Stack: Next.js 16 · TypeScript · Tailwind CSS v4 · Supabase (future) · Vercel

This is a solo project. The primary user is not an experienced web developer. Explanations should be clear enough for someone learning as they build.

**Tailwind note:** This project uses Tailwind CSS v4, which differs from v3. There is no `tailwind.config.ts`. Colors and fonts are configured via `@theme` blocks inside `src/app/globals.css`. All standard color names and opacity modifiers still work.

---

## Rules — Always Apply

### Build incrementally
Check `docs/implementation_plan.md` for the active phase. Complete one task before starting the next. If a task requires a decision, ask before proceeding.

### Do not connect live APIs until instructed
All data in MVP comes from static JSON files in `src/data/`. No API calls, no external fetch calls, no environment variable references for external services until Phase 4 is authorized.

### Live-data architecture rules (Phase 4A+)
The live-data provider abstraction exists for **macro only** so far. When working with live data:
- **Components must not call providers or external APIs directly.** Page/UI components read `src/lib/data/*` (static, synchronous) for the initial render, and use the client-safe `fetch*` helpers in `src/lib/data` (which hit `/api` routes) to optionally upgrade to live.
- **All live data goes through `src/lib/data` helpers or `/api` route handlers.** Provider modules in `src/lib/providers/` (except `types.ts`) are **server-only** and must never be imported by client components.
- **Static fallback is mandatory.** The app must build, run, and deploy with no env vars. Missing credentials must never break local dev, `npm run build`, Vercel, or any page.
- **Never guess BCCh series IDs.** Codes live in `src/config/bcchSeriesManualMap.ts` and must stay `seriesId: null, verified: false` until confirmed. Only official **SearchSeries/GetSeries** verification (via `npm run bcch:search` / `npm run bcch:validate`) is acceptable proof. `macroSeries.ts` derives `enabled`/`providerSeriesCode` from that map — do not hand-set codes there.
- **No scraping** of websites unless explicitly instructed — official BCCh API only.
- **BCCh (and all provider) credentials are server-only** — read only in route handlers / server provider code and the `scripts/bcch/*` tools, never prefixed `NEXT_PUBLIC_`, never logged.
- **Do not run BCCh scripts during build.** `bcch:search`/`bcch:validate` are manual dev tools; the build/Vercel deploy must never depend on BCCh availability.
- **Live macro must always keep static fallback.** Missing credentials, timeouts, or implausible values must fall back to static — never break local dev, `npm run build`, Vercel, or any page.
- Do not expand live ingestion beyond the currently-authorized scope (e.g. CMF, earnings, stock prices, US macro live, news) without an explicit phase instruction.

### Do not add authentication until instructed
No login pages, no session management, no Supabase Auth, no middleware. Authentication is Phase 6.

### Do not change the design direction without asking
The design is defined in `docs/design_principles.md`. Flag conflicts before implementing. Do not substitute your own design judgment for the documented principles.

### Use semantic CSS tokens — never hardcoded colors
In all component files, use the semantic CSS token classes (`bg-surface`, `text-foreground`, `border-border`, `text-positive`, etc.) or CSS variable inline styles (`var(--sidebar-fg)`). Never use:
- Raw Tailwind color scales: `bg-gray-900`, `text-emerald-400`
- Hardcoded hex values in className or style props
- Purple anywhere

The full token list is in `docs/design_principles.md` Section 3 and in `src/app/globals.css`.

### Light mode is default. Dark mode must preserve contrast.
The app starts in light mode. Dark mode is activated by the user and saved to localStorage. When adding dark mode support to new components:
- Test that all text is readable on dark backgrounds.
- Use `color-mix()` for pill/badge backgrounds rather than fixed hex values.
- Never use `bg-white` or `text-black` — use `bg-surface` and `text-foreground`.

### Default interface language is English. Spanish toggle exists.
The TopBar has a language toggle (EN/ES). All UI labels must use the translation dictionary in `src/lib/i18n.ts`. When adding new UI labels:
1. Add the English version to `dict.en`
2. Add the Spanish version to `dict.es`
3. Reference via `t.section.key` in components

Do not hardcode UI label strings in component files.

### Future UI additions must use semantic tokens and translations
Any new component or page must:
- Use semantic CSS token class names (not hardcoded colors)
- Reference `useLang()` for any user-visible text
- Work correctly in both light and dark modes

### Prefer simple, maintainable code
- No abstractions that aren't immediately needed.
- No third-party libraries unless they solve a specific, documented problem.
- No state management libraries (Redux, Zustand) — React state + context is sufficient.
- No animation libraries in MVP.
- Keep components small and single-purpose.

### Keep API keys out of code
Use `.env.local` for secrets. The `.env.local` file is always in `.gitignore`. Never hardcode credentials.

### Explain commands before running them
Before any terminal command, explain what it does and why. No destructive commands without explicit user confirmation.

### After each phase, summarize and pause
When a phase is complete:
1. List every file created or modified.
2. Describe what changed in one sentence per file.
3. State the next suggested task.
4. Wait for user confirmation.

---

## Design Rules (see full detail in docs/design_principles.md)

- Light mode is default. Dark mode toggled by user, derived from same palette.
- Goldman-style institutional palette: `#004A64` deep navy, `#7399C6` blue, `#F1F1F1` light background.
- Sidebar is always dark navy (`#004A64` light / `#191C1D` dark).
- Tables first. Cards for KPI summaries only.
- Monospace font for all prices, numbers, tickers, codes.
- Color only for signal: `--positive` (green), `--negative` (red), `--warning` (amber), `--primary` (blue accent).
- No purple. No gradients. No `rounded-2xl`+. No hero sections. No hardcoded colors.
- Every data point shows source and timestamp.
- Chilean locale for financial figures (1.234.567,50).

---

## Stack and Conventions

### Framework
- Next.js 16, App Router (`src/app/`).
- TypeScript strict mode.
- Tailwind CSS v4 — configuration in `globals.css`, not `tailwind.config.ts`.

### File organization
```
src/app/              — Pages (Next.js App Router)
src/components/
  layout/             — AppShell, Sidebar, TopBar
  providers/          — LangProvider (language context)
  ui/                 — SectionHeader, StatusPill, ThemeToggle, LangToggle
src/data/             — Static JSON data files (MVP)
src/lib/
  navigation.ts       — Nav config + getPageTitle()
  formatters.ts       — Chilean locale formatting
  i18n.ts             — EN/ES translation dictionary
src/types/index.ts    — TypeScript interfaces
scripts/              — Python data ingestion scripts (future)
docs/                 — Project documentation
```

### Theme system
- CSS variables defined in `:root` (light) and `.dark` (dark) in `globals.css`.
- Tailwind utilities registered via `@theme inline` — e.g., `bg-surface`, `text-foreground`.
- `<html>` element gets `class="dark"` when dark mode is active.
- An inline `<script>` in `layout.tsx` applies theme before paint (no flash).

### Language system
- Default language: English (`'en'`).
- `LangProvider` (in `src/components/providers/`) wraps the app via `AppShell`.
- All pages/components use `useLang()` hook to get `{ lang, setLang, t }`.
- Translation dictionary: `src/lib/i18n.ts` — `dict.en` and `dict.es`.
- Language choice persisted in `localStorage` (`lang` key).

### TypeScript
- All entities must match interfaces in `src/types/index.ts`.
- Types are derived from `docs/data_dictionary.md` — don't change types without updating the doc.

### Data loading (MVP)
- Import JSON files directly: `import companies from '@/data/companies.json'`
- No `fetch()` calls in MVP components.
- When Supabase is connected (Phase 5), data fetching moves to `src/lib/db/` — components don't call Supabase directly.

### Formatting
- All number/date formatting through `src/lib/formatters.ts` — no inline `toLocaleString()`.

---

## What Not to Build (MVP)

- User authentication or session management
- Live API calls to external data providers
- Database connections (Supabase, Postgres, SQLite)
- WebSockets or real-time data
- Server-side cron jobs or background workers
- Email or push notifications
- Admin panel or CMS
- Mobile layout optimization
- i18n framework (current simple dictionary is intentional)
- Unit tests (add in Phase 3 polish)

---

## Data Sources Reference

| Source | What it provides | When to connect |
|---|---|---|
| Banco Central BDE API | TPM, IPC, IMACEC, UF, FX rates | Phase 4 |
| CMF API | Hechos Esenciales, company registry | Phase 4 |
| Bolsa de Santiago / Brain Data | Stock prices, OHLCV | Phase 7 |
| Manual CSV/JSON | Earnings data | MVP (static) |
| Supabase Postgres | All persistent storage | Phase 5 |

---

## Typography Rules

- Font stack: `"Helvetica Neue", Helvetica, Arial, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **The body font is the default for ALL UI text** — labels, headers, table headers, badges, eyebrows.
- `font-mono` is ONLY for data values: prices, numbers, tickers/codes, timestamps in data rows, version strings.
- Do NOT use `font-mono` on section titles, card titles, table `<th>`, badge labels, or "Affected:" labels.
- Section headers and table headers: use CSS utility classes `ui-label` and `ui-table-header` defined in `globals.css`.
  - These set 11px, font-weight 500, uppercase, letter-spacing 0.04em — body font (not mono).
  - Always combine with `text-muted-fg` and spacing classes: `className="ui-label text-muted-fg mb-3"`
  - For table `<th>`: `className="text-left py-2.5 px-3 first:pl-4 ui-table-header text-muted-fg"`
- `tracking-widest` (0.1em) is forbidden — it is a generic AI dashboard anti-pattern.
- The only exception is short brand monograms like "CMI" which may use `tracking-wider` (0.05em).

## Theme Toggle Rule

- The TopBar theme toggle is a **segmented pill** — [☀ Light | ☽ Dark] both options visible.
- Active segment: `bg-surface text-foreground`. Inactive: `text-muted-fg`.
- Container: `bg-surface-2 border border-border rounded-full`.
- Uses `aria-label` on the group and `title` on each button for accessibility.
- Do NOT replace it with an icon-only button or text-only "Theme: Light" — the segmented pill is the current standard.

## News Module Rule

- Mock news data lives in `src/data/news_mock.ts` as a static `NewsItem[]` array.
- Do NOT connect live news APIs, scrapers, or external fetches until explicitly instructed.
- Future sources are documented in `docs/product_spec.md` — they are reference only.
- Module title is **NEWS** (English) / **NOTICIAS** (Spanish). Do NOT rename back to "Chilean News".
- News items follow institutional monitoring format: headline (14px) → meta row (body font, timestamp mono) → summary → affected chips.
- Materiality badge colors: High = `--negative` (red), Medium = `--warning` (amber), Low = `--accent` (blue).
  - All use `color-mix(in oklab, var(--color) N%, var(--surface))` for theme-aware backgrounds.
- Ticker chips in "Affected:" row use `font-mono` (identifiers). The "Affected:" label itself does NOT use `font-mono`.
- **News High-materiality highlight:** Bloomberg NH-style — `borderLeft: '3px solid var(--negative)'` + `backgroundColor: color-mix(in oklab, var(--negative) 5%, var(--surface))`. No badge text for any row.
- **Only HIGH news gets the red stripe.** Medium and Low rows have `borderLeft: '3px solid transparent'` to preserve layout alignment.

## Number and Font Rules (Phase 2B)

- **All prices, percentages, dates, macro values, multiples, and market caps use the body font — NOT `font-mono`.**
- Use the `.ui-number` CSS utility class for all numeric table cells: `className="ui-number"`.
  - `.ui-number` applies `font-family: var(--font-sans); font-variant-numeric: tabular-nums;`
  - It is defined in `globals.css` under `@layer components`.
- `font-mono` is ONLY for ticker symbols (identifiers), the sidebar version string, and timestamp chips in the news affected row.
- Never write `font-mono tabular-nums` on price, change, market cap, or any numerical data cell.

## Layout Rules (Phase 2B)

- All dashboard and table pages (`page.tsx` files) use `w-full` as the outermost container class.
- Do NOT add `max-w-screen-xl` or other max-width constraints to page containers.
- The `AppShell` sidebar controls horizontal layout; pages fill the remaining space.

## DocumentRecord System (Phase 2B)

- `src/data/documents.json` is an internal registry of source documents (CMF filings, earnings releases).
- `src/lib/data/documents.ts` exports helpers: `getDocumentByRelatedId(id)` links HE or earnings records to their document page.
- `src/app/documents/[id]/page.tsx` is the drill-down viewer — AI summary, key points, external source link.
- All records have `localStatus: "external_only"` in MVP. Do NOT download, scrape, or sync actual documents.
- Do NOT create a live document sync in any phase until explicitly instructed. The `sourceUrl` links to CMF — users click to open it externally.

## Charts and History Data Rules (Phase 2C)

- **SVG LineChart:** `src/components/charts/LineChart.tsx` — pure SVG, no external chart library. Props: `data: { date: string; value: number }[]`, `unit?: string`, `height?: number`. Uses `var(--positive)` / `var(--negative)` for line color based on direction.
  - **Wide intrinsic viewBox (W=1000):** the SVG is only lightly upscaled in real layout, so axis text stays near its nominal size. Do NOT shrink the viewBox back to 600 — that made fonts render ~1.8× too large. Strokes use `vectorEffect="non-scaling-stroke"`; gradient/clip IDs are unique via `useId()`.
  - **Date axis adapts to span:** ≤31 days → `DD Mon` (daily); longer → `Mon 'YY`. Handles both `YYYY-MM-DD` (daily) and `YYYY-MM` (quarterly) date strings.
- **Macro history:** `src/data/macroHistory.json` — quarterly + daily + weekly per indicator (`node scripts/genMacroHistory.mjs`). The popup chart uses a **monthly** frequency for ALL timeframes (downsampled from weekly, sliced years×12) via `getMacroHistoryForTimeframe(id, years)`.
- **Stock history:** `src/data/stockHistory.json` — three series per ticker, by `type`: `quarterly` (fallback), `daily` (~295 business days, 2024-05→2025-06) for 1D…1Y, and `weekly` (~5 years) for 3Y/5Y. Regenerate with `node scripts/genStockHistory.mjs` (anchors noise to the quarterly trajectory; deterministic). Helper: `getStockHistoryForTimeframe(ticker, timeframe)`. Do NOT use quarterly for 3Y/5Y — they must be weekly.
- **Macro page chart is a POPUP MODAL.** Clicking an indicator row opens a centered modal overlay (fixed inset-0, `color-mix` backdrop, click-backdrop-to-close). Do NOT revert to an inline panel above the tables. Timeframe toggle: 1Y / 3Y / 5Y / 10Y. Chile and US indicators are in separate labeled sections with a **strong divider** (`border-t-4 border-border-strong`) between them; the US heading is **"US Macro"** (not "US & Global Macro").
- **Theme-aware scrollbars:** styled in `globals.css` via `--border-strong`/`--background` tokens so they adapt in dark mode. Don't hardcode scrollbar colors.
- **Company page:** Stock price chart uses `LineChart` with timeframe toggle: 1D / 5D / 1M / MTD / YTD / 1Y / 3Y / 5Y. Short timeframes (1D…1Y) slice the **daily** series; 3Y/5Y use the **quarterly** series. Do NOT collapse short timeframes back to 1-2 quarterly points.
- **Chart source note:** Always show `t.company.stockChartSource` or `t.macro.chartSource` below every chart.
- **No chart library:** Do NOT add recharts, chart.js, victory, or any other charting dependency in MVP.

## Earnings Columns Rule (Phase 2C)

- The company-detail **Recent Results** table is full-width with these columns in order: **Period · Revenue · EBITDA · Net Income · EPS · Net Debt · Quality.**
- `EarningsRelease` has `eps?` (CLP) and `netDebt?` (MM CLP) fields. Banks (BSANTANDER, CHILE, BCI) carry `netDebt: null` (and no EBITDA) — render as `—`.
- Use `formatEPS()` (CLP, 2 decimals) and `formatNetDebt()` (MM CLP; net cash shown in parens) from `formatters.ts`. Negative Net Income / EPS render in `text-negative`.

## Macro Value/Change Formatting Rule (Phase 2C)

- **`formatMacroChange()` returns the bare label — it does NOT add parentheses.** The caller wraps in a single `(...)`. This prevents the `((-0.25%))` double-paren bug.
- Home dashboard macro rows: value first, then change in one set of parens, e.g. `5,00% (-0.25%)`.

## Market Overview Modules (Phase 2C)

- **Home page title:** "Market Overview" (EN) / "Vista General de Mercado" (ES). Do NOT revert to "Chilean Market Overview".
- **Top summary grid (3 cols):** Column 1 stacks **Macro · Chile** on top of **Macro · US** (both filter `getHighImportance()` by region). Column 2 = Hechos. Column 3 = Earnings. Use a shared `MacroRow` component for both macro panels.
- **Macro panel rows on Home:** Value first, change in ONE set of parentheses after. Example: `4,42 USD/lb (-1.8%)`. The change color is applied to the parenthesized portion. (See the formatMacroChange rule — no double parens.)
- **Heat-map row (3 cols):** **Sector heat map** (left) · **Chilean Rates** (center) · **Index changes** (right). Do NOT revert to the 2-col `col-span-2` layout.
- **Sector heat map:** `src/data/sectorPerformance.json` — 10 Chilean sectors. Rendered as a **3-wide** tile grid (3+3+3, with the 10th tile in `col-start-2` so it centers on its own row). Tile background uses `color-mix(in oklab, var(--positive or --negative) N%, var(--surface))` scaled by magnitude (max ~25%). No gradients.
- **Chilean Rates panel:** built from `getAllIndicators()` filtered to CL + `category === 'Rates'` (TPM, BTU 10Y). Value-first with change in parens.
- **Index changes:** `src/data/indexPerformance.json` — 6 indices. Rendered as a compact list (name, country, value, day %, YTD %) in the right column.

## US Macro Indicators (Phase 2C)

- `src/data/macroIndicators.json` now contains 18 indicators: 12 Chile (`region: "CL"`) + 6 US (`region: "US"`).
- Chile categories: `Rates`, `Inflation`, `FX`, `Activity`, `Commodities`, `Labor`.
- US categories: `US Rates`, `US Inflation`, `US FX`, `Crypto`.
- `getHighImportance()` returns all high-importance indicators. Filter by `region` in pages as needed.
- Home page: Macro · Chile panel filters `region === 'CL'`; Macro · US panel filters `region === 'US'`.

## Company Business Profile Fields (Phase 2C)

- `Company` interface now has: `businessModel?`, `keyRevenueDrivers?` (string[]), `keyRisks?` (string[]), `sourceForBusinessDescription?`, `sourceStatus?`.
- Company detail page shows these fields in 3-column cards only when the data is present.
- 7 key companies in `companies.json` have these fields populated: BSANTANDER, CHILE, SQM-B, ENELCHILE, CMPC, COPEC, FALABELLA.

## Phase 2D — Home Redesign, FX/Rates, Interactive Charts

### Global typography
- Root rem is bumped to `17px` in `globals.css` (`html { font-size: 17px }`) so the whole UI reads slightly larger. Do NOT revert to the 16px default without a reason.

### Home layout (two equal-height regions + news)
- **Top region** (`grid grid-cols-3`, fixed `height: 660`): Col 1 = combined **Macro** card (Chile rows, a `border-t-2 border-border-strong` divider, then US rows — ONE card, per the "same table separated by a horizontal line" rule). Col 2 = **Tracked Stocks** (ticker · company · day chg · YTD · market cap, only these 5) on top of the **FX table** (fills, scrolls). Col 3 = **Earnings** on top of **Hechos Esenciales recent** (fills, scrolls, ~3 visible).
- **Second region** (`grid grid-cols-3`, fixed `height: 420`): **Sector heat map** · **Chilean Rates** · **Index changes**.
- **Equal-bottom rule:** every region uses a fixed pixel height; each column is `h-full` / `flex flex-col`; the overflowing table in each column uses `flex-1 min-h-0 overflow-y-auto` so all columns end at the exact same bottom and excess content scrolls inside. Apply this pattern to any new multi-table row.
- **Sector heat-map shading:** intensity is normalized to the max absolute day-change across sectors — `12% + (|pct|/maxAbs)*38%` (range 12–50%) so the best and worst sectors saturate and mid-range stays light. 3-wide tile grid; 10th tile in `col-start-2`.

### FX table (`src/data/fxRates.json`, `src/lib/data/fxRates.ts`)
- Four sections in this order: **Key FX** (CLP, CLPCOP, EURCLP, DXY, Bitcoin) · **# USD per** (EURUSD, GBPUSD, AUDUSD, NZDUSD) · **# of currency per USD** (USDMXN, USDCOP, USDBRL, USDPEN, USDUYU, USDARS, USDKRW, USDJPY, USDCNY, USDCAD, USDCHF, USDHKD, USDTRY) · **# of Yen per** (EURJPY, GBPJPY, CHFJPY).
- Three numeric columns each: Last · Day % · YTD %. `decimals` per pair drives `formatFx`. Static MVP sample values.

### Chilean Rates (`src/data/chileanRates.json`, `src/lib/data/chileanRates.ts`)
- Full list shown: BTU 10, BTP 10, BTU 5, BCU 5, Cámara Swap 2Y, Cámara Swap 1Y, PDBC 90d, TPM/TNA. Replaces the old 2-row macro-derived rates panel.

### Index changes (`src/data/indexPerformance.json`)
- 11 indices, render order: Chile (IPSA) first, then S&P 500, then LatAm (Ibovespa, IPC México, COLCAP, BVL Peru), then the rest (Euro Stoxx 50, FTSE 100, Nikkei 225, Hang Seng, KOSPI).

### Interactive LineChart
- Measures its container via `ResizeObserver` and renders the SVG 1:1 (`viewBox` width = measured px) so **axis fonts stay at their true ~11px size** regardless of chart width. Do NOT go back to a fixed viewBox width — that re-introduces oversized axis labels.
- **Hover crosshair + HTML tooltip** (value + date), Google-charts style. Accepts an optional `valueFormatter` (company page passes a CLP formatter).
- Company chart header shows the latest price plus the **dynamic period % change** for the selected timeframe (recomputed from the sliced series).

### Market cap standard
- Use `formatMarketCapMM(valueInMillions)` → `"<grouped> MM CLP"` (single MM). `marketCapCLP` is stored in millions. Never append a second "MM" — fixes the `12.0 MM MM CLP` bug. KPI strip and Valuation both use it.

### Company detail layout
- **Recent Results · Valuation · Filings** sit in ONE row (`grid grid-cols-3 items-start`); all table columns are `text-center`. **Valuation drives the height** as a **3×3 metric grid** (P/E fwd · P/S fwd · EV/EBITDA · Op. Margin · Gross Margin · ROE · FCF Yield · P/B · Net Debt/EBITDA) and does not scroll; Recent Results and Filings are pinned to the Valuation card's **measured** height (`ResizeObserver` → `valH`) and scroll to match. Do NOT revert to a fixed `height: 300` — heights are measured now (Phase 2H).
- **Recent Results shows the pending quarter + ~5 prior quarters** (e.g. Q2'25 pending, Q1'25, Q4'24…Q1'24). Prior quarters are back-filled by `node scripts/genEarningsHistory.mjs`; valuation metrics by `node scripts/genValuationMetrics.mjs` (`StockPriceSnapshot.peFwd/psFwd/opMargin/grossMargin/roe/fcfYield/pb/netDebtEbitda`; banks carry null for EV/margin/net-debt fields).
- **News rule is cross-platform:** the company page news uses the same High-only red left-stripe + tint and **no materiality tags**, identical to Home.

### Phase 2D.1 home refinements
- **Macro card** = ONE card; Chile and US rows are separated by **highlighted band rows** (`bg-surface-2`, left accent), no divider line. Curated rows by id — Chile: TPM, IPC 12m, USD/CLP, IMACEC, PIB(GDP), Desempleo; US: Fed Funds, US 10Y, US CPI y/y, US GDP, US Unemployment, DXY. Macro is **unscrollable** and drives the top region height via its **measured** natural height (`ResizeObserver` → `macroH`, grid is `items-start`); Tracked Stocks / FX / Earnings / Hechos are pinned to `macroH` and scroll. Do NOT revert to a fixed `height: 653`/`500` — heights are measured now (Phase 2H).
- **Tracked Stocks** shows max 5 rows then scrolls; market-cap column header is `Mkt Cap (MM)` and cells show the raw millions figure (`formatCLP(marketCapCLP)`), no "MM CLP" suffix.
- **Heat-map tiles:** all text is `text-foreground` (legible on saturated tiles in both themes — never `text-muted-fg`). Each tile shows the sector day %, YTD, and the **best (▲) and worst (▼) constituent** with their % (`topContributorPct` / `worstContributorPct` in `sectorPerformance.json`). The heat-map card renders at **natural height (never scrolls)** and is **measured via `ResizeObserver`**; Chilean Rates and Markets are pinned to that measured height (`style.height = heatH`) and scroll internally. Heat-map footer shows a diverging −/+ legend.
- **Chilean Rates** rows are **drag-to-reorder** (native HTML5 DnD, session state) with a `⠿` grip.
- **Markets** (renamed from "Index Changes"): country name on top, index name below.

## Phase 2E — Interactive Layer (command palette, chart analytics, persistence)

- **Command palette:** `src/components/ui/CommandPalette.tsx`, mounted in `AppShell`. Opens with **⌘K / Ctrl-K**, **`/`**, or the TopBar Search button (`cmdk:open` window event). It is a **clean stock search only** — NO pages, NO macro (pages already live in the sidebar). Empty state shows **Recent searches** (companies opened in the last 3 days, persisted in `cmi.recentSearches` and auto-pruned). Placeholder is `t.common.search` ("Search company or ticker…"). Do NOT re-add Pages/Macro groups.
- **LineChart analytics:** now supports `markers` (earnings ▲ primary / filing ▲ warning on the baseline, with `<title>` hover) and a `compareData` second series (dashed muted line + legend). Company chart has a **vs IPSA** toggle that rebases the stock and the IPSA benchmark to 100. Benchmark series = ticker `IPSA` in `stockHistory.json` (generated by `genStockHistory.mjs` from quarterly anchors).
- **Valuation context:** each 3×3 tile shows the **sector median** (`med Xx`/`med X%`) computed client-side from peer snapshots in the same sector.
- **Persistence:** `src/lib/usePersistentState.ts` (localStorage, hydration-safe). Used for the Chilean-rates drag order (`cmi.ratesOrder`), company chart timeframe (`cmi.chartTimeframe`), and relative toggle (`cmi.chartRelative`).
- **Stocks table** header is sticky (`sticky top-0` on `th`) while scrolling.
- **Compare tab** (`/compare`, nav key `compare`, icon `compare`) — modeled on Bloomberg **COMP**. Layout top→bottom: (1) **Comparative Returns** table = 6 editable ticker fields (`cmi.compareSlots`, datalist autocomplete, color swatch per valid line) with **Total Return · Difference · Annualized** columns (green/red); (2) control bar — timeframe (1M/YTD/1Y/3Y/5Y), **Period** D/W/M (`getStockSeriesByPeriod`), and a custom **Range** (start/end date inputs that override the timeframe); (3) **Cumulative Return chart** (`CompareChart.tsx`, each series rebased to **0%**, 0-baseline dashed, hover shows all names); (4) **Fundamentals** table (returns rows excluded — already in the top table) with direction-aware best/worst cell highlighting.
  - **Add Benchmark** toggle (`cmi.compareBenchmark`) appends **IPSA** as a dashed `var(--muted)` line + a returns row.
  - **⚙ Settings modal:** (a) **Difference vs** — pick the reference security (Security 1–6 or IPSA); the reference row shows `--`, `cmi.compareDiffRef`. (b) **Series colors** — per-slot color, default institutional palette `PRESET=['#004A64','#1A6630','#8B0E04','#B07A12','#0E7FB8','#5B6770']` (6 distinct, no purple/near-dupes) with preset swatches + an RGB `<input type=color>`, `cmi.compareColors`. (c) **Chart** — legend / gridlines / line thickness. (d) **Table** — highlight best/worst. All persisted.
  - **Period** is a `<select>` (Daily/Weekly/Monthly); **Legend** is a quick checkbox on the control bar (`cmi.compareLegend`). Fundamentals table data is **centered**. **Layout:** Returns (left, `xl:col-span-5`) + Fundamentals (right, `xl:col-span-7`) side-by-side, then control bar, then chart below. **Clicking a legend item highlights that line** (thicker stroke, others dimmed). All compare state persisted under `cmi.compare*`.

## Phase 2F — Macro Sub-tabs, Economic Calendar, Yield Curves

- **Macro region (`Chile` / `US`) is chosen from the SIDEBAR dropdown**, not in-page tabs. The Sidebar "Macro" item expands to Chile/US sub-links; clicking one writes `cmi.macroRegion` and dispatches a `macro:region` window event that the macro page listens for. The page shows the current region as a badge in the SectionHeader. Title is just **"Macroeconomic Indicators"**. Both regions are **identical in layout/behavior**.
- **Today's releases** calendar sits at the **TOP** of the macro page (above the indicators table). The forecast column is labelled **"Consensus"** (`t.cal.forecast`).
- **Indicator rows are uniform height** — the Source column truncates to a single line (`truncate max-w-[180px]` + `title`) instead of wrapping. The **FX depth table is sortable** by any column.
- **One banded indicators table** per region: a single table where each category is a **highlighted band row** (`bg-surface-2` + `borderLeft 3px var(--accent)`) followed by its rows. Category labels are region-agnostic (`Rates`, `Inflation`, `FX`, `Economic Activity`, `Commodities`, `Labor`, `Crypto`). Chartable rows show an accent dot and open the **monthly** popup chart; non-chartable rows (most rate instruments) don't.
- **Chile `Rates` section = the full Home rate set** (`getChileanRates()`: BTU 10/5, BTP 10, BCU 5, Cámara Swap 1/2Y, PDBC 90d, TPM/TNA). `RATE_HIST` maps `tpm-tna→tpm`, `btu10→btu10-ref` for charting.
- **Yield curve** (`src/data/yieldCurves.json`, `YieldCurveChart.tsx`): per region, three lines — **Today / 1 week ago / Year-end 2024** across tenors. **FX depth** table beside it (region-filtered `fxRates`).
- **Economic calendar** is **schedule-driven** (`src/lib/data/calendar.ts`) — events generated deterministically from recurring release rules, so any week always has data; values synthetic. The macro tab shows **today's** region releases + **"View full calendar →"**.
- **`/macro/calendar`**: "← Back to Macro", week **← / →** navigation + Today button, **search** (scans 8 weeks forward, e.g. "cpi"/"inflation"), grouped-by-day table with **High-impact rows in red** (same `--negative` stripe+tint as news). CL + US events with country pill.

## Phase 2G — Graph Fundamentals (Bloomberg GF)

- **Charting tab** (`/chart-builder`, nav key `charting`, icon `gf`) — a Bloomberg-**GF**-style fundamentals grapher.
  - **Data:** `src/data/fundamentals.json` (`node scripts/genFundamentals.mjs`) — ~21 metrics/quarter per ticker across **Income Statement / Cash Flow / Balance Sheet / Returns to Shareholders** (`src/lib/data/fundamentals.ts`).
  - **Controls:** ticker **text input** (datalist autocomplete, `cmi.gfTicker`); a **categorized metric picker** (selected rows get a colored dot; selected metrics also show as colored chips up top, colored by selection order via `PALETTE`); **Absolute / Indexed=100** mode (`cmi.gfMode`); **Quarterly / TTM / Annual** frequency (`cmi.gfFreq`, TTM = rolling-4 sums / last for levels / recomputed margins; Annual = full calendar years); ⚙ **Settings** (chart type auto/lines/bars, legend, gridlines).
  - **Two-company overlay:** a second "vs" ticker (`cmi.gfTickerB`) overlays the same metrics for a second company — bars grouped side-by-side, the second company's lines **dashed + faded**, labels prefixed with the ticker.
  - **`FundamentalsChart.tsx`:** dual-axis (left = MM CLP amounts as bars; right = ratios/EPS as lines), or in **Indexed** mode every series rebased to 100 as lines on one axis. Measured width, hover tooltip (shows indexed + raw), legend. Axis scales are NaN-guarded: if only right-axis metrics are selected they fall back to the left axis (don't reintroduce `Math.max()` on an empty array → `-Infinity`/`NaN`).
- **Deep link:** the company page Recent Results header has a **"Graph fundamentals →"** link that sets `cmi.gfTicker` + dispatches a `gf:ticker` event, then routes to `/chart-builder`.

## Phase 2H — SOTA Pass (beat/miss, export, freshness, print, a11y, tests)

- **Earnings beat/miss vs consensus:** `EarningsRelease` gains optional `consensusRevenue/consensusEbitda/consensusEps`. `scripts/genEarningsConsensus.mjs` injects them deterministically into every reported (non-Pending) record, **correlated with `resultQuality`** (Clean beats, Weak misses). The Earnings tab Recent Results table shows a **"Rev. Surprise"** column = `surprisePct(revenue, consensusRevenue)` with a Beat/Miss/In-line label, colored via `changeColor`. `surprisePct()` lives in `formatters.ts`. Do NOT hand-edit consensus — rerun the script.
- **CSV export:** `src/lib/export.ts` (`toCSV`/`downloadCSV`/`exportCSV`, RFC-4180 escaping + UTF-8 BOM for Excel). Export buttons (⤓ `t.common.exportCsv`) on Stocks, Earnings (recent results), Hechos, Compare (fundamentals), and Charting (underlying data). Values are exported as shown.
- **"As of" freshness chips:** single source of truth `DATA_AS_OF` in `src/lib/constants.ts`; `AsOfBadge` component. `SectionHeader` has an `asOf?` prop that renders the chip. Shown on Home, Stocks, Earnings, Hechos, Macro, Compare, Charting, Company. Phase 4 swaps this for per-source live timestamps.
- **Measured region heights (replaces fixed px):** Home top region is driven by the **Macro card's** measured height (`macroH`); Company detail Results·Valuation·Filings row is driven by the **Valuation card's** measured height (`valH`). Both use `ResizeObserver` + `items-start`, mirroring the heat-map pattern. Do NOT reintroduce `height: 653`/`300`.
- **Print tearsheet (#9):** `window.print()` button (`t.common.print`, `.no-print`) on the Company page. `globals.css` `@media print` hides `.no-print` chrome (Sidebar/TopBar carry `.no-print`), unlocks scroll/height containers (`AppShell` uses `print:` variants), and avoids breaking cards across pages.
- **Accessibility (#8):** global `:focus-visible` ring in `globals.css` (accent on the dark sidebar); `src/lib/useEscape.ts` adds Esc-to-close to the Macro, Charting, and Compare modals, all of which carry `role="dialog" aria-modal`.
- **Document viewer enrichment (#7):** `/documents/[id]` cross-links its underlying earnings/hecho record (by `relatedRecordId`) to show an **"At a Glance"** facts panel + an **Assessment** chip (from `resultQuality` / `stockImpact`) and an **AI-draft disclaimer**. Static data only — no external calls.
- **Unit tests (#10):** `tests/formatters.test.ts` + `tests/returns.test.ts` using the **built-in `node:test`** runner (Node 24 strips TS types natively — zero new deps). Return math extracted to `src/lib/returns.ts` (`totalAndAnnual`, `tfStart`) and reused by Compare. Run with `npm test`.
- **Lint cleanup (React Compiler rules):** the codebase is now **lint-clean** (`npm run lint` exits 0). Key patterns to keep:
  - `usePersistentState` is built on **`useSyncExternalStore`** (not `useState`+`useEffect`) — hydration-safe with no setState-in-effect, snapshots cached at module scope (`snapByKey`) for stable identity, and it syncs across hook instances/tabs via a `cmi-ls:<key>` event + the native `storage` event. Do NOT reintroduce a `useEffect` that calls `setState` to hydrate.
  - "Adjust state when a prop/route changes" uses the **render-time previous-value pattern** (`if (x !== prevX) { setPrevX(x); … }`), never an effect — see CommandPalette (query/open resets), Sidebar (`onMacro` accordion), chart-builder (`typed`/`typedB` mirrors).
  - The `ResizeObserver` measurement effects (heat-map/macro/valuation/chart widths) are the **one accepted** setState-in-effect shape (setState runs from the observer callback) — leave them.
  - Components are defined at **module scope** (e.g. chart-builder `Seg`), never inside render.
- Build: `npm run build` passes 0 errors (12 routes); `npm test` 13/13 pass; `npm run lint` 0 problems. Runtime-verified (dev server): home/compare/charting render, persistence round-trips, command palette filters, **no console errors or hydration warnings**.

## Current Phase

**Phase 4B — BCCh Series Mapping, Encoding Fix & Production Deploy** ✓ COMPLETE

11 Chilean macro series live in Production from BCCh BDE. Production URL: `https://nevada-market-intelligence.vercel.app` (Deployment `dpl_78oUQvyNRfiFma58PAupzGrygggn`).

Sub-phases completed:
- **4B (foundation):** SearchSeries/GetSeries tooling, manual mapping framework, all 16 indicators unverified pending credentials.
- **4B.1:** Ran SearchSeries with credentials; mapped 6 high-confidence series (TPM, UF, BTU 10Y, BTU 5Y, Cámara Swap 2Y, Cámara Swap 1Y).
- **4B.2:** Fixed BCCh SearchSeries UTF-8/iso-8859-1 encoding Mojibake (`decodeResponseText` in `textDecode.ts`, UTF-8-first sniffing). Mapped 5 additional series (USD/CLP, IPC m/m, IPC 12m, IMACEC 12m via `transformation: 'yoy'`, Desempleo). 11 series verified total, 5 unmapped (copper unit mismatch, BTP-10, BCU-5, PDBC-90d, TPM-TNA).
- **4B.3:** Deployed to Vercel Preview; diagnosed BOM (`U+FEFF`) on all env vars due to Windows PowerShell stdin piping. Fixed with `stripBom()` in `bcchClient.ts`.
- **4B.4:** Pushed 5 commits to `origin/master`. Set Production env vars via Vercel API (credentials encrypted, never printed). Deployed `--prod`. Validated all 11 BCCh indicators + 6 history endpoints live on `nevada-market-intelligence.vercel.app`. Production logs clean (no errors, no credential exposure).

Files added/changed (all sub-phases):
- `src/lib/providers/textDecode.ts` — UTF-8 BOM sniffing + accent-insensitive search normalization
- `src/lib/providers/bcchClient.ts` — `stripBom()` for all env var reads; `isBcchConfigured()` updated
- `src/config/bcchSeriesManualMap.ts` — 11 verified entries (6 from 4B.1 + 5 from 4B.2)
- `scripts/bcch/searchSeries.ts` — encoding fix applied; uses `decodeResponseText`
- `tests/textDecode.test.ts` (15 tests), `tests/bcchMapping.test.ts` (updated: ≥11 verified)
- Build 14 routes · lint 0 · tests 53/53 · static fallback works with no env vars

5 unmapped indicators (design/data decisions — see `tmp/bcch-mapping-review.md`):
- `copper` — BCCh publishes in USD/oz; UI expects CLP/lb. Source from LME in later phase.
- `btp-10` — no continuous secondary market BTP rate in BCCh catalog (only auction rates).
- `bcu-5` — BCU bonds stale (last issued 2011-2013); BUF 5Y covers combined BCU/BTU.
- `pdbc-90d` — BCCh discontinued 90d PDBC; active is 14d. UI label needs update before mapping.
- `tpm-tna` — TPM IS the nominal annual rate; no distinct TNA series found.

Next: **Phase 4C** (stock price provider) or **Phase 5** (CMF filings ingestion).

---

**Phase 4A — Live Macro Architecture (BCCh foundation)** ✓ COMPLETE

Live-data ingestion architecture + BCCh macro provider foundation. The app still
runs on static data in production (live disabled until series codes are mapped in
Phase 4B). Files added/changed:
- `src/lib/providers/{types,dataMode,bcchClient,staticMacroProvider,bcchMacroProvider,macroProvider}.ts` — provider abstraction (server-only except `types.ts`)
- `src/config/macroSeries.ts` — series registry; all `providerSeriesCode: null`, `enabled: false` (codes verified in 4B)
- `src/app/api/macro/route.ts`, `src/app/api/macro/history/[indicatorId]/route.ts` — live/hybrid API routes with metadata + static fallback
- `src/lib/data/macro.ts`, `src/lib/data/macroHistory.ts` — added client-safe `fetchMacroIndicators` / `fetchMacroHistory`
- `src/components/ui/DataSourceBadge.tsx` + `i18n` `dataSource.*` (en/es) — subtle source/status chip
- `src/app/macro/page.tsx`, `src/app/page.tsx` — static-first, upgrade-if-live; badges wired
- `tests/dataMode.test.ts`, `tests/bcchClient.test.ts` — 13 new tests (26 total)
- `.env.example`, `docs/{data_dictionary,deployment,implementation_plan}.md`, `README.md` — DATA_MODE + provider docs
- Build 14 routes (12 + 2 API) · lint 0 · tests 26/26 · runs with no env vars

Next: **Phase 4B** (map & enable official BCCh BDE series codes) or **Phase 4C** (stock price provider).

---

**Phase 3 — Polish and Vercel Deployment** ✓ COMPLETE

Changes made in Phase 3:
- `src/app/globals.css` — added `min-width: 1200px` to `html` so narrow viewports scroll horizontally instead of crushing the 3-column layout
- `src/app/macro/page.tsx` — added `max-h-[90vh] overflow-y-auto` to chart modal inner container (safe on short displays)
- `src/app/layout.tsx` — rich `Metadata` (description, applicationName, keywords, robots noindex, icons, openGraph) + `Viewport` export
- `src/lib/i18n.ts` — added `topbar.disclaimer` key in both `en` and `es` with the full MVP disclaimer text
- `src/components/ui/AppDisclaimer.tsx` — new slim footer component (11px, muted, `no-print`)
- `src/components/layout/AppShell.tsx` — added `<AppDisclaimer />` below `<main>`
- `public/favicon.svg` — simple CMI monogram SVG (32×32, navy `#004A64`, white "CMI" text)
- `docs/deployment.md` — full deployment guide (prerequisites, local run, Vercel deploy options, rollback, env vars, data source map)
- `README.md` — project README with features, stack, data sources, limitations, next phases
- `.env.example` — placeholder env-var template (all commented out; safe to commit)
- `.gitignore` — added `!.env.example` so the template is not excluded by the `.env*` rule
- `public/` — removed unused default Next.js SVGs (file, globe, next, vercel, window)
- Build: `npm run build` → 12 routes, 0 errors · Lint: exit 0 · Tests: 13/13

**Phase 2C — Charts, Macro Expansion, Market Overview Modules** ✓ COMPLETE

**Phase 2B — Data/UI Consistency, Document Drill-Down, Layout Density** ✓ COMPLETE

Changes made in Phase 2B:
- `src/app/globals.css` — added `.ui-number` utility class
- `src/lib/formatters.ts` — added `formatMacroValue()`, `formatMacroChange()`
- `src/data/macroIndicators.json` — normalized `changeLabel` to `%` format throughout
- `src/types/index.ts` — added `DocumentRecord` interface
- `src/data/documents.json` — 24 DocumentRecord entries (15 HE, 9 earnings), all `external_only`
- `src/lib/data/documents.ts` — typed accessor helpers for documents
- `src/app/documents/[id]/page.tsx` — new document viewer route
- `src/lib/i18n.ts` — added `documents.*` section in both `en` and `es`
- All 7 existing pages — `w-full`, `ui-number`, drill-down "View Summary" links, news red stripe
- Build: `npm run build` passes 0 errors (9 routes)

Changes made in Phase 2C:
- `src/types/index.ts` — added MacroHistoryPoint, StockHistoryPoint, SectorPerformance, IndexPerformance; extended MacroIndicator (region, US categories); extended Company (businessModel, keyRevenueDrivers, keyRisks, sourceStatus)
- `src/data/macroHistory.json` — 756 records, 42 quarterly points × 18 indicators (2015–2025)
- `src/data/stockHistory.json` — 176 records, 22 quarterly points × 8 tickers (2020–2025)
- `src/data/sectorPerformance.json` — 10 Chilean sectors with day/YTD change and top/worst contributor
- `src/data/indexPerformance.json` — 6 indices (IPSA + 5 LatAm/global)
- `src/data/macroIndicators.json` — added 6 US indicators, region field on all 18
- `src/data/companies.json` — businessModel/keyRevenueDrivers/keyRisks for 7 key companies
- `src/components/charts/LineChart.tsx` — pure SVG line chart, no library
- `src/components/ui/SectionHeader.tsx` — text-xl heading
- `src/lib/data/macroHistory.ts`, `stockHistory.ts`, `sectorPerformance.ts`, `indexPerformance.ts` — typed accessors
- `src/lib/i18n.ts` — new keys for sector heat map, index changes, macro US section, company business profile
- `src/app/macro/page.tsx` — clickable chart panel, 1Y/3Y/5Y/10Y toggle, Chile + US sections
- `src/app/page.tsx` — fixed macro ordering, sector heat map, index changes modules, "Market Overview" title
- `src/app/companies/[ticker]/page.tsx` — LineChart + timeframe toggle, business model panels, fixed earnings alignment
- Build: `npm run build` passes 0 errors (9 routes)

Next step: Phase 3 — Polish and Vercel Deployment. See `docs/implementation_plan.md`.
