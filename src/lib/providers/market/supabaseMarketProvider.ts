// Phase 4C.3 — Supabase-persisted Yahoo Finance market provider.
//
// SERVER-ONLY. Reads the latest deduplicated stock/index/sector snapshots
// written by the Phase 4C.2 ingestion pipeline (scripts/ingest + the
// /api/cron/ingest-market-snapshot route — neither touched by this provider).
// This is the new default "live" baseline when MARKET_DATA_MODE=supabase or
// hybrid: it replaces brainDataProvider in the orchestrator, which remains
// unhooked but in place for a future real paid-provider integration.
//
// LIMITATION (Phase 4C.3 scope): getStockHistory always returns ok:false.
// There is no historical OHLCV table populated by the Yahoo ingestion
// pipeline yet (only point-in-time snapshots) — persisted history is future
// work (tracked as "Phase 4C.4"). Callers fall back to static history.

import type { MarketProvider, StockSnapshot, StockHistoryPoint, IndexSnapshot, SectorSnapshot, StockTimeframe } from './types.ts'
import type { ProviderResult } from '../types.ts'
import {
  getLatestStockSnapshots,
  getLatestStockSnapshot,
  getLatestIndexSnapshots,
  getLatestSectorPerformance,
  type LatestStockSnapshotRecord,
  type LatestIndexSnapshotRecord,
  type LatestSectorSnapshotRecord,
} from '../../db/repositories/marketRepository.ts'

const SUPABASE_SOURCE = 'Persisted Yahoo Finance via Supabase'
const SUPABASE_PROVIDER = 'supabase'

/** A snapshot_date more than this many days in the past is considered stale. */
const STALE_DAYS = 5

export function isSnapshotStale(snapshotDate: string | null, today: Date = new Date()): boolean {
  if (!snapshotDate) return true
  const snap = new Date(`${snapshotDate}T00:00:00Z`)
  if (Number.isNaN(snap.getTime())) return true
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const diffDays = (todayUtc.getTime() - snap.getTime()) / 86_400_000
  return diffDays > STALE_DAYS
}

function unavailable<T>(reason: string): ProviderResult<T> {
  return { ok: false, reason }
}

function toStockSnapshot(r: LatestStockSnapshotRecord): StockSnapshot {
  return {
    ticker: r.ticker,
    price: r.price ?? 0,
    currency: r.currency ?? 'CLP',
    dayChange: r.dayChange,
    dayChangePct: r.dayChangePct ?? 0,
    ytdChangePct: r.ytdChangePct ?? 0,
    volume: r.volume,
    avgVolume30d: r.avgVolume30d,
    marketCapCLP: r.marketCap,
    lastUpdated: r.lastUpdated ?? r.snapshotDate ?? '',
    source: SUPABASE_SOURCE,
    provider: SUPABASE_PROVIDER,
    status: 'persisted',
  }
}

function toIndexSnapshot(r: LatestIndexSnapshotRecord): IndexSnapshot {
  return {
    id: r.indexId,
    name: r.name,
    country: r.country ?? '',
    region: '',
    value: r.value ?? 0,
    currency: r.currency ?? 'USD',
    dayChangePct: r.dayChangePct ?? 0,
    ytdChangePct: r.ytdChangePct ?? 0,
    lastUpdated: r.lastUpdated ?? r.snapshotDate ?? '',
    source: SUPABASE_SOURCE,
    provider: SUPABASE_PROVIDER,
    status: 'persisted',
  }
}

function toSectorSnapshot(r: LatestSectorSnapshotRecord): SectorSnapshot {
  return {
    sector: r.sector,
    dayChangePct: r.dayChangePct ?? 0,
    ytdChangePct: r.ytdChangePct ?? 0,
    numberOfStocks: r.numberOfStocks ?? 0,
    topContributor: r.topContributor ?? '',
    topContributorPct: r.topContributorPct ?? 0,
    worstContributor: r.worstContributor ?? '',
    worstContributorPct: r.worstContributorPct ?? 0,
    lastUpdated: r.lastUpdated ?? r.snapshotDate ?? '',
    source: SUPABASE_SOURCE,
    provider: SUPABASE_PROVIDER,
    status: 'persisted',
  }
}

export const supabaseMarketProvider: MarketProvider = {
  name: 'supabase',

  async getStockSnapshots(): Promise<ProviderResult<StockSnapshot[]>> {
    const res = await getLatestStockSnapshots()
    if (!res.configured) return unavailable('Supabase not configured')
    if (!res.available) return unavailable(res.error ?? 'No persisted stock snapshots available')
    return {
      ok: true,
      data: res.data.map(toStockSnapshot),
      source: SUPABASE_SOURCE,
      lastUpdated: res.latestSnapshotDate ?? '',
    }
  },

  async getStockSnapshot(ticker: string): Promise<ProviderResult<StockSnapshot | null>> {
    const res = await getLatestStockSnapshot(ticker)
    if (!res.configured) return unavailable('Supabase not configured')
    if (!res.available) return unavailable(res.error ?? 'No persisted stock snapshot available')
    const row = res.data[0]
    return {
      ok: true,
      data: row ? toStockSnapshot(row) : null,
      source: SUPABASE_SOURCE,
      lastUpdated: res.latestSnapshotDate ?? '',
    }
  },

  async getStockHistory(ticker: string, timeframe: StockTimeframe): Promise<ProviderResult<StockHistoryPoint[]>> {
    void ticker; void timeframe
    // Phase 4C.3 scope: no persisted history table yet. See file header.
    return unavailable('Persisted stock history not yet available (Phase 4C.4)')
  },

  async getIndices(): Promise<ProviderResult<IndexSnapshot[]>> {
    const res = await getLatestIndexSnapshots()
    if (!res.configured) return unavailable('Supabase not configured')
    if (!res.available) return unavailable(res.error ?? 'No persisted index snapshots available')
    return {
      ok: true,
      data: res.data.map(toIndexSnapshot),
      source: SUPABASE_SOURCE,
      lastUpdated: res.latestSnapshotDate ?? '',
    }
  },

  async getSectors(): Promise<ProviderResult<SectorSnapshot[]>> {
    const res = await getLatestSectorPerformance()
    if (!res.configured) return unavailable('Supabase not configured')
    if (!res.available) return unavailable(res.error ?? 'No persisted sector snapshots available')
    return {
      ok: true,
      data: res.data.map(toSectorSnapshot),
      source: SUPABASE_SOURCE,
      lastUpdated: res.latestSnapshotDate ?? '',
    }
  },
}
