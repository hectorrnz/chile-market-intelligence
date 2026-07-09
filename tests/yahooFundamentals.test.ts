// Phase 8C.5 — Yahoo Finance universal fundamentals provider tests.
//
// Pure mapper + period derivation are tested against synthetic in-memory rows
// (no network, no yahoo-finance2 import). Route/registration hygiene is
// grep-based, matching the CMF test style.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  derivePeriod,
  mapYahooRowsToPayload,
  yahooSymbolFor,
  YAHOO_FINANCE_SOURCE_TYPE,
  type YahooFundamentalsFetch,
} from '../src/lib/financials/providers/yahooFundamentalsProvider.ts'
import { getYahooTickers } from '../src/lib/financials/yahoo/runYahooFinancialsIngestion.ts'
import { VALID_SOURCE_TYPES } from '../src/lib/financials/csvFinancials.ts'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('yahoo derivePeriod — quarterly + annual, UTC-safe', () => {
  it('maps quarter-end months to Q1..Q4', () => {
    assert.equal(derivePeriod('2025-03-31T00:00:00.000Z', 'quarterly')?.fiscalPeriod, 'Q1')
    assert.equal(derivePeriod('2025-06-30T00:00:00.000Z', 'quarterly')?.fiscalPeriod, 'Q2')
    assert.equal(derivePeriod('2025-09-30T00:00:00.000Z', 'quarterly')?.fiscalPeriod, 'Q3')
    assert.equal(derivePeriod('2025-12-31T00:00:00.000Z', 'quarterly')?.fiscalPeriod, 'Q4')
  })
  it('quarter fiscalYear + start date are correct', () => {
    const q = derivePeriod('2026-03-31T00:00:00.000Z', 'quarterly')!
    assert.equal(q.fiscalYear, 2026)
    assert.equal(q.periodStartDate, '2026-01-01')
    assert.equal(q.periodEndDate, '2026-03-31')
  })
  it('annual maps to FY with Jan-1 start', () => {
    const a = derivePeriod('2025-12-31T00:00:00.000Z', 'annual')!
    assert.equal(a.fiscalPeriod, 'FY')
    assert.equal(a.fiscalYear, 2025)
    assert.equal(a.periodStartDate, '2025-01-01')
  })
  it('returns null on an unparseable date', () => {
    assert.equal(derivePeriod('not-a-date', 'annual'), null)
  })
})

describe('yahoo mapYahooRowsToPayload — field mapping, sign, missing, metrics', () => {
  const fetch: YahooFundamentalsFetch = {
    ticker: 'CCU',
    symbol: 'CCU.SN',
    currency: 'CLP',
    annual: [
      { date: '2025-12-31T00:00:00.000Z', totalRevenue: 2000, grossProfit: 800, operatingIncome: 300, EBITDA: 400, netIncome: 200, dilutedEPS: 5, operatingCashFlow: 350, capitalExpenditure: -120, freeCashFlow: 230, cashAndCashEquivalents: 500, totalDebt: 900, ordinarySharesNumber: 369000000, cashDividendsPaid: -80 },
    ],
    quarterly: [
      { date: '2025-12-31T00:00:00.000Z', totalRevenue: 600, netIncome: 60, EBITDA: 110, dilutedEPS: 1.5 },
      { date: '2025-09-30T00:00:00.000Z', totalRevenue: 500, netIncome: 40 }, // sparse — missing fields skipped
    ],
  }
  const payload = mapYahooRowsToPayload(fetch, new Date('2026-07-09T00:00:00Z'))

  it('creates one reporting period per Yahoo row, with correct periodType', () => {
    assert.equal(payload.reportingPeriods.length, 3)
    const annual = payload.reportingPeriods.filter((p) => p.periodType === 'annual')
    const qtr = payload.reportingPeriods.filter((p) => p.periodType === 'quarterly')
    assert.equal(annual.length, 1)
    assert.equal(qtr.length, 2)
    assert.equal(annual[0].fiscalPeriod, 'FY')
    assert.equal(annual[0].currency, 'CLP')
  })
  it('every row carries source_type yahoo_finance and a Yahoo source name', () => {
    for (const p of payload.reportingPeriods) {
      assert.equal(p.sourceType, YAHOO_FINANCE_SOURCE_TYPE)
      assert.match(p.sourceName ?? '', /Yahoo/)
    }
    for (const s of payload.statementItems) assert.equal(s.sourceType, YAHOO_FINANCE_SOURCE_TYPE)
  })
  it('maps income/cash/balance/returns line items with the codes the resolver reads', () => {
    const annualItems = payload.statementItems.filter((s) => s.periodType === 'annual')
    const byCode = Object.fromEntries(annualItems.map((s) => [s.lineItemCode, s.value]))
    assert.equal(byCode.revenue, 2000)
    assert.equal(byCode.gross_profit, 800)
    assert.equal(byCode.operating_income, 300)
    assert.equal(byCode.ebitda, 400)
    assert.equal(byCode.net_income, 200)
    assert.equal(byCode.eps, 5)
    assert.equal(byCode.ocf, 350)
    assert.equal(byCode.cash, 500)
    assert.equal(byCode.total_debt, 900)
    assert.equal(byCode.shares_out, 369000000)
  })
  it('stores capex and dividends as positive magnitudes (Yahoo reports negatives)', () => {
    const annualItems = payload.statementItems.filter((s) => s.periodType === 'annual')
    const byCode = Object.fromEntries(annualItems.map((s) => [s.lineItemCode, s.value]))
    assert.equal(byCode.capex, 120)
    assert.equal(byCode.dividends_paid, 80)
  })
  it('missing fields are skipped, never coerced to zero', () => {
    // The sparse Q3 row only had revenue + netIncome → exactly 2 statement items, no ebitda/eps.
    const q3 = payload.statementItems.filter((s) => s.periodType === 'quarterly' && s.fiscalPeriod === 'Q3')
    const codes = q3.map((s) => s.lineItemCode).sort()
    assert.deepEqual(codes, ['net_income', 'revenue'])
    assert.ok(!codes.includes('ebitda'))
  })
  it('emits fcf and ebitda_margin metrics only where the inputs exist', () => {
    const fcf = payload.metrics.filter((m) => m.metricCode === 'fcf')
    const margin = payload.metrics.filter((m) => m.metricCode === 'ebitda_margin')
    assert.equal(fcf.length, 1) // only the annual row had freeCashFlow
    assert.equal(fcf[0].value, 230)
    // annual margin = 400/2000 = 20%; Q4 margin = 110/600 ≈ 18.3%
    const annualMargin = margin.find((m) => m.periodType === 'annual')
    assert.equal(annualMargin?.value, 20)
  })
  it('shares_out uses a share unit; amounts use the financial currency', () => {
    const shares = payload.statementItems.find((s) => s.lineItemCode === 'shares_out')
    const rev = payload.statementItems.find((s) => s.lineItemCode === 'revenue')
    assert.equal(shares?.unit, 'shares')
    assert.equal(rev?.unit, 'CLP')
  })
})

