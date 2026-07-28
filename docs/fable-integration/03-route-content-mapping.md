# 03 — Route ↔ Content ↔ Fable Mapping

> **Audit phase — no application code changed.** One entry per existing NMI route. Each entry
> carries all 14 required fields: route · page title · every content section · data source/API
> · user interactions · loading state · empty state · error state · auth status · Fable
> destination screen · Fable component mapping · new component required · implementation status
> · verification status.
>
> **Implementation status** and **Verification status** are seeded for the whole migration:
> at this planning point every route is `Not started` / `Not verified`. These two columns are
> the live tracking surface — update them per route as the re-skin proceeds.

Legend — Fable screens (see doc 02 §3): `0 Login · 1 Overview · 2 Portfolio · 3 Performance ·
4 Risk · 5 Fixed Income · 6 Structured Notes · 7 Macro · 8 Research · 9 Documents · 10 Admin`.

---

## Master mapping table (at-a-glance)

| # | Route | Page title | Auth | Fable destination | New component(s) required? | Impl. status | Verif. status |
|---|---|---|---|---|---|---|---|
| 1 | `/` | Market Overview | public | 1 Overview (visual lang.) | Yes — News feed, Sector heat map, Chilean-rates DnD, band-macro card | Not started | Not verified |
| 2 | `/stocks` | Stocks | public | 2 Portfolio (DataTable) | No (reused Phase 3 `TableCard`) | **✓ Phase 5A (2026-07-28)** | **✓ Source + rendered-markup verified** |
| 3 | `/compare` | Compare | public | 3 Performance (chart+table) | No (reused Phase 3 `TableCard`/`GlassSurface`/`SegmentedControl`) | **✓ Phase 5D (2026-07-28)** | **✓ Source + rendered-markup verified** |
| 4 | `/chart-builder` | Charting | public | 3 Performance (chart) | No (reused Phase 3 `TableCard`/`GlassSurface`/`SegmentedControl`) | **✓ Phase 5E (2026-07-28)** | **✓ Source-scan verified** |
| 5 | `/macro` | Macroeconomic Indicators | public | 7 Macro | Yes — banded indicators table, yield curve, FX depth, chart popup | Not started | Not verified |
| 6 | `/macro/calendar` | Economic Calendar | public | 7 Macro / 9 Documents table | Yes — release calendar table, FOMC outlook card | Not started | Not verified |
| 7 | `/earnings` | Earnings | public | 8 Research (upcoming earnings) / DataTable | Yes — upcoming + results tables | Not started | Not verified |
| 8 | `/companies/[ticker]` | Stocks · TICKER | public | 2 Portfolio detail panel + 3 Performance | Yes — company detail (KPI capsules, chart, valuation grid, results, news) | Done | Verified |
| 9 | `/watchlist` 🔒 | Watchlist | protected | 2 Portfolio (DataTable) | No (reused Phase 3 `TableCard` + `AsyncState`) | **✓ Phase 5B (2026-07-28)** | **✓ Source + protected-route verified** |
| 10 | `/portfolio` 🔒 | Portfolio | protected | 1 Overview + 2 Portfolio + 4 Risk | Yes — summary hero cards, sector exposure, positions/transactions/cash tabs | Not started | Not verified |
| 11 | `/structured-notes` 🔒 | Structured Notes | protected | 6 Structured Notes | Yes — barrier gauge, upload/extract panel, dashboard KPIs, bar/donut | Not started | Not verified |
| 12 | `/structured-notes/[id]` 🔒 | note ISIN/name | protected | 6 SN detail panel | Yes — terms grid, current-levels table, schedule, allocation grid | Not started | Not verified |
| 13 | `/settings/notifications` 🔒 | Notification Settings | protected | 10 Administration | Yes — recipients table, add form | Not started | Not verified |
| 14 | `/login` | Sign in / Create account | public (auth) | 0 Login | Yes — cinematic login shell, glass auth panel | Not started | Not verified |
| 15 | `/forgot-password` | Reset your password | public (auth) | 0 Login (variant) | Yes — auth-panel variant | Not started | Not verified |
| 16 | `/auth/reset-password` | Set a new password | public (auth) | 0 Login (variant) | Yes — auth-panel variant | Not started | Not verified |

> Every route needs at least some new/adapted components because NMI's data footprint is
> **richer** than the Fable sample on most screens (merge-contract point 3). Only `/stocks`,
> `/watchlist`, and the Structured Notes pages have a near-direct Fable screen counterpart.

---

## 1. `/` — Market Overview

- **Page title:** `t.home.title` ("Market Overview" / "Vista General de Mercado"); eyebrow
  `t.home.tag`, subtitle `t.home.subtitle`. Custom `<h1>` (not `SectionHeader`).
- **Content sections:** (1) **Macro card** — one card, two banded sections Chile
  (`CHILE_MACRO_IDS`) + US (`US_MACRO_IDS`), rows via local `MacroRow`, measured height
  `macroH`. (2) **Watchlist + FX card** — one table, band-separated: user's real Supabase
  watchlist + BCCh FX pairs. (3) **Earnings card** — Upcoming (CMF EEFF ≤7 days) + Recently
  Reported (5 most-recent CMF dates). (4) **Sector heat map** — 10 magnitude-shaded tiles
  (`grid-cols-2 sm:grid-cols-3`), best/worst contributor, diverging legend, measured `heatH`.
  (5) **Chilean Rates** — drag-to-reorder list (`⠿` grip) + live BCCh overlay. (6) **Markets**
  — index list. (7) **News** — live source-backed feed (DF / La Tercera), high-impact red bar,
  source code + timestamp, affected-ticker chips, status dot.
- **Data source / API:** static `getAllCompanies/Snapshots`, `getAllIndicators/getByCategory`,
  `getChileanRates`, `getSectorPerformance`, `getIndexPerformance`; hooks `useMarketData`,
  `useMacroData`, `useGlobalRefresh`; mount fetches `fetchStockSnapshots`,
  `fetchSectorPerformance`, `fetchIndexPerformance`, `fetchLiveNews`, `fetchEarningsCalendar`;
  direct `GET /api/watchlists` + `/items`. Merge priority static → persisted → live.
