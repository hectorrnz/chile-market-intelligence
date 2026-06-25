// Phase 5B — DB mode resolution (mirrors dataMode.ts / marketDataMode.ts pattern).
// Controls whether repositories read from static JSON or Supabase.

import type { DbMode } from './types'
import { isSupabaseConfigured } from '../supabase/env.ts'

/** Parses the DB_MODE env var; falls back to 'static' for any unrecognised value. */
export function parseDbMode(raw: string | undefined): DbMode {
  const v = raw?.trim().toLowerCase()
  if (v === 'supabase' || v === 'hybrid') return v
  return 'static'
}

/** Returns the configured DbMode for this process. Server-safe; never throws. */
export function getDbMode(): DbMode {
  return parseDbMode(process.env.DB_MODE)
}

/**
 * Resolves the effective source for a DB request:
 * - 'static' when mode is static or Supabase is not configured
 * - 'supabase' when mode is 'supabase'
 * - 'supabase' when mode is 'hybrid' (falls back to 'static' at call time on error)
 */
export function decideDbSource(mode?: DbMode): 'static' | 'supabase' {
  const m = mode ?? getDbMode()
  if (m === 'static') return 'static'
  if (!isSupabaseConfigured()) return 'static'
  return 'supabase'
}
