// Phase 4C — Market data provider types.
//
// These types are shared between SERVER provider code and CLIENT fetch helpers.
// The file contains ONLY type declarations, so importing it from a client
// component is safe — all imports are erased at compile time.

import type { DataMode, DataSourceStatus, ProviderResult } from '../types'

export type { DataMode, DataSourceStatus, ProviderResult }

/**
 * Market-local mode type. MARKET_DATA_MODE is repurposed (Phase 4C.3) so its
 * three values are static|supabase|hybrid — 'supabase' reads persisted Yahoo
 * Finance snapshots instead of attempting a live paid provider. This is
 * intentionally a separate type from the shared DataMode ('static'|'live'|
 * 'hybrid') used by macro/CMF, so those domains are unaffected.
 */
export type MarketMode = 'static' | 'supabase' | 'hybrid'

/** Metadata on every market data API response. Never contains secrets. */
export interface MarketDataMeta {
  dataModeRequested: MarketMode
  dataModeUsed: MarketMode
  liveAvailable: boolean
  status: DataSourceStatus
  source: string
  lastUpdated: string
  fallbackReason?: string
  provider?: string
  // Phase 4C.3 — Supabase-as-default-baseline metadata (all optional, additive).
  /** MARKET_DATA_MODE as requested by env (mirrors dataModeRequested; explicit for clarity in API responses). */
  marketDataModeRequested?: string
  /** MARKET_DATA_MODE actually used to serve this response. */
  marketDataModeUsed?: string
  /** True when persisted Supabase snapshot rows were found (regardless of staleness). */
  persistedAvailable?: boolean
  /** snapshot_date of the most recent persisted row used, if any. */
  latestSnapshotDate?: string | null
  /** snapshot_type of the most recent persisted row used, if any. */
  latestSnapshotType?: string | null
  /** ingestion_runs.id of the most recent Yahoo Finance ingestion run, if known. */
  latestIngestionRunId?: string | null
  /** Number of deduplicated rows returned from Supabase for this entity. */
  snapshotCount?: number
  /** True when hybrid mode fell through to static because Supabase data was empty/stale/errored. */
  staleFallbackUsed?: boolean
  /** True when at least one returned row carries proxy metadata (e.g. COLCAP/BVL proxies). */
  proxyMetadataPresent?: boolean
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
