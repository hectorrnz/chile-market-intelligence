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

### No-static-terminal-state policy (Phase 8B+)
No visible module may remain static as a terminal state. Static data is permitted only as:
1. **Fallback** — a live/persisted path exists and is preferred (e.g. macro, market data).
2. **Seed/reference layer** — data that legitimately doesn't change from a live feed (e.g. static sector/company reference metadata).
3. **Temporary placeholder with a defined conversion path** — static today, with a documented target source and next phase (see `docs/data_source_status.md`).
4. **Blocked source with a documented workaround** — a live path was attempted and is structurally blocked (e.g. CMF's CAPTCHA gate), with workaround options documented, not silently treated as "just static."

Every visible field must be classified as `live` · `persisted` · `derived` · `static_fallback` · `temporary_static` · `blocked` · `unavailable` — never left as an unlabeled, open-ended "Static MVP" with no path forward. `docs/data_source_status.md` is the canonical matrix; update it whenever a module's source or conversion path changes.

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

**Phase 8D.1 — Macro Category Fix + BCCh FX Cleanup + FRED Release-Date Calendar** ✓ COMPLETE (2026-07-10)

Follow-up cleanup pass on Phase 8D. `FRED_API_KEY` became available (server-only, free, self-service) —
used solely for the new dates-only release calendar; the 9 US macro time-series indicators from Phase 8D
still need no key at all.

**Macro category classification — real bug fixed.** Both live providers (`bcchMacroProvider.ts`,
`fredMacroProvider.ts`) hardcoded `category: 'Rates'`/`'US Rates'` for every indicator, regardless of its
true category — confirmed live before the fix: copper, IPC, UF, IMACEC, unemployment, US CPI, and US
unemployment all reported the wrong category once live data replaced the static fallback. Fixed by adding a
`category: MacroCategory` field to `MacroSeriesDef` (`src/config/macroSeries.ts`), matched exactly against
`src/data/macroIndicators.json`'s category for every id; both providers now read `def.category` instead of
hardcoding. A regression test (`tests/macroSeriesDualProvider.test.ts`) asserts every `MACRO_SERIES` entry's
category matches its static counterpart, so this can never silently regress.

**EUR/CLP — verified in Phase 8D, wired this phase.** `F072.CLP.EUR.N.O.D`, daily, re-confirmed live
(recent values ~1,040–1,054 CLP/EUR) and wired via the same pattern as copper: `bcchSeriesManualMap.ts`
entry, `macroSeries.ts` `BASE` entry (category `FX`), `macroIndicators.json` static fallback, and a new
`macro_indicators` DB row (a data insert, not a migration). Live: 2,486 rows ingested and persisted.

**FX panel (Home page) — cleaned up to BCCh-only.** The old panel rendered 25 currency pairs across 4
sections (Key FX / # USD per / # of currency per USD / # of Yen per) from static `fxRates.json`, with
fabricated source labels ("Bloomberg", "CoinMarketCap") this project has never had a relationship with. The
panel now renders directly from the live macro `FX` category (`getByCategory('FX')`) — the same category
the Macro page's indicators use — showing exactly the 2 BCCh-verified pairs (USD/CLP, EUR/CLP). Removed: the
4-section grouping, the "# of currency per USD" helper label, and the "Static MVP sample" footer (now:
"Source: Banco Central de Chile (BCCh) — verified live pairs only"). The other 23 pairs are all excluded for
the same documented reason (`no_verified_bcch_series`) — none has a confirmed live BCCh series; a dedicated
FX-cross provider remains explicitly out of scope (no Frankfurter/Finnhub/paid vendors). `fxRates.json`/
`fxRates.ts` are untouched and still back the separate Macro-page "FX depth" table.

**Nonfarm Payrolls — verified live, deliberately deferred.** FRED's `PAYEMS` is a cumulative employment
*level* (thousands of persons), not the month-over-month *change* the headline print means (e.g. "+150K
jobs"). Deriving that requires a new `diff` transform type — genuinely different from every transform
already in `transforms.ts` (`none`/`yoy`/`mom`/`level-to-yoy`/`bp-to-pct`, all percentage-based or
pass-through). Per the phase's own instruction, deferred and documented rather than overbuilt or shown
misleadingly as a raw level.

**Dates-only FRED economic release calendar — new.** FRED's Releases API
(`https://api.stlouisfed.org/fred/release/dates`, distinct from the public CSV graph endpoint used for
macro time series) requires the new `FRED_API_KEY`. Discovery matched all target categories against FRED's
329-release catalog (never guessed an id): 15 candidates found, University of Michigan Consumer Sentiment
and ISM PMI confirmed absent from FRED's release catalog (searched, not guessed). **A real data-quality
issue was found and excluded, not silently shipped**: live-testing showed `release_id 101` ("FOMC Press
Release") and `release_id 18` ("H.15 Selected Interest Rates") returning a release-date entry for
essentially every consecutive calendar day (53 and 36 hits in a 45-day window) rather than discrete
scheduled dates — a genuine FRED API/data-modeling quirk for those two releases specifically, confirmed by
direct inspection. Both excluded from the final **13-release curated allowlist**
(`src/config/fredReleaseAllowlist.ts`). Architecture: `fredReleaseCalendarClient.ts` (server-only, reads the
key) → `fredReleaseCalendar.ts` (orchestrator, every event tagged `datesOnly: true` with
`actual`/`consensus`/`prior` always `null`) → `GET /api/macro/fred-release-calendar` (public, sanitized,
reports `configured: false` — not an error — when the key is unset) → `fredCalendar.ts` (client-safe fetch
helper) → a new, clearly-labeled ("Dates only — no consensus") panel on `/macro/calendar`, additive below
the existing synthetic schedule-driven table, which is completely unchanged. No persistence, no migration,
no new cron — every request live-queries FRED directly (13 parallel requests per page load).

**Tests:** 1 new test file (`tests/fredReleaseCalendar.test.ts`, 18 tests — allowlist shape/exclusions,
configured/unconfigured paths, mocked fetch success/failure, dates-only invariants, no client-side key
exposure) + additions to `tests/macroSeriesDualProvider.test.ts` (category regression guard, FX-panel
cleanup hygiene checks). Full suite 1156 → 1187/1187, lint 0, build 0 errors.

**Local validation:** live-verified via dev server — `/api/macro/fred-release-calendar` returns 19 clean,
correctly-spaced events after excluding FOMC/H.15; Home page FX panel confirmed showing exactly USD/CLP +
EUR/CLP with a live `DataSourceBadge`; `/macro/calendar` confirmed rendering the new panel correctly.

Scope limits: macro category/FX/calendar cleanup only; no Finnhub, Frankfurter, or paid vendors; no full
consensus/actual/prior economic calendar; financials, Structured Notes, auth/watchlist/portfolio, and UI
redesign untouched; no new cron schedule (calendar is live-queried per-request, not cron-ingested).

Next: bring the Macro page's separate FX depth table to the same BCCh-only standard; add a `diff` transform
+ UI slot for Nonfarm Payrolls if desired; consider persistence for the FRED release calendar if usage
justifies it; periodically re-check for a Consumer Sentiment/ISM PMI FRED release.

---

**Phase 8D — FX, Rates, Copper, US Macro, and Economic Calendar Live-Source Completion** ✓ COMPLETE (2026-07-10)

Expands live macro/market-source coverage beyond the existing Chile-only BCCh integration, using only
official or stable free sources. Full discovery record (every source investigated, implemented, or
rejected, with reasons) in `docs/macro_market_source_coverage.md`.

**Copper — implemented via BCCh.** The Phase 4B deferral was a genuine unit mismatch (BCCh's daily
`F019.PPB.PRE.100.D` publishes USD/oz; the UI expects USD/lb). Re-running BCCh's official SearchSeries
catalog this phase surfaced `F019.PPB.PRE.40.M` — monthly, already in USD/lb, the exact unit the UI
expects. No unit conversion, no guessing — verified directly against the official catalog. Cross-checked
against Yahoo Finance `HG=F` futures as a sanity check only, never as the source of truth.

**BTP-10, BCU-5, PDBC-90d, TPM-TNA — re-verified, still deferred.** No new live series exists for any of
the four (same conclusion as Phase 4B, confirmed again against the live catalog).

**EUR/CLP — verified but deliberately not wired.** `F072.CLP.EUR.N.O.D` is confirmed live and correct, but
wiring it in requires a new `macro_indicators` row + UI card + static fallback (UI/data-model scope beyond
this phase's source-discovery scope). Documented for a future phase.

**US macro — implemented via FRED (Federal Reserve Bank of St. Louis).** FRED's public CSV "graph" endpoint
(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>`) requires **no API key** — genuinely free,
official, verified live. 9 series mapped: Fed Funds (`FEDFUNDS`), US 3M/2Y/10Y/20Y/30Y Treasury yields
(`DGS3MO`/`DGS2`/`DGS10`/`DGS20`/`DGS30`), US Unemployment (`UNRATE`), US CPI m/m and y/y (both derived
from the same `CPIAUCSL` index-level series with different transforms — mirroring how Chile's IPC
mensual/anual both derive from one BCCh level series). Nonfarm payrolls, ISM/PMI, and a recession-indicator
series were considered and deliberately **not** added — no UI slot, no free reliable source, or doesn't fit
the existing indicator value/change model, respectively.

**Dual-provider architecture**: `src/config/usFredSeriesManualMap.ts` mirrors `bcchSeriesManualMap.ts`'s
human-verification discipline exactly (`seriesId`/`verified`/`frequency`/`transformation`/`confidence`/
`verificationDate`/`notes` — no code ever guessed). `src/config/macroSeries.ts`'s registry `merge()`
dispatches each series definition to the correct manual map based on `sourceProvider`
(`'BCCh' | 'INE' | 'LME' | 'FRED' | 'external'`); `getEnabledBcchSeries()` / `getEnabledFredSeries()` scope
each provider (and each ingestion script) to only its own series, so a FRED series can never accidentally
reach the BCCh client or vice versa. `src/lib/providers/fredClient.ts` (pure `parseFredCsv`,
`isFredConfigured()` always `true`) + `fredMacroProvider.ts` implement the same `MacroProvider` contract as
the BCCh equivalents. The orchestrator (`macroProvider.ts`) now queries both providers in parallel for the
indicators list (`resolveMacroIndicators`) and dispatches per-indicator to the correct provider for history
(`resolveMacroHistory`, via each indicator's `sourceProvider`) — the Supabase-persisted read layer and
static-fallback layer needed **no changes**, since both already key purely off `indicator_id`.

**A real bug was caught and fixed while auditing the existing BCCh scripts during this phase**:
`getEnabledSeries()` (now returning both providers' series after the registry merge) was being called
unscoped in `scripts/ingest/bcchMacro.ts` and `src/lib/ingestion/bcchMacroIngestion.ts` — fixed to call
`getEnabledBcchSeries()` so the BCCh-only ingestion path can never accidentally attempt to fetch a FRED
series code via the BCCh client.

**Two real production bugs caught and fixed during live Production validation** (both would have silently
broken US macro entirely if not caught): (1) `fetchFredSeries` had no date-range parameter, so daily
Treasury-yield series (decades of history) were downloaded in full just to read the latest value — fixed by
adding `cosd`/`coed` support (FRED's own chart start/end-date params) and scoping every call site to the
window it actually needs, mirroring `bcchClient`'s `firstDate`/`lastDate` pattern; (2) even after that fix,
`GET /api/macro?region=US` still hung indefinitely (90+ seconds) from the live Vercel deployment while the
identical request completed in under a second from a regular machine and Yahoo Finance calls from that same
deployment returned in ~2s — Node's default `fetch` sends no descriptive User-Agent, and FRED's edge
appears to silently stall such requests rather than reject them. Fixed by sending an explicit UA string;
verified live, `/api/macro?region=US` now returns in ~2.6s. A separate, unrelated pre-existing bug was also
found (not fixed this phase, flagged as a follow-up task): the live BCCh/FRED providers hardcode
`category: 'Rates'`/`'US Rates'` for every indicator regardless of its true category, which can misfile an
indicator like copper (Commodities) into the wrong section on the Macro page once live data loads.

**Ingestion**: `scripts/ingest/fredMacroCore.ts` (pure) + `scripts/ingest/fredMacro.ts` (CLI,
`npm run ingest:fred-macro:dry` / `ingest:fred-macro -- --all --write`) + `src/lib/ingestion/fredMacroIngestion.ts`
(shared logic, mirrors `bcchMacroIngestion.ts`) + `GET /api/cron/ingest-fred-macro` (Bearer `CRON_SECRET`)
— **not added to `vercel.json`**, manual/reviewable trigger only, same policy as the BCCh/CMF-XBRL/
Yahoo-financials crons. No new schema migration, no new dependency, no new cron schedule.

**Economic calendar — deferred, unchanged.** Re-investigated; no free, structured (non-scraped), stable
calendar source was found (government sites publish only rendered HTML; commercial calendar vendors require
a paid API key). The existing schedule-driven synthetic calendar (`src/lib/data/calendar.ts`) continues
unchanged, honestly labeled as such.

**Plausibility bands**: 9 new bands added to `src/lib/providers/plausibility.ts` for the FRED series.

**Tests**: 5 new test files (`fredMacroIngest.test.ts`, `fredClient.test.ts`, `macroSeriesDualProvider.test.ts`,
`fredCronIngestion.test.ts`, plus additions to `transforms.test.ts` and a correction to `bcchMapping.test.ts`
— copper was hardcoded there as the "known unverified" example, updated to use `btp-10`, still genuinely
unverified). Full suite 1102 → 1156/1156, lint 0, build 0 errors.

**Local validation**: live dry-run of all 9 FRED series — 12,961 rows across 9 indicators, all succeeded;
live dry-run of all 12 enabled BCCh series including copper — 18,512 rows, copper returned 118 real monthly
USD/lb observations (2016–2026).

Scope limits: macro/market source-discovery expansion only; no financials refactor; no Structured Notes/
auth/watchlist/portfolio changes; no UI redesign; no paid/vendor APIs; no Bloomberg; no CAPTCHA bypass; no
fragile scraping; no new cron schedule; EUR/CLP and Nonfarm Payrolls documented as ready-to-wire but out of
scope (UI-slot work, not source-discovery work).

Next: wire EUR/CLP (new `macro_indicators` row + UI card); add a Nonfarm Payrolls UI slot if desired;
periodically re-check the economic-calendar source landscape — or return to Structured Notes (Santander/
older-2024-Citi parser templates) or continue CMF/XBRL issuer work.

---

**Phase 8C.8 — Official CMF Bank Financials Persistence + Pillar 3 Discovery** ✓ COMPLETE (2026-07-09)

Enables official CMF bank regulatory data as a controlled production annual source for the 4 bank tickers
(BSANTANDER, CHILE, BCI, ITAUCL) discovered in Phase 8C.7, and investigates an official CMF/SBIF source for
bank capital/risk metrics (CET1, RWA, NPL, coverage).

**`cmf_bank` source type + priority**: migration `20260712000000_financials_cmf_bank_source_type.sql`
(additive/idempotent, mirrors the Phase 8C.5 `yahoo_finance` migration) widens the `source_type` CHECK on all
4 financials tables. `VALID_SOURCE_TYPES`/`DEFAULT_SOURCE_PRIORITY` gained `cmf_bank` at **priority 180** —
full ordering: `xbrl (210) > cmf_fecu (200) > cmf_bank (180) > vendor_feed (150) > broker_feed (140) >
document_ingestion (120) > manual_csv (100) > yahoo_finance (80) > derived (50) > static_seed (10)`.

**Ingestion orchestrator** (`runCmfBankFinancialsIngestion.ts`) drives all 4 banks over the latest annual
release, writing only payloads clearing both a minimum-mapped-field guard and a minimum-validation guard —
never a silently-degraded partial parse. `cmfBankProvider.ts` gained a real `writeImport()`. Cron:
`GET /api/cron/financials/cmf-bank` — **not on a Vercel cron schedule**, same policy as the non-bank cron.

**Production result: all 4 banks succeeded** — 60 rows written (15/bank), 56 fields mapped, 0 failures, all
`valid`. Verified live: each bank's FY2025 `cmf_bank` annual period now supersedes the prior `yahoo_finance`
FY2025 annual period; Yahoo's quarterly/other-year data untouched. BCI's two independently-sourced
`net_income` figures cross-validate within ~0.02%.

**A real bug was caught and fixed during production validation**: the ingestion CLI was missing the
`@next/env` env-loading call every other ingestion script in this project has — `--write` silently ran with
no Supabase credentials, both upserts failed closed, surfaced only as a generic row-count error. Fixed,
verified with a single-bank write before the full run, guarded by a new regression test.

**Labeling**: `resolveFinancials.ts` now labels `cmf_bank` "Official CMF bank regulatory filing" — distinct
from "Persisted financials via CMF XBRL." Status endpoint's `bankTrack` overlays live per-bank coverage
(`productionIngestion: 'enabled'`, period count, latest release) + a `pillar3` field.

**Pillar 3 discovery: `deferred` — not a viable structured source.** CMF's own disclosure page is a PDF whose
entire content is a link directory to each bank's own investor-relations website (self-hosted, per-bank
format, mostly PDF). None of the 4 app banks link to a direct structured file. No ingestion prototype was
built for a non-viable source (`pillar3Discovery.ts`) — per the "document the blocker, don't build
speculative ingestion" policy. CET1/RWA/NPL/coverage remain structurally unavailable, never fabricated.

**Tests:** 8C.8 additions to `tests/financialsCmfBank.test.ts` — source-type/priority/migration checks,
summarizeSource labeling, orchestrator/cron hygiene, pillar3Discovery coverage, live-coverage overlay, and an
env-loading regression test. Full suite 1072→1101, lint 0, build 0 errors.

Scope limits: bank official-source persistence + Pillar 3 discovery only; annual (December) only; no non-bank
refactor; no paid/vendor API; no OCR; Pillar 3 writes out of scope (non-viable source); Structured Notes/auth/
watchlist/portfolio/macro untouched; no UI redesign; bank cron stays unscheduled.

Next: resolve the deposits/borrowings ambiguity; periodically re-check Pillar 3; or **Phase 8D** (FX/rates +
economic calendar), or **Phase 9F** (Santander/older-2024-Citi structured-notes parser).

---

**Phase 8C.7 — Bank-Specific CMF Discovery + Banking Financials Architecture** ✓ COMPLETE (2026-07-09)

Investigates a bank-specific CMF ingestion path for the 4 `bank_track_required` tickers (BSANTANDER, CHILE,
BCI, ITAUCL) that Phase 8C.4/8C.6 confirmed structurally unreachable via the non-bank securities-issuer XBRL
directory. Discovery + dry-run prototype only — **no production write**.

**No bank XBRL path exists (none was expected)** — re-confirmed live this phase that banks are absent from
the securities-issuer directory under every registry group. Instead, a **real, official, non-XBRL, public,
no-CAPTCHA monthly regulatory feed** was discovered: CMF's "Balance y Estado de Situación Bancos" — tab-
delimited TXT files (not XBRL) under the "Compendio de Normas Contables para Bancos" chart of accounts, each
release bundling its own official bank-code↔legal-name registry and a 2,397-entry account-code dictionary.
Bank codes verified from this official documentation: CHILE=001, BCI=016, BSANTANDER=037, ITAUCL=039. No RUT
is asserted (never guessed — the bank code is this pipeline's identifier).

**Bank-specific normalized field model** (`src/lib/financials/banks/bankStatementTypes.ts`) kept deliberately
separate from the industrial concept map (interest income ≠ revenue; loans/deposits ≠ current assets/
liabilities). **Conservative 14-field account-code map** (`bankConceptMap.ts`) — every entry verified `high`
confidence via exact additive identities (`total_assets == total_liabilities + total_equity`;
`profit_before_tax + tax_expense == net_income`) against real data for **all 4 banks**, confirmed twice (May
2026 and the target December 2025 annual release). Deposits/borrowings and all capital/regulatory ratios
(CET1, RWA, NPL, coverage) stay unmapped — no unambiguous account exists for the former; the latter don't
exist anywhere in this feed (a separate, un-investigated quarterly Pillar 3 disclosure) — never fabricated.

**Dry-run prototype** (`cmfBankProvider.ts`, `npm run discover:cmf-bank -- --live`) reuses the existing
dependency-free ZIP reader unchanged. **No `writeImport` exists** — verified live against the real December-
2025 annual release: all 4 banks, 14/14 fields mapped, `valid`, 0 warnings. Yahoo Finance remains the sole
active fundamentals source for all 4 banks. Status endpoint gained a separate `bankTrack` diagnostics field
(`coverageFunnel` still classifies banks `bank_track_required`, unchanged).

**Persistence not enabled**: schema is source-agnostic (no migration needed to store bank fields), but
`source_type`/`DEFAULT_SOURCE_PRIORITY` have no `cmf_bank` entry yet — deliberately deferred until a real
write is decided.

**Tests:** `tests/financialsCmfBank.test.ts` — 48 new tests, sanitized fictional fixtures, no live network in
any unit test. Full suite 1024→1072, lint 0, build 0 errors.

Scope limits: bank-specific discovery only; annual (December) only; no non-bank refactor; no production write/
migration/cron; no paid/vendor API; Structured Notes/auth/watchlist/portfolio/macro untouched; no UI redesign.

Next: resolve the deposits/borrowings ambiguity; investigate the quarterly Pillar 3 disclosure for capital
ratios; or promote `cmf_bank` to a real (still unscheduled) ingestion path via a migration — or **Phase 8D**
(FX/rates + economic calendar), or **Phase 9F** (Santander/older-2024-Citi structured-notes parser).

---

**Phase 8C.6 — CMF/XBRL Non-Bank Completion: Eligible Promotion + XBRL Dialect Support** ✓ COMPLETE (2026-07-09)

Finishes the official CMF/XBRL non-bank layer: **all 21 non-bank app stocks** now have authoritative annual
CMF/XBRL data. The 4 banks stay `bank_track_required` (bank-specific taxonomy, deferred). Coverage funnel
15/3/3/4 → **21/0/0/4**.

**Promoted 3 eligible_verified → enabled** (CONCHATORO, FALABELLA, MALLPLAZA) after a re-confirmed clean live
FY2025 dry-run (29/29/27 mapped, CLP). RUT/legal-identity notes retained.

**XBRL parser dialect support** (`src/lib/financials/xbrl/parseXbrl.ts`) — verified byte-identical for the 15
already-working issuers (CCU regression-checked):
- **Default/unprefixed-namespace (SONDA):** the xbrli instance namespace is the XML default, so
  `<context>`/`<unit>`/`<identifier>`/period elements are unprefixed (facts stay `cl-ci:`/`ifrs-full:`
  prefixed). Structural regexes now accept an **optional `xbrli:` prefix**. SONDA: 0 contexts before → 2044
  contexts / 11756 facts / 30 mapped.
- **CTI-Service ISO-8859-1 (ANDINA-B, VAPORES):** `xbrli:`-prefixed but **single-quoted attributes** + an
  ISO-8859-1 encoding declaration. All attribute regexes now accept both quote styles; new `decodeXbrlBytes()`
  decodes per the `<?xml encoding=?>` declaration (ISO-8859-1 → latin1, else UTF-8, unknown → UTF-8 fail-safe);
  the provider's `fetchFiling` uses it instead of hardcoded `toString('utf8')`. ANDINA-B 818/4402/30;
  VAPORES 200/1024/23.
- Namespace URIs parsed into `XbrlInstance.namespaces` (never dropped). Taxonomy-only ZIP rejection unchanged
  (provider-level, pre-parse; parser still yields 0 facts for schema-only docs).

**No concept-map change** — both dialects use standard `ifrs-full:` for every mapped concept (`cl-ci:` is only
for CMF-extension items we don't map). **VAPORES legitimately files zero `ifrs-full:Revenue`** (a shipping
holdco dominated by its Hapag-Lloyd equity stake) — that field stays honestly missing, never fabricated (Yahoo
fills it).

**Production write:** 6 newly-enabled issuers, **174 rows, 0 failures**, all `valid_with_warnings`.

**Precedence/fallback verified live in the DB:** for the new issuers, XBRL FY2025 (priority 210) **supersedes**
the Yahoo annual (80) for that year (`is_superseded=true` on the Yahoo row), while all Yahoo quarterly periods
+ pre-2025 annuals stay active as the fallback. No migration, no source-priority change.

**Tests:** `tests/financialsCmfXbrl.test.ts` 65→72 (default-namespace + CTI-Service parsing, `decodeXbrlBytes`
incl. unknown-encoding fail-safe, namespace-URI preservation, facts-free/taxonomy rejection, funnel 21/0/0/4,
banks still bank_track_required). Full suite 1017→1024/1024, lint 0, build 0 errors. Cron still unscheduled.

Scope limits: non-bank CMF/XBRL completion only; annual only; no interim/YTD; no bank ingestion; no new cron
schedule; no paid/vendor APIs; no dependency; Yahoo-priority unchanged; Structured Notes/auth/watchlist/
portfolio/macro untouched; no UI redesign.

Next: bank-specific CMF/XBRL track (separate taxonomy, deferred); or **Phase 8D** (FX/rates + economic
calendar); or **Phase 9F** (Santander + older-2024-Citi structured-notes parser).

---

**Phase 8C.5 — Universal Fundamentals Coverage via Yahoo Finance** ✓ COMPLETE (2026-07-09)

Fixes a real gap found using Charting live: CMF/XBRL issuers had only **one annual data point**, so
Quarterly/TTM/Annual had nothing to aggregate for 15 stocks, and 10 stocks (4 banks + 3 unsupported-XBRL
dialects + 3 synthetic-only) had **no persisted fundamentals at all**. CMF/XBRL structurally cannot reach
banks (confirmed in 8C.4), so no amount of CMF work alone could make every stock's tabs work.

**Yahoo Finance is now the universal fundamentals source** (`src/lib/financials/providers/yahooFundamentalsProvider.ts`):
fetches real quarterly (discrete) + ~4-5yr annual income/balance/cash-flow for all 25 tickers via
`fundamentalsTimeSeries`, currency read per ticker via `financialData.financialCurrency`. Missing fields stay
missing (never zeroed); capex/dividends stored as positive magnitudes (Yahoo reports them negative).

**New source_type `yahoo_finance` at priority 80** (below `manual_csv`=100, above `derived`=50) — migration
`20260711000000_financials_yahoo_source_type.sql` widens the `source_type` CHECK (idempotent). This makes
CMF/XBRL annual (210) supersede Yahoo annual automatically for the same fiscal year — verified live for
CCU/SQM-B/etc. (`sourceType: xbrl` for their filed year) — while Yahoo quarterly (a different logical period)
always shows.

**Real library bug caught and fixed during validation**: `yahoo-finance2`'s `fundamentalsTimeSeries(...,
{module:'all'})` intermittently fails with a "Failed to generate key" error **non-deterministically** — same
ticker succeeds on one call, fails on the next (found live: SQM-B's first ingestion silently wrote 0 quarterly
periods while every other ticker had 5-6). The original `.catch(() => [])` swallowed this into a
false-empty-but-not-actually-empty result — exactly what the no-silent-fabrication doctrine forbids. Fixed
with a 3-attempt retry per fetch (`withRetry` helper); a fetch that still fails after retries fails the whole
ticker loudly (never persists a partial/silently-degraded history).

**Ingestion**: `npm run ingest:yahoo-financials[:dry]` (`--ticker`, `--write`) + cron route
`GET /api/cron/financials/yahoo` (Bearer `CRON_SECRET`, unscheduled — manual/reviewable like the CMF cron).

**Honest labeling**: badge "Fundamentals via Yahoo Finance (unofficial)" — never claims official status.
`resolveFinancials.ts`'s `summarizeSource` surfaces the highest-priority source present with a `(+ Yahoo)`/
`(+ manual)` nuance, never a blanket label.

**Production result**: all 25 tickers ingested, **2,921 rows, 0 failures**. Every stock has 7-10 real
reporting periods. The 3 tickers (SQM-B, COPEC, BSANTANDER) carrying stale synthetic `manual_csv` sample rows
from the original Phase 8C CSV templates had those rows deleted.

**Charting fix verified live** (dev server): BSANTANDER (bank, previously zero fundamentals data) now renders
all 3 frequency modes with real numbers — Quarterly shows 9 correctly-sorted periods (`qIdx`/`qShort`/`yearOf`
now parse both `Q# YYYY` and `FY YYYY`), Annual groups into 4 real year bars, TTM is enabled (≥4 quarters) and
renders real rolling-window values, no `—` placeholders.

**Tests:** 18 new (`tests/yahooFundamentals.test.ts` — period derivation, field mapping incl. sign conventions
and missing-field skipping, metrics, source registration/priority, migration, cron route hygiene) + 1 existing
hygiene test corrected (a `/official/` regex false-positive that also matched the honest "unofficial"
disclaimer — fixed with a word boundary + an assertion the disclaimer is present). Full suite 999 → 1017/1017,
lint 0, build 0 errors.

Scope limits (explicit): universal fundamentals coverage only; no new charting features beyond making the
existing toggle work; no paid/vendor API; no changes to CMF/XBRL priority/logic; Structured Notes/auth/
watchlist/portfolio/macro untouched; no UI redesign beyond badge wiring; no mobile work.

Next: **Phase 8D** (FX/rates + economic calendar) — or continue CMF/XBRL issuer expansion (promote the 3
eligible_verified, add the 2 extra XBRL dialects) now that Yahoo backstops every stock regardless.

---

**Phase 8C.4 — Full CMF/XBRL Coverage Discovery Sweep + Controlled Issuer Enablement + Bank Registry Track** ✓ COMPLETE (2026-07-08)

Runs a full discovery sweep over the entire 25-stock app universe, expands enabled CMF/XBRL coverage from 5 to
**15 issuers**, gives every stock an explicit coverage classification, and confirms the separate bank track.
No new migration, no new dependency, no concept-map change.

**Discovery sweep:** matched all 25 app legal names against CMF's own official RVEMI `sociedad[]` directory
(483 entries). 19 exact-matched; FALABELLA/MALLPLAZA matched on razón social (legal-name-form difference,
cross-checked against the entidad.php razón social); all 4 banks matched **nothing** under any registry group
(`rg_rf=RVEMI/RGEIN/RGB/RB/BANC` all return the identical securities list — zero banks). Each non-bank
candidate then had its full entidad.php → XBRL ZIP → parse chain exercised live (FY2025). Reproducible via
`npm run discover:cmf-coverage` (+ `--live`) and the pure classifier `src/lib/financials/cmfCoverage.ts`.

**Enabled batch (+10, now 15 total):** LAS-CONDES (93930000), CAP (91297000), ENELAM (94271000), COLBUN
(96505760), AGUAS-A (61808000), RIPLEY (99579730), PARAUCO (94627000), ENTEL (92580000), CCU (90413000), LTM
(89862200) — each RUT-verified against CMF's directory + a clean live FY2025 dry-run. Currency read per fact
(USD: CAP/ENELAM/COLBUN/LTM; CLP: the rest). **Production write: 15 enabled issuers, 422 rows, 0 failures, all
`valid_with_warnings`.**

**Deferred (+3 `eligible_verified`):** CONCHATORO (exact match, deferred to keep the batch at 10), FALABELLA
("FALABELLA S.A." vs app "S.A.C.I. Falabella"), MALLPLAZA ("PLAZA S.A." vs trading name "Mall Plaza") — all
verified + dry-run clean, deferred one batch for conservatism.

**Critical safety change:** the default ingestion set is now `getEnabledTickers()` (15), NOT
`getMappedTickers()` (18). `eligible_verified` issuers are **never** written by a default/cron run — only
reachable via an explicit `?ticker=`/`--ticker` dry-run. This means adding a verified-but-deferred issuer to
the map can never trigger an unintended production write. Enforced by tests.

**Coverage funnel (all 25 stocks):** 15 `enabled` · 3 `eligible_verified` · 3 `unsupported_page_shape` · 4
`bank_track_required`. Exposed via `/api/financials/cmf-xbrl/status` (`coverageFunnel`, `eligibleVerifiedIssuers`).

**`unsupported_page_shape` (3):** SONDA, ANDINA-B, VAPORES download a **real** XBRL instance, but in a dialect
the current `xbrli:`-prefixed regex parser can't extract (SONDA: default/unprefixed XBRL namespace;
ANDINA-B/VAPORES: "CTI Service" ISO-8859-1 generator) → 0 facts. The RUTs are directory-verified; the filing
exists — only parser dialect support is missing, deferred to a future phase. Not a coverage gap, not enabled.

**Bank track (`bank_track_required`, 4):** BSANTANDER, CHILE, BCI, ITAUCL are confirmed **absent** from the
securities-issuer XBRL directory under every registry group. Banks report under CMF's separate "Bancos e
Instituciones Financieras" track with a **bank-specific taxonomy** (net interest income, loan-loss provisions —
not revenue/EBITDA/gross profit) that **must never be forced into the industrial concept map**. No programmatic
bank-XBRL path was verified this phase → `bank_track_required` (not `bank_track_discovered`). Bank RUTs are not
guessed. A bank-specific ingestion track (its own concept map + fields) is deferred future work.

**No concept-map change:** all 13 verified candidates validated cleanly against the existing ~31-concept map;
adding mappings without a concrete gap would violate the evidence-only rule.

**New/changed files:** `src/lib/financials/cmfCoverage.ts` (new — pure coverage classifier + funnel);
`src/lib/financials/cmfIssuerMap.ts` (10 enabled + 3 eligible entries, `coverageStatus`/`registryGroup` fields,
`getEnabledTickers`/`getEligibleVerifiedTickers`/`isCmfIssuerEnabled`, 4 banks + 3 unsupported documented);
`scripts/discover/cmfCoverageSweep.ts` (new sweep CLI, `npm run discover:cmf-coverage`);
`runCmfXbrlIngestion.ts` + cron route (default to enabled-only); status route (`coverageFunnel`);
`tests/financialsCmfXbrl.test.ts` (53→65). Full suite 999/999, lint 0, build 0 errors.

**Cron remains unscheduled** — 15 issuers is broader but still an undocumented HTML surface.

Scope limits (explicit): CMF/XBRL coverage discovery + controlled non-bank enablement only; annual filings
only; no interim/YTD; no new cron schedule; no paid/vendor APIs; no Bloomberg; no CAPTCHA bypass; no Hechos
Esenciales scraping; no News/FX/rates/calendar; Structured Notes/auth/watchlist/portfolio/macro untouched; no
UI redesign; no new dependency; no bank production ingestion (path + mapping deferred).

Next: promote the 3 `eligible_verified` issuers; add parser support for the 2 extra XBRL dialects (SONDA
default-namespace; CTI Service ISO-8859-1); build a bank-specific CMF/XBRL track; or **Phase 8D** (FX/rates +
economic calendar) / **Phase 9F** (Santander + older-2024-Citi parser).

---

**Phase 8C.3 — CMF/XBRL Issuer Coverage Expansion** ✓ COMPLETE (2026-07-08)

Expands CMF/XBRL issuer coverage from 2 to 5 issuers using a conservative, verified, issuer-by-issuer
process — no changes to the 8C.2 pipeline architecture itself.

**Enabled:** ENELCHILE (RUT `76536353`), CMPC (RUT `90222000`), CENCOSUD (RUT `93834000`) — joining SQM-B and
COPEC (5 total). **Skipped, documented not guessed:** BSANTANDER and CHILE (Banco de Chile) — confirmed
absent from both CMF registry groups (`RVEMI`, `RGEIN`) this discovery tool exposes; banks are supervised
under a separate CMF track this public XBRL search surface does not cover.

**Verification method** (`src/lib/financials/cmfIssuerMap.ts`): CMF's own official issuer directory — a
`sociedad[]` multi-select dropdown embedded in its public XBRL search form (`sa_eeff_ifrs_index.php`) — lists
every registered entity as `"<RUT with check digit> <LEGAL NAME>"`. This is CMF's own authoritative
RUT↔legal-name source, stronger evidence than the search-engine snippet that produced a wrong RUT in Phase
8C.1. CMPC and CENCOSUD each required disambiguation from a similarly-named but distinct directory entry
(e.g. "Inversiones CMPC S.A." vs. the correct "Empresas CMPC S.A."). Every mapped entry carries
`verificationStatus: 'verified'` and a `verificationMethod` note; `UNMAPPED_TICKERS` documents BSANTANDER/
CHILE with the registry-group evidence — **never guess a RUT**.

**Real-world finding — currency changed between fiscal years for the same issuer:** ENELCHILE filed FY2024 in
CLP but FY2025 entirely in USD. Verified as genuine (all 22 mapped FY2025 facts consistently `USD`; the XBRL
`entityIdentifier` context confirmed ENELCHILE's own RUT in both filings, ruling out an entidad.php mismatch)
— not a bug. Confirms the currency-per-fact-never-assumed policy must hold even across a single issuer's own
filing history, not just across issuers.

**Concept map extended** (~24 → ~31 `ifrs-full` concepts, `src/lib/financials/xbrl/conceptMap.ts`): added
`total_debt` / `long_term_debt` / `short_term_debt` — but only after verifying the additive identity
`LongtermBorrowings + CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings == Borrowings` held exactly in
real CMPC/CENCOSUD filings — plus `shares_outstanding` and higher-confidence real-world capex/dividend
concept variants observed in the new filings. Concepts that FAILED cross-year/cross-issuer consistency
checks were deliberately left unmapped with the numeric evidence documented in `KNOWN_UNMAPPED_CONCEPTS`:
`NetDebt` (≈4.5× gross `Borrowings` in a real CMPC filing — a genuinely different metric, not gross debt),
`ShorttermBorrowings` (present in a prior-year context but entirely absent from the current-year context in a
real filing), `CurrentPortionOfLongtermBorrowings` (diverged from `CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings`
in a real filing: 90,357,000 vs. 392,601,000 for the same period).

**Status endpoint rewritten** (`GET /api/financials/cmf-xbrl/status`): now reports `enabledIssuers` (ticker,
legal name, verification status/date, coverage counts) and `notConfiguredIssuers` (ticker + documented
reason) explicitly, alongside the prior `coverage`/`mappedIssuers`/`unmappedIssuers` shape kept for backward
compatibility.

**No migration, no new dependency, no new env var** — the same source-agnostic schema, `metadata` jsonb
provenance columns, and `source_priority`-based supersession from 8C.2 handle the 3 new issuers with zero
code changes to the provider/orchestrator/repository.

**Production validation:** real writes for ENELCHILE (26 rows, USD), CMPC (31 rows, USD), CENCOSUD (31 rows,
CLP) — all `sourceType: xbrl`, `valid_with_warnings`. Charting badge verified live in-browser for CMPC (real
revenue value, EBITDA correctly `—` where not filed). Pre-existing SQM-B/COPEC mapped-field counts also grew
(23→29 and 23/24→24 respectively) purely from the concept-map expansion — no re-ingestion of those two
issuers' already-persisted rows was required for this to take effect on the next real run.

**Tests:** `tests/financialsCmfXbrl.test.ts` grew from 41 to 53 — new concept-map verification tests (debt
trio, shares outstanding, capex/dividend variants, NetDebt/ShorttermBorrowings/CurrentPortionOfLongtermBorrowings
exclusions) and issuer-map coverage tests (exactly 5 mapped tickers with correct RUTs, BSANTANDER/CHILE
unmapped with registry-referencing reasons, a never-guesses regression check). Build 0 errors, lint 0, tests
987/987.

**Cron remains unscheduled** — issuer coverage is still narrow (5 issuers), not yet a stable basis for an
unattended Vercel cron run against CMF's undocumented HTML surface. Ingestion stays manually-triggered and
reviewable (`GET /api/cron/financials/cmf-xbrl`, Bearer `CRON_SECRET`).

**Structured Notes / CMF-XBRL module rules — reaffirmed and extended:**
- **Never guess a RUT or legal entity** — only issuers verified against CMF's own official `sociedad[]`
  issuer directory (or a direct cmfchile.cl URL, the 8C.1/8C.2 precedent) are enabled.
- **A candidate concept mapping must be empirically verified** (additive identity, cross-year/cross-issuer
  consistency) before being trusted — a plausible-sounding concept name is not sufficient evidence.
- **Currency is always read per-fact, never assumed** — even for the *same issuer* across fiscal years.
- **Banks sit under a separate CMF registry track** this public XBRL discovery tool does not expose — do not
  keep re-attempting BSANTANDER/CHILE without a new discovery method; document the gap instead.
- **CMF ingestion is still not on a schedule** — manual/reviewable runs only, and will stay that way until
  issuer coverage and surface stability justify otherwise.

Scope limits (explicit): CMF/XBRL issuer coverage expansion only; annual filings only; no interim/YTD
ingestion or charting support; no new cron schedule; no paid/vendor APIs; no Bloomberg; no CAPTCHA bypass; no
Hechos Esenciales scraping; no News/FX/rates/calendar work; no Structured Notes/auth/watchlist/portfolio/
macro/market changes; no mobile work; no new dependency.

Next: continue CMF/XBRL issuer expansion (per-issuer RUT verification against CMF's official directory); or
**Phase 8D** (FX/rates + economic calendar live source completion); or **Phase 9F** (Santander / older-2024-Citi
structured-notes parser expansion).

---

**Phase 8C.2 — CMF/XBRL Automated Financials Ingestion (LIVE)** ✓ COMPLETE (2026-07-08)

Automated official **CMF XBRL** financial-statement ingestion for Chile issuers is now working end to end and
is the **preferred** source for mapped issuers (SQM-B, COPEC); manual CSV is now a genuine fallback, no longer
the only populated financials source.

**The blocker removed:** Phase 8C.1 verified the whole CMF chain but stopped at the ZIP download (no zip
dependency). 8C.2 adds a **dependency-free ZIP reader** (`src/lib/financials/xbrl/unzip.ts`) on Node's
built-in `node:zlib` (`inflateRawSync` — ZIP entries are raw DEFLATE). No new package. Verified against the
real COPEC archive.

**Pipeline** (`providers/cmfXbrlProvider.ts` + `cmf/runCmfXbrlIngestion.ts`): entidad.php → parse XBRL href →
download ZIP → unzip (reject taxonomy-only, path-traversal/zip-bomb guards) → parse `.xbrl` → **period-match**
→ normalize → validate → persist via the **same source-agnostic repository upsert manual CSV uses**. `xbrl`
(priority 210) supersedes `manual_csv` (100) automatically.

**Honest period handling** (`xbrl/periodClassify.ts`): a CMF instance carries the current period, prior-year
comparatives, and (interim) both a YTD and a discrete-quarter window. Facts are matched to the CURRENT
period's contexts only (income/cash on the Jan-1→period-end duration; balance on the period-end instant);
comparatives excluded. `period_nature` ∈ `annual`/`quarterly_discrete`/`year_to_date`/`instant`; `period_type`
stays quarterly/annual so supersession still groups an XBRL period with a manual one. **Default ingestion is
annual (December) filings only** — unambiguous; interim is supported but not the default.

**Concept map** (`xbrl/conceptMap.ts`): ~24 standard `ifrs-full` concepts → normalized line items, each tagged
`high`/`medium`/`low`/`review_required`. EBITDA is never fabricated (stays a derived metric). Ambiguous
note-only concepts (AccountingProfit, related-party revenue) are documented as deliberately unmapped.

**Validation** (`xbrl/validateFinancials.ts`): balance-sheet identity (assets ≈ liab+equity, 1% tol.), period
chronology, non-finite, currency/unit presence, YTD-derived, unmapped — status
valid/valid_with_warnings/review_required/invalid. The orchestrator refuses to write an `invalid` filing.

**No migration, no new dependency, no new env var.** Honest-period metadata (period_start_date, period_nature,
filing_period_label) + per-fact provenance (source concept, contextRef, unit, decimals, mapping confidence)
reuse the EXISTING `metadata` jsonb columns on `company_reporting_periods`/`financial_statement_items` —
mirroring the 9D/9E "reuse existing metadata jsonb" approach.

**Cron + status:** `GET /api/cron/financials/cmf-xbrl` (Bearer `CRON_SECRET`, service-role admin client,
records an `ingestion_runs` row, sanitized summary) — **NOT on a Vercel cron schedule** (the entidad.php
surface is undocumented HTML; ingestion is manually-triggered and reviewable until stability is observed).
`GET /api/financials/cmf-xbrl/status` — public read-only diagnostics (latest run + per-issuer XBRL coverage +
mapped/unmapped issuers), consistent with the app's other public ingestion-status endpoints.

**UI:** Charting source badge shows "Persisted financials via CMF XBRL" when the ticker's financials are
XBRL-sourced (`resolveFinancials` now reports the dominant `sourceType`; a ticker with both surfaces the
authoritative XBRL label).

**Honesty guarantees:** currency read per-fact (SQM-B/COPEC file in USD, not CLP — never assumed); missing
concepts stay missing (never zero); taxonomy-only ZIPs rejected as non-filings; no raw XBRL ever returned by a
route or logged; RUTs never guessed (BSANTANDER stays unmapped — banks use a different CMF registry track).

**Live validation** (real data, production Supabase — no staging DB, same as 9D/9E): COPEC FY2025 written (24
rows, USD, valid_with_warnings, balance-sheet identity exact); SQM-B + COPEC FY2025/FY2024 dry-run clean;
**supersession proven live** (synthetic manual_csv FY row correctly demoted by the XBRL row, then cleaned up);
`/api/financials/COPEC/statements` reports `sourceType: xbrl`; cron auth 401 without bearer.

**Tests:** `tests/financialsCmfXbrl.test.ts` (41 new; in-memory ZIP fixtures, no binaries). 975/975 pass, lint
0, build 0 errors. Regression: macro/market/compare/earnings/health all 200, auth gating intact.

**Structured Notes / CMF-XBRL module rules (apply going forward):**
- Automated CMF XBRL is the **preferred** financials source for a mapped issuer; manual CSV is fallback/override.
- **Never guess a RUT** — only issuers verified against a direct cmfchile.cl URL are enabled.
- **No new dependency for zip** — the built-in `node:zlib` reader in `unzip.ts` is the approved path.
- **Taxonomy-only ZIPs are not filings** — reject any archive with no `.xbrl` instance.
- **Currency per-fact, missing = missing (never zero), YTD labeled** — never silently chart a cumulative YTD
  figure as a discrete quarter.
- **CMF ingestion is not on a schedule** — manual/reviewable runs only (undocumented HTML surface).

Scope limits (explicit): CMF/XBRL financials only; 2 issuers mapped; annual default; no CAPTCHA/scraping of
Hechos Esenciales; no News/FX/rates/calendar work; no Structured Notes/auth/watchlist/portfolio/macro/market
changes; no mobile work; no vercel.json cron schedule added.

Next: expand the verified issuer map (per-issuer RUT verification); revisit interim-filing ingestion with clear
YTD handling; or **Phase 8D** (FX/rates + economic calendar live source completion).

---

**Phase 9E — Structured Notes: free market-data architecture + observation QA** ✓ COMPLETE (2026-07-07)

Hardens Structured Notes monitoring's market-data layer with a provider abstraction, a fallback/sanity-check
orchestrator, and structured quote-quality rules — without adding any paid/vendor dependency. Not about
replacing Yahoo; about building the best free, resilient architecture.

**Free-provider discovery** (`docs/structured_notes_market_data_sources.md`): Stooq investigated and rejected
— its CSV endpoints now serve a client-side SHA-256 proof-of-work challenge (confirmed live via curl), not a
stable API, consistent with the standing no-scraping policy. Keyed free tiers (Alpha Vantage/IEX/Polygon/
Twelve Data) rejected — a new secret for no clear benefit over Yahoo. Official exchange delayed-quote pages
rejected — JS-rendered, no public endpoint. **Yahoo Finance remains the only viable free provider.**

**Provider abstraction** (`src/lib/structuredNotes/marketData/providers/types.ts`): a
`StructuredNoteMarketDataProvider` interface any provider implements. `sourceType` is
`free_monitoring_estimate | proxy | unsupported` — **deliberately no `official` value**, a structural guard
against ever mislabeling free data. Yahoo refactored into `yahooStructuredNoteProvider.ts` with zero behavior
change.

**Fallback/sanity-check orchestrator** (`marketData/resolveStructuredNoteQuotes.ts`): queries **every**
registered provider that supports a symbol, not only on failure — a later provider both fills a gap the
primary missed (fallback) and gets cross-checked against the primary's price (sanity-check via
`compareProviderQuotes`) once a second provider exists. A provider that throws is caught per-provider and
never takes the batch down. Runs with exactly one registered provider today (see discovery above).

**Quote-quality rules** (`marketData/quoteQuality.ts`, pure): `classifyQuoteQuality` → `ok`/`warning`/`reject`
per quote. Named threshold constants: stale >3 calendar days (dashboard) / >1 day (a DUE observation), large
daily move >15%, cross-provider disagreement >1%.

**Symbol mapping hardened** (`underlyingSymbolMap.ts`, additive-only): `UnderlyingSymbolEntry` gained
`normalizedCode`, `providerSymbols` (`{ yahoo, stooq: null }`), `currency`, `verifiedAt`, `confidence`,
`sourceType` — while preserving every pre-9E field name (`bloombergTicker`, `yahooSymbol`, `assetClass`,
`displayName`, `verified`, `notes`) that the 6 issuer parsers + `structuredNoteMarketProvider.ts` already read.

**Observation QA** (`monitoring.ts`): `ObservationEvaluation.reviewReasons` is now a typed
`ReviewRequiredReason[]` (`missing_price`, `stale_price`, `unsupported_symbol`, `provider_error`,
`large_price_move_warning`, `provider_disagreement`, `final_observation_requires_official_verification` always
on every final observation, `non_trading_day_or_unavailable_close`, `ambiguous_underlying_mapping`) — the
free-text `reviewReason` is derived from this list. An optional `quoteMeta` param enables the fuller
classification; omitting it preserves exact pre-9E behavior.

**No migration needed** — the price-snapshot/observation/monitoring-run tables already had a `metadata jsonb`
column from earlier phases; provider/quality diagnostics are written into it.

**API additions:** the cron response and `GET /api/structured-notes/monitoring-status` both now include
`providerSummary`, `unsupportedSymbols`, `staleSymbols`, `reviewRequiredObservations`/`reviewRequiredSymbols`,
`fallbackProviderUsed`, `providerDisagreement` — read from the run's `metadata`, safely absent on a pre-9E run.

**UI:** subtle additions only — a provider-label chip ("Yahoo Finance monitoring estimate") and conditional
"Free-source fallback used"/"Provider disagreement" badges on the dashboard's monitoring status line (both
inactive today with one provider registered); no redesign.

**Two real bugs caught by tests before shipping:** (1) the orchestrator didn't catch a provider's `fetchQuotes`
throwing — now caught per-provider, degrades to `provider_error` instead of crashing the batch; (2) the
no-providers-registered path returned an empty quotes array instead of one `unsupported` entry per symbol —
fixed so every symbol always gets a quote object.

**Tests:** 3 new test files + additions to 2 existing — 72 new tests (quote quality, provider abstraction,
orchestrator fallback/disagreement/error-handling against mocked providers, observation-QA reason
classification, symbol-map hardening, route/discovery-doc hygiene). 862 → 934.

**Real cron validation** against the live production Supabase book (no separate staging environment exists):
`status: success`, 5 active notes, 2 symbols, 2/2 succeeded, `providerSummary` populated correctly,
`fallbackProviderUsed`/`providerDisagreement` both correctly `false` with one provider registered.

Build 0 errors (`npx tsc --noEmit` clean) · lint 0 · tests 934/934. Regression-checked: `/api/health/ingestion`
healthy, `/api/macro` and `/api/market/stocks` 200, `/structured-notes` still redirects unauthenticated to
`/login`, no console errors.

Scope limits (explicit): free-data architecture only — no paid/vendor API, no Bloomberg, no API key required,
no claim that any free provider is official, no final/legal payoff determination from free data, no CMF/XBRL
or News/Hechos/FX/calendar work, no parser-behavior change beyond additive symbol-map metadata, auth/
watchlist/portfolio/macro/financials untouched, no mobile work.

Next: extend the parser to Santander/older-2024-Citi templates; revisit free-provider discovery periodically;
add persisted scheduled snapshots for global (non-US) underlyings once a real note requires one — or return
to **Phase 8C.2** (CMF/XBRL automated financials ingestion).

---

**Phase 9D — Structured Notes: scheduled price snapshots + observation automation** ✓ COMPLETE (2026-07-07)

Turns Structured Notes from automated PDF ingestion into **automated monitoring** — a scheduled cron now
persists price snapshots for every active note's underlyings, evaluates due observations (coupon/autocall/
final) against those levels, and applies one conservative automatic status transition. The existing
on-demand "Update" button and live dashboard/detail routes are **unchanged** — scheduled monitoring is
additive, never a replacement of the immediate-refresh path.

**Monitoring policy** (see `docs/structured_notes_design.md` § "Scheduled monitoring"): every level is a
MONITORING ESTIMATE from Yahoo Finance, never an official calculation-agent determination — labeled as such
everywhere it's surfaced. Missing/unsupported prices → `unavailable`, never fabricated. Coupon/autocall
observations transition deterministically once due (the worst-of barrier math is exact); **final/maturity
observations are always flagged `reviewRequired`** — the legal payoff requires manual verification and is
never auto-finalized without an official source. Archived/called notes are never reactivated by scheduled
monitoring (`getActiveStructuredNotesForMonitoring` filters to `active` only; `shouldUpdateNoteStatus`
additionally guards against touching an archived note).

**Migration** `20260709000000_structured_notes_monitoring.sql`: makes
`structured_note_price_snapshots.user_id` nullable (the cron writes via the service-role admin client — no
session exists to populate `default auth.uid()`, consistent with the Phase 9B shared-book model where
`user_id` is already just an upload/audit stamp); adds 11 monitoring-evaluation columns to
`structured_note_observations` (`observed_at`, `observed_source`, `observed_levels`, `coupon_eligible`,
`autocall_eligible`, `final_barrier_breached`, `review_required`, `review_reason`, etc.), distinct from the
extraction-time terms already on that table; creates `structured_note_monitoring_runs` (system-level audit
log mirroring the `structured_note_extraction_runs` precedent — no `user_id`, read-only RLS for any
authenticated user, **no insert/update/delete policy at all** — writes are service-role only).

**Pure calculations** (`src/lib/structuredNotes/monitoring.ts`): `getActiveStructuredNotesForMonitoring`,
`getUniqueUnderlyingSymbols`, `calculateStructuredNoteSnapshot`, `detectStalePrice`,
`classifyStructuredNoteRisk` (reuses the Phase 9B severity model so the cron and the on-demand dashboard
never disagree), `evaluateCouponObservation`/`evaluateAutocallObservation`/`evaluateFinalObservation`,
`evaluateObservation` (dispatch + due-date gating — an observation only evaluates once, when its valuation
date is due and it's still `scheduled`), `shouldUpdateNoteStatus` (the **one** conservative automatic
transition this module makes: autocall-eligible + clean/complete data → note `autocalled`),
`deriveObservationStatus`, `calculateDashboardAggregates`.

**Market provider** (`structuredNoteMonitoringProvider.ts`): wraps the existing batched Yahoo call
(`fetchYahooPriceMap`) with per-symbol success/failure accounting, so one bad symbol never blocks the rest
of the book — the cron correctly reports `partial_success` rather than an all-or-nothing pass/fail. No
Bloomberg, no paid vendor feed — same as the rest of the module.

**Cron route** `GET /api/cron/structured-notes/snapshot` — Bearer `CRON_SECRET` (same pattern as
`/api/cron/ingest-bcch-macro` and `/api/cron/check-ingestion-health`; no new env var), service-role admin
client (the one intentional service-role use in this module, justified by there being no authenticated
session for a scheduled job). Vercel schedule `30 21 * * 1-5` (weekdays, 21:30 UTC) — fixed safely after the
US market's 4:00pm ET close across both the EDT (→4:30pm ET) and EST (→5:30pm ET) halves of the year, since
Vercel Cron has no timezone parameter. **Read endpoint** `GET /api/structured-notes/monitoring-status` —
authenticated, user-session client, latest run + stale/unsupported/due-soon/review-required counts.

**UI** (no layout redesign): dashboard shows the last monitoring run timestamp/status + stale/unsupported/
due-soon/review-required counts + a monitoring-estimate disclaimer line; detail page's current-levels table
gains a "last monitored" column (with a staleness warning icon), and the observation-schedule table gains
Coupon/Autocall eligibility columns plus a `title` tooltip surfacing the review-required reason.

**Real-data validation** (ran against the live production Supabase book — the only environment available,
no separate staging DB): 5 active notes, 2 unique underlying symbols (SPX/RTY shared across the whole
current book). First run persisted 10 price-snapshot rows and correctly evaluated 5 already-due Barclays
coupon observations (valuation dates 2025-07-07 through 2026-07-06, all in the past relative to the
validation date) as `coupon_paid` — both underlyings were genuinely well above their 65% coupon barrier at
current market levels, so this is accurate real history, not test pollution. A second run confirmed
idempotent upsert behavior: still exactly 10 snapshot rows (refreshed in place), and 0 observations
re-evaluated (they were no longer `scheduled`, correctly skipped by the due-date/status gate).

**Tests:** 2 new test files, 55 new tests — `tests/structuredNotesMonitoring.test.ts` (pure calculations:
worst-of strict eligibility, no NaN/Infinity, stale-price detection, archived-note non-reactivation,
conservative status transitions, dashboard aggregates) and `tests/structuredNotesMonitoringRoutes.test.ts`
(cron auth, no-secret-leakage, RLS/migration structure, Vercel cron config, macro/health cron regression).
862 tests total (807 → 862). Build 59 routes · lint 0.

Scope limits (explicit): scheduled monitoring only — no CMF/XBRL work, no News/Hechos/FX/calendar work, no
mobile work, auth/watchlist/portfolio/macro/market/financials untouched except by reusing the existing
market-provider utilities. No official calculation-agent feed, no paid/vendor data, no Bloomberg dependency.
Global (non-US) underlyings and a more robust/official market-data source remain future work.

**Apply FIVE migrations** in order: `20260706000000_*` (9A) → `20260706120000_*` (9B shared book) →
`20260707000000_*` (9B.1 allocation upsert) → `20260708000000_*` (9B.2 archived_at) → `20260709000000_*`
(9D monitoring).

---

**Phase 9C — Structured Notes: multi-issuer parser expansion** ✓ COMPLETE (2026-07-07)

Extended the deterministic PDF parser from 2 issuer families (Citi/HSBC, Phase 9B) to 6, adding **Crédit
Agricole, BNP Paribas, Barclays, and BBVA** as dedicated parser modules behind a new issuer-detection router.
Automation-first per the standing product requirement — this expands *deterministic extraction coverage*,
not a manual-entry screen; manual entry remains the fallback it always was.

**Router architecture** (`src/lib/structuredNotes/pdf/parsers/`): `types.ts` (shared contracts —
`IssuerParseContext`, `IssuerParser`, `DetectedIssuer`, `ReviewState`), `shared.ts` (pure utilities reused by
every parser: ordinal-date stripping, wrap-tolerant label lookup for labels that split mid-phrase across
physical lines in real PDFs, mixed Bloomberg/Refinitiv ticker-cell parsing, barrier-role classification,
`classifyReviewState`, `dedupeObservationsByDate`), `citiHsbcParser.ts` (the Phase 9B generic logic relocated
verbatim — unchanged behavior, and also the router's safe fallback for any undetected issuer),
`creditAgricoleParser.ts` / `bnpParibasParser.ts` / `barclaysParser.ts` / `bbvaParser.ts` (one module per new
issuer), and `index.ts` (`detectIssuer()` — keyword-based, never guesses between two issuers — + dispatch).
`extractStructuredNoteTerms.ts` is now a thin entry point over this router; its public API
(`extractStructuredNoteTerms`, `PARSER_VERSION`, `parseTermSheetDate`, `dedupeObservationsByDate`) is
unchanged so no call site needed to change.

**Confidence/review-state model** (`classifyReviewState` in `shared.ts`): `ready` (≥0.90 confidence, zero
low-confidence fields) / `review_recommended` (≥0.70) / `review_required` (any critical field missing, or
<0.70) / `unsupported` (issuer unidentifiable). A missing critical field always forces review regardless of
the numeric score — confidence can never promote an incomplete extraction to "ready". Surfaced via a new
`reviewState` field on `POST /api/structured-notes/extract` (the DB audit row's `parserVersion` now also
reflects the specific issuer parser that ran, not a single static constant) and a 4-color badge on the
upload/review UI (`t.sn.reviewState.{ready,review_recommended,review_required,unsupported}`, EN+ES).

**Real-document validation:** all 4 new issuers extract at **confidence 1.0** against their real term sheets
(Crédit Agricole `XS3306812929`, BNP Paribas `XS2999188746`, Barclays `XS2998054097`). BBVA (`XS2958604485`)
extracts every field cleanly but is **always** forced to `review_required` because the one real sample
available is itself an explicit draft ("DRAFT FOR DISCUSSION PURPOSES ... Subject to completion") — the
parser treats that as a hard gate, never an optimistic pass-through, and flags the ISIN found in a boilerplate
clause as unverified rather than trusting it at face value. Citi and HSBC continue extracting unchanged at
confidence 1.0 through the same router (regression-proof — `9B.multi.1` parserVersion unchanged).

**Real-world parsing hazards handled** (see `docs/structured_notes_design.md` and
`docs/structured_notes_workbook_mapping.md` §7 for full per-issuer detail): BNP's ordinal dates
(`April 09th, 2025`, handled generically by `parseTermSheetDate`'s ordinal-suffix stripping) and mid-phrase
label wrapping (e.g. "Redemption Valuation" / "Date October 09th, 2026" split across physical lines — handled
via wrap-tolerant `extractAfterLabel`/`labelDateJoined` helpers); Barclays' mixed Bloomberg/Refinitiv ticker
cells (`parseMixedTickerCell`, Bloomberg always the source of truth for pricing) and mid-decimal-split price
levels in its narrow cover-table layout (`reconstructSplitDecimals` — only fires when the digit fragment is
entirely alone on its own line, to avoid misjoining an unrelated row-index digit); Crédit Agricole's
positionally-matched (not name-matched) barrier table and non-assumed knock-in equivalence (only promoted to
`high` confidence when the payoff wording explicitly confirms the same percentage); BBVA's clause-based (not
table-based) extraction with two barrier clauses disambiguated purely by wording order ("equal to or greater
than" vs "greater than or equal to").

**Fixtures:** four new small, sanitized, fictional-value text fixtures
(`tests/fixtures/structured-notes/{creditagricole,bnp,barclays,bbva}_sample_terms.txt`) reproducing each
issuer's real field structure — no real PDFs or full extracted text committed, matching the existing
Citi/HSBC fixture policy. **Tests:** 5 new test files (one per issuer parser + a router test covering issuer
detection, safe fallback, unsupported-format handling, and Citi/HSBC regression) — 807 tests total (745→807).

Scope limits (explicit): parser expansion only — no dashboard redesign, no scheduled monitoring, no
price-snapshot cron, auth/watchlist/portfolio/macro/market/financials untouched, no mobile work, no CMF/XBRL
work this phase. Santander and older-2024 Citi templates remain unimplemented (flag for review, never
mis-parsed) — the next parser targets if pursued. No new migration, no new routes, no new env vars.

Build 56 routes · lint 0 · tests 807/807.

---

**Phase 9B.2 — Structured Notes: dashboard UX refinements from real use** ✓ COMPLETE (2026-07-07)

Eight small UX fixes requested after using the shared dashboard for real: (1) **allocation-by-entity inputs**
now auto-format with thousand separators while typing (`formatWithThousands`/`parseFormattedNumber` in the
detail page); (2) the dashboard table, current-levels/distance-to-barrier, underlyings, and observation-schedule
tables are all **center-aligned**; (3) the **"Live positions" KPI is now clickable** (same pattern as the
existing "Called" KPI) and jumps straight to the Live view with no status filter; (4) archived notes show an
**"Archived as of"** column (swapped in for "Next obs.", which isn't meaningful once called) sourced from a
new `archived_at` timestamp — migration `20260708000000_structured_notes_archived_at.sql` adds the column;
the repository stamps it when `status` transitions into an `ARCHIVED_STATUSES` value and clears it if reversed;
(5) the dashboard table is **sortable** by Issuer / Issued / Status / Next obs. (click column header, arrow
indicator), **defaulting to Issued newest-first**; Status sorts by severity (breached → autocallable → watch →
safe → unavailable) via `STATUS_RANK`, not alphabetically; (6) every risk-status KPI (Safe/Watch/Autocallable/
Breached) got a `title` tooltip explaining the state in plain English, plus a one-line legend caption under the
KPI row — clicking a KPI filters the table to just that status (`focusStatus()`), giving an at-a-glance way to
find which specific note(s) are near a barrier/autocall/breach without a heavier modal; (7) added **Status**
and **Issuer** filter dropdowns to the toolbar, composable with the KPI-click shortcut; (8) **delete now asks
for confirmation** (`window.confirm`) before removing a note. Tests 745 (+3 archived_at hygiene checks). Build
56 routes · lint 0.

**Apply FOUR migrations** in order: `20260706000000_*` (9A) → `20260706120000_*` (9B shared book) →
`20260707000000_*` (9B.1 allocation upsert) → `20260708000000_*` (9B.2 archived_at).

---

**Phase 9B — Structured Notes: multi-issuer extraction + shared book dashboard** ✓ COMPLETE (2026-07-06)

Follow-up to 9A addressing two user requirements: (1) the tab must be a **shared book-level dashboard** (all
authenticated users see the same positions — how many are live, in/out of the money, about to autocall, total
exposure — like the legacy workbook); (2) extraction must work beyond the single Citi sample.

- **Parser generalized to multiple issuer templates** (`extractStructuredNoteTerms.ts`, `PARSER_VERSION 9B.multi.1`):
  multi-format dates (`Month DD, YYYY` · `DD Mon YYYY` · `DD/MM/YYYY` day-first), label aliases
  (Issue Size|Principal Amount, Currency|Settlement Currency, Trade|Strike Date, Maturity|Due), flexible
  underlying rows (2–5 trailing levels; inline bare ticker like `SPX`/`RTY` **or** preceding `XXX Index`),
  barrier aliases (Knock-In|Barrier Level, Coupon|Coupon Barrier Level, Autocall|Autocall Barrier Level),
  coupon `X% per quarter` **or** `j × X%`, and a **combined EU schedule table** (HSBC) in addition to the
  Citi two-block schedule. **Validated over the real book: 27/45 term sheets extract at confidence 1.0 —
  every recent Citi + HSBC (the active June-2026 book), incl. the user's HSBC `XS3376583269`.** Barclays/BNP/
  Santander/Crédit Agricole/BBVA/older-2024-Citi use distinct appendix/single-underlying layouts and still
  **flag for review with honest per-field gaps** (never mis-parsed) — they are the next parser targets.
- **Shared book** (migration `20260706120000_structured_notes_shared_book.sql`): RLS changed from per-user
  (`auth.uid()=user_id`) to **any authenticated user** (`auth.uid() is not null`); ownership-guard triggers
  dropped; ISIN made globally unique. `user_id` stays only as an upload/audit stamp. Public/anon still blocked.
- **Dashboard** (`src/lib/structuredNotes/dashboard.ts`, pure): `GET /api/structured-notes` now returns
  per-note live metrics (risk status safe/watch/breached/autocallable/unavailable, worst performer, distance
  to barrier, current notional, next observation) + a book summary (live/ITM/near-barrier/autocallable counts,
  total notional, issuer exposure) from ONE batched Yahoo call (`fetchYahooPriceMap`). The list page is now a
  dashboard: KPI cards + a live status/worst/distance/notional column per position. Missing prices →
  `unavailable`, never fabricated.
- **Tests:** 86 structured-notes tests (added HSBC EU-template extraction against a sanitized fixture,
  multi-format date parsing, dashboard aggregation, shared-migration RLS checks). Build 56 routes · lint 0 ·
  tests 738.

**9B.1 UI/data edits** (from real use): (1) a **Called** checkbox per row sets status `autocalled` and moves
the note to an **Archived** view (Live/Archived toggle + a clickable "Called" KPI); (2) the observation
schedule now stores **one row per valuation date** (coupon + autocall coincide — no double count;
`dedupeObservationsByDate` collapses legacy rows for already-imported notes); (3) the **Next obs.** cell turns
red when ≤7 days away; (4) **Allocation by entity** is a fixed grid of the 9 sociedades (Watermill, Dubai,
Staten, La Esperanza, Naidelt, Los Sauzales, Retboy, Los Laureles, Vanglor) each with an editable USD notional
(upsert by `(note_id, entity_name)`, 0 clears) + add/remove custom entity — migration
`20260707000000_structured_notes_allocation_upsert.sql`; (5) dashboard shows an **issuer bar chart** + an
**entity donut** (notional + % of total, no chart library — inline SVG); (6) an **Update** button re-pulls live
prices; (7) an **Issued** date column. Tests 742.

**Apply THREE migrations** in order: `20260706000000_*` (9A) → `20260706120000_*` (9B shared book) →
`20260707000000_*` (9B.1 allocation upsert).

Next: **Phase 9C** — extend the parser to Barclays/BNP/Santander/CA/BBVA appendix templates; scheduled
price-snapshot persistence + observation-event automation; per-role permissioning for add/remove entity.

---

**Phase 9A — Structured Notes Foundation + Excel Workbook Audit + PDF Extraction MVP** ✓ COMPLETE (2026-07-06)

New **Structured Notes** module (`/structured-notes`, ES **Notas Estructuradas**) — an authenticated,
user-scoped, **automation-first** replacement for the legacy `NUEVA BASE - Notas Estructuradas.xlsx` operating
model. Primary workflow: upload term-sheet PDF → deterministic auto-extraction → review → import → auto-fetch
live underlying levels (Yahoo, replacing the workbook's Bloomberg `BDP`) → auto-compute barriers / distance to
barrier / worst-of risk status / current notional / issuer exposure. Manual entry is a fallback, never the
terminal design.

**Workbook audit** (`docs/structured_notes_workbook_mapping.md`): single sheet "Notas", notes as columns,
labels in column B. Classified every field as PDF-extracted / internal / derived / market-data. **The only
live-data mechanism in the workbook is Bloomberg `=+_xll.BDP(ticker,"LAST PRICE")`** — replaced by Yahoo in
the app. Internal allocations (WATERMILL, DUBAI, STATEN, …) are **never** extracted from a PDF.

**PDF extraction MVP** (`src/lib/structuredNotes/pdf/`): `unpdf` (serverless pdf.js) extracts text; a
deterministic regex/keyword parser (`extractStructuredNoteTerms.ts`, **no OCR, no AI**) targets the **Citi
CGMFL "Memory Coupon Barrier Autocall"** family. Validated end-to-end against the real sample
(`XS3180975347`): confidence 1.0, all fields correct — ISIN, issuer (Citi), trade/issue/final/maturity dates,
coupon 2.5375%/q · 10.15% p.a., barriers 65/65/100%, both underlyings (RTY→^RUT, SPX→^GSPC) with all levels,
and 7 coupon + 7 autocall + 1 final observations. Per-field confidence + provenance; critical-field validation
rejects/flags incomplete extractions (never persisted).

**Schema** (migration `20260706000000_structured_notes_foundation.sql`, 7 tables, user-scoped RLS
`auth.uid()=user_id`, ownership-guard trigger on child tables): `structured_notes`, `structured_note_underlyings`,
`structured_note_observations`, `structured_note_allocations`, `structured_note_price_snapshots`,
`structured_note_extraction_runs`, `structured_note_extracted_fields`.

**Calculations** (`src/lib/structuredNotes/calculations.ts`, pure, NaN/Infinity-guarded, workbook parity):
barrier level = strike×pct; Caída = barrier/current−1; worst-of coupon/autocall eligibility; current notional
(0 if called); issuer/entity exposure (SUMIF parity). Missing market data → `unavailable`, never fabricated.

**API** (auth-only, middleware-protected): `POST /api/structured-notes/extract` (PDF→preview, records an
extraction-run, never echoes the raw PDF), `POST /api/structured-notes/import` (server-revalidates critical
fields), `GET /api/structured-notes`, `GET|PATCH|DELETE /api/structured-notes/[id]` (detail returns live
prices + computed risk metrics), `POST|DELETE .../[id]/allocations[/allocationId]` (internal allocations).

**UI:** `/structured-notes` (upload → confidence-scored review → import → notes table) + `/structured-notes/[id]`
(general terms · underlyings · schedule · internal allocations · live levels & distance to barrier ·
source/provenance). Full EN/ES i18n (`sn.*`), semantic tokens, dark-mode safe. Nav item + `notes` sidebar icon.

**Dependency added:** `unpdf` (serverless-friendly pdf.js text extraction; no native deps).

**Tests:** `tests/structuredNotes{Calculations,PdfExtraction,WorkbookMapping}.test.ts` — 69 tests (workbook-parity
math, NaN guards, worst-of logic, Citi-sample extraction against a **sanitized text fixture**, symbol map,
migration/RLS structure, no-Bloomberg-call guard, security, and a check that **no private PDF/xlsx is committed**).
Build 54 routes · lint 0 · tests 652 → 721.

**Structured Notes module rules (apply going forward):**
- Automation-first: PDF extraction is the primary write path; manual entry/edit is a fallback only — never
  frame this module as manual data entry.
- **Never extract internal allocations (sociedades) from a PDF.** They are internal portfolio data.
- **No Bloomberg in the app** — live levels come from the Yahoo provider; unmapped/unverified underlyings
  report `unavailable`, never a fabricated price.
- **No OCR, no AI extraction** in this phase — deterministic parsing only; scanned PDFs are rejected.
- **Never commit the real workbook or private term-sheet PDFs.** Only the tiny sanitized text fixture
  (`tests/fixtures/structured-notes/citi_sample_terms.txt`) belongs in the repo.
- All structured-note tables are user-scoped (RLS `auth.uid()=user_id`); never use the service-role client for them.

Scope limits (explicit): only the Citi CGMFL family is validated for extraction; no scheduled observation-event
automation; price snapshots are compute-on-request (not yet persisted on a schedule); macro/market/auth/
watchlist/portfolio/financials logic untouched; no mobile work.

Next: **Phase 9B** (parser generalization to more issuers/families + scheduled monitoring), or return to
**Phase 8C.2** (CMF/XBRL automated financials ingestion).

---

**Phase 8C.1 — Automated Financials Provider Discovery + CMF/XBRL Proof of Concept** ✓ COMPLETE (2026-07-03)

Determines whether official CMF financial-statement/XBRL filings can be programmatically accessed without
CAPTCHA or brittle scraping, and builds the first real automated-provider scaffolding on top of the Phase 8C
automation-ready schema. Verdict: **`feasible_with_mapping`** — real, official XBRL instance documents (not
just blank taxonomy schemas) were downloaded successfully during discovery with no CAPTCHA and no login, via
a two-step public HTTP chain, for two real companies (Ripley Chile and **Empresas Copec — a ticker this app
covers**). This is genuinely more promising than Hechos Esenciales (confirmed CAPTCHA-blocked), but it is
still an unofficial, undocumented HTML surface — not a published/versioned API — so this phase treats it
cautiously: a working provider was built, but no unattended/scheduled ingestion was enabled.

**Discovery** (`docs/cmf_xbrl_provider_discovery.md`): verified that CMF's taxonomy download pages
(`/portal/principal/613/w3-article-*.html`) only provide blank schema ZIPs — proving nothing about actual
filing access. Separately, CMF's entity filing page (`entidad.php?rut=&mm=&aa=&tipo=C&tipo_norma=IFRS...`)
was found to resolve deterministically from `rut+mm+aa` alone (no session/search-form token required — the
`row`/`auth`/`send` params can be left blank), and its HTML embeds a relative link to a real XBRL ZIP download
(`.../inc/inf_financiera/ifrs/safec_ifrs_verarchivo.php?auth=...&send=...`, tokens freshly generated per page
load, not guessable in advance). Verified end-to-end for RUT `99530250` (Ripley, 3 periods) and RUT `90690000`
(Empresas Copec, confirmed genuine ZIP with real `ifrs-full` IFRS facts). Found a real-world nuance while
inspecting Copec's filing: it reports entirely in **USD**, not CLP — confirms currency must always be read
per-fact from the XBRL unit block, never assumed.

**Issuer mapping** (`src/lib/financials/cmfIssuerMap.ts`): only RUTs confirmed against a direct cmfchile.cl
URL are mapped — SQM-B (`93007000`) and COPEC (`90690000`), both verified. BSANTANDER stays **unmapped**: a
search-engine snippet suggested RUT `97036000`, but querying it directly returned "Sin información" —
confirmed wrong. Per the never-guess-a-RUT policy, BSANTANDER is documented as unmapped with the reason, not
guessed.

**Provider abstraction** (`src/lib/financials/providers/types.ts`): a `FinancialsProvider` interface
(`discoverFilings`/`fetchFiling`/`parseFiling`/`normalizeToFinancialImportPayload`/`dryRunImport`/
`writeImport`) so manual CSV (Phase 8C) and CMF/XBRL (this phase) — and any future vendor/broker/document
pipeline — all normalize to the exact same `FinancialImportPayload` shape and call the exact same
`financialsRepository.ts` upsert functions. No provider-specific tables, no duplicated repository logic.

**CMF/XBRL provider** (`src/lib/financials/providers/cmfXbrlProvider.ts`): implements the verified two-step
fetch chain for mapped issuers only; returns a structured `blocked` result (`issuer_not_mapped`) for any
unmapped ticker rather than guessing. Honestly reports `not_implemented` at the unzip step — a real ZIP
download was proven to work, but this phase did not add a zip-extraction dependency, so `parseFiling`/
`normalizeToFinancialImportPayload` operate on an already-extracted `.xbrl` instance string (ready for the
next phase to wire the unzip step in).

**XBRL parser** (`src/lib/financials/xbrl/parseXbrl.ts`): minimal, dependency-free contexts/units/facts
extractor built and tested against a small **synthetic** fixture modeled on the real structure observed (the
real 2–2.7 MB downloaded filings were inspected locally but not committed). `plainFacts()` excludes
segment/dimensional-breakdown contexts so only the consolidated top-level figure is used — a real bug this
exact test suite caught (a naive greedy fact-matching regex was silently treating the entire document as one
fact) before it ever reached a real filing.

**Concept map** (`src/lib/financials/xbrl/conceptMap.ts`): conservative IFRS concept → line-item mapping,
built only from concepts actually observed in the two real filings — never computes EBITDA, never forces a
bank concept onto an industrial line item, documents every deliberately-unmapped concept
(`KNOWN_UNMAPPED_CONCEPTS`) with a reason instead of silently dropping it.

**CLI** (`scripts/discover/cmfXbrlFinancials.ts`, `npm run discover:cmf-financials` /
`ingest:cmf-financials:dry` / `ingest:cmf-financials -- --write`): discovery mode by default, dry-run by
default, sanitized logs only (never echoes raw HTML/XBRL or secrets).

**Supersession**: not re-demonstrated with a fresh live write this phase (no real same-period XBRL data
exists yet for a ticker already covered by the manual-CSV sample) — instead verified via the repository's own
priority table (`xbrl: 210 > manual_csv: 100` in `financialsRepository.ts`) plus the Phase 8C upgrade's
already-proven live Production supersession test. The mechanism is unchanged and requires no new proof to
apply to a `source_type: 'xbrl'` row.

Build 46 routes · lint 0 · tests 612 → 636+ (35 new tests in `tests/cmfXbrlProvider.test.ts`)

Scope limits (explicit): no CAPTCHA bypass, no OCR, no AI extraction; only 2 tickers mapped (SQM-B, COPEC);
no unzip dependency added (real ZIP download proven, extraction not wired); no scheduled/unattended ingestion;
News/Hechos Relevantes/FX/rates/calendar untouched; macro/market/auth/portfolio logic untouched.

Next: extend the verified issuer map (manually, per issuer), add a zip-extraction step, and exercise the
fetch chain against more tickers before considering any scheduled ingestion — or move to **Phase 8D**
(FX/rates + economic calendar live source completion) if CMF/XBRL automation is deprioritized.

---

**Phase 8C (upgrade) — Automation-First Financials Architecture, Manual CSV as Interim Bridge** ✓ COMPLETE (2026-07-03)

Upgrades the Phase 8C financials foundation (below) to an explicit **automation-first** design. Manual CSV
remains the only populated source today, but this was a non-negotiable product requirement: **manual CSV must
never become the terminal architecture.** Every schema, repository function, ingestion-run log, and UI label
now treats manual CSV as an interim bridge to establish the canonical schema/validation/persistence/read
layers — a future automated CMF FECU/XBRL parser, licensed vendor feed, broker feed, or document-ingestion
pipeline must be able to write into the same 4 tables through the same repository functions with **zero
redesign**.

**New migration** (`20260705000000_financials_automation_ready.sql`, purely additive/idempotent — never drops
or renames an existing column): adds `source_file`, `source_as_of`, `ingestion_run_id` (FK →
`ingestion_runs`), `source_priority` (default 100), `is_superseded` (default false), `superseded_by` to all 4
financials tables; widens the `source_type` CHECK constraint on each table to accept `manual_csv`, `cmf_fecu`,
`xbrl`, `vendor_feed`, `broker_feed`, `document_ingestion`, `static_seed`, `derived`; widens `statement_type`
to accept long-form codes alongside the original `income`/`cash`/`balance`/`returns`.

**Source priority + supersession** (`financialsRepository.ts`): `DEFAULT_SOURCE_PRIORITY` auto-derives an
integer priority from `source_type` — never hand-set by a caller — `static_seed`(10) < `derived`(50) <
`manual_csv`(100) < `document_ingestion`(120) < `broker_feed`(140) < `vendor_feed`(150) < `cmf_fecu`(200) <
`xbrl`(210). `reconcileSupersession()` runs after every upsert: groups rows by logical key (ticker +
fiscal_year + fiscal_period [+ period_type]), marks every row but the highest-priority one
`is_superseded = true` pointing `superseded_by` at the winner. The read path
(`getReportingPeriods`/`getCanonicalReportingPeriods`/`getStatementItems`/`getFinancialMetrics`/
`getEarningsEvents`) always filters `is_superseded = false` and dedupes defensively by highest priority per
group. **Verified end-to-end against Production Supabase**: a throwaway script inserted a synthetic
`cmf_fecu` row over an existing `manual_csv` period via the exact same `upsertReportingPeriods()` function a
real automated ingestion script would call — the manual row was automatically superseded, the canonical read
switched over, and after cleanup the system correctly reverted. Zero code changes were needed.

**Human-error controls added to the parser** (`src/lib/financials/csvFinancials.ts`): `normalizeSourceMetadata()`
rejects a `source_file` that looks like a path (slash, backslash, or Windows drive letter) and validates
`source_as_of` parses as a real timestamp; `findDuplicates()` rejects rows sharing a logical key within one
CSV batch (line-numbered errors); a statement-item value with no explicit `scale` is rejected as ambiguous;
dry-run stays the default, `--write`/`--allow-partial` are explicit opt-ins, and full CSV row content is never
echoed to logs (counts and line numbers only). **Caught a real bug via this validation**: the
`earnings_events.template.csv` COPEC "expected" row had one extra comma, shifting every field after it by one
column — found by the parser's own strict checks, not manual inspection.

**Ingestion script** (`scripts/ingest/financialsCsv.ts`): creates the `ingestion_runs` row **first**
(`metadata: { ingestionVersion: '8C', sourceType: 'manual_csv', automationReadiness: 'interim_bridge' }`),
threads that run's `id` as `ingestion_run_id` through every upserted row.

**UI/registry labels** now say "Static fallback · pending automated financials ingestion" and reference
"manual CSV interim bridge; automated CMF/FECU/XBRL ingestion planned" instead of a bare "Phase 8C" reference
— `src/lib/dataSourceRegistry.ts`, `src/lib/i18n.ts` (`charting.source`, `compare.fundamentalsNote`,
`compare.derivedFieldTitle`, `earnings.footer`, EN+ES).

**Tests:** `tests/financialsIngest.test.ts` extended from 49 to 73 tests — ambiguous-scale rejection,
provenance preservation, path-rejection, duplicate-row detection, `normalizeSourceMetadata`, `VALID_SOURCE_TYPES`
completeness, and a dedicated automation-first hygiene suite (migration is additive and CHECK-constrains all 8
source types; repository never hardcodes `source_priority`; supersession implemented; read path filters
`is_superseded`; ingestion script records `automationReadiness`; no source file frames manual CSV as
terminal/permanent; CLAUDE.md and `docs/data_source_status.md` document the interim-bridge/automation-first
constraint).

Build 46 routes · lint 0 · tests 612/612

**Automation-readiness summary:** manual CSV is the only populated source today (an ingestion-coverage gap,
not an architecture gap). An automated CMF FECU/XBRL parser, vendor feed, broker feed, or document-ingestion
pipeline replaces the manual step by calling the same `financialsRepository.ts` upsert functions with a
different `source_type` — the schema is fully source-agnostic and supersession is automatic. Remaining
human-error risk is confined to the manual-CSV path itself (typos in a source spreadsheet); mitigated by
strict validation, duplicate detection, and provenance tracking. Next automation step: build an actual
`cmf_fecu` or `xbrl` provider that writes into this already-ready schema.

Scope limits (explicit, unchanged from base Phase 8C): manual CSV is still the only source implemented; no
consensus/estimates ingestion; no dividends beyond the raw imported line item; no FX conversion; no
cross-period YoY for persisted records; no AI summaries; no mobile work; macro/market/auth/portfolio logic
untouched.

Next: **Phase 8D** (FX/rates + economic calendar live source completion), or building an actual automated
`cmf_fecu`/`xbrl` provider against the now-ready schema.

---

**Phase 8C — Financial-Statement Ingestion Foundation, Manual CSV First** ✓ COMPLETE (2026-07-03)

Converts Charting, Compare's Fundamentals table, and Earnings from terminal static/sample data into
persisted (or derived) data wherever a ticker's financials have been imported via CSV — the manual-CSV-first
step the Phase 8B conversion-path plan called for. No CMF/XBRL automation (still CAPTCHA-blocked), no
consensus/estimates ingestion, no FX conversion, no AI summaries. (Immediately upgraded to an automation-first
architecture the same day — see the Current Phase entry above.)

**New schema** (migration `20260704000000_financials_foundation.sql`, public read / admin-only write, same pattern as macro/market): `company_reporting_periods`, `financial_statement_items`, `financial_metrics` (manual or `derived`, manual wins ties), `earnings_events` (`status` ∈ expected/reported/preliminary/missing — **no consensus/estimate field exists**, so beat/miss is structurally impossible to fabricate for these rows).

**CSV templates:** `data/import_templates/*.template.csv` (synthetic sample data, safe to commit — real imports are never committed). **Parser/validation:** `src/lib/financials/csvFinancials.ts` (pure, line-numbered errors, NaN/Infinity-guarded, `deriveFinancialMetrics()` auto-computes EBITDA/gross/op margin, FCF, net debt, net debt/EBITDA from imported statement items). **Repository + ingestion script:** `src/lib/db/repositories/financialsRepository.ts` + `scripts/ingest/financialsCsv.ts` (`npm run ingest:financials:dry` / `ingest:financials -- --write`, dry-run default, aborts on validation errors unless `--allow-partial`, records `ingestion_runs`).

**Wiring (field/section-level labeled, never a blanket claim):**
- **Charting** — `src/lib/financials/resolveFinancials.ts` builds the exact `FundamentalRecord[]` shape the existing aggregation logic already renders, so no chart code changed; per-ticker fallback to `fundamentals.json`. `SourceStateBadge` in the toolbar.
- **Compare fundamentals** — `buildFundamentals()` upgrades P/E, EV/EBITDA, op/gross margin, FCF yield, dividend yield to `derived` field-by-field (new `derivedFields: CompareFundamentalKey[]` on `CompareFundamentals`, `•` marker in the UI); P/S fwd, ROE, P/B always stay `temporary_static` (no forward estimates or book value imported — never fabricated).
- **Earnings** — persisted `earnings_events` take over per-ticker where imported; status pill shows the real `status`, never a synthesized quality judgment; Rev. Surprise renders `—` for persisted rows; non-imported tickers keep the original static feature set unchanged.
- **Optional read APIs:** `GET /api/financials/coverage`, `/api/financials/[ticker]/metrics`, `/api/financials/[ticker]/statements`, `/api/earnings[?ticker=]`.

**Tests:** `tests/financialsIngest.test.ts` — 49 tests (parser/validators against the real template CSVs, `deriveFinancialMetrics`, `buildFundamentals` derived-vs-static incl. a bank-like null-EBITDA case, source-label/regression checks). One outdated Phase 8B test updated for the new `derivedFields` shape.

**Local validation:** migration applied via Supabase SQL Editor (manual — CLI blocked on this machine); `npm run ingest:financials -- --write` against the templates (SQM-B/BSANTANDER/COPEC synthetic data) → 79 rows upserted, 0 errors. Verified in the dev server: Charting shows "Persisted financials via manual CSV" with exact imported values; `/api/compare` shows 7 derived fields per ticker and correctly returns `null` (not a fake ratio) for BSANTANDER's EBITDA-dependent metrics (bank, blank EBITDA); `/earnings` shows honest `—` for YoY/surprise on persisted rows plus a real "Reported"/"Reportado" status pill, non-imported tickers unchanged; dark mode and Spanish both correct.

Build 46 routes · lint 0 · tests 588/588

Scope limits (explicit): manual CSV only, no CMF/XBRL automation, no consensus/estimates, no dividends beyond the raw imported line item, no FX conversion, no cross-period YoY for persisted records, no AI summaries, no mobile work, macro/market/auth/portfolio logic untouched.

Next: **Phase 8D** (FX/rates + economic calendar live source completion). Growing CSV coverage beyond the 3-ticker sample is ongoing, low-risk data entry, not further engineering.

---

**Phase 8B — Compare Real-Data Wiring + No-Static-Terminal-State Policy** ✓ COMPLETE (2026-07-02)

Establishes the durable **no-static-terminal-state policy** (see the standing rule above) and wires Compare's
market fields (price, day change, market cap, sector, currency, short-term performance) to the same
persisted/live Supabase market data used elsewhere in the app, reusing the existing `marketProvider.ts`
static/supabase/hybrid orchestrator — no new provider.

`src/lib/compare/compareTypes.ts` — `CompareEntry`/`CompareFieldSource` model (`live` · `persisted` ·
`static_fallback` · `temporary_static` · `unavailable`), NaN/Infinity-guarded. `src/lib/compare/resolveCompareData.ts`
(server-only) + `GET /api/compare?tickers=` + `src/lib/compare/compareStatic.ts` (pure, test-safe — no
transitive Supabase import, unlike the resolver). New "Market Data" panel on `/compare` with a dynamic
`MarketDataSourceBadge`; short-term performance (1D/5D) shows `persisted` once enough Supabase snapshot
history exists, longer windows correctly fall back to static with an explicit `insufficient_supabase_history`
reason. Comparative Returns chart/table and Fundamentals remained `temporary_static` in this phase (Phase 8C
above wired Fundamentals to persisted/derived data).

`docs/data_source_status.md` gained a "Conversion Paths for Remaining Static Modules" section giving every
remaining static/blocked module (FX/rates, US macro, economic calendar, Fundamentals/Charting, Earnings,
Hechos Relevantes, News) a target source, conversion path, blocker, next phase, and priority.

**Bug caught mid-phase (Preview validation):** the generic `loadJson(path)` helper in `compareStatic.ts`
passed a runtime variable to `new URL(path, import.meta.url)` — Vercel's build-time file tracer only detects
this pattern when the path is a string literal directly in the call (matching `portfolioRepository.ts`'s
proven pattern). Fixed by inlining both JSON loads with literal paths.

Build 44 routes · lint 0 · tests 539/539 (at the time of this phase)

Next (superseded by Phase 8C above): financial-statement ingestion for Charting + Earnings.

---

**Phase 8A — Static MVP Audit and Data Source Truth Layer** ✓ COMPLETE (2026-07-02)

Audit + label-cleanup phase (not a new-provider phase). By this point the app has real live/persisted data (macro via BCCh, market via Yahoo Finance/Supabase, auth/watchlist/portfolio via Supabase) sitting alongside modules that are still genuinely static or CAPTCHA-blocked (CMF) — but many UI labels hadn't been updated since the original MVP mockup, so several pages either understated what was already live or overstated a "future phase" that had already happened (or, for CMF, never can happen without a new access path). This phase read every visible page's actual data-fetch chain, compared it to its on-screen label, and corrected the mismatches — no new ingestion was added.

**Canonical truth-layer reference:** [`docs/data_source_status.md`](../docs/data_source_status.md) — a full page-by-page matrix (source / status / label / accuracy / next action / priority) that should be updated whenever a module's data source changes; other docs summarize from it, don't duplicate it.

**New shared infrastructure:**
- `src/lib/dataSourceRegistry.ts` — canonical `SourceState` enum (`live | persisted | hybrid | static_fallback | static_mvp | blocked | unavailable`) and a registry of specific EN/ES label pairs (e.g. `bcchLive` → "Live BCCh"/"BCCh en vivo"). Add new labels here, never inline a fresh source string in a component.
- `src/components/ui/SourceStateBadge.tsx` — a 7-state badge for new call sites, matching the existing `DataSourceBadge`/`MarketDataSourceBadge`/`CmfDataSourceBadge` dot+label visual language (semantic tokens only — `--positive`/`--accent`/`--muted-fg`/`--negative`/`--warning`; `static_mvp` gets a hollow dot to visually distinguish "always-static sample" from `static_fallback`, a live system's fallback state).

**P0 fixes (misleading or false labels, corrected this phase):**
- **Global disclaimer** (shown on every page): "Static MVP data · ... · Live data integrations planned" → "Not investment advice · Data sourcing varies by module — see source badges". This was the single highest-impact fix — a blanket static claim sitting under pages that already had accurate live/persisted badges.
- **Home macro card**: footer said "Phase 4 will connect BCCh BDE API" (Phase 4 finished long ago) directly under a `DataSourceBadge` already showing the real live/persisted status. Also, the Chile+US band shared ONE badge — since BCCh has no US series, a "live" Chile result would visually overstate freshness for the always-static US rows. Fixed by giving each band its own badge (Chile: dynamic; US: always `static`) and rewriting the footer to just name sources, not claim a status.
- **Home sector heat map / markets (index changes)**: footers claimed "Static MVP sample" (sector) and "Source: Bloomberg" (markets) while the code actually merges static → Supabase-persisted → Yahoo-live-on-refresh, and Bloomberg has no relationship to this project anywhere. Fixed by adding dynamic badges and removing the fabricated vendor name. **Caught a real bug while fixing this**: the first pass used the BCCh-flavored `DataSourceBadge` for these two market modules, which rendered "BCCh persisted" on sector/index data — wrong data-source attribution. Fixed by switching to `MarketDataSourceBadge`.
- **Stocks page**: footer named "Brain Data" as a Phase 4 source — Brain Data was tried and confirmed blocked (institutional-account requirement; see `docs/market_data_provider_discovery.md`), never actually integrated. Fixed to describe the real chain (static baseline → Supabase → Yahoo Finance on refresh) and added a `MarketDataSourceBadge`.
- **Company page**: (a) the price/chart area had the same static→persisted→live merge as Stocks/Home but no badge at all — added one; (b) the historical chart footer said "Phase 7: Bolsa de Comercio de Santiago" — Phase 7 (live price integration) effectively already happened via 4C.1-alt for current price, so the wording now explicitly splits "historical chart: static" from "current price: see badge above"; (c) the **"+ Watchlist" action was a purely decorative `StatusPill variant="soon"`** claiming a feature that has existed since Phase 6A was still unavailable — replaced with a real link to `/watchlist`.
- **Hechos Esenciales page + Home's Hechos footer**: said "Phase 4 will connect CMF API" — CMF live ingestion is not "pending a phase", it is **structurally blocked by a CAPTCHA gate** confirmed via a real discovery run (`docs/cmf_provider_discovery.md`, Phase 5A.1). Fixed everywhere to "CMF live ingestion not active (public portal requires CAPTCHA)" wording — never phrase CMF as a confirmed future connection.
- **Charting page + Macro page's own subtitle**: "future source: CMF · manual CSV" and "Future source: Banco Central BDE API..." (the latter on the Macro page itself, whose indicator rows already show BCCh live/persisted via badges a few lines below — directly contradicting its own subtitle). Fixed to name sources without a status claim.
- **Compare page**: "live data in Phase 4 / 7" (vague, unfulfilled) → "Static MVP sample — historical returns and fundamentals".
- **Watchlist page**: footer said "Personal watchlist · Supabase", which conflated two different truths — watchlist *membership* is Supabase-persisted, but the *prices* shown are static sample (no live/Supabase price overlay on this page, unlike Stocks/Home/Company). Fixed to state both explicitly.
- **Document Viewer**: "Live source sync planned for a future phase" — per `CLAUDE.md`'s own standing rule, live document sync is an intentional non-goal, not a pending phase. Fixed to describe the real, permanent behavior ("external only — documents are not synced").
- Removed two dead, unused, stale i18n keys (`home.stocksSource`, `home.watchlistPhase` — referenced a "Phase 6 auth" requirement that no longer applied and weren't rendered anywhere).

**Preserved as-is (already honest, no change needed):** Portfolio page footer (built correctly in 6C/6D), FX/Chilean-rates/Earnings-FECU/US-macro footers (genuinely 100% static, already said so plainly), News footer (already names candidate future sources without over-promising a phase), index proxy labels (`(proxy)` suffixes on COLCAP/BVL substitutes — untouched, still accurate).

**Recommended next phases (documented in `docs/data_source_status.md`, not started):**
- **Phase 8B** — Compare page real-data wiring: current price/day-change and IPSA benchmark can reuse `getLatestStockSnapshots()`/`index_snapshots` (already live elsewhere) at low risk; multi-period returns need more accumulated daily history in `stock_snapshots` before they're meaningful; fundamentals remain static pending 8C.
- **Phase 8C** — Financial-statement ingestion for Charting + Earnings: new `financial_statements`/`financial_metrics`/`company_reporting_periods` tables, manual CSV import as the pragmatic first step (CMF FECU parser blocked same as Hechos).
- **Phase 8D** — News / Economic Calendar source strategy: curated manual JSON → RSS → licensed API for News; BCCh/INE release calendars → manual JSON → paid calendar API for the Economic Calendar. No aggressive scraping in any option.

Files added/changed in 8A:
- `src/lib/dataSourceRegistry.ts` — new canonical source-state/label registry
- `src/components/ui/SourceStateBadge.tsx` — new shared 7-state badge
- `src/app/page.tsx` — per-band macro badges (Chile dynamic / US static), sector/index `MarketDataSourceBadge`s, computed `sectorStatus`/`indexStatus` from already-fetched state (no new provider calls)
- `src/app/stocks/page.tsx` — added `MarketDataSourceBadge` + `priceStatus`
- `src/app/companies/[ticker]/page.tsx` — added `MarketDataSourceBadge` + `priceStatus`; replaced the dead "soon" watchlist pill with a real link
- `src/lib/i18n.ts` — corrected ~20 EN+ES label pairs across Home, Stocks, Macro, Compare, Charting, Hechos Esenciales, Watchlist, Document Viewer, plus the global disclaimer/MVP pill; removed 2 dead keys
- `docs/data_source_status.md` — new canonical page-by-page source/status/accuracy matrix
- `tests/dataSourceAudit.test.ts` — 27 tests: registry labels, badge semantic-token guard, no stale phase/future-source/vendor-fabrication copy, CMF-blocked wording precision, Home badge-component regression guard (the BCCh-vs-market mix-up), Stocks/Company badge presence, and regression checks confirming portfolio math / middleware / provider orchestrators untouched

Build 42 routes · lint 0 · tests 513/513

Local validation (dev server): confirmed the Home macro card's Chile band showed genuinely dynamic "Live BCCh"/"Static MVP" across repeated reloads (real BCCh API variability) while the US band stayed correctly static every time; confirmed the sector/index badges show "Persisted market data" (not the initially-wrong "BCCh persisted"); confirmed the Company page's new watchlist link resolves to `/watchlist`; confirmed dark mode resolves the new badge's dot color to the correct theme token; zero console errors across Home/Stocks/Company/Macro/Hechos/Compare/Charting/Earnings; all explicit regression endpoints (`/api/macro`, `/api/macro/history/tpm`, `/api/market/stocks`, `/api/market/live-snapshot`, `/api/health/ingestion`) returned 200/healthy; `/portfolio` and `/watchlist` still correctly redirect when unauthenticated.

Scope limits (this phase, explicit):
- No new provider/ingestion implemented — label and metadata corrections only, plus one trivial low-risk link fix (Company page watchlist button)
- Auth logic, portfolio math, macro ingestion, and market ingestion untouched (confirmed by regression tests)
- No mobile-responsive work

Next: **Phase 8B** (Compare page real-data wiring) is the lowest-risk follow-up, reusing infrastructure that already exists.

---

**Phase 6D — Transaction History and Cash Ledger Foundation** ✓ COMPLETE (2026-07-02)

Lets positions be derived from real buy/sell lots instead of a manually entered quantity + average cost, while leaving the Phase 6C manual-position flow fully intact for tickers that don't use it. `portfolio_positions` (Phase 6C) stays the current-state table with an unchanged schema; `portfolio_transactions` becomes the source of truth for lot-managed tickers and every mutation reconciles `portfolio_positions` from the full replayed history.

**Average cost:** weighted average only (no FIFO/LIFO/specific-lot). A buy blends into the existing average (`newAvg = (existingQty×existingAvg + buyQty×buyPrice + fees + taxes) / (existingQty+buyQty)`); a sell reduces quantity but leaves the average cost on remaining shares unchanged.

**Realized P&L:** `(sellQty×sellPrice − fees − taxes) − (sellQty×averageCostAtSaleTime)`. `rebuildPositionFromTransactions()` (`src/lib/portfolio/transactions.ts`) replays a ticker's full history (sorted by `trade_date`) and returns both the final state and a per-transaction `steps[]` array, so editing or deleting an earlier transaction correctly recalculates `realized_pnl` on every later sell — not just the row touched. A sell that would exceed the quantity derivable from history is rejected (`insufficient_quantity`) **before** any write; editing/deleting also pre-validates the resulting full history first, so an invalid ledger (e.g. deleting a buy that would leave a later sell oversold) is never persisted.

**Cash ledger:** every buy/sell automatically creates one linked entry — `buy_cash_outflow` (negative, gross+fees+taxes) or `sell_cash_inflow` (positive, gross−fees−taxes). Users can also add manual `deposit` / `withdrawal` / `adjustment` entries; deposit/withdrawal are entered as a positive magnitude and normalized to +/− internally.

**Manual-position compatibility (no silent conversion):** the first transaction for a ticker that already has a manually-entered position (Phase 6C flow, or any pre-6D row with no `metadata.positionSource`) is blocked with `manual_position_conflict` — the user must remove the manual position first. Once a ticker has any transaction history it's `positionSource: 'transactions'`; the Positions-tab manual edit/remove controls are disabled for that row (directs the user to the Transactions tab instead).

DB tables added (migration `20260703000000_portfolio_transactions_cash_ledger.sql`, does **not** alter `portfolio_positions` — reuses its existing `metadata` column instead of an `ALTER TABLE`):
- `portfolio_transactions` — ticker (FK → `companies.ticker`), `transaction_type` ('buy'/'sell'), trade_date, quantity, price, fees, taxes, gross/net amount, `realized_pnl`; check constraints on type/quantity(>0)/price/fees/taxes(≥0)
- `portfolio_cash_ledger` — entry_type ('deposit'/'withdrawal'/'buy_cash_outflow'/'sell_cash_inflow'/'fee'/'tax'/'adjustment'), signed amount, optional `transaction_id` link

RLS: `auth.uid() = user_id` on every operation (both tables), `user_id` defaults to `auth.uid()` at the column level, no public read/write — same pattern as 6A/6C. Additionally, a `before insert or update` trigger (`check_portfolio_ownership()`) on both tables verifies the referenced `portfolio_id` actually belongs to `user_id`, since RLS alone only checks the row's own `user_id` and can't validate a cross-table FK.

Files added/changed in 6D:
- `supabase/migrations/20260703000000_portfolio_transactions_cash_ledger.sql` — 2 tables, 8 indexes, 1 updated_at trigger, 1 ownership-guard trigger (×2 tables), 8 RLS policies; idempotent
- `src/lib/supabase/database.types.ts` — added `portfolio_transactions` + `portfolio_cash_ledger` Row/Insert/Update types + `PortfolioTransactionRow`/`PortfolioCashLedgerRow` aliases
- `src/lib/portfolio/transactions.ts` — pure functions: `calculateTransactionAmounts`, `calculateAverageCostAfterBuy`, `calculatePositionAfterSell`, `calculateRealizedPnl`, `rebuildPositionFromTransactions` (+ per-step realized-P&L replay), `buildCashLedgerEntriesForTransaction`, `calculateCashBalance`, `calculatePortfolioCashSummary`
- `src/lib/db/repositories/portfolioTransactionRepository.ts` — `getPortfolioTransactions`, `addPortfolioTransaction`, `updatePortfolioTransaction`, `deletePortfolioTransaction`, `rebuildPortfolioPositionsFromTransactions`, `getCashLedger`, `addCashLedgerEntry`, `getCashBalance`, `getPortfolioCashSummary`, `getRealizedPnlSummary`; all pre-validate via the replay function before writing, then reconcile after
- `src/lib/db/repositories/portfolioRepository.ts` — added `positionSource` field (read from `metadata.positionSource`, defaults `'manual'`), `getPositionSource()` helper exported for reuse; manual `addPosition` now explicitly sets `metadata: { positionSource: 'manual' }`
- `src/app/api/portfolios/[id]/transactions/route.ts` — GET (list, optional `?ticker=`/`?limit=`), POST (add)
- `src/app/api/portfolios/[id]/transactions/[transactionId]/route.ts` — PATCH (edit), DELETE (remove)
- `src/app/api/portfolios/[id]/cash/route.ts` — GET (ledger + summary), POST (manual deposit/withdrawal/adjustment)
- `src/app/api/portfolios/[id]/route.ts` — now also returns `cashSummary` and `realizedPnl` in the same response
- `src/app/portfolio/page.tsx` — tab bar (Positions/Transactions/Cash); summary strip grows 5→7 cards (added Realized P&L, Cash Balance); transaction-derived rows show a "Transactions" badge with locked edit/remove; manual rows show "Manual" and keep full edit/remove; new `AddTransactionForm`, `TransactionsTable`, `AddCashForm`, `CashSummaryCards`, `CashLedgerTable` components
- `src/lib/i18n.ts` — `portfolio.tx.*` and `portfolio.cash.*` sections (EN + ES), plus `realizedPnL`/`cashBalance`/tab labels/badges at the top level
- `tests/portfolioTransactions.test.ts` — 52 tests: migration/RLS/ownership-trigger structural checks, all pure math (weighted average, realized P&L, oversell rejection, per-step replay), and a full add→buy→buy→sell→update→delete integration flow against an in-memory fake Supabase client that mimics real PostgREST snapshot semantics (see the fix below — the first version of this fake masked a real bug)

**Bug caught by Preview validation (fixed same day):** `addPortfolioTransaction`/`updatePortfolioTransaction` returned the pre-reconcile transaction row, so `realized_pnl` was always `null` in the POST/PATCH response even though the persisted DB value (written moments later by the reconcile step) was correct. Invisible to the UI (it re-fetches via GET after every mutation) but a real API-contract bug. Root cause of why unit tests didn't catch it: the original test fake Supabase client returned live object references from `insert()`, so a later `.update()` call retroactively "fixed" the already-captured value in-memory — real PostgREST returns a point-in-time snapshot, not a live reference. Fixed both the repository (merge the reconciled step's `realizedPnl` into the response) and the fake client (shallow-copy on read, matching real semantics) — this is exactly the kind of gap the required Preview-before-Production curl validation exists to catch.

Build 42 routes · lint 0 · tests 486/486

Local validation (dev server, existing throwaway test account, migration applied via Supabase SQL Editor):
- Cash deposit (1,000,000) → buy SQM-B ×2 at different prices (10@50,000, 10@70,000) → weighted average cost correctly 60,000 → partial sell (5@80,000) → realized P&L correctly 100,000 → position quantity/avg-cost/cash-balance/summary-card math all verified correct at every step
- Oversell (999 shares) → rejected with the correct message
- First transaction attempt on BSANTANDER (which had an existing manual position) → correctly blocked with `manual_position_conflict`
- Refresh → all state persisted; sign-out → `/portfolio` re-protected
- Watchlist, public pages (`/`, `/stocks`, `/macro`, `/compare`, `/chart-builder`, `/earnings`, `/hechos-esenciales`), `/api/macro`, `/api/market/stocks`, `/api/health/ingestion` → all unaffected

Preview validation (curl against a live Preview deployment, same throwaway test account):
- Deposit → buy → buy → sell round-trip via `/api/portfolios/[id]/transactions` and `/cash` — all math confirmed correct via GET
- **Found and fixed the realized-P&L response bug above** during this step, redeployed, re-verified: a subsequent sell's POST response showed the correct `realizedPnl` directly
- Edit/delete transaction, cash ledger + summary, watchlist regression — all confirmed; test transactions cleaned up (position correctly reconciled back to quantity 0)

Production validation (`nevada-market-intelligence.vercel.app`, commit `57f422d`, deployment `dpl_5zfy4arHieLuFAtm3sAg3EYaWYjz`):
- Public pages 200, `/portfolio` and `/watchlist` redirect to login when unauthenticated (307), `/api/portfolios` and `/api/watchlists` return 401 unauthenticated, `/api/health/ingestion` → `overallStatus: healthy`, `/api/macro` and `/api/market/stocks` → 200
- Logged in with the test account on the canonical domain (same session mechanism as 6B) → buy BSANTANDER → edit price (30→35, gross/net recalculated correctly) → delete → all succeeded; test data cleaned up
- Cron route (`/api/cron/check-ingestion-health`) still returns 401 without its own bearer token — confirms middleware still leaves cron routes untouched

Scope limits (this phase, explicit):
- No FIFO/LIFO or specific-lot selection — weighted average only
- No dividends
- No time-weighted or money-weighted performance attribution
- No broker/CSV import
- No automated cash reconciliation against a real brokerage statement
- Multi-step writes (transaction insert → cash-ledger insert → position reconcile) are sequential, not a single DB transaction (Supabase JS has no multi-statement transaction API) — pre-validation before every write keeps the ledger consistent in practice; a Postgres RPC would close this gap if ever needed
- No alerts, no AI summaries, no admin panel
- Macro/market ingestion logic untouched

Next: **Phase 7A** — mobile-responsive foundation, or **Phase 6E** — portfolio analytics / performance attribution.

---

**Phase 6C — Portfolio Positions Foundation** ✓ COMPLETE (2026-07-02)

First portfolio-monitoring layer for authenticated users: create/view a portfolio, add/edit/remove positions, see current market value and unrealized P&L, see exposure by sector. Follows the exact pattern established by Phase 6A's watchlist (same middleware protection style, same `getSupabaseUserClient()` + RLS ownership model). No transaction history, realized P&L, cash balance, FX conversion, alerts, or AI summaries in this phase.

Protected routes (middleware, added to the existing 6A lists):
- `/portfolio` → redirect to `/login?next=/portfolio` if not authed
- `/api/portfolios/*` → 401 JSON if not authed

DB tables added (migration `20260702000000_portfolio_foundation.sql`):
- `portfolios` — one or more per user; `is_default` auto-created ("Default", `base_currency: 'CLP'`) on first `/portfolio` visit
- `portfolio_positions` — ticker (FK → `companies.ticker`, restrict on delete) + quantity + average_cost + cost_currency + notes; unique(portfolio_id, ticker)

RLS: `auth.uid() = user_id` on select/insert/update/delete for both tables — no public read/write, mirrors the 6A watchlist policies exactly. `user_id` also defaults to `auth.uid()` at the column level (defense in depth). Repository code never sets `user_id` in an insert/update payload; ownership is established solely by the database.

Pricing source: `getLatestStockSnapshots()` in `marketRepository.ts` (Phase 4C.4's deduplicated-latest-per-ticker helper — already used by the company-page charts). No new market ingestion; Yahoo live overlay is out of scope for this phase.

Valuation (`src/lib/portfolio/valuation.ts`, pure functions, NaN/Infinity-guarded):
- `calculatePositionMarketValue` = `quantity × latestPrice`; `calculateCostBasis` = `quantity × averageCost`
- `calculateUnrealizedPnL` = `marketValue − costBasis`; `calculateUnrealizedPnLPct` guards a zero/null cost basis → `null`, never `Infinity`
- `calculatePortfolioTotals` sums across positions; `calculateSectorExposure` groups by sector (from `companies.json`) and computes weight
- `isMixedCurrency` flags (doesn't convert) when a position's `cost_currency` differs from the live price's currency — no FX conversion is implemented yet

Files added/changed in 6C:
- `supabase/migrations/20260702000000_portfolio_foundation.sql` — 2 tables, 5 indexes, updated_at triggers, 8 RLS policies; idempotent
- `src/lib/supabase/database.types.ts` — added `portfolios` + `portfolio_positions` Row/Insert/Update types + `PortfolioRow`/`PortfolioPositionRow` aliases
- `src/lib/db/repositories/portfolioRepository.ts` — `getUserPortfolios`, `getDefaultPortfolio`, `createPortfolio`, `ensureDefaultPortfolio`, `getPortfolioPositions`, `addPosition`, `updatePosition`, `removePosition`, `getPortfolioSummary`; covered-ticker set loaded via `fs.readFileSync` + `import.meta.url` (not the `@/lib/data/companies` alias helper, which Node's native test runner can't resolve directly)
- `src/lib/portfolio/valuation.ts` — pure valuation/exposure math (no Next.js/Supabase imports; directly unit-testable)
- `src/app/api/portfolios/route.ts` — GET (list + auto-create default), POST (create named portfolio)
- `src/app/api/portfolios/[id]/route.ts` — GET portfolio detail: positions + totals + sector exposure, joined with live pricing
- `src/app/api/portfolios/[id]/positions/route.ts` — POST (add position; validates ticker/quantity/averageCost; 409 on duplicate)
- `src/app/api/portfolios/[id]/positions/[ticker]/route.ts` — PATCH (edit), DELETE (remove)
- `src/app/portfolio/page.tsx` — summary cards, sector-exposure bars, positions table with inline edit, add-position form
- `src/middleware.ts` — added `/portfolio` and `/api/portfolios` to the protected-route lists
- `src/lib/navigation.ts`, `src/components/layout/Sidebar.tsx` — Portfolio nav item + icon
- `src/lib/i18n.ts` — `portfolio:` section (EN + ES): summary labels, table columns, form labels, error messages
- `tests/portfolioFoundation.test.ts` — 46 tests: migration/RLS structural checks, ownership-safety checks (never sets `user_id` explicitly, never uses the admin client), `addPosition`/`updatePosition`/`removePosition` validation (mocked Supabase client, no live DB/Auth needed), full valuation math, middleware protection (exact `PROTECTED_PAGES`/`PROTECTED_API` scope, no creep), route existence + no-secrets checks, regression checks

Build 42 routes · lint 0 · tests 434/434

Local validation (dev server, throwaway test account — did not touch the real user's data):
- Unauthenticated `/portfolio` → redirects to `/login?next=%2Fportfolio`; unauthenticated `/api/portfolios` → 401
- Public pages (`/`, `/stocks`, `/macro`, `/compare`, `/chart-builder`, `/earnings`, `/hechos-esenciales`) → all 200, unaffected
- `/api/macro`, `/api/market/stocks`, `/api/health/ingestion` → all 200/healthy, unaffected
- Created account → default portfolio auto-created → added SQM-B (qty 10, avg cost 50,000) → market value/cost basis/P&L/sector exposure all computed correctly from the live Supabase snapshot price → added BSANTANDER → duplicate SQM-B correctly rejected (409, "already in your portfolio") → edited SQM-B (qty 20, avg cost 55,000) → recalculated correctly → removed SQM-B → BSANTANDER weight recalculated to 100% → refreshed page → BSANTANDER persisted → signed out → `/portfolio` re-protected
- `/api/watchlists` still 401 unauthenticated (no regression)

Scope limits (this phase, explicit):
- No transaction history (average cost entered directly, not derived from buy/sell lots)
- No realized P&L, no cash balance, no FX conversion
- No performance attribution
- No price alerts, no AI summaries, no admin panel
- Macro/market ingestion logic untouched

Next: **Phase 6D** — transaction history + cash ledger (to derive average cost from real lots). Or **Phase 7A** — mobile-responsive foundation.

---

**Phase 6B — Username + Password Authentication** ✓ COMPLETE (2026-07-02)

Replaced the Phase 6A magic-link (email OTP) flow with username + password sign-in. Root cause for the change: the PKCE flow's one-time code verifier, written client-side before the redirect to the magic-link email, did not reliably persist in the browser during testing (`document.cookie` proved cookies worked fine in general, but Supabase's own error — "PKCE code verifier not found in storage" — confirmed the verifier specifically wasn't surviving the round trip). Rather than keep chasing that fragility, auth was rebuilt on a mechanism proven reliable earlier in the same debugging session: session cookies set directly on the HTTP response.

Auth flow: `POST /api/auth/login` (username → email resolved server-side via the admin client, email never sent to the browser; `signInWithPassword`) or `POST /api/auth/register` (create/attach password to an account, set username/display_name) → session cookies set directly on the `NextResponse` inside `setAll` (not via `next/headers`, which doesn't reliably survive a redirect in Next.js 16) → client navigates to the target page.

Email is now recovery-only — never used to sign in. Username doubles as the display name (no separate field), shown only in the sidebar (not the TopBar). The `/auth/callback` PKCE route is kept only for any future OAuth provider; it is not part of the primary sign-in path.

DB change (migration `20260701120000_username_password_auth.sql`):
- `user_profiles.username` — `citext`, unique, indexed. Username lookup at login time is server-side only (admin client), email never returned to the browser.

Files added/changed in 6B (plus a UX-refinement pass immediately after):
- `supabase/migrations/20260701120000_username_password_auth.sql` — `citext` extension, `username` column + unique constraint + index; idempotent
- `src/lib/auth/credentials.ts` — pure validators: `normalizeUsername`, `isValidUsername`, `isValidPassword`, `isValidEmail`, `isValidDisplayName`
- `src/lib/auth/sessionCookies.ts` — `createSessionWriterClient()`: captures Supabase's session-cookie writes and applies them directly to a `NextResponse` — the fix for the whole 6A/6B cookie saga
- `src/lib/auth/useAuthDisplay.ts` — client hook exposing the signed-in user's display name from session `user_metadata` (no extra network call)
- `src/app/api/auth/register/route.ts` — creates or attaches a password to an existing email-based account; optional `AUTH_REGISTRATION_CODE` gate
- `src/app/api/auth/login/route.ts` — resolves username → email server-side; generic `invalid_credentials` on any failure (no user enumeration)
- `src/app/login/page.tsx` — rewritten: username/password sign-in + create-account mode; single "Create an account" toggle (no separate display-name field)
- `src/app/auth/callback/route.ts`, `src/app/logout/route.ts` — cookies now set directly on the response object (same fix applied everywhere)
- `src/components/layout/Sidebar.tsx` — shows the display name below "Nevada Market Intelligence"; sign-out/sign-in link in the sidebar footer
- `src/components/layout/TopBar.tsx` — removed the `AuthStatus` widget (username now sidebar-only); added the collapsible-sidebar hamburger toggle
- `src/components/providers/SidebarProvider.tsx` — persisted sidebar-collapse state (`cmi.sidebarCollapsed`), a UX request made alongside this phase
- `src/lib/i18n.ts` — `auth:` section rewritten for username/password (EN + ES); `common.hideSidebar`/`showSidebar`
- Removed: `src/components/ui/AuthStatus.tsx`, the temporary `/api/debug-auth` diagnostic endpoint, and all `x-cb-*`/`x-mw-*` diagnostic headers added during the magic-link debugging session
- `tests/credentials.test.ts` — 7 tests for the pure validators; `tests/authWatchlist.test.ts` updated to assert the new POST-to-server-route pattern instead of the old browser-client pattern

Build 35 routes · lint 0 · tests 388/388 (at time of this phase; see 6C above for the current count)

Production validated: sign-in/sign-out round-trip, watchlist add/remove works with the new session mechanism (previously blocked by the PKCE issue), public pages unaffected.

Next (superseded by 6C above, kept for history): portfolio positions foundation.

---

**Phase 6A — Authentication and Watchlist Foundation** ✓ COMPLETE (2026-07-01)

Supabase Auth with magic-link (email OTP) + personal watchlist. Authenticated users can add/remove tickers from their default watchlist. All other pages remain public.

Auth flow: `POST /auth/v1/otp` (signInWithOtp) → magic-link email → `GET /auth/callback?code=` (PKCE exchange) → session cookie set → user redirected to `/watchlist`.

Protected routes (middleware):
- `/watchlist` → redirect to `/login?next=/watchlist` if not authed
- `/api/watchlists/*` → 401 JSON if not authed
- All other routes → public (no auth required)

Supabase dashboard setup required before use:
1. Enable Email provider: Dashboard → Auth → Providers → Email → enable **"Confirm email"** (OTP mode)
2. Add site URL: Dashboard → Auth → URL Configuration → `NEXT_PUBLIC_SITE_URL` (e.g. `https://nevada-market-intelligence.vercel.app`)
3. Add `http://localhost:3000/auth/callback` and production callback URL to **Redirect URLs**
4. Apply migration: paste `supabase/migrations/20260701000000_auth_watchlist_foundation.sql` in SQL Editor → Run

DB tables added (migration `20260701000000_auth_watchlist_foundation.sql`):
- `user_profiles` — mirrors `auth.users`; RLS: own row only
- `watchlists` — one per user (default created on first visit); RLS: own rows only
- `watchlist_items` — ticker + watchlist_id + user_id; unique(watchlist_id, ticker); RLS: own rows only

All RLS policies use `auth.uid() = user_id`. No service-role key in any client or page code.

TypeScript note: Supabase JS `.from('watchlist*')` type inference fails for user-scoped tables at TypeScript 5.9 recursion depth. All watchlist repository functions use `(client as any).from(...)` with explicit row-type casts — same pattern as `macroRepository.ts:155`.

Files added/changed in 6A:
- `supabase/migrations/20260701000000_auth_watchlist_foundation.sql` — 3 tables, 6 indexes, updated_at triggers, 11 RLS policies; idempotent
- `src/lib/supabase/database.types.ts` — rewrote ALL Insert/Update types as explicit field lists (removed Omit<Database[...]> self-references that hit TS 5.9 depth limit); added user_profiles, watchlists, watchlist_items tables + convenience type aliases
- `src/lib/supabase/server.ts` — added `getSupabaseUserClient()` (async, cookie-aware, for user-scoped queries)
- `src/lib/auth/getUser.ts` — `getCurrentUser()`, `getUserIdOrNull()`, `requireCurrentUser()`
- `src/middleware.ts` — session refresh + route protection; cron routes untouched
- `src/app/login/page.tsx` — magic-link form; 3 states (form/loading/sent); `'use client'` + `<Suspense>`
- `src/app/auth/callback/route.ts` — PKCE code exchange; safe redirect (same-origin only)
- `src/app/logout/route.ts` — POST + GET; calls signOut + redirects to /
- `src/lib/db/repositories/watchlistRepository.ts` — getUserWatchlists, getDefaultWatchlist, createWatchlist, ensureDefaultWatchlist, getWatchlistItems, addTickerToWatchlist, removeTickerFromWatchlist, updateWatchlistItemNotes, deleteWatchlist
- `src/app/api/watchlists/route.ts` — GET (list + auto-create default), POST (create named watchlist)
- `src/app/api/watchlists/[id]/items/route.ts` — GET (list items), POST (add ticker; validates against covered universe; deduplicates)
- `src/app/api/watchlists/[id]/items/[ticker]/route.ts` — DELETE (remove ticker)
- `src/app/watchlist/page.tsx` — replaced MVP placeholder with real authenticated page; add/remove ticker UI; static JSON for market data display
- `src/components/ui/AuthStatus.tsx` — TopBar auth widget; shows email + sign-out when authed, "Sign in" link when not; uses onAuthStateChange for SSR-safe hydration
- `src/components/layout/TopBar.tsx` — added AuthStatus widget
- `src/lib/navigation.ts` — removed `soon: true` from watchlist nav item
- `src/lib/i18n.ts` — added `auth:` section (EN + ES) + replaced watchlist placeholder keys with real content keys
- `.env.example` — added `NEXT_PUBLIC_SITE_URL` note
- `tests/authWatchlist.test.ts` — 31 tests: migration tables/RLS/idempotency, middleware protection, login page safety, API routes, no service-role leakage, regression on core migration

Build 35 routes · lint 0 · tests 381/381

Scope limits (unchanged):
- No user portfolios or position tracking
- No performance attribution
- No price alerts
- No AI summaries
- No admin panel
- Ingestion logic untouched

---

**Phase 4C.4 — Historical Stock Charts from Supabase Snapshots** ✓ COMPLETE (2026-07-01)

`/api/market/stocks/[ticker]/history` now reads accumulated `stock_snapshots` rows from Supabase in hybrid/supabase mode and normalizes them to `StockHistoryPoint[]` for the company-page LineChart. Static JSON fallback active for all modes and for 3Y/5Y timeframes (which require years of daily data not yet accumulated).

Three-tier read hierarchy (mirrors macro pattern):
- `MARKET_DATA_MODE=static` → always static JSON
- `MARKET_DATA_MODE=supabase` → Supabase only; empty + `live-unavailable` if insufficient
- `MARKET_DATA_MODE=hybrid` → Supabase if sufficient data; static fallback otherwise

Sufficiency thresholds: 1D≥1 · 5D≥3 · 1M≥5 · MTD≥1 · YTD≥5 · 1Y≥60. 3Y/5Y → always static.

Same-day dedup: multiple snapshot_type rows for the same date → highest `SNAPSHOT_TYPE_PRIORITY` wins (`live_refresh:3 > manual:2 > close:1 > midday:0`).

Files added/changed in 4C.4:
- `src/lib/market/marketHistory.ts` — pure helpers: `resolveHistoryDateRange`, `isSufficientMarketHistory`, `normalizeStockSnapshotsToHistoryPoints`, `HISTORY_MIN_POINTS`
- `src/lib/db/repositories/marketRepository.ts` — added `StockHistorySnapshotRow`, `SnapshotHistoryResult`, `getStockSnapshotHistory(ticker, {from?, to?})`
- `src/lib/providers/market/supabaseMarketProvider.ts` — `getStockHistory()` implemented (was stub returning ok:false)
- `src/lib/providers/market/marketProvider.ts` — `resolveStockHistory()` rewritten with full 3-tier logic (was always-static stub)
- `tests/marketSnapshotHistory.test.ts` — 33 tests for all pure helpers

Build 28 routes · lint 0 · tests 350/350

---

**Phase 5D.1 — Ingestion Observability and Alerting** ✓ COMPLETE (validated 2026-07-01)

Health evaluation, status endpoint, and alert cron for BCCh macro and Yahoo Finance market ingestion.

Health states: `healthy | warning | stale | failed | unknown`

Staleness thresholds:
- **Macro BCCh:** healthy ≤ 2 business days since last successful run · warning 2–4 · stale/failed > 4
- **Market Yahoo:** healthy ≤ 2 calendar days since latest snapshot · warning 2–4 · stale/failed > 4
- **Monthly indicators** (ipc-mensual, ipc-anual, imacec-anual, desempleo): 100-day threshold to account for 1–2 month publication lag — do not flag stale for normal release delay

Alert delivery: `ALERTS_ENABLED=true` + `ALERT_WEBHOOK_URL` → POST JSON payload to webhook. Default: disabled. Slack-compatible payload shape.

Cron schedule: `45 13 * * 1-5` (weekdays, 15 min after market refresh window)

Files added/changed in 5D.1:
- `src/lib/observability/ingestionHealth.ts` — pure health functions: `evaluateMacroIngestionHealth`, `evaluateMarketIngestionHealth`, `evaluateOverallIngestionHealth`, `formatHealthSummary`, `businessDaysBetween`, `calendarDaysBetween`
- `src/lib/observability/alertDelivery.ts` — generic webhook delivery; `ALERTS_ENABLED` guard; no secrets in output
- `src/app/api/health/ingestion/route.ts` — `GET /api/health/ingestion`, public read-only status endpoint
- `src/app/api/cron/check-ingestion-health/route.ts` — `GET /api/cron/check-ingestion-health`, Bearer `CRON_SECRET` auth; `?dryRun` and `?force` params; `alertSuppressed` flag
- `vercel.json` — added cron `45 13 * * 1-5` for `check-ingestion-health`
- `.env.example` — `ALERTS_ENABLED`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET`, `ALERT_EMAIL_TO`
- `tests/ingestionHealth.test.ts` — 32 tests for all health evaluation paths

Production validated (2026-07-01):
- `dpl_GHxaMdQx2C1VEyA3EiVVFnfaXdtg` · commit `8e44597` · 28 routes · 0 errors
- `/api/health/ingestion` → `overallStatus: healthy` · macro 11/11 · market healthy
- `/api/cron/check-ingestion-health` (valid auth) → `alertSuppressed: true` (ALERTS_ENABLED=false)
- Invalid auth → 401. No secrets in any response. Logs clean.
- Macro and market read paths: no regression
- Build 28 routes · lint 0 · tests 317/317

Alert env vars (server-only, never NEXT_PUBLIC_):
- `ALERTS_ENABLED=true` — master switch (default: false/disabled)
- `ALERT_WEBHOOK_URL` — POST target (Slack, Teams, Discord, or any HTTP)
- `ALERT_WEBHOOK_SECRET` — optional Bearer token for webhook auth
- `ALERT_EMAIL_TO` — reserved for future email delivery

Manual trigger:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://nevada-market-intelligence.vercel.app/api/cron/check-ingestion-health
```

To enable alerts after configuring a real webhook:
1. `echo "true" | npx vercel env add ALERTS_ENABLED production`
2. `echo "<url>" | npx vercel env add ALERT_WEBHOOK_URL production`
3. Redeploy and test with `?force=true`

---

**Phase 5D — Scheduled BCCh Macro Ingestion (Vercel Cron)** ✓ COMPLETE (validated 2026-06-26)

Daily cron route that upserts the last 14 days of verified BCCh observations into
Supabase. Runs weekdays at 12:30 UTC. Secured with `CRON_SECRET`. Idempotent.

Schedule: `30 12 * * 1-5` (weekday-only; fall back to `* * *` if Hobby plan rejects it)
Production URL: `https://nevada-market-intelligence.vercel.app/api/cron/ingest-bcch-macro`

Manual production trigger result (2026-06-26T19:40Z):
- `status: success` · 11/11 indicators succeeded · `rowsSeen: 2602` · `rowsInserted: 74` · `rowsFailed: 0`
- `ingestionRunId: 3110210a-9db2-4e11-a99f-5674ff13eee2`

**Post-deploy fix (5D hotfix):** Production cron was returning `partial_success` with PGRST125
errors on all 7 daily indicators. Root cause: PostgREST schema cache staleness after
DDL changes (ADD CONSTRAINT, NOT NULL) made during debugging — PostgREST's `NOTIFY pgrst`
is blocked by PgBouncer on Supabase Free tier and doesn't reload immediately.
Separately, `getSupabaseAdminConfig()` was not applying `normalizeProjectUrl()`, meaning
`.env.local` URLs with the Supabase Dashboard's `/rest/v1` suffix would construct
double-path requests. Fixed by adding `normalizeProjectUrl()` to the admin config function.
NEXT_PUBLIC_SUPABASE_URL in `.env.local` and Vercel canonicalized to the bare project URL.
`upsertMacroObservations` reverted to clean `.upsert(onConflict)` — no delete-then-insert.

Files added/changed in 5D + 5D hotfix:
- `src/lib/ingestion/bcchMacroIngestion.ts` — shared incremental/backfill logic; sanitizes errors; records ingestion_runs
- `src/app/api/cron/ingest-bcch-macro/route.ts` — GET route with Bearer CRON_SECRET auth; sanitized JSON response
- `vercel.json` — cron schedule `30 12 * * 1-5`
- `scripts/cron/testBcchMacroCron.ts` — local manual trigger helper
- `scripts/vercel/setPreviewEnv.ts` + `setProductionEnv.ts` — added CRON_SECRET
- `src/lib/supabase/env.ts` — `normalizeProjectUrl()` now applied to both public and admin configs
- `src/lib/db/repositories/macroRepository.ts` — `upsertMacroObservations` uses `.upsert(onConflict)`
- `tests/cronIngestion.test.ts` — 22 tests (sanitizeError, auth guards, not_configured path, result shape)
- `tests/supabaseEnv.test.ts` — 8 new URL normalization tests (public + admin, base/suffix/trailing-slash)
- `docs/supabase_persistence.md` — URL format requirement section
- `docs/deployment.md` — Phase 5D cron section
- `package.json` — `cron:test` script
Build 24 routes · lint 0 · tests 214/214

**Supabase URL rule:** `NEXT_PUBLIC_SUPABASE_URL` must be the bare project URL
(`https://ref.supabase.co`), never the REST URL (`https://ref.supabase.co/rest/v1`).
The `normalizeProjectUrl()` function in `env.ts` strips the suffix defensively,
but both `.env.local` and Vercel should store the canonical bare URL.

---

**Phase 4C.1-alt — Yahoo Finance Live Market Overlay** ✓ COMPLETE (2026-06-30)

Brain Data blocked (institutional account required — personal "Personas" account does not
expose the API product on `marketplace.bolsadesantiago.com`). Yahoo Finance chosen as free
unofficial alternative. No API key required.

Two-layer architecture:
1. **GitHub Actions static refresh** (twice daily): `scripts/refresh/refreshMarketData.py` (Python/yfinance) runs at **13:30 UTC** and **21:30 UTC** weekdays. Commits updated JSON if changed; Vercel auto-redeploys.
2. **Next.js live-snapshot route** (`/api/market/live-snapshot`): uses `yahoo-finance2` npm package server-side; 10-second timeout; sanitized error responses; batch-quotes all 25 tickers + 11 indices; returns `provider`, `symbolsSucceeded`, `symbolsFailed`.

UI refresh button (`MarketRefreshButton`) appears on Home, Stocks, and Company pages. 3-state (idle/loading/done). Static fallback always active — if Yahoo fails, last committed JSON is served and the UI shows no error.

Pure aggregation logic in `src/lib/market/liveOverlay.ts` (no Next.js imports — testable).

Files added/changed:
- `scripts/refresh/refreshMarketData.py` — Python/yfinance fetch; writes 4 JSON files
- `scripts/refresh/requirements.txt` — yfinance, pandas
- `.github/workflows/refresh-market-data.yml` — twice-daily weekday cron + workflow_dispatch
- `src/lib/market/liveOverlay.ts` — pure ticker maps + buildStocks/buildSectors/buildIndices
- `src/app/api/market/live-snapshot/route.ts` — GET handler with timeout + metadata
- `src/lib/data/marketLiveData.ts` — client-safe fetch helper + formatLiveTimestamp
- `src/lib/data/marketMeta.ts` — formatMarketLastUpdated from static JSON
- `src/data/marketMeta.json` — static timestamp (null initially)
- `src/components/ui/MarketRefreshButton.tsx` — 3-state refresh icon button
- `src/app/page.tsx` — refresh button on Tracked Stocks + Sector Heat Map; live overlay
- `src/app/stocks/page.tsx` — refresh button in toolbar; live price/dayPct/marketCap overlay
- `src/app/companies/[ticker]/page.tsx` — refresh button in SectionHeader; live KPI overlay
- `src/lib/i18n.ts` — common.marketUpdated key
- `tests/marketLiveOverlay.test.ts` — 20 tests (ticker map, buildStocks, buildSectors, buildIndices)
Build 24 routes · lint 0 · tests 234/234

Production deploy (2026-06-30): `dpl_2aHBfYyA5fyzuZTVhLGh4WwXMPJd` · 25 routes · 0 errors

**Phase 4C.1-alt post-deploy fixes (2026-06-30):**
- `SECURITY.SN` → `LAS-CONDES.SN` (Clínica Las Condes), `ITAUCORP.SN` → `ITAUCL.SN` (both delisted/unavailable via yfinance)
- `^COLCAP` → `^SPCOSLCP` (S&P Colombia Select proxy — COLCAP unavailable on Yahoo Finance servers)
- `^BVL` → `EPU` (iShares MSCI Peru ETF proxy — BVL unavailable on Yahoo Finance servers)
- LAS-CONDES sector corrected: `Real Estate / Malls` → `Healthcare` (Clínica Las Condes is a private hospital, not real estate)
- Healthcare sector entry added to `sectorPerformance.json` and `SECTOR_MAP` in `liveOverlay.ts`
- Index proxy labels clarified: `"S&P Colombia (proxy)"` and `"Peru ETF proxy (EPU)"` so UI never claims official index data
- yahoo-finance2 v3 instantiation fixed (`new YahooFinance()` required) — previously every live call returned 503
- `None` guard added to Python refresh script for tickers that return no timezone data

**Phase 4C.1-alt production validation (2026-06-30):** commit `210eacd`
- `/api/market/live-snapshot` → 25/25 succeeded · 0 failed · provider: yahoo-finance · Healthcare sector present · Real Estate/Malls 2 stocks · S&P Colombia proxy live (1544.5, -0.58%) · Peru ETF proxy live (83.56, +1.33%)
- `/api/macro` → 11 indicators · status live (BCCh) · no regression
- `/api/macro/history/tpm?timeframe=1Y` → 249 pts · status persisted · dbModeUsed supabase
- `/api/macro/ingestion-status` → 11 indicators · last run 2026-06-30T12:42 UTC · success · 68 rows upserted
- GitHub Actions `workflow_dispatch` triggered manually → succeeded (18s) · committed fresh sector + index data
- lint 0 · tests 234/234 · build 24 routes 0 errors · supabase:check-macro: 11 indicators healthy

**Yahoo Finance ticker coverage rules:**
- `.SN` suffix required for Bolsa de Santiago stocks (e.g. `LAS-CONDES.SN`, `ITAUCL.SN`)
- Index proxies: `^SPCOSLCP` (Colombia) and `EPU` (Peru) — EPU has no `^` prefix (it is an ETF)
- `SECTOR_MAP` and Python `SECTORS` must stay in sync — both live in `liveOverlay.ts` and `refreshMarketData.py`
- Index proxy labels in `indexPerformance.json` must include "(proxy)" to avoid misrepresenting unofficial data
- `buildIndices` in `liveOverlay.ts` handles ETF symbols without `^` prefix — the INDEX_YF test was updated accordingly

Next options:
- **Phase 4C.2** — Persist daily market snapshots to Supabase `market_snapshots` table
- **Phase 5D.1** — Cron observability: alerting on partial_success runs

---

**Phase 5D — Scheduled BCCh Macro Ingestion (Vercel Cron)** ✓ COMPLETE (validated 2026-06-26)

Daily cron route that upserts the last 14 days of verified BCCh observations into
Supabase. Runs weekdays at 12:30 UTC. Secured with `CRON_SECRET`. Idempotent.

Schedule: `30 12 * * 1-5` (weekday-only; fall back to `* * *` if Hobby plan rejects it)
Production URL: `https://nevada-market-intelligence.vercel.app/api/cron/ingest-bcch-macro`

Manual production trigger result (2026-06-26T19:40Z):
- `status: success` · 11/11 indicators succeeded · `rowsSeen: 2602` · `rowsInserted: 74` · `rowsFailed: 0`
- `ingestionRunId: 3110210a-9db2-4e11-a99f-5674ff13eee2`

**Post-deploy fix (5D hotfix):** Production cron was returning `partial_success` with PGRST125
errors on all 7 daily indicators. Root cause: PostgREST schema cache staleness after
DDL changes (ADD CONSTRAINT, NOT NULL) made during debugging — PostgREST's `NOTIFY pgrst`
is blocked by PgBouncer on Supabase Free tier and doesn't reload immediately.
Separately, `getSupabaseAdminConfig()` was not applying `normalizeProjectUrl()`, meaning
`.env.local` URLs with the Supabase Dashboard's `/rest/v1` suffix would construct
double-path requests. Fixed by adding `normalizeProjectUrl()` to the admin config function.
NEXT_PUBLIC_SUPABASE_URL in `.env.local` and Vercel canonicalized to the bare project URL.
`upsertMacroObservations` reverted to clean `.upsert(onConflict)` — no delete-then-insert.

Files added/changed in 5D + 5D hotfix:
- `src/lib/ingestion/bcchMacroIngestion.ts` — shared incremental/backfill logic; sanitizes errors; records ingestion_runs
- `src/app/api/cron/ingest-bcch-macro/route.ts` — GET route with Bearer CRON_SECRET auth; sanitized JSON response
- `vercel.json` — cron schedule `30 12 * * 1-5`
- `scripts/cron/testBcchMacroCron.ts` — local manual trigger helper
- `scripts/vercel/setPreviewEnv.ts` + `setProductionEnv.ts` — added CRON_SECRET

Production env vars set via `npm run vercel:set-production-env` (4 newly created Supabase
vars; 4 BCCh vars already present from Phase 4B — `failed: 0`). Fresh Production deployment
triggered from Vercel Dashboard. All 6 Production API endpoints validated:

| Endpoint | Result |
|---|---|
| `/api/macro` | 10 indicators · status live (BCCh) · no secrets |
| `/api/macro/history/tpm?timeframe=1Y` | 250 pts · status **persisted** · dbModeUsed supabase |
| `/api/macro/history/usdclp?timeframe=1Y` | 250 pts · status **persisted** · dbModeUsed supabase |
| `/api/macro/history/ipc-anual?timeframe=3Y` | 35 pts · status **persisted** · latest 2026-05-01 |
| `/api/macro/history/imacec-anual?timeframe=3Y` | 34 pts · status **persisted** · latest 2026-04-01 |
| `/api/macro/ingestion-status` | source supabase · 11 indicators · rows_inserted 18,395 |

No credentials, keys, or errors in any response. Production URL: `https://nevada-market-intelligence.vercel.app`

Files added in 5C.3:
- `scripts/vercel/setProductionEnv.ts` — sets 8 Production env vars from `.env.local` via Vercel API; PATCH omits `type` to avoid Sensitive-var type-change error
- `src/lib/db/repositories/macroRepository.ts` — `getMacroObservationSummary()` rewritten: per-indicator targeted queries bypass PostgREST 1,000-row cap
- `package.json` — `vercel:set-production-env` script

---

**Phase 5C.2 — Vercel Preview Supabase Macro Read Path Validation** ✓ COMPLETE

Preview env vars set via `npm run vercel:set-preview-env`. All 5 history endpoints on the
Preview URL confirmed `status: 'persisted'` with `source: 'Persisted BCCh via Supabase'`.
`/api/macro/ingestion-status` confirmed 11 indicators post row-cap fix. No secrets exposed.

Files added in 5C.2:
- `scripts/vercel/setPreviewEnv.ts` — sets 8 Preview env vars from `.env.local` via Vercel API; omits `type` on PATCH for Sensitive vars
- `package.json` — `vercel:set-preview-env` script

---

**Phase 5C.1 — Read Persisted Macro Observations from Supabase** ✓ COMPLETE

Three-layer read priority wired into `resolveMacroHistory()`: Supabase persisted
observations → BCCh live → static fallback. DataSourceStatus gains `'persisted'` (blue dot).

Read priority by DB_MODE:
- `DB_MODE=static` → static macroHistory.json only (unchanged)
- `DB_MODE=supabase` → Supabase only; returns clean unavailable if missing/stale (no BCCh fallback)
- `DB_MODE=hybrid` → Supabase first; falls through to BCCh live then static if observations missing/stale

Files added/changed in 5C.1:
- `src/lib/providers/types.ts` — added `'persisted'` to `DataSourceStatus`; new `MacroDataMeta` fields (`dbModeRequested`, `dbModeUsed`, `persistedAvailable`, `observationCount`, `latestObservationDate`)
- `src/lib/providers/macroProvider.ts` — `resolveMacroHistory()` rewritten with 3-layer logic; imports `getDbMode`, `decideDbSource`, `getMacroObservationsForTimeframe`, `isSufficientHistory`
- `src/lib/db/repositories/macroRepository.ts` — added: `getLatestIngestionRun`, `downsampleMonthly`, `downsampleWeekly`, `downsampleForTimeframe`, `isSufficientHistory`, `getMacroObservationsForTimeframe`, `hasSufficientMacroHistory`; fixed require paths (`../../data` → `../../../data`)
- `src/lib/i18n.ts` — `persisted` key in `dataSource`, `cmfData`, `marketData` sections (EN + ES)
- `src/components/ui/DataSourceBadge.tsx` — `persisted` entry (blue accent dot)
- `src/components/ui/CmfDataSourceBadge.tsx` — `persisted` entry (blue accent dot)
- `src/components/ui/MarketDataSourceBadge.tsx` — `persisted` entry (blue accent dot)
- `src/lib/db/repositories/cmfRepository.ts`, `companiesRepository.ts`, `documentsRepository.ts`, `marketRepository.ts` — fixed same wrong `../../data` require paths
- `src/app/api/macro/ingestion-status/route.ts` — new read-only endpoint: observation counts + recent ingestion runs
- `tests/macroReadPriority.test.ts` — 22 new unit tests for pure helpers
- Build 23 routes · lint 0 · tests 184/184

---

**Phase 5C — BCCh Macro Observations Ingestion** ✓ COMPLETE

Local ingestion pipeline that fetches all 11 verified BCCh series and persists normalized
observations into the `macro_observations` Supabase table.

**Before first run:** paste `supabase/migrations/20260626000000_macro_obs_constraints.sql`
into Supabase Dashboard → SQL Editor and run it (adds UNIQUE constraint + 3 rate indicators).

Key scripts added:
- `npm run ingest:bcch-macro:dry` — preview all series (no writes)
- `npm run ingest:bcch-macro -- --all --write` — full 10Y backfill
- `npm run ingest:bcch-macro -- --indicator tpm --years 1 --write` — single indicator
- `npm run supabase:check-macro` — validate DB counts + latest ingestion run

Files added/changed in 5C:
- `supabase/migrations/20260626000000_macro_obs_constraints.sql` — UNIQUE constraint on macro_observations + 3 missing rate indicators (btu5, swap2y, swap1y)
- `scripts/ingest/bcchMacroCore.ts` — pure testable logic (parseArgs, buildObservationRows, chunk, sanitizeError; INGESTION_VERSION=5C.0)
- `scripts/ingest/bcchMacro.ts` — CLI script (dry-run default, --write for DB, sequential BCCh requests, 500-row batches, records ingestion_runs)
- `scripts/supabase/checkMacroObservations.ts` — validation: counts/date-range/latest-value per indicator
- `src/lib/db/repositories/macroRepository.ts` — added: upsertMacroObservations, getMacroObservations, getLatestMacroObservation, getMacroObservationSummary, getMacroIngestionStatus
- `src/lib/supabase/database.types.ts` — fixed macro_observations.Insert to include fetched_at
- `package.json` — ingest:bcch-macro, ingest:bcch-macro:dry, supabase:check-macro scripts
- `tests/bcchMacroIngest.test.ts` — 28 new tests for pure functions
- Build 22 routes · lint 0 · tests 162/162

Next options:
- **Phase 5D** — add scheduled refresh so Supabase observations stay current (Vercel cron or manual trigger)
- **Phase 4C.1** — Brain Data credentials + live market price provider

---

**Phase 5B.1 — Supabase Project Link & Seed** ✓ COMPLETE

Supabase project `nevada-market-intelligence` linked, migration applied via SQL Editor,
reference data seeded. DB_MODE=hybrid active locally. Static fallback still works with no env vars.

Key fixes applied during 5B.1:
- `src/lib/supabase/env.ts`: `normalizeProjectUrl()` strips `/rest/v1/` suffix from the URL
  (Supabase Dashboard REST URL field includes it; the JS client needs the bare project URL)
- `scripts/supabase/checkConnection.ts`: loads `.env.local` via `@next/env`; fixed false-positive
  bug where PGRST205 schema-cache errors were misclassified as "present"
- `scripts/supabase/applySeed.ts`: new JS seed runner (`npm run supabase:seed`) using admin client;
  idempotent; skips `data_sources` if already seeded (no unique constraint on `provider`)
- Supabase CLI (`supabase.exe`) is blocked by Windows security policy on this machine —
  migration and seed were applied via SQL Editor instead; `npm run supabase:check` uses JS client only

Verified state (project cnxfougkpynovlwsmmdz):
  11 tables present · data_sources 4 · companies 25 · macro_indicators 25
  Build 22 routes · lint 0 · tests 134/134

**Phase 5B — Supabase Persistence Foundation** ✓ COMPLETE

Schema-first, repository-layer-first Supabase integration. No production behaviour changed.
Static fallback always active; app builds and runs with zero env vars.
DB_MODE defaults to `static`; set to `supabase` or `hybrid` once a project is linked (Phase 5B.1).

Files added/changed:
- `@supabase/supabase-js` + `@supabase/ssr` added to dependencies
- `src/lib/supabase/types.ts` — `SupabaseConfig`, `SupabaseAdminConfig`
- `src/lib/supabase/env.ts` — `getSupabasePublicConfig()`, `getSupabaseAdminConfig()`, `isSupabaseConfigured()`
- `src/lib/supabase/database.types.ts` — provisional manual types (11 tables)
- `src/lib/supabase/client.ts` — browser singleton (`'use client'`, `NEXT_PUBLIC_*` only)
- `src/lib/supabase/server.ts` — server client for route handlers (no cookie management until Phase 6)
- `src/lib/supabase/admin.ts` — service-role admin client (server-only; bypasses RLS)
- `src/lib/db/types.ts` — `DbMode`, `DbResult<T>`, `DbListResult<T>`
- `src/lib/db/dbMode.ts` — `parseDbMode()`, `getDbMode()`, `decideDbSource()`
- `src/lib/db/repositories/companiesRepository.ts` — `getCompanies()`, `getCompanyByTicker()`
- `src/lib/db/repositories/macroRepository.ts` — `getMacroIndicators()`, `getMacroHistory()`
- `src/lib/db/repositories/marketRepository.ts` — `getStockSnapshots()`, `getIndexSnapshots()`, `getSectorPerformance()`
- `src/lib/db/repositories/cmfRepository.ts` — `getCmfFilings()`, `getCmfFiling()`
- `src/lib/db/repositories/documentsRepository.ts` — `getDocuments()`, `getDocumentById()`
- `src/lib/db/repositories/ingestionRunsRepository.ts` — `getIngestionRuns()`, `createIngestionRun()`
- `supabase/migrations/20260625000000_create_market_intelligence_core.sql` — 11 tables, RLS, updated_at triggers
- `supabase/seed.sql` — data_sources, companies (25), macro_indicators (25); all `static_mvp` tagged; upsert-safe
- `scripts/supabase/checkConnection.ts` — `npm run supabase:check`
- `scripts/supabase/generateSeed.ts` — `npm run supabase:generate-seed`
- `scripts/supabase/applySeed.ts` — `npm run supabase:seed`
- `docs/supabase_persistence.md` — setup guide, architecture, schema reference, security notes
- `tests/dbMode.test.ts` — 10 tests for `parseDbMode` + `decideDbSource`
- `tests/supabaseEnv.test.ts` — 4 tests for env detection (no vars)
- `tests/supabaseSchema.test.ts` — 6 tests for migration + seed file integrity
- `.env.example` — `DB_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DATABASE_URL`
- `package.json` — `supabase:check`, `supabase:generate-seed`, `supabase:seed` scripts
- Build 22 routes · lint 0 · tests 134/134 · static fallback works with no env vars

Next: **Phase 4C.1** — Brain Data credentials + live market price provider.
Or: **Phase 5A.2-alt** — CMF alternative ingestion (official CMF API, paid data feed, or manual pipeline).
Or: **Phase 5C** — Persist BCCh macro observations into Supabase `macro_observations` table.

---

**Phase 4C — Chilean Market Data Provider Architecture** ✓ COMPLETE

Provider abstraction for Chilean equity/index data (Brain Data / Bolsa de Santiago),
mirroring the BCCh macro pattern. All Brain Data methods return `ok:false` (shell)
until Phase 4C.1 obtains official credentials and confirms endpoint paths.

Files added/changed:
- `.env.example` — `MARKET_DATA_MODE`, `BRAIN_DATA_API_BASE_URL`, `BRAIN_DATA_API_KEY` placeholders
- `docs/market_data_provider_discovery.md` — Brain Data discovery document (auth unknown, all endpoints `❓`)
- `src/lib/providers/market/types.ts` — provider-facing types: `StockSnapshot`, `StockHistoryPoint`, `IndexSnapshot`, `SectorSnapshot`, `MarketProvider`, `MarketDataMeta`
- `src/lib/providers/market/marketDataMode.ts` — `parseMarketDataMode()`, `decideMarketSource()`
- `src/lib/providers/market/staticMarketProvider.ts` — wraps JSON data layer behind `MarketProvider` contract
- `src/lib/providers/market/brainDataProvider.ts` — shell; every method returns `ok:false` with clear reason; `void param` for unused typed args
- `src/lib/providers/market/marketProvider.ts` — orchestrator with 5 `resolve*` functions
- `src/app/api/market/stocks/route.ts` — `GET /api/market/stocks`
- `src/app/api/market/stocks/[ticker]/route.ts` — `GET /api/market/stocks/[ticker]`
- `src/app/api/market/stocks/[ticker]/history/route.ts` — `GET /api/market/stocks/[ticker]/history?timeframe=`
- `src/app/api/market/indices/route.ts` — `GET /api/market/indices`
- `src/app/api/market/sectors/route.ts` — `GET /api/market/sectors`
- `src/lib/data/marketData.ts` — client-safe async fetch helpers (`fetchStockSnapshots`, etc.)
- `src/config/tickerMap.ts` — 25 Chilean equity ticker mappings, all `verified:false` / `providerSymbol:null`
- `src/config/marketDataProviders.ts` — Brain Data config + `isBrainDataConfigured()`
- `src/components/ui/MarketDataSourceBadge.tsx` — market-specific source badge
- `src/lib/i18n.ts` — `marketData.*` section (en/es)
- `tests/marketDataMode.test.ts` — 9 tests for `parseMarketDataMode` + `decideMarketSource`
- `tests/marketProvider.test.ts` — 10 tests for Brain Data shell + ticker map invariants
- Build 19 routes · lint 0 · tests 72/72 · static fallback works with no env vars

Next: **Phase 4C.1** (obtain Brain Data credentials, confirm endpoints, implement actual provider calls)
or **Phase 5** (Supabase persistence).

---

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
