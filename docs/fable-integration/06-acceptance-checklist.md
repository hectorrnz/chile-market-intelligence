# 06 — Acceptance Checklist

> **Audit phase — no application code changed.** The gate the merged app must pass. Organized as
> (A) the 12-point merge contract, (B) per-route content preservation, (C) cross-cutting quality
> gates. Check boxes as the re-skin lands. Nothing here is satisfied yet — this is the target.

Status key: `[ ]` not done · `[~]` in progress · `[x]` verified.

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
- [ ] **8 · Dark mode preserved.** Light and dark both fully supported; pre-paint no-flash intact;
  WCAG AA in both themes; default-theme decision (D1) implemented as agreed.
- [ ] **9 · Responsive fixes preserved.** Card-level table scrolling, mobile navigation behavior,
  and **zero page-level horizontal overflow** at every breakpoint.
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
- [ ] Tokens: every Fable token present in `globals.css` with a **light and dark** value.
- [ ] Liquid Glass materials applied (card/header/overlay/chip tiers); dense tables on near-opaque
  surface.
- [ ] Typography scale, `tabular-nums lining-nums` body-wide, updated `.ui-label`/`.ui-table-header`.
- [ ] Radii (999px pills, 22–24px cards), shadows, spacing per spec.
- [ ] Segmented pill controls with sliding indicator where Fable uses them.
- [ ] Motion (reveal, count-up, nav slide, drawer/pop) present and **`prefers-reduced-motion`-gated**.
- [ ] Login: Ken-Burns Santiago bg, cursor specular, utility chips (secure dot, EN|ES, clock,
  contrast), glass auth panel.

### C2 · Shared components restyled (semantics unchanged)
- [ ] `ThemeToggle`, `LangToggle`, `SectionHeader`, `EmptyState`, `StatusPill`, `UpdateDataButton`.
- [ ] `DataSourceBadge`, `MarketDataSourceBadge`, `SourceStateBadge`, `TableSourceFooter` — states,
  labels, tooltips, one-footer-per-table preserved.
- [ ] `CommandPalette` (⌘K/`/`/`cmdk:open`, recent searches), `NotificationBell` (drawer, polling,
  auth-gate, mark-read).
- [ ] Charts (`LineChart`, `CompareChart`, `FundamentalsChart`, `YieldCurveChart`,
  `EconomicCalendarTable`) — props, ResizeObserver, hover, markers, dual-axis intact.
- [ ] New: `GlassCard`, `KpiCapsule`/`KpiHero`, `SegmentedPill`, `Sparkline`, `BarrierGauge`
  (+ optional `DetailPanel`, `SideScrim`, privacy mask).

### C3 · Interaction & state preservation
- [ ] All persisted `cmi.*` keys (compare, gf, ratesOrder, chartTimeframe, macroRegion,
  sidebarCollapsed) round-trip.
- [ ] Window events (`macro:region`, `gf:ticker`, `cmdk:open`) fire and are handled.
- [ ] CSV export (Stocks/Compare/Charting/Earnings) and Print (Company) work.
- [ ] `Update` buttons refresh via `useGlobalRefresh`; badges reflect live/persisted/static.

### C4 · Engineering gates (run at each phase boundary)
- [ ] `npm run build` → 0 errors, all routes present.
- [ ] `npm run lint` → 0 problems.
- [ ] `npm test` → all 75 files pass (business-logic tests untouched; DOM tests updated only
  deliberately, never deleted to pass).
- [ ] Browser responsive ladder (1728/1440/1280/1023/900/767/630/430/390) in **light + dark** and
  **EN + ES**, per route → zero page-level horizontal overflow.
- [ ] Accessibility: focus-visible ring, `aria` on toggles/dialogs, `prefers-reduced-motion`, AA
  contrast.
- [ ] Print tearsheet (Company) renders; `.no-print` chrome hidden.

### C5 · Governance & docs
- [ ] `docs/design_principles.md` + CLAUDE.md design sections rewritten to the Fable language
  (Phase 0) — the app no longer contradicts its own design authority.
- [ ] `docs/data_source_status.md` current (no module static as terminal state).
- [ ] `docs/fable-integration/03` implementation/verification columns updated per route.
- [ ] No new runtime dependency added without an explicit, documented decision (D6).

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
