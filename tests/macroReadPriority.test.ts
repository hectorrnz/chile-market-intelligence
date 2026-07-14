// Phase 5C.1 — Unit tests for pure macro-read-priority helpers.
// Run: npm test
// No I/O, no env reads, no network — purely exercises the exported pure functions.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSufficientHistory,
  downsampleMonthly,
  downsampleWeekly,
  downsampleForTimeframe,
} from '../src/lib/db/repositories/macroRepository.ts'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build N daily points going back `years` years from today, equally spaced. */
function makeDailyPoints(years: number, count = Math.round(years * 250)): { date: string; value: number }[] {
  const now = new Date()
  const startMs = now.getTime() - years * 365 * 86_400_000
  if (count < 2) {
    return [{ date: new Date(startMs).toISOString().slice(0, 10), value: 0 }]
  }
  const spanMs = now.getTime() - startMs
  const stepMs = spanMs / (count - 1)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(startMs + i * stepMs)
    return { date: d.toISOString().slice(0, 10), value: i * 0.01 }
  })
}

/** Build points whose latest observation is `monthsAgo` months in the past. */
function makeStalePoints(monthsAgo: number): { date: string; value: number }[] {
  const latest = new Date()
  latest.setUTCMonth(latest.getUTCMonth() - monthsAgo)
  const older = new Date(latest)
  older.setUTCFullYear(older.getUTCFullYear() - 1)
  return [
    { date: older.toISOString().slice(0, 10), value: 1 },
    { date: latest.toISOString().slice(0, 10), value: 2 },
  ]
}

// ─── isSufficientHistory ─────────────────────────────────────────────────────

describe('isSufficientHistory', () => {
  it('returns false for empty array', () => {
    assert.equal(isSufficientHistory([], 1), false)
  })

  it('returns false for single point', () => {
    const pts = [{ date: new Date().toISOString().slice(0, 10), value: 5 }]
    assert.equal(isSufficientHistory(pts, 1), false)
  })

  it('returns true for full 1Y of daily data', () => {
    const pts = makeDailyPoints(1)
    assert.equal(isSufficientHistory(pts, 1), true)
  })

  it('returns true for full 3Y of daily data', () => {
    const pts = makeDailyPoints(3)
    assert.equal(isSufficientHistory(pts, 3), true)
  })

  it('returns true for full 10Y of daily data', () => {
    const pts = makeDailyPoints(10)
    assert.equal(isSufficientHistory(pts, 10), true)
  })

  it('returns false when span is only 50% of required (below 70% threshold)', () => {
    // Half a year of data but requesting 1Y
    const pts = makeDailyPoints(0.5, 125)
    assert.equal(isSufficientHistory(pts, 1), false)
  })

  it('returns true when span is 80% of required (comfortably above 70% threshold)', () => {
    // 0.8 years of data, requesting 1Y
    const pts = makeDailyPoints(0.8, 200)
    assert.equal(isSufficientHistory(pts, 1), true)
  })

  it('returns false when latest point is 7 months ago (stale)', () => {
    const pts = makeStalePoints(7)
    assert.equal(isSufficientHistory(pts, 1), false)
  })

  it('returns true when latest point is 5 months ago (within 6m window)', () => {
    const pts = makeStalePoints(5)
    assert.equal(isSufficientHistory(pts, 1), true)
  })
})

// ─── downsampleMonthly ───────────────────────────────────────────────────────

describe('downsampleMonthly', () => {
  it('returns one point per month (last in month wins)', () => {
    const pts = [
      { date: '2024-01-10', value: 1 },
      { date: '2024-01-20', value: 2 }, // last in Jan — wins
      { date: '2024-02-05', value: 3 },
    ]
    const result = downsampleMonthly(pts)
    assert.equal(result.length, 2)
    assert.equal(result[0].value, 2)
    assert.equal(result[1].value, 3)
  })

  it('preserves ascending order', () => {
    const pts = makeDailyPoints(2)
    const result = downsampleMonthly(pts)
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i].date > result[i - 1].date)
    }
  })

  it('handles empty input', () => {
    assert.deepEqual(downsampleMonthly([]), [])
  })

  it('returns ~24 points for 2 years of daily data', () => {
    const pts = makeDailyPoints(2)
    const result = downsampleMonthly(pts)
    // Allow 22–26 months given boundary effects
    assert.ok(result.length >= 22 && result.length <= 26, `Expected ~24, got ${result.length}`)
  })
})

// ─── downsampleWeekly ────────────────────────────────────────────────────────

