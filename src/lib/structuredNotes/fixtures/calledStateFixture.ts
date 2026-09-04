// R13.7B2.1 § 26–27 · R13.7B2.2 § 12 — SAFE CALLED-STATE REVIEW FIXTURE.
//
// WHY THIS EXISTS
// ───────────────
// Preview points at PRODUCTION data, and production has not been reconciled:
// XS3164820824 is still stored as `active`, with SEVEN coupon observations and
// NO autocall observations at all (that absence is the R13.7 defect itself).
// So the owner cannot see the repaired Called / same-date coupon+autocall /
// voided-row / settlement presentation on any real note, and mutating
// production to create one is expressly forbidden — and would be the wrong
// thing to do regardless.
//
// This module is the alternative: a deterministic note that reproduces the
// corrected state, rendered by the REAL detail page through the REAL
// computation pipeline. Nothing here is a mock-up of the UI; only the DATA is
// supplied rather than queried, so what the owner approves is the actual
// shipped component.
//
// R13.7B2.2 — EVERY CONTRACTUAL TERM IS NOW SOURCE-BACKED
// ───────────────────────────────────────────────────────
// The first version of this fixture invented terms that looked plausible and
// were wrong: a 2.5375% / 10.15% coupon (that is XS3180975347's rate — this
// note pays 2.50% per quarter, 10.00% p.a.), 2025 trade/issue dates, the wrong
// guarantor, a 1,000,000 issue size, and SPX/RTY in the opposite order from the
// filed underlyings. It also stored every percentage as WHOLE PERCENTAGE POINTS
// (65, 100) while this platform's canonical representation — produced by every
// issuer parser, stored by every one of the nine live notes, and consumed by
// `calculateBarrierLevel` — is a DECIMAL FRACTION (0.65, 1). That single unit
// mismatch is what rendered "6500.00%" and "10000.00%" in the owner review.
//
// Every value below is now read from the persisted record for XS3164820824
// (read-only) or derived from it by the shipped calculation. The only synthetic
// values are the ones that MUST be synthetic, and each is marked SYNTHETIC with
// its reason.
//
// SAFETY PROPERTIES, each load-bearing
// ────────────────────────────────────
//   · NOT A PRODUCTION SURFACE. The route that serves it refuses outside
//     Preview/development, where the ids are simply unknown notes and 404.
//   · NO QUERY-CONTROLLED STATE. The only input is a fixed id; there is no
//     parameter that shapes the note. A caller cannot ask for an arbitrary
//     status, level or barrier.
//   · NO AUTHORIZATION BYPASS. The fixture is served AFTER the same module
//     guard as any real note, so an unentitled caller is refused first.
//   · NO PRODUCTION READ OR WRITE. It touches neither the database nor a market
//     data provider — which is also what makes it deterministic.
//   · NO PRIVATE DATA. The real note's account allocations are internal
//     sociedad positions and are NEVER copied here; the fixture carries two
//     openly-named FIXTURE accounts instead (§ 7 requires a non-zero position
//     to demonstrate settlement-aware notional, and an invented amount under an
//     invented account name cannot be mistaken for a real one).
//
// The product name says FIXTURE so it can never be mistaken for the real note
// on screen, while the ISIN stays XS3164820824 so the owner is reviewing the
// case they already know.

import { calculateBarrierLevel } from '../calculations.ts'
import type { StructuredNote, StructuredNoteObservation, UnderlyingPrice } from '../types.ts'

/** Called on 2026-08-28, redemption still ahead — settlement PENDING. */
export const CALLED_PENDING_FIXTURE_ID = '00000000-0000-4000-8000-00000000ca11'

/** The same call, read after its Mandatory Early Redemption Date — SETTLED. */
export const CALLED_SETTLED_FIXTURE_ID = '00000000-0000-4000-8000-00000000ca12'

export const REVIEW_FIXTURE_IDS = [CALLED_PENDING_FIXTURE_ID, CALLED_SETTLED_FIXTURE_ID] as const

export function isReviewFixtureId(id: string): boolean {
  return (REVIEW_FIXTURE_IDS as readonly string[]).includes(id)
}

/**
 * Fixtures are Preview/development only.
 *
 * `VERCEL_ENV` is 'production' on the production deployment, 'preview' on a
 * Preview one, and undefined locally. Deny-on-production rather than
 * allow-on-preview so an unset variable in some future runtime cannot silently
 * open the surface... except locally, where there is no deployment at all.
 */
