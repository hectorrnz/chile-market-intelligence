// Phase 4A — Macro provider orchestrator.
//
// SERVER-ONLY (imported by the /api/macro route handlers). Applies the
// static / live / hybrid policy and attaches non-sensitive metadata. Never
// throws and never leaks credentials or raw provider errors — only our own
// short `reason` strings reach the client.

import type { MacroIndicatorsResponse, MacroHistoryResponse, MacroChartPoint } from './types'
import { getDataMode, decideSource } from './dataMode'
import { staticMacroProvider } from './staticMacroProvider'
import { bcchMacroProvider } from './bcchMacroProvider'
import { getSeriesByStaticId } from '@/config/macroSeries'
import { getDbMode, decideDbSource } from '@/lib/db/dbMode'
import {
  getMacroObservationsForTimeframe,
  isSufficientHistory,
} from '@/lib/db/repositories/macroRepository'

const BCCH_PROVIDER = 'BCCh BDE'

export async function resolveMacroIndicators(region?: 'CL' | 'US'): Promise<MacroIndicatorsResponse> {
  const requested = getDataMode()

  let liveOk = false
  let liveReason: string | undefined
  let liveData = null as Awaited<ReturnType<typeof bcchMacroProvider.getIndicators>> | null
  if (requested !== 'static') {
    liveData = await bcchMacroProvider.getIndicators(region)
    if (liveData.ok) liveOk = true
    else liveReason = liveData.reason
  }

  const decision = decideSource(requested, liveOk, liveReason)

  if (decision.liveAvailable && liveData && liveData.ok) {
    return {
      data: liveData.data,
      metadata: {
        dataModeRequested: requested,
        dataModeUsed: decision.dataModeUsed,
        liveAvailable: true,
        status: decision.status,
        source: liveData.source,
        lastUpdated: liveData.lastUpdated,
        provider: BCCH_PROVIDER,
      },
    }
  }

  const stat = await staticMacroProvider.getIndicators(region)
  return {
    data: stat.ok ? stat.data : [],
    metadata: {
      dataModeRequested: requested,
      dataModeUsed: 'static',
      liveAvailable: false,
      status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP',
      lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason: decision.fallbackReason,
      provider: 'static',
    },
  }
}

export async function resolveMacroHistory(
  indicatorId: string,
  years: 1 | 3 | 5 | 10
): Promise<MacroHistoryResponse> {
  const dataMode = getDataMode()
  const dbMode   = getDbMode()
  const dbSource = decideDbSource(dbMode)

  // ─── Layer 1: Supabase persisted observations ────────────────────────────
  if (dbSource === 'supabase') {
    const persisted = await getMacroObservationsForTimeframe(indicatorId, years)
    if (persisted.source === 'supabase' && isSufficientHistory(persisted.data, years)) {
      const latest = persisted.data[persisted.data.length - 1]
      return {
        data: persisted.data,
        metadata: {
          dataModeRequested: dataMode,
          dataModeUsed: dataMode,
          liveAvailable: false,
          status: 'persisted',
          source: 'Persisted BCCh via Supabase',
          lastUpdated: latest?.date ?? '',
          provider: BCCH_PROVIDER,
          persistedAvailable: true,
          observationCount: persisted.data.length,
          latestObservationDate: latest?.date,
          dbModeRequested: dbMode,
          dbModeUsed: 'supabase',
        },
      }
    }

    // Pure supabase mode: no BCCh or static fallback
    if (dbMode === 'supabase') {
      return {
        data: [],
        metadata: {
          dataModeRequested: dataMode,
          dataModeUsed: 'static',
          liveAvailable: false,
          status: 'live-unavailable',
          source: 'Supabase',
          lastUpdated: '',
          persistedAvailable: false,
          fallbackReason: 'Insufficient observations in Supabase for this indicator/timeframe',
          dbModeRequested: dbMode,
          dbModeUsed: 'supabase',
        },
      }
    }
    // DB_MODE=hybrid: fall through to BCCh live or static
  }

  // ─── Layer 2: BCCh live ──────────────────────────────────────────────────
  let liveOk = false
  let liveReason: string | undefined
  let liveData = null as Awaited<ReturnType<typeof bcchMacroProvider.getHistory>> | null
  if (dataMode !== 'static') {
    liveData = await bcchMacroProvider.getHistory(indicatorId, years)
    if (liveData.ok) liveOk = true
    else liveReason = liveData.reason
  }

  const decision = decideSource(dataMode, liveOk, liveReason)

  if (decision.liveAvailable && liveData && liveData.ok) {
    const points: MacroChartPoint[] = liveData.data.map(p => ({ date: p.date, value: p.value }))
    const seriesId = getSeriesByStaticId(indicatorId)?.providerSeriesCode ?? undefined
    return {
      data: points,
      metadata: {
        dataModeRequested: dataMode,
        dataModeUsed: decision.dataModeUsed,
        liveAvailable: true,
        status: decision.status,
        source: liveData.source,
        lastUpdated: liveData.lastUpdated,
        provider: BCCH_PROVIDER,
        seriesId: seriesId ?? undefined,
        persistedAvailable: false,
        dbModeRequested: dbMode,
        dbModeUsed: 'static',
      },
    }
  }

  // ─── Layer 3: Static fallback ────────────────────────────────────────────
  const stat = await staticMacroProvider.getHistory(indicatorId, years)
  const points: MacroChartPoint[] = stat.ok ? stat.data.map(p => ({ date: p.date, value: p.value })) : []
  const fallbackReason = dataMode === 'static'
    ? undefined
    : (decision.fallbackReason ?? 'No live provider series code mapped yet')
  return {
    data: points,
    metadata: {
      dataModeRequested: dataMode,
      dataModeUsed: 'static',
      liveAvailable: false,
      status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP',
      lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason,
      provider: 'static',
      persistedAvailable: false,
      dbModeRequested: dbMode,
      dbModeUsed: 'static',
    },
  }
}
