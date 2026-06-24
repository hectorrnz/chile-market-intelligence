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
| `BCCH_API_USER` | Banco Central BDE API username | Phase 4 |
| `BCCH_API_PASS` | Banco Central BDE API password | Phase 4 |
| `CMF_API_KEY` | CMF filing API key (if required) | Phase 4 |
| `MARKET_DATA_API_KEY` | Bolsa/Brain Data price feed key | Phase 7 |
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
- `BCCH_API_PASS` — API credential; server-side only
- Any raw portfolio positions or watchlist data before authentication is implemented (Phase 6)

## Next.js Configuration Notes

- The app uses the **App Router** (`src/app/`).
- Dynamic routes (`/companies/[ticker]`, `/documents/[id]`) are server-rendered on demand — Vercel handles these automatically as serverless functions.
- No custom `vercel.json` is required; Vercel auto-detects Next.js.
- No filesystem access at runtime; all data is imported at build time from JSON.
