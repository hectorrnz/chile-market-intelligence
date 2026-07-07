# Deployment Guide — Chile Market Intelligence

## Prerequisites

- Node.js 20+ (LTS recommended)
- npm 10+
- A [Vercel](https://vercel.com) account (free tier is sufficient for MVP)
- Vercel CLI (optional, for command-line deploys): `npm i -g vercel`

## Running Locally

```bash
# Install dependencies (first time or after pulling changes)
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

The dev server uses Turbopack for fast hot-module replacement.

## Building Locally

```bash
npm run build
```

This produces an optimized production build in `.next/`. All 12 routes should compile with 0 errors and 0 TypeScript errors.

To preview the production build locally:

```bash
npm run start
```

## Linting and Tests

```bash
npm run lint    # ESLint — should exit 0
npm test        # Node built-in test runner — 13/13 should pass
```

## Deploying to Vercel

### Option A — Vercel Dashboard (recommended for first deploy)

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the GitHub repository (or drag-and-drop the project folder)
3. Framework preset: **Next.js** (auto-detected)
4. No environment variables are required for the static MVP
5. Click **Deploy**

Vercel will assign a `.vercel.app` URL automatically.

### Option B — Vercel CLI

```bash
# First deploy (prompts for project setup)
vercel

# Production deploy (after initial setup)
vercel --prod
```

### Option C — GitHub Auto-Deploy

Connect the repository to Vercel via the dashboard. Every push to `main` will trigger an automatic production deploy. Pull request branches get preview URLs.

## Rolling Back a Deploy

In the Vercel dashboard:

1. Go to the project → **Deployments**
2. Find the last known-good deployment
3. Click the `...` menu → **Promote to Production**

This is instant — no rebuild required.

## Environment Variables

### Current (MVP — none required)

The MVP uses only static JSON files in `src/data/`. No environment variables are needed to build or run the app.

### Future (Phase 4–7)

Add these in the Vercel dashboard under **Settings → Environment Variables**, and locally in `.env.local` (never commit this file):

| Variable | Purpose | Phase |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Phase 5 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key | Phase 5 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side key (secret) | Phase 5 |
| `DATA_MODE` | `static`/`live`/`hybrid` for BCCh macro (`static` default) | Phase 4A |
| `BCCH_API_USER` | Banco Central BDE API username | Phase 4B |
| `BCCH_API_PASSWORD` | Banco Central BDE API password | Phase 4B |
| `BCCH_API_BASE_URL` | BCCh BDE base URL (optional override) | Phase 4B |
| `MARKET_DATA_MODE` | `static`/`live`/`hybrid` for market prices (`static` default) | Phase 4C |
| `BRAIN_DATA_API_BASE_URL` | Brain Data / Bolsa de Santiago base URL | Phase 4C.1 |
| `BRAIN_DATA_API_KEY` | Brain Data API key | Phase 4C.1 |
| `CMF_DATA_MODE` | `static`/`live`/`hybrid` for CMF Hechos Esenciales (`static` default) | Phase 5A |
| `CMF_BASE_URL` | CMF portal base URL (optional override, default cmfchile.cl) | Phase 5A |
| `CMF_USER_AGENT` | Custom User-Agent for CMF requests | Phase 5A |
| `CMF_REQUEST_TIMEOUT_MS` | Per-request timeout in ms for CMF (default: 8000) | Phase 5A |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Phase 5 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key | Phase 5 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side key (secret) | Phase 5 |
| `NEWS_API_KEY` | News ingestion API key | Future |

**Never commit `.env.local` to version control.** It is listed in `.gitignore`.

## Static MVP Data vs Future Live Data

All data currently served by the app comes from static JSON files in `src/data/`. These are committed to the repository and compiled into the build — no database or API calls at runtime.

| Current (MVP) | Future (Phase 4+) |
|---|---|
| `src/data/macroIndicators.json` | Banco Central BDE API |
| `src/data/earnings.json` | CMF FECU filings |
| `src/data/hechosEsenciales.json` | CMF API |
| `src/data/companies.json` / `stockPrices.json` | Bolsa de Santiago / Brain Data |
| `src/data/news.json` | News aggregation service |
| `src/data/fxRates.json` | Bloomberg / FRED |

When live sources are connected (Phase 4–5), data fetching will move to `src/lib/db/` and the static JSON files will be archived rather than deleted.

## What Not to Expose Publicly

- `.env.local` — contains secrets; already in `.gitignore`
- `SUPABASE_SERVICE_ROLE_KEY` — has full DB access; server-side only, never prefix with `NEXT_PUBLIC_`
- `BCCH_API_PASSWORD` — API credential; server-side only (read only in `/api/macro*` route handlers)
- User watchlist and portfolio data is protected by Supabase Auth + RLS (Phase 6A/6C) — never queried with the service-role client from a public-facing route

## Next.js Configuration Notes

- The app uses the **App Router** (`src/app/`).
- Dynamic routes (`/companies/[ticker]`, `/documents/[id]`) are server-rendered on demand — Vercel handles these automatically as serverless functions.
- No custom `vercel.json` is required; Vercel auto-detects Next.js.
- No filesystem access at runtime; all data is imported at build time from JSON.

## Phase 4A — Live Macro Data (BCCh)

The app deploys and runs on **static data with zero env vars**. Live macro data
is opt-in via environment variables.

### Environment variables

| Variable | Purpose | Scope |
|---|---|---|
| `DATA_MODE` | `static` \| `live` \| `hybrid` (default: hybrid if BCCh creds exist, else static) | server |
| `BCCH_API_USER` | BCCh BDE/SieteRestWS username | **server-only** |
| `BCCH_API_PASSWORD` | BCCh BDE/SieteRestWS password | **server-only** |
| `BCCH_API_BASE_URL` | SieteRestWS endpoint (has a sane default) | server |

⚠️ **Never** prefix BCCh variables with `NEXT_PUBLIC_`. They are read only in
server route handlers (`/api/macro*`) and must never reach the browser bundle.
Credentials are never logged.

### Setting env vars in Vercel

1. Vercel dashboard → Project → **Settings → Environment Variables**.
2. Add `BCCH_API_USER`, `BCCH_API_PASSWORD` (and optionally `DATA_MODE=hybrid`)
   for the **Production** (and Preview) environments. Do **not** mark them as
   exposed to the browser.
3. Redeploy for the values to take effect.

Until those are set, **production stays on static MVP data** — the `/api/macro`
routes return the static fallback with `status: "static"`/`"hybrid-fallback"`,
and the UI shows a subtle source badge. No build or runtime errors result from
missing credentials.

### Series codes

Live fetches stay disabled until official BDE series codes are mapped in
`src/config/macroSeries.ts` (Phase 4B). Even with credentials set, `hybrid`
mode serves static data and reports `"No live provider series code mapped yet"`
until then.

## Phase 4B — Enabling live BCCh macro in production

The app deploys and runs on static data with no env vars. To enable live macro
once official series codes are mapped and validated (see
`docs/bcch_series_mapping.md`):

1. **Vercel → Settings → Environment Variables** (Production + Preview):
   - `BCCH_API_USER`, `BCCH_API_PASSWORD` — **not** exposed to the browser.
   - `DATA_MODE=hybrid` (recommended) so any live failure silently falls back to static.
2. Redeploy.

**Keeping production safe if BCCh fails:** in `hybrid` mode a timeout, auth
failure, or implausible value causes the route to serve static data and report
`status: "hybrid-fallback"` — no errors, no layout change. Only `DATA_MODE=live`
surfaces a `live-unavailable` status (still serving static data underneath).
Unmapped indicators always stay on static. Credentials are server-only and never
logged; the BCCh discovery/validation scripts never run during the Vercel build.

## Phase 5D — Vercel Cron: Scheduled BCCh Macro Ingestion

A daily cron job refreshes BCCh macro observations in Supabase so the persisted
read path stays current without manual intervention.

### How it works

`vercel.json` schedules `GET /api/cron/ingest-bcch-macro` at **12:30 UTC weekdays**.
Vercel calls the route automatically and passes `Authorization: Bearer <CRON_SECRET>`.
The route upserts the last **14 days** of all verified BCCh series — idempotent on repeat
runs. A record is written to `ingestion_runs` for observability.

### Required env vars (in addition to Phase 4B + 5B vars)

| Variable | Purpose | Scope |
|---|---|---|
| `CRON_SECRET` | Bearer token for cron route auth | **server-only** |

Set via `npm run vercel:set-production-env` (already done in Phase 5D).

### Setting CRON_SECRET locally

```bash
# .env.local (never commit)
CRON_SECRET=<random 32+ char string>
```

Generate a secret:
```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes) -replace '[+/=]','x'
```

### Manual trigger (local dev)

```bash
node scripts/cron/testBcchMacroCron.ts
# or with a custom URL:
node scripts/cron/testBcchMacroCron.ts --url https://your-preview.vercel.app
```

PowerShell:
```powershell
$h = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Uri http://localhost:3000/api/cron/ingest-bcch-macro -Headers $h
```

curl:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-bcch-macro
```

