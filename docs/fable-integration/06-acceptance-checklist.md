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
**Phase 5E (`/chart-builder` page re-skin) ✓ COMPLETE 2026-07-28** ·
**Phase 5F (`/macro` + `/macro/calendar` page re-skin) ✓ COMPLETE 2026-07-28** ·
**Phase 5G (`/earnings` page re-skin) ✓ COMPLETE 2026-07-29** ·
**Phase 5H (`/portfolio` page re-skin) ✓ COMPLETE 2026-07-29** — see
`04-file-level-implementation-plan.md` § "Phase 1 — as built" / "Phase 2 — as built" /
"Phase 3 — as built" / "Phase 4 — as built" / "Phase 5A — `/stocks` — as built" /
"Phase 5B — `/watchlist` — as built" / "Phase 5C — `/companies/[ticker]` — as built" /
"Phase 5D — `/compare` — as built" / "Phase 5E — `/chart-builder` — as built" /
"Phase 5F — `/macro` + `/macro/calendar` — as built" / "Phase 5G — `/earnings` — as built" /
"Phase 5H — `/portfolio` — as built".
**Phase R0 (shared composition primitives — first phase of the accepted Stage 5R normalized
repair program) ✓ IMPLEMENTED 2026-07-29, pending manual browser acceptance** — PageHeader /
Chip / ModalShell (+ destructive-confirmation mode) / TableCard vertical-scroll option /
UpdateDataButton–LangToggle–ThemeToggle normalization / shell width alignment / two chart token
repairs; no route migrated; see `04-file-level-implementation-plan.md` § "Phase R0". R0 is not
manually accepted until its browser checks (gutter alignment, modal keyboard walk, both themes,
reduced motion) run.
**Phase R1 (auth shell + `/login`) ✓ IMPLEMENTED 2026-07-29, automated validation complete,
manual browser validation pending** — ShellGate + `(auth)` route group; AuthShell (photo, veils,
Ken-Burns, lockup, white-glass utility chips, notice) + Tier-1 AuthPanel; `/login` migrated with
the complete Phase-6B contract preserved (endpoints, payloads, error mapping, `next` guard,
loading/disabled, field semantics); passkey/demo/remember/Show-Hide/simulated-auth/auto-redirect
all excluded per the locked register; `/forgot-password` + `/auth/reset-password` deferred to R2;
see `04-file-level-implementation-plan.md` § "Phase R1". Not manually accepted until the browser
checks (sign-in/out, create, `next` round-trip, ES, reduced motion, 1728/1024/390) run.
**Phase R1.5 (private-access enforcement + admin-controlled provisioning) ✓ IMPLEMENTED,
automated validation complete, manual browser/API validation pending** — a security phase, not a
visual one. Middleware became DEFAULT-DENY over one authoritative allowlist
(`src/lib/auth/accessPolicy.ts`): before this, every route absent from a two-array denylist was
world-readable, including the whole `/api/market`, `/api/macro`, `/api/earnings`, `/api/financials`,
`/api/valuation`, `/api/compare` and `/api/news` surface. Public self-registration removed at both
layers (create-account mode gone from `/login`; `/api/auth/register` deleted). The approval boundary
(`user_profiles.username`, the record username login already required — no migration) is now
enforced at BOTH session-minting routes. One authoritative safe-redirect validator replaces the
`startsWith('/')` open redirect. Accounts are provisioned by `scripts/admin/provisionUser.ts`
(outside the router, dry-run by default, invoked with plain `node`). The gate verifies identity with
`auth.getUser()` — not a cookie read — and re-reads the approval record on **every** private
request, so revocation denies the next request with no token-expiry wait (403 for a verified but
unapproved identity, 401 for an invalid session). Canonical reference:
`docs/security_access_control.md`. Guarded by `tests/accessControl.test.ts` +
`tests/userProfilesRls.test.ts`.

**Two controls sit outside the application code.** Public Supabase signup was enabled and has been
**disabled by the administrator (verified 2026-07-30)**. The `user_profiles` self-approval RLS
repair is written as `supabase/migrations/20260730000000_user_profiles_admin_controlled_approval.sql`
but is **NOT YET APPLIED** — until it is, the database still lets any session-holder grant itself
approval. Not manually accepted until that migration is applied and the browser/API checks in the
security document run.

