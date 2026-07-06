// Phase 6C — Portfolio Positions Foundation tests.
// Tests pure helpers, structural invariants, and repository logic with a
// mocked Supabase client — no live Supabase calls, no real Auth required.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addPosition,
  updatePosition,
  removePosition,
} from '../src/lib/db/repositories/portfolioRepository.ts'
import {
  calculatePositionMarketValue,
  calculateCostBasis,
  calculateUnrealizedPnL,
  calculateUnrealizedPnLPct,
  isMixedCurrency,
  valuePositions,
  calculatePortfolioTotals,
  calculateSectorExposure,
  type PositionInput,
  type ValuedPosition,
} from '../src/lib/portfolio/valuation.ts'

const ROOT = join(import.meta.dirname, '..')
const MIGRATION_PORTFOLIO = join(ROOT, 'supabase/migrations/20260702000000_portfolio_foundation.sql')
const MIDDLEWARE = join(ROOT, 'src/middleware.ts')
const REPO_FILE = join(ROOT, 'src/lib/db/repositories/portfolioRepository.ts')

// ─── Migration: portfolio tables ──────────────────────────────────────────────

describe('Phase 6C migration file', () => {
  it('portfolio migration file exists', () => {
    assert.ok(existsSync(MIGRATION_PORTFOLIO), 'portfolio_foundation.sql not found')
  })

  it('defines portfolios table', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('create table if not exists portfolios'), 'migration missing portfolios table')
  })

  it('defines portfolio_positions table', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('create table if not exists portfolio_positions'), 'migration missing portfolio_positions table')
  })

  it('portfolio_positions references companies(ticker)', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('references companies(ticker)'), 'ticker must FK to companies(ticker)')
  })

  it('has unique constraint on portfolio_positions(portfolio_id, ticker)', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('unique (portfolio_id, ticker)'), 'missing unique(portfolio_id, ticker)')
  })

  it('enables RLS on both tables', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('alter table portfolios          enable row level security'), 'RLS not enabled on portfolios')
    assert.ok(sql.includes('alter table portfolio_positions enable row level security'), 'RLS not enabled on portfolio_positions')
  })

  it('RLS policies are user-scoped (auth.uid() = user_id) for all 4 CRUD ops per table', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    const expectedPolicies = [
      'users_own_portfolios_select', 'users_own_portfolios_insert',
      'users_own_portfolios_update', 'users_own_portfolios_delete',
      'users_own_positions_select', 'users_own_positions_insert',
      'users_own_positions_update', 'users_own_positions_delete',
    ]
    for (const p of expectedPolicies) {
      assert.ok(sql.includes(p), `missing RLS policy: ${p}`)
    }
    // Every policy body must check auth.uid() = user_id (no public read/write).
    const usingClauses = sql.match(/using \(auth\.uid\(\) = user_id\)/g) ?? []
    const checkClauses = sql.match(/with check \(auth\.uid\(\) = user_id\)/g) ?? []
    assert.ok(usingClauses.length >= 4, 'expected at least 4 "using (auth.uid() = user_id)" clauses')
    assert.ok(checkClauses.length >= 2, 'expected at least 2 "with check (auth.uid() = user_id)" clauses')
  })

  it('user_id defaults to auth.uid() on both tables (defense in depth)', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    const matches = sql.match(/user_id\s+uuid not null default auth\.uid\(\)/g) ?? []
    assert.equal(matches.length, 2, 'both tables should default user_id to auth.uid()')
  })

  it('is idempotent (if not exists / drop policy if exists)', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('if not exists'), 'migration should use if not exists')
    assert.ok(sql.includes('drop policy if exists'), 'migration should drop policies idempotently')
  })

  it('adds updated_at triggers reusing set_updated_at()', () => {
    const sql = readFileSync(MIGRATION_PORTFOLIO, 'utf8')
    assert.ok(sql.includes('set_portfolios_updated_at'), 'missing portfolios updated_at trigger')
    assert.ok(sql.includes('set_portfolio_positions_updated_at'), 'missing portfolio_positions updated_at trigger')
    assert.ok(sql.includes('execute function set_updated_at()'), 'triggers must reuse set_updated_at()')
  })
})

// ─── Repository: never trusts a client-supplied user_id ──────────────────────

