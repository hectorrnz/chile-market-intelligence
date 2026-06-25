// Phase 4C — MARKET_DATA_MODE resolution.
//
// Separate from DATA_MODE (BCCh macro) so BCCh live + market static can
// coexist independently. parseMarketDataMode / decideMarketSource are pure
// functions (no env, no I/O) and are unit-tested directly.

import type { DataMode, DataSourceStatus } from '../types'
import type { SourceDecision } from '../dataMode'

export type { DataMode, DataSourceStatus, SourceDecision }

/** Parse a raw MARKET_DATA_MODE string. Unknown/empty → 'static'. */
export function parseMarketDataMode(raw: string | undefined | null): DataMode {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'live') return 'live'
  if (v === 'hybrid') return 'hybrid'
  return 'static'
}

/**
 * Resolve the effective market data mode for this server process.
 * - Explicit MARKET_DATA_MODE wins.
 * - Falls back to 'static' if Brain Data is not configured.
 * Guarantees the app works with no market data env vars at all.
 */
export function getMarketDataMode(): DataMode {
  const explicit = process.env.MARKET_DATA_MODE
  if (explicit && explicit.trim()) return parseMarketDataMode(explicit)
  // Default to static — Brain Data credentials are not assumed present.
  return 'static'
}

/**
 * Decide which source to serve given the requested mode and provider result.
 * Mirrors the BCCh macro decideSource pattern for consistency.
 */
export function decideMarketSource(
  requested: DataMode,
  liveOk: boolean,
  liveReason?: string,
): SourceDecision {
  if (requested === 'static') {
    return { dataModeUsed: 'static', status: 'static', liveAvailable: false }
  }
  if (liveOk) {
    return {
      dataModeUsed: requested === 'hybrid' ? 'hybrid' : 'live',
      status: 'live',
      liveAvailable: true,
    }
  }
  if (requested === 'live') {
    return {
      dataModeUsed: 'static',
      status: 'live-unavailable',
      liveAvailable: false,
      fallbackReason: liveReason ?? 'Live market provider unavailable',
    }
  }
  return {
    dataModeUsed: 'static',
    status: 'hybrid-fallback',
    liveAvailable: false,
    fallbackReason: liveReason ?? 'Live market provider unavailable',
  }
}