**Phase R2 (Fable password-recovery variants) ✓ IMPLEMENTED 2026-07-30, automated validation
complete, manual browser validation pending** — `/forgot-password` and `/auth/reset-password`
migrated into the `(auth)` route group (public URLs unchanged) and joined `ShellGate`'s bare-route
set, so all three public authentication routes now render the same AuthShell gateway instead of the
application shell. Both recovery pages were rebuilt on the Tier-1 AuthPanel with a new shared
primitive module, `src/components/fable/AuthForm.tsx` (field · notice · primary action · secondary
link · headline slot · panel column), which `/login` also adopts — so each auth concern has exactly
one implementation rather than three copies. Every recovery behaviour is carried over verbatim
(endpoints, payloads, generic non-enumerating sent state, mismatch guard, invalid-recovery-session
message, success redirect, loading/disabled semantics); the legacy `BrandLogo` card and plain
background are gone. **R2 repair (desktop review):** the "← Back to dashboard" link below the panel
is removed from all three routes — `/` is a private route, so from a signed-out gateway it only
bounced the visitor back to `/login`. The `AuthBackLink` primitive and the orphaned
`auth.backToHome` key are deleted; each auth route now emits exactly one anchor, its own in-panel
navigation. One new token trio
(`--nv-auth-ok-*`) gives the confirmation banner a sibling of the existing error banner, declared in
`:root` only, like every other `--nv-auth-*` token. **No security behaviour changed** — R1.5's
allowlist already classified all three routes public, and `/auth/callback` remains a route handler
at its own URL. Guarded by `tests/fableAuthRecovery.test.ts` (47) plus the updated
`tests/fableAuthShell.test.ts`. Not manually accepted until the side-by-side viewport checks
(1728/1024/390, reduced motion, EN+ES) and the end-to-end recovery round-trip run.

