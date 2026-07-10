// Phase 8D — FRED macro provider (US region). Mirrors bcchMacroProvider.ts's
// shape exactly so the orchestrator (macroProvider.ts) can treat both
// providers uniformly, just filtered to each provider's own enabled series.

import type { MacroProvider, ProviderResult } from './types'
import type { MacroIndicator, MacroHistoryPoint } from '@/types'
import { isFredConfigured, fetchFredSeries, type FredSeriesPoint } from './fredClient'
import { getEnabledFredSeries, getSeriesByStaticId, type MacroSeriesDef } from '@/config/macroSeries'
import { deriveValueChange, transformSeries } from './transforms'
import { isPlausible } from './plausibility'

const NO_CODE = 'No live FRED series code mapped yet'

/** Build a MacroIndicator from a fetched series, applying transform + plausibility. */
function toIndicator(def: MacroSeriesDef, points: FredSeriesPoint[]): MacroIndicator | null {
  const derived = deriveValueChange(points, def.transformation)
  if (!derived) return null
  // Reject an implausible value rather than display a wrong mapping.
  if (!isPlausible(def.manualKey, derived.value)) return null
  const isPct = def.unit === '%'
  return {
    id: def.fallbackStaticId,
    name: def.displayName,
    shortName: def.displayName,
    category: 'US Rates',
    region: def.region,
    value: derived.value,
    unit: def.unit,
    change: derived.change ?? undefined,
    changeLabel: derived.change != null ? `${derived.change >= 0 ? '+' : ''}${derived.change}${isPct ? '%' : ''}` : undefined,
    period: derived.asOf,
    source: def.source,
    lastUpdated: derived.asOf,
    importance: 'high',
    marketImplication: undefined,
  }
}

export const fredMacroProvider: MacroProvider = {
  name: 'fred',

  async getIndicators(region): Promise<ProviderResult<MacroIndicator[]>> {
    if (!isFredConfigured()) return { ok: false, reason: 'FRED not available' }
    const series = getEnabledFredSeries(region)
    if (series.length === 0) return { ok: false, reason: NO_CODE }

    const out: MacroIndicator[] = []
    let lastUpdated = ''
    for (const def of series) {
      const res = await fetchFredSeries(def.providerSeriesCode as string)
      if (!res.ok) continue
      const ind = toIndicator(def, res.data)
      if (ind) { out.push(ind); if (ind.lastUpdated > lastUpdated) lastUpdated = ind.lastUpdated }
    }
    if (out.length === 0) return { ok: false, reason: 'FRED returned no usable series' }
    return { ok: true, data: out, source: 'FRED (Federal Reserve Bank of St. Louis)', lastUpdated }
  },

  async getHistory(indicatorId, years): Promise<ProviderResult<MacroHistoryPoint[]>> {
    if (!isFredConfigured()) return { ok: false, reason: 'FRED not available' }
    const def = getSeriesByStaticId(indicatorId)
    if (!def || def.sourceProvider !== 'FRED' || !def.enabled || !def.providerSeriesCode) {
      return { ok: false, reason: NO_CODE }
    }

    const res = await fetchFredSeries(def.providerSeriesCode)
    if (!res.ok) return res
    // FRED's CSV endpoint has no from/to param — filter client-side to the requested window.
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - years)
    const cutoffIso = cutoff.toISOString().slice(0, 10)
    const windowed = res.data.filter((p) => p.date >= cutoffIso)
    const data: MacroHistoryPoint[] = transformSeries(windowed, def.transformation)
      .map((p) => ({ indicatorId, date: p.date, value: p.value }))
    if (data.length < 2) return { ok: false, reason: 'FRED series too short to chart' }
    return { ok: true, data, source: 'FRED (Federal Reserve Bank of St. Louis)', lastUpdated: res.lastUpdated }
  },
}
