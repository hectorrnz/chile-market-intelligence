# 06 — Acceptance Checklist

> **Audit phase — no application code changed.** The gate the merged app must pass. Organized as
> (A) the 12-point merge contract, (B) per-route content preservation, (C) cross-cutting quality
> gates. Check boxes as the re-skin lands. Nothing here is satisfied yet — this is the target.

Status key: `[ ]` not done · `[~]` in progress · `[x]` verified.

**Phase progress:** Phase 0 (design governance) ✓ · **Phase 1 (shared visual foundation) ✓
COMPLETE 2026-07-22** · **Phase 2 (app shell: top pill navigation) ✓ COMPLETE 2026-07-24** ·
**Phase 3 (shared UI primitives / Fable component library) ✓ COMPLETE 2026-07-24** ·
**Phase 4 (shared chart & financial-visualization system) ✓ COMPLETE 2026-07-24** — see
`04-file-level-implementation-plan.md` § "Phase 1 — as built" / "Phase 2 — as built" /
"Phase 3 — as built" / "Phase 4 — as built". Phases 5–8 not started. Items below are ticked only
where Phase 1–4 genuinely satisfy them; everything that still depends on page work stays `[ ]` or
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
- [ ] `/stocks` — toolbar + 9-col sortable table; search/sector/sort/CSV/Update; noResults; public.
- [ ] `/compare` — market data + returns (6 slots) + fundamentals + control bar + chart + settings
  modal; all `cmi.compare*` persisted; empty `—`; public.
- [ ] `/chart-builder` — toolbar + metric picker + dual-axis chart + underlying table + settings;
  `cmi.gf*` persisted; `gf:ticker` deep-link; noData/selectMetric; public.
- [ ] `/macro` — calendar embed (US) + banded indicators + yield curve + FX depth (US) + chart
  popup; region via sidebar `macro:region`; Update; public.
- [ ] `/macro/calendar` — FRED calendar + FOMC outlook + Chile deferred; back link; public.
- [ ] `/earnings` — upcoming + recent results tables; Update/CSV; loading/empty; public.
- [ ] `/companies/[ticker]` — KPI strip + business cards + price chart (8 TF + markers) + results +
  valuation grid + news; Print/Watchlist/Graph-fundamentals; `cmi.chartTimeframe`; public.
- [ ] `/watchlist` 🔒 — add-ticker form + table + remove; loading/empty/409/422; protected.
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
  `useNavIndicator`) — but no page has adopted it yet. Compare/Charting/Macro's own timeframe/
  period/frequency toggles still use their original plain segmented buttons; migrating them to
  `SegmentedControl` is Phase 5 page work, not a Phase 3 deliverable.)*
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
  — they already consume semantic tokens from Phase 1 and were left out of Phase 3's explicit scope.)*
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
  title. No page that consumes these charts changed.)*
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
  removed from client localStorage automatically, but harmless. compare/gf/ratesOrder/
  chartTimeframe are untouched (their pages haven't changed).*
- [~] Window events (`macro:region`, `gf:ticker`, `cmdk:open`) fire and are handled.
  *Phase 2: `macro:region` dispatch verified unchanged (same event name/detail shape) from both
  the desktop and mobile nav surfaces, and `macro/page.tsx`'s listener is untouched. `gf:ticker`/
  `cmdk:open` unaffected (their producers/consumers weren't touched this phase).*
- [ ] CSV export (Stocks/Compare/Charting/Earnings) and Print (Company) work.
- [ ] `Update` buttons refresh via `useGlobalRefresh`; badges reflect live/persisted/static.

### C4 · Engineering gates (run at each phase boundary)
- [x] `npm run build` → 0 errors, all routes present. *(Phase 1 boundary: compiled in 6.4s, 19/19
  static pages, full route list unchanged. Phase 2 boundary: 0 errors, 19/19 static pages, full
  route list unchanged. Phase 3 boundary: 0 errors, full route table unchanged. Phase 4 boundary:
  0 errors, full route table unchanged — no page route touched.)*
- [x] `npm run lint` → 0 problems. *(Phase 1, Phase 2, Phase 3, and Phase 4 boundaries.)*
- [~] `npm test` → all files pass (business-logic tests untouched; DOM tests updated only
  deliberately, never deleted to pass). *(Phase 1 boundary: 1795 tests, 1792 pass. Phase 2 boundary:
  1846 tests, 1843 pass. Phase 3 boundary: 1980 tests, 1977 pass. Phase 4 boundary: **2074 tests,
  2071 pass** — 1 new test file (`tests/fableCharts.test.ts`, 94 tests); no existing test was
  modified this phase. The same 3 pre-existing, date-dependent `tests/newsModule.test.ts` failures
  from Phases 1–3 persist unchanged (News-module work, out of scope here; no news-related file was
  touched this phase, confirmed via `git status`).)*
- [ ] Browser responsive ladder (1728/1440/1280/1023/900/767/630/430/390) in **light + dark** and
  **EN + ES**, per route → zero page-level horizontal overflow.
  *Phase 3/4, like Phase 2, could only run source-level/build checks — no interactive browser
  session was available in this environment, and no page was restyled yet to ladder-test. A real
  browser pass remains open until Phase 5 renders the restyled charts on real pages.*
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

### C5 · Governance & docs
- [ ] `docs/design_principles.md` + CLAUDE.md design sections rewritten to the Fable language
  (Phase 0) — the app no longer contradicts its own design authority.
- [ ] `docs/data_source_status.md` current (no module static as terminal state).
- [ ] `docs/fable-integration/03` implementation/verification columns updated per route.
  *(Untouched by Phase 1 — no route changed.)*
- [x] No new runtime dependency added without an explicit, documented decision (D6).
  *(Phase 1, Phase 3, and Phase 4 all added none; `package.json`/`package-lock.json` unchanged
  every time — no chart library was added, per the brief's explicit instruction to keep the
  existing pure-SVG approach. Asserted by test in every phase.)*

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
