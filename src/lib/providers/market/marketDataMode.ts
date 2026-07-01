// Phase 4C — MARKET_DATA_MODE resolution.
// Phase 4C.3 — repurposed: static|supabase|hybrid. 'supabase' reads persisted
// Yahoo Finance snapshots (via supabaseMarketProvider) as the default live
// baseline. Brain Data (live paid provider) is unhooked from this orchestrator
// but the shell files remain in place for a future real-provider integration.
//
// Separate from DATA_MODE (BCCh macro) so BCCh live + market persisted data can
// coexist independently. parseMarketDataMode / decideMarketSource are pure
// functions (no env, no I/O) and are unit-tested directly.

import type { DataSourceStatus } from '../types'
import type { MarketMode } from './types'

export type { DataSourceStatus, MarketMode }

export interface SourceDecision {
  dataModeUsed: MarketMode
  status: DataSourceStatus
  liveAvailable: boolean
  fallbackReason?: string
}

/** Parse a raw MARKET_DATA_MODE string. Unknown/empty → 'static'. */
export function parseMarketDataMode(raw: string | undefined | null): MarketMode {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'supabase') return 'supabase'
  if (v === 'hybrid') return 'hybrid'
  return 'static'
}

/**
 * Resolve the effective market data mode for this server process.
 * - Explicit MARKET_DATA_MODE wins.
 * - Defaults to 'static' — guarantees the app works with no market data env vars at all.
 */
export function getMarketDataMode(): MarketMode {
  const explicit = process.env.MARKET_DATA_MODE
  if (explicit && explicit.trim()) return parseMarketDataMode(explicit)
  return 'static'
}

/**
 * Decide which source to serve given the requested mode and whether the
 * Supabase-persisted provider succeeded. Mirrors the BCCh macro decideSource
 * pattern for consistency, with 'supabase' standing in for 'live'.
 */
export function decideMarketSource(
  requested: MarketMode,
  liveOk: boolean,
  liveReason?: string,
): SourceDecision {
  if (requested === 'static') {
    return { dataModeUsed: 'static', status: 'static', liveAvailable: false }
  }
  if (liveOk) {
    return {
      dataModeUsed: requested === 'hybrid' ? 'hybrid' : 'supabase',
      status: 'persisted',
      liveAvailable: true,
    }
  }
  if (requested === 'supabase') {
    return {
      dataModeUsed: 'static',
      status: 'live-unavailable',
      liveAvailable: false,
      fallbackReason: liveReason ?? 'Persisted market data unavailable',
    }
  }
  return {
    dataModeUsed: 'static',
    status: 'hybrid-fallback',
    liveAvailable: false,
    fallbackReason: liveReason ?? 'Persisted market data unavailable',
  }
}
