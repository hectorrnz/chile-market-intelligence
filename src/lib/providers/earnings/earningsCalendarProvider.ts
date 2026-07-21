// CMF earnings-calendar orchestrator — SERVER-ONLY.
//
// Fetches CMF's EEFF-sending-date calendar for the current + next year, maps
// each issuer row to one of the app's tracked tickers by RUT, and flattens the
// four quarter columns into a sorted list of report-date events. Never
// fabricates a date: an issuer absent from CMF (BSANTANDER, ITAUCL) simply has
// no event, and is surfaced honestly via `missingTickers`.
//
// Uses relative imports with explicit .ts extensions so the pure helpers
// (buildEarningsEvents, upcomingEvents) run under Node's native test runner.

import {
  fetchCmfEarningsYear,
  type CmfEarningsRow,
  type CmfFetcher,
} from './cmfEarningsClient.ts'
import { RUT_TO_TICKER, UNLISTED_EARNINGS_TICKERS } from '../../../config/cmfEarningsCalendarMap.ts'

const SOURCE = 'Comisión para el Mercado Financiero (CMF)'

export type EarningsPeriod = 'Q1' | 'Q2' | 'Q3' | 'Annual'

export interface EarningsCalendarEvent {
  ticker: string
  /** Report/EEFF-sending date, YYYY-MM-DD. */
  reportDate: string
  period: EarningsPeriod
}

export interface EarningsCalendarResult {
  status: 'live' | 'unavailable'
  /** ISO timestamp the calendar was resolved. */
  asOf: string
  source: string
  /** All mapped events for tracked tickers, sorted ascending by date. */
  events: EarningsCalendarEvent[]
  /** Tracked tickers CMF publishes no date for (documented gap, e.g. Santander/Itaú). */
  missingTickers: string[]
}

const PERIOD_DEFS: { key: keyof CmfEarningsRow; period: EarningsPeriod }[] = [
  { key: 'q1Mar', period: 'Q1' },
  { key: 'q2Jun', period: 'Q2' },
  { key: 'q3Sep', period: 'Q3' },
  { key: 'annualDec', period: 'Annual' },
]

/**
 * Flattens CMF rows (possibly spanning multiple years) into sorted, deduped
 * events for tracked tickers only. Pure — no network.
 */
export function buildEarningsEvents(rows: CmfEarningsRow[]): EarningsCalendarEvent[] {
  const seen = new Set<string>()
  const events: EarningsCalendarEvent[] = []
  for (const row of rows) {
    const ticker = RUT_TO_TICKER[row.rutPrefix]
    if (!ticker) continue
    for (const { key, period } of PERIOD_DEFS) {
      const d = row[key]
      if (typeof d !== 'string' || !d) continue
      const id = `${ticker}|${d}`
      if (seen.has(id)) continue
      seen.add(id)
      events.push({ ticker, reportDate: d, period })
    }
  }
  events.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.ticker.localeCompare(b.ticker))
  return events
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Events whose report date falls within [today, today + days]. Pure. */
export function upcomingEvents(
  events: EarningsCalendarEvent[],
  now: Date,
  days: number,
): EarningsCalendarEvent[] {
  const todayIso = toIsoDate(now)
  const endIso = toIsoDate(new Date(now.getTime() + days * 86_400_000))
  return events.filter((e) => e.reportDate >= todayIso && e.reportDate <= endIso)
}

/**
 * Resolves the live CMF earnings calendar. Fetches the current + next year so a
 * next-quarter date that spills into January (e.g. an annual filed in late
 * January) is always captured. Any year that fails to fetch is skipped; only if
 * ALL fail is the result 'unavailable'.
 */
export async function resolveEarningsCalendar(opts?: {
  years?: number[]
  fetcher?: CmfFetcher
  now?: Date
}): Promise<EarningsCalendarResult> {
  const now = opts?.now ?? new Date()
  const years = opts?.years ?? [now.getUTCFullYear(), now.getUTCFullYear() + 1]

  // Fetch the years in parallel so total latency ≈ a single request (keeps well
  // under a serverless function's max duration). Any year that fails is skipped;
  // only if ALL fail is the result 'unavailable'.
  const results = await Promise.allSettled(
    years.map((year) => fetchCmfEarningsYear(year, opts?.fetcher)),
  )
  let allRows: CmfEarningsRow[] = []
  let anyOk = false
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      allRows = allRows.concat(r.value)
      anyOk = true
    }
  }

  if (!anyOk) {
    return {
      status: 'unavailable',
      asOf: now.toISOString(),
      source: SOURCE,
      events: [],
      missingTickers: UNLISTED_EARNINGS_TICKERS,
    }
  }

  return {
    status: 'live',
    asOf: now.toISOString(),
    source: SOURCE,
    events: buildEarningsEvents(allRows),
    missingTickers: UNLISTED_EARNINGS_TICKERS,
  }
}
