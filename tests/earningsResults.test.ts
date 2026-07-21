// Live quarterly earnings results — pure logic tests (no network).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildResultRows,
  yoyPct,
  toMillions,
  quarterLabel,
  BANK_TICKERS,
  type QuarterRow,
} from '../src/lib/earnings/earningsResultsCore.ts'

const ROOT = join(import.meta.dirname, '..')

describe('earnings results — helpers', () => {
  test('quarterLabel maps a period end to its calendar quarter', () => {
    assert.equal(quarterLabel('2026-03-31'), 'Q1 2026')
    assert.equal(quarterLabel('2025-12-31'), 'Q4 2025')
    assert.equal(quarterLabel('2026-06-30'), 'Q2 2026')
    assert.equal(quarterLabel('2026-09-30'), 'Q3 2026')
    assert.equal(quarterLabel('nonsense'), null)
  })

  test('toMillions converts raw currency units', () => {
    assert.equal(toMillions(1_760_108_000), 1760.1)
    assert.equal(toMillions(null), null)
  })

  test('yoyPct is null for a zero/negative base (never a misleading swing)', () => {
    assert.equal(yoyPct(120, 100), 20)
    assert.equal(yoyPct(100, 0), null)
    assert.equal(yoyPct(100, -50), null)
    assert.equal(yoyPct(null, 100), null)
    assert.equal(yoyPct(100, null), null)
  })
})

describe('earnings results — rolling two-quarter window', () => {
  // Newest first in the fixture is deliberately NOT the input order — the
  // builder must sort, not trust the provider's ordering.
  const rows: QuarterRow[] = [
    { date: '2025-03-31', totalRevenue: 1000e6, EBITDA: 200e6, netIncome: 100e6, dilutedEPS: 1 },
    { date: '2026-03-31', totalRevenue: 1200e6, EBITDA: 260e6, netIncome: 130e6, dilutedEPS: 1.3 },
    { date: '2024-12-31', totalRevenue: 900e6, EBITDA: 180e6, netIncome: 90e6, dilutedEPS: 0.9 },
    { date: '2025-12-31', totalRevenue: 990e6, EBITDA: 198e6, netIncome: 99e6, dilutedEPS: 0.99 },
  ]

  test('keeps exactly the two most recent quarters, newest first', () => {
    const out = buildResultRows('SQM-B', 'SQM', 'USD', rows)
    assert.equal(out.length, 2)
    assert.deepEqual(out.map((r) => r.period), ['Q1 2026', 'Q4 2025'])
  })

  test('YoY compares the SAME quarter a year earlier, not the sequential quarter', () => {
    const out = buildResultRows('SQM-B', 'SQM', 'USD', rows)
    const q1 = out[0]
    // 1200 vs Q1-2025's 1000 = +20% (NOT vs Q4-2025's 990, which would be +21.2%)
    assert.equal(q1.revenueYoY, 20)
    assert.equal(q1.ebitdaYoY, 30)
    assert.equal(q1.netIncomeYoY, 30)
  })

  test('amounts are reported in millions of the row currency', () => {
    const out = buildResultRows('SQM-B', 'SQM', 'USD', rows)
    assert.equal(out[0].revenue, 1200)
    assert.equal(out[0].currency, 'USD')
    assert.equal(out[0].eps, 1.3)
  })

  test('a newly reported quarter rolls the oldest out automatically', () => {
    const withQ2 = [...rows, { date: '2026-06-30', totalRevenue: 1300e6, netIncome: 140e6 }]
    const out = buildResultRows('SQM-B', 'SQM', 'USD', withQ2)
    assert.deepEqual(out.map((r) => r.period), ['Q2 2026', 'Q1 2026'])
    assert.ok(!out.some((r) => r.period === 'Q4 2025'), 'older quarter dropped')
  })

  test('banks never show EBITDA (not a banking metric), even if the source has one', () => {
    const out = buildResultRows('CHILE', 'Banco de Chile', 'CLP', rows)
    assert.equal(out[0].isBank, true)
    assert.equal(out[0].ebitda, null)
    assert.equal(out[0].ebitdaYoY, null)
    // Revenue / net income / EPS still shown for banks.
    assert.equal(out[0].revenue, 1200)
    assert.equal(out[0].netIncome, 130)
  })

  test('all four banks are classified as banks', () => {
    assert.deepEqual([...BANK_TICKERS].sort(), ['BCI', 'BSANTANDER', 'CHILE', 'ITAUCL'])
  })

  test('a period with neither revenue nor net income is not a reported quarter', () => {
    const sparse: QuarterRow[] = [
      { date: '2026-06-30', EBITDA: 10e6 },                 // no top or bottom line → skipped
      { date: '2026-03-31', totalRevenue: 500e6 },
      { date: '2025-12-31', netIncome: 40e6 },
    ]
    const out = buildResultRows('ENTEL', 'Entel', 'CLP', sparse)
    assert.deepEqual(out.map((r) => r.period), ['Q1 2026', 'Q4 2025'])
  })

  test('undated/invalid rows are dropped, never guessed at', () => {
    const bad: QuarterRow[] = [
      { date: 'not-a-date', totalRevenue: 1e9 },
      { date: '2026-03-31', totalRevenue: 500e6, netIncome: 10e6 },
    ]
    const out = buildResultRows('CCU', 'CCU', 'CLP', bad)
    assert.equal(out.length, 1)
    assert.equal(out[0].period, 'Q1 2026')
  })
})

describe('earnings results — no fabricated data', () => {
  test('the resolver documents that NIM is deliberately not derived', () => {
    const src = readFileSync(join(ROOT, 'src/lib/earnings/earningsResultsCore.ts'), 'utf8')
    assert.match(src, /NIM/)
    assert.match(src, /no free source/i)
  })

  test('the Earnings page no longer reads the fabricated static sample', () => {
    const page = readFileSync(join(ROOT, 'src/app/earnings/page.tsx'), 'utf8')
    assert.doesNotMatch(page, /getRecentResults|getUpcomingEarnings/)
    assert.doesNotMatch(page, /resultQuality/)
    // Upcoming now comes from the real CMF calendar.
    assert.match(page, /fetchEarningsCalendar/)
    assert.match(page, /fetchEarningsResults/)
  })
})
