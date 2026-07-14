// Category-aware macro popup-chart frequency policy.
// Run: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  macroChartFrequency,
  applyMacroFrequency,
  downsampleWeekly,
  downsampleMonthly,
  type MacroTimeframe,
} from '../src/lib/providers/macroFrequency.ts'

// ── Market-priced series: 1Y daily · 3Y/5Y weekly · 10Y monthly ──────────────

const MARKET_IDS = [
  // non-central-bank rates
  'us10y', 'us2y', 'us3m', 'us20y', 'us30y',
  'btu10-ref', 'btp10', 'btu5', 'bcu5', 'swap1y', 'swap2y', 'pdbc90',
  // FX
  'usdclp', 'eurclp', 'dxy',
  // commodities
  'cobre-lme', 'litio-spot', 'brent',
  // crypto
  'bitcoin',
]

for (const id of MARKET_IDS) {
  test(`market series ${id}: daily/weekly/weekly/monthly`, () => {
    assert.equal(macroChartFrequency(id, 1), 'daily')
    assert.equal(macroChartFrequency(id, 3), 'weekly')
    assert.equal(macroChartFrequency(id, 5), 'weekly')
    assert.equal(macroChartFrequency(id, 10), 'monthly')
  })
}

// ── Monthly-at-every-timeframe series ────────────────────────────────────────

const MONTHLY_IDS = [
  // central-bank policy rates
  'tpm', 'tpm-tna', 'fed-funds',
  // inflation
  'ipc-mensual', 'ipc-anual', 'uf-diaria', 'us-cpi-mensual', 'us-cpi-anual',
  // labor
  'desempleo', 'us-unemployment',
  // activity
  'imacec-anual', 'credito', 'pib', 'us-gdp',
]

for (const id of MONTHLY_IDS) {
  test(`monthly-all series ${id}: monthly at every timeframe`, () => {
    for (const y of [1, 3, 5, 10] as MacroTimeframe[]) {
      assert.equal(macroChartFrequency(id, y), 'monthly', `expected monthly at ${y}Y for ${id}`)
    }
  })
}

// ── The specific rule the user called out: Fed Funds & TPM are the ONLY rates
//    kept monthly; every other rate follows the market plan. ──────────────────

test('Fed Funds and TPM diverge from other rates at 1Y (monthly vs daily)', () => {
  assert.equal(macroChartFrequency('fed-funds', 1), 'monthly')
  assert.equal(macroChartFrequency('tpm', 1), 'monthly')
  assert.equal(macroChartFrequency('us10y', 1), 'daily')     // a non-CB US rate
  assert.equal(macroChartFrequency('btu10-ref', 1), 'daily') // a non-CB Chile rate
})

// ── Unknown ids default to the market plan (never throw). ─────────────────────

test('unknown id defaults to the market plan', () => {
  assert.equal(macroChartFrequency('something-new', 1), 'daily')
  assert.equal(macroChartFrequency('something-new', 5), 'weekly')
  assert.equal(macroChartFrequency('', 10), 'monthly')
})

// ── applyMacroFrequency wires the classifier to the downsamplers ─────────────

test('applyMacroFrequency: market series at 5Y downsamples to weekly', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({
    date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    value: i,
  }))
  const out = applyMacroFrequency(pts, 'usdclp', 5)
  assert.equal(out.length, downsampleWeekly(pts).length)
})

test('applyMacroFrequency: monthly-all series at 1Y downsamples to monthly', () => {
  const pts = Array.from({ length: 400 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    value: i,
  }))
  const out = applyMacroFrequency(pts, 'fed-funds', 1)
  assert.equal(out.length, downsampleMonthly(pts).length)
})

test('applyMacroFrequency never fabricates — every output is a real input point', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({
    date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    value: i * 1.5,
  }))
  for (const out of [applyMacroFrequency(pts, 'us10y', 3), applyMacroFrequency(pts, 'ipc-anual', 5)]) {
    for (const p of out) assert.ok(pts.some((raw) => raw.date === p.date && raw.value === p.value))
  }
})
