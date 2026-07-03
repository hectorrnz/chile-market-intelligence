// Phase 8C — Manual CSV financial-statement ingestion: pure parsing +
// validation. No Supabase/Next.js imports — safe to unit-test directly with
// plain `node --test` (mirrors src/lib/compare/compareStatic.ts's fs-based
// static-data loading, avoiding the '@/*' alias Node's native test runner
// cannot resolve).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const companiesPath = fileURLToPath(new URL('../../data/companies.json', import.meta.url))
const COVERED_TICKERS = new Set(
  (JSON.parse(readFileSync(companiesPath, 'utf8')) as { ticker: string }[]).map((c) => c.ticker.toUpperCase()),
)

export const MANUAL_CSV_SOURCE_TYPE = 'manual_csv'
export const VALID_FISCAL_PERIODS = ['Q1', 'Q2', 'Q3', 'Q4', 'FY'] as const
export const VALID_PERIOD_TYPES = ['quarterly', 'annual', 'ttm'] as const
export const VALID_STATEMENT_TYPES = ['income', 'cash', 'balance', 'returns'] as const
export const VALID_EARNINGS_STATUS = ['expected', 'reported', 'preliminary', 'missing'] as const

export type FiscalPeriod = (typeof VALID_FISCAL_PERIODS)[number]
export type PeriodType = (typeof VALID_PERIOD_TYPES)[number]
export type StatementType = (typeof VALID_STATEMENT_TYPES)[number]
export type EarningsStatus = (typeof VALID_EARNINGS_STATUS)[number]

export interface ValidationError {
  line: number
  reason: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationError }

// ─── CSV parsing ───────────────────────────────────────────────────────────────

export interface ParsedCsvRow {
  /** 1-indexed source line number (header is line 1; first data row is line 2). */
  line: number
  cells: Record<string, string>
}

/** Splits a single CSV line into fields, honoring double-quoted fields with embedded commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; continue }
      if (ch === '"') { inQuotes = false; continue }
      current += ch
    } else {
      if (ch === '"') { inQuotes = true; continue }
      if (ch === ',') { fields.push(current); current = ''; continue }
      current += ch
    }
  }
  fields.push(current)
  return fields.map((f) => f.trim())
}

/** Parses raw CSV text into header-keyed rows. Blank lines are skipped. */
export function parseCsvRows(text: string): { header: string[]; rows: ParsedCsvRow[] } {
  const lines = text.split(/\r\n|\r|\n/)
  const nonEmptyIndices = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim().length > 0)
  if (nonEmptyIndices.length === 0) return { header: [], rows: [] }

  const [headerLine, headerIndex] = nonEmptyIndices[0]
  const header = splitCsvLine(headerLine).map((h) => h.trim())

  const rows: ParsedCsvRow[] = []
  for (const [line, index] of nonEmptyIndices.slice(1)) {
    if (index === headerIndex) continue
    const cells = splitCsvLine(line)
    const record: Record<string, string> = {}
    header.forEach((key, i) => { record[key] = (cells[i] ?? '').trim() })
    rows.push({ line: index + 1, cells: record })
  }
  return { header, rows }
}

// ─── Normalization helpers ──────────────────────────────────────────────────────

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase()
}

export function isCoveredTicker(ticker: string): boolean {
  return COVERED_TICKERS.has(normalizeTicker(ticker))
}

export function normalizePeriod(raw: string): FiscalPeriod | null {
  const v = raw.trim().toUpperCase()
  return (VALID_FISCAL_PERIODS as readonly string[]).includes(v) ? (v as FiscalPeriod) : null
}

/** Parses a CSV numeric cell. Empty string -> null. Anything non-finite -> null (never NaN/Infinity). */
export function normalizeNumericValue(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** Parses a CSV date cell (YYYY-MM-DD). Empty string -> null (allowed for optional dates). */
function normalizeDate(raw: string | undefined): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw.trim() === '') return { ok: true, value: null }
  const trimmed = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false }
  const d = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return { ok: false }
  return { ok: true, value: trimmed }
}