describe('downsampleWeekly', () => {
  it('returns one point per ISO week', () => {
    const pts = [
      { date: '2024-01-08', value: 1 }, // Mon wk2
      { date: '2024-01-09', value: 2 }, // Tue wk2 — wins
      { date: '2024-01-15', value: 3 }, // Mon wk3
    ]
    const result = downsampleWeekly(pts)
    assert.equal(result.length, 2)
    assert.equal(result[0].value, 2)
    assert.equal(result[1].value, 3)
  })

  it('preserves ascending order', () => {
    const pts = makeDailyPoints(1)
    const result = downsampleWeekly(pts)
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i].date > result[i - 1].date)
    }
  })

  it('handles empty input', () => {
    assert.deepEqual(downsampleWeekly([]), [])
  })

  it('returns ~52 points for 1 year of daily data', () => {
    const pts = makeDailyPoints(1)
    const result = downsampleWeekly(pts)
    // Allow 50–54 weeks given boundary effects
    assert.ok(result.length >= 50 && result.length <= 54, `Expected ~52, got ${result.length}`)
  })
})

// ─── downsampleForTimeframe (category-aware) ──────────────────────────────────

describe('downsampleForTimeframe — market series (e.g. usdclp, us10y)', () => {
  it('returns all daily points for 1Y', () => {
    const pts = makeDailyPoints(1)
    const result = downsampleForTimeframe(pts, 1, 'usdclp')
    assert.equal(result.length, pts.length)
  })

  it('returns weekly for 3Y', () => {
    const pts = makeDailyPoints(3)
    const weekly = downsampleWeekly(pts)
    const result = downsampleForTimeframe(pts, 3, 'usdclp')
    assert.equal(result.length, weekly.length)
  })

  it('returns WEEKLY for 5Y (market series stay weekly at 5Y, not monthly)', () => {
    const pts = makeDailyPoints(5)
    const weekly = downsampleWeekly(pts)
    const result = downsampleForTimeframe(pts, 5, 'us10y')
    assert.equal(result.length, weekly.length)
    // and materially denser than a monthly downsample would be
    assert.ok(result.length > downsampleMonthly(pts).length)
  })

  it('returns monthly for 10Y', () => {
    const pts = makeDailyPoints(10)
    const monthly = downsampleMonthly(pts)
    const result = downsampleForTimeframe(pts, 10, 'cobre-lme')
    assert.equal(result.length, monthly.length)
  })

  it('omitted histId defaults to the market plan (weekly at 5Y)', () => {
    const pts = makeDailyPoints(5)
    assert.equal(downsampleForTimeframe(pts, 5).length, downsampleWeekly(pts).length)
  })

  it('handles empty input for all timeframes', () => {
    assert.deepEqual(downsampleForTimeframe([], 1, 'usdclp'), [])
    assert.deepEqual(downsampleForTimeframe([], 3, 'usdclp'), [])
    assert.deepEqual(downsampleForTimeframe([], 5, 'usdclp'), [])
    assert.deepEqual(downsampleForTimeframe([], 10, 'usdclp'), [])
  })
})

describe('downsampleForTimeframe — monthly-all series (CB rate / inflation / labor / activity)', () => {
  it('Fed Funds is monthly at every timeframe (incl. 1Y and 3Y)', () => {
    for (const y of [1, 3, 5, 10] as const) {
      const pts = makeDailyPoints(y)
      const result = downsampleForTimeframe(pts, y, 'fed-funds')
      assert.equal(result.length, downsampleMonthly(pts).length, `1Y..10Y monthly, failed at ${y}Y`)
    }
  })

  it('TPM (Chile central bank) is monthly at 1Y (not daily)', () => {
    const pts = makeDailyPoints(1)
    const result = downsampleForTimeframe(pts, 1, 'tpm')
    assert.equal(result.length, downsampleMonthly(pts).length)
    assert.ok(result.length < pts.length)
  })

  it('inflation (ipc-anual) is monthly at 3Y (not weekly)', () => {
    const pts = makeDailyPoints(3)
    const result = downsampleForTimeframe(pts, 3, 'ipc-anual')
    assert.equal(result.length, downsampleMonthly(pts).length)
    assert.ok(result.length < downsampleWeekly(pts).length)
  })

  it('labor (us-unemployment) is monthly at 1Y', () => {
    const pts = makeDailyPoints(1)
    const result = downsampleForTimeframe(pts, 1, 'us-unemployment')
    assert.equal(result.length, downsampleMonthly(pts).length)
  })
})
