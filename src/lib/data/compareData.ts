// Phase 8B — Client-safe Compare data fetch helper.
// Components call this to hit /api/compare — never the resolver or Supabase
// directly. Mirrors the fetchStockSnapshots pattern in marketData.ts.

import type { CompareResolveResult } from '@/lib/compare/compareTypes'

export async function fetchCompareData(tickers: string[]): Promise<CompareResolveResult> {
  if (tickers.length === 0) {
    return {
      data: [],
      metadata: {
        marketDataModeRequested: 'static',
        marketDataModeUsed: 'static',
        persistedAvailable: false,
        staticFallbackUsed: false,
        latestSnapshotDate: null,
        invalidTickers: [],
      },
    }
  }
  const query = tickers.map((t) => encodeURIComponent(t)).join(',')
  const res = await fetch(`/api/compare?tickers=${query}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/compare returned ${res.status}`)
  return res.json()
}
