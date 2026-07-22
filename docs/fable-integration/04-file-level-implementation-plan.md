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

## Phase 2 — App shell: nav, top bar, providers (`src/components/layout/`)

Re-skin the shell **without** changing the provider tree or the responsive/drawer behavior.

**Files**
- `src/components/layout/AppShell.tsx` — keep the provider nesting (Lang → MarketData →
  MacroData → Sidebar) and `CommandPalette` mount. Apply the Fable page background
  (`--nv-bg0`/`bg1`) and content max-width (1560px centered) to `<main>`; keep
  `overflow-y-auto` + responsive padding + print unlocks.
- `src/components/layout/TopBar.tsx` — Fable glass header (`.glass-header`): 30px logo crop +
  "Inversiones Nevada"/title, glass search pill (⌘K), icon buttons (bell, lang, theme),
  optional avatar menu. Keep the hamburger + `useSidebar().toggle` + `getPageTitle` + date.
- `src/components/layout/Sidebar.tsx` — **decision-gated** (doc 05): either (a) restyle the
  existing left navy column + mobile drawer in glass, or (b) convert to Fable's top pill-rail
  with a measured sliding indicator + mobile scroll rail. Preserve `navItems`, the Macro
  accordion + `macro:region` event, active-state logic, `useAuthDisplay` name, sign-in/out
  link. If moving to a top rail, the `SidebarProvider` collapse/drawer semantics change — plan
  that as an explicit sub-task.
- `src/components/providers/SidebarProvider.tsx` — only if the nav model changes (rail vs
  column). Otherwise untouched.
- **New:** `src/components/fable/` directory for the sliding-nav-indicator, avatar menu, and
  any shell-specific glass primitives.

**Guardrails:** `tests/responsiveLayout.test.ts` (sidebar `hidden lg:flex`, drawer,
`min-w` table scroll, grid prefixes). If the nav model changes, update this test deliberately
(it encodes the current conventions).

---

## Phase 3 — Shared UI primitives (`src/components/ui/` + `src/components/fable/`)

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

## Phase 4 — Charts (`src/components/charts/`)

Restyle the four SVG charts to the Fable chart language (gridlines, dashed zero line, chart
palette `--chart-1/2/3` + tertiary, crosshair tooltip, event chips). **Keep every prop and the
ResizeObserver measurement** — data flow is untouched.

**Files:** `LineChart.tsx`, `CompareChart.tsx`, `FundamentalsChart.tsx`, `YieldCurveChart.tsx`,
`src/components/macro/EconomicCalendarTable.tsx` (table restyle). Consider extracting shared
chart primitives (axis, gridlines, tooltip) into `src/components/fable/chart/`.

---

## Phase 5 — Page-by-page re-skin (recommended order)

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
| 2 | `src/components/layout/{AppShell,TopBar,Sidebar}.tsx`, `src/components/providers/SidebarProvider.tsx` (if nav model changes), new `src/components/fable/*` shell parts |
| 3 | `src/components/ui/*` (all 14), new `src/components/fable/*` (GlassCard, KpiCapsule/Hero, SegmentedPill, Sparkline, BarrierGauge, DetailPanel, SideScrim) |
| 4 | `src/components/charts/*` (4), `src/components/macro/EconomicCalendarTable.tsx` |
| 5 | `src/app/{stocks,watchlist,companies/[ticker],macro,macro/calendar,earnings,compare,chart-builder,portfolio,structured-notes,structured-notes/[id],settings/notifications}/page.tsx`, `src/app/page.tsx` |
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
| D3 | Nav model | **Fable top pill rail is the primary desktop model** *(overrides the audit recommendation to keep the sidebar)* — every route stays reachable; scrollable rail/drawer below desktop |
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
