# 06 — Acceptance Checklist

> **Audit phase — no application code changed.** The gate the merged app must pass. Organized as
> (A) the 12-point merge contract, (B) per-route content preservation, (C) cross-cutting quality
> gates. Check boxes as the re-skin lands. Nothing here is satisfied yet — this is the target.

Status key: `[ ]` not done · `[~]` in progress · `[x]` verified.

**Phase progress:** Phase 0 (design governance) ✓ · **Phase 1 (shared visual foundation) ✓
COMPLETE 2026-07-22** · **Phase 2 (app shell: top pill navigation) ✓ COMPLETE 2026-07-24** ·
**Phase 3 (shared UI primitives / Fable component library) ✓ COMPLETE 2026-07-24** ·
**Phase 4 (shared chart & financial-visualization system) ✓ COMPLETE 2026-07-24** ·
**Phase 5A (`/stocks` page re-skin) ✓ COMPLETE 2026-07-28** ·
**Phase 5B (`/watchlist` page re-skin) ✓ COMPLETE 2026-07-28** ·
**Phase 5C (`/companies/[ticker]` page re-skin) ✓ COMPLETE 2026-07-28** ·
**Phase 5D (`/compare` page re-skin) ✓ COMPLETE 2026-07-28** ·
**Phase 5E (`/chart-builder` page re-skin) ✓ COMPLETE 2026-07-28** — see
`04-file-level-implementation-plan.md` § "Phase 1 — as built" / "Phase 2 — as built" /
"Phase 3 — as built" / "Phase 4 — as built" / "Phase 5A — `/stocks` — as built" /
"Phase 5B — `/watchlist` — as built" / "Phase 5C — `/companies/[ticker]` — as built" /
"Phase 5D — `/compare` — as built" / "Phase 5E — `/chart-builder` — as built". Phase 5's
remaining 7 pages and Phases 6–8 not started. Items below are ticked only where Phases 1–5E
genuinely satisfy them; everything that still depends on the remaining page work stays `[ ]` or
`[~]`.

---

## A. Merge contract — 12 points

- [ ] **1 · Nothing removed.** Every existing NMI route, module, table, field, control, dataset,
  source note, timestamp, user action, loading state, empty state, error state, language, auth
  rule, and business rule still present. (Cross-checked against doc 03 per route.)
- [ ] **2 · Fable authoritative for aesthetics.** Typography, layout hierarchy, colors, Liquid
  Glass materials, pill controls, spacing, motion, page transitions, responsive composition, and
  login presentation match the Fable spec (doc 02) via shared tokens/components.
- [ ] **3 · Fable-thinner-than-NMI → NMI content preserved with new Fable-language components.**
  News feed, sector heat map, Chilean-rates DnD, banded macro card, compare returns/settings,
  charting metric picker, portfolio transactions/cash, structured-note terms/schedule/allocation,
  notification recipients — all preserved as new glass-language components.
- [ ] **4 · Fable sample content unsupported by NMI data excluded.** Risk, Fixed Income, Research
  (except Upcoming Earnings), Documents, Admin (except notification switches), standalone
  Performance sample data, simulated auth, demo credentials, passkey, 3 sample portfolios — all
  excluded from production; only their visual language is reused.
- [ ] **5 · No Supabase/API/schema/ingestion/cron/source-priority/structured-note/auth/business-
  calc rewrite.** `src/app/api/**`, `src/lib/{providers,db,financials,structuredNotes,market,
  earnings,ingestion,observability,portfolio,compare}/**`, `src/config/**`, `src/data/**`,
  `src/middleware.ts`, `vercel.json`, `supabase/migrations/**`, `scripts/**` unchanged.
- [ ] **6 · No second authentication system.** Exactly one auth (Supabase username+password);
  login re-skin wires the real `/api/auth/*` routes; no simulated/passkey/demo auth added.
- [ ] **7 · English + Spanish preserved.** Every route renders in EN and ES; all new strings in
  both `dict.en` and `dict.es`; no hardcoded UI text.
- [~] **8 · Dark mode preserved.** Light and dark both fully supported; pre-paint no-flash intact;
  WCAG AA in both themes; default-theme decision (D1) implemented as agreed.
  *Phase 1: D1 + D2 implemented and browser-verified (dark first-visit default, stored light and
  stored dark both persist across reload, no flash in either direction, one class system). Every
  theme-varying token has a light and a dark value (asserted by `tests/fableFoundation.test.ts`).
  Three tokens deviate from the Fable palette to hold WCAG AA — documented in doc 04. Per-route AA
  auditing remains open until the pages are restyled.*
