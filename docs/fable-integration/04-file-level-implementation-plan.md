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
> See "Phase 5A — as built" and "Phase 5B — as built" below. Pages 3–12 are not started.

Each page: swap layout/card/table/pill classes to the new shared components; **do not change**
data fetching, `fetch*` calls, `useMarketData`/`useMacroData`/`useGlobalRefresh`, persisted
`cmi.*` keys, loading/empty/error branches, source badges/footers, or `t.*` usage. Where NMI
has more content than Fable, keep it (merge point 3). Where Fable sample content has no NMI
data, exclude it (merge point 4).

Recommended order (low-risk → high-risk, dependency-aware):

1. **`/stocks`** — cleanest DataTable, direct Fable Portfolio-table map; proves the table +
   toolbar + source-footer recipe end to end.
2. **`/watchlist`** — small protected table + add form; proves the recipe on a protected route
   and the add-form pattern.
3. **`/companies/[ticker]`** — KPI capsules + chart + valuation grid + results + news; proves
   capsules, charts, glass cards, print path.
4. **`/macro`** + **`/macro/calendar`** — direct Fable Macro map (snapshot rows + sparklines),
   banded table, yield curve, chart popup overlay, release calendar.
5. **`/earnings`** — two glass DataTables + upcoming module.
6. **`/compare`** — multi-slot returns table, settings modal (glass overlay), compare chart,
   segmented pills.
7. **`/chart-builder`** — metric picker + dual-axis chart + underlying table + settings.
8. **`/portfolio`** — hero/capsule summary, exposure bars, three tabbed tables + forms
   (biggest single page; do after capsules/tables are proven).
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
| 5 (rest) | `src/app/{companies/[ticker],macro,macro/calendar,earnings,compare,chart-builder,portfolio,structured-notes,structured-notes/[id],settings/notifications}/page.tsx`, `src/app/page.tsx` |
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