function isValidFiscalYear(raw: string): number | null {
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 1990 || n > 2100) return null
  return n
}

// ─── Row validators ─────────────────────────────────────────────────────────────

export interface ReportingPeriodImportRow {
  ticker: string
  fiscalYear: number
  fiscalPeriod: FiscalPeriod
  periodType: PeriodType
  periodEndDate: string
  reportDate: string | null
  currency: string
  sourceName: string | null
  sourceUrl: string | null
  sourceType: string
}

export function validateReportingPeriodRow(row: ParsedCsvRow): ValidationResult<ReportingPeriodImportRow> {
  const err = (reason: string): ValidationResult<ReportingPeriodImportRow> => ({ ok: false, error: { line: row.line, reason } })
  const ticker = normalizeTicker(row.cells.ticker ?? '')
  if (!ticker || !isCoveredTicker(ticker)) return err(`invalid ticker "${row.cells.ticker ?? ''}" — not in covered universe`)

  const fiscalYear = isValidFiscalYear(row.cells.fiscal_year ?? '')
  if (fiscalYear === null) return err(`invalid fiscal_year "${row.cells.fiscal_year ?? ''}"`)

  const fiscalPeriod = normalizePeriod(row.cells.fiscal_period ?? '')
  if (!fiscalPeriod) return err(`invalid fiscal_period "${row.cells.fiscal_period ?? ''}"`)

  const periodType = (row.cells.period_type ?? '').trim().toLowerCase()
  if (!(VALID_PERIOD_TYPES as readonly string[]).includes(periodType)) return err(`invalid period_type "${row.cells.period_type ?? ''}"`)

  const periodEnd = normalizeDate(row.cells.period_end_date)
  if (!periodEnd.ok || !periodEnd.value) return err(`invalid period_end_date "${row.cells.period_end_date ?? ''}"`)

  const reportDate = normalizeDate(row.cells.report_date)
  if (!reportDate.ok) return err(`invalid report_date "${row.cells.report_date ?? ''}"`)

  return {
    ok: true,
    value: {
      ticker,
      fiscalYear,
      fiscalPeriod,
      periodType: periodType as PeriodType,
      periodEndDate: periodEnd.value,
      reportDate: reportDate.value,
      currency: (row.cells.currency ?? '').trim() || 'CLP',
      sourceName: (row.cells.source_name ?? '').trim() || null,
      sourceUrl: (row.cells.source_url ?? '').trim() || null,
      sourceType: MANUAL_CSV_SOURCE_TYPE,
    },
  }
}

export interface StatementItemImportRow {
  ticker: string
  fiscalYear: number
  fiscalPeriod: FiscalPeriod
  periodType: PeriodType
  statementType: StatementType
  lineItemCode: string
  lineItemName: string
  value: number | null
  unit: string
  scale: string | null
  sourceType: string
}

