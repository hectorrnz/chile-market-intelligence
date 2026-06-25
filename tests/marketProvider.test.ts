// Run with: npm test
// Tests for Brain Data provider shell and ticker map invariants.
// Static provider tests are intentionally omitted — the static data layer
// imports @/data/* JSON files and @/types, which require Next.js path-alias
// resolution unavailable in the raw node:test runner. Coverage for the data
// layer itself lives in the Next.js build (type-checked) and integration tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brainDataProvider } from '../src/lib/providers/market/brainDataProvider.ts'
import { tickerMap, verifiedTickerCount } from '../src/config/tickerMap.ts'
import { isBrainDataConfigured } from '../src/config/marketDataProviders.ts'

// ── Brain Data provider: inert without credentials ────────────────────────────

test('isBrainDataConfigured: returns false when BRAIN_DATA_API_KEY is not set', () => {
  assert.equal(isBrainDataConfigured(), false)
})

test('brainDataProvider.getStockSnapshots: returns ok:false without credentials', async () => {
  const r = await brainDataProvider.getStockSnapshots()
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.length > 0)
  assert.ok(!r.ok && !r.reason.includes('BRAIN_DATA_API_KEY'), 'reason must not leak env var name')
})

test('brainDataProvider.getStockSnapshot: returns ok:false without credentials', async () => {
  const r = await brainDataProvider.getStockSnapshot('SQM-B')
  assert.equal(r.ok, false)
})

test('brainDataProvider.getStockHistory: returns ok:false without credentials', async () => {
  const r = await brainDataProvider.getStockHistory('SQM-B', '1Y')
  assert.equal(r.ok, false)
})

test('brainDataProvider.getIndices: returns ok:false without credentials', async () => {
  const r = await brainDataProvider.getIndices()
  assert.equal(r.ok, false)
})

test('brainDataProvider.getSectors: returns ok:false without credentials', async () => {
  const r = await brainDataProvider.getSectors()
  assert.equal(r.ok, false)
})

// ── Ticker map invariants ─────────────────────────────────────────────────────

test('tickerMap: all entries have required fields', () => {
  assert.ok(tickerMap.length >= 25, `expected 25+ entries, got ${tickerMap.length}`)
  for (const e of tickerMap) {
    assert.ok(typeof e.internalTicker === 'string' && e.internalTicker.length > 0, `missing internalTicker`)
    assert.ok(typeof e.bolsaSymbol === 'string' && e.bolsaSymbol.length > 0, `${e.internalTicker}: missing bolsaSymbol`)
    assert.equal(e.exchange, 'XSGO', `${e.internalTicker}: exchange must be XSGO`)
    assert.equal(e.currency, 'CLP', `${e.internalTicker}: currency must be CLP`)
    assert.equal(typeof e.verified, 'boolean')
  }
})

test('tickerMap: no verified entries until official Brain Data confirmation', () => {
  assert.equal(verifiedTickerCount(), 0, 'No ticker mappings should be verified before Phase 4C.1')
})

test('tickerMap: all providerSymbols are null (unconfirmed)', () => {
  for (const e of tickerMap) {
    assert.equal(e.providerSymbol, null, `${e.internalTicker}: providerSymbol must be null until confirmed`)
  }
})

test('tickerMap: no duplicate internalTicker values', () => {
  const tickers = tickerMap.map(e => e.internalTicker)
  const unique = new Set(tickers)
  assert.equal(unique.size, tickers.length, 'Duplicate internalTicker found in tickerMap')
})