- **User interactions:** `UpdateDataButton`; watchlist sortable headers (Day Chg./YTD); rates
  drag-to-reorder (persist `cmi.ratesOrder`); links to `/watchlist`, `/login`,
  `/companies/{ticker}`, external news URLs.
- **Loading state:** earnings → `t.common.loading`; news header → `t.home.newsLoading`.
- **Empty state:** watchlist sign-in/empty prompts; `t.home.noUpcoming`; `t.home.newsEmpty`.
- **Error state:** all mount fetches `.catch(()=>null)` → static fallback; watchlist 401 →
  sign-in prompt.
- **Auth:** public (watchlist section degrades to a sign-in prompt when unauthenticated).
- **Fable destination:** **1 Overview** (visual language only — Fable Overview's
  portfolio-centric modules are NOT NMI Home content).
- **Fable component mapping:** Macro card → glass card + macro snapshot rows (sparklines);
  Watchlist/FX → glass DataTable; Earnings → glass card + event/timeline list; Sector heat map
  → **no direct Fable analog** (closest is the allocation-bar/monthly-returns tint language) →
  reuse tint scale; Chilean Rates → glass list rows; Markets → macro snapshot rows; News → glass
  card list w/ severity dots (like notification drawer rows).
- **New component required:** **Yes** — News feed card, Sector heat-map tile grid,
  Chilean-rates drag list, banded dual-region Macro card. All in Fable glass language.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 2. `/stocks` — Stocks

- **Page title:** `SectionHeader` `t.stocks.tag`/`title`/`subtitle`.
- **Content sections:** (1) toolbar (search, sector select, `MarketDataSourceBadge`, Export
  CSV); (2) Stocks table (9 cols: Ticker·Company·Sector·Price·Day Chg.·YTD·Market Cap·P/E·Div
  Yield, sticky header, `min-w-[760px]` inner scroll, source footer + count).
- **Data source / API:** static `getAllCompanies/Snapshots/getSectors`; `useMarketData`
  (+`refreshSeq`), `useGlobalRefresh`; mount `fetchStockSnapshots`. Cell merge live→persisted→
  static.
- **User interactions:** `SearchInput`; sector `<select>`; sortable headers (derived default
  Day Chg. desc until user sorts; refresh clears manual sort via `refreshSeq`); Export CSV;
  `UpdateDataButton`; ticker links → company page.
- **Loading state:** none (static renders, live overlays).
- **Empty state:** `t.common.noResults` row.
- **Error state:** `fetchStockSnapshots().catch(()=>{})`.
- **Auth:** public.
- **Fable destination:** **2 Portfolio** (its holdings DataTable IS this pattern).
- **Fable component mapping:** glass **DataTable** (sticky header, sortable `<th>`, row hover,
  in-card horizontal scroll); toolbar → glass search pill + segmented sector filter +
  Export chip; `MarketDataSourceBadge` → status chip; footer → meta line.
- **New component required:** No (reuse the glass DataTable + toolbar patterns; preserve NMI
  source badge/footer semantics).
- **Impl. status:** **✓ COMPLETE — Phase 5A (2026-07-28)** · **Verif. status:** **✓ verified**
  (74 new source-scan tests + rendered-markup checks against a live dev server; browser
  responsive ladder still outstanding — see below).

**Phase 5A — as built.** Presentation only; every data line is byte-for-byte unchanged.
- **Container:** the hand-rolled `bg-surface border border-border rounded overflow-x-auto` card
  became the Phase 3 **`TableCard`** (`GlassSurface card` shell → `GlassSurface dense` body →
  `minWidth={760}` scroll → one designated footer slot). The 760px floor and the in-card scroll
  are preserved exactly, now supplied by the shared component.
- **Toolbar** moved into `TableCard`'s `controls` slot as Fable's in-card toolbar: search pill +
  pill sector select inside a `role="group" aria-label={t.stocks.filters}`, then
  `MarketDataSourceBadge` (`ml-auto`) and the Export CSV chip.
- **Sector filter stays a `<select>`**, restyled as a Fable pill (`appearance-none` + token
  chevron). Deliberately **not** `SegmentedControl`: the sector list is 10+ entries and a pill
  rail that long would either wrap into a multi-row block or scroll away the later sectors,
  against the zero-page-overflow rule. Semantics (single-select, keyboard, mobile-native picker,
  `All Sectors` default) are unchanged.
- **Table:** sticky header now sits on `var(--surface-table)` (§8 near-opaque, was
  `bg-surface-2`); sortable `<th scope="col">` carry `aria-sort` (`ascending`/`descending`/`none`)
  and wrap a real `<button>` with a `Sort by {column}` title; the `↑/↓` glyph is `aria-hidden`
  (decorative — `aria-sort` is authoritative); rows use `nv-row-hover nv-transition` (tint, never
  blur/shadow); the six numeric columns are right-aligned so tabular numerals line up (**alignment
  only — no column added, removed, reordered, renamed, or de-sorted**); cell type moved to
  `var(--fs-table-cell)`; an `sr-only <caption>` names the table.
- **Empty state** renders through Phase 3 `AsyncState kind="empty"` **carrying its own exact
  message** (`t.common.noResults`), so it stays distinguishable from loading/error/unavailable.
- **Motion:** two `Reveal` wrappers (0ms header / 70ms card — the Fable stagger). No count-up, no
  pulse, nothing animating a market value (§12.2). Reduced motion is handled by the global block.
- **Deliberately NOT added:** no KPI strip, hero, chart, sparkline, or sector heat map. `/stocks`
  has never carried any of them and no data on this route backs one — inventing market-summary
  numbers here would be fabricated content, not a re-skin. The only summary figure that exists
  (the filtered row count) is preserved, now with `aria-live="polite"`.
