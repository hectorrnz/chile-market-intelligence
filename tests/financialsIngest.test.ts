// Phase 8C — Financial-statement CSV ingestion tests.
//
// Only src/lib/financials/csvFinancials.ts and src/lib/compare/compareStatic.ts
// are imported directly — both have zero transitive Supabase/'@/*'-alias
// imports, so they're safe under plain `node --test` (same constraint as
// compareResolver.test.ts / marketProvider.test.ts). The repository and
// resolvers (financialsRepository.ts, resolveFinancials.ts,
// resolveCompareData.ts) are exercised via code-content hygiene checks
// instead, mirroring the established pattern in this codebase.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseCsvRows,
  validateReportingPeriodRow,
  validateStatementItemRow,
  validateFinancialMetricRow,
  validateEarningsEventRow,
  normalizeTicker,
  normalizePeriod,
  normalizeNumericValue,
  isCoveredTicker,
  buildFinancialImportPayload,
  deriveFinancialMetrics,
  type ParsedCsvRow,
} from '../src/lib/financials/csvFinancials.ts'
import { buildFundamentals, type PersistedFundamentalsInput } from '../src/lib/compare/compareStatic.ts'

const ROOT = join(import.meta.dirname, '..')
const TEMPLATES_DIR = join(ROOT, 'data/import_templates')
const MIGRATION = join(ROOT, 'supabase/migrations/20260704000000_financials_foundation.sql')
const STATUS_DOC = join(ROOT, 'docs/data_source_status.md')
const CHARTING_PAGE = join(ROOT, 'src/app/chart-builder/page.tsx')
const EARNINGS_PAGE = join(ROOT, 'src/app/earnings/page.tsx')
const COMPARE_RESOLVER = join(ROOT, 'src/lib/compare/resolveCompareData.ts')
const FINANCIALS_REPO = join(ROOT, 'src/lib/db/repositories/financialsRepository.ts')
const INGEST_SCRIPT = join(ROOT, 'scripts/ingest/financialsCsv.ts')

function row(cells: Record<string, string>, line = 2): ParsedCsvRow {
  return { line, cells }
}

// ─── Normalization helpers ──────────────────────────────────────────────────────

describe('normalizeTicker / isCoveredTicker', () => {
  it('trims and uppercases', () => {
    assert.equal(normalizeTicker(' sqm-b '), 'SQM-B')
  })
  it('recognizes covered tickers case-insensitively', () => {
    assert.equal(isCoveredTicker('sqm-b'), true)
    assert.equal(isCoveredTicker('NOTREAL'), false)
  })
})

describe('normalizePeriod', () => {
  it('accepts valid fiscal periods case-insensitively', () => {
    assert.equal(normalizePeriod('q1'), 'Q1')
    assert.equal(normalizePeriod('FY'), 'FY')
  })
  it('rejects invalid periods', () => {
    assert.equal(normalizePeriod('Q5'), null)
    assert.equal(normalizePeriod(''), null)
  })
})

describe('normalizeNumericValue', () => {
  it('parses valid numbers', () => {
    assert.equal(normalizeNumericValue('780000'), 780000)
    assert.equal(normalizeNumericValue('-1.5'), -1.5)
  })
  it('empty string -> null, never NaN', () => {
    assert.equal(normalizeNumericValue(''), null)
    assert.equal(normalizeNumericValue('   '), null)
    assert.equal(normalizeNumericValue(undefined), null)
  })
  it('non-numeric text -> null, never NaN', () => {
    assert.equal(normalizeNumericValue('not a number'), null)
  })
  it('never returns Infinity', () => {
    assert.equal(normalizeNumericValue('Infinity'), null)
    assert.equal(normalizeNumericValue('1e400'), null)
  })
})

// ─── CSV parsing ────────────────────────────────────────────────────────────────

