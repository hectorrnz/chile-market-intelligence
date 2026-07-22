# 05 — Risk & Regression Register

> **Audit phase — no application code changed.** Enumerates the risks the Fable re-skin
> introduces, the regression surfaces to protect, and the open decisions the user must resolve
> before implementation. Severity: **P0** (contract-breaking / must not regress), **P1** (high),
> **P2** (medium). Each risk lists a mitigation and the guardrail that catches it.

---

## A. Decisions — RESOLVED (Phase 0, 2026-07-22)

These were the choices only the user could make. **All are now decided** and encoded in
`docs/design_principles.md` + CLAUDE.md. The "Recommendation" column is retained as the record of
what was proposed; **"Decision" is binding.** Note D3 and D4 where the outcome differs from, or
tightens, the original recommendation.

| # | Decision | Options | Recommendation (at audit) | **DECISION (binding)** |
|---|---|---|---|---|
| D1 | **Default theme** | Fable defaults **dark**; NMI defaulted **light**. | Adopt Fable dark; keep light fully supported and keep respecting a saved preference. | ✅ **Dark is the first-visit default.** Light remains **fully supported and equally maintained** — every token/material/state specified in both. User choice persists and **takes precedence over the system preference** on every later visit; system preference consulted only when nothing is stored. Pre-paint application, no flash either direction. → principles §15 |
| D2 | **Theme class mechanism** | `.dark` on `<html>` (current, pre-paint script) vs Fable's `body.nv-light`. | Keep `.dark`-on-`<html>`; express light under `:root`, dark under `.dark`. Avoid a second class system. | ⚠️ **Implementation detail — deferred to Phase 1.** Not a product decision; the user's ruling is on *behavior* (D1), which either mechanism satisfies. Recommendation stands: **one** class system, no `body.nv-light` alongside `.dark`. Note the inversion implied by D1 — dark is now the default state, so the pre-paint script's default branch flips. |
| D3 | **Navigation model** | Keep NMI left navy sidebar restyled in glass; OR adopt Fable's glass **top pill-rail** with sliding indicator. | Keep the left sidebar (preserves Macro accordion, mobile drawer, `responsiveLayout.test.ts`; NMI's nav is denser than Fable's rail). | ✅ **OVERRIDDEN — Fable top pill navigation is the primary desktop model.** Constraints attached: **every existing route must remain reachable**, including sub-region nav (Macro Chile/US); below desktop it becomes a horizontally scrollable pill rail or equivalent drawer that closes on navigate/backdrop; `aria-current` for active state; zero page-level horizontal overflow. → principles §14. **This is a sub-project**: `SidebarProvider` semantics and `tests/responsiveLayout.test.ts` change deliberately (see B5, C-series). |
| D4 | **Detail views** | Keep full pages for company / position / note; OR adopt Fable slide-in detail panels. | Keep full pages; panels only as an additive quick-look. | ✅ **Confirmed, and tightened: dynamic detail routes remain full pages.** Slide-in panels are **supplementary and may not replace a canonical route** — they may enrich a list view, never become the only path to content that has its own URL. → principles §2 |
| D5 | **Brand logo** | Fable cyan/blue SVG (`#1E5591`/`#23BAE8`) vs NMI navy raster (`/nevada-logo-*`) vs merged mark. | Confirm which is the real brand mark. | ✅ **The transparent blue + cyan Inversiones Nevada SVG is authoritative.** Never redraw/recolor/distort/box. Full lockup on login; 30px symbol crop + "Inversiones Nevada" as UI text in the header. Because it is transparent, legibility must be verified against **both** theme backgrounds and the login photo — if a backdrop compromises it, change the backdrop. Keep graceful degradation on load failure. → principles §16 |
| D6 | **Motion implementation** | Pure CSS + WAAPI (zero deps) vs a motion library (README suggests Framer Motion). | Pure CSS + WAAPI. | ✅ **Pure CSS transitions/keyframes + WAAPI.** Resolved by the standing "no new libraries without a documented decision" rule rather than by new instruction; now stated explicitly in CLAUDE.md. Motion is approved **when it communicates hierarchy, state, navigation, or continuity**; decorative/ambient motion prohibited; **`prefers-reduced-motion` always honored**. → principles §12–§13 |
| D7 | **Fable-only screens** (Risk, Fixed Income, Research, Documents, Admin, Performance-standalone, portfolio selector, privacy mask) | Exclude sample content; optionally build real versions later. | Exclude now; harvest the visual language. | ✅ **Excluded.** **Fable mock financial data must never enter production**, and **no static sample component may replace a live NMI component.** Harvest visual language only. Privacy mask remains an optional additive feature. → principles §3 |

