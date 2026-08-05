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
| 1 | `/` | Overview (command center) | protected (R1.5 default-deny) | 1 Overview | Home-local: command strip, portfolio/notes snapshots, events timeline, macro pulse (all in `page.tsx`) | **✓ R10 (2026-08-04)** | Automated ✓ · manual pending |
| 2 | `/stocks` | Stocks | protected (R1.5 default-deny) | 2 Portfolio (DataTable) | No (reused Phase 3 `TableCard`) | **✓ Phase 5A (2026-07-28)** | **✓ Source + rendered-markup verified** |
| 3 | `/compare` | Compare | protected (R1.5 default-deny) | 3 Performance (chart+table) | No (reused Phase 3 `TableCard`/`GlassSurface`/`SegmentedControl`) | **✓ Phase 5D (2026-07-28)** | **✓ Source + rendered-markup verified** |
| 4 | `/chart-builder` | Charting | protected (R1.5 default-deny) | 3 Performance (chart) | No (reused Phase 3 `TableCard`/`GlassSurface`/`SegmentedControl`) | **✓ Phase 5E (2026-07-28)** | **✓ Source-scan verified** |
| 5 | `/macro` | Macroeconomic Indicators | protected (R1.5 default-deny) | 7 Macro | No (reused Phase 3 `TableCard`/`GlassSurface`/`SegmentedControl`) | **✓ Phase 5F (2026-07-28)** | **✓ Source-scan verified** |
| 6 | `/macro/calendar` | Economic Calendar | protected (R1.5 default-deny) | 7 Macro / 9 Documents table | No (reused Phase 3 `TableCard`) | **✓ Phase 5F (2026-07-28)** | **✓ Source-scan verified** |
| 7 | `/earnings` | Earnings | private_page | 8 Research (upcoming earnings) / DataTable | No (reused Phase 3 `TableCard`/`AsyncState`) | **✓ Phase 5G (2026-07-29)** · **✓ R8 (2026-08-03)** | **✓ Source-scan verified** |
| 8 | `/companies/[ticker]` | Stocks · TICKER | protected (R1.5 default-deny) | 2 Portfolio detail panel + 3 Performance | Yes — company detail (KPI capsules, chart, valuation grid, results, news) | Done | Verified |
| 9 | `/watchlist` 🔒 | Watchlist | protected | 2 Portfolio (DataTable) | No (reused Phase 3 `TableCard` + `AsyncState`) | **✓ Phase 5B (2026-07-28)** | **✓ Source + protected-route verified** |
| 10 | `/portfolio` 🔒 | Portfolio | protected | 1 Overview + 2 Portfolio + 4 Risk | No (reused Phase 3 `TableCard`/`KpiCapsule`/`ChangeIndicator`/`SegmentedControl`/`GlassSurface`/`AsyncState`) | **✓ Phase 5H (2026-07-29)** | **✓ Source-scan verified** |
| 11 | `/structured-notes` 🔒 | Structured Notes | protected | 6 Structured Notes | Yes — barrier gauge, upload/extract panel, dashboard KPIs, bar/donut | **✓ R7 (2026-07-31)** · privacy masking added R11 | **✓ Source-scan verified** |
| 12 | `/structured-notes/[id]` 🔒 | note ISIN/name | protected | 6 SN detail panel | Yes — terms grid, current-levels table, schedule, allocation grid | **✓ R7.1 (2026-07-31)** · privacy masking added R11 | **✓ Source-scan verified** |
| 13 | `/settings` 🔒 | Settings | protected | 10 Administration | Yes — Account, Data Sources, Security, Display, Notification Recipients | **R9.2 + R9.3 + R9.4 implemented (2026-08-04)** | Automated complete; manual pending |
| 13b | `/settings/notifications` 🔒 | Notification Settings | protected | 10 Administration | server `redirect('/settings#notifications')` — R9.4 folded the surface into `/settings` | **✓ R9.4 (2026-08-04)** | Automated complete; manual pending |
| 14 | `/login` | Sign in | public (auth) | 0 Login | Yes — cinematic login shell, glass auth panel | **R1 implemented (2026-07-29)** · create-account mode + register endpoint removed R1.5 | Automated complete; manual pending |
| 15 | `/forgot-password` | Reset your password | public (auth) | 0 Login (variant) | Yes — auth-panel variant | **✓ R1.6 (2026-07-30)** | **✓ Source-scan verified** |
| 16 | `/auth/reset-password` | Set a new password | public (auth) | 0 Login (variant) | Yes — auth-panel variant | **✓ R1.6 (2026-07-30)** | **✓ Source-scan verified** |

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
- **Auth:** protected — R1.5 default-deny (corrected R12; this line predated the access-control
  rework). The watchlist section additionally degrades to a sign-in prompt on a lapsed session.
- **Fable destination:** **1 Overview** (visual language only — Fable Overview's
  portfolio-centric modules are NOT NMI Home content).
- **Fable component mapping:** Macro card → glass card + macro snapshot rows (sparklines);
  Watchlist/FX → glass DataTable; Earnings → glass card + event/timeline list; Sector heat map
  → **no direct Fable analog** (closest is the allocation-bar/monthly-returns tint language) →
  reuse tint scale; Chilean Rates → glass list rows; Markets → macro snapshot rows; News → glass
  card list w/ severity dots (like notification drawer rows).
- **New component required:** **Yes** — News feed card, Sector heat-map tile grid,
  Chilean-rates drag list, banded dual-region Macro card. All in Fable glass language.
- **Impl. status:** **✓ COMPLETE — R10 (2026-08-04)** · **Verif. status:** automated complete
  (`tests/fableHomePage.test.ts`, 45 tests), **manual pending**.

**R10 — as built (2026-08-04).** Home was the last pre-Fable route; R10 rebuilt it as the
institutional command center on the Fable Overview language, keeping EVERY pre-R10 module and
adding only modules the platform already served real data for. Composition, top→bottom (each in a
staggered `Reveal`; mobile order = DOM order = priority):

1. **`PageHeader`** (`t.home.tag` / `t.home.title` "Overview"/"Resumen" / subtitle) + the ONE
   platform `UpdateDataButton` (fed by `useGlobalRefresh()`; also re-pulls news, the notes book and
   ingestion health — portfolio totals re-value automatically from the refreshed market overlay).
