// Phase 4A — Macro provider orchestrator.
//
// SERVER-ONLY (imported by the /api/macro route handlers). Applies the
// static / live / hybrid policy and attaches non-sensitive metadata. Never
// throws and never leaks credentials or raw provider errors — only our own
// short `reason` strings reach the client.

import type { MacroIndicatorsResponse, MacroHistoryResponse, MacroChartPoint } from './types'
import type { MacroIndicator } from '@/types'
import { getDataMode, decideSource } from './dataMode'
import { staticMacroProvider } from './staticMacroProvider'
import { bcchMacroProvider } from './bcchMacroProvider'
import { fredMacroProvider } from './fredMacroProvider'
import { getSeriesByStaticId } from '@/config/macroSeries'
import { applyMacroFrequency } from './macroFrequency'
import { getDbMode, decideDbSource } from '@/lib/db/dbMode'
import {
  getMacroObservationsForTimeframe,
  isSufficientHistory,
} from '@/lib/db/repositories/macroRepository'

const BCCH_PROVIDER = 'BCCh BDE'
const FRED_PROVIDER = 'FRED (St. Louis Fed)'

/**
 * Combines both providers' live indicators. A ticker's region determines which
 * provider actually has data for it (BCCh for CL, FRED for US) — calling both
 * unconditionally is safe: the provider with no enabled series for that region
 * cleanly returns `{ ok: false, reason: 'No live ... series code mapped yet' }`
 * and is simply excluded from the merge, never a hard error.
 */
export async function resolveMacroIndicators(region?: 'CL' | 'US'): Promise<MacroIndicatorsResponse> {
  const requested = getDataMode()

  let liveOk = false
  let liveReason: string | undefined
  const sources: string[] = []
  let combinedData: MacroIndicator[] = []
  let lastUpdated = ''

  if (requested !== 'static') {
    const [bcchRes, fredRes] = await Promise.all([
      bcchMacroProvider.getIndicators(region),
      fredMacroProvider.getIndicators(region),
    ])
    if (bcchRes.ok) {
      liveOk = true
      combinedData = [...combinedData, ...bcchRes.data]
      sources.push(bcchRes.source)
      if (bcchRes.lastUpdated > lastUpdated) lastUpdated = bcchRes.lastUpdated
    }
    if (fredRes.ok) {
      liveOk = true
      combinedData = [...combinedData, ...fredRes.data]
      sources.push(fredRes.source)
      if (fredRes.lastUpdated > lastUpdated) lastUpdated = fredRes.lastUpdated
    }
    if (!bcchRes.ok && !fredRes.ok) liveReason = bcchRes.reason || fredRes.reason
  }

  const decision = decideSource(requested, liveOk, liveReason)

  if (decision.liveAvailable && combinedData.length > 0) {
    return {
      data: combinedData,
      metadata: {
        dataModeRequested: requested,
        dataModeUsed: decision.dataModeUsed,
        liveAvailable: true,
        status: decision.status,
        source: sources.join(' + '),
        lastUpdated,
        provider: sources.length > 1 ? `${BCCH_PROVIDER} + ${FRED_PROVIDER}` : (sources[0] ?? BCCH_PROVIDER),
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
  const persistedDef = getSeriesByStaticId(indicatorId)
  const persistedProviderLabel = persistedDef?.sourceProvider === 'FRED' ? FRED_PROVIDER : BCCH_PROVIDER
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
          source: `Persisted via Supabase (${persistedProviderLabel})`,
          lastUpdated: latest?.date ?? '',
          provider: persistedProviderLabel,
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

  // ─── Layer 2: live (BCCh for CL series, FRED for US series) ─────────────
  const def = getSeriesByStaticId(indicatorId)
  const provider = def?.sourceProvider === 'FRED' ? fredMacroProvider : bcchMacroProvider
  const providerLabel = def?.sourceProvider === 'FRED' ? FRED_PROVIDER : BCCH_PROVIDER

  let liveOk = false
  let liveReason: string | undefined
  let liveData = null as Awaited<ReturnType<typeof provider.getHistory>> | null
  if (dataMode !== 'static') {
    liveData = await provider.getHistory(indicatorId, years)
    if (liveData.ok) liveOk = true
    else liveReason = liveData.reason
  }

  const decision = decideSource(dataMode, liveOk, liveReason)

  if (decision.liveAvailable && liveData && liveData.ok) {
    // Live providers return their series at native cadence (daily for Treasury
    // yields, monthly for CPI, etc.). Apply the same category-aware frequency
    // policy the persisted and static paths use so the popup chart's density is
    // identical regardless of which layer served the data.
    const points: MacroChartPoint[] = applyMacroFrequency(
      liveData.data.map(p => ({ date: p.date, value: p.value })),
      indicatorId,
      years,
    )
    const seriesId = def?.providerSeriesCode ?? undefined
    return {
      data: points,
      metadata: {
        dataModeRequested: dataMode,
        dataModeUsed: decision.dataModeUsed,
        liveAvailable: true,
        status: decision.status,
        source: liveData.source,
        lastUpdated: liveData.lastUpdated,
        provider: providerLabel,
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
