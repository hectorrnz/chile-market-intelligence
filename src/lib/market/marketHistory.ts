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

// ─── Live-provider (Yahoo Finance chart) date range ────────────────────────────
// Unlike resolveHistoryDateRange (which returns null for 3Y/5Y — those require
// years of accumulated Supabase snapshots we don't have yet), a live Yahoo
// Finance fetch genuinely has years of real daily history for any listed
// ticker, so every timeframe resolves to a real range here — no null case.

export function resolveLiveHistoryDateRange(
  timeframe: StockTimeframe,
  today?: string,
): { from: string; to: string } {
  const todayStr = today ?? new Date().toISOString().slice(0, 10)
  const to = todayStr

  let from: string
  switch (timeframe) {
    case '1D':  from = subtractDays(todayStr, 4);            break
    case '5D':  from = subtractDays(todayStr, 10);           break
    case '1M':  from = subtractDays(todayStr, 35);           break
    case 'MTD': from = `${todayStr.slice(0, 7)}-01`;         break
    case 'YTD': from = `${todayStr.slice(0, 4)}-01-01`;      break
    case '1Y':  from = subtractDays(todayStr, 370);          break
    case '3Y':  from = subtractDays(todayStr, 3 * 365 + 10); break
    case '5Y':  from = subtractDays(todayStr, 5 * 365 + 15); break
    default:    from = subtractDays(todayStr, 35);           break
  }

  return { from, to }
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

// A persisted series can clear the point-count threshold above while still
// covering only a fraction of the requested window — e.g. accumulated
// snapshot history starting a few weeks ago will have ≥5 points long before
// it has genuinely covered a full year, but a naive `from: <a year ago>`
// query still returns those points without complaint. Silently presenting
// that truncated window as "1Y"/"YTD" is materially misleading (a real bug
// found 2026-07-20: Compare's YTD and 1M figures were identical for every
// ticker, because both queries silently clipped to the same ~3-week-old
// earliest snapshot). MIN_COVERAGE_RATIO requires the series to actually
// span most of the requested range, not just clear a point-count floor.
const MIN_COVERAGE_RATIO = 0.7

function daysBetween(a: string, b: string): number {
  return (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000
}

export function isSufficientMarketHistory(
  points: StockHistoryPoint[],
  timeframe: StockTimeframe,
  /** The window this history was requested for — pass resolveHistoryDateRange's
   *  result to also enforce date coverage, not just a point count. Omit (or
   *  pass null) to check point count only, matching the original behavior. */
  requestedRange?: { from: string; to: string } | null,
): boolean {
  const min = HISTORY_MIN_POINTS[timeframe] ?? 1
  if (points.length < min) return false
  if (!requestedRange) return true
  const requestedDays = daysBetween(requestedRange.from, requestedRange.to)
  if (requestedDays <= 0) return true
  const coveredDays = daysBetween(points[0].date, points[points.length - 1].date)
  return coveredDays >= requestedDays * MIN_COVERAGE_RATIO
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