2. **Executive command strip** (`GlassSurface kpi`): localized session date · **data health** from
   `GET /api/health/ingestion` (the same sanitized shape Settings reads; failed check renders
   "Unavailable", never healthy) · **attention count** (the length of the Current Actions list —
   one derivation, two surfaces) · **workspace launcher** (labeled `<nav>`, chip links to
   `/portfolio` + `/structured-notes` (primary weight), `/macro`, `/macro/calendar`, `/compare`,
   `/chart-builder`; labels from `t.nav.*`). Deliberately NO market-freshness chip — each surface
   below carries its own footer as-of (one as-of per surface).
3. **Hero row** (Fable Overview Row A asymmetry — flex 1.7 / 1 / 1.15, `min(100%,…)` bases):
   - **Portfolio snapshot** — `GET /api/portfolios` → `GET /api/portfolios/[id]` (the exact
     sequence `/portfolio` runs), re-valued through the SAME `valuePositions` +
     `calculatePortfolioTotals` helpers with the shared live overlay, so Home and `/portfolio` can
     never disagree. Hero total market value (**masked**), unrealized P&L % (`ChangeIndicator`,
     public), minis: unrealized P&L amount / cost basis / cash balance / realized P&L (**all
     masked** via `PrivacyValue`), positions count (public). `MarketDataSourceBadge`
     (live/persisted) + Yahoo footer with the live as-of. Loading/error via `AsyncState`; empty =
     honest zero-positions prompt. **No daily P&L exists anywhere — the repository has no
     portfolio value time series, so none was invented.**
   - **Structured Notes snapshot** — `GET /api/structured-notes` (the same dashboard payload the
     `/structured-notes` page reads; 503 → honest `unavailable`). Active-note count, the four
     risk-status counts (dot + word + legend tooltip, from `summary.safeNotes/watchNotes/
     autocallableNotes/breachedNotes`), total **Nevada** notional (**masked**; allocation-based
     `totalCurrentNotional` — `issueSize` is never referenced; mixed-currency books disclosed via
     `t.home.notesMixedCcy`), next observation (date · days · note, linked), Yahoo
     monitoring-estimate footer with `pricesAsOf`.
   - **`CurrentActions`** (first consumer of the Fable deep-teal card) — real items only: one per
     active note whose dominant reason is breached (high) > autocallable > watch (medium) > an
     observation due ≤7 days (low, dated), plus one ingestion-health item when the run is
     warning/stale/failed (links to `/settings`). No fabricated unified score — severity comes from
     the existing risk model and health states; empty state is the primitive's own honest copy.
4. **Macro + events row** (flex 1 / 1.4) *(R10.1 — see the amendment below)*:
   - **Macro card (merged)** — ONE surface for every Home indicator, in the pulse row style
     (label · sparkline · value · `ChangeIndicator`), organized in the two provider bands.
     **Chile band** (BCCh badge + footer): TPM, USD/CLP, copper (`cobre-lme`), IPC 12m, IMACEC,
     PIB, unemployment, EUR/CLP (the FX extra via `liveIndicatorMap[fx.id]`). **US band** (FRED
     badge + footer): US 10Y, Fed Funds, US CPI y/y, US GDP, US unemployment, DXY. **1Y sparkline
     drawn ONLY when `/api/macro/history` resolved live/persisted/hybrid-fallback** (the 4
     `PULSE_IDS`); every other row carries an aligned spacer — a static-bundle series is never
     decorated as a live trend.
   - **Upcoming events** — ONE date-sorted timeline over the next 14 days (window disclosed in the
     header): CMF report dates (`upcomingWithinDays(events, 14)`), scheduled **High**-importance
     FRED releases (`fetchFredReleaseCalendar`; unconfigured/failed → honest per-source line), and
     active-note observation dates from the book payload. Each row: DD/MM chip · kind dot+word ·
     deep link (`/companies/{t}` / `/macro/calendar` / `/structured-notes/{id}`). Zero events
     (`t.home.eventsEmpty`) is rendered distinctly from any failed source
     (`evCmfUnavailable`/`evFredUnavailable`/`evNotesUnavailable`). **Recently Reported** (5 most
     recent past CMF dates) kept as a sub-section. Three per-source footers (CMF · FRED · notes
     book).
5. **Detail row** (flex 1.7 / 1, R10.1): the **Watchlist table** — pure watchlist in the Fable
   table idiom (`TableCard`, `minWidth={430}` + `maxHeight` scroll, sticky `--surface-table`
   header cells, badge in the card controls; sortable headers with `aria-sort` + real `<button>`s,
   sign-in/empty states, `/companies/{t}` links and the live→persisted→static merge preserved) ·
   **Chilean Rates** (drag-to-reorder `⠿` Fable list rows, `cmi.ratesOrder`, live BCCh dot
   overlay + `ChangeIndicator`, exact badge+footer preserved).
6. **Market breadth row** (flex 1.7 / 1): **sector heat map** (dense surface, `rounded-md` tiles,
   best/worst constituent, diverging legend — shading math preserved) · **Markets** index list
   (country/index Fable rows with `ChangeIndicator` + muted YTD).
7. **News** — the NH-style feed preserved byte-for-byte at row level (status dot, solid
   `--negative` High bar, source codes, timestamps, ticker chips, 7-day window) inside a glass
   card with dense body.

**Removed by design:** measured-height pinning (`pinH`/`macroH`/`heatH`/`ResizeObserver`) — cards
take natural height and dense lists scroll in-card via `maxHeight`; the old custom `<h1>` header.
**Privacy:** Home is now a real privacy consumer (supersedes the R9.6 finding, tests updated
explicitly): the five portfolio amounts + the Nevada notional mask through the shared
`PrivacyValue` (fails closed during hydration; both routes' private values arrive only after
hydration via fetch, so a stored-ON reload cannot flash). Percentages, counts, dates, tickers,
note names and all public market data stay visible. **Endpoints consumed** (each fetched once):
`/api/watchlists`(+items), `/api/portfolios`(+detail), `/api/structured-notes`,
`/api/health/ingestion`, `/api/news`, `/api/earnings/calendar`,
`/api/macro/fred-release-calendar`, `/api/macro/history/{id}` ×4, plus the shared
market/macro providers. Guarded by `tests/fableHomePage.test.ts` (45) + the updated
`homeWatchlistOverhaul`/`responsiveLayout`/`fableSettingsPage` suites.

