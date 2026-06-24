// One-off generator: enriches macroHistory.json with a DAILY series (last ~1
// year) and a WEEKLY series (~10 years) per indicator, anchored to the existing
// quarterly trajectory. Used by the macro popup chart:
//   1Y  -> daily   ·  3Y / 5Y / 10Y -> weekly
// Static MVP sample data only — no live source.
//
// Run: node scripts/genMacroHistory.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'src', 'data', 'macroHistory.json')

const DAILY_START = '2024-06-17'
const WEEKLY_START = '2015-06-01'
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
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function normal(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
function parseDate(s) { return new Date(s.length === 7 ? `${s}-01` : `${s}`) }
function iso(d) { return d.toISOString().slice(0, 10) }
function round(v) {
  const a = Math.abs(v)
  if (a >= 1000) return Math.round(v)
  if (a >= 100) return Math.round(v * 10) / 10
  if (a >= 1) return Math.round(v * 100) / 100
  return Math.round(v * 1000) / 1000
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
const quarterly = raw.filter(p => !p.type || p.type === 'quarterly').map(p => ({ ...p, type: 'quarterly' }))

const byId = new Map()
for (const p of quarterly) {
  if (!byId.has(p.indicatorId)) byId.set(p.indicatorId, [])
  byId.get(p.indicatorId).push(p)
}

const out = [...quarterly]

for (const [id, pts] of byId) {
  pts.sort((a, b) => a.date.localeCompare(b.date))
  const anchors = pts.map(p => ({ t: parseDate(p.date).getTime(), v: p.value }))
  if (anchors.length === 0) continue
  const trend = trendFn(anchors)

  // Daily (~1 year of business days), small noise
  {
    const rng = mulberry32(hashStr(id + '|d'))
    let noise = 0
    for (let d = parseDate(DAILY_START); d <= parseDate(END); d.setDate(d.getDate() + 1)) {
      const dow = d.getDay(); if (dow === 0 || dow === 6) continue
      noise = 0.9 * noise + 0.0015 * normal(rng)
      noise = Math.max(-0.02, Math.min(0.02, noise))
      out.push({ indicatorId: id, date: iso(d), value: round(trend(d.getTime()) * (1 + noise)), type: 'daily' })
    }
  }
  // Weekly (~10 years)
  {
    const rng = mulberry32(hashStr(id + '|w'))
    let noise = 0
    for (let d = parseDate(WEEKLY_START); d <= parseDate(END); d.setDate(d.getDate() + 7)) {
      noise = 0.88 * noise + 0.004 * normal(rng)
      noise = Math.max(-0.05, Math.min(0.05, noise))
      out.push({ indicatorId: id, date: iso(d), value: round(trend(d.getTime()) * (1 + noise)), type: 'weekly' })
    }
  }
}

writeFileSync(FILE, JSON.stringify(out, null, 0) + '\n', 'utf8')
const c = t => out.filter(p => p.type === t).length
console.log(`Wrote ${out.length} records (${c('quarterly')} quarterly + ${c('daily')} daily + ${c('weekly')} weekly) for ${byId.size} indicators.`)
