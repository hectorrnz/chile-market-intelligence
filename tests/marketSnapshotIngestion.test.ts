// Phase 4C.2 — Unit tests for market snapshot ingestion pure functions.
// Run: npm test
// All mocked — no live Yahoo Finance or Supabase calls.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeError,
  normalizeStockSnapshotRows,
  normalizeIndexSnapshotRows,
  normalizeSectorSnapshotRows,
  INGESTION_VERSION,
  type StockLive,
  type SnapshotType,
} from '../src/lib/ingestion/marketSnapshotIngestion.ts'
import type { SectorLive, IndexLive } from '../src/lib/market/liveOverlay.ts'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TODAY = '2026-06-30'
const OPTS = { snapshotDate: TODAY, snapshotType: 'manual' as SnapshotType, fetchedAt: new Date().toISOString() }

function makeStock(overrides: Partial<StockLive> = {}): StockLive {
  return { price: 100, dayChangePct: 1.5, marketCapCLP: 5000, ...overrides }
}

function makeSector(name: string, overrides: Partial<SectorLive> = {}): SectorLive {
  return {
    sector: name,
    dayChangePct: 0.5,
    ytdChangePct: 3.0,
    numberOfStocks: 3,
    topContributor: 'TICKER_A',
    topContributorPct: 1.2,
    worstContributor: 'TICKER_B',
    worstContributorPct: -0.4,
    ...overrides,
  }
}

function makeIndex(id: string, overrides: Partial<IndexLive> = {}): IndexLive {
  return { id, value: 1000, dayChangePct: 0.3, ytdChangePct: 5.0, ...overrides }
}

// ─── sanitizeError ───────────────────────────────────────────────────────────

describe('sanitizeError', () => {
  test('strips JWT tokens (eyJ...)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const result = sanitizeError(new Error(`Bearer ${jwt}`))
    assert.ok(!result.includes(jwt), 'JWT should be stripped')
    assert.ok(result.includes('***JWT***'), 'placeholder should be present')
  })

  test('strips key= patterns', () => {
    const msg = `Request failed with key=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef`
    const result = sanitizeError(msg)
    assert.ok(!result.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'key should be stripped')
  })

  test('truncates to 500 chars', () => {
    const long = 'x'.repeat(600)
    const result = sanitizeError(new Error(long))
    assert.ok(result.length <= 500, `Expected ≤500 chars, got ${result.length}`)
  })

  test('handles non-Error input (string)', () => {
    const result = sanitizeError('plain error string')
    assert.equal(typeof result, 'string')
    assert.ok(result.includes('plain error string'))
  })

  test('handles non-Error input (object)', () => {
    const result = sanitizeError({ code: 42 })
    assert.equal(typeof result, 'string')
  })
})

// ─── normalizeStockSnapshotRows ───────────────────────────────────────────────

describe('normalizeStockSnapshotRows', () => {
  test('maps StockLive to correct DB row shape', () => {
    const stocks = { BSANTANDER: makeStock({ price: 75, dayChangePct: 1.25, marketCapCLP: 12000 }) }
    const ytdMap = new Map<string, number | null>([['BSANTANDER', 11.5]])
    const rows = normalizeStockSnapshotRows(stocks, ytdMap, OPTS)
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.equal(row.ticker, 'BSANTANDER')
    assert.equal(row.price, 75)
    assert.equal(row.day_change_pct, 1.25)
    assert.equal(row.market_cap, 12000)
    assert.equal(row.provider, 'Yahoo Finance')
    assert.equal(row.status, 'live')
  })

  test('sets ytd_change_pct from staticYtd map', () => {
    const stocks = { CHILE: makeStock() }
    const ytdMap = new Map<string, number | null>([['CHILE', 8.3]])
    const rows = normalizeStockSnapshotRows(stocks, ytdMap, OPTS)
    assert.equal(rows[0].ytd_change_pct, 8.3)
  })

  test('sets ytd_change_pct = null when ticker not in map', () => {
    const stocks = { 'SQM-B': makeStock() }
    const ytdMap = new Map<string, number | null>()
    const rows = normalizeStockSnapshotRows(stocks, ytdMap, OPTS)
    assert.equal(rows[0].ytd_change_pct, null)
  })

  test('sets currency = CLP for all stocks', () => {
    const stocks = { COPEC: makeStock(), CMPC: makeStock() }
    const rows = normalizeStockSnapshotRows(stocks, new Map(), OPTS)
    for (const row of rows) {
      assert.equal(row.currency, 'CLP')
    }
  })

  test('snapshot_date and snapshot_type are set on every row', () => {
    const stocks = { FALABELLA: makeStock(), CCU: makeStock() }
    const rows = normalizeStockSnapshotRows(stocks, new Map(), OPTS)
    for (const row of rows) {
      assert.equal(row.snapshot_date, TODAY)
      assert.equal(row.snapshot_type, 'manual')
    }
  })

  test('metadata includes ingestionVersion', () => {
    const stocks = { ENTEL: makeStock() }
    const rows = normalizeStockSnapshotRows(stocks, new Map(), OPTS)
    assert.equal(rows[0].metadata.ingestionVersion, INGESTION_VERSION)
    assert.equal(rows[0].metadata.ingestionVersion, '4C.2')
  })

  test('returns empty array for empty input', () => {
    const rows = normalizeStockSnapshotRows({}, new Map(), OPTS)
    assert.equal(rows.length, 0)
  })
})

