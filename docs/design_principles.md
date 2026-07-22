# Design Principles — Nevada Market Intelligence

These principles govern every visual and UX decision. They exist so future work does not drift
toward generic SaaS aesthetics, and so the approved Fable visual direction is applied
consistently without eroding the application's content, data integrity, or accessibility.

**Authority model (read this first):**

| Domain | Authority |
|---|---|
| Visual design — typography, layout hierarchy, color, materials, spacing, radii, shadows, motion, page transitions, responsive composition, login presentation | **The approved Fable output** |
| Content, data, routes, data sources, business logic, source disclosures, timestamps, loading / empty / error states, localization, authentication, responsive functionality | **Existing NMI implementation** |

Where the two appear to conflict, the resolution is always *"Fable's look, NMI's substance."*
If a design decision cannot be resolved under that rule, raise it before implementing.

> **Supersedes:** the pre-Fable version of this document, which prohibited glassmorphism,
> gradients, large radii, shadows, and motion outright. Those prohibitions are replaced by the
> **governed** rules in §7–§13 below. This is a deliberate, approved reversal — not drift.
> Full context: `docs/fable-integration/` (docs 01–06).

---

## 1. Institutional Over Consumer

This is an internal tool for a professional investor. It should read as a private-capital
investment platform — a buyside workbench — not a startup marketing site, not a consumer finance
app, not an AI demo.

The Fable language is *refined institutional*: restrained palette, dense data, precise
typography, and material depth used to establish hierarchy. Depth and motion are instruments of
clarity here, never decoration. Every visual device must earn its place by making the
information easier to read, rank, or navigate.

---

## 2. Content-Preservation Rule (non-negotiable)

Applying the visual language must never remove application substance.

Every existing route, module, table, column, field, control, dataset, source note, timestamp,
user action, loading state, empty state, error state, language, authentication rule, and
business rule **remains**.

- **Where Fable shows less content than NMI**, preserve the NMI content and build additional
  components in the Fable visual language.
- **Where Fable shows sample content NMI has no data for**, exclude that content from
  production. Harvest its visual treatment only.
- **No static sample component may replace a live NMI component.**
- **Every existing NMI route must remain accessible.** Dynamic detail routes
  (`/companies/[ticker]`, `/structured-notes/[id]`) remain **full pages**.
- **Slide-in detail panels are supplementary.** They may enrich a list view; they may never
  become the only way to reach content that has a canonical route.

---

## 3. Data-Integrity Rule (non-negotiable)

- **Fable's mock financial data must never enter production.** Every number rendered comes from
  the real data layer.
- Every visible field stays classifiable as `live` · `persisted` · `derived` · `static_fallback`
  · `temporary_static` · `blocked` · `unavailable`. No visible module may be static as a
  terminal state (see CLAUDE.md, "No-static-terminal-state policy").
- Restyling must not alter data fetching, provider selection, source-priority/supersession
  logic, refresh behavior, or any business calculation.
- Loading, empty, and error states are content. They get restyled — never removed, never
  replaced with a decorative placeholder that implies data exists.

---

## 4. Source-Label Preservation (non-negotiable)

The data-quality disclosure system is a core product feature, not chrome. It survives the
re-skin intact, restyled into Fable's chip language.

- **Source badges** (`DataSourceBadge`, `MarketDataSourceBadge`, `SourceStateBadge`) remain
  visible, keep their exact state vocabulary, and continue showing a bare status word beside a
  colored dot, with the provider name in the `title` tooltip.
- **`TableSourceFooter` remains on every table** — exactly one per table, naming a plain source
  and its as-of. Never remove it, never merge two tables' footers, never let a badge stand in
  for it.
- **Timestamps and as-of values remain visible** and continue to derive from the data actually
  on screen.
- Genuine caveats (unofficial-rate warnings, `†` derived markers, unit notes, monitoring-estimate
  disclaimers) keep their own line.
- Fable's single `SAMPLE` badge is **not** a substitute for this system.

Detailed rules: CLAUDE.md, "Source Badge Rule".

---

## 5. Palette

The Fable palette is the same Goldman-derived institutional palette NMI already used, so
continuity is high. Signal semantics are unchanged: red is critical/negative only, green is
positive, amber is caution.

### 5.1 Brand
| Token | Hex |
|---|---|
| deepTeal | `#004A64` |
| deepNavy | `#00355F` |
| institutionalBlue | `#7399C6` |
| paleBlue | `#ACD4F1` |
| nearBlack | `#231F20` |
| coolGray | `#58575A` |
| digitalDark / digitalLight | `#202324` / `#F1F1F1` |
| critical (errors only) | `#8B0E04` |
| positive | `#3EA464` |
| secondary blues | `#88CBDF · #007DB1 · #2F6EB6 · #007FC3 · #68A6D6 · #569BBE` |

