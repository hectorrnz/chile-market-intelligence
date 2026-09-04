// R13.7 § 27 — contractual event-state regression matrix.
//
// The permanent guard for the defect this stage repaired: a note whose autocall
// condition was contractually satisfied was persisted as a coupon-only
// observation, evaluated against the 65% coupon barrier, and rendered as a
// green "Eligible" while the 100% call test never ran.
//
// The golden case is REAL: XS3164820824's own contractual levels and the closes
// this platform itself recorded for 2026-08-28, independently corroborated by
// the owner's term-sheet figures.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  evaluateCouponEvent,
  evaluateAutocallEvent,
  evaluateKnockInEvent,
  isBarrierEvent,
  deriveNoteLifecycle,
  deriveSettlementStatus,
  isVoidedByLifecycle,
  relativeToThreshold,
  moveToThreshold,
} from '../src/lib/structuredNotes/contractualEvents.ts'
import { resolveValuationCloses, toCloseMap, CLOSE_DISAGREEMENT_TOLERANCE } from '../src/lib/structuredNotes/valuationClose.ts'
import {
  claimObservationNotification,
  completeObservationNotification,
  releaseObservationNotification,
  updateObservationResult,
} from '../src/lib/db/repositories/structuredNotesRepository.ts'
import {
  previousTradingDay,
  isWeekend,
  isTradingDay,
  hasSessionSettled,
  toMarketDate,
  isIsoDate,
} from '../src/lib/structuredNotes/marketDate.ts'
import {
  evaluatePotentialAutocall,
  findNextAutocallObservation,
  bindingCushionLeg,
  downsideCushionPct,
  buildPotentialAutocallMessage,
} from '../src/lib/structuredNotes/autocallWarning.ts'
import { reconcileNote, contractualAutocallSchedule } from '../src/lib/structuredNotes/reconciliation.ts'
import { calculateCurrentNotional } from '../src/lib/structuredNotes/calculations.ts'
import { extractStructuredNoteTerms } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { dedupeObservationsByDate, withAutocallObservations } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'
import type { StructuredNote, StructuredNoteUnderlying, StructuredNoteObservation } from '../src/lib/structuredNotes/types.ts'

// ── The golden note: XS3164820824's real contractual terms ───────────────────

const RTY: StructuredNoteUnderlying = {
  id: 'u-rty', underlyingOrder: 1, underlyingName: 'RTY Index', sourceTicker: 'RTY Index',
  bloombergTicker: 'RTY Index', yahooSymbol: '^RUT', assetClass: 'index',
  initialLevel: 2940.54, strikeLevel: 2940.54,
  knockInBarrierLevel: 1911.351, couponBarrierLevel: 1911.351, autocallBarrierLevel: 2940.54,
  knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
}
const SPX: StructuredNoteUnderlying = {
  id: 'u-spx', underlyingOrder: 2, underlyingName: 'SPX Index', sourceTicker: 'SPX Index',
  bloombergTicker: 'SPX Index', yahooSymbol: '^GSPC', assetClass: 'index',
  initialLevel: 7565.3, strikeLevel: 7565.3,
  knockInBarrierLevel: 4917.445, couponBarrierLevel: 4917.445, autocallBarrierLevel: 7565.3,
  knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
}
const UNDERLYINGS = [RTY, SPX]

/** The closes this platform recorded for 2026-08-28, matching the owner's term-sheet figures. */
const GOLDEN_CLOSES = new Map<number, number | null>([[1, 2972.3718], [2, 7711.76]])

function obs(over: Partial<StructuredNoteObservation> = {}): StructuredNoteObservation {
  return {
    id: 'o-1', observationNumber: 1, observationType: 'coupon', valuationDate: '2026-08-28',
    paymentDate: '2026-09-04', redemptionDate: '2026-09-04',
    couponDuePct: 0.025, autocallBarrierPct: 1, couponBarrierPct: 0.65, status: 'scheduled',
    ...over,
  }
}

function goldenNote(over: Partial<StructuredNote> = {}): StructuredNote {
  return {
    id: 'note-golden', isin: 'XS3164820824', productName: 'Memory Coupon Barrier Autocall Notes',
    issuerName: 'Citigroup Global Markets Funding Luxembourg S.C.A.', issuerDisplayName: 'Citi',
    custodian: null, guarantorName: 'Citigroup Global Markets Limited',
    structureType: 'worst_of_memory_coupon_autocall', payoffType: 'barrier_contingent', currency: 'USD',
    issueSize: 1500000, denomination: 1000, issuePricePct: 1,
    tradeDate: '2026-05-28', issueDate: '2026-06-04', initialValuationDate: '2026-05-28',
    finalValuationDate: '2028-05-30', maturityDate: '2028-06-06', redemptionDate: '2028-06-06',
    couponFrequency: 'quarterly', couponRatePeriodic: 0.025, couponRateAnnualized: 0.1,
    memoryCoupon: true, principalProtection: false,
    knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
    status: 'active', sourceType: 'pdf_extraction', sourceName: 'Term sheet (Citi)',
    sourceFileName: null, confidenceScore: 1, archivedAt: null,
    underlyings: UNDERLYINGS,
    observations: [
      obs({ id: 'o-c1', observationType: 'coupon', valuationDate: '2026-08-28' }),
      obs({ id: 'o-a1', observationType: 'autocall', valuationDate: '2026-08-28', couponBarrierPct: null, couponDuePct: null }),
      obs({ id: 'o-c2', observationType: 'coupon', valuationDate: '2026-11-30', paymentDate: '2026-12-07', redemptionDate: '2026-12-07' }),
      obs({ id: 'o-a2', observationType: 'autocall', valuationDate: '2026-11-30', paymentDate: '2026-12-07', redemptionDate: '2026-12-07', couponBarrierPct: null, couponDuePct: null }),
      obs({ id: 'o-f', observationType: 'final', valuationDate: '2028-05-30', paymentDate: '2028-06-06', redemptionDate: '2028-06-06' }),
    ],
    allocations: [{ id: 'a-1', entityName: 'Watermill', custodian: null, notionalAmount: 500000, currency: 'USD', active: true }],
    ...over,
  }
}

// ═══ GOLDEN CASE ═════════════════════════════════════════════════════════════

