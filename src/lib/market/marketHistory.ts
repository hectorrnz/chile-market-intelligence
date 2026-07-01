// Phase 4C.4 — Pure helpers for building chart history from accumulated
// Supabase market snapshots. No Supabase imports, no Next.js — unit-testable.

import type { StockHistoryPoint, StockTimeframe } from '../providers/market/types.ts'
import type { StockHistorySnapshotRow } from '../db/repositories/marketRepository.ts'

// ─── Timeframe → date range ───────────────────────────────────────────────────
// Returns null for 3Y/5Y: those require years of accumulated daily data
// that doesn't exist yet. Callers fall through to static JSON history.

export function resolveHistoryDateRange(
  timeframe: StockTimeframe,
  today?: string,
): { from: string; to: string } | null {
  if (timeframe === '3Y' || timeframe === '5Y') return null

  const todayStr = today ?? new Date().toISOString().slice(0, 10)
  const to = todayStr

  let from: string
  switch (timeframe) {
    case '1D':  from = subtractDays(todayStr, 4);    break  // 4 cal days → ≥2 trading days
    case '5D':  from = subtractDays(todayStr, 10);   break  // 10 cal days → ≥6 trading days
    case '1M':  from = subtractDays(todayStr, 35);   break  // 35 cal days → ~22 trading days
    case 'MTD': from = `${todayStr.slice(0, 7)}-01`; break
    case 'YTD': from = `${todayStr.slice(0, 4)}-01-01`; break
    case '1Y':  from = subtractDays(todayStr, 370);  break  // 370 cal days → ~252 trading days
    default:    from = subtractDays(todayStr, 35);   break
  }

  return { from, to }
}

function subtractDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ─── Sufficiency thresholds ───────────────────────────────────────────────────

export const HISTORY_MIN_POINTS: Partial<Record<StockTimeframe, number>> = {
  '1D':  1,
  '5D':  3,
  '1M':  5,
  'MTD': 1,
  'YTD': 5,
  '1Y':  60,
  // 3Y / 5Y: resolveHistoryDateRange returns null — callers never reach here
}

export function isSufficientMarketHistory(
  points: StockHistoryPoint[],
  timeframe: StockTimeframe,
): boolean {
  const min = HISTORY_MIN_POINTS[timeframe] ?? 1
  return points.length >= min
}

// ─── Normalization ────────────────────────────────────────────────────────────

const SUPABASE_SOURCE   = 'Persisted Yahoo Finance via Supabase'
const SUPABASE_PROVIDER = 'supabase'

export function normalizeStockSnapshotsToHistoryPoints(
  rows: StockHistorySnapshotRow[],
): StockHistoryPoint[] {
  const points: StockHistoryPoint[] = []
  for (const r of rows) {
    if (r.price === null || r.price === undefined) continue
    points.push({
      ticker:   r.ticker,
      date:     r.snapshotDate,
      open:     null,
      high:     null,
      low:      null,
      close:    r.price,
      volume:   r.volume,
      source:   r.source ?? SUPABASE_SOURCE,
      provider: r.provider ?? SUPABASE_PROVIDER,
    })
  }
  return points
}
