// Phase 5D.1 — Unit tests for ingestion health evaluation.
// No live Supabase, Yahoo Finance, or webhook calls — all inputs are mocked inline.
// Run: npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateMacroIngestionHealth,
  evaluateMarketIngestionHealth,
  evaluateOverallIngestionHealth,
  businessDaysBetween,
  calendarDaysBetween,
  formatHealthSummary,
  type MacroHealthInput,
  type MarketHealthInput,
} from '../src/lib/observability/ingestionHealth.ts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAILY_INDICATORS = ['tpm', 'usdclp', 'uf-diaria', 'swap1y', 'swap2y', 'btu10-ref', 'btu5']

// ─── businessDaysBetween ──────────────────────────────────────────────────────

describe('businessDaysBetween', () => {
  test('same day = 0', () => {
    const d = new Date('2026-07-01T00:00:00Z')
    assert.equal(businessDaysBetween(d, d), 0)
  })

  test('Mon→Tue = 1 business day', () => {
    assert.equal(
      businessDaysBetween(new Date('2026-06-29T00:00:00Z'), new Date('2026-06-30T00:00:00Z')),
      1,
    )
  })

  test('Mon→Wed = 2 business days', () => {
    assert.equal(
      businessDaysBetween(new Date('2026-06-29T00:00:00Z'), new Date('2026-07-01T00:00:00Z')),
      2,
    )
  })

  test('Fri→Mon = 1 business day (weekend skipped)', () => {
    // Fri Jun 26 → Mon Jun 29 — Sat/Sun not counted
    assert.equal(
      businessDaysBetween(new Date('2026-06-26T00:00:00Z'), new Date('2026-06-29T00:00:00Z')),
      1,
    )
  })

  test('Sat→Mon = 0 business days (run fell on a Saturday)', () => {
    assert.equal(
      businessDaysBetween(new Date('2026-06-27T00:00:00Z'), new Date('2026-06-29T00:00:00Z')),
      0,
    )
  })
})

// ─── calendarDaysBetween ──────────────────────────────────────────────────────

describe('calendarDaysBetween', () => {
  test('same day = 0', () => {
    const d = new Date('2026-07-01T00:00:00Z')
    assert.equal(calendarDaysBetween(d, d), 0)
  })

  test('1 day apart', () => {
    assert.equal(
      calendarDaysBetween(new Date('2026-06-30T00:00:00Z'), new Date('2026-07-01T00:00:00Z')),
      1,
    )
  })

  test('3 days apart', () => {
    assert.equal(
      calendarDaysBetween(new Date('2026-06-28T00:00:00Z'), new Date('2026-07-01T00:00:00Z')),
      3,
    )
  })
})

// ─── evaluateMacroIngestionHealth ────────────────────────────────────────────

describe('evaluateMacroIngestionHealth — run age', () => {
  test('healthy: latest run 1 business day ago', () => {
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-06-30T12:00:00Z', rowsFailed: 0 },
      observations: DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-06-30' })),
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.equal(r.status, 'healthy', `expected healthy, got ${r.status}`)
    assert.equal(r.alerts.filter(a => a.severity === 'critical').length, 0)
  })

  test('healthy: latest run today', () => {
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-07-01' })),
    }
    assert.equal(evaluateMacroIngestionHealth(input).status, 'healthy')
  })

  test('warning: latest run 3 business days ago', () => {
    // Mon Jul 1 as today; run from Wed Jun 25 (Thu=1, Fri=1, Mon=1 → 3 bdays)
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-06-25T12:00:00Z', rowsFailed: 0 },
      observations: DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-06-25' })),
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.equal(r.status, 'warning')
    assert.ok(r.alerts.some(a => a.code.includes('MACRO_RUN_AGING')))
  })

  test('stale: latest run 6 business days ago', () => {
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-06-20T12:00:00Z', rowsFailed: 0 },
      observations: DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-06-20' })),
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.equal(r.status, 'stale')
    assert.ok(r.alerts.some(a => a.code.includes('MACRO_RUN_STALE')))
  })

  test('failed: latest run status is failed', () => {
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'failed', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-06-30' })),
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.equal(r.status, 'failed')
    assert.ok(r.alerts.some(a => a.severity === 'critical' && a.code.includes('MACRO_RUN_FAILED')))
  })

  test('unknown: no run record', () => {
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: null,
      observations: [],
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.equal(r.status, 'unknown')
    assert.ok(r.alerts.some(a => a.code.includes('MACRO_RUN_UNKNOWN')))
  })
})

