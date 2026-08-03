# 04 — File-Level Implementation Plan

> **Audit phase — no application code changed.** This is the proposed, phased, file-by-file
> plan to apply the Fable visual language while preserving 100% of NMI content, per the 12-point
> merge contract. It is a plan, not an instruction to execute now.

**Guiding principles (from the merge contract)**
- **Re-skin, don't rewrite.** Touch presentation (`globals.css`, layout, UI components, page
  markup/classes). Do **not** touch `src/app/api/**`, `src/lib/providers/**`, `src/lib/db/**`,
  `src/lib/financials/**`, `src/lib/structuredNotes/**` business logic, `src/middleware.ts`
  protection lists, or the auth API routes.
- **Foundation first.** Land the token/material/motion foundation before restyling pages, so
  every page inherits the language from shared components and tokens.
- **One source of visual truth.** New tokens live in `globals.css` `@theme`; new shared
  components live in `src/components/ui/` and `src/components/fable/` (proposed). Pages consume
  them — no page hardcodes a Fable hex or blur value.
- **Every step keeps the app green:** `npm run build` (0 errors), `npm run lint` (0), `npm test`
  (all pass), zero page-level horizontal overflow, EN+ES, light+dark, auth intact.

---

## Phase 0 — Design governance reconciliation (docs only, no app code)