- [~] **9 · Responsive fixes preserved.** Card-level table scrolling, mobile navigation behavior,
  and **zero page-level horizontal overflow** at every breakpoint.
  *Phase 2: the navigation model itself changed by deliberate decision (D3, sidebar → top pill
  rail) and is now verified — desktop rail scrolls internally with a hidden scrollbar rather than
  wrapping or widening the page, the mobile drawer is `lg:hidden` with no page-level overflow, and
  `tests/responsiveLayout.test.ts` encodes the new conventions. Card-level table scrolling on
  individual pages is untouched (no page content changed). Full browser-ladder verification
  (1728→390, light+dark, EN+ES) remains open until pages are restyled in Phase 5 — this phase's
  checks were HTTP/source-level only (no interactive browser session was available).*
- [ ] **10 · Source labels, data-quality disclosures, and timestamps preserved.** Every table
  ends in one `TableSourceFooter` (plain source name); badges show correct state word + tooltip;
  monitoring-estimate/derived/unofficial disclaimers intact; as-of timestamps correct.
- [ ] **11 · No visible module static as a terminal state.** Every field stays classifiable as
  live/persisted/derived/static_fallback/temporary_static/blocked/unavailable; `docs/
  data_source_status.md` current.
- [ ] **12 · No secrets or private data exposed.** No credentials in client code; server-only
  provider/db boundary intact; no `NEXT_PUBLIC_` leak; no private PDFs/keys committed.

---

## B. Per-route content preservation (all 16 routes)

For **each** route: page title · all content sections · data source/API · all user interactions ·
loading state · empty state · error state · auth status — verified identical in behavior to doc
03, restyled in Fable language.

- [ ] `/` — Market Overview: macro card, watchlist+FX, earnings, sector heat map, Chilean rates
  (DnD), markets, news; `UpdateDataButton`, sort, DnD; loading/empty/error; public.
- [x] `/stocks` — toolbar + 9-col sortable table; search/sector/sort/CSV/Update; noResults; public.
  *Phase 5A (2026-07-28). All 4 sections, all 9 columns in their original order, both filters, all
  6 sort keys + the derived default + the refresh-clears-manual-sort rule, the CSV export, the
  ticker links, the live→persisted→static merge, the single badge / single footer / single as-of,
  and the "—"-never-zero fallbacks are preserved — locked by 74 tests in
  `tests/fableStocksPage.test.ts`. Restyled onto `TableCard` + Fable pill toolbar; empty state now
  runs through `AsyncState` while keeping its own exact `noResults` wording. No KPI, chart, or heat
  map was invented (no data on this route backs one).*
- [x] `/compare` — market data + returns (6 slots) + fundamentals + control bar + chart + settings
  modal; all `cmi.compare*` persisted; empty `—`; public.
  *Phase 5D (2026-07-28). All 6 slots + dedup/validation, all 12 fundamentals rows in order + all
  10 derived-field keys, the exact 5-timeframe array, all 11 `cmi.compare*` keys, 2 badges + 4
  footers with unchanged source-precedence, the chart's untouched series/legend/tooltip/axis
  delegation, and the historyAccumulating note under both footers are preserved — locked by 121
  tests in `tests/fableComparePage.test.ts`. All 3 tables restyled onto `TableCard`; TF and Period
  onto `SegmentedControl` (2nd/3rd adopter); the Settings modal onto the established
  `nv-scrim`/`nv-glass-overlay nv-pop` overlay recipe. Two genuine pre-existing bilingual/hex
  defects fixed in passing (`title="Clear range"` → `t.compare.clearRange`; a redundant hex
  literal → `PRESET[0]`).*
