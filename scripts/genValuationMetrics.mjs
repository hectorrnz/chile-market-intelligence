// One-off generator: adds a standard valuation-metric set to every stock
// snapshot so the company-detail 3x3 valuation grid has data:
// peFwd, psFwd, evEbitda, opMargin, grossMargin, roe, fcfYield, pb, netDebtEbitda.
// Banks (no EV/EBITDA in source) get null for the margin / EV / net-debt metrics.
// Deterministic & idempotent. Static MVP sample data only — no live source.
//
// Run: node scripts/genValuationMetrics.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'src', 'data', 'stockPrices.json')

function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100

const snaps = JSON.parse(readFileSync(FILE, 'utf8'))

for (const s of snaps) {
  const isBank = s.evEbitda == null
  const rng = mulberry32(hashStr(s.ticker + '|v'))
  const peBase = s.pe ?? (s.evEbitda != null ? s.evEbitda * 1.6 : 12)

  s.peFwd = r1(peBase * (0.90 + 0.05 * rng()))
  s.psFwd = isBank ? r1(2.6 + 1.4 * rng()) : r1(1.4 + 1.8 * rng())
  // evEbitda: keep existing for non-banks; banks stay null
  const opMargin = isBank ? null : r1(13 + 9 * rng())
  s.opMargin = opMargin
  s.grossMargin = isBank ? null : r1((opMargin ?? 16) + 11 + 7 * rng())
  s.roe = isBank ? r1(16 + 7 * rng()) : r1(9 + 9 * rng())
  s.fcfYield = r1(2.5 + 4.5 * rng())
  s.pb = isBank ? r2(1.3 + 0.9 * rng()) : r2(1.4 + 1.9 * rng())
  s.netDebtEbitda = isBank ? null : r1(1.3 + 2.6 * rng())
}

writeFileSync(FILE, JSON.stringify(snaps, null, 2) + '\n', 'utf8')
console.log(`Updated ${snaps.length} snapshots with valuation metrics.`)