### Validation after deploy

```
GET /api/macro/ingestion-status
```

Shows `recentRuns[0]` with `job_type: macro_observations_incremental` and `status: success`.

### Security

- `CRON_SECRET` is server-only — never prefixed `NEXT_PUBLIC_`, never logged, never returned in responses.
- Invalid or missing `Authorization` → `401 Unauthorized` / `500 Cron not configured`.
- All BCCh and Supabase errors are sanitized (credentials stripped) before appearing in responses.
- Vercel Cron passes the secret automatically; Vercel Dashboard → Cron Jobs shows run history.

### Failure behavior

If BCCh returns an error for some indicators, the run is recorded as `partial_success`.
The persisted read path continues serving the last successful observations — no page errors.
Full backfill can be re-run manually: `npm run ingest:bcch-macro -- --all --write`.

## Phase 4C.1-alt — Yahoo Finance Live Market Overlay

Chilean market data from Brain Data / Bolsa de Santiago requires an institutional account
and is currently blocked. Yahoo Finance is used as a free, unofficial fallback.

### Architecture

Two complementary mechanisms refresh market data:

**1. GitHub Actions static refresh (twice daily)**

`.github/workflows/refresh-market-data.yml` schedules `scripts/refresh/refreshMarketData.py`:
- **13:30 UTC weekdays** — ~30 min after Bolsa de Santiago opens (09:00 SCL winter)
- **21:30 UTC weekdays** — after market close (17:30 SCL winter)

