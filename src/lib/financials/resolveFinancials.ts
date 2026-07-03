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

export interface FinancialsResolveResult {
  ticker: string
  records: FundamentalRecord[]
  status: FinancialsSourceStatus
  source: string
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
    return { ticker: upperTicker, records: [], status: 'static_fallback', source: 'Static MVP sample' }
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

  return { ticker: upperTicker, records, status: 'persisted', source: 'Persisted financials via manual CSV' }
}