The single hard blocker to starting: `docs/design_principles.md` currently **forbids** the
core Fable devices (glassmorphism/backdrop-blur, gradients, `rounded-2xl`+, drop shadows,
motion) and `CLAUDE.md` cites it as the design authority ("Do not change the design direction
without asking"). The user's merge contract now makes **Fable authoritative**, so these docs
must be rewritten *before* code, or every re-skin PR will read as a violation.

| File | Change |
|---|---|
| `docs/design_principles.md` | Rewrite to the Fable "Liquid Glass" language: adopt tokens (doc 02 §2), permit backdrop-blur/gradients/22–24px radii/layered shadows/motion under the Fable spec; keep the still-valid rules (semantic tokens only, no hardcoded hex, bilingual, dark-mode parity, tabular-nums, source-labeling). Replace the Section-10 anti-patterns table with Fable-aligned ones (e.g. "no purple except the chart/Review token", "`#8B0E04` reserved for critical only", "respect `prefers-reduced-motion`"). |
| `CLAUDE.md` | Update the "Design Rules", "Theme Toggle Rule", "Typography Rules", "Number and Font Rules", and "Layout Rules" sections to reference the new Fable language; note that the segmented-pill theme toggle, `.ui-label` spec, and flat-design rules are superseded. Add a pointer to `docs/fable-integration/`. |
| `docs/fable-integration/06-acceptance-checklist.md` | The running acceptance gate (already created). |

**Deliverable:** approved, rewritten design authority. No app code in this phase.

---

## Phase 1 — Token & material foundation (`globals.css` + tailwind theme) ✓ COMPLETE (2026-07-22)

> **Status: implemented and validated.** The shared visual foundation is in place. No page, route,
> API, provider, shell, navigation, or login file was touched. See "Phase 1 — as built" below for
> the delivered file list, the D2 ruling, and the three documented palette deviations.

**Files**
- `src/app/globals.css` — the heart of this phase:
  - Extend `:root` (light) and `.dark` with Fable's variable set (doc 02 §2.2/§2.3), mapping
    Fable `--nv-*` values onto NMI's existing semantic names where they already align
    (`--primary` ↔ `#004A64`/`#00355F`, `--background` ↔ digital tones, `--negative` ↔
    `#8B0E04`, etc.) and adding the genuinely new tokens: `--surface-glass` (card gradient),
    `--glass-blur` (24px, the tunable knob), `--glass-border`, `--glass-shadow`,
    `--action-card` (deep-teal gradient), `--chart-1/2/3`, `--review` (violet), `--nv-hover`,
    `--focus`. Keep **both** a light and a dark value for every one.
  - Update `.ui-label` / `.ui-table-header` to the Fable sectionLabel spec (10.5px/700/0.14em)
    and extend `tabular-nums lining-nums` to `body`.
  - Add glass utility classes in `@layer components`: `.glass-card`, `.glass-header`,
    `.glass-overlay`, `.glass-chip`, `.pill`, `.pill-active`, `.capsule` — each pairing
    `backdrop-filter: blur(var(--glass-blur)) saturate(…)` with the fill/border/shadow tokens.
  - Add Fable keyframes (`nvPop`, `nvSlide`, `nvIn`, `nvPulse`, `nvKen`, `nvSpin`) + motion
    tokens, all gated behind `@media (prefers-reduced-motion: reduce) { … .01ms }`.
  - Preserve the existing print block, scrollbar theming, focus-visible ring (retune to
    `--focus`), and the responsive comment (no root min-width).
- `src/app/layout.tsx` — extend the pre-paint script if light is chosen as non-default
  (it must also toggle `body.nv-light` / or NMI keeps `.dark` on `<html>` — pick one mechanism,
  see doc 05 decision "theme class strategy"). No structural change otherwise.

**Guardrails:** `tests/dataSourceAudit.test.ts` asserts badges use semantic tokens — keep
that true. Verify light+dark parity for every new token (WCAG AA).

---

### Phase 1 — as built (2026-07-22)

**Files changed (6 — 2 primary, 4 supporting):**

| File | Change |
|---|---|
| `src/app/globals.css` | Rewritten as the foundation. Fable `--nv-*` material tokens (light in `:root`, dark in `.dark`) + NMI semantic aliases mapped onto them; 7 Liquid Glass material tiers; typography/radius/shadow/spacing/motion token scales; 6 Fable keyframes; reduced-motion block; focus ring on `--focus`; print flattens glass. |
| `src/app/layout.tsx` | D2 + dark-first: `<html>` ships `class="h-full dark"`; the pre-paint script now only *removes* `.dark` for a stored `'light'`. Metadata/viewport/`AppShell` untouched. |
| `public/nevada-logo.svg` | **New.** Byte-identical copy of the Fable `brand-assets/download1.svg` (SHA256 `ada2c482…cb5f`). Never redrawn or recolored. |
| `src/components/ui/NevadaMark.tsx` | **New.** Reusable brand component (`lockup` / `symbol` variants, the latter reproducing Fable's exact 30px header crop). Graceful `onError`. **Not yet consumed** — existing `BrandLogo` branding is untouched. |
| `tests/fableFoundation.test.ts` | **New.** 55 tests locking the theme mechanism, token parity, glass rules, typography, radii, shadows, motion, reduced motion, a11y, responsive guarantees, logo, and source-badge compatibility. |
| `docs/fable-integration/{04,06}` | This status record + the acceptance checklist. |

**D2 — RESOLVED (binding).** One theme system: `.dark` on `<html>`; light under `:root`, dark under
`.dark`. **No `body.nv-light`, no second provider, no second localStorage key.** Dark is the
first-visit default, so the *server render already carries `.dark`* and the head script only removes
it when `localStorage.theme === 'light'` — a stored choice always beats the default, and neither
direction can flash. The `theme` key, its `'dark' | 'light'` values, and `ThemeToggle`'s behavior
are unchanged (the component needed no edit).

Consequence to note: because dark is now an unconditional default, `prefers-color-scheme` is no
longer consulted on a first visit. That is the explicit reading of D1 / principles §15 ("dark mode
is the first-visit default") and of this phase's own acceptance criterion.

**Three documented palette deviations** (WCAG AA §5.4 is non-negotiable and outranks palette
fidelity; each carries a `DEVIATION (documented)` note in `globals.css`):

| Token | Fable value | Shipped | Why |
|---|---|---|---|
| `--positive` (light) | `#3EA464` | `#1A6630` | Fable's green is 3.1:1 on white — fails AA for normal text. Dark mode uses Fable's `#3EA464` (5.9:1). |
| `--negative` (dark) | `#D4796B` | `#D05050` | Three live surfaces paint white text on solid `var(--negative)` (Home + Company high-impact news bar, `NotificationBell` count badge); Fable's value drops them 4.25:1 → 3.11:1. |
| `--muted-fg` / `--meta-fg` (light) | `#8B8E92` | `#6E7276` | Fable's tertiary is 3.3:1 on white and this token carries 10.5px labels. Dark keeps Fable's `#75818A` (4.7:1). |

`--critical-fill` / `--critical-fill-fg` (`#8B0E04` on white, 9:1+ in both themes) was added as the
one signal token safe *under* white text. **Follow-up for Phase 3/5:** move the three solid-fill
sites above from `--negative` to `--critical-fill`, after which dark `--negative` can adopt Fable's
`#D4796B`.

**Deliberately deferred out of Phase 1** (per the brief): top pill navigation, shell/`AppShell`,
login redesign, per-page restyling, Santiago login photograph, consuming `NevadaMark` in the header
or login, and JS-driven motion (count-up, IntersectionObserver reveal staggering) — the CSS
reduced-motion path is in place for all of them.

**Validation:** lint 0 · build 0 errors (all routes present) · suite 1795 tests, 1792 pass. The 3
failures are **pre-existing and date-dependent** (`tests/newsModule.test.ts` fixtures are stamped
`15 Jul 2026` and today, 2026-07-22, is outside the orchestrator's rolling 7-day window) — verified
identical on a clean `git stash` of this branch, so Phase 1 did not cause them. Browser-verified on
`/stocks` and `/`: dark default with no stored preference, light and dark preferences both persist
across reload, tokens resolve per theme, `.ui-table-header` computes to 10.5px/700/1.47px in the
body font, body numerals are `lining-nums tabular-nums`, the reduced-motion rule and the `@supports`
blur guard are present in the live stylesheet, source badges and `TableSourceFooter` render intact,
and page-level horizontal overflow is 0.

---

## Phase 2 — App shell: nav, top bar, providers (`src/components/layout/`) ✓ COMPLETE (2026-07-24)

> **Status: implemented and validated.** The sidebar is gone; the shell now runs on the Fable
> top pill navigation model (D3). See "Phase 2 — as built" below for the delivered file list
> and the file-by-file summary presented to the user.

---

### Phase 2 — as built (2026-07-24)

**Files changed (15 — 7 modified, 2 deleted, 6 new, plus 2 tests):**

| File | Change |
|---|---|
| `src/lib/navigation.ts` | Rewritten. `navItems: NavItem[]` (flat, 9 entries) → `navGroups: NavGroup[]` (8 groups per the brief's grouping, 3 with `children`: Markets → Stocks/Watchlist, Analysis → Compare/Charting, Macro → Indicators/Calendar). New `resolveActiveGroup`/`resolveActiveChild` (longest-prefix match, so `/companies/[ticker]` activates Markets → Stocks via `matchPrefixes` without its own nav entry). `getPageTitle` rewritten on top of these. `MACRO_REGIONS` — the Chile/US region list — moved here so both `SecondaryNav` and `MobileNavDrawer` share one definition. **Settings (`/settings/notifications`) is newly discoverable in nav** — it existed only as a direct-URL route before. |
| `src/components/layout/PrimaryNav.tsx` | **New.** The desktop top pill rail (`hidden lg:flex`) — 8 text pills, a measured sliding active-indicator (`useNavIndicator`), horizontally scrollable with a hidden scrollbar (`.nv-scrollbar-hidden`, new in `globals.css`) rather than wrapping, per Fable's own "scrollable, scrollbar hidden" spec. |
| `src/components/layout/SecondaryNav.tsx` | **New.** Contextual secondary pill row, rendered only when the active group has `children` (Markets/Analysis/Macro). Hosts the Macro Chile/US region control — same persisted key (`cmi.macroRegion`) and `macro:region` window event as the old Sidebar accordion, so `macro/page.tsx` needed no change. `hidden lg:flex`. |
| `src/components/layout/MobileNavDrawer.tsx` | **New.** Replaces the old Sidebar's mobile overlay. Every group's children are listed flat (no accordion — no destination sits behind more than one interaction). Adds everything the old overlay lacked: `role="dialog" aria-modal`, Escape-to-close (`useEscape`), a real Tab focus trap, focus restored to the hamburger trigger on close, body-scroll lock while open. Closes on backdrop click and on navigation (unchanged behavior). Includes the same Macro region control as SecondaryNav. |
| `src/components/layout/NavIcon.tsx` | **New.** Minimal stroke SVG icons (home/chart/trending/document/star/compare/gf/portfolio/notes/settings) — mobile-drawer only; the desktop rail is text-only per the Fable reference. No icon library added. |
| `src/components/layout/useNavIndicator.ts` | **New.** Shared hook measuring the active pill's rendered position (`getBoundingClientRect`) and returning a `{left, width}` pair for the sliding indicator, remeasured on resize and on a caller-supplied token (pathname+lang, so a language switch that changes a label's width re-measures too). Used by both `PrimaryNav` and `SecondaryNav`. |
| `src/components/providers/MobileNavProvider.tsx` | **New, replaces `SidebarProvider`.** The shell no longer has a collapsible desktop column, so the only state left is whether the mobile drawer is open — plain `useState(false)`, deliberately **not** persisted (a drawer must never restore open on load). Captures `returnFocusRef` (the element focused when the drawer opens) for focus restoration. |
| `src/components/layout/Sidebar.tsx` | **Deleted.** Every responsibility (brand block, nav items, Macro accordion, active-state styling, mobile overlay, sign-in/out footer) migrated to `PrimaryNav`/`SecondaryNav`/`MobileNavDrawer`/`TopBar`. |
| `src/components/providers/SidebarProvider.tsx` | **Deleted.** Collapse state had no successor (the top rail has no collapsed mode); mobile-open state moved to `MobileNavProvider`. |
| `src/components/layout/AppShell.tsx` | Provider nesting changed from `Lang → MarketData → MacroData → Sidebar` to `Lang → MarketData → MacroData → MobileNav`. Shell layout changed from a `flex` row (`Sidebar` + column) to a `flex-col` column (`TopBar` → `SecondaryNav` → `main` → `MobileNavDrawer`, with `CommandPalette` still mounted app-wide). `<main>` gained `w-full max-w-(--content-max-w) mx-auto` — the Fable 1560px centered content width — while keeping `overflow-y-auto`, the responsive padding, and the print unlocks verbatim. |
| `src/components/layout/TopBar.tsx` | The sidebar-toggle button became the mobile-drawer hamburger (`useMobileNav().toggleNav`, `lg:hidden`, `aria-expanded`/`aria-haspopup="dialog"`). `BrandLogo` (raster) replaced by `NevadaMark variant="symbol"` (the authoritative Fable SVG, now consumed for the first time) + "Inversiones Nevada" text, linking home. `PrimaryNav` mounted in the header center. **User identity + sign-in/out affordance added** — previously nowhere in the shell; now `useAuthDisplay` drives a display-name + sign-out link (or a sign-in link), `hidden lg:flex` (mirrored in the mobile drawer footer for narrower widths). Search pill, `NotificationBell`, `LangToggle`, `ThemeToggle`, and the date all preserved. |
| `src/app/globals.css` | One small addition: `.nv-scrollbar-hidden` (hides the scrollbar on the horizontally-scrollable pill rail at every width, per the Fable spec) — declared unlayered so it can override the existing unlayered universal themed-scrollbar rule. **Dead-CSS cleanup**: the `--sidebar`/`--sidebar-fg`/`--sidebar-muted`/`--sidebar-active`/`--sidebar-accent`/`--sidebar-border` tokens (light + dark + their `@theme` Tailwind registration) and the `[style*="--sidebar"] :focus-visible, aside :focus-visible` focus-ring rule are removed — confirmed via a full-codebase grep that no component referenced them any longer once `Sidebar.tsx` was deleted. |
| `src/lib/i18n.ts` | `nav.*` rewritten: `home`/`soon` removed; `overview`/`markets`/`analysis`/`macroIndicators`/`macroCalendar`/`settings` added (EN+ES); `stocks`/`watchlist`/`compare`/`charting`/`macro`/`earnings`/`portfolio`/`structuredNotes` kept (now used as child-pill labels, not top-level ones). `common.hideSidebar`/`showSidebar` replaced with `common.openMenu`/`closeMenu`/`primaryNav`/`mobileNav`/`macroRegion` (EN+ES). |
| `tests/topNavigation.test.ts` | **New.** Real-logic tests for `resolveActiveGroup`/`resolveActiveChild`/`getPageTitle` (every route in the brief's grouping table, plus `/companies/[ticker]` and `/structured-notes/[id]` resolving to the correct parent group with no standalone nav entry) + source-scan checks for the Macro-region-preserved contract, `aria-current`, focus trap/Escape/restore/body-lock, reduced-motion gating on the indicator and drawer slide, the `NevadaMark`-not-`BrandLogo` shell requirement, and a no-hardcoded-hex/no-raw-Tailwind-scale sweep of the 4 new/changed shell files. |
| `tests/responsiveLayout.test.ts` | The `sidebar: desktop column + mobile drawer` describe block rewritten to `primary navigation: desktop pill rail + accessible mobile drawer` — asserts the pill rail's `hidden lg:flex` + internal scroll, the secondary row's `hidden lg:flex`, the drawer's dialog semantics, that `Sidebar.tsx`/`SidebarProvider.tsx` are actually gone (not just unused), that `MobileNavProvider` open-state is plain (never persisted), that `AppShell` mounts exactly one nav system, and the new 1560px content max-width. |
| `tests/fableFoundation.test.ts` | One line updated: the `THEME_VARYING` token list's `--sidebar*` entries removed (deliberately, alongside the CSS deletion — not weakened, the token genuinely no longer exists). |

**D3 — implemented as decided (binding, doc 05).** Fable's top pill rail is now the primary
desktop navigation model. Constraints honored: **every existing route stays reachable**
(the 8-group table matches the brief exactly, `/companies/[ticker]` and
`/structured-notes/[id]` resolve to their parent group's active state via `matchPrefixes`
with no standalone nav entry — canonical full pages, never replaced by a panel); the Macro
Chile/US sub-region control and its `macro:region` event/`cmi.macroRegion` key are preserved
verbatim in both `SecondaryNav` (desktop) and `MobileNavDrawer` (mobile); `aria-current="page"`
marks every active state (paired with a font-weight change, never color alone); the mobile
drawer is a fully accessible dialog (focus trap, Escape, restored focus, body-scroll lock —
capabilities the old Sidebar overlay never had); zero page-level horizontal overflow (verified
by the updated `responsiveLayout.test.ts` conventions, matching the existing card/table-scroll
patterns unchanged).

**Deliberately deferred out of Phase 2** (per the brief): per-page content restyling (Phase 5),
the cinematic login shell (Phase 6), the notification drawer / command-palette glass restyle
(Phase 3), and an avatar menu (the brief did not require one — sign-in/out is a plain link,
matching the pre-existing TopBar pattern for auth state).

**Validation:** lint 0 · build 0 errors (19/19 static pages, full route table unchanged) ·
suite grew to 1846 tests, 1843 pass. The 3 failures are the same pre-existing, date-dependent
`tests/newsModule.test.ts` failures documented in Phase 1 (unrelated to this phase). No
`src/app/api/**`, `src/middleware.ts`, `src/lib/providers|db|financials|structuredNotes|market|
earnings|compare|ingestion|observability|portfolio/**`, `src/config/**`, `src/data/**`, or
`package.json`/`package-lock.json` file touched (verified by a scope grep over the full
changed-file list). HTTP-level verification against a local dev server (no interactive browser
session was available this phase — see the validation report for the honest disclosure)
confirmed: every public route 200s, every protected route 307-redirects to
`/login?next=<path>` unauthenticated (including the dynamic `/structured-notes/[id]` route),
`/companies/SQM-B` resolves the title "Stocks · SQM-B", `/macro`'s secondary row renders
Indicators/Calendar pills plus a Chile/US `aria-pressed` toggle, `TableSourceFooter` renders
correctly ("Source: Yahoo Finance" on `/stocks`), the shell ships `class="dark"` on `<html>`
by default (Phase 1's dark-first default undisturbed), and the "Inversiones Nevada" brand text
renders with no leftover "NMI" monogram.

---

## Phase 3 — Shared UI primitives (`src/components/ui/` + `src/components/fable/`) ✓ COMPLETE (2026-07-24)

> **Status: implemented and validated.** The reusable Fable component library now exists. No
> individual page was redesigned this phase — see "Phase 3 — as built" below for the delivered
> file list and validation record.

Restyle every shared component so pages inherit the language for free. **Semantics/props stay
identical** — only classes/markup change.

**Restyle (existing files, no prop/signature changes):**
- `ThemeToggle.tsx`, `LangToggle.tsx` — Fable capsule/contrast-toggle styling; keep persistence.
- `SectionHeader.tsx` — Fable page-title scale + actions row (keep `flex-wrap`).
- `DataSourceBadge.tsx`, `MarketDataSourceBadge.tsx`, `SourceStateBadge.tsx` — Fable chip
  (dot + word), **same states/labels/tooltip** (merge point 10). Keep semantic tokens.
- `TableSourceFooter.tsx` — Fable meta line; **one per table** unchanged (merge point 10).
- `StatusPill.tsx` — map to Fable pill color set (pos/neg/crit/amb/rev/neu). Keep `color-mix`.
- `EmptyState.tsx` — Fable muted glass empty state.
- `UpdateDataButton.tsx` — Fable primary/outline pill + spinner→✓ (keep idle/loading/done).
- `CommandPalette.tsx` — Fable 560px glass overlay (`.glass-overlay`), kind-tagged results,
  keyboard-hint footer. Keep ⌘K/`/`/`cmdk:open`, recent searches, company routing.
- `NotificationBell.tsx` — Fable right **notification drawer** (slide-in `nvSlide`, severity
  dots, mark-all-read). Keep polling, auth-gating, `useEscape`.
- `SearchInput.tsx`, `BrandLogo.tsx` — Fable search pill; BrandLogo asset reconciliation
  (see Phase 6).

**New Fable-language components (`src/components/fable/`):**
- `GlassCard.tsx` — the base card material (variants: card / module / action-teal / hero).
- `KpiCapsule.tsx` + `KpiHero.tsx` — label + big value + delta capsule (+ optional count-up,
  respecting reduced-motion).
- `SegmentedPill.tsx` — pill toggle w/ measured sliding indicator (used by Compare/Charting/
  Macro/Portfolio tabs, currency/period/frequency toggles).
- `Sparkline.tsx` — inline SVG sparkline for macro/markets/company rows.
- `DataTable` conventions — either a light wrapper or documented class recipe (sticky glass
  header, sortable `<th>`, in-card `overflow-x-auto` + `min-w`, row hover). Keep NMI's existing
  per-page tables; apply the recipe.
- `BarrierGauge.tsx` — the structured-notes 0–130 gauge (barrier tick, strike tick, glowing
  current dot).
- `DetailPanel.tsx` — optional right slide-in panel (for company/position/note detail if the
  panel pattern is adopted; otherwise pages stay full-page).
- `SideScrim.tsx` — shared overlay scrim.

**Guardrails:** `tests/tableSourceFooterConvention.test.ts` (one footer/table, plain source
names); badge/source tests. Charts keep their data props unchanged.

---

### Phase 3 — as built (2026-07-24)

**New files (16 — `src/components/fable/`):** `GlassSurface.tsx` (the 7 Liquid Glass tiers as one
prop-driven wrapper over the Phase 1 `.nv-glass-*`/`.nv-surface-dense`/`.nv-scrim` classes),
`useCountUp.ts` (+ `usePrefersReducedMotion`, `useSyncExternalStore`-based, no setState-in-effect),
`Sparkline.tsx`, `SparklineRow.tsx`, `ChangeIndicator.tsx`, `KpiCapsule.tsx`, `KpiHero.tsx`,
`CurrentActions.tsx` (the one solid deep-teal card, new `.nv-action-card` CSS utility built only
from existing `--nv-actioncard`/`--shadow-action`/`--radius-card` tokens — no new token),
`SegmentedControl.tsx` (generic `role="radiogroup"` pill toggle, reusing the Phase 2
`useNavIndicator` sliding-indicator hook — no second visual system), `BarrierGauge.tsx`,
`TableCard.tsx`, `PrivacyValue.tsx` (+ `PrivacyToggle`), `usePrivacyMode.ts` (persisted via the
existing `usePersistentState('cmi.privacyMode', …)` mechanism — no new persistence layer),
`DetailPanel.tsx`, `AsyncState.tsx` (loading/empty/error/unavailable/blocked/partial/stale, each
with distinct copy — never a generic skeleton standing in for a meaningful state), `motion.tsx`
(`Reveal`/`Pop`/`SlideIn`/`ContentPulse` + `OverlayTransition`/`ValueChangeTransition` aliases,
each a thin wrapper over the existing `.nv-reveal`/`.nv-pop`/`.nv-slide-in` classes plus one new
one-shot `.nv-content-pulse` utility — reuses the existing `nvPulse` keyframe and `--dur-pulse`
token at a single iteration, distinct from the ambient `.nv-pulse` loop).

**Modified (restyled in place, semantics/props preserved):**
- `StatusPill.tsx` — purely additive: 8 new variants (critical/review/live/persisted/derived/
  fallback/blocked/unavailable) mapped onto the existing `--state-*` tokens Phase 1 declared
  specifically for this; the `{ label, variant? }` signature is unchanged, so no call site needed
  an edit. Does not replace `DataSourceBadge`/`SourceStateBadge`'s own vocabulary or logic.
- `NotificationBell.tsx` — restyled from an anchored dropdown to a full right-edge Fable drawer
  (`.nv-glass-overlay` + `.nv-slide-in`, `w-[min(390px,94vw)]`): added `role="dialog" aria-modal`,
  a Tab focus trap, body-scroll lock, and focus restored to the bell button on close — capabilities
  the old dropdown never had. The unread-count badge moved from `--negative` to
  `--critical-fill`/`--critical-fill-fg` — the exact "Follow-up for Phase 3/5" migration Phase 1's
  own `globals.css` DEVIATION note called out for this precise surface. Polling, auth-gating,
  mark-read/mark-all-read, links, and timestamps are byte-for-byte unchanged.
- `CommandPalette.tsx` — restyled to `.nv-glass-overlay`/`.nv-scrim`/`.nv-pop`, added
  `role="dialog" aria-modal"` and a body-scroll lock. Every keyboard shortcut (⌘K/Ctrl-K/`/`),
  `cmdk:open` event, arrow-key navigation, and the `cmi.recentSearches` persistence are unchanged.

**i18n:** new `fable` namespace (EN+ES) — `kpi`, `currentActions`, `barrier`, `privacy`, `panel`,
`async` (7 states × title/body). No existing namespace was touched beyond this addition.

**Deliberately deferred out of Phase 3** (per the brief — restyling shared primitives only, not
pages): `ThemeToggle`/`LangToggle`/`SectionHeader`/`EmptyState`/`UpdateDataButton`/`SearchInput`/
`BrandLogo` visual restyle, the 4 chart components (Phase 4), and every individual page (Phase 5).
`GlassSurface` intentionally does not include an `action`/`module` variant beyond the 7 named
tiers — Current Actions uses its own `.nv-action-card` class directly (it is not a glass tier: no
blur, no translucency, a fixed solid gradient), and `TableCard` composes `GlassSurface
variant="dense"` for its inner body rather than needing an 8th variant.

**Validation:** lint 0 problems · build 0 errors (35/35 routes, full route table unchanged) · test
suite 1846 → **1980 tests, 1977 pass** (134 new — `tests/fableComponents.test.ts`). The 3 failures
are the same pre-existing, date-dependent `tests/newsModule.test.ts` fixture failures documented in
Phases 1–2 (fixtures stamped mid-July against the orchestrator's rolling 7-day window; unrelated to
this phase, reproduced identically before this phase's changes). Two pre-existing tests were
updated deliberately, not weakened: `tests/responsiveLayout.test.ts`'s NotificationBell viewport-cap
assertion now checks the new `w-[min(390px,94vw)]` pattern (still always narrower than the
viewport, just a different responsive unit than the old dropdown's `max-w-[calc(100vw-1.5rem)]`);
`tests/notificationsPlatform.test.ts`'s unread-badge assertion now checks `--critical-fill`/
`--critical-fill-fg` instead of `--negative`, matching the pre-planned token migration above. No
`src/app/**`, `src/middleware.ts`, `src/lib/{providers,db,financials,structuredNotes,market,
earnings,compare,ingestion,observability,portfolio}/**`, `src/config/**`, `src/data/**`, or
`package.json`/`package-lock.json` file was touched (no new dependency — verified by
`tests/fableComponents.test.ts`'s dependency-list check).

---

## Phase 4 — Charts (`src/components/charts/`) ✓ COMPLETE (2026-07-24)

> **Status: implemented and validated.** All four SVG charts now speak the same tokenized
> institutional chart language, share one tooltip surface, and carry a real accessible text
> alternative. See "Phase 4 — as built" below for the delivered file list and validation record.

Restyle the four SVG charts to the Fable chart language (gridlines, dashed zero line, chart
palette `--chart-1/2/3` + tertiary, crosshair tooltip, event chips). **Keep every prop and the
ResizeObserver measurement** — data flow is untouched.

**Files:** `LineChart.tsx`, `CompareChart.tsx`, `FundamentalsChart.tsx`, `YieldCurveChart.tsx`,
`src/components/macro/EconomicCalendarTable.tsx` (table restyle). Consider extracting shared
chart primitives (axis, gridlines, tooltip) into `src/components/fable/chart/`.

---

### Phase 4 — as built (2026-07-24)

**New files (2 — `src/components/fable/chart/`):** `ChartTooltip.tsx` (the one shared
institutional tooltip surface — near-opaque `--chart-tooltip-bg`, `--radius-menu`,
`--shadow-card`, no `backdrop-filter` — consumed by all four charts, replacing four
near-identical `rounded border-border bg-surface px-2 py-1 shadow-md` blocks); `chartA11y.ts`
(one pure `formatTemplate()` helper used to build each chart's accessible summary sentence from
its own translated template + real data).

**`src/app/globals.css`:** one new "Chart semantic tokens" block in `:root` — `--chart-primary/
secondary/tertiary/comparison`, `--chart-positive/negative/neutral/review/warning/unavailable`,
`--chart-grid/axis/border/bg`, `--chart-tooltip-bg/fg/border`, `--chart-crosshair/
selected-point/reference-line/threshold-line/confidence-band`, `--legend-text/
legend-inactive-opacity`. Every one aliases an existing signal/material token (`--nv-ch1/2/3`,
`--positive`, `--border`, `--surface-table`, …) — no new raw color was introduced, and each
already resolves correctly per-theme because the tokens it points at are themselves redefined
under `.dark`. `--chart-threshold-line` and `--chart-confidence-band` are declared but not yet
consumed by any chart (no current chart renders a threshold/confidence-band series) — reserved
for the next chart that needs one, matching the existing "reserved token" convention (e.g.
`--news-src-de`).

**`src/lib/formatters.ts`:** added `formatChartValue()` — the one inline `toLocaleString('es-CL',
…)` fallback call that used to live inside `LineChart`'s tooltip formatter, extracted verbatim
(identical output) so chart components no longer perform an ad hoc locale call themselves.

**Modified (4 chart components, props/data logic byte-for-byte unchanged):**
- `LineChart.tsx` — gridlines/axis/border/crosshair/hover-dot-halo tokens renamed to their
  `--chart-*` equivalents; the primary line (and the "hasCompare" primary line, previously
  `--accent`) now draws from the Fable-designated chart palette (`--chart-primary` →
  `--nv-ch1`) rather than the generic UI accent token — a deliberate, documented harmonization
  (still institutional blue in both themes; only the light-mode hue shifts from deep navy to
  the Fable chart blue). Tooltip switched to the shared `ChartTooltip`. Added `role="img"` +
  `aria-describedby` on the chart wrapper, an SVG `<title>`, and an `sr-only` long-form summary
  (point count, date range, latest value, plus a compare-series and marker-count sentence when
  present) built via `chartA11y`'s `formatTemplate` — the hardcoded `"No data available"`
  fallback is now `t.common.noData`.
- `CompareChart.tsx` — same token renames; the 0%-baseline dashed reference line moved from
  `--muted-fg` to the new shared `--chart-reference-line` (aliasing `--border-strong`, matching
  `FundamentalsChart`'s existing baseline color so the two charts no longer disagree on what a
  "reference line" looks like); the click-to-highlight legend's dimmed state now reads
  `--legend-inactive-opacity` instead of a bare Tailwind `opacity-50` class, and its transition
  moved from `transition-opacity` (untokenized duration) to the shared `.nv-transition` utility.
  Same tooltip/accessibility/i18n treatment as above (`"No data"` → `t.common.noData`).
- `FundamentalsChart.tsx` — same token renames; the hover-column highlight rect moved from
  `fill="var(--surface-2)" opacity="0.5"` to `fill="var(--hover)"` — the same row-hover-tint
  token the rest of the app already uses for "highlight without a blur/shadow change"
  (design_principles §8). Same tooltip/accessibility treatment; the rarely-hit
  no-metric-selected fallback (`"Select a company and at least one metric."`) now reads
  `t.charting.selectMetric`.
- `YieldCurveChart.tsx` — same token renames, shared tooltip, accessibility treatment
  (`"No data"` → `t.common.noData`).

All four: `fontSize="11"` attributes became `fontSize="var(--fs-meta)"` (identical 11px, now a
named token); gridlines/axis-label fill/plot-border/crosshair moved to `--chart-grid`/
`--chart-axis`/`--chart-border`/`--chart-crosshair`; the hover-dot halo stroke moved to
`--chart-selected-point` (aliasing `--surface`, unchanged value). No series, benchmark,
comparison line, marker, timeframe, axis, unit, or tooltip/legend field was removed — verified by
the new test file's explicit prop-preservation checks per component.

**`src/components/macro/EconomicCalendarTable.tsx`:** one small change — row hover moved from
`hover:bg-surface-2 transition-colors` to the established `.nv-row-hover .nv-transition`
utilities (the same pattern Phase 3's `SparklineRow` already uses), for token-driven hover timing
instead of Tailwind's untokenized default. Everything else in this file was already fully
semantic-token-compliant and needed no change.

**`src/lib/i18n.ts`:** new `fable.chart` sub-namespace (EN+ES) — a translated name + a
`{placeholder}` summary template per chart kind (`lineChart`/`compareChart`/
`fundamentalsChart`/`yieldCurveChart`), plus `compareSuffix`/`comparisonSeries`/`markersSuffix`
fragments for `LineChart`'s optional compare/marker sentences. The 3 pre-existing hardcoded
English-only fallback strings inside the chart components (a genuine, pre-existing bilingual-rule
gap, fixed while already in these exact lines) now resolve through existing keys
(`t.common.noData`, `t.charting.selectMetric`) rather than a new duplicate key.

**Deliberately not done this phase:** no page (`/macro`, `/compare`, `/chart-builder`,
`/companies/[ticker]`, `/macro/calendar`) was touched — they still import the same components with
the same call signatures, so nothing needed to change there. No keyboard-operable data-point
navigation was added to any chart (a real, pre-existing limitation the new accessible summary
narrows but does not close — the summary text is a genuine data-bearing alternative, not merely a
decorative label, but there is still no keyboard equivalent for the mouse-driven crosshair/
tooltip). `Sparkline.tsx` and `BarrierGauge.tsx` (Phase 3) were already accessible and were not
touched.

**Validation:** lint 0 problems · build 0 errors (same 19 static + dynamic routes, full route
table unchanged) · new `tests/fableCharts.test.ts` (94 tests: token declarations, no hardcoded
hex/raw Tailwind color scale, per-component prop preservation, shared-tooltip adoption, accessible
role/description presence, i18n completeness, no network calls, no new dependency, no new
animation, scope guard confirming no page/middleware/auth file changed) · full suite 1980 → **2074
tests, 2071 pass**. The 3 failures are the same pre-existing, date-dependent
`tests/newsModule.test.ts` failures documented in Phases 1–3 (fixtures stamped mid-July against
the orchestrator's rolling 7-day window; today, 2026-07-24, is outside it) — reproduced
identically before this phase's changes (git-confirmed: no file under `tests/newsModule.test.ts`
or any news-related source path was touched this phase).

---

## Phase 5 — Page-by-page re-skin (recommended order)

> **Phase 5A (`/stocks`) ✓ COMPLETE (2026-07-28)** — proves the table + toolbar + source-footer
> recipe end to end. **Phase 5B (`/watchlist`) ✓ COMPLETE (2026-07-28)** — proves the same recipe
> on a *protected* route, plus the add/remove form pattern and the `AsyncState` state machine.
> **Phase 5C (`/companies/[ticker]`) ✓ COMPLETE (2026-07-28)** — proves KPI capsules, the price
> chart on Fable materials, `SegmentedControl`, glass business/valuation cards, and the print path
> on a dynamic detail route. **Phase 5D (`/compare`) ✓ COMPLETE (2026-07-28)** — proves a
> multi-table analytical page (3 `TableCard`s), a second `SegmentedControl` adopter, and a
> from-scratch settings-modal restyle onto the established overlay pattern. **Phase 5E
> (`/chart-builder`) ✓ COMPLETE (2026-07-28)** — proves the metric-picker + dual-axis-chart pattern
> and closes a genuine pre-existing responsive gap (the underlying-data table had no `min-w`).
> **Phase 5F (`/macro` + `/macro/calendar`) ✓ COMPLETE (2026-07-28)** — proves a two-route phase
> sharing one restyled component (`EconomicCalendarTable`), closes two more pre-existing no-`min-w`
> gaps, and adds real keyboard operability to a mouse-only interaction (chartable indicator rows).
> **Phase 5G (`/earnings`) ✓ COMPLETE (2026-07-29)** — proves the smallest/simplest remaining
> two-table page, closes one more pre-existing no-`min-w` gap, and adopts the
> loading/empty `AsyncState` convention already established on the same data source in
> `/companies/[ticker]`. **Phase 5H (`/portfolio`) ✓ COMPLETE (2026-07-29)** — the largest
> remaining page (7 summary metrics, a sector-exposure panel, 3 tabbed tables + 3 forms), and the
> first sub-phase to be **recomposed** rather than only re-skinned: a follow-up Fable-parity audit
> established that adopting the Nevada components on the old layout was not parity, so the page was
> rebuilt to the approved export's own composition (asymmetric hero row + two-column analytical
> workspace with a right rail). **Lesson for the remaining pages: start from the Fable
> composition, not from the existing layout.** See "Phase 5A — as built" through "Phase 5H — as
> built" below. Pages 9–11 are not started.

Each page: adopt the **Fable composition** for the route (section grouping, grid proportions,
primary/secondary hierarchy, component placement), then swap layout/card/table/pill classes to the
new shared components; **do not change**
data fetching, `fetch*` calls, `useMarketData`/`useMacroData`/`useGlobalRefresh`, persisted
`cmi.*` keys, loading/empty/error branches, source badges/footers, or `t.*` usage. Where NMI
has more content than Fable, keep it (merge point 3). Where Fable sample content has no NMI
data, exclude it (merge point 4).

Recommended order (low-risk → high-risk, dependency-aware):

1. **`/stocks`** ✓ — cleanest DataTable, direct Fable Portfolio-table map; proves the table +
   toolbar + source-footer recipe end to end.
2. **`/watchlist`** ✓ — small protected table + add form; proves the recipe on a protected route
   and the add-form pattern.
3. **`/companies/[ticker]`** ✓ — KPI capsules + chart + valuation grid + results + news; proves
   capsules, charts, glass cards, print path.
4. **`/macro`** + **`/macro/calendar`** ✓ — banded table, yield curve, chart popup overlay,
   release calendar, FOMC outlook, Chile-deferred disclosure.
5. **`/earnings`** ✓ — two glass DataTables + upcoming module.
6. **`/compare`** ✓ — multi-slot returns table, settings modal (glass overlay), compare chart,
   segmented pills.
7. **`/chart-builder`** ✓ — metric picker + dual-axis chart + underlying table + settings.
8. **`/portfolio`** ✓ — hero/capsule summary, exposure bars, three tabbed tables + forms
   (biggest single page; done after capsules/tables were proven).
9. **`/structured-notes`** ✓ (Phase R3) — barrier gauge, upload/extract panel, dashboard KPIs, bar/donut.
10. **`/structured-notes/[id]`** ✓ (Phase R4) — terms grid, current-levels table + gauge,
    lifecycle timeline over the schedule, allocation grid, provenance + destructive delete.
11. **`/settings/notifications`** — recipients table + toggle switch (Admin language).
12. **Home `/`** — LAST among content pages: it's the densest, most-composed page (7 modules,
    News, heat map, DnD rates) and benefits from every component proven above.

---

### Phase 5A — `/stocks` — as built (2026-07-28)

**Files changed (7 — 3 source, 2 tests, 2 docs; `06-acceptance-checklist.md` makes 3 docs):**

| File | Change |
|---|---|
| `src/app/stocks/page.tsx` | Re-skinned. **Every hook, state variable, `useMemo`, merge expression, sort comparator, CSV builder, and fetch call is byte-for-byte unchanged.** Presentation moved to `TableCard` + Fable pill toolbar + tokenised sticky header/row hover + `AsyncState` empty + two `Reveal` wrappers. New: `aria-sort`, `<th scope="col">`, real sort `<button>`s, `role="group"` filter set, `sr-only <caption>`, `aria-live` row count, right-aligned numeric columns. |
| `src/components/ui/SearchInput.tsx` | Restyled to the Fable search pill (999px, `--nv-chip`/`--nv-chipbd`, inline glyph). `width` now caps the field (`min-w-0 flex-1` + `maxWidth`) instead of pinning it — better narrow-width behavior, same `value`/`onChange`/`type="text"` contract. Added optional `ariaLabel` (a placeholder alone is not a label). **In scope because `/stocks` is its only consumer repo-wide** (grep-verified; a test now locks that). |
| `src/lib/i18n.ts` | 3 new keys × 2 languages under `stocks`: `filters` (Filters / Filtros), `sectorFilter` (Sector filter / Filtro de sector), `sortBy` (Sort by / Ordenar por). No existing key touched. |
| `tests/fableStocksPage.test.ts` | **New, 74 tests** — section/column/order/CSV preservation, live→persisted→static merge, formatter usage, "—"-never-zero, filter + sort semantics, links, one-footer/one-as-of/one-badge, async-state distinctness, Fable material + pill + radius + token rules, no-hardcoded-hex/no-raw-Tailwind-scale, motion restraint, a11y (aria-sort/scope/caption/labels/live/focus), responsive, EN+ES completeness, and a scope guard (no API/provider/db import, no new dependency, no other page touched, middleware untouched). |
| `tests/responsiveLayout.test.ts` | **Deliberate update, not a weakening.** The dense-table CASES matcher now counts `overflow-x-auto` **or** `minWidth={` — because `/stocks` delegates its in-card scroll to the shared `TableCard`. Two **new** tests keep the guarantee real: one asserts `TableCard` genuinely owns an `overflow-x-auto` container and applies the caller's `minWidth`, the other asserts `/stocks` still passes `minWidth={760}`. Net: the file gained coverage. |
| `docs/fable-integration/03` / `04` / `06` | Route status → complete/verified; this as-built record; checklist items ticked with Phase 5A notes. |

**Files deliberately NOT changed:** `globals.css` (every token this page needed already existed —
no new token, no new utility), any chart component, any other page, `src/app/api/**`,
`src/middleware.ts`, `src/lib/{providers,db,market,...}/**`, `src/config/**`, `src/data/**`,
`package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **Sector filter stays a `<select>`.** A `SegmentedControl` rail with 10+ sectors would wrap into
  a multi-row block or scroll options out of reach — a direct conflict with the zero-page-overflow
  and reachability rules. It is restyled as a Fable pill instead; semantics unchanged.
- **Numeric columns are now right-aligned.** Fable's own holdings table right-aligns figures and
  this is what makes body-wide tabular numerals actually pay off. It is an alignment change only —
  no column was added, removed, reordered, renamed, or made unsortable, and the CSV export is
  untouched.
- **No KPI/summary strip was invented.** `/stocks` has no financial summary data; the brief's KPI
  section is conditional ("where current summary metrics exist"). The one real summary — the
  filtered row count — is preserved and now announced politely.
- **No loading state was invented.** The page renders static data synchronously; a spinner would
  delay readable data (§12.2). The pre-existing silent `.catch(() => {})` degrade is preserved,
  honestly carried by the `Static` badge.

**Validation:** lint 0 problems · build 0 errors (19/19 static pages, `/stocks` still static, full
route table unchanged) · suite 2074 → **2150 tests, 2147 pass** (+76: 74 new + 2 new responsive
tests). The 3 failures are the same pre-existing, date-dependent `tests/newsModule.test.ts`
fixture failures documented in Phases 1–4 — fixtures stamped `15 Jul 2026` against the
orchestrator's rolling 7-day window, and today is 2026-07-28. No news-related file is in this
phase's changed-file list.

**Rendered-markup verification** against a live dev server (`GET /stocks` → 200): 9 column headers,
6 sortable headers carrying `aria-sort` (1 active `descending`, 5 `none`), 25 company links, 25
`nv-row-hover` rows, `nv-glass-card` + `nv-surface-dense` from `TableCard`, `min-width:760px`
inside an `overflow-x-auto` container, the source badge, "Yahoo Finance" twice (subtitle +
footer), `aria-live="polite"` on the count, `role="group"` on the filter set, and 14 honest `—`
placeholders (proving nulls never render as 0). A sampled row confirms the Chilean locale and
formatters survived intact: `63.851` / `-2,4%` (negative token) / `+4,0%` (positive token) /
`15.0 MM` / `14.2x` / `8.1%`.

**Honest gap:** the interactive browser responsive ladder (1440/1280/1024/768/390, light+dark,
EN+ES) was **not** run — the Chrome extension is not connected in this environment, the same
limitation disclosed in Phases 2–4. What *is* verified is source- and markup-level: no root
`min-width`, no fixed pixel width on any page element (the search field caps at `max-width:220px`
and shrinks), the only `min-width` is the 760px table floor **inside** the scroll container, and
the toolbar wraps. Those are the conventions that cause page-level overflow when broken, but they
are not a substitute for looking at the page.

---

### Phase 5B — `/watchlist` — as built (2026-07-28)

**Files changed (6 — 2 source, 2 tests, 3 docs; `03` counted once):**

| File | Change |
|---|---|
| `src/app/watchlist/page.tsx` | Re-skinned onto `TableCard` + `AsyncState` + `Reveal` + Fable pill controls. **All four API calls, their request shapes, headers, bodies and status-code mapping are unchanged**; so are the client-side `VALID_TICKERS` validation, the datalist, the 2500ms auto-dismiss, the seven columns and their formatters, the company links, and the single `TableSourceFooter`. New: a `LoadOutcome` state that tells "no watchlist" / "load error" / "expired session" apart instead of showing all three as "empty"; a footer item count (suppressed when the count isn't knowable); `res.ok` handling on remove; `role="status" aria-live` regions for add and remove; `scope="col"`, `sr-only <caption>`, an `sr-only` label on the action column, and an `aria-label` naming the ticker on each remove button. |
| `src/lib/i18n.ts` | 6 new keys × 2 languages under `watchlist`: `addError`, `removeError`, `networkError`, `loadError`, `noWatchlist`, `sessionExpired`. No existing key touched; the previously-unused `watchlist.removed` key is now wired to real remove-success feedback. |
| `tests/fableWatchlistPage.test.ts` | **New, 81 tests** — section/column/order preservation, cell values and formatters, "—"-never-zero, add workflow (validation, POST shape, 409/422, success path, no optimistic insert), remove workflow (DELETE shape, `res.ok` gate, item retained on failure, busy state, labelled control, no invented confirm), the five distinct async states, links/source/protection, API-contract immutability, Fable material/pill/token rules, motion restraint, a11y, responsive, EN+ES, and a scope guard. |
| `tests/responsiveLayout.test.ts` | One new test: `/watchlist` keeps its 620px table floor under the `TableCard` delegation (mirrors the 760px Stocks assertion added in 5A). |
| `tests/fableStocksPage.test.ts` | **Deliberate boundary update.** Its "redesigns no other page" guard listed `/watchlist`; Phase 5B legitimately migrated that page under its own brief, so the entry moved out and the test was renamed to "redesigns no page that has not had its own phase". The other five pages still hold the line, and `/watchlist` is now guarded by its own suite — a phase boundary moving, not an assertion relaxed. |
| `docs/fable-integration/03` / `04` / `06` | Route status → complete/verified; this as-built record; checklist items updated. |

**Files deliberately NOT changed:** `globals.css` (no new token or utility needed), `src/app/api/watchlists/**` (all three route files), `src/middleware.ts`, `src/lib/db/repositories/watchlistRepository.ts`, every other page, `package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **No watchlist selector was built.** The page has only ever read `watchlists[0]`. The API supports multiple lists, but no switch/create/rename/delete UI has ever existed — adding one is a feature, not a re-skin. The selected list's *identity* is now shown (`TableCard title={watchlist?.name}`) from data that was already fetched.
- **No sorting or filtering was added.** Neither existed; a test asserts the rows render the API order verbatim with no filter or sort interposed.
- **No source badge was added.** Prices here are the static sample by design (Phase 8A audit: membership is Supabase-persisted, prices are not). A "Live"/"Persisted" badge would contradict the honest `Static sample` footer, and there is no as-of to show.
- **Three pre-existing defects were fixed** (silent failed remove; three untranslated English literals incl. a raw server error code leaking to the UI; `text-surface` on `bg-primary` failing dark-mode contrast). The first is a behaviour change and is called out explicitly for review — the brief required remove-failure to be a distinguishable state, which is impossible without checking the response.

**Validation:** lint 0 · build 0 errors (19/19 static pages, `/watchlist` still in the route table, full table unchanged) · suite 2150 → **2232 tests, 2229 pass** (+82: 81 new + 1 new responsive test). The 3 failures are the same pre-existing, date-dependent `tests/newsModule.test.ts` fixture failures documented in Phases 1–5A (fixtures stamped `15 Jul 2026`; today is 2026-07-28, outside the rolling 7-day window). No news-related file is in this phase's changed-file list.

**Live verification** against a dev server: `/watchlist` unauthenticated → **307 → `/login?next=%2Fwatchlist`** (protection and `next` preservation both intact); `/login?next=…`, `/stocks` and `/` all 200; Phase 5A `/stocks` confirmed un-regressed (9 headers, 6 `aria-sort`, 25 `nv-row-hover` rows, `min-width:760px`, "Yahoo Finance" ×2); and the new bilingual strings — `"Could not remove ticker…"` **and** `"…sigue en tu watchlist"` — were found in the served client bundle, proving both dictionaries reach the browser.

**Honest gaps:** (1) the page's own rendered markup could **not** be fetched, because the route correctly redirects without a session — verification is therefore build-, source- and bundle-level plus the redirect check, not a DOM inspection of the authenticated page. (2) The interactive browser responsive ladder (1440/1280/1024/768/390, light+dark, EN+ES) was **not** run — the Chrome extension is not connected in this environment, the same limitation disclosed in Phases 2–5A. The conventions that prevent page-level overflow are source-verified (no root `min-width`; the only `min-width` is the 620px floor inside `TableCard`'s `overflow-x-auto`; the add form and footer row both `flex-wrap`), but that is not a substitute for looking at the page while signed in.

---

### Phase 5C — `/companies/[ticker]` — as built (2026-07-28)

**Files changed (4 — 1 source, 1 i18n, 3 docs; `06` counted once):**

| File | Change |
|---|---|
| `src/app/companies/[ticker]/page.tsx` | Re-skinned. **Every hook, state variable, effect, fetch call, computed value (`livePrice`, `liveDayPct`, `ytdVal`, `mktCapVal`, `peVal`, `divVal`, `valMetrics`, `markers`, `chartStatus`, `periodChange`, `valH`/`ResizeObserver` measurement) is byte-for-byte unchanged** — only the JSX tree changed. KPI strip: 4 tiles → `KpiCapsule`; Day Chg./YTD → `GlassSurface variant="kpi"` + `ChangeIndicator` (icon+color, not color-alone). Business summary / business model / revenue drivers / risks → `GlassSurface variant="card"`. Price chart card → `GlassSurface variant="card"`; the 8-timeframe button row → `SegmentedControl` (first production adopter); the period-change badge → `ChangeIndicator`; the "no data" box → `AsyncState kind="empty"`. Recent Results + Valuation cards are hand-composed from `GlassSurface variant="card"` (header/footer) + `GlassSurface variant="dense"` (data region) — the same material structure `TableCard` uses internally, chosen over `TableCard` itself because this page's pinned-height + internal-vertical-scroll layout (`--pin-h` CSS var bound to the Valuation card's measured height, `flex-1 min-h-0 overflow-auto` on the Results table region) doesn't fit `TableCard`'s current horizontal-only-scroll model; forcing that model to fit here would have meant changing a shared, tested component for one caller's unusual requirement. Loading/empty states route through `AsyncState`, with the pre-existing exact copy (`t.common.loading`, `t.company.noData`) passed via its `message` override so wording is unchanged. Recent news card → `GlassSurface variant="card"`; row content (headline, source-code chip, high-impact full-bleed bar) untouched. Six `Reveal` wrappers (0/60/110/170/230/290ms stagger) added for section entrance; all collapse to final state under `prefers-reduced-motion` via the existing global CSS gate — no new reduced-motion branch was needed. Print/Watchlist header actions restyled to the Fable pill shape (`rounded-full`, `--nv-chip`/`--nv-chipbd`) with `onClick={() => window.print()}`, `no-print`, and `href="/watchlist"` all unchanged. |
| `src/lib/i18n.ts` | 1 new key × 2 languages under `company`: `chartTimeframeLabel` (Chart timeframe / Periodo del gráfico) — the `SegmentedControl`'s `ariaLabel`. No existing key touched. |
| `docs/fable-integration/03` | Route 8 status → Done/Verified; the per-route entry rewritten with the as-built component mapping. |
| `docs/fable-integration/04` / `06` | This as-built record; recommended-order item 3 ticked; checklist items updated. |

**Files deliberately NOT changed:** `globals.css` (every token this page needed already existed), `src/components/fable/TableCard.tsx` (deliberately not used here — see above), any chart component (`LineChart.tsx` untouched, same props/call signature), any other page, `src/app/api/**`, `src/middleware.ts`, `src/lib/{providers,db,market,earnings,compare,financials}/**`, `src/config/**`, `src/data/**`, `package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **`TableCard` was not extended or reused for Recent Results/Valuation.** It assumes natural/page-level height with horizontal-only scroll; this page needs a fixed (measured) height with internal vertical scroll on the data region while header/footer stay pinned. Hand-composing the same `GlassSurface(card)` + `GlassSurface(dense)` + `AsyncState` primitives locally gets full material consistency without adding a new, narrowly-motivated prop surface to a component two other pages already depend on.
- **`SegmentedControl` first adopted here**, for the 8-timeframe chart selector — exactly the candidate the acceptance checklist named. `cmi.chartTimeframe` persistence (`usePersistentState`) is untouched; the control only changes how the same `chartTimeframe`/`setChartTimeframe` pair is rendered.
- **Day Chg./YTD KPI tiles do not use `KpiCapsule`'s own `value`+`changeValue` combination.** `KpiCapsule` shows a primary value AND, optionally, an adjacent change indicator — for a tile whose *entire* content is a signed percentage, using both slots would either duplicate the number or force a `null` primary value to show "Unavailable" beside the real figure. A plain `GlassSurface variant="kpi"` tile with just `ChangeIndicator` inside avoids both problems while staying on the exact same glass-kpi material as the other four tiles.
- **No 52-week high/low, sparklines, or benchmark/IPSA chart series were added.** `t.company.kpis.low52`/`high52` exist in `i18n.ts` but were never rendered before this phase either — pre-existing dead keys, left untouched (out of scope: adding a metric the current APIs don't drive would violate "do not invent metrics"). `LineChart`'s `compareData`/`compareLabel` props were never passed by this page before and still aren't — no benchmark series exists in this page's data today.

**Validation:** lint 0 problems · build 0 errors (full route table unchanged, `/companies/[ticker]`
still dynamic/`ƒ`) · suite **2232 tests, 2229 pass, 3 fail** — the same pre-existing, date-dependent
`tests/newsModule.test.ts` fixture failures documented in Phases 5A/5B (fixtures stamped `15 Jul
2026` against the orchestrator's rolling 7-day window; today is 2026-07-28). No news-related file
is in this phase's changed-file list, and the failure count/location is unchanged from the pre-phase
baseline.

**Live verification** against the already-running dev server: `GET /companies/SQM-B` and
`GET /companies/BSANTANDER` both 200 with no server-rendered error markers.

**Honest gap:** the interactive browser responsive ladder (1440/1280/1024/768/390, light+dark,
EN+ES) and a manual `window.print()` check were **not** run — the Chrome extension is not
connected in this background session, the same limitation disclosed in Phases 5A/5B. What *is*
verified is source-level: the KPI strip, business-panel row, and results/valuation row keep their
exact pre-existing responsive grid classes (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`,
`grid-cols-1 lg:grid-cols-3`, `grid-cols-1 lg:grid-cols-2`) and the pinned-height class
(`lg:h-(--pin-h)`, no inline `style={{ height: valH`), both asserted by the pre-existing
`tests/responsiveLayout.test.ts` suite for this route, which passes unchanged. `.no-print` and the
print-unlock CSS in `globals.css` were not touched by this phase.

#### Phase 5C — visual/data-integrity repair (2026-07-28, same day)

Five defects found during manual browser validation of the completed Phase 5C page; four were real
and fixed narrowly, one was diagnosed and found to require no code change.

1. **KPI source line overlapped the KPI grid.** Root cause: the KPI-strip `TableSourceFooter` carried
   a leftover `className="-mt-2"` (negative top margin) from the pre-Fable, shorter plain-box KPI
   tiles — the taller `GlassSurface`/`KpiCapsule` tiles now render past that negative offset. Fixed
   by removing the negative margin (`className="mt-2"`, normal document flow, no absolute
   positioning) — `src/app/companies/[ticker]/page.tsx`, one line.
2. **News section vanished on zero articles.** `{news.length > 0 && (...)}` unmounted the whole card,
   heading included. Replaced with an always-rendered `GlassSurface` card whose body branches through
   the shared `AsyncState` component across four honest states — `loading` / `unavailable` (from the
   real `NewsFetchResponse.status` field) / `empty` / `error` (a new `newsFailed` flag, set only when
   the fetch itself returns no payload) — reusing the pre-existing `t.home.newsLoading` /
   `t.home.newsEmpty` / `t.home.newsUnavailable` strings (no new i18n keys needed). The populated
   branch (headline, source-code chip, high-impact bar) is byte-for-byte unchanged.
3. **Settings clipped in the top nav.** `PrimaryNav`'s 8 pills need more width than the `flex-1` rail
   gets next to the wide right-hand icon cluster at common desktop widths, and the scroll container
   had zero trailing padding — the last pill (Settings) sat flush against the rounded clip edge with
   a hidden scrollbar and no affordance that more content existed. Fixed by tightening pill padding
   (`px-3.5`→`px-3`), reserving real trailing space on the rail (`px-1`→`pl-1 pr-2.5`), and tightening
   TopBar's own gaps (`gap-2 sm:gap-4`→`gap-1.5 sm:gap-3`, right cluster `gap-1.5 sm:gap-2.5`→
   `gap-1 sm:gap-2`) plus deferring the `⌘K` kbd hint to `xl:` instead of `md:`. Internal
   `overflow-x-auto nv-scrollbar-hidden` scrolling — already the documented Fable spec — is
   unchanged and remains the fallback for genuinely narrow widths; no item, order, control, or
   active-route behavior was touched. `src/components/layout/PrimaryNav.tsx`,
   `src/components/layout/TopBar.tsx`.
4. **Bank header KPI showed P/E instead of a balance-sheet multiple.** `pb` (Price/Book) already
   exists as a live, derived `ValuationResult.fundamentals` field for all four banks (verified live:
   BSANTANDER 3.0, CHILE 3.4, ITAUCL 1.1, BCI 1.8); no P/TBV field is sourced anywhere in the
   codebase (grepped, zero matches), so the required precedence resolves to P/B, never a fabricated
   substitute. Bank identity comes from the existing, authoritative `src/lib/financials/banks/
   bankRegistry.ts` (`isBankTicker()`) — an explicit 4-ticker whitelist, never inferred from company
   name or sector, so insurers/asset managers/exchanges are unaffected. The fifth KPI slot now
   branches: banks render `KpiCapsule label={t.company.kpis.pb}`, everyone else keeps
   `label={t.company.kpis.pe}` — six-KPI count/order otherwise unchanged. New i18n pair
   `company.kpis.pb` (EN "P/B" / ES "P/VL"), matching the existing `val.pb` label convention.
5. **SONDA's price chart showed "No data available."** Diagnosed, not a code defect — see the
   diagnostic report in the conversation record. `TICKER_YF['SONDA'] = 'SONDA.SN'` is correct; a
   direct, isolated Yahoo Finance probe (bypassing the app) returned 249 real daily bars for
   `SONDA.SN`. Locally `MARKET_DATA_MODE` is unset → defaults to `'static'` (by design, zero env
   vars), and in that mode the history resolver never attempts Yahoo — it reads
   `src/data/stockHistory.json`, which only ever seeded 9 of 25 tickers (SONDA never among them; any
   of the other 16 non-seeded tickers shows the identical empty chart locally). No fix applied —
   seeding data or changing `MARKET_DATA_MODE`/env files would both violate explicit constraints, and
   the live/production (hybrid-mode) path is already correct.

New test coverage: `tests/fableCompanyDetailPage.test.ts` grew from 107 to **151 tests** (+44) —
sections 4b, 9b, 10b, 16, 17 lock in all five diagnoses/fixes, including a bank-registry authenticity
check, a News-always-renders check, a KPI-footer-flow check, a Settings-reachability check (source +
`navGroups` real-logic), and a SONDA-mapping-untouched regression guard. `tests/topNavigation.test.ts`
and `tests/responsiveLayout.test.ts` re-verified unaffected (78/78 pass, no changes needed).

**Live verification** (dev server): `GET /companies/{BSANTANDER,CHILE,ITAUCL,BCI,SQM-B}` all 200, no
server-rendered error markers. **Honest gap, unchanged from the original Phase 5C entry:** the
interactive browser ladder and a visual print check were not run — the Chrome extension remains
unavailable in this session.

#### Phase 5C — historical-price chart follow-up (2026-07-28, same day)

Empty price charts were re-reported for SONDA **and ITAUCL** after the local environment was
configured. A full runtime trace confirmed **no code defect exists anywhere in the history path** —
the earlier "MARKET_DATA_MODE defaults to static" note was correct but incomplete, so the verified
evidence is recorded here in full:

- **Provider symbols are correct.** `TICKER_YF['SONDA'] = 'SONDA.SN'`, `TICKER_YF['ITAUCL'] =
  'ITAUCL.SN'`. There is no `ITAU` key and no alias pointing a second ticker at `ITAUCL.SN` — the
  canonical NMI ticker is `ITAUCL` and it is the only route to that security.
- **The live tier returns full data for every one of these tickers.** Executing the real
  `getYahooStockHistory()` in-process returned, for **all five** of SQM-B / SONDA / ITAUCL /
  BSANTANDER / CHILE, identical bar counts across all eight timeframes: 1D 2 · 5D 6 · 1M 23 ·
  MTD 18 · YTD 142 · 1Y 251 · 3Y 748 · 5Y 1252. SONDA 1Y ran 2025-07-23 (355.99) → 2026-07-27
  (309.99); ITAUCL 1Y ran 2025-07-23 (12,740) → 2026-07-27 (20,678). Symbol mapping, date parsing,
  numeric parsing, and timeframe sufficiency are all verified correct.
- **The frontend consumes the response correctly.** `fetchStockHistory` → `res.data` /
  `res.metadata.status`, accepted when status is `live`/`persisted` and `length >= 2`, mapped as
  `{ date, value: close }`, refetched on `[sym, chartTimeframe, live?.lastUpdated]`. Nothing
  discards valid rows.
- **The real blocker is environmental, in two independent layers.** (1) The running dev server was
  started 10:53:27 local while `.env.local` was last modified 15:19:06 local — the process predated
  the env edit by ~4.5 h. The server was restarted to remove this variable. (2) After the clean
  restart the mode **still** resolves to `static`, because `.env.local` line 4 sets
  `MARKET_DATA_MODE` to an unreplaced bracketed all-uppercase placeholder token rather than one of
  `static` | `supabase` | `hybrid`; `parseMarketDataMode()` correctly treats an unrecognised value as
  `static`. Env files are out of scope for this repair, so this is reported for the operator to set.
- **In `static` mode the empty chart is correct, honest behaviour and is not SONDA/ITAUCL-specific.**
  `src/data/stockHistory.json` seeds exactly **9 of 25** tickers (BCI, BSANTANDER, CHILE, CMPC,
  COPEC, ENELCHILE, FALABELLA, IPSA, SQM-B). The other **17** — LAS-CONDES, ITAUCL, CAP, ENELAM,
  COLBUN, AGUAS-A, CENCOSUD, RIPLEY, PARAUCO, MALLPLAZA, ENTEL, SONDA, ANDINA-B, CCU, CONCHATORO,
  LTM, VAPORES — have no static series, so every one of them shows the same honest empty state
  locally. No series was seeded or fabricated to mask this.

**No production code was changed by this follow-up.** New guard: `tests/stockHistoryChartIntegrity.ts`
(39 tests) locks in the verified symbol mapping, the absence of an `ITAU` alias, null-vs-falsy numeric
parsing (a 0 close survives), date parsing, per-timeframe sufficiency incl. the coverage-ratio guard,
the live → persisted → static precedence order, the honest unavailable/empty states, and the four
earlier Phase 5C repairs. One pre-existing test in `tests/fableCompanyDetailPage.test.ts` was
corrected: it asserted on the developer's gitignored `.env.local`, so it failed the moment an
operator legitimately configured the mode — it now asserts the repository-verifiable intent (env
files stay gitignored; no source file assigns `MARKET_DATA_MODE`).

---

### Phase 5D — `/compare` — as built (2026-07-28)

**Files changed (9 — 1 source, 1 i18n, 3 test scope-boundary corrections, 1 new test, 3 docs;
`06` counted once):**

| File | Change |
|---|---|
| `src/app/compare/page.tsx` | Re-skinned. **Every hook, state variable, computed value (`valids`, `compareData`, `persistedHistory`, `rowData`, `returnsStatus`, `returnsAsOf`, `historyAccumulating`, `chartSeries`, `fund`, `cellStyle`, `handleExportFund`) and fetch/effect is byte-for-byte unchanged** — only the JSX tree changed. All 3 tables (Market Data, Comparative Returns, Fundamentals) → `TableCard` (dense near-opaque surface + card-level scroll via `minWidth={620/440/560}`); the Fundamentals table's 0-valid-slot empty state now routes through `TableCard`'s own `state="empty"`/`AsyncState`, replacing the old bare `<div>` — same message (`t.compare.empty`), same trigger condition. TF (1M/YTD/1Y/3Y/5Y) and Period (D/W/M) button/select rows → `SegmentedControl` (2nd/3rd production adopters after Company's chart-timeframe control); the TF control's `value` is deliberately set to a non-matching sentinel (`(usingCustom ? '' : tf) as CmpTf`) when a custom date range is active, reproducing the original `!usingCustom && tf === x` "no button reads active" behaviour that a plain `value`-bound radiogroup can't otherwise express. Control bar + chart card → `GlassSurface variant="card"`. The Settings modal (⚙, opened from the Returns table header) was restyled onto the exact `nv-scrim` + `nv-glass-overlay nv-pop` overlay recipe `CommandPalette` established in Phase 3 — same structural content (Difference vs, Series colors ×6, Chart options, Table options, Reset/Done), only the container material and control chrome changed. Ticker-slot inputs, color swatches, date-range inputs, and pill buttons restyled to the Fable chip language (`--nv-chip`/`--nv-chipbd`, `rounded-full`). Three staggered `Reveal` wrappers (0/70/130/190ms — header unstaggered, Market Data, Returns+Fundamentals row, control bar+chart). Two small, genuine pre-existing defects fixed while already on these exact lines: a hardcoded English `title="Clear range"` (no Spanish translation existed) → `t.compare.clearRange`; a redundant hex literal (`'#004A64'`, the color-picker's fallback value, which already exactly equalled `PRESET[0]`) → `PRESET[0]`. |
| `src/lib/i18n.ts` | 2 new keys × 2 languages under `compare`: `timeframeLabel` (Timeframe / Periodo — the TF `SegmentedControl`'s `ariaLabel`, since the button row previously had no group label at all) and `clearRange` (Clear range / Limpiar rango — the pre-existing hardcoded-English fix above). No existing key touched. |
| `tests/fableWatchlistPage.test.ts`, `tests/fableStocksPage.test.ts`, `tests/fableCompanyDetailPage.test.ts` | **Deliberate scope-boundary updates, not weakened assertions** — matching the exact precedent Phase 5B set when it migrated `/watchlist` out of Phase 5A's "untouched pages" list. `/compare` is removed from all four "this page has had no re-skin phase yet" arrays across these three files (it now legitimately uses `TableCard`/`GlassSurface`/`SegmentedControl`, which those assertions exist specifically to rule out for *not-yet-migrated* pages) — the six other pages in each list still hold the line, and `/compare` is now guarded by its own suite below. |
| `tests/fableComparePage.test.ts` | **New, 121 tests** — every section/slot/metric/mode/timeframe/setting/reset preserved, all 6 comparison slots + duplicate handling + dedup-first-wins, all 12 Fundamentals rows in original order + all 10 derived-field keys, the exact `TF` array and `cmi.compare*` 11-key persistence, chart series/legend/tooltip/axis delegation to the untouched `CompareChart`, return-math delegation to `lib/returns` (no inlined CAGR formula), Fundamentals rounding (`fmtX`/`fmtPctCell`/`toFixed(1)`) and the derived-field `•` marker, 2 `MarketDataSourceBadge` + 4 `TableSourceFooter` instances with the exact source-precedence ternaries, the `historyAccumulating` note under both footers, async-state distinctness (loading/empty/partial/stale/error — no zero-fallback, no dropped valid ticker), API/provider/dependency scope guards, Fable material/pill/token/radius rules, motion restraint + reduced-motion collapse, full a11y (labelled slots/controls/dialog, keyboard-operable `SegmentedControl`, sign never color-only), responsive containment (12-col grid, 3× `TableCard` `minWidth`, no root min-width), and complete EN/ES coverage including a scan for hardcoded literals in both JSX text *and* `title`/`aria-label` attributes (which caught the `clearRange` defect above). |
| `docs/fable-integration/03` / `04` / `06` | Route 3 status → Done/Verified; this as-built record; checklist items updated. |

**Files deliberately NOT changed:** `globals.css` (every token this page needed already existed),
`src/components/charts/CompareChart.tsx` (same props/call signature — untouched since Phase 4), any
other page, `src/app/api/**`, `src/middleware.ts`, `src/lib/{providers,db,market,compare,financials}/**`,
`src/config/**`, `src/data/**`, `package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **Period (D/W/M) was promoted from a `<select>` to a `SegmentedControl`.** With only 3 options
  and ample control-bar width, it is exactly the case the Fable component catalog names ("used for
  currency, period (1M/3M/YTD/1Y/3Y/SI), frequency (D/W/M)") — unlike Stocks' 10+-option sector
  filter, which stayed a `<select>` for the identical wrap/reachability reason. The visible "Period:"
  text label is kept alongside it (redundant with the control's own `ariaLabel`, but harmless and
  matches the existing "TF | Period: … | Range: … | Legend" scannable-groups layout).
- **`diffRef` and line-thickness stayed `<select>`s inside the Settings modal.** `diffRef`'s options
  are dynamic, variable-length ticker labels with `disabled` states depending on which slots are
  valid — a poor fit for a fixed-width pill rail. Thickness is a minor, infrequently-touched control
  tucked inside a modal, not a primary surface control.
- **No focus trap was added to the Settings modal.** It follows `CommandPalette`'s exact
  scrim+pop+dialog-role precedent (Phase 3), which likewise has no full Tab-trap — `DetailPanel`'s
  fuller trap is reserved for supplementary side panels, a different interaction shape than this
  centered settings dialog. Esc-to-close and backdrop-click-to-close are both preserved unchanged.
- **The Fundamentals empty state gained a visible "Fundamentals" title bar it didn't have before**
  (via `TableCard`'s own header, always rendered). Previously, 0 valid slots showed only a bare
  centered message with no section title at all. This is a strict improvement in orientation (the
  section is now nameable while empty), not a removed feature — the identical `t.compare.empty`
  message, at the identical trigger condition, still renders.

**Validation:** lint 0 problems · full suite **2422 → 2543 tests, 2540 pass, 3 fail** (+121, all in
the new file) · build 0 errors (full route table unchanged, `/compare` still static/`○`). The 3
failures are the same pre-existing, date-dependent `tests/newsModule.test.ts` fixture failures
documented in every phase since Phase 1 (fixtures stamped `15 Jul 2026` against the orchestrator's
rolling 7-day window; today is 2026-07-28) — no news-related file is in this phase's changed-file
list, and the failure count/location is unchanged from the pre-phase baseline.

**Live verification** against the running dev server: `GET /compare` → 200; the served HTML contains
`nv-glass-card`/`nv-surface-dense` (the `TableCard`/`GlassSurface` materials), and both `Comparative
Returns` and `Fundamentals` section titles.

**Honest gap:** the interactive browser responsive ladder (1920/1600/1440/1280/1024/768/390,
light+dark, EN+ES, reduced motion) was **not** run — the Chrome extension is not connected in this
background session, the same limitation disclosed in every prior Phase 5 pass. What *is* verified is
source-level: the 12-col responsive grid classes (`grid-cols-12`, `col-span-12 xl:col-span-5/7`), the
3 `TableCard` `minWidth` floors, the control-bar/settings-modal `flex-wrap`, and the settings modal's
`max-h-[80vh]` viewport cap are all present and asserted by the new test suite, but that is not a
substitute for looking at the page.

---

### Phase 5E — `/chart-builder` — as built (2026-07-28)

**Files changed (5 — 1 source, 1 i18n, 2 test scope-boundary corrections, 1 new test; `03`/`04`/`06`
counted once):**

| File | Change |
|---|---|
| `src/app/chart-builder/page.tsx` | Re-skinned. **Every hook, state variable, computed value (`records`, `periods`/`periodsB`, `series`, `canTTM`/`effFreq`, `financialsBadgeKey`, `sourceStatusA`, `fmtBar`/`fmtAxis`/`fmtLine`/`fmtCell`, `handleExport`) and fetch effect is byte-for-byte unchanged** — only the JSX tree changed. The page-local `Seg` segmented-button component is deleted (no longer used anywhere). Toolbar/metric-picker/chart panel → `GlassSurface variant="card"` (3 instances, replacing the hand-rolled `bg-surface border border-border rounded` recipe). Absolute/Indexed and TTM/Annual → `SegmentedControl` (3rd/4th production adopter after Company's chart-timeframe and Compare's TF/Period); the TTM-disabled explanatory tooltip (`t.charting.ttmUnavailable`) is preserved via a wrapping `<span title=…>` around the control rather than a new per-option prop on the shared component. Ticker inputs, the Settings gear button, the Export CSV button, and the Settings modal's chart-type `<select>` all restyled to the established Fable chip recipe (`--nv-chip`/`--nv-chipbd`, `rounded-full`), matching Compare's exact ticker-slot/control-bar styling. The underlying-data table → `TableCard` (`minWidth={640}`) — this closes a genuine pre-existing responsive gap: the table previously had **no** `min-w` at all, so a ticker with many TTM/annual periods could force page-level horizontal scroll rather than scrolling inside its own card, the one thing `design_principles.md` §19 calls "never acceptable." The chart panel's "no data"/"select a metric" empty states now route through `AsyncState kind="empty"` with a `message` override carrying the exact original copy. The Settings modal restyled onto the exact `nv-scrim` + `nv-glass-overlay nv-pop` recipe `CommandPalette`/Compare established — same content (chart type, legend, gridlines), only the container material and control chrome changed. Three `Reveal` wrappers (0/70/130/190ms — header unstaggered, toolbar+chips, picker+chart row, underlying table) match the Compare/Company stagger cadence exactly. |
| `src/lib/i18n.ts` | 5 new keys × 2 languages under `charting`: `vs` (the ticker-separator, previously hardcoded English — a genuine pre-existing i18n gap fixed while already on this line), `compareTicker` (the "vs" ticker input's `aria-label`, since it previously had none), `removeMetric` (the metric-chip remove button's `aria-label`, previously a hardcoded English `"Remove"`), `modeLabel`/`freqLabel` (the two new `SegmentedControl`s' `ariaLabel`s, since the original button rows had no group label at all). No existing key touched. |
| `tests/fableComparePage.test.ts`, `tests/fableCompanyDetailPage.test.ts` | **Deliberate scope-boundary updates, not weakened assertions** — the exact precedent Phase 5B/5D set. `/chart-builder` is removed from both "this page has had no re-skin phase yet" arrays (it now legitimately uses `SegmentedControl`, which those assertions exist specifically to rule out for *not-yet-migrated* pages) — the remaining pages in each list still hold the line, and `/chart-builder` is now guarded by its own suite below. |
| `tests/fableChartBuilderPage.test.ts` | **New, 112 tests** — every section/config-slot/metric/chart-type/frequency preserved, the 21-metric × 4-category inventory verified exhaustively, fixed left/right axis assignment and the MM/CLP/%/"MM sh" formatter set shared by axis/tooltip/table, Absolute/Indexed normalization delegated to the untouched `FundamentalsChart`, add/remove-metric and overlay-ticker behaviour, the absence of any reset/save/print action (none existed — none invented), the 8 `cmi.gf*` persisted keys with original defaults, the `gf:ticker` deep-link, chart series/legend/tooltip delegation with no marker prop (never existed), 1 `SourceStateBadge` + 2 `TableSourceFooter` instances with the unchanged source-precedence ternary, no fabricated `asOf`, all 7 async/data-quality state checks (no loading spinner, 2 distinct empty states, TTM-disabled-not-hidden, silent provider-failure fallback, no null-to-zero, no series dropped when a sibling has no data), Fable material/pill/token/radius rules, motion restraint + reduced-motion collapse, full a11y (labelled ticker inputs and segmented controls, `aria-pressed` on metric buttons, localized remove-button names, dialog semantics), responsive containment (12-col grid, `TableCard` `minWidth={640}` closing the pre-existing gap, no root min-width), and complete EN/ES coverage including every per-metric label and a scan for hardcoded literals in both JSX text *and* `title`/`aria-label` attributes (which caught the `vs`/`removeMetric` defects above). |
| `docs/fable-integration/03` / `04` / `06` | Route 4 status → Done/Verified; this as-built record; recommended-order item 7 ticked; checklist items updated. |

**Files deliberately NOT changed:** `globals.css` (every token this page needed already existed),
`src/components/charts/FundamentalsChart.tsx` (same props/call signature — untouched since Phase 4),
any other page, `src/app/api/**`, `src/middleware.ts`, `src/lib/{providers,db,financials}/**`,
`src/config/**`, `src/data/**`, `package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **The underlying-data table's conditional hide-when-empty behaviour is preserved exactly**, not
  converted to an always-visible `TableCard` empty state the way Compare's Fundamentals table was.
  That was Compare's own explicit judgement call for *that* table (it gains a visible section title
  while empty); Chart Builder's table never showed a bare container when nothing was selected, and
  changing that now would be a new UI decision, not a re-skin.
- **`SegmentedControl`'s `disabled` option carries no per-option tooltip prop.** Rather than extend
  the shared component (used by 3 other pages) for one caller's explanatory-text need, the TTM
  toggle is wrapped in a plain `<span title={…}>` — the same hover behaviour the original `Seg`
  button's own `title` attribute gave, achieved without touching a shared component for a feature
  addition rather than a verified defect.
- **No reset/clear-all, save, or print action was added.** None of the three existed on this route
  before, and the brief is explicit that inventing one would violate content preservation.
- **`minWidth={640}` is a deliberate, reasoned choice, not an arbitrary one.** The table has one
  sticky metric-label column plus N period columns of variable count (TTM/Annual periods, unlike
  Compare's fixed 6 slots) — 640px is in the same order of magnitude as this app's other dense-table
  floors (Stocks 760, Watchlist 620, Compare 440–620) and comfortably fits the label column plus a
  handful of period columns before the card-level scroll takes over.

**Validation:** lint 0 problems · full suite **2543 → 2655 tests, 2652 pass, 3 fail** (+112, all in
the new file) · build 0 errors (full route table unchanged, `/chart-builder` still static/`○`). The
3 failures are the same pre-existing, date-dependent `tests/newsModule.test.ts` fixture failures
documented in every phase since Phase 1 (fixtures stamped `15 Jul 2026` against the orchestrator's
rolling 7-day window; today is 2026-07-28) — no news-related file is in this phase's changed-file
list, and the failure count/location is unchanged from the pre-phase baseline.

**Honest gap:** the interactive browser responsive ladder (1920/1600/1440/1280/1024/768/390,
light+dark, EN+ES, reduced motion) was **not** run — the Chrome extension is not connected in this
background session, the same limitation disclosed in every prior Phase 5 pass. What *is* verified is
source-level: the 12-col responsive grid classes (`grid-cols-12`, `col-span-12 lg:col-span-3/9`), the
`TableCard` `minWidth={640}` floor, the toolbar's `flex-wrap`, and the metric picker's internal
`max-h-[520px] overflow-y-auto` scroll are all present and asserted by the new test suite, and no
live dev-server rendered-markup check was performed this phase (unlike 5A–5D, which each fetched
their route against a running server) — this is a source-and-build-level verification only.

---

### Phase 5F — `/macro` + `/macro/calendar` — as built (2026-07-28)

**Files changed (8 — 3 source, 1 i18n, 3 test scope-boundary corrections, 2 new tests; `03`/`04`/`06`
counted once):**

| File | Change |
|---|---|
| `src/app/macro/page.tsx` | Re-skinned. **Every hook, state variable, effect, and computed value (`groups`, `clRatesRows`, `curveTenors`/`curveToday`/`curveWeekAgo`/`curveYearEnd`/`curveSource`/`curveAsOf`/`curveStatus`/`curveYearEndYear`, `chartProvider`, `latestAsOf`, `historyData`) is byte-for-byte unchanged** — only the JSX tree changed. Calendar embed / indicators table / FX depth table → `TableCard` (`minWidth={720}`/`{660}`/`{420}` — the calendar and FX tables had **no `min-w` at all** before this phase, a genuine pre-existing responsive gap now closed, matching the exact pattern from Chart Builder's Phase 5E fix). Yield-curve chart card → `GlassSurface variant="card"` (chart panels use plain glass per the Compare/Chart Builder precedent, not the dense table wrapper). The chart popup's 1Y/3Y/5Y/10Y row → `SegmentedControl` (5th production adopter), mapped to/from the existing numeric `Timeframe` type only at the render boundary (`value={String(timeframe)}` / `onChange={v => setTimeframe(Number(v) as Timeframe)}`) — the state's type, default, and every fetch call using it are untouched. The chart popup itself restyled onto the established `nv-scrim` + `nv-glass-overlay nv-pop` recipe, gaining a data-driven `aria-label={selected.label}`. Chartable indicator rows gained real keyboard operability (`role="button"`, `tabIndex={0}`, Enter/Space via `onKeyDown`, a distinct per-row `aria-label`) — the click handler (`openRow`) itself is unchanged, only its reachability improved; this was a genuine pre-existing gap (a mouse-only interaction), not a new feature. Six `Reveal` wrappers (0/70/130/190ms — header unstaggered, calendar embed, indicators table, yield-curve+FX row) match the established stagger cadence. |
| `src/app/macro/calendar/page.tsx` | Re-skinned. **Every fetch call and computed value (`events`, `latestAsOf`, `pct`) is byte-for-byte unchanged.** All 3 cards (FRED release calendar, FOMC outlook, Chile deferred) → `TableCard`. The FRED and FOMC tables had **no `min-w`** either — closed via `minWidth={720}`/`{480}`. The Chile-deferred card uses `TableCard`'s own `state="unavailable"` slot directly (no table body exists — there is genuinely no data or source here), replacing a bespoke muted `<div>` with the same shared async-state language used everywhere else. Three `Reveal` wrappers (0/70/130/190ms — back-link+header, FRED calendar, FOMC, Chile-deferred). |
| `src/components/macro/EconomicCalendarTable.tsx` | Restyled — **exclusively consumed by these two in-scope routes**, so this is a same-phase content restyle, not a cross-page shared-component change. Near-opaque `var(--surface-table)` header background (was `bg-surface-2`); `scope="col"` + `sr-only <caption>` added; its own outer `overflow-x-auto` wrapper removed (now supplied by the caller's `TableCard`, avoiding a nested double-scroll-container); its "no releases" empty branch now routes through the shared `AsyncState kind="empty"` component with the exact same `emptyMessage` prop, instead of a bare `<div>`. Row hover (`nv-row-hover nv-transition`) and every column/formatter/status branch (`pending`/`unavailable`/`actualText`/`previousText`/originating-agency chip/importance dot) are unchanged. |
| `src/lib/i18n.ts` | 5 new keys × 2 languages under `macro`: `chartable` (the "Chartable" dot's `title`, previously hardcoded English), `viewChart` (the new per-row aria-label suffix), `regionCL`/`regionUS` (the header region chip, previously a hardcoded `'Chile'`/`'US'` literal regardless of language), `timeframeLabel` (the popup `SegmentedControl`'s `ariaLabel`, since the original button row had no group label at all). No existing key touched. |
| `tests/fableComparePage.test.ts`, `tests/fableStocksPage.test.ts`, `tests/fableWatchlistPage.test.ts`, `tests/fableChartBuilderPage.test.ts`, `tests/fableCompanyDetailPage.test.ts` | **Deliberate scope-boundary updates, not weakened assertions** — the exact precedent Phase 5B/5D/5E set. `/macro` and/or `/macro/calendar` removed from each file's "not yet migrated" guard array (they now legitimately use `TableCard`/`GlassSurface`/`SegmentedControl`, which those assertions exist specifically to rule out for *not-yet-migrated* pages) — the remaining pages in each list still hold the line, and `/macro`/`/macro/calendar` are now guarded by their own suites below. |
| `tests/fableMacroPage.test.ts`, `tests/fableMacroCalendarPage.test.ts` | **New — 95 + 56 = 151 tests.** Every section/category/series/region-context/chart-series/timeframe/tenor/FX-pair/calendar-column/calendar-filter/user-action/source-badge/footer/timestamp/async-state preserved; the exact CL/US responsive grid class and the FX-block character-proximity shape required by the pre-existing `tests/frankfurterFx.test.ts` regex guard (see below) are asserted; no synthetic calendar event, no fabricated actual/previous/forecast value, no null-to-zero coercion, no Fable sample data; Fable material/pill/token/radius rules; motion restraint + reduced-motion collapse; full a11y (scoped headers, captions, labelled controls, the new keyboard-operable rows, localized titles); responsive containment (`TableCard` `minWidth` floors closing all 4 pre-existing gaps across both routes); complete EN/ES coverage including a scan for hardcoded literals in both JSX text *and* `title`/`aria-label` attributes (which caught the `regionCL`/`regionUS`/`chartable`/close-button defects above). |
| `docs/fable-integration/03` / `04` / `06` | Routes 5 & 6 status → Done/Verified; this as-built record; recommended-order item 4 ticked; checklist items updated. |

**Files deliberately NOT changed:** `globals.css` (every token this phase needed already existed),
`src/components/charts/{LineChart,YieldCurveChart}.tsx` (same props/call signatures — untouched
since Phase 4), `src/config/macroSeries.ts` / `bcchSeriesManualMap.ts` / `usFredSeriesManualMap.ts`
/ `yahooMacroSeries.ts` (no series, category, tenor, or transformation logic touched), any other
page, `src/app/api/**`, `src/middleware.ts`, `src/lib/{providers,db,market}/**`, `src/data/**`,
`package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **The Change-column color coding was deliberately left untouched**, not upgraded to the newer
  `ChangeIndicator` glyph+color component. The FX table's day/YTD ternary text is asserted
  byte-for-byte by a pre-existing business-logic regression test
  (`tests/frankfurterFx.test.ts` — a `.slice(indexOf('usForex?.ok'), +2500)` window that must
  contain the literal `oneDayChangePct != null … formatPct … : '—'` pattern). Restructuring those
  cells around `ChangeIndicator` would have broken that unrelated pre-existing guard; keeping the
  exact original ternary text was the correct, minimal-risk choice. A related real fix was still
  required: the FX card's `controls`/`state` props originally would have introduced an *earlier*,
  spurious match of the literal string `usForex?.ok` (in the status badge), pushing the real match
  outside the test's 2500-char window — fixed by using the logically-identical but textually-distinct
  `usForex && usForex.ok` in `controls`/`state`/`footer`, leaving exactly one `usForex?.ok`
  occurrence in the whole file, positioned immediately before the table it guards.
- **`MacroSeriesDef`/category-list logic was not touched.** The category bands (`catLabel`,
  `indByCat`, `groups`) were already a hardcoded array literal before this phase, not derived from
  `MacroSeriesDef` at runtime — the brief's "don't hardcode categories when the current
  implementation reads them from `MacroSeriesDef`" instruction is conditional on that not already
  being true, so it didn't apply here, and changing this pre-existing data-flow shape would have
  been out of scope for a presentation-only re-skin.
- **No date-range or category-filter control was invented.** Neither existed before this phase;
  the category bands are (and remain) always-shown groupings, not a togglable filter.

**Validation:** lint 0 problems · full suite **2655 → 2806 tests, 2803 pass, 3 fail** (+151, all in
the two new files) · build 0 errors (full route table unchanged, `/macro` and `/macro/calendar`
both still static/`○`). The 3 failures are the same pre-existing, date-dependent
`tests/newsModule.test.ts` fixture failures documented in every phase since Phase 1 (fixtures
stamped `15 Jul 2026` against the orchestrator's rolling 7-day window; today is 2026-07-28) — no
news-related file is in this phase's changed-file list, and the failure count/location is
unchanged from the pre-phase baseline.

**Honest gap:** the interactive browser responsive ladder (1920/1600/1440/1280/1024/768/390,
light+dark, EN+ES, reduced motion) was **not** run — the Chrome extension is not connected in this
background session, the same limitation disclosed in every prior Phase 5 pass. What *is* verified
is source-and-build-level: the exact `region === 'CL' ? 'grid-cols-1' : 'grid-cols-1
xl:grid-cols-2'` responsive class, the 4 `TableCard` `minWidth` floors across both routes, and the
`max-h-[90vh] overflow-y-auto` popup cap are all present and asserted by the new test suites, and
no live dev-server rendered-markup check was performed this phase (unlike 5A–5D) — this is a
source-and-build-level verification only.

**Manual repair addendum (2026-07-29) — chart popup opacity defect.** A visual bug was reported
after the phase above shipped: the `/macro` historical-chart popup used the Tier-5 `nv-glass-overlay`
recipe (a translucent `var(--nv-card)` gradient, ~.72–.9 alpha, + `backdrop-filter: blur(30px)`) —
correct for sparse label/toggle overlays (nav drawer, command palette, both settings modals) but a
violation of the project's own dense-content rule (design_principles §8: text under 13px — axis
labels, tooltips, legend, source footer — must never sit on low-opacity glass; hard minimum .92) for
this specific dense analytical surface. The underlying indicators table was visibly readable through
the popup body. Fix: the popup's `className` swapped `nv-glass-overlay` → `nv-surface-dense` (the
existing Tier-6 near-opaque `--surface-table` token, `.97` alpha, no blur — already the exact token
this chart's own tooltip uses via `--chart-tooltip-bg`), with the Tier-5 rounded modal *shape*
(radius/border/shadow) preserved via an inline `style` referencing the same
`var(--radius-module)`/`var(--nv-bd)`/`var(--nv-sh-palette)` tokens `nv-glass-overlay` itself used —
no new global CSS, no new token, no hardcoded color. Every other `nv-glass-overlay` consumer
(CommandPalette, NotificationBell, DetailPanel, MobileNavDrawer, Chart Builder's and Compare's
settings modals) was checked and confirmed unaffected/appropriate — the defect was local to this one
popup, not a shared-component regression. One pre-existing test assertion in
`tests/fableMacroPage.test.ts` that literally asserted the old `nv-glass-overlay nv-pop` string was
corrected to assert the repaired `nv-surface-dense nv-pop` class and the absence of
`nv-glass-overlay`; a new focused file, `tests/fableMacroChartModalOpacity.test.ts` (14 tests), locks
down the repair itself (near-opaque surface, no translucent token, both themes ≥.92 alpha, no blur on
the dense tier, scrim/shape/chart/controls/footer/close/async-state/responsiveness/reduced-motion all
preserved, no API/data/other-Phase-5F-section change, unrelated modal consumers unchanged). Full
suite: 2806 → **2820 tests, 2817 pass, 3 fail** (+14, all in the new file) — same 3 pre-existing
date-dependent `tests/newsModule.test.ts` failures, unchanged. Lint 0 · build 0 errors.

---

### Phase 5G — `/earnings` — as built (2026-07-29)

**Files changed (5 — 1 source, 3 test scope-boundary corrections, 1 new test; `03`/`04`/`06`
counted once):**

| File | Change |
|---|---|
| `src/app/earnings/page.tsx` | Re-skinned. **Every hook, state variable, effect, and computed value (`cal`, `results`, `loading`, `upcoming`, `rows`, `live`, `handleExport`, `pctCell`, `fmtMM`, `fmtEps`) is byte-for-byte unchanged** — only the JSX tree changed. Both tables (raw `bg-surface border` divs, ad hoc `overflow-x-auto`) → `TableCard`. The Upcoming table's `min-w-[360px]` is preserved via `minWidth={360}`; the Recent Results table had **no `min-w` at all** — a genuine pre-existing responsive gap, now closed, the same shape of fix every prior Phase 5 sub-phase made. `MarketDataSourceBadge` (×2, unchanged component/props) and the Export CSV button moved into `TableCard`'s `controls` slot; `TableSourceFooter` (×2) + the amounts note + the record-count span moved into its `footer` slot. The bare `<td>{loading ? ... : ...}</td>` empty/loading cells were replaced with the shared `AsyncState` component, `kind={loading ? 'loading' : 'empty'}` — **adopting the exact convention already established** on this same data source in `src/app/companies/[ticker]/page.tsx` (`kind={earningsResults === null ? 'loading' : 'empty'}`), not inventing a new one. Semantic table markup added: `scope="col"`, `sr-only <caption>` on each table, near-opaque `var(--surface-table)` header background, tokenised `var(--fs-table-cell)` body type, `nv-row-hover nv-transition` (was `hover:bg-surface-2 transition-colors`). Three `Reveal` wrappers (0/70/130ms — header, Upcoming, Recent Results). |
| `tests/fableMacroCalendarPage.test.ts`, `tests/fableStocksPage.test.ts`, `tests/fableWatchlistPage.test.ts` | **Deliberate scope-boundary updates, not weakened assertions** — the exact precedent every prior Phase 5 sub-phase set. `/earnings` removed from each file's `TableCard`-absence "not yet migrated" guard array (the only three lists that would actually have broken — checked all 8 occurrences of `'src/app/earnings/page.tsx'` across the fable test suite; the other 5, checking `SegmentedControl`/`KpiCapsule`/a direct `GlassSurface` import, remain true unmodified since this page adopts none of those three). |
| `tests/fableEarningsPage.test.ts` | **New — 57 tests.** Every section/table/column-order/ticker-link/period/date/currency/YoY-field/metric preserved; no consensus/surprise/beat-miss field, no fabricated quarter, no `earnings.json` import (confirmed both on this page and via a repo-wide `src/` scan — the file is a dead, zero-import orphan), no Clean/Mixed/Weak label, no metric coerced to zero; confirms no filter/sort/persistence was invented (none existed); confirms the loading/empty `AsyncState` mapping matches the company-detail page's own convention exactly; confirms partial/stale/unavailable/provider-error remain exactly as unified as they already were (not a new distinction); Fable material/pill/token/radius rules; motion restraint + reduced-motion collapse; full a11y; responsive containment; complete EN/ES (zero new keys needed — every string reused); scope guards (Macro/Macro Calendar/company-detail/middleware/API-contract untouched). |
| `docs/fable-integration/03` / `04` / `06` | Route 7 status → Done/Verified (and the pre-existing missing `## 7.` section header in doc 03 fixed); this as-built record; recommended-order item 5 ticked; checklist items updated. |

**Files deliberately NOT changed:** `globals.css` (every token this page needed already existed),
`src/lib/data/{earningsCalendar,earningsResults}.ts` (client-safe fetch helpers, untouched),
`src/lib/earnings/{resolveEarningsResults,earningsResultsCore}.ts` (calculations/rolling-window/
YoY/bank-EBITDA-suppression logic, untouched), `src/lib/providers/earnings/earningsCalendarProvider.ts`
(CMF orchestration, untouched), `src/app/api/earnings/{calendar,results}/route.ts` (untouched), any
other page, `src/middleware.ts`, `package.json`/`package-lock.json`.

**Judgement calls, stated plainly:**
- **Partial/stale/unavailable/provider-error states were not newly distinguished.** The brief listed
  these as required coverage, but the current NMI implementation genuinely does not visually
  distinguish them — a `results.status === 'unavailable'` response and a `results === null` client
  fetch failure render identically (`rows.length === 0` → the same "empty" message) today. Per the
  authority model ("existing NMI is authoritative for … all asynchronous and data-quality states"),
  inventing a new distinction here would have been a functional change disguised as a re-skin, so the
  existing conflated behavior was preserved exactly and is asserted as such by the new test suite,
  rather than papered over with a cosmetically "complete"-looking set of AsyncState kinds the data
  layer doesn't actually produce.
- **A pre-existing, unrelated loose end was found and deliberately left alone**: `/api/earnings/route.ts`
  (a different, orphaned Phase 8C route — `/api/earnings`, no trailing segment, reading persisted
  `earnings_events` from manual-CSV ingestion) carries a stale comment claiming the page "falls back to
  earnings.json" for uncovered tickers. Verified this route is **not called anywhere** by the
  `/earnings` page (which only ever calls `/api/earnings/calendar` and `/api/earnings/results`) and that
  `src/data/earnings.json` itself has **zero import statements** anywhere in `src/` — a dead file, not a
  live production source. Out of scope to fix (a backend API file, and no verified defect was raised
  against it) — documented here rather than silently left for a future session to rediscover.
- **No new i18n keys were needed.** Every visible string on the re-skinned page already existed in
  `t.earnings`/`t.common`/`t.home`/`t.stocks` before this phase.

**Validation:** lint 0 problems · full suite **2820 → 2877 tests, 2874 pass, 3 fail** (+57, all in the
new file) · build 0 errors (`/earnings` still static/`○`). The 3 failures are the same pre-existing,
date-dependent `tests/newsModule.test.ts` fixture failures documented in every phase since Phase 1.

**Honest gap:** the interactive browser responsive ladder (1920/1600/1440/1280/1024/768/390,
light+dark, EN+ES, reduced motion) was **not** run — no connected browser in this background session,
the same disclosed limitation as every prior Phase 5 sub-phase. What *is* verified is source-and-
build-level: the `minWidth={360}` floor and `TableCard`'s own card-level `overflow-x-auto` for the
(previously unbounded) Recent Results table are both present and asserted by the new test suite.

---

### Phase 5H — `/portfolio` — as built (2026-07-29)

> **Two passes.** The first pass applied the Nevada components to the existing layout. A
> follow-up **Fable-parity audit** found that component adoption alone had not achieved
> structural parity — the page still followed the pre-Fable full-width vertical stack — and the
> page was **recomposed** against the approved export (`nmi-fable-v1` `SPECS.md` §2 *"the table
> IS the page"* + §1 Overview hero language, per doc 03's route mapping). What follows is the
> post-repair state.

**Files changed (11 — 1 source, 1 i18n, 8 test updates, 1 new test; `03`/`04`/`06` counted once):**

| File | Change |
|---|---|
| `src/app/portfolio/page.tsx` | **Recomposed to the Fable Portfolio layout.** Every hook, effect, fetch call, computed value, validation rule, and mutation payload is byte-for-byte unchanged; the JSX tree was rebuilt. **Header** → Fable header architecture (eyebrow, 19px `ui-page-title`, identity/meta inline on the baseline — `{positionCount} holdings` + `MarketDataSourceBadge` — actions right). **Region A** → asymmetric hero row: total-value hero (`flex 1.7 1 400px`, single `ui-kpi-hero` value + `color-mix`-tinted `ChangeIndicator` delta pill + 5 secondary minis in Fable's `repeat(auto-fit,minmax(120px,1fr))` grid under a divider) beside the sector **exposure meter panel** (`flex 1 1 250px`). **Region B** → Fable workspace: wide `TableCard` column (`flex 2.6 1 620px`) with the tab `SegmentedControl` moved **into the card's own toolbar**, beside a narrow right rail (`flex 1 1 280px`) holding the active tab's add-form as a **side panel** (vertically-stacked full-width chip inputs) plus the **CONCENTRATION** meter panel. Two page-local primitives added — `RailPanel` and `MeterRow` — composed entirely from `GlassSurface` + tokens. Cash-tab summary metrics moved into the left column adjacent to their table. Removed: the flat 7-across `KpiCapsule` grid, the hand-rolled underline tab band, the `space-y-5` single-column container, and the full-width sector band. Contrast fix carried over: all 3 submit buttons on `bg-primary text-primary-fg`. |
| `src/lib/i18n.ts` | 6 new keys × 2 languages: `tabsAriaLabel`, `holdings`, `vsCostBasis`, `concentration`, `largestPosition`, `noExposure`. No existing key touched. |
| `tests/fablePortfolioPage.test.ts` | **New — 123 tests.** Roughly half assert **structural parity** via real containment/ordering (`bodyOf()` component-body extraction and first-index ordering), not component-name presence: the Fable flex ratios and which surface each is applied to, section order, header architecture, primary-vs-secondary metric hierarchy (exactly one `ui-kpi-hero`; 5 minis under a divider), meter-panel anatomy, concentration = sort+slice of existing weights with no `reduce`, segmented control in the card toolbar, forms in the rail, and that each omitted Fable element is genuinely absent. The other half assert content/behaviour preservation exactly as before. |
| `tests/responsiveLayout.test.ts` | **Deliberate convention update, not a weakening.** The pre-Fable `xl:grid-cols-7` assertion is replaced by checks on the new intrinsically-responsive composition: all four Fable columns carry a `min(100%, …)` basis, both regions are wrapping flex rows, the minis grid is `auto-fit`, the cash grid still reflows 2→3→5, **and** `xl:grid-cols-7` must not return. Net coverage increased. |
| `tests/fableComparePage.test.ts`, `fableChartBuilderPage.test.ts`, `fableMacroCalendarPage.test.ts`, `fableWatchlistPage.test.ts`, `fableMacroPage.test.ts`, `fableCompanyDetailPage.test.ts`, `fableStocksPage.test.ts` | Scope-boundary updates — `/portfolio` removed from each file's "not yet migrated" guard array, the precedent every prior Phase 5 sub-phase set. |
| `docs/fable-integration/03` / `04` / `06` | Route 10 → Done/Verified with the full parity record; recommended-order item 8 ticked. |

**Files deliberately NOT changed:** `globals.css` (**no CSS was added** — the meter fill reuses the
existing `.nv-transition-state` width transition, already reduced-motion-gated globally), every
shared Fable component (`TableCard`/`AsyncState`/`GlassSurface`/`ChangeIndicator`/
`SegmentedControl` signatures asserted unchanged by test), `src/lib/portfolio/valuation.ts`, all 7
`src/app/api/portfolios/**` route files, `src/middleware.ts`, any other page,
`package.json`/`package-lock.json`.

**Fable elements incorporated (Class A/B):** header architecture with inline identity/meta ·
asymmetric hero row · single primary metric at hero scale · delta pill · secondary minis grid ·
exposure meter panel · CONCENTRATION rail panel · two-column analytical workspace at the Fable
2.6/1 ratio · segmented control inside the card toolbar · forms as a rail side panel · Fable
source/action placement · 14px gutter rhythm · intrinsic `min(100%, …)` responsive collapse.

**Fable elements omitted, with the precise missing authoritative data:**

| Fable element | Missing data / functionality |
|---|---|
| Hero sparkline | No portfolio-value time series exists — no history table, no endpoint, no accumulated snapshots for a portfolio (only per-ticker `stock_snapshots`). |
| Currency mix panel | `valuation.ts` is CLP-first and implements **no FX conversion**; every covered ticker is CLP, so the panel would be a single decorative 100% bar. |
| Search + asset-class filter row | No filter state, handler, or asset-class field exists on this route. Adding one is new functionality. |
| Sortable table headers ("weight default desc") | No sort state or comparator exists for Portfolio (Stocks has one; Portfolio never did). |
| Row-click position detail panel | No position-detail payload/endpoint exists, and the row already owns an inline-edit interaction that a row-click would conflict with. |
| Performance / attribution / benchmark / risk charts, monthly-returns grid, statistics list | None of that data exists for a portfolio here — no return series, no benchmark, no attribution decomposition, no risk metrics. |
| "Sample data" chips and footnotes | Fable sample-data disclosure; NMI's real source disclosure is the `MarketDataSourceBadge` + `TableSourceFooter`, which are preserved. |

Each omission is asserted by test **and** written into the page's own header comment, so no empty
decorative shell was created and the reason is discoverable from the source.

**Judgement calls, stated plainly:**
- **`SectionHeader` was replaced by a page-local header block on this route only.** Fable's header
  puts identity/meta *inline on the title's baseline*; the shared `SectionHeader` stacks a
  subtitle beneath. Forking the shared component would have restyled seven already-migrated
  routes — out of scope for a Portfolio-only phase — so the Fable architecture was reproduced
  locally at identical type scales (`ui-label` / `ui-page-title` / `ui-meta`). All three original
  strings (`tag`/`title`/`subtitle`) are preserved.
- **CONCENTRATION uses a sort + slice, never a new calculation.** Every number it renders is
  `position.weight` exactly as `valuePositions` produced it, and the headline stat is the single
  largest existing weight — deliberately **not** Fable's top-10 weight sum, which would be a new
  aggregate. A test asserts the panel contains no `reduce(`.
- **Cash summary cards keep their fixed per-card colours.** Each carries a *cash-flow direction*
  (deposits/sells green, withdrawals/buys red, net neutral), not a sign-derived one, so neither
  `KpiCapsule`'s single foreground nor `ChangeIndicator`'s sign colour models them. Feeding
  `ChangeIndicator` a synthetic "change value" purely to obtain a colour would misrepresent
  figures that are always non-negative `Math.abs()` display magnitudes.
- **No confirmation dialog and no tab-persistence key were invented** — neither existed, and the
  brief forbids adding mutations or persisted state for visual parity.

**Validation:** lint 0 problems · full suite **2877 → 3000 tests, 2997 pass, 3 fail** · build 0
errors (`/portfolio` still static/`○`). The 3 failures are the same pre-existing, date-dependent
`tests/newsModule.test.ts` fixture failures documented in every phase since Phase 1. No new
`tsc` nits were introduced (the 32 remaining are all pre-existing in other test files).

**Honest gap:** the interactive browser responsive ladder (1920/1600/1440/1280/1024/768/390,
light+dark, EN+ES) was **not** run — no Chrome extension is connected in this environment, the
same disclosed limitation as every prior Phase 5 sub-phase, and `/portfolio` is additionally
protected so its rendered DOM is unreachable without a session (as for `/watchlist` in Phase 5B).
What *was* verified beyond source scanning: a live dev server returned `307 →
/login?next=%2Fportfolio` for the protected route; the shipped client chunk contains all four
Fable flex ratios, the `min(100%, …)` collapse bases, the auto-fit minis grid, `ui-kpi-hero` and
`nv-transition-state`; all 12 new EN+ES strings appear in the shipped bundles; and the served
stylesheet contains every utility the page uses plus a `prefers-reduced-motion` block that forces
`transition-duration:.01ms` universally (covering the meter-fill width transition) and renders
`.nv-reveal` at its final state.
---

## Phase R0 — Shared composition primitives (normalized Stage 5R program) ✓ IMPLEMENTED (2026-07-29, pending manual browser acceptance)

First phase of the accepted Stage 5R normalized repair program (R0–R12). Foundation only — **no
route was migrated**; later route phases (R1–R11) adopt these primitives deliberately.

**New components** (`src/components/fable/`):
- `PageHeader.tsx` — the Fable baseline page header (eyebrow · `ui-page-title` · dot-separated
  baseline metadata · trailing action cluster reserved for route-wide actions per decision D-1).
  Presentational only; replaces `SectionHeader` route-by-route in later phases.
- `Chip.tsx` — the shared pill recipe as `ChipButton` / `ChipLabel` / `ChipSelect` (native select
  in pill clothing — the Stocks sector-filter pattern). Later phases replace the ~18 hand-rolled
  inline chip recipes with these.
- `ModalShell.tsx` — the one shared dialog shell (scrim → labelled `role="dialog"`, focus trap,
  initial focus, Escape/scrim/✕ dismissal, body-scroll lock, focus restore, pinned header/footer
  slots, scrollable body, `dense` near-opaque body option per §8) plus `DestructiveConfirm`
  (alertdialog mode for the approved Portfolio delete confirmation: pending lock,
  duplicate-submit guard, critical-fill action, never `window.confirm`). Existing route modals
  are NOT migrated in R0.

**Extended:** `TableCard.tsx` gains an optional `maxHeight` vertical-scroll mode — both scroll
axes on one container so `sticky top-0` table headers genuinely stick (they were inert on every
current consumer; behavior unchanged when the prop is omitted).

**Normalized (styling only — behavior byte-preserved):** `UpdateDataButton` (999px pill,
`nv-transition`/`nv-spin`; state machine, labels, h-9 prominence, and **API unchanged** —
`onRefresh` stays required and the component takes on no provider dependency, so the
platform-wide contract (decision D-1) continues to be supplied by each page's own
`useGlobalRefresh()` call), `LangToggle` (chip-token capsule
matching ThemeToggle geometry, `aria-pressed` added, `font-mono` dropped per §18), `ThemeToggle`
(chip-token track, tokenized motion; persisted-choice behavior untouched).

**Shell width alignment:** `TopBar` and `SecondaryNav` content now sits in an inner
`max-w-(--content-max-w) mx-auto` rail, sharing `<main>`'s cap — header and page content keep one
gutter line above the cap (Stage 5R shared defect #1). No nav behavior, route, or item changed.

**Chart token repairs:** `LineChart` event markers `var(--primary)` → `var(--chart-primary)`;
`FundamentalsChart` hover column `var(--hover)` → new alias `--chart-hover-column: var(--hover)`
declared in the chart token block. No chart logic, data, scale, or dimension changed.

**Tests:** `tests/fableR0Primitives.test.ts` (61 tests — primitive anatomy/order/containment,
ModalShell dialog contract, TableCard scroll-container binding, the UpdateDataButton D-1
contract guard, shell width sharing, chart token leak closure, token/data hygiene).

**Not done in R0 (by design):** no route adoption, no route modal migration, no i18n additions
(ModalShell reuses `t.fable.panel.close`), no API/provider/persistence change. **Manual browser
checks pending** (gutter alignment ≥1728px, modal keyboard walk, chip focus, TableCard scroll,
toggles in both themes, reduced motion) — R0 is implemented but not manually accepted until they
run.

---

## Phase R1 — Auth shell and login (normalized Stage 5R program) ✓ IMPLEMENTED (2026-07-29, automated validation complete, manual browser validation pending)

`/login` now renders the full-bleed Fable "Private Access" gateway (spec §0) with the complete
Phase-6B functional contract preserved verbatim. `/forgot-password` and `/auth/reset-password`
are **untouched** (R2).

**Shell architecture** (the doc's own Phase-6 "route group *or* shell-suppression" choice —
implemented as BOTH, minimally): the root layout cannot conditionally skip `AppShell` server-side,
so it now mounts **`ShellGate`** (`src/components/layout/ShellGate.tsx`, client), which renders the
byte-unchanged `<AppShell>` for every app route and steps aside for `BARE_ROUTES = {'/login'}`.
The **`(auth)` route group** (`src/app/(auth)/layout.tsx`) supplies what those routes still need:
`LangProvider` + `AuthShell`. No market/macro providers, no TopBar/CommandPalette on the gateway.
R2 adds the other two auth routes to both the group and `BARE_ROUTES` in one change.

**New components** (`src/components/fable/`):
- `AuthShell.tsx` — layer stack photo → light-wash veil → navy-vignette veil → content column
  (top row: full `NevadaMark` lockup at `clamp(98px,9vw,132px)` + white-glass utility chips —
  secure-connection `ChipLabel` with pulsing dot, the EXISTING `LangToggle`, a Santiago clock
  chip (`America/Santiago`, minute resolution, hydration-safe), the EXISTING `ThemeToggle`;
  middle: wrapping Fable row for `{children}`; bottom: confidentiality notice). The toggles are
  re-skinned via **CSS custom-property rescoping only** (`CHIP_REMAP` maps `--nv-chip`/`--surface`/
  `--foreground`/`--muted-fg`/`--hover` to fixed `--nv-auth-*` values) — zero edits to the
  originals, no duplicate toggle components.
- `AuthPanel.tsx` — the Tier-1 `nv-glass-auth` panel: cursor specular (`--glx`/`--gly` →
  `--nv-auth-specular`), top hairline, `ui-label` eyebrow, 23px `<h2>` title, children slot.
  Reused as-is by the R2 variants.

**Login page** (`src/app/(auth)/login/page.tsx`, old `src/app/login/page.tsx` deleted — same URL):
headline block (`--fs-login-headline` clamp, `--brand-navy`, Fable copy via new `t.auth.*` keys)
beside the panel at Fable's `flex: 1.1 1 340px` / `flex: 0 1 402px` + `min-width: min(100%, 330px)`
grammar. Preserved verbatim: `POST /api/auth/login|register` + exact payloads, all six error-code
mappings + generic fallback, `?error` callback banner, same-origin `next` guard +
`window.location.assign`, `disabled={loading || !username.trim() || !password}`, both
`setLoading(false)` failure paths, field ids/types/`autoComplete`/`autoCapitalize`/`spellCheck`,
create-mode email + hints, forgot-password link (sign-in only), mode toggle, back link, Suspense
boundary. Improvements within scope: `role="alert"` on the error banner, `autoFocus` on username,
spinner (`nv-spin`) beside the unchanged label while loading. **Excluded** (locked register):
passkey, demo credentials, remember-device, Show/Hide password (Class C, unapproved), simulated
auth, signed-in auto-redirect.

**Theme-independence** (spec §Theming): all gateway colors are `--nv-auth-*` tokens declared once
in `:root` and never overridden under `.dark` — the login reads identically in both themes while
ThemeToggle still switches the app behind it. `globals.css` additions: the §0 veils/inks/input/
error/on-photo/chip-remap/specular tokens, `.nv-auth-input` (13px-radius field with the Fable
border+halo **replacement** focus treatment — same replace-not-remove precedent as the pre-Fable
login), `.nv-auth-chip-glass` (chip-tier blur inside the `@supports` guard). Motion is
tokenized (`nv-ken`/`nv-reveal` staggers/`nv-pulse`/`nv-pop`) and fully covered by the existing
reduced-motion block.

**Asset:** `public/login-santiago.webp` — copied byte-identical from the approved Fable export
(`brand-assets/sky-costanera.webp`, 1400×800, same image as the export's referenced login bg);
`object-position: 58% 30%` per doc 02.

**Tests:** new `tests/fableAuthShell.test.ts` (47) — gate/group architecture, layer-stack and
panel anatomy order, the full preserved login contract, locked-exclusion negatives, token/i18n/
motion hygiene, R2 non-regression. Deliberate guard updates: `authWatchlist` +
`passwordResetAndUpdateButton` login paths → `(auth)/login`; `fableFoundation` root-layout
assertion → ShellGate (chrome contract asserted on ShellGate itself) and the global focus-ring
guard anchored to column 0 with the narrow, visibility-asserted `.nv-auth-input` exception.

**Manual browser checks pending** (1728/1024/390, both themes, both languages): sign-in/out,
create-account, `next` round-trip, ES swap, reduced-motion, focus lands on the username field,
headline/panel stacking, chip legibility over the sky, no page-level horizontal overflow.

### R1 performance repair (2026-07-29, after the first manual pass)

Manual validation reported the composition as correct but the entrance as visibly laggy. Three
compounding causes were found and removed; the gateway is now **visually still once it has
entered**, and the entrance animates only compositor-friendly properties.

1. **Ken-Burns on the full-screen photograph (dominant cost, removed).** `.nv-ken` continuously
   transformed a 105%-sized 1400×800 image beneath **five backdrop-filter surfaces** (the
   `AuthPanel` + four utility chips). A blurred surface can only reuse its cached result while its
   backdrop holds still, so every frame of the 60s loop invalidated and recomputed five 24px
   blur + 150% saturate passes — forever. The photograph now ships static, sized to the viewport
   (the 105% oversize existed only to hide the drift edges), with `decoding="async"` +
   `fetchPriority="high"` so the 1.3MB decode cannot stall first paint. `.nv-ken`, `nvKen` and
   `--dur-ken` remain declared as foundation utilities (documented as no longer applied here).
   This is a **documented deviation from Fable §0**, which specifies a 60s Ken-Burns.
2. **`.nv-reveal` animated `filter: blur(8px)` (replaced).** `nvIn` blur-animated five auth
   elements — including the headline block and the entire panel, which already carries a
   backdrop-filter — for `--dur-reveal` (640ms) plus delays up to 300ms, i.e. a ~940ms
   blur-animating cascade running while the browser decoded the photograph and hydrated. Replaced
   with two auth-scoped utilities: **`.nv-auth-reveal`** (opacity + `translate3d(0, 22px, 0)`) and
   **`.nv-auth-fade`** (opacity only, used for the surfaces that carry a backdrop-filter, because
   translating one re-samples its backdrop every frame). `.nv-reveal`/`nvIn` are untouched for
   every other route.

   **Timing correction (second manual pass).** The first repair also shortened the entrance to
   `--dur-pop` (220ms), which made the gateway snap in visibly ahead of every app page — Markets,
   Macro and the rest reveal over `--dur-reveal` (640ms). The auth utilities now use **exactly
   `.nv-reveal`'s timing**: the same `--dur-reveal` duration token, the same `--ease-primary`
   easing, the same 22px rise, staggered in whole `--stagger-reveal` (70ms) tiers — headline and
   top row at 0, panel at 70ms, notice at 140ms, mirroring the 0/70/130/190 cadence app pages use
   between their sections. Only `nvIn`'s blur is omitted. A test asserts the duration/easing
   parity by reading both rules, so the gateway cannot drift from the app pages again.
3. **Cursor specular set React state per `mousemove` (removed).** `AuthPanel`'s `onMouseMove`
   called `setSpec()`, re-rendering the whole panel subtree — the entire form — on every pointer
   event, and repainting a 520×260 radial gradient over a backdrop-filtered surface. The panel is
   now **stateless and pointer-free** (no `'use client'` needed) and the sheen is a fixed
   highlight at its former resting position, so the glass still reads as glass at zero runtime
   cost.

Also removed: the infinite `nv-pulse` on the secure-connection dot (the last permanently-running
animation; the dot stays, and meaning never rested on the motion since the chip is labelled).
Both new utilities are added to the reduced-motion final-state rule, so reduced motion renders the
gateway immediately with no entrance, drift, pulse, or pointer effect.

Nothing else changed: no field, mode, endpoint, payload, redirect, callback, loading semantic,
error mapping, i18n string, route-group/ShellGate architecture, or protected path. `AuthPanel`
losing `'use client'` is a consequence of it becoming stateless, not an architectural change.
Tests: `tests/fableAuthShell.test.ts` 47 → **56** (entrance-property, no-Ken-Burns, no-pointer-
state, app-page timing parity, tokenized stagger tiers, glass-fade-vs-translate, reduced-motion
and loading-legibility guards).

---

## Phase R1.5 — Private-access enforcement and admin-controlled provisioning

A security phase inserted between R1 and R2. Canonical reference:
**`docs/security_access_control.md`** — read that first; this section records only what changed and
why, for continuity with the R-phase plan.

**Vulnerabilities closed.** (1) Middleware protected only four page prefixes and five API prefixes
by *denylist*, so every other route was world-readable — `/`, `/stocks`, `/macro`, `/compare`,
`/chart-builder`, `/earnings`, `/companies/[ticker]` and the entire `/api/market`, `/api/macro`,
`/api/earnings`, `/api/financials`, `/api/valuation`, `/api/compare`, `/api/news`,
`/api/health` surface. (2) `/api/auth/register` was publicly callable and created a real account
plus a session whenever `AUTH_REGISTRATION_CODE` was unset. (3) `next.startsWith('/')` accepted
`//evil.example`, an open redirect on both `/login` and `/auth/callback`. (4) A Supabase Auth
identity with no application profile could obtain a session through the recovery-link path and,
under (1), read everything.

**Architecture.** Four new pure/server modules under `src/lib/auth/`: `accessPolicy.ts`
(default-deny classification — THE allowlist), `safeRedirect.ts` (THE redirect validator),
`approval.ts` (THE approval predicate), `apiGuard.ts` (reusable JSON 401/403 guard).
`middleware.ts` rewritten as a thin adapter over the policy; the approval boundary is enforced at
both session-minting routes. No new schema, no migration, no new dependency, no new env var — the
approval marker is `user_profiles.username`, the record username login already required.

**Deliberate deviation from the "runs with zero env vars" convenience.** With Supabase
unconfigured there is no authentication mechanism, so middleware now fails **closed** for private
paths rather than serving private data anonymously. `/login`, the auth endpoints and all assets
still respond; `npm run build` and the full suite are unaffected.

**Registration removal.** `/login` lost its create-account mode, recovery-email field, mode toggle
and register POST; `/api/auth/register/route.ts` was deleted. Accounts come from
`scripts/admin/provisionUser.ts` (outside the router, dry-run by default, `--revoke` supported).
Two i18n keys added in both dictionaries: `auth.adminProvisioned`, `auth.errNotAuthorized`.

Tests: new `tests/accessControl.test.ts`, route matrices built by walking `src/app` so future
routes are covered automatically. Nineteen pre-existing tests across sixteen suites asserted
protection via the removed `PROTECTED_PAGES`/`PROTECTED_API` literals or claimed a page was
"public"; each was re-pointed at the real policy function (same property, stronger assertion).
`fableCompanyDetailPage`'s "the company route stays public" was **deliberately inverted**, since
making it private is the point.

**Correction pass (verified session, immediate revocation, DB integrity).** Three follow-ups the
first pass left open:

1. **Verified identity.** The gate authorised from `getSession()` — a cookie read. It now runs
   `decideRequestAccess` (`src/lib/auth/requestAccess.ts`, pure + dependency-injected) over
   `auth.getUser()`, which validates the token with the Auth server and so rejects forged, expired,
   revoked, **banned and deleted** identities. Costs two sequential Supabase round-trips per private
   request; documented and accepted.
2. **Per-request approval.** The approval record is re-read on every private request, not only when
   a session is minted, so `--revoke` denies the very next request with no access-token-expiry wait.
   Browser denials for an unapproved identity redirect with `?error=not_authorized` and drop the
   `sb-*` cookies; API denials are **403** (401 stays for an invalid session).
3. **Database integrity.** Migration `20260730000000_user_profiles_admin_controlled_approval.sql`
   removes the Phase-6A self-approval policies and every authenticated write privilege, leaving one
   own-row `SELECT`. **Authored, not applied.** Also found and fixed: the provisioning command
   documented `npx tsx`, but `tsx` is not a dependency — it would have fetched an unpinned package
   before a command holding the service-role key. Now plain `node`, matching every other script.

Live read-only checks against the connected project (2026-07-30): public signup was enabled
(`disable_signup: false`), the administrator disabled it, re-verified `true`; anonymous
`GET /rest/v1/user_profiles` returned `200 []`, confirming the table privilege existed and only RLS
filtered the rows.

New: `tests/userProfilesRls.test.ts` (37). Suite 3141 → **3391**, lint 0, build 0 errors.

---

## Phase R2 — Fable password-recovery variants ✓ IMPLEMENTED (2026-07-30, automated validation complete, manual browser validation pending)

R1 gave `/login` the full-bleed gateway; `/forgot-password` and `/auth/reset-password` were left on
the legacy presentation and rendered through `AppShell` on a plain background with a `BrandLogo`
mini-card — they read as a different platform. R2 makes all three public authentication routes
variants of one gateway while each keeps its own form content and behaviour.

**Routing.** Both recovery pages moved into the existing `(auth)` route group:
`src/app/(auth)/forgot-password/page.tsx` and `src/app/(auth)/auth/reset-password/page.tsx`. A route
group contributes no URL segment, so the public URLs are byte-identical (`/forgot-password`,
`/auth/reset-password`) — only the enclosing layout changed. `(auth)/auth/reset-password` and
`app/auth/callback/route.ts` resolve to different URLs, so they coexist with no route conflict
(verified by a clean `next build`: 19 routes, `/auth/callback` still ƒ, both pages still ○).
`ShellGate.BARE_ROUTES` gained the two paths in the same change; a test now asserts that set and the
`(auth)` group's page set are **equal**, because drift either way is a real defect — a bare route
outside the group renders with no shell at all, and a group route missing from the gate renders the
gateway nested inside the app chrome.

**Shared primitives.** Rebuilding two panels from the login's JSX would have meant three copies of
every field, notice, button and link. New `src/components/fable/AuthForm.tsx` owns those concerns
once — `AuthField`, `AuthNotice`, `AuthSubmitButton`, `AuthSecondaryLink`, `AuthBackLink`,
`AuthHint`, plus the two shell slots `AuthHeadline` and `AuthPanelColumn`. `/login` was recomposed
onto them too, so there is no privileged copy. The module is presentational only: no fetch, no
Supabase, no URL, no state — each route still shows its complete contract in its own file. The R1
assertions that pointed at login markup now point at the primitive that renders it, so the same
guarantees hold at the level where the behaviour actually lives.

**Preserved verbatim.** `/forgot-password`: same endpoint, same `{ email: email.trim() }` payload,
same empty catch and `finally`-set sent state, so the response never gates the UI and a real address
stays indistinguishable from an unknown one. `/auth/reset-password`: same endpoint and payload, the
client-side mismatch guard still precedes the request, `no_session` still maps to the explicit
"request a new link" message, and the only navigation is the existing 1.5s `router.push('/login')`
after success — the page still never redirects before the user can set a password.

**Visual/a11y.** Both panels use the Tier-1 `nv-glass-auth` surface, the `privateAccess` eyebrow and
the same identity column as `/login` (asserted byte-identical across the three routes). Panel height
follows content — no route pins a height. Each panel's eyebrow, title and explanation render in both
states, so submitting changes only the region below them rather than jolting the head. New token
trio `--nv-auth-ok-bg/-bd/-fg` gives the confirmation banner a sibling of the error banner, declared
in `:root` only like every other `--nv-auth-*` token. The error notice is `role="alert"`, the
success notice `role="status"`, and both stateful forms wire `aria-describedby` from their fields to
the visible error — an improvement on R1, where the banner was an unassociated sibling. The legacy
`BrandLogo` card and the plain background are gone.

**R2 repair (2026-07-30, from the desktop review).** The "← Back to dashboard" link below the panel
still rendered on `/login` — R1 inherited it, and the first R2 pass removed it only from the two
recovery pages. It is now gone from the whole gateway: the `AuthBackLink` primitive is deleted, the
usage removed from `/login`, and the orphaned `auth.backToHome` key dropped from both dictionaries.
The rationale is that `/` is a PRIVATE route, so on a signed-out gateway the link only bounced the
visitor through middleware back to `/login?next=/`. Route-specific navigation stays inside the panel
("Forgot password?" on `/login`, "Back to sign in" on both recovery routes). Verified in rendered
HTML: each auth route now emits exactly ONE anchor — its own in-panel link — and zero links to `/`.
The app's own navigation is untouched (`TopBar` keeps its brand link; `AppShell` unchanged).

**Security: nothing changed.** R1.5's allowlist already classified all three paths `public_page`, so
no policy edit was needed; `/auth/callback` stays a route handler enforcing the approval boundary.
Re-verified at runtime against the dev server: the three auth pages 200, private pages 307 to
`/login?next=…`, private APIs 401 JSON, `/api/auth/register` still absent.

New: `tests/fableAuthRecovery.test.ts` (53, including 6 for the back-link repair), plus one added
case in `tests/fableAuthShell.test.ts` (`/auth/callback` stays a route handler). Measured after this
phase: **3471 tests, 3468 pass, 3 fail**, the three failures being the pre-existing date-dependent
`tests/newsModule.test.ts` cases (confirmed by running that file alone: 53 tests, 50 pass, 3 fail).
Lint 0, build 0 errors, `git diff --check` clean.

---

## Phase R3 — Fable Structured Notes dashboard ✓ IMPLEMENTED (2026-07-30, automated validation complete, manual browser validation pending)

`/structured-notes` (the dashboard only — the `[id]` detail page is R4) re-skinned to the approved
Fable §6 composition: capsule row → lifecycle legend chips → wide table with the signature barrier
gauge. Presentation only: every hook, fetch call, filter, sort comparator, mutation payload,
monitoring calculation and API contract is unchanged in substance.

**Files:** `src/app/structured-notes/page.tsx` (recomposed), `src/lib/i18n.ts` (6 new `sn` keys × 2
languages: `pageMeta`, `colNote`, `colLevel`, `dashNextObs`, `clickHint`, `viewToggle`), new
`tests/fableStructuredNotesPage.test.ts`, phase-boundary guard lists updated in 8 existing
`fable*Page` suites (the same "real phase boundary moving" precedent as 5F/5H). No shared component
was modified; no CSS was added; no new dependency.

**Composition (shared primitives only):** `PageHeader` (its first consumer — 19px title + baseline
metadata + actions), a KPI-glass capsule row carrying ALL SEVEN pre-R3 dashboard KPIs (more than
Fable's four — NMI substance wins) plus the Fable NEXT OBSERVATION capsule derived from the
per-note `nextObservationDate` the API already returns; the exposure bar/donut SVGs re-housed on
`GlassSurface` card glass; the Fable lifecycle-legend chip row (full legend sentences preserved via
`title` + `sr-only`, replacing the pre-Fable always-visible paragraph); and a `TableCard`
(minWidth 1180, card-level scroll) whose toolbar holds the upload pill, two `ChipSelect` filters and
the Live/Archived `SegmentedControl`. Rows navigate to the CANONICAL `/structured-notes/[id]` route
(row click + a real link on the product name); the extraction preview is a glass card with the
confidence/review pill. The route-local Update button deliberately does NOT use `UpdateDataButton`
(that control is reserved for the platform-wide refresh; this one re-pulls the book's prices).

**The barrier gauge** (Fable's signature element) uses the existing shared `BarrierGauge` on its
0–130 scale: current = worst-of level indexed to 100 at strike (`(1 + worstPerformer.performance) ×
100`, a pure display transform of the existing metric), knock-in tick at `knockInBarrierPct × 100`,
strike tick at 100; missing prices render the honest unavailable text. The distance-to-barrier
column is proximity-colored with the same documented Fable thresholds (display-only —
`distanceTone` never feeds eligibility logic, which stays in `src/lib/structuredNotes`).

**Preserved verbatim:** endpoints (`GET /api/structured-notes`, `/monitoring-status`; `POST
/extract`, `/import`; `PATCH /{id}`), upload → extract → review → import, Called checkbox →
archived, clickable KPI filters (`focusStatus`), status/issuer filters, 4-key sorting, the
≤7-day next-observation highlight, the archived-view column swap, all four monitoring exception
counts + provider-quality flags, `TableSourceFooter` with `sourceMarket` + the book-level
`pricesAsOf`, and every i18n key. States: loading/empty/populated via the shared `AsyncState`
kinds; NEW: a failed initial load now renders the `error` state instead of masquerading as the
empty book (the one deliberate state improvement, per the R3 real-data-states requirement).

**Documented departures from the Fable reference:** (1) Fable's per-row VALUATION timestamp column
is omitted — no per-note valuation timestamp exists on the list payload; the book-level as-of stays
in the footer. (2) Fable's "% of portfolio" capsule subline is omitted — no portfolio-total linkage
exists. (3) Fable's narrated coupon cell ("Paid Q2 · 8.20% p.a.") is the plain annualized rate —
the narration is sample content. (4) The lifecycle legend renders as its own band above the table
(SPECS §6 sequence) rather than inside the table-card header band (the export's variant) — the
`TableCard` header row is occupied by the real toolbar NMI needs and Fable's prototype lacks.
(5) Numerics right-align per the Fable typographic standard, superseding the pre-Fable Phase 9B.2
center-alignment. (6) The seven NMI KPIs + next-observation capsule exceed Fable's four capsules —
"Fable's look, NMI's substance."

**Security: nothing changed.** Verified at runtime against the dev server: `/structured-notes` and
`/structured-notes/{id}` 307 → `/login?next=…` with zero structured-note content in the pre-auth
response; all five SN APIs 401 JSON; `classifyPath` still reports `private_page`/`private_api`;
middleware, access policy, and every API route file untouched.

Measured after this phase: **3511 tests, 3508 pass, 3 fail** (only the three pre-existing
date-dependent `tests/newsModule.test.ts` cases). Lint 0, build 0 errors (`/structured-notes` ○ and
`/structured-notes/[id]` ƒ both present), `git diff --check` clean. Manual browser validation at
1728/1024/390 (light/dark, EN/ES, reduced motion) is **pending** — no browser was connected in the
implementing session.

### R3 manual-validation repair (2026-07-31) — exposure cards + triage-first table

Two findings from the manual visual review, fixed as a presentation-only repair inside R3 (same
files: `page.tsx`, `i18n.ts` + one key, the R3 test suite; no API/auth/lib change, detail page
untouched):

1. **Exposure cards recomposed Fable-native.** Both cards gain a shared `ExposureHeader` (ui-label
   title left, `TOTAL` micro-label + exact figure right — the capsule label/value pattern).
   *Exposure by issuer* is now a ranked list: name + share (`%` emphasized, exact notional muted)
   over a thin **uniform accent** fill on the chip track (`--nv-chip`), rows on `nv-row-hover` —
   the old per-issuer `CHART_PALETTE` colors were dropped because they falsely implied a color link
   with the entity donut. *Allocation by entity* keeps the palette (segments need identity) and
   gains descending gapped segments (min-sliver guard so tiny allocations never vanish), a center
   TOTAL (truncation-safe — the exact figure repeats in the header), and a hover-linked legend
   (entering a row or segment dims the others; opacity-only via `nv-transition`, reduced-motion
   safe, `onMouseEnter` not `onMouseMove`). Every exact value and percentage stays printed; hover is
   optional emphasis, never load-bearing. No chart library.
2. **Triage-first table order.** New column order: Status · Next obs (Archived as of in the archived
   view) · Note · Issuer · Level gauge · To barrier · Worst · Coupon · Knock-in · Issued · Notional ·
   the administrative Called checkbox last — the monitoring-decision fields are now visible before
   any horizontal scroll. The NOTE column is width-capped (`maxWidth: 230`) with both lines
   truncating; the full product name and the full `ISIN · underlyings` line are revealed on hover
   via `title` (native tooltip — no custom system). No column removed; sorting, the ≤7-day
   highlight, and the archived swap are unchanged. `minWidth` stays 1180 (readability floor).

Guarded by the new `R3.R1`/`R3.R2` describes in `tests/fableStructuredNotesPage.test.ts` (+7
tests). Measured after the repair: **3518 tests, 3515 pass, 3 fail** (the same three permitted
`newsModule` cases), lint 0, build 0 errors, `git diff --check` clean. Manual browser validation at
1728/1024/390 (light/dark, EN/ES, reduced motion) remains **pending** — no browser connected.

### R3 table-density repair (2026-07-31) — full table visible at 1728px, no internal scrollbar

Final desktop review found the table still scrolling horizontally at a maximized 1728px viewport.
Presentation-only fix (page + `colLevel` label + tests; no data/logic/order change):

- **Deliberate column system**: `table-layout: fixed` + a `COLS` colgroup (no browser
  auto-sizing). Widths: Status **118** (EN) / **150** (ES — "Cerca de la barrera" is longer) ·
  Next obs **120** (**130** for the archived view's "Archived as of") · Note **160** · Issuer
  **80** · Level gauge **170** · Dist. to barrier **85** · Worst **100** · Coupon p.a. **80** ·
  Knock-in **75** · Issued **85** · Notional **100** · Called **80**. Sums: **1253** EN / **1285**
  ES vs ~1302 available inside the shell at 1728 (1560 shell − 208 sidebar − 48 padding − borders)
  → every column visible, slack distributed proportionally by the fixed layout. `TableCard
  minWidth` is now the system's own sum, so narrower viewports keep the identical card-contained
  scroll (no page-level overflow; no font-size change).
- **Width enablers**: cell/header padding `px-3` → `px-2`; the two long headers ("Dist. to
  barrier"/"Caída a barrera", "Coupon p.a.") wrap to two deliberate lines (`thBaseWrap`,
  headers `align-bottom` so single-line labels share the baseline); `colLevel` label shortened to
  'Level'/'Nivel' and the gauge given a compact single-line reading (`Current 87.3` via the
  existing `t.fable.barrier.current`, passed as `summary` — the old auto-derived sentence was
  ~40 chars and was the real width driver of that column); gauge track 150 → 140 (fully legible);
  the near-observation pill's padding trimmed to fit "(NNd)" inside 120.
- **Alignment (final)**: Status left · Note left (truncated, full text via hover title) · gauge
  centered · Next obs, Issuer, Dist., Worst, Coupon, Knock-in, Issued, Notional, Called all
  **center** header + cells (supersedes the interim right-alignment, which had superseded the
  pre-Fable 9B.2 centering). Sort arrows sit inline with their centered labels; `aria-sort`
  unchanged.
- **No silent numeric truncation**: percents/dates are narrower than their columns by
  construction; Issuer, the worst-performer name, and Notional carry `truncate` + full-value
  `title` as the safety net (the worst-performer % is `shrink-0` and can never truncate).
- **Underlying tickers display without the Bloomberg market qualifier** (follow-up, same day):
  `underlyingName` stores the term-sheet ticker verbatim — "SPX Index", "SPY US Equity" — whose
  qualifier is redundant in a table where every row is an underlying. A pure display helper
  (`shortUnderlying`) strips ONLY a recognized trailing qualifier (`Index|Equity|Curncy|Comdty|
  Govt|Corp`, optional 2-letter exchange code), so "SPX Index" → "SPX", "SPY US Equity" → "SPY",
  "SQM/B CC Equity" → "SQM/B", while an unrecognized name ("Some Custom Basket") passes through
  verbatim — never mangled. Applied to the Worst cell and the NOTE underlyings line only; the
  stored value, the hover `title`s, the extraction-review field (where the reviewer is verifying
  parse fidelity against the PDF), symbol resolution, and the detail page are all untouched.
  With the shorter ticker the Worst column now shows in full at its normal content; widths
  rebalanced Level 170 → **160** (the 140px gauge track + `px-2` needs only 156) and Worst
  100 → **110**, so the column sums are unchanged (1253 EN / 1285 ES).

Guarded by the new `R3.R3` describe (+7 tests; `R3.R1`'s NOTE-cap and `R3.1`'s
minWidth/alignment assertions updated). Measured: **3525 tests, 3522 pass, 3 fail** (the same
three permitted `newsModule` cases), lint 0, build 0 errors, `git diff --check` clean. The
manual browser pass (1728/1024/390, light/dark, EN/ES) remains **pending** — no browser
connected; the 1728 fit above is arithmetic from the real token font specs, not an observed
render.

---

## Phase R4 — Fable Structured Notes DETAIL page ✓ IMPLEMENTED (2026-07-31, automated validation complete, manual browser validation pending)

`/structured-notes/[id]` (the canonical detail route — the last legacy SN surface) re-skinned to
the approved Fable note-detail anatomy: nmi-fable-v1 SPECS.md §6 "Row → panel: 12-field terms
grid, lifecycle timeline (issued ✓, coupons ✓, next observation ●, maturity ○)" plus §Overlays'
detail-panel header (title, status pill, subtitle) and 2-column stats grid — **adapted from the
export's supplementary 440px side panel to this canonical full page** in the R3 dashboard's
visual family (design_principles §2: panels never replace a canonical route). Presentation only:
every endpoint, payload, monitoring value, allocation mutation, and the delete
confirm/endpoint/redirect are unchanged in substance.

**Files:** `src/app/structured-notes/[id]/page.tsx` (recomposed), `src/lib/i18n.ts` (26 new `sn`
keys × 2 languages — detail labels that were previously HARDCODED English on the legacy page:
guarantor/couponBarrier/autocallBarrier/initialValuation/finalValuation/redemption/payoffType/
couponFrequency/denomination/issuePrice/currencyLabel/memoryCoupon/principalProtection/
termsIdentity/termsEconomics/termsDates/initialLevel/strikeLevel/symbolLabel/currentLevel/
valuationDate/paymentDate/notFound/deleting/deleteError/removeEntity), new
`tests/fableStructuredNoteDetailPage.test.ts` (46 tests), `tests/fableStructuredNotesPage.test.ts`
(R3.9 phase boundary advanced — same precedent as 5F/5H). **One minimal dashboard compatibility
change:** `src/app/structured-notes/page.tsx`'s export line grew from `{ fmtPct, fmtNum }` to
also export `distanceTone`, `shortUnderlying`, `StatCapsule`, `RISK_TONE` — display-only shares
so the two SN surfaces can never drift (the detail page already imported fmtPct/fmtNum from the
dashboard pre-R4); no dashboard behavior or markup changed.

**Composition (shared primitives only):** back link → `PageHeader` (mono ISIN eyebrow, product
name as a WRAPPING title — `break-words`, never truncation/hover-only, so the full name is
readable on touch; issuer · structure · lifecycle-status pill as metadata) → the R3
`StatCapsule` strip in decision-first order (risk status w/ legend tooltip, worst performer
(short ticker + %), worst distance-to-knock-in (proximity-toned), next observation (≤7d
negative-toned), coupon p.a., current notional, maturity) → **Current levels & barriers**
`TableCard` (minWidth 680): per-underlying `BarrierGauge` (level indexed to 100 at strike — pure
display transform; marks = per-underlying knock-in pct → note-level fallback + strike),
current level, both distances proximity-colored via the shared `distanceTone`, the
worst-performer designation as a visible text chip, last-monitored + stale flag, Yahoo footer +
real as-of + estimate disclaimer → **Terms** on card glass, grouped Identity · Coupon & barriers
· Key dates (Fable grid, micro-label over value; boolean features memory-coupon /
principal-protection as chips ONLY when true — absence is never a fabricated "No"; now also
shows payoffType/couponFrequency/denomination/issuePrice/initialValuation/redemption, real
fields the legacy page omitted) → **Underlyings** `TableCard` (560): order/name/symbol/initial/
strike/knock-in/coupon/autocall contractual levels → **Observation schedule** `TableCard` (680,
maxHeight 300): the Fable lifecycle timeline as the card's header strip (Issued ✓ green ·
Observed n/m · Next ● amber · Maturity ○ neutral — all four anchors from real fields) above the
COMPLETE deduped observation table; completed rows muted, the next observation row
warning-tinted with a ● marker + sr-only announcement — classification comes from the API's own
`status` + `nextObservation`, never client date math → **Allocation** card (EntityAllocationGrid
preserved verbatim in behavior: upsert endpoint/payload, custom entities, thousands formatting,
total + issue-size mismatch warning; inputs gain aria-labels) · **Provenance** card (source
type/file/confidence) with the delete workflow: same confirmation text + `DELETE` + success-only
redirect, now a labeled destructive pill (negative border/tint) with honest
`deleting`/`deleteError` states — and, since R4.1 below, gated by the shared Fable
`DestructiveConfirm` dialog instead of `window.confirm`.

**Real-data state fixes (documented improvements, not contract changes):** (1) API failure now
renders the `error` AsyncState — the legacy page showed "not found" for a network failure;
(2) a failed DELETE now surfaces `deleteError` instead of silently redirecting as if it
succeeded; (3) not-found renders an honest localized empty state (`t.sn.notFound`) instead of
hardcoded "not found"; (4) loading is the shared spinner AsyncState instead of a bare "…".

**Documented departures from the Fable reference:** (1) the side-panel presentation itself —
adapted to the canonical full page (canonical routes never become panels); (2) "View termsheet
in Documents" omitted — no documents module exists; provenance names the real source file
instead; (3) the panel-header spark omitted — no per-note valuation series exists; (4) LATEST
VALUATION and SETTLEMENT stats-grid fields omitted — no such fields exist on the payload (the
book-level prices-as-of lives in the monitoring footer, one as-of per surface); (5) the terms
grid is grouped into three labeled sections rather than one 12-field block (R4 requirement:
"logical Fable-native sections"); (6) the timeline's "Q1 2026 · termsheet executed" meta is
replaced by the real issue date.

**Security: nothing changed.** Verified at runtime against a dev server:
`/structured-notes/some-id` → 307 `/login?next=%2Fstructured-notes%2Fsome-id` (41-byte body,
ZERO structured-note content pre-auth); `/api/structured-notes/some-id` and
`.../allocations` → 401 JSON (27 bytes). `classifyPath` still reports
`private_page`/`private_api`; middleware, access policy, migrations, and every API route file
untouched.

Measured after this phase: **3570 tests, 3567 pass, 3 fail** (only the three pre-existing
date-dependent `tests/newsModule.test.ts` cases). Lint 0, build 0 errors (`○ /structured-notes`,
`ƒ /structured-notes/[id]` and all 8 SN API routes present), `git diff --check` clean. Manual
browser validation at 1728/1024/390 (light/dark, EN/ES, reduced motion) and the authenticated
functional walk (open a real note, verify against the dashboard row, allocation round-trip,
back navigation) are **pending** — no browser was connected and no session was available in the
implementing session; delete execution was intentionally not performed (no disposable record —
the endpoint/payload/confirm/redirect contract is locked by the R4.5 tests instead).

### R4.1 (2026-07-31) — shared Fable dialog replaces the browser-native confirm

**Inventory** (full-repo scan for `window.confirm/alert/prompt` + `globalThis.*`): exactly ONE
application-controlled native dialog existed in `src/` — the Structured Notes delete
`window.confirm(t.sn.confirmDelete)` on the detail page. No `window.alert`/`window.prompt`
anywhere. Browser/OS interfaces deliberately out of scope: the upload flow's native file
picker and the Company page's `window.print()`.

**Fix — adoption, not invention.** The shared system already existed unused:
`src/components/fable/ModalShell.tsx` exports `ModalShell` (the one Fable overlay shell —
labelled `role="dialog"`, `aria-modal`, focus trap + initial focus + restore-to-trigger,
Escape, scrim, body-scroll lock, pinned footer) and `DestructiveConfirm` (its
`role="alertdialog"` destructive mode: safe ChipButton cancel, `--critical-fill` confirm with
`aria-busy`, `dismissDisabled` while pending, and an at-most-once-per-open confirm guard),
both locked by `tests/fableR0Primitives.test.ts`. R4.1 makes the SN delete flow its first
consumer: the trigger button now only OPENS the dialog (`confirmingDelete` state); the dialog
description names the real record (`productName · ISIN`); the body carries the existing
`t.sn.confirmDelete` sentence, an sr-only `role="status"` deleting announcement, and the
`deleteError` line INSIDE the dialog (which stays open on failure for retry/cancel — the same
error also shows adjacent to the trigger once the dialog closes). The mutation is byte-identical:
same `DELETE /api/structured-notes/{id}`, success-only `router.push('/structured-notes')`.
Zero new i18n keys (title `sn.delete`, `sn.cancel`, `sn.confirmDelete`, `sn.deleting`,
`sn.deleteError` all pre-existed in EN + ES). Initial focus lands on the dialog's ✕ dismiss
control (the first focusable — a cancel-equivalent, so the destructive action is never the
accidental default). Guarded by the rewritten `R4.5` + new `R4.5b` describes, including a
recursive src-wide scan asserting no `window.confirm/alert/prompt`/`globalThis.*` call
survives anywhere. Suite 3570 → **3579** (3576 pass + the 3 permitted `newsModule` cases),
lint 0, build 0, `git diff --check` clean. Manual dialog validation (open/Escape/cancel/focus,
1728/1024/390, EN/ES, light/dark) remains **pending** — no browser connected; deletion still
intentionally not executed on any real note.

**Superseded by phases R1 and R2**, which delivered this scope under the normalized Stage 5R
program: the `(auth)` route group + `ShellGate` (R1), `/login` on the gateway (R1), and both
recovery pages as panel variants (R2). The original plan is kept below as the historical record.
Two items were deliberately resolved differently: public self-registration was **removed** in R1.5
rather than restyled, and `BrandLogo` was superseded by `NevadaMark` on the auth surface rather than
re-pointed (the component itself remains for any non-auth caller).

Do together, after shared components exist. The login is the marquee Fable moment and needs a
**new full-bleed shell** (no sidebar/topbar).

**Files**
- **New:** `src/app/(auth)/layout.tsx` (route group) *or* per-page full-bleed layout — so
  `/login`, `/forgot-password`, `/auth/reset-password` render the cinematic Fable shell WITHOUT
  `AppShell`'s sidebar/topbar. (Currently they inherit the app shell.) This requires moving the
  three auth pages under a route group, or introducing a shell-suppression mechanism. Verify
  middleware `matcher` and protected-route logic still behave (they key on pathname, not
  layout — safe).
- `src/app/login/page.tsx` — Fable login: Ken-Burns Santiago bg, cursor specular, deep-navy
  headline, utility chips (secure dot, EN|ES via `LangProvider`, Santiago clock, contrast via
  `ThemeToggle` mechanism), glass auth panel. **Keep the real flow:** `POST /api/auth/login|
  register`, username+password, sign-in⇄create toggle, `next` redirect, error mapping.
  **Exclude** Fable's simulated auth, demo-credentials chip, passkey (merge points 5, 6).
- `src/app/forgot-password/page.tsx`, `src/app/auth/reset-password/page.tsx` — glass auth-panel
  variants on the same shell; preserve no-enumeration + recovery-session behavior.
  *(Delivered in R2 from `src/app/(auth)/forgot-password/` and `src/app/(auth)/auth/reset-password/`
  — same public URLs.)*
- **New assets:** add the Santiago login photo to `public/` (from Fable
  `uploads/pasted-…png` / `sky-costanera.webp`).
- `src/components/ui/BrandLogo.tsx` + `public/` — **asset reconciliation**: Fable's logo is a
  cyan/blue SVG (`#1E5591`/`#23BAE8`); NMI ships navy raster (`/nevada-logo-*`). Decide the
  production mark (doc 05) and update `BrandLogo` accordingly (keep the theme-swap + graceful
  onError behavior).

**Guardrails:** `tests/authWatchlist.test.ts`, `tests/credentials.test.ts`,
`tests/passwordResetAndUpdateButton.test.ts`; manual sign-in/out + protected-route redirect
verification.

---

## Phase R5 — Fable Macro + Economic Calendar ✓ IMPLEMENTED (2026-07-31, automated validation complete, manual browser validation pending)

Baseline `b8272bd` (clean R4/R4.1 HEAD). `/macro` and `/macro/calendar` were already re-skinned in
Phase 5F; R5 is the fidelity-deepening pass that brings both routes into the R3/R4 family without
touching a single data semantic. **Fable references used:** `zip-export/SPECS.md` §7 Macro (Chile /
Global metric-row cards + "Upcoming releases" card + Santiago-times footer) and the standalone
export's Macro renderer (extracted at offsets ~2850700–2857600: 12.6px/600 metric name over a
10px source·timestamp·prev meta line, 54×20 accent-2 sparkline, 13.5px/650 latest, signed delta;
releases rows = 11px/700 accent-2 date · 12.3px title · 8.5px importance chip, HIGH=amber,
else neutral). Fable has **no dedicated calendar page** — `/macro/calendar` is composed from the
Fable system (releases-card anatomy + shared primitives), a documented adaptation, not an invention.

**What changed (4 files + i18n + tests):**
- `src/app/macro/page.tsx` — (1) `SectionHeader` → shared **`PageHeader`** (the 19px/650 baseline
  row every R-phase route opens with); the region-aware source subtitle moved into its metadata
  beside a **new always-visible `/macro/calendar` link** — before R5 the only in-page path to the
  calendar sat inside the US-only embed, so the Chile region had no link at all. (2) The
  hand-rolled chart-popup dialog → shared **`ModalShell`** (`dense`, `size="lg"`) per the R4.1
  shared-dialog rule — the page-local scrim/role/aria/Escape plumbing (and its `useEscape` import)
  deleted; the shell adds a real focus trap, initial focus, focus-restore-to-row and body-scroll
  lock the old markup never had. Title/description = the same series label + value/(change)/period;
  body = the same 1/3/5/10Y `SegmentedControl` + `LineChart`/`AsyncState` + per-series
  `DataSourceBadge` line. (3) The region chip → shared `ChipLabel`. Everything else — banded
  indicators table, category derivation from fetched `i.category`, Chile-rates overlay, yield
  curve precedence, Frankfurter FX table, US calendar embed, `macro:region`/`cmi.macroRegion`
  wiring, `useGlobalRefresh`, every badge/footer/async state — byte-identical.
- `src/app/macro/calendar/page.tsx` — `SectionHeader` → `PageHeader` (back link + honest scope
  sentence in the metadata row); the local `pill()` helper → `ChipLabel` (no-consensus, Chile
  deferred). FRED calendar card, FOMC outlook, Chile-deferred disclosure, both footers unchanged.
- `src/components/macro/EconomicCalendarTable.tsx` (shared by both routes) — the Fable
  releases-card anatomy: date cells now `text-accent-2` at weight 650 (the chronological anchor);
  the **color-only importance dot became a visible localized chip** (`impHigh/impMedium/impLow`,
  platform pill recipe `color-mix(in oklab, tone 12%, var(--surface))`, `title=t.cal.impTitle`
  noting the classification is app-assigned, not FRED-sourced) — an a11y fix (status no longer
  color-alone/hover-only). **Color mapping unchanged**: High keeps `--negative` (platform-wide
  High-impact signal, News-module consistency) — a documented departure from Fable's amber HIGH.
- `src/lib/i18n.ts` — 4 new `cal.*` keys ×2 dictionaries (`impHigh`, `impMedium`, `impLow`,
  `impTitle`).

**Departures from Fable (all documented):** (1) §7 per-row sparklines omitted — the only
synchronously-available per-row history is the static bundled series, which would silently pair a
static shape with a live latest value in one unlabeled glyph; history stays one click away in the
popup chart with a real per-source badge. (2) §7 "prev X" per-row previous value omitted —
`MacroIndicator` carries no previous field and deriving one from the change label is economically
unsafe; the signed-delta element is the existing Change column. (3) The Chile+Global simultaneous
two-card layout not adopted — NMI's region model (persisted `cmi.macroRegion` filter driven from
the shell's SecondaryNav, a standing CLAUDE.md rule) is functional authority; the banded dense
table remains the correct surface for 26 indicators under the governed density rule. (4) HIGH
importance stays `--negative`, not Fable amber (above). (5) "Times in America/Santiago" footer not
applicable — FRED release dates are date-only; no release times are fabricated. (6) The Macro ↔
Calendar route navigation is the shell's `SecondaryNav` pill rail (Indicators | Calendar, sliding
indicator, real links) — already the approved Fable tab anatomy — plus the new header-metadata
links; no duplicate in-page tab rail was added.

**Tests:** `tests/fableMacroPage.test.ts` (+5 R5 cases; 6 Phase 5F cases updated in place with R5
comments — header→PageHeader, popup→ModalShell, chip→ChipLabel, nv-pop/aria moved to the shell),
`tests/fableMacroCalendarPage.test.ts` (+5 R5 cases; 3 updated — header, importance chip, ChipLabel;
column-order probe disambiguated `t.cal.imp}` vs the new `impHigh` prefix),
`tests/fableMacroChartModalOpacity.test.ts` rewritten to target the shared shell (same 14-point
repair contract — dense ≥.92 alpha both themes, no backdrop-filter, scrim, token shape, Tier-5
consumers unchanged), `tests/fablePortfolioPage.test.ts` cross-check updated (`nv-surface-dense
nv-pop` → `<ModalShell`, a real phase boundary moving). Focused: 634/634. Full suite:
**3589 tests, 3586 pass, 3 fail** — only the three permitted date-dependent
`tests/newsModule.test.ts` cases. Lint 0, build 0 errors, `git diff --check` clean.

**Not changed:** every API route/payload, `MacroSeriesDef`/category registry, BCCh/FRED/Frankfurter/
Yahoo providers, yield-curve + FX + enrichment logic, FOMC outlook, Chile-deferred integrity rules,
R1.5 access control (`/macro` + `/macro/calendar` stay `private_page`), navigation model, and every
route outside R5 scope. Manual browser validation (1728/1024/390, EN/ES, light/dark,
reduced-motion) remains **pending** — no browser connected this session.

### R5.1 (2026-07-31) — relevance bar meter replaces the importance word chip

Controlled repair inside R5, applied to the relevance/importance display only. The R5 word chip
(`Alta`/`High` on the pill recipe) read as another text column in a table already dense with
words; relevance is an ordinal magnitude, so it now renders as a compact ascending **bar meter** —
the Bloomberg *idea* (bar count = relevance) expressed entirely in the Fable material system, with
none of Bloomberg's styling.

**Mapping (real levels only, no invented fourth):** the data model defines exactly three
(`fredReleaseAllowlist.ts`: `'High' | 'Medium' | 'Low'`) → **High 3 / Medium 2 / Low 1** filled of
3. Bars are 3px wide at 5/8/11px ascending heights, `gap-[2px]`, `rounded-xs` (the dense-radius
end of the scale, never a pill), inside a fixed `h-3` inline-flex box so row heights cannot shift.
Filled bars take the unchanged tone mapping (High `--negative`, Medium `--warning`, Low
`--muted-fg`); the unfilled track is `color-mix(in oklab, var(--muted-fg) 24%, transparent)` — one
token-derived recipe, both themes, no hex, no raw Tailwind scale, no motion. The Imp. column
narrowed `w-20` → `w-16`.

**Accessibility — count is the signal, colour is reinforcement.** The meter is a single
`role="img"` with a localized `aria-label` (`"Relevance: High"` / `"Relevancia: Alta"`), a `title`
appending the existing honesty note (classification assigned by this app, not sourced from FRED),
and `sr-only` localized text; the bars themselves are `aria-hidden`. One new key pair,
`cal.relevanceLabel` (EN `Relevance` / ES `Relevancia`); `impHigh`/`impMedium`/`impLow`/`impTitle`
are reused unchanged. Nothing else moved: chronological sort, Actual/Previous semantics, source
chips, footers, FOMC card, Chile-deferred disclosure, both routes' composition.

Files: `src/components/macro/EconomicCalendarTable.tsx` (shared by `/macro/calendar` and the Macro
embed), `src/lib/i18n.ts`, `tests/fableMacroCalendarPage.test.ts` (new R5.1 describe, 6 cases; 2 R5
cases updated). Focused calendar suites 320/320. Full suite **3595 · 3592 pass · 3 fail** (the three
permitted `newsModule` cases). Lint 0, build 0 errors, `git diff --check` clean. Manual browser
validation still **pending** — no browser connected.

### R5.2 (2026-07-31) — actual/previous enrichment repair: FRED's keyless CSV transport died

**Symptom.** `/api/macro/fred-release-calendar` returned `ok: true, configured: true,
enriched: true` with the full event schedule, but EVERY metric — CPI, PPI, PCE, Employment
Situation, Retail Sales, Industrial Production, Housing Starts, GDP, FOMC — reported
`actual: null, previous: null, status: "unavailable"`. Schedule layer healthy, value layer dead.

**Root cause (diagnosed, not guessed).** The two layers use DIFFERENT FRED hosts. Release dates
come from the keyed `api.stlouisfed.org` (`fredReleaseCalendarClient.ts`); values come from the
keyless CSV graph endpoint `fred.stlouisfed.org/graph/fredgraph.csv` (`fredClient.ts`). That CSV
endpoint has **stopped serving programmatic requests**: every request stalls until the caller's
timeout. Verified live, series by series — all 13 enrichment series plus both FOMC target-range
series failed identically (15s timeout / one HTTP 504), and reproduced outside the app from two
independent clients (curl and Node `fetch`) under three User-Agents including a full browser one:
**HTTP status 000, 0 bytes, 40s**. Not a local network fault: the same machine reached Frankfurter,
Yahoo Finance and example.com with HTTP 200, DNS resolved FRED normally, and TCP:443 to FRED's own
edge connected. This is the Phase 8D failure mode ("FRED's edge appears to silently stall such
requests", then Vercel-only) now applying everywhere. Because `fetchFredSeries` was the single
transport behind every metric, one dead endpoint blanked the whole value layer — nothing was wrong
with the mappings, period matching, transforms, or the enrichment logic.

**Repair — same source, working transport.** `fetchFredSeries` now prefers FRED's official **keyed
JSON observations API** (`api.stlouisfed.org/fred/series/observations`) when the server-only
`FRED_API_KEY` is set — the same host and key the release calendar already uses, verified live
returning real current data for all 15 series in ~300ms each. The keyless CSV endpoint is retained
as (a) the zero-env-var path, so the standing "must build and run with no env vars" rule is intact,
and (b) the fallback if a keyed request fails, so a key problem degrades to the old behaviour
rather than removing a source. New `parseFredObservations` normalizes the JSON payload to the exact
`FredSeriesPoint[]` the CSV parser produces (`"."` → null, genuine 0 stays 0), and both transports
share one `toSeriesResult` builder so they can never disagree on what counts as a usable series.
The key is sent as a query parameter (FRED accepts no other form) but never logged and never placed
in a failure `reason` — reasons carry only the HTTP status. No new vendor, no scraping, no
consensus, no synthetic values. This also restores US macro indicators/history and the yield curve,
which share the same client.

**Status semantics.** `EnrichedMetric` gained an optional `unavailableReason`
(`source-unavailable` | `source-error` | `period-not-found`) so an outage is no longer
indistinguishable from a genuinely unmapped release. Additive and diagnostic-only — the three
public statuses, the API contract, and the UI are unchanged.

**Verified end to end against real FRED data** (`resolveFredReleaseCalendarRange('2026-07-01',
'2026-07-31')` → `resolveCalendarEnrichment`): 13 events, **16/16 metrics published, 0 unavailable**,
across all four agencies (BLS 6 · BEA 4 · Census 4 · Federal Reserve 2) and both frequencies —
NFP +57K (level-diff, never the ~159,000 raw level) with previous +129K; Unemployment 4.2% (prev
4.3%); CPI y/y 3.46% and m/m −0.42%; PPI y/y 5.51%; Retail Sales m/m 0.22%; Industrial Production
m/m 0.08%; Housing Starts 1,427K; Trade Balance −77,585 (a real negative, not a zero); GDP q/q SAAR
1.5% on **quarterly** periods (2026-04-01 vs 2026-01-01); PCE y/y 3.67% and Core PCE 3.29%; and the
FOMC band as a RANGE, `3.50%–3.75%`, never a fabricated midpoint. Forward window (60 days): 31
events, 31 pending with real previous values, `actual` null, chronology intact, 0 unavailable.
Consensus null everywhere.

**Cache.** No stale-unavailable retention is possible: the route is `force-dynamic`, both transports
send `cache: 'no-store'`, and the series map is built per call with no module-scope cache — all three
now locked by tests.

**Still unavailable, by design:** ADP (its FRED series `NPPTTL` is stale since 2022) and Existing
Home Sales (NAR, not a government agency) remain deliberately unmapped and render dates-only rather
than a stale or fabricated number.

Files: `src/lib/providers/fredClient.ts`, `src/lib/providers/calendarEnrichment.ts`,
`tests/calendarEnrichmentRepair.test.ts` (new, 42 cases, fully mocked — no live network in
automated tests). Focused suites 672/672. Full suite **3637 · 3634 pass · 3 fail** (the three
permitted `newsModule` cases). Lint 0, build 0 errors, `git diff --check` clean.

**Limitations.** Values are current-vintage prints, not original release vintages — unchanged,
pre-existing methodology (FRED's `realtime_*` vintage parameters are not used). The shared `yearAgo`
helper picks the nearest available base, which equals the true same-month-a-year-earlier base only
because the enrichment window requests ~3 years; noted rather than changed, since `transforms.ts` is
shared with every macro indicator and altering it is outside this repair. Manual browser validation
of `/macro/calendar` remains **pending** — no browser connected; the authenticated API walk could
not be performed (no session credentials available to this session), so the identical server-side
resolver + enrichment path was exercised directly instead, against live FRED.

---

## Phase R6 — Fable Compare analytical workspace ✓ IMPLEMENTED (2026-07-31, automated validation complete, manual browser validation pending)

Baseline `9282c54` (clean, pushed R5 HEAD). `/compare` was already re-skinned onto the Fable
foundation in Phase 5D (TableCard ×3, GlassSurface, SegmentedControl, Reveal, tokenised hover,
chip material); R6 is the fidelity-deepening pass that brings the route into the R3/R4/R5 family
and closes real workflow/a11y gaps — without touching any data, calculation, API, timeframe,
normalization, or persisted-state semantic.

**Fable references used — and the key finding:** `zip-export/SPECS.md` contains **no Compare
section** (its 11 sections are Login/Overview/Portfolio/Performance/Risk/Fixed Income/Structured
Notes/Macro/Research/Documents/Admin), and the standalone export has **no Compare renderer** — the
only "Compare"/"versus" hits in the 2.95MB HTML are `localeCompare` inside the **§2 Portfolio
table sorter** (offset ~2932474) and the **§1/§3 Performance chart aria-label** (~2781165). Both
were extracted and inspected. The binding route-adjacent authorities are therefore §2 Portfolio
("the table IS the page": dense near-opaque sortable table, filter capsules, name+id identity,
`N of M holdings` count), §3 Performance (chart card + sign/magnitude-tinted grid + attribution
bars), §1 Row B (multi-series chart interactions, legend toggles, crosshair tooltip) and the
Overlays spec — all already encoded in the shared primitives. The composition is documented
adaptation from those patterns, never invention.

**What changed (2 files + i18n + tests + docs):**
- `src/app/compare/page.tsx` —
  (1) `SectionHeader` → shared **`PageHeader`**; metadata = subtitle + a live **selection count**
  (`{valids.length}/6 selected` — the Fable Portfolio "N of M holdings" pattern); actions =
  the platform-wide UpdateDataButton, unchanged.
  (2) The page-local Settings dialog → the one shared **`ModalShell`** (R4.1 dialog rule; R5
  precedent). The raw `nv-scrim`/`nv-glass-overlay`/`role="dialog"`/`useEscape` plumbing is
  deleted; the shell adds a real focus trap, initial focus, focus-restore-to-trigger and
  body-scroll lock the old markup never had. Every control inside (Difference-vs, 6× series
  colors with 10 swatches + native picker, legend/gridlines/thickness, highlight toggle, Reset,
  Done) is unchanged; the two selects became shared **`ChipSelect`**, the ⚙/⤓ hand-rolled chip
  buttons became shared **`ChipButton`**.
  (3) **Subject identity + canonical routes** (a real gap: the page had *no* link to any company
  page): the Market Data identity cell now links the ticker to `/companies/[ticker]` with the
  company's real `shortName` beneath (truncated so long names never distort — Fable Portfolio
  name+id anatomy), and each Fundamentals subject header links the same canonical route.
  (4) **Per-slot clear affordance**: each filled slot gains a touch-usable ✕ that rides the exact
  pre-existing remove pathway (`setSlot(i, '')`), localized aria-label per slot; it can only ever
  clear its own slot. No parallel remove mechanism was introduced.
  (5) **Best/worst emphasis is no longer color-only**: the direction-aware ranking (unchanged
  logic — `dir 0` ambiguous rows never ranked, nulls excluded before min/max, needs ≥2 values)
  now also emits `title` + `sr-only` text (`bestInGroup`/`worstInGroup`); the raw value stays
  visible; the toggle still disables it.
  (6) **Total Return magnitude bars** (Fable §1 Attribution contributor/detractor bars): a 3px
  track under the printed % — length = |return| scaled to the group max, tone by sign
  (`--positive`/`--negative`), `aria-hidden` (the signed printed value stays authoritative), and
  a null return draws no bar (never coerced to zero). Sign-based tone, not winner/loser styling.
- `src/components/charts/CompareChart.tsx` — the one pre-existing hardcoded English literal
  (`title="Click to highlight"` on legend items) localized via `t.compare.legendHint`. No other
  chart change: rebased-to-0% normalization, series building, tooltip, axes, legend isolation,
  a11y summary all byte-identical.
- `src/lib/i18n.ts` — 5 new `compare.*` keys ×2 dictionaries: `selectedCount`, `removeSecurity`,
  `bestInGroup`, `worstInGroup`, `legendHint`.

**Deliberate omissions (all restraint rules from the R6 brief):** (1) No KPI-capsule overview —
the Market Data table already IS the compact decision-oriented overview (price, 1D/5D/1M/YTD/1Y,
market cap, sector); capsules would duplicate identical values with no analytical reason. (2) No
tab/section navigation — the Fable export has no tabbed analytical page; its model is §2's
single-surface "the table IS the page", and tabs would hide co-visible real data. (3) No per-row
sparklines in Market Data — they would duplicate the main chart's real history at worse fidelity
(and R5 already documented the static-shape-next-to-live-value hazard). (4) No sorting added to
any Compare table — current functionality has none; the brief permits sorting only where it
exists. (5) No clear-all control — not in current behavior. (6) No scatter/small-multiples/
distribution charts — the analytical questions this route answers (performance over time,
cross-sectional fundamentals) are already served by the correct chart types; adding chart types
merely because Fable contains them is prohibited. (7) Table orientation kept: **metrics as rows ×
subjects as columns** with sticky metric column + sticky subject headers — already the brief's
preferred structure; no orientation flip needed. (8) Selection state stays in `localStorage`
(`cmi.compare*`), not the URL — the existing state semantic (refresh-persistent, not
URL-encoded); introducing a URL-state system is out of scope and the no-new-query-state guard
still passes.

**Data integrity:** all 12 fundamentals getters, the perfCell null handling, `fmtX`/`fmtPctCell`
rounding, derived-field `•` markers, footer source-precedence ternaries, badge logic,
`historyAccumulating` note, return math (`totalAndAnnual`/`tfStart`), TF/Period/custom-range
wiring, and the `/api/compare` + `/api/compare/history` fetch effects are byte-identical. Zero
and negatives stay distinct from unavailable everywhere (guarded); nothing new fetches, sorts,
smooths, interpolates, or forecasts.

**Tests:** `tests/fableComparePage.test.ts` — 9 Phase 5D cases updated in place with documented
R6 comments (header→PageHeader, dialog→ModalShell ×4, chip primitives, focus-ring count,
clear-affordance, i18n keys) + a new **Phase R6** block (12 cases across composition, canonical
routes/identity, and data-honest enhancement rules: nulls never ranked/drawn, `dir 0` never
styled, tint never the sole channel, raw value always visible, no native dialogs, no new route,
no sort introduced). `tests/fableMacroChartModalOpacity.test.ts` item 14 updated — compare left
the raw-overlay-consumer list for `<ModalShell` (a real phase boundary moving). Focused: 255/255
(compare suites) + 1147/1147 (cross-check suites). Lint 0, build 0 errors, `git diff --check`
clean.

**Not changed:** every API route/payload (`/api/compare`, `/api/compare/history`, valuation
resolvers), `resolveCompareData`/`resolveCompareHistory`/`compareTypes`, return/normalization
math, all 11 `cmi.compare*` persisted keys, duplicate prevention (Set, first-occurrence wins),
the 6-slot cap, datalist search, CSV export contents, source badges/footers/as-of derivations,
R1.5 access control (`/compare` stays `private_page`; unauthenticated page → login redirect, API
→ 401), and every route outside `/compare`. Manual browser validation (1728/1024/390, EN/ES,
light/dark, reduced-motion) remains **pending** — no browser connected this session.

### R6.1 (2026-07-31) — Compare static-path and API restoration repair

Both Compare APIs were returning **HTTP 500** with
`TypeError: The "path" argument must be of type string or an instance of URL. Received an instance of
URL` thrown from `fileURLToPath` in `src/lib/compare/compareStatic.ts`. The throw happened at MODULE
EVALUATION — before `resolveCompareData`, `resolveCompareHistory`, Yahoo, persisted fundamentals, or
history resolution ran — so each route's own `try`/`catch` (which degrades a *resolver* failure to a
200 envelope) could never catch it. The browser therefore rendered unavailable Market Data and
Fundamentals and fell back to Static-sample returns.

**Failing expression:** `fileURLToPath(new URL('../../data/companies.json', import.meta.url))`
(and the `stockPrices.json` twin).

**Root cause — confirmed empirically against webpack's own emitted output, not assumed.** Webpack
rewrites *both halves* of that expression:

1. `new URL(...)` → `new __webpack_require__.U(...)`. Read verbatim from the emitted
   `.next/server/webpack-runtime.js`, that helper builds a fake URL and sets
   `c.origin = c.protocol = ""`, then does `g.U.prototype = URL.prototype`. Node's `fileURLToPath`
   brand-checks by DUCK TYPING (`href && protocol && auth === undefined && path === undefined`), so
   the **falsy protocol fails the guard** — while the borrowed prototype makes Node's error formatter
   print the constructor name `URL`, producing the self-contradictory "must be … an instance of URL.
   Received an instance of URL". Executing that verbatim helper reproduces the production message
   byte-for-byte.
2. The JSON literal → an **asset module**: `module.exports = __webpack_require__.p +
   "static/media/companies.28369a33.json"` with `p = "/_next/"`. So the value is a public web path,
   not a filesystem path. Passing the string form (`.href`) therefore only moves the failure to
   `TypeError: Invalid URL` — verified by execution. **A `.href` tweak alone is not a sufficient
   repair under webpack.**

The compiled pre-fix expression was captured from a real webpack build as
`(0,e.fileURLToPath)(new c.U(c(99132)))`. **Turbopack is unaffected**: its build emits a native
`new URL(e.R(72373)).href` against a real `/server/assets/...` file URL, which is why production and
`npm run dev` (Turbopack) never showed this — the reported failure can only originate from webpack.

**Repair architecture.** `compareStatic.ts` no longer resolves a path at all:

```ts
import companiesJson  from '../../data/companies.json'  with { type: 'json' }
import stockPricesJson from '../../data/stockPrices.json' with { type: 'json' }
export const STATIC_COMPANIES = companiesJson  as StaticCompany[]
export const STATIC_SNAPSHOTS = stockPricesJson as StaticStockSnapshot[]
```

There is nothing left for a bundler to rewrite: webpack and Turbopack both inline the data, Node's
native test runner reads it directly via the `with { type: 'json' }` attribute (without the attribute
Node throws `ERR_IMPORT_ATTRIBUTE_MISSING` — the exact reason this file originally used `fs` +
`import.meta.url`), and Vercel's file tracer has nothing to trace, which also permanently retires the
ENOENT-on-Vercel hazard the old `new URL('<literal>', …)` comment existed to warn about. No
`process.cwd()`, no hardcoded path, no `file://` stripping, no drive-letter slicing, no duplicated or
relocated data file, no swallowed error, no fake-success response.

**Cross-platform behaviour:** module-loader resolution, so no drive letter, separator, or
percent-decoding semantics remain to diverge between Windows and Linux/Vercel; a guard test asserts the
file consults no path/platform API at all.

**Sibling helpers.** Four other files carried the identical expression
(`news/tickerMapping.ts`, `financials/csvFinancials.ts`, `db/repositories/portfolioRepository.ts`,
`db/repositories/portfolioTransactionRepository.ts`). They back `/api/news` and `/api/portfolios`, are
outside the reported Compare outage, and work under Turbopack (the production runtime), so they were
**hardened to the string form (`.href`)** — which fixes the brand-check half of the bug at zero risk —
rather than restructured. Their webpack asset-path limitation is recorded under Limitations below.

**Evidence.**
- *Before, webpack build:* compiled to `(0,e.fileURLToPath)(new c.U(c(99132)))`; executing webpack's
  verbatim `U` helper on its verbatim asset value reproduces the exact production TypeError, and the
  `.href` variant fails with `Invalid URL`.
- *After, webpack build:* the Compare route bundles and their chunks contain **no `fileURLToPath` and
  no `static/media/companies`** reference at all. Force-evaluating the compiled `compareStatic` module
  (id 59852, chunk 6094) through the real `webpack-runtime.js` returns live objects:
  `COMPANY_BY_TICKER` 25 entries, `SNAPSHOT_BY_TICKER` 25 entries, `BSANTANDER → Santander Chile |
  Banking`, `SQM-B → SQM | Mining`, `FALABELLA → Falabella | Retail`, `SQM-B price=63851 CLP`.
- *Turbopack build:* `✓ Compiled successfully`, exit 0, `/compare`, `/api/compare` and
  `/api/compare/history` all emitted.
- *Webpack dev and Turbopack dev:* both boot clean; `/api/compare` and `/api/compare/history` return
  **JSON** `401 {"error":"unauthenticated"}` (not an HTML Next.js error document) and `/compare`
  returns `307 → /login?next=%2Fcompare`, so R1.5 is unchanged in both runtimes.

**Tests:** `tests/compareStaticPathResolution.test.ts` (new, 30 cases, fully deterministic — no live
Supabase/Yahoo/network): webpack's verbatim shim reproduction, proof that the string form alone is
insufficient, the no-path-resolution invariant, byte-identical imported data, platform independence,
the required import attribute, no-forbidden-shortcut scans across all five sites, both routes' query
contracts and auth classification, provider-failure-vs-path-failure separation, Market Data /
Fundamentals / History population from mocked inputs, zero-vs-null and negative-vs-null distinctions,
source-label preservation, and scope guards (R6 UI untouched, no route file resolves a path, no native
dialog).

**Limitations.** (1) The authenticated API walk could not be performed — no session credentials are
available to this session and creating an account or entering a password is prohibited; middleware
short-circuits before the route module compiles, so HTTP cannot reach it unauthenticated. The
force-evaluation of the real webpack-compiled module (above) is the equivalent proof. (2) Manual UI
validation at 1728/390 was not performed — no browser is connected. (3) `npm run build -- --webpack`
compiles successfully but then fails type-checking on a **pre-existing, unrelated** constraint: the
webpack build emits `.next/types/app/**` page-type guards that reject the R3 test-visibility exports
(`fmtPct`, `fmtNum`, …) from `src/app/structured-notes/page.tsx`. Not conflated with this repair;
the Turbopack build (the project's actual build and deploy path) is clean. (4) `/api/news` and
`/api/portfolios` retain the webpack asset-path limitation described above; migrating them to JSON
imports would also require updating the standing CLAUDE.md rule that mandates `fs.readFileSync` +
`import.meta.url` for JSON data (written before import attributes were available) and is left as
documented follow-on work outside this brief's scope.

### R6.2 (2026-07-31) — short-term returns, data freshness, and analytical hierarchy

Three reported defects on `/compare`: every security showed **1D and 5D at exactly +0.00%**, the
Market Data as-of ran several days stale, and the chart sat *below* the returns table with no
indication of which window the table's figures used.

**Root cause — the data, not the arithmetic.** Diagnosed against the live provider on 2026-07-31
(no assumption; the raw responses were inspected):

1. **Carried-forward filler bars.** Yahoo's daily chart for Santiago-listed tickers publishes
   placeholder sessions that repeat the last real close with `volume: 0`. On 2026-07-31 that was
   **2026-07-20 … 2026-07-30 on every tracked ticker** (BSANTANDER 77, CHILE 188.5, FALABELLA 5835,
   CENCOSUD 1995 — the genuine last session was 07-17). Comparing "latest bar vs previous bar"
   therefore compared a filler against a filler: exactly 0.00%, for every security, in both windows.
   1M/YTD/1Y were unaffected because their windows reach back past the filler region.
2. **`period2` is exclusive.** The live chart request ended at `to = today`, and Yahoo treats
   `period2` as exclusive, so the genuine current session was never fetched — a request ending
   "today" returned bars only through 07-30 while a real 07-31 bar existed. This is the stale as-of.
3. **1D never consulted the quote.** The quote endpoint was healthy throughout (`marketState:
   REGULAR`, real day high/low and volume, CHILE 192.82 against a 196.8 previous close = −2.02%),
   and its `regularMarketPreviousClose` did not match *any* chart bar — so the chart could not have
   produced a correct 1D even without the fillers.

**Formulas.** 1D = `latest valid price / previous trading-session close − 1`, taking the quote's own
`price` / `previousClose` pair when present (same snapshot as the displayed price, so the two can
never disagree), else the two most recent genuine sessions. 5D = `latest valid price / close five
TRADING sessions earlier − 1`. Sessions are counted, never calendar days; fewer than two valid
observations yields a null 1D, fewer than six a null 5D — never a zero.

**Trading-session selection** (`src/lib/market/shortTermReturns.ts`, pure): normalize (drop
non-finite closes, dedupe by date with the last print winning, sort ascending) → strip fillers →
merge the quote as the latest session (superseding a same-dated bar, appending when newer). Filler
removal is deliberately conservative: a bar is dropped only when it BOTH reports `volume === 0` AND
repeats the previous retained close, so `volume: null` ("not reported") and any zero-volume bar whose
close moved are always kept.

**Search buffer.** 1D and 5D share ONE `1M` fetch. This is a search buffer, not the measured window
(the same technique the 1D path already used with a 5D buffer): after filler removal a 5-day request
yielded *zero* genuine sessions for these tickers, while the 1M request yields ~15. `fiveDayReturn`
still measures exactly five sessions.

**As-of convention.** Each row's `latestSnapshotDate` is now its own quote observation date
(`priceAsOf`), falling back to the persisted-snapshot date only when there is no live quote; the
surface-level as-of is the **newest** row's date. A genuinely stale subject therefore keeps its own
real date and stays in the comparison rather than being hidden behind one blended figure or dropped.
Market cap, price and 1D all derive from the same quote snapshot. Fundamentals are untouched and
keep their real reporting periods — the same-date rule applies to market-price data only.

**Page order** (D): PageHeader → **subject-selection rail** (the six slot inputs moved out of the
returns table, so selection precedes the window controls) → timeframe/period/range controls →
**Cumulative Return chart** → Comparative Returns → Fundamentals → Market Data. Documented
deviation: Market Data sits after the Returns/Fundamentals grid rather than between them, so the two
matrix tables keep their existing side-by-side `xl` composition; all four mandatory rules hold
(controls immediately before the chart, chart before the returns table, table states its timeframe,
chart and table share one window). The controls exist exactly once.

**Timeframe synchronization.** A single `tfLabel` — `usingCustom ? `${cStart} → ${cEnd}` : tf` —
feeds both the chart heading (`Cumulative Return · Rebased to 0% · 1Y`) and the returns-table title
(`Comparative Returns · 1Y`). Total Return, Difference and Annualized all come from `rowData`, built
from the same `start`/`end` the chart series uses, so table and chart cannot describe different
windows. 1M/YTD/1Y keep their existing `classifyPerformance` definition; normalization, custom-range
behaviour, annualization and the reference-subject logic are unchanged.

**Live evidence** (2026-07-31, all four requested subjects, real provider): BSANTANDER 1D −0.52% /
5D +1.62%; CHILE 1D −2.18% / 5D +1.92%; FALABELLA 1D −0.33% / 5D +4.99%; CENCOSUD 1D +0.25% /
5D −4.66%. Every 1D matches its quote's price-vs-previous-close exactly; 5D bases resolve to
2026-07-10 (five genuine sessions back, skipping the filler run); 1M/YTD/1Y unchanged and sane
(e.g. CENCOSUD YTD −33.45%); as-of **2026-07-31** on every row, equal to the current date.

**Files:** `src/lib/market/shortTermReturns.ts` (new, pure), `src/lib/market/marketHistory.ts`
(exclusive-`period2` compensation), `src/lib/providers/market/yahooHistoryProvider.ts` (filler
removal), `src/lib/providers/market/yahooRatiosProvider.ts` (additive `previousClose`/`priceAsOf`),
`src/lib/compare/resolveCompareData.ts` (short-term wiring + row/surface as-of),
`src/app/compare/page.tsx` (hierarchy + timeframe labelling + selection rail), `src/lib/i18n.ts`
(3 keys ×2). API response shapes are unchanged — the new diagnostics live in the pure module, not the
wire types.

**Tests:** `tests/compareShortTermReturns.test.ts` (new, 39 cases, fully deterministic): both
formulas, weekend/holiday/filler gaps never yielding zero, conservative filler removal, null-vs-zero
and negative-vs-null semantics, ordering/dedupe/invalid-observation hygiene, quote-merge rules,
exclusive-`period2` range, as-of and price-basis wiring, 1M/YTD/1Y preservation, the full hierarchy
contract, and scope/security/i18n/theme guards. Four `fableComparePage` guards and three
`marketSnapshotHistory` range guards were updated in place with documented reasoning (real behaviour
moving, not weakened assertions), plus `stockHistoryChartIntegrity` 7c for the new trim expression.
Focused 758/758. Full suite **3724 · 3721 pass · 3 fail** (the permitted `newsModule` cases).
Lint 0, build exit 0, `git diff --check` clean.

**Limitations.** (1) The authenticated API walk and manual UI validation were **not performed** — no
session credentials (creating an account or entering a password is prohibited) and no browser
connected; the identical server-side provider + return path was exercised directly against live data
instead, as recorded above. (2) 5D spans more calendar days than five when the provider fills the
interval with placeholders (07-10 → 07-31 here). That is the brief's definition — five *trading
sessions* — and both endpoint dates are returned so the window is disclosable, but it is not a
five-calendar-day figure. (3) Filler detection depends on the provider reporting `volume: 0`; a
carried-forward bar published with non-zero or absent volume would still be counted as a session.

---

## Phase R7.1A — targeted mobile shell + Structured Notes responsive repair ✓ IMPLEMENTED (2026-08-03, automated validation complete, manual browser validation pending)

Triggered by the R7 no-code approval gate, which confirmed four mobile defects with screenshots
(390 × 844). Visual geometry / responsive composition only — no calculation, API, schema, auth, or
structured-note business-logic change; the proposed custody/guarantor exposure chart was NOT added.

**Defect 1 — mobile search collided with the Nevada logo.** Root cause: the TopBar's left flex
group (`min-w-0 grow basis-0`) contained the hamburger and the brand as `shrink-0` children. The
group's `min-w-0` let the flex line treat it as zero-width — so `flex-wrap` never triggered — while
its unshrinkable children visually overflowed the group box to the right, underneath the utility
cluster painted later in DOM order: the collapsed search chip landed on the logo. Repair: three
independent top-level slots — (1) protected `shrink-0` slot (nav trigger + brand, min-content always
respected), (2) the only squeezable slot (`shrink min-w-0 grow basis-0`, breadcrumb + truncating
title — doubling as the guaranteed clear area around the mark), (3) `shrink-0 ml-auto` utility
cluster. With the line's min-content honest again, genuine overflow (extreme font scaling) wraps the
utilities to a second header row instead of overlapping. Compaction so one row fits 320 px at
default scaling: search becomes a `w-9` icon-only square below `md` (accessible name via
`aria-label`, glyph `aria-hidden`); ThemeToggle segments become icon-only below `sm` (labels
`hidden sm:inline`; both segments stay rendered, `aria-pressed`, `aria-label` + `title` — never a
text-only reduction); Theme/Lang segment padding `px-1.5 sm:px-2.5`. The hamburger's `-ml-1`
optical nudge was dropped — the header now contains no negative margin, no absolute positioning,
no z-index.

**Defect 2 — drawer username clipped/contaminated.** Root cause: a one-line `truncate` strip
squeezed under the drawer header, on the old translucent surface (defect 4) that let page text show
through it. Repair: the strip is gone; a dedicated identity section at the drawer foot carries an
eyebrow label (`t.auth.signedInAs`, new EN/ES key), the username allowed to wrap to two lines
(`break-words line-clamp-2`, full value always on `title`), and sign-out as a visually distinct
chip on its own row. The divider is the section's top border only — it never crosses text.

**Defect 3 — allocation legend overflowed the card.** Root cause: the Allocation-by-entity donut
card (`/structured-notes`) kept `donut (w-44, shrink-0) + legend (flex-1)` side by side at every
card width. In the wrapping two-up exposure row a card is ~340 px wide at tablet widths, so the
legend was squeezed to ~120 px while each row's `whitespace-nowrap` value span is ~200 px — the
amounts escaped the card boundary, and the spill surfaced a scrollbar inside the app shell
(`<main>` is `overflow-y-auto`, which computes the unspecified `overflow-x` to `auto`). Repair:
**container-query composition** (first Tailwind v4 native `@container` use in the codebase — the
card is ~340 px at tablet but ~590 px on a phone in the single-column stack, so no viewport
breakpoint can express this). Base styles = donut stacked above a full-width legend (the safe
degradation for engines without container-query support); side-by-side returns only from `@lg`
(32 rem of the card's own width), which preserves the effective desktop composition and also fixes
the previously-broken tablet case. Legend rows now `flex-wrap`: the entity name is the flexible
truncating part (full identity via `title`); the numeric block is two atomic `whitespace-nowrap`
units — `12,3% of total` and `· USD 1.234.567` — right-aligned (`justify-end`, `ui-number` tabular
numerals, formatting/precision unchanged) that drop to a right-aligned second line when the row is
too narrow. No value can leave the card; no nested scroll container exists; card height grows
naturally. Chart data, percentages, gapped segments, center total, and hover linking are unchanged.

**Defect 4 — drawer (and shared overlays) too transparent.** Root cause: the Tier-5
`.nv-glass-overlay` blurred fill reused the in-flow `--nv-card` gradient (.75–.9 alpha light,
.58–.72 dark) — tuned for cards sitting IN the page, not for surfaces covering live analytical
content; underlying headings/values stayed legible through the open drawer and dialogs. Repair
(shared-token fix, §C audit): new `--nv-overlay-fill` in both themes (light .97/.94, dark .97/.95 —
all stops ≥ the §8 .92 dense floor), consumed by `.nv-glass-overlay` in the `@supports` block; blur
30 px + saturation + border + shadow retained, so the Liquid Glass identity survives in the ≤ 6 %
translucency. Every Tier-5 consumer (nav drawer, ModalShell, DetailPanel, NotificationBell panel,
CommandPalette, chart-builder settings) is corrected by the one token — no per-overlay redesign.
The shared scrim was raised .38 → .45 (light) and .48 → .56 (dark) so the backdrop clearly
suppresses the page; its 3 px blur is unchanged. The z-index layering scale is now documented in
`globals.css` beside the Tier-5 rule (sticky chrome 10/20 · drawer 80 · dialogs/panels 90 ·
palette 100 · header un-z-indexed) — audited consistent across all overlay components; no value
changed.

**Files.** `globals.css` (tokens + Tier-5 fill + scrim + layering doc), `TopBar.tsx`,
`ThemeToggle.tsx`, `LangToggle.tsx`, `MobileNavDrawer.tsx`, `structured-notes/page.tsx` (Donut
only), `i18n.ts` (`auth.signedInAs` EN/ES), tests (below), docs 04 + 06.

**Tests.** New `tests/mobileShellResponsiveRepair.test.ts` — 25 cases mapping 1:1 onto the brief's
§G items (slot independence, non-overlap geometry, protected mark, 320-px compaction proxy,
overlay-fill ≥ .92 both themes, scrim suppression, layering scale, identity container, focus
trap/Escape/restore/scroll-lock, ModalShell contract, stacked composition, full-width legend,
no-overflow numeric structure, no nested scroll, desktop preservation, unchanged chart data, no
mock data, no API/schema reference, no native dialogs, EN/ES complete, token-driven themes, no
weakened overflow rule). `fableFoundation.test.ts` gained `--nv-overlay-fill` in the theme-parity
list (additive). No existing assertion was weakened; all existing shell/notes suites pass
unmodified apart from that additive line.

**Validation status.** Focused suites (mobileShellResponsiveRepair, topNavigation,
fableR0Primitives, responsiveLayout, fableFoundation, fableStructuredNotesPage,
fableMacroChartModalOpacity, fableComponents, all Fable page suites): green. The §E viewport
matrix (320/360/390/430/768/1024/1728 × EN/ES × light/dark) and §I screenshot evidence could
**not** be captured — no browser is connected to this environment (verified via the browser
extension: not connected) and the protected routes additionally require a session whose
credentials Claude cannot enter. The geometry contracts are locked by the source-scan suite above;
in-browser confirmation remains pending, as it has for every Fable round in this environment.

**Limitations.** (1) Manual browser/viewport/theme matrix pending (above). (2) The 320-px
"fits in one row" claim is a computed min-content budget (≈ 292 px vs the 296 px content box at
default font scale), not a rendered measurement; under browser font scaling the header wraps to a
second row by design rather than overflowing. (3) Container queries require a 2023+ engine; the
declared base composition (stacked) is the fallback, so older engines degrade to the mobile-safe
layout, never the overflowing one. (4) `--nv-overlay-fill` intentionally makes ALL Tier-5 overlays
near-opaque; if a future overlay genuinely wants the old in-flow card translucency it must use the
card tier, not lower the overlay token.

---

## Phase R7.1B — custodian exposure, notional semantics, delete controls ✓ IMPLEMENTED (2026-08-03, automated validation complete, manual browser validation pending)

Portfolio-accounting repair on top of R7.1A. No visual redesign, no guarantor analysis, no guarantor
fields, no custodian inference from any document.

**Custodian — business definition and storage.** Custodian is the institution holding Nevada's
position/account. It is a PORTFOLIO fact, not a product term: an issuer's term sheet does not state
who Nevada banks with, so it can only be user-entered. It is explicitly never derived from the
issuer, dealer, distributor, calculation agent, paying agent, clearing system (Euroclear/Clearstream
are settlement infrastructure, not a custodian), ISIN prefix, document sender, file name, or
financial-group parent — asserted by test.

**Custodian is stored on the NOTE (R7.1B.1 correction).** The first implementation put custody on
each account allocation, following the brief's default. The desk then corrected the business fact:
**every account allocation of a note is traded through the same custodian** — the accounts are
traded together — and the custodian varies from note to note, not between accounts within a note.
Per-allocation storage was therefore the wrong shape: it invited three copies of one fact that could
drift apart, and asked the user to type the same institution three times. Custody now lives in one
place, `structured_notes.custodian`, captured by ONE field on the note.

**Migration `20260803000000_structured_notes_custodian.sql`** (forward-only, re-runnable, additive):
adds the nullable column, plus column comments recording the rule. It follows the current CLI
workflow convention (`supabase db push`), not the older SQL-Editor paste. The superseded
`structured_note_allocations.custodian` column is deliberately **not dropped** — dropping is
destructive, this project's migrations are additive, and the column holds no data (all 27 allocation
rows are NULL, because the field was never capturable). Nothing reads or writes it any more.
Pending-migration behavior is graceful: reads use `select('*')`, so a missing column yields
`undefined`, `mapNote` coerces it to `null`, and every note simply classifies "Custodian
unavailable"; only an attempt to SAVE a custodian fails, loudly, until the migration is applied.

**Custodian registry.** The suggestion list is the set of distinct custodians users have already
recorded on their notes (`getKnownCustodians`, served by `GET /api/structured-notes/{id}/
allocations`, rendered as a `<datalist>`). The app never ships a guessed roster of institutions.
Normalization trims and collapses internal whitespace and groups case-insensitively, so
`"  banco   DE chile "` and `"Banco de Chile"` are one institution while the user's own legal name
and casing are preserved for display. Punctuation and legal suffixes are deliberately NOT stripped,
because that is precisely what would merge "Banco de Chile" with "Banchile Corredores de Bolsa", or
"JPMorgan Chase Bank, N.A." with "J.P. Morgan Securities LLC".

**Missing custodian.** A note imported from a term sheet cannot know its custodian (custody is not a
product term — every parser sets `custodian: null` explicitly), so notes start unrecorded, stay
fully readable, and are classified `Custodian unavailable`. The single field is border-flagged with
the warning token until filled. Nothing is ever backfilled or defaulted from the issuer, the entity
name, or a clearing system. The write path is the note `PATCH`, which acts only when the client
actually sends the key; an explicit null clears it.

**Nevada investment.** `calculateNevadaInvestmentNotional(allocations)` = the sum of valid ACTIVE
account allocations, delegating to the single existing `calculateAllocationTotal` implementation, so
two authoritative totals cannot exist. There is no stored note-level investment field to
synchronize.

**Issue size.** Product metadata only — the total notional issued across ALL investors. The rule
that Nevada's investment must equal it was **removed in both places that carried it**: the detail
page's `mismatch = n.issueSize !== null && Math.abs(allocationTotal - n.issueSize) > 0.01`, and the
allocations route's `allocationsMismatch = ... > 0.01`. The two quantities are now labelled and
shown separately (Total issuance size / Nevada investment notional), each with its own help text.
The only surviving comparison is `classifyIssueSizePlausibility`, which returns `not_comparable`
unless both values exist in the same known currency and the issue size is not flagged indicative,
then `below` (normal) · `equal` (valid, never required) · `review` (Nevada above the recorded issue
size — a NON-BLOCKING advisory line, since the stored figure may be stale, indicative, or superseded
by a tap/reopening). Nothing rejects a note, and nothing is overwritten to force agreement. The
`allocationsMismatch` wire field is retained for compatibility but now means only the review case,
alongside the new explicit `nevadaInvestmentNotional` and `issueSizeComparison`.

**XS3164820824 (real book data, read-only audit).** Issue size USD 1,500,000; Nevada investment
USD 1,000,000 across 3 active same-currency allocations; 0 allocations carried a custodian. The
removed rule DID fire on it (`|1,000,000 − 1,500,000| > 0.01` → "Allocations do not match the issue
size"). After: `below` — silent, correct, nothing overwritten, and its three allocations are what
feed both issuer and custodian exposure.

**Exposure by Custodian.** Each note contributes its whole Nevada position (its
`calculateCurrentNotional`, i.e. the sum of its active account allocations, 0 once archived) to its
own custodian. Because custody is note-level, a position cannot be split across custodians and
double-counting is structurally impossible. Notes with no recorded custodian are kept under the
`null` key and rendered "Custodian unavailable", so they stay in the total and the denominator and
are never re-attributed to the issuer, entity, broker, or clearing system; that bucket always sorts
last. The universe, archived-note rule, and unconverted currency basis are deliberately identical to
`calculateIssuerExposure` — the two functions now have the same shape — so the charts always share a
denominator (asserted). The card reuses the issuer card's own `ExposureHeader` + `BarChart`, so the
issuer card is untouched, the two can never drift, and no chart library was added.

**Dashboard exposure layout (R7.1B.1).** The two ranked lists were each consuming a full-width third
of a wrapping row while the entity allocation donut — the more decision-useful view — was squeezed
into the remainder. They now **stack in a narrower left column** (Issuer above Custodian) with the
**allocation chart beside them** in the wider column: `grid-cols-1 lg:grid-cols-[minmax(0,5fr)_
minmax(0,7fr)] items-start`. Below `lg` everything collapses to one column in the same reading
order. Both columns are `min-w-0`, so a long label truncates inside its card rather than widening
the page. The donut is drawn larger to match its new prominence (`w-52` stacked, `w-60` side by
side) and its R7.1A container-query composition is otherwise unchanged.

**Delete architecture — HARD delete, and why.** There is no soft-delete convention for structured
notes to reuse: `status`/`archived_at` model a note being CALLED (a real lifecycle event, still
fully visible in the Archived view), so overloading them to mean "deleted" would corrupt that
meaning. `deleteStructuredNote` therefore removes the row in one statement, and the confirmation
honestly says it cannot be undone. Dependent records, classified explicitly against the declared
foreign keys (documented in the repository and asserted against the migration, never left to
incidental cascade behavior): **delete with note** — underlyings, observations, allocations, price
snapshots, extracted fields (all `note_id ... on delete cascade`); **preserve but detach** —
`structured_note_extraction_runs.extracted_note_id` is `on delete set null`, so the upload/extraction
audit trail survives; **preserve because shared** — `structured_note_monitoring_runs` is book-level
with no note FK. No orphan is reachable, and nothing shared is destroyed: entities and custodians
are text attributes of allocation rows, not shared records, and this module owns no document store.

**Delete surfaces.** New far-right Actions column on the dashboard table (56 px in the R3 fixed-width
COLS system) with an icon-only trash `<button>` — localized accessible name naming the note, tooltip,
32 px target, focus ring, and no row navigation (the row handler already skips `a, button, input,
label`). It only opens the shared `DestructiveConfirm`; the detail page's existing delete action is
unchanged in contract and now carries the same richer description. Both call `DELETE
/api/structured-notes/{id}`. Dashboard success closes the dialog and reloads, so the table AND both
exposure aggregates recompute server-side; detail success redirects to `/structured-notes`. Failure
keeps the row, the page, and the dialog open for retry.

**API.** `DELETE /api/structured-notes/{id}` gained id validation and a controlled `404 not_found`
(deliberately not idempotent, so a UI can tell "removed by this action" from "already gone"); every
failure path is structured JSON with no stack, path, SQL, or env detail. `POST .../allocations`
gained custodian passthrough with preserve-on-omit semantics and the new response fields. Access is
unchanged: default-deny middleware classifies the path `private_api` (JSON 401), and handlers run on
the RLS-scoped user client — never the service-role client.

**Data audit (read-only query against the live book, aggregates only).** 9 notes (9 active, 0
archived) · 27 allocation rows, all active · 0 with an explicit custodian, 27 missing (custody was
never capturable) · 0 distinct custodians · 0 notes at one custodian, 0 across several, 9 with none ·
issue size == Nevada investment on 5 notes, differs on 4 (1 of those with Nevada ABOVE the recorded
issue size — a genuine review case the new rule surfaces as advisory) · 0 notes where only one value
exists · 0 with an allocation currency differing from the note currency · **4 notes were affected by
the removed equality validation** (the 4 that differ, including XS3164820824). Dependent records:
underlyings 18 · observations 68 · allocations 27 · price snapshots 18 · extracted fields 0 (all
delete-with-note) · extraction runs 34 (preserve-detached) · monitoring runs 26 (preserve-shared).

**Limitations.** (1) **The migration has not been applied to the live database.** The Supabase CLI is
blocked by Windows security policy on this machine, `.env.local` carries no direct Postgres URL, and
the JS client cannot execute DDL — so `supabase db push` (or an equivalent) must be run before
custody can be saved. Until then the app degrades cleanly: every note reads as "Custodian
unavailable" and only a save attempt fails. (2) Manual browser acceptance (§U: dashboard, detail,
XS3164820824, 390/1024/1728, EN/ES, light/dark) was NOT performed — no browser is connected and the
routes require a session whose credentials cannot be entered; the live evidence recorded here is
server-side and read-only. (3) Final-vs-indicative issue-size provenance is not modelled, so
`issueSizeBasis` defaults to `unknown`; the comparison stays advisory-only, which is its maximum
permitted outcome anyway. (4) Cross-currency comparison is refused rather than converted — there is
no FX layer in this module (the book is currently single-currency per note). (5) With 0 custodians
recorded today, the new chart will legitimately show a single "Custodian unavailable" band until
users enter custody data.

---

## Phase R8 — Earnings source honesty, per-source coverage, composition ✓ IMPLEMENTED (2026-08-03, automated validation complete, manual browser validation pending)

Baseline `5bd6b2b` (clean). `/earnings` was re-skinned onto the Fable foundation in Phase 5G
(`TableCard` ×2, `AsyncState`, `Reveal`, tokenised hover, near-opaque dense headers); R8 is the
fidelity-deepening pass that brings the route into the R3–R6 family **and** closes two real
data-integrity defects that predate the re-skin. Preceded by a read-only audit whose gap list this
section implements.

**Fable reference:** doc 02 §8 Research (the "Upcoming earnings" module) + the glass DataTable
pattern, exactly as recorded in doc 03 §7. The composition adopts primitives already shipped in
R0/R6 — no new shared component was created.

### The two data-correctness fixes (not styling)

**1 · Both source badges claimed a static sample that does not exist.** `page.tsx` rendered
`status={… ? 'live' : 'static'}` for both tables. There is no static earnings source: both payload
unions are `'live' | 'unavailable'`, and `src/data/earnings.json` is a deleted file whose absence
`tests/auditSourceIntegrity.test.ts` already asserts. So a Yahoo outage, a CMF-unavailable snapshot,
**and a plain network failure** (`.catch(() => null)`) all printed **"Static"** under an empty table
— telling the reader a sample was on screen when nothing was. Both now resolve
**`'live-unavailable'`**, a status the shared `MarketDataSourceBadge` and both dictionaries already
carried, so **no shared string was edited** (`t.marketData.*` untouched — it is consumed by Stocks,
Home and Company).

**2 · `missingTickers` never reached the user.** Both payloads carry it, and both resolvers document
it in-source as the honest-gap channel ("never faked" / "documented gap, e.g. Santander/Itaú"). A
repo-wide scan confirmed **no component in `src/` read it**. Live consequence: CMF genuinely does not
publish BSANTANDER or ITAUCL (only 3 banks appear on its calendar), so a reader saw 23 of 25 tracked
companies with zero indication two were missing *by construction* rather than "not reporting yet".

**Coverage is per-table, deliberately.** The calendar and the results feed are independent sources
with independently different coverage; one merged page-level figure would be false for at least one
of them, so the R8 brief's architecture correction (no combined number in `PageHeader`) is
implemented as one `CoverageNote` per table. Coverage = `trackedCompanyCount` −
that payload's own `missingTickers`, and **never** the displayed row count: Recent Results prints two
quarters per company and Upcoming prints only companies reporting inside the window, so neither row
count can express "this source has no data for this issuer at all". The note renders beside
`TableSourceFooter`, never inside its `source` string (Source Badge Rule), and exactly one footer per
table survives.

**One registry, read once** *(R8 follow-up correction, 2026-08-03)*. `COMPANY_REGISTRY =
getAllCompanies()` is evaluated a single time at module scope and backs **both** the coverage
denominator (`trackedCompanyCount = COMPANY_REGISTRY.length`) and the Upcoming ticker→name lookup, so
the two can never disagree about which universe is being measured. The denominator is never
hardcoded and never taken from a provider-side symbol map: `TICKER_YF` is a Yahoo symbol map in
server-facing code, not the app's company registry, and the page does not import it. Guarded by three
dedicated tests (registry read exactly once; no `TICKER_YF`/`liveOverlay`/hardcoded size; coverage
derived from `missingTickers` and never from either payload's row arrays).

**Unavailable is no longer collapsed into empty.** Phase 5G explicitly asserted the collapse as
preserved NMI behaviour; R8 was commissioned to correct it. Null-or-explicitly-unavailable →
`AsyncState kind="unavailable"` (existing bilingual copy, no message override); a healthy live
payload with zero rows keeps `kind="empty"` and its original message — a genuinely real case for
Upcoming between quarterly reporting waves. `partial`/`stale` remain unused because no payload field
distinguishes them; using them would be invention.

### A latent date bug found and closed

The audit prescribed replacing the raw ISO `reportDate` with the shared `formatDate`. Doing so
literally would have **introduced a regression**: `new Date('2026-08-04')` parses as UTC midnight,
and in Chile (UTC-4/-3) `toLocaleDateString` then renders **"03 ago 2026" — one day early**, on a
page whose entire purpose is stating when a company reports. Verified directly; every sampled date
drifted. `formatDate` had **zero prior call sites**, so no existing behaviour depended on it.

`src/lib/formatters.ts` is out of scope for this phase, so the fix normalizes the *input* to local
midnight (`formatDate(\`${iso}T00:00:00\`)` inside a documented one-line `reportDateLabel` helper)
rather than editing the formatter — no second date formatter, and no hand-rolled segment
rearrangement (the `slice(8,10)/slice(5,7)` recipe Home uses is explicitly not adopted). Guarded by a
behavioural test asserting the normalized parse yields the right day in **every** timezone, plus a
timezone-gated assertion that proves the naive drift is real when running west of UTC.
*Recommended follow-up, out of scope here: `formatDate` itself should take an explicit
`timeZone`/date-only path so the next caller cannot re-enter this trap.*

### Composition (presentation only)

- `SectionHeader` → shared **`PageHeader`** — tag→`eyebrow`, subtitle→`metadata`, Update Data action
  byte-identical. This was the last non-R header on the route.
- Hand-rolled export capsule → shared **`ChipButton`** (same handler, filename, headers, row mapping,
  keyboard operation and accessible name; the inline `--nv-chip` recipe is gone from the page).
- Upcoming gained a **Company** column in 2nd position — the name+id subject-identity anatomy R6
  established and Recent Results already had. Resolved from the client-safe `@/lib/data/companies`
  registry (`c.name`, the same field the server-side results resolver uses, so one company reads
  identically in both tables), honest `—` fallback, **no added API request**. `colSpan` 3→4,
  `scope="col"` 14→15.
- The inline `45` literal became `UPCOMING_WINDOW_DAYS` (business rule out of the render body; the
  value and the calendar resolver are unchanged — Home keeps its own 7-day window).
- Dead `earnings.calCols.notes` removed from both dictionaries after confirming zero references in
  `src/` and `tests/`.

**New i18n (both dictionaries):** `earnings.calPeriods.{q1,q2,q3,annual}` (`Annual`/`Anual` — the
calendar enum was printed raw, so the Spanish UI showed an English word; Recent Results' own
`"Q1 2026"` is already language-neutral and is left alone), `earnings.companiesCovered`,
`earnings.notCovered`.

**Data integrity:** the rolling two-quarter window, exact-period prior-year YoY matching, per-row
reporting currency, bank-EBITDA suppression and its tooltip, `fmtMM`/`fmtEps`/`pctCell`, negative
styling, the amounts note, the record count, both `TableSourceFooter` source/as-of expressions,
`Promise.all` per-source isolation with four independent `.catch(() => null)`, and force-refresh
semantics are all byte-identical. No resolver, API route, cache, provider, schema, cron or access
rule was touched.

**Deliberate omissions:** no sorting, filter, period selector, KPI capsule strip, sparkline, detail
drawer, consensus/forecast/surprise field, quality pill, static fallback, new cache, or new route.
The Recent Results CSV is unchanged and deliberately does **not** gain the new Upcoming Company
column. Home carries the identical raw-period and date-format defects (and a
`t.home.earningsSource = 'Static sample'` label naming a dataset that no longer exists) but is a
separate route and was **not** touched.

**Tests:** `tests/fableEarningsPage.test.ts` 57 → **99**. Nine Phase 5G cases updated in place with
documented R8 rationale (header→`PageHeader`, Upcoming column order, live-data helper bindings,
badge ternaries, three-way state mapping, `AsyncState` type import, `scope="col"` count, `colSpan`,
and the `partial/stale/unavailable` case whose original premise R8 explicitly supersedes) + 40 new
R8 cases across source honesty, async-state distinction, per-source coverage (including three that
pin the denominator's provenance), localization, date normalization, composition, preserved business
contracts, and access-control documentation. One
guard caught a real self-inflicted slip: the word "miss" in a new code comment tripped the
beat/miss field scan, so the **comment** was reworded rather than the guard weakened.

**Gates:** focused suites green (**738/738** across the 11 R8 cross-check suites); full suite
3794 → **3836 · 3833 pass · 3 fail** — the +42 is exactly this phase's new cases, and the 3 failures
are only the known date-dependent `newsModule` trio (lines 311/351/361); lint 0; build 0 errors
(`/earnings` still prerendered `○`); `git diff --check` clean.

**Manual browser validation: PENDING** (390/1024/1728 + 320 stress, EN/ES, light/dark,
normal/reduced-motion). No browser is connected this session and the route requires a session whose
credentials cannot be entered. One item to watch specifically: Upcoming's `minWidth` was
deliberately left at 360 despite the 4th column — the table sizes to its own content and the card
scrolls, so no truncation is expected, but this is the one place browser evidence could justify a
minimal raise.

---

## Phase R9.0 — Shared theme state + language cross-tab sync ✓ IMPLEMENTED (2026-08-03, automated validation complete, manual browser validation pending)

**Preference architecture only. No Settings UI was implemented, no `Switch` primitive was created,
no notification-recipient behaviour was touched, and no privacy-mode consumer was wired.** R9.0
exists so that when the Settings Display card arrives it is a *view* of the preferences the TopBar
already owns, rather than a second copy of them.

### Why a purpose-built theme store rather than `usePersistentState`

`usePersistentState` is the right tool for every other preference in this app and it is deliberately
**not** used here. It JSON-stringifies, so it would store `"\"light\""` at key `theme`. The pre-paint
script in `src/app/layout.tsx` compares `localStorage.getItem('theme')==='light'` against a **raw**
string, so a JSON-encoded value can never match: the stored preference would be silently ignored on
every first paint and the app would flash dark before hydration corrected it. The raw storage
contract is authoritative and unchanged:

| | |
|---|---|
| Key | `theme` |
| Values | `dark` \| `light` |
| Format | **raw string, never JSON** |
| Default | `dark` (also the server-rendered value — `<html className="dark">`) |
| First paint | the existing pre-paint script, **byte-identical**, `layout.tsx` untouched |

### Files changed

| File | Change |
|---|---|
| `src/lib/useTheme.ts` **(new)** | The one theme store. `useSyncExternalStore` over module-scope functions; strict validation (only the exact string `light` is light, everything else resolves to `dark`); raw read/write; `applyTheme` owns the `<html class="dark">` effect; `subscribe` listens to **`cmi-ls:theme`** (same-tab, the app's existing custom-event convention) *and* the native **`storage`** event (cross-tab, where it also applies the document class because no `setTheme` ran locally). SSR-guarded on both `window` and `document`; nothing persists during server rendering. No provider, no context, no `matchMedia`, no second default. Exports `useTheme`, `readTheme`, `setTheme`, `applyTheme`, `subscribeToTheme`, `THEME_STORAGE_KEY`, `DEFAULT_THEME`, `Theme`. |
| `src/components/ui/ThemeToggle.tsx` | State ownership only: `useState`/`useEffect`/`localStorage`/`documentElement` removed in favour of `const { isDark, setTheme } = useTheme()`; the two handlers now pass `'light'`/`'dark'` instead of `false`/`true`. **Zero visual change** — markup, both segments, `role="group"`, both `aria-pressed`, both `aria-label`s and `title`s, the `hidden sm:inline` icon-only collapse, chip tokens and `nv-transition` are untouched. |
| `src/components/providers/LangProvider.tsx` | One added effect: a native `storage` listener for key `lang` that applies a cross-tab write. Same provider, same `lang` key, same raw `'en'`/`'es'` format, same `'en'` default, same `useLang()` signature, same dictionary. Any other key is ignored; any value that is not exactly `en`/`es` — including the `null` a `removeItem`/`clear()` produces — leaves the current language alone rather than silently resetting the UI. Listener removed on unmount. |
| `tests/themeLanguageSync.test.ts` **(new)** | 33 cases. Theme is tested **behaviourally**: the store lives outside React, so a minimal browser stub (Map-backed `localStorage`, class-set `documentElement`, event registry) exercises the real read/normalize/write/subscribe/notify logic — no DOM library, no new dependency, no React renderer. Covers default/raw-dark/raw-light/invalid resolution, raw-not-JSON writes, out-of-range normalization, same-tab and cross-tab notification, unrelated-key isolation, `clear()` handling, dark-class tracking in both directions, three subscribers sharing one state, writing the current value settling in exactly one notification per call, both listeners removed on unsubscribe, and the SSR path. LangProvider (a React component with no headless renderer available here) is covered by source scan, the established convention for components in this repo. |
| `tests/fableR0Primitives.test.ts` | One existing case updated deliberately: the persisted-choice and dark-class assertions used to read `ThemeToggle.tsx`. The **contract is unchanged and still asserted** — it now reads `src/lib/useTheme.ts`, its new home, and `ThemeToggle` is asserted to consume `useTheme()`. Every accessibility/markup assertion in that case is untouched. |

### Synchronization guarantees

- **Same tab** — any control calling `setTheme` dispatches `cmi-ls:theme`; every subscriber re-reads. Verified with three concurrent subscribers.
- **Across tabs** — the native `storage` event updates value *and* document class in the receiving tab. Verified for both directions.
- **No loop** — writing the current value notifies once per call and `useSyncExternalStore` bails out on the identical primitive. Verified with three consecutive same-value writes.
- **Isolation** — `lang`, `cmi.privacyMode` and `cmi.compare*` storage events do not wake the theme store. Verified.
- **Language** — a cross-tab `en`/`es` write updates the provider; invalid values and unrelated keys are ignored; the listener is cleaned up.

### Not in R9.0

No `/settings` page, no `Switch` primitive, no notification-recipient change, no privacy-mode
consumer, no server-side preference persistence, **no migration, no API, no schema, no new
dependency**, no change to `src/app/layout.tsx`.

**Gates:** focused suites green — **697/697** across `fableR0Primitives`, `fableFoundation`,
`fableAuthShell`, `fableAuthRecovery`, `topNavigation`, `accessControl`,
`mobileShellResponsiveRepair`, `fableComponents`, `notificationsPlatform`; new file **33/33**.
Full suite, lint, build and `git diff --check` recorded in the phase report.

**Manual browser validation: PENDING** — theme changed in the TopBar propagates to every mounted
control; reload preserves it with no wrong-theme flash; a second tab updates immediately; the
document dark/light class is correct; language changed in one tab reaches another, survives reload,
and retranslates the whole shell.

---

## Phase 7 — i18n additions & cleanup (`src/lib/i18n.ts`)

Any new visible string (login utility chips "Secure connection", contrast label, privacy-mask
tooltip, new empty/aria strings) → add to **both** `dict.en` and `dict.es` (merge point 7). No
hardcoded UI text in components. Reuse existing namespaces; add keys under `topbar`, `common`,
`auth` as needed. No new namespace unless a genuinely new surface appears.

---

## Phase 8 — Verification, tests, docs

- Update DOM-asserting tests that legitimately change (responsive conventions if nav model
  changed; any badge/footer text tests) — **update deliberately**, never delete a guard to make
  markup pass.
- Add/adjust: a token-parity check (every Fable token has light+dark), a reduced-motion check,
  and a glass-utility semantic-token check if useful.
- Run the full gate at each phase: `npm run build` · `npm run lint` · `npm test`.
- Browser-verify the responsive ladder (1728/1440/1280/1023/900/767/630/430/390) in **both**
  themes and **both** languages, per route, for zero page-level horizontal overflow.
- Keep `docs/data_source_status.md` and `06-acceptance-checklist.md` current.

---

## Files expected to change, by phase (summary)

| Phase | Files |
|---|---|
| 0 | `docs/design_principles.md`, `CLAUDE.md` (docs only) |
| 1 | `src/app/globals.css`, `src/app/layout.tsx` |
| 2 ✓ | `src/lib/navigation.ts`, `src/components/layout/{AppShell,TopBar,PrimaryNav,SecondaryNav,MobileNavDrawer,NavIcon,useNavIndicator}.tsx/.ts`, `src/components/providers/MobileNavProvider.tsx` (replaces `SidebarProvider`), `src/lib/i18n.ts`, `src/app/globals.css` (small addition + sidebar-token cleanup) — `Sidebar.tsx`/`SidebarProvider.tsx` deleted |
| 3 ✓ | `src/components/ui/{StatusPill,NotificationBell,CommandPalette}.tsx` (restyled in place), new `src/components/fable/*` (GlassSurface, KpiCapsule/Hero, ChangeIndicator, Sparkline, SparklineRow, useCountUp, CurrentActions, SegmentedControl, BarrierGauge, TableCard, PrivacyValue, usePrivacyMode, DetailPanel, AsyncState, motion), `src/app/globals.css` (`.nv-action-card`, `.nv-content-pulse`), `src/lib/i18n.ts` (`fable` namespace) |
| 4 ✓ | `src/components/charts/{LineChart,CompareChart,FundamentalsChart,YieldCurveChart}.tsx` (restyled in place, props unchanged), new `src/components/fable/chart/{ChartTooltip.tsx,chartA11y.ts}`, `src/components/macro/EconomicCalendarTable.tsx` (row-hover utility swap), `src/app/globals.css` (chart semantic token block), `src/lib/formatters.ts` (`formatChartValue`), `src/lib/i18n.ts` (`fable.chart` namespace) |
| 5A ✓ | `src/app/stocks/page.tsx`, `src/components/ui/SearchInput.tsx` (only `/stocks` consumes it), `src/lib/i18n.ts` (3 keys ×2 langs), new `tests/fableStocksPage.test.ts`, `tests/responsiveLayout.test.ts` (deliberate `TableCard` scroll-delegation update + 2 new tests) |
| 5B ✓ | `src/app/watchlist/page.tsx`, `src/lib/i18n.ts` (6 keys ×2 langs), new `tests/fableWatchlistPage.test.ts`, `tests/responsiveLayout.test.ts` (620px floor), `tests/fableStocksPage.test.ts` (phase-boundary guard update) |
| 5C ✓ | `src/app/companies/[ticker]/page.tsx`, `src/lib/i18n.ts` (2 keys ×2 langs), new `tests/fableCompanyDetailPage.test.ts` |
| 5D ✓ | `src/app/compare/page.tsx`, `src/lib/i18n.ts` (2 keys ×2 langs), new `tests/fableComparePage.test.ts`, `tests/{fableWatchlistPage,fableStocksPage,fableCompanyDetailPage}.test.ts` (phase-boundary guard updates) |
| 5E ✓ | `src/app/chart-builder/page.tsx`, `src/lib/i18n.ts` (5 keys ×2 langs), new `tests/fableChartBuilderPage.test.ts`, `tests/{fableComparePage,fableCompanyDetailPage}.test.ts` (phase-boundary guard updates) |
| 5F ✓ | `src/app/macro/page.tsx`, `src/app/macro/calendar/page.tsx`, `src/components/macro/EconomicCalendarTable.tsx`, `src/lib/i18n.ts` (5 keys ×2 langs), new `tests/{fableMacroPage,fableMacroCalendarPage}.test.ts`, `tests/{fableComparePage,fableStocksPage,fableWatchlistPage,fableChartBuilderPage,fableCompanyDetailPage}.test.ts` (phase-boundary guard updates) |
| 5 (rest) | `src/app/{earnings,portfolio,structured-notes,structured-notes/[id],settings/notifications}/page.tsx`, `src/app/page.tsx` |
| 6 | new `src/app/(auth)/layout.tsx`, `src/app/{login,forgot-password,auth/reset-password}/page.tsx`, `src/components/ui/BrandLogo.tsx`, `public/*` (login photo, logo) |
| 7 | `src/lib/i18n.ts` |
| 8 | `tests/*` (deliberate updates), `docs/*` |

## Explicitly NOT changed (out of scope — merge point 5)

`src/app/api/**` (all 60 routes) · `src/middleware.ts` (protection lists) · `src/lib/auth/*`
logic · `src/lib/providers/**` · `src/lib/db/**` · `src/lib/financials/**` ·
`src/lib/structuredNotes/**` (calc/monitoring/parsers) · `src/lib/market/**` · `src/lib/earnings/**`
· `src/lib/compare/*` resolvers · `src/lib/ingestion/**` · `src/lib/observability/**` ·
`src/lib/portfolio/*` math · `src/config/**` · `src/data/**` · `vercel.json` crons ·
`supabase/migrations/**` · `scripts/**`. No new auth system, no schema/API/business-logic edits.

## Dependency decisions — RESOLVED in Phase 0 (see doc 05 §A for the binding record)

| # | Decision | Outcome |
|---|---|---|
| D1 | Default theme | **Dark is the first-visit default**; light fully supported; user choice persists and beats system preference |
| D2 | Theme class mechanism | ✅ **RESOLVED in Phase 1 (2026-07-22)** — `.dark` on `<html>`, light under `:root`, dark under `.dark`. Server renders `.dark` (dark-first); the pre-paint script only removes it for a stored `'light'`. No `body.nv-light`, no second provider, no second storage key. See "Phase 1 — as built" |
| D3 | Nav model | ✅ **IMPLEMENTED in Phase 2 (2026-07-24)** — Fable top pill rail is the primary desktop model *(overrides the audit recommendation to keep the sidebar)*; every route stays reachable; scrollable rail (desktop) + accessible dialog drawer (mobile). See "Phase 2 — as built" |
| D4 | Detail views | **Full pages retained** for dynamic detail routes; slide-in panels supplementary only, never replacing a canonical route |
| D5 | Logo | **Fable transparent blue/cyan SVG is authoritative**; never redraw/recolor/distort/box |
| D6 | Motion | **Pure CSS + WAAPI**, no animation library; `prefers-reduced-motion` always honored |
| D7 | Fable-only screens | **Excluded**; visual language harvested only; no mock data, no sample component replacing a live one |

### Impact of D3 on this plan

Phase 2 changes shape: the top pill rail is **the** nav model, not the fallback branch.
- `src/components/layout/Sidebar.tsx` → becomes/gives way to a top pill rail with a measured
  sliding indicator (380ms, primary easing), plus a horizontally scrollable rail (or equivalent
  drawer) below the desktop breakpoint.
- `src/components/providers/SidebarProvider.tsx` — its collapse/drawer semantics **do** change;
  treat as an explicit sub-task, not an incidental edit.
- `tests/responsiveLayout.test.ts` encodes the current sidebar conventions (`hidden lg:flex`,
  drawer round-trip). It must be **updated deliberately** to the new nav conventions — never
  deleted or weakened to make markup pass.
- Must be preserved through the change: the Macro Chile/US sub-region navigation and its
  `macro:region` event, active-state logic, `useAuthDisplay` name, sign-in/out affordance,
  command-palette entry point, and zero page-level horizontal overflow at every breakpoint.

Phase 6 gains certainty on the logo (D5): ship the SVG, keep `BrandLogo`'s theme-swap and
graceful `onError`, and verify legibility against both themes and the Santiago photo.
