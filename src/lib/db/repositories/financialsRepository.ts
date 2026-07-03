// Phase 8C — Financials repository (company_reporting_periods,
// financial_statement_items, financial_metrics, earnings_events).
// Reads use the public/anon server client (RLS: "anon read" on all four
// tables — same pattern as macro_indicators/stock_snapshots/cmf_filings).
// Writes use the admin client (bypasses RLS) and are only ever called from
// scripts/ingest/financialsCsv.ts, never from a request handler triggered by
// user input.

import type {
  ReportingPeriodImportRow,
  StatementItemImportRow,
  FinancialMetricImportRow,
  EarningsEventImportRow,
  DerivedMetricRow,
} from '../../financials/csvFinancials.ts'

function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***')
    .replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***')
    .slice(0, 300)
}

function periodKey(ticker: string, fiscalYear: number, fiscalPeriod: string, periodType: string): string {
  return `${ticker}|${fiscalYear}|${fiscalPeriod}|${periodType}`
}

export interface UpsertResult {
  inserted: number
  errors: string[]
}

// ─── Write path (admin client, called only from the ingestion script) ────────

export interface ReportingPeriodUpsertResult extends UpsertResult {
  /** Maps "ticker|fiscalYear|fiscalPeriod|periodType" -> reporting_period_id, for child-row mapping. */
  idsByKey: Map<string, string>
}

