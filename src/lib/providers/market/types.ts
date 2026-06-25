// Phase 4C — Market data provider types.
//
// These types are shared between SERVER provider code and CLIENT fetch helpers.
// The file contains ONLY type declarations, so importing it from a client
// component is safe — all imports are erased at compile time.

import type { DataMode, DataSourceStatus, ProviderResult } from '../types'

export type { DataMode, DataSourceStatus, ProviderResult }

/** Metadata on every market data API response. Never contains secrets. */
export interface MarketDataMeta {
  dataModeRequested: DataMode
  dataModeUsed: DataMode
  liveAvailable: boolean
  status: DataSourceStatus
  source: string
  lastUpdated: string
  fallbackReason?: string
  provider?: string
}

/** Normalized stock price snapshot from any provider. */
export interface StockSnapshot {
  ticker: string
  price: number
  currency: string
  /** Absolute price change from previous close (may be null for static data). */
  dayChange: number | null
  dayChangePct: number
  ytdChangePct: number
  volume: number | null
  avgVolume30d: number | null
  /** Market cap in CLP millions (matches existing convention). */
  marketCapCLP: number | null
  lastUpdated: string
  source: string
  provider: string
  status: DataSourceStatus
}

/** Normalized OHLCV history point from any provider. */
export interface StockHistoryPoint {
  ticker: string
  date: string    // YYYY-MM-DD
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  source: string
  provider: string
}

/** Normalized index snapshot from any provider. */
export interface IndexSnapshot {
  id: string
  name: string
  country: string
  region: string
  value: number
  currency: string
  dayChangePct: number
  ytdChangePct: number
  lastUpdated: string
  source: string
  provider: string
  status: DataSourceStatus
}

/** Normalized sector performance from any provider. */
export interface SectorSnapshot {
  sector: string
  dayChangePct: number
  ytdChangePct: number
  numberOfStocks: number
  topContributor: string
  topContributorPct: number
  worstContributor: string
  worstContributorPct: number
  lastUpdated: string
  source: string
  provider: string
  status: DataSourceStatus
}

export type StockTimeframe = '1D' | '5D' | '1M' | 'MTD' | 'YTD' | '1Y' | '3Y' | '5Y'

/** Response envelopes returned by API routes. */
export interface StockSnapshotsResponse {
  data: StockSnapshot[]
  metadata: MarketDataMeta
}

export interface StockSnapshotResponse {
  data: StockSnapshot | null
  metadata: MarketDataMeta
}

export interface StockHistoryResponse {
  data: StockHistoryPoint[]
  metadata: MarketDataMeta
}

export interface IndexSnapshotsResponse {
  data: IndexSnapshot[]
  metadata: MarketDataMeta
}

export interface SectorSnapshotsResponse {
  data: SectorSnapshot[]
  metadata: MarketDataMeta
}

/** Contract every market data provider implements. */
export interface MarketProvider {
  name: string
  getStockSnapshots(): Promise<ProviderResult<StockSnapshot[]>>
  getStockSnapshot(ticker: string): Promise<ProviderResult<StockSnapshot | null>>
  getStockHistory(ticker: string, timeframe: StockTimeframe): Promise<ProviderResult<StockHistoryPoint[]>>
  getIndices(): Promise<ProviderResult<IndexSnapshot[]>>
  getSectors(): Promise<ProviderResult<SectorSnapshot[]>>
}
