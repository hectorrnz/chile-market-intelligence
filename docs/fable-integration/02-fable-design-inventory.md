# 02 — Fable Design Inventory

> **Audit phase — no application code changed.** Authoritative capture of the approved Fable
> reference export at `C:\Projects\nmi-fable-v1`. Per the merge contract, **Fable is
> authoritative for aesthetics** (typography, layout hierarchy, colors, Liquid Glass
> materials, pill controls, spacing, motion, page transitions, responsive composition, and
> login presentation). Values below are transcribed verbatim from the export and are the
> target spec for the re-skin.

---

## 1. What the export is

- **Product identity in the prototype:** "Inversiones Nevada — Private Investment Platform"
  (a family-office / private-capital dashboard). NMI is the same client; the Fable prototype
  is the visual language, **not** the data model.
- **Format:** a single-file **DC (Design Composer) template** — `<x-dc>` HTML with
  `{{ expr }}` interpolation + `<sc-if>`/`<sc-for>`/`<helmet>` directives + one
  `class Component extends DCLogic` state block, compiled to **React 18.3.1** at runtime by
  `zip-export/support.js`. **`support.js` is prototype plumbing — explicitly NOT production
  code.** All data is seeded synthetic and flagged `SAMPLE`.
- **Canonical files:**
  - `zip-export/tokens.json` — machine-readable design tokens (authoritative).
  - `zip-export/SPECS.md` — page-by-page visual spec.
  - `zip-export/README.md` — handoff overview, screen/component inventories, animation &
    interaction specs, known limitations. States: *"recreate in the target codebase; colors,
    type, spacing, radii, materials, motion, and copy are final; chart data is illustrative."*
  - `standalone-html/nevada-frontend.html` — the running prototype (inline styles).
  - `brand-assets/download1.svg` — authoritative logo; `sky-costanera.webp` +
    `uploads/pasted-…png` — Santiago login photo.
  - `handoff-documents/` and `references/` folders are **empty**; the docs live in
    `zip-export/`.

> **Key porting rule (from README):** keep data and presentation separate so real NMI APIs
> drop into Fable-styled shells without redesign. This aligns exactly with NMI's existing
> static-first + live-upgrade data architecture.

---

## 2. Design tokens (exact values)

