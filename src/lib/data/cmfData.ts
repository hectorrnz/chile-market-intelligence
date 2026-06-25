// Phase 5A — Client-safe async helpers for CMF filings data.
//
// These helpers are safe to import from client components. They hit the
// /api/cmf/* routes which apply the CMF_DATA_MODE policy server-side.
// For the initial render, pages use the synchronous helpers in hechos.ts /
// documents.ts directly (static-first). These async helpers optionally
// upgrade to live data after mount.

import type {
  CmfFilingsResponse, CmfFilingResponse, CmfDocumentResponse, CmfFilingFilters,
} from '@/lib/providers/cmf/types'

function buildQuery(filters?: CmfFilingFilters): string {
  const params = new URLSearchParams()
  if (filters?.limit)       params.set('limit',       String(filters.limit))
  if (filters?.ticker)      params.set('ticker',      filters.ticker)
  if (filters?.entity)      params.set('entity',      filters.entity)
  if (filters?.from)        params.set('from',        filters.from)
  if (filters?.to)          params.set('to',          filters.to)
  if (filters?.category)    params.set('category',    filters.category)
  if (filters?.materiality) params.set('materiality', filters.materiality)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Fetch the CMF Hechos list, optionally filtered. */
export async function fetchCmfHechos(
  filters?: CmfFilingFilters,
): Promise<CmfFilingsResponse> {
  const res = await fetch(`/api/cmf/hechos${buildQuery(filters)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetchCmfHechos: HTTP ${res.status}`)
  return res.json() as Promise<CmfFilingsResponse>
}

/** Fetch a single CMF filing by document number (or internal id for static). */
export async function fetchCmfHecho(
  documentNumber: string,
): Promise<CmfFilingResponse> {
  const res = await fetch(`/api/cmf/hechos/${encodeURIComponent(documentNumber)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetchCmfHecho: HTTP ${res.status}`)
  return res.json() as Promise<CmfFilingResponse>
}

/** Fetch a single CMF document record by id. */
export async function fetchCmfDocument(
  id: string,
): Promise<CmfDocumentResponse> {
  const res = await fetch(`/api/cmf/documents/${encodeURIComponent(id)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetchCmfDocument: HTTP ${res.status}`)
  return res.json() as Promise<CmfDocumentResponse>
}