Phase 5's remaining 3 pages and later R-phases not started. Items below are ticked only where
completed phases genuinely satisfy them; everything that still depends on the remaining page work
stays `[ ]` or `[~]`.

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
  *Post-R1 shell repair (mobile brand wordmark clipping): manual validation at ~390px found a stray
  partial glyph beside the Nevada symbol. Two compounding causes — (a) the symbol's
  `hidden sm:inline-block` was **inert** (NevadaMark's root span already sets `inline-block`, and
  Tailwind emits `.inline-block` after `.hidden` at equal specificity, so the mark rendered at every
  width regardless); (b) the page-title span had no responsive gate, and since the utility cluster
  opposite is `shrink-0` the title was the only flexible child on the line and collapsed toward zero
  width instead of disappearing — on routes with no active nav group that string is literally
  `'Nevada Market Intelligence'`, which is why it read as a broken wordmark. Repaired in
  `TopBar.tsx` only: the symbol is now unconditional + `shrink-0` with no display class, and the
  breadcrumb title is `hidden sm:block` so it is **absent** below `sm` rather than truncated. The
  wordmark's `md:inline` reveal and all behavior at 768/1024/1728 are unchanged. Guarded by 9 new
  tests in `tests/topNavigation.test.ts` (55 in that suite). Manual re-check at 390px still pending —
  note the EN|ES and Light|Dark capsules together consume ~234px of the 366px content line at that
  width, so Spanish is the tightest case.*
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
- [~] `/compare` — market data + returns (6 slots) + fundamentals + control bar + chart + settings
  modal; all `cmi.compare*` persisted; empty `—`; private (R1.5).
  *Phase 5D (2026-07-28). All 6 slots + dedup/validation, all 12 fundamentals rows in order + all
  10 derived-field keys, the exact 5-timeframe array, all 11 `cmi.compare*` keys, 2 badges + 4
  footers with unchanged source-precedence, the chart's untouched series/legend/tooltip/axis
  delegation, and the historyAccumulating note under both footers are preserved — locked by 121
  tests in `tests/fableComparePage.test.ts`. All 3 tables restyled onto `TableCard`; TF and Period
  onto `SegmentedControl` (2nd/3rd adopter); the Settings modal onto the established
  `nv-scrim`/`nv-glass-overlay nv-pop` overlay recipe. Two genuine pre-existing bilingual/hex
  defects fixed in passing (`title="Clear range"` → `t.compare.clearRange`; a redundant hex
  literal → `PRESET[0]`).*
  *Phase R6 (2026-07-31) — analytical-workspace deepening, `[x]` pending manual browser check:
  `PageHeader` with live `{n}/6` selection count; Settings → shared `ModalShell` (focus trap +
  restore the old markup never had); `ChipButton`/`ChipSelect` replace hand-rolled chips;
  canonical `/companies/[ticker]` links + real company-name identity line (a genuine gap — the
  route previously linked to no detail page); touch-usable per-slot ✕ over the unchanged
  `setSlot(i,'')` remove semantics; best/worst emphasis gains `title` + `sr-only` (no longer
  color-only); Fable Attribution-style signed magnitude bars on Total Return (null → no bar,
  never zero-coerced); `CompareChart`'s one hardcoded literal localized (`legendHint`). Data,
  APIs, math, persistence, and every state semantic byte-identical — Phase R6 test block added.
  Manual 1728/1024/390 EN/ES light/dark reduced-motion validation still pending (no browser
  connected).*
  *Phase R6.1 (2026-07-31) — both Compare APIs were returning HTTP 500 at module evaluation:
  `fileURLToPath(new URL('<literal>', import.meta.url))` in `compareStatic.ts`. Root cause confirmed
  against webpack's own emitted runtime: it rewrites `new URL(...)` into a shim whose `protocol` is
  `''` (failing Node's duck-typed brand check while its borrowed `URL.prototype` makes the error
  name it `URL`), AND rewrites the JSON into an asset module returning `/_next/static/media/…` — so
  the string (`.href`) form alone is provably insufficient. Repaired by importing the JSON
  (`with { type: 'json' }`), leaving no path for any bundler to rewrite. Verified by force-evaluating
  the webpack-compiled module through the real `webpack-runtime.js`: 25 companies / 25 snapshots,
  BSANTANDER → Santander Chile | Banking, SQM-B price 63851 CLP. Turbopack unaffected (native URL);
  Turbopack build exit 0; both dev runtimes return JSON 401s and the 307 login redirect, so R1.5 is
  unchanged. Authenticated API walk and manual UI validation remain **not performed** — no session
  credentials and no browser connected.*
  *Phase R6.2 (2026-07-31) — 1D/5D read +0.00% for every security, Market Data ran days stale, and
  the chart sat below the returns table. Diagnosed live: Yahoo publishes carried-forward filler bars
  (repeated close, `volume: 0`) for Santiago tickers — 07-20…07-30 on every ticker — so "latest vs
  previous bar" compared filler to filler; `period2` is exclusive so the current session was never
  fetched; and 1D never used the quote, whose `previousClose` matched no chart bar. Fixed with a pure
  `shortTermReturns.ts` (session-counted math, conservative filler removal, quote-first 1D), a
  `to = today+1` range, per-row quote-derived as-of, and a reordered page (selection rail → controls →
  chart → returns → fundamentals → market data) with one `tfLabel` shared by the chart heading and the
  returns-table title. Live: BSANTANDER −0.52%/+1.62%, CHILE −2.18%/+1.92%, FALABELLA −0.33%/+4.99%,
  CENCOSUD +0.25%/−4.66%, as-of 2026-07-31. Authenticated API walk and manual UI validation still
  **not performed** (no credentials, no browser).*
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
- [~] `/macro` — calendar embed (US) + banded indicators + yield curve + FX depth (US) + chart
  popup; region via sidebar `macro:region`; Update; public.
  *Phase 5F (2026-07-28). All 5 content sections, all 6 CL / 6 US category bands in their original
  order, all 26 indicators + 7 Chile-rate rows, the live/static yield-curve tenor precedence
  (5 live / 7–11 static, unchanged), the 12-pair Frankfurter FX universe with quote direction, the
  1/3/5/10Y popup timeframe set, the exact `region === 'CL' ? 'grid-cols-1' : 'grid-cols-1
  xl:grid-cols-2'` responsive class, all 3 `DataSourceBadge` + 1 `SourceStateBadge` + 4
  `TableSourceFooter` instances, and every async/data-quality state are preserved — locked by 95
  tests in `tests/fableMacroPage.test.ts`. Restyled onto `TableCard`(×3, closing 2 pre-existing
  no-`min-w` gaps) + `GlassSurface` (yield-curve card) + `SegmentedControl` (5th adopter, popup
  timeframe) + the established Settings-modal overlay recipe (popup chart). Chartable indicator
  rows gained real keyboard operability (were mouse-only). Three pre-existing hardcoded-English
  defects fixed in passing (`regionCL`/`regionUS` region chip, `chartable` dot title, popup close
  button now reuses `t.fable.panel.close`). No `ChangeIndicator` upgrade on the Change columns —
  deliberately left as the original `changeColor()` text to avoid touching an unrelated
  pre-existing business-logic test (`tests/frankfurterFx.test.ts`) that asserts the FX ternary
  verbatim within a fixed character window.*
  *(R5 2026-07-31: deepened to the R3/R4 family — `SectionHeader` → shared `PageHeader` (region
  source subtitle + a new ALWAYS-visible `/macro/calendar` link in the metadata; before R5 the
  Chile region had no in-page path to the calendar), the hand-rolled chart-popup dialog → shared
  `ModalShell` (`dense`/`size="lg"`, R4.1 dialog system — gains focus trap/restore + body-scroll
  lock; page-local `useEscape`/scrim/aria plumbing deleted), region chip → `ChipLabel`. Zero data/
  API/state changes — guarded by the updated `fableMacroPage` suite (+5 R5 cases) and the rewritten
  `fableMacroChartModalOpacity` shell-level contract. Checkbox reverted to `[~]`: the R5 visuals
  await a manual browser pass at 1728/1024/390, EN/ES, light/dark, reduced-motion.)*
