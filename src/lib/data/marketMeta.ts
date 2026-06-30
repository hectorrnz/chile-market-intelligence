import rawMeta from '@/data/marketMeta.json'

export interface MarketMeta {
  lastUpdated: string | null
  source: string
  tickersRefreshed: number
  indicesRefreshed: number
}

export function getMarketMeta(): MarketMeta {
  return rawMeta as MarketMeta
}

/**
 * Returns a human-readable "Jun 30, 18:30 SCL" string in Santiago time,
 * or null if the data has never been refreshed (still on static MVP values).
 */
export function formatMarketLastUpdated(): string | null {
  const raw = (rawMeta as MarketMeta).lastUpdated
  if (!raw) return null
  try {
    const d = new Date(raw)
    const parts = d.toLocaleString('en-US', {
      timeZone: 'America/Santiago',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    return `${parts} SCL`
  } catch {
    return null
  }
}
