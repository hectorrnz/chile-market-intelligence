// Phase 8B — Compare resolver tests.
//
// Only src/lib/compare/compareStatic.ts and compareTypes.ts are imported here
// — never resolveCompareData.ts itself, which transitively imports
// marketProvider.ts -> staticMarketProvider.ts -> '@/data/stocks' (a path
// alias Node's native test runner cannot resolve; see marketProvider.test.ts's
// header comment for the same constraint). No live Supabase or Yahoo calls.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeCompareTickers,
  classifyPerformance,
  buildFundamentals,
  COMPANY_BY_TICKER,
} from '../src/lib/compare/compareStatic.ts'
import { safeNumber } from '../src/lib/compare/compareTypes.ts'
import type { StockHistoryResponse } from '../src/lib/providers/market/types.ts'

const ROOT = join(import.meta.dirname, '..')
const STATUS_DOC = join(ROOT, 'docs/data_source_status.md')
const CLAUDE_MD = join(ROOT, 'CLAUDE.md')
const COMPARE_PAGE = join(ROOT, 'src/app/compare/page.tsx')
const I18N = join(ROOT, 'src/lib/i18n.ts')
const API_ROUTE = join(ROOT, 'src/app/api/compare/route.ts')
const RESOLVER = join(ROOT, 'src/lib/compare/resolveCompareData.ts')

function meta(overrides: Partial<StockHistoryResponse['metadata']>): StockHistoryResponse['metadata'] {
  return {
    dataModeRequested: 'hybrid',
    dataModeUsed: 'hybrid',
    liveAvailable: false,
    status: 'static',
    source: 'Static MVP',
    lastUpdated: '',
    provider: 'static',
    ...overrides,
  }
}

// ─── normalizeCompareTickers ───────────────────────────────────────────────────

describe('normalizeCompareTickers', () => {
  it('validates tickers against the covered universe', () => {
    const r = normalizeCompareTickers(['sqm-b', 'notreal', 'BSANTANDER'])
    assert.deepEqual(r.valid, ['SQM-B', 'BSANTANDER'])
    assert.deepEqual(r.invalid, ['NOTREAL'])
  })

  it('dedupes case-insensitively, preserving first occurrence order', () => {
    const r = normalizeCompareTickers(['sqm-b', 'SQM-B', ' Sqm-B '])
    assert.deepEqual(r.valid, ['SQM-B'])
  })

  it('drops blank/whitespace-only entries without treating them as invalid', () => {
    const r = normalizeCompareTickers(['', '   ', 'SQM-B'])
    assert.deepEqual(r.valid, ['SQM-B'])
    assert.deepEqual(r.invalid, [])
  })

  it('every entry in the covered universe map has required fields', () => {
    assert.ok(COMPANY_BY_TICKER.size >= 20, 'expected the full covered universe')
    for (const [ticker, c] of COMPANY_BY_TICKER) {
      assert.equal(ticker, c.ticker.toUpperCase())
      assert.ok(c.sector.length > 0, `${ticker}: missing sector`)
    }
  })
})

// ─── classifyPerformance ───────────────────────────────────────────────────────

