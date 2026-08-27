// Phase 8D — FRED macro provider (US region). Mirrors bcchMacroProvider.ts's
// shape exactly so the orchestrator (macroProvider.ts) can treat both
// providers uniformly, just filtered to each provider's own enabled series.

import type { MacroProvider, ProviderResult } from './types'
import type { MacroIndicator, MacroHistoryPoint } from '@/types'
import { isFredConfigured, fetchFredSeries, type FredSeriesPoint } from './fredClient'
import { getEnabledFredSeries, getSeriesByStaticId, type MacroSeriesDef } from '@/config/macroSeries'
import { deriveValueChange, transformSeries, monthEndSample, requiredFetchStart, earliestIso } from './transforms'
import { isPlausible } from './plausibility'

const NO_CODE = 'No live FRED series code mapped yet'

function firstDateFor(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

/** Applies the series' resample policy (if any) before any transform/derivation. */
function preprocess(def: MacroSeriesDef, points: FredSeriesPoint[]): FredSeriesPoint[] {
  return def.resample === 'month-end' ? monthEndSample(points) : points
}

/** Build a MacroIndicator from a fetched series, applying transform + plausibility. */
function toIndicator(def: MacroSeriesDef, points: FredSeriesPoint[]): MacroIndicator | null {
  const derived = deriveValueChange(preprocess(def, points), def.transformation)
  if (!derived) return null
  // Reject an implausible value rather than display a wrong mapping.
  if (!isPlausible(def.manualKey, derived.value)) return null
  const isPct = def.unit === '%'
  return {
    id: def.fallbackStaticId,
    name: def.displayName,
    shortName: def.displayName,
    category: def.category,
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
    // Bound to a short recent window (mirrors bcchMacroProvider's firstDateFor(2))
    // — a listing only needs the latest value + prior for change, never the
    // full multi-decade history a daily Treasury-yield series like DGS10 has.
    const startDate = firstDateFor(2)
    for (const def of series) {
      const res = await fetchFredSeries(def.providerSeriesCode as string, { startDate })
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

    // R13.R5F § 1A — request enough context for THIS series' transform to have
    // a real base at the oldest CHARTED point, derived from the display window
    // and the transform's lookback rather than a flat extra year. cosd/coed
    // keep the request bounded instead of downloading a series' full
    // multi-decade history just to chart a 1-10Y window.
    const cutoffIso = firstDateFor(years)
    const startDate = earliestIso(
      firstDateFor(years + 1),
      requiredFetchStart(cutoffIso, def.transformation, def.frequency),
    )
    const res = await fetchFredSeries(def.providerSeriesCode, { startDate })
    if (!res.ok) return res
    // Transform the FULL fetched series, THEN window the result. Windowing
    // first discarded the leading context this request went and fetched, so a
    // yoy chart's oldest points had no base inside the data and were computed
    // against whatever was nearest — the same wrong-base defect that corrupted
    // persisted CPI y/y (see YEAR_AGO_MAX_DRIFT_DAYS in transforms.ts).
    const data: MacroHistoryPoint[] = transformSeries(preprocess(def, res.data), def.transformation)
      .filter((p) => p.date >= cutoffIso)
      .map((p) => ({ indicatorId, date: p.date, value: p.value }))
    if (data.length < 2) return { ok: false, reason: 'FRED series too short to chart' }
    return { ok: true, data, source: 'FRED (Federal Reserve Bank of St. Louis)', lastUpdated: res.lastUpdated }
  },
}
