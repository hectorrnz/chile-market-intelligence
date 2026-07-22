# 01 — Current NMI Inventory

> **Audit phase — no application code changed.** This document is the authoritative
> snapshot of the existing Nevada Market Intelligence (NMI) frontend as it stands on
> branch `feat/fable-frontend-integration` (2026-07-21). It is the "before" side of the
> Fable merge contract: every item listed here must survive the visual re-skin.

---

## 1. Framework & build configuration

| Concern | Value |
|---|---|
| Framework | **Next.js 16.2.9** (App Router, `src/app/`) |
| React | **19.2.4** / react-dom 19.2.4 |
| Language | **TypeScript** strict mode (`tsconfig.json` → `strict: true`, `target: ES2017`, `moduleResolution: bundler`, `allowImportingTsExtensions: true`, `noEmit`) |
| Styling | **Tailwind CSS v4** via `@tailwindcss/postcss` — **no `tailwind.config.ts`**. Theme is declared with `@theme inline` + CSS custom properties inside `src/app/globals.css` |
| Bundler | **Turbopack** (`next.config.ts` sets `turbopack.root`) |
| Path alias | `@/*` → `./src/*` (tsconfig `paths`) |
| Lint | ESLint 9 + `eslint-config-next` 16.2.9 |
| Tests | `node --test "tests/*.test.ts"` — Node's built-in runner strips TS types natively; **zero test-framework deps**. 75 test files (see §12) |
| Deploy | **Vercel**; `vercel.json` declares **4 cron schedules** (see §9) |
| Runtime deps | `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`, `react-dom`, `unpdf` (serverless pdf.js text extraction, structured notes), `yahoo-finance2` |
| Dev deps | `@tailwindcss/postcss`, `tailwindcss`, `typescript`, `eslint`, `eslint-config-next`, `supabase`, `@types/*` |

**Merge-contract implication:** No CSS framework swap. The Fable visual language must be
expressed **through Tailwind v4 `@theme` tokens + `globals.css`** (the same mechanism already
in place), not by introducing a second styling system. There is currently **no web-font
download** (system font stack only) and **no animation/motion library** — Fable motion will
need either CSS or a deliberately-added, minimal mechanism.

---

## 2. Route tree

### 2.1 Page routes (16 rendered pages)

| # | Route | File | `'use client'`? | Auth |
|---|---|---|---|---|
| 1 | `/` | `src/app/page.tsx` | client | public |
| 2 | `/stocks` | `src/app/stocks/page.tsx` | client | public |
| 3 | `/compare` | `src/app/compare/page.tsx` | client | public |
| 4 | `/chart-builder` | `src/app/chart-builder/page.tsx` | client | public |
| 5 | `/macro` | `src/app/macro/page.tsx` | client | public |
| 6 | `/macro/calendar` | `src/app/macro/calendar/page.tsx` | client | public |
| 7 | `/earnings` | `src/app/earnings/page.tsx` | client | public |
| 8 | `/companies/[ticker]` | `src/app/companies/[ticker]/page.tsx` | client | public |
| 9 | `/watchlist` | `src/app/watchlist/page.tsx` | client | **protected** |
| 10 | `/portfolio` | `src/app/portfolio/page.tsx` | client | **protected** |
| 11 | `/structured-notes` | `src/app/structured-notes/page.tsx` | client | **protected** |
| 12 | `/structured-notes/[id]` | `src/app/structured-notes/[id]/page.tsx` | client | **protected** |
| 13 | `/settings/notifications` | `src/app/settings/notifications/page.tsx` | client | **protected** |
| 14 | `/login` | `src/app/login/page.tsx` | client | public (auth) |
| 15 | `/forgot-password` | `src/app/forgot-password/page.tsx` | client | public (auth) |
| 16 | `/auth/reset-password` | `src/app/auth/reset-password/page.tsx` | client | public (auth) |

Plus a non-page redirect handler: `src/app/logout/route.ts` (GET/POST → signOut → `/`).

