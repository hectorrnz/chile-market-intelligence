// Run with: npm test
// Tests for CMF live provider shell and entity map invariants.
// Static CMF provider is omitted — it imports the data layer which uses @/ aliases
// (same constraint as staticMarketProvider). Coverage for the data layer is
// ensured by the Next.js build (type-checked) and integration tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cmfHechosProvider } from '../src/lib/providers/cmf/cmfHechosProvider.ts'
import { isCmfLiveConfigured } from '../src/lib/providers/cmf/cmfClient.ts'
import { cmfEntityMap, verifiedCmfEntityCount, getCmfEntityByTicker, matchCmfEntityName } from '../src/config/cmfEntityMap.ts'

// ── CMF live provider: inert without configuration ────────────────────────────

test('isCmfLiveConfigured: returns false when CMF_DATA_MODE is not set', () => {
  assert.equal(isCmfLiveConfigured(), false)
})

test('cmfHechosProvider.getHechos: returns ok:false without configuration', async () => {
  const r = await cmfHechosProvider.getHechos()
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.length > 0, 'reason must not be empty')
  assert.ok(!r.ok && !r.reason.includes('CMF_DATA_MODE'), 'reason must not leak env var name')
})

test('cmfHechosProvider.getHecho: returns ok:false without configuration', async () => {
  const r = await cmfHechosProvider.getHecho('345678')
  assert.equal(r.ok, false)
})

test('cmfHechosProvider.getDocument: returns ok:false without configuration', async () => {
  const r = await cmfHechosProvider.getDocument('doc-001')
  assert.equal(r.ok, false)
})

// ── Entity map invariants ─────────────────────────────────────────────────────

test('cmfEntityMap: has 25 entries', () => {
  assert.equal(cmfEntityMap.length, 25)
})

test('cmfEntityMap: all entries have required fields', () => {
  for (const e of cmfEntityMap) {
    assert.ok(typeof e.ticker === 'string' && e.ticker.length > 0, `${e.ticker}: missing ticker`)
    assert.ok(typeof e.companyName === 'string' && e.companyName.length > 0, `${e.ticker}: missing companyName`)
    assert.ok(['emisor', 'banco', 'fondo', 'unknown'].includes(e.cmfEntityType), `${e.ticker}: invalid cmfEntityType`)
    assert.equal(typeof e.verified, 'boolean')
  }
})

test('cmfEntityMap: no verified entries until Phase 5A.1 confirmation', () => {
  assert.equal(verifiedCmfEntityCount(), 0, 'No entity mappings should be verified before Phase 5A.1')
})

test('cmfEntityMap: all rut values are null (unconfirmed)', () => {
  for (const e of cmfEntityMap) {
    assert.equal(e.rut, null, `${e.ticker}: rut must be null until confirmed`)
  }
})

test('cmfEntityMap: all cmfEntityUrl values are null (unconfirmed)', () => {
  for (const e of cmfEntityMap) {
    assert.equal(e.cmfEntityUrl, null, `${e.ticker}: cmfEntityUrl must be null until confirmed`)
  }
})

test('cmfEntityMap: no duplicate ticker values', () => {
  const tickers = cmfEntityMap.map(e => e.ticker)
  const unique = new Set(tickers)
  assert.equal(unique.size, tickers.length, 'Duplicate ticker found in cmfEntityMap')
})

test('getCmfEntityByTicker: finds known ticker', () => {
  const e = getCmfEntityByTicker('SQM-B')
  assert.ok(e !== undefined, 'SQM-B should be in cmfEntityMap')
  assert.equal(e?.ticker, 'SQM-B')
})

test('getCmfEntityByTicker: returns undefined for unknown ticker', () => {
  assert.equal(getCmfEntityByTicker('DOESNOTEXIST'), undefined)
})

test('matchCmfEntityName: returns null when no match (conservative)', () => {
  // Unmatched names should return null, not a wrong ticker
  const r = matchCmfEntityName('SOCIEDAD DESCONOCIDA LTDA')
  assert.equal(r, null)
})
