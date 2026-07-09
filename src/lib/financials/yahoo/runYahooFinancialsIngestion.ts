// Phase 8C.5 — Yahoo Finance fundamentals ingestion orchestrator.
//
// Fetches Yahoo quarterly + annual fundamentals for a set of tickers and writes
// them into the SAME source-agnostic financials tables (via the existing
// repository upserts) that manual CSV and CMF/XBRL use. Yahoo rows carry
// source_type 'yahoo_finance' (priority 80): CMF/XBRL annual (210) supersedes
// Yahoo annual for the same fiscal year automatically; Yahoo quarterly always
// coexists. This is what gives every one of the 25 app stocks — banks included —
// working quarterly + annual + TTM data in Charting/Compare/Earnings.
//
// Design guarantees mirror the CMF orchestrator: per-ticker isolation (one
// ticker's failure never aborts the batch), never fabricates (missing fields
// were already dropped by the pure mapper), dryRun by default, sanitized errors.

import { TICKER_YF } from '../../market/liveOverlay.ts'
import { fetchYahooFundamentals, mapYahooRowsToPayload } from '../providers/yahooFundamentalsProvider.ts'

export interface PerTickerYahooResult {
  ticker: string
  status: 'ingested' | 'dry_run_ok' | 'no_data' | 'error'
  currency: string | null
  quarterlyPeriods: number
  annualPeriods: number
  statementItems: number
  metrics: number
  rowsWritten: number
  reason: string | null
}

export interface YahooIngestionSummary {
  status: 'success' | 'partial_success' | 'failed' | 'skipped'
  tickersAttempted: number
  tickersSucceeded: number
  tickersFailed: number
  periodsSeen: number
  rowsWritten: number
  startedAt: string
  completedAt: string
  tickers: PerTickerYahooResult[]
  errors: string[]
}

export interface RunYahooIngestionOptions {
  tickers?: string[]
  write?: boolean
  ingestionRunId?: string | null
  yearsBack?: number
  now?: Date
}

function sanitize(msg: string): string {
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***').replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***').slice(0, 300)
}

/** Every app ticker that has a Yahoo symbol mapping (all 25). */
export function getYahooTickers(): string[] {
  return Object.keys(TICKER_YF)
}

async function ingestTicker(ticker: string, opts: { write: boolean; ingestionRunId: string | null; yearsBack: number; now: Date }): Promise<PerTickerYahooResult> {
  const base: PerTickerYahooResult = {
    ticker, status: 'error', currency: null, quarterlyPeriods: 0, annualPeriods: 0, statementItems: 0, metrics: 0, rowsWritten: 0, reason: null,
  }
  try {
    const fetched = await fetchYahooFundamentals(ticker, { yearsBack: opts.yearsBack })
    if (!fetched.ok) return { ...base, status: 'error', reason: fetched.reason }

    const payload = mapYahooRowsToPayload(fetched.value, opts.now)
    const quarterlyPeriods = payload.reportingPeriods.filter((p) => p.periodType === 'quarterly').length
    const annualPeriods = payload.reportingPeriods.filter((p) => p.periodType === 'annual').length
    const result: PerTickerYahooResult = {
      ...base, currency: fetched.value.currency, quarterlyPeriods, annualPeriods,
      statementItems: payload.statementItems.length, metrics: payload.metrics.length, status: 'dry_run_ok',
    }
    if (payload.reportingPeriods.length === 0) return { ...result, status: 'no_data', reason: 'Yahoo returned no mappable periods' }

    if (opts.write) {
      const { upsertReportingPeriods, upsertStatementItems, upsertFinancialMetrics } = await import('../../db/repositories/financialsRepository.ts')
      const periods = await upsertReportingPeriods(payload.reportingPeriods, opts.ingestionRunId)
      const items = await upsertStatementItems(payload.statementItems, periods.idsByKey, opts.ingestionRunId)
      const mets = await upsertFinancialMetrics(payload.metrics, periods.idsByKey, opts.ingestionRunId)
      const errs = [...periods.errors, ...items.errors, ...mets.errors]
      if (errs.length > 0) return { ...result, status: 'error', reason: sanitize(errs.slice(0, 3).join('; ')) }
      result.status = 'ingested'
      result.rowsWritten = periods.inserted + items.inserted + mets.inserted
    }
    return result
  } catch (e) {
    return { ...base, status: 'error', reason: sanitize(e instanceof Error ? e.message : 'unknown error') }
  }
}

export async function runYahooFinancialsIngestion(options: RunYahooIngestionOptions = {}): Promise<YahooIngestionSummary> {
  const now = options.now ?? new Date()
  const startedAt = now.toISOString()
  const tickers = (options.tickers && options.tickers.length > 0 ? options.tickers : getYahooTickers()).map((t) => t.toUpperCase())
  const write = options.write ?? false
  const yearsBack = options.yearsBack ?? 6

  const results: PerTickerYahooResult[] = []
  const errors: string[] = []
  for (const ticker of tickers) {
    const r = await ingestTicker(ticker, { write, ingestionRunId: options.ingestionRunId ?? null, yearsBack, now })
    if (r.status === 'error' && r.reason) errors.push(`${ticker}: ${r.reason}`)
    results.push(r)
  }

  const succeeded = results.filter((r) => r.status === 'ingested' || r.status === 'dry_run_ok').length
  const failed = results.filter((r) => r.status === 'error').length
  let status: YahooIngestionSummary['status']
  if (results.length === 0) status = 'skipped'
  else if (succeeded > 0 && failed > 0) status = 'partial_success'
  else if (succeeded > 0) status = 'success'
  else status = 'failed'

  return {
    status,
    tickersAttempted: results.length,
    tickersSucceeded: succeeded,
    tickersFailed: failed,
    periodsSeen: results.reduce((n, r) => n + r.quarterlyPeriods + r.annualPeriods, 0),
    rowsWritten: results.reduce((n, r) => n + r.rowsWritten, 0),
    startedAt,
    completedAt: new Date().toISOString(),
    tickers: results,
    errors,
  }
}