export async function upsertReportingPeriods(
  rows: ReportingPeriodImportRow[],
): Promise<ReportingPeriodUpsertResult> {
  const idsByKey = new Map<string, string>()
  if (rows.length === 0) return { inserted: 0, errors: [], idsByKey }

  const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
  const db = getSupabaseAdminClient()
  if (!db) return { inserted: 0, errors: ['Admin Supabase client not configured'], idsByKey }

  const payload = rows.map((r) => ({
    ticker: r.ticker,
    fiscal_year: r.fiscalYear,
    fiscal_period: r.fiscalPeriod,
    period_type: r.periodType,
    period_end_date: r.periodEndDate,
    report_date: r.reportDate,
    currency: r.currency,
    source_type: r.sourceType,
    source_name: r.sourceName,
    source_url: r.sourceUrl,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('company_reporting_periods')
    .upsert(payload, { onConflict: 'ticker,fiscal_year,fiscal_period,period_type,source_type' })
    .select('id, ticker, fiscal_year, fiscal_period, period_type')

  if (res.error) return { inserted: 0, errors: [sanitizeError(res.error)], idsByKey }

  const data = (res.data ?? []) as Array<{ id: string; ticker: string; fiscal_year: number; fiscal_period: string; period_type: string }>
  for (const row of data) {
    idsByKey.set(periodKey(row.ticker, row.fiscal_year, row.fiscal_period, row.period_type), row.id)
  }
  return { inserted: data.length, errors: [], idsByKey }
}

export async function upsertStatementItems(
  rows: StatementItemImportRow[],
  idsByKey: Map<string, string>,
): Promise<UpsertResult> {
  if (rows.length === 0) return { inserted: 0, errors: [] }
  const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
  const db = getSupabaseAdminClient()
  if (!db) return { inserted: 0, errors: ['Admin Supabase client not configured'] }

  const errors: string[] = []
  const payload: Record<string, unknown>[] = []
  for (const r of rows) {
    const reportingPeriodId = idsByKey.get(periodKey(r.ticker, r.fiscalYear, r.fiscalPeriod, r.periodType))
    if (!reportingPeriodId) {
      errors.push(`no reporting period found for ${r.ticker} ${r.fiscalYear} ${r.fiscalPeriod} ${r.periodType} (line item ${r.lineItemCode})`)
      continue
    }
    payload.push({
      reporting_period_id: reportingPeriodId,
      ticker: r.ticker,
      statement_type: r.statementType,
      line_item_code: r.lineItemCode,
      line_item_name: r.lineItemName,
      value: r.value,
      unit: r.unit,
      scale: r.scale,
      source_type: r.sourceType,
    })
  }
  if (payload.length === 0) return { inserted: 0, errors }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('financial_statement_items')
    .upsert(payload, { onConflict: 'reporting_period_id,statement_type,line_item_code,source_type' })
    .select('id')

  if (res.error) return { inserted: 0, errors: [...errors, sanitizeError(res.error)] }
  return { inserted: (res.data ?? []).length, errors }
}

export async function upsertFinancialMetrics(
  rows: (FinancialMetricImportRow | DerivedMetricRow)[],
  idsByKey: Map<string, string>,
): Promise<UpsertResult> {
  if (rows.length === 0) return { inserted: 0, errors: [] }
  const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
  const db = getSupabaseAdminClient()
  if (!db) return { inserted: 0, errors: ['Admin Supabase client not configured'] }

  const errors: string[] = []
  const payload: Record<string, unknown>[] = []
  for (const r of rows) {
    const reportingPeriodId = idsByKey.get(periodKey(r.ticker, r.fiscalYear, r.fiscalPeriod, r.periodType))
    if (!reportingPeriodId) {
      errors.push(`no reporting period found for ${r.ticker} ${r.fiscalYear} ${r.fiscalPeriod} ${r.periodType} (metric ${r.metricCode})`)
      continue
    }
    payload.push({
      reporting_period_id: reportingPeriodId,
      ticker: r.ticker,
      metric_code: r.metricCode,
      metric_name: r.metricName,
      value: r.value,
      unit: r.unit,
      source_type: r.sourceType,
      calculation_method: 'calculationMethod' in r ? r.calculationMethod : null,
    })
  }
  if (payload.length === 0) return { inserted: 0, errors }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('financial_metrics')
    .upsert(payload, { onConflict: 'reporting_period_id,metric_code,source_type' })
    .select('id')

  if (res.error) return { inserted: 0, errors: [...errors, sanitizeError(res.error)] }
  return { inserted: (res.data ?? []).length, errors }
}

export async function upsertEarningsEvents(
  rows: EarningsEventImportRow[],
  idsByKey: Map<string, string>,
): Promise<UpsertResult> {
  if (rows.length === 0) return { inserted: 0, errors: [] }
  const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
  const db = getSupabaseAdminClient()
  if (!db) return { inserted: 0, errors: ['Admin Supabase client not configured'] }

  const payload = rows.map((r) => {
    const reportingPeriodId =
      r.fiscalYear && r.fiscalPeriod && r.periodType
        ? idsByKey.get(periodKey(r.ticker, r.fiscalYear, r.fiscalPeriod, r.periodType)) ?? null
        : null
    return {
      ticker: r.ticker,
      fiscal_year: r.fiscalYear,
      fiscal_period: r.fiscalPeriod,
      period_type: r.periodType,
      report_date: r.reportDate,
      event_date: r.eventDate,
      status: r.status,
      revenue: r.revenue,
      ebitda: r.ebitda,
      net_income: r.netIncome,
      eps: r.eps,
      currency: r.currency,
      source_type: r.sourceType,
      source_name: r.sourceName,
      source_url: r.sourceUrl,
      reporting_period_id: reportingPeriodId,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('earnings_events')
    .upsert(payload, { onConflict: 'ticker,fiscal_year,fiscal_period,source_type' })
    .select('id')

  if (res.error) return { inserted: 0, errors: [sanitizeError(res.error)] }
  return { inserted: (res.data ?? []).length, errors: [] }
}

// ─── Read path (public/anon client — every table has an "anon read" policy) ──

export interface ReportingPeriodRecord {
  id: string
  ticker: string
  fiscalYear: number
  fiscalPeriod: string
  periodType: string
  periodEndDate: string
  reportDate: string | null
  currency: string
  sourceType: string
}

export interface StatementItemRecord {
  ticker: string
  reportingPeriodId: string
  fiscalYear: number
  fiscalPeriod: string
  periodType: string
  periodEndDate: string
  statementType: string
  lineItemCode: string
  lineItemName: string
  value: number | null
  unit: string
  sourceType: string
}

export interface FinancialMetricRecord {
  ticker: string
  reportingPeriodId: string
  fiscalYear: number
  fiscalPeriod: string
  periodType: string
  periodEndDate: string
  metricCode: string
  metricName: string
  value: number | null
  unit: string | null
  sourceType: string
  calculationMethod: string | null
}

export interface EarningsEventRecord {
  id: string
  ticker: string
  fiscalYear: number | null
  fiscalPeriod: string | null
  periodType: string | null
  reportDate: string | null
  eventDate: string | null
  status: string
  revenue: number | null
  ebitda: number | null
  netIncome: number | null
  eps: number | null
  currency: string | null
  sourceType: string
  sourceName: string | null
}

async function getReadClient() {
  const { getSupabaseServerClient } = await import('../../supabase/server.ts')
  return getSupabaseServerClient()
}

/** All reporting periods for a ticker, most recent period_end_date first. */
export async function getReportingPeriods(ticker: string): Promise<ReportingPeriodRecord[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('company_reporting_periods')
    .select('id, ticker, fiscal_year, fiscal_period, period_type, period_end_date, report_date, currency, source_type')
    .eq('ticker', ticker.toUpperCase())
    .order('period_end_date', { ascending: false })
  if (res.error || !res.data) return []
  return (res.data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    ticker: r.ticker as string,
    fiscalYear: r.fiscal_year as number,
    fiscalPeriod: r.fiscal_period as string,
    periodType: r.period_type as string,
    periodEndDate: r.period_end_date as string,
    reportDate: (r.report_date as string) ?? null,
    currency: r.currency as string,
    sourceType: r.source_type as string,
  }))
}

/** All statement line items for a ticker across every imported period, newest first. */
export async function getStatementItems(ticker: string): Promise<StatementItemRecord[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('financial_statement_items')
    .select('ticker, reporting_period_id, statement_type, line_item_code, line_item_name, value, unit, source_type, company_reporting_periods(fiscal_year, fiscal_period, period_type, period_end_date)')
    .eq('ticker', ticker.toUpperCase())
  if (res.error || !res.data) return []
  const mapped: (StatementItemRecord | null)[] = (res.data as Array<Record<string, unknown>>).map((r) => {
    const period = r.company_reporting_periods as Record<string, unknown> | null
    if (!period) return null
    const record: StatementItemRecord = {
      ticker: r.ticker as string,
      reportingPeriodId: r.reporting_period_id as string,
      fiscalYear: period.fiscal_year as number,
      fiscalPeriod: period.fiscal_period as string,
      periodType: period.period_type as string,
      periodEndDate: period.period_end_date as string,
      statementType: r.statement_type as string,
      lineItemCode: r.line_item_code as string,
      lineItemName: r.line_item_name as string,
      value: (r.value as number) ?? null,
      unit: r.unit as string,
      sourceType: r.source_type as string,
    }
    return record
  })
  const filtered: StatementItemRecord[] = mapped.filter((r): r is StatementItemRecord => r !== null)
  return filtered.sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))
}

/** All financial metrics (manual + derived) for a ticker across every imported period. */
export async function getFinancialMetrics(ticker: string): Promise<FinancialMetricRecord[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('financial_metrics')
    .select('ticker, reporting_period_id, metric_code, metric_name, value, unit, source_type, calculation_method, company_reporting_periods(fiscal_year, fiscal_period, period_type, period_end_date)')
    .eq('ticker', ticker.toUpperCase())
  if (res.error || !res.data) return []
  const mapped: (FinancialMetricRecord | null)[] = (res.data as Array<Record<string, unknown>>).map((r) => {
    const period = r.company_reporting_periods as Record<string, unknown> | null
    if (!period) return null
    const record: FinancialMetricRecord = {
      ticker: r.ticker as string,
      reportingPeriodId: r.reporting_period_id as string,
      fiscalYear: period.fiscal_year as number,
      fiscalPeriod: period.fiscal_period as string,
      periodType: period.period_type as string,
      periodEndDate: period.period_end_date as string,
      metricCode: r.metric_code as string,
      metricName: r.metric_name as string,
      value: (r.value as number) ?? null,
      unit: (r.unit as string) ?? null,
      sourceType: r.source_type as string,
      calculationMethod: (r.calculation_method as string) ?? null,
    }
    return record
  })
  const filtered: FinancialMetricRecord[] = mapped.filter((r): r is FinancialMetricRecord => r !== null)
  return filtered.sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))
}

