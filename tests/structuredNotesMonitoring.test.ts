// Phase 9D — Structured Notes scheduled-monitoring calculation tests (pure).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getActiveStructuredNotesForMonitoring,
  getUniqueUnderlyingSymbols,
  calculateStructuredNoteSnapshot,
  detectStalePrice,
  classifyStructuredNoteRisk,
  evaluateCouponObservation,
  evaluateAutocallObservation,
  evaluateFinalObservation,
  evaluateObservation,
  shouldUpdateNoteStatus,
  deriveObservationStatus,
  calculateDashboardAggregates,
} from '../src/lib/structuredNotes/monitoring.ts'
import type { StructuredNote, StructuredNoteObservation } from '../src/lib/structuredNotes/types.ts'
import type { QuoteMetaEntry } from '../src/lib/structuredNotes/monitoring.ts'

function note(over: Partial<StructuredNote> = {}): StructuredNote {
  return {
    id: 'note-1', isin: 'XS0000000001', productName: 'Note', issuerName: 'Citi', issuerDisplayName: 'Citi',
    guarantorName: null, structureType: 'worst_of_autocall', payoffType: null, currency: 'USD',
    issueSize: 1000000, denomination: 1000, issuePricePct: 1,
    tradeDate: '2026-06-04', issueDate: '2026-06-11', initialValuationDate: '2026-06-04',
    finalValuationDate: '2028-06-05', maturityDate: '2028-06-12', redemptionDate: '2028-06-12',
    couponFrequency: 'quarterly', couponRatePeriodic: 0.025, couponRateAnnualized: 0.1,
    memoryCoupon: true, principalProtection: false,
    knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
    status: 'active', sourceType: 'pdf_extraction', sourceName: null, sourceFileName: null, confidenceScore: 1, archivedAt: null,
    underlyings: [
      { id: 'u-spx', underlyingOrder: 1, underlyingName: 'SPX Index', sourceTicker: 'SPX Index', bloombergTicker: 'SPX Index', yahooSymbol: '^GSPC', assetClass: 'index', initialLevel: 7576, strikeLevel: 7576, knockInBarrierLevel: 4924.4, couponBarrierLevel: 4924.4, autocallBarrierLevel: 7576, knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1 },
      { id: 'u-rty', underlyingOrder: 2, underlyingName: 'RTY Index', sourceTicker: 'RTY Index', bloombergTicker: 'RTY Index', yahooSymbol: '^RUT', assetClass: 'index', initialLevel: 2927, strikeLevel: 2927, knockInBarrierLevel: 1902.55, couponBarrierLevel: 1902.55, autocallBarrierLevel: 2927, knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1 },
    ],
    observations: [
      { id: 'o-1', observationNumber: 1, observationType: 'coupon', valuationDate: '2027-01-01', paymentDate: '2027-01-08', redemptionDate: null, couponDuePct: 0.025, autocallBarrierPct: 1, couponBarrierPct: 0.65, status: 'scheduled' },
    ],
    allocations: [],
    ...over,
  }
}

const today = '2027-01-01'

describe('getActiveStructuredNotesForMonitoring', () => {
  it('keeps only active notes, excluding autocalled/matured/defaulted/cancelled', () => {
    const notes = [note({ isin: 'A', status: 'active' }), note({ isin: 'B', status: 'autocalled' }), note({ isin: 'C', status: 'matured' })]
    const active = getActiveStructuredNotesForMonitoring(notes)
    assert.equal(active.length, 1)
    assert.equal(active[0].isin, 'A')
  })
})

describe('getUniqueUnderlyingSymbols', () => {
  it('dedupes symbols across notes', () => {
    const notes = [note({ isin: 'A' }), note({ isin: 'B' })]
    const symbols = getUniqueUnderlyingSymbols(notes)
    assert.deepEqual([...symbols].sort(), ['^GSPC', '^RUT'])
  })
  it('excludes underlyings with no Yahoo symbol', () => {
    const n = note({ underlyings: [{ ...note().underlyings[0], yahooSymbol: null }] })
    assert.equal(getUniqueUnderlyingSymbols([n]).length, 0)
  })
})