### 5.2 Theme variables
Both themes are first-class. Every token defined for one **must** have a counterpart in the
other. Exact values are transcribed in `docs/fable-integration/02-fable-design-inventory.md`
§2.2 (dark) and §2.3 (light) and are the implementation source of truth.

Two deliberate exceptions to theme-switching:
- **The Current Actions / primary action card stays deep-teal in both themes.**
- **The login is theme-independent** — its own glass palette over the Santiago photograph.

### 5.3 Purple
Purple is permitted **only** as the "Review" status/chart token (`#7A68AE` / `#B9ABE4` /
`#5E4B8B`). It carries meaning. It is never a decorative or brand color anywhere else.

### 5.4 Contrast
All text-on-background combinations must meet **WCAG AA (4.5:1 normal text, 3:1 large text)**
in **both** themes, measured against the *effective* rendered backdrop — which, for glass
surfaces, means the composited result, not the nominal token.

---

## 6. Semantic Token System (unchanged and still binding)

All color in components references semantic CSS custom properties. Never a hardcoded hex, never
a raw Tailwind color scale.

**Allowed**
```tsx
className="bg-surface text-foreground border-border"
className="text-positive"
style={{ color: 'var(--sidebar-fg)' }}
```

**Forbidden in components**
```tsx
className="bg-gray-900"        // raw Tailwind scale
className="text-emerald-400"   // raw Tailwind scale
style={{ color: '#004A64' }}   // hardcoded hex
style={{ backdropFilter: 'blur(24px)' }}  // hardcoded material value
```

This extends to the new material system: **blur radii, glass fills, shadows, radii, and motion
durations are tokens**, declared once in `src/app/globals.css` and consumed by name. A page or
component that hardcodes a Fable value is a defect even when the value is correct.

---

## 7. Liquid Glass — Approved, Governed

Liquid Glass is the signature material and is **approved**, subject to the readability,
contrast, density, and performance rules in this section. Glass that fails any of them must be
replaced with an opaque surface.

### 7.1 Material tiers
| Tier | Blur | Saturate | Fill / border |
|---|---|---|---|
| **Auth panel** | 24px | 150% | white-glass gradient; `1px rgba(255,255,255,.62)`; inset specular |
| **Navigation / header** | 24px | 145% | `--nv-hdrbg`; `1px --nv-line` |
| **Card** | 24px | 142% | `--nv-card`; `1px --nv-bd` |
| **Overlay** (command palette, drawers, menus) | 28–30px | 150% | palette 30px; menus 28px |
| **Login utility chips** | 18px | 140% | `rgba(255,255,255,.44)` |
| **Dense data (tables)** | — | — | **near-opaque `--nv-tbl`** — see §8 |
| **Scrim** | 3px | — | `rgba(4,10,16,.48)` |

`--nv-blur` (24px default) is the **single tunable knob**, range 0.4×–1.6×.

### 7.2 Governing rules
1. **Readability wins.** If text over a glass surface fails AA against the composited result,
   raise the fill opacity or move to an opaque surface. Never reduce text contrast to preserve
   an effect.
2. **Glass is for containers, not for dense content.** See §8.
3. **No stacked blur.** Never nest a blurred surface inside another blurred surface — the
   compositing cost multiplies and the result muddies. One blur layer between content and page
   background.
4. **Performance budget.** Blur is GPU-expensive. Do not apply `backdrop-filter` to elements
   that animate position/size continuously, to large scrolling regions, or per-row in a table.
   Prefer one blurred container over many blurred children.
5. **Always provide a fallback fill.** Every glass surface declares a solid/near-solid
   background so browsers without `backdrop-filter` (and print) render legibly.
6. **Print is opaque.** The print stylesheet flattens glass to solid surfaces.

---

## 8. Opacity Requirements for Dense Content (hard rule)

Dense financial data is the product. It must never be hard to read.

- **Tables, data grids, and any small-text analytical module render on a high-opacity surface**
  (`--nv-tbl`, ≈`.97` alpha) — **not** low-opacity glass.
- **Minimum fill opacity for any surface carrying text below 13px: `.92`.**
- Table headers may be glass-styled and sticky, but the header fill must remain high-opacity so
  column labels stay legible over scrolling content.
- Row hover uses a tint (`--nv-hover`), never a blur change.
- Numeric columns keep `tabular-nums lining-nums` so digits align across rows.

Glass belongs to the *card around* the table, not the table surface itself.

---