- [~] `/macro/calendar` — FRED calendar + FOMC outlook + Chile deferred; back link; public.
  *Phase 5F (2026-07-28). All 3 cards, all 7 FRED-calendar columns + all 5 FOMC columns in their
  original order, the dates-only-vs-enriched distinction, the honest Chile-deferred disclosure, and
  both `TableSourceFooter` instances are preserved — locked by 56 tests in
  `tests/fableMacroCalendarPage.test.ts`. Restyled onto `TableCard`(×3, closing 2 more pre-existing
  no-`min-w` gaps — the FRED and FOMC tables had none before). The shared
  `EconomicCalendarTable.tsx` (consumed only by this page and the Macro-page embed) was restyled in
  the same pass: near-opaque header, `scope="col"`/`sr-only` caption, its own empty state now routed
  through the shared `AsyncState` component. No forecast/consensus/synthetic-event was invented;
  no Chile row fabricated.*
  *(R5 2026-07-31: deepened to the R3/R4 family — `SectionHeader` → shared `PageHeader` (back link
  + honest scope sentence in the metadata row), local `pill()` → shared `ChipLabel`, and in the
  shared `EconomicCalendarTable` the Fable releases-card anatomy: `text-accent-2`/650 date anchors
  and the color-only importance dot upgraded to a visible localized chip (`impHigh/impMedium/
  impLow` ×EN/ES, `color-mix` pill, app-assigned-heuristic tooltip) — an a11y fix; the color
  mapping itself is unchanged (High keeps `--negative`, a documented departure from Fable's amber
  HIGH). Chronological sort, Actual/Previous honesty, Chile-deferred disclosure and both footers
  untouched — guarded by the updated `fableMacroCalendarPage` suite (+5 R5 cases). Checkbox
  reverted to `[~]` pending the R5 manual browser pass.)*
  *(R5.1 2026-07-31: the importance word chip became a compact **relevance bar meter** — the
  Bloomberg idea (bar count = relevance) rendered entirely in Fable material: High 3 / Medium 2 /
  Low 1 filled of 3, 3px bars at 5/8/11px, `rounded-xs`, fixed `h-3` box (row heights stable),
  filled bars on the unchanged tone mapping and an unfilled `color-mix` track; Imp. column `w-20`
  → `w-16`. Count is the signal, colour only reinforces — `role="img"` + localized `aria-label`
  ("Relevance: High" / "Relevancia: Alta") + `title` carrying the app-assigned-heuristic note +
  `sr-only` text, bars `aria-hidden`. One new key pair `cal.relevanceLabel`. No data, ordering,
  or column change — guarded by the new R5.1 describe (6 cases). Manual pass still pending.)*
  *(R5.2 2026-07-31 — data-integrity repair: every Actual/Previous read `unavailable` because
  FRED's **keyless CSV graph endpoint stopped serving programmatic requests** (verified live:
  status 000 / 0 bytes / 40s from curl AND Node under three User-Agents, while Frankfurter, Yahoo
  and example.com returned 200 from the same machine). Release DATES kept working because they use
  a different host (keyed `api.stlouisfed.org`). `fetchFredSeries` now prefers FRED's official
  keyed JSON observations API on that same working host when `FRED_API_KEY` is set, keeping the CSV
  endpoint as the zero-env-var path and the fallback — same official source, no new vendor, no
  scraping, no consensus. Verified end-to-end on real data: **16/16 metrics published, 0
  unavailable** across BLS/BEA/Census/Fed, monthly + quarterly, with the FOMC band preserved as a
  RANGE (`3.50%–3.75%`, no invented midpoint) and forward releases correctly `pending`. Added an
  optional diagnostic `unavailableReason` so an outage is distinguishable from an unmapped release.
  ADP and Existing Home Sales stay honestly dates-only. Guarded by
  `tests/calendarEnrichmentRepair.test.ts` (42 cases, fully mocked). Manual browser pass still
  pending.)*