describe('R13.7 golden case — XS3164820824 on 2026-08-28', () => {
  it('satisfies the coupon condition (every underlying above its 65% barrier)', () => {
    assert.equal(evaluateCouponEvent(UNDERLYINGS, GOLDEN_CLOSES).outcome, 'met')
  })

  it('satisfies the AUTOCALL condition — the test the old pipeline never ran', () => {
    const e = evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES)
    assert.equal(e.outcome, 'met')
    assert.ok(e.legs.every((l) => l.met === true))
    // The exact contractual comparison, leg by leg.
    assert.equal(e.legs.find((l) => l.underlyingName === 'RTY Index')!.threshold, 2940.54)
    assert.equal(e.legs.find((l) => l.underlyingName === 'SPX Index')!.threshold, 7565.3)
  })

  it('the coupon test and the autocall test use DIFFERENT thresholds on the same date', () => {
    const coupon = evaluateCouponEvent(UNDERLYINGS, GOLDEN_CLOSES)
    const autocall = evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES)
    const cRty = coupon.legs.find((l) => l.underlyingName === 'RTY Index')!.threshold
    const aRty = autocall.legs.find((l) => l.underlyingName === 'RTY Index')!.threshold
    assert.notEqual(cRty, aRty)
    assert.equal(cRty, 1911.351) // 65%
    assert.equal(aRty, 2940.54) // 100%
  })

  it('derives the terminal lifecycle state: autocalled on the contractual valuation date', () => {
    const lc = deriveNoteLifecycle([{
      valuationDate: '2026-08-28', redemptionDate: '2026-09-04',
      coupon: evaluateCouponEvent(UNDERLYINGS, GOLDEN_CLOSES),
      autocall: evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES),
      final: null,
    }], '2026-09-02')
    assert.equal(lc.status, 'autocalled')
    assert.equal(lc.effectiveDate, '2026-08-28')
    assert.equal(lc.redemptionDate, '2026-09-04')
    assert.equal(lc.settlement, 'pending') // redemption date not yet reached
  })

  it('identifies RTY as the binding underlying by NORMALIZED cushion, never raw price', () => {
    const e = evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES)
    assert.equal(e.bindingLeg?.underlyingName, 'RTY Index')
    // SPX has the far larger absolute level and the larger absolute gap, yet RTY
    // is binding — which is exactly what raw-price comparison would get wrong.
    const spx = e.legs.find((l) => l.underlyingName === 'SPX Index')!
    const rty = e.legs.find((l) => l.underlyingName === 'RTY Index')!
    assert.ok(spx.close! > rty.close!)
    assert.ok(spx.close! - spx.threshold! > rty.close! - rty.threshold!)
    assert.ok(rty.relativeToThresholdPct! < spx.relativeToThresholdPct!)
  })

  it('reproduces the owner-supplied cushion figures to 4 decimal places', () => {
    const e = evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES)
    const spx = e.legs.find((l) => l.underlyingName === 'SPX Index')!
    const rty = e.legs.find((l) => l.underlyingName === 'RTY Index')!
    assert.equal((spx.relativeToThresholdPct! * 100).toFixed(4), '1.9359')
    assert.equal((spx.moveToThresholdPct! * 100).toFixed(4), '-1.8992')
    assert.equal((rty.relativeToThresholdPct! * 100).toFixed(4), '1.0825')
    assert.equal((rty.moveToThresholdPct! * 100).toFixed(4), '-1.0709')
  })
})

// ═══ § 8 — WORST-OF / ALL-UNDERLYING LOGIC ═══════════════════════════════════

describe('ALL-underlying (worst-of) aggregation', () => {
  it('one underlying below its call level → NOT called, even with the other far above', () => {
    const closes = new Map<number, number | null>([[1, 2900], [2, 9000]])
    assert.equal(evaluateAutocallEvent(UNDERLYINGS, closes).outcome, 'not_met')
  })

  it('exactly at the threshold counts as met (the contract says "equal to or greater than")', () => {
    const closes = new Map<number, number | null>([[1, 2940.54], [2, 7565.3]])
    assert.equal(evaluateAutocallEvent(UNDERLYINGS, closes).outcome, 'met')
  })

  it('one tick below the threshold is not met', () => {
    const closes = new Map<number, number | null>([[1, 2940.53], [2, 7565.3]])
    assert.equal(evaluateAutocallEvent(UNDERLYINGS, closes).outcome, 'not_met')
  })

  it('coupon can pass while autocall fails — the ordinary mid-life state', () => {
    // Both above 65%, both below 100%.
    const closes = new Map<number, number | null>([[1, 2500], [2, 6500]])
    assert.equal(evaluateCouponEvent(UNDERLYINGS, closes).outcome, 'met')
    assert.equal(evaluateAutocallEvent(UNDERLYINGS, closes).outcome, 'not_met')
  })

  it('never compares two underlyings to each other by raw level', () => {
    // RTY at 2972 and SPX at 7711 — a naive cross-comparison would call RTY
    // "worse" on magnitude alone regardless of thresholds. Swapping only the
    // thresholds flips which leg binds, proving the comparison is normalized.
    const flipped = [
      { ...RTY, autocallBarrierLevel: 2000 },
      { ...SPX, autocallBarrierLevel: 7700 },
    ]
    const e = evaluateAutocallEvent(flipped, GOLDEN_CLOSES)
    assert.equal(e.bindingLeg?.underlyingName, 'SPX Index')
  })
})

// ═══ § 9 — MISSING DATA IS UNKNOWN, NEVER FALSE ══════════════════════════════

describe('undetermined data never becomes a negative determination', () => {
  it('a missing close yields unknown, not not_met', () => {
    const closes = new Map<number, number | null>([[1, 2972.3718], [2, null]])
    const e = evaluateAutocallEvent(UNDERLYINGS, closes)
    assert.equal(e.outcome, 'unknown')
    assert.equal(e.undeterminedLegs.length, 1)
  })

  it('an unknown autocall never terminates a note', () => {
    const lc = deriveNoteLifecycle([{
      valuationDate: '2026-08-28', redemptionDate: '2026-09-04',
      coupon: null,
      autocall: evaluateAutocallEvent(UNDERLYINGS, new Map([[1, null], [2, null]])),
      final: null,
    }], '2026-09-02')
    assert.equal(lc.status, 'active')
    assert.equal(lc.effectiveDate, null)
  })

  it('a confirmed failure still resolves even when another leg is missing (real determination, not a data gap)', () => {
    const closes = new Map<number, number | null>([[1, 100], [2, null]])
    assert.equal(evaluateAutocallEvent(UNDERLYINGS, closes).outcome, 'not_met')
  })

  it('an undetermined knock-in is not reported as "no breach"', () => {
    const e = evaluateKnockInEvent(UNDERLYINGS, new Map([[1, null], [2, null]]))
    assert.equal(isBarrierEvent(e), null)
  })

  it('a genuine breach is reported as a barrier event', () => {
    const e = evaluateKnockInEvent(UNDERLYINGS, new Map([[1, 1000], [2, 7711.76]]))
    assert.equal(isBarrierEvent(e), true)
  })
})

// ═══ § 9 — VALUATION-DATE PRICING, NOT RUN-DATE ══════════════════════════════