The script uses `yfinance` to download YTD close prices for all 25 tickers and 11 indices,
writes updated JSON to `src/data/`, and commits only if data changed. Vercel auto-redeploys
on each commit.

**2. Next.js live-snapshot API route (on-demand)**

`GET /api/market/live-snapshot` uses `yahoo-finance2` (npm) to batch-quote all symbols
server-side. The UI refresh button (↻) calls this route and overlays live data on top
of the static baseline in client state. No redeploy needed.

### Running the refresh script locally

```bash
cd scripts/refresh
pip install -r requirements.txt
python refreshMarketData.py
```

### Validating the live-snapshot route

```bash
npm run dev
curl http://localhost:3000/api/market/live-snapshot
```

Expected response shape:
```json
{
  "stocks": { "BSANTANDER": { "price": 32.5, "dayChangePct": 1.25, "marketCapCLP": 10000 } },
  "sectors": [...],
  "indices": [...],
  "lastUpdated": "2026-06-30T14:00:00.000Z",
  "provider": "yahoo-finance",
  "symbolsSucceeded": 25,
  "symbolsFailed": 0
}
```

On failure: `{"error": "Live snapshot unavailable: provider unavailable", "provider": "yahoo-finance", "fallbackAvailable": true}` with HTTP 503.

### No env vars required

The Yahoo Finance path requires no API keys. The GitHub Actions workflow uses only
`secrets.GITHUB_TOKEN` (automatically provided by GitHub — no setup needed).

### Limitations

- Data is unofficial and may be delayed 15+ minutes during market hours
- Yahoo Finance can change its API without notice
- Static fallback is always active; if Yahoo fails, last committed JSON is served
- Do not label this data as "official BCS data"

### Pure aggregation logic

`src/lib/market/liveOverlay.ts` — contains all pure aggregation functions
(`buildStocks`, `buildSectors`, `buildIndices`) and the ticker/sector/index maps.
Import from here for tests; do not import from the Next.js route directly.

### Transitioning to Brain Data when available

1. Set `BRAIN_DATA_API_KEY` and `BRAIN_DATA_API_BASE_URL` in `.env.local` and Vercel
2. Set `MARKET_DATA_MODE=live` or `hybrid`
3. Confirm endpoints in `src/config/marketDataProviders.ts`
4. Implement `src/lib/providers/market/brainDataProvider.ts` (shell exists)
5. Confirm ticker symbols in `src/config/tickerMap.ts` (all `verified: false`)

