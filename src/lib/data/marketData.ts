// Phase 4C — Client-safe market data fetch helpers.
//
// Mirrors the macro fetchMacroIndicators pattern. Components call these
// async helpers to optionally upgrade from static JSON to live /api/market
// data. The sync helpers (getAllSnapshots, getIndexPerformance, etc.) remain
// for the initial static render.
//
// These functions are safe to import in client components — they only call
// our own /api/market routes, never Brain Data directly.

import type { StockSnapshotsResponse, StockSnapshotResponse, StockHistoryResponse, IndexSnapshotsResponse, SectorSnapshotsResponse, StockTimeframe } from '@/lib/providers/market/types'

/** Fetch all stock snapshots. Falls back to static server-side rendering when called in RSC. */
export async function fetchStockSnapshots(): Promise<StockSnapshotsResponse> {
  const res = await fetch('/api/market/stocks', { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/market/stocks returned ${res.status}`)
  return res.json()
}

/** Fetch a single stock snapshot by ticker. */
export async function fetchStockSnapshot(ticker: string): Promise<StockSnapshotResponse> {
  const res = await fetch(`/api/market/stocks/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/market/stocks/${ticker} returned ${res.status}`)
  return res.json()
}

/** Fetch stock price history for the given ticker and timeframe. */
export async function fetchStockHistory(ticker: string, timeframe: StockTimeframe): Promise<StockHistoryResponse> {
  const res = await fetch(`/api/market/stocks/${encodeURIComponent(ticker)}/history?timeframe=${timeframe}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/market/stocks/${ticker}/history returned ${res.status}`)
  return res.json()
}

/** Fetch index performance (IPSA, LatAm, global). */
export async function fetchIndexPerformance(): Promise<IndexSnapshotsResponse> {
  const res = await fetch('/api/market/indices', { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/market/indices returned ${res.status}`)
  return res.json()
}

/** Fetch sector performance (Chilean sector heat map). */
export async function fetchSectorPerformance(): Promise<SectorSnapshotsResponse> {
  const res = await fetch('/api/market/sectors', { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/market/sectors returned ${res.status}`)
  return res.json()
}