- [x] `/earnings` — upcoming + recent results tables; Update/CSV; loading/empty; public.
  *Phase 5G (2026-07-29). Both tables, all 3 Upcoming columns and all 11 Recent Results columns in
  their original order, every ticker link, per-row currency, YoY field, the bank-no-EBITDA tooltip,
  both `MarketDataSourceBadge`/`TableSourceFooter` instances, the amounts note, the record count,
  and the Export CSV action are preserved byte-for-byte in logic — only presentation changed
  (`TableCard`/`AsyncState`/`Reveal`). Restyled onto `TableCard`(×2, closing one more pre-existing
  no-`min-w` gap — Recent Results had none before). The loading/empty rows now route through the
  shared `AsyncState`, adopting the exact convention already used for this same data source on
  `/companies/[ticker]`. No consensus/surprise/beat-miss field, no fabricated quarter, no
  reintroduced Clean/Mixed/Weak label, no use of the dead `earnings.json` file (confirmed via a
  repo-wide scan) — locked by 57 tests in `tests/fableEarningsPage.test.ts`.*
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
- [x] `/portfolio` 🔒 — 7 summary cards + sector exposure + Positions/Transactions/Cash tabs +
  forms; Update; all validation states; protected.
  *Phase 5H (2026-07-29), **recomposed** after a same-day Fable-parity audit. All 7 summary
  metrics, the sector-exposure panel, all 3 tabs, all 3 tables (12/10/4 columns in order), all 3
  add-forms, every fetch endpoint/payload shape/validation message/status-code branch, the
  transaction-derived read-only lock, the 6 write calls, and the single `MarketDataSourceBadge`/
  `TableSourceFooter` are preserved byte-for-byte in logic — the **layout** is what changed. The
  first pass applied the Nevada components to the old full-width vertical stack; the audit
  established that this was not parity, so the page was rebuilt to the approved export's own
  composition: Fable header architecture (inline identity/meta on the title baseline) → asymmetric
  hero row (single primary metric at `ui-kpi-hero` scale + `ChangeIndicator` delta pill + 5
  secondary minis in an auto-fit grid, beside the sector **exposure meter panel**) → Fable
  analytical workspace (wide `TableCard` column at `flex 2.6` with the `SegmentedControl` in the
  card's own toolbar, beside a `flex 1` right rail holding the add-form **side panel** and the
  **CONCENTRATION** meter panel). Removed: the flat 7-across capsule grid, the hand-rolled
  underline tab band, and the full-width sector band. Omitted with documented reasons (each
  asserted absent by test): hero sparkline, currency mix, search/asset-class filters, sortable
  headers, row-click detail panel, and every performance/attribution/benchmark/risk visual — none
  has authoritative NMI data. CONCENTRATION is a sort+slice of the weights `valuePositions`
  already computes, with no new aggregate. A pre-existing dark-mode contrast bug (`bg-primary
  text-surface`, the same defect Phase 5B fixed on Watchlist) was corrected on all 3 submit
  buttons. No confirmation dialog, persistence key, new calculation, or fabricated figure was
  invented — locked by 123 tests in `tests/fablePortfolioPage.test.ts`, roughly half of which
  assert real structural containment and ordering rather than component-name presence.*
