// Phase 4C.2 — Market snapshot ingestion module.
// SERVER-ONLY — never import from 'use client' files.
//
// Fetches live quotes from Yahoo Finance and persists market snapshots
// (stocks, sectors, indices) into Supabase. Mirrors the BCCh ingestion pattern.
//
// Used by:
//   - src/app/api/cron/ingest-market-snapshot/route.ts
//   - scripts/ingest/marketSnapshots.ts (CLI)

import { createRequire } from 'node:module'
import {
  TICKER_YF, INDEX_YF, INDEX_PROXY_OF,
  buildStocks, buildSectors, buildIndices,
  type YFQuote, type StaticSector, type StaticIndex,
  type SectorLive, type IndexLive, type StockLive,
} from '../market/liveOverlay.ts'
import { isSupabaseConfigured } from '../supabase/env.ts'

const _require = createRequire(import.meta.url)

export const SOURCE_PROVIDER = 'Yahoo Finance'
export const PROVIDER_KEY    = 'yahoo_finance_unofficial'
export const INGESTION_VERSION = '4C.2'

const TIMEOUT_MS = 30_000

// ─── Public types ─────────────────────────────────────────────────────────────

export type SnapshotType = 'midday' | 'close' | 'manual' | 'live_refresh'
export type IngestionSource = 'local' | 'api' | 'cron'

export interface MarketSnapshotIngestionOptions {
  snapshotType: SnapshotType
  source: IngestionSource
  dryRun?: boolean
}

export interface MarketSnapshotIngestionResult {
  success: boolean
  status: 'success' | 'partial_success' | 'failed' | 'dry_run' | 'not_configured'
  provider: string
  snapshotType: SnapshotType
  snapshotDate: string
  symbolsRequested: number
  symbolsSucceeded: number
  symbolsFailed: number
  stockRowsSeen: number
  stockRowsInserted: number
  indexRowsSeen: number
  indexRowsInserted: number
  sectorRowsSeen: number
  sectorRowsInserted: number
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  rowsFailed: number
  startedAt: string
  finishedAt: string
  durationMs: number
  ingestionRunId?: string
  errorSummary?: string
}

export interface StockSnapshotInsertRow {
  ticker: string
  price: number | null
  currency: string
  day_change_pct: number | null
  market_cap: number | null
  last_updated: string
  provider: string
  status: string
  ytd_change_pct: number | null
  source: string
  snapshot_date: string
  snapshot_type: string
  metadata: Record<string, unknown>
}

export interface IndexSnapshotInsertRow {
  index_id: string
  name: string
  country: string | null
  value: number | null
  day_change_pct: number | null
  ytd_change_pct: number | null
  last_updated: string
  provider: string
  snapshot_date: string
  snapshot_type: string
  currency: string | null
  proxy_of: string | null
  metadata: Record<string, unknown>
}

export interface SectorSnapshotInsertRow {
  sector: string
  day_change_pct: number | null
  ytd_change_pct: number | null
  number_of_stocks: number | null
  top_contributor: string | null
  worst_contributor: string | null
  last_updated: string
  provider: string
  snapshot_date: string
  snapshot_type: string
  top_contributor_pct: number | null
  worst_contributor_pct: number | null
  metadata: Record<string, unknown>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/user=[^&\s]+/gi, 'user=***')
    .replace(/pass(word)?=[^&\s]+/gi, '$1=***')
    .replace(/key=[A-Za-z0-9_.\\-]{20,}/gi, 'key=***')
    .replace(/eyJ[A-Za-z0-9_.\\-]{40,}/g, '***JWT***')
    .slice(0, 500)
}

// ─── Pure row normalizers (testable, no I/O) ──────────────────────────────────

