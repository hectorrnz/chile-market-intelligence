// Phase 5A — CMF provider orchestrator. SERVER-ONLY.
//
// Applies static / live / hybrid policy for CMF filings. Never throws and
// never leaks credentials or raw errors to the client. Mirrors the BCCh macro
// macroProvider.ts and Phase 4C marketProvider.ts patterns exactly.

import type {
  CmfFilingsResponse, CmfFilingResponse, CmfDocumentResponse,
  CmfDataMeta, CmfFilingFilters,
} from './types'
import { getCmfDataMode, decideCmfSource } from './cmfDataMode'
import { staticCmfProvider } from './staticCmfProvider'
import { cmfHechosProvider } from './cmfHechosProvider'

const STATIC_FALLBACK_META = (
  requested: string,
  reason?: string,
): CmfDataMeta => ({
  dataModeRequested: requested as CmfDataMeta['dataModeRequested'],
  dataModeUsed: 'static',
  provider: 'static',
  liveAvailable: false,
  status: 'static',
  source: 'CMF — Static MVP sample',
  lastUpdated: '',
  fallbackReason: reason,
})

export async function resolveCmfHechos(
  filters?: CmfFilingFilters,
): Promise<CmfFilingsResponse> {
  const requested = getCmfDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof cmfHechosProvider.getHechos>> | null
  if (requested !== 'static') {
    liveResult = await cmfHechosProvider.getHechos(filters)
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideCmfSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return {
      data: liveResult.data,
      metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, provider: 'cmf-live', liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated, count: liveResult.data.length },
    }
  }
  const stat = await staticCmfProvider.getHechos(filters)
  return {
    data: stat.ok ? stat.data : [],
    metadata: { dataModeRequested: requested, dataModeUsed: 'static', provider: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'CMF — Static MVP sample', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason, count: stat.ok ? stat.data.length : 0 },
  }
}

export async function resolveCmfHecho(
  documentNumber: string,
): Promise<CmfFilingResponse> {
  const requested = getCmfDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof cmfHechosProvider.getHecho>> | null
  if (requested !== 'static') {
    liveResult = await cmfHechosProvider.getHecho(documentNumber)
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideCmfSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return {
      data: liveResult.data,
      metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, provider: 'cmf-live', liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated },
    }
  }
  const stat = await staticCmfProvider.getHecho(documentNumber)
  return {
    data: stat.ok ? stat.data : null,
    metadata: { dataModeRequested: requested, dataModeUsed: 'static', provider: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'CMF — Static MVP sample', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason },
  }
}

export async function resolveCmfDocument(
  id: string,
): Promise<CmfDocumentResponse> {
  const requested = getCmfDataMode()
  let liveOk = false; let liveReason: string | undefined
  let liveResult = null as Awaited<ReturnType<typeof cmfHechosProvider.getDocument>> | null
  if (requested !== 'static') {
    liveResult = await cmfHechosProvider.getDocument(id)
    if (liveResult.ok) liveOk = true; else liveReason = liveResult.reason
  }
  const decision = decideCmfSource(requested, liveOk, liveReason)
  if (decision.liveAvailable && liveResult?.ok) {
    return {
      data: liveResult.data,
      metadata: { dataModeRequested: requested, dataModeUsed: decision.dataModeUsed, provider: 'cmf-live', liveAvailable: true, status: decision.status, source: liveResult.source, lastUpdated: liveResult.lastUpdated },
    }
  }
  const stat = await staticCmfProvider.getDocument(id)
  return {
    data: stat.ok ? stat.data : null,
    metadata: { dataModeRequested: requested, dataModeUsed: 'static', provider: 'static', liveAvailable: false, status: decision.status, source: stat.ok ? stat.source : 'CMF — Static MVP sample', lastUpdated: stat.ok ? stat.lastUpdated : '', fallbackReason: decision.fallbackReason },
  }
}

/** Shared error envelope for CMF route handler catch blocks. */
export function cmfErrorResponse(entity: string): { data: never[]; metadata: CmfDataMeta } {
  return { data: [], metadata: STATIC_FALLBACK_META('static', `Unexpected server error fetching ${entity}`) }
}
