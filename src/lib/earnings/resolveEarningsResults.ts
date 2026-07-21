// Live quarterly earnings results — SERVER-ONLY.
//
// Replaces the Earnings tab's fabricated static sample (src/data/earnings.json:
// invented revenue/EBITDA figures, a synthetic "consensus", and an editorial
// Clean/Mixed/Weak "result quality" judgment that was never a real assessment)
// with genuine reported quarterly financials from Yahoo Finance — the same
// provider already backing Charting, Compare and the company-page valuation.
//
// Rolling window (explicit product requirement): each ticker shows its TWO most
// recent reported quarters — the latest plus the one before it. When a new
// quarter is reported it enters and the older one drops off automatically,
// because the window is always derived from the sorted period list rather than
// a hand-maintained list.
//
// YoY is computed against the SAME quarter one year earlier (period end 4
// quarters back), never the sequential prior quarter — a quarter-over-quarter
// number labelled "YoY" would be wrong for seasonal businesses.
//
// Banks (BSANTANDER, CHILE, BCI, ITAUCL) do not report EBITDA — the field stays
// null and renders as "—". Net interest margin (NIM) is NOT published by Yahoo
// (it requires net interest income over average earning assets, which no free
// source we have exposes per quarter), so it is deliberately absent rather than
// derived from an approximation and presented as a real reported figure.

import { TICKER_YF } from '@/lib/market/liveOverlay'
import { getAllCompanies } from '@/lib/data/companies'
import { yahooSymbolFor } from '@/lib/financials/providers/yahooFundamentalsProvider'
import { buildResultRows, type EarningsResultRow, type QuarterRow } from './earningsResultsCore'

const SOURCE = 'Yahoo Finance'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // quarterly financials change a few times a year
const FETCH_CONCURRENCY = 6

export type { EarningsResultRow, QuarterRow }

export interface EarningsResultsPayload {
  status: 'live' | 'unavailable'
  asOf: string
  source: string
  rows: EarningsResultRow[]
  /** Tickers whose fundamentals could not be fetched (honest gap, never faked). */
  missingTickers: string[]
}

// ── Network side ────────────────────────────────────────────────────────────

let cache: { at: number; payload: EarningsResultsPayload } | null = null

async function fetchQuarterly(
  ticker: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yf: any,
): Promise<{ rows: QuarterRow[]; currency: string } | null> {
  const symbol = yahooSymbolFor(ticker)
  if (!symbol) return null
  const period1 = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 1)).toISOString().slice(0, 10)
  const period2 = new Date().toISOString().slice(0, 10)
  try {
    const [rows, summary] = await Promise.all([
      yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'quarterly', module: 'all' }),
      yf.quoteSummary(symbol, { modules: ['financialData'] }, { validateResult: false }).catch(() => null),
    ])
    if (!Array.isArray(rows) || rows.length === 0) return null
    const currency = (summary?.financialData?.financialCurrency as string | undefined)?.trim() || 'CLP'
    return { rows, currency }
  } catch {
    return null
  }
}

/** Runs `worker` over `items` with a bounded concurrency (Yahoo rate-limits bursts). */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await worker(items[i])
      }
    }),
  )
  return results
}

/**
 * Resolves the two most recent reported quarters for every tracked ticker.
 * Cached for 6h — quarterly financials change a handful of times a year, and
 * this fans out one Yahoo request per ticker. Never throws.
 */
export async function resolveEarningsResults(opts?: { force?: boolean }): Promise<EarningsResultsPayload> {
  if (!opts?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload

  const companies = getAllCompanies()
  const nameOf = new Map(companies.map((c) => [c.ticker.toUpperCase(), c.name]))
  const tickers = Object.keys(TICKER_YF)

  const { default: YahooFinance } = await import('yahoo-finance2')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })

  const fetched = await mapLimit(tickers, FETCH_CONCURRENCY, async (ticker) => ({
    ticker,
    data: await fetchQuarterly(ticker, yf),
  }))

  const rows: EarningsResultRow[] = []
  const missingTickers: string[] = []
  for (const { ticker, data } of fetched) {
    if (!data) { missingTickers.push(ticker); continue }
    const built = buildResultRows(ticker, nameOf.get(ticker.toUpperCase()) ?? ticker, data.currency, data.rows)
    if (built.length === 0) missingTickers.push(ticker)
    rows.push(...built)
  }

  // Newest reported quarter first, so the freshest results lead the table.
  rows.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.ticker.localeCompare(b.ticker))

  const payload: EarningsResultsPayload = {
    status: rows.length > 0 ? 'live' : 'unavailable',
    asOf: new Date().toISOString(),
    source: SOURCE,
    rows,
    missingTickers,
  }
  if (rows.length > 0) cache = { at: Date.now(), payload }
  return payload
}
