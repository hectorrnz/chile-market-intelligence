// Source-integrity regression guards — production audit 2026-07-21.
//
// Locks in the audit's fabricated-data removals:
//   H1  Company page rendered static earnings.json rows with editorial
//       Clean/Mixed/Weak "Quality" pills (the machinery the Earnings-tab
//       rewrite condemned) — now live Yahoo rows + real CMF marker dates.
//   M1  The orphaned /documents/[id] route publicly served fabricated
//       "AI Summary" content from documents.json — deleted.
//   L1  fxRates.json (test/demo-only) still attributed rows to "Bloomberg" /
//       "CoinMarketCap", vendors this project has no relationship with.
//   L2  Dead frozen-date accessors (today = '2025-06-17') and dead
//       consensus-era exports (surprisePct) — deleted.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('H1 — Company page earnings are live, never the fabricated sample', () => {
  const src = read('src/app/companies/[ticker]/page.tsx')

  test('no static earnings.json machinery remains', () => {
    assert.doesNotMatch(src, /getEarningsByTicker/)
    assert.doesNotMatch(src, /resultQuality/)
    assert.doesNotMatch(src, /qualityVariant/)
    assert.doesNotMatch(src, /StatusPill/)
  })

  test('rows come from the live earnings-results resolver', () => {
    assert.match(src, /fetchEarningsResults/)
    assert.match(src, /earningsResults\?\.status === 'live'/)
  })

  test('chart markers are real CMF report dates, not fabricated ones', () => {
    assert.match(src, /fetchEarningsCalendar/)
    assert.match(src, /reportDate <= todayIso/)
  })

  test('the footer names the real source with a real as-of', () => {
    assert.match(src, /t\.stocks\.footer.*asOf=\{earningsResults/s)
  })
})

describe('M1 — the fabricated documents drill-down is gone', () => {
  test('the /documents route no longer exists', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/documents')), 'src/app/documents deleted')
  })

  test('the static accessors are deleted', () => {
    assert.ok(!existsSync(join(ROOT, 'src/lib/data/documents.ts')))
    assert.ok(!existsSync(join(ROOT, 'src/lib/data/earnings.ts')))
  })

  test('the documents i18n block is removed from both languages', () => {
    const i18n = read('src/lib/i18n.ts')
    assert.doesNotMatch(i18n, /documents:\s*\{/)
    assert.doesNotMatch(i18n, /aiSummary/)
    assert.doesNotMatch(i18n, /viewSummary/i)
  })
})

describe('L1 — no fabricated vendor attribution anywhere in src/data', () => {
  test('fxRates.json carries no Bloomberg/CoinMarketCap labels', () => {
    const raw = read('src/data/fxRates.json')
    assert.doesNotMatch(raw, /Bloomberg/i)
    assert.doesNotMatch(raw, /CoinMarketCap/i)
  })
})

describe('L2 — dead consensus-era machinery stays deleted', () => {
  test('formatters no longer exports surprisePct', () => {
    assert.doesNotMatch(read('src/lib/formatters.ts'), /surprisePct/)
  })

  test('earnings i18n has no consensus/quality/beat-miss keys', () => {
    const i18n = read('src/lib/i18n.ts')
    assert.doesNotMatch(i18n, /resultQuality:/)
    assert.doesNotMatch(i18n, /consensus:\s*'/)
    assert.doesNotMatch(i18n, /beatMiss/)
  })

  test('the empty leftover data files stay deleted', () => {
    for (const f of ['hechos_esenciales.json', 'macro_indicators.json', 'stock_prices.json']) {
      assert.ok(!existsSync(join(ROOT, 'src/data', f)), `${f} deleted`)
    }
  })
})