- [~] `/structured-notes` 🔒 — dashboard KPIs + bar/donut + monitoring line + upload/extract/import
  + filters + Live/Archived + sortable table; protected.
  *(R3 2026-07-30: recomposed to the approved Fable §6 dashboard — `PageHeader`, KPI-glass capsule
  row (all 7 pre-R3 KPIs, still click-to-filter, plus the Fable NEXT OBSERVATION capsule),
  exposure bar/donut on card glass, lifecycle-legend chips (full sentences kept via title +
  sr-only), and a `TableCard` (minWidth 1180) with the shared `BarrierGauge` column on the 0–130
  scale, ChipSelect filters, Live/Archived `SegmentedControl`, and row → canonical
  `/structured-notes/[id]` navigation. Every endpoint, filter, sort, mutation, monitoring
  exception count, and the `TableSourceFooter` + `pricesAsOf` preserved; a failed initial load now
  renders the honest `error` state instead of the empty-book copy. Departures documented in doc 04
  (no per-row valuation timestamp, no "% of portfolio" subline — no such data exists). Automated
  validation complete (`tests/fableStructuredNotesPage.test.ts`); private enforcement re-verified
  live (307 → `/login?next=%2Fstructured-notes`, APIs 401, no pre-auth content). Ticks to `[x]`
  after the manual browser pass at 1728/1024/390 in both themes and languages.)*
  *(R3 repair 2026-07-31, from the manual visual review: the two exposure blocks recomposed
  Fable-native — shared TOTAL header, ranked uniform-accent bars for issuer exposure, gapped donut
  with center total + hover-linked legend for entity allocation, exact values/percentages always
  printed — and the table reordered triage-first (Status · Next obs · Note · Issuer · gauge ·
  distance · worst · coupon · knock-in · issued · notional · Called last) with the NOTE column
  width-capped and the full name/identifiers revealed on hover via `title`. Presentation only;
  guarded by the R3.R1/R3.R2 tests. Manual browser pass still pending.)*
  *(R3 table-density repair 2026-07-31: `table-layout: fixed` + explicit `COLS` colgroup
  (lang/view-aware; sums 1253 EN / 1285 ES vs ~1302 available at 1728px) so the full table shows
  with no internal scrollbar on a maximized desktop; tighter `px-2` cells, two-line
  Dist./Coupon headers, `colLevel` → 'Level'/'Nivel', gauge 140px with a compact `Current N`
  reading, centered dense columns (Status/Note left, gauge centered), truncate+`title` safety
  nets on Issuer/Worst/Notional. Card-contained scrolling below the sum is unchanged. Guarded by
  R3.R3. Manual browser pass still pending.)*