export function reviewFixturesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV !== 'production'
}

// ── Source-backed contract terms (XS3164820824, as filed) ────────────────────
//
// CANONICAL UNIT: decimal fraction. 0.65 IS 65%. This is what every parser
// emits (`Number(match) / 100`), what all nine production notes store, and what
// `calculateBarrierLevel(strike, pct)` — which multiplies without dividing —
// requires. `fmtPct` renders it by multiplying by 100.
const COUPON_BARRIER_PCT = 0.65
const KNOCK_IN_BARRIER_PCT = 0.65
const AUTOCALL_BARRIER_PCT = 1
const COUPON_PERIODIC_PCT = 0.025 // 2.50% per quarter — NOT 2.5375%, which is XS3180975347
const COUPON_ANNUALIZED_PCT = 0.1 // 10.00% p.a.
const ISSUE_PRICE_PCT = 1 // 100% of denomination

// Initial (= strike, = autocall) levels as filed. The autocall barrier is 100%
// of each underlying's own initial level, so THE INITIAL LEVEL IS THE CALL
// LEVEL — deriving it any other way would render cushions that do not match the
// +1.0825% / +1.9359% pinned in tests/structuredNotesEventState.test.ts.
const RTY_INITIAL = 2940.54
const SPX_INITIAL = 7565.3

// The closes this platform recorded for the 2026-08-28 valuation. Identical to
// the values pinned in the golden regression test, so the fixture and the test
// can never drift into telling different stories. RTY is the binding leg:
// +1.0825% cushion against SPX's +1.9359% — a fact about normalized distance to
// each index's OWN call level, not about 2972 being a smaller number than 7711.
const RTY_CLOSE = 2972.3718
const SPX_CLOSE = 7711.76

/** The real contractual observation schedule: valuation date → payment/redemption date. */
const COUPON_DATES: readonly (readonly [string, string])[] = [
  ['2026-08-28', '2026-09-04'],
  ['2026-11-30', '2026-12-07'],
  ['2027-03-01', '2027-03-08'],
  ['2027-05-28', '2027-06-07'],
  ['2027-08-30', '2027-09-07'],
  ['2027-11-29', '2027-12-06'],
  ['2028-02-28', '2028-03-06'],
]
const FINAL_VALUATION = '2028-05-30'
const FINAL_REDEMPTION = '2028-06-06'

/** The contractual call: the first observation, 2026-08-28. Real. */
const CALL_DATE = '2026-08-28'

/**
 * SYNTHETIC — the redemption date attached to the calling observation.
 *
 * Settlement is DERIVED from `redemptionDate` vs today (`deriveSettlementStatus`),
 * so this note's single real Mandatory Early Redemption Date can only ever
 * demonstrate ONE of the two states at a time:
 *
 *   settled — keeps the REAL pair: called 2026-08-28, redeems 2026-09-04.
 *   pending — keeps the REAL call and moves redemption to 2026-12-07, which is
 *             this note's OWN next contractual redemption date. The real
 *             7-day lag would expire within the review window and silently flip
 *             the fixture to "settled", i.e. it would stop demonstrating the
 *             one state it exists to demonstrate. The longer window is the
 *             deliberate trade: a real date from the note's own schedule,
 *             chosen for robustness over lag realism.
 */
const PENDING_REDEMPTION = '2026-12-07'
const SETTLED_REDEMPTION = '2026-09-04' // real Mandatory Early Redemption Date

function underlying(
  order: number,
  name: string,
  ticker: string,
  yahooSymbol: string,
  initial: number,
) {
  return {
    id: `fx-u${order}`,
    underlyingOrder: order,
    underlyingName: name,
    sourceTicker: ticker,
    bloombergTicker: ticker,
    yahooSymbol,
    assetClass: 'index' as const,
    initialLevel: initial,
    strikeLevel: initial,
    // Derived by the SHIPPED calculation from the canonical fractional pct, so
    // the fixture cannot encode a level the engine would not itself produce.
    knockInBarrierLevel: calculateBarrierLevel(initial, KNOCK_IN_BARRIER_PCT),
    couponBarrierLevel: calculateBarrierLevel(initial, COUPON_BARRIER_PCT),
    autocallBarrierLevel: calculateBarrierLevel(initial, AUTOCALL_BARRIER_PCT),
    knockInBarrierPct: KNOCK_IN_BARRIER_PCT,
    couponBarrierPct: COUPON_BARRIER_PCT,
    autocallBarrierPct: AUTOCALL_BARRIER_PCT,
  }
}