describe('evaluateMacroIngestionHealth — monthly indicators not wrongly stale', () => {
  test('monthly indicators from last month are not stale', () => {
    // Today = 2026-07-01; monthly obs from 2026-05-01 (~61 days) — BUT wait,
    // 45-day threshold applies. Let's use 2026-06-01 (30 days) — should be fine.
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: [
        { indicatorId: 'ipc-mensual',    maxDate: '2026-06-01' },  // 30 days
        { indicatorId: 'ipc-anual',      maxDate: '2026-06-01' },
        { indicatorId: 'imacec-anual',   maxDate: '2026-06-01' },
        { indicatorId: 'desempleo',      maxDate: '2026-06-01' },
      ],
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.deepEqual(r.staleIndicators, [], `monthly from Jun should not be stale, got: ${r.staleIndicators}`)
  })

  test('monthly indicators beyond 100 days ARE stale (threshold = 100 days for release-lag allowance)', () => {
    // Today = 2026-07-01; obs from 2026-02-01 = 150 days — genuinely missing 5 months
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: [
        { indicatorId: 'ipc-mensual',  maxDate: '2026-02-01' },  // 150 days
        { indicatorId: 'desempleo',    maxDate: '2026-02-01' },
      ],
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.ok(r.staleIndicators.includes('ipc-mensual'), 'ipc-mensual at 150 days should be stale')
    assert.ok(r.staleIndicators.includes('desempleo'),   'desempleo at 150 days should be stale')
  })

  test('indicatorsHealthy counts correctly', () => {
    const input: MacroHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: [
        { indicatorId: 'tpm',    maxDate: '2026-06-30' },  // healthy
        { indicatorId: 'usdclp', maxDate: '2026-06-30' },  // healthy
      ],
    }
    const r = evaluateMacroIngestionHealth(input)
    assert.equal(r.indicatorsTotal, 2)
    assert.equal(r.indicatorsHealthy, 2)
  })
})

// ─── evaluateMarketIngestionHealth ───────────────────────────────────────────

describe('evaluateMarketIngestionHealth', () => {
  test('healthy: latest snapshot 0 days old', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      latestSnapshotDate: '2026-07-01',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    }
    assert.equal(evaluateMarketIngestionHealth(input).status, 'healthy')
  })

  test('healthy: latest snapshot 1 day old', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-06-30T22:00:00Z', rowsFailed: 0 },
      latestSnapshotDate: '2026-06-30',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    }
    assert.equal(evaluateMarketIngestionHealth(input).status, 'healthy')
  })

  test('warning: latest snapshot 3 days old', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-06-28T22:00:00Z', rowsFailed: 0 },
      latestSnapshotDate: '2026-06-28',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    }
    const r = evaluateMarketIngestionHealth(input)
    assert.equal(r.status, 'warning')
    assert.ok(r.alerts.some(a => a.code.includes('MARKET_SNAPSHOT_AGING')))
  })

  test('stale: latest snapshot 5 days old', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-06-26T22:00:00Z', rowsFailed: 0 },
      latestSnapshotDate: '2026-06-26',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    }
    const r = evaluateMarketIngestionHealth(input)
    assert.equal(r.status, 'stale')
    assert.ok(r.alerts.some(a => a.code.includes('MARKET_SNAPSHOT_STALE')))
  })

  test('failed: run status is failed', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'failed', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      latestSnapshotDate: '2026-07-01',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    }
    const r = evaluateMarketIngestionHealth(input)
    assert.equal(r.status, 'failed')
    assert.ok(r.alerts.some(a => a.severity === 'critical' && a.code.includes('MARKET_RUN_FAILED')))
  })

  test('warning: partial_success with rowsFailed > 0 when otherwise healthy', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: { status: 'partial_success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 3 },
      latestSnapshotDate: '2026-07-01',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    }
    const r = evaluateMarketIngestionHealth(input)
    assert.equal(r.status, 'warning')
    assert.ok(r.alerts.some(a => a.code.includes('MARKET_PARTIAL')))
  })

  test('unknown: no run record', () => {
    const input: MarketHealthInput = {
      today: '2026-07-01',
      latestRun: null,
      latestSnapshotDate: null,
      latestSnapshotType: null,
    }
    assert.equal(evaluateMarketIngestionHealth(input).status, 'unknown')
  })
})