describe('valuation-date close resolution', () => {
  const snapshots = [
    { underlyingOrder: 1, priceDate: '2026-08-28', close: 2972.3718, source: 'yahoo-finance' },
    { underlyingOrder: 2, priceDate: '2026-08-28', close: 7711.76, source: 'yahoo-finance' },
    // A LATER day's levels, deliberately far below the call levels.
    { underlyingOrder: 1, priceDate: '2026-09-01', close: 2920.1323, source: 'yahoo-finance' },
    { underlyingOrder: 2, priceDate: '2026-09-01', close: 7631.47, source: 'yahoo-finance' },
  ]

  it('resolves the close for the requested date, never a nearby one', () => {
    const r = resolveValuationCloses(UNDERLYINGS, '2026-08-28', snapshots)
    assert.equal(r.find((x) => x.underlyingOrder === 1)!.close, 2972.3718)
    assert.equal(r.find((x) => x.underlyingOrder === 2)!.close, 7711.76)
  })

  it('a date with no close is unavailable — never substituted from another date', () => {
    const r = resolveValuationCloses(UNDERLYINGS, '2026-08-31', snapshots)
    assert.ok(r.every((x) => x.close === null))
    assert.ok(r.every((x) => x.source === 'unavailable'))
    assert.ok(r.every((x) => x.unavailableReason === 'no_close_for_valuation_date'))
  })

  it('evaluating a past observation cannot silently use a later day\'s price', () => {
    // The regression: 2026-08-28 was a call; 2026-09-01 was not. If the
    // resolver leaked the later date, the golden case would evaluate not_met.
    const onDate = evaluateAutocallEvent(UNDERLYINGS, toCloseMap(resolveValuationCloses(UNDERLYINGS, '2026-08-28', snapshots)))
    const laterDate = evaluateAutocallEvent(UNDERLYINGS, toCloseMap(resolveValuationCloses(UNDERLYINGS, '2026-09-01', snapshots)))
    assert.equal(onDate.outcome, 'met')
    assert.equal(laterDate.outcome, 'not_met')
  })

  it('prefers the persisted snapshot and corroborates it against provider history', () => {
    const history = [
      { underlyingOrder: 1, closesByDate: new Map([['2026-08-28', 2972.3718]]) },
      { underlyingOrder: 2, closesByDate: new Map([['2026-08-28', 7711.76]]) },
    ]
    const r = resolveValuationCloses(UNDERLYINGS, '2026-08-28', snapshots, history)
    assert.ok(r.every((x) => x.source === 'persisted_snapshot'))
    assert.ok(r.every((x) => x.corroborated))
  })

  it('flags a cross-source disagreement rather than silently picking a tier', () => {
    const history = [{ underlyingOrder: 1, closesByDate: new Map([['2026-08-28', 2500]]) }]
    const r = resolveValuationCloses(UNDERLYINGS, '2026-08-28', snapshots, history)
    const rty = r.find((x) => x.underlyingOrder === 1)!
    assert.ok(rty.disagreementPct !== null && rty.disagreementPct > CLOSE_DISAGREEMENT_TOLERANCE)
    assert.equal(rty.corroborated, false)
  })

  it('falls back to provider history when no snapshot exists for the date', () => {
    const history = [
      { underlyingOrder: 1, closesByDate: new Map([['2026-08-12', 3045.483]]) },
      { underlyingOrder: 2, closesByDate: new Map([['2026-08-12', 7748.5]]) },
    ]
    const r = resolveValuationCloses(UNDERLYINGS, '2026-08-12', [], history)
    assert.ok(r.every((x) => x.source === 'provider_history'))
    assert.equal(r.find((x) => x.underlyingOrder === 1)!.close, 3045.483)
  })
})

// ═══ § 11 — TERMINAL STATE ═══════════════════════════════════════════════════

describe('a call is terminal', () => {
  const called = {
    valuationDate: '2026-08-28', redemptionDate: '2026-09-04',
    coupon: evaluateCouponEvent(UNDERLYINGS, GOLDEN_CLOSES),
    autocall: evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES),
    final: null,
  }

  it('a later price collapse cannot un-call the note', () => {
    const later = {
      valuationDate: '2026-11-30', redemptionDate: '2026-12-07',
      coupon: evaluateCouponEvent(UNDERLYINGS, new Map([[1, 100], [2, 100]])),
      autocall: evaluateAutocallEvent(UNDERLYINGS, new Map([[1, 100], [2, 100]])),
      final: null,
    }
    const lc = deriveNoteLifecycle([called, later], '2027-01-01')
    assert.equal(lc.status, 'autocalled')
    assert.equal(lc.effectiveDate, '2026-08-28')
  })

  it('the EARLIEST call wins when several dates would qualify', () => {
    const secondCall = { ...called, valuationDate: '2026-11-30', redemptionDate: '2026-12-07' }
    const lc = deriveNoteLifecycle([secondCall, called], '2027-01-01')
    assert.equal(lc.effectiveDate, '2026-08-28')
  })

  it('observations after the call date are voided', () => {
    const lc = deriveNoteLifecycle([called], '2027-01-01')
    assert.equal(isVoidedByLifecycle('2026-11-30', lc), true)
    assert.equal(isVoidedByLifecycle('2026-08-28', lc), false)
  })

  it('a final observation never auto-matures a note ahead of an autocall', () => {
    const lc = deriveNoteLifecycle([called, {
      valuationDate: '2028-05-30', redemptionDate: '2028-06-06',
      coupon: null, autocall: null,
      final: evaluateKnockInEvent(UNDERLYINGS, GOLDEN_CLOSES),
    }], '2028-06-10')
    assert.equal(lc.status, 'autocalled')
  })
})

// ═══ § 12 — REDEMPTION / NOTIONAL ACCOUNTING ═════════════════════════════════

describe('called vs settled — notional accounting', () => {
  const allocations = goldenNote().allocations

  it('settlement is pending until the mandatory early redemption date', () => {
    assert.equal(deriveSettlementStatus('2026-09-04', '2026-09-02'), 'pending')
    assert.equal(deriveSettlementStatus('2026-09-04', '2026-09-04'), 'settled')
    assert.equal(deriveSettlementStatus('2026-09-04', '2026-09-10'), 'settled')
    assert.equal(deriveSettlementStatus(null, '2026-09-02'), 'unknown')
  })

  it('a called-but-unsettled note KEEPS its notional (the money is still at the issuer)', () => {
    const note = goldenNote({ status: 'autocalled' })
    assert.equal(calculateCurrentNotional(note, allocations, 'pending'), 500000)
  })

  it('a settled note releases its notional', () => {
    const note = goldenNote({ status: 'autocalled' })
    assert.equal(calculateCurrentNotional(note, allocations, 'settled'), 0)
  })

  it('an unrecorded redemption date keeps exposure visible rather than erasing it', () => {
    const note = goldenNote({ status: 'autocalled' })
    assert.equal(calculateCurrentNotional(note, allocations, 'unknown'), 500000)
  })

  it('omitting the settlement context preserves the pre-R13.7 behaviour exactly', () => {
    const note = goldenNote({ status: 'autocalled' })
    assert.equal(calculateCurrentNotional(note, allocations), 0)
    assert.equal(calculateCurrentNotional(goldenNote(), allocations), 500000)
  })
})