describe('calculateStructuredNoteSnapshot', () => {
  it('builds one row per underlying with the resolved price', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    const rows = calculateStructuredNoteSnapshot(note(), prices, today)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].price, 7000)
    assert.equal(rows[0].source, 'yahoo-finance')
    assert.equal(rows[0].noteId, 'note-1')
  })
  it('marks a missing price as unavailable, never fabricated', () => {
    const rows = calculateStructuredNoteSnapshot(note(), new Map(), today)
    assert.equal(rows[0].price, null)
    assert.equal(rows[0].source, 'unavailable')
  })
  it('returns an empty array when the note has no id', () => {
    const n = note({ id: undefined })
    assert.equal(calculateStructuredNoteSnapshot(n, new Map(), today).length, 0)
  })
})

describe('detectStalePrice', () => {
  it('is stale when there is no snapshot at all', () => {
    assert.equal(detectStalePrice(null, today), true)
    assert.equal(detectStalePrice(undefined, today), true)
  })
  it('is stale when price is null even with a date', () => {
    assert.equal(detectStalePrice({ priceDate: today, price: null }, today), true)
  })
  it('is fresh on the same day', () => {
    assert.equal(detectStalePrice({ priceDate: '2027-01-01', price: 100 }, '2027-01-01'), false)
  })
  it('is stale beyond the default 4-day window', () => {
    assert.equal(detectStalePrice({ priceDate: '2026-12-20', price: 100 }, '2027-01-01'), true)
  })
  it('respects a custom maxAgeDays', () => {
    assert.equal(detectStalePrice({ priceDate: '2026-12-30', price: 100 }, '2027-01-01', 10), false)
  })
})

describe('classifyStructuredNoteRisk', () => {
  it('matches the existing dashboard severity model (safe/watch/autocallable/breached/unavailable)', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    assert.equal(classifyStructuredNoteRisk(note(), prices, today), 'safe')
    const breachedPrices = new Map([['^GSPC', 4900], ['^RUT', 2700]])
    assert.equal(classifyStructuredNoteRisk(note(), breachedPrices, today), 'breached')
  })
  it('reports unavailable with no prices, never a fabricated safe status', () => {
    assert.equal(classifyStructuredNoteRisk(note(), new Map(), today), 'unavailable')
  })
})

describe('evaluateCouponObservation — worst-of strict eligibility', () => {
  it('is eligible only if every underlying clears its coupon barrier', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    const result = evaluateCouponObservation(note(), note().observations[0], prices)
    assert.equal(result.couponEligible, true)
    assert.equal(result.reviewRequired, false)
  })
  it('is not eligible if any single underlying breaches (strict worst-of)', () => {
    const prices = new Map([['^GSPC', 4900], ['^RUT', 2700]]) // SPX below its coupon barrier
    const result = evaluateCouponObservation(note(), note().observations[0], prices)
    assert.equal(result.couponEligible, false)
  })
  it('flags reviewRequired (not a fabricated false) when a price is missing', () => {
    const prices = new Map([['^GSPC', 7000]]) // RTY missing
    const result = evaluateCouponObservation(note(), note().observations[0], prices)
    assert.equal(result.couponEligible, null)
    assert.equal(result.reviewRequired, true)
    assert.match(result.reviewReason ?? '', /unavailable/)
  })
  it('never claims to be an official calculation-agent source', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    const result = evaluateCouponObservation(note(), note().observations[0], prices)
    assert.match(result.observedSource ?? '', /monitoring estimate/i)
    assert.doesNotMatch(result.observedSource ?? '', /official/i)
  })
})

describe('evaluateAutocallObservation — worst-of strict eligibility', () => {
  it('is eligible only if every underlying is at/above its autocall barrier', () => {
    const prices = new Map([['^GSPC', 7576], ['^RUT', 2927]])
    const result = evaluateAutocallObservation(note(), note().observations[0], prices)
    assert.equal(result.autocallEligible, true)
  })
  it('is not eligible if any underlying is below its autocall barrier', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2927]])
    const result = evaluateAutocallObservation(note(), note().observations[0], prices)
    assert.equal(result.autocallEligible, false)
  })
  it('flags reviewRequired on missing data', () => {
    const result = evaluateAutocallObservation(note(), note().observations[0], new Map())
    assert.equal(result.autocallEligible, null)
    assert.equal(result.reviewRequired, true)
  })
})