**Still open (implementation-level, not product-level):** D2 only — settle it at the top of Phase 1.

### A.1 Additional governance rules ratified in Phase 0

Beyond D1–D7, these were ruled on directly and are now binding in `design_principles.md`:

- **Liquid Glass approved — governed.** Permitted subject to explicit readability, contrast,
  density, and performance rules: readability beats effect, no stacked blur, no `backdrop-filter`
  on continuously-animating or per-row elements, always an opaque fallback fill, opaque in print.
  (§7)
- **Dense tables use high-opacity surfaces, not low-opacity glass** — `--nv-tbl` ≈.97, hard minimum
  `.92` for any surface carrying text below 13px. Glass belongs to the card *around* the table. (§8)
- **Gradients** permitted only as subtle material reflections, atmospheric overlays, charts where
  analytically justified, or approved brand treatments. Broad decorative gradients still prohibited. (§11)
- **Shadows** permitted only to establish material hierarchy, and restrained; never on table rows,
  cells, in-table chips, or form fields; no stacking, no neumorphism. (§10)
- **Large radii** for auth panels, major glass surfaces, nav pills, approved heroes; **dense tables
  and analytical modules use small radii** (6px cell). (§9)
- **Source badges, `TableSourceFooter`, data-quality disclosures, and timestamps stay visible** —
  restyled, never removed. Fable's single `SAMPLE` badge is not a substitute. (§4)
- **Content-preservation and data-integrity are non-negotiable** and outrank any visual rule. (§2, §3)

---

## B. P0 risks — contract-breaking; must not regress

### B1 · Second auth system / auth flow regression (merge points 5, 6)
- **Risk:** Fable's login ships a *simulated* auth flow (any email + any password, demo chip,
  passkey button, "remember device"). Copying it verbatim would create a fake second auth path
  or bypass Supabase.
- **Mitigation:** Re-skin the login **shell** only; keep the real `POST /api/auth/login|register|
  forgot-password|reset-password` calls, username+password, `next` redirect, and error mapping.
  Do not add passkey/demo/simulated logic. Do not touch `src/middleware.ts` protection lists or
  `src/lib/auth/*`.
- **Guardrail:** `tests/authWatchlist.test.ts`, `tests/credentials.test.ts`,
  `tests/passwordResetAndUpdateButton.test.ts`; manual sign-in/out + protected-route redirect.

### B2 · Login moves out of shell breaks route protection or shell (merge points 5, 9)
- **Risk:** Introducing an `(auth)` route group / full-bleed layout for the cinematic login
  could accidentally change how protected routes render or drop the provider tree for auth pages.
- **Mitigation:** Middleware keys on **pathname**, not layout — protection is unaffected by a
  route group. Ensure the auth layout still mounts `LangProvider` (EN|ES chip needs it) and
  `ThemeToggle` mechanism (contrast toggle). Verify `/login?next=…` redirect round-trips.
- **Guardrail:** middleware tests + manual redirect checks; build must still enumerate all routes.

### B3 · Source labels / data-quality disclosures lost or weakened (merge points 10, 11)
- **Risk:** Fable shows only a `SAMPLE` badge + inline source/timestamp. Re-skinning could drop
  NMI's rigorous `DataSourceBadge`/`MarketDataSourceBadge`/`SourceStateBadge` +
  `TableSourceFooter` system, or a module could be left showing static sample as a terminal
  state, or a badge could regain a hardcoded hex.
- **Mitigation:** Restyle these components in glass **preserving states, labels, tooltips, and
  the one-footer-per-table rule**. Never present a static module as terminal (point 11) — the
  live/persisted/derived/static-fallback/temporary-static/blocked/unavailable classification and
  `docs/data_source_status.md` matrix stay in force. Badges keep semantic tokens.
- **Guardrail:** `tests/tableSourceFooterConvention.test.ts`, `tests/dataSourceAudit.test.ts`,
  `tests/auditSourceIntegrity.test.ts`, `tests/homeWatchlistOverhaul.test.ts`.

### B4 · Dark-mode contrast regression on glass (merge point 8)
- **Risk:** Liquid Glass (transparent, blurred, gradient) can drop text below WCAG AA,
  especially small table text on low-contrast glass, and especially in the *non-default* theme.
- **Mitigation:** Fable already solves this — **dense data sits on the near-opaque `--nv-tbl`
  surface**, not on translucent glass. Apply that rule to every NMI table. Define every token in
  both themes; verify AA for body + table text in light and dark.