**R10.1 amendment (2026-08-05, user-directed).** The R10 build had preserved the legacy tables
byte-for-byte, which read as a second design and duplicated macro information (US 10Y on two
surfaces, USD/CLP on three). R10.1 merged the pulse strip + banded macro card + FX band into the
ONE Macro card described in item 4 (each indicator exactly once; per-band BCCh/FRED badges and
footers kept), rebuilt Watchlist/rates/heat/Markets in the Fable idiom (items 5–6), and replaced
the last fixed 3-col grid with a wrapping flex row. News keeps its NH terminal anatomy by product
rule. `home.pulseTitle`/`home.fxTitle` removed (dead keys); full record in
`04-file-level-implementation-plan.md` § Phase R10.1.

**R10.2 amendment (2026-08-05, user-directed).** Macro rows carry NO sparklines (the 1Y history
fetch is gone — Home fetches no `/api/macro/history` series and renders no chart); the command
strip has NO workspace launcher (it duplicated the top nav rail) and the header has NO subtitle;
macro row labels wrap instead of truncating; Current Actions surfaces an autocallable note only
when its observation is ≤7 days away; `AppShell`'s scroll container now spans the full window
(the `--content-max-w` cap moved to an inner wrapper) so the vertical scrollbar sits at the
screen edge at every viewport. Removed keys: `home.subtitle`, `home.launcher`,
`home.pulseWindow`. Full record in `04-file-level-implementation-plan.md` § Phase R10.2.

**R10.3 amendment (2026-08-05, user-directed width/density rebalance).** Supersedes the layout
halves of items 4–6 (all substance unchanged): the analytical modules now sit in two responsive
PEER rows — **Row A: Macro · Upcoming Events · Watchlist**, **Row B: Chilean Rates · Sector
Heat Map · Markets** (`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3`; at lg the third card
spans both columns so none sits isolated; News stays full-width below). Each card's dense area
caps at a shared 420px and scrolls in-card (CSS only), so the three cards in a row keep similar
practical heights; heat tiles are 2-across (a clean 5×2 for the 10 sectors) sized for the
one-third-width card. The desktop canvas widened via the ONE shell token
(`--content-max-w` 1560 → 1680px — ~24px gutters at 1728; TopBar/SecondaryNav/main stay
aligned). Hero row, command strip, PageHeader and News substance untouched; no endpoint,
calculation, privacy or i18n change. Full record in `04-file-level-implementation-plan.md`
§ Phase R10.3.

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
- **New component required:** **No** — every primitive already existed from Phase 3/4;
  `DataSourceBadge`/`SourceStateBadge`/`TableSourceFooter` preserved exactly (3 badges, 1 status
  badge, 4 footers).
- **Impl. status:** ✓ Phase 5F (2026-07-28) · **Verif. status:** ✓ Source-level (95 new tests in
  `tests/fableMacroPage.test.ts`; build 0 errors, `/macro` still static/`○`).

**Phase 5F — `/macro` as built.** Presentation only; every hook, computed value (`groups`,
`curveTenors`/`curveToday`/`curveWeekAgo`/`curveYearEnd`, `curveYearEndYear`, `chartProvider`,
`latestAsOf`) and fetch effect is byte-for-byte unchanged.
- **Container:** the calendar embed / indicators table / FX depth table all moved from hand-rolled
  `bg-surface border border-border rounded` divs to `TableCard` (`minWidth={720}` / `{660}` /
  `{420}`) — the calendar and FOMC tables previously had **no `min-w` at all**, a genuine
  pre-existing responsive gap now closed. The yield-curve chart card moved to `GlassSurface
  variant="card"` (chart panels use plain glass, not the dense table wrapper, matching Compare/
  Chart Builder precedent).
- **Toggles:** the chart popup's 1Y/3Y/5Y/10Y timeframe row → `SegmentedControl` (5th adopter),
  mapped to/from the existing numeric `Timeframe` type at the presentation boundary only — the
  underlying `timeframe` state and every fetch call keeps its exact type and value.