export function validateStatementItemRow(row: ParsedCsvRow): ValidationResult<StatementItemImportRow> {
  const err = (reason: string): ValidationResult<StatementItemImportRow> => ({ ok: false, error: { line: row.line, reason } })
  const ticker = normalizeTicker(row.cells.ticker ?? '')
  if (!ticker || !isCoveredTicker(ticker)) return err(`invalid ticker "${row.cells.ticker ?? ''}" — not in covered universe`)

  const fiscalYear = isValidFiscalYear(row.cells.fiscal_year ?? '')
  if (fiscalYear === null) return err(`invalid fiscal_year "${row.cells.fiscal_year ?? ''}"`)

  const fiscalPeriod = normalizePeriod(row.cells.fiscal_period ?? '')
  if (!fiscalPeriod) return err(`invalid fiscal_period "${row.cells.fiscal_period ?? ''}"`)

  const periodType = (row.cells.period_type ?? '').trim().toLowerCase()
  if (!(VALID_PERIOD_TYPES as readonly string[]).includes(periodType)) return err(`invalid period_type "${row.cells.period_type ?? ''}"`)

  const statementType = (row.cells.statement_type ?? '').trim().toLowerCase()
  if (!(VALID_STATEMENT_TYPES as readonly string[]).includes(statementType)) return err(`invalid statement_type "${row.cells.statement_type ?? ''}"`)

  const lineItemCode = (row.cells.line_item_code ?? '').trim().toLowerCase()
  if (!lineItemCode) return err('missing line_item_code')

  const lineItemName = (row.cells.line_item_name ?? '').trim() || lineItemCode

  return {
    ok: true,
    value: {
      ticker,
      fiscalYear,
      fiscalPeriod,
      periodType: periodType as PeriodType,
      statementType: statementType as StatementType,
      lineItemCode,
      lineItemName,
      value: normalizeNumericValue(row.cells.value),
      unit: (row.cells.unit ?? '').trim() || 'CLP',
      scale: (row.cells.scale ?? '').trim() || null,
      sourceType: MANUAL_CSV_SOURCE_TYPE,
    },
  }
}

export interface FinancialMetricImportRow {
  ticker: string
  fiscalYear: number
  fiscalPeriod: FiscalPeriod
  periodType: PeriodType
  metricCode: string
  metricName: string
  value: number | null
  unit: string | null
  calculationMethod: string | null
  sourceType: string
}

export function validateFinancialMetricRow(row: ParsedCsvRow): ValidationResult<FinancialMetricImportRow> {
  const err = (reason: string): ValidationResult<FinancialMetricImportRow> => ({ ok: false, error: { line: row.line, reason } })
  const ticker = normalizeTicker(row.cells.ticker ?? '')
  if (!ticker || !isCoveredTicker(ticker)) return err(`invalid ticker "${row.cells.ticker ?? ''}" — not in covered universe`)

  const fiscalYear = isValidFiscalYear(row.cells.fiscal_year ?? '')
  if (fiscalYear === null) return err(`invalid fiscal_year "${row.cells.fiscal_year ?? ''}"`)

  const fiscalPeriod = normalizePeriod(row.cells.fiscal_period ?? '')
  if (!fiscalPeriod) return err(`invalid fiscal_period "${row.cells.fiscal_period ?? ''}"`)

  const periodType = (row.cells.period_type ?? '').trim().toLowerCase()
  if (!(VALID_PERIOD_TYPES as readonly string[]).includes(periodType)) return err(`invalid period_type "${row.cells.period_type ?? ''}"`)

  const metricCode = (row.cells.metric_code ?? '').trim().toLowerCase()
  if (!metricCode) return err('missing metric_code')

  const metricName = (row.cells.metric_name ?? '').trim() || metricCode

  return {
    ok: true,
    value: {
      ticker,
      fiscalYear,
      fiscalPeriod,
      periodType: periodType as PeriodType,
      metricCode,
      metricName,
      value: normalizeNumericValue(row.cells.value),
      unit: (row.cells.unit ?? '').trim() || null,
      calculationMethod: (row.cells.calculation_method ?? '').trim() || null,
      sourceType: MANUAL_CSV_SOURCE_TYPE,
    },
  }
}

export interface EarningsEventImportRow {
  ticker: string
  fiscalYear: number | null
  fiscalPeriod: FiscalPeriod | null
  periodType: PeriodType | null
  reportDate: string | null
  eventDate: string | null
  status: EarningsStatus
  revenue: number | null
  ebitda: number | null
  netIncome: number | null
  eps: number | null
  currency: string
  sourceName: string | null
  sourceUrl: string | null
  sourceType: string
}

