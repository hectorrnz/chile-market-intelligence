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
 * All macro popup charts use a **monthly** frequency, sliced to the timeframe
 * (years × 12 points). Falls back to quarterly when monthly is unavailable.
 */
export function getMacroHistoryForTimeframe(
  indicatorId: string,
  years: 1 | 3 | 5 | 10
): MacroHistoryPoint[] {
  const monthly = monthlyFor(indicatorId)
  if (monthly.length >= 2) return monthly.slice(-years * 12)
  return byType(indicatorId, 'quarterly').slice(-years * 4)
}