export function normalizeStockSnapshotRows(
  stocks: Record<string, StockLive>,
  staticYtd: Map<string, number | null>,
  opts: { snapshotDate: string; snapshotType: SnapshotType; fetchedAt: string },
): StockSnapshotInsertRow[] {
  if (!stocks || Object.keys(stocks).length === 0) return []
  return Object.entries(stocks).map(([ticker, live]) => ({
    ticker,
    price:          live.price,
    currency:       'CLP',
    day_change_pct: live.dayChangePct,
    market_cap:     live.marketCapCLP,
    last_updated:   opts.fetchedAt,
    provider:       SOURCE_PROVIDER,
    status:         'live',
    ytd_change_pct: staticYtd.has(ticker) ? (staticYtd.get(ticker) ?? null) : null,
    source:         SOURCE_PROVIDER,
    snapshot_date:  opts.snapshotDate,
    snapshot_type:  opts.snapshotType,
    metadata: {
      ingestionVersion: INGESTION_VERSION,
      provider:         PROVIDER_KEY,
    },
  }))
}

export function normalizeIndexSnapshotRows(
  indices: IndexLive[],
  staticIndexMeta: Map<string, { name: string; country: string | null; currency: string | null }>,
  opts: { snapshotDate: string; snapshotType: SnapshotType; fetchedAt: string },
): IndexSnapshotInsertRow[] {
  if (!indices || indices.length === 0) return []
  return indices.map(live => {
    const meta    = staticIndexMeta.get(live.id)
    const proxyOf = INDEX_PROXY_OF[live.id] ?? null
    const proxyInstrumentMeta: Record<string, unknown> = proxyOf
      ? { proxyInstruments: { [live.id]: INDEX_YF[live.id] } }
      : {}
    return {
      index_id:       live.id,
      name:           meta?.name ?? live.id,
      country:        meta?.country ?? null,
      value:          live.value,
      day_change_pct: live.dayChangePct,
      ytd_change_pct: live.ytdChangePct,
      last_updated:   opts.fetchedAt,
      provider:       SOURCE_PROVIDER,
      snapshot_date:  opts.snapshotDate,
      snapshot_type:  opts.snapshotType,
      currency:       meta?.currency ?? null,
      proxy_of:       proxyOf,
      metadata: {
        ingestionVersion: INGESTION_VERSION,
        provider:         PROVIDER_KEY,
        ...proxyInstrumentMeta,
      },
    }
  })
}

export function normalizeSectorSnapshotRows(
  sectors: SectorLive[],
  opts: { snapshotDate: string; snapshotType: SnapshotType; fetchedAt: string },
): SectorSnapshotInsertRow[] {
  if (!sectors || sectors.length === 0) return []
  return sectors.map(s => ({
    sector:               s.sector,
    day_change_pct:       s.dayChangePct,
    ytd_change_pct:       s.ytdChangePct,
    number_of_stocks:     s.numberOfStocks,
    top_contributor:      s.topContributor,
    worst_contributor:    s.worstContributor,
    last_updated:         opts.fetchedAt,
    provider:             SOURCE_PROVIDER,
    snapshot_date:        opts.snapshotDate,
    snapshot_type:        opts.snapshotType,
    top_contributor_pct:  s.topContributorPct ?? null,
    worst_contributor_pct: s.worstContributorPct ?? null,
    metadata: {
      ingestionVersion: INGESTION_VERSION,
      provider:         PROVIDER_KEY,
    },
  }))
}

// ─── ingestion_runs helper ────────────────────────────────────────────────────

