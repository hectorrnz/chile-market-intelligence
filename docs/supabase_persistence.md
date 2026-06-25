# Supabase Persistence — Phase 5B

This document describes the database layer added in Phase 5B. No production behavior changed — the app continues to run on static data until `DB_MODE` is set.

---

## Architecture Overview

```
UI / Pages
    ↓
src/lib/data/*   (existing, static-first, unchanged)
    ↓
src/lib/db/repositories/*   (NEW — repository layer, static or Supabase)
    ↓
src/lib/supabase/*          (NEW — Supabase client utilities, server-only except client.ts)
    ↓
Supabase Postgres           (only when DB_MODE=supabase or hybrid)
```

The repository layer sits between the existing data helpers and Supabase. In Phase 5B it is not yet wired into the UI — that happens in Phase 5B.1 when credentials are available.

---

## DB Mode (`DB_MODE` env var)

| Value | Behaviour |
|-------|-----------|
| `static` (default) | All repositories return static JSON data. Supabase is never called. |
| `supabase` | Repositories call Supabase. If the call fails, the error is returned (no silent fallback). |
| `hybrid` | Repositories call Supabase and fall back to static data on error/timeout. |

Set in `.env.local`:
```
DB_MODE=static
```

---

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | When DB_MODE ≠ static | Project API URL from Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | When DB_MODE ≠ static | `anon` key — safe to expose to browser |
| `SUPABASE_SERVICE_ROLE_KEY` | For admin/ingestion | **Server-only** — bypasses RLS |
| `SUPABASE_DATABASE_URL` | For `psql` seed/migration | `postgresql://...` connection string |
| `DB_MODE` | No (defaults to `static`) | `static` \| `supabase` \| `hybrid` |

`NEXT_PUBLIC_SUPABASE_SECRET_KEY` is not used — the naming follows Supabase's 2025 `publishableKey`/`secretKey` convention.

---

## Database Schema

Migration file: [`supabase/migrations/20260625000000_create_market_intelligence_core.sql`](../supabase/migrations/20260625000000_create_market_intelligence_core.sql)

### Tables

| Table | Description |
|-------|-------------|
| `data_sources` | Registry of upstream providers (BCCh, CMF, Brain Data, static) |
| `companies` | Chilean listed companies, mirrors `companies.json` |
| `macro_indicators` | Macro series definitions, mirrors `macroSeries.ts` ids |
| `macro_observations` | Timestamped macro values from BCCh or static |
| `stock_snapshots` | Latest price/change snapshot per ticker |
| `stock_ohlcv` | OHLCV bars (daily, weekly) per ticker |
| `index_snapshots` | Index levels and day/YTD changes |
| `sector_performance` | Sector heat-map data |
| `cmf_filings` | CMF Hechos Esenciales parsed from live or static |
| `documents` | Document registry (HE PDFs, earnings releases) |
| `ingestion_runs` | Audit log of provider ingestion runs |

All tables have RLS enabled with an anon-read policy. No public write policies exist until Phase 6 auth.

---

## Supabase Client Files

| File | Client type | Notes |
|------|-------------|-------|
| `src/lib/supabase/env.ts` | — | Pure env detection; no side effects |
| `src/lib/supabase/types.ts` | — | `SupabaseConfig`, `SupabaseAdminConfig` |
| `src/lib/supabase/database.types.ts` | — | Provisional manual types; replace with `npx supabase gen types` after linking |
| `src/lib/supabase/client.ts` | Browser (singleton) | `'use client'`; uses `NEXT_PUBLIC_*` vars only |
| `src/lib/supabase/server.ts` | Server | For route handlers + Server Components; no cookie management until Phase 6 |
| `src/lib/supabase/admin.ts` | Admin (server-only) | Uses `SUPABASE_SERVICE_ROLE_KEY`; bypasses RLS; ingestion scripts only |

---

## Repository Layer (`src/lib/db/`)

| File | Purpose |
|------|---------|
| `dbMode.ts` | `parseDbMode()`, `getDbMode()`, `decideDbSource()` |
| `types.ts` | `DbMode`, `DbResult<T>`, `DbListResult<T>`, `DbConfig` |
| `repositories/companiesRepository.ts` | `getCompanies()`, `getCompanyByTicker()` |
| `repositories/macroRepository.ts` | `getMacroIndicators()`, `getMacroHistory()` |
| `repositories/marketRepository.ts` | `getStockSnapshots()`, `getIndexSnapshots()`, `getSectorPerformance()` |
| `repositories/cmfRepository.ts` | `getCmfFilings()`, `getCmfFiling()` |
| `repositories/documentsRepository.ts` | `getDocuments()`, `getDocumentById()` |
| `repositories/ingestionRunsRepository.ts` | `getIngestionRuns()`, `createIngestionRun()` |

All repositories are **server-only** — never import from `'use client'` files.

---

## Scripts

```bash
# Check Supabase connectivity (needs NEXT_PUBLIC_* vars in .env.local)
npm run supabase:check

# Regenerate supabase/seed.sql from src/data/*.json
npm run supabase:generate-seed

# Apply migration to a linked project
npx supabase db push

# Or apply directly via psql
psql $SUPABASE_DATABASE_URL -f supabase/migrations/20260625000000_create_market_intelligence_core.sql

# Seed reference data
psql $SUPABASE_DATABASE_URL -f supabase/seed.sql
```

---

## Setup (Phase 5B.1)

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Copy the Project URL and anon key from **Settings → API**.
3. Copy the service-role key from **Settings → API → service_role**.
4. Copy the database password from **Settings → Database**.
5. Add to `.env.local`:
   ```
   DB_MODE=hybrid
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   SUPABASE_DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
   ```
6. Apply the migration: `psql $SUPABASE_DATABASE_URL -f supabase/migrations/20260625000000_create_market_intelligence_core.sql`
7. Seed reference data: `psql $SUPABASE_DATABASE_URL -f supabase/seed.sql`
8. Test: `npm run supabase:check`
9. Replace provisional DB types: `npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts`

---

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — never expose to the browser or log it.
- `NEXT_PUBLIC_*` vars are bundled into the client; they are safe because RLS restricts what the anon key can do.
- Supabase is not a dependency for local dev, build, or Vercel deploy — all fallback to static when vars are absent.
