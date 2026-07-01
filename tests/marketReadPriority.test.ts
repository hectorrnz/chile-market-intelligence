// Phase 4C.3 — Unit tests for the Supabase market read-path pure functions.
// Run: npm test
// No live Supabase or Yahoo Finance calls — all inputs are mocked inline.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarketDataMode, decideMarketSource } from '../src/lib/providers/market/marketDataMode.ts'
import { isSnapshotStale } from '../src/lib/providers/market/supabaseMarketProvider.ts'
import { SNAPSHOT_TYPE_PRIORITY } from '../src/lib/db/repositories/marketRepository.ts'

// ─── parseMarketDataMode ─────────────────────────────────────────────────────

describe('parseMarketDataMode (Phase 4C.3 semantics)', () => {
  test('supabase → supabase', () => {
    assert.equal(parseMarketDataMode('supabase'), 'supabase')
    assert.equal(parseMarketDataMode('SUPABASE'), 'supabase')
    assert.equal(parseMarketDataMode('  supabase  '), 'supabase')
  })

  test('hybrid → hybrid', () => {
    assert.equal(parseMarketDataMode('hybrid'), 'hybrid')
    assert.equal(parseMarketDataMode('HYBRID'), 'hybrid')
  })

  test('static → static', () => {
    assert.equal(parseMarketDataMode('static'), 'static')
    assert.equal(parseMarketDataMode('STATIC'), 'static')
  })

  test('old "live" value is no longer recognised → maps to static', () => {
    assert.equal(parseMarketDataMode('live'), 'static', '"live" was Brain Data; now repurposed to static')
    assert.equal(parseMarketDataMode('LIVE'), 'static')
  })

  test('unknown/empty/null → static', () => {
    assert.equal(parseMarketDataMode(undefined), 'static')
    assert.equal(parseMarketDataMode(null), 'static')
    assert.equal(parseMarketDataMode(''), 'static')
    assert.equal(parseMarketDataMode('brain_data'), 'static')
    assert.equal(parseMarketDataMode('SUPABASE_V2'), 'static')
  })
})

// ─── decideMarketSource ───────────────────────────────────────────────────────

describe('decideMarketSource', () => {
  test('static → always static regardless of liveOk', () => {
    const r = decideMarketSource('static', false)
    assert.equal(r.dataModeUsed, 'static')
    assert.equal(r.status, 'static')
    assert.equal(r.liveAvailable, false)

    const r2 = decideMarketSource('static', true)
    assert.equal(r2.dataModeUsed, 'static')
    assert.equal(r2.liveAvailable, false)
  })

  test('supabase + ok → persisted status, supabase dataModeUsed', () => {
    const r = decideMarketSource('supabase', true)
    assert.equal(r.dataModeUsed, 'supabase')
    assert.equal(r.status, 'persisted')
    assert.equal(r.liveAvailable, true)
    assert.equal(r.fallbackReason, undefined)
  })

  test('supabase + failed → live-unavailable, no silent static fallback', () => {
    const r = decideMarketSource('supabase', false, 'No snapshots available')
    assert.equal(r.dataModeUsed, 'static')
    assert.equal(r.status, 'live-unavailable')
    assert.equal(r.liveAvailable, false)
    assert.ok(r.fallbackReason?.includes('No snapshots'), 'reason should propagate')
  })

  test('supabase + failed without reason → default fallback message', () => {
    const r = decideMarketSource('supabase', false)
    assert.equal(r.status, 'live-unavailable')
    assert.ok(typeof r.fallbackReason === 'string' && r.fallbackReason.length > 0)
  })

  test('hybrid + ok → persisted status, hybrid dataModeUsed', () => {
    const r = decideMarketSource('hybrid', true)
    assert.equal(r.dataModeUsed, 'hybrid')
    assert.equal(r.status, 'persisted')
    assert.equal(r.liveAvailable, true)
  })

  test('hybrid + failed → hybrid-fallback, silent static', () => {
    const r = decideMarketSource('hybrid', false, 'Supabase not configured')
    assert.equal(r.dataModeUsed, 'static')
    assert.equal(r.status, 'hybrid-fallback')
    assert.equal(r.liveAvailable, false)
    assert.ok(r.fallbackReason?.includes('Supabase'))
  })
})

