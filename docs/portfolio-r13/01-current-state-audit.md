# R13.0 · Document 01 — Current-State Repository Audit

**Phase:** R13.0 (documentation only — no code, tests, migrations, or configuration changed)
**Branch:** `feat/portfolio-r13`
**Baseline commit:** `2d92daf` (`origin/master`)
**Date of audit:** 2026-08-06

Every statement below marked **VERIFIED** was established by reading the referenced
implementation file, migration, or configuration in this repository at the baseline commit.
Statements marked **PROPOSED** are recommendations for R13.1+, not existing behaviour.

---

## 1. Executive finding

> **R13 is a new product domain, not an extension of the existing `/portfolio` module.**

The existing `/portfolio` route implements a *personal, single-user, CLP-denominated, Chilean-equity
position book* built from manually entered transactions. R13 requires a *shared, multi-principal,
USD-denominated, hierarchical family-office reporting surface* sourced from an uploaded weekly
workbook. The two share a route name and almost nothing else: different currency, different
entity model, different data provenance, different authorization model, different update cadence.

They **cannot** be merged, and the existing module must **not** be repurposed or deleted. R13 needs
its own tables, its own routes, and its own entitlement layer.

**Route naming — RESOLVED (binding).** R13 is the **Family Portfolio** module and lives under
`/family-portfolio`. The existing `/portfolio` route remains the separate Chilean-equities portfolio
domain and is **not** replaced, renamed, redirected, merged into, or otherwise altered. Full route
contract in `05-authorization-and-data-architecture.md` § 7.

---

## 2. Existing portfolio module

### 2.1 What exists — VERIFIED

| Layer | File | Behaviour |
|---|---|---|
| Page | `src/app/portfolio/page.tsx` | `'use client'`. Fable-composed (Phase 5H). Tabs: Positions / Transactions / Cash. |
| Valuation | `src/lib/portfolio/valuation.ts` | Pure. `calculatePositionMarketValue`, `calculateCostBasis`, `calculateUnrealizedPnL(Pct)`, `calculatePortfolioTotals`, `calculateSectorExposure`. NaN/Infinity guarded. |
| Lots | `src/lib/portfolio/transactions.ts` | Pure. Weighted-average cost, realized P&L, full-history replay (`rebuildPositionFromTransactions`), cash-ledger derivation. |
| Repository | `src/lib/db/repositories/portfolioRepository.ts` | User-session client only; never sets `user_id` (RLS + column default own it). |
| Repository | `src/lib/db/repositories/portfolioTransactionRepository.ts` | Pre-validates via replay before every write, then reconciles. |
| API | `src/app/api/portfolios/**` | 6 route files: list/create, detail, positions (add/edit/remove), transactions (add/edit/remove), cash. |
| Schema | `20260702000000_portfolio_foundation.sql` | `portfolios`, `portfolio_positions`. |
| Schema | `20260703000000_portfolio_transactions_cash_ledger.sql` | `portfolio_transactions`, `portfolio_cash_ledger` + `check_portfolio_ownership()` trigger. |

### 2.2 Why it cannot host R13 — VERIFIED

1. **Ticker-constrained.** `portfolioRepository.ts` loads `src/data/companies.json` into `VALID_TICKERS`
   and rejects anything outside the 25 tracked Chilean equities. R13's holdings are asset classes,
   sub-asset classes, and named funds (`FI Drake Real Estate Partners Fund III`, `Trinity Alps
   Venture Opportunities Fund I LP`, …) — none is a listed ticker.
2. **Currency.** `portfolios.base_currency` defaults `'CLP'`; the page formats through `formatCLP`.
   The entire R13 source is explicitly `valores en dólares` (USD).
3. **Flat, not hierarchical.** `portfolio_positions` is one row per ticker. R13 needs
   asset class → sub-asset class → sociedad → individual asset, with subtotal rows that are part of
   the published artefact.
4. **Ownership model.** RLS is `auth.uid() = user_id` — strictly private per user. R13 requires
   *shared* portfolios visible to an entitled subset of users (Main is visible to all four principals).
5. **Provenance.** Positions are user-entered and continuously mutable. R13 rows are
   **immutable published weekly snapshots** derived from an administrator upload.
6. **No time series.** The page comment states explicitly that the hero sparkline is omitted because
   "no portfolio value time series exists". R13's core artefact *is* a weekly value time series.

**Risk if ignored:** forcing R13 into `portfolio_positions` would require dropping the ticker
foreign key and the per-user RLS predicate — silently weakening the isolation guarantees the
existing personal book depends on. **Do not do this.**

### 2.3 Binding non-interference rule