## 9. Radius Scale

Large radii are approved for major surfaces; dense analytical modules stay tighter.

| Role | Radius |
|---|---|
| Pill / capsule / nav pill | `999px` |
| Hero card | `24px` |
| Card | `22px` |
| Module | `20px` |
| Capsule card | `18px` |
| Input | `13px` |
| Menu item | `12px` |
| Table cell / dense element | `6px` |

**Rule:** authentication panels, major glass surfaces, navigation pills, and approved hero
components use the large end. **Dense tables and analytical modules use the small end.** Do not
apply a 22–24px radius to a table, a table cell, a data row, or a compact control.

---

## 10. Shadow Rules

Shadows are permitted **only to establish material hierarchy** — to say "this surface floats
above that one." They must remain restrained.

| Role | Shadow |
|---|---|
| Card | `0 22px 48px -26px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.05)` |
| Auth panel | `0 30px 70px -30px rgba(0,30,60,.45), 0 4px 16px -8px rgba(0,40,80,.18)` |
| Action card | `0 24px 50px -26px rgba(0,25,40,.7), inset 0 1px 0 rgba(255,255,255,.09)` |
| Drawer | `-30px 0 70px -30px rgba(0,0,0,.55)` |
| Primary button | `0 12px 26px -12px rgba(0,53,95,.55), inset 0 1px 0 rgba(255,255,255,.18)` |
| Command palette | `0 40px 90px -30px rgba(0,0,0,.6)` |

**Rules:** shadows are large-radius, low-opacity, and heavily offset-negative (soft, not
hard-edged). The inset top highlight is a specular cue, not a border. **Never** put a shadow on
a table row, a table cell, a chip inside a table, or a form field. Never stack shadows to create
"pop." No neumorphism.

---

## 11. Gradient Rules

Gradients are permitted in **four** cases only:

1. **Subtle material reflections** — the glass card fill (`--nv-card`) and inset speculars.
2. **Atmospheric overlays** — login photo veils, scrims, hero backdrops.
3. **Charts, where analytically justified** — e.g. an area fill under a series, or a magnitude
   ramp in a heat grid, where the gradient encodes data.
4. **Approved brand treatments** — the deep-teal action card (`--nv-actioncard`), the avatar
   monogram.

**Broad decorative gradients remain prohibited.** No gradient page backgrounds, no gradient
buttons outside the approved brand treatments, no gradient text, no rainbow/multi-hue ramps, no
gradient borders as ornament.

---

## 12. Motion Rules

Motion is permitted when it **communicates hierarchy, state, navigation, or continuity**.
Decorative or distracting motion remains prohibited.

### 12.1 Approved motion
| Purpose | Token |
|---|---|
| Primary easing | `cubic-bezier(.22,.61,.36,1)` |
| Section reveal (continuity on scroll) | 640ms, 70ms stagger, from `opacity 0 / translateY 22px / blur 8px` |
| Nav pill slide (navigation) | 380ms transform + width |
| KPI count-up (state change) | 650ms, ease-out `1-(1-t)³` |
| Bar width (state change) | 600–700ms |
| Overlay pop | 220ms |
| Drawer slide | 320ms |
| Hover transition | 150–300ms |
| Content pulse (currency/period/privacy change) | 430ms |
| Login Ken-Burns (atmosphere, login only) | 60s alternate, scale 1→1.07 |
| Login / app fade | .75s / .7s |

### 12.2 Prohibited motion
- Motion with no informational purpose — looping ambient animation on app screens, animated
  icons, parallax, bouncing, attention-seeking pulses on idle content.
- Motion that delays data. A value must never be unreadable while it animates in; count-up
  starts from a plausible value and completes fast.
- Motion on high-frequency updates — live price ticks do not animate.
- Motion that shifts layout after paint (no content jumping).
- Auto-playing animation anywhere except the login Ken-Burns backdrop.

---

## 13. Reduced Motion (hard rule)

**`@media (prefers-reduced-motion: reduce)` must always be honored.** Every animation and
transition collapses to `.01ms`, and Ken-Burns, count-up, section reveal, and pulse effects are
disabled entirely — the interface arrives in its final state.

This is not optional, not per-component, and not something a new component may skip. Any
component introducing motion must ship its reduced-motion path in the same change.

---

## 14. Navigation Rules

- **The Fable top pill navigation is the primary desktop navigation model** — a glass pill rail
  with a measured sliding indicator (380ms, primary easing).
