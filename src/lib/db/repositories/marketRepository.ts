// Phase 5B â€” Market data repository.
// Static source: src/data/stockSnapshots.json + indexPerformance.json + sectorPerformance.json
// Supabase source: stock_snapshots, index_snapshots, sector_performance tables
// Falls back to static when DB_MODE=static or Supabase not configured.

import type { DbListResult, DbResult } from '../types.ts'
import type { StockSnapshotRow, IndexSnapshotRow, SectorPerformanceRow } from '../../supabase/database.types.ts'
import { decideDbSource } from '../dbMode.ts'

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
      const { getSupabaseServerClient } = await import('../../supabase/server.ts')
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
      const { getSupabaseServerClient } = await import('../../supabase/server.ts')
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
      const { getSupabaseServerClient } = await import('../../supabase/server.ts')
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
    const raw = require('../../../data/companies.json') as Array<Record<string, unknown>>
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
    const raw = require('../../../data/indexPerformance.json') as Array<Record<string, unknown>>
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
    const raw = require('../../../data/sectorPerformance.json') as Array<Record<string, unknown>>
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

// ─── Phase 4C.2: Upsert helpers (admin client, server-only) ──────────────────

export interface UpsertResult { inserted: number; updated: number; error?: string }

function sanitizeUpsertError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/eyJ[A-Za-z0-9_.\\-]{40,}/g, '***JWT***')
    .replace(/key=[A-Za-z0-9_.\\-]{20,}/gi, 'key=***')
    .slice(0, 300)
}

export async function upsertStockSnapshots(
  rows: import('../../ingestion/marketSnapshotIngestion.ts').StockSnapshotInsertRow[],
): Promise<UpsertResult> {
  try {
    const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return { inserted: 0, updated: 0, error: 'Admin client unavailable' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (db as any).from('stock_snapshots').upsert(rows, { onConflict: 'ticker,snapshot_date,snapshot_type' })
    if (res.error) return { inserted: 0, updated: 0, error: sanitizeUpsertError(res.error) }
    return { inserted: rows.length, updated: 0 }
  } catch (e) {
    return { inserted: 0, updated: 0, error: sanitizeUpsertError(e) }
  }
}

export async function upsertIndexSnapshots(
  rows: import('../../ingestion/marketSnapshotIngestion.ts').IndexSnapshotInsertRow[],
): Promise<UpsertResult> {
  try {
    const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return { inserted: 0, updated: 0, error: 'Admin client unavailable' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (db as any).from('index_snapshots').upsert(rows, { onConflict: 'index_id,snapshot_date,snapshot_type' })
    if (res.error) return { inserted: 0, updated: 0, error: sanitizeUpsertError(res.error) }
    return { inserted: rows.length, updated: 0 }
  } catch (e) {
    return { inserted: 0, updated: 0, error: sanitizeUpsertError(e) }
  }
}

export async function upsertSectorPerformanceSnapshots(
  rows: import('../../ingestion/marketSnapshotIngestion.ts').SectorSnapshotInsertRow[],
): Promise<UpsertResult> {
  try {
    const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return { inserted: 0, updated: 0, error: 'Admin client unavailable' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (db as any).from('sector_performance').upsert(rows, { onConflict: 'sector,snapshot_date,snapshot_type' })
    if (res.error) return { inserted: 0, updated: 0, error: sanitizeUpsertError(res.error) }
    return { inserted: rows.length, updated: 0 }
  } catch (e) {
    return { inserted: 0, updated: 0, error: sanitizeUpsertError(e) }
  }
}

export async function getMarketSnapshotSummary(): Promise<{
  stockCount: number
  indexCount: number
  sectorCount: number
  latestSnapshotDate: string | null
  latestSnapshotType: string | null
  source: string
}> {
  try {
    const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return fallbackMarketSummary()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stockRes = await (db as any)
      .from('stock_snapshots')
      .select('ticker, snapshot_date, snapshot_type', { count: 'exact', head: false })
      .order('snapshot_date', { ascending: false })
      .limit(1)
    if (stockRes.error) return fallbackMarketSummary()
    const latestRow = stockRes.data?.[0] ?? null
    const [idxRes, secRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).from('index_snapshots').select('id', { count: 'exact', head: true }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).from('sector_performance').select('id', { count: 'exact', head: true }),
    ])
    return {
      stockCount:         stockRes.count ?? 0,
      indexCount:         idxRes.count  ?? 0,
      sectorCount:        secRes.count  ?? 0,
      latestSnapshotDate: latestRow?.snapshot_date ?? null,
      latestSnapshotType: latestRow?.snapshot_type ?? null,
      source:             'supabase',
    }
  } catch {
    return fallbackMarketSummary()
  }
}

function fallbackMarketSummary() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stocks  = require('../../../data/companies.json') as Array<Record<string, unknown>>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const indices = require('../../../data/indexPerformance.json') as unknown[]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sectors = require('../../../data/sectorPerformance.json') as unknown[]
    return {
      stockCount:         stocks.filter(c => c.isTracked).length,
      indexCount:         indices.length,
      sectorCount:        sectors.length,
      latestSnapshotDate: null,
      latestSnapshotType: null,
      source:             'static',
    }
  } catch {
    return { stockCount: 0, indexCount: 0, sectorCount: 0, latestSnapshotDate: null, latestSnapshotType: null, source: 'static' }
  }
}

export async function getLatestMarketIngestionRun(): Promise<{
  runId: string | null
  startedAt: string | null
  finishedAt: string | null
  status: string | null
  rowsInserted: number | null
  rowsFailed: number | null
  metadata: Record<string, unknown> | null
}> {
  try {
    const { getSupabaseAdminClient } = await import('../../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return emptyRunResult()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (db as any)
      .from('ingestion_runs')
      .select('id, started_at, finished_at, status, rows_inserted, rows_failed, metadata')
      .eq('provider', 'Yahoo Finance')
      .order('started_at', { ascending: false })
      .limit(1)
      .single()
    if (res.error || !res.data) return emptyRunResult()
    const r = res.data
    return {
      runId:        r.id        ? String(r.id) : null,
      startedAt:    r.started_at  ?? null,
      finishedAt:   r.finished_at ?? null,
      status:       r.status      ?? null,
      rowsInserted: r.rows_inserted ?? null,
      rowsFailed:   r.rows_failed   ?? null,
      metadata:     r.metadata      ?? null,
    }
  } catch {
    return emptyRunResult()
  }
}

function emptyRunResult() {
  return { runId: null, startedAt: null, finishedAt: null, status: null, rowsInserted: null, rowsFailed: null, metadata: null }
}