> **Total NMI page routes: 16.** (13 in-shell app pages + 3 auth pages. `/companies/[ticker]`
> and `/structured-notes/[id]` are dynamic.)

### 2.2 API route handlers (60 endpoints)

Grouped by domain (all under `src/app/api/`):

- **auth** (4): `forgot-password`, `login`, `register`, `reset-password`
- **macro** (7): `route`, `history/[indicatorId]`, `ingestion-status`, `yield-curve`, `fx/us`, `fred-release-calendar`, `fomc-expectations`
- **market** (7): `stocks`, `stocks/[ticker]`, `stocks/[ticker]/history`, `indices`, `sectors`, `live-snapshot`, `ingestion-status`
- **compare** (2): `route`, `history`
- **earnings** (3): `route`, `results`, `calendar`
- **financials** (4): `coverage`, `[ticker]/metrics`, `[ticker]/statements`, `cmf-xbrl/status`
- **valuation** (1): `[ticker]`
- **news** (1): `route`
- **watchlists** (3): `route`, `[id]/items`, `[id]/items/[ticker]`
- **portfolios** (7): `route`, `[id]`, `[id]/positions`, `[id]/positions/[ticker]`, `[id]/cash`, `[id]/transactions`, `[id]/transactions/[transactionId]`
- **structured-notes** (7): `route`, `[id]`, `[id]/allocations`, `[id]/allocations/[allocationId]`, `extract`, `import`, `monitoring-status`
- **notifications** (4) + **notification-recipients** (2): feed read/read-all, `[id]/read`, recipients CRUD
- **health** (1): `health/ingestion`
- **cron** (9): `ingest-bcch-macro`, `ingest-fred-macro`, `ingest-market-snapshot`, `check-ingestion-health`, `refresh-calendar-enrichment`, `structured-notes/snapshot`, `financials/cmf-bank`, `financials/cmf-xbrl`, `financials/yahoo`

> **These 60 API routes are business-logic surface and are OUT OF SCOPE for the Fable
> re-skin.** They must not be renamed, moved, or altered. The frontend calls them via the
> `src/lib/data/*` client helpers.

---

## 3. Layout & shell composition

Single root layout: `src/app/layout.tsx`. **There is no nested/route-group layout** — every
route (including `/login`, `/forgot-password`, `/auth/reset-password`) renders inside the
same `AppShell`, so the sidebar + top bar currently wrap the auth pages too (the login page
just centers itself within `<main>`).