describe('Phase 6C portfolio repository — ownership safety', () => {
  it('never sets user_id explicitly in insert/update payloads (relies on RLS + DB default)', () => {
    const src = readFileSync(REPO_FILE, 'utf8')
    // Every .insert({...}) / .update({...}) call site must not include a
    // "user_id:" key — ownership is established solely by the row default
    // (auth.uid()) and enforced by RLS, never by a value passed from the API.
    assert.ok(!/insert\(\{[^}]*user_id\s*:/.test(src), 'insert() must never set user_id explicitly')
    assert.ok(!/update\(\{[^}]*user_id\s*:/.test(src), 'update() must never set user_id explicitly')
  })

  it('never imports or uses the admin/service-role client', () => {
    const src = readFileSync(REPO_FILE, 'utf8')
    assert.ok(!src.includes('getSupabaseAdminClient'), 'portfolio repository must not use the admin client')
    assert.ok(!src.includes('service_role'), 'portfolio repository must not reference service_role')
  })
})

// ─── Repository: addPosition validation (pure, no DB call needed) ────────────

// A minimal stub — validation short-circuits before touching the client, so a
// literal `{}` is enough for the invalid-input cases below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unusedClient = {} as any

describe('Phase 6C addPosition validation', () => {
  it('rejects a ticker outside the covered universe', async () => {
    const result = await addPosition(unusedClient, 'pf-1', { ticker: 'NOTREAL', quantity: 10 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_ticker')
  })

  it('rejects zero or negative quantity', async () => {
    const zero = await addPosition(unusedClient, 'pf-1', { ticker: 'SQM-B', quantity: 0 })
    assert.equal(zero.ok, false)
    assert.equal(zero.error, 'invalid_quantity')

    const negative = await addPosition(unusedClient, 'pf-1', { ticker: 'SQM-B', quantity: -5 })
    assert.equal(negative.ok, false)
    assert.equal(negative.error, 'invalid_quantity')
  })

  it('rejects a negative average cost', async () => {
    const result = await addPosition(unusedClient, 'pf-1', { ticker: 'SQM-B', quantity: 10, averageCost: -1 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_average_cost')
  })

  it('accepts a zero average cost (e.g. gifted shares)', async () => {
    const mockClient = mockSupabaseInsert({ id: 'p1', portfolio_id: 'pf-1', user_id: 'u1', ticker: 'SQM-B', quantity: 10, average_cost: 0, cost_currency: 'CLP', opened_at: null, notes: null, created_at: 't', updated_at: 't' })
    const result = await addPosition(mockClient, 'pf-1', { ticker: 'SQM-B', quantity: 10, averageCost: 0 })
    assert.equal(result.ok, true)
    assert.equal(result.position?.averageCost, 0)
  })

  it('surfaces a duplicate-ticker conflict from a unique-violation error', async () => {
    const mockClient = mockSupabaseInsertError({ code: '23505', message: 'duplicate key' })
    const result = await addPosition(mockClient, 'pf-1', { ticker: 'SQM-B', quantity: 10 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'duplicate')
  })
})

describe('Phase 6C updatePosition / removePosition', () => {
  it('updatePosition rejects invalid quantity before touching the client', async () => {
    const result = await updatePosition(unusedClient, 'pf-1', 'SQM-B', { quantity: -1 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_quantity')
  })

  it('updatePosition rejects invalid average cost before touching the client', async () => {
    const result = await updatePosition(unusedClient, 'pf-1', 'SQM-B', { averageCost: -5 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_average_cost')
  })

  it('updatePosition returns not_found when the row is not visible to this user (RLS-filtered)', async () => {
    // RLS makes another user's row invisible rather than returning an error —
    // Supabase's .single() then resolves with a PGRST116 "no rows" error.
    const mockClient = mockSupabaseUpdateError({ code: 'PGRST116', message: 'no rows' })
    const result = await updatePosition(mockClient, 'pf-1', 'SQM-B', { quantity: 5 })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'update_failed')
  })

  it('removePosition scopes the delete by portfolio_id and ticker', async () => {
    const calls: string[] = []
    const mockClient = mockSupabaseDelete(calls)
    const result = await removePosition(mockClient, 'pf-1', 'SQM-B')
    assert.equal(result.ok, true)
    assert.ok(calls.includes('eq:portfolio_id:pf-1'))
    assert.ok(calls.includes('eq:ticker:SQM-B'))
  })
})

// ─── Mock Supabase client builders ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSupabaseInsert(row: Record<string, unknown>): any {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSupabaseInsertError(error: { code: string; message: string }): any {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error }),
        }),
      }),
    }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSupabaseUpdateError(error: { code: string; message: string }): any {
  return {
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({ data: null, error }),
            }),
          }),
        }),
      }),
    }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSupabaseDelete(calls: string[]): any {
  return {
    from: () => ({
      delete: () => ({
        eq: (col: string, val: string) => {
          calls.push(`eq:${col}:${val}`)
          return {
            eq: (col2: string, val2: string) => {
              calls.push(`eq:${col2}:${val2}`)
              return Promise.resolve({ error: null })
            },
          }
        },
      }),
    }),
  }
}

