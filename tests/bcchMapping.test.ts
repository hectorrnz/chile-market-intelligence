// Run with: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bcchSeriesManualMap, isManualSeriesLive, verifiedCount,
} from '../src/config/bcchSeriesManualMap.ts'

test('manual map: unverified entries have null seriesId; verified entries have a seriesId', () => {
  const entries = Object.entries(bcchSeriesManualMap)
  assert.ok(entries.length >= 16)
  for (const [key, e] of entries) {
    if (e.verified) {
      assert.ok(e.seriesId !== null, `verified entry "${key}" must have a non-null seriesId`)
    } else {
      assert.equal(e.seriesId, null, `unverified entry "${key}" must keep seriesId=null (no guessing)`)
    }
  }
  // Phase 4B.1 mapped 6, Phase 4B.2 added 5 more = 11 total
  assert.ok(verifiedCount() >= 11, `expected at least 11 verified entries, got ${verifiedCount()}`)
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
  // Use a known-unverified entry (copper remains pending — unit mismatch)
  const unverified = bcchSeriesManualMap['copper']
  assert.equal(isManualSeriesLive(undefined), false)
  assert.equal(isManualSeriesLive({ ...unverified }), false)                    // verified=false, seriesId=null
  assert.equal(isManualSeriesLive({ ...unverified, verified: true }), false)    // verified but no seriesId
  assert.equal(isManualSeriesLive({ ...unverified, verified: true, seriesId: 'X.Y.Z' }), true)
  // Confirmed live entries should return true
  assert.equal(isManualSeriesLive(bcchSeriesManualMap.tpm), true)
  assert.equal(isManualSeriesLive(bcchSeriesManualMap.uf), true)
  assert.equal(isManualSeriesLive(bcchSeriesManualMap['ipc-mom']), true)
  assert.equal(isManualSeriesLive(bcchSeriesManualMap['ipc-yoy']), true)
  assert.equal(isManualSeriesLive(bcchSeriesManualMap['usdclp']), true)
})

test('every manual entry has a staticId for the fallback path', () => {
  for (const [k, e] of Object.entries(bcchSeriesManualMap)) {
    assert.ok(typeof e.staticId === 'string' && e.staticId.length > 0, `${k} missing staticId`)
  }
})