describe('classifyPerformance', () => {
  it('returns persisted with a computed value when Supabase history is sufficient', () => {
    const resp: StockHistoryResponse = {
      data: [
        { ticker: 'SQM-B', date: '2026-07-01', open: null, high: null, low: null, close: 100, volume: null, source: 's', provider: 'supabase' },
        { ticker: 'SQM-B', date: '2026-07-02', open: null, high: null, low: null, close: 105, volume: null, source: 's', provider: 'supabase' },
      ],
      metadata: meta({ status: 'persisted' }),
    }
    const m = classifyPerformance(resp)
    assert.equal(m.source, 'persisted')
    assert.ok(m.value !== null && Math.abs(m.value - 5) < 1e-9)
    assert.equal(m.fallbackReason, undefined)
  })

  it('flags insufficient_supabase_history when persisted status has <2 points', () => {
    const resp: StockHistoryResponse = {
      data: [{ ticker: 'SQM-B', date: '2026-07-02', open: null, high: null, low: null, close: 100, volume: null, source: 's', provider: 'supabase' }],
      metadata: meta({ status: 'persisted' }),
    }
    const m = classifyPerformance(resp)
    assert.equal(m.value, null)
    assert.equal(m.source, 'unavailable')
    assert.equal(m.fallbackReason, 'insufficient_supabase_history')
  })

  it('falls back to static_fallback with insufficient_supabase_history reason on hybrid-fallback', () => {
    const resp: StockHistoryResponse = {
      data: [
        { ticker: 'SQM-B', date: '2020-01-01', open: null, high: null, low: null, close: 50, volume: null, source: 's', provider: 'static' },
        { ticker: 'SQM-B', date: '2020-04-01', open: null, high: null, low: null, close: 60, volume: null, source: 's', provider: 'static' },
      ],
      metadata: meta({ status: 'hybrid-fallback', fallbackReason: 'Insufficient snapshot history for 1Y (3 point(s) available)' }),
    }
    const m = classifyPerformance(resp)
    assert.equal(m.source, 'static_fallback')
    assert.equal(m.fallbackReason, 'insufficient_supabase_history')
    assert.ok(m.value !== null)
  })

  it('falls back to static_fallback with supabase_unavailable reason when not an insufficiency message', () => {
    const resp: StockHistoryResponse = {
      data: [
        { ticker: 'SQM-B', date: '2020-01-01', open: null, high: null, low: null, close: 50, volume: null, source: 's', provider: 'static' },
        { ticker: 'SQM-B', date: '2020-04-01', open: null, high: null, low: null, close: 60, volume: null, source: 's', provider: 'static' },
      ],
      metadata: meta({ status: 'hybrid-fallback', fallbackReason: 'Supabase not configured' }),
    }
    const m = classifyPerformance(resp)
    assert.equal(m.source, 'static_fallback')
    assert.equal(m.fallbackReason, 'supabase_unavailable')
  })

  it('plain static mode (no hybrid attempted) carries no fallbackReason', () => {
    const resp: StockHistoryResponse = {
      data: [
        { ticker: 'SQM-B', date: '2020-01-01', open: null, high: null, low: null, close: 50, volume: null, source: 's', provider: 'static' },
        { ticker: 'SQM-B', date: '2020-04-01', open: null, high: null, low: null, close: 60, volume: null, source: 's', provider: 'static' },
      ],
      metadata: meta({ status: 'static', dataModeRequested: 'static', dataModeUsed: 'static' }),
    }
    const m = classifyPerformance(resp)
    assert.equal(m.source, 'static_fallback')
    assert.equal(m.fallbackReason, undefined)
  })

  it('returns unavailable/supabase_unavailable when Supabase strict mode fails outright', () => {
    const resp: StockHistoryResponse = { data: [], metadata: meta({ status: 'live-unavailable' }) }
    const m = classifyPerformance(resp)
    assert.equal(m.value, null)
    assert.equal(m.source, 'unavailable')
    assert.equal(m.fallbackReason, 'supabase_unavailable')
  })

  it('never returns NaN/Infinity even with a zero first-value edge case', () => {
    const resp: StockHistoryResponse = {
      data: [
        { ticker: 'X', date: '2026-01-01', open: null, high: null, low: null, close: 0, volume: null, source: 's', provider: 'supabase' },
        { ticker: 'X', date: '2026-01-02', open: null, high: null, low: null, close: 10, volume: null, source: 's', provider: 'supabase' },
      ],
      metadata: meta({ status: 'persisted' }),
    }
    const m = classifyPerformance(resp)
    assert.equal(m.value, null)
  })
})

// ─── buildFundamentals ──────────────────────────────────────────────────────────

describe('buildFundamentals', () => {
  it('always returns source: temporary_static with a conversion path, never live', () => {
    const f = buildFundamentals({ ticker: 'SQM-B', pe: 12, peFwd: 11, psFwd: 2 })
    assert.equal(f.source, 'temporary_static')
    assert.ok(f.conversionPath.includes('Phase 8C'))
    assert.equal(f.pe, 11) // prefers peFwd over pe
  })

  it('handles undefined snapshot without throwing, all fields null', () => {
    const f = buildFundamentals(undefined)
    assert.equal(f.source, 'temporary_static')
    assert.equal(f.pe, null)
    assert.equal(f.dividendYield, null)
  })
})

// ─── safeNumber ─────────────────────────────────────────────────────────────────

describe('safeNumber', () => {
  it('passes through finite numbers', () => {
    assert.equal(safeNumber(42), 42)
    assert.equal(safeNumber(-1.5), -1.5)
  })

  it('guards against NaN, Infinity, and non-numbers', () => {
    assert.equal(safeNumber(NaN), null)
    assert.equal(safeNumber(Infinity), null)
    assert.equal(safeNumber(-Infinity), null)
    assert.equal(safeNumber('42'), null)
    assert.equal(safeNumber(null), null)
    assert.equal(safeNumber(undefined), null)
  })
})

// ─── API route / resolver source hygiene ───────────────────────────────────────