R13 must **not**: replace `/portfolio`; rename it; redirect it; merge family-portfolio data into it;
reuse its ticker-constrained data model as the family-portfolio model; or break any of its existing
behaviour. Its routes, tables, RLS policies, repositories, valuation/transaction modules, and tests
are out of R13's scope entirely. Stage 11 smoke-tests it explicitly for regression
(`08-implementation-test-release-plan.md` § Stage 11).

---

## 3. Authentication, approval, and entitlement

### 3.1 The current boundary — VERIFIED

| Concern | Implementation | Status |
|---|---|---|
| Route gating | `src/lib/auth/accessPolicy.ts` | **Default-deny.** `classifyPath()` returns `private_page`/`private_api` for anything not on an explicit allowlist. |
| Public pages | `PUBLIC_PAGE_PATHS` | `/login`, `/forgot-password`, `/auth/reset-password` — only these. |
| Public APIs | `PUBLIC_API_PATHS` | `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password` — only these. |
| Bearer APIs | `BEARER_AUTH_API_PREFIXES` | `/api/cron` — self-guarded, fails closed. |
| Approval predicate | `src/lib/auth/approval.ts` → `isApprovedProfile()` | Non-empty `user_profiles.username` = approved. |
| API guard | `src/lib/auth/apiGuard.ts` → `guardPrivateApi()` | 401 `unauthenticated` / 403 `not_authorized`, `Cache-Control: no-store`. |
| DB boundary | `20260730000000_user_profiles_admin_controlled_approval.sql` | One policy: `users_own_profile_select` (authenticated, `auth.uid() = id`). All writes **service-role only**. |
| Provisioning | `scripts/admin/provisionUser.ts` | The only sanctioned write path. |

This is a strong, well-asserted foundation. R13 must **extend** it, never bypass it.

### 3.2 The entitlement gap — VERIFIED

`approval.ts` states plainly:

> `user_profiles.role` exists in the schema (default `'user'`) but is read **NOWHERE** in the
> codebase. R1.5 deliberately does not activate it… A richer model belongs to the future
> Users & Access phase.

**R13 is that phase.** Approval today is binary (approved / not approved). R13 needs
*per-principal scoping*: Jaime must reach Main + Jaime + Alternatives and must not reach Andrés's
or Pablo's portfolio.

### 3.3 Schema/type drift — VERIFIED (real defect, low severity)

`20260701000000_auth_watchlist_foundation.sql` creates:

```sql
create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, display_name text,
  role text not null default 'user',
  preferences jsonb not null default '{}',
  ...
);
```

`src/lib/supabase/database.types.ts` (lines 548–571) declares `user_profiles` with
`id, username, email, display_name, avatar_url, created_at, updated_at` — **`role` and
`preferences` are missing, and `avatar_url` is present in the types but absent from the
migration.** The generated types are out of sync with the applied schema in both directions.

**Impact on R13:** any entitlement column added to `user_profiles` must be added to
`database.types.ts` in the same change, and this pre-existing drift should be corrected at the same
time rather than built upon.

---

## 4. File upload, storage, and file-security utilities

### 4.1 Upload precedent — VERIFIED

Exactly **one** upload endpoint exists: `POST /api/structured-notes/extract`
(`src/app/api/structured-notes/extract/route.ts`). Its pattern is directly reusable by R13:

- `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`
- `request.formData()` → `f instanceof File`
- MIME **and** extension check; `MAX_BYTES = 10 * 1024 * 1024`
- `createHash('sha256').update(bytes).digest('hex')` → `fileHash`
- `sanitizeFileName()` strips `/` and `\`, truncates to 200 chars
- Parser exceptions are caught and degraded to a structured `422`, never a bare `500`
- Backend exception text **never** leaves the server
- Every attempt is audited via `recordExtractionRun(...)` — including failures
- **The raw file is never persisted and never echoed back**

### 4.2 The storage gap — VERIFIED

A repository-wide search for `storage.from`, `createBucket`, and Supabase Storage usage returns
**zero matches**. Nevada Market Intelligence has never stored an uploaded file. R13's requirement to
retain the source workbook under a private, opaque identifier is **entirely new infrastructure**.

### 4.3 Reusable ZIP security — VERIFIED

`src/lib/financials/xbrl/unzip.ts` is a dependency-free ZIP reader on `node:zlib` with guards R13
needs verbatim for `.xlsx` (which is a ZIP):

| Guard | Constant / behaviour |
|---|---|
| Archive size cap | `MAX_ZIP_BYTES = 32 MB` |
| Per-entry uncompressed cap | `MAX_ENTRY_UNCOMPRESSED_BYTES = 48 MB` |
| Total uncompressed cap | `MAX_TOTAL_UNCOMPRESSED_BYTES = 64 MB` (zip-bomb defence) |
| Path traversal | `isSafeEntryName()` rejects `..`, absolute paths, backslashes, NUL, drive letters |
| Compression methods | Only `0` (stored) and `8` (deflate) accepted |
| Disk writes | None — extraction is fully in-memory |
| Failure mode | Structured `UnzipError`, never a guess |

**Defect found during this audit (in my own throwaway analysis code, not in the repository):** a
combined `(?:\/>|>[\s\S]*?<\/xf>)` alternation silently collapses runs of self-closing XML elements
(630 real `<xf>` entries parsed as 211). Any R13 `.xlsx` style parser must match **opening tags
only**. Recorded here because it will otherwise be reintroduced. See `03-alternatives-source-contract.md` § 5.

### 4.4 Spreadsheet dependencies — VERIFIED

`package.json` contains **no** xlsx/spreadsheet library (`xlsx`, `exceljs`, `node-xlsx` all absent).
Dependencies are `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`, `react-dom`, `unpdf`,
`yahoo-finance2`. The project's standing rule is "no third-party libraries unless they solve a
specific, documented problem", and Phase 8C.2 set the precedent of writing a dependency-free reader
rather than adding one. **PROPOSED:** follow that precedent — see `09-open-decisions.md` § D4.

---

## 5. Market data

### 5.1 What exists — VERIFIED

| Provider | File | Role |
|---|---|---|
| Orchestrator | `src/lib/providers/market/marketProvider.ts` | static / supabase / hybrid tiering |
| Static | `staticMarketProvider.ts` | committed JSON baseline |
| Persisted | `supabaseMarketProvider.ts` | `stock_snapshots`, `index_snapshots` |
| Live quotes | `src/app/api/market/live-snapshot/route.ts` | batched `yahoo-finance2` |
| Live history | `yahooHistoryProvider.ts` → `getYahooStockHistory()` | wraps `yf.chart(symbol, …)` |
| Ratios | `yahooRatiosProvider.ts` → `fetchYahooValuation()` | one `quoteSummary` call per ticker |
| Symbol maps | `src/lib/market/liveOverlay.ts` | `TICKER_YF` (25 equities), `INDEX_YF` (11 indices) |

`yf.chart()` accepts an arbitrary symbol, so the One Pager's instruments require **no new provider**
— only a new symbol map and a weekly-close alignment rule. Full analysis in
`06-one-pager-market-data-contract.md`.

### 5.2 Committed-snapshot refresh pattern — VERIFIED

Two GitHub Actions commit refreshed JSON into `src/data/` and let the commit trigger a Vercel
redeploy: `refresh-market-data.yml` (twice daily) and `refresh-earnings-calendar.yml` (daily). This
is the established pattern for data a Vercel request cannot reach.

**Risk for R13 — VERIFIED, already observed.** At pre-flight for this very phase, local `master` was
2 commits behind `origin/master`; both were bot commits (`chore(data): market data refresh via
yfinance`, `chore(data): CMF earnings calendar refresh`) touching only `src/data/*.json`. A
long-lived `feat/portfolio-r13` branch will drift from `origin/master` continuously.
**PROPOSED:** R13 must not write to `src/data/` — portfolio data belongs in Supabase, not in
committed JSON — which keeps the drift confined to files R13 never edits, so rebases stay conflict-free.

---

## 6. Fable component inventory — VERIFIED

`src/components/fable/` (24 entries):

`AsyncState`, `AuthForm`, `AuthPanel`, `AuthShell`, `BarrierGauge`, `ChangeIndicator`, `Chip`,
`CurrentActions`, `DetailPanel`, `GlassSurface`, `KpiCapsule`, `KpiHero`, `ModalShell`, `motion`,
`PageHeader`, `PrivacyValue`, `SegmentedControl`, `Sparkline`, `SparklineRow`, `Switch`,
`TableCard`, `useCountUp`, `usePrivacyMode`, plus `chart/` (`chartA11y.ts`, `ChartTooltip.tsx`).

`src/components/ui/`: `BrandLogo`, `CommandPalette`, `DataSourceBadge`, `EmptyState`, `LangToggle`,
`MarketDataSourceBadge`, `NevadaMark`, `NotificationBell`, `SearchInput`, `SectionHeader`,
`SourceStateBadge`, `StatusPill`, `TableSourceFooter`, `ThemeToggle`, `UpdateDataButton`.

`src/components/charts/`: `LineChart`, `CompareChart`, `FundamentalsChart`, `YieldCurveChart`.

**Coverage assessment for R13:**

| R13 need | Existing component | Gap |
|---|---|---|
| Page header + actions | `PageHeader` | none |
| Hero KPI | `KpiHero`, `KpiCapsule`, `useCountUp` | none |
| Dense table in a card | `TableCard` | needs hierarchical expand/collapse |
| Week selector | `SegmentedControl` | needs a dated dropdown for ~100 weeks |
| Loading / empty / error | `AsyncState`, `EmptyState` | none |
| Value masking | `PrivacyValue`, `usePrivacyMode` | none |
| Source honesty | `SourceStateBadge`, `TableSourceFooter`, `dataSourceRegistry.ts` | needs `provisional` / dual-as-of states |
| Portfolio evolution chart | `LineChart` | none (already measured + responsive) |
| Allocation donut | — | **new** (Structured Notes ships an inline-SVG donut precedent) |
| Detail drill-down | `DetailPanel`, `ModalShell` | none |
| Upload + review | — | **new** (`/structured-notes` upload UI is the precedent) |

No new charting dependency is required, consistent with the standing no-chart-library rule.

---

## 7. Tests, build, and runtime constraints — VERIFIED

- **109** test files in `tests/`, run by `node --test "tests/*.test.ts"` (Node strips TS natively; zero test deps).
- Conventions R13 must follow: pure logic extracted to `src/lib/**` and unit-tested directly;
  routes tested for auth/hygiene (`accessControl.test.ts`, `userProfilesRls.test.ts`); migrations
  asserted structurally (`supabaseSchema.test.ts`); page composition asserted by source inspection
  (`fablePortfolioPage.test.ts`); conventions enforced repo-wide
  (`tableSourceFooterConvention.test.ts`, `responsiveLayout.test.ts`).
- Fixtures are **sanitized and fictional** (`tests/fixtures/structured-notes/*.txt`), and
  `structuredNotesWorkbookMapping.test.ts` asserts no private workbook/PDF is committed. **R13 must
  extend that assertion to `.xlsx` and to `docs/portfolio-r13/`.**
- `vercel.json` declares 4 crons. R13 adds none (upload is administrator-initiated).
- Vercel runtime: parsing must declare `runtime = 'nodejs'` (`node:zlib` is unavailable on Edge).
  Serverless request/response limits make **synchronous parse-and-return of a ~450 KB workbook**
  the right shape; no background job infrastructure exists.

---

## 8. Prioritised risk register

| # | Risk | Severity | Evidence | Mitigation |
|---|---|---|---|---|
| R1 | R13 forced into `portfolio_positions`, weakening per-user RLS | **High** | § 2.2 | Separate tables; keep the personal book untouched |
| R2 | Entitlement enforced only in React, so unauthorized portfolios are still returned by the API | **High** | § 3.2 — no scoping exists today | RLS + server-side filter + client presentation (doc 05) |
| R3 | Server evaluates workbook formulas or follows external links | **High** | Live column depends on a SharePoint workbook and Bloomberg `_xll.BDP` (doc 02 § 6) | Read cached values only; never resolve `externalLink1.xml` |
| R4 | Error cells published as real numbers | **High** | `#NAME?` present in the live column today (doc 04 § 5) | Publication blocks on any required-cell error |
| R5 | Value change presented as performance attribution | **High** | No per-asset flows exist (doc 07) | Honest labels; Level 1 at leaf granularity |
| R6 | Fixed row/column indices break on an inserted row | **Medium** | Header row 1 already lacks `BV` while row 5 has it (doc 02 § 3.3) | Semantic anchor detection |
| R7 | Private workbook or its values committed | **Medium** | New file type; existing guard covers only PDF/xlsx under `tests/fixtures` | Extend the committed-secrets test |
| R8 | Branch drift from twice-daily bot commits | **Low** | Observed at pre-flight | Keep R13 out of `src/data/` |
| R9 | `database.types.ts` drift compounded | **Low** | § 3.3 | Fix drift in the entitlement migration |

---

## 9. Acceptance criteria for this document

- [x] Existing portfolio routes, components, APIs, calculations, and tables read and characterised
- [x] Supabase migrations (20) and RLS posture reviewed; `user_profiles` boundary read in full
- [x] Admin-approval architecture and provisioning path identified
- [x] Private storage and upload patterns audited — storage confirmed absent, upload precedent documented
- [x] Server-side authorization helpers read (`accessPolicy`, `approval`, `apiGuard`)
- [x] Fable/UI/chart component inventory completed with a per-need gap assessment
- [x] Spreadsheet dependencies checked — none present
- [x] File-security utilities identified and their guards enumerated
- [x] Market-data sources and endpoints mapped
- [x] Test patterns, Vercel constraints, and data-refresh commit conflicts assessed