- **Guardrail:** manual contrast audit per route in both themes; consider a contrast unit check.

### B5 · Page-level horizontal overflow / lost responsive fixes (merge point 9)
- **Risk:** Glass cards with fixed radii/padding, wider chart SVGs, or a nav change reintroduce
  page-level horizontal scroll or break card-level table scrolling / the mobile drawer.
- **Mitigation:** Preserve the responsive conventions verbatim: no root min-width, responsive
  grid prefixes, `overflow-x-auto` + `min-w` on dense tables, measured-height pinning only at
  `lg+`, sidebar `hidden lg:flex` + drawer. Keep Fable's own intrinsic-first + `min-width:0`
  approach.
- **Guardrail:** `tests/responsiveLayout.test.ts`; browser ladder 1728→390 in both themes.

### B6 · i18n regression — hardcoded Fable copy (merge point 7)
- **Risk:** Fable's English sample strings ("Welcome back", "Private Access", "Sign in", utility
  chips) get hardcoded, breaking Spanish.
- **Mitigation:** Every visible Fable string routed through `t.*`; add EN+ES keys for genuinely
  new strings. No literal UI text in components.
- **Guardrail:** grep for hardcoded strings in changed pages; visual ES pass per route.

### B7 · Business logic / API / schema touched (merge point 5)
- **Risk:** A "quick" edit strays into `src/lib/providers|db|financials|structuredNotes`, an API
  route, `middleware.ts`, `vercel.json`, or a migration.
- **Mitigation:** Hard scope boundary (doc 04 "NOT changed"). Re-skin PRs touch only presentation
  files. Data flow (static-first + `fetch*`/provider-hook live upgrade) is identical.
- **Guardrail:** the ~65 business-logic tests must stay green untouched; PR review scopes files.

---

## C. P1 risks — high

### C1 · Design-governance contradiction (Phase 0 blocker)
- **Risk:** `docs/design_principles.md` forbids glassmorphism/gradients/`rounded-2xl`/shadows/
  motion, and `CLAUDE.md` cites it as authoritative + "don't change design without asking."
  Every re-skin PR would appear to violate the repo's own rules, and future prompts/agents may
  "correct" the glass back to flat.
- **Mitigation:** **Phase 0 first** — rewrite `design_principles.md` and the CLAUDE.md design
  sections to the Fable language before writing code. Point them at `docs/fable-integration/`.
- **Guardrail:** doc review; no code before the design authority is updated.

### C2 · Theme-toggle rule contradiction
- **Risk:** CLAUDE.md and `design_principles.md` mandate a specific segmented-pill theme toggle
  and even a test (`homeWatchlistOverhaul`/others reference wording). Fable uses a contrast/theme
  glyph. Changing it without updating the rule looks like a regression.
- **Mitigation:** Decide the toggle presentation (glyph vs pill) as part of Phase 0; keep the
  persisted `theme` mechanism and `aria` regardless.
- **Guardrail:** any test asserting toggle markup updated deliberately.

### C3 · Motion causing distraction / accessibility issues
- **Risk:** Section reveals, count-up, Ken-Burns, pulses can violate `prefers-reduced-motion`,
  hurt performance, or (count-up on financial figures) momentarily show wrong numbers.
- **Mitigation:** Gate all motion behind `@media (prefers-reduced-motion: reduce)` (Fable does);
  keep count-up subtle and reduced-motion-safe (or skip it for precise financial values); no
  auto-playing loops except the opt-in login Ken-Burns.
- **Guardrail:** reduced-motion manual check; performance spot-check on the dense Home page.

### C4 · Backdrop-filter performance & browser support
- **Risk:** Heavy `backdrop-filter: blur(24px) saturate(150%)` across many stacked cards can
  jank on lower-end devices; some engines throttle it.
- **Mitigation:** Use the tunable `--glass-blur` knob; limit blur to top-level cards/overlays,
  not every nested element; near-opaque table surfaces avoid blur on the densest content.
- **Guardrail:** manual perf check; provide a low-motion/low-blur fallback path.

### C5 · Persisted UI state (`cmi.*`) and window events broken by restructure
- **Risk:** 20+ `usePersistentState` keys (`cmi.compare*`, `cmi.gf*`, `cmi.ratesOrder`,
  `cmi.chartTimeframe`, `cmi.macroRegion`, `cmi.sidebarCollapsed`) and window events
  (`macro:region`, `gf:ticker`, `cmdk:open`) drive real UX; a markup rewrite can silently drop a
  handler or key.
- **Mitigation:** Treat these as content to preserve (they are user state). Keep every key name,
  event name, and handler. If the sidebar model changes, re-wire `macro:region` +
  `cmi.macroRegion` explicitly.