- [x] `/chart-builder` — toolbar + metric picker + dual-axis chart + underlying table + settings;
  `cmi.gf*` persisted; `gf:ticker` deep-link; noData/selectMetric; public.
  *Phase 5E (2026-07-28). All 6 sections, the 2-ticker (primary + optional overlay) configuration,
  all 21 metrics across 4 categories, the Absolute/Indexed and TTM/Annual toggles (now
  `SegmentedControl`), the fixed per-metric left/right axis assignment, the MM/CLP/%/"MM sh"
  formatter set shared by axis/tooltip/table, add/remove-metric and overlay-ticker behaviour, all
  8 `cmi.gf*` persisted keys with original defaults, the `gf:ticker` deep-link, the 1
  `SourceStateBadge` + 2 `TableSourceFooter` instances, and both empty states (now routed through
  `AsyncState` with the original exact copy) are preserved — locked by 112 tests in
  `tests/fableChartBuilderPage.test.ts`. Restyled onto `GlassSurface`(×3) + `TableCard` +
  `SegmentedControl`(×2, 3rd/4th production adopter) + the established Settings-modal overlay
  recipe. A genuine pre-existing responsive gap was closed (the underlying-data table had no
  `min-w`, unlike every other migrated table) via `TableCard minWidth={640}`. Two pre-existing
  hardcoded-English defects fixed in passing (the `vs` ticker separator; the metric-chip remove
  button's `aria-label="Remove"`). No reset/save/print action was invented (none existed); no
  `asOf` timestamp was invented (this route never had one).*
- [ ] `/macro` — calendar embed (US) + banded indicators + yield curve + FX depth (US) + chart
  popup; region via sidebar `macro:region`; Update; public.
- [ ] `/macro/calendar` — FRED calendar + FOMC outlook + Chile deferred; back link; public.
- [ ] `/earnings` — upcoming + recent results tables; Update/CSV; loading/empty; public.
- [x] `/companies/[ticker]` — KPI strip + business cards + price chart (8 TF + markers) + results +
  valuation grid + news; Print/Watchlist/Graph-fundamentals; `cmi.chartTimeframe`; public.
  *Phase 5C (2026-07-28). All 7 content sections, all 6 KPIs, all 8 chart timeframes (now a
  `SegmentedControl`), the EEFF markers, all 8 Recent Results columns, all 9 Valuation metrics +
  sector medians, the news panel, all 4 `TableSourceFooter` instances, the `MarketDataSourceBadge`,
  Print (`window.print()` + `.no-print`), the Watchlist link, and the "Graph fundamentals →"
  `cmi.gfTicker`/`gf:ticker` deep-link are preserved byte-for-byte in logic — only presentation
  changed (`KpiCapsule`/`GlassSurface`/`ChangeIndicator`/`AsyncState`/`SegmentedControl`/`Reveal`).
  `cmi.chartTimeframe` persistence untouched. No fabricated earnings quarters, no editorial quality
  pills (`auditSourceIntegrity.test.ts` H1 passes unchanged). Ships as a full page, not a side
  panel, per decision D4. **Same-day repair pass** fixed a KPI-footer overlap (negative margin
  removed), made the News section render in every state (never omitted on zero articles), gave the
  four bank tickers a P/B header KPI instead of P/E (via the existing `bankRegistry.ts`, never a
  fabricated P/TBV), and confirmed SONDA's chart gap is a local static-seed-coverage limitation, not
  a code defect (Yahoo already serves it correctly in hybrid/production mode). Test suite
  107 → 151.*
- [x] `/watchlist` 🔒 — add-ticker form + table + remove; loading/empty/409/422; protected.
  *Phase 5B (2026-07-28). All 3 sections, all 7 columns in order, the company links, the client-side
  ticker validation, the exact POST/DELETE shapes, 409/422 handling, the 2500ms auto-dismiss, and
  the single `TableSourceFooter` are preserved — locked by 81 tests in
  `tests/fableWatchlistPage.test.ts`. Protected-route redirect verified live
  (307 → `/login?next=%2Fwatchlist`). Restyled onto `TableCard` + `AsyncState`; the five async
  situations (loading / empty / no-watchlist / load-error / expired-session) are now distinct
  instead of all showing "your watchlist is empty", and the source footer survives the empty state.
  No watchlist selector, sorting, filtering, or source badge was invented — none existed, and a
  badge would contradict the honest `Static sample` footer. Three pre-existing defects fixed:
  a failed remove no longer drops the row, three untranslated English literals are now bilingual,
  and the Add button's dark-mode contrast token is corrected.*
- [ ] `/portfolio` 🔒 — 7 summary cards + sector exposure + Positions/Transactions/Cash tabs +
  forms; Update; all validation states; protected.
- [ ] `/structured-notes` 🔒 — dashboard KPIs + bar/donut + monitoring line + upload/extract/import
  + filters + Live/Archived + sortable table; protected.
- [ ] `/structured-notes/[id]` 🔒 — metrics strip + terms + current levels + underlyings + schedule
  + allocation grid + provenance/delete; protected.
- [ ] `/settings/notifications` 🔒 — add-recipient form + recipients table + active toggle; back
  link; protected.
- [ ] `/login` — cinematic shell + glass auth panel; username/password + create toggle + forgot
  link; real `/api/auth/login|register`; error mapping; `next` redirect; public (full-bleed).
- [ ] `/forgot-password` — request form + sent confirmation (no enumeration); public (full-bleed).
- [ ] `/auth/reset-password` — new+confirm password + done; recovery-session; validation; public.

---

## C. Cross-cutting quality gates

### C1 · Design language fidelity (doc 02)
- [x] Tokens: every Fable token present in `globals.css` with a **light and dark** value.
  *(Phase 1. Light under `:root`, dark under `.dark`; parity asserted by test.)*
- [~] Liquid Glass materials applied (card/header/overlay/chip tiers); dense tables on near-opaque
  surface. *(Phase 1 defines all 7 tiers — auth / nav / KPI / card / overlay / dense / scrim — each
  with an opaque fallback, blur gated behind `@supports`, no stacked blur, no blur on table rows,
  and opaque in print. **Applying** them to the shell/components/pages is Phases 2–5.)*
- [x] Typography scale, `tabular-nums lining-nums` body-wide, updated `.ui-label`/`.ui-table-header`.
  *(Phase 1. Verified in-browser: `.ui-table-header` computes to 10.5px / 700 / 1.47px in the body
  font; body numerals `lining-nums tabular-nums`.)*
- [x] Radii (999px pills, 22–24px cards), shadows, spacing per spec — **tokenised** as
  `--radius-*`, `--shadow-*`, `--space-*`. *(Phase 1; per-surface application is Phases 2–5.)*
- [~] Segmented pill controls with sliding indicator where Fable uses them.
  *(Phase 1 shipped the `.nv-indicator` motion primitive at 380ms/primary easing. Phase 2 consumed
  it for the nav rails. Phase 3 generalized it into a reusable `SegmentedControl` component
  (`src/components/fable/SegmentedControl.tsx`, `role="radiogroup"`, keyboard-operable, reuses
  `useNavIndicator`). **Phase 5C adopted it for the first time** — `/companies/[ticker]`'s
  8-timeframe chart selector — proving the component end to end on a real page. **Phase 5D adopted
  it twice more** — `/compare`'s TF (1M/YTD/1Y/3Y/5Y) and Period (D/W/M) toggles. **Phase 5E adopted
  it twice more again** — `/chart-builder`'s Absolute/Indexed and TTM/Annual toggles (5th/6th
  adopter overall). Macro's own timeframe/period/frequency toggles still use their original plain
  segmented buttons; migrating them to `SegmentedControl` remains its own Phase 5 page work.)*
