// One-off generator: builds a full quarterly fundamentals dataset per ticker
// (income statement, cash flow, balance sheet, returns to shareholders) derived
// deterministically from the published earnings + price snapshots.
// Static MVP sample only — synthetic; replace with CMF FECU in Phase 4.
//
// Run: node scripts/genFundamentals.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, '..', 'src', 'data')

const earnings = JSON.parse(readFileSync(join(DATA, 'earnings.json'), 'utf8'))
const prices = JSON.parse(readFileSync(join(DATA, 'stockPrices.json'), 'utf8'))
const priceBy = Object.fromEntries(prices.map(p => [p.ticker, p]))

function mulberry32(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
const r0 = n => Math.round(n)
const r1 = n => Math.round(n * 10) / 10
const qIdx = p => { const m = p.match(/Q(\d)\s+(\d{4})/); return m ? +m[2] * 4 + +m[1] : 0 }

const byTicker = new Map()
for (const e of earnings) { if (e.revenue == null) continue; if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, []); byTicker.get(e.ticker).push(e) }

const out = []
for (const [ticker, recs] of byTicker) {
  recs.sort((a, b) => qIdx(a.period) - qIdx(b.period))
  const px = priceBy[ticker]
  const lastIdx = recs.length - 1
  recs.forEach((e, i) => {
    const rng = mulberry32(hash(ticker + e.period))
    const j = () => 0.9 + 0.2 * rng()
    const R = e.revenue, E = e.ebitda ?? null, NI = e.netIncome ?? 0, ND = e.netDebt ?? null
    const isBank = E == null
    const dan = r0(R * (isBank ? 0.012 : 0.04) * j())
    const grossProfit = isBank ? r0(R * 0.96) : r0(R * Math.min(Math.max(0.34 * j(), 0.28), 0.46))
    const operatingIncome = E != null ? r0(E - dan) : r0(NI * 1.25)
    const rdExpense = r0(R * 0.012 * j())
    const sgaExpense = r0(R * 0.13 * j())
    const sbcExpense = r0(R * 0.005 * j())
    const capex = r0(R * (isBank ? 0.012 : 0.06) * j())
    const ocf = r0(NI + dan + R * 0.015 * (rng() - 0.5) * 2)
    const fcf = r0(ocf - capex)
    const cash = r0(R * 0.16 * j())
    const ltDebt = ND != null ? r0(ND + cash) : r0(R * 0.6 * j())
    const sharesOut = px ? r0((px.marketCapCLP / px.price) * (1 + 0.002 * (lastIdx - i))) : null
    const dividendsPaid = r0(Math.max(NI, 0) * 0.35 * j())
    const buybacks = r0(Math.max(NI, 0) * 0.03 * rng())
    out.push({
      ticker, period: e.period, reportDate: e.reportDate,
      revenue: R, ebitda: E, grossProfit, operatingIncome, netIncome: NI,
      rdExpense, sgaExpense, sbcExpense, depAmort: dan, eps: e.eps ?? null,
      ebitdaMargin: e.ebitdaMargin ?? (E != null ? r1((E / R) * 100) : null),
      revenueYoY: e.revenueYoY ?? null, netIncomeYoY: e.netIncomeYoY ?? null,
      fcf, ocf, capex, cash, ltDebt, sharesOut, dividendsPaid, buybacks,
    })
  })
}

writeFileSync(join(DATA, 'fundamentals.json'), JSON.stringify(out, null, 0) + '\n', 'utf8')
console.log(`Wrote ${out.length} quarterly fundamentals records for ${byTicker.size} tickers.`)
