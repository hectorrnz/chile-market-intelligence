import rawHistory from '@/data/macroHistory.json'
import type { MacroHistoryPoint } from '@/types'

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
 * Macro popup chart frequencies:
 *   1Y  → daily   (up to 365 business days)
 *   3Y  → weekly  (up to 3×52 weeks)
 *   5Y / 10Y → monthly (downsampled from weekly)
 * Each falls back to the next coarser series if the preferred one is unavailable.
 */
export function getMacroHistoryForTimeframe(
  indicatorId: string,
  years: 1 | 3 | 5 | 10
): MacroHistoryPoint[] {
  if (years === 1) {
    const daily = byType(indicatorId, 'daily')
    if (daily.length >= 2) return daily.slice(-365)
    const monthly = monthlyFor(indicatorId)
    if (monthly.length >= 2) return monthly.slice(-12)
    return byType(indicatorId, 'quarterly').slice(-4)
  }
  if (years === 3) {
    const weekly = byType(indicatorId, 'weekly')
    if (weekly.length >= 2) return weekly.slice(-3 * 52)
    const monthly = monthlyFor(indicatorId)
    if (monthly.length >= 2) return monthly.slice(-36)
    return byType(indicatorId, 'quarterly').slice(-12)
  }
  // 5Y and 10Y: monthly (downsampled from weekly)
  const monthly = monthlyFor(indicatorId)
  if (monthly.length >= 2) return monthly.slice(-years * 12)
  return byType(indicatorId, 'quarterly').slice(-years * 4)
}