The prototype uses **CSS custom properties (prefix `--nv-`) + inline styles**. Port these to
Tailwind v4 `@theme` tokens in `globals.css` (NMI's existing mechanism). **Every token needs a
light and a dark value** (dark is the Fable default — see §6).

### 2.1 Brand palette (`tokens.json → color.brand`)
| Token | Hex |
|---|---|
| institutionalBlue | `#7399C6` |
| deepNavy | `#00355F` |
| paleBlue | `#ACD4F1` |
| nearBlack | `#231F20` |
| coolGray | `#58575A` |
| white | `#FFFFFF` |
| deepTeal | `#004A64` |
| digitalDark | `#202324` |
| digitalLight | `#F1F1F1` |
| critical (errors only) | `#8B0E04` |
| positive | `#3EA464` |
| secondary blues | `#88CBDF, #007DB1, #2F6EB6, #007FC3, #68A6D6, #569BBE` |
| chart tertiary | `#546292, #9194B6, #C9CEE1, #7A68AE, #60C5BA, #9DC8BA, #679146, #B4CC95, #948671, #FFD457` |

> **Palette continuity is excellent news for the merge:** Fable's `#004A64` deepTeal,
> `#7399C6` institutionalBlue, `#00355F` deepNavy, `#231F20` nearBlack, `#8B0E04` critical,
> `#F1F1F1`/`#202324` digital tones are **the same Goldman-derived palette NMI already uses**.
> Signal-color semantics also match (`#8B0E04` = errors/critical only; green = gains).
> Difference: Fable's positive green is `#3EA464` (NMI light `#1A6630` / dark `#3DAA60`), and
> Fable adds a "Review" violet (`#7A68AE`/`#B9ABE4`/`#5E4B8B`) used **only** as a chart/status
> token — otherwise no purple.

### 2.2 Theme variables — DARK (default; `body` root)
| Var | Value |
|---|---|
| `--nv-blur` | `24px` (× `glassIntensity`) |
| `--nv-bg0` / `bg1` | `#0D1418` / `#12181D` |
| `--nv-text` / `text2` / `text3` | `#F1F1F1` / `#A7B2BA` / `#75818A` |
| `--nv-line` | `rgba(172,212,241,.12)` |
| `--nv-card` | `linear-gradient(168deg, rgba(27,38,48,.72), rgba(15,22,29,.58))` |
| `--nv-bd` | `rgba(172,212,241,.13)` |
| `--nv-sh` | `0 22px 48px -26px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.05)` |
| `--nv-mod` | `rgba(19,27,35,.5)` |
| `--nv-tbl` (table surface) | `rgba(15,21,27,.97)` |
| `--nv-chip` / `chipbd` | `rgba(172,212,241,.08)` / `rgba(172,212,241,.14)` |
| `--nv-acc` / `acc2` | `#ACD4F1` / `#68A6D6` |
| `--nv-deep` / `teal` | `#00355F` / `#004A64` |
| `--nv-pos` / `posbg` | `#3EA464` / `rgba(62,164,100,.16)` |
| `--nv-neg` / `negbg` | `#D4796B` / `rgba(139,14,4,.16)` |
| `--nv-crit` / `critbg` | `#ED8A7B` / `rgba(139,14,4,.28)` |
| `--nv-amb` / `ambbg` | `#FFD457` / `rgba(255,212,87,.13)` |
| `--nv-rev` / `revbg` | `#B9ABE4` / `rgba(122,104,174,.22)` |
| `--nv-neu` / `neubg` | `#A7B2BA` / `rgba(145,148,182,.16)` |
| `--nv-hdrbg` | `rgba(10,17,23,.86)` |
| `--nv-hover` | `rgba(172,212,241,.06)` |
| `--nv-onnav` | `#EAF4FC` |
| `--nv-focus` | `#68A6D6` |
| `--nv-actioncard` | `linear-gradient(160deg, #0A4157, #003A52 55%, #00304A)` |

### 2.3 Theme variables — LIGHT (`body.nv-light`)
| Var | Value |
|---|---|
| `--nv-bg0` / `bg1` | `#EEF1F3` / `#F5F6F7` |
| `--nv-text` / `text2` / `text3` | `#231F20` / `#58575A` / `#8B8E92` |
| `--nv-line` | `rgba(0,53,95,.1)` |
| `--nv-card` | `linear-gradient(168deg, rgba(255,255,255,.9), rgba(245,248,251,.75))` |
| `--nv-bd` | `rgba(0,53,95,.1)` |
| `--nv-sh` | `0 22px 44px -30px rgba(0,42,84,.25), inset 0 1px 0 rgba(255,255,255,.95)` |
| `--nv-mod` / `tbl` | `rgba(255,255,255,.66)` / `rgba(255,255,255,.97)` |
| `--nv-chip` / `chipbd` | `rgba(47,110,182,.07)` / `rgba(0,53,95,.12)` |
| `--nv-acc` / `acc2` | `#00355F` / `#2F6EB6` |
| `--nv-neg` / `crit` | `#A34A3D` / `#8B0E04` |
| `--nv-amb` | `#8A6D14` |
| `--nv-rev` | `#5E4B8B` |
| `--nv-hdrbg` | `rgba(243,246,248,.88)` |
| `--nv-hover` | `rgba(0,53,95,.05)` |
| `--nv-onnav` | `#FFFFFF` |
| `--nv-focus` | `#2F6EB6` |
| `--nv-actioncard` | `linear-gradient(160deg, #004A64, #00355F)` |

> The **Current Actions card stays deep-teal in both themes.** The **login is
> theme-independent** (its own hardcoded light-glass palette over the Santiago photo).

### 2.4 Typography
- **Font family:** `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
  "Helvetica Neue", Helvetica, sans-serif`. (NMI uses the Helvetica-Neue-first system stack —
  compatible; SF Pro is Apple-only and falls back to Helvetica Neue, matching NMI.)
- **`font-variant-numeric: tabular-nums lining-nums` applied body-wide** (matches NMI's
  `.ui-number` intent — extend it to the whole body).
- **Scale:**

| Role | Spec |
|---|---|
| loginHeadline | `clamp(32px, 4.6vw, 56px)` / lh 1.06 / 650 / -0.015em |
| kpiHero | `clamp(30px, 3vw, 40px)` / 1 / 650 / -0.02em |
| chartHeadline | 23–24px / 650 |
| capsuleValue | 19–22px / 650 |
| pageTitle | 19px / 650 / -0.01em |
| cardValue | 14–17px / 650 |
| body | 12–13px / 1.5 / 400–550 |
| tableCell | 11.5–12.6px |
| **sectionLabel** | **10.5px / 700 / letter-spacing .14em / UPPERCASE** |
| microLabel | 9–10px / 700 / .06–.12em |
| meta | 10.5–11.5px / `text3` |

Weights used: 400, 500, 550, 600, 650, 700. Max tracking `.14em` (no `tracking-widest`).

> NMI's `.ui-label` is 11px/500/0.04em/uppercase; Fable's sectionLabel is 10.5px/700/0.14em.
> The re-skin should update `.ui-label`/`.ui-table-header` to the Fable spec.

### 2.5 Spacing / radii / shadows
- **Spacing:** base `8px`; card padding `18px 20px`; hero padding `20px 22px`; grid gap
  `14px`; row padding-Y `7–11px`.
- **Radii:** pill/capsule `999px`; heroCard `24px`; card `22px`; module `20px`; capsuleCard
  `18px`; input `13px`; menuItem `12px`; cell `6px`. *(This is the direct conflict with NMI's
  current `rounded-2xl`-forbidden rule — Fable's cards are 22–24px radius.)*
- **Shadows (exact):** card `0 22px 48px -26px rgba(0,0,0,.65), inset 0 1px 0
  rgba(255,255,255,.05)`; authPanel `0 30px 70px -30px rgba(0,30,60,.45), 0 4px 16px -8px
  rgba(0,40,80,.18)`; actionCard `0 24px 50px -26px rgba(0,25,40,.7), inset 0 1px 0
  rgba(255,255,255,.09)`; drawer `-30px 0 70px -30px rgba(0,0,0,.55)`; primaryButton
  `0 12px 26px -12px rgba(0,53,95,.55), inset 0 1px 0 rgba(255,255,255,.18)`; command palette
  `0 40px 90px -30px rgba(0,0,0,.6)`.

### 2.6 Liquid Glass materials (the signature — 4 tiers + variants)
| Tier | blur | saturate | fill / border |
|---|---|---|---|
| authPanel | 24px | 150% | white-glass gradient; border `1px rgba(255,255,255,.62)`; specular `inset 0 1px 0 rgba(255,255,255,.8)` |
| navigation/header | 24px | 145% | fill `--nv-hdrbg`; border `1px --nv-line` |
| card | 24px | 142% | fill `--nv-card`; border `1px --nv-bd` |
| overlay (palette/drawer/menus) | 28–30px | 150% | palette blur 30px; menus blur 28px |
| login utility chips | 18px | 140% | `rgba(255,255,255,.44)` fill |
| **dense data (tables)** | — | — | **near-opaque `--nv-tbl` surface** — no small text on low-contrast glass |
| scrim | 3px | — | `rgba(4,10,16,.48)` |

**`--nv-blur` is the single tunable knob** (24px default, range 0.4×–1.6× via the
`glassIntensity` prop). Tables and dense data deliberately sit on a near-opaque surface for
legibility (important for preserving NMI's dense financial tables).

### 2.7 Motion tokens
| Token | Value |
|---|---|
| easingPrimary | `cubic-bezier(.22,.61,.36,1)` |
| sectionReveal | 640ms, from `opacity 0 / translateY 22px / blur 8px`, 70ms stagger, IntersectionObserver threshold .06 |
| navPillSlide | 380ms (transform + width) |
| kpiCountUp | 650ms, ease-out `1-(1-t)^3` |
| barWidth | 600–700ms |
| authFlow | verify 950ms → success 620ms → dissolve 780ms |
| kenBurns | 60s alternate, scale 1→1.07 |
| overlayPop | 220ms (`nvPop`) |
| drawerSlide | 320ms (`nvSlide`) |
| hoverTransition | 150–300ms |
| contentPulse | 430ms (on currency/period/privacy change) |
| loginFade / appFade | .75s / .7s |

**Keyframes:** `nvKen` (Ken Burns), `nvPulse` (secure dot), `nvSpin` (spinner), `nvPop`
(dropdowns/overlays), `nvSlide` (drawer), `nvIn` (login entrance).
**`@media (prefers-reduced-motion: reduce)` forces all durations to `.01ms`** — must be
carried over (accessibility).

### 2.8 Responsive strategy
- **Intrinsic-first** — no required media queries: `flex: <grow> 1 <basis>px` wrapping rows,
  `grid auto-fit minmax()`, `clamp()` type, `min-width:0` on flex children.
- **Design targets:** 1440+, 1280, 1024, 768, 390. Content max-width `1560px`, centered.
- **Mobile:** nav collapses to a **horizontally scrollable pill rail** (scrollbar hidden);
  tables scroll inside their cards; login stacks headline over panel; blur reducible.
- **Reset:** custom scrollbars (10px, `rgba(120,140,155,.28)` thumb, 99px radius);
  `::selection rgba(104,166,214,.35)`; `:focus-visible 2px solid var(--nv-focus)`, offset 2px.

> This matches NMI's existing responsive philosophy (card-level table scrolling, no page-level
> horizontal overflow) — a strong compatibility point. NMI's mobile drawer differs from
> Fable's scrollable pill rail (see doc 05 decision).

---

## 3. Fable screens catalog (11 screens + overlays)

Running view ids: `overview, portfolio, performance, risk, fixedincome, notes, macro,
research, documents, admin` + `login` (separate phase).

| # | Screen | Core composition |
|---|---|---|
| 0 | **Login (Private Access)** | Full-bleed Ken-Burns Santiago photo; deep-navy headline (left) + 402px liquid-glass auth panel (right); utility chips (secure dot, EN|ES, Santiago clock, contrast "Aa"); cursor-following specular highlight; EN/ES copy swap; simulated auth flow |
| 1 | **Overview** | Asymmetric flex rows: Total-value hero (flex 1.7) + Exposure & Liquidity + **Current Actions** (solid deep-teal); Performance chart + Risk/Macro stack; Allocation (segmented) + Attribution + Next-30-days timeline; Research & Notes; SAMPLE footer |
| 2 | **Portfolio** | Sortable/filterable holdings **DataTable** (9 cols, sticky header, weight-desc) is the page; right rail Concentration + Currency mix; row → position detail side panel |
| 3 | **Performance** | Full-width tall chart; Monthly-returns heat grid (13-col) + Statistics; Attribution-by-asset-class table |
| 4 | **Risk** | VaR/beta/duration/drawdown capsules; Limit-utilization bars + Active alerts + Liquidity stacked bar; Stress scenarios + Factor exposures + Currency exposure |
| 5 | **Fixed Income** | 6 KPI capsules; Maturity ladder (stacked cols) + Credit-quality bars; Sensitivity + Largest issuers + Coupons |
| 6 | **Structured Notes** | Capsule row; lifecycle legend chips; wide DataTable with signature **barrier gauge**; row → detail panel (12-field terms grid + lifecycle timeline) |
| 7 | **Macro** | Chile card + Global card (each row: metric/source/timestamp/previous + sparkline + value + signed delta); Upcoming releases card (HIGH/MEDIUM chips); Santiago-time footnote |
| 8 | **Research** | 8-pill decision-taxonomy legend; thesis card grid; Research queue + AI Briefs (labeled, verify-before-use) + Upcoming earnings |
| 9 | **Documents** | Single library card: search + 8 type pills → table (monogram tile, name, type, scope, date, version chip, approval pill, size) |
| 10 | **Administration** | Users & roles + Data sources (FX feed shows DELAYED amber) + Security posture chips + Notification switches + Reporting policy + Audit table |

**Global overlays (over any app screen):**
- **Command palette** — centered 560px glass at `top:13vh`, blur 30px; ⌘K/Ctrl-K toggle,
  kind-tagged results, keyboard-hint footer.
- **Notification drawer** — right `min(390px,94vw)`, `--nv-tbl` surface, severity dots,
  deep-links, "Mark all read".
- **Detail side panel** — right `min(440px,96vw)`; header (title + status/decision pill + ✕),
  optional sparkline, 2-col stats grid, decision-pill row / lifecycle timeline / note,
  pinned full-width capsule action.
- **Scrims** — dark blurred scrim (blur 3px) under overlays; invisible scrim under dropdowns;
  dismiss on outside-click or Esc.

> **Total Fable screens: 11** (`0–10`) **+ 4 overlay types** (command palette, notification
> drawer, detail side panel, scrims).

---

## 4. Fable component catalog (distinct visual treatments)

| Component | Treatment |
|---|---|
| **Liquid-glass card** | `--nv-card` gradient, `1px --nv-bd`, radius 22–24px, `--nv-sh`, `backdrop-filter: blur(var(--nv-blur)) saturate(142%)`, pad 18–20px |
| **Hero KPI card** | flex 1.7, radius 24px, 40px value, day-P&L capsule (▲/▼), inline sparkline, 4 divider-separated minis; **count-up animation** |
| **Current Actions card** | the one solid **deep-teal** card (`--nv-actioncard`); count badge, action rows, ✓ approve, top specular line; fixed light-on-teal both themes |
| **KpiCapsule** | 18px-radius capsule; label + 19–22px value + sub + optional delta/spark |
| **Segmented pill toggle** | `padding:3px` pill container, inner 999px buttons, active fill; used for currency, period (1M/3M/YTD/1Y/3Y/SI), frequency (D/W/M), allocation dims |
| **Glass sliding-indicator nav** | pill rail; absolute indicator `translateX/width` measured, 380ms `cubic-bezier(.22,.61,.36,1)`; horizontally scrollable, scrollbar hidden |
| **Portfolio selector** | chip + ▼ → 290px glass listbox |
| **Icon button (34px)** | round chip (privacy eye, bell, theme glyph); bell unread badge `--nv-acc2` |
| **Avatar menu** | 34px gradient monogram → 230px glass menu |
| **Performance chart** | SVG (860×280), gridlines + dashed zero, portfolio line `--nv-ch1` 1.8px over benchmark `--nv-ch2` 1.2px + IPSA `--nv-ch3`; event chips w/ dashed verticals; crosshair tooltip; drawdown strip |
| **Sparkline** | inline SVG `path`, `stroke-width 1.5 vector-effect:non-scaling-stroke`, 54px in rows |
| **RiskStatusPill** | 5 states → Normal/Watch/Review/Critical/Info color map, 999px, 9–9.5px/700 |
| **DecisionPill** | 8 states (Ignore/Monitor/Research/Add/Hold/Trim/Exit/Escalate) |
| **LimitBar** | name + rule, status pill, utilization bar in status color; width transition 600–700ms |
| **Barrier gauge** | 0–130 track (`2.5px`); crit-red barrier tick, text3 strike tick, glowing accent current dot (`8px` + `box-shadow 0 0 0 2.5px rgba(104,166,214,.25)`) |
| **Maturity ladder** | stacked per-year columns (gov over corp), legend |
| **Monthly-returns grid** | 13-col, cells tinted by sign/magnitude (≤.5α), year totals |
| **Macro snapshot row** | metric/source over timestamp/previous + sparkline + value + signed delta |
| **Event timeline** | date-chip + type-colored tag (MACRO/DEADLINE/EARNINGS/COUPON/OBSERVATION/COMMITTEE) |
| **Thesis card / AI brief** | decision pill + owner/review/catalyst; AI briefs in dashed module w/ "AI-GENERATED" badge + verify note |
| **DataTable** | sticky header on `--nv-tbl` surface, sortable `<th>` (arrow), 10px/700 uppercase headers, row hover `--nv-hover`, row→panel; horizontal scroll inside card via `min-width` |
| **Search / command bar** | pill button w/ search glyph + "Search" + `⌘K` kbd chip |
| **Badge/chip family** | SAMPLE (amber), status pills, version chips, approval pills (Approved/Final/Executed green, In-review violet, Draft/Received neutral) |
| **Login auth panel** | 402px liquid-glass; eyebrow + "Welcome back", error banner, 13px-radius inputs, Show/Hide, remember switch, navy 999px "Sign in" (spinner→✓), outline passkey, demo-credentials chip |
| **Toggle switch** | 30×18px track, 13px sliding knob, .25s |
| **Detail side panel** | 440px drawer; header pill, sparkline, stats grid, decision-pill row, lifecycle timeline, note, pinned capsule action |
| **PrivacyValue** | masks monetary strings to `•••••` when privacy mode on |

---

## 5. Brand assets & lockup rules

- **Logo** (`download1.svg`, 435×348): stylized peaks "N/M" monogram in `#1E5591` (deep blue)
  + `#23BAE8` (cyan) with an "INVERSIONES NEVADA" pixel-letterform wordmark. **Rules:** never
  redraw/recolor/distort/box; full lockup on login; **header uses a 30px-square crop of the
  symbol** + "Inversiones Nevada" as UI text.
  - ⚠️ NMI currently ships `/nevada-logo-light.jpg` + `/nevada-logo-dark.png` (raster, via
    `BrandLogo`). The Fable logo is a **cyan/blue SVG** distinct from NMI's current navy
    raster mark → asset reconciliation needed (doc 04).
- **Santiago photo** (`sky-costanera.webp` / `uploads/pasted-…png`, 1400×800) — the login
  background, `object-position:58% 30%`, Ken-Burns.
- **Fonts:** none shipped — system stack by name only (matches NMI).
- **Icons:** minimal inline stroked SVGs (search, eye, bell); README suggests Lucide in
  production. NMI currently uses inline stroke SVGs (no icon library) — keep that approach or
  adopt Lucide as a deliberate, documented dependency decision.

---

## 6. Critical deltas vs current NMI design (decisions surfaced in docs 04/05)

| Aspect | Current NMI | Fable target |
|---|---|---|
| **Default theme** | **Light** (localStorage `theme`) | **Dark** (light = `body.nv-light` swap) |
| **Materials** | Flat surfaces; glassmorphism/backdrop-blur **forbidden** by design_principles.md | **Liquid Glass** (4 blur tiers, saturate 142–150%) is the signature |
| **Card radius** | `rounded-2xl`+ forbidden (≤ `rounded-lg`) | 22–24px cards, 999px pills |
| **Shadows** | Drop shadows forbidden (flat) | Deep layered shadows + inset speculars |
| **Motion** | Animated transitions/counters forbidden | Section reveal, count-up, nav slide, Ken-Burns, drawer/pop |
| **Gradients** | Forbidden | Card fills, action card, login veils are gradients |
| **Nav** | Static navy sidebar (`w-52`) + mobile drawer | Glass top pill-rail with sliding indicator (+ mobile scroll rail) |
| **Section label** | 11px/500/0.04em | 10.5px/700/0.14em |
| **Positive green** | `#1A6630` (L) / `#3DAA60` (D) | `#3EA464` |
| **Login shell** | Inside AppShell (sidebar+topbar visible) | Full-bleed cinematic, no shell |
| **Detail views** | Full pages | Slide-in detail side panel option |
| **Data-source labels** | Rigorous badge + `TableSourceFooter` system | Only a `SAMPLE` badge + inline source/timestamp in macro rows |

> **These deltas do not conflict with the merge contract — they ARE the merge contract**
> (Fable authoritative for aesthetics). The reconciliation work is: (1) rewrite
> `docs/design_principles.md` to the Fable language (doc 04, task 0); (2) preserve NMI's
> data-source/data-quality labeling system and re-skin it in Fable's chip language (doc 05);
> (3) resolve the light-vs-dark default and the nav sidebar-vs-pillrail decisions (doc 05
> open decisions). Everything else is additive re-styling.

---

## 7. Fable content **not backed by NMI data** (excluded per merge-contract point 4)

These Fable screens/modules are seeded `SAMPLE` and have **no NMI data source** — their
*visual language* is harvested but the *sample content* is excluded from production:

- **Performance** screen as a standalone (monthly-returns heat grid, attribution-by-class,
  drawdown strip) — no NMI performance-attribution dataset. *Chart styling reused in
  Compare/Charting/Company/Portfolio.*
- **Risk** screen (VaR, beta, limit utilization, stress scenarios, factor exposures) — no NMI
  risk engine/data. *Capsule + limit-bar language reusable if/when data exists.*
- **Fixed Income** screen (maturity ladder, credit quality, coupons) — no NMI fixed-income
  data.
- **Research** screen (thesis cards, AI briefs, decision taxonomy) — no NMI research data.
  *"Upcoming earnings" module maps to NMI Earnings.*
- **Documents** screen — NMI deliberately **removed** the Documents viewer (`/documents`
  route deleted per CLAUDE.md). *DataTable language reusable.*
- **Administration** screen (users/roles, data-sources health, audit history) — mostly
  sample. *Notification switches map to NMI `/settings/notifications`; Data-sources-health
  language could later surface NMI's real `/api/health/ingestion`.*
- **Login extras** — simulated auth flow, demo-credentials chip, passkey button, "remember
  device" → excluded/replaced by NMI's real Supabase auth (points 5, 6). Ken-Burns visual +
  EN|ES + clock + contrast toggle are kept.
- **Privacy mask (`•••••`)**, **portfolio selector** (3 sample portfolios) — optional
  additive features, not required content.

Full per-route resolution of these is in **doc 03** (columns "new component required" and
"Fable component mapping").