`layout.tsx` responsibilities:
- `<html lang="en" className="h-full" suppressHydrationWarning>` — root lang attribute is a
  static `"en"` (the app's live language is client-side via `LangProvider`, not this attr).
- **Pre-paint theme script** (inline `<script>` in `<head>`): reads `localStorage.theme`
  (or `prefers-color-scheme`) and adds `.dark` to `<html>` before first paint → no theme
  flash. **Must be preserved.**
- Rich `metadata` (title template `%s · NMI`, `robots: { index:false }`, favicon, openGraph)
  and `viewport` (`width=device-width, initialScale=1`).
- Body: `className="h-full bg-background text-foreground"` → `<AppShell>{children}</AppShell>`.

`src/components/layout/AppShell.tsx` provider/shell nesting (order matters):

```
LangProvider
 └ MarketDataProvider        (live market snapshot, app-wide, survives navigation)
    └ MacroDataProvider      (live macro snapshot, app-wide)
       └ SidebarProvider     (collapse + mobile drawer state)
          └ <div flex h-full overflow-hidden>       ← print:block print:h-auto
              ├ <Sidebar />                          (.no-print)
              └ <div flex-col flex-1 min-w-0>
                  ├ <TopBar />                        (.no-print)
                  └ <main flex-1 overflow-y-auto      px-3 py-4 sm:px-6 sm:py-5>
                      {children}
              <CommandPalette />                       (⌘K modal, app-wide)
```

**Merge-contract implications**
- The four providers (Lang, MarketData, MacroData, Sidebar) and `CommandPalette` are global
  and must remain mounted. The Fable shell must wrap the same provider tree.
- `main` uses `overflow-y-auto` with responsive padding — the scroll container and
  `print:` unlock behavior must survive.
- If Fable wants a full-bleed login/marketing shell, that requires a **new nested layout or
  route group** (an additive change) rather than removing the global shell — see doc 04.

---

## 4. Navigation

`src/lib/navigation.ts`:
- `navItems: NavItem[]` — **9 primary items**, each `{ key, href, icon }`:
  `home /`, `stocks /stocks`, `compare /compare`, `charting /chart-builder`,
  `macro /macro`, `earnings /earnings`, `watchlist /watchlist`, `portfolio /portfolio`,
  `structuredNotes /structured-notes`. (`soon?` flag exists but is unused now.)
- `getPageTitle(pathname, lang, t)` — resolves the TopBar breadcrumb title, including the
  `/companies/[ticker]` special case (`Stocks · TICKER`).

`src/components/layout/Sidebar.tsx` (client):
- Renders `SidebarContent` in **two** presentations (shared inner markup):
  1. **Desktop static column** — `w-52`, `hidden lg:flex`, only when not `collapsed`.
  2. **Mobile overlay drawer** — `fixed inset-0 z-[80] lg:hidden`, opened by the TopBar
     hamburger via `SidebarProvider.mobileOpen`; closes on backdrop click or navigation.
- Brand block: "NMI" monogram (`font-mono`, `--sidebar-accent`) + "Nevada Market
  Intelligence" subtitle + signed-in `displayName` (from `useAuthDisplay`).
- Nav items use inline `--sidebar-*` CSS vars; **active item** = left border-accent +
  `--sidebar-active` bg. Icons are inline stroke SVGs (`NavIcon`, **no icon library**).
- **Macro is an expandable accordion** with Chile / US sub-links — clicking a region writes
  `cmi.macroRegion` (persistent) and dispatches a `macro:region` window event the Macro page
  listens for. Auto-expands on macro routes (render-time previous-value pattern).
- Footer: `v0.1.0 · mvp` version string + Sign in / Sign out link (driven by `authReady`).

`src/components/layout/TopBar.tsx` (client):
- Left: hamburger (viewport-aware toggle), `BrandLogo` (`hidden sm:block`), `NMI /` crumb
  (`hidden md:inline`), page title (truncates).
- Center: **command-palette search trigger** — full-width button dispatching `cmdk:open`,
  shows `⌘K` kbd hint.
- Right: `NotificationBell`, `LangToggle`, `ThemeToggle`, today's date (`hidden xl:inline`,
  locale-aware `es-CL`/`en-US`).
- Compresses responsively (`min-w-0` + `truncate`, progressive `sm:`/`md:`/`xl:` hides).

---

## 5. Authentication (single system — do not duplicate)

- **Mechanism:** Supabase Auth, **username + password** (Phase 6B — replaced the earlier
  magic-link flow). Session is set by the server directly on the HTTP response via
  `src/lib/auth/sessionCookies.ts` (`createSessionWriterClient`).
- **Middleware** (`src/middleware.ts`):
  - Refreshes the Supabase session cookie on every non-static request (`createServerClient`
    from `@supabase/ssr`, `getSession()` — cookie-only, no network call).
  - `PROTECTED_PAGES = ['/watchlist', '/portfolio', '/structured-notes', '/settings']` →
    unauthenticated redirect to `/login?next=<path>`.
  - `PROTECTED_API = ['/api/watchlists', '/api/portfolios', '/api/structured-notes',
    '/api/notifications', '/api/notification-recipients']` → 401 JSON.
  - **Cron routes (`/api/cron/*`) are intentionally left untouched** (they carry their own
    `CRON_SECRET` bearer auth).
  - If Supabase is unconfigured, protected pages still redirect to `/login` (public pages
    pass through) — the app must build/run with zero env vars.
  - `matcher` excludes `_next/static`, `_next/image`, favicon, and common static assets.