// ─── evaluateOverallIngestionHealth ──────────────────────────────────────────

describe('evaluateOverallIngestionHealth', () => {
  function macroResult(status: string) {
    return evaluateMacroIngestionHealth({
      today: '2026-07-01',
      latestRun: status === 'healthy' ? { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 } :
                 status === 'failed'  ? { status: 'failed', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 } : null,
      observations: status === 'healthy' ? DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-07-01' })) : [],
    })
  }
  function marketResult(status: string) {
    return evaluateMarketIngestionHealth({
      today: '2026-07-01',
      latestRun: status === 'healthy' ? { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 } :
                 status === 'failed'  ? { status: 'failed', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 } : null,
      latestSnapshotDate: status === 'healthy' ? '2026-07-01' : null,
      latestSnapshotType: 'close',
    })
  }

  test('both healthy → overall healthy', () => {
    const overall = evaluateOverallIngestionHealth(macroResult('healthy'), marketResult('healthy'))
    assert.equal(overall.overallStatus, 'healthy')
  })

  test('macro failed, market healthy → overall failed', () => {
    const overall = evaluateOverallIngestionHealth(macroResult('failed'), marketResult('healthy'))
    assert.equal(overall.overallStatus, 'failed')
  })

  test('macro healthy, market failed → overall failed', () => {
    const overall = evaluateOverallIngestionHealth(macroResult('healthy'), marketResult('failed'))
    assert.equal(overall.overallStatus, 'failed')
  })

  test('macro unknown, market healthy → overall unknown', () => {
    const overall = evaluateOverallIngestionHealth(macroResult('unknown'), marketResult('healthy'))
    assert.equal(overall.overallStatus, 'unknown')
  })

  test('alerts are aggregated from both sub-results', () => {
    const overall = evaluateOverallIngestionHealth(macroResult('failed'), marketResult('failed'))
    const codes = overall.alerts.map(a => a.code)
    assert.ok(codes.some(c => c.includes('MACRO')), 'should include macro alert')
    assert.ok(codes.some(c => c.includes('MARKET')), 'should include market alert')
  })

  test('result includes generatedAt timestamp', () => {
    const overall = evaluateOverallIngestionHealth(macroResult('healthy'), marketResult('healthy'))
    assert.ok(typeof overall.generatedAt === 'string' && overall.generatedAt.length > 0)
    assert.doesNotThrow(() => new Date(overall.generatedAt))
  })
})

// ─── formatHealthSummary ──────────────────────────────────────────────────────

describe('formatHealthSummary', () => {
  test('healthy summary contains no secret-like strings', () => {
    const macro = evaluateMacroIngestionHealth({
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: DAILY_INDICATORS.map(id => ({ indicatorId: id, maxDate: '2026-07-01' })),
    })
    const market = evaluateMarketIngestionHealth({
      today: '2026-07-01',
      latestRun: { status: 'success', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      latestSnapshotDate: '2026-07-01',
      latestSnapshotType: 'close',
      stockCount: 25, indexCount: 11, sectorCount: 11,
    })
    const overall = evaluateOverallIngestionHealth(macro, market)
    const summary = formatHealthSummary(overall)

    assert.ok(typeof summary === 'string' && summary.length > 0)
    assert.ok(!summary.includes('supabase.co'), 'no Supabase URL')
    assert.ok(!summary.includes('service_role'), 'no service_role')
    assert.ok(!summary.includes('BCCH_'), 'no BCCh creds')
    assert.ok(!summary.includes('eyJ'), 'no JWT fragments')
    assert.ok(summary.includes('HEALTHY') || summary.includes('healthy'), 'summary mentions status')
  })

  test('failed summary includes alert details', () => {
    const macro = evaluateMacroIngestionHealth({
      today: '2026-07-01',
      latestRun: { status: 'failed', startedAt: '2026-07-01T12:00:00Z', rowsFailed: 0 },
      observations: [],
    })
    const market = evaluateMarketIngestionHealth({
      today: '2026-07-01',
      latestRun: null,
      latestSnapshotDate: null,
      latestSnapshotType: null,
    })
    const overall = evaluateOverallIngestionHealth(macro, market)
    const summary = formatHealthSummary(overall)
    assert.ok(summary.includes('Alerts:'), 'failed summary should list alerts')
    assert.ok(summary.includes('CRITICAL') || summary.includes('WARNING'), 'alert severity shown')
  })
})