- [~] Motion (reveal, count-up, nav slide, drawer/pop) present and **`prefers-reduced-motion`-gated**.
  *(Phase 1: all 6 Fable keyframes, the duration/easing token set, the foundational utilities, and
  the reduced-motion block — which disables reveal / Ken-Burns / pulse / spin outright and collapses
  everything else to `.01ms` — are in place and confirmed in the live stylesheet. Phase 2: nav-pill
  slide (`.nv-indicator`, real usage) and the mobile drawer slide-in (`.nv-slide-in`) are now live and
  reduced-motion-gated (asserted by `tests/topNavigation.test.ts`). Page-specific choreography and
  JS-driven count-up land with their pages, each of which must read the preference before animating.)*
- [ ] Login: Ken-Burns Santiago bg, cursor specular, utility chips (secure dot, EN|ES, clock,
  contrast), glass auth panel.

### C2 · Shared components restyled (semantics unchanged)
- [~] `ThemeToggle`, `LangToggle`, `SectionHeader`, `EmptyState`, `StatusPill`, `UpdateDataButton`.
  *(Phase 3: `StatusPill` extended with 8 new semantic variants, same `{label, variant?}` signature.
  `ThemeToggle`/`LangToggle`/`SectionHeader`/`EmptyState`/`UpdateDataButton` visual restyle deferred
  — they already consume semantic tokens from Phase 1 and were left out of Phase 3's explicit scope.
  Phase 5A restyled `SearchInput` to the Fable search pill — in scope for a page phase because
  `/stocks` is its only consumer repo-wide, which a test now locks. `SectionHeader` is consumed
  as-is by the new `/stocks` (it already wraps correctly); its own restyle is still open.)*