describe('evaluateFinalObservation — always reviewRequired (never a final legal determination)', () => {
  it('estimates a barrier breach from current levels but always flags reviewRequired', () => {
    const prices = new Map([['^GSPC', 4000], ['^RUT', 2700]]) // SPX below knock-in
    const result = evaluateFinalObservation(note(), note().observations[0], prices)
    assert.equal(result.finalBarrierBreached, true)
    assert.equal(result.reviewRequired, true)
    assert.match(result.reviewReason ?? '', /legal determination/i)
  })
  it('is still reviewRequired even when no breach is detected', () => {
    const prices = new Map([['^GSPC', 7576], ['^RUT', 2927]])
    const result = evaluateFinalObservation(note(), note().observations[0], prices)
    assert.equal(result.finalBarrierBreached, false)
    assert.equal(result.reviewRequired, true)
  })
  it('produces no NaN/Infinity', () => {
    const result = evaluateFinalObservation(note(), note().observations[0], new Map())
    assert.ok(result.worstPerformerReturn === null || Number.isFinite(result.worstPerformerReturn))
  })
})

describe('evaluateObservation — dispatch + due-date gating', () => {
  it('returns null for an observation not yet due', () => {
    const future: StructuredNoteObservation = { ...note().observations[0], valuationDate: '2028-01-01' }
    assert.equal(evaluateObservation(note(), future, new Map(), today), null)
  })
  it('returns null for an observation that is not scheduled (already finalized)', () => {
    const done: StructuredNoteObservation = { ...note().observations[0], status: 'coupon_paid' }
    assert.equal(evaluateObservation(note(), done, new Map(), today), null)
  })
  it('dispatches to the coupon evaluator for a due coupon observation', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    const result = evaluateObservation(note(), note().observations[0], prices, today)
    assert.equal(result?.observationType, 'coupon')
    assert.equal(result?.couponEligible, true)
  })
  it('dispatches to the autocall evaluator', () => {
    const obs: StructuredNoteObservation = { ...note().observations[0], observationType: 'autocall' }
    const prices = new Map([['^GSPC', 7576], ['^RUT', 2927]])
    const result = evaluateObservation(note(), obs, prices, today)
    assert.equal(result?.observationType, 'autocall')
    assert.equal(result?.autocallEligible, true)
  })
  it('dispatches to the final evaluator', () => {
    const obs: StructuredNoteObservation = { ...note().observations[0], observationType: 'final' }
    const result = evaluateObservation(note(), obs, new Map(), today)
    assert.equal(result?.observationType, 'final')
    assert.equal(result?.reviewRequired, true)
  })
})

describe('shouldUpdateNoteStatus — conservative automatic transitions', () => {
  it('transitions to autocalled when the autocall observation is cleanly eligible', () => {
    const evalResult = evaluateAutocallObservation(note(), note().observations[0], new Map([['^GSPC', 7576], ['^RUT', 2927]]))
    const update = shouldUpdateNoteStatus(note(), evalResult)
    assert.equal(update?.newStatus, 'autocalled')
  })
  it('never transitions on a final observation, even with a breach (requires manual verification)', () => {
    const evalResult = evaluateFinalObservation(note(), note().observations[0], new Map([['^GSPC', 4000], ['^RUT', 2700]]))
    assert.equal(shouldUpdateNoteStatus(note(), evalResult), null)
  })
  it('never reactivates or touches an already-archived note', () => {
    const archived = note({ status: 'autocalled' })
    const evalResult = evaluateAutocallObservation(archived, archived.observations[0], new Map([['^GSPC', 7576], ['^RUT', 2927]]))
    assert.equal(shouldUpdateNoteStatus(archived, evalResult), null)
  })
  it('does not transition when eligibility could not be determined (missing prices)', () => {
    const evalResult = evaluateAutocallObservation(note(), note().observations[0], new Map())
    assert.equal(shouldUpdateNoteStatus(note(), evalResult), null)
  })
})