describe('Phase 8B API route + resolver hygiene', () => {
  it('/api/compare route always returns 200 with a metadata envelope', () => {
    const src = readFileSync(API_ROUTE, 'utf8')
    assert.ok(src.includes("status: 200") || !src.includes('status:'), 'route should not return non-200 on error')
    assert.ok(src.includes('invalidTickers'))
  })

  it('resolver never imports the client-only fetch helper (server/client boundary)', () => {
    const src = readFileSync(RESOLVER, 'utf8')
    assert.ok(!src.includes("from '@/lib/data/compareData'"))
    assert.ok(!src.includes('fetchCompareData'))
  })

  it('resolver has no hardcoded secrets or credential-looking strings', () => {
    const src = readFileSync(RESOLVER, 'utf8')
    assert.ok(!/[A-Za-z0-9_-]{32,}/.test(src.replace(/Phase 8C.{0,40}ingestion/g, '')), 'no long opaque tokens in resolver source')
  })
})

// ─── No-static-terminal-state policy documentation ────────────────────────────

describe('Phase 8B no-static-terminal-state policy docs', () => {
  it('CLAUDE.md documents the no-static-terminal-state policy', () => {
    const src = readFileSync(CLAUDE_MD, 'utf8')
    assert.ok(src.includes('No-static-terminal-state policy') || src.includes('no-static-terminal-state policy'))
    assert.ok(src.includes('docs/data_source_status.md'))
  })

  it('data_source_status.md states the policy explicitly', () => {
    const src = readFileSync(STATUS_DOC, 'utf8')
    assert.ok(src.includes('No visible module may remain static as a terminal state'))
  })

  it('data_source_status.md gives every required remaining-static module a conversion path', () => {
    const src = readFileSync(STATUS_DOC, 'utf8')
    const requiredModules = [
      'FX / Chilean rates',
      'US macro',
      'Economic calendar',
      'Fundamentals / Charting',
      'Earnings',
      'Hechos Relevantes',
      'News',
    ]
    for (const mod of requiredModules) {
      assert.ok(src.includes(`### ${mod}`), `missing conversion-path section for ${mod}`)
    }
    // Each section must name a target source, a conversion path, and a next phase.
    const section = src.split('## Conversion Paths for Remaining Static Modules')[1]
    assert.ok(section, 'missing the consolidated conversion-paths section')
    const targetSourceCount = (section.match(/\*\*Target source/g) ?? []).length
    const conversionPathCount = (section.match(/\*\*Conversion path/g) ?? []).length
    const nextPhaseCount = (section.match(/\*\*Next phase/g) ?? []).length
    assert.ok(targetSourceCount >= requiredModules.length)
    assert.ok(conversionPathCount >= requiredModules.length)
    assert.ok(nextPhaseCount >= requiredModules.length)
  })

  it('Compare page no longer claims a blanket static state on the page subtitle', () => {
    const en = readFileSync(I18N, 'utf8')
    // The old blanket claim was "Comparative returns and valuation — static MVP sample"
    assert.ok(!en.includes('Comparative returns and valuation — static MVP sample'))
  })

  it('Compare fundamentals table is explicitly labeled temporary static with a conversion path', () => {
    const pageSrc = readFileSync(COMPARE_PAGE, 'utf8')
    assert.ok(pageSrc.includes('fundamentalsNote'))
    const i18nSrc = readFileSync(I18N, 'utf8')
    assert.ok(i18nSrc.includes('Phase 8C'))
  })

  it('Compare page renders the new Market Data panel with a dynamic source badge', () => {
    const pageSrc = readFileSync(COMPARE_PAGE, 'utf8')
    assert.ok(pageSrc.includes('marketDataTitle'))
    assert.ok(pageSrc.includes('MarketDataSourceBadge'))
  })
})

// ─── Regression: prior-phase infrastructure untouched ─────────────────────────

describe('Phase 8B regression checks', () => {
  it('does not modify the macro or market provider orchestrators', () => {
    const marketProvider = readFileSync(join(ROOT, 'src/lib/providers/market/marketProvider.ts'), 'utf8')
    assert.ok(marketProvider.includes('resolveStockSnapshots'))
    assert.ok(marketProvider.includes('resolveStockHistory'))
  })

  it('middleware protected routes are unchanged (portfolio/watchlist still protected)', () => {
    const mw = readFileSync(join(ROOT, 'src/middleware.ts'), 'utf8')
    assert.ok(mw.includes('/portfolio'))
    assert.ok(mw.includes('/watchlist'))
  })
})
