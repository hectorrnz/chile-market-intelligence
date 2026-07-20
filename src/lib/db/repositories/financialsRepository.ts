// Phase 8C — Financials repository (company_reporting_periods,
// financial_statement_items, financial_metrics, earnings_events).
// Reads use the public/anon server client (RLS: "anon read" on all four
// tables — same pattern as macro_indicators/stock_snapshots/cmf_filings).
// Writes use the admin client (bypasses RLS) and are only ever called from
// scripts/ingest/financialsCsv.ts, never from a request handler triggered by
// user input.
//
// AUTOMATION-FIRST: every write function accepts `sourceType` from the
// caller's row data — nothing here is hardcoded to manual_csv. A future
// automated ingestion script (CMF/FECU parser, XBRL parser, vendor/broker
// feed) reuses these exact same upsert functions, just passing a different
// source_type. `source_priority` is derived from source_type via
// DEFAULT_SOURCE_PRIORITY below (never guessed row-by-row), and the
// supersession step (`reconcileSupersededPeriods`/`reconcileSupersededEarnings`)
// automatically demotes a lower-priority row for the same logical period
// once a higher-priority source supplies it — so an automated source
// naturally supersedes a manual_csv entry without any code change here.

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

/**
 * Suggested source-priority convention (see migration header comment) —
 * applied automatically from source_type so no ingestion caller has to pick
 * a number. Higher = more authoritative; ties broken by most recent write.
 */
const DEFAULT_SOURCE_PRIORITY: Record<string, number> = {
  static_seed: 10,
  derived: 50,
  // Phase 8C.5 — Yahoo Finance is an UNOFFICIAL free aggregator (same status as
  // the app's Yahoo prices), so it sits deliberately below manual curation and
  // every official/vendor source, but above derived/static. This makes CMF/XBRL
  // annual (210) supersede Yahoo annual for the same FY, while Yahoo quarterly
  // (a different logical period) always shows.
  yahoo_finance: 80,
  manual_csv: 100,
  document_ingestion: 120,
  broker_feed: 140,
  vendor_feed: 150,
  // Phase 8C.8 — cmf_bank is CMF's OFFICIAL bank regulatory feed ("Balance y
  // Estado de Situación Bancos", Phase 8C.7 discovery) for the 4 bank tickers
  // non-bank xbrl structurally cannot reach. It outranks yahoo_finance (an
  // unofficial aggregator) and manual_csv/vendor_feed/broker_feed (third-party
  // or human-curated), because it comes directly from the regulator — but it
  // sits below cmf_fecu/xbrl (200/210) because it is a lower-detail regulatory
  // report (14 mapped fields) than a full audited annual IFRS statement. This
  // makes cmf_bank annual supersede Yahoo's matching annual period for the 14
  // mapped fields only; Yahoo remains active for bank quarterly/TTM/earlier
  // years/unmapped fields (a different logical period or field, never wiped).
  cmf_bank: 180,
  cmf_fecu: 200,
  xbrl: 210,
}

function priorityFor(sourceType: string): number {
  return DEFAULT_SOURCE_PRIORITY[sourceType] ?? 100
}

export interface UpsertResult {
  inserted: number
  errors: string[]
}

// ─── Supersession reconciliation (source-agnostic) ────────────────────────────
// After upserting rows for a logical period, check every OTHER row sharing
// that same logical key (different source_type) and mark the lower-priority
// ones is_superseded — regardless of whether "lower" is a manual_csv row
// being superseded by a future automated source, or vice versa if a manual
// correction is deliberately entered with a higher priority.

