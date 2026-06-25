// Phase 5A — CMF live Hechos Esenciales provider shell. SERVER-ONLY.
//
// This is a SHELL implementation — every method returns ok:false with a clear
// reason until Phase 5A.1 completes:
//   1. discoverHechos.ts run and parser confidence confirmed ≥ 0.8
//   2. CMF entity → ticker mapping confirmed for key issuers
//   3. robots.txt policy at cmfchile.cl reviewed
//   4. Ingestion frequency and rate limits confirmed
//
// Do NOT add real fetch calls here until the above steps are done.

import type { CmfProvider, CmfFiling, CmfDocument, CmfFilingFilters } from './types.ts'
import type { ProviderResult } from '../types.ts'
import { isCmfLiveConfigured } from './cmfClient.ts'

const NOT_CONFIGURED = 'CMF live ingestion not configured — enable live mode to activate'
const NOT_IMPLEMENTED = 'CMF live Hechos parser pending Phase 5A.1 discovery validation'

function unavailable<T>(reason: string): ProviderResult<T> {
  return { ok: false, reason }
}

export const cmfHechosProvider: CmfProvider = {
  name: 'cmf-live',

  async getHechos(filters?: CmfFilingFilters): Promise<ProviderResult<CmfFiling[]>> {
    void filters
    if (!isCmfLiveConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 5A.1): fetch CMF Hechos listing page, parse with hechosListParser,
    // map entity names via cmfEntityMap, normalize to CmfFiling[].
    // Run discoverHechos.ts first to confirm page structure and parser confidence.
    return unavailable(NOT_IMPLEMENTED)
  },

  async getHecho(documentNumber: string): Promise<ProviderResult<CmfFiling | null>> {
    void documentNumber
    if (!isCmfLiveConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 5A.1): fetch individual filing by documentNumber.
    return unavailable(NOT_IMPLEMENTED)
  },

  async getDocument(id: string): Promise<ProviderResult<CmfDocument | null>> {
    void id
    if (!isCmfLiveConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 5A.1): fetch CMF document metadata and PDF link.
    return unavailable(NOT_IMPLEMENTED)
  },
}
