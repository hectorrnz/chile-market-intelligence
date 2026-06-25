// Phase 4C — Market data provider orchestrator.
//
// SERVER-ONLY. Applies the static / live / hybrid policy for market data.
// Never throws and never leaks credentials — only short `reason` strings reach
// the client. Mirrors the BCCh macro macroProvider.ts pattern exactly.

import type {
  StockSnapshotsResponse, StockSnapshotResponse, StockHistoryResponse,
  IndexSnapshotsResponse, SectorSnapshotsResponse, MarketDataMeta, StockTimeframe,
} from './types'
import { getMarketDataMode, decideMarketSource } from './marketDataMode'
import { staticMarketProvider } from './staticMarketProvider'
import { brainDataProvider } from './brainDataProvider'

const STATIC_FALLBACK_META = (requested: string, reason?: string): MarketDataMeta => ({
  dataModeRequested: requested as MarketDataMeta['dataModeRequested'],
  dataModeUsed: 'static',
  liveAvailable: false,
  status: 'static',
  source: 'Static MVP',
  lastUpdated: '',
  fallbackReason: reason,
  provider: 'static',
})

export async function resolveStockSnapshots(): Promise<StockSnapshotsResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof brainDataProvider.getStockSnapshots>> | null
  if (requested !== 'static') {
    liveResult = await brainDataProvider.getStockSnapshots()
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return { data: liveResult.data, metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'Brain Data' } }
  }
  const stat = await staticMarketProvider.getStockSnapshots()
  return { data: stat.ok ? stat.data : [], metadata: { dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason, provider: 'static' } }
}

export async function resolveStockSnapshot(ticker: string): Promise<StockSnapshotResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof brainDataProvider.getStockSnapshot>> | null
  if (requested !== 'static') {
    liveResult = await brainDataProvider.getStockSnapshot(ticker)
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return { data: liveResult.data, metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'Brain Data' } }
  }
  const stat = await staticMarketProvider.getStockSnapshot(ticker)
  return { data: stat.ok ? stat.data : null, metadata: { dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason, provider: 'static' } }
}

export async function resolveStockHistory(ticker: string, timeframe: StockTimeframe): Promise<StockHistoryResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof brainDataProvider.getStockHistory>> | null
  if (requested !== 'static') {
    liveResult = await brainDataProvider.getStockHistory(ticker, timeframe)
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return { data: liveResult.data, metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'Brain Data' } }
  }
  const stat = await staticMarketProvider.getStockHistory(ticker, timeframe)
  return { data: stat.ok ? stat.data : [], metadata: { dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason, provider: 'static' } }
}

export async function resolveIndices(): Promise<IndexSnapshotsResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof brainDataProvider.getIndices>> | null
  if (requested !== 'static') {
    liveResult = await brainDataProvider.getIndices()
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return { data: liveResult.data, metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'Brain Data' } }
  }
  const stat = await staticMarketProvider.getIndices()
  return { data: stat.ok ? stat.data : [], metadata: { dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason, provider: 'static' } }
}

export async function resolveSectors(): Promise<SectorSnapshotsResponse> {
  const requested = getMarketDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof brainDataProvider.getSectors>> | null
  if (requested !== 'static') {
    liveResult = await brainDataProvider.getSectors()
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideMarketSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return { data: liveResult.data, metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, provider: 'Brain Data' } }
  }
  const stat = await staticMarketProvider.getSectors()
  return { data: stat.ok ? stat.data : [], metadata: { dataModeRequested: requested, dataModeUsed: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'Static MVP', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason, provider: 'static' } }
}

/** Shared error envelope used in route handler catch blocks. */
export function marketErrorResponse(entity: string): { data: never[]; metadata: MarketDataMeta } {
  return { data: [], metadata: STATIC_FALLBACK_META('static', `Unexpected server error fetching ${entity}`) }
}