// ═══ § 13 — COUPON ON THE CALL DATE ══════════════════════════════════════════

describe('a coupon is not lost because the note also called', () => {
  it('both tests are evaluated and both results are retained for the same date', () => {
    const coupon = evaluateCouponEvent(UNDERLYINGS, GOLDEN_CLOSES)
    const autocall = evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES)
    assert.equal(coupon.outcome, 'met')
    assert.equal(autocall.outcome, 'met')
    const r = reconcileNote({
      note: goldenNote(),
      closesByDate: new Map([['2026-08-28', resolveValuationCloses(UNDERLYINGS, '2026-08-28', [
        { underlyingOrder: 1, priceDate: '2026-08-28', close: 2972.3718, source: 's' },
        { underlyingOrder: 2, priceDate: '2026-08-28', close: 7711.76, source: 's' },
      ])]]),
      asOf: '2026-09-02',
    })
    assert.equal(r.classification, 'confirmed_missed_autocall')
    assert.equal(r.couponOnCallDate, 'eligible')
  })
})

// ═══ § 10 — MARKET DATE / TIMEZONE / SESSIONS ════════════════════════════════

describe('market-date and session arithmetic', () => {
  it('derives the exchange-local date, not the UTC date', () => {
    // 2026-08-29T01:00:00Z is still 2026-08-28 in New York.
    assert.equal(toMarketDate('2026-08-29T01:00:00Z', 'America/New_York'), '2026-08-28')
    assert.equal(toMarketDate('2026-08-28T13:30:00Z', 'America/New_York'), '2026-08-28')
  })

  it('skips the weekend to find the prior trading session', () => {
    // 2026-08-31 is a Monday; its prior session is Friday 2026-08-28.
    assert.equal(previousTradingDay('2026-08-31'), '2026-08-28')
    assert.equal(isWeekend('2026-08-29'), true)
    assert.equal(isWeekend('2026-08-30'), true)
    assert.equal(isWeekend('2026-08-28'), false)
  })

  it('skips a supplied market holiday', () => {
    const holidays = new Set(['2026-08-28'])
    assert.equal(previousTradingDay('2026-08-31', holidays), '2026-08-27')
    assert.equal(isTradingDay('2026-08-28', holidays), false)
  })

  it('a past session is settled; a future one never is', () => {
    const now = new Date('2026-09-02T20:30:00Z')
    assert.equal(hasSessionSettled(now, '2026-09-01'), true)
    assert.equal(hasSessionSettled(now, '2026-09-03'), false)
  })

  it('the same day is settled only after the close plus the buffer', () => {
    // 19:00Z = 15:00 America/New_York (EDT) — before the close.
    assert.equal(hasSessionSettled(new Date('2026-09-02T19:00:00Z'), '2026-09-02'), false)
    // 20:20Z = 16:20 EDT — after the close plus the 15-minute buffer.
    assert.equal(hasSessionSettled(new Date('2026-09-02T20:20:00Z'), '2026-09-02'), true)
  })

  it('the winter cron slot is correctly treated as UNSETTLED (the DST trap)', () => {
    // 2027-01-04, 20:20Z = 15:20 America/New_York (EST) — the session is open.
    // The 20:20 UTC cron must defer here, not evaluate an intraday level.
    assert.equal(hasSessionSettled(new Date('2027-01-04T20:20:00Z'), '2027-01-04'), false)
    // The 21:15Z slot is 16:15 EST — settled.
    assert.equal(hasSessionSettled(new Date('2027-01-04T21:15:00Z'), '2027-01-04'), true)
  })

  it('rejects malformed dates rather than inventing one', () => {
    assert.equal(isIsoDate('2026-02-31'), false)
    assert.equal(isIsoDate('2026-13-01'), false)
    assert.equal(isIsoDate('2026-08-28'), true)
    assert.equal(previousTradingDay('not-a-date'), null)
  })
})

// ═══ § 19–24 — T-1 POTENTIAL AUTOCALL WARNING ════════════════════════════════

