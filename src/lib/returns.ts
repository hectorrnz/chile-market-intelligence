// Pure return-math helpers — extracted so they can be unit-tested and reused
// across the Compare tab and any future performance views.

export interface ReturnStats {
  /** Total return over the window, in percent. */
  tr: number
  /** Annualized (CAGR) return, in percent. */
  annual: number
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Total return and annualized (CAGR) return for a price series.
 * Returns null when there are fewer than two points.
 */
export function totalAndAnnual(data: { date: string; value: number }[]): ReturnStats | null {
  if (data.length < 2) return null
  const f = data[0].value
  const l = data[data.length - 1].value
  if (f === 0) return null
  const tr = (l / f - 1) * 100
  const days = (new Date(data[data.length - 1].date).getTime() - new Date(data[0].date).getTime()) / 86_400_000
  const annual = days > 0 ? (Math.pow(l / f, 365 / days) - 1) * 100 : tr
  return { tr, annual }
}

export type Timeframe = '1M' | 'YTD' | '1Y' | '3Y' | '5Y'

/** Resolve the start date for a timeframe relative to an end date (YYYY-MM-DD). */
export function tfStart(end: string, tf: Timeframe): string {
  const d = new Date(end)
  if (tf === 'YTD') return `${end.slice(0, 4)}-01-01`
  if (tf === '1M') d.setMonth(d.getMonth() - 1)
  if (tf === '1Y') d.setFullYear(d.getFullYear() - 1)
  if (tf === '3Y') d.setFullYear(d.getFullYear() - 3)
  if (tf === '5Y') d.setFullYear(d.getFullYear() - 5)
  return iso(d)
}