- **Chart popup modal:** restyled onto the established `nv-scrim` + `nv-glass-overlay nv-pop`
  recipe (same as Compare/Chart Builder's settings modals); gained a data-driven `aria-label`
  (the indicator's own name).
- **Real accessibility addition:** chartable indicator rows (`onClick={() => openRow(r)}`) were
  previously mouse-only. They are now also keyboard-operable (`role="button"`, `tabIndex`,
  Enter/Space via `onKeyDown`) with a distinct per-row accessible name — the interaction itself
  (`openRow`) is unchanged, only its reachability improved.
- **Three genuine pre-existing i18n gaps fixed in passing** (found while already on these exact
  lines, same precedent as Compare's `clearRange` and Chart Builder's `vs`/`removeMetric` fixes):
  the region chip literally rendered `'Chile'`/`'US'` in English regardless of language (now
  `t.macro.regionCL`/`regionUS`); the "Chartable" dot's `title` was hardcoded English (now
  `t.macro.chartable`); the popup close button's `aria-label="Close chart"` was hardcoded English
  (now reuses the shared `t.fable.panel.close`, the same key Compare/Chart Builder's modals use).
- **Deliberately NOT changed:** the Change-column ternaries (indicators table, FX table, popup
  badge) keep their exact original `changeColor()`-based text — `ChangeIndicator` (the newer
  glyph+color Fable component) was considered and rejected here because the FX table's exact
  ternary text is asserted verbatim by a pre-existing business-logic test
  (`tests/frankfurterFx.test.ts`); rather than touch that unrelated test, the ternaries stayed
  byte-for-byte identical. No date-range or category-filter control was invented (neither existed).
  `MacroSeriesDef`/category-list logic in the page (`catLabel`, `indByCat`, `groups`) is completely
  untouched — it was already hardcoded pre-phase (not derived from `MacroSeriesDef` at runtime), so
  the "don't hardcode categories" instruction didn't apply here.

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
- **New component required:** **No** — every primitive already existed from Phase 3.
- **Impl. status:** ✓ Phase 5F (2026-07-28) · **Verif. status:** ✓ Source-level (56 new tests in
  `tests/fableMacroCalendarPage.test.ts`; build 0 errors, `/macro/calendar` still static/`○`).

**Phase 5F — `/macro/calendar` as built.** Presentation only; every fetch call and computed value
(`events`, `latestAsOf`, `pct`) is byte-for-byte unchanged.
- **Container:** all 3 cards (FRED release calendar, FOMC outlook, Chile deferred) moved to
  `TableCard`. The FRED calendar and FOMC tables previously had **no `min-w`** — closed via
  `minWidth={720}`/`{480}`, the same pre-existing-gap fix applied to the Macro page's calendar
  embed (same shared `EconomicCalendarTable` component). The Chile-deferred card uses `TableCard`'s
  own `state="unavailable"` slot directly (no table body — there is genuinely no data or source
  here), rather than a bespoke muted `<div>`.
- **`EconomicCalendarTable.tsx` restyled** (shared by both this page and the Macro-page embed —
  exclusively consumed by these two in-scope routes, so restyling it is restyling this phase's own
  content, not a cross-page shared-component change): near-opaque `var(--surface-table)` header,
  `scope="col"` + `sr-only` caption, its own outer `overflow-x-auto` wrapper removed (now supplied
  by the caller's `TableCard`), and its internal "no releases" empty state now routes through the
  shared `AsyncState kind="empty"` component instead of a bare `<div>` — same exact message.
- **Deliberately NOT changed:** no forecast/consensus field was invented (none exists — the
  dates-only vs. enriched-actual/previous distinction is preserved exactly); the Chile deferred
  card's honest unavailable copy is untouched; the FOMC "NOT CME FedWatch / NOT a per-meeting
  forecast" disclaimer is untouched; no filtering/sorting/search UI was invented (none existed).

## 7. `/earnings` — Earnings

- **Page title:** `PageHeader` `t.earnings.tag` (eyebrow) / `title` / `subtitle` (metadata). *(R8 —
  was `SectionHeader`.)*
- **Content sections:** (1) Upcoming table (CMF EEFF next 45d: Ticker·**Company**·Period·Expected);
  (2) Recent Results table (rolling 2 quarters/ticker: Ticker·Company·Period·Cur.·Revenue·Rev.YoY·
  EBITDA·EBITDA YoY·Net Income·Net Inc.YoY·EPS, Export CSV, footer + amounts note + count). Each
  table carries its **own** source-coverage disclosure. *(R8 added the Upcoming Company column and
  both coverage lines.)*
- **Data source / API:** `useGlobalRefresh`; `fetchEarningsCalendar`→`/api/earnings/calendar`,
  `fetchEarningsResults(force)`→`/api/earnings/results` (6h cache). Company names and the coverage
  denominator come from the client-safe `@/lib/data/companies` registry — no added request.
- **User interactions:** `UpdateDataButton` (force-refetch both), Export CSV (`ChipButton`), ticker
  links. No sort, no filter, no persistence.
- **Loading state:** shared `AsyncState kind="loading"`, `t.common.loading`.
- **Empty state:** shared `AsyncState kind="empty"`, `t.earnings.noUpcoming`; `t.common.noResults` —
  reserved for a **healthy live payload that legitimately has no rows**.
- **Error/unavailable state:** all fetches still `.catch(()=>null)`. **R8 corrected the collapse:** a
  null payload *or* an explicit `status:'unavailable'` now renders `AsyncState kind="unavailable"`
  (its own bilingual copy) and a `live-unavailable` badge — distinct from "empty". Previously both
  rendered as "empty" under a **`static`** badge, which named a static earnings sample that does not
  exist.
- **Auth:** private_page (shared R1.5 default-deny policy; `classifyPath('/earnings')`). *(R8 doc
  correction — the runtime was always correct, this table said "public".)*
- **Fable destination:** **8 Research** (Upcoming-earnings module) + glass DataTable.
- **Fable component mapping:** both tables → `TableCard` (near-opaque dense body, `scope="col"` +
  `sr-only` caption headers); `MarketDataSourceBadge` stays the status chip (unchanged component);
  loading/empty rows → shared `AsyncState`. Preserve bank-no-EBITDA tooltip + `TableSourceFooter`.
- **New component required:** **No** — Phase 3 `TableCard`/`AsyncState`/`Reveal` plus, in R8, the
  shared `PageHeader` and `ChipButton`. One page-local presentational helper (`CoverageNote`).
- **Impl. status:** ✓ Phase 5G (2026-07-29) · ✓ **R8 (2026-08-03)** · **Verif. status:** ✓
  Source-scan verified (97 tests in `tests/fableEarningsPage.test.ts` — 57 Phase 5G, 9 of them
  updated in place for R8, + 40 new R8 cases; lint 0, build 0 errors). **Manual browser validation
  PENDING** for R8.

**Phase 5G — `/earnings` as built.** Presentation only; every hook, state variable, effect, and
computed value (`cal`, `results`, `loading`, `upcoming`, `rows`, `live`, `handleExport`, `pctCell`,
`fmtMM`, `fmtEps`) is byte-for-byte unchanged — only the JSX tree changed.
- **Container:** both tables (previously raw `bg-surface border` divs with ad hoc
  `overflow-x-auto`) moved to `TableCard` — the Upcoming table had `min-w-[360px]` (preserved via
  `minWidth={360}`), the Recent Results table had **no `min-w` at all**, a genuine pre-existing
  responsive gap now closed by `TableCard`'s own scroll container, matching the exact pattern from
  every prior Phase 5 sub-phase. `MarketDataSourceBadge` + (on Recent Results) the Export CSV button
  moved into `TableCard`'s `controls` slot; `TableSourceFooter` + the amounts note + the record
  count moved into its `footer` slot — same components, same props, same conditions.
- **Loading/empty rows:** the bare `<td>{loading ? t.common.loading : ...}</td>` text cells were
  replaced with the shared `AsyncState` component (`kind={loading ? 'loading' : 'empty'}`),
  mirroring the **exact same convention already established** in
  `src/app/companies/[ticker]/page.tsx`'s own earnings-results section
  (`kind={earningsResults === null ? 'loading' : 'empty'}`) — this page's migration did not invent
  a new idiom, it adopted the one the company-detail page already uses for the identical data
  source. The two messages (`t.earnings.noUpcoming` / `t.common.noResults`) are unchanged.
- **Semantic table markup:** `scope="col"` on every header cell, `<caption className="sr-only">`
  on each table, near-opaque `var(--surface-table)` header background, tokenised
  `var(--fs-table-cell)` body type, `nv-row-hover nv-transition` row hover (was
  `hover:bg-surface-2 transition-colors`).
- **Deliberately NOT changed:** no consensus/surprise/beat/miss field exists or was added; no
  editorial Clean/Mixed/Weak quality label was reintroduced; `earnings.json` (a dead, orphaned file
  with zero import statements anywhere in `src/` — confirmed by a repo-wide scan, not just for this
  page) was not touched or reimported; no filter/sort/segmented control was invented (none existed —
  the resolver's fixed sort order is the only ordering); no summary KPI strip was added; the
  `/api/earnings/route.ts` orphaned legacy route (unrelated to this page, reads persisted
  `earnings_events` from Phase 8C manual-CSV ingestion, carries a stale comment referencing the
  long-deleted `earnings.json` fallback) was noted as a pre-existing loose end but is out of scope
  (backend API file) and was left untouched.

**R8 — `/earnings` as built (2026-08-03).** Two data-correctness fixes and one composition pass. No
resolver, API, cache, calculation, or access rule was touched; the whole change lives in
`page.tsx` + `i18n.ts`.

- **Source honesty (the headline fix).** Both badges fell back to **`'static'`**, asserting that a
  static earnings sample was on screen. No such source exists: both payload unions are
  `'live' | 'unavailable'` and `earnings.json` is deleted. A *network failure* also printed "Static".
  Both now resolve **`'live-unavailable'`** — a state the shared `MarketDataSourceBadge` and both
  dictionaries already supported, so **no shared string was edited**.
- **Unavailable ≠ empty.** Phase 5G deliberately preserved the collapse of these two states; R8 was
  commissioned to correct it. A null payload *or* an explicit `status:'unavailable'` now renders
  `AsyncState kind="unavailable"` (existing bilingual copy); a healthy live payload with zero rows
  keeps `kind="empty"` and its original `t.earnings.noUpcoming` / `t.common.noResults` message — a
  real case for Upcoming between reporting waves. `partial`/`stale` stay unused: no payload field
  distinguishes them, so using them would be invention.
- **Per-source coverage disclosure.** Both payloads carry `missingTickers` — the resolvers' own
  documented honest-gap channel — and **no component read it**, so issuers CMF structurally never
  publishes (BSANTANDER, ITAUCL) were silently invisible. Each table now carries its own
  `CoverageNote`, deliberately **not** one combined page-level figure: the calendar and the results
  feed are independent sources whose coverage genuinely differs, so a merged number would be false
  for at least one of them. Coverage = `trackedCompanyCount` − that payload's own `missingTickers`,
  and **never** the displayed row count (Recent Results prints 2 quarters per company; Upcoming
  prints only companies reporting inside the window — neither row count can express "this source has
  no data for this issuer at all"). `trackedCompanyCount` is the length of `COMPANY_REGISTRY =
  getAllCompanies()`, read once at module scope and backing the Upcoming name lookup too, so the
  denominator and the lookup can never disagree about which universe is measured — never hardcoded,
  and never a provider-side symbol map (`TICKER_YF` is not imported here). Rendered beside
  `TableSourceFooter`, never inside its `source` string; exactly one footer per table survives.
- **Localization.** The calendar period enum (`Q1|Q2|Q3|Annual`, no Q4 — the annual filing replaces
  it) was printed raw, so the Spanish UI showed the English word **"Annual"**. New bilingual
  `earnings.calPeriods.*` (`Anual` in ES). Recent Results' own `period` is left alone — `"Q1 2026"`
  from `quarterLabel()` is already language-neutral.
- **Report dates.** Raw ISO (`2026-08-04`) → the shared `formatDate`. **A real trap was found and
  closed here:** `new Date('2026-08-04')` parses as UTC midnight, which in Chile (UTC-4/-3) formats
  as **03 ago — one day early**, on a page whose entire job is stating when a company reports.
  `formatDate` had zero prior call sites, so nothing depended on the behaviour. Since
  `src/lib/formatters.ts` is out of scope, the *input* is normalized to local midnight
  (`formatDate(\`${iso}T00:00:00\`)`) rather than the formatter changed — no second formatter, no
  hand-rolled segment surgery. Guarded by a behavioural test that also proves the drift is real
  when running west of UTC.
- **Composition.** `SectionHeader` → shared **`PageHeader`** (tag→eyebrow, subtitle→metadata,
  Update Data action unchanged) — the last R-series header migration for this route. The hand-rolled
  export capsule → shared **`ChipButton`** (same handler, filename, headers, row mapping, accessible
  name). Upcoming gained a **Company** column in 2nd position (the name+id identity anatomy R6
  established and Recent Results already had), resolved from the client-safe `@/lib/data/companies`
  registry with an honest `—` fallback and **no added API request**; `colSpan` 3→4, `scope="col"`
  14→15. The inline `45` became `UPCOMING_WINDOW_DAYS`.
- **Deliberately NOT changed:** no sort, filter, period selector, KPI strip, sparkline, detail
  drawer, consensus/forecast/surprise field, quality pill, static fallback, new cache, or new route.
  The Recent Results CSV is byte-identical and deliberately does **not** gain the new Upcoming
  Company column. `fmtMM`/`fmtEps`/`pctCell`, the currency column, bank-EBITDA suppression, negative
  styling, the amounts note, the record count, `Promise.all` isolation with 4 independent
  `.catch(() => null)`, force-refresh semantics, `w-full`, both `minWidth` floors and the `Reveal`
  cadence are all unchanged. Home shares the identical raw-period and date-format defects but is a
  separate route and was **not** touched.

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
- **Fable component mapping (as-built, Phase 5H + parity repair):** the page is rebuilt to the
  Fable **composition**, not merely re-skinned. Header → Fable header architecture (eyebrow,
  19px `ui-page-title`, identity/meta inline on the baseline, actions right). Region A →
  Fable Overview §1 hero language: total-value hero card (`flex 1.7 1 400px`, `ui-kpi-hero`
  value + tinted `ChangeIndicator` delta pill + auto-fit secondary-minis grid under a divider)
  beside the exposure meter panel (`flex 1 1 250px`). Region B → Fable Portfolio §2 workspace:
  wide `TableCard` column (`flex 2.6 1 620px`) with the `SegmentedControl` in the card's own
  toolbar, beside a narrow right rail (`flex 1 1 280px`) holding the add-form side panel and the
  CONCENTRATION meter panel. `MarketDataSourceBadge` + `TableSourceFooter` preserved.
- **New component required:** **No** — reused Phase 3 `TableCard`/`ChangeIndicator`/
  `SegmentedControl`/`GlassSurface`/`AsyncState`/`Reveal`, plus two page-local primitives
  (`RailPanel`, `MeterRow`) composed entirely from those.
- **Impl. status:** ✓ Phase 5H (2026-07-29) · **Verif. status:** ✓ Source-scan + bundle verified
  (123 tests in `tests/fablePortfolioPage.test.ts`; build 0 errors, `/portfolio` still static/`○`).

**Phase 5H — `/portfolio` as built (incl. the same-day Fable-parity repair).** Every hook, state
variable, effect, and computed value (`displayed` `useMemo`, `loadDetail`, `refresh`, `doRefresh`,
every form's validation/fetch logic) is byte-for-byte unchanged — the **layout** is what changed.

**The composition (Fable-authoritative):**
- **Header** — eyebrow + 19px title with the identity/meta (`{positionCount} holdings` +
  `MarketDataSourceBadge`) **inline on the baseline**, `UpdateDataButton` right. This is Fable's
  own `h1` + meta-span header, replacing the stacked tag/title/subtitle/badge-on-its-own-line
  block. All three original strings (`tag`/`title`/`subtitle`) are preserved.
- **Region A — asymmetric hero row** (Fable §1: *"deliberate asymmetry — no equal-card grid"*).
  The old flat 7-across `KpiCapsule` grid is **gone**. Market Value is now the single primary
  metric at `ui-kpi-hero` scale; Unrealized P&L is the Fable delta pill directly beneath it
  (a `ChangeIndicator` inside a `color-mix` tinted capsule, so direction is never colour-alone);
  the remaining five metrics are **secondary**, under a divider in Fable's
  `repeat(auto-fit, minmax(120px,1fr))` minis grid. Beside it, sector exposure moved out of its
  full-width band into the Fable exposure **meter panel** (`flex 1 1 250px`).
- **Region B — analytical workspace** (Fable §2: *"the table IS the page"*). A wide `TableCard`
  column (`flex 2.6 1 620px`) with the tab `SegmentedControl` relocated **into the card's own
  toolbar**, beside a narrow right rail (`flex 1 1 280px`) carrying (a) the active tab's add-form
  as a Fable **side panel** with vertically-stacked full-width chip inputs, and (b) the Fable
  **CONCENTRATION** panel. The Cash tab's 5 summary metrics stay in the left column, adjacent to
  the table they describe (Fable's secondary-information placement).
- **CONCENTRATION** renders the five largest holdings using the `weight` **already computed by
  `valuePositions`** — a sort + slice only; every number shown is `position.weight` verbatim, and
  its headline stat is the single largest existing weight, deliberately **not** a top-10 sum
  (that would be a new calculation).

**Fable elements omitted, with the precise missing data:** hero **sparkline** (no portfolio-value
time series exists — no history table, no endpoint); **currency mix** (`valuation.ts` is CLP-first
and implements no FX conversion, so the panel would be a single 100% CLP bar); **search + asset-class
filter row** and **sortable headers** (no filter/sort state or handler exists on this route —
adding one is new functionality, not a re-skin); **row-click position detail panel** (no
position-detail payload/endpoint exists, and the row already owns an inline-edit interaction);
**performance / attribution / benchmark / risk charts and monthly-return grids** (none of that data
exists for a portfolio here). Each is asserted absent by test, and the omission reason is written
into the page's own header comment.

**Preserved verbatim:** all 3 tables (12/10/4 columns in order), all 3 add-forms with their exact
endpoints/payloads/validation/409-422 branches/2500ms auto-dismiss, the transaction-derived
read-only lock, the 6 write calls, the single `MarketDataSourceBadge` and single
`TableSourceFooter`, all 3 distinct empty-state messages, and the `TableCard` empty-state fix so
the Positions source footer survives a zero-position portfolio.

**Fixed in passing** (same pre-existing defect Phase 5B fixed on Watchlist): all 3 submit buttons
moved off `bg-primary text-surface` (a latent dark-mode contrast failure) onto
`bg-primary text-primary-fg`. **Accessibility added:** `aria-label` on every form control, a
permanently-mounted `role="status" aria-live="polite"` feedback region per form, a descriptive
`aria-label` on the transaction remove button, `scope="col"` + `sr-only <caption>` on every table,
and `title` on truncated meter names.

**Deliberately NOT changed:** no confirmation dialog on removal (none existed); no persistence key
for the active tab (it has always reset to Positions on mount); no FX/dividend/attribution field;
no shared Fable component modified; no CSS added (the meter fill reuses the existing
`.nv-transition-state` width transition, already reduced-motion-gated globally).

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
- **Impl. status:** **✓ R7 (2026-07-31)** · **Verif. status:** source-scan verified (cell
  reconciled R12 — the master table row was updated at R7 but this planning section was not).

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
- **Impl. status:** **✓ R7.1 (2026-07-31)** · **Verif. status:** source-scan verified (cell
  reconciled R12).

## 13. `/settings` 🔒 — Settings (canonical) — **R9.2 + R9.3 + R9.4 as built**

- **Canonical destination.** `/settings` is now what the primary Settings nav item points at.
  `/settings/notifications` is **unchanged and still fully functional** — `matchesPrefix` keeps it
  resolving to the same nav group, so its active-pill state and `getPageTitle` are untouched. Its
  redirect and the NotificationBell repoint belong to **R9.4**, when a real `#notifications` target
  exists to land on.
- **Architecture:** `page.tsx` is a **server component** (`force-dynamic`) — the first in the app.
  It is the only place account authority is read: `getCurrentUser()` (`supabase.auth.getUser()`,
  Auth-server verified) and `getApprovalProfile()` (session-bound client, own-row RLS). Only
  sanitized serializable facts cross into `SettingsClient.tsx`. **No new API route, no migration,
  no service-role client, no `user_profiles` write.**
- **Content sections:** (1) `PageHeader`; (2) **Account** — display name · email · username ·
  access, as a `<dl>`; (3) **Data sources** — live rows from `GET /api/health/ingestion`;
  (4) **Security** — four factual NMI invariants plus Reset-password → `/forgot-password` and
  Sign out → `/logout`; (5) **Display** (R9.3) — Theme and Language; (6) **Notification Recipients**
  (R9.4) — the full-width third row, the page's one mutation-heavy surface.
- **Notification Recipients (R9.4).** The Fable Audit-History slot: one full-width `TableCard`
  (compact uppercase section label, near-opaque table material, dense rows, card-level horizontal
  overflow at a 560px floor, bordered footer note), with the add form in the toolbar slot and the
  R9.1 `Switch` as the Active control. `src/app/settings/NotificationRecipientsCard.tsx` owns it, so
  three mutations, per-row pending state, a confirmation gate and a feedback region never obscure the
  read-only composition.
  - **Server contract completely unchanged** — the same four endpoints
    (`GET`/`POST /api/notification-recipients`, `PATCH`/`DELETE /api/notification-recipients/[id]`),
    the same methods, payloads, email validation, 80-char label cap, trimming, shared-trust RLS and
    delivery consumer. No API, repository, type or migration was touched.
  - **Three dishonest client behaviours repaired.** A failed `GET` fell through
    `Array.isArray(...) ? ... : []` and rendered the EMPTY state — now `loading`/`ready`/`error` are
    three explicit states and a failure is never empty. The Active toggle swallowed every failure
    behind `.catch(() => {})` — now the optimistic update rolls back, scoped to the one affected
    recipient (never a whole-list snapshot, which would discard another row's concurrent result).
    Delete removed the row BEFORE the request, also behind `.catch(() => {})` — now the row is
    removed only after a confirmed response, behind the shared `DestructiveConfirm` gate.
  - **Add clears only after confirmed success.** The route returns `{ ok: true }`, not the row, so a
    success re-reads the confirmed list; a non-ok response preserves both entered values, shows a
    localized failure and inserts nothing. `invalid_email` keeps its exact prior behaviour; a
    unique-violation on the `citext UNIQUE` email column is now named specifically instead of
    falling into the generic message. The server's own error text is classified, never rendered.
- **Backward compatibility.** `/settings/notifications` is **preserved** as a server `redirect()` to
  `/settings#notifications`. One direction only — `/settings` redirects nowhere, so no loop is
  possible. Both paths stay `private_page`, both still resolve to the Settings nav group, and
  `getPageTitle('/settings/notifications')` is unchanged. The notification bell now points **directly**
  at `/settings#notifications` (one navigation instead of two); nothing else about the bell changed.
- **Display preferences (R9.3).** Two `SegmentedControl` selectors, each a synchronized **view** of
  preference state that already existed and still lives elsewhere:
  - **Theme** → the one shared store `@/lib/useTheme` (`useTheme()` / `setTheme`). Key `theme`,
    RAW `'dark' | 'light'`, default `dark` — all unchanged, and the option values ARE the stored
    values, so nothing is mapped or re-encoded. The pre-paint script in `layout.tsx` is untouched
    and still compares the raw string; the single downstream effect is still
    `documentElement.classList.toggle('dark', …)`.
  - **Language** → the existing `LangProvider` (`useLang()` / `setLang`). Key `lang`, RAW
    `'en' | 'es'`, default `en`. Option labels are **endonyms** (English · Español) in both
    dictionaries, so a user who lands in a language they cannot read can still find their own.
  - **Synchronization is bidirectional and automatic**, because neither control owns state: Settings
    ↔ TopBar in the same tab (theme via the store's `cmi-ls:theme` event; language via React
    context) and across tabs (both via the native `storage` event). No second key, provider,
    dictionary, default, or storage format was introduced.
  - **Immediate-save model** — no Save / Apply / Cancel / Reset / unsaved-changes state / toast. The
    downstream effect (the whole app repainting or retranslating) *is* the confirmation. The card's
    footer states plainly that the choice applies immediately and is remembered in this browser —
    a factual statement about per-browser client preferences, not a fabricated "saved" indicator.
- **Data source / API:** existing `/api/health/ingestion` only (macro + market domains). Fetched
  after mount with an `AbortController`; `AsyncState` `loading` / `unavailable` / `empty` are
  distinct, so a failure is never rendered as healthy or empty. Every subline field is guarded on
  actually being returned; dates go through `formatSourceDate`.
- **Account authority:** username comes from the authoritative `user_profiles` row **only** — a
  failed read renders "Unavailable" rather than borrowing metadata. Access is a **tri-state**
  (`approved` / `not_approved` / `unavailable`) so an unreadable profile is never silently
  downgraded into a denial. `user_metadata` supplies a display name for presentation and never an
  authority claim. `role` is neither selected nor displayed.
- **Excluded Fable fixture content** (screen 10 is almost entirely prototype data): the four-person
  user directory (RLS permits reading only your own row), the four invented feeds, the six security
  capabilities NMI does not have (SSO · 2FA · session timeout · device trust · IP allowlist · export
  watermark — rendering `ENFORCED` for these would be a fabricated security assurance), the five
  inert notification switches, the four reporting policies, and the audit log with its seven-year
  immutability claim. The **visual** composition is reproduced exactly; the content is NMI's.
- **Auth:** **protected** — `private_page` under default-deny, same as before.
- **Fable destination:** **10 Administration**, Fable proportions preserved — row 1 `1.6 1 420px`
  beside `1 1 300px`; row 2 `1.2 1 320px` (Security) beside the Display slot Fable filled with its
  five inert notification switches; row 3 the full-width Audit-History slot; `min-width:min(100%,…)`
  stacking, 14px gaps, 22px glass, uppercase section labels, primary-over-subline rows,
  right-aligned trailing element (a status chip on the read-only cards, a compact selector on
  Display, a Switch + Remove chip on each recipient row), staggered `Reveal` at 70/130/190ms.
- **New component required:** **No** — `PageHeader`, `GlassSurface`, `ChipLabel`, `AsyncState`,
  `Reveal`, `SegmentedControl` (R9.3) and `TableCard`/`ChipButton`/`Switch`/`DestructiveConfirm`
  (R9.4) all already existed. No shared primitive was introduced or modified in either phase; R9.4
  is the R9.1 `Switch`'s first and only consumer.
- **R9.5 consolidation audit (2026-08-04):** the five phases were re-read as one surface. Two source
  defects repaired, both in `NotificationRecipientsCard.tsx` and neither touching a primitive:
  (1) focus fell to `<body>` after a confirmed removal, because `ModalShell` restores focus to the
  Remove chip that had just unmounted with its row — the section is now `tabIndex={-1}` and takes
  focus on the confirmed-success path only; (2) the confirmation dialog's target email, one
  unbreakable token in a clipping dialog, could be cut off at 320px — it now wraps exactly as the
  table cell already did. Everything else audited clean; see `06-acceptance-checklist.md` § R9.5.
- **R9.6 — Privacy Mode (2026-08-04):** the Display card's **third** row, after Theme and Language.
  Existing architecture, unchanged: `usePrivacyMode` → `usePersistentState<boolean>('cmi.privacyMode',
  false)` — one hook, one key, JSON-serialized, default OFF, same-tab `cmi-ls:cmi.privacyMode` event,
  cross-tab native `storage`. The control is the shared R9.1 `Switch` (a genuine boolean, unlike the
  two radiogroup selectors above it), immediate-save, no Save/Cancel/toast. Copy states the real,
  narrow effect and explicitly disclaims being a security control.
  **Masked (Portfolio):** total market value, total cost basis, unrealized and realized P&L amounts,
  cash balance, all five cash-summary totals, ledger amounts; per position quantity, average cost,
  market value and P&L amount; per transaction quantity, price, fees, taxes, net and realized P&L.
  **Deliberately visible:** public last price, ticker, company, sector; all user-derived
  PERCENTAGES (P&L %, position weight, sector exposure, concentration — proportions and performance
  disclose no amount, and the meter bars encode weight graphically, so masking only their printed
  number would be theatre); holdings count; transaction date/type; ledger description; and the
  inline editor and add-forms, which are the user's own explicit input.
  **Home had NO user-specific amount at R9.6** — superseded by design in R10, which added real
  portfolio/notes consumers to Home; every such amount masks through the same shared boundary
  (see §1's R10 record).
- **Pending:** none — **R10 (the Fable Home redesign) is implemented; manual validation pending.**
- **Impl. status:** R9.2 + R9.3 + R9.4 + R9.6 implemented, R9.5 audited · **Verif. status:** automated
  complete, manual pending.

## 13b. `/settings/notifications` 🔒 — preserved redirect — **R9.4 as built**

- **What it is now:** a server component whose only statement is
  `redirect('/settings#notifications')`. The route is **preserved, not deleted**, so existing
  bookmarks, older links and any pre-R9.4 bell target still resolve.
- **Direction:** one-way by construction. `/settings` redirects nowhere, so a loop is impossible.
- **Content sections / data source / user interactions:** none — the entire workflow (add form,
  recipients table, Active toggle, Remove) moved to `/settings#notifications`, section 13 above.
  The four API endpoints it used are unchanged and are now called from
  `src/app/settings/NotificationRecipientsCard.tsx`.
- **Auth:** **protected** — still `private_page` under default-deny, and still resolving to the
  Settings nav group with an unchanged `getPageTitle`.
- **Fable destination:** n/a — the destination is section 13's full-width third row.
- **New component required:** **No.**
- **Impl. status:** R9.4 implemented · **Verif. status:** automated complete, manual pending.

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
- **Impl. status:** **R1 implemented (2026-07-29)** — page moved to
  `src/app/(auth)/login/page.tsx` (same URL); `ShellGate` in the root layout suppresses AppShell
  for `/login`; `(auth)/layout.tsx` supplies `LangProvider` + `AuthShell` (photo/veils/Ken-Burns/
  lockup/utility chips/notice); `AuthPanel` is the Tier-1 glass panel. The full Phase-6B contract
  is preserved verbatim (endpoints, payloads, error mapping, `next` guard, loading/disabled,
  field attributes, mode toggle, links); loading now shows a tokenized spinner beside the label;
  the error banner gained `role="alert"`; the username field gained `autoFocus`. **No Show/Hide
  password** (not currently supported; no Class C approval), no remember/passkey/demo/clock-mock
  auth. Utility chips re-skin the EXISTING LangToggle/ThemeToggle via token rescoping only.
  **Performance repair after the first manual pass (2026-07-29):** Ken-Burns drift, the
  pointer-tracked specular, and the secure-dot pulse are removed — the gateway is visually still
  once entered, and `AuthPanel` is stateless so pointer movement can no longer re-render the form.
  The entrance (`.nv-auth-reveal` / `.nv-auth-fade`) animates opacity and transform only, at
  **exactly the app pages' `--dur-reveal` (640ms) / `--ease-primary` / 22px-rise timing** with
  `--stagger-reveal` tiers, so the login settles at the same pace as Markets and Macro. Documented
  deviation from Fable §0; rationale in doc 04 § "R1 performance repair". No auth behavior changed.
  · **Verif. status:** automated validation complete (`tests/fableAuthShell.test.ts`, 56);
  manual browser validation pending.

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
- **Impl. status:** **✓ R1.6 (2026-07-30)** · **Verif. status:** source-scan verified (cell
  reconciled R12).

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
- **Impl. status:** **✓ R1.6 (2026-07-30)** · **Verif. status:** source-scan verified (cell
  reconciled R12).

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
| **SectionHeader** | most pages | Fable page title (19px/650) + actions row — **R0 (2026-07-29) shipped the `PageHeader` primitive** (`src/components/fable/PageHeader.tsx`); route adoption happens per-route in the Stage 5R program (R1–R11), not in R0 | Restyle |
| **DataSourceBadge / MarketDataSourceBadge / SourceStateBadge** | tables | Fable status chip (dot + word) — **semantics preserved** (merge point 10) | Restyle |
| **TableSourceFooter** | every table | Fable meta line — **one per table preserved** (merge point 10) | Restyle |
| **UpdateDataButton** | 7 pages | Fable primary/outline pill button w/ spinner→✓ — **R0 (2026-07-29): visual normalization only** (999px pill, tokenized motion/spin). Its API and behavior are unchanged: `onRefresh` stays **required**, the component holds no provider dependency, and each page keeps supplying the authoritative `useGlobalRefresh` callback (decision D-1) | Restyle |
| **EmptyState / StatusPill** | various | Fable muted glass empty state / status pill | Restyle |
| **Charts** (LineChart, CompareChart, FundamentalsChart, YieldCurveChart) | analysis pages | Fable SVG chart language (gridlines, dashed zero, chart palette, crosshair) | Restyle |
| **Pre-paint theme script** | layout head | Preserve verbatim (extend to also set `body.nv-light` if light chosen as non-default) | Preserve |
| **Providers** (Lang/MarketData/MacroData/Sidebar) | AppShell | Preserve mounted; wrap Fable shell | Preserve |