- [~] `/structured-notes/[id]` 🔒 — metrics strip + terms + current levels + underlyings + schedule
  + allocation grid + provenance/delete; protected.
  *(R4 2026-07-31: recomposed to the approved Fable note-detail anatomy (SPECS §6 "Row → panel"
  12-field terms grid + lifecycle timeline, §Overlays panel header), adapted to the canonical
  full page in the R3 family — `PageHeader` (mono ISIN eyebrow, wrapping product name,
  lifecycle pill), the R3 `StatCapsule` strip (risk/worst/distance/next-obs/coupon/notional/
  maturity), per-underlying `BarrierGauge` monitoring table with proximity-toned distances +
  visible Worst chip + Yahoo footer + estimate disclaimer, grouped terms grid (Identity ·
  Coupon & barriers · Key dates, boolean features as true-only chips), full underlyings table,
  timeline strip (Issued ✓ · Observed n/m · Next ● · Maturity ○) over the COMPLETE observation
  table (next row highlighted, done rows muted, API-data classification only), allocation grid
  preserved verbatim in behavior, provenance + labeled destructive delete with honest
  deleting/failure states. API failure ≠ not-found; missing prices stay "Unavailable"; 26 new
  i18n keys replace previously hardcoded English labels. R1.5 re-verified live (307 →
  `/login?next=%2Fstructured-notes%2Fsome-id`, APIs 401, zero pre-auth note content). Guarded
  by `tests/fableStructuredNoteDetailPage.test.ts` (46 tests). Ticks to `[x]` after the manual
  browser pass at 1728/1024/390 in both themes and languages + the authenticated functional
  walk.)*
  *(R4.1 2026-07-31: the delete confirmation moved from `window.confirm` to the shared Fable
  `DestructiveConfirm` dialog (ModalShell contract — alertdialog, focus trap/restore, Escape
  cancels unless pending, scroll lock, at-most-once confirm, safe cancel first, critical-fill
  destructive action). Same DELETE endpoint and success-only redirect; failure keeps the dialog
  open with the error inside. That was the ONLY app-controlled native dialog in src — a
  recursive scan test now bans them repo-wide. Manual dialog pass still pending.)*
- [ ] `/settings/notifications` 🔒 — add-recipient form + recipients table + active toggle; back
  link; protected.
- [~] `/login` — cinematic shell + glass auth panel; username/password + create toggle + forgot
  link; real `/api/auth/login|register`; error mapping; `next` redirect; public (full-bleed).
  *(R1 2026-07-29: implemented + automated validation complete (`tests/fableAuthShell.test.ts`);
  ticks to `[x]` after the manual browser pass at 1728/1024/390 in both themes and languages.)*
- [~] `/forgot-password` — request form + sent confirmation (no enumeration); public (full-bleed).
  *(R2 2026-07-30: migrated to the `(auth)` group and rebuilt on AuthPanel + the shared AuthForm
  primitives; endpoint, payload and the unconditional generic sent state unchanged; automated
  validation complete (`tests/fableAuthRecovery.test.ts`); ticks to `[x]` after the manual pass.)*
- [~] `/auth/reset-password` — new+confirm password + done; recovery-session; validation; public.
  *(R2 2026-07-30: same migration; mismatch guard, `no_session` invalid-link message, success
  state and the 1.5s return to `/login` all preserved; the page still never redirects before the
  user can set a password. Ticks to `[x]` after the end-to-end recovery round-trip.)*

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
  adopter overall). **Phase 5F adopted it once more** — `/macro`'s chart-popup 1Y/3Y/5Y/10Y
  timeframe row (7th adopter), mapped to/from the page's existing numeric `Timeframe` type only at
  the render boundary.)*
- [~] Motion (reveal, count-up, nav slide, drawer/pop) present and **`prefers-reduced-motion`-gated**.
  *(Phase 1: all 6 Fable keyframes, the duration/easing token set, the foundational utilities, and
  the reduced-motion block — which disables reveal / Ken-Burns / pulse / spin outright and collapses
  everything else to `.01ms` — are in place and confirmed in the live stylesheet. Phase 2: nav-pill
  slide (`.nv-indicator`, real usage) and the mobile drawer slide-in (`.nv-slide-in`) are now live and
  reduced-motion-gated (asserted by `tests/topNavigation.test.ts`). Page-specific choreography and
  JS-driven count-up land with their pages, each of which must read the preference before animating.)*