describe('parseCsvRows', () => {
  it('parses header + rows with correct 1-indexed line numbers', () => {
    const { header, rows } = parseCsvRows('a,b\n1,2\n3,4\n')
    assert.deepEqual(header, ['a', 'b'])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].line, 2)
    assert.equal(rows[1].line, 3)
    assert.deepEqual(rows[0].cells, { a: '1', b: '2' })
  })

  it('skips blank lines without breaking line numbering', () => {
    const { rows } = parseCsvRows('a,b\n1,2\n\n3,4\n')
    assert.equal(rows.length, 2)
    assert.equal(rows[1].line, 4)
  })

  it('handles quoted fields with embedded commas', () => {
    const { rows } = parseCsvRows('name,value\n"Smith, Jane",100\n')
    assert.equal(rows[0].cells.name, 'Smith, Jane')
  })

  it('returns empty header/rows for empty input', () => {
    const { header, rows } = parseCsvRows('')
    assert.deepEqual(header, [])
    assert.deepEqual(rows, [])
  })
})

// ─── Row validators ─────────────────────────────────────────────────────────────

describe('validateReportingPeriodRow', () => {
  const valid = { ticker: 'SQM-B', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', period_end_date: '2025-03-31', report_date: '2025-05-14', currency: 'CLP' }

  it('accepts a valid row', () => {
    const r = validateReportingPeriodRow(row(valid))
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.ticker, 'SQM-B')
      assert.equal(r.value.fiscalYear, 2025)
      assert.equal(r.value.sourceType, 'manual_csv')
    }
  })

  it('rejects an invalid ticker with a line-numbered error', () => {
    const r = validateReportingPeriodRow(row({ ...valid, ticker: 'NOTREAL' }, 7))
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.error.line, 7)
      assert.match(r.error.reason, /ticker/i)
    }
  })

  it('rejects an invalid fiscal_period', () => {
    const r = validateReportingPeriodRow(row({ ...valid, fiscal_period: 'Q9' }))
    assert.equal(r.ok, false)
  })

  it('rejects an invalid period_end_date', () => {
    const r = validateReportingPeriodRow(row({ ...valid, period_end_date: 'not-a-date' }))
    assert.equal(r.ok, false)
  })

  it('rejects an invalid fiscal_year', () => {
    const r = validateReportingPeriodRow(row({ ...valid, fiscal_year: '1800' }))
    assert.equal(r.ok, false)
  })

  it('allows an empty optional report_date', () => {
    const r = validateReportingPeriodRow(row({ ...valid, report_date: '' }))
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value.reportDate, null)
  })
})

describe('validateStatementItemRow', () => {
  const valid = { ticker: 'SQM-B', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', statement_type: 'income', line_item_code: 'revenue', line_item_name: 'Revenue', value: '780000', unit: 'CLP' }

  it('accepts a valid row', () => {
    const r = validateStatementItemRow(row(valid))
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value.value, 780000)
  })

  it('accepts an empty value as null (e.g. banks with no EBITDA)', () => {
    const r = validateStatementItemRow(row({ ...valid, line_item_code: 'ebitda', value: '' }))
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value.value, null)
  })

  it('rejects an invalid statement_type', () => {
    const r = validateStatementItemRow(row({ ...valid, statement_type: 'bogus' }))
    assert.equal(r.ok, false)
  })

  it('rejects a missing line_item_code', () => {
    const r = validateStatementItemRow(row({ ...valid, line_item_code: '' }))
    assert.equal(r.ok, false)
  })
})