- **Auth API routes:** `/api/auth/{login,register,forgot-password,reset-password}`.
- **Auth pages:** `/login` (sign-in / create-account toggle, `Suspense`-wrapped, uses
  `BrandLogo` + `t.auth.*`), `/forgot-password`, `/auth/reset-password`.
- **Client display hook:** `src/lib/auth/useAuthDisplay.ts` — reads session via the browser
  Supabase client `onAuthStateChange` (no network call); drives the sidebar name, the
  Sign in/out link, and `NotificationBell` visibility (bell only renders when signed in).
- **Server helpers:** `src/lib/auth/getUser.ts` (`getCurrentUser`, `getUserIdOrNull`,
  `requireCurrentUser`), `src/lib/auth/credentials.ts` (pure validators).

> **Merge-contract points 5 & 6:** exactly one auth system exists. The Fable login
> presentation must re-skin `/login` (+ the two other auth pages) **without** adding a
> second auth mechanism and without changing the middleware protection lists.

---

## 6. Theme system (dark mode — must be preserved)

- **Definition:** `src/app/globals.css`. `@theme inline` maps semantic Tailwind utilities
  (`bg-background`, `text-foreground`, `text-positive`, …) onto CSS custom properties.
  Light values in `:root`; dark values in `.dark` (class on `<html>`). **Not a separate
  design — a variable override.**
- **Full token set** (light + dark values both defined):
  `--background, --surface, --surface-2, --foreground, --muted, --muted-fg, --border,
  --border-strong, --primary, --primary-fg, --accent, --accent-fg, --link, --positive,
  --negative, --warning, --news-src-{df,lt,em,de,cmf,bc}, --sidebar, --sidebar-fg,
  --sidebar-muted, --sidebar-active, --sidebar-accent, --sidebar-border, --topbar,
  --topbar-fg, --topbar-border`.
- **Palette (light):** bg `#F1F1F1`, surface `#FFFFFF`, surface-2 `#E8EAEB`, fg `#231F20`,
  primary `#004A64` (deep navy), accent `#7399C6`, link `#007FC3`, positive `#1A6630`,
  negative `#8B0E04`, warning `#7A5200`, sidebar `#004A64` (always dark navy).
- **Palette (dark):** bg `#202324`, surface `#2A2D2E`, surface-2 `#333638`, fg `#E6E5E4`,
  primary `#7399C6`, accent `#88CBDF`, positive `#3DAA60`, negative `#D05050`, warning
  `#CC9010`, sidebar `#0B2437`.
- **Toggle:** `ThemeToggle.tsx` — a **segmented pill** `[☀ Light | ☽ Dark]`, both segments
  visible, `role="group"`, `aria-pressed`; persists `localStorage.theme`; toggles `.dark`.
- **Pre-paint script** in `layout.tsx` prevents flash.
- **Brand logo swap:** `.brand-logo-light`/`.brand-logo-dark` CSS keyed off `.dark`.
- **Typography utilities** in `@layer components`: `.ui-label`, `.ui-table-header`,
  `.ui-number` (11px labels / tabular numeric body font). Font stack is system-only
  (Helvetica Neue → system fallbacks); mono stack for tickers/versions only.
- **Scrollbars, focus ring, print** all token-driven (theme-aware).

> **Merge-contract point 8:** dark mode is a first-class parallel palette. Fable colors/
> materials must be expressed as **both** a light and a dark value for every token, and the
> `.dark` override + pre-paint script must remain. See doc 05 for the glassmorphism risk.

---

## 7. Localization (English + Spanish — must be preserved)

- `src/lib/i18n.ts` — `dict.en` / `dict.es`, exported `type Lang = 'en' | 'es'` and
  `type Translation = typeof dict['en']`. **1,406 lines.**