// ─── Valuation math (pure functions) ──────────────────────────────────────────

describe('Phase 6C valuation math', () => {
  const position: PositionInput = { ticker: 'SQM-B', quantity: 10, averageCost: 100, costCurrency: 'CLP', sector: 'Materials' }

  it('calculatePositionMarketValue multiplies quantity by price', () => {
    assert.equal(calculatePositionMarketValue(position, { price: 150, currency: 'CLP' }), 1500)
  })

  it('calculatePositionMarketValue returns null when there is no price', () => {
    assert.equal(calculatePositionMarketValue(position, { price: null, currency: null }), null)
  })

  it('calculateCostBasis returns null when averageCost is null', () => {
    const noCost: PositionInput = { ...position, averageCost: null }
    assert.equal(calculateCostBasis(noCost), null)
  })

  it('calculateUnrealizedPnL is marketValue minus costBasis', () => {
    assert.equal(calculateUnrealizedPnL(position, { price: 150, currency: 'CLP' }), 500) // 1500 - 1000
  })

  it('calculateUnrealizedPnLPct guards division by zero (zero cost basis -> null, not Infinity)', () => {
    const zeroCost: PositionInput = { ...position, averageCost: 0 }
    const pct = calculateUnrealizedPnLPct(zeroCost, { price: 150, currency: 'CLP' })
    assert.equal(pct, null)
  })

  it('calculateUnrealizedPnLPct computes percentage correctly', () => {
    const pct = calculateUnrealizedPnLPct(position, { price: 150, currency: 'CLP' })
    assert.equal(pct, 50) // 500 / 1000 * 100
  })

  it('isMixedCurrency flags when cost currency differs from live price currency', () => {
    const usdCost: PositionInput = { ...position, costCurrency: 'USD' }
    assert.equal(isMixedCurrency(usdCost, { price: 150, currency: 'CLP' }), true)
    assert.equal(isMixedCurrency(position, { price: 150, currency: 'CLP' }), false)
  })

  it('never produces NaN or Infinity — missing price yields null fields, not NaN', () => {
    const prices = new Map<string, { price: number | null; currency: string | null }>()
    const [valued] = valuePositions([position], prices)
    assert.equal(valued.marketValue, null)
    assert.equal(valued.unrealizedPnL, null)
    assert.equal(valued.weight, null)
    assert.notEqual(valued.marketValue, NaN)
  })

  it('calculatePortfolioTotals sums market value and cost basis across positions', () => {
    const prices = new Map([['SQM-B', { price: 150, currency: 'CLP' }], ['CHILE', { price: 50, currency: 'CLP' }]])
    const positions: PositionInput[] = [
      position,
      { ticker: 'CHILE', quantity: 20, averageCost: 40, costCurrency: 'CLP', sector: 'Financials' },
    ]
    const valued = valuePositions(positions, prices)
    const totals = calculatePortfolioTotals(valued)
    assert.equal(totals.totalMarketValue, 1500 + 1000) // 10*150 + 20*50
    assert.equal(totals.totalCostBasis, 1000 + 800)    // 10*100 + 20*40
    assert.equal(totals.totalUnrealizedPnL, 2500 - 1800)
    assert.equal(totals.positionCount, 2)
  })

  it('calculateSectorExposure groups by sector and computes weight', () => {
    const valued: ValuedPosition[] = [
      { ticker: 'SQM-B', quantity: 10, averageCost: 100, costCurrency: 'CLP', sector: 'Materials', latestPrice: 150, marketValue: 1500, costBasis: 1000, unrealizedPnL: 500, unrealizedPnLPct: 50, weight: 60, mixedCurrency: false },
      { ticker: 'CHILE', quantity: 20, averageCost: 40, costCurrency: 'CLP', sector: 'Financials', latestPrice: 50, marketValue: 1000, costBasis: 800, unrealizedPnL: 200, unrealizedPnLPct: 25, weight: 40, mixedCurrency: false },
    ]
    const exposure = calculateSectorExposure(valued)
    assert.equal(exposure.length, 2)
    const materials = exposure.find(e => e.sector === 'Materials')
    assert.equal(materials?.marketValue, 1500)
    assert.equal(materials?.weight, 60) // 1500 / 2500 * 100
  })

  it('calculateSectorExposure falls back to "Unknown" for a missing sector', () => {
    const valued: ValuedPosition[] = [
      { ticker: 'X', quantity: 1, averageCost: 1, costCurrency: 'CLP', sector: null, latestPrice: 10, marketValue: 10, costBasis: 1, unrealizedPnL: 9, unrealizedPnLPct: 900, weight: 100, mixedCurrency: false },
    ]
    const exposure = calculateSectorExposure(valued)
    assert.equal(exposure[0].sector, 'Unknown')
  })
})

