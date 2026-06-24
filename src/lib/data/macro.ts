import macroData from '@/data/macroIndicators.json'
import type { MacroIndicator } from '@/types'
import type { MacroIndicatorsResponse } from '@/lib/providers/types'

const indicators = macroData as MacroIndicator[]

export function getAllIndicators(): MacroIndicator[] { return indicators }
export function getByCategory(category: MacroIndicator['category']): MacroIndicator[] {
  return indicators.filter(i => i.category === category)
}
export function getHighImportance(): MacroIndicator[] {
  return indicators.filter(i => i.importance === 'high')
}

/**
 * Client-safe live/hybrid fetch (Phase 4A). Calls the server /api/macro route,
 * which decides static vs live and returns data + source metadata. Returns null
 * on any error so callers keep their static render. Only imports a TYPE from the
 * provider layer, so no server code or credentials reach the browser bundle.
 */
export async function fetchMacroIndicators(
  region?: 'CL' | 'US',
  signal?: AbortSignal
): Promise<MacroIndicatorsResponse | null> {
  try {
    const q = region ? `?region=${region}` : ''
    const res = await fetch(`/api/macro${q}`, { signal })
    if (!res.ok) return null
    return (await res.json()) as MacroIndicatorsResponse
  } catch {
    return null
  }
}
