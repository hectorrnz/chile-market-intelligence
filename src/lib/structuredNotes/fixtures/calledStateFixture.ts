// R13.7B2.1 § 26–27 — SAFE CALLED-STATE REVIEW FIXTURE.
//
// WHY THIS EXISTS
// ───────────────
// Preview points at PRODUCTION data, and production has not been reconciled:
// XS3164820824 is still stored as `active` with no autocall observations at
// all. So the owner cannot see the repaired Called / same-date coupon+autocall
// / voided-row / settlement presentation on any real note, and mutating
// production to create one is expressly forbidden — and would be the wrong
// thing to do regardless.
//
// This module is the alternative: a deterministic, entirely synthetic note that
// reproduces the corrected state, rendered by the REAL detail page through the
// REAL computation pipeline. Nothing here is a mock-up of the UI; only the DATA
// is synthetic, so what the owner approves is the actual shipped component.
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
//   · NO PRIVATE DATA. No allocation rows (those are the internal sociedad
//     positions), no recipient addresses, no real notional. The levels are the
//     public index closes already pinned in the golden regression test.
//
// The product name says FIXTURE so it can never be mistaken for the real note
// on screen, while the ISIN stays XS3164820824 so the owner is reviewing the
// case they already know.

import type { StructuredNote, UnderlyingPrice } from '../types.ts'

/** Called on 2026-08-28, redeeming 2026-09-04 — settlement still PENDING. */
export const CALLED_PENDING_FIXTURE_ID = '00000000-0000-4000-8000-00000000ca11'

/** The same note after its redemption date has passed — settlement SETTLED. */
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

// The golden case's real contractual levels and the closes this platform
// recorded for the 2026-08-28 valuation — identical to the values pinned in
// tests/structuredNotesEventState.test.ts, so the fixture and the regression
// test can never drift into telling different stories.
// The autocall barrier is 100% of the initial level, so the INITIAL LEVEL IS
// the call level — 7565.30 and 2940.54 in the golden case. Deriving it any
// other way would render cushions that do not match the pinned +1.9359% /
// +1.0825%, and the owner would be reviewing numbers this note never had.
const SPX_INITIAL = 7565.30
const RTY_INITIAL = 2940.54
const SPX_CLOSE = 7711.76
const RTY_CLOSE = 2972.3718

const pct = (initial: number, p: number) => Number((initial * (p / 100)).toFixed(4))

/** Coupon + autocall on ONE date — the contractual point the repair restores. */
function observationPair(
  n: number,
  valuationDate: string,
  redemptionDate: string,
  status: { coupon: StructuredNote['observations'][number]['status']; autocall: StructuredNote['observations'][number]['status'] },
) {
  const base = {
    valuationDate,
    paymentDate: redemptionDate,
    redemptionDate,
    couponBarrierPct: 65,
    autocallBarrierPct: 100,
  }
  return [
    { ...base, id: `fx-c${n}`, observationNumber: n, observationType: 'coupon' as const, couponDuePct: 2.5375, status: status.coupon },
    { ...base, id: `fx-a${n}`, observationNumber: n, observationType: 'autocall' as const, couponDuePct: null, status: status.autocall },
  ]
}

