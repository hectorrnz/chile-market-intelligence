// Phase 6A — Auth + Watchlist foundation tests.
// Tests pure helpers and structural invariants only — no live Supabase calls.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MIGRATION_CORE = join(ROOT, 'supabase/migrations/20260625000000_create_market_intelligence_core.sql')
const MIGRATION_AUTH = join(ROOT, 'supabase/migrations/20260701000000_auth_watchlist_foundation.sql')
const MIDDLEWARE     = join(ROOT, 'src/middleware.ts')

// ─── Migration: auth/watchlist tables ────────────────────────────────────────

describe('Phase 6A migration file', () => {
  it('auth migration file exists', () => {
    assert.ok(existsSync(MIGRATION_AUTH), 'auth_watchlist_foundation.sql not found')
  })

  it('defines user_profiles table', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(sql.includes('user_profiles'), 'migration missing user_profiles table')
  })

  it('defines watchlists table', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(sql.includes('watchlists'), 'migration missing watchlists table')
  })

  it('defines watchlist_items table', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(sql.includes('watchlist_items'), 'migration missing watchlist_items table')
  })

  it('enables RLS on user_profiles', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(
      sql.includes('enable row level security') && sql.includes('user_profiles'),
      'RLS not enabled on user_profiles'
    )
  })

  it('enables RLS on watchlists', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(
      sql.includes('enable row level security') && sql.includes('watchlists'),
      'RLS not enabled on watchlists'
    )
  })

  it('enables RLS on watchlist_items', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(
      sql.includes('enable row level security') && sql.includes('watchlist_items'),
      'RLS not enabled on watchlist_items'
    )
  })

  it('uses auth.uid() in RLS policies', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(sql.includes('auth.uid()'), 'RLS policies must reference auth.uid()')
  })

  it('has unique constraint on watchlist_items(watchlist_id, ticker)', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    // Check for unique constraint or index
    const hasUnique = sql.includes('unique') && sql.includes('watchlist_id') && sql.includes('ticker')
    assert.ok(hasUnique, 'Missing unique(watchlist_id, ticker) on watchlist_items')
  })

  it('references auth.users for foreign keys', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    assert.ok(sql.includes('auth.users'), 'Tables should FK reference auth.users')
  })

  it('is idempotent (uses if not exists / create or replace)', () => {
    const sql = readFileSync(MIGRATION_AUTH, 'utf8')
    const isIdempotent = sql.includes('if not exists') || sql.includes('create or replace') || sql.includes('drop policy if exists')
    assert.ok(isIdempotent, 'Migration should be idempotent (if not exists / drop if exists)')
  })
})

// ─── Middleware: protected routes ─────────────────────────────────────────────

describe('Phase 6A middleware', () => {
  it('middleware file exists', () => {
    assert.ok(existsSync(MIDDLEWARE), 'src/middleware.ts not found')
  })

  it('protects /watchlist page route', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes('/watchlist'), 'middleware must protect /watchlist')
  })

  it('protects /api/watchlists API route', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes('/api/watchlists'), 'middleware must protect /api/watchlists')
  })

  it('redirects unauthenticated pages to /login', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes('/login'), 'middleware must redirect to /login')
  })

  it('returns 401 for unauthenticated API requests', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes('401'), 'middleware must return 401 for unauthorized API calls')
  })

  it('does not block cron routes', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    // The middleware comment or config must mention cron routes are left untouched
    assert.ok(src.includes('/api/cron'), 'middleware should reference cron routes as untouched')
  })

  it('handles missing Supabase config gracefully', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    // Must check for missing URL / key before trying to use Supabase
    assert.ok(
      src.includes('NEXT_PUBLIC_SUPABASE_URL') || src.includes('getSupabasePublicConfig') || src.includes('supabaseUrl'),
      'middleware must handle unconfigured Supabase'
    )
  })
})

// ─── Auth pages exist ─────────────────────────────────────────────────────────

describe('Phase 6A auth pages', () => {
  it('login page exists', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/login/page.tsx')), 'login page not found')
  })

  it('auth callback route exists', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/auth/callback/route.ts')), 'auth callback not found')
  })

  it('logout route exists', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/logout/route.ts')), 'logout route not found')
  })

  it('login page uses Supabase browser client (not service role)', () => {
    const src = readFileSync(join(ROOT, 'src/app/login/page.tsx'), 'utf8')
    assert.ok(src.includes('getSupabaseBrowserClient'), 'login must use browser client')
    assert.ok(!src.includes('service_role'), 'login must never use service_role key')
    assert.ok(!src.includes('SUPABASE_SERVICE_ROLE'), 'login must never reference service role')
  })

  it('auth callback exchanges code for session', () => {
    const src = readFileSync(join(ROOT, 'src/app/auth/callback/route.ts'), 'utf8')
    assert.ok(src.includes('exchangeCodeForSession'), 'callback must exchange PKCE code')
  })

  it('auth callback has safe redirect (same-origin only)', () => {
    const src = readFileSync(join(ROOT, 'src/app/auth/callback/route.ts'), 'utf8')
    assert.ok(src.includes('startsWith'), 'callback must validate redirect target starts with /')
  })
})

// ─── Watchlist API routes exist ───────────────────────────────────────────────

describe('Phase 6A watchlist API routes', () => {
  it('/api/watchlists route exists', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/route.ts')), 'watchlists route not found')
  })

  it('/api/watchlists/[id]/items route exists', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/[id]/items/route.ts')), 'items route not found')
  })

  it('/api/watchlists/[id]/items/[ticker] route exists', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/[id]/items/[ticker]/route.ts')), 'ticker DELETE route not found')
  })

  it('items POST validates ticker against covered universe', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/watchlists/[id]/items/route.ts'), 'utf8')
    assert.ok(src.includes('VALID_TICKERS') || src.includes('invalid_ticker'), 'items POST must validate ticker')
  })

  it('watchlist routes do not reference service_role key', () => {
    const routes = [
      'src/app/api/watchlists/route.ts',
      'src/app/api/watchlists/[id]/items/route.ts',
      'src/app/api/watchlists/[id]/items/[ticker]/route.ts',
    ]
    for (const r of routes) {
      const src = readFileSync(join(ROOT, r), 'utf8')
      assert.ok(!src.includes('service_role'), `${r} must not use service_role key`)
      assert.ok(!src.includes('SUPABASE_SERVICE_ROLE'), `${r} must not reference SUPABASE_SERVICE_ROLE`)
    }
  })
})

// ─── core migration unchanged (regression check) ─────────────────────────────

describe('Phase 5B core migration (regression)', () => {
  it('core migration still exists', () => {
    assert.ok(existsSync(MIGRATION_CORE), 'core migration lost')
  })

  it('core migration still has 11 original tables', () => {
    const sql = readFileSync(MIGRATION_CORE, 'utf8')
    const tables = ['data_sources', 'companies', 'macro_indicators', 'macro_observations',
      'stock_snapshots', 'stock_ohlcv', 'index_snapshots', 'sector_performance',
      'cmf_filings', 'documents', 'ingestion_runs']
    for (const t of tables) {
      assert.ok(sql.includes(t), `core migration missing table: ${t}`)
    }
  })
})