export function validateEarningsEventRow(row: ParsedCsvRow): ValidationResult<EarningsEventImportRow> {
  const err = (reason: string): ValidationResult<EarningsEventImportRow> => ({ ok: false, error: { line: row.line, reason } })
  const ticker = normalizeTicker(row.cells.ticker ?? '')
  if (!ticker || !isCoveredTicker(ticker)) return err(`invalid ticker "${row.cells.ticker ?? ''}" — not in covered universe`)

  const fiscalYearRaw = (row.cells.fiscal_year ?? '').trim()
  const fiscalYear = fiscalYearRaw ? isValidFiscalYear(fiscalYearRaw) : null
  if (fiscalYearRaw && fiscalYear === null) return err(`invalid fiscal_year "${fiscalYearRaw}"`)

  const fiscalPeriodRaw = (row.cells.fiscal_period ?? '').trim()
  const fiscalPeriod = fiscalPeriodRaw ? normalizePeriod(fiscalPeriodRaw) : null
  if (fiscalPeriodRaw && !fiscalPeriod) return err(`invalid fiscal_period "${fiscalPeriodRaw}"`)

  const periodTypeRaw = (row.cells.period_type ?? '').trim().toLowerCase()
  if (periodTypeRaw && !(VALID_PERIOD_TYPES as readonly string[]).includes(periodTypeRaw)) return err(`invalid period_type "${row.cells.period_type ?? ''}"`)

  const reportDate = normalizeDate(row.cells.report_date)
  if (!reportDate.ok) return err(`invalid report_date "${row.cells.report_date ?? ''}"`)

  const eventDate = normalizeDate(row.cells.event_date)
  if (!eventDate.ok) return err(`invalid event_date "${row.cells.event_date ?? ''}"`)

  const statusRaw = (row.cells.status ?? '').trim().toLowerCase() || 'reported'
  if (!(VALID_EARNINGS_STATUS as readonly string[]).includes(statusRaw)) return err(`invalid status "${row.cells.status ?? ''}"`)

  return {
    ok: true,
    value: {
      ticker,
      fiscalYear,
      fiscalPeriod,
      periodType: (periodTypeRaw as PeriodType) || null,
      reportDate: reportDate.value,
      eventDate: eventDate.value,
      status: statusRaw as EarningsStatus,
      revenue: normalizeNumericValue(row.cells.revenue),
      ebitda: normalizeNumericValue(row.cells.ebitda),
      netIncome: normalizeNumericValue(row.cells.net_income),
      eps: normalizeNumericValue(row.cells.eps),
      currency: (row.cells.currency ?? '').trim() || 'CLP',
      sourceName: (row.cells.source_name ?? '').trim() || null,
      sourceUrl: (row.cells.source_url ?? '').trim() || null,
      sourceType: MANUAL_CSV_SOURCE_TYPE,
    },
  }
}

// ─── Payload builder ─────────────────────────────────────────────────────────────

export interface FinancialImportPayload {
  reportingPeriods: ReportingPeriodImportRow[]
  statementItems: StatementItemImportRow[]
  metrics: FinancialMetricImportRow[]
  earningsEvents: EarningsEventImportRow[]
  errors: ValidationError[]
}

/**
 * Validates every row of each CSV's parsed rows and assembles a single import
 * payload. Any file may be omitted (empty rows array). Errors from all four
 * files are collected together with their originating line numbers; callers
 * decide whether to abort (default) or proceed with --allow-partial.
 */
export function buildFinancialImportPayload(input: {
  reportingPeriodRows?: ParsedCsvRow[]
  statementItemRows?: ParsedCsvRow[]
  metricRows?: ParsedCsvRow[]
  earningsEventRows?: ParsedCsvRow[]
}): FinancialImportPayload {
  const errors: ValidationError[] = []

  const reportingPeriods: ReportingPeriodImportRow[] = []
  for (const row of input.reportingPeriodRows ?? []) {
    const r = validateReportingPeriodRow(row)
    if (r.ok) reportingPeriods.push(r.value)
    else errors.push(r.error)
  }

  const statementItems: StatementItemImportRow[] = []
  for (const row of input.statementItemRows ?? []) {
    const r = validateStatementItemRow(row)
    if (r.ok) statementItems.push(r.value)
    else errors.push(r.error)
  }

  const metrics: FinancialMetricImportRow[] = []
  for (const row of input.metricRows ?? []) {
    const r = validateFinancialMetricRow(row)
    if (r.ok) metrics.push(r.value)
    else errors.push(r.error)
  }

  const earningsEvents: EarningsEventImportRow[] = []
  for (const row of input.earningsEventRows ?? []) {
    const r = validateEarningsEventRow(row)
    if (r.ok) earningsEvents.push(r.value)
    else errors.push(r.error)
  }

  return { reportingPeriods, statementItems, metrics, earningsEvents, errors }
}