- [~] Login: **static** Santiago bg, **static** specular, utility chips (secure dot, EN|ES, clock,
  contrast), glass auth panel.
  *(R1 2026-07-29: implemented — contrast chip realized as the existing `ThemeToggle` per doc 04
  Phase 6; theme-independent `--nv-auth-*` tokens. **Documented deviation from Fable §0 after the
  first manual pass:** Ken-Burns drift, the pointer-tracked specular, and the secure-dot pulse are
  all removed for performance — continuously moving the backdrop invalidated the cached blur of
  five backdrop-filter surfaces every frame, and the specular re-rendered the form on every
  pointer event. The gateway is visually still once entered; the entrance itself animates opacity
  and transform only, at the same `--dur-reveal` (640ms) / `--ease-primary` / 22px-rise timing as
  every app page. Full rationale in doc 04 § "R1 performance repair". `[x]` after manual browser
  acceptance.)*

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
  byte-for-byte, asserted by test. Phase 5G: Earnings' Export CSV (`handleExport` → `exportCSV`,
  `earnings_recent_results` filename, same 11 header labels/row shape) is likewise preserved
  byte-for-byte, asserted by test.*
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
  `/chart-builder`, the same precedent Phase 5B/5D set. **Phase 5F boundary: 2655 → 2806 tests,
  2803 pass** — 2 new test files (`tests/fableMacroPage.test.ts` 95 tests,
  `tests/fableMacroCalendarPage.test.ts` 56 tests);
  `fableComparePage`/`fableStocksPage`/`fableWatchlistPage`/`fableChartBuilderPage`/
  `fableCompanyDetailPage`'s phase-boundary guards updated deliberately to remove `/macro` and/or
  `/macro/calendar`, the same precedent Phase 5B/5D/5E set. **Phase 5G boundary: 2820 → 2877 tests,
  2874 pass** (a manual chart-modal opacity repair landed between 5F and 5G, +14 tests, folded into
  the 2806→2820 count above) — 1 new test file (`tests/fableEarningsPage.test.ts`, 57 tests);
  `fableMacroCalendarPage`/`fableStocksPage`/`fableWatchlistPage`'s phase-boundary guards updated
  deliberately to remove `/earnings` (the only 3 of its 8 list occurrences that checked `TableCard`
  specifically — the other 5, checking `SegmentedControl`/`KpiCapsule`/a direct `GlassSurface`
  import, remain true unmodified since `/earnings` adopts none of those three), the same precedent
  every prior Phase 5 sub-phase set. **Phase 5H boundary: 2877 → 3000 tests, 2997 pass** — 1 new
  test file (`tests/fablePortfolioPage.test.ts`, 123 tests after the Fable-parity repair, roughly
  half of them asserting real structural containment/ordering rather than component-name
  presence); `fableComparePage`/`fableChartBuilderPage`/`fableMacroCalendarPage`/
  `fableWatchlistPage`/`fableMacroPage`/`fableCompanyDetailPage`/`fableStocksPage`'s
  phase-boundary guards updated deliberately to remove `/portfolio` (all 7 of the lists that would
  actually have broken), the same precedent every prior Phase 5 sub-phase set. One further test
  was updated **deliberately**: `responsiveLayout`'s Portfolio case asserted the pre-Fable
  `xl:grid-cols-7` capsule grid, which the Fable recomposition removes — it now asserts the new
  intrinsically-responsive conventions (all four Fable columns carry a `min(100%, …)` collapse
  basis, both regions are wrapping flex rows, the minis grid is `auto-fit`, the cash grid still
  reflows 2→3→5) **plus** a `doesNotMatch(/xl:grid-cols-7/)` guard so the old grid cannot return.
  Net coverage increased; nothing was relaxed. The same 3 pre-existing, date-dependent `tests/newsModule.test.ts`
  failures persist unchanged across every one of these boundaries (fixtures stamped `15 Jul 2026` vs
  a rolling 7-day window; today is 2026-07-29). No news-related file is in any Phase 5 sub-phase's
  changed-file list.)*
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
  `/compare`. Phase 5E: `/chart-builder`. Phase 5F: `/macro` + `/macro/calendar`. Phase 5G:
  `/earnings`. Phase 5H: `/portfolio` — each marked ✓ Complete / ✓ Verified with a full
  "as built" record in its section. The other 6 routes remain Not started / Not verified.)*
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
