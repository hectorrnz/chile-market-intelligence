// Phase 8C.5 — Yahoo Finance fundamentals provider.
//
// The UNIVERSAL fundamentals source: quarterly + annual income/balance/cash-flow
// for every one of the 25 app stocks — including the 4 banks that CMF/XBRL
// structurally can't reach. Yahoo returns DISCRETE quarters (periodType '3M'),
// so unlike CMF interim filings there is no YTD-vs-discrete decomposition to do.
//
// Honesty rules this file must never violate:
//   - Yahoo is UNOFFICIAL (a free third-party aggregator) — the exact same
//     status the app already gives Yahoo prices. It writes source_type
//     'yahoo_finance' (priority 80), which CMF/XBRL annual (210) supersedes for
//     the same fiscal year. Yahoo quarterly is a different logical period and
//     always coexists.
//   - Missing fields stay missing — a null/NaN/absent Yahoo value is skipped,
//     never coerced to 0.
//   - Values are stored RAW (units, native financial currency), consistent with
//     how the XBRL provider stores facts, so a single chart's quarterly / annual
//     / TTM points share one scale. capex / dividends are stored as positive
//     magnitudes (Yahoo reports them as negative cash outflows).
//   - The pure mapper (`mapYahooRowsToPayload`) does no network I/O; the fetch
//     function is the only side-effecting part and is never called at import.

import { TICKER_YF } from '../../market/liveOverlay.ts'
import type {
  FinancialImportPayload,
  ReportingPeriodImportRow,
  StatementItemImportRow,
  FinancialMetricImportRow,
  StatementType,
  FiscalPeriod,
} from '../csvFinancials.ts'

export const YAHOO_FINANCE_SOURCE_TYPE = 'yahoo_finance'
export const YAHOO_FINANCE_SOURCE_NAME = 'Yahoo Finance (unofficial)'

/** One row from Yahoo `fundamentalsTimeSeries` (only the fields we consume). */
export interface YahooFundamentalsRow {
  date: string | Date
  totalRevenue?: number | null
  grossProfit?: number | null
  operatingIncome?: number | null
  EBITDA?: number | null
  netIncome?: number | null
  dilutedEPS?: number | null
  basicEPS?: number | null
  operatingCashFlow?: number | null
  capitalExpenditure?: number | null
  freeCashFlow?: number | null
  cashAndCashEquivalents?: number | null
  totalDebt?: number | null
  ordinarySharesNumber?: number | null
  [key: string]: unknown
}

export interface YahooFundamentalsFetch {
  ticker: string
  symbol: string
  currency: string
  quarterly: YahooFundamentalsRow[]
  annual: YahooFundamentalsRow[]
}

