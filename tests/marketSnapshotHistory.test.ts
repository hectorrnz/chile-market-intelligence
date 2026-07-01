// Phase 4C.4 — Tests for pure market history helpers.
// Covers: resolveHistoryDateRange, isSufficientMarketHistory,
// normalizeStockSnapshotsToHistoryPoints. All pure functions — no Supabase.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveHistoryDateRange,
  isSufficientMarketHistory,
  normalizeStockSnapshotsToHistoryPoints,
  HISTORY_MIN_POINTS,
} from '../src/lib/market/marketHistory.ts'
import type { StockHistoryPoint } from '../src/lib/providers/market/types.ts'
import type { StockHistorySnapshotRow } from '../src/lib/db/repositories/marketRepository.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(
  ticker: string,
  snapshotDate: string,
  price: number | null,
  volume?: number | null,
): StockHistorySnapshotRow {
  return { ticker, snapshotDate, price, volume: volume ?? null, source: 'Yahoo Finance', provider: 'supabase' }
}

function makePoint(ticker: string, date: string, close: number): StockHistoryPoint {
  return { ticker, date, open: null, high: null, low: null, close, volume: null, source: 'test', provider: 'test' }
}

// ─── resolveHistoryDateRange ──────────────────────────────────────────────────

describe('resolveHistoryDateRange', () => {
  const today = '2026-07-01'

  it('returns null for 3Y', () => {
    assert.equal(resolveHistoryDateRange('3Y', today), null)
  })

  it('returns null for 5Y', () => {
    assert.equal(resolveHistoryDateRange('5Y', today), null)
  })

  it('1D range ends today and starts 4 days earlier', () => {
    const r = resolveHistoryDateRange('1D', today)
    assert.ok(r)
    assert.equal(r.to, today)
    assert.equal(r.from, '2026-06-27')
  })

  it('5D range ends today and starts 10 days earlier', () => {
    const r = resolveHistoryDateRange('5D', today)
    assert.ok(r)
    assert.equal(r.to, today)
    assert.equal(r.from, '2026-06-21')
  })

  it('1M range ends today and starts 35 days earlier', () => {
    const r = resolveHistoryDateRange('1M', today)
    assert.ok(r)
    assert.equal(r.to, today)
    assert.equal(r.from, '2026-05-27')
  })

  it('MTD range starts on the 1st of current month', () => {
    const r = resolveHistoryDateRange('MTD', today)
    assert.ok(r)
    assert.equal(r.from, '2026-07-01')
    assert.equal(r.to, today)
  })

  it('YTD range starts on Jan 1 of current year', () => {
    const r = resolveHistoryDateRange('YTD', today)
    assert.ok(r)
    assert.equal(r.from, '2026-01-01')
    assert.equal(r.to, today)
  })

  it('1Y range ends today and starts 370 days earlier', () => {
    const r = resolveHistoryDateRange('1Y', today)
    assert.ok(r)
    assert.equal(r.to, today)
    assert.equal(r.from, '2025-06-26')
  })

  it('from < to for all non-null timeframes', () => {
    const timeframes = ['1D', '5D', '1M', 'MTD', 'YTD', '1Y'] as const
    for (const tf of timeframes) {
      const r = resolveHistoryDateRange(tf, today)
      assert.ok(r, `expected range for ${tf}`)
      assert.ok(r.from <= r.to, `from should be <= to for ${tf}`)
    }
  })
})

// ─── isSufficientMarketHistory ────────────────────────────────────────────────

describe('isSufficientMarketHistory', () => {
  it('1D: 0 points = insufficient', () => {
    assert.equal(isSufficientMarketHistory([], '1D'), false)
  })

  it('1D: 1 point = sufficient', () => {
    assert.equal(isSufficientMarketHistory([makePoint('SQM-B', '2026-07-01', 1000)], '1D'), true)
  })

  it('5D: 2 points = insufficient (need 3)', () => {
    const pts = [makePoint('SQM-B', '2026-06-29', 1000), makePoint('SQM-B', '2026-06-30', 1010)]
    assert.equal(isSufficientMarketHistory(pts, '5D'), false)
  })

  it('5D: 3 points = sufficient', () => {
    const pts = Array.from({ length: 3 }, (_, i) => makePoint('SQM-B', `2026-06-2${i + 6}`, 1000))
    assert.equal(isSufficientMarketHistory(pts, '5D'), true)
  })

  it('1M: 4 points = insufficient (need 5)', () => {
    const pts = Array.from({ length: 4 }, (_, i) => makePoint('SQM-B', `2026-06-${String(i + 1).padStart(2, '0')}`, 1000))
    assert.equal(isSufficientMarketHistory(pts, '1M'), false)
  })

  it('1M: 5 points = sufficient', () => {
    const pts = Array.from({ length: 5 }, (_, i) => makePoint('SQM-B', `2026-06-${String(i + 1).padStart(2, '0')}`, 1000))
    assert.equal(isSufficientMarketHistory(pts, '1M'), true)
  })

  it('MTD: 0 points = insufficient (need 1)', () => {
    assert.equal(isSufficientMarketHistory([], 'MTD'), false)
  })

  it('MTD: 1 point = sufficient', () => {
    assert.equal(isSufficientMarketHistory([makePoint('SQM-B', '2026-07-01', 1000)], 'MTD'), true)
  })

  it('YTD: 4 points = insufficient (need 5)', () => {
    const pts = Array.from({ length: 4 }, (_, i) => makePoint('SQM-B', `2026-0${i + 1}-01`, 1000))
    assert.equal(isSufficientMarketHistory(pts, 'YTD'), false)
  })

  it('YTD: 5 points = sufficient', () => {
    const pts = Array.from({ length: 5 }, (_, i) => makePoint('SQM-B', `2026-0${i + 1}-01`, 1000))
    assert.equal(isSufficientMarketHistory(pts, 'YTD'), true)
  })

  it('1Y: 59 points = insufficient (need 60)', () => {
    const pts = Array.from({ length: 59 }, (_, i) => makePoint('SQM-B', `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-01`, 1000))
    assert.equal(isSufficientMarketHistory(pts, '1Y'), false)
  })

  it('1Y: 60 points = sufficient', () => {
    const pts = Array.from({ length: 60 }, (_, i) => makePoint('SQM-B', `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-01`, 1000))
    assert.equal(isSufficientMarketHistory(pts, '1Y'), true)
  })
})