- **Guardrail:** manual per-page interaction verification (sort persists, chart timeframe
  persists, compare slots persist, rates order persists, deep-link `gf:ticker` works).

### C6 · Chart legibility & correctness after restyle
- **Risk:** Restyling the 4 SVG charts could break the ResizeObserver sizing, hover crosshair,
  markers, or dual-axis scaling (`FundamentalsChart` NaN-guards).
- **Mitigation:** Keep all chart props + measurement logic; change only stroke/fill/axis styling.
  Preserve marker system (EEFF dates on Company), compare series, and axis NaN guards.
- **Guardrail:** `tests/returns.test.ts`, visual chart checks per page.

### C7 · Login asset & brand reconciliation
- **Risk:** Missing Santiago photo or wrong logo variant produces a broken login; the Fable SVG
  logo differs from NMI's current raster.
- **Mitigation:** Add the login photo to `public/`; resolve D5; keep `BrandLogo`'s onError
  graceful-degrade so a missing asset never shows a broken glyph.
- **Guardrail:** manual login render in both themes.

---

## D. P2 risks — medium

| # | Risk | Mitigation | Guardrail |
|---|---|---|---|
| D-a | **Section-label/typography test drift** — `.ui-label` spec change (11px/500/0.04em → 10.5px/700/0.14em) may break tests asserting the old values | Update the typography utilities + any asserting test deliberately | typography-related tests |
| D-b | **News feed / sector heat map / rates DnD have no Fable analog** (merge point 3) | Build them as new glass-language components; don't drop them | manual Home verification |
| D-c | **CSV export / Print** buttons could be lost in a toolbar restyle | Preserve `exportCSV` (Stocks/Compare/Charting/Earnings) and `window.print()` (Company) | manual export/print checks |
| D-d | **NotificationBell → drawer** could break polling or auth-gating | Keep polling, `signedIn` gate, `useEscape`, optimistic mark-read | `tests/notificationsPlatform.test.ts` |
| D-e | **CommandPalette restyle** could break ⌘K/`/`/`cmdk:open` or recent-search routing | Keep all key handlers + `getAllCompanies` routing | manual ⌘K check |
| D-f | **New dependency creep** (Framer Motion, Lucide, chart lib) violates "no new libraries" | Prefer pure CSS/WAAPI + inline SVG icons (status quo); document any dep explicitly | package.json review |
| D-g | **Purple/gradient misuse** — Fable reserves violet for chart/Review token and `#8B0E04` for critical only | Encode these as tokens + note in design_principles; never general purple | design review |
| D-h | **Empty/loading/error state styling drift** — glass restyle could visually swallow an EmptyState or loading text | Restyle `EmptyState` + keep every `t.common.loading`/empty/error branch per route | per-route state checks (doc 06) |
| D-i | **Metadata / favicon / SEO** — layout changes could drop `robots:{index:false}` or the favicon | Preserve `layout.tsx` metadata block | build check |
| D-j | **Print tearsheet** (`@media print`, `.no-print`) could break if glass cards/overflow containers change | Keep `.no-print` on shell chrome + print unlocks in `globals.css` | manual print check on Company |

---

## E. Regression-surface checklist (protect during every phase)

- **Auth:** sign-in, create-account, forgot/reset, sign-out; protected redirects for
  `/watchlist`, `/portfolio`, `/structured-notes`, `/structured-notes/[id]`, `/settings/*`;
  401 on protected APIs; cron routes untouched.
- **i18n:** every route renders correctly in EN and ES; no hardcoded strings.
- **Dark mode:** every route legible in light and dark; pre-paint no-flash preserved.
- **Responsive:** ladder 1728→390, both themes; no page-level horizontal overflow; tables scroll
  in-card; mobile nav works.
- **Source integrity:** every table has exactly one `TableSourceFooter` with a plain source
  name; badges show correct state word + tooltip; no module static as a terminal state.
- **Data flow:** static-first render + `fetch*`/provider-hook live upgrade unchanged; `Update`
  buttons refresh; persisted `cmi.*` state + window events intact.
- **Charts:** sizing, hover, markers, dual-axis all functional.
- **Exports/print:** CSV on Stocks/Compare/Charting/Earnings; print on Company.
- **Notifications & command palette:** bell polling + drawer; ⌘K search + routing.
- **Tests:** all 75 test files green (business-logic tests untouched; DOM tests updated only
  deliberately).
- **Build/lint:** `npm run build` 0 errors, `npm run lint` 0, at every phase boundary.