## Phase 6A/6B — Authentication (username + password)

No additional Vercel configuration beyond the existing Supabase env vars
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) — auth uses the same Supabase project as the rest
of the app. Sign-in is username + password (`/api/auth/login`); account
creation (`/api/auth/register`) resolves a chosen username to a Supabase Auth
user via the service-role admin client and sets the session with cookies
written directly on the response (required — cookies set via `next/headers`
inside a route handler are not guaranteed to reach the browser on a redirect
response in Next.js 16; see `src/lib/auth/sessionCookies.ts`).

Optional: `AUTH_REGISTRATION_CODE` — when set, `/api/auth/register` requires a
matching `code` field to close open signup. Unset by default.

## Phase 6C — Portfolio Foundation

Adds `portfolios` + `portfolio_positions` tables (migration
`20260702000000_portfolio_foundation.sql`) and the protected `/portfolio`
route + `/api/portfolios*` handlers. No new env vars — pricing is read from
the same `stock_snapshots` table the Yahoo/Stocks pages already populate via
`getLatestStockSnapshots()`. Apply the migration via the Supabase Dashboard
SQL Editor before the first deploy that includes this phase (idempotent —
safe to re-run).

## Phase 6D — Transaction History and Cash Ledger Foundation

Adds `portfolio_transactions` + `portfolio_cash_ledger` tables (migration
`20260703000000_portfolio_transactions_cash_ledger.sql`), new Transactions/Cash
tabs on `/portfolio`, and `/api/portfolios/[id]/transactions*` +
`/api/portfolios/[id]/cash` route handlers. No new env vars. Apply the
migration via the Supabase Dashboard SQL Editor before the first deploy that
includes this phase (idempotent — safe to re-run). It does **not** alter
`portfolio_positions` — see `docs/supabase_persistence.md` for why (reuses the
existing `metadata` column instead of an `ALTER TABLE`).

## Phase 8C — Financial-Statement Ingestion (automation-first; manual CSV as interim bridge)

Adds `company_reporting_periods`, `financial_statement_items`,
`financial_metrics`, `earnings_events` tables (migration
`20260704000000_financials_foundation.sql`) and 4 new public read-only API
routes (`/api/financials/coverage`, `/api/financials/[ticker]/metrics`,
`/api/financials/[ticker]/statements`, `/api/earnings`). No new env vars —
writes use the same `SUPABASE_SERVICE_ROLE_KEY` already configured for
market/macro ingestion. Apply the migration via the Supabase Dashboard SQL
Editor before the first deploy that includes this phase (idempotent).

A second, **automation-first** migration (`20260705000000_financials_automation_ready.sql`)
extends all 4 tables with provenance and supersession columns (`source_file`,
`source_as_of`, `ingestion_run_id`, `source_priority`, `is_superseded`,
`superseded_by`) and widens the `source_type` CHECK constraint to accept
`manual_csv`, `cmf_fecu`, `xbrl`, `vendor_feed`, `broker_feed`,
`document_ingestion`, `static_seed`, `derived`. This migration must also be
applied via the Supabase Dashboard SQL Editor (idempotent — purely additive,
no destructive changes) before deploying commits that include it. The intent
is that a future automated CMF FECU/XBRL parser or vendor/broker feed can
write into these same tables via the same repository functions and
automatically supersede any manual-CSV row for the same period — manual CSV
is an interim bridge, not the terminal architecture. See
`docs/data_source_status.md` → "Automation-first source architecture" for the
verified end-to-end supersession test.

**Populating data after deploy** (from a machine with `.env.local` pointed at
the target Supabase project):
```bash
npm run ingest:financials:dry -- --reporting-periods path.csv --statement-items path.csv --metrics path.csv --earnings path.csv
npm run ingest:financials -- --reporting-periods path.csv --statement-items path.csv --write
```
This is a manual, deliberate step — no CSV import runs automatically on
deploy or on a schedule. See `data/import_templates/*.template.csv` for the
expected column format (synthetic samples, including provenance columns;
never commit a real/private CSV) and `docs/supabase_persistence.md` →
"Financial-Statement Ingestion (Phase 8C — automation-first, manual CSV as
interim bridge)" for the full workflow.