- **Deliberately NOT changed:** the silent `fetchStockSnapshots().catch(() => {})` fallback. The
  page has no loading state today because static data renders synchronously; adding a spinner
  would delay readable data for no gain (§12.2), and the `Static` badge is already the honest
  carrier of the degraded state.
- `SearchInput` was restyled in place to the Fable search pill (999px, chip fill/border, inline
  glyph, `aria-label`, `min-w-0 flex-1` + `max-width` instead of a fixed pixel width). In scope
  because **`/stocks` is its only consumer in the entire repo** (grep-verified, and locked by a
  test).

## 3. `/compare` — Compare

- **Page title:** `SectionHeader` `t.compare.tag`/`title`/`subtitle`.
- **Content sections:** (1) Market Data table (Security·Price·1D·5D·1M·YTD·1Y·Mkt Cap Bn·
  Sector); (2) Comparative Returns table (6 editable ticker slots, Total/Difference/Annualized,
  color swatches); (3) Fundamentals table (12 rows, best/worst highlight, `•` derived marker,
  Export CSV); (4) control bar (timeframe 1M/YTD/1Y/3Y/5Y, Period D/W/M, custom Range, Legend);
  (5) Cumulative Return chart (`CompareChart`); (6) Settings modal (diff-vs, per-slot colors,
  chart opts, table highlight).
- **Data source / API:** static `getAllCompanies/Snapshots`, `getStockSeriesByPeriod`;
  `useMarketData`, `useGlobalRefresh`; `fetchCompareData`→`/api/compare`,
  `fetchCompareHistory`→`/api/compare/history`; return math `@/lib/returns`.
- **User interactions:** 6 ticker slots (`cmi.compareSlots`), TF buttons, Period select, Range
  date inputs, Legend checkbox, **Settings modal** (Esc-close), Export CSV, `UpdateDataButton`
  (bumps `compareRefreshSeq`), legend/color pickers. Persisted `cmi.compare*` (11 keys).
- **Loading state:** none (keeps previous data on transient failure).
- **Empty state:** Fundamentals `t.compare.empty`; cells `—`.
- **Error state:** try/catch keeps previous; `.catch(()=>setPersistedHistory({}))`; "history
  accumulating" note when persisted history genuinely insufficient.
- **Auth:** public.
- **Fable destination:** **3 Performance** (chart + comparison tables).
- **Fable component mapping (as-built, Phase 5D):** all 3 tables (Market Data, Comparative
  Returns, Fundamentals) → `TableCard` (dense near-opaque surface, sticky headers, card-level
  `overflow-x-auto` via `minWidth`); control bar + chart card → `GlassSurface variant="card"`;
  TF (1M/YTD/1Y/3Y/5Y) and Period (D/W/M) → `SegmentedControl`; Settings modal → the established
  `nv-scrim` + `nv-glass-overlay nv-pop` overlay pattern (same recipe as `CommandPalette`);
  ticker slot inputs, color swatches, date-range inputs, and pill buttons → Fable chip
  (`--nv-chip`/`--nv-chipbd`) styling; section entrance → 3 staggered `Reveal` wrappers (header
  at 0ms is un-staggered; Market Data 70ms; Returns+Fundamentals row 130ms; control bar+chart
  190ms). `CompareChart` itself was untouched (already Fable-tokenized in Phase 4).
- **New component required:** **No** — every primitive already existed from Phase 3/4;
  `MarketDataSourceBadge`/`TableSourceFooter` preserved exactly (2 badges, 4 footers).
- **Impl. status:** ✓ Phase 5D (2026-07-28) · **Verif. status:** ✓ Source + rendered-markup
  verified (`GET /compare` → 200, Fable material classes present in the served HTML).

## 4. `/chart-builder` — Charting (Graph Fundamentals)

- **Page title:** `SectionHeader` `t.charting.tag`/`title`/`subtitle`.
- **Content sections:** (1) toolbar (primary ticker input, "vs" ticker, Absolute/Indexed
  toggle, TTM/Annual toggle, `SourceStateBadge`, Settings); (2) selected metric chips;
  (3) categorized metric picker (~21 metrics, 4 categories); (4) `FundamentalsChart` (dual-axis
  bars/lines); (5) underlying data table (Export CSV); (6) Settings modal.
- **Data source / API:** static `getFundamentals`; `fetchFinancialStatements(ticker)` for A + B
  overlay (CMF XBRL/FECU/bank/Yahoo/manual); persisted precedence.
- **User interactions:** 2 ticker inputs (`cmi.gfTicker/gfTickerB`, datalist), Absolute/Indexed,
  TTM/Annual, metric picker, chip removes, Export CSV, Settings (Esc-close), `gf:ticker` window
  event (deep-linked from Company). Persist `cmi.gf*` (8 keys).
- **Loading state:** none (static then persisted overlay).
- **Empty state:** `t.charting.noData` / `t.charting.selectMetric`.
- **Error state:** `.catch(()=>setPersistedA(null))` → static.
- **Auth:** public.
- **Fable destination:** **3 Performance** (chart-centric analysis).
- **Fable component mapping:** `FundamentalsChart` → Fable chart SVG (dual-axis, bars+lines,
  chart palette); metric picker → glass list with color dots + chips; toggles → segmented
  pills; `SourceStateBadge` → status chip; underlying table → glass DataTable.
- **New component required:** **No** — every primitive already existed from Phase 3/4;
  `SourceStateBadge`/`TableSourceFooter` preserved exactly (1 badge, 2 footers).
- **Impl. status:** ✓ Phase 5E (2026-07-28) · **Verif. status:** ✓ Source-level (112 new tests in
  `tests/fableChartBuilderPage.test.ts`; build 0 errors, `/chart-builder` still static/`○`).

