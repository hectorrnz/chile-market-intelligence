import rawHistory from '@/data/stockHistory.json'
import type { StockHistoryPoint } from '@/types'

const history = rawHistory as StockHistoryPoint[]

export type StockTimeframe = '1D' | '5D' | '1M' | 'MTD' | 'YTD' | '1Y' | '3Y' | '5Y'

export function getStockHistory(ticker: string): StockHistoryPoint[] {
  return history.filter(p => p.ticker === ticker)
}

/** Series at a chosen sampling period — for the Compare tool's Daily/Weekly/Monthly control. */
export function getStockSeriesByPeriod(ticker: string, period: 'D' | 'W' | 'M'): StockHistoryPoint[] {
  if (period === 'D') return dailyFor(ticker)
  const weekly = weeklyFor(ticker)
  if (period === 'W') return weekly
  // Monthly: last weekly point of each calendar month
  const m = new Map<string, StockHistoryPoint>()
  for (const p of weekly) m.set(p.date.slice(0, 7), p)
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function dailyFor(ticker: string): StockHistoryPoint[] {
  return history
    .filter(p => p.ticker === ticker && p.type === 'daily')
    .sort((a, b) => a.date.localeCompare(b.date))
}

function weeklyFor(ticker: string): StockHistoryPoint[] {
  return history
    .filter(p => p.ticker === ticker && p.type === 'weekly')
    .sort((a, b) => a.date.localeCompare(b.date))
}

function quarterlyFor(ticker: string): StockHistoryPoint[] {
  return history
    .filter(p => p.ticker === ticker && p.type === 'quarterly')
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Slice the right granularity for each timeframe:
 *  - Short ranges (1D…1Y) use the daily series — real day-to-day movement.
 *  - Long ranges (3Y, 5Y) use the weekly series.
 */
export function getStockHistoryForTimeframe(
  ticker: string,
  timeframe: StockTimeframe
): StockHistoryPoint[] {
  const daily = dailyFor(ticker)

  if (timeframe === '3Y') {
    const weekly = weeklyFor(ticker)
    return weekly.length ? weekly.slice(-156) : quarterlyFor(ticker).slice(-12)
  }
  if (timeframe === '5Y') {
    const weekly = weeklyFor(ticker)
    return weekly.length ? weekly : quarterlyFor(ticker)
  }

  if (daily.length === 0) return quarterlyFor(ticker).slice(-4)

  const lastDate = daily[daily.length - 1].date // YYYY-MM-DD
  const lastYear = lastDate.slice(0, 4)
  const lastMonth = lastDate.slice(0, 7)

  switch (timeframe) {
    case '1D':  return daily.slice(-2)
    case '5D':  return daily.slice(-5)
    case '1M':  return daily.slice(-22)
    case 'MTD': return daily.filter(p => p.date.slice(0, 7) === lastMonth)
    case 'YTD': return daily.filter(p => p.date.slice(0, 4) === lastYear)
    case '1Y':  return daily.slice(-252)
    default:    return daily
  }
}
