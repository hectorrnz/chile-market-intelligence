// 2026-07-20 — Compare's Comparative Returns table + Cumulative Return chart,
// wired to real historical data.
//
// Reuses resolveStockHistory() (the same resolver the Company-page price
// chart and Compare's own Market Data 1D/5D/1M/YTD/1Y performance columns
// already use) — no new provider, no new sufficiency logic. resolveStockHistory
// itself now tries a live Yahoo Finance historical fetch before falling back
// to Supabase-persisted-accumulation and then static (see marketProvider.ts /
// yahooHistoryProvider.ts) — this module just forwards whichever status comes
// back.
//
// IPSA benchmark: previously always static, because the persisted
// stock_snapshots table never covered it (only the 25 tracked equities are
// snapshotted). That limitation doesn't apply to the live Yahoo tier — IPSA
// resolves via the index map (see yahooHistoryProvider.ts) — so IPSA is now
// resolved the same way as any other ticker when the caller asks for it
// (normalizeCompareTickers only validates real companies, so IPSA is handled
// as a special case here rather than being rejected as invalid).
//
// SERVER-ONLY — resolveStockHistory transitively imports Supabase repository
// code. Never import this from a client component; go through
// /api/compare/history + src/lib/data/compareHistory.ts instead.

import { resolveStockHistory } from '../providers/market/marketProvider.ts'
import type { StockTimeframe } from '../providers/market/types.ts'
import { normalizeCompareTickers } from './compareStatic.ts'

/** The timeframes the Comparative Returns table/chart actually offer — kept
 *  in sync with the `TF` array in compare/page.tsx. Never resolve a
 *  timeframe the UI doesn't expose. */
export const COMPARE_HISTORY_TIMEFRAMES: readonly StockTimeframe[] = ['1M', 'YTD', '1Y', '3Y', '5Y']

const IPSA_BENCHMARK_TICKER = 'IPSA'

export type CompareHistoryStatus = 'live' | 'persisted' | 'static_fallback'

export interface CompareHistorySeries {
  ticker: string
  /** Only populated when status is 'live'/'persisted' — the caller already
   *  has its own static series and should use that instead when this is empty. */
  points: { date: string; value: number }[]
  status: CompareHistoryStatus
  source: string | null
  asOfDate: string | null
  /** Set only when static_fallback was reached because persisted history
   *  exists but doesn't yet cover the requested window (never for any other
   *  static reason) — lets the UI say "still accumulating" instead of a bare
   *  "Static sample" that reads as permanent. See resolveStockHistory's
   *  fallbackReason / isSufficientMarketHistory in marketHistory.ts. */
  insufficientHistoryReason: string | null
}

export interface CompareHistoryResult {
  series: CompareHistorySeries[]
  invalidTickers: string[]
}

async function resolveOne(ticker: string, timeframe: StockTimeframe): Promise<CompareHistorySeries> {
  const resp = await resolveStockHistory(ticker, timeframe)
  if ((resp.metadata.status === 'live' || resp.metadata.status === 'persisted') && resp.data.length >= 2) {
    return {
      ticker,
      points: resp.data.map((p) => ({ date: p.date, value: p.close })),
      status: resp.metadata.status,
      source: resp.metadata.source || null,
      asOfDate: resp.metadata.lastUpdated || null,
      insufficientHistoryReason: null,
    }
  }
  const reason = resp.metadata.fallbackReason
  return {
    ticker,
    points: [],
    status: 'static_fallback',
    source: null,
    asOfDate: null,
    insufficientHistoryReason: reason && /insufficient/i.test(reason) ? reason : null,
  }
}

export async function resolveCompareHistory(
  tickersInput: string[],
  timeframe: StockTimeframe,
): Promise<CompareHistoryResult> {
  const wantsIpsa = tickersInput.some((t) => t.trim().toUpperCase() === IPSA_BENCHMARK_TICKER)
  const { valid, invalid } = normalizeCompareTickers(
    tickersInput.filter((t) => t.trim().toUpperCase() !== IPSA_BENCHMARK_TICKER),
  )

  if ((valid.length === 0 && !wantsIpsa) || !COMPARE_HISTORY_TIMEFRAMES.includes(timeframe)) {
    return { series: [], invalidTickers: invalid }
  }

  const tickersToResolve = wantsIpsa ? [...valid, IPSA_BENCHMARK_TICKER] : valid
  const series = await Promise.all(tickersToResolve.map((ticker) => resolveOne(ticker, timeframe)))

  return { series, invalidTickers: invalid }
}