// ─── Middleware: protects /portfolio without expanding scope ─────────────────

describe('Phase 6C middleware protection', () => {
  it('protects /portfolio page route', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes("'/portfolio'"), 'middleware must protect /portfolio')
  })

  it('protects /api/portfolios API route', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes("'/api/portfolios'"), 'middleware must protect /api/portfolios')
  })

  it('PROTECTED_PAGES contains watchlist + portfolio (structured-notes added in Phase 9A)', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    const match = src.match(/const PROTECTED_PAGES\s*=\s*(\[[^\]]*\])/)
    assert.ok(match, 'PROTECTED_PAGES declaration not found')
    const arr = JSON.parse(match![1].replace(/'/g, '"'))
    assert.ok(arr.includes('/portfolio') && arr.includes('/watchlist'))
    assert.deepEqual(arr.sort(), ['/portfolio', '/structured-notes', '/watchlist'])
  })

  it('PROTECTED_API contains watchlists + portfolios (structured-notes added in Phase 9A)', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    const match = src.match(/const PROTECTED_API\s*=\s*(\[[^\]]*\])/)
    assert.ok(match, 'PROTECTED_API declaration not found')
    const arr = JSON.parse(match![1].replace(/'/g, '"'))
    assert.ok(arr.includes('/api/portfolios') && arr.includes('/api/watchlists'))
    assert.deepEqual(arr.sort(), ['/api/portfolios', '/api/structured-notes', '/api/watchlists'])
  })

  it('cron routes remain unblocked', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes('/api/cron'), 'middleware should reference cron routes as untouched')
  })
})

// ─── API routes exist ──────────────────────────────────────────────────────────

describe('Phase 6C portfolio API routes', () => {
  const routes = [
    'src/app/api/portfolios/route.ts',
    'src/app/api/portfolios/[id]/route.ts',
    'src/app/api/portfolios/[id]/positions/route.ts',
    'src/app/api/portfolios/[id]/positions/[ticker]/route.ts',
  ]

  for (const r of routes) {
    it(`${r} exists`, () => {
      assert.ok(existsSync(join(ROOT, r)), `${r} not found`)
    })
  }

  it('routes require an authenticated user client and return 503 (not a crash) when unconfigured', () => {
    for (const r of routes) {
      const src = readFileSync(join(ROOT, r), 'utf8')
      assert.ok(src.includes('getSupabaseUserClient'), `${r} must use getSupabaseUserClient`)
      assert.ok(src.includes('Not configured'), `${r} must handle the unconfigured case`)
    }
  })

  it('no route references the service-role key', () => {
    for (const r of routes) {
      const src = readFileSync(join(ROOT, r), 'utf8')
      assert.ok(!src.includes('service_role'), `${r} must not use service_role key`)
      assert.ok(!src.includes('SUPABASE_SERVICE_ROLE'), `${r} must not reference SUPABASE_SERVICE_ROLE`)
    }
  })

  it('portfolio page does not reference the service-role key', () => {
    const src = readFileSync(join(ROOT, 'src/app/portfolio/page.tsx'), 'utf8')
    assert.ok(!src.includes('service_role'), 'portfolio page must not use service_role key')
    assert.ok(!src.includes('SUPABASE_SERVICE_ROLE'), 'portfolio page must not reference SUPABASE_SERVICE_ROLE')
  })
})

// ─── Regression: existing auth/watchlist + core migration untouched ──────────

describe('Phase 6C regression checks', () => {
  it('watchlist API routes still exist', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/[id]/items/route.ts')))
  })

  it('core migration still has all 11 original tables', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/20260625000000_create_market_intelligence_core.sql'), 'utf8')
    const tables = ['data_sources', 'companies', 'macro_indicators', 'macro_observations',
      'stock_snapshots', 'stock_ohlcv', 'index_snapshots', 'sector_performance',
      'cmf_filings', 'documents', 'ingestion_runs']
    for (const t of tables) {
      assert.ok(sql.includes(t), `core migration missing table: ${t}`)
    }
  })
})
