// Phase 4A/4B — BCCh macro provider.
//
// SERVER-ONLY. Implements the MacroProvider contract against the BCCh BDE
// client + series registry, applying each series' transformation (4B) and a
// plausibility guard before returning live values. Because every registry entry
// is currently unverified (see bcchSeriesManualMap), getEnabledSeries returns an
// empty list and both methods report "No live provider series code mapped yet"
// → the orchestrator falls back to static data.

import type { MacroProvider, ProviderResult } from './types'
import type { MacroIndicator, MacroHistoryPoint } from '@/types'
import { isBcchConfigured, fetchBcchSeries, type BcchSeriesPoint } from './bcchClient'
import { getEnabledBcchSeries, getSeriesByStaticId, type MacroSeriesDef } from '@/config/macroSeries'
import { deriveValueChange, transformSeries } from './transforms'
import { isPlausible } from './plausibility'

const NO_CODE = 'No live provider series code mapped yet'

function firstDateFor(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

/** Build a MacroIndicator from a fetched series, applying transform + plausibility. */
function toIndicator(def: MacroSeriesDef, points: BcchSeriesPoint[]): MacroIndicator | null {
  const derived = deriveValueChange(points, def.transformation)
  if (!derived) return null
  // Reject an implausible value rather than display a wrong mapping.
  if (!isPlausible(def.manualKey, derived.value)) return null
  const isPct = def.unit === '%'
  return {
    id: def.fallbackStaticId,
    name: def.displayName,
    shortName: def.displayName,
    category: 'Rates',
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

export const bcchMacroProvider: MacroProvider = {
  name: 'bcch',

  async getIndicators(region): Promise<ProviderResult<MacroIndicator[]>> {
    if (!isBcchConfigured()) return { ok: false, reason: 'BCCh credentials not configured' }
    const series = getEnabledBcchSeries(region)
    if (series.length === 0) return { ok: false, reason: NO_CODE }

    const out: MacroIndicator[] = []
    let lastUpdated = ''
    for (const def of series) {
      const res = await fetchBcchSeries(def.providerSeriesCode as string, { firstDate: firstDateFor(2) })
      if (!res.ok) continue
      const ind = toIndicator(def, res.data)
      if (ind) { out.push(ind); if (ind.lastUpdated > lastUpdated) lastUpdated = ind.lastUpdated }
    }
    if (out.length === 0) return { ok: false, reason: 'BCCh returned no usable series' }
    return { ok: true, data: out, source: 'Banco Central de Chile (BDE)', lastUpdated }
  },

  async getHistory(indicatorId, years): Promise<ProviderResult<MacroHistoryPoint[]>> {
    if (!isBcchConfigured()) return { ok: false, reason: 'BCCh credentials not configured' }
    const def = getSeriesByStaticId(indicatorId)
    if (!def || def.sourceProvider !== 'BCCh' || !def.enabled || !def.providerSeriesCode) return { ok: false, reason: NO_CODE }

    const res = await fetchBcchSeries(def.providerSeriesCode, { firstDate: firstDateFor(years) })
    if (!res.ok) return res
    const data: MacroHistoryPoint[] = transformSeries(res.data, def.transformation)
      .map(p => ({ indicatorId, date: p.date, value: p.value }))
    if (data.length < 2) return { ok: false, reason: 'BCCh series too short to chart' }
    return { ok: true, data, source: 'Banco Central de Chile (BDE)', lastUpdated: res.lastUpdated }
  },
}
