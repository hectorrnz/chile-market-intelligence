import rawHistory from '@/data/macroHistory.json'
import type { MacroHistoryPoint } from '@/types'
import type { MacroHistoryResponse } from '@/lib/providers/types'
import { macroChartFrequency } from '@/lib/providers/macroFrequency'

const history = rawHistory as MacroHistoryPoint[]

export function getMacroHistory(indicatorId: string): MacroHistoryPoint[] {
  return history.filter(p => p.indicatorId === indicatorId)
}

function byType(indicatorId: string, type: 'daily' | 'weekly' | 'quarterly'): MacroHistoryPoint[] {
  return history
    .filter(p => p.indicatorId === indicatorId && (p.type ?? 'quarterly') === type)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Monthly series: last point of each calendar month from the weekly series. */
function monthlyFor(indicatorId: string): MacroHistoryPoint[] {
  const weekly = byType(indicatorId, 'weekly')
  const m = new Map<string, MacroHistoryPoint>()
  for (const p of weekly) m.set(p.date.slice(0, 7), p)
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Macro popup chart frequencies — category-aware (see macroFrequency.ts):
 *   • Market series (non-CB rates, FX, commodities, crypto):
 *       1Y → daily · 3Y/5Y → weekly · 10Y → monthly
 *   • CB rates (TPM, Fed Funds) + inflation + labor + activity:
 *       monthly at every timeframe
 * Each frequency falls back to the next coarser materialized series if the
 * preferred one is unavailable in the static bundle.
 */
export function getMacroHistoryForTimeframe(
  indicatorId: string,
  years: 1 | 3 | 5 | 10
): MacroHistoryPoint[] {
  const freq = macroChartFrequency(indicatorId, years)

  if (freq === 'daily') {
    const daily = byType(indicatorId, 'daily')
    if (daily.length >= 2) return daily.slice(-365)
    const weekly = byType(indicatorId, 'weekly')
    if (weekly.length >= 2) return weekly.slice(-52)
    return byType(indicatorId, 'quarterly').slice(-4)
  }

  if (freq === 'weekly') {
    const weekly = byType(indicatorId, 'weekly')
    if (weekly.length >= 2) return weekly.slice(-years * 52)
    const monthly = monthlyFor(indicatorId)
    if (monthly.length >= 2) return monthly.slice(-years * 12)
    return byType(indicatorId, 'quarterly').slice(-years * 4)
  }

  // monthly (CB rates, inflation, labor, activity — every timeframe)
  const monthly = monthlyFor(indicatorId)
  if (monthly.length >= 2) return monthly.slice(-years * 12)
  return byType(indicatorId, 'quarterly').slice(-years * 4)
}

/**
 * Client-safe live/hybrid history fetch (Phase 4A). Calls /api/macro/history,
 * which returns live BCCh points when available, else the static fallback.
 * Returns null on error so the caller keeps its static chart. Only a TYPE is
 * imported from the provider layer — no server code reaches the browser.
 */
export async function fetchMacroHistory(
  indicatorId: string,
  timeframe: '1Y' | '3Y' | '5Y' | '10Y',
  signal?: AbortSignal
): Promise<MacroHistoryResponse | null> {
  try {
    const res = await fetch(`/api/macro/history/${encodeURIComponent(indicatorId)}?timeframe=${timeframe}`, { signal })
    if (!res.ok) return null
    return (await res.json()) as MacroHistoryResponse
  } catch {
    return null
  }
}
