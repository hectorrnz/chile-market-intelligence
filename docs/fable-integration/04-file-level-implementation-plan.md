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
9. **`/structured-notes`** — barrier gauge, upload/extract panel, dashboard KPIs, bar/donut.
10. **`/structured-notes/[id]`** — terms grid, current-levels table, schedule, allocation grid,
    optional detail-panel language.
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

## Phase 6 — Auth pages + login shell (highest-visibility, distinct layout)

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