describe('T-1 potential autocall warning', () => {
  // Monday 2026-08-31 valuation; the warning session is Friday 2026-08-28.
  function warnNote(over: Partial<StructuredNote> = {}): StructuredNote {
    return goldenNote({
      observations: [
        obs({ id: 'o-a', observationType: 'autocall', valuationDate: '2026-08-31', paymentDate: '2026-09-07', redemptionDate: '2026-09-07' }),
      ],
      ...over,
    })
  }
  const freshCloses = resolveValuationCloses(UNDERLYINGS, '2026-08-28', [
    { underlyingOrder: 1, priceDate: '2026-08-28', close: 2972.3718, source: 's' },
    { underlyingOrder: 2, priceDate: '2026-08-28', close: 7711.76, source: 's' },
  ])

  it('warns on the PRIOR TRADING SESSION across a weekend, not calendar D-1', () => {
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-28' })
    assert.equal(r.warn, true)
    if (r.warn) assert.equal(r.warning.valuationDate, '2026-08-31')
  })

  it('does not warn on calendar D-1 when that is a Sunday', () => {
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-30' })
    assert.equal(r.warn, false)
    if (!r.warn) assert.equal(r.reason, 'not_the_prior_trading_session')
  })

  it('respects a market holiday when one is supplied', () => {
    const holidays = new Set(['2026-08-28'])
    const onFriday = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-28', holidays })
    assert.equal(onFriday.warn, false)
    const onThursday = evaluatePotentialAutocall({
      note: warnNote(), sessionDate: '2026-08-27', holidays,
      sessionCloses: resolveValuationCloses(UNDERLYINGS, '2026-08-27', [
        { underlyingOrder: 1, priceDate: '2026-08-27', close: 3014.34, source: 's' },
        { underlyingOrder: 2, priceDate: '2026-08-27', close: 7730.99, source: 's' },
      ]),
    })
    assert.equal(onThursday.warn, true)
  })

  it('does NOT warn when the condition is not currently satisfied', () => {
    const low = resolveValuationCloses(UNDERLYINGS, '2026-08-28', [
      { underlyingOrder: 1, priceDate: '2026-08-28', close: 2000, source: 's' },
      { underlyingOrder: 2, priceDate: '2026-08-28', close: 7711.76, source: 's' },
    ])
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: low, sessionDate: '2026-08-28' })
    assert.equal(r.warn, false)
    if (!r.warn) assert.equal(r.reason, 'condition_not_currently_satisfied')
  })

  it('DEFERS rather than warning when a close is unavailable', () => {
    const partial = resolveValuationCloses(UNDERLYINGS, '2026-08-28', [
      { underlyingOrder: 1, priceDate: '2026-08-28', close: 2972.3718, source: 's' },
    ])
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: partial, sessionDate: '2026-08-28' })
    assert.equal(r.warn, false)
    if (!r.warn) assert.equal(r.reason, 'deferred_stale_data')
  })

  it('warns only ONCE per (note, valuation date)', () => {
    const r = evaluatePotentialAutocall({
      note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-28',
      alreadyWarned: new Set(['2026-08-31']),
    })
    assert.equal(r.warn, false)
    if (!r.warn) assert.equal(r.reason, 'already_warned')
  })

  it('never warns for a note that is already called or otherwise not live', () => {
    for (const status of ['autocalled', 'matured', 'cancelled'] as const) {
      const r = evaluatePotentialAutocall({ note: warnNote({ status }), sessionCloses: freshCloses, sessionDate: '2026-08-28' })
      assert.equal(r.warn, false)
      if (!r.warn) assert.equal(r.reason, 'note_not_live')
    }
  })

  it('finds only AUTOCALL-typed observations — a coupon date is not a call opportunity', () => {
    const couponOnly = goldenNote({ observations: [obs({ observationType: 'coupon', valuationDate: '2026-08-31' })] })
    assert.equal(findNextAutocallObservation(couponOnly.observations, '2026-08-28'), null)
  })

  it('reports the binding cushion from the MOVE metric, and names RTY', () => {
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-28' })
    assert.equal(r.warn, true)
    if (!r.warn) return
    assert.equal(r.warning.bindingLeg?.underlyingName, 'RTY Index')
    const cushion = downsideCushionPct(r.warning.bindingLeg!)
    assert.equal((cushion! * 100).toFixed(2), '1.07')
    const spxLeg = r.warning.legs.find((l) => l.underlyingName === 'SPX Index')!
    assert.equal((downsideCushionPct(spxLeg)! * 100).toFixed(2), '1.90')
  })

  it('the binding leg is the smallest cushion, not the smallest price', () => {
    const legs = evaluateAutocallEvent(UNDERLYINGS, GOLDEN_CLOSES).legs
    assert.equal(bindingCushionLeg(legs)?.underlyingName, 'RTY Index')
  })

  it('the message states the valuation date and never claims the note is called', () => {
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-28' })
    assert.equal(r.warn, true)
    if (!r.warn) return
    const { title, body } = buildPotentialAutocallMessage(r.warning)
    assert.match(title, /Potential autocall/i)
    assert.match(body, /2026-08-31/)
    assert.match(body, /PRE-VALUATION warning/i)
    assert.match(body, /has not been called/i)
    assert.match(body, /RTY Index/)
    // Never asserts a completed call.
    assert.doesNotMatch(body, /was called/i)
    assert.doesNotMatch(body, /has been called(?! )/i)
  })

  it('a T-1 warning does not itself produce any called state', () => {
    const r = evaluatePotentialAutocall({ note: warnNote(), sessionCloses: freshCloses, sessionDate: '2026-08-28' })
    assert.equal(r.warn, true)
    // The warning shape carries no status field at all — it structurally cannot
    // transition a note.
    if (r.warn) assert.equal('status' in (r.warning as object), false)
  })
})

// ═══ § 5–6 — PARSERS AND DEDUPLICATION ═══════════════════════════════════════

describe('every issuer parser preserves the autocall test', () => {
  const FIXTURES: Record<string, string> = {
    citi: 'tests/fixtures/structured-notes/citi_sample_terms.txt',
    hsbc: 'tests/fixtures/structured-notes/hsbc_sample_terms.txt',
    barclays: 'tests/fixtures/structured-notes/barclays_sample_terms.txt',
    bbva: 'tests/fixtures/structured-notes/bbva_sample_terms.txt',
    bnp: 'tests/fixtures/structured-notes/bnp_sample_terms.txt',
    creditagricole: 'tests/fixtures/structured-notes/creditagricole_sample_terms.txt',
    santander: 'tests/fixtures/structured-notes/santander_sample_terms.txt',
  }

  for (const [issuer, path] of Object.entries(FIXTURES)) {
    it(`${issuer} emits at least one autocall observation`, () => {
      const r = extractStructuredNoteTerms([readFileSync(path, 'utf8')], { fileName: `${issuer}.pdf` })
      const observations = r.note?.observations ?? []
      const autocalls = observations.filter((o) => o.observationType === 'autocall')
      assert.ok(autocalls.length > 0, `${issuer} produced no autocall observation`)
      assert.ok(autocalls.every((o) => o.autocallBarrierPct !== null))
    })

    it(`${issuer} never erases a contractual test through a shared date`, () => {
      const r = extractStructuredNoteTerms([readFileSync(path, 'utf8')], { fileName: `${issuer}.pdf` })
      const observations = r.note?.observations ?? []
      const keys = observations.map((o) => `${o.valuationDate}::${o.observationType}`)
      assert.equal(new Set(keys).size, keys.length)
    })
  }

  it('the final valuation date never carries an autocall test', () => {
    const r = extractStructuredNoteTerms([readFileSync(FIXTURES.citi, 'utf8')], { fileName: 'citi.pdf' })
    const observations = r.note!.observations
    const finalDates = new Set(observations.filter((o) => o.observationType === 'final').map((o) => o.valuationDate))
    assert.ok(observations.filter((o) => o.observationType === 'autocall').every((o) => !finalDates.has(o.valuationDate)))
  })

  it('withAutocallObservations never invents a call for a note with no call level', () => {
    const noCall: StructuredNoteObservation[] = [obs({ autocallBarrierPct: null })]
    assert.equal(withAutocallObservations(noCall, null, null).filter((o) => o.observationType === 'autocall').length, 0)
  })

  it('deduplication keeps a same-date coupon and autocall apart', () => {
    const rows: StructuredNoteObservation[] = [
      obs({ observationType: 'coupon', valuationDate: '2026-08-28' }),
      obs({ observationType: 'autocall', valuationDate: '2026-08-28' }),
    ]
    const out = dedupeObservationsByDate(rows)
    assert.equal(out.length, 2)
    assert.ok(out.some((o) => o.observationType === 'autocall'))
    assert.ok(out.some((o) => o.observationType === 'coupon'))
  })
})

// ═══ § 15 — DISTANCE FORMULAS ════════════════════════════════════════════════

describe('the two distance metrics are distinct and correctly signed', () => {
  it('cushion and required-move are NOT negations of each other', () => {
    const above = relativeToThreshold(7711.76, 7565.3)
    const move = moveToThreshold(7711.76, 7565.3)
    assert.ok(above! > 0) // sits above the level
    assert.ok(move! < 0) // must fall to reach it
    assert.notEqual(Math.abs(above!).toFixed(6), Math.abs(move!).toFixed(6))
  })

  it('a level below its threshold reverses both signs', () => {
    assert.ok(relativeToThreshold(7000, 7565.3)! < 0)
    assert.ok(moveToThreshold(7000, 7565.3)! > 0)
  })

  it('guards a zero or missing denominator instead of returning Infinity', () => {
    assert.equal(relativeToThreshold(100, 0), null)
    assert.equal(moveToThreshold(0, 100), null)
    assert.equal(relativeToThreshold(null, 100), null)
    assert.equal(moveToThreshold(100, null), null)
  })
})

