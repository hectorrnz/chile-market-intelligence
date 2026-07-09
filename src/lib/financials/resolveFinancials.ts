// Phase 8C — Server-only resolver: builds FundamentalRecord[]-shaped series
// from persisted financial_statement_items/financial_metrics, so existing
// Charting aggregation logic (quarterly/TTM/annual) works unchanged whether
// the data came from Supabase or the static fundamentals.json fallback.

import {
  getStatementItems,
  getFinancialMetrics,
  type StatementItemRecord,
  type FinancialMetricRecord,
} from '../db/repositories/financialsRepository.ts'
import type { FundamentalRecord } from '../data/fundamentals.ts'

export type FinancialsSourceStatus = 'persisted' | 'static_fallback'

/** The dominant source_type behind a persisted result, so the UI can label XBRL vs manual CSV vs Yahoo honestly. */
export type FinancialsSourceType = 'xbrl' | 'cmf_fecu' | 'cmf_bank' | 'manual_csv' | 'yahoo_finance' | 'mixed' | 'none'

export interface FinancialsResolveResult {
  ticker: string
  records: FundamentalRecord[]
  status: FinancialsSourceStatus
  source: string
  /** Which persisted source_type dominates (drives the source badge). */
  sourceType: FinancialsSourceType
}

/**
 * Human-readable source label + the most-authoritative source_type present,
 * from the statement items backing a result. When a ticker has more than one
 * source (e.g. some periods manual CSV, some automated CMF XBRL during a
 * transition), the label reflects the HIGHEST-priority source present — XBRL is
 * the preferred/authoritative automated source, so its presence is surfaced
 * rather than hidden behind a "manual CSV" or vague "mixed" label. `sourceType:
 * 'mixed'` is still returned when genuinely more than one non-derived source
 * exists, so a caller can show a "+ manual" nuance if it wants.
 */
export function summarizeSource(items: StatementItemRecord[]): { source: string; sourceType: FinancialsSourceType } {
  if (items.length === 0) return { source: 'Static MVP sample', sourceType: 'none' }
  const present = new Set(items.map((it) => it.sourceType).filter((k) => k !== 'derived'))
  const hasXbrl = present.has('xbrl')
  const hasFecu = present.has('cmf_fecu')
  const hasCmfBank = present.has('cmf_bank')
  const hasYahoo = present.has('yahoo_finance')
  const hasManual = present.has('manual_csv')
  // Phase 8C.5 — most common real case: CMF/XBRL official annual + Yahoo
  // quarterly for the same ticker. Surface the authoritative source, with a
  // nuance for the others actually present (never a blanket "manual").
  const extras = [hasYahoo && 'Yahoo', hasManual && 'manual'].filter(Boolean).join(' + ')
  const suffix = extras ? ` (+ ${extras})` : ''
  if (hasXbrl) return { source: `Persisted financials via CMF XBRL${suffix}`, sourceType: 'xbrl' }
  if (hasFecu) return { source: `Persisted financials via CMF/FECU${suffix}`, sourceType: 'cmf_fecu' }
  // Phase 8C.8 — official CMF bank regulatory data (NOT XBRL, a distinct
  // source/track — see docs/bank_financials_ingestion.md). Labeled separately
  // from the non-bank "CMF XBRL" badge so a bank ticker's official annual
  // fields are never mistaken for the industrial XBRL pipeline.
  if (hasCmfBank) return { source: `Official CMF bank regulatory filing${suffix}`, sourceType: 'cmf_bank' }
  if (hasManual) return { source: `Persisted financials via manual CSV${hasYahoo ? ' (+ Yahoo)' : ''}`, sourceType: 'manual_csv' }
  if (hasYahoo) return { source: 'Fundamentals via Yahoo Finance (unofficial)', sourceType: 'yahoo_finance' }
  return { source: 'Persisted financials', sourceType: 'manual_csv' }
}

function periodLabel(fiscalPeriod: string, fiscalYear: number): string {
  return fiscalPeriod === 'FY' ? `FY ${fiscalYear}` : `${fiscalPeriod} ${fiscalYear}`
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Resolves persisted financials for a ticker into the exact FundamentalRecord
 * shape the Charting page already knows how to aggregate/render. Falls back
 * to signalling `static_fallback` (empty records) when nothing is imported —
 * callers merge in the static JSON themselves so the fallback path never
 * changes.
 */
export async function resolveFinancialStatements(ticker: string): Promise<FinancialsResolveResult> {
  const upperTicker = ticker.toUpperCase()
  const [items, metrics] = await Promise.all([getStatementItems(upperTicker), getFinancialMetrics(upperTicker)])

  if (items.length === 0) {
    return { ticker: upperTicker, records: [], status: 'static_fallback', source: 'Static MVP sample', sourceType: 'none' }
  }

  const periodKey = (r: { fiscalYear: number; fiscalPeriod: string; periodType: string }) =>
    `${r.fiscalYear}|${r.fiscalPeriod}|${r.periodType}`

  const itemsByPeriod = new Map<string, Map<string, StatementItemRecord>>()
  for (const item of items) {
    const key = periodKey(item)
    let m = itemsByPeriod.get(key)
    if (!m) { m = new Map(); itemsByPeriod.set(key, m) }
    m.set(item.lineItemCode, item)
  }

  const metricsByPeriod = new Map<string, Map<string, FinancialMetricRecord>>()
  for (const metric of metrics) {
    const key = periodKey(metric)
    let m = metricsByPeriod.get(key)
    if (!m) { m = new Map(); metricsByPeriod.set(key, m) }
    const existing = m.get(metric.metricCode)
    if (!existing || (existing.sourceType === 'derived' && metric.sourceType === 'manual_csv')) {
      m.set(metric.metricCode, metric)
    }
  }

  const periodMeta = new Map<string, { fiscalYear: number; fiscalPeriod: string; periodType: string; periodEndDate: string }>()
  for (const item of items) periodMeta.set(periodKey(item), item)

  const records: FundamentalRecord[] = Array.from(periodMeta.entries())
    .sort(([, a], [, b]) => a.periodEndDate.localeCompare(b.periodEndDate))
    .map(([key, meta]) => {
      const codeMap = itemsByPeriod.get(key) ?? new Map()
      const metricMap = metricsByPeriod.get(key) ?? new Map()
      const get = (code: string) => codeMap.get(code)?.value ?? null
      return {
        ticker: upperTicker,
        period: periodLabel(meta.fiscalPeriod, meta.fiscalYear),
        reportDate: meta.periodEndDate,
        revenue: num(get('revenue')),
        ebitda: numOrNull(get('ebitda')),
        grossProfit: num(get('gross_profit')),
        operatingIncome: num(get('operating_income')),
        netIncome: num(get('net_income')),
        rdExpense: num(get('rd_expense')),
        sgaExpense: num(get('sga_expense')),
        sbcExpense: num(get('sbc_expense')),
        depAmort: num(get('dep_amort')),
        eps: numOrNull(get('eps')),
        ebitdaMargin: numOrNull(metricMap.get('ebitda_margin')?.value),
        revenueYoY: null,
        netIncomeYoY: null,
        fcf: num(metricMap.get('fcf')?.value),
        ocf: num(get('ocf')),
        capex: num(get('capex')),
        cash: num(get('cash')),
        ltDebt: num(get('total_debt')),
        sharesOut: numOrNull(get('shares_out')),
        dividendsPaid: num(get('dividends_paid')),
        buybacks: num(get('buybacks')),
      }
    })

  const { source, sourceType } = summarizeSource(items)
  return { ticker: upperTicker, records, status: 'persisted', source, sourceType }
}