async function reconcileSupersession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  table: 'company_reporting_periods' | 'earnings_events',
  groupKeys: { ticker: string; fiscalYear: number | null; fiscalPeriod: string | null; periodType?: string | null }[],
): Promise<string[]> {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const g of groupKeys) {
    if (!g.fiscalYear || !g.fiscalPeriod) continue
    const key = `${g.ticker}|${g.fiscalYear}|${g.fiscalPeriod}|${g.periodType ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    let query = db.from(table).select('id, source_priority, is_superseded').eq('ticker', g.ticker).eq('fiscal_year', g.fiscalYear).eq('fiscal_period', g.fiscalPeriod)
    if (table === 'company_reporting_periods' && g.periodType) query = query.eq('period_type', g.periodType)
    const res = await query
    if (res.error) { errors.push(sanitizeError(res.error)); continue }
    const rows = (res.data ?? []) as Array<{ id: string; source_priority: number; is_superseded: boolean }>
    if (rows.length < 2) continue

    const winner = rows.reduce((a, b) => (b.source_priority > a.source_priority ? b : a))
    const losers = rows.filter((r) => r.id !== winner.id && (!r.is_superseded || true))
    for (const loser of losers) {
      if (loser.source_priority >= winner.source_priority) continue
      const upd = await db.from(table).update({ is_superseded: true, superseded_by: winner.id }).eq('id', loser.id)
      if (upd.error) errors.push(sanitizeError(upd.error))
    }
    // If the previously-superseded row is now the highest priority again
    // (e.g. a corrected re-import), un-supersede it.
    if (winner.is_superseded) {
      const upd = await db.from(table).update({ is_superseded: false, superseded_by: null }).eq('id', winner.id)
      if (upd.error) errors.push(sanitizeError(upd.error))
    }
  }
  return errors
}

// ─── Write path (admin client, called only from the ingestion script) ────────

export interface ReportingPeriodUpsertResult extends UpsertResult {
  /** Maps "ticker|fiscalYear|fiscalPeriod|periodType" -> reporting_period_id, for child-row mapping. */
  idsByKey: Map<string, string>
}

export async function upsertReportingPeriods(
  rows: ReportingPeriodImportRow[],
  ingestionRunId?: string | null,
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
    source_file: r.sourceFile,
    source_as_of: r.sourceAsOf,
    ingestion_run_id: ingestionRunId ?? null,
    source_priority: priorityFor(r.sourceType),
    // Phase 8C.2 — honest-period metadata into the EXISTING metadata jsonb
    // column (no migration needed, mirroring the 9D/9E approach). Manual CSV
    // rows omit these fields, leaving metadata at its default {}.
    ...((r.periodNature || r.periodStartDate || r.filingPeriodLabel)
      ? { metadata: { periodStartDate: r.periodStartDate ?? null, periodNature: r.periodNature ?? null, filingPeriodLabel: r.filingPeriodLabel ?? null } }
      : {}),
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

  const supersessionErrors = await reconcileSupersession(
    db,
    'company_reporting_periods',
    rows.map((r) => ({ ticker: r.ticker, fiscalYear: r.fiscalYear, fiscalPeriod: r.fiscalPeriod, periodType: r.periodType })),
  )

  return { inserted: data.length, errors: supersessionErrors, idsByKey }
}

export async function upsertStatementItems(
  rows: StatementItemImportRow[],
  idsByKey: Map<string, string>,
  ingestionRunId?: string | null,
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
      source_name: r.sourceName,
      source_url: r.sourceUrl,
      source_file: r.sourceFile,
      source_as_of: r.sourceAsOf,
      ingestion_run_id: ingestionRunId ?? null,
      source_priority: priorityFor(r.sourceType),
      // Phase 8C.2 — raw XBRL fact provenance into the existing metadata jsonb (no new table).
      ...(r.metadata ? { metadata: r.metadata } : {}),
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
  ingestionRunId?: string | null,
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
      source_name: 'sourceName' in r ? r.sourceName : null,
      source_url: 'sourceUrl' in r ? r.sourceUrl : null,
      source_file: 'sourceFile' in r ? r.sourceFile : null,
      source_as_of: 'sourceAsOf' in r ? r.sourceAsOf : null,
      ingestion_run_id: ingestionRunId ?? null,
      calculation_method: 'calculationMethod' in r ? r.calculationMethod : null,
      source_priority: priorityFor(r.sourceType),
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
  ingestionRunId?: string | null,
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
      source_file: r.sourceFile,
      source_as_of: r.sourceAsOf,
      ingestion_run_id: ingestionRunId ?? null,
      source_priority: priorityFor(r.sourceType),
      reporting_period_id: reportingPeriodId,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('earnings_events')
    .upsert(payload, { onConflict: 'ticker,fiscal_year,fiscal_period,source_type' })
    .select('id')

  if (res.error) return { inserted: 0, errors: [sanitizeError(res.error)] }

  const supersessionErrors = await reconcileSupersession(
    db,
    'earnings_events',
    rows.map((r) => ({ ticker: r.ticker, fiscalYear: r.fiscalYear, fiscalPeriod: r.fiscalPeriod })),
  )

  return { inserted: (res.data ?? []).length, errors: supersessionErrors }
}

// ─── Read path (public/anon client — every table has an "anon read" policy) ──
// Every read excludes is_superseded rows, and where more than one non-
// superseded row can exist for the same logical period (a defensive
// safety net — the write-side reconciliation above should normally prevent
// this), the highest source_priority wins. UI code never needs to know
// which source_type answered a given field.

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
  sourcePriority: number
}

export interface StatementItemRecord {
  ticker: string
  reportingPeriodId: string
  fiscalYear: number
  fiscalPeriod: string
  periodType: string
  periodEndDate: string
  /** The owning reporting period's own source_priority — lets a "latest" reader
   *  pick a single period when two periods of different granularity (e.g. an
   *  annual filing and a Q4 filing) share the same period_end_date, instead of
   *  merging line items from both. See getLatestStatementItems. */
  reportingPeriodSourcePriority: number
  statementType: string
  lineItemCode: string
  lineItemName: string
  value: number | null
  unit: string
  /** 'millions' (the manual-CSV template convention) or 'units' (raw CLP —
   *  every live provider: Yahoo, CMF/XBRL, CMF bank) — read this before
   *  combining `value` with a millions-denominated figure like marketCapCLP.
   *  Never assume; both conventions coexist in this table. */
  scale: string | null
  sourceType: string
}

export interface FinancialMetricRecord {
  ticker: string
  reportingPeriodId: string
  fiscalYear: number
  fiscalPeriod: string
  periodType: string
  periodEndDate: string
  reportingPeriodSourcePriority: number
  metricCode: string
  metricName: string
  value: number | null
  unit: string | null
  sourceType: string
  calculationMethod: string | null
}

/**
 * Normalizes a CLP-denominated statement-item or metric value to millions —
 * the scale every downstream consumer that also uses marketCapCLP (always
 * millions) expects. `financial_statement_items` carries its own `scale`
 * column and is trusted directly; `financial_metrics` has no scale column
 * (a real schema gap), so falls back to a source_type rule: every live
 * provider (Yahoo, CMF/XBRL, CMF bank) writes raw CLP, and only the
 * manual-CSV template convention (source_type 'manual_csv'/'derived') is
 * already millions-scale. A 2026-07-20 bug — this normalization not existing
 * at all — let a raw-CLP FCF value get divided by a millions-scale market
 * cap, producing FCF Yield figures in the millions of percent. Never skip
 * this when combining a persisted financials value with marketCapCLP.
 */
export function toMillionsClp(value: number, opts: { scale?: string | null; sourceType: string }): number {
  if (opts.scale === 'units') return value / 1_000_000
  if (opts.scale === 'millions') return value
  return opts.sourceType === 'manual_csv' || opts.sourceType === 'derived' ? value : value / 1_000_000
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
  sourcePriority: number
}

async function getReadClient() {
  const { getSupabaseServerClient } = await import('../../supabase/server.ts')
  return getSupabaseServerClient()
}

/** Non-superseded reporting periods for a ticker, most recent period_end_date first. */
export async function getReportingPeriods(ticker: string): Promise<ReportingPeriodRecord[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('company_reporting_periods')
    .select('id, ticker, fiscal_year, fiscal_period, period_type, period_end_date, report_date, currency, source_type, source_priority')
    .eq('ticker', ticker.toUpperCase())
    .eq('is_superseded', false)
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
    sourcePriority: (r.source_priority as number) ?? 100,
  }))
}

/**
 * Canonical (one-per-logical-period) reporting periods — when more than one
 * non-superseded source exists for the same (fiscalYear, fiscalPeriod,
 * periodType), the highest source_priority wins. This is the set Charting/
 * Compare/Earnings should read from, never the raw multi-source list.
 */
export async function getCanonicalReportingPeriods(ticker: string): Promise<ReportingPeriodRecord[]> {
  const all = await getReportingPeriods(ticker)
  const byGroup = new Map<string, ReportingPeriodRecord>()
  for (const p of all) {
    const key = `${p.fiscalYear}|${p.fiscalPeriod}|${p.periodType}`
    const existing = byGroup.get(key)
    if (!existing || p.sourcePriority > existing.sourcePriority) byGroup.set(key, p)
  }
  return Array.from(byGroup.values()).sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))
}

/** All statement line items for a ticker's canonical reporting periods, newest first. */
export async function getStatementItems(ticker: string): Promise<StatementItemRecord[]> {
  const canonical = await getCanonicalReportingPeriods(ticker)
  if (canonical.length === 0) return []
  const canonicalIds = new Set(canonical.map((p) => p.id))
  const periodById = new Map(canonical.map((p) => [p.id, p]))

  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('financial_statement_items')
    .select('ticker, reporting_period_id, statement_type, line_item_code, line_item_name, value, unit, scale, source_type')
    .eq('ticker', ticker.toUpperCase())
    .eq('is_superseded', false)
  if (res.error || !res.data) return []

  const mapped: (StatementItemRecord | null)[] = (res.data as Array<Record<string, unknown>>).map((r) => {
    const reportingPeriodId = r.reporting_period_id as string
    if (!canonicalIds.has(reportingPeriodId)) return null
    const period = periodById.get(reportingPeriodId)!
    const record: StatementItemRecord = {
      ticker: r.ticker as string,
      reportingPeriodId,
      fiscalYear: period.fiscalYear,
      fiscalPeriod: period.fiscalPeriod,
      periodType: period.periodType,
      periodEndDate: period.periodEndDate,
      reportingPeriodSourcePriority: period.sourcePriority,
      statementType: r.statement_type as string,
      lineItemCode: r.line_item_code as string,
      lineItemName: r.line_item_name as string,
      value: (r.value as number) ?? null,
      unit: r.unit as string,
      scale: (r.scale as string) ?? null,
      sourceType: r.source_type as string,
    }
    return record
  })
  const filtered: StatementItemRecord[] = mapped.filter((r): r is StatementItemRecord => r !== null)
  return filtered.sort((a, b) => b.periodEndDate.localeCompare(a.periodEndDate))
}

/** All financial metrics (manual + derived) for a ticker's canonical reporting periods. */
export async function getFinancialMetrics(ticker: string): Promise<FinancialMetricRecord[]> {
  const canonical = await getCanonicalReportingPeriods(ticker)
  if (canonical.length === 0) return []
  const canonicalIds = new Set(canonical.map((p) => p.id))
  const periodById = new Map(canonical.map((p) => [p.id, p]))

  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('financial_metrics')
    .select('ticker, reporting_period_id, metric_code, metric_name, value, unit, source_type, calculation_method')
    .eq('ticker', ticker.toUpperCase())
    .eq('is_superseded', false)
  if (res.error || !res.data) return []

  const mapped: (FinancialMetricRecord | null)[] = (res.data as Array<Record<string, unknown>>).map((r) => {
    const reportingPeriodId = r.reporting_period_id as string
    if (!canonicalIds.has(reportingPeriodId)) return null
    const period = periodById.get(reportingPeriodId)!
    const record: FinancialMetricRecord = {
      ticker: r.ticker as string,
      reportingPeriodId,
      fiscalYear: period.fiscalYear,
      fiscalPeriod: period.fiscalPeriod,
      periodType: period.periodType,
      periodEndDate: period.periodEndDate,
      reportingPeriodSourcePriority: period.sourcePriority,
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
 * Within the same (canonical) period, a manually-supplied value takes
 * precedence over a derived one for the same metric_code.
 *
 * A quarterly filing and an annual filing can legitimately share the same
 * period_end_date (e.g. a Q4 quarter and the full FY both end 12-31) and both
 * stay canonical, since supersession only dedupes within the same
 * (fiscal_year, fiscal_period, period_type) — different period types are
 * never grouped together. Picking "every item whose date matches the max
 * date" would silently mix line items from two unrelated filings (e.g. an
 * annual net_income next to a single quarter's EPS). Instead, among periods
 * sharing the latest date, only the single reporting_period_id with the
 * highest source_priority is used — never merged across periods.
 */
export async function getLatestFinancialMetrics(ticker: string): Promise<Map<string, FinancialMetricRecord>> {
  const all = await getFinancialMetrics(ticker)
  if (all.length === 0) return new Map()
  const latestPeriodId = pickLatestReportingPeriodId(all)
  const latest = all.filter((m) => m.reportingPeriodId === latestPeriodId)
  const byCode = new Map<string, FinancialMetricRecord>()
  for (const m of latest) {
    const existing = byCode.get(m.metricCode)
    if (!existing || (existing.sourceType === 'derived' && m.sourceType !== 'derived')) {
      byCode.set(m.metricCode, m)
    }
  }
  return byCode
}

/** Latest reporting period's statement items for a ticker, keyed by line_item_code. */
export async function getLatestStatementItems(ticker: string): Promise<Map<string, StatementItemRecord>> {
  const all = await getStatementItems(ticker)
  if (all.length === 0) return new Map()
  const latestPeriodId = pickLatestReportingPeriodId(all)
  const byCode = new Map<string, StatementItemRecord>()
  for (const item of all) {
    if (item.reportingPeriodId === latestPeriodId) byCode.set(item.lineItemCode, item)
  }
  return byCode
}

/** Shared by getLatestStatementItems/getLatestFinancialMetrics — see their doc comments. */
function pickLatestReportingPeriodId(
  rows: { reportingPeriodId: string; periodEndDate: string; reportingPeriodSourcePriority: number }[],
): string {
  const latestPeriodEnd = rows.reduce((max, r) => (r.periodEndDate > max ? r.periodEndDate : max), rows[0].periodEndDate)
  let best = rows.find((r) => r.periodEndDate === latestPeriodEnd)!
  for (const r of rows) {
    if (r.periodEndDate === latestPeriodEnd && r.reportingPeriodSourcePriority > best.reportingPeriodSourcePriority) best = r
  }
  return best.reportingPeriodId
}

/**
 * The EPS figure Compare's derived P/E should use: the latest ANNUAL period's
 * eps if that's what's most recent, otherwise the sum of the last 4
 * CONSECUTIVE quarterly eps values (a trailing-twelve-months figure) — never
 * a single quarter's EPS treated as if it were annual. Returns null when
 * neither is available (fewer than 4 quarters and no annual figure) rather
 * than falling back to a misleading single-quarter number.
 */
export async function getEpsForValuation(ticker: string): Promise<{ value: number; asOfDate: string } | null> {
  const all = await getStatementItems(ticker)
  const epsRows = all.filter((r) => r.lineItemCode === 'eps' && r.value != null)
  if (epsRows.length === 0) return null
  // `all` (and therefore epsRows) is already sorted newest-first.
  const latest = epsRows[0]
  if (latest.periodType === 'annual') {
    return { value: latest.value as number, asOfDate: latest.periodEndDate }
  }
  const quarterly = epsRows.filter((r) => r.periodType === 'quarterly')
  if (quarterly.length < 4) return null
  const last4 = quarterly.slice(0, 4)
  const sum = last4.reduce((s, r) => s + (r.value as number), 0)
  return { value: sum, asOfDate: last4[0].periodEndDate }
}

/**
 * Canonical (one-per-logical-period, highest source_priority, non-superseded)
 * earnings events for a ticker, or every ticker's when `ticker` is omitted.
 */
export async function getEarningsEvents(ticker?: string): Promise<EarningsEventRecord[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (db as any)
    .from('earnings_events')
    .select('id, ticker, fiscal_year, fiscal_period, period_type, report_date, event_date, status, revenue, ebitda, net_income, eps, currency, source_type, source_name, source_priority')
    .eq('is_superseded', false)
    .order('report_date', { ascending: false, nullsFirst: false })
  if (ticker) query = query.eq('ticker', ticker.toUpperCase())
  const res = await query
  if (res.error || !res.data) return []

  const all = (res.data as Array<Record<string, unknown>>).map((r) => ({
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
    sourcePriority: (r.source_priority as number) ?? 100,
  }))

  // Canonical dedup per (ticker, fiscalYear, fiscalPeriod) — defense-in-depth
  // alongside the write-side reconciliation.
  const byGroup = new Map<string, EarningsEventRecord>()
  for (const e of all) {
    const key = `${e.ticker}|${e.fiscalYear}|${e.fiscalPeriod}`
    const existing = byGroup.get(key)
    if (!existing || e.sourcePriority > existing.sourcePriority) byGroup.set(key, e)
  }
  return Array.from(byGroup.values()).sort((a, b) => (b.reportDate ?? '').localeCompare(a.reportDate ?? ''))
}

/**
 * Per-ticker coverage for a specific source_type (e.g. 'xbrl') — how many
 * reporting periods that source has supplied and the latest, and whether each
 * is currently canonical (non-superseded). Powers the CMF/XBRL ingestion
 * status endpoint without exposing any raw fact data.
 */
export async function getSourceTypeCoverage(sourceType: string): Promise<{ ticker: string; periodCount: number; canonicalCount: number; latestPeriodEnd: string | null; latestPeriodLabel: string | null }[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('company_reporting_periods')
    .select('ticker, period_end_date, fiscal_period, fiscal_year, is_superseded')
    .eq('source_type', sourceType)
  if (res.error || !res.data) return []
  const byTicker = new Map<string, { count: number; canonical: number; latest: string; label: string | null }>()
  for (const row of res.data as Array<{ ticker: string; period_end_date: string; fiscal_period: string; fiscal_year: number; is_superseded: boolean }>) {
    const e = byTicker.get(row.ticker) ?? { count: 0, canonical: 0, latest: '', label: null }
    e.count += 1
    if (!row.is_superseded) e.canonical += 1
    if (row.period_end_date > e.latest) { e.latest = row.period_end_date; e.label = `${row.fiscal_period} ${row.fiscal_year}` }
    byTicker.set(row.ticker, e)
  }
  return Array.from(byTicker.entries())
    .map(([ticker, v]) => ({ ticker, periodCount: v.count, canonicalCount: v.canonical, latestPeriodEnd: v.latest || null, latestPeriodLabel: v.label }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
}

/** Distinct tickers with at least one canonical (non-superseded) reporting period — drives fallback decisions. */
export async function getFinancialsCoverage(): Promise<{ ticker: string; reportingPeriodCount: number; latestPeriodEnd: string | null }[]> {
  const db = await getReadClient()
  if (!db) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (db as any)
    .from('company_reporting_periods')
    .select('ticker, period_end_date')
    .eq('is_superseded', false)
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