- **19 top-level namespaces** per language: `nav, sn, notifications, commandk, charting,
  compare, topbar, common, dataSource, marketData, home, stocks, macro, cal, earnings,
  auth, watchlist, portfolio, company`.
- **Provider:** `LangProvider` (`useLang()` → `{ lang, setLang, t }`), default `'en'`,
  persisted `localStorage.lang`. `TopBar` renders `LangToggle` (EN/ES pill).
- **Rule (enforced by design principles & tests):** every user-visible string comes from
  `t.*`; adding a label means adding it to **both** `en` and `es`. Data values are never
  translated.

> **Merge-contract point 7:** any new Fable component that introduces visible text must add
> EN + ES keys. No hardcoded UI strings.

---

## 8. Responsive & layout conventions (must be preserved)

Locked by `tests/responsiveLayout.test.ts` (2026-07-21 responsive audit). Key rules:
- **No root min-width.** `globals.css` deliberately removed `html { min-width: 1200px }` —
  do **not** reintroduce. Grids collapse via responsive prefixes; dense tables scroll inside
  their own cards. **Zero page-level horizontal overflow anywhere.**
- **Responsive layout grids:** e.g. Home regions `grid-cols-1 lg:grid-cols-3`; Company KPI
  `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`; Portfolio `grid-cols-2 sm:grid-cols-4
  xl:grid-cols-7`; heat tiles `grid-cols-2 sm:grid-cols-3`.
- **Measured-height pinning binds only at `lg+`** via a CSS variable (`--pin-h` +
  `lg:h-(--pin-h)`), so stacked mobile cards take natural height. Never inline
  `style={{ height: macroH }}`.
- **Card-level table scrolling:** dense tables wrap in `overflow-x-auto` + a `min-w-[…px]`
  on the `<table>` (e.g. Stocks 760, Macro indicators 660, Compare returns 440). Full-page
  horizontal scroll is never acceptable.
- **Sidebar** is `hidden lg:flex`; below `lg` the TopBar hamburger opens the overlay drawer
  (`SidebarProvider.mobileOpen`, viewport-aware `toggle()` via `matchMedia`).
- **TopBar** compresses; **SectionHeader** wraps its actions row; NotificationBell dropdown
  capped `max-w-[calc(100vw-1.5rem)]`; `main` padding `px-3 py-4 sm:px-6 sm:py-5`.
- Verified in-browser at 1728/1440/1280/1023/900/767/630/430/390, light + dark.

> **Merge-contract point 9:** these responsive fixes, the card-level table scrolling, the
> mobile drawer, and zero page-level horizontal overflow must all survive the re-skin.

---

## 9. Cron jobs & server scheduling (out of scope)

`vercel.json` crons (weekdays):
- `30 12 * * 1-5` → `/api/cron/ingest-bcch-macro`
- `45 13 * * 1-5` → `/api/cron/check-ingestion-health`
- `30 21 * * 1-5` → `/api/cron/structured-notes/snapshot`
- `30 22 * * 1-5` → `/api/cron/refresh-calendar-enrichment`

Additional cron routes exist but are **not** on a Vercel schedule (manual/reviewable):
`ingest-fred-macro`, `ingest-market-snapshot`, `financials/{cmf-bank,cmf-xbrl,yahoo}`.
Plus a twice-daily **GitHub Actions** market-data + earnings-calendar refresh (Python
`refreshMarketData.py`, `refreshEarningsCalendar.ts`) commits JSON snapshots.

> All server scheduling, ingestion pipelines, and source-priority logic are **out of scope**
> for the Fable re-skin (merge-contract point 5).

---

## 10. Component inventory (the parts the re-skin will touch)

### 10.1 Layout (`src/components/layout/`)
`AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`.