/**
 * The REPAIRED schedule: a coupon test AND an autocall test on every one of the
 * seven contractual valuation dates, plus the final observation.
 *
 * This is precisely what production is missing — it holds the seven coupon rows
 * and no autocall rows — and precisely what the reconciliation would insert
 * (7 autocall rows for this ISIN). Keeping them as separate canonical rows here
 * is deliberate: the presentation layer collapses them into one row per date
 * (`buildScheduleRows`), while the model keeps both outcomes representable, so
 * "coupon paid ON the call date" stays expressible rather than being lost to a
 * merge.
 */
function observations(redemptionOnCall: string): StructuredNoteObservation[] {
  const rows: StructuredNoteObservation[] = []

  COUPON_DATES.forEach(([valuationDate, scheduledRedemption], i) => {
    const isCall = valuationDate === CALL_DATE
    // Everything strictly after the call is void — the note had ended, so those
    // dates were never live contractual observations.
    const isVoid = valuationDate > CALL_DATE
    const redemptionDate = isCall ? redemptionOnCall : scheduledRedemption
    const observed = isCall
      ? { observedAt: `${CALL_DATE}T20:00:00.000Z`, observedSource: 'fixture' }
      : {}

    rows.push({
      id: `fx-c${i + 1}`,
      observationNumber: i + 1,
      observationType: 'coupon',
      valuationDate,
      paymentDate: redemptionDate,
      redemptionDate,
      couponDuePct: COUPON_PERIODIC_PCT,
      couponBarrierPct: COUPON_BARRIER_PCT,
      autocallBarrierPct: AUTOCALL_BARRIER_PCT,
      // The coupon is PAID on the call date: both underlyings closed above
      // their 65% coupon barrier, and being called does not forfeit the coupon
      // that the same date's coupon test earned.
      status: isCall ? 'coupon_paid' : isVoid ? 'cancelled' : 'scheduled',
      couponEligible: isCall ? true : null,
      ...observed,
    })

    rows.push({
      id: `fx-a${i + 1}`,
      observationNumber: i + 1,
      observationType: 'autocall',
      valuationDate,
      paymentDate: redemptionDate,
      redemptionDate,
      couponDuePct: null,
      couponBarrierPct: COUPON_BARRIER_PCT,
      autocallBarrierPct: AUTOCALL_BARRIER_PCT,
      status: isCall ? 'autocalled' : isVoid ? 'cancelled' : 'scheduled',
      autocallEligible: isCall ? true : null,
      ...observed,
    })
  })

  rows.push({
    id: 'fx-f1',
    observationNumber: 1,
    observationType: 'final',
    valuationDate: FINAL_VALUATION,
    paymentDate: FINAL_REDEMPTION,
    redemptionDate: FINAL_REDEMPTION,
    couponDuePct: COUPON_PERIODIC_PCT,
    couponBarrierPct: COUPON_BARRIER_PCT,
    autocallBarrierPct: null,
    status: 'cancelled',
  })

  return rows
}