/**
 * Latest reporting period's metrics for a ticker, keyed by metric_code.
 * Manual CSV values take precedence over derived values for the same code+period.
 */
export async function getLatestFinancialMetrics(ticker: string): Promise<Map<string, FinancialMetricRecord>> {
  const all = await getFinancialMetrics(ticker)
  if (all.length === 0) return new Map()
  const latestPeriodEnd = all[0].periodEndDate
  const latest = all.filter((m) => m.periodEndDate === latestPeriodEnd)
  const byCode = new Map<string, FinancialMetricRecord>()
  for (const m of latest) {
    const existing = byCode.get(m.metricCode)
    if (!existing || (existing.sourceType === 'derived' && m.sourceType === 'manual_csv')) {
      byCode.set(m.metricCode, m)
    }
  }
  return byCode
}

/** Latest reporting period's statement items for a ticker, keyed by line_item_code. */
export async function getLatestStatementItems(ticker: string): Promise<Map<string, StatementItemRecord>> {
  const all = await getStatementItems(ticker)
  if (all.length === 0) return new Map()
  const latestPeriodEnd = all[0].periodEndDate
  const byCode = new Map<string, StatementItemRecord>()
  for (const item of all) {
    if (item.periodEndDate === latestPeriodEnd) byCode.set(item.lineItemCode, item)
  }
  return byCode
}