describe('deriveObservationStatus', () => {
  it('maps a clean coupon-eligible evaluation to coupon_paid', () => {
    const r = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000], ['^RUT', 2700]]))
    assert.equal(deriveObservationStatus(r), 'coupon_paid')
  })
  it('maps a clean coupon-ineligible evaluation to coupon_missed', () => {
    const r = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 4900], ['^RUT', 2700]]))
    assert.equal(deriveObservationStatus(r), 'coupon_missed')
  })
  it('maps a clean autocall-eligible evaluation to autocalled', () => {
    const r = evaluateAutocallObservation(note(), note().observations[0], new Map([['^GSPC', 7576], ['^RUT', 2927]]))
    assert.equal(deriveObservationStatus(r), 'autocalled')
  })
  it('maps any reviewRequired evaluation to observed, never a fabricated terminal status', () => {
    const r = evaluateCouponObservation(note(), note().observations[0], new Map())
    assert.equal(deriveObservationStatus(r), 'observed')
  })
  it('always maps a final observation to observed, never matured', () => {
    const r = evaluateFinalObservation(note(), note().observations[0], new Map([['^GSPC', 7576], ['^RUT', 2927]]))
    assert.equal(deriveObservationStatus(r), 'observed')
  })
})

describe('observation QA — quoteMeta-driven review reasons (Phase 9E)', () => {
  it('reports missing_price when a quoteMeta entry is absent and the price is null', () => {
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000]])) // ^RUT missing, no quoteMeta
    assert.ok(result.reviewReasons.includes('missing_price'))
  })
  it('reports unsupported_symbol when quoteMeta marks the symbol unsupported', () => {
    const quoteMeta = new Map([['^RUT', { asOf: null, supported: false, providerError: false }]])
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000]]), quoteMeta)
    assert.ok(result.reviewReasons.includes('unsupported_symbol'))
  })
  it('reports provider_error when quoteMeta flags a provider error for a missing price', () => {
    const quoteMeta = new Map([['^RUT', { asOf: null, supported: true, providerError: true }]])
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000]]), quoteMeta)
    assert.ok(result.reviewReasons.includes('provider_error'))
  })
  it('reports non_trading_day_or_unavailable_close when quoteMeta flags it', () => {
    const quoteMeta = new Map([['^RUT', { asOf: null, supported: true, providerError: false, nonTradingDay: true }]])
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000]]), quoteMeta)
    assert.ok(result.reviewReasons.includes('non_trading_day_or_unavailable_close'))
  })
  it('reports ambiguous_underlying_mapping when an underlying never resolved a symbol at all', () => {
    const n = note({ underlyings: [{ ...note().underlyings[0], yahooSymbol: null }, note().underlyings[1]] })
    const result = evaluateCouponObservation(n, n.observations[0], new Map([['^RUT', 2700]]))
    assert.ok(result.reviewReasons.includes('ambiguous_underlying_mapping'))
  })
  it('reports stale_price using the tighter observation threshold via quoteMeta.asOf', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const quoteMeta = new Map([
      ['^GSPC', { asOf: twoDaysAgo, supported: true, providerError: false }],
      ['^RUT', { asOf: twoDaysAgo, supported: true, providerError: false }],
    ])
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000], ['^RUT', 2700]]), quoteMeta)
    assert.ok(result.reviewReasons.includes('stale_price'))
    assert.equal(result.reviewRequired, true)
  })
  it('reports large_price_move_warning when quoteMeta carries that quality reason', () => {
    const now = new Date().toISOString()
    const quoteMeta = new Map<string, QuoteMetaEntry>([
      ['^GSPC', { asOf: now, supported: true, providerError: false, qualityReasons: ['large_price_move_warning'] }],
      ['^RUT', { asOf: now, supported: true, providerError: false }],
    ])
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000], ['^RUT', 2700]]), quoteMeta)
    assert.ok(result.reviewReasons.includes('large_price_move_warning'))
  })
  it('a clean coupon evaluation with quoteMeta present but no issues has empty reviewReasons', () => {
    const now = new Date().toISOString()
    const quoteMeta = new Map([
      ['^GSPC', { asOf: now, supported: true, providerError: false }],
      ['^RUT', { asOf: now, supported: true, providerError: false }],
    ])
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000], ['^RUT', 2700]]), quoteMeta)
    assert.deepEqual(result.reviewReasons, [])
    assert.equal(result.reviewRequired, false)
  })
  it('final observations always include final_observation_requires_official_verification', () => {
    const now = new Date().toISOString()
    const quoteMeta = new Map([
      ['^GSPC', { asOf: now, supported: true, providerError: false }],
      ['^RUT', { asOf: now, supported: true, providerError: false }],
    ])
    const result = evaluateFinalObservation(note(), note().observations[0], new Map([['^GSPC', 7576], ['^RUT', 2927]]), quoteMeta)
    assert.ok(result.reviewReasons.includes('final_observation_requires_official_verification'))
    assert.equal(result.reviewRequired, true)
  })
  it('omitting quoteMeta preserves pre-9E behavior (reasons collapse to missing_price only)', () => {
    const result = evaluateCouponObservation(note(), note().observations[0], new Map([['^GSPC', 7000]]))
    assert.deepEqual(result.reviewReasons, ['missing_price'])
  })
  it('evaluateObservation threads quoteMeta through to the dispatched evaluator', () => {
    const quoteMeta = new Map([['^RUT', { asOf: null, supported: false, providerError: false }]])
    const result = evaluateObservation(note(), note().observations[0], new Map([['^GSPC', 7000]]), today, quoteMeta)
    assert.ok(result?.reviewReasons.includes('unsupported_symbol'))
  })
})

