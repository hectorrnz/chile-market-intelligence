// Phase 4A — Static macro provider.
//
// Wraps the existing static JSON data layer behind the MacroProvider contract.
// SERVER-side (imported only by the orchestrator / route handlers), but reads
// only isomorphic JSON, so it carries no secrets.

import type { MacroProvider } from './types'
import { getAllIndicators } from '@/lib/data/macro'
import { getMacroHistoryForTimeframe } from '@/lib/data/macroHistory'
import { DATA_AS_OF } from '@/lib/constants'

export const staticMacroProvider: MacroProvider = {
  name: 'static',

  async getIndicators(region) {
    const all = getAllIndicators()
    const data = region
      ? all.filter(i => (region === 'CL' ? (!i.region || i.region === 'CL') : i.region === 'US'))
      : all
    return { ok: true, data, source: 'Static MVP', lastUpdated: DATA_AS_OF }
  },

  async getHistory(indicatorId, years) {
    const data = getMacroHistoryForTimeframe(indicatorId, years)
    if (data.length < 1) return { ok: false, reason: 'No static history for indicator' }
    return { ok: true, data, source: 'Static MVP', lastUpdated: DATA_AS_OF }
  },
}