describe('validateFinancialMetricRow', () => {
  it('accepts a valid row', () => {
    const r = validateFinancialMetricRow(row({ ticker: 'SQM-B', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', metric_code: 'ebitda_margin', metric_name: 'EBITDA Margin', value: '25', unit: '%' }))
    assert.equal(r.ok, true)
  })
  it('rejects an invalid ticker', () => {
    const r = validateFinancialMetricRow(row({ ticker: 'FAKE', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', metric_code: 'x', metric_name: 'x', value: '1' }))
    assert.equal(r.ok, false)
  })
})

describe('validateEarningsEventRow', () => {
  it('accepts a reported row', () => {
    const r = validateEarningsEventRow(row({ ticker: 'SQM-B', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', report_date: '2025-05-14', event_date: '2025-05-14', status: 'reported', revenue: '780000', ebitda: '195000', net_income: '115000', eps: '405', currency: 'CLP' }))
    assert.equal(r.ok, true)
  })

  it('accepts an "expected" (upcoming) row with blank financials', () => {
    const r = validateEarningsEventRow(row({ ticker: 'COPEC', fiscal_year: '2025', fiscal_period: 'Q2', period_type: 'quarterly', report_date: '', event_date: '2025-08-07', status: 'expected', revenue: '', ebitda: '', net_income: '', eps: '' }))
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.value.status, 'expected')
      assert.equal(r.value.revenue, null)
    }
  })

  it('rejects an invalid status', () => {
    const r = validateEarningsEventRow(row({ ticker: 'SQM-B', status: 'bogus' }))
    assert.equal(r.ok, false)
  })

  it('rejects an invalid event_date', () => {
    const r = validateEarningsEventRow(row({ ticker: 'SQM-B', event_date: 'not-a-date' }))
    assert.equal(r.ok, false)
  })
})

// ─── Payload builder ─────────────────────────────────────────────────────────────

describe('buildFinancialImportPayload', () => {
  it('validates the real template CSVs with zero errors', () => {
    const reportingPeriodRows = parseCsvRows(readFileSync(join(TEMPLATES_DIR, 'financial_reporting_periods.template.csv'), 'utf8')).rows
    const statementItemRows = parseCsvRows(readFileSync(join(TEMPLATES_DIR, 'financial_statement_items.template.csv'), 'utf8')).rows
    const metricRows = parseCsvRows(readFileSync(join(TEMPLATES_DIR, 'financial_metrics.template.csv'), 'utf8')).rows
    const earningsEventRows = parseCsvRows(readFileSync(join(TEMPLATES_DIR, 'earnings_events.template.csv'), 'utf8')).rows

    const payload = buildFinancialImportPayload({ reportingPeriodRows, statementItemRows, metricRows, earningsEventRows })
    assert.deepEqual(payload.errors, [])
    assert.equal(payload.reportingPeriods.length, 3)
    assert.equal(payload.statementItems.length, 54)
    assert.equal(payload.metrics.length, 2)
    assert.equal(payload.earningsEvents.length, 4)
  })

  it('collects errors with line numbers across mixed valid/invalid rows', () => {
    const rows: ParsedCsvRow[] = [
      row({ ticker: 'SQM-B', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', period_end_date: '2025-03-31' }, 2),
      row({ ticker: 'BOGUS', fiscal_year: '2025', fiscal_period: 'Q1', period_type: 'quarterly', period_end_date: '2025-03-31' }, 3),
    ]
    const payload = buildFinancialImportPayload({ reportingPeriodRows: rows })
    assert.equal(payload.reportingPeriods.length, 1)
    assert.equal(payload.errors.length, 1)
    assert.equal(payload.errors[0].line, 3)
  })
})

// ─── Derived metrics ────────────────────────────────────────────────────────────

describe('deriveFinancialMetrics', () => {
  const base = { ticker: 'SQM-B', fiscalYear: 2025, fiscalPeriod: 'Q1' as const, periodType: 'quarterly' as const }

  it('derives ebitda_margin, gross_margin, op_margin, fcf, net_debt, net_debt_ebitda', () => {
    const itemsByCode = new Map<string, number | null>([
      ['revenue', 100], ['ebitda', 25], ['gross_profit', 40], ['operating_income', 20],
      ['ocf', 30], ['capex', 10], ['total_debt', 200], ['cash', 50],
    ])
    const rows = deriveFinancialMetrics({ ...base, itemsByCode })
    const byCode = Object.fromEntries(rows.map((r) => [r.metricCode, r.value]))
    assert.equal(byCode.ebitda_margin, 25)
    assert.equal(byCode.gross_margin, 40)
    assert.equal(byCode.op_margin, 20)
    assert.equal(byCode.fcf, 20)
    assert.equal(byCode.net_debt, 150)
    assert.equal(byCode.net_debt_ebitda, 6)
    for (const r of rows) assert.equal(r.sourceType, 'derived')
  })

  it('skips a ratio when its inputs are missing, never emits NaN/Infinity', () => {
    const itemsByCode = new Map<string, number | null>([['revenue', 0], ['ebitda', 25]])
    const rows = deriveFinancialMetrics({ ...base, itemsByCode })
    assert.equal(rows.find((r) => r.metricCode === 'ebitda_margin'), undefined)
    for (const r of rows) assert.ok(Number.isFinite(r.value))
  })

  it('handles a bank-like ticker with null EBITDA gracefully', () => {
    const itemsByCode = new Map<string, number | null>([['revenue', 410000], ['ebitda', null], ['total_debt', 0], ['cash', 2100000]])
    const rows = deriveFinancialMetrics({ ...base, itemsByCode })
    assert.equal(rows.find((r) => r.metricCode === 'ebitda_margin'), undefined)
    assert.equal(rows.find((r) => r.metricCode === 'net_debt_ebitda'), undefined)
    const netDebt = rows.find((r) => r.metricCode === 'net_debt')
    assert.equal(netDebt?.value, -2100000)
  })
})

// ─── Compare fundamentals: derived vs temporary_static ────────────────────────

describe('buildFundamentals (Compare, Phase 8C derivation)', () => {
  it('falls back to static fields with an empty derivedFields list when nothing persisted', () => {
    const f = buildFundamentals({ ticker: 'SQM-B', peFwd: 12.9, dividendYield: 8.1 })
    assert.deepEqual(f.derivedFields, [])
    assert.equal(f.pe, 12.9)
    assert.equal(f.conversionPath.includes('Phase 8C'), true)
  })

  it('derives P/E from persisted EPS + market price, marking the field', () => {
    const persisted: PersistedFundamentalsInput = { epsClp: 405 }
    const f = buildFundamentals(undefined, 68164, null, persisted)
    assert.ok(f.pe !== null && Math.abs(f.pe - 68164 / 405) < 1e-9)
    assert.ok(f.derivedFields.includes('pe'))
  })

  it('derives EV/EBITDA from net debt + EBITDA + market cap', () => {
    const persisted: PersistedFundamentalsInput = { netDebtMM: 520000, ebitdaMM: 195000 }
    const f = buildFundamentals(undefined, null, 12000000, persisted)
    assert.ok(f.evEbitda !== null)
    assert.ok(f.derivedFields.includes('evEbitda'))
  })

  it('derives dividend yield from dividends paid + shares out + price', () => {
    const persisted: PersistedFundamentalsInput = { dividendsPaidMM: 40000, sharesOutMM: 284 }
    const f = buildFundamentals(undefined, 68164, null, persisted)
    assert.ok(f.dividendYield !== null)
    assert.ok(f.derivedFields.includes('dividendYield'))
  })

  it('never derives psFwd/roe/pb (no forward estimates or book value imported)', () => {
    const persisted: PersistedFundamentalsInput = { epsClp: 405, netDebtMM: 100, ebitdaMM: 50, fcfMM: 10, dividendsPaidMM: 1, sharesOutMM: 1 }
    const f = buildFundamentals(undefined, 100, 1000, persisted)
    assert.ok(!f.derivedFields.includes('psFwd'))
    assert.ok(!f.derivedFields.includes('roe'))
    assert.ok(!f.derivedFields.includes('pb'))
  })

  it('never produces NaN/Infinity even with a zero-division edge case', () => {
    const persisted: PersistedFundamentalsInput = { epsClp: 0, ebitdaMM: 0, sharesOutMM: 0 }
    const f = buildFundamentals(undefined, 100, 1000, persisted)
    assert.equal(f.pe, null)
    assert.ok(!f.derivedFields.includes('pe'))
  })
})

// ─── Source labels / documentation / hygiene ──────────────────────────────────

describe('Phase 8C source labels and hygiene', () => {
  it('data source registry defines persisted financials/earnings labels', () => {
    const src = readFileSync(join(ROOT, 'src/lib/dataSourceRegistry.ts'), 'utf8')
    assert.ok(src.includes('financialsPersisted'))
    assert.ok(src.includes('financialsDerived'))
    assert.ok(src.includes('earningsPersisted'))
  })

  it('Charting page wires persisted financials with a source badge', () => {
    const src = readFileSync(CHARTING_PAGE, 'utf8')
    assert.ok(src.includes('fetchFinancialStatements'))
    assert.ok(src.includes('SourceStateBadge'))
  })

  it('Earnings page never shows a fabricated surprise/consensus for persisted rows', () => {
    const src = readFileSync(EARNINGS_PAGE, 'utf8')
    assert.ok(src.includes('noEstimates'))
    assert.ok(src.includes('isPersisted'))
  })

  it('Compare resolver still wires market data via marketProvider (no regression)', () => {
    const src = readFileSync(COMPARE_RESOLVER, 'utf8')
    assert.ok(src.includes('resolveStockSnapshots'))
    assert.ok(src.includes('resolveStockHistory'))
    assert.ok(src.includes('getLatestFinancialMetrics'))
  })

  it('financialsRepository sanitizes errors and never logs raw Supabase error objects', () => {
    const src = readFileSync(FINANCIALS_REPO, 'utf8')
    assert.ok(src.includes('sanitizeError'))
    assert.ok(!/console\.(log|warn|error)\(.*res\.error\)/.test(src))
  })

  it('ingestion script records ingestion_runs with the correct provider/job_type/version', () => {
    const src = readFileSync(INGEST_SCRIPT, 'utf8')
    assert.ok(src.includes("PROVIDER = 'Manual CSV'"))
    assert.ok(src.includes("JOB_TYPE = 'financials_csv_import'"))
    assert.ok(src.includes("INGESTION_VERSION = '8C'"))
    assert.ok(src.includes('rows_seen'))
    assert.ok(src.includes('rows_inserted'))
    assert.ok(src.includes('rows_failed'))
  })

  it('ingestion script never writes without --write and validates before writing', () => {
    const src = readFileSync(INGEST_SCRIPT, 'utf8')
    assert.ok(src.includes('isDryRun'))
    assert.ok(src.includes('allowPartial'))
  })

  it('migration grants public read but no public write policy on all 4 tables', () => {
    const src = readFileSync(MIGRATION, 'utf8')
    for (const table of ['company_reporting_periods', 'financial_statement_items', 'financial_metrics', 'earnings_events']) {
      assert.ok(src.includes(`create policy "${table}: anon read" on ${table} for select using (true);`), `missing anon-read policy for ${table}`)
    }
    assert.ok(!src.includes('for insert'), 'migration must not grant a public insert policy')
    assert.ok(!src.includes('for update'), 'migration must not grant a public update policy')
  })

  it('data_source_status.md documents the Phase 8C wiring for Charting/Compare/Earnings', () => {
    const src = readFileSync(STATUS_DOC, 'utf8')
    assert.ok(/Phase 8C/.test(src))
  })

  it('no private/real CSV files are tracked — only .template.csv files exist', () => {
    const files = readdirSync(TEMPLATES_DIR)
    for (const f of files) assert.ok(f.endsWith('.template.csv'), `unexpected non-template file in import_templates: ${f}`)
  })
})