// ─── isSnapshotStale ──────────────────────────────────────────────────────────

describe('isSnapshotStale', () => {
  function daysAgo(n: number): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - n)
    return d.toISOString().slice(0, 10)
  }

  test('same day → not stale', () => {
    assert.equal(isSnapshotStale(daysAgo(0)), false)
  })

  test('1 day old → not stale', () => {
    assert.equal(isSnapshotStale(daysAgo(1)), false)
  })

  test('5 days old → not stale (boundary is exclusive at exactly 5)', () => {
    assert.equal(isSnapshotStale(daysAgo(5)), false)
  })

  test('6 days old → stale', () => {
    assert.equal(isSnapshotStale(daysAgo(6)), true)
  })

  test('10 days old → stale', () => {
    assert.equal(isSnapshotStale(daysAgo(10)), true)
  })

  test('null → stale', () => {
    assert.equal(isSnapshotStale(null), true)
  })

  test('empty string → stale', () => {
    assert.equal(isSnapshotStale(''), true)
  })

  test('invalid date string → stale', () => {
    assert.equal(isSnapshotStale('not-a-date'), true)
    assert.equal(isSnapshotStale('2026-99-99'), true)
  })

  test('future date → not stale', () => {
    const tomorrow = daysAgo(-1)
    assert.equal(isSnapshotStale(tomorrow), false)
  })
})

// ─── SNAPSHOT_TYPE_PRIORITY ───────────────────────────────────────────────────

describe('SNAPSHOT_TYPE_PRIORITY ordering', () => {
  test('live_refresh ranks highest', () => {
    const rank = (t: string) => SNAPSHOT_TYPE_PRIORITY[t] ?? -1
    assert.ok(rank('live_refresh') > rank('manual'), 'live_refresh > manual')
    assert.ok(rank('manual') > rank('close'), 'manual > close')
    assert.ok(rank('close') > rank('midday'), 'close > midday')
  })

  test('all four types are defined', () => {
    for (const t of ['live_refresh', 'manual', 'close', 'midday']) {
      assert.ok(t in SNAPSHOT_TYPE_PRIORITY, `${t} should be in priority map`)
    }
  })

  test('unknown type falls back to -1 sentinel', () => {
    const unknown = SNAPSHOT_TYPE_PRIORITY['unknown_type'] ?? -1
    assert.equal(unknown, -1)
  })
})

// ─── Proxy / sector classification (contract assertions) ─────────────────────

describe('Proxy and sector metadata contract', () => {
  test('INDEX_PROXY_OF covers colcap → COLCAP and bvl-peru → BVL', async () => {
    const { INDEX_PROXY_OF } = await import('../src/lib/market/liveOverlay.ts')
    assert.equal(INDEX_PROXY_OF['colcap'], 'COLCAP')
    assert.equal(INDEX_PROXY_OF['bvl-peru'], 'BVL')
  })

  test('EPU maps to bvl-peru index (Peru proxy is a USD ETF, not an official index)', async () => {
    const { INDEX_YF } = await import('../src/lib/market/liveOverlay.ts')
    assert.equal(INDEX_YF['bvl-peru'], 'EPU', 'bvl-peru should use EPU (iShares MSCI Peru ETF) as Yahoo symbol')
  })

  test('LAS-CONDES belongs to Healthcare sector (not Real Estate/Malls)', async () => {
    const { SECTOR_MAP } = await import('../src/lib/market/liveOverlay.ts')
    const healthcare = SECTOR_MAP['Healthcare'] ?? []
    const realEstate = SECTOR_MAP['Real Estate / Malls'] ?? []
    assert.ok(healthcare.includes('LAS-CONDES'), 'LAS-CONDES must be Healthcare')
    assert.ok(!realEstate.includes('LAS-CONDES'), 'LAS-CONDES must not be Real Estate / Malls')
  })

  test('Real Estate / Malls contains only PARAUCO and MALLPLAZA', async () => {
    const { SECTOR_MAP } = await import('../src/lib/market/liveOverlay.ts')
    const realEstate = SECTOR_MAP['Real Estate / Malls'] ?? []
    assert.deepEqual(realEstate.sort(), ['MALLPLAZA', 'PARAUCO'].sort())
  })
})