- **Every existing NMI route must remain reachable** from it, including nested/sub-region
  navigation (e.g. Macro's Chile/US regions) and authenticated destinations.
- **Below the desktop breakpoint**, the rail becomes a horizontally scrollable pill rail
  (scrollbar hidden) or an equivalent overlay drawer. Whichever is used, it must close on
  navigation and on backdrop click, and must never cause page-level horizontal overflow.
- Active state is conveyed by the sliding indicator plus an accessible current-page signal
  (`aria-current`), never by color alone.
- **Canonical routes stay canonical.** Navigation may add a slide-in panel as a shortcut; it may
  not remove or hide a route's own page.
- The command palette (⌘K / Ctrl-K / `/`) remains a first-class navigation path.

---

## 15. Theme Rules

- **Dark mode is the first-visit default.**
- **Light mode remains fully supported** and equally maintained — not a degraded afterthought.
  Every token, material, and state is specified in both.
- **User theme choice persists** (localStorage) and takes precedence over the system preference
  on every subsequent visit. The system preference is consulted only when no choice is stored.
- The theme is applied **before first paint** by the inline script in `layout.tsx` — no flash,
  in either direction.
- Both themes must independently satisfy §5.4 contrast and §8 density rules.
- The theme control remains visible and labeled for assistive technology.

---

## 16. Logo Rules

- **The transparent blue and cyan Inversiones Nevada SVG is the authoritative logo** —
  `#1E5591` (deep blue) + `#23BAE8` (cyan), stylized peaks monogram with the "INVERSIONES
  NEVADA" wordmark.
- **Never** redraw, recolor, distort, rotate, add effects to, or place the mark in a box.
- **Full lockup** on the login screen. **Header uses a 30px-square crop of the symbol** plus
  "Inversiones Nevada" set as UI text.
- Because the mark is transparent SVG, it must be verified legible against **both** theme
  backgrounds and the login photograph; if a backdrop compromises it, change the backdrop, not
  the mark.
- Preserve graceful degradation if the asset fails to load.

---

## 17. Information Density

Every pixel carries information. Whitespace separates data groups; it does not fill space.

- Tables are the default layout for lists of companies, indicators, positions, and filings.
- Cards are for KPI summaries, hero values, and modules where a table would have 1–2 rows.
- Row padding stays tight (7–11px vertical). Do not add decorative spacing between rows.
- Glass and radius must not inflate a dense module's footprint (see §8, §9).

---

## 18. Typography

- **Family:** system stack — `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro
  Text", "Helvetica Neue", Helvetica, Arial, sans-serif`. No web-font downloads.
- **`font-variant-numeric: tabular-nums lining-nums` applies body-wide.**
- **Scale:**

| Role | Spec |
|---|---|
| loginHeadline | `clamp(32px, 4.6vw, 56px)` / 1.06 / 650 / -0.015em |
| kpiHero | `clamp(30px, 3vw, 40px)` / 1 / 650 / -0.02em |
| chartHeadline | 23–24px / 650 |
| capsuleValue | 19–22px / 650 |
| pageTitle | 19px / 650 / -0.01em |
| cardValue | 14–17px / 650 |
| body | 12–13px / 1.5 / 400–550 |
| tableCell | 11.5–12.6px |
| **sectionLabel** | **10.5px / 700 / .14em / UPPERCASE** |
| microLabel | 9–10px / 700 / .06–.12em |
| meta | 10.5–11.5px |

- Weights: 400, 500, 550, 600, 650, 700. **Maximum tracking `.14em`.**
- Section labels and table headers use the shared utility classes (`.ui-label`,
  `.ui-table-header`) at the sectionLabel spec — body font, never monospace.
- Monospace is reserved for identifiers: ticker symbols, codes, version strings. **Numeric data
  uses the body font with tabular numerals**, not monospace.
- No decorative, condensed, or display typefaces.

---

## 19. Responsive Rules

- **Intrinsic-first.** Prefer `flex: <grow> 1 <basis>px` wrapping rows, `grid auto-fit
  minmax()`, `clamp()` type, and `min-width: 0` on flex children over hard media queries.
- **Design targets:** 1440+, 1280, 1024, 768, 390. Content max-width `1560px`, centered.
- **Zero page-level horizontal overflow at every breakpoint.** This is absolute. Never
  reintroduce a root `min-width`.
- **Dense tables scroll inside their own card** (`overflow-x-auto` + a `min-w` on the table) —
  never by scrolling the page.
- Measured-height pinning binds only at the desktop breakpoint; stacked cards below it take
  natural height.
- Navigation collapses per §14. Login stacks headline over panel.
- Blur may be reduced at small sizes for performance.

Existing responsive fixes, card-level table scrolling, and mobile navigation behavior are
preserved (§2).

---

## 20. Accessibility Requirements

- **WCAG AA contrast** in both themes, against the composited backdrop (§5.4, §7.2).
- **`prefers-reduced-motion` always honored** (§13).
- **Visible focus:** `2px solid var(--nv-focus)`, offset 2px, on every interactive element.
  Never remove the focus ring; the glass background makes this more important, not less.
- **Keyboard-operable:** all controls reachable and operable by keyboard; overlays trap focus,
  close on Esc, and restore focus to their trigger.
- **Semantic markup and ARIA:** `role="dialog"` + `aria-modal` on modals/drawers,
  `aria-current` on active nav, `aria-label` on icon-only controls, `role="group"` on segmented
  toggles, live regions for async status where appropriate.
- **Never convey meaning by color alone** — pair with a word, icon, or shape (this is why source
  badges carry a status word, not just a dot).
- **Sortable table headers** expose sort state accessibly (`aria-sort`).
- Motion, blur, and transparency must never be the sole carrier of state.

---

## 21. Bilingual Interface

English and Spanish are both supported. All UI text comes from `src/lib/i18n.ts`.

- Every new visible string is added to **both** `dict.en` and `dict.es` in the same change.
- No hardcoded UI text in components — including new Fable-language strings (chip labels,
  tooltips, aria-labels, empty states).
- Data values (company names, financial figures, filing text) are not translated.
- Language choice persists in localStorage.
- Layouts must tolerate Spanish string expansion without overflow or truncation of meaning.

---

## 22. Data Presentation Standards

- Every number shows its source and timestamp. No orphan data points (§4).
- Chilean locale for financial figures: `$1.234.567,50`.
- All formatting goes through `src/lib/formatters.ts` — never an inline `toLocaleString()`.
- Abbreviate large numbers consistently (M, MM); market cap uses the single-`MM` standard.
- Units belong in column headers, not repeated per cell.
- Negative values use the negative token; sign is always explicit where it carries meaning.

---

## 23. Prohibited Implementation Patterns

| Pattern | Reason |
|---|---|
| Raw Tailwind color scales (`bg-gray-900`, `text-emerald-400`) on themed elements | Breaks theming — use semantic tokens (§6) |
| Hardcoded hex, blur, radius, shadow, or duration values in components | Materials are tokens (§6) |
| Low-opacity glass under tables or any text below 13px | Illegible dense data (§8) |
| Nested/stacked `backdrop-filter` surfaces | Compositing cost + muddy result (§7.2) |
| `backdrop-filter` on continuously animating or per-row elements | Performance (§7.2) |
| Glass with no opaque fallback fill | Breaks without `backdrop-filter` support, and in print (§7.2) |
| Large radii (20px+) on tables, cells, rows, or compact controls | Density (§9) |
| Shadows on table rows, cells, in-table chips, or form fields | Hierarchy noise (§10) |
| Stacked shadows for "pop"; neumorphism | Not institutional (§10) |
| Broad decorative gradients — page backgrounds, gradient text, multi-hue ramps | Decoration (§11) |
| Purple outside the "Review" status/chart token | Reserved semantic (§5.3) |
| Motion without informational purpose; ambient loops on app screens | Distraction (§12.2) |
| Any animation lacking a `prefers-reduced-motion` path | Accessibility (§13) |
| Removing or weakening the focus ring | Accessibility (§20) |
| Meaning conveyed by color alone | Accessibility (§20) |
| `tracking` above `.14em` | Generic dashboard aesthetic (§18) |
| Monospace on numeric data values | Body font + tabular numerals (§18) |
| Root `min-width`; page-level horizontal scroll | Responsive regression (§19) |
| Replacing a canonical route with a slide-in panel | Content preservation (§2) |
| Removing a `TableSourceFooter`, source badge, or timestamp | Data integrity (§4) |
| Shipping Fable mock/sample data, or a sample component in place of a live one | Data integrity (§3) |
| Hardcoded UI strings outside `i18n.ts` | Bilingual requirement (§21) |
| A second authentication system, or simulated/demo auth | Out of scope, security |

---

## 24. Change Control

- This document and the Fable reference are the design authority. A visual decision that
  contradicts both is a defect.
- Changing the **visual** direction requires re-approving against the Fable reference.
- Changing a **content, data, source-labeling, localization, auth, or responsive-behavior** rule
  requires an explicit product decision — the visual re-skin never justifies it on its own.
- New shared components belong in the shared component layer with tokens, both themes, both
  languages, a reduced-motion path, and accessible semantics — before any page consumes them.
- Reference material: `docs/fable-integration/01`–`06` (inventories, route/content mapping,
  implementation plan, risk register, acceptance checklist).