// ─── HISTORY_MIN_POINTS ───────────────────────────────────────────────────────

describe('HISTORY_MIN_POINTS', () => {
  it('has entries for all short timeframes', () => {
    const expected = ['1D', '5D', '1M', 'MTD', 'YTD', '1Y'] as const
    for (const tf of expected) {
      assert.ok(HISTORY_MIN_POINTS[tf] !== undefined, `Missing min for ${tf}`)
    }
  })

  it('does not have entries for 3Y or 5Y', () => {
    assert.equal(HISTORY_MIN_POINTS['3Y' as never], undefined)
    assert.equal(HISTORY_MIN_POINTS['5Y' as never], undefined)
  })
})

// ─── normalizeStockSnapshotsToHistoryPoints ───────────────────────────────────

describe('normalizeStockSnapshotsToHistoryPoints', () => {
  it('maps price to close; open/high/low are null', () => {
    const rows: StockHistorySnapshotRow[] = [makeRow('SQM-B', '2026-07-01', 1234.5)]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts.length, 1)
    assert.equal(pts[0].close, 1234.5)
    assert.equal(pts[0].open, null)
    assert.equal(pts[0].high, null)
    assert.equal(pts[0].low, null)
  })

  it('copies ticker and date from row', () => {
    const rows = [makeRow('BSANTANDER', '2026-06-30', 50)]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts[0].ticker, 'BSANTANDER')
    assert.equal(pts[0].date, '2026-06-30')
  })

  it('copies volume from row', () => {
    const rows = [makeRow('SQM-B', '2026-07-01', 1000, 500_000)]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts[0].volume, 500_000)
  })

  it('null volume stays null', () => {
    const rows = [makeRow('SQM-B', '2026-07-01', 1000, null)]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts[0].volume, null)
  })

  it('skips rows where price is null', () => {
    const rows: StockHistorySnapshotRow[] = [
      makeRow('SQM-B', '2026-06-30', null),
      makeRow('SQM-B', '2026-07-01', 1234),
    ]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts.length, 1)
    assert.equal(pts[0].close, 1234)
  })

  it('empty input returns empty array', () => {
    assert.deepEqual(normalizeStockSnapshotsToHistoryPoints([]), [])
  })

  it('preserves order of input rows', () => {
    const rows: StockHistorySnapshotRow[] = [
      makeRow('SQM-B', '2026-06-01', 100),
      makeRow('SQM-B', '2026-06-02', 101),
      makeRow('SQM-B', '2026-06-03', 102),
    ]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts.length, 3)
    assert.equal(pts[0].close, 100)
    assert.equal(pts[1].close, 101)
    assert.equal(pts[2].close, 102)
  })

  it('uses fallback source and provider when row fields are null', () => {
    const row: StockHistorySnapshotRow = {
      ticker: 'SQM-B', snapshotDate: '2026-07-01',
      price: 1000, volume: null, source: null, provider: null,
    }
    const pts = normalizeStockSnapshotsToHistoryPoints([row])
    assert.equal(pts[0].source, 'Persisted Yahoo Finance via Supabase')
    assert.equal(pts[0].provider, 'supabase')
  })

  it('uses row source and provider when present', () => {
    const row: StockHistorySnapshotRow = {
      ticker: 'SQM-B', snapshotDate: '2026-07-01',
      price: 1000, volume: null, source: 'Yahoo Finance', provider: 'yahoo',
    }
    const pts = normalizeStockSnapshotsToHistoryPoints([row])
    assert.equal(pts[0].source, 'Yahoo Finance')
    assert.equal(pts[0].provider, 'yahoo')
  })

  it('handles multiple tickers in one batch', () => {
    const rows: StockHistorySnapshotRow[] = [
      makeRow('SQM-B',      '2026-07-01', 1000),
      makeRow('BSANTANDER', '2026-07-01', 50),
    ]
    const pts = normalizeStockSnapshotsToHistoryPoints(rows)
    assert.equal(pts.length, 2)
    assert.equal(pts[0].ticker, 'SQM-B')
    assert.equal(pts[1].ticker, 'BSANTANDER')
  })
})
