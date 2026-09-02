// Phase 9B — Structured Notes dashboard aggregation tests (pure).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildBookDashboard, computeNoteMetrics } from '../src/lib/structuredNotes/dashboard.ts'
import type { StructuredNote } from '../src/lib/structuredNotes/types.ts'

function note(over: Partial<StructuredNote> = {}): StructuredNote {
  return {
    isin: 'XS0000000001', productName: 'Note', issuerName: 'Citi', issuerDisplayName: 'Citi',
    guarantorName: null, structureType: 'worst_of_autocall', payoffType: null, currency: 'USD',
    issueSize: 1000000, denomination: 1000, issuePricePct: 1,
    tradeDate: '2026-06-04', issueDate: '2026-06-11', initialValuationDate: '2026-06-04',
    finalValuationDate: '2028-06-05', maturityDate: '2028-06-12', redemptionDate: '2028-06-12',
    couponFrequency: 'quarterly', couponRatePeriodic: 0.025, couponRateAnnualized: 0.1,
    memoryCoupon: true, principalProtection: false,
    knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
    status: 'active', sourceType: 'pdf_extraction', sourceName: null, sourceFileName: null, confidenceScore: 1, archivedAt: null,
    underlyings: [
      { underlyingOrder: 1, underlyingName: 'SPX Index', sourceTicker: 'SPX Index', bloombergTicker: 'SPX Index', yahooSymbol: '^GSPC', assetClass: 'index', initialLevel: 7576, strikeLevel: 7576, knockInBarrierLevel: 4924.4, couponBarrierLevel: 4924.4, autocallBarrierLevel: 7576, knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1 },
      { underlyingOrder: 2, underlyingName: 'RTY Index', sourceTicker: 'RTY Index', bloombergTicker: 'RTY Index', yahooSymbol: '^RUT', assetClass: 'index', initialLevel: 2927, strikeLevel: 2927, knockInBarrierLevel: 1902.55, couponBarrierLevel: 1902.55, autocallBarrierLevel: 2927, knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1 },
    ],
    observations: [
      { observationNumber: 1, observationType: 'coupon', valuationDate: '2027-09-04', paymentDate: '2027-09-14', redemptionDate: null, couponDuePct: 0.025, autocallBarrierPct: null, couponBarrierPct: 0.65, status: 'scheduled' },
    ],
    allocations: [{ entityName: 'WATERMILL', custodian: 'Santander', notionalAmount: 1000000, currency: 'USD', active: true }],
    ...over,
  }
}

const today = '2027-01-01'

describe('computeNoteMetrics', () => {
  it('is "safe" (in the money) when both underlyings are above barriers but below autocall', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    const m = computeNoteMetrics(note(), prices, '2027-01-01T00:00:00Z', today)
    assert.equal(m.riskStatus, 'safe')
    assert.equal(m.currentNotional, 1000000)
    assert.equal(m.pricesAvailable, true)
  })
  it('is "autocallable" when both are at/above autocall barrier', () => {
    const prices = new Map([['^GSPC', 7576], ['^RUT', 2927]])
    assert.equal(computeNoteMetrics(note(), prices, null, today).riskStatus, 'autocallable')
  })
  it('is "breached" when one underlying is at/below its coupon barrier', () => {
    const prices = new Map([['^GSPC', 4900], ['^RUT', 2700]])
    assert.equal(computeNoteMetrics(note(), prices, null, today).riskStatus, 'breached')
  })
  it('is "unavailable" (never fake) when no prices are present', () => {
    const m = computeNoteMetrics(note(), new Map(), null, today)
    assert.equal(m.riskStatus, 'unavailable')
    assert.equal(m.minDistanceToCouponBarrier, null)
    assert.equal(m.pricesAvailable, false)
  })
  it('worst performer is the weaker underlying', () => {
    const prices = new Map([['^GSPC', 7576], ['^RUT', 2000]]) // RTY −31.7%
    const m = computeNoteMetrics(note(), prices, null, today)
    assert.equal(m.worstPerformer?.underlyingName, 'RTY Index')
  })
})

describe('buildBookDashboard (book-level summary)', () => {
  it('aggregates counts, notional and issuer exposure across the book', () => {
    const prices = new Map([['^GSPC', 7000], ['^RUT', 2700]])
    const notes = [
      note({ isin: 'A', issuerDisplayName: 'Citi' }),
      note({ isin: 'B', issuerDisplayName: 'HSBC', autocallBarrierPct: 1 }),
      // R13.7B2 § 20 — a called note is SETTLED here: its Mandatory Early
      // Redemption Date has passed, so the cash has left the book and it
      // correctly contributes nothing.
      note({
        isin: 'C', issuerDisplayName: 'Citi', status: 'autocalled',
        observations: [
          { observationNumber: 1, observationType: 'autocall', valuationDate: '2026-12-01', paymentDate: null, redemptionDate: '2026-12-08', couponDuePct: null, autocallBarrierPct: 1, couponBarrierPct: null, status: 'autocalled' },
        ],
      }),
    ]
    const { summary, metrics } = buildBookDashboard(notes, prices, '2027-01-01T00:00:00Z', today)
    assert.equal(summary.totalNotes, 3)
    assert.equal(summary.activeNotes, 2) // the autocalled one is not active
    assert.equal(summary.totalCurrentNotional, 2000000) // 2 active × 1M; the SETTLED called note contributes 0
    assert.equal(metrics.length, 3)
    // Citi exposure = 1M active (the settled Citi note contributes 0 current notional)
    assert.equal(summary.issuerExposure.find((e) => e.issuer === 'Citi')?.notional, 1000000)
    assert.equal(summary.issuerExposure.find((e) => e.issuer === 'HSBC')?.notional, 1000000)
  })

  it('R13.7B2 section 20: a called note whose redemption is still future KEEPS its notional', () => {
    // The window this exists for. The note stopped tracking the underlyings on
    // 2026-12-28, but the money is still at the issuer until 2027-01-06 — so
    // dropping it from AUM and from issuer credit exposure on the call date
    // would understate both, silently, for over a week.
    const pending = note({
      isin: 'D', issuerDisplayName: 'Citi', status: 'autocalled',
      observations: [
        { observationNumber: 1, observationType: 'autocall', valuationDate: '2026-12-28', paymentDate: null, redemptionDate: '2027-01-06', couponDuePct: null, autocallBarrierPct: 1, couponBarrierPct: null, status: 'autocalled' },
      ],
    })
    const { summary, metrics } = buildBookDashboard([pending], new Map(), null, today)
    assert.equal(summary.activeNotes, 0, 'it is no longer a LIVE position')
    assert.equal(summary.totalCurrentNotional, 1000000, 'but its cash is still outstanding')
    assert.equal(summary.issuerExposure.find((e) => e.issuer === 'Citi')?.notional, 1000000, 'issuer credit exposure persists until settlement')
    assert.equal(metrics[0].currentNotional, 1000000)

    // ...and once the redemption date passes, it leaves the book on its own.
    const after = buildBookDashboard([pending], new Map(), null, '2027-01-06')
    assert.equal(after.summary.totalCurrentNotional, 0)
    assert.equal(after.summary.issuerExposure.find((e) => e.issuer === 'Citi')?.notional, 0)
  })
  it('flags mixed currency without converting', () => {
    const notes = [note({ isin: 'A', currency: 'USD' }), note({ isin: 'B', currency: 'EUR' })]
    const { summary } = buildBookDashboard(notes, new Map(), null, today)
    assert.equal(summary.mixedCurrency, true)
  })
})
