// Phase 4A — DATA_MODE resolution + source-decision logic.
//
// parseDataMode / decideSource are PURE (no env, no I/O) so they are unit-tested
// directly. getDataMode reads server env and is only called inside route
// handlers. Importing this module from a client bundle is safe: the type import
// below is erased, and process.env access only runs when getDataMode() is
// invoked on the server.

import type { DataMode, DataSourceStatus } from './types'

/** Parse a raw DATA_MODE string into a valid mode. Unknown/empty → 'static'. */
export function parseDataMode(raw: string | undefined | null): DataMode {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'live') return 'live'
  if (v === 'hybrid') return 'hybrid'
  return 'static'
}

/**
 * Resolve the effective DATA_MODE for this server process.
 * - explicit DATA_MODE wins
 * - else default to 'hybrid' when BCCh credentials are present
 * - else 'static' (guarantees the app works with no env vars at all)
 */
export function getDataMode(): DataMode {
  const explicit = process.env.DATA_MODE
  if (explicit && explicit.trim()) return parseDataMode(explicit)
  if (process.env.BCCH_API_USER && process.env.BCCH_API_PASSWORD) return 'hybrid'
  return 'static'
}

export interface SourceDecision {
  dataModeUsed: DataMode
  status: DataSourceStatus
  liveAvailable: boolean
  fallbackReason?: string
}

/**
 * Decide which source to serve given the requested mode and whether the live
 * provider succeeded. This never throws and always yields a usable decision —
 * the orchestrator serves static data whenever liveAvailable is false.
 */
export function decideSource(requested: DataMode, liveOk: boolean, liveReason?: string): SourceDecision {
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
    return { dataModeUsed: 'static', status: 'live-unavailable', liveAvailable: false, fallbackReason: liveReason ?? 'Live provider unavailable' }
  }
  // hybrid + live failed → silent static fallback
  return { dataModeUsed: 'static', status: 'hybrid-fallback', liveAvailable: false, fallbackReason: liveReason ?? 'Live provider unavailable' }
}
