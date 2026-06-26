// Phase 5B â€” Documents repository.
// Static source: src/data/documents.json
// Supabase source: documents table
// Falls back to static when DB_MODE=static or Supabase not configured.

import type { DbListResult, DbResult } from '../types'
import type { DocumentRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode'

export interface DocumentRecord {
  id: string
  externalId?: string
  relatedType?: string
  relatedId?: string
  ticker?: string
  companyName?: string
  title: string
  documentType?: string
  source?: string
  sourceUrl?: string
  localStatus?: string
  aiSummary?: string
  keyPoints?: string[]
  publishedAt?: string
}

export async function getDocuments(
  options: { ticker?: string; relatedType?: string } = {},
): Promise<DbListResult<DocumentRecord>> {
  const { ticker, relatedType } = options
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStatic(ticker, relatedType), source: 'static' }

      // Build query without conditional chaining to keep TypeScript's type inference happy.
      let rows: DocumentRow[] | null = null
      let fetchError: string | undefined
      if (ticker && relatedType) {
        const r = await db.from('documents').select('*').eq('ticker', ticker).eq('related_type', relatedType).order('published_at', { ascending: false })
        rows = r.data; fetchError = r.error?.message
      } else if (ticker) {
        const r = await db.from('documents').select('*').eq('ticker', ticker).order('published_at', { ascending: false })
        rows = r.data; fetchError = r.error?.message
      } else if (relatedType) {
        const r = await db.from('documents').select('*').eq('related_type', relatedType).order('published_at', { ascending: false })
        rows = r.data; fetchError = r.error?.message
      } else {
        const r = await db.from('documents').select('*').order('published_at', { ascending: false })
        rows = r.data; fetchError = r.error?.message
      }
      if (!rows) {
        return { data: loadStatic(ticker, relatedType), source: 'static', error: fetchError }
      }
      return { data: rows.map(mapRow), source: 'supabase' }
    } catch {
      return { data: loadStatic(ticker, relatedType), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStatic(ticker, relatedType), source: 'static' }
}

export async function getDocumentById(id: string): Promise<DbResult<DocumentRecord | null>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: findStatic(id), source: 'static' }
      const res = await db.from('documents').select('*').eq('id', id).single()
      const row = res.data as unknown as DocumentRow | null
      if (res.error || !row) {
        return { data: findStatic(id), source: 'static', error: res.error?.message }
      }
      return { data: mapRow(row), source: 'supabase' }
    } catch {
      return { data: findStatic(id), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: findStatic(id), source: 'static' }
}

function mapRow(r: DocumentRow): DocumentRecord {
  return {
    id: r.id,
    externalId: r.external_id ?? undefined,
    relatedType: r.related_type ?? undefined,
    relatedId: r.related_id ?? undefined,
    ticker: r.ticker ?? undefined,
    companyName: r.company_name ?? undefined,
    title: r.title,
    documentType: r.document_type ?? undefined,
    source: r.source ?? undefined,
    sourceUrl: r.source_url ?? undefined,
    localStatus: r.local_status ?? undefined,
    aiSummary: r.ai_summary ?? undefined,
    keyPoints: Array.isArray(r.key_points) ? r.key_points as string[] : [],
    publishedAt: r.published_at ?? undefined,
  }
}

function loadStatic(
  ticker: string | undefined,
  relatedType: string | undefined,
): DocumentRecord[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../../data/documents.json') as Array<Record<string, unknown>>
    let result = raw
    if (ticker) result = result.filter((d) => d.ticker === ticker)
    if (relatedType) result = result.filter((d) => d.relatedType === relatedType)
    return result.map((d) => ({
      id: d.id as string,
      externalId: d.externalId as string | undefined,
      relatedType: d.relatedType as string | undefined,
      relatedId: d.relatedId as string | undefined,
      ticker: d.ticker as string | undefined,
      companyName: d.companyName as string | undefined,
      title: d.title as string,
      documentType: d.documentType as string | undefined,
      source: d.source as string | undefined,
      sourceUrl: d.sourceUrl as string | undefined,
      localStatus: d.localStatus as string | undefined,
      keyPoints: (d.keyPoints as string[] | undefined) ?? [],
    }))
  } catch {
    return []
  }
}

function findStatic(id: string): DocumentRecord | null {
  return loadStatic(undefined, undefined).find((d) => d.id === id) ?? null
}
