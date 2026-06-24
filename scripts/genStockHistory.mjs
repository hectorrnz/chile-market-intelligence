// One-off generator: enriches stockHistory.json with a DAILY series (last ~13
// months) and a WEEKLY series (~5 years), both anchored to the existing
// quarterly trajectory. Quarterly points are preserved for fallback.
//   - daily  → 1D / 5D / 1M / MTD / YTD / 1Y views
//   - weekly → 3Y / 5Y views
// Static MVP sample data only — no live source.
//
// Run: node scripts/genStockHistory.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'src', 'data', 'stockHistory.json')

const DAILY_START = '2024-05-01'
const WEEKLY_START = '2020-06-01'
const END = '2025-06-17'

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
function normal(rng) {
  let u = 0, v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function parseDate(s) { return new Date(s.length === 7 ? `${s}-01` : `${s}`) }
function iso(d) { return d.toISOString().slice(0, 10) }
function roundPrice(p) {
  if (p >= 1000) return Math.round(p)
  if (p >= 100) return Math.round(p * 10) / 10
  return Math.round(p * 100) / 100
}

function trendFn(anchors) {
  return (t) => {
    if (t <= anchors[0].t) return anchors[0].v
    if (t >= anchors[anchors.length - 1].t) return anchors[anchors.length - 1].v
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1]
      if (t >= a.t && t <= b.t) return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t))
    }
    return anchors[anchors.length - 1].v
  }
}

const raw = JSON.parse(readFileSync(FILE, 'utf8'))
const quarterly = raw.filter(p => p.type === 'quarterly' && p.ticker !== 'IPSA')

// Benchmark: IPSA index levels (quarterly anchors, 2020–2025) so company pages
// can show relative performance vs the local market. Static sample.
const IPSA_ANCHORS = [
  ['2020-01', 4600], ['2020-04', 3700], ['2020-07', 3900], ['2020-10', 3600],
  ['2021-01', 4300], ['2021-04', 4700], ['2021-07', 4300], ['2021-10', 4200],
  ['2022-01', 4500], ['2022-04', 5100], ['2022-07', 5200], ['2022-10', 5300],
  ['2023-01', 5400], ['2023-04', 5300], ['2023-07', 6000], ['2023-10', 5500],
  ['2024-01', 5900], ['2024-04', 6500], ['2024-07', 6300], ['2024-10', 6400],
  ['2025-01', 6300], ['2025-04', 6421],
]
const ipsaQuarterly = IPSA_ANCHORS.map(([date, price]) => ({ ticker: 'IPSA', date, price, type: 'quarterly' }))

const byTicker = new Map()
for (const p of [...quarterly, ...ipsaQuarterly]) {
  if (!byTicker.has(p.ticker)) byTicker.set(p.ticker, [])
  byTicker.get(p.ticker).push(p)
}

const out = [...quarterly, ...ipsaQuarterly]

for (const [ticker, points] of byTicker) {
  points.sort((a, b) => a.date.localeCompare(b.date))
  const allAnchors = points.map(p => ({ t: parseDate(p.date).getTime(), v: p.price }))
  const recentAnchors = points.filter(p => p.date >= '2024-04').map(p => ({ t: parseDate(p.date).getTime(), v: p.price }))
  if (allAnchors.length === 0) continue

  // ── Daily (business days, last ~13 months) ──
  {
    const trend = trendFn(recentAnchors.length ? recentAnchors : allAnchors)
    const rng = mulberry32(hashStr(ticker + '|d'))
    let noise = 0
    const end = parseDate(END)
    for (let d = parseDate(DAILY_START); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay()
      if (dow === 0 || dow === 6) continue
      noise = 0.94 * noise + 0.009 * normal(rng)
      noise = Math.max(-0.05, Math.min(0.05, noise))
      out.push({ ticker, date: iso(d), price: roundPrice(trend(d.getTime()) * (1 + noise)), type: 'daily' })
    }
  }

  // ── Weekly (~5 years) ──
  {
    const trend = trendFn(allAnchors)
    const rng = mulberry32(hashStr(ticker + '|w'))
    let noise = 0
    const end = parseDate(END)
    for (let d = parseDate(WEEKLY_START); d <= end; d.setDate(d.getDate() + 7)) {
      noise = 0.9 * noise + 0.018 * normal(rng)
      noise = Math.max(-0.10, Math.min(0.10, noise))
      out.push({ ticker, date: iso(d), price: roundPrice(trend(d.getTime()) * (1 + noise)), type: 'weekly' })
    }
  }
}

writeFileSync(FILE, JSON.stringify(out, null, 0) + '\n', 'utf8')

const c = t => out.filter(p => p.type === t).length
console.log(`Wrote ${out.length} records (${c('quarterly')} quarterly + ${c('daily')} daily + ${c('weekly')} weekly) for ${byTicker.size} tickers.`)