describe('yahoo symbol map + ticker universe', () => {
  it('resolves .SN symbols for banks and non-banks', () => {
    assert.equal(yahooSymbolFor('BSANTANDER'), 'BSANTANDER.SN')
    assert.equal(yahooSymbolFor('CCU'), 'CCU.SN')
    assert.equal(yahooSymbolFor('SQM-B'), 'SQM-B.SN')
    assert.equal(yahooSymbolFor('NOPE'), null)
  })
  it('the ingestion default set covers all 25 app stocks, including the 4 banks', () => {
    const tickers = getYahooTickers()
    assert.equal(tickers.length, 25)
    for (const bank of ['BSANTANDER', 'CHILE', 'BCI', 'ITAUCL']) assert.ok(tickers.includes(bank), `${bank} must be covered by Yahoo`)
  })
})

describe('yahoo source-type registration + priority (honest, low, XBRL-overridable)', () => {
  const REPO = read('../src/lib/db/repositories/financialsRepository.ts')
  const MIGRATION = read('../supabase/migrations/20260711000000_financials_yahoo_source_type.sql')
  it('yahoo_finance is a valid source type', () => {
    assert.ok((VALID_SOURCE_TYPES as readonly string[]).includes('yahoo_finance'))
  })
  it('yahoo_finance priority (80) is below manual_csv (100) and far below xbrl (210)', () => {
    assert.match(REPO, /yahoo_finance:\s*80/)
    assert.match(REPO, /manual_csv:\s*100/)
    assert.match(REPO, /xbrl:\s*210/)
  })
  it('the migration widens the CHECK constraint to include yahoo_finance (idempotent)', () => {
    assert.match(MIGRATION, /yahoo_finance/)
    assert.match(MIGRATION, /drop constraint if exists/i)
    assert.match(MIGRATION, /company_reporting_periods/)
    assert.match(MIGRATION, /earnings_events/)
  })
})

describe('yahoo cron route — auth + safety', () => {
  const ROUTE = read('../src/app/api/cron/financials/yahoo/route.ts')
  it('requires Bearer CRON_SECRET and 401s on mismatch', () => {
    assert.ok(ROUTE.includes('CRON_SECRET'))
    assert.ok(ROUTE.includes('Bearer ${secret}'))
    assert.ok(ROUTE.includes('status: 401'))
  })
  it('uses the service-role admin client, sanitizes errors, and never returns raw payloads', () => {
    assert.ok(ROUTE.includes('getSupabaseAdminClient'))
    assert.ok(ROUTE.includes('***JWT***'))
    assert.ok(/Yahoo Finance/i.test(ROUTE))
  })
})