/** Yahoo symbol for an app ticker (e.g. FALABELLA → FALABELLA.SN). */
export function yahooSymbolFor(ticker: string): string | null {
  return TICKER_YF[ticker.toUpperCase()] ?? null
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Derives (fiscalYear, fiscalPeriod, periodEndDate) from a Yahoo period-end date, using UTC so a Chile-tz timestamp still lands in the right quarter-end month. */
export function derivePeriod(date: string | Date, kind: 'quarterly' | 'annual'): { fiscalYear: number; fiscalPeriod: FiscalPeriod; periodEndDate: string; periodStartDate: string } | null {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1 // 1..12
  const endDate = d.toISOString().slice(0, 10)
  if (kind === 'annual') {
    return { fiscalYear: year, fiscalPeriod: 'FY', periodEndDate: endDate, periodStartDate: `${year}-01-01` }
  }
  const q = Math.min(4, Math.max(1, Math.ceil(month / 3)))
  const startMonth = String((q - 1) * 3 + 1).padStart(2, '0')
  return { fiscalYear: year, fiscalPeriod: `Q${q}` as FiscalPeriod, periodEndDate: endDate, periodStartDate: `${year}-${startMonth}-01` }
}

// Yahoo field → normalized statement line item. capex/dividends are magnitudes.
const STATEMENT_FIELDS: { code: string; statement: StatementType; pick: (r: YahooFundamentalsRow) => number | null }[] = [
  { code: 'revenue', statement: 'income', pick: (r) => finite(r.totalRevenue) },
  { code: 'gross_profit', statement: 'income', pick: (r) => finite(r.grossProfit) },
  { code: 'operating_income', statement: 'income', pick: (r) => finite(r.operatingIncome) },
  { code: 'ebitda', statement: 'income', pick: (r) => finite(r.EBITDA) },
  { code: 'net_income', statement: 'income', pick: (r) => finite(r.netIncome) },
  { code: 'eps', statement: 'income', pick: (r) => finite(r.dilutedEPS) ?? finite(r.basicEPS) },
  { code: 'ocf', statement: 'cash', pick: (r) => finite(r.operatingCashFlow) },
  { code: 'capex', statement: 'cash', pick: (r) => { const v = finite(r.capitalExpenditure); return v === null ? null : Math.abs(v) } },
  { code: 'cash', statement: 'balance', pick: (r) => finite(r.cashAndCashEquivalents) },
  { code: 'total_debt', statement: 'balance', pick: (r) => finite(r.totalDebt) },
  { code: 'shares_out', statement: 'balance', pick: (r) => finite(r.ordinarySharesNumber) },
  { code: 'dividends_paid', statement: 'returns', pick: (r) => { const v = finite((r as Record<string, unknown>).cashDividendsPaid); return v === null ? null : Math.abs(v) } },
]

/**
 * Pure: maps Yahoo quarterly + annual rows into a FinancialImportPayload with
 * source_type 'yahoo_finance'. No network I/O. Rows with no derivable period or
 * zero mappable fields are skipped.
 */
export function mapYahooRowsToPayload(fetch: YahooFundamentalsFetch, now: Date = new Date()): FinancialImportPayload {
  const nowIso = now.toISOString()
  const currency = fetch.currency || 'CLP'
  const symbol = fetch.symbol
  const reportingPeriods: ReportingPeriodImportRow[] = []
  const statementItems: StatementItemImportRow[] = []
  const metrics: FinancialMetricImportRow[] = []
  const seenPeriods = new Set<string>()

  const handle = (rows: YahooFundamentalsRow[], kind: 'quarterly' | 'annual') => {
    for (const row of rows) {
      const p = derivePeriod(row.date, kind)
      if (!p) continue
      const periodType = kind === 'quarterly' ? 'quarterly' : 'annual'
      const key = `${p.fiscalYear}|${p.fiscalPeriod}|${periodType}`
      if (seenPeriods.has(key)) continue // most recent wins if Yahoo repeats a period

      const items: StatementItemImportRow[] = []
      for (const f of STATEMENT_FIELDS) {
        const value = f.pick(row)
        if (value === null) continue
        items.push({
          ticker: fetch.ticker,
          fiscalYear: p.fiscalYear,
          fiscalPeriod: p.fiscalPeriod,
          periodType,
          statementType: f.statement,
          lineItemCode: f.code,
          lineItemName: f.code,
          value,
          unit: f.code === 'shares_out' ? 'shares' : currency,
          scale: 'units',
          sourceType: YAHOO_FINANCE_SOURCE_TYPE,
          sourceName: YAHOO_FINANCE_SOURCE_NAME,
          sourceUrl: `https://finance.yahoo.com/quote/${symbol}`,
          sourceFile: null,
          sourceAsOf: nowIso,
          metadata: { yahooSymbol: symbol, yahooPeriodType: kind === 'quarterly' ? '3M' : '12M' },
        })
      }
      if (items.length === 0) continue // nothing mappable — don't create an empty period

      seenPeriods.add(key)
      reportingPeriods.push({
        ticker: fetch.ticker,
        fiscalYear: p.fiscalYear,
        fiscalPeriod: p.fiscalPeriod,
        periodType,
        periodEndDate: p.periodEndDate,
        reportDate: null,
        currency,
        sourceType: YAHOO_FINANCE_SOURCE_TYPE,
        sourceName: YAHOO_FINANCE_SOURCE_NAME,
        sourceUrl: `https://finance.yahoo.com/quote/${symbol}`,
        sourceFile: null,
        sourceAsOf: nowIso,
        periodStartDate: p.periodStartDate,
        periodNature: kind === 'quarterly' ? 'quarterly_discrete' : 'annual',
        filingPeriodLabel: `${p.fiscalPeriod} ${p.fiscalYear}`,
      })
      statementItems.push(...items)

      // Derived-but-reported helper metrics the resolver reads from metricMap.
      const fcf = finite(row.freeCashFlow)
      if (fcf !== null) {
        metrics.push({
          ticker: fetch.ticker, fiscalYear: p.fiscalYear, fiscalPeriod: p.fiscalPeriod, periodType,
          metricCode: 'fcf', metricName: 'Free Cash Flow', value: fcf, unit: currency, calculationMethod: 'yahoo_reported',
          sourceType: YAHOO_FINANCE_SOURCE_TYPE, sourceName: YAHOO_FINANCE_SOURCE_NAME, sourceUrl: `https://finance.yahoo.com/quote/${symbol}`, sourceFile: null, sourceAsOf: nowIso,
        })
      }
      const rev = finite(row.totalRevenue)
      const ebitda = finite(row.EBITDA)
      if (rev !== null && rev !== 0 && ebitda !== null) {
        metrics.push({
          ticker: fetch.ticker, fiscalYear: p.fiscalYear, fiscalPeriod: p.fiscalPeriod, periodType,
          metricCode: 'ebitda_margin', metricName: 'EBITDA Margin', value: Math.round((ebitda / rev) * 1000) / 10, unit: '%', calculationMethod: 'derived_ebitda_over_revenue',
          sourceType: YAHOO_FINANCE_SOURCE_TYPE, sourceName: YAHOO_FINANCE_SOURCE_NAME, sourceUrl: `https://finance.yahoo.com/quote/${symbol}`, sourceFile: null, sourceAsOf: nowIso,
        })
      }
    }
  }

  handle(fetch.annual, 'annual')
  handle(fetch.quarterly, 'quarterly')

  return { reportingPeriods, statementItems, metrics, earningsEvents: [], errors: [] }
}

// ── Network side (never imported for tests of the pure mapper) ──────────────

/**
 * yahoo-finance2's `fundamentalsTimeSeries(..., { module: 'all' })` builds its
 * request from a very large field-type list and intermittently fails with a
 * "Failed to generate key for symbol=..." error — non-deterministically (a
 * given ticker may succeed on one call and fail on the next). This is
 * transient library flakiness, not "this ticker has no data", so it is
 * retried a few times before being treated as a real failure. Silently
 * swallowing it into an empty array would be indistinguishable from an
 * honestly-empty response — exactly what this app's no-fabrication doctrine
 * forbids.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 400): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let lastReason = 'unknown error'
  for (let i = 0; i < attempts; i++) {
    try {
      return { ok: true, value: await fn() }
    } catch (e) {
      lastReason = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return { ok: false, reason: lastReason }
}

/** Fetches Yahoo quarterly + annual fundamentals + financial currency for a ticker. Server-only. */
export async function fetchYahooFundamentals(ticker: string, opts?: { yearsBack?: number }): Promise<{ ok: true; value: YahooFundamentalsFetch } | { ok: false; reason: string }> {
  const symbol = yahooSymbolFor(ticker)
  if (!symbol) return { ok: false, reason: `no Yahoo symbol mapping for "${ticker}"` }

  const { default: YahooFinance } = await import('yahoo-finance2')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })

  const yearsBack = opts?.yearsBack ?? 6
  const period1 = new Date(Date.UTC(new Date().getUTCFullYear() - yearsBack, 0, 1)).toISOString().slice(0, 10)
  const period2 = new Date().toISOString().slice(0, 10)

  try {
    const [quarterlyRes, annualRes, summaryRes] = await Promise.all([
      withRetry(() => yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'quarterly', module: 'all' })),
      withRetry(() => yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'all' })),
      withRetry(() => yf.quoteSummary(symbol, { modules: ['financialData'] })),
    ])
    // Quarterly/annual failing after retries is a real fetch failure, not "no
    // data" — fail the whole ticker loudly so it's retried on the next run
    // rather than silently persisted with a missing history.
    if (!quarterlyRes.ok) return { ok: false, reason: `quarterly fetch failed after retries: ${quarterlyRes.reason}` }
    if (!annualRes.ok) return { ok: false, reason: `annual fetch failed after retries: ${annualRes.reason}` }
    const quarterly = quarterlyRes.value
    const annual = annualRes.value
    // The currency lookup is best-effort only (defaults to CLP) — it never
    // blocks ingestion, since a missing currency label doesn't invalidate the
    // (already-fetched) statement figures themselves.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = summaryRes.ok ? (summaryRes.value as any) : null
    const currency = (summary?.financialData?.financialCurrency as string | undefined)?.trim() || 'CLP'
    return {
      ok: true,
      value: {
        ticker: ticker.toUpperCase(),
        symbol,
        currency,
        quarterly: Array.isArray(quarterly) ? quarterly : [],
        annual: Array.isArray(annual) ? annual : [],
      },
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown Yahoo error' }
  }
}
