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
  // Phase 4B.1 mapped 6, Phase 4B.2 added 5 more = 11; Phase 8D verified copper = 12;
  // Home overhaul (2026-07-15) verified btp-10 (BTP 2Y substitute) + pdbc-90d (14d
  // substitute) = 14 total. bcu-5 and tpm-tna remain deliberately unverified.
  assert.ok(verifiedCount() >= 14, `expected at least 14 verified entries, got ${verifiedCount()}`)
})

test('manual map: copper is verified in Phase 8D (BCCh monthly USD/lb series)', () => {
  const copper = bcchSeriesManualMap['copper']
  assert.equal(copper.verified, true)
  assert.equal(copper.seriesId, 'F019.PPB.PRE.40.M')
  assert.equal(copper.frequency, 'MONTHLY')
  assert.equal(isManualSeriesLive(copper), true)
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
  // Use a known-unverified entry (bcu-5 remains pending — genuinely zero live
  // observations exist; re-confirmed 2026-07-15, see the Home overhaul phase)
  const unverified = bcchSeriesManualMap['bcu-5']
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
  assert.equal(isManualSeriesLive(bcchSeriesManualMap['btp-10']), true)
  assert.equal(isManualSeriesLive(bcchSeriesManualMap['pdbc-90d']), true)
})

test('manual map: bcu-5 remains the sole genuinely-unverified Chilean rate (re-confirmed 2026-07-15)', () => {
  const bcu5 = bcchSeriesManualMap['bcu-5']
  assert.equal(bcu5.verified, false)
  assert.equal(bcu5.seriesId, null)
})

test('manual map: btp-10 (BTP 2Y substitute) and pdbc-90d (14d substitute) are verified with a distinct real seriesId', () => {
  const btp10 = bcchSeriesManualMap['btp-10']
  assert.equal(btp10.verified, true)
  assert.equal(btp10.seriesId, 'F022.BTP.TIN.AN02.NO.Z.D')
  const pdbc = bcchSeriesManualMap['pdbc-90d']
  assert.equal(pdbc.verified, true)
  assert.equal(pdbc.seriesId, 'F022.PDBC.TIN.D014.NO.Z.D')
})

test('manual map: tpm-tna is deliberately NOT separately live-enabled (avoids a duplicate BCCh fetch of the tpm series)', () => {
  const tpmTna = bcchSeriesManualMap['tpm-tna']
  assert.equal(tpmTna.verified, false)
  assert.equal(tpmTna.seriesId, null)
})

test('every manual entry has a staticId for the fallback path', () => {
  for (const [k, e] of Object.entries(bcchSeriesManualMap)) {
    assert.ok(typeof e.staticId === 'string' && e.staticId.length > 0, `${k} missing staticId`)
  }
})
