// Phase 9A — Structured-note calculation tests (pure functions, no Supabase).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateBarrierLevel,
  calculateBarrierPct,
  calculateDistanceToBarrier,
  calculateUnderlyingPerformance,
  calculateCouponAnnualized,
  frequencyToPeriodsPerYear,
  calculateWorstPerformer,
  calculateCouponEligibility,
  calculateAutocallEligibility,
  calculateMaturityRedemptionAmount,
  calculateCurrentRiskStatus,
  calculateNextObservation,
  calculateDaysToNextObservation,
  calculateAllocationTotal,
  calculateCurrentNotional,
  calculateIssuerExposure,
  calculateEntityExposure,
  calculateTenorMonths,
} from '../src/lib/structuredNotes/calculations.ts'
import type { StructuredNoteUnderlying, UnderlyingPrice, StructuredNoteAllocation, StructuredNoteObservation } from '../src/lib/structuredNotes/types.ts'

function underlying(order: number, initial: number, couponBarrier: number, knockIn: number, autocall: number): StructuredNoteUnderlying {
  return {
    underlyingOrder: order, underlyingName: `U${order}`, sourceTicker: null, bloombergTicker: null, yahooSymbol: null,
    assetClass: 'index', initialLevel: initial, strikeLevel: initial, knockInBarrierLevel: knockIn,
    couponBarrierLevel: couponBarrier, autocallBarrierLevel: autocall, knockInBarrierPct: null, couponBarrierPct: null, autocallBarrierPct: null,
  }
}
function price(order: number, p: number | null): UnderlyingPrice {
  return { underlyingOrder: order, yahooSymbol: null, price: p, source: p === null ? 'unavailable' : 'yahoo-finance', sourceSymbol: null, asOf: p === null ? null : '2026-07-06T00:00:00Z' }
}

describe('barrier math (workbook parity)', () => {
  it('barrier level = strike × pct (workbook R28/R29)', () => {
    assert.equal(calculateBarrierLevel(2927, 0.65), 1902.55)
    assert.equal(Math.round(calculateBarrierLevel(7576, 0.65)! * 100) / 100, 4924.4)
  })
  it('barrier pct = level / strike', () => {
    assert.equal(calculateBarrierPct(1902.55, 2927), 0.65)
  })
  it('distance to barrier = barrier / current − 1 (workbook R60/R62)', () => {
    // price at strike (2927), coupon barrier 1902.55 → must fall 35% to hit barrier
    assert.equal(Math.round(calculateDistanceToBarrier(2927, 1902.55)! * 100) / 100, -0.35)
  })
  it('performance = current / initial − 1', () => {
    assert.equal(Math.round(calculateUnderlyingPerformance(2634.3, 2927)! * 100) / 100, -0.1)
  })
})

describe('NaN / Infinity guards', () => {
  it('never divides by zero', () => {
    assert.equal(calculateDistanceToBarrier(0, 100), null)
    assert.equal(calculateBarrierPct(100, 0), null)
    assert.equal(calculateUnderlyingPerformance(100, 0), null)
  })
  it('returns null for non-finite inputs, never NaN', () => {
    assert.equal(calculateBarrierLevel(null, 0.65), null)
    assert.equal(calculateBarrierLevel(NaN, 0.65), null)
    assert.equal(calculateBarrierLevel(Infinity, 0.65), null)
  })
})

describe('coupon annualization', () => {
  it('annualized = periodic × periods-per-year', () => {
    assert.equal(calculateCouponAnnualized(0.025375, 4), 0.1015)
  })
  it('frequency label → periods per year', () => {
    assert.equal(frequencyToPeriodsPerYear('quarterly'), 4)
    assert.equal(frequencyToPeriodsPerYear('Trimestrales'), 4)
    assert.equal(frequencyToPeriodsPerYear('semiannual'), 2)
    assert.equal(frequencyToPeriodsPerYear('annual'), 1)
    assert.equal(frequencyToPeriodsPerYear('weird'), null)
  })
})

describe('worst-of logic', () => {
  const us = [underlying(1, 2927, 1902.55, 1902.55, 2927), underlying(2, 7576, 4924.4, 4924.4, 7576)]
  it('worst performer is the weakest underlying', () => {
    const worst = calculateWorstPerformer(us, [price(1, 2634.3), price(2, 7576)]) // U1 −10%, U2 0%
    assert.equal(worst?.underlyingOrder, 1)
    assert.equal(Math.round(worst!.performance! * 100) / 100, -0.1)
  })
  it('coupon eligible only if all ≥ coupon barrier', () => {
    assert.equal(calculateCouponEligibility(us, [price(1, 2000), price(2, 5000)]), true)
    assert.equal(calculateCouponEligibility(us, [price(1, 1800), price(2, 5000)]), false)
  })
  it('coupon eligibility is null (unknown) when a price is missing — never a fake false', () => {
    assert.equal(calculateCouponEligibility(us, [price(1, null), price(2, 5000)]), null)
  })
  it('autocall eligible only if all ≥ autocall barrier', () => {
    assert.equal(calculateAutocallEligibility(us, [price(1, 2927), price(2, 7576)]), true)
    assert.equal(calculateAutocallEligibility(us, [price(1, 2900), price(2, 7576)]), false)
  })
})

