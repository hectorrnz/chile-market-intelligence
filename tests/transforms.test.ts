// Run with: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveValueChange, transformSeries } from '../src/lib/providers/transforms.ts'
import { isPlausible, plausibilityReason } from '../src/lib/providers/plausibility.ts'

test('transform "none": value is latest, change is delta vs previous', () => {
  const pts = [
    { date: '2025-04-15', value: 5.25 },
    { date: '2025-06-17', value: 5.0 },
  ]
  const d = deriveValueChange(pts, 'none')
  assert.equal(d?.value, 5)
  assert.equal(d?.change, -0.25)
  assert.equal(d?.asOf, '2025-06-17')
})

test('transform "bp-to-pct": rescales basis points to percent', () => {
  const pts = [
    { date: '2025-05-01', value: 550 },
    { date: '2025-06-01', value: 500 },
  ]
  const d = deriveValueChange(pts, 'bp-to-pct')
  assert.equal(d?.value, 5)       // 500bp → 5%
  assert.equal(d?.change, -0.5)   // (550→500)bp → −0.5pp
})

test('transform "mom": month-over-month % from an index level', () => {
  const pts = [
    { date: '2025-04-01', value: 100 },
    { date: '2025-05-01', value: 101 }, // +1.0% m/m
    { date: '2025-06-01', value: 101.5 }, // +0.495% m/m
  ]
  const d = deriveValueChange(pts, 'mom')
  assert.equal(d?.value, 0.5)     // ~0.495 rounded
  // change = latest m/m (0.5) − prior m/m (1.0) = −0.5
  assert.equal(d?.change, -0.5)
})

test('transform "yoy": 12-month % from a monthly index level', () => {
  const pts = []
  // 13 monthly points: base 100 growing 0.5%/mo → ~6.17% yoy
  let v = 100
  for (let m = 0; m < 13; m++) {
    const month = String((m % 12) + 1).padStart(2, '0')
    const year = 2024 + Math.floor(m / 12)
    pts.push({ date: `${year}-${month}-01`, value: Math.round(v * 100) / 100 })
    v *= 1.005
  }
  const d = deriveValueChange(pts, 'yoy')
  assert.ok(d != null)
  assert.ok(d.value > 5.5 && d.value < 7, `expected ~6.2% yoy, got ${d.value}`)
})

test('deriveValueChange returns null for an empty/all-null series', () => {
  assert.equal(deriveValueChange([], 'none'), null)
  assert.equal(deriveValueChange([{ date: '2025-06-01', value: null }], 'none'), null)
})

test('transformSeries drops points without a derivable metric (yoy needs a year-ago base)', () => {
  const pts = [
    { date: '2024-06-01', value: 100 },
    { date: '2024-12-01', value: 103 },
    { date: '2025-06-01', value: 106 },
  ]
  const out = transformSeries(pts, 'yoy')
  // earliest point has no year-ago base → fewer points than input
  assert.ok(out.length >= 1 && out.length < pts.length)
  assert.ok(out.every(p => typeof p.value === 'number'))
})

test('plausibility: accepts in-band, rejects out-of-band', () => {
  assert.equal(isPlausible('tpm', 5), true)
  assert.equal(isPlausible('tpm', 25), false)        // > 20%
  assert.equal(isPlausible('usdclp', 950), true)
  assert.equal(isPlausible('usdclp', 50), false)     // index level mistakenly mapped
  assert.equal(isPlausible('uf', 38000), true)
  assert.equal(isPlausible('unknown-key', 999999), true) // no band → not rejected
})

test('plausibilityReason explains the failure', () => {
  assert.equal(plausibilityReason('tpm', 5), null)
  assert.match(plausibilityReason('tpm', 25) ?? '', /outside plausible band/)
})
