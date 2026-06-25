// Phase 5A — CMF filing provider types (type-declarations only, no runtime code).
//
// Shared between SERVER provider modules and client-safe data helpers.
// Because this file only exports types, every import is erased at compile time —
// importing from a client component never pulls server-only CMF code into the browser.

import type { DataMode, DataSourceStatus, ProviderResult } from '../types'
import type { HechoEsencial } from '../../../types'

export type { DataMode, DataSourceStatus, ProviderResult }

// ── Filing types ──────────────────────────────────────────────────────────────

export type CmfFilingType = 'HE' | 'II' | 'EE' | 'FE' | 'OTHER'

/** CmfFiling is the normalized shape for any CMF disclosure filing.
 *  When sourced from static data, many live-only fields are null. */
export interface CmfFiling {
  /** Internal stable id (matches HechoEsencial.id for static data). */
  id: string
  /** CMF document number (integer string). Null for static data. */
  documentNumber: string | null
  filingType: CmfFilingType
  /** Legal entity name as it appears on CMF (uppercase). */
  entityName: string
  /** Internal ticker if matched via cmfEntityMap. */
  ticker: string | null
  /** Entity RUT if available from live source. */
  rut: string | null
  /** Filing date — YYYY-MM-DD. */
  date: string
  /** Filing time — HH:MM local (Chile). Null for static data. */
  time: string | null
  /** ISO 8601 datetime — date + time if known, else midnight UTC. */
  datetime: string
  /** Raw CMF "materia" / subject string. */
  subject: string
  /** Normalized internal category matching HechoEsencial.category. */
  category: HechoEsencial['category']
  title: string
  summary: string | null
  materiality: 'Low' | 'Medium' | 'High'
  /** URL to the CMF filing page or PDF. */
  sourceUrl: string | null
  /** Direct PDF download URL if extractable. */
  documentUrl: string | null
  /** id of linked DocumentRecord in local documents.json. */
  localDocumentId: string | null
  /** Data source description. */
  source: string
  /** Provider name: 'static' | 'cmf-live' */
  provider: string
  status: DataSourceStatus
  fetchedAt: string | null
}

// ── Document types ────────────────────────────────────────────────────────────

export interface CmfDocument {
  id: string
  /** Link back to the parent CmfFiling id. */
  filingId: string | null
  /** CMF document number. */
  documentNumber: string | null
  title: string
  sourceUrl: string | null
  documentUrl: string | null
  fileType: 'pdf' | 'html' | 'xbrl' | 'unknown'
  /** Sync status in the local store. */
  localStatus: 'external_only' | 'placeholder' | 'synced_future'
  textStatus: 'none' | 'pending' | 'available'
  aiSummaryStatus: 'none' | 'pending' | 'available'
  fetchedAt: string | null
  source: string
}

// ── Response metadata ─────────────────────────────────────────────────────────

/** Metadata on every CMF API response. Never contains secrets or raw errors. */
export interface CmfDataMeta {
  dataModeRequested: DataMode
  dataModeUsed: DataMode
  provider: string
  liveAvailable: boolean
  status: DataSourceStatus
  source: string
  lastUpdated: string
  fallbackReason?: string
  count?: number
}

// ── Filter params ─────────────────────────────────────────────────────────────

export interface CmfFilingFilters {
  limit?: number
  ticker?: string | null
  entity?: string | null
  from?: string | null
  to?: string | null
  category?: string | null
  materiality?: string | null
}

// ── Response envelopes ────────────────────────────────────────────────────────

export interface CmfFilingsResponse {
  data: CmfFiling[]
  metadata: CmfDataMeta
}

export interface CmfFilingResponse {
  data: CmfFiling | null
  metadata: CmfDataMeta
}

export interface CmfDocumentResponse {
  data: CmfDocument | null
  metadata: CmfDataMeta
}

// ── Provider contract ─────────────────────────────────────────────────────────

/** Contract every CMF provider (static, live, …) must implement. */
export interface CmfProvider {
  name: string
  getHechos(filters?: CmfFilingFilters): Promise<ProviderResult<CmfFiling[]>>
  getHecho(documentNumber: string): Promise<ProviderResult<CmfFiling | null>>
  getDocument(id: string): Promise<ProviderResult<CmfDocument | null>>
}