**Phase 5E — as built.** Presentation only; every hook, computed value (`records`, `periods`,
`series`, `canTTM`/`effFreq`, `financialsBadgeKey`, `fmtBar`/`fmtAxis`/`fmtLine`/`fmtCell`,
`handleExport`) and fetch effect is byte-for-byte unchanged.
- **Container:** toolbar/metric-picker/chart panel moved from hand-rolled `bg-surface
  border border-border rounded` divs to `GlassSurface variant="card"` (3 instances); the
  underlying-data table moved to `TableCard` (`minWidth={640}`) — closing a genuine pre-existing
  gap (this table previously had no `min-w`, so a ticker with many TTM/annual periods could force
  page-level horizontal scroll; it now scrolls card-level like every other migrated table).
- **Toggles:** Absolute/Indexed and TTM/Annual moved from the page-local `Seg` button component
  (now deleted — no longer used anywhere) to two `SegmentedControl` adopters (3rd/4th after
  Company's chart-timeframe and Compare's TF/Period). The TTM option's disabled-state explanation
  (`t.charting.ttmUnavailable`) is preserved via a wrapping `<span title=…>` around the control,
  since disabling a reason string per-option isn't part of the shared component's contract and
  changing it would be a new feature to a component two other pages depend on, not a re-skin.
- **Ticker inputs, settings gear, Export CSV button, chartType select:** restyled to the
  established Fable chip recipe (`rounded-full`, `--nv-chip`/`--nv-chipbd`), matching Compare's
  ticker-slot and control-bar inputs exactly.
- **Settings modal:** restyled onto the exact `nv-scrim` + `nv-glass-overlay nv-pop` overlay recipe
  `CommandPalette`/Compare established — same content (chart type, legend, gridlines), only the
  container material and control chrome changed.
- **Empty states:** the "no data" / "select a metric" message now routes through the shared
  `AsyncState kind="empty"` component (message override, exact original copy preserved) instead of
  a bare `<div>` — same trigger condition, now with proper `role="status" aria-live="polite"`.
