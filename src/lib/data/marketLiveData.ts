// Client-side helper for the live market snapshot route.
// Import types here so pages don't need to import from the server-only route file.

export interface StockLive {
  price: number
  dayChangePct: number
  marketCapCLP: number | null
}

export interface SectorLive {
  sector: string
  dayChangePct: number
  ytdChangePct: number
  numberOfStocks: number
  topContributor: string
  topContributorPct: number
  worstContributor: string
  worstContributorPct: number
}

export interface IndexLive {
  id: string
  value: number
  dayChangePct: number
  ytdChangePct: number
}

export interface LiveSnapshot {
  stocks: Record<string, StockLive>
  sectors: SectorLive[]
  indices: IndexLive[]
  lastUpdated: string
}

/** Fetch a fresh market snapshot from the live-snapshot API route. Returns null on failure. */
export async function fetchLiveSnapshot(signal?: AbortSignal): Promise<LiveSnapshot | null> {
  try {
    const res = await fetch('/api/market/live-snapshot', { signal, cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as LiveSnapshot
  } catch {
    return null
  }
}

/** Format a live snapshot timestamp as "Jun 30, 18:30 SCL". */
export function formatLiveTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Santiago',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' SCL'
  } catch {
    return iso
  }
}