### 10.2 Providers (`src/components/providers/`)
`LangProvider.tsx` (i18n), `MarketDataProvider.tsx` (app-wide live market snapshot +
`refreshSeq`), `MacroDataProvider.tsx` (app-wide live macro), `SidebarProvider.tsx`
(collapse + mobile drawer).

### 10.3 UI primitives (`src/components/ui/`) — 14 components
| Component | Role | Notes for re-skin |
|---|---|---|
| `SectionHeader` | page title + tag + subtitle + actions | on every page; `flex-wrap` actions |
| `ThemeToggle` | segmented light/dark pill | design control — Fable restyles |
| `LangToggle` | EN/ES pill | design control |
| `BrandLogo` | theme-aware logo (`/nevada-logo-*`) | login + topbar |
| `CommandPalette` | ⌘K / `/` company search modal | app-wide; recent searches |
| `NotificationBell` | auth-only bell + dropdown feed | polls `/api/notifications` |
| `SearchInput` | reusable search field | |
| `DataSourceBadge` | macro live/persisted/static chip (dot + word) | **source label — preserve** |
| `MarketDataSourceBadge` | market equivalent | **source label — preserve** |
| `SourceStateBadge` | canonical 7-state chip (registry-driven) | **source label — preserve** |
| `TableSourceFooter` | `Source: X as of DD-MM` footer | **one per table — preserve** |
| `StatusPill` | color-mix status pill (6 variants) | |
| `EmptyState` | centered muted message | **empty state — preserve** |
| `UpdateDataButton` | idle/loading/done "Update Data" | refresh pattern — preserve |

### 10.4 Charts (`src/components/charts/`) — pure SVG, no chart library
`LineChart.tsx` (ResizeObserver width, hover crosshair/tooltip, markers, compare series),
`CompareChart.tsx`, `FundamentalsChart.tsx` (dual-axis bars+lines), `YieldCurveChart.tsx`.

### 10.5 Macro (`src/components/macro/`)
`EconomicCalendarTable.tsx`.

> **Rule (Source Badge / TableSourceFooter conventions, per CLAUDE.md):** badges render only
> a bare status word next to a colored dot; the real source name lives in `TableSourceFooter`
> at the bottom of each table; every table ends with exactly one footer (enforced by
> `tests/tableSourceFooterConvention.test.ts`). **Merge-contract points 10 & 11** depend on
> these staying intact.

---

## 11. Data layer (how the frontend gets data — do not rewire)

- **Static seed/fallback JSON** (`src/data/*.json`, 15 files): `companies`, `stockPrices`,
  `macroIndicators`, `macroHistory`, `stockHistory`, `sectorPerformance`, `indexPerformance`,
  `chileanRates`, `fxRates`, `yieldCurves`, `earnings`, `earningsCalendar`, `fundamentals`,
  `documents`, `marketMeta`.
- **Client-safe data helpers** (`src/lib/data/*.ts`, 27 modules): synchronous static readers
  (e.g. `getAllCompanies`, `getAllIndicators`) **and** async `fetch*` helpers that hit `/api`
  routes (e.g. `fetchLiveSnapshot`, `fetchMacroIndicators`, `fetchCompareData`,
  `fetchEarningsResults`, `fetchValuation`, `fetchYieldCurveLive`, `fetchNews`).
- **App-wide live providers:** `MarketDataProvider` (`useMarketData().{live, refresh,
  refreshSeq, refreshing}`) and `MacroDataProvider` (`useMacroData()`) — mounted in AppShell,
  survive navigation, drive every page's "Update" button and its live/persisted/static badge.
- **Server-only provider layer** (`src/lib/providers/`, `src/lib/db/repositories/`,
  `src/lib/financials/`, `src/lib/market/`, `src/lib/earnings/`, `src/lib/compare/`,
  `src/lib/structuredNotes/`): BCCh/FRED/Yahoo/Frankfurter providers, Supabase repositories,
  DB-mode orchestration (`static | supabase | hybrid`), source-priority/supersession. **Never
  imported by client components.**
