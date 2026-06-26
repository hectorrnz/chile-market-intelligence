// Phase 5B â€” CMF filings repository.
// Static source: src/data/hechos.json (via existing static CMF provider)
// Supabase source: cmf_filings table
// Falls back to static when DB_MODE=static or Supabase not configured.

import type { DbListResult, DbResult } from '../types'
import type { CmfFilingRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode'

export interface CmfFilingRecord {
  id?: string
  documentNumber?: string
  filingType?: string
  entityName?: string
  ticker?: string
  rut?: string
  filingDate?: string
  subject?: string
  category?: string
  title?: string
  materiality?: string
  sourceUrl?: string
  documentUrl?: string
  status?: string
}

export async function getCmfFilings(
  options: { ticker?: string; limit?: number } = {},
): Promise<DbListResult<CmfFilingRecord>> {
  const { ticker, limit = 50 } = options
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStatic(ticker, limit), source: 'static' }

      let rows: CmfFilingRow[] | null = null
      let fetchError: string | undefined
      if (ticker) {
        const res = await db.from('cmf_filings').select('*').eq('ticker', ticker).order('filing_date', { ascending: false }).limit(limit)
        rows = res.data; fetchError = res.error?.message
      } else {
        const res = await db.from('cmf_filings').select('*').order('filing_date', { ascending: false }).limit(limit)
        rows = res.data; fetchError = res.error?.message
      }
      if (!rows) {
        return { data: loadStatic(ticker, limit), source: 'static', error: fetchError }
      }
      const records: CmfFilingRecord[] = rows.map((r) => ({
        id: r.id,
        documentNumber: r.document_number ?? undefined,
        filingType: r.filing_type ?? undefined,
        entityName: r.entity_name ?? undefined,
        ticker: r.ticker ?? undefined,
        rut: r.rut ?? undefined,
        filingDate: r.filing_date ?? undefined,
        subject: r.subject ?? undefined,
        category: r.category ?? undefined,
        title: r.title ?? undefined,
        materiality: r.materiality ?? undefined,
        sourceUrl: r.source_url ?? undefined,
        documentUrl: r.document_url ?? undefined,
        status: r.status ?? undefined,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStatic(ticker, limit), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStatic(ticker, limit), source: 'static' }
}

export async function getCmfFiling(documentNumber: string): Promise<DbResult<CmfFilingRecord | null>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: findStatic(documentNumber), source: 'static' }
      const res = await db
        .from('cmf_filings')
        .select('*')
        .eq('document_number', documentNumber)
        .single()
      const row = res.data as unknown as CmfFilingRow | null
      if (res.error || !row) {
        return { data: findStatic(documentNumber), source: 'static', error: res.error?.message }
      }
      return {
        data: {
          id: row.id,
          documentNumber: row.document_number ?? undefined,
          entityName: row.entity_name ?? undefined,
          ticker: row.ticker ?? undefined,
          filingDate: row.filing_date ?? undefined,
          title: row.title ?? undefined,
          sourceUrl: row.source_url ?? undefined,
        },
        source: 'supabase',
      }
    } catch {
      return { data: findStatic(documentNumber), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: findStatic(documentNumber), source: 'static' }
}

function loadStatic(ticker: string | undefined, limit: number): CmfFilingRecord[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../../data/hechos.json') as Array<Record<string, unknown>>
    const filtered = ticker ? raw.filter((h) => h.ticker === ticker) : raw
    return filtered.slice(0, limit).map((h) => ({
      documentNumber: h.id as string | undefined,
      entityName: h.company as string | undefined,
      ticker: h.ticker as string | undefined,
      filingDate: h.date as string | undefined,
      title: h.title as string | undefined,
      materiality: h.materiality as string | undefined,
      sourceUrl: h.sourceUrl as string | undefined,
      status: 'static',
    }))
  } catch {
    return []
  }
}

function findStatic(documentNumber: string): CmfFilingRecord | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../../data/hechos.json') as Array<Record<string, unknown>>
    const h = raw.find((r) => r.id === documentNumber)
    if (!h) return null
    return {
      documentNumber: h.id as string | undefined,
      entityName: h.company as string | undefined,
      ticker: h.ticker as string | undefined,
      filingDate: h.date as string | undefined,
      title: h.title as string | undefined,
      materiality: h.materiality as string | undefined,
    }
  } catch {
    return null
  }
}