- [x] `DataSourceBadge`, `MarketDataSourceBadge`, `SourceStateBadge`, `TableSourceFooter` — states,
  labels, tooltips, one-footer-per-table preserved.
  *(Phase 3: confirmed untouched — `tests/fableComponents.test.ts` locks this in.)*
- [x] `CommandPalette` (⌘K/`/`/`cmdk:open`, recent searches), `NotificationBell` (drawer, polling,
  auth-gate, mark-read).
  *(Phase 3: both restyled to the Fable glass overlay/drawer language with full dialog semantics
  — role="dialog", aria-modal, focus trap/restore, body-scroll lock — while every keyboard
  shortcut, fetch, and persisted key is unchanged.)*
- [x] Charts (`LineChart`, `CompareChart`, `FundamentalsChart`, `YieldCurveChart`,
  `EconomicCalendarTable`) — props, ResizeObserver, hover, markers, dual-axis intact.
  *(Phase 4, 2026-07-24 — every prop/series/marker/tooltip-field/legend-item preserved
  (`tests/fableCharts.test.ts` asserts this per component); gridline/axis/border/crosshair/
  hover-dot tokens moved to a new shared `--chart-*` set; a shared `ChartTooltip` replaces four
  duplicated ad hoc tooltip boxes; each chart gained `role="img"` + `aria-describedby` + an
  `sr-only` data-driven summary + an SVG `<title>` — a real accessible alternative, not merely a
  title. No page that consumes these charts changed at the time.)* *(Phase 5C, 2026-07-28:
  `/companies/[ticker]` — the first consuming page to be restyled — confirmed the `LineChart`
  call (`data`/`unit`/`height`/`valueFormatter`/`primaryLabel`/`markers`) is untouched; only the
  surrounding card material and the timeframe control changed.)*
- [x] New: `GlassSurface`, `KpiCapsule`/`KpiHero`, `SegmentedControl`, `Sparkline`/`SparklineRow`,
  `BarrierGauge`, `DetailPanel`, `AsyncState`, `PrivacyValue`/`usePrivacyMode`, `CurrentActions`,
  `ChangeIndicator`, `useCountUp`, `motion` primitives (Reveal/Pop/SlideIn/ContentPulse).
  *(Phase 3, 2026-07-24 — `src/components/fable/*`, 16 files. Not yet consumed by any page — that
  is Phase 5.)*

