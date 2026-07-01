// Phase 4C — Market data provider orchestrator.
// Phase 4C.3 — Supabase-persisted Yahoo Finance snapshots are now the default
// "live" baseline for MARKET_DATA_MODE=supabase|hybrid, replacing Brain Data
// (which remains unhooked but in place — see brainDataProvider.ts).
//
// SERVER-ONLY. Applies the static / supabase / hybrid policy for market data.
// Never throws and never leaks credentials — only short `reason` strings reach
// the client. Mirrors the BCCh macro macroProvider.ts 3-layer pattern.

import type {
  StockSnapshotsResponse, StockSnapshotResponse, StockHistoryResponse,
  IndexSnapshotsResponse, SectorSnapshotsResponse, MarketDataMeta, StockTimeframe, MarketMode,
} from './types.ts'
import { getMarketDataMode, decideMarketSource } from './marketDataMode.ts'
import { staticMarketProvider } from './staticMarketProvider.ts'
import { supabaseMarketProvider, isSnapshotStale } from './supabaseMarketProvider.ts'

const STATIC_FALLBACK_META = (requested: MarketMode, reason?: string): MarketDataMeta => ({
  dataModeRequested: requested,
  dataModeUsed: 'static',
  liveAvailable: false,
  status: 'static',
  source: 'Static MVP',
  lastUpdated: '',
  fallbackReason: reason,
  provider: 'static',
  marketDataModeRequested: requested,
  marketDataModeUsed: 'static',
  persistedAvailable: false,
})

/**
 * Decide whether a successful Supabase fetch should be served as-is, treated
 * as a stale-fallback-to-static (hybrid only), or served anyway with the
 * staleness flag set (strict supabase mode). Pure decision logic shared by
 * every resolver below.
 */
function evaluateStaleness(requested: MarketMode, lastUpdated: string): { useSupabase: boolean; stale: boolean; reason?: string } {
  const stale = isSnapshotStale(lastUpdated || null)
  if (!stale) return { useSupabase: true, stale: false }
  if (requested === 'hybrid') {
    return { useSupabase: false, stale: true, reason: 'Persisted market data is stale (>5 days old)' }
  }
  // requested === 'supabase' (strict): still serve it, but flag the staleness.
  return { useSupabase: true, stale: true }
}

export async function resolveStockSnapshots(): Promise<StockSnapshotsResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined; let staleFallbackUsed = false
  let liveResult: Awaited<ReturnType<typeof supabaseMarketProvider.getStockSnapshots>> | null = null
  if (requested !== 'static') {
    liveResult = await supabaseMarketProvider.getStockSnapshots()
    if (liveResult.ok) {
      const ev = evaluateStaleness(requested, liveResult.lastUpdated)
      liveOk = ev.useSupabase
      staleFallbackUsed = ev.stale
      liveReason = ev.reason
    } else {
      liveReason = liveResult.reason
    }
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return {
      data: liveResult.data,
      metadata: {
        dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true,
        status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'supabase',
        marketDataModeRequested: requested, marketDataModeUsed: decision.dataModeUsed, persistedAvailable: true,
        latestSnapshotDate: liveResult.lastUpdated || null, snapshotCount: liveResult.data.length, staleFallbackUsed,
      },
    }
  }
  const stat = await staticMarketProvider.getStockSnapshots()
  return {
    data: stat.ok ? stat.data : [],
    metadata: {
      dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason: decision.fallbackReason, provider: 'static',
      marketDataModeRequested: requested, marketDataModeUsed: 'static',
      persistedAvailable: requested !== 'static' ? Boolean(liveResult?.ok) : undefined, staleFallbackUsed,
    },
  }
}

export async function resolveStockSnapshot(ticker: string): Promise<StockSnapshotResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined; let staleFallbackUsed = false
  let liveResult: Awaited<ReturnType<typeof supabaseMarketProvider.getStockSnapshot>> | null = null
  if (requested !== 'static') {
    liveResult = await supabaseMarketProvider.getStockSnapshot(ticker)
    if (liveResult.ok) {
      const ev = evaluateStaleness(requested, liveResult.lastUpdated)
      liveOk = ev.useSupabase
      staleFallbackUsed = ev.stale
      liveReason = ev.reason
    } else {
      liveReason = liveResult.reason
    }
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return {
      data: liveResult.data,
      metadata: {
        dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true,
        status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'supabase',
        marketDataModeRequested: requested, marketDataModeUsed: decision.dataModeUsed, persistedAvailable: true,
        latestSnapshotDate: liveResult.lastUpdated || null, snapshotCount: liveResult.data ? 1 : 0, staleFallbackUsed,
      },
    }
  }
  const stat = await staticMarketProvider.getStockSnapshot(ticker)
  return {
    data: stat.ok ? stat.data : null,
    metadata: {
      dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason: decision.fallbackReason, provider: 'static',
      marketDataModeRequested: requested, marketDataModeUsed: 'static',
      persistedAvailable: requested !== 'static' ? Boolean(liveResult?.ok) : undefined, staleFallbackUsed,
    },
  }
}