async function recordIngestionRun(
  status: 'success' | 'partial_success' | 'failed' | 'dry_run',
  startedAt: string,
  jobType: string,
  meta: Record<string, unknown>,
  errorMessage: string | null,
): Promise<string | undefined> {
  try {
    const { getSupabaseAdminClient } = await import('../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return undefined
    const row = {
      provider:      SOURCE_PROVIDER,
      job_type:      jobType,
      status,
      started_at:    startedAt,
      finished_at:   new Date().toISOString(),
      rows_seen:     (meta.rowsSeen as number) ?? 0,
      rows_inserted: (meta.rowsInserted as number) ?? 0,
      rows_updated:  0,
      rows_failed:   (meta.rowsFailed as number) ?? 0,
      error_message: errorMessage,
      metadata:      meta,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (db as any).from('ingestion_runs').insert(row).select('id').single()
    return res.data?.id ? String(res.data.id) : undefined
  } catch {
    return undefined
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runMarketSnapshotIngestion(
  opts: MarketSnapshotIngestionOptions,
): Promise<MarketSnapshotIngestionResult> {
  const startedAt    = new Date().toISOString()
  const snapshotDate = new Date().toISOString().slice(0, 10)
  const fetchedAt    = startedAt
  const dryRun       = opts.dryRun ?? false
  const jobType      = 'market_snapshot_' + opts.snapshotType

  const allSymbols       = [...Object.values(TICKER_YF), ...Object.values(INDEX_YF)]
  const symbolsRequested = allSymbols.length

  // ── Supabase configured check ─────────────────────────────────────────────
  if (!dryRun && !isSupabaseConfigured()) {
    const finishedAt = new Date().toISOString()
    return {
      success: false,
      status:  'not_configured',
      provider: SOURCE_PROVIDER,
      snapshotType:     opts.snapshotType,
      snapshotDate,
      symbolsRequested,
      symbolsSucceeded: 0,
      symbolsFailed:    symbolsRequested,
      stockRowsSeen:    0,  stockRowsInserted:  0,
      indexRowsSeen:    0,  indexRowsInserted:  0,
      sectorRowsSeen:   0,  sectorRowsInserted: 0,
      rowsSeen:         0,  rowsInserted: 0, rowsUpdated: 0, rowsFailed: 0,
      startedAt, finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      errorSummary: 'Supabase not configured',
    }
  }

  // ── Fetch Yahoo Finance quotes ────────────────────────────────────────────
  let quotes: YFQuote[] = []
  let succeeded = 0
  let failed    = symbolsRequested
  const errorMessages: string[] = []

  try {
    const YahooFinance = (await import('yahoo-finance2')).default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })
    const quotePromise = yf.quote(allSymbols, {}, { validateResult: false })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Yahoo Finance timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawQuotes: any = await Promise.race([quotePromise, timeoutPromise])
    quotes = Array.isArray(rawQuotes) ? rawQuotes : [rawQuotes]
  } catch (e) {
    errorMessages.push(`Yahoo Finance fetch failed: ${sanitizeError(e)}`)
  }

  // ── Load static JSON via require ───────────────────────────────────────────
  const staticSectors   = _require('../../data/sectorPerformance.json') as StaticSector[]
  const staticIndicesRaw = _require('../../data/indexPerformance.json') as StaticIndex[]
  const stockPricesRaw  = _require('../../data/stockPrices.json') as Array<Record<string, unknown>>

  // ── Build live data ────────────────────────────────────────────────────────
  const { stocks, dayByTicker, succeeded: s, failed: f } = buildStocks(quotes)
  succeeded = s
  failed    = f
  const sectors = buildSectors(dayByTicker, staticSectors)
  const indices = buildIndices(quotes, staticIndicesRaw)

  // ── Build lookup maps ──────────────────────────────────────────────────────
  const staticYtd = new Map<string, number | null>()
  for (const row of stockPricesRaw) {
    staticYtd.set(row.ticker as string, (row.ytdChangePct as number | null) ?? null)
  }

  const staticIndexMeta = new Map<string, { name: string; country: string | null; currency: string | null }>()
  for (const idx of staticIndicesRaw) {
    staticIndexMeta.set(idx.id, {
      name:     idx.name     ?? idx.id,
      country:  idx.country  ?? null,
      currency: idx.currency ?? null,
    })
  }

  // ── Normalize rows ─────────────────────────────────────────────────────────
  const rowOpts = { snapshotDate, snapshotType: opts.snapshotType, fetchedAt }
  const stockRows  = normalizeStockSnapshotRows(stocks, staticYtd, rowOpts)
  const indexRows  = normalizeIndexSnapshotRows(indices, staticIndexMeta, rowOpts)
  const sectorRows = normalizeSectorSnapshotRows(sectors, rowOpts)

  const rowsSeen    = stockRows.length + indexRows.length + sectorRows.length
  let rowsInserted  = 0
  let rowsFailed    = 0

  // ── Dry run ────────────────────────────────────────────────────────────────
  if (dryRun) {
    const finishedAt = new Date().toISOString()
    return {
      success:          true,
      status:           'dry_run',
      provider:         SOURCE_PROVIDER,
      snapshotType:     opts.snapshotType,
      snapshotDate,
      symbolsRequested,
      symbolsSucceeded: succeeded,
      symbolsFailed:    failed,
      stockRowsSeen:    stockRows.length,  stockRowsInserted:  stockRows.length,
      indexRowsSeen:    indexRows.length,  indexRowsInserted:  indexRows.length,
      sectorRowsSeen:   sectorRows.length, sectorRowsInserted: sectorRows.length,
      rowsSeen, rowsInserted: rowsSeen, rowsUpdated: 0, rowsFailed: 0,
      startedAt, finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    }
  }

  // ── Upsert to Supabase ────────────────────────────────────────────────────
  const { upsertStockSnapshots, upsertIndexSnapshots, upsertSectorPerformanceSnapshots } =
    await import('../db/repositories/marketRepository.ts')

  type R = { inserted: number; updated: number; error?: string }
  const noOp: R = { inserted: 0, updated: 0 }
  const [stockRes, indexRes, sectorRes] = await Promise.all([
    stockRows.length  > 0 ? upsertStockSnapshots(stockRows)              : Promise.resolve(noOp),
    indexRows.length  > 0 ? upsertIndexSnapshots(indexRows)              : Promise.resolve(noOp),
    sectorRows.length > 0 ? upsertSectorPerformanceSnapshots(sectorRows) : Promise.resolve(noOp),
  ])

  if (stockRes.error)  errorMessages.push(`stocks: ${stockRes.error}`)
  if (indexRes.error)  errorMessages.push(`indices: ${indexRes.error}`)
  if (sectorRes.error) errorMessages.push(`sectors: ${sectorRes.error}`)

  rowsInserted = stockRes.inserted + indexRes.inserted + sectorRes.inserted
  rowsFailed   = (stockRes.error  ? stockRows.length  : 0)
               + (indexRes.error  ? indexRows.length  : 0)
               + (sectorRes.error ? sectorRows.length : 0)

  const status: MarketSnapshotIngestionResult['status'] =
    rowsFailed === 0 && errorMessages.length === 0 ? 'success'
    : rowsInserted > 0                             ? 'partial_success'
    : 'failed'

  const finishedAt   = new Date().toISOString()
  const durationMs   = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  const errorSummary = errorMessages.length > 0
    ? errorMessages.join('; ').slice(0, 500)
    : undefined

  const ingestionMeta = {
    snapshotType:      opts.snapshotType,
    source:            opts.source,
    symbolsRequested,
    symbolsSucceeded:  succeeded,
    symbolsFailed:     failed,
    indicesSucceeded:  indexRows.length,
    sectorsWritten:    sectorRows.length,
    provider:          PROVIDER_KEY,
    proxyInstruments:  { colcap: '^SPCOSLCP', 'bvl-peru': 'EPU' },
    ingestionVersion:  INGESTION_VERSION,
    rowsSeen,
    rowsInserted,
    rowsFailed,
  }

  const ingestionRunId = await recordIngestionRun(
    status,
    startedAt,
    jobType,
    ingestionMeta,
    errorSummary ?? null,
  )

  return {
    success:          rowsFailed === 0 || rowsInserted > 0,
    status,
    provider:         SOURCE_PROVIDER,
    snapshotType:     opts.snapshotType,
    snapshotDate,
    symbolsRequested,
    symbolsSucceeded: succeeded,
    symbolsFailed:    failed,
    stockRowsSeen:    stockRows.length,  stockRowsInserted:  stockRes.inserted,
    indexRowsSeen:    indexRows.length,  indexRowsInserted:  indexRes.inserted,
    sectorRowsSeen:   sectorRows.length, sectorRowsInserted: sectorRes.inserted,
    rowsSeen,
    rowsInserted,
    rowsUpdated:      0,
    rowsFailed,
    startedAt,
    finishedAt,
    durationMs,
    ingestionRunId,
    errorSummary,
  }
}
