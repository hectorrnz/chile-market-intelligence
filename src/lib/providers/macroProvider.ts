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
  const requested = getDataMode()

  let liveOk = false
  let liveReason: string | undefined
  let liveData = null as Awaited<ReturnType<typeof bcchMacroProvider.getHistory>> | null
  if (requested !== 'static') {
    liveData = await bcchMacroProvider.getHistory(indicatorId, years)
    if (liveData.ok) liveOk = true
    else liveReason = liveData.reason
  }

  const decision = decideSource(requested, liveOk, liveReason)

  if (decision.liveAvailable && liveData && liveData.ok) {
    const points: MacroChartPoint[] = liveData.data.map(p => ({ date: p.date, value: p.value }))
    const seriesId = getSeriesByStaticId(indicatorId)?.providerSeriesCode ?? undefined
    return {
      data: points,
      metadata: {
        dataModeRequested: requested,
        dataModeUsed: decision.dataModeUsed,
        liveAvailable: true,
        status: decision.status,
        source: liveData.source,
        lastUpdated: liveData.lastUpdated,
        provider: BCCH_PROVIDER,
        seriesId: seriesId ?? undefined,
      },
    }
  }

  const stat = await staticMacroProvider.getHistory(indicatorId, years)
  const points: MacroChartPoint[] = stat.ok ? stat.data.map(p => ({ date: p.date, value: p.value })) : []
  // When no live code is mapped yet, surface that explicitly per spec.
  const fallbackReason = requested === 'static'
    ? undefined
    : (decision.fallbackReason ?? 'No live provider series code mapped yet')
  return {
    data: points,
    metadata: {
      dataModeRequested: requested,
      dataModeUsed: 'static',
      liveAvailable: false,
      status: decision.status,
      source: stat.ok ? stat.source : 'Static MVP',
      lastUpdated: stat.ok ? stat.lastUpdated : '',
      fallbackReason,
      provider: 'static',
    },
  }
}
