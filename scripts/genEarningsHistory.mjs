// One-off generator: back-fills quarterly earnings history (down to Q1 2024)
// for every ticker that already has a published result, so the company-detail
// "Recent Results" table can show the pending quarter plus ~5 prior quarters.
// Existing records are preserved; only missing prior quarters are synthesized.
// Static MVP sample data only — no live source.
//
// Run: node scripts/genEarningsHistory.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'src', 'data', 'earnings.json')

const FIRST_QUARTER = { y: 2024, q: 1 }

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
function qIndex(y, q) { return y * 4 + (q - 1) }
function parsePeriod(p) { const m = p.match(/Q(\d)\s+(\d{4})/); return m ? { q: +m[1], y: +m[2] } : null }
function reportDateFor(y, q) {
  // ~45 days after quarter-end
  if (q === 1) return `${y}-05-14`
  if (q === 2) return `${y}-08-13`
  if (q === 3) return `${y}-11-13`
  return `${y + 1}-03-14`
}
function r0(n) { return Math.round(n) }
function r1(n) { return Math.round(n * 10) / 10 }
function r2(n) { return Math.round(n * 100) / 100 }

const data = JSON.parse(readFileSync(FILE, 'utf8'))

const byTicker = new Map()
for (const e of data) {
  if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, [])
  byTicker.get(e.ticker).push(e)
}

const generated = []
const firstIdx = qIndex(FIRST_QUARTER.y, FIRST_QUARTER.q)

for (const [ticker, recs] of byTicker) {
  const published = recs.filter(r => r.resultQuality !== 'Pending' && r.revenue != null)
  if (published.length === 0) continue
  // Latest published quarter = anchor
  let anchor = null, anchorIdx = -1
  for (const r of published) {
    const p = parsePeriod(r.period)
    if (!p) continue
    const idx = qIndex(p.y, p.q)
    if (idx > anchorIdx) { anchorIdx = idx; anchor = r }
  }
  if (!anchor) continue

  const havePeriods = new Set(recs.map(r => r.period))
  const rng = mulberry32(hashStr(ticker + '|e'))

  for (let idx = anchorIdx - 1; idx >= firstIdx; idx--) {
    const y = Math.floor(idx / 4)
    const q = (idx % 4) + 1
    const period = `Q${q} ${y}`
    if (havePeriods.has(period)) continue
    const k = anchorIdx - idx // steps back from anchor
    const decay = Math.pow(1.025, k)             // older quarters scaled down
    const jit = 0.95 + 0.10 * rng()

    const scale = (v) => (v == null ? null : v / decay * jit)
    const revenue = anchor.revenue != null ? r0(scale(anchor.revenue)) : null
    const ebitda = anchor.ebitda != null ? r0(scale(anchor.ebitda)) : null
    const netIncome = anchor.netIncome != null ? r0(scale(anchor.netIncome)) : null
    const eps = anchor.eps != null ? r2(anchor.eps / decay * jit) : null
    const netDebt = anchor.netDebt != null ? r0(anchor.netDebt * (1 + 0.03 * k) * (0.97 + 0.06 * rng())) : null

    const roll = rng()
    const quality = roll < 0.55 ? 'Clean' : roll < 0.85 ? 'Mixed' : 'Weak'

    generated.push({
      id: `h-${ticker.toLowerCase()}-${y}q${q}`,
      ticker,
      companyName: anchor.companyName,
      period,
      reportDate: reportDateFor(y, q),
      ...(revenue != null ? { revenue } : {}),
      ...(ebitda != null ? { ebitda } : {}),
      ...(netIncome != null ? { netIncome } : {}),
      ...(eps != null ? { eps } : {}),
      ...(netDebt != null ? { netDebt } : {}),
      ...(revenue != null ? { revenueYoY: r1(6 + 8 * (rng() - 0.5)) } : {}),
      ...(ebitda != null ? { ebitdaYoY: r1(5 + 10 * (rng() - 0.5)) } : {}),
      ...(netIncome != null ? { netIncomeYoY: r1(7 + 12 * (rng() - 0.5)) } : {}),
      ...(ebitda != null && revenue ? { ebitdaMargin: r1((ebitda / revenue) * 100) } : {}),
      resultQuality: quality,
      summary: `${anchor.companyName} ${period} results (static sample — derived for history view).`,
      source: 'CMF FECU — Static MVP sample (derived history)',
    })
  }
}

const out = [...data, ...generated]
writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`Added ${generated.length} historical earnings records. Total: ${out.length}.`)