- **Two real, pre-existing i18n gaps fixed in passing** (found while already on these exact lines,
  same as Compare's `clearRange` fix): the literal `vs` separator between the two ticker inputs and
  the metric-chip remove button's hardcoded `aria-label="Remove"` were both English-only; now
  `t.charting.vs` and `t.charting.removeMetric` (EN+ES). Two new `SegmentedControl` `ariaLabel`
  keys added: `t.charting.modeLabel`, `t.charting.freqLabel`. Metric-picker buttons gained
  `aria-pressed` (their selected state was previously colour/weight-only).
- **Deliberately NOT changed:** `FundamentalsChart.tsx` (same props/call signature, untouched since
  Phase 4); no reset/clear-all/save/print action was invented (none existed); no `asOf` timestamp
  was invented (this route never had one); the underlying-table's conditional hide-when-empty
  behaviour is preserved exactly (not converted to an always-visible `TableCard` empty state, unlike
  Compare's Fundamentals table — that was Compare's own judgement call for that specific table, not
  a new platform default).
- All 8 `cmi.gf*` persisted keys and the `gf:ticker` deep-link window event (Company page's "Graph
  fundamentals →" link) are unchanged.

## 5. `/macro` — Macroeconomic Indicators

- **Page title:** `SectionHeader` `t.macro.tag`/`title`; CL/US subtitle; region badge chip.
  Region driven by sidebar `macro:region` event (`cmi.macroRegion`).
- **Content sections:** (1) Economic calendar embed (US only, `EconomicCalendarTable` + link);
  (2) banded indicators table (category bands; chartable rows open popup; Chile Rates uses full
  `getChileanRates`); (3) `YieldCurveChart` (Today/1wk/prior-year-end); (4) FX depth table (US
  only, Frankfurter, `†` derived); (5) chart popup modal (`LineChart`, 1Y/3Y/5Y/10Y).
- **Data source / API:** static `getAllIndicators`, `getChileanRates`, `getYieldCurve`,
  `getMacroHistoryForTimeframe`; `useMacroData`(+`refreshSeq`), `useGlobalRefresh`;
  `fetchMacroIndicators`, `fetchMacroHistory`, `fetchLiveYieldCurve`, `fetchUsForexTable`,
  `fetchFredReleaseCalendarRange`.
- **User interactions:** `UpdateDataButton` (bumps `macroRefreshSeq` → refetch 4 effects); row
  click → chart popup (Esc/backdrop/✕); modal timeframe buttons; region change via sidebar;
  "View full calendar" link; `†` tooltip.
- **Loading state:** static renders; live swaps in.
- **Empty state:** `t.cal.fredEmpty`/`fredUnavailable`, `t.macro.fxUnavailable`,
  `t.macro.noHistory`.
- **Error state:** falls back to static; `AbortController` on unmount.
- **Auth:** public.
- **Fable destination:** **7 Macro** (direct — Chile card + Global card, metric rows).
- **Fable component mapping:** indicators → **macro snapshot rows** (metric/source/timestamp/
  previous + sparkline + value + signed delta) inside Chile/Global glass cards; calendar →
  upcoming-releases card (HIGH/MEDIUM chips); yield curve → chart SVG; FX depth → glass
  DataTable; chart popup → glass overlay + Fable line chart. Preserve `DataSourceBadge`/
  `SourceStateBadge`/`TableSourceFooter`.
- **New component required:** **Yes** — banded indicators table, yield-curve restyle, FX depth
  table, chart popup modal (Fable overlay). Sparkline component is a Fable addition.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 6. `/macro/calendar` — Economic Calendar

- **Page title:** `SectionHeader` `t.macro.tag`/`t.cal.title`/`subtitle`; "← Back to Macro".
- **Content sections:** (1) FRED release calendar (`EconomicCalendarTable`, 60d, enriched
  actual/previous, "Dates only" pill); (2) FOMC market-implied rate outlook (Window·Expected·
  P(Below)·P(In)·P(Above), target-range header); (3) Chile release calendar (deferred block).
- **Data source / API:** `fetchFredReleaseCalendar(60)`, `fetchFomcExpectations()`.
- **User interactions:** "← Back to Macro" link only (otherwise static tables).
- **Loading state:** none (renders empty then populates).
- **Empty state:** `t.cal.fredUnavailable`/`fredEmpty`; `t.cal.fomcOutlookUnavailable`; Chile
  `t.cal.chileUnavailable`.
- **Error state:** guards `fred.configured`; FOMC hidden if `unavailable`.
- **Auth:** public.
- **Fable destination:** **7 Macro** (upcoming-releases treatment) / **9 Documents** table lang.
- **Fable component mapping:** calendar → glass DataTable + HIGH/MEDIUM chips + "Dates only"
  version-chip; FOMC → glass capsule card; deferred block → muted glass empty state. Preserve
  `TableSourceFooter`.
- **New component required:** **Yes** — release-calendar table, FOMC outlook card.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 7. `/earnings` — Earnings

- **Page title:** `SectionHeader` `t.earnings.tag`/`title`/`subtitle`.
- **Content sections:** (1) Upcoming table (CMF EEFF next 45d: Ticker·Period·Expected); (2)
  Recent Results table (rolling 2 quarters/ticker: Ticker·Company·Period·Cur.·Revenue·Rev.YoY·
  EBITDA·EBITDA YoY·Net Income·Net Inc.YoY·EPS, Export CSV, footer + amounts note + count).
- **Data source / API:** `useGlobalRefresh`; `fetchEarningsCalendar`→`/api/earnings/calendar`,
  `fetchEarningsResults(force)`→`/api/earnings/results` (6h cache).
- **User interactions:** `UpdateDataButton` (force-refetch both), Export CSV, ticker links.
- **Loading state:** `t.common.loading` in cells.
- **Empty state:** `t.earnings.noUpcoming`; `t.common.noResults`.
- **Error state:** all fetches `.catch(()=>null)`.
- **Auth:** public.
- **Fable destination:** **8 Research** (Upcoming-earnings module) + glass DataTable.
- **Fable component mapping:** Upcoming → event/timeline chips or glass DataTable; Recent
  Results → glass DataTable w/ signed-delta coloring; `MarketDataSourceBadge` → status chip.
  Preserve bank-no-EBITDA tooltip + `TableSourceFooter`.
- **New component required:** **Yes** — upcoming + results tables in glass language.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 8. `/companies/[ticker]` — Company Detail

- **Page title:** `SectionHeader` tag=`sym` title=`company.name` subtitle=`sector·industry·
  exchange`; breadcrumb `/stocks / {sym}`.
- **Content sections:** (1) KPI strip (6, `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`); (2)
  Business summary card; (3) Business model / drivers / risks cards; (4) Price chart
  (`LineChart`, 8 timeframes 1D…5Y, EEFF markers, Print/Watchlist actions); (5) Recent Results
  table (+ "Graph fundamentals →"); (6) Valuation 3×3 grid (sector medians, drives `valH`); (7)
  Recent news (ticker-filtered, high-impact bar).
- **Data source / API:** static `getCompanyByTicker/getSnapshotByTicker/getAllCompanies/
  getAllSnapshots/getStockHistoryForTimeframe`; `useMarketData`, `useGlobalRefresh`;
  `fetchStockSnapshot`, `fetchLiveNews`, `fetchEarningsResults`, `fetchEarningsCalendar`
  (markers), `fetchValuation` (KPIs+Valuation), `fetchStockHistory` (chart).
- **User interactions:** `UpdateDataButton`; **Print** (`window.print()`); Watchlist link;
  chart timeframe buttons (`cmi.chartTimeframe`); "Graph fundamentals →" (sets `cmi.gfTicker` +
  `gf:ticker` event → `/chart-builder`); breadcrumb/earnings/news links.
- **Loading state:** Valuation/Recent Results `t.common.loading`; chart "no data" fallback.
- **Empty state:** no company → `EmptyState` `t.company.noData`; chart <2 pts → `t.common.noData`.
- **Error state:** all fetches `.catch()` → static fallback.
- **Auth:** public.
- **Fable destination:** **2 Portfolio** position-detail side panel + **3 Performance** chart.
- **Fable component mapping:** KPI strip → **KPI capsules** (+ count-up); chart → Fable
  performance chart w/ event chips (EEFF markers); Valuation grid → capsule grid w/ sector
  median sub; Recent Results → glass DataTable; news → glass list w/ severity dots; business
  cards → glass cards. Print path must survive. Preserve `MarketDataSourceBadge` +
  4× `TableSourceFooter`.
- **New component required:** **Yes** — full company detail composition (as a full page, not
  just Fable's side panel). Reuses KPI-capsule, chart, DataTable, glass-card patterns.
- **Impl. status:** Done (2026-07-28) · **Verif. status:** Verified (lint 0, build 0 errors, full
  test suite green except the 3 pre-existing date-dependent News tests, unrelated). Shipped as a
  full page — no side panel introduced, per decision D4 in the risk register. KPI strip uses
  `KpiCapsule` (plain metrics) + `GlassSurface variant="kpi"` + `ChangeIndicator` (Day Chg./YTD, so
  change direction is never color-only); business summary/model/drivers/risks and the price-chart
  card use `GlassSurface variant="card"`; the 8-timeframe selector is the first production adopter
  of `SegmentedControl`; Recent Results and the Valuation 3×3 grid are hand-composed from
  `GlassSurface variant="card"` (header/footer) + `GlassSurface variant="dense"` (data region) —
  matching `TableCard`'s internal material structure without altering the shared component, since
  this page's pinned-height + internal-vertical-scroll requirement (`--pin-h`, `valH`
  `ResizeObserver`) doesn't fit `TableCard`'s current (horizontal-only) scroll model; loading/empty
  states route through `AsyncState` with the pre-existing exact copy passed via its `message`
  override so wording is byte-identical to before. All 7 content sections, the 8 timeframes, EEFF
  markers, `cmi.chartTimeframe` persistence, Print, and the Watchlist/"Graph fundamentals →" links
  are unchanged. Zero API/provider/data-layer files touched.

## 9. `/watchlist` 🔒 — Watchlist

- **Page title:** `SectionHeader` `t.watchlist.tag`/`title`/`subtitle`; actions = add-ticker form.
- **Content sections:** (1) add-ticker form (datalist input, Add, inline feedback); (2)
  watchlist table (Ticker·Company·Sector·Price·Day Chg.·YTD·remove×, `min-w-[620px]`, footer).
- **Data source / API:** static `getAllCompanies/Snapshots` (prices are static sample here);
  `GET/POST/DELETE /api/watchlists/{id}/items`, `GET /api/watchlists`.
- **User interactions:** add-ticker submit; remove × per row (busy state); ticker links; client
  validation vs `VALID_TICKERS`.
- **Loading state:** "Loading…" card.
- **Empty state:** `t.watchlist.emptyWatchlist` card.
- **Error state:** add form 409/422/network messages; fetch errors → empty state.
- **Auth:** **protected** (middleware → `/login?next=/watchlist`).
- **Fable destination:** **2 Portfolio** (DataTable).
- **Fable component mapping:** glass DataTable; add-ticker → glass input + primary pill button;
  remove → icon button. Preserve `TableSourceFooter` (`t.watchlist.source`).
- **New component required:** No — reused Phase 3 `TableCard` + `AsyncState`; the add-ticker form
  was restyled in place with Fable pill controls.
- **Impl. status:** **✓ COMPLETE — Phase 5B (2026-07-28)** · **Verif. status:** **✓ verified**
  (81 new source-scan tests; protected-route redirect and bilingual bundle strings confirmed
  against a live dev server; browser responsive ladder still outstanding — see below).

**Phase 5B — as built.** Presentation re-skinned; all four API calls, their request shapes and
their status-code mapping are unchanged.
- **Container:** `bg-surface border border-border rounded overflow-x-auto` → Phase 3 **`TableCard`**
  (`minWidth={620}` preserved, footer slot, `state`/`stateMessage`). The card `title` now shows
  `watchlist.name` — real API data that was already fetched but never displayed, giving the page
  the "selected-watchlist identity" it previously lacked.
- **Async states split apart.** "No watchlist", "load failed", and "session expired (401)" all used
  to render the *same* "your watchlist is empty" message. A new `LoadOutcome` (`ok`/`none`/`error`/
  `blocked`) — set inside the **same** effect, from the **same** two fetches — now drives
  `AsyncState` `unavailable`/`error`/`blocked` respectively, each with its own bilingual message.
  `empty` keeps its original `t.watchlist.emptyWatchlist` wording verbatim.
- **The source footer no longer disappears when the list is empty.** Previously the empty state
  replaced the whole card, taking `TableSourceFooter` with it; `TableCard` renders the state
  *instead of the table body* while the footer slot still renders.
- **Item count added** to the footer (`items.length` — real data already on screen, mirroring
  `/stocks`), and deliberately **suppressed** for the error/blocked/unavailable states so a "0"
  can never be mistaken for "you have no tickers".
- **Add form** restyled to Fable pill controls (999px mono input + primary pill button), now
  `flex-wrap` so it stays usable at 390px, with `aria-label`/`aria-invalid`/`aria-describedby` and
  a permanently-mounted `role="status" aria-live="polite"` feedback region.
- **Table:** header row on `var(--surface-table)` (§8), rows on `nv-row-hover nv-transition`,
  `<th scope="col">`, `sr-only <caption>`, and the previously-nameless action column header now
  carries an `sr-only` label. All seven columns, their order, their formatters and every `—`
  fallback are unchanged.
- **Remove control** is now a labelled `<button type="button">` with
  `aria-label="{Remove} {TICKER}"`; the `×` glyph is `aria-hidden`. No confirmation dialog was
  added (none existed).
- **Deliberately NOT added:** no watchlist selector / create / rename / delete UI. The page has
  only ever used `watchlists[0]`; building multi-watchlist management is a **new feature**, not a
  re-skin. No sorting and no filtering (neither existed — and a test now asserts no hidden default
  filtering crept in). No source badge (adding one would contradict the honest "Static sample"
  footer — prices on this route are the static sample by design, per the Phase 8A audit). No
  `asOf` (there is no meaningful timestamp for static sample prices). No `notes`/`added_at` column.

**Three pre-existing defects corrected in this phase** (each locked by a test):
1. **`DELETE` ignored its response** — a failed remove still dropped the row from the table, so the
   ticker silently reappeared on the next load. The request is unchanged; the result is now checked,
   the item stays on failure, and the failure is stated.
2. **Untranslated English literals** — `'Loading…'`, `json.error ?? 'Error'` (which also leaked a raw
   server error code into the UI) and `'Network error'` now resolve through new bilingual keys.
3. **`bg-primary text-surface`** on the Add button — `--surface` is dark in dark mode, so this was a
   latent contrast failure. Corrected to the proper `text-primary-fg` token pair.

## 10. `/portfolio` 🔒 — Portfolio

- **Page title:** `SectionHeader` `t.portfolio.tag`/`title`/`subtitle`; actions = `UpdateDataButton`.
- **Content sections:** (1) `MarketDataSourceBadge`; (2) 7 summary cards (Total MV, Cost Basis,
  Unrealized P&L, Unrealized P&L %, Realized P&L, Cash Balance, Position Count); (3) sector
  exposure bars; (4) tab bar Positions/Transactions/Cash; (5) Positions tab (add form +
  12-col table, Manual/Transactions badge, inline edit, `min-w-[720px]`); (6) Transactions tab
  (add form + ledger table w/ realized P&L); (7) Cash tab (5 summary cards + add form + ledger).
- **Data source / API:** static `getAllCompanies`, `@/lib/portfolio/valuation`; `useMarketData`,
  `useGlobalRefresh`; `GET /api/portfolios`, `/{id}`, `/transactions`, `/cash` + POST/PATCH/DELETE.
- **User interactions:** `UpdateDataButton`; tab switching; add/edit/remove position;
  add/remove transaction (buy/sell); add cash (deposit/withdrawal/adjustment); validation +
  feedback; ticker links.
- **Loading state:** "Loading…" card.
- **Empty state:** `t.portfolio.emptyPortfolio` / `.tx.empty` / `.cash.empty`.
- **Error state:** form 409 (duplicate/manual_position_conflict/insufficient_quantity)/422/
  network messages.
- **Auth:** **protected**.
- **Fable destination:** **1 Overview** (hero + exposure) + **2 Portfolio** (positions table)
  + **4 Risk** (capsule language for summary cards).
- **Fable component mapping:** summary cards → **KPI capsule row / hero card** (P&L delta
  capsules, count-up); sector exposure → **allocation bars**; positions/transactions/cash →
  glass DataTables; tab bar → segmented pill toggle; add forms → glass inputs. Preserve
  `MarketDataSourceBadge` + `TableSourceFooter`. (Fable's privacy-mask `•••••` is an optional
  additive fit here.)
- **New component required:** **Yes** — summary hero cards, sector-exposure bars, three
  tabbed tables + their add forms. Strong Fable-language reuse.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 11. `/structured-notes` 🔒 — Structured Notes (dashboard)

- **Page title:** `SectionHeader` tag+title `t.sn.tag` (NOTES/NOTAS ESTRUCTURADAS).
- **Content sections:** (1) 7 dashboard KPI cards (Live/Safe/Watch/Autocallable/Breached/Called/
  Notional, clickable filters, legend); (2) exposure charts (issuer `BarChart` + entity `Donut`,
  inline SVG); (3) monitoring warnings line; (4) upload + Update + view toggle (PDF input,
  Status/Issuer filters, Live/Archived); (5) extraction preview (confidence-scored review,
  Import/Cancel); (6) positions table (Called checkbox·ISIN·Issuer·Underlyings·Issued·Coupon·
  Knock-in·Status·Worst·Distance·Next obs./Archived·Notional, sortable).
- **Data source / API:** `GET /api/structured-notes`, `/monitoring-status`; `POST
  /api/structured-notes/extract`, `/import`; `PATCH /api/structured-notes/{id}`.
- **User interactions:** PDF upload → extract → review → import; Update; Status/Issuer filters;
  Live/Archived toggle; sortable headers; Called checkbox (→archived); clickable KPIs
  (`focusStatus`); Cancel/Import; links to detail.
- **Loading state:** "…"; refresh disables button.
- **Empty state:** `t.sn.empty`; KPIs/charts hidden when no notes.
- **Error state:** `error` red text; extract/import errors (`t.sn.extractError`/`importError`).
- **Auth:** **protected**.
- **Fable destination:** **6 Structured Notes** (direct — barrier gauge, lifecycle legend).
- **Fable component mapping:** KPI cards → capsule row w/ status coloring; barrier distance →
  **barrier gauge** component (Fable signature); table → glass DataTable w/ row→detail; upload/
  review → glass card + confidence pills; bar/donut → keep inline SVG restyled to chart palette;
  filters/toggle → segmented pills. Preserve `TableSourceFooter` + monitoring-estimate
  disclaimer.
- **New component required:** **Yes** — barrier gauge, upload/extraction review panel, dashboard
  KPI cards. (Fable's SN screen supplies most of the language directly.)
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 12. `/structured-notes/[id]` 🔒 — Structured Note detail

- **Page title:** `SectionHeader` tag=`isin` title=`productName` subtitle=`issuer·structureType`;
  "← Back".
- **Content sections:** (1) 5-KPI metrics strip; (2) general terms card; (3) current levels &
  distance-to-barrier card (+ last-monitored stale ⚠, footer + disclaimer); (4) underlyings
  card; (5) schedule card (per valuation date, `max-h-64`); (6) allocation-by-entity grid (9
  sociedades + custom, thousand-sep, total + mismatch); (7) provenance + Delete.
- **Data source / API:** `GET /api/structured-notes/{id}`; `POST .../allocations`; `DELETE
  .../{id}`; `dedupeObservationsByDate`, `DEFAULT_ENTITIES`.
- **User interactions:** allocation inputs (blur/Enter commit, thousand-sep); add/remove custom
  entity; Delete (`window.confirm`); "← Back" links.
- **Loading state:** "…".
- **Empty state:** 404 → "not found" + back link.
- **Error state:** 404 → notFound; else silent.
- **Auth:** **protected**.
- **Fable destination:** **6 Structured Notes** detail side panel (terms grid + lifecycle
  timeline).
- **Fable component mapping:** metrics strip → capsule row; general terms → 2-col stats grid;
  current levels → glass DataTable + barrier-distance cells; schedule → lifecycle timeline /
  DataTable; allocation grid → glass inputs grid; Delete → critical-colored action. Preserve
  `TableSourceFooter` + disclaimer.
- **New component required:** **Yes** — terms grid, current-levels table, schedule, entity
  allocation grid (as a full detail page; Fable offers the language via its SN detail panel).
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 13. `/settings/notifications` 🔒 — Notification Settings

- **Page title:** `SectionHeader` `t.notifications.settings.tag`/`title`/`subtitle`; "Back" →
  `/structured-notes`.
- **Content sections:** (1) add-recipient form (Email, Label, Add); (2) recipients table
  (Email·Label·Active toggle·Remove); (3) note line.
- **Data source / API:** `GET/POST /api/notification-recipients`, `PATCH/DELETE /{id}`.
- **User interactions:** add-recipient form; active checkbox (optimistic); remove (optimistic);
  "Back" link.
- **Loading state:** "…".
- **Empty state:** `t.notifications.settings.empty` card.
- **Error state:** `invalid_email`/`addError` box.
- **Auth:** **protected** (`/settings`).
- **Fable destination:** **10 Administration** (notification switches + data-sources table lang).
- **Fable component mapping:** recipients table → glass DataTable; active toggle → **toggle
  switch** (30×18); add form → glass inputs; note → meta line.
- **New component required:** **Yes** — recipients table + add form + toggle switch in glass
  language.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 14. `/login` — Sign in / Create account

- **Page title:** in-form `t.auth.signInTitle` / `t.auth.createAccountTitle` (centered card, no
  `SectionHeader`).
- **Content sections:** centered card — BrandLogo + "NMI"; title/subtitle; error box; Username;
  (create-only) recovery Email + hint; Password + Forgot link; submit; mode toggle; "← Back to
  home".
- **Data source / API:** `POST /api/auth/login` | `/register`; `useSearchParams` for
  `error`/`next`.
- **User interactions:** username/password/email inputs; submit; sign-in ⇄ create toggle;
  Forgot link; Back link; success → `window.location.assign(safeNext)`.
- **Loading state:** button "…".
- **Empty state:** n/a.
- **Error state:** mapped error box (`errorKeyToMessage`) + callback error.
- **Auth:** public auth page. **Currently renders INSIDE AppShell (sidebar+topbar visible).**
- **Fable destination:** **0 Login** (cinematic Ken-Burns + glass auth panel).
- **Fable component mapping:** full **login shell** (Santiago Ken-Burns bg, cursor specular,
  deep-navy headline, utility chips: secure dot / EN|ES / clock / contrast) + **glass auth
  panel** (eyebrow, title, error banner, 13px-radius inputs, Show/Hide, primary 999px button).
  **Excludes** Fable's simulated-auth flow / demo-credentials chip / passkey (merge points 5,6)
  — wire the real NMI `POST /api/auth/*` instead. Keep sign-in ⇄ create toggle + username field
  (NMI is username+password, not email-only).
- **New component required:** **Yes** — cinematic login layout + glass auth panel. Requires a
  **new nested layout / route group** so `/login` renders full-bleed WITHOUT the app shell
  (doc 04). EN|ES chip must use existing `LangProvider`; contrast/theme via existing
  `ThemeToggle` mechanism.
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 15. `/forgot-password` — Reset your password

- **Page title:** in-form `t.auth.forgotPasswordTitle` (centered card).
- **Content sections:** BrandLogo + "NMI"; request form (Email, Send, "have account" link) OR
  sent-confirmation (`t.auth.resetLinkSentTitle`/`Message`); "← Back to home".
- **Data source / API:** `POST /api/auth/forgot-password` (fire-and-forget; identical
  confirmation regardless of account existence — no user enumeration).
- **User interactions:** Email input; submit; links to `/login`, `/`.
- **Loading state:** button "…".
- **Empty state:** n/a.
- **Error state:** intentionally none (privacy — always "sent" confirmation).
- **Auth:** public auth page.
- **Fable destination:** **0 Login** (auth-panel variant).
- **Fable component mapping:** glass auth-panel variant on the same cinematic shell; success
  state = glass confirmation panel. Preserve the no-enumeration behavior.
- **New component required:** **Yes** — auth-panel variant (shares the login shell).
- **Impl. status:** Not started · **Verif. status:** Not verified.

## 16. `/auth/reset-password` — Set a new password

- **Page title:** in-form `t.auth.newPasswordTitle` (centered card).
- **Content sections:** BrandLogo + "NMI"; form (error box, New password + hint, Confirm
  password, submit) OR done message; "← Back" → `/login`.
- **Data source / API:** `POST /api/auth/reset-password` (`{ password }`); relies on
  recovery-session cookie; `useRouter` redirect after success.
- **User interactions:** password + confirm inputs; submit; back link.
- **Loading state:** button "…".
- **Empty state:** n/a.
- **Error state:** mismatch (`errPasswordMismatch`), `no_session`→`errResetLinkInvalid`, else
  `errResetFailed`.
- **Auth:** public auth page (recovery session).
- **Fable destination:** **0 Login** (auth-panel variant).
- **Fable component mapping:** glass auth-panel variant on the login shell; success = glass
  confirmation. Preserve the recovery-session dependency and validation.
- **New component required:** **Yes** — auth-panel variant (shares the login shell).
- **Impl. status:** Not started · **Verif. status:** Not verified.

---

## Cross-cutting elements (present on every route — map once, apply everywhere)

| NMI element | Where | Fable destination | New component? |
|---|---|---|---|
| **Sidebar** (navy `w-52` + mobile drawer) | AppShell | Fable **glass top nav pill-rail w/ sliding indicator** (+ mobile scroll rail). *Open decision: keep left sidebar vs adopt top rail — see doc 05.* | Adapt |
| **TopBar** (hamburger, brand, search, bell, lang, theme, date) | AppShell | Fable header glass bar (logo crop + title, search pill, icon buttons, avatar menu) | Adapt |
| **CommandPalette** (⌘K/`/`) | AppShell | Fable **command palette** (560px glass, kind-tagged results) — direct restyle | Restyle |
| **NotificationBell** dropdown | TopBar | Fable **notification drawer** (right slide-in, severity dots, mark-all-read) | Restyle |
| **ThemeToggle** (segmented pill) | TopBar | Fable theme glyph / contrast toggle — keep NMI's persisted `theme` mechanism | Restyle |
| **LangToggle** (EN/ES) | TopBar | Fable **EN|ES capsule** — keep `LangProvider` | Restyle |
| **SectionHeader** | most pages | Fable page title (19px/650) + actions row | Restyle |
| **DataSourceBadge / MarketDataSourceBadge / SourceStateBadge** | tables | Fable status chip (dot + word) — **semantics preserved** (merge point 10) | Restyle |
| **TableSourceFooter** | every table | Fable meta line — **one per table preserved** (merge point 10) | Restyle |
| **UpdateDataButton** | 7 pages | Fable primary/outline pill button w/ spinner→✓ | Restyle |
| **EmptyState / StatusPill** | various | Fable muted glass empty state / status pill | Restyle |
| **Charts** (LineChart, CompareChart, FundamentalsChart, YieldCurveChart) | analysis pages | Fable SVG chart language (gridlines, dashed zero, chart palette, crosshair) | Restyle |
| **Pre-paint theme script** | layout head | Preserve verbatim (extend to also set `body.nv-light` if light chosen as non-default) | Preserve |
| **Providers** (Lang/MarketData/MacroData/Sidebar) | AppShell | Preserve mounted; wrap Fable shell | Preserve |