### C3 · Interaction & state preservation
- [~] All persisted `cmi.*` keys (compare, gf, ratesOrder, chartTimeframe, macroRegion,
  sidebarCollapsed) round-trip.
  *Phase 2: `cmi.macroRegion` migrated verbatim into `SecondaryNav`/`MobileNavDrawer` (same key,
  same `'CL'|'US'` values). `cmi.sidebarCollapsed` has no successor — the top rail has no collapsed
  mode, so this key is now simply unused going forward (never read/written by any file); not
  removed from client localStorage automatically, but harmless. Phase 5C: `cmi.chartTimeframe` is
  now genuinely exercised by `/companies/[ticker]`'s restyled `SegmentedControl` — same
  `usePersistentState('cmi.chartTimeframe', '1Y')` call, unchanged. Phase 5D: all 11
  `cmi.compare*` keys are now genuinely exercised by `/compare`'s restyled page (2 of them via
  `SegmentedControl`) — same `usePersistentState` calls, unchanged, asserted by test. gf/ratesOrder
  are otherwise untouched (their pages haven't changed).*
- [~] Window events (`macro:region`, `gf:ticker`, `cmdk:open`) fire and are handled.
  *Phase 2: `macro:region` dispatch verified unchanged (same event name/detail shape) from both
  the desktop and mobile nav surfaces, and `macro/page.tsx`'s listener is untouched. Phase 5C:
  `/companies/[ticker]`'s "Graph fundamentals →" link still sets `localStorage['cmi.gfTicker']`
  and dispatches `gf:ticker` with the same detail shape, byte-for-byte unchanged. `cmdk:open`
  unaffected (its producer/consumer weren't touched this phase).*
- [~] CSV export (Stocks/Compare/Charting/Earnings) and Print (Company) work.
  *Phase 5A: the Stocks export is preserved unchanged — same `chilean_stocks` filename, same nine
  header labels, same row shape (asserted by test). Phase 5C: Company's Print button still calls
  `window.print()` verbatim and keeps its `no-print` class (source-verified) — restyled to the
  Fable pill shape only; a live in-browser print check was **not** run (Chrome extension not
  connected in this session), so this stays `[~]` rather than `[x]` pending that manual check.
  Phase 5D: Compare's Fundamentals CSV export (`handleExportFund` → `exportCSV`) is preserved
  byte-for-byte, same filename/headers/row-shape, asserted by test. Phase 5E: Charting's Export CSV
  (`handleExport` → `exportCSV`, `fundamentals_{ticker}` filename) is likewise preserved
  byte-for-byte, asserted by test. Earnings export untouched (its page is not yet restyled).*
- [~] `Update` buttons refresh via `useGlobalRefresh`; badges reflect live/persisted/static.
  *Phase 5A: Stocks still routes its single `UpdateDataButton` through `useGlobalRefresh()` and
  still derives `priceStatus` as live → persisted → static; both asserted by test and confirmed in
  the rendered markup.*

### C4 · Engineering gates (run at each phase boundary)
- [x] `npm run build` → 0 errors, all routes present. *(Phase 1 boundary: compiled in 6.4s, 19/19
  static pages, full route list unchanged. Phase 2 boundary: 0 errors, 19/19 static pages, full
  route list unchanged. Phase 3 boundary: 0 errors, full route table unchanged. Phase 4 boundary:
  0 errors, full route table unchanged — no page route touched.)*
- [x] `npm run lint` → 0 problems. *(Phase 1–4, 5A, 5B, 5C, 5D and 5E boundaries.)*
- [~] `npm test` → all files pass (business-logic tests untouched; DOM tests updated only
  deliberately, never deleted to pass). *(Phase 1 boundary: 1795 tests, 1792 pass. Phase 2 boundary:
  1846 tests, 1843 pass. Phase 3 boundary: 1980 tests, 1977 pass. Phase 4 boundary: 2074 tests,
  2071 pass. **Phase 5A boundary: 2150 tests, 2147 pass** — 1 new test file
  (`tests/fableStocksPage.test.ts`, 74 tests) plus 2 new tests added to
  `tests/responsiveLayout.test.ts`. One existing test was updated **deliberately**: that file's
  dense-table matcher now also recognises `TableCard`'s `minWidth={…}` delegation, and the two new
  tests prove the delegation is real (`TableCard` owns the `overflow-x-auto`; `/stocks` still
  passes `minWidth={760}`) — net coverage increased, nothing was relaxed. **Phase 5B boundary:
  2232 tests, 2229 pass** — 1 new test file (`tests/fableWatchlistPage.test.ts`, 81 tests) plus a
  620px-floor test in `responsiveLayout`. One existing test was updated **deliberately**:
  `fableStocksPage`'s "redesigns no other page" guard listed `/watchlist`, which Phase 5B migrated
  under its own brief — the entry moved out, the other five pages still hold the line, and
  `/watchlist` gained its own 81-test suite. A phase boundary moving, not an assertion relaxed.
  **Phase 5C boundary: 2232 → 2276 → 2232 tests, 2229 pass** (144 new across the initial pass plus
  the same-day repair pass, net `tests/fableCompanyDetailPage.test.ts` at 151 tests). **Phase 5D
  boundary: 2422 → 2543 tests, 2540 pass** — 1 new test file (`tests/fableComparePage.test.ts`,
  121 tests); `fableWatchlistPage`/`fableStocksPage`/`fableCompanyDetailPage`'s phase-boundary
  guards updated deliberately to remove `/compare`. **Phase 5E boundary: 2543 → 2655 tests, 2652
  pass** — 1 new test file (`tests/fableChartBuilderPage.test.ts`, 112 tests);
  `fableComparePage`/`fableCompanyDetailPage`'s phase-boundary guards updated deliberately to remove
  `/chart-builder`, the same precedent Phase 5B/5D set. The same 3 pre-existing, date-dependent
  `tests/newsModule.test.ts` failures persist unchanged across every one of these boundaries
  (fixtures stamped `15 Jul 2026` vs a rolling 7-day window; today is 2026-07-28). No news-related
  file is in any Phase 5 sub-phase's changed-file list.)*
- [ ] Browser responsive ladder (1728/1440/1280/1023/900/767/630/430/390) in **light + dark** and
  **EN + ES**, per route → zero page-level horizontal overflow.
  *Phases 3/4/5A, like Phase 2, could only run source-level, build, and rendered-markup checks —
  **the Chrome extension is not connected in this environment**, so no interactive browser session
  was available. Phase 5A did verify `/stocks` at the HTTP/markup level against a live dev server
  (200; 9 headers, 6 `aria-sort` headers, 25 rows/links, `min-width:760px` inside an
  `overflow-x-auto` container, no root `min-width`, no fixed pixel width — the search field caps at
  `max-width:220px` and shrinks, the toolbar wraps). Those are the conventions whose breakage
  causes page-level overflow, but they are **not** a substitute for viewing the page. A real
  browser ladder pass remains genuinely open. Phase 5B could verify even less at the markup level:
  `/watchlist` correctly redirects without a session, so its rendered DOM was never fetched —
  verification there is build-, source- and bundle-level plus the 307 redirect check. Phase 5E
  (`/chart-builder`) verification is source- and build-level only — unlike 5A–5D, no live dev-server
  fetch was performed this phase, so even the HTTP/markup-level check available to public routes was
  not exercised; the 12-col grid classes, the `TableCard minWidth={640}` floor, and the toolbar/
  metric-picker wrap/scroll conventions are asserted by test but not visually confirmed.*
- [~] Accessibility: focus-visible ring, `aria` on toggles/dialogs, `prefers-reduced-motion`, AA
  contrast.
  *Phase 2: the mobile drawer's dialog semantics and nav-indicator `aria-current`/reduced-motion are
  source-verified by `tests/topNavigation.test.ts`. Phase 3: the same dialog-semantics pattern
  (role="dialog", aria-modal, focus trap, Escape, restored focus, body-scroll lock) is now also
  verified on `NotificationBell`, `CommandPalette`, and the new `DetailPanel` component by
  `tests/fableComponents.test.ts`; `SegmentedControl`'s `role="radiogroup"`/keyboard handling and
  `BarrierGauge`'s accessible text equivalent are source-verified too. A live keyboard/
  screen-reader/contrast pass remains open.*
- [ ] Print tearsheet (Company) renders; `.no-print` chrome hidden.
  *Phase 5C: the Print button's `onClick={() => window.print()}` and `no-print` class are
  source-verified unchanged, and `globals.css`'s `@media print` rules were not touched by this
  phase — but a live `window.print()` render was not exercised (Chrome extension not connected in
  this session), so this item stays open pending that manual check.*

### C5 · Governance & docs
- [ ] `docs/design_principles.md` + CLAUDE.md design sections rewritten to the Fable language
  (Phase 0) — the app no longer contradicts its own design authority.
- [ ] `docs/data_source_status.md` current (no module static as terminal state).
- [~] `docs/fable-integration/03` implementation/verification columns updated per route.
  *(Phase 5A: `/stocks`. Phase 5B: `/watchlist`. Phase 5C: `/companies/[ticker]`. Phase 5D:
  `/compare`. Phase 5E: `/chart-builder` — each marked ✓ Complete / ✓ Verified with a full
  "as built" record in its section. The other 11 routes remain Not started / Not verified.)*
- [x] No new runtime dependency added without an explicit, documented decision (D6).
  *(Phases 1, 3, 4, and 5A all added none; `package.json`/`package-lock.json` unchanged every
  time — no chart library was added, per the brief's explicit instruction to keep the existing
  pure-SVG approach. Asserted by test in every phase.)*

### C6 · Security & privacy (merge point 12)
- [ ] No secrets/credentials in client bundles; no `NEXT_PUBLIC_` provider key.
- [ ] Server-only boundary intact (`src/lib/providers/**`, `src/lib/db/**` never imported by
  client components).
- [ ] Middleware protection lists unchanged; cron `CRON_SECRET` auth intact.
- [ ] No private term-sheet PDFs, workbooks, or keys committed with the login photo/assets.

---

## Sign-off

- [ ] All 12 merge-contract points ✔ (§A)
- [ ] All 16 routes content-preserved ✔ (§B)
- [ ] All cross-cutting gates ✔ (§C)
- [ ] Open decisions D1–D7 (doc 05 §A) resolved and implemented as agreed
- [ ] Final full-app pass in light+dark, EN+ES, desktop+mobile, authed+unauthed