## Phase 8C.1 — CMF/XBRL Automated Financials Discovery

No new tables, migrations, or env vars. Adds a discovery/proof-of-concept layer
(`src/lib/financials/providers/`, `src/lib/financials/xbrl/`,
`scripts/discover/cmfXbrlFinancials.ts`) that fetches real public CMF financial-
statement pages over plain HTTPS — no credentials, no CAPTCHA bypass. Nothing
in this phase runs automatically on deploy or on a schedule.

```bash
npm run discover:cmf-financials                    # feasibility report, no network calls
npm run ingest:cmf-financials:dry -- --ticker COPEC # real fetch attempt against live cmfchile.cl, no writes
npm run ingest:cmf-financials -- --ticker COPEC --write # writes only if the dry run is valid (currently blocked at the unzip step — see docs/cmf_xbrl_provider_discovery.md)
```

See `docs/cmf_xbrl_provider_discovery.md` for the full feasibility assessment and exactly what was verified.

## Phase 9A — Structured Notes (PDF extraction foundation)

Adds the **Structured Notes** module. New migration
`20260706000000_structured_notes_foundation.sql` (7 user-scoped tables, RLS
`auth.uid() = user_id`, ownership-guard trigger) — apply via the Supabase
Dashboard SQL Editor before deploying commits that include this phase
(idempotent). New dependency `unpdf` (serverless pdf.js text extraction; no
native deps, Vercel-compatible). No new env vars. Middleware now protects
`/structured-notes` + `/api/structured-notes` (authenticated-only, same pattern
as watchlist/portfolio).

**Phase 9B** adds a second migration `20260706120000_structured_notes_shared_book.sql` — apply it AFTER the
9A migration. It converts the tables from per-user to a **shared internal book** (RLS `auth.uid() is not
null`, ownership-guard triggers dropped, ISIN globally unique) so every authenticated user sees the same
positions + a book-level dashboard. Public/anon access stays blocked.

**Phase 9B.1** adds `20260707000000_structured_notes_allocation_upsert.sql` (unique `(note_id, entity_name)`
constraint for the allocation-by-entity grid). **Phase 9B.2** adds `20260708000000_structured_notes_archived_at.sql`
(a single additive `archived_at timestamptz` column). **Phase 9D** adds
`20260709000000_structured_notes_monitoring.sql` (makes `structured_note_price_snapshots.user_id` nullable,
adds monitoring-evaluation columns to `structured_note_observations`, creates
`structured_note_monitoring_runs`). Apply all five migrations in order:
`20260706000000_*` → `20260706120000_*` → `20260707000000_*` → `20260708000000_*` → `20260709000000_*`.

**Phase 9C** (parser expansion to Crédit Agricole/BNP Paribas/Barclays/BBVA) added **no new migration, no new
routes, and no new env vars** — it is a pure parser-code change behind the existing `/api/structured-notes/extract`
route (new files under `src/lib/structuredNotes/pdf/parsers/`).

**Phase 9D** (scheduled price-snapshot persistence + observation-event automation) adds:
- `GET /api/cron/structured-notes/snapshot` — Bearer `CRON_SECRET` auth (same pattern as
  `/api/cron/ingest-bcch-macro` and `/api/cron/check-ingestion-health`), service-role admin client. Vercel
  cron schedule `30 21 * * 1-5` (weekdays, 21:30 UTC — see `docs/structured_notes_design.md` for the DST
  rationale). **No new env var** — reuses the existing `CRON_SECRET`.
- `GET /api/structured-notes/monitoring-status` — authenticated-only, read-only, same middleware protection
  as the rest of `/api/structured-notes/*`.
- The existing "Update" button and on-demand dashboard/detail routes are **unchanged** — the scheduled cron
  is additive, not a replacement of the live-refresh path.

New routes: `/structured-notes`, `/structured-notes/[id]`, and
`/api/structured-notes` (+ `/extract`, `/import`, `/[id]`, `/[id]/allocations`,
`/[id]/allocations/[allocationId]`, `/monitoring-status`). Uploaded PDFs are parsed server-side and
never persisted or served publicly. **Never commit the real workbook or private
term-sheet PDFs** — only the sanitized text fixtures under
`tests/fixtures/structured-notes/` belong in the repo. See
`docs/structured_notes_design.md` and `docs/structured_notes_workbook_mapping.md`.
