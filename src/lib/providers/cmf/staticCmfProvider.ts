// Phase 5A — Static CMF provider.
//
// Wraps the existing static JSON data layer behind the CmfProvider contract.
// Makes existing Hechos Esenciales and document pages continue to work even
// when no live CMF provider is configured.
// SERVER-side only (imported by cmfProvider.ts orchestrator).

import type { CmfProvider, CmfFiling, CmfDocument, CmfFilingFilters } from './types.ts'
import type { ProviderResult } from '../types.ts'
import { getAllHechos, getHechosByTicker } from '../../data/hechos'
import { getDocumentById } from '../../data/documents'
import { DATA_AS_OF } from '../../constants'
import type { HechoEsencial, DocumentRecord } from '../../../types'

const STATIC_SOURCE = 'CMF — Static MVP sample'
const STATIC_PROVIDER = 'static'

function toFiling(h: HechoEsencial): CmfFiling {
  return {
    id: h.id,
    documentNumber: null,
    filingType: h.filingType,
    entityName: h.companyName,
    ticker: h.ticker,
    rut: null,
    date: h.date,
    time: null,
    datetime: `${h.date}T00:00:00.000Z`,
    subject: h.title,
    category: h.category,
    title: h.title,
    summary: h.summary,
    materiality: h.materiality,
    sourceUrl: h.url ?? null,
    documentUrl: null,
    localDocumentId: null,
    source: STATIC_SOURCE,
    provider: STATIC_PROVIDER,
    status: 'static',
    fetchedAt: null,
  }
}

function toDocument(d: DocumentRecord): CmfDocument {
  const ft = d.fileType
  const fileType: CmfDocument['fileType'] =
    ft === 'pdf' ? 'pdf' : ft === 'html' ? 'html' : ft === 'xbrl' ? 'xbrl' : 'unknown'
  return {
    id: d.id,
    filingId: d.relatedRecordId ?? null,
    documentNumber: null,
    title: d.title,
    sourceUrl: d.sourceUrl ?? null,
    documentUrl: null,
    fileType,
    localStatus: d.localStatus,
    textStatus: 'none',
    aiSummaryStatus: 'none',
    fetchedAt: null,
    source: STATIC_SOURCE,
  }
}

function applyFilters(hechos: HechoEsencial[], filters?: CmfFilingFilters): HechoEsencial[] {
  let result = hechos
  if (filters?.entity) {
    const q = filters.entity.toLowerCase()
    result = result.filter(h => h.companyName.toLowerCase().includes(q))
  }
  if (filters?.from) result = result.filter(h => h.date >= filters.from!)
  if (filters?.to) result = result.filter(h => h.date <= filters.to!)
  if (filters?.category) result = result.filter(h => h.category === filters.category)
  if (filters?.materiality) result = result.filter(h => h.materiality === filters.materiality)
  return result
}

export const staticCmfProvider: CmfProvider = {
  name: 'static',

  async getHechos(filters?: CmfFilingFilters): Promise<ProviderResult<CmfFiling[]>> {
    const base = filters?.ticker ? getHechosByTicker(filters.ticker) : getAllHechos()
    const filtered = applyFilters(base, filters)
    const limit = filters?.limit ?? 200
    return {
      ok: true,
      data: filtered.slice(0, limit).map(toFiling),
      source: STATIC_SOURCE,
      lastUpdated: DATA_AS_OF,
    }
  },

  async getHecho(documentNumber: string): Promise<ProviderResult<CmfFiling | null>> {
    // Static data has no CMF document number — match by internal id
    const h = getAllHechos().find(x => x.id === documentNumber)
    return {
      ok: true,
      data: h ? toFiling(h) : null,
      source: STATIC_SOURCE,
      lastUpdated: DATA_AS_OF,
    }
  },

  async getDocument(id: string): Promise<ProviderResult<CmfDocument | null>> {
    const d = getDocumentById(id)
    return {
      ok: true,
      data: d ? toDocument(d) : null,
      source: STATIC_SOURCE,
      lastUpdated: DATA_AS_OF,
    }
  },
}