// ═══ § 28–29 — RECONCILIATION ════════════════════════════════════════════════

describe('reconciliation analysis', () => {
  const closes = new Map([['2026-08-28', resolveValuationCloses(UNDERLYINGS, '2026-08-28', [
    { underlyingOrder: 1, priceDate: '2026-08-28', close: 2972.3718, source: 's' },
    { underlyingOrder: 2, priceDate: '2026-08-28', close: 7711.76, source: 's' },
  ])]])

  it('confirms a missed autocall and proposes the exact state change', () => {
    const r = reconcileNote({ note: goldenNote(), closesByDate: closes, asOf: '2026-09-02' })
    assert.equal(r.classification, 'confirmed_missed_autocall')
    assert.equal(r.storedStatus, 'active')
    assert.equal(r.expectedStatus, 'autocalled')
    assert.equal(r.expectedCallDate, '2026-08-28')
    assert.equal(r.expectedRedemptionDate, '2026-09-04')
    assert.equal(r.settlement, 'pending')
    assert.ok(r.proposedChanges.some((c) => c.table === 'structured_notes' && c.field === 'status' && c.to === 'autocalled'))
  })

  it('voids only the observations AFTER the call date', () => {
    const r = reconcileNote({ note: goldenNote(), closesByDate: closes, asOf: '2026-09-02' })
    assert.ok(r.voidedObservationDates.includes('2026-11-30'))
    assert.ok(!r.voidedObservationDates.includes('2026-08-28'))
  })

  it('classifies insufficient data as such, never as "not called"', () => {
    const r = reconcileNote({ note: goldenNote(), closesByDate: new Map(), asOf: '2026-09-02' })
    assert.equal(r.classification, 'insufficient_data')
  })

  it('returns not_called for a note whose levels did not clear the call level', () => {
    const low = new Map([['2026-08-28', resolveValuationCloses(UNDERLYINGS, '2026-08-28', [
      { underlyingOrder: 1, priceDate: '2026-08-28', close: 2000, source: 's' },
      { underlyingOrder: 2, priceDate: '2026-08-28', close: 6000, source: 's' },
    ])]])
    const r = reconcileNote({ note: goldenNote(), closesByDate: low, asOf: '2026-09-02' })
    assert.equal(r.classification, 'not_called')
    assert.equal(r.proposedChanges.length, 0)
  })

  it('recommends a HISTORICAL CORRECTION notification, never a live "called" alert', () => {
    const r = reconcileNote({ note: goldenNote(), closesByDate: closes, asOf: '2026-09-02' })
    assert.match(r.proposedNotification, /Historical correction/i)
    assert.match(r.proposedNotification, /Do NOT emit a standard/i)
  })

  it('proposes an audit record identifying the note, both states and the evidence', () => {
    const r = reconcileNote({ note: goldenNote(), closesByDate: closes, asOf: '2026-09-02' })
    const a = r.proposedAuditRecord
    assert.equal(a.targetIsin, 'XS3164820824')
    assert.equal(a.previousStatus, 'active')
    assert.equal(a.correctedStatus, 'autocalled')
    assert.equal(a.originalContractualEventDate, '2026-08-28')
    assert.ok(Array.isArray(a.evidence) && (a.evidence as unknown[]).length === 2)
    assert.ok(typeof a.reasonCode === 'string')
  })

  it('reconstructs the contractual autocall schedule for a note imported without one', () => {
    const legacy = goldenNote({
      observations: [
        obs({ observationType: 'coupon', valuationDate: '2026-08-28' }),
        obs({ observationType: 'coupon', valuationDate: '2026-11-30' }),
        obs({ observationType: 'final', valuationDate: '2028-05-30' }),
      ],
    })
    const schedule = contractualAutocallSchedule(legacy)
    assert.equal(schedule.length, 2)
    assert.ok(schedule.every((s) => s.synthesized))
    assert.ok(!schedule.some((s) => s.valuationDate === '2028-05-30')) // the final date is not a call opportunity
    const r = reconcileNote({ note: legacy, closesByDate: closes, asOf: '2026-09-02' })
    assert.equal(r.observationsToInsert.length, 2)
    assert.ok(r.observationsToInsert.every((o) => o.observationType === 'autocall'))
  })

  it('prefers real autocall observations over reconstruction when they exist', () => {
    const schedule = contractualAutocallSchedule(goldenNote())
    assert.ok(schedule.every((s) => !s.synthesized))
  })
})

// R13.7 § 16 — chart / reference-line unit coherence.

