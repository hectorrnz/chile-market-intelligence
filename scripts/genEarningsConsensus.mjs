// One-off generator: injects sell-side consensus estimates into earnings.json
// for every reported (non-Pending) record, so the Earnings tab can show a
// beat/miss surprise. Deterministic and correlated with resultQuality — a
// "Clean" quarter beats consensus, a "Weak" quarter misses. Synthetic MVP
// sample only; replaced by real consensus feeds in a later phase.
//
// Run: node scripts/genEarningsConsensus.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'src', 'data', 'earnings.json')

function mulberry32(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

// Surprise band (fraction) by result quality: [min, max]
const BAND = {
  Clean: [0.01, 0.05],
  Mixed: [-0.015, 0.015],
  Weak:  [-0.05, -0.01],
}

const data = JSON.parse(readFileSync(FILE, 'utf8'))
let n = 0
for (const e of data) {
  if (e.resultQuality === 'Pending') continue
  if (e.revenue == null) continue
  const rng = mulberry32(hash(e.id))
  const band = BAND[e.resultQuality] ?? BAND.Mixed
  const pick = (jitter = 1) => {
    const f = band[0] + (band[1] - band[0]) * rng()
    return f * jitter
  }
  // Revenue surprise drives the headline; EBITDA and EPS get correlated but
  // slightly larger surprises (operating leverage), same sign.
  const revSurprise = pick()
  e.consensusRevenue = Math.round(e.revenue / (1 + revSurprise))
  if (e.ebitda != null) {
    const ebSurprise = revSurprise * (1.1 + 0.6 * rng())
    e.consensusEbitda = Math.round(e.ebitda / (1 + ebSurprise))
  }
  if (e.eps != null) {
    const epsSurprise = revSurprise * (1.2 + 0.7 * rng())
    const dec = Math.abs(e.eps) < 100 ? 100 : 1
    e.consensusEps = Math.round((e.eps / (1 + epsSurprise)) * dec) / dec
  }
  n++
}

writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log(`Injected consensus into ${n} reported earnings records.`)
