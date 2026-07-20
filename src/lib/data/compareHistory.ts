// 2026-07-20 — Client-safe fetch helper for Compare's persisted returns
// history. Components call this to hit /api/compare/history — never the
// resolver or Supabase directly. Mirrors fetchCompareData's pattern.

export interface CompareHistorySeries {
  ticker: string
  points: { date: string; value: number }[]
  status: 'persisted' | 'static_fallback'
  source: string | null
  asOfDate: string | null
}

export interface CompareHistoryResult {
  series: CompareHistorySeries[]
  invalidTickers: string[]
}

export async function fetchCompareHistory(tickers: string[], timeframe: string): Promise<CompareHistoryResult> {
  if (tickers.length === 0) return { series: [], invalidTickers: [] }
  const query = tickers.map((t) => encodeURIComponent(t)).join(',')
  const res = await fetch(`/api/compare/history?tickers=${query}&timeframe=${encodeURIComponent(timeframe)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/compare/history returned ${res.status}`)
  return res.json()
}