describe('gauge reference lines share one unit system', () => {
  const DETAIL = readFileSync('src/app/structured-notes/[id]/page.tsx', 'utf8')

  it('the current level is normalized to the underlying own strike (100 = strike)', () => {
    assert.ok(DETAIL.includes('(d.currentLevel / strike) * 100'))
  })

  it('every reference mark is expressed in that same normalized unit', () => {
    // Marks are built from PERCENTAGES times 100, never from an absolute level.
    for (const pct of ['kiPct * 100', 'couponPct * 100', 'autocallPct * 100']) {
      assert.ok(DETAIL.includes(pct), 'missing normalized mark: ' + pct)
    }
    assert.ok(DETAIL.includes("kind: 'strike' as const, level: 100"))
  })

  it('a raw absolute barrier level is never placed on the gauge', () => {
    // Putting SPX ~7565 and RTY ~2940 on one 0-130 track would be meaningless.
    // Anchored on the mark-construction block's own boundaries rather than on
    // an incidental local variable name (R13.7B2.2 renamed the de-duplicator),
    // so the invariant is what is asserted, not the spelling.
    const from = DETAIL.indexOf('const rawMarks')
    const to = DETAIL.indexOf('const gaugeMarks')
    assert.ok(from > 0 && to > from, 'the gauge mark-construction block must be locatable')
    const gaugeBlock = DETAIL.slice(from, to)
    for (const raw of ['autocallBarrierLevel', 'couponBarrierLevel', 'knockInBarrierLevel']) {
      assert.ok(!gaugeBlock.includes(raw), 'raw level must not feed the normalized gauge: ' + raw)
    }
  })

  it('coinciding thresholds collapse to one tick instead of stacking', () => {
    const from = DETAIL.indexOf('const rawMarks')
    const to = DETAIL.indexOf('const gaugeMarks')
    const block = DETAIL.slice(from, to)
    // One tick per DISTINCT normalized level, keyed on the rounded level.
    assert.match(block, /Math\.round\(m\.level \* 100\) \/ 100/)
    assert.match(block, /byLevel/)
  })

  it('the distance columns declare their sign convention', () => {
    assert.ok(DETAIL.includes('t.sn.distanceConvention'))
    assert.ok(DETAIL.includes('t.sn.distanceAutocall'))
  })

  // R13.7B2.2 § 8 — the normalized reading must be self-explanatory. An
  // unlabelled "Current 101.9" against raw levels of 7,711 and 2,972 was the
  // single most confusing element of the owner review.
  it('the gauge states its basis instead of printing a bare number', () => {
    assert.ok(DETAIL.includes('t.sn.gaugeNormalized'), 'the reading must be named as normalized')
    assert.ok(DETAIL.includes('t.sn.gaugeBasis'), 'the 100 = initial / call level basis must be stated')
    assert.ok(!DETAIL.includes('t.fable.barrier.current'), 'the bare "Current <n>" summary must be gone')
  })

  it('every gauge mark carries a name, and the legend repeats them visibly', () => {
    const from = DETAIL.indexOf('const rawMarks')
    const to = DETAIL.indexOf('const gaugeMarks')
    const block = DETAIL.slice(from, to)
    for (const key of ['t.sn.gaugeMarkKnockIn', 't.sn.gaugeMarkCoupon', 't.sn.gaugeMarkAutocall', 't.sn.gaugeMarkStrike']) {
      assert.ok(block.includes(key), 'unnamed gauge mark: ' + key)
    }
    // Not hover-only: a visible legend component renders the same names.
    assert.match(DETAIL, /function GaugeLegend\(\)/)
    assert.match(DETAIL, /<GaugeLegend \/>/)
  })

  it('the raw market level stays visible alongside the normalized gauge', () => {
    assert.ok(DETAIL.includes('t.sn.currentLevel'))
    assert.match(DETAIL, /fmtNum\(d\.currentLevel\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R13.7B2 § 6 — CONCURRENCY.
//
// The B1 delivery marker was read-then-write: two crons firing together both
// read "absent", both send, both mark sent. Two Vercel slots plus a manual
// invocation make that a real arrangement, so these tests exercise CONCURRENT
// workers, not merely repeated sequential calls.
//
// The fake client below reproduces the one Postgres property the fix relies on:
// a conditional UPDATE on a single row is atomic, and a writer whose predicate
// no longer matches the committed row updates ZERO rows. It is deliberately
// pessimistic — both workers read before either writes, which is exactly the
// interleaving that broke the previous design.
// ─────────────────────────────────────────────────────────────────────────────

/** A single-row store with conditional-update semantics matching PostgREST + Postgres READ COMMITTED. */
function makeRowStore(initialMetadata: Record<string, unknown> = {}) {
  const row: { id: string; status: string; metadata: Record<string, unknown> } = {
    id: 'obs-1', status: 'scheduled', metadata: initialMetadata,
  }
  const client = {
    from() {
      const filters: { path: string; op: 'eq' | 'is'; value: unknown }[] = []
      let pending: Record<string, unknown> | null = null
      const api = {
        select() { return api },
        update(patch: Record<string, unknown>) { pending = patch; return api },
        eq(path: string, value: unknown) { filters.push({ path, op: 'eq', value }); return api },
        is(path: string, value: unknown) { filters.push({ path, op: 'is', value }); return api },
        maybeSingle() { return Promise.resolve({ data: { metadata: row.metadata, status: row.status }, error: null }) },
        // Resolving the builder performs the write, applying every filter to the
        // CURRENT committed row — the re-evaluation Postgres does for a blocked
        // writer once the winner commits.
        then(resolve: (r: { data: unknown[]; error: null }) => void) {
          const read = (path: string): unknown => {
            if (path === 'id') return row.id
            if (path === 'status') return row.status
            const m = path.match(/^metadata->notifications->([a-z_]+)(->>(\w+))?$/)
            if (!m) return undefined
            const notifications = (row.metadata['notifications'] ?? {}) as Record<string, unknown>
            const rec = notifications[m[1]]
            if (m[3] === undefined) return rec ?? null
            return rec && typeof rec === 'object' ? ((rec as Record<string, unknown>)[m[3]] ?? null) : null
          }
          const matches = filters.every((f) => (f.op === 'is' ? read(f.path) === null : read(f.path) === f.value))
          if (matches && pending) Object.assign(row, pending)
          resolve({ data: matches ? [{ id: row.id }] : [], error: null })
        },
      }
      return api
    },
  }
  return { row, client: client as never }
}

const OBS_PATCH = {
  status: 'coupon_paid' as const, observedAt: null, observedSource: null, observedLevels: null,
  worstPerformerTicker: null, worstPerformerReturn: null, couponEligible: true,
  autocallEligible: true, finalBarrierBreached: null, reviewRequired: false, reviewReason: null,
}

describe('R13.7B2 section 6 — concurrent delivery claims', () => {
  it('two simultaneous T-1 workers: exactly one wins the claim', async () => {
    const { client } = makeRowStore()
    // Both read before either writes — the interleaving that defeated the
    // previous read-then-write marker.
    const [a, b] = await Promise.all([
      claimObservationNotification(client, 'obs-1', 'potential_autocall'),
      claimObservationNotification(client, 'obs-1', 'potential_autocall'),
    ])
    assert.equal([a.claimed, b.claimed].filter(Boolean).length, 1, 'exactly one worker may deliver')
  })

  it('two simultaneous T0 workers: exactly one confirms the call', async () => {
    const { client } = makeRowStore()
    const [a, b] = await Promise.all([
      claimObservationNotification(client, 'obs-1', 'autocall_confirmed'),
      claimObservationNotification(client, 'obs-1', 'autocall_confirmed'),
    ])
    assert.equal([a.claimed, b.claimed].filter(Boolean).length, 1)
  })

  it('a delivered event is terminal — a later run never re-sends', async () => {
    const { client } = makeRowStore({ notifications: { potential_autocall: { claimToken: 't', notifiedAt: '2026-08-27T20:20:00Z' } } })
    const again = await claimObservationNotification(client, 'obs-1', 'potential_autocall')
    assert.equal(again.claimed, false)
    assert.equal(again.claimed === false && again.reason, 'already_delivered')
  })

  it('a fresh in-flight claim blocks a second worker', async () => {
    const now = new Date('2026-08-27T20:25:00Z')
    const { client } = makeRowStore({ notifications: { potential_autocall: { claimToken: 't', claimedAt: '2026-08-27T20:20:00Z' } } })
    const r = await claimObservationNotification(client, 'obs-1', 'potential_autocall', now)
    assert.equal(r.claimed, false)
    assert.equal(r.claimed === false && r.reason, 'claim_in_flight')
  })

  it('a STALE claim is reclaimable — a crashed worker costs one interval, not the alert', async () => {
    const now = new Date('2026-08-27T21:00:00Z')
    const { client } = makeRowStore({ notifications: { potential_autocall: { claimToken: 'stale', claimedAt: '2026-08-27T20:00:00Z' } } })
    const r = await claimObservationNotification(client, 'obs-1', 'potential_autocall', now)
    assert.equal(r.claimed, true, 'a claim older than the stale window may be taken over')
  })

  it('two workers racing to reclaim the SAME stale claim: exactly one wins', async () => {
    const now = new Date('2026-08-27T21:00:00Z')
    const { client } = makeRowStore({ notifications: { potential_autocall: { claimToken: 'stale', claimedAt: '2026-08-27T20:00:00Z' } } })
    const [a, b] = await Promise.all([
      claimObservationNotification(client, 'obs-1', 'potential_autocall', now),
      claimObservationNotification(client, 'obs-1', 'potential_autocall', now),
    ])
    assert.equal([a.claimed, b.claimed].filter(Boolean).length, 1, 'compare-and-swap on the stale token admits one winner')
  })

  it('a released claim is retried by the next run; a completed one is not', async () => {
    const { client, row } = makeRowStore()
    const first = await claimObservationNotification(client, 'obs-1', 'potential_autocall')
    assert.equal(first.claimed, true)
    // Delivery failed, so the claim is handed back.
    await releaseObservationNotification(client, 'obs-1', 'potential_autocall', first.claimed ? first.token : '')
    const retry = await claimObservationNotification(client, 'obs-1', 'potential_autocall')
    assert.equal(retry.claimed, true, 'a failed delivery must not suppress the alert forever')
    await completeObservationNotification(client, 'obs-1', 'potential_autocall', retry.claimed ? retry.token : '', { valuationDate: '2026-08-28' })
    const third = await claimObservationNotification(client, 'obs-1', 'potential_autocall')
    assert.equal(third.claimed, false, 'a delivered alert is terminal')
    const notifications = row.metadata['notifications'] as Record<string, Record<string, unknown>>
    assert.ok(notifications['potential_autocall']['notifiedAt'])
  })

  it('completion by a worker that LOST a reclaim cannot overwrite the winner', async () => {
    const { client } = makeRowStore()
    const winner = await claimObservationNotification(client, 'obs-1', 'potential_autocall')
    assert.equal(winner.claimed, true)
    const ok = await completeObservationNotification(client, 'obs-1', 'potential_autocall', 'some-other-token', { valuationDate: '2026-08-28' })
    assert.equal(ok, false, 'compare-and-swap on the token rejects a stale writer')
  })

  it('warning and confirmation identities are distinct — neither suppresses the other', async () => {
    const { client } = makeRowStore()
    const warn = await claimObservationNotification(client, 'obs-1', 'potential_autocall')
    assert.equal(warn.claimed, true)
    await completeObservationNotification(client, 'obs-1', 'potential_autocall', warn.claimed ? warn.token : '', {})
    const confirm = await claimObservationNotification(client, 'obs-1', 'autocall_confirmed')
    assert.equal(confirm.claimed, true, 'a T-1 warning must never block the T0 confirmation')
  })

  it('rejects an event key that could escape the JSON path', async () => {
    const { client } = makeRowStore()
    await assert.rejects(() => claimObservationNotification(client, 'obs-1', 'evil->>x'))
    await assert.rejects(() => claimObservationNotification(client, 'obs-1', 'Bad Key'))
  })

  it('two simultaneous T0 workers: only one applies the observation transition', async () => {
    const { client } = makeRowStore()
    const [a, b] = await Promise.all([
      updateObservationResult(client, 'obs-1', OBS_PATCH, 'scheduled'),
      updateObservationResult(client, 'obs-1', OBS_PATCH, 'scheduled'),
    ])
    assert.equal([a, b].filter(Boolean).length, 1, 'the status guard admits exactly one processor')
  })

  it('without an expected status the update stays unconditional (unchanged behaviour)', async () => {
    const { client } = makeRowStore()
    assert.equal(await updateObservationResult(client, 'obs-1', OBS_PATCH), true)
    assert.equal(await updateObservationResult(client, 'obs-1', OBS_PATCH), true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// R13.7B2 § 7 — T-1 SCHEDULE.
//
// Vercel Cron has no timezone, so a fixed UTC slot drifts an hour against
// America/New_York across DST. The invariant is not "the clock looks tidy" but:
// every half of the year must have at least one slot that lands AFTER the close
// plus the settle buffer, and at least one retry after it — because a single
// deferral with no retry loses that day's warning entirely.
// ─────────────────────────────────────────────────────────────────────────────
describe('R13.7B2 section 7 — T-1 cron scheduling', () => {
  const vercelCfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    crons: { path: string; schedule: string }[]
  }
  const warningSlots = vercelCfg.crons.filter((c) => c.path === '/api/cron/structured-notes/autocall-warning')

  /** UTC HH:MM for each scheduled slot, from its cron expression. */
  function slotTimes(): string[] {
    return warningSlots.map((c) => {
      const [minute, hour] = c.schedule.split(' ')
      return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    })
  }

  it('is registered on weekdays only', () => {
    assert.ok(warningSlots.length > 0, 'the T-1 warning cron must be registered')
    for (const c of warningSlots) assert.match(c.schedule, /1-5$/, `${c.schedule} must be weekday-only`)
  })

  for (const [label, day] of [['EDT', '2026-08-27'], ['EST', '2026-12-03']] as const) {
    it(`${label}: has a settled primary slot and at least one retry`, () => {
      const settled = slotTimes().filter((t) => hasSessionSettled(new Date(`${day}T${t}:00Z`), day))
      assert.ok(settled.length >= 2, `${label} needs a primary slot plus a retry, got ${settled.length}: ${settled.join(', ')}`)
    })

    it(`${label}: no slot may evaluate before the close plus the settle buffer`, () => {
      for (const t of slotTimes()) {
        const now = new Date(`${day}T${t}:00Z`)
        const et = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
        const [h, m] = et.split(':').map(Number)
        const minutesAfterClose = h * 60 + m - 16 * 60
        if (hasSessionSettled(now, day)) {
          assert.ok(minutesAfterClose >= 15, `${label} slot ${t}Z is ${minutesAfterClose} min from the close but was treated as settled`)
        } else {
          // Not settled is always acceptable — it defers to a later slot.
          assert.ok(minutesAfterClose < 15, `${label} slot ${t}Z deferred despite being ${minutesAfterClose} min after the close`)
        }
      }
    })
  }

  it('the winter pre-close slot defers rather than reading an intraday tick', () => {
    // 20:20Z is 15:20 America/New_York in EST — mid-session. This is the exact
    // trap the settle gate exists for, and it must never be treated as a close.
    assert.equal(hasSessionSettled(new Date('2026-12-03T20:20:00Z'), '2026-12-03'), false)
    // The same slot in EDT is 16:20 ET and is a legitimate post-close read.
    assert.equal(hasSessionSettled(new Date('2026-08-27T20:20:00Z'), '2026-08-27'), true)
  })
})
