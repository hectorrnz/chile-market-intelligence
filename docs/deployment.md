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
| `CMF_API_KEY` | CMF filing API key (if required) | Future |
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
- Any raw portfolio positions or watchlist data before authentication is implemented (Phase 6)

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
