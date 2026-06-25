// Phase 5B — Macro repository.
// Static source: src/data/macroIndicators.json + macroHistory.json
// Supabase source: macro_indicators + macro_observations tables
// Falls back to static when DB_MODE=static or Supabase not configured.

import type { DbListResult } from '../types'
import type { MacroIndicatorRow, MacroObservationRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode'

export interface MacroIndicatorRecord {
  id: string
  region: string
  name: string
  shortName?: string
  category?: string
  unit?: string
  value?: number
  changeLabel?: string
  importance?: string
  source?: string
  live?: boolean
}

export interface MacroObservationRecord {
  indicatorId: string
  date: string
  value: number
}

function loadStaticIndicators(): MacroIndicatorRecord[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../../data/macroIndicators.json') as Array<Record<string, unknown>>
  return raw.map((r) => ({
    id: r.id as string,
    region: (r.region as string) ?? 'CL',
    name: r.name as string,
    shortName: r.shortName as string | undefined,
    category: r.category as string | undefined,
    unit: r.unit as string | undefined,
    value: r.value as number | undefined,
    changeLabel: r.changeLabel as string | undefined,
    importance: r.importance as string | undefined,
    source: r.source as string | undefined,
  }))
}

export async function getMacroIndicators(): Promise<DbListResult<MacroIndicatorRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticIndicators(), source: 'static' }
      const res = await db.from('macro_indicators').select('*').order('region')
      const rows = res.data as unknown as MacroIndicatorRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticIndicators(), source: 'static', error: res.error?.message }
      }
      const records: MacroIndicatorRecord[] = rows.map((r) => ({
        id: r.id,
        region: r.region,
        name: r.name,
        shortName: r.short_name ?? undefined,
        category: r.category ?? undefined,
        unit: r.unit ?? undefined,
        source: r.source_provider ?? undefined,
        live: r.live_enabled,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticIndicators(), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticIndicators(), source: 'static' }
}

export async function getMacroHistory(
  indicatorId: string,
  limit = 48,
): Promise<DbListResult<MacroObservationRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticHistory(indicatorId, limit), source: 'static' }
      const res = await db
        .from('macro_observations')
        .select('*')
        .eq('indicator_id', indicatorId)
        .order('observation_date', { ascending: false })
        .limit(limit)
      const rows = res.data as unknown as MacroObservationRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticHistory(indicatorId, limit), source: 'static', error: res.error?.message }
      }
      const records: MacroObservationRecord[] = rows.map((r) => ({
        indicatorId: r.indicator_id ?? indicatorId,
        date: r.observation_date,
        value: Number(r.value),
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticHistory(indicatorId, limit), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticHistory(indicatorId, limit), source: 'static' }
}

function loadStaticHistory(indicatorId: string, limit: number): MacroObservationRecord[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../../data/macroHistory.json') as Array<{ id: string; date: string; value: number }>
  return raw
    .filter((r) => r.id === indicatorId)
    .slice(0, limit)
    .map((r) => ({ indicatorId: r.id, date: r.date, value: r.value }))
}
