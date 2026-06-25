// Phase 5B — Market data repository.
// Static source: src/data/stockSnapshots.json + indexPerformance.json + sectorPerformance.json
// Supabase source: stock_snapshots, index_snapshots, sector_performance tables
// Falls back to static when DB_MODE=static or Supabase not configured.

import type { DbListResult, DbResult } from '../types'
import type { StockSnapshotRow, IndexSnapshotRow, SectorPerformanceRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode'

export interface StockSnapshotRecord {
  ticker: string
  price?: number
  currency?: string
  dayChange?: number
  dayChangePct?: number
  volume?: number
  marketCap?: number
  lastUpdated?: string
  status?: string
}

export interface IndexSnapshotRecord {
  indexId: string
  name: string
  country?: string
  value?: number
  dayChangePct?: number
  ytdChangePct?: number
}

export interface SectorSnapshotRecord {
  sector: string
  dayChangePct?: number
  ytdChangePct?: number
  numberOfStocks?: number
  topContributor?: string
  worstContributor?: string
}

export async function getStockSnapshots(): Promise<DbListResult<StockSnapshotRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticStocks(), source: 'static' }
      const res = await db.from('stock_snapshots').select('*').order('ticker')
      const rows = res.data as unknown as StockSnapshotRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticStocks(), source: 'static', error: res.error?.message }
      }
      const records: StockSnapshotRecord[] = rows.map((r) => ({
        ticker: r.ticker,
        price: r.price ?? undefined,
        currency: r.currency ?? undefined,
        dayChange: r.day_change ?? undefined,
        dayChangePct: r.day_change_pct ?? undefined,
        volume: r.volume ?? undefined,
        marketCap: r.market_cap ?? undefined,
        lastUpdated: r.last_updated ?? undefined,
        status: r.status ?? undefined,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticStocks(), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticStocks(), source: 'static' }
}

export async function getStockSnapshot(ticker: string): Promise<DbResult<StockSnapshotRecord | null>> {
  const list = await getStockSnapshots()
  return {
    data: list.data.find((s) => s.ticker === ticker) ?? null,
    source: list.source,
    error: list.error,
  }
}

export async function getIndexSnapshots(): Promise<DbListResult<IndexSnapshotRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticIndices(), source: 'static' }
      const res = await db.from('index_snapshots').select('*')
      const rows = res.data as unknown as IndexSnapshotRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticIndices(), source: 'static', error: res.error?.message }
      }
      const records: IndexSnapshotRecord[] = rows.map((r) => ({
        indexId: r.index_id,
        name: r.name,
        country: r.country ?? undefined,
        value: r.value ?? undefined,
        dayChangePct: r.day_change_pct ?? undefined,
        ytdChangePct: r.ytd_change_pct ?? undefined,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticIndices(), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticIndices(), source: 'static' }
}

export async function getSectorPerformance(): Promise<DbListResult<SectorSnapshotRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticSectors(), source: 'static' }
      const res = await db.from('sector_performance').select('*')
      const rows = res.data as unknown as SectorPerformanceRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticSectors(), source: 'static', error: res.error?.message }
      }
      const records: SectorSnapshotRecord[] = rows.map((r) => ({
        sector: r.sector,
        dayChangePct: r.day_change_pct ?? undefined,
        ytdChangePct: r.ytd_change_pct ?? undefined,
        numberOfStocks: r.number_of_stocks ?? undefined,
        topContributor: r.top_contributor ?? undefined,
        worstContributor: r.worst_contributor ?? undefined,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticSectors(), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticSectors(), source: 'static' }
}

function loadStaticStocks(): StockSnapshotRecord[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../data/companies.json') as Array<Record<string, unknown>>
    return raw
      .filter((c) => c.isTracked)
      .map((c) => ({
        ticker: c.ticker as string,
        currency: (c.currency as string) ?? 'CLP',
        marketCap: c.marketCapCLP as number | undefined,
        status: 'static',
      }))
  } catch {
    return []
  }
}

function loadStaticIndices(): IndexSnapshotRecord[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../data/indexPerformance.json') as Array<Record<string, unknown>>
    return raw.map((r) => ({
      indexId: r.id as string,
      name: r.name as string,
      country: r.country as string | undefined,
      value: r.value as number | undefined,
      dayChangePct: r.dayChangePct as number | undefined,
      ytdChangePct: r.ytdChangePct as number | undefined,
    }))
  } catch {
    return []
  }
}

function loadStaticSectors(): SectorSnapshotRecord[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../data/sectorPerformance.json') as Array<Record<string, unknown>>
    return raw.map((r) => ({
      sector: r.sector as string,
      dayChangePct: r.dayChangePct as number | undefined,
      ytdChangePct: r.ytdChangePct as number | undefined,
      numberOfStocks: r.numberOfStocks as number | undefined,
      topContributor: r.topContributor as string | undefined,
      worstContributor: r.worstContributor as string | undefined,
    }))
  } catch {
    return []
  }
}