describe('calculateStructuredNoteSnapshot — quote-quality metadata (Phase 9E)', () => {
  it('attaches provider/sourceType/quality metadata when quoteMeta is supplied', () => {
    const quoteMeta = new Map<string, QuoteMetaEntry>([['^GSPC', { asOf: '2027-01-01T00:00:00.000Z', supported: true, providerError: false, qualityReasons: ['stale_price'] }]])
    const rows = calculateStructuredNoteSnapshot(note(), new Map([['^GSPC', 7000]]), today, quoteMeta)
    const spxRow = rows.find((r) => r.sourceSymbol === '^GSPC')
    assert.ok(spxRow?.metadata)
    assert.equal(spxRow?.metadata?.sourceType, 'free_monitoring_estimate')
    assert.deepEqual(spxRow?.metadata?.qualityReasons, ['stale_price'])
  })
  it('omits metadata for an underlying quoteMeta has no entry for (never fabricates it)', () => {
    const rows = calculateStructuredNoteSnapshot(note(), new Map([['^GSPC', 7000]]), today, new Map())
    assert.equal(rows[0].metadata, undefined)
  })
  it('omitting quoteMeta entirely preserves pre-9E behavior (no metadata field)', () => {
    const rows = calculateStructuredNoteSnapshot(note(), new Map([['^GSPC', 7000]]), today)
    assert.equal(rows[0].metadata, undefined)
  })
})

describe('calculateDashboardAggregates', () => {
  it('counts stale, unsupported, review-required, and due-soon notes', () => {
    const n1 = note({ isin: 'A' })
    const n2 = note({ isin: 'B', underlyings: [{ ...note().underlyings[0], yahooSymbol: null }] })
    const inputs = [
      { note: n1, latestSnapshotDate: today, latestSnapshotHasPrice: true, reviewRequired: false, daysToNextObservation: 3 },
      { note: n2, latestSnapshotDate: null, latestSnapshotHasPrice: false, reviewRequired: true, daysToNextObservation: null },
    ]
    const agg = calculateDashboardAggregates(inputs, today)
    assert.equal(agg.activeNoteCount, 2)
    assert.equal(agg.staleCount, 1)
    assert.equal(agg.unsupportedSymbolCount, 1)
    assert.equal(agg.reviewRequiredCount, 1)
    assert.equal(agg.dueSoonCount, 1)
  })
})