/** Earnings events for a single ticker, or every persisted event when `ticker` is omitted. */
export async function getEarningsEvents(ticker?: string): Promise<EarningsEventRecord[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any)
    .from('earnings_events')
    .select('id, ticker, fiscal_year, fiscal_period, period_type, report_date, event_date, status, revenue, ebitda, net_income, eps, currency, source_type, source_name')
    .order('report_date', { ascending: false, nullsFirst: false })
  if (ticker) query = query.eq('ticker', ticker.toUpperCase())
  const res = await query
  if (res.error || !res.data) return []
  return (res.data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    ticker: r.ticker as string,
    fiscalYear: (r.fiscal_year as number) ?? null,
    fiscalPeriod: (r.fiscal_period as string) ?? null,
    periodType: (r.period_type as string) ?? null,
    reportDate: (r.report_date as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    status: r.status as string,
    revenue: (r.revenue as number) ?? null,
    ebitda: (r.ebitda as number) ?? null,
    netIncome: (r.net_income as number) ?? null,
    eps: (r.eps as number) ?? null,
    currency: (r.currency as string) ?? null,
    sourceType: r.source_type as string,
    sourceName: (r.source_name as string) ?? null,
  }))
}

/** Distinct tickers with at least one persisted reporting period — drives fallback decisions. */
export async function getFinancialsCoverage(): Promise<{ ticker: string; reportingPeriodCount: number; latestPeriodEnd: string | null }[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('company_reporting_periods')
    .select('ticker, period_end_date')
  if (res.error || !res.data) return []
  const byTicker = new Map<string, { count: number; latest: string }>()
  for (const row of res.data as Array<{ ticker: string; period_end_date: string }>) {
    const existing = byTicker.get(row.ticker)
    if (!existing) byTicker.set(row.ticker, { count: 1, latest: row.period_end_date })
    else {
      existing.count += 1
      if (row.period_end_date > existing.latest) existing.latest = row.period_end_date
    }
  }
  return Array.from(byTicker.entries())
    .map(([ticker, v]) => ({ ticker, reportingPeriodCount: v.count, latestPeriodEnd: v.latest }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
}