// ─── normalizeIndexSnapshotRows ───────────────────────────────────────────────

describe('normalizeIndexSnapshotRows', () => {
  const makeIndexMeta = (entries: [string, { name: string; country: string | null; currency: string | null }][]) =>
    new Map(entries)

  test('sets proxy_of = COLCAP for colcap index', () => {
    const indices = [makeIndex('colcap')]
    const meta = makeIndexMeta([['colcap', { name: 'S&P Colombia', country: 'Colombia', currency: 'COP' }]])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    assert.equal(rows[0].proxy_of, 'COLCAP')
  })

  test('sets proxy_of = BVL for bvl-peru index', () => {
    const indices = [makeIndex('bvl-peru')]
    const meta = makeIndexMeta([['bvl-peru', { name: 'Peru ETF', country: 'Peru', currency: 'USD' }]])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    assert.equal(rows[0].proxy_of, 'BVL')
  })

  test('sets currency = USD for bvl-peru (EPU is a USD ETF)', () => {
    const indices = [makeIndex('bvl-peru')]
    const meta = makeIndexMeta([['bvl-peru', { name: 'Peru ETF', country: 'Peru', currency: 'USD' }]])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    assert.equal(rows[0].currency, 'USD')
  })

  test('sets currency = COP for colcap', () => {
    const indices = [makeIndex('colcap')]
    const meta = makeIndexMeta([['colcap', { name: 'S&P Colombia', country: 'Colombia', currency: 'COP' }]])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    assert.equal(rows[0].currency, 'COP')
  })

  test('proxy_of = null for non-proxy indices (ipsa)', () => {
    const indices = [makeIndex('ipsa')]
    const meta = makeIndexMeta([['ipsa', { name: 'IPSA', country: 'Chile', currency: 'CLP' }]])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    assert.equal(rows[0].proxy_of, null)
  })

  test('snapshot_date and snapshot_type are set on every row', () => {
    const indices = [makeIndex('ipsa'), makeIndex('sp500')]
    const meta = makeIndexMeta([
      ['ipsa',  { name: 'IPSA',   country: 'Chile', currency: 'CLP' }],
      ['sp500', { name: 'S&P 500', country: 'USA', currency: 'USD' }],
    ])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    for (const row of rows) {
      assert.equal(row.snapshot_date, TODAY)
      assert.equal(row.snapshot_type, 'manual')
    }
  })

  test('metadata includes proxyInstruments for proxy indices', () => {
    const indices = [makeIndex('colcap')]
    const meta = makeIndexMeta([['colcap', { name: 'S&P Colombia', country: 'Colombia', currency: 'COP' }]])
    const rows = normalizeIndexSnapshotRows(indices, meta, OPTS)
    const md = rows[0].metadata as Record<string, unknown>
    assert.ok('proxyInstruments' in md, 'Expected proxyInstruments in metadata for proxy index')
  })

  test('returns empty array for empty input', () => {
    const rows = normalizeIndexSnapshotRows([], new Map(), OPTS)
    assert.equal(rows.length, 0)
  })
})

// ─── normalizeSectorSnapshotRows ──────────────────────────────────────────────

describe('normalizeSectorSnapshotRows', () => {
  test('includes top_contributor_pct and worst_contributor_pct', () => {
    const sectors = [makeSector('Banking', { topContributorPct: 2.1, worstContributorPct: -0.8 })]
    const rows = normalizeSectorSnapshotRows(sectors, OPTS)
    assert.equal(rows[0].top_contributor_pct, 2.1)
    assert.equal(rows[0].worst_contributor_pct, -0.8)
  })

  test('Healthcare sector (LAS-CONDES) maps correctly', () => {
    const sectors = [makeSector('Healthcare', { topContributor: 'LAS-CONDES', topContributorPct: 1.5, worstContributor: 'LAS-CONDES', worstContributorPct: 1.5 })]
    const rows = normalizeSectorSnapshotRows(sectors, OPTS)
    assert.equal(rows[0].sector, 'Healthcare')
    assert.equal(rows[0].top_contributor, 'LAS-CONDES')
  })

  test('snapshot_date and snapshot_type are set on every row', () => {
    const sectors = [makeSector('Banking'), makeSector('Retail')]
    const rows = normalizeSectorSnapshotRows(sectors, OPTS)
    for (const row of rows) {
      assert.equal(row.snapshot_date, TODAY)
      assert.equal(row.snapshot_type, 'manual')
    }
  })

  test('returns empty array for empty input', () => {
    const rows = normalizeSectorSnapshotRows([], OPTS)
    assert.equal(rows.length, 0)
  })
})
