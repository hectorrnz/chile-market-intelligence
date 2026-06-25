// Phase 4C — Static market data provider.
//
// Wraps the existing static JSON data layer behind the MarketProvider contract.
// SERVER-side (imported only by the orchestrator / route handlers), but reads
// only isomorphic JSON, so it carries no secrets.

import type { MarketProvider, StockSnapshot, StockHistoryPoint, IndexSnapshot, SectorSnapshot, StockTimeframe } from './types'
import type { ProviderResult } from '../types'
import { getAllSnapshots, getSnapshotByTicker } from '../../data/stocks'
import { getStockHistoryForTimeframe } from '../../data/stockHistory'
import { getIndexPerformance } from '../../data/indexPerformance'
import { getSectorPerformance } from '../../data/sectorPerformance'
import { DATA_AS_OF } from '../../constants'

const STATIC_SOURCE = 'Static MVP'
const STATIC_PROVIDER = 'static'

function toSnapshot(raw: ReturnType<typeof getAllSnapshots>[number]): StockSnapshot {
  return {
    ticker: raw.ticker,
    price: raw.price,
    currency: raw.currency,
    dayChange: null,   // static data has only dayChangePct, not absolute change
    dayChangePct: raw.dayChangePct,
    ytdChangePct: raw.ytdChangePct,
    volume: raw.volume ?? null,
    avgVolume30d: raw.avgVolume30d ?? null,
    marketCapCLP: raw.marketCapCLP ?? null,
    lastUpdated: raw.lastUpdated,
    source: STATIC_SOURCE,
    provider: STATIC_PROVIDER,
    status: 'static',
  }
}

export const staticMarketProvider: MarketProvider = {
  name: 'static',

  async getStockSnapshots(): Promise<ProviderResult<StockSnapshot[]>> {
    return {
      ok: true,
      data: getAllSnapshots().map(toSnapshot),
      source: STATIC_SOURCE,
      lastUpdated: DATA_AS_OF,
    }
  },

  async getStockSnapshot(ticker: string): Promise<ProviderResult<StockSnapshot | null>> {
    const raw = getSnapshotByTicker(ticker)
    return {
      ok: true,
      data: raw ? toSnapshot(raw) : null,
      source: STATIC_SOURCE,
      lastUpdated: DATA_AS_OF,
    }
  },

  async getStockHistory(ticker: string, timeframe: StockTimeframe): Promise<ProviderResult<StockHistoryPoint[]>> {
    const points = getStockHistoryForTimeframe(ticker, timeframe)
    const data: StockHistoryPoint[] = points.map(p => ({
      ticker: p.ticker,
      date: p.date,
      open: null,   // static data has only close price
      high: null,
      low: null,
      close: p.price,
      volume: null,
      source: STATIC_SOURCE,
      provider: STATIC_PROVIDER,
    }))
    return { ok: true, data, source: STATIC_SOURCE, lastUpdated: DATA_AS_OF }
  },

  async getIndices(): Promise<ProviderResult<IndexSnapshot[]>> {
    const data: IndexSnapshot[] = getIndexPerformance().map(idx => ({
      id: idx.id,
      name: idx.name,
      country: idx.country,
      region: idx.region,
      value: idx.value,
      currency: idx.currency,
      dayChangePct: idx.dayChangePct,
      ytdChangePct: idx.ytdChangePct,
      lastUpdated: idx.date,
      source: STATIC_SOURCE,
      provider: STATIC_PROVIDER,
      status: 'static' as const,
    }))
    return { ok: true, data, source: STATIC_SOURCE, lastUpdated: DATA_AS_OF }
  },

  async getSectors(): Promise<ProviderResult<SectorSnapshot[]>> {
    const data: SectorSnapshot[] = getSectorPerformance().map(s => ({
      sector: s.sector,
      dayChangePct: s.dayChangePct,
      ytdChangePct: s.ytdChangePct,
      numberOfStocks: s.numberOfStocks,
      topContributor: s.topContributor,
      topContributorPct: s.topContributorPct,
      worstContributor: s.worstContributor,
      worstContributorPct: s.worstContributorPct,
      lastUpdated: s.lastUpdated,
      source: STATIC_SOURCE,
      provider: STATIC_PROVIDER,
      status: 'static' as const,
    }))
    return { ok: true, data, source: STATIC_SOURCE, lastUpdated: DATA_AS_OF }
  },
}
