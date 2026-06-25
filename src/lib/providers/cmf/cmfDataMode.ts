// Phase 5A — CMF_DATA_MODE resolution.
//
// Separate from DATA_MODE (BCCh macro) and MARKET_DATA_MODE (Brain Data) so each
// provider can be toggled independently. parseCmfDataMode / decideCmfSource are
// pure functions (no env, no I/O) and are unit-tested directly.

import type { DataMode, DataSourceStatus } from '../types'
import type { SourceDecision } from '../dataMode'

export type { DataMode, DataSourceStatus, SourceDecision }

/** Parse a raw CMF_DATA_MODE string. Unknown/empty → 'static'. */
export function parseCmfDataMode(raw: string | undefined | null): DataMode {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'live') return 'live'
  if (v === 'hybrid') return 'hybrid'
  return 'static'
}

/**
 * Resolve the effective CMF data mode for this server process.
 * Defaults to 'static' — CMF live ingestion is not assumed present.
 * Guarantees the app works with no CMF env vars at all.
 */
export function getCmfDataMode(): DataMode {
  const explicit = process.env.CMF_DATA_MODE
  if (explicit && explicit.trim()) return parseCmfDataMode(explicit)
  return 'static'
}

/**
 * Decide which source to serve given the requested mode and provider result.
 * Mirrors the BCCh macro decideSource and Brain Data decideMarketSource patterns.
 */
export function decideCmfSource(
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
      fallbackReason: liveReason ?? 'CMF live provider unavailable',
    }
  }
  // hybrid + live failed → silent static fallback
  return {
    dataModeUsed: 'static',
    status: 'hybrid-fallback',
    liveAvailable: false,
    fallbackReason: liveReason ?? 'CMF live provider unavailable',
  }
}
