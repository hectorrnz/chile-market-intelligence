// 2026-07-20 — Compare fundamentals correctness fixes.
//
// Live-verified against the real production Supabase data (CHILE/BCI/ITAUCL,
// the three bank tickers) that Compare's derived P/E and FCF Yield were
// producing nonsensical figures — P/E fwd 70.5x/47.9x/65x for banks that
// should trade around 8-16x, and FCF Yield in the millions of percent
// (-4,980,212.8% for ITAUCL). Root-caused to two distinct bugs:
//
//   1. P/E used the single latest quarter's EPS as if it were an annual/TTM
//      figure (CHILE: price 187.62 / Q1'26 eps 2.66 = 70.53x — an exact
//      match to the displayed bug). Fixed by getEpsForValuation(), which
//      prefers the latest ANNUAL eps, or sums the last 4 CONSECUTIVE
//      quarterly eps values (a real trailing-twelve-months figure) — never a
//      single quarter alone.
//
//   2. financial_statement_items/financial_metrics store each source's own
//      raw scale — the manual-CSV template convention is millions CLP, but
//      every LIVE provider (Yahoo, CMF/XBRL, CMF bank) writes true raw CLP
//      (confirmed via the DB's own 'scale' column: 'units', not 'millions').
//      resolveCompareData.ts combined a raw-CLP fcf metric with
//      marketCapCLP (always millions) with no conversion at all — a
//      1,000,000x error. Fixed by toMillionsClp(), which normalizes using
//      the item's own scale column (statement items) or a source_type rule
//      (metrics, which have no scale column at all).
//
// A latent third bug was found while fixing #1: a quarterly and an annual
// reporting period can legitimately share the same period_end_date (a Q4
// quarter and the full FY both end 12-31), and both stay canonical since
// supersession only dedupes within the same (fiscal_year, fiscal_period,
// period_type). The old getLatestStatementItems/getLatestFinancialMetrics
// picked "every item whose date matches the latest date" — silently mixing
// line items from two unrelated filings. Fixed to pick a single
// reporting_period_id (highest source_priority) instead of merging.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toMillionsClp } from '../src/lib/db/repositories/financialsRepository.ts'

const ROOT = join(import.meta.dirname, '..')
const REPO = readFileSync(join(ROOT, 'src/lib/db/repositories/financialsRepository.ts'), 'utf8')
const RESOLVER = readFileSync(join(ROOT, 'src/lib/compare/resolveCompareData.ts'), 'utf8')
const COMPARE_PAGE = readFileSync(join(ROOT, 'src/app/compare/page.tsx'), 'utf8')

describe('toMillionsClp — the fix for the FCF Yield scale bug', () => {
  it('divides by 1e6 when the statement item scale is "units" (every live provider)', () => {
    assert.equal(toMillionsClp(3_111_301_000_000, { scale: 'units', sourceType: 'yahoo_finance' }), 3_111_301)
  })

  it('passes through unchanged when scale is "millions" (the manual-CSV convention)', () => {
    assert.equal(toMillionsClp(745_990, { scale: 'millions', sourceType: 'manual_csv' }), 745_990)
  })

  it('financial_metrics has no scale column — falls back to a source_type rule', () => {
    // The exact real bug: fcf = -224,104,000,000 raw CLP from Yahoo, no scale
    // column on financial_metrics at all.
    assert.equal(toMillionsClp(-224_104_000_000, { sourceType: 'yahoo_finance' }), -224_104)
    assert.equal(toMillionsClp(-224_104_000_000, { sourceType: 'xbrl' }), -224_104)
    assert.equal(toMillionsClp(-224_104_000_000, { sourceType: 'cmf_bank' }), -224_104)
  })

  it('manual_csv/derived metrics (no scale column) are assumed already-millions, unconverted', () => {
    assert.equal(toMillionsClp(115_000, { sourceType: 'manual_csv' }), 115_000)
    assert.equal(toMillionsClp(115_000, { sourceType: 'derived' }), 115_000)
  })

  it('reproduces the exact live ITAUCL FCF Yield bug and confirms the fix corrects it', () => {
    const fcfRaw = -224_104_000_000 // real persisted value, source_type yahoo_finance
    const marketCapMM = 4_499_888 // real persisted value, already millions
    const buggyPct = (fcfRaw / marketCapMM) * 100
    assert.ok(buggyPct < -1_000_000, 'reproduces the reported ~-4,980,212% bug before the fix')

    const fixedFcfMM = toMillionsClp(fcfRaw, { sourceType: 'yahoo_finance' })
    const fixedPct = (fixedFcfMM / marketCapMM) * 100
    assert.ok(fixedPct > -20 && fixedPct < 0, `fixed FCF yield must be a plausible percentage, got ${fixedPct}`)
  })
})

describe('resolveCompareData.ts — wiring for both fixes', () => {
  it('imports and uses toMillionsClp for ebitda/net_debt/fcf, never the raw value', () => {
    assert.ok(RESOLVER.includes('toMillionsClp'))
    assert.ok(RESOLVER.includes('toMillionsClp(ebitdaItem.value, ebitdaItem)'))
    assert.ok(RESOLVER.includes('toMillionsClp(fcfMetric.value, fcfMetric)'))
  })

  it('imports and uses getEpsForValuation instead of a raw single-period eps lookup', () => {
    assert.ok(RESOLVER.includes('getEpsForValuation'))
    assert.ok(!RESOLVER.includes("itemsByCode.get('eps')"), 'must not read eps directly — a single period is never annual/TTM')
  })

  it('dividendsPaidMM/sharesOutMM are deliberately left unconverted (their ratio cancels scale)', () => {
    assert.ok(RESOLVER.includes('dividendsPaidMM: itemsByCode'))
    assert.ok(RESOLVER.includes('cancels out'))
  })
})

describe('getLatestStatementItems/getLatestFinancialMetrics — no cross-period contamination', () => {
  it('picks a single reporting_period_id, never merges items across periods sharing a date', () => {
    assert.ok(REPO.includes('pickLatestReportingPeriodId'))
    assert.ok(!REPO.includes('if (item.periodEndDate === latestPeriodEnd) byCode.set(item.lineItemCode, item)'))
  })

  it('disambiguates same-date periods by the higher source_priority, not an arbitrary order', () => {
    assert.ok(REPO.includes('reportingPeriodSourcePriority'))
  })
})

describe('Compare fundamentals cell formatting — always rounded, never a raw float', () => {
  it('every "x"/"%" cell in the fundamentals table goes through a rounding formatter', () => {
    assert.ok(COMPARE_PAGE.includes('fmtX'))
    assert.ok(COMPARE_PAGE.includes('fmtPctCell'))
    assert.ok(COMPARE_PAGE.includes('toFixed(1)'))
    // The old unrounded template-literal formatters must be gone.
    assert.ok(!COMPARE_PAGE.includes('fmt: v => `${v}x`'))
    assert.ok(!COMPARE_PAGE.includes('fmt: v => `${v}%`'))
  })
})