function buildNote(settled: boolean): StructuredNote {
  const redemptionOnCall = settled ? SETTLED_REDEMPTION : PENDING_REDEMPTION
  const state = settled ? 'settled' : 'called, settlement pending'

  return {
    id: settled ? CALLED_SETTLED_FIXTURE_ID : CALLED_PENDING_FIXTURE_ID,
    isin: 'XS3164820824',
    productName: `FIXTURE — Memory Coupon Barrier Autocall Notes (synthetic ${state} state, not a production position)`,
    issuerName: 'Citigroup Global Markets Funding Luxembourg S.C.A.',
    issuerDisplayName: 'Citi',
    // SYNTHETIC — custody is user-entered portfolio data, unrecorded on the
    // real note. Named so it cannot read as a real banking relationship.
    custodian: 'FIXTURE Custodian',
    guarantorName: 'Citigroup Global Markets Limited',
    structureType: 'worst_of_memory_coupon_autocall',
    payoffType: 'barrier_contingent',
    currency: 'USD',
    issueSize: 1_500_000,
    denomination: 1_000,
    issuePricePct: ISSUE_PRICE_PCT,
    tradeDate: '2026-05-28',
    issueDate: '2026-06-04',
    initialValuationDate: '2026-05-28',
    finalValuationDate: FINAL_VALUATION,
    // Scheduled maturity — a contractual term that survives an early call and
    // therefore still belongs in General Terms (§ 6).
    maturityDate: '2028-06-06',
    // The header redemption date describes SCHEDULED maturity; an early call
    // redeems on its own observation's date, which is why `noteSettlementStatus`
    // reads the calling observation rather than this field.
    redemptionDate: '2028-06-06',
    couponFrequency: 'quarterly',
    couponRatePeriodic: COUPON_PERIODIC_PCT,
    couponRateAnnualized: COUPON_ANNUALIZED_PCT,
    memoryCoupon: true,
    principalProtection: false,
    knockInBarrierPct: KNOCK_IN_BARRIER_PCT,
    couponBarrierPct: COUPON_BARRIER_PCT,
    autocallBarrierPct: AUTOCALL_BARRIER_PCT,
    status: 'autocalled',
    sourceType: 'manual',
    sourceName: 'R13.7B2.2 review fixture (not a term sheet)',
    sourceFileName: null,
    confidenceScore: null,
    archivedAt: `${CALL_DATE}T00:00:00.000Z`,
    // Filed order: RTY is underlying 1, SPX is underlying 2.
    underlyings: [
      underlying(1, 'RTY Index', 'RTY Index', '^RUT', RTY_INITIAL),
      underlying(2, 'SPX Index', 'SPX Index', '^GSPC', SPX_INITIAL),
    ],
    observations: observations(redemptionOnCall),
    // SYNTHETIC — § 7 requires a non-zero position so the settlement-aware
    // notional is actually demonstrable (a called-but-unsettled note must still
    // show outstanding notional). The real note's sociedad allocations are
    // private and are never copied here. Two openly-fictional accounts totalling
    // USD 1,000,000, deliberately BELOW the 1,500,000 issue size — Nevada
    // ordinarily owns a fraction of an issuance, and the two quantities are
    // separately labelled on screen.
    allocations: [
      { id: 'fx-al1', entityName: 'FIXTURE Account A', custodian: 'FIXTURE Custodian', notionalAmount: 600_000, currency: 'USD', active: true },
      { id: 'fx-al2', entityName: 'FIXTURE Account B', custodian: 'FIXTURE Custodian', notionalAmount: 400_000, currency: 'USD', active: true },
    ],
  }
}

/**
 * The fixture note plus the fixed "current" levels the page should display.
 *
 * The prices are the real 2026-08-28 closes, so every derived number the page
 * shows — distance to barrier, distance to call level, worst performer, the
 * normalized gauge — is computed by the shipped code from the same inputs the
 * golden regression test pins.
 */
export function buildReviewFixture(id: string): {
  note: StructuredNote
  prices: UnderlyingPrice[]
  snapshots: Map<string, { price: number | null; priceDate: string }>
} | null {
  if (!isReviewFixtureId(id)) return null
  const note = buildNote(id === CALLED_SETTLED_FIXTURE_ID)
  const prices: UnderlyingPrice[] = [
    { underlyingOrder: 1, yahooSymbol: '^RUT', price: RTY_CLOSE, source: 'fixture', sourceSymbol: '^RUT', asOf: '2026-08-28T20:00:00.000Z' },
    { underlyingOrder: 2, yahooSymbol: '^GSPC', price: SPX_CLOSE, source: 'fixture', sourceSymbol: '^GSPC', asOf: '2026-08-28T20:00:00.000Z' },
  ]
  // The persisted-snapshot column, supplied rather than queried so the fixture
  // stays DB-free. Dated to the valuation itself: a note called days ago
  // genuinely has no fresher monitored level, so the page's staleness flag
  // showing is correct behaviour to review, not a defect in the fixture.
  const snapshots = new Map<string, { price: number | null; priceDate: string }>([
    ['fx-u1', { price: RTY_CLOSE, priceDate: CALL_DATE }],
    ['fx-u2', { price: SPX_CLOSE, priceDate: CALL_DATE }],
  ])
  return { note, prices, snapshots }
}