function buildNote(settled: boolean): StructuredNote {
  const id = settled ? CALLED_SETTLED_FIXTURE_ID : CALLED_PENDING_FIXTURE_ID
  // The settled variant is the SAME contractual event read from a later date.
  // Only the redemption date moves back, so "pending vs settled" is genuinely
  // derived rather than a second hand-written state.
  const redemption = settled ? '2026-08-07' : '2026-09-04'
  const callDate = settled ? '2026-07-31' : '2026-08-28'

  return {
    id,
    isin: 'XS3164820824',
    productName: `FIXTURE — Memory Coupon Barrier Autocall (synthetic ${settled ? 'settled' : 'called, pending settlement'} state, not a production position)`,
    issuerName: 'Citigroup Global Markets Funding Luxembourg S.C.A.',
    issuerDisplayName: 'Citi',
    custodian: null,
    guarantorName: 'Citigroup Global Markets Holdings Inc.',
    structureType: 'autocall',
    payoffType: 'Memory Coupon Barrier Autocall',
    currency: 'USD',
    issueSize: 1_000_000,
    denomination: 1_000,
    issuePricePct: 100,
    tradeDate: '2025-08-22',
    issueDate: '2025-09-05',
    initialValuationDate: '2025-08-22',
    finalValuationDate: '2028-08-22',
    maturityDate: '2028-09-05',
    redemptionDate: redemption,
    couponFrequency: 'quarterly',
    couponRatePeriodic: 2.5375,
    couponRateAnnualized: 10.15,
    memoryCoupon: true,
    principalProtection: false,
    knockInBarrierPct: 65,
    couponBarrierPct: 65,
    autocallBarrierPct: 100,
    status: 'autocalled',
    sourceType: 'manual',
    sourceName: 'R13.7B2.1 review fixture',
    sourceFileName: null,
    confidenceScore: null,
    archivedAt: `${callDate}T00:00:00.000Z`,
    underlyings: [
      {
        id: 'fx-u1', underlyingOrder: 1, underlyingName: 'S&P 500 Index',
        sourceTicker: 'SPX', bloombergTicker: 'SPX Index', yahooSymbol: '^GSPC', assetClass: 'index',
        initialLevel: SPX_INITIAL, strikeLevel: SPX_INITIAL,
        knockInBarrierLevel: pct(SPX_INITIAL, 65), couponBarrierLevel: pct(SPX_INITIAL, 65),
        autocallBarrierLevel: pct(SPX_INITIAL, 100),
        knockInBarrierPct: 65, couponBarrierPct: 65, autocallBarrierPct: 100,
      },
      {
        id: 'fx-u2', underlyingOrder: 2, underlyingName: 'Russell 2000 Index',
        sourceTicker: 'RTY', bloombergTicker: 'RTY Index', yahooSymbol: '^RUT', assetClass: 'index',
        initialLevel: RTY_INITIAL, strikeLevel: RTY_INITIAL,
        knockInBarrierLevel: pct(RTY_INITIAL, 65), couponBarrierLevel: pct(RTY_INITIAL, 65),
        autocallBarrierLevel: pct(RTY_INITIAL, 100),
        knockInBarrierPct: 65, couponBarrierPct: 65, autocallBarrierPct: 100,
      },
    ],
    observations: [
      // Two ordinary quarters that paid a coupon without calling.
      ...observationPair(1, '2025-11-24', '2025-12-01', { coupon: 'coupon_paid', autocall: 'observed' }),
      ...observationPair(2, '2026-02-23', '2026-03-02', { coupon: 'coupon_paid', autocall: 'observed' }),
      // THE CALLING DATE. Coupon paid AND autocall triggered on the same date —
      // the coupon is not lost because the note also called.
      ...observationPair(3, callDate, redemption, { coupon: 'coupon_paid', autocall: 'autocalled' }),
      // Everything after the call is void, not merely "scheduled forever".
      ...observationPair(4, '2026-11-30', '2026-12-07', { coupon: 'cancelled', autocall: 'cancelled' }),
      ...observationPair(5, '2027-03-01', '2027-03-08', { coupon: 'cancelled', autocall: 'cancelled' }),
      {
        id: 'fx-f', observationNumber: 6, observationType: 'final', valuationDate: '2028-08-22',
        paymentDate: '2028-09-05', redemptionDate: '2028-09-05', couponDuePct: null,
        autocallBarrierPct: null, couponBarrierPct: 65, status: 'cancelled',
      },
    ].map((o) => ({ ...o })) as StructuredNote['observations'],
    // Deliberately EMPTY: account allocations are internal position data and
    // have no place in a review fixture.
    allocations: [],
  }
}

/**
 * The fixture note plus the fixed "current" levels the page should display.
 *
 * The prices are the real 2026-08-28 closes, so every derived number the page
 * shows — distance to barrier, distance to call level, worst performer, the
 * barrier gauge — is computed by the shipped code from the same inputs the
 * golden regression test pins. RTY is the binding leg at roughly +1.08% over
 * its call level against SPX's +1.94%.
 */
export function buildReviewFixture(id: string): {
  note: StructuredNote
  prices: UnderlyingPrice[]
  snapshots: Map<string, { price: number | null; priceDate: string }>
} | null {
  if (!isReviewFixtureId(id)) return null
  const note = buildNote(id === CALLED_SETTLED_FIXTURE_ID)
  const prices: UnderlyingPrice[] = [
    { underlyingOrder: 1, yahooSymbol: '^GSPC', price: SPX_CLOSE, source: 'fixture', sourceSymbol: '^GSPC', asOf: '2026-08-28T20:00:00.000Z' },
    { underlyingOrder: 2, yahooSymbol: '^RUT', price: RTY_CLOSE, source: 'fixture', sourceSymbol: '^RUT', asOf: '2026-08-28T20:00:00.000Z' },
  ]
  // The persisted-snapshot column, supplied rather than queried so the fixture
  // stays DB-free. Dated to the valuation itself: a note called days ago
  // genuinely has no fresher monitored level, so the page's staleness flag
  // showing is correct behaviour to review, not a defect in the fixture.
  const snapshots = new Map<string, { price: number | null; priceDate: string }>([
    ['fx-u1', { price: SPX_CLOSE, priceDate: '2026-08-28' }],
    ['fx-u2', { price: RTY_CLOSE, priceDate: '2026-08-28' }],
  ])
  return { note, prices, snapshots }
}