/**
 * Stock history has no persisted Supabase source yet (Phase 4C.3 scope — see
 * supabaseMarketProvider.ts header; tracked as a future "Phase 4C.4"). Always
 * resolves from static, but reports the requested/used mode honestly.
 */
export async function resolveStockHistory(ticker: string, timeframe: StockTimeframe): Promise<StockHistoryResponse> {
  const requested = getMarketDataMode()
  const stat = await staticMarketProvider.getStockHistory(ticker, timeframe)
  return {
    data: stat.ok ? stat.data : [],
    metadata: {
      dataModeRequested: requested,
      dataModeUsed: 'static',
      liveAvailable: false,
      status: requested === 'static' ? 'static' : 'hybrid-fallback',
      source: stat.ok ? stat.source : 'Static MVP',
      lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason: requested !== 'static' ? 'Persisted stock history not yet available (Phase 4C.4)' : undefined,
      provider: 'static',
      marketDataModeRequested: requested,
      marketDataModeUsed: 'static',
      persistedAvailable: false,
    },
  }
}

export async function resolveIndices(): Promise<IndexSnapshotsResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined; let staleFallbackUsed = false
  let liveResult: Awaited<ReturnType<typeof supabaseMarketProvider.getIndices>> | null = null
  if (requested !== 'static') {
    liveResult = await supabaseMarketProvider.getIndices()
    if (liveResult.ok) {
      const ev = evaluateStaleness(requested, liveResult.lastUpdated)
      liveOk = ev.useSupabase
      staleFallbackUsed = ev.stale
      liveReason = ev.reason
    } else {
      liveReason = liveResult.reason
    }
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    const proxyMetadataPresent = liveResult.data.some(idx => idx.id === 'colcap' || idx.id === 'bvl-peru')
    return {
      data: liveResult.data,
      metadata: {
        dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true,
        status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'supabase',
        marketDataModeRequested: requested, marketDataModeUsed: decision.dataModeUsed, persistedAvailable: true,
        latestSnapshotDate: liveResult.lastUpdated || null, snapshotCount: liveResult.data.length, staleFallbackUsed,
        proxyMetadataPresent,
      },
    }
  }
  const stat = await staticMarketProvider.getIndices()
  return {
    data: stat.ok ? stat.data : [],
    metadata: {
      dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason: decision.fallbackReason, provider: 'static',
      marketDataModeRequested: requested, marketDataModeUsed: 'static',
      persistedAvailable: requested !== 'static' ? Boolean(liveResult?.ok) : undefined, staleFallbackUsed,
    },
  }
}

export async function resolveSectors(): Promise<SectorSnapshotsResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined; let staleFallbackUsed = false
  let liveResult: Awaited<ReturnType<typeof supabaseMarketProvider.getSectors>> | null = null
  if (requested !== 'static') {
    liveResult = await supabaseMarketProvider.getSectors()
    if (liveResult.ok) {
      const ev = evaluateStaleness(requested, liveResult.lastUpdated)
      liveOk = ev.useSupabase
      staleFallbackUsed = ev.stale
      liveReason = ev.reason
    } else {
      liveReason = liveResult.reason
    }
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return {
      data: liveResult.data,
      metadata: {
        dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true,
        status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'supabase',
        marketDataModeRequested: requested, marketDataModeUsed: decision.dataModeUsed, persistedAvailable: true,
        latestSnapshotDate: liveResult.lastUpdated || null, snapshotCount: liveResult.data.length, staleFallbackUsed,
      },
    }
  }
  const stat = await staticMarketProvider.getSectors()
  return {
    data: stat.ok ? stat.data : [],
    metadata: {
      dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason: decision.fallbackReason, provider: 'static',
      marketDataModeRequested: requested, marketDataModeUsed: 'static',
      persistedAvailable: requested !== 'static' ? Boolean(liveResult?.ok) : undefined, staleFallbackUsed,
    },
  }
}

/** Shared error envelope used in route handler catch blocks. */
export function marketErrorResponse(entity: string): { data: never[]; metadata: MarketDataMeta } {
  return { data: [], metadata: STATIC_FALLBACK_META('static', `Unexpected server error fetching ${entity}`) }
}
