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
import {
  getYahooMacroIndicators,
  getYahooMacroHistory,
  isYahooMacroIndicator,
} from './yahooMacroProvider'
import { applyMacroFrequency } from './macroFrequency'
import { pickFreshestMacroSource } from './macroHistorySource'
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
    // BTC/USD and DXY exist in neither FRED nor BCCh — they came from Yahoo or
    // stayed frozen on a 2025-06-17 static value forever. Fetched alongside the
    // other two providers; an empty result just leaves them on static.
    const [bcchRes, fredRes, yahooRes] = await Promise.all([
      bcchMacroProvider.getIndicators(region),
      fredMacroProvider.getIndicators(region),
      getYahooMacroIndicators(region),
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
    if (yahooRes.length > 0) {
      liveOk = true
      combinedData = [...combinedData, ...yahooRes]
      sources.push('Yahoo Finance')
      for (const i of yahooRes) if (i.lastUpdated > lastUpdated) lastUpdated = i.lastUpdated
    }
    if (!bcchRes.ok && !fredRes.ok && yahooRes.length === 0) liveReason = bcchRes.reason || fredRes.reason
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

  // ─── Yahoo-backed indicators (BTC/USD, DXY) ──────────────────────────────
  // Neither FRED nor BCCh carries these, so the popup chart could only ever
  // render the frozen static series. Same source as the row's value, so the
  // chart and the number can never disagree. Falls through to static on failure.
  if (isYahooMacroIndicator(indicatorId) && dataMode !== 'static') {
    const live = await getYahooMacroHistory(indicatorId, years)
    if (live.length >= 2) {
      const points: MacroChartPoint[] = applyMacroFrequency(
        live.map((p) => ({ date: p.date, value: p.value })),
        indicatorId,
        years,
      )
      const decision = decideSource(dataMode, true, undefined)
      return {
        data: points,
        metadata: {
          dataModeRequested: dataMode,
          dataModeUsed: decision.dataModeUsed,
          liveAvailable: true,
          status: decision.status,
          source: 'Yahoo Finance',
          lastUpdated: live[live.length - 1]?.date ?? '',
          provider: 'Yahoo Finance',
          dbModeRequested: dbMode,
          dbModeUsed: dbSource,
        },
      }
    }
  }

  const def = getSeriesByStaticId(indicatorId)
  const providerLabel = def?.sourceProvider === 'FRED' ? FRED_PROVIDER : BCCH_PROVIDER
  const provider = def?.sourceProvider === 'FRED' ? fredMacroProvider : bcchMacroProvider

  // ─── Strict Supabase mode (DB_MODE=supabase, not hybrid) ─────────────────
  // By design, never touches BCCh/FRED regardless of freshness — unchanged
  // from before this fix.
  if (dbSource === 'supabase' && dbMode === 'supabase') {
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
          source: `Persisted via Supabase (${providerLabel})`,
          lastUpdated: latest?.date ?? '',
          provider: providerLabel,
          persistedAvailable: true,
          observationCount: persisted.data.length,
          latestObservationDate: latest?.date,
          dbModeRequested: dbMode,
          dbModeUsed: 'supabase',
        },
      }
    }
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

  // ─── Hybrid / static DB mode: prefer whichever source is FRESHER ─────────
  // Point-count sufficiency alone isn't enough — a persisted series can clear
  // isSufficientHistory's coverage/6-month-staleness bar while a materially
  // newer observation has since been published live (verified 2026-07-20:
  // FRED's own CPIAUCSL series already had a 2026-06-01 print while the
  // persisted store, well inside the 6-month window, was still serving
  // 2026-05-01 for every timeframe). Fetching both and comparing their actual
  // latest dates — rather than trusting persisted just because it passed its
  // own bar — is what "the popup chart must be updating" actually requires.
  const [persistedResult, liveResult] = await Promise.all([
    dbSource === 'supabase' ? getMacroObservationsForTimeframe(indicatorId, years) : Promise.resolve(null),
    dataMode !== 'static' ? provider.getHistory(indicatorId, years) : Promise.resolve(null),
  ])

  const persistedOk = !!persistedResult && persistedResult.source === 'supabase' && isSufficientHistory(persistedResult.data, years)
  const liveOk = !!liveResult && liveResult.ok
  const persistedLatestDate = persistedOk ? (persistedResult!.data[persistedResult!.data.length - 1]?.date ?? '') : ''
  const liveLatestDate = liveOk ? (liveResult!.data[liveResult!.data.length - 1]?.date ?? '') : ''

  const winner = pickFreshestMacroSource({ persistedOk, persistedLatestDate, liveOk, liveLatestDate })

  if (winner === 'live' && liveResult && liveResult.ok) {
    // Live providers return their series at native cadence (daily for Treasury
    // yields, monthly for CPI, etc.). Apply the same category-aware frequency
    // policy the persisted and static paths use so the popup chart's density is
    // identical regardless of which layer served the data.
    const points: MacroChartPoint[] = applyMacroFrequency(
      liveResult.data.map((p) => ({ date: p.date, value: p.value })),
      indicatorId,
      years,
    )
    const decision = decideSource(dataMode, true, undefined)
    const seriesId = def?.providerSeriesCode ?? undefined
    return {
      data: points,
      metadata: {
        dataModeRequested: dataMode,
        dataModeUsed: decision.dataModeUsed,
        liveAvailable: true,
        status: decision.status,
        source: liveResult.source,
        lastUpdated: liveResult.lastUpdated,
        provider: providerLabel,
        seriesId: seriesId ?? undefined,
        persistedAvailable: persistedOk,
        dbModeRequested: dbMode,
        dbModeUsed: dbSource,
      },
    }
  }

  if (winner === 'persisted') {
    const latest = persistedResult!.data[persistedResult!.data.length - 1]
    return {
      data: persistedResult!.data,
      metadata: {
        dataModeRequested: dataMode,
        dataModeUsed: dataMode,
        liveAvailable: false,
        status: 'persisted',
        source: `Persisted via Supabase (${providerLabel})`,
        lastUpdated: latest?.date ?? '',
        provider: providerLabel,
        persistedAvailable: true,
        observationCount: persistedResult!.data.length,
        latestObservationDate: latest?.date,
        dbModeRequested: dbMode,
        dbModeUsed: 'supabase',
      },
    }
  }

  // ─── Neither persisted nor live produced usable data — static fallback ──
  const decision = decideSource(dataMode, false, liveResult && !liveResult.ok ? liveResult.reason : undefined)
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