- **Config** (`src/config/*.ts`): verified series maps (`bcchSeriesManualMap`,
  `usFredSeriesManualMap`, `macroSeries`, `yahooMacroSeries`, `tickerMap`,
  `fredReleaseAllowlist`, `cmfEarningsCalendarMap`, `fomcMeetingCalendar`,
  `calendarEnrichmentMap`, `marketDataProviders`).
- **Shared entity types** (`src/types/index.ts`): `Company`, `StockPriceSnapshot`,
  `MacroIndicator`, `MacroHistoryPoint`, `StockHistoryPoint`, `SectorPerformance`,
  `ChileanRate`, `FxRate`, `IndexPerformance`, `EarningsRelease`, `NewsItem`,
  `DocumentRecord`, and news enums.

> **The re-skin changes presentation only.** Pages keep reading the same static helpers for
> first render and the same `fetch*`/provider hooks for the live upgrade. The client/server
> boundary (`src/lib/providers/*` and `src/lib/db/*` are server-only) must not be crossed.

---

## 12. Tests (regression guardrails — 75 files)

`node --test "tests/*.test.ts"`. Highest-relevance guards for the re-skin:
- `responsiveLayout.test.ts` — responsive grid/scroll/drawer conventions.
- `tableSourceFooterConvention.test.ts` — every table ends with exactly one footer; plain
  source names only.
- `dataSourceAudit.test.ts` / `auditSourceIntegrity.test.ts` — badge semantic-token guard,
  no stale phase/vendor-fabrication copy, correct source labels.
- `homeWatchlistOverhaul.test.ts` — Home watchlist/source wording.
- `authWatchlist.test.ts`, `credentials.test.ts`, `passwordResetAndUpdateButton.test.ts` —
  auth flow + protected-route scope.
- `notificationsPlatform.test.ts` — notification feed.
- Plus ~65 data/provider/ingestion/structured-notes/formatters tests (business logic).

Any of these that assert on **DOM text/structure** may need updates when markup changes —
tracked per-route in doc 05.

---

## 13. Design governance conflict (must be reconciled)

`docs/design_principles.md` is the current design authority referenced by `CLAUDE.md`
("Do not change the design direction without asking"). Its **Section 10 Anti-patterns
explicitly forbid** several things the Fable "Liquid Glass" language is built on:

| design_principles.md forbids | Fable introduces |
|---|---|
| Glassmorphism (`backdrop-blur`, transparent panels) | **Liquid Glass materials** |
| Gradient backgrounds | (likely gradients/tints) |
| `rounded-2xl` or larger | (likely larger radii on glass cards) |
| Drop shadows (`shadow-2xl`, `drop-shadow-lg`) | (glass depth/elevation) |
| Animated transitions / auto-playing animations | **motion + page transitions** |
| Icon-only theme toggle → segmented pill required | (Fable pill controls) |

Per the **explicit merge contract, the Fable frontend is now authoritative for aesthetics**,
which supersedes these anti-patterns. `docs/design_principles.md` (and the CLAUDE.md design
rules that cite it) **must be revised** as part of the migration — not silently violated.
This reconciliation is captured as a first-class task in doc 04 and a risk in doc 05.

---

## 14. Summary counts

| Metric | Count |
|---|---|
| Page routes | **16** (13 app + 3 auth) |
| Protected page routes | 5 (`/watchlist`, `/portfolio`, `/structured-notes`, `/structured-notes/[id]`, `/settings/notifications`) |
| API route handlers | 60 |
| Cron routes (scheduled) | 4 (of 9 total cron routes) |
| Providers | 4 (Lang, MarketData, MacroData, Sidebar) |
| Layout components | 3 |
| UI primitives | 14 |
| Chart components | 4 |
| i18n namespaces | 19 (× EN/ES) |
| Static JSON datasets | 15 |
| `src/lib/data` client helpers | 27 |
| Test files | 75 |
| Theme tokens | ~30 semantic (× light/dark) |