// ─── Derived metrics (computed post-import from statement items) ───────────────

export interface DerivedMetricInput {
  ticker: string
  fiscalYear: number
  fiscalPeriod: FiscalPeriod
  periodType: PeriodType
  itemsByCode: Map<string, number | null>
}

export interface DerivedMetricRow {
  ticker: string
  fiscalYear: number
  fiscalPeriod: FiscalPeriod
  periodType: PeriodType
  metricCode: string
  metricName: string
  value: number
  unit: string
  calculationMethod: string
  sourceType: 'derived'
}

/** Computes the "minimum useful" derived ratios from raw statement line items. Never emits NaN/Infinity. */
export function deriveFinancialMetrics(input: DerivedMetricInput): DerivedMetricRow[] {
  const get = (code: string): number | null => input.itemsByCode.get(code) ?? null
  const out: DerivedMetricRow[] = []
  const base = { ticker: input.ticker, fiscalYear: input.fiscalYear, fiscalPeriod: input.fiscalPeriod, periodType: input.periodType, sourceType: 'derived' as const }

  const revenue = get('revenue')
  const ebitda = get('ebitda')
  if (revenue !== null && revenue !== 0 && ebitda !== null) {
    const v = (ebitda / revenue) * 100
    if (Number.isFinite(v)) out.push({ ...base, metricCode: 'ebitda_margin', metricName: 'EBITDA Margin', value: v, unit: '%', calculationMethod: 'ebitda / revenue' })
  }

  const grossProfit = get('gross_profit')
  if (revenue !== null && revenue !== 0 && grossProfit !== null) {
    const v = (grossProfit / revenue) * 100
    if (Number.isFinite(v)) out.push({ ...base, metricCode: 'gross_margin', metricName: 'Gross Margin', value: v, unit: '%', calculationMethod: 'gross_profit / revenue' })
  }

  const operatingIncome = get('operating_income')
  if (revenue !== null && revenue !== 0 && operatingIncome !== null) {
    const v = (operatingIncome / revenue) * 100
    if (Number.isFinite(v)) out.push({ ...base, metricCode: 'op_margin', metricName: 'Operating Margin', value: v, unit: '%', calculationMethod: 'operating_income / revenue' })
  }

  const ocf = get('ocf')
  const capex = get('capex')
  if (ocf !== null && capex !== null) {
    const v = ocf - capex
    if (Number.isFinite(v)) out.push({ ...base, metricCode: 'fcf', metricName: 'Free Cash Flow', value: v, unit: 'CLP', calculationMethod: 'ocf - capex' })
  }

  const totalDebt = get('total_debt')
  const cash = get('cash')
  if (totalDebt !== null && cash !== null) {
    const netDebt = totalDebt - cash
    if (Number.isFinite(netDebt)) {
      out.push({ ...base, metricCode: 'net_debt', metricName: 'Net Debt', value: netDebt, unit: 'CLP', calculationMethod: 'total_debt - cash' })
      if (ebitda !== null && ebitda !== 0) {
        const v = netDebt / ebitda
        if (Number.isFinite(v)) out.push({ ...base, metricCode: 'net_debt_ebitda', metricName: 'Net Debt / EBITDA', value: v, unit: 'x', calculationMethod: 'net_debt / ebitda' })
      }
    }
  }

  return out
}