describe('maturity redemption', () => {
  const us = [underlying(1, 2927, 1902.55, 1902.55, 2927), underlying(2, 7576, 4924.4, 4924.4, 7576)]
  it('no barrier event → par (100%)', () => {
    const finals = new Map([[1, 2500], [2, 7000]])
    const r = calculateMaturityRedemptionAmount({ underlyings: us }, finals)
    assert.equal(r.barrierEvent, false)
    assert.equal(r.perNotePct, 1)
  })
  it('barrier event → tracks worst performer, never below 0', () => {
    const finals = new Map([[1, 1000], [2, 7000]]) // U1 below KI (1902.55), −65.8%
    const r = calculateMaturityRedemptionAmount({ underlyings: us }, finals)
    assert.equal(r.barrierEvent, true)
    assert.ok(r.perNotePct! >= 0)
    assert.ok(r.perNotePct! < 1)
  })
  it('missing final level → all null (no fabricated redemption)', () => {
    const r = calculateMaturityRedemptionAmount({ underlyings: us }, new Map([[1, 2500]]))
    assert.equal(r.perNotePct, null)
  })
})

describe('risk status (no fake status without market data)', () => {
  const us = [underlying(1, 2927, 1902.55, 1902.55, 2927), underlying(2, 7576, 4924.4, 4924.4, 7576)]
  it('unavailable when no prices', () => {
    assert.equal(calculateCurrentRiskStatus({ underlyings: us, status: 'active' }, [price(1, null), price(2, null)]), 'unavailable')
  })
  it('safe when comfortably above coupon barrier', () => {
    assert.equal(calculateCurrentRiskStatus({ underlyings: us, status: 'active' }, [price(1, 2900), price(2, 7500)]), 'safe')
  })
  it('breached when at/below coupon barrier', () => {
    assert.equal(calculateCurrentRiskStatus({ underlyings: us, status: 'active' }, [price(1, 1800), price(2, 7500)]), 'breached')
  })
  it('autocallable when all ≥ autocall barrier', () => {
    assert.equal(calculateCurrentRiskStatus({ underlyings: us, status: 'active' }, [price(1, 2927), price(2, 7576)]), 'autocallable')
  })
  it('autocalled note is always autocallable status', () => {
    assert.equal(calculateCurrentRiskStatus({ underlyings: us, status: 'autocalled' }, []), 'autocallable')
  })
})

describe('observations', () => {
  const obs: StructuredNoteObservation[] = [
    { observationNumber: 1, observationType: 'coupon', valuationDate: '2026-09-04', paymentDate: '2026-09-14', redemptionDate: null, couponDuePct: 0.025, autocallBarrierPct: null, couponBarrierPct: 0.65, status: 'scheduled' },
    { observationNumber: 2, observationType: 'coupon', valuationDate: '2026-12-04', paymentDate: '2026-12-11', redemptionDate: null, couponDuePct: 0.025, autocallBarrierPct: null, couponBarrierPct: 0.65, status: 'scheduled' },
  ]
  it('next observation is the earliest future scheduled one', () => {
    assert.equal(calculateNextObservation(obs, '2026-10-01')?.valuationDate, '2026-12-04')
  })
  it('days to next observation', () => {
    assert.equal(calculateDaysToNextObservation(obs, '2026-12-01'), 3)
  })
  it('null when no future observation', () => {
    assert.equal(calculateNextObservation(obs, '2027-01-01'), null)
  })
})

describe('notional + exposure (workbook R51/R52/R66-73)', () => {
  const allocations: StructuredNoteAllocation[] = [
    { entityName: 'WATERMILL', custodian: 'Citi', notionalAmount: 600000, currency: 'USD', active: true },
    { entityName: 'DUBAI', custodian: 'Citi', notionalAmount: 450000, currency: 'USD', active: true },
    { entityName: 'OLD', custodian: null, notionalAmount: 100000, currency: 'USD', active: false },
  ]
  it('allocation total sums active only', () => {
    assert.equal(calculateAllocationTotal(allocations), 1050000)
  })
  it('current notional = total when active, 0 when called', () => {
    assert.equal(calculateCurrentNotional({ status: 'active' }, allocations), 1050000)
    assert.equal(calculateCurrentNotional({ status: 'autocalled' }, allocations), 0)
  })
  it('issuer exposure groups current notional by issuer', () => {
    const exp = calculateIssuerExposure([
      { issuerDisplayName: 'Citi', status: 'active', allocations },
      { issuerDisplayName: 'Citi', status: 'autocalled', allocations }, // called → 0
      { issuerDisplayName: 'Barclays', status: 'active', allocations: [{ entityName: 'X', custodian: null, notionalAmount: 500000, currency: 'USD', active: true }] },
    ])
    assert.equal(exp.find((e) => e.issuer === 'Citi')?.notional, 1050000)
    assert.equal(exp.find((e) => e.issuer === 'Barclays')?.notional, 500000)
  })
  it('entity exposure groups active allocations across notes', () => {
    const exp = calculateEntityExposure([{ status: 'active', allocations }])
    assert.equal(exp.find((e) => e.entityName === 'WATERMILL')?.notional, 600000)
    assert.ok(!exp.find((e) => e.entityName === 'OLD')) // inactive excluded
  })
})

describe('tenor', () => {
  it('tenor in months', () => {
    assert.equal(calculateTenorMonths('2026-06-04', '2028-06-12'), 24)
  })
  it('null for unparseable', () => {
    assert.equal(calculateTenorMonths('bad', '2028-06-12'), null)
  })
})
