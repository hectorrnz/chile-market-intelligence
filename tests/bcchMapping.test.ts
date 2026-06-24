// Run with: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bcchSeriesManualMap, isManualSeriesLive, verifiedCount,
} from '../src/config/bcchSeriesManualMap.ts'

test('manual map: every entry is unverified with a null seriesId (no guessed codes)', () => {
  const entries = Object.values(bcchSeriesManualMap)
  assert.ok(entries.length >= 16)
  for (const e of entries) {
    assert.equal(e.seriesId, null)
    assert.equal(e.verified, false)
  }
  assert.equal(verifiedCount(), 0)
})

test('manual map: includes the required indicator keys', () => {
  const required = [
    'tpm', 'ipc-mom', 'ipc-yoy', 'uf', 'usdclp', 'imacec-yoy', 'unemployment',
    'copper', 'btu-10', 'btp-10', 'btu-5', 'bcu-5', 'camara-swap-2y',
    'camara-swap-1y', 'pdbc-90d', 'tpm-tna',
  ]
  for (const k of required) assert.ok(k in bcchSeriesManualMap, `missing manual-map key: ${k}`)
})

test('isManualSeriesLive: only verified + seriesId counts as live', () => {
  assert.equal(isManualSeriesLive(undefined), false)
  assert.equal(isManualSeriesLive({ ...bcchSeriesManualMap.tpm }), false) // unverified
  assert.equal(isManualSeriesLive({ ...bcchSeriesManualMap.tpm, verified: true }), false) // no seriesId
  assert.equal(isManualSeriesLive({ ...bcchSeriesManualMap.tpm, verified: true, seriesId: 'X.Y.Z' }), true)
})

test('every manual entry has a staticId for the fallback path', () => {
  for (const [k, e] of Object.entries(bcchSeriesManualMap)) {
    assert.ok(typeof e.staticId === 'string' && e.staticId.length > 0, `${k} missing staticId`)
  }
})
