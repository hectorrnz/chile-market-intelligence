// Phase 5B — Ingestion runs repository.
// Static source: no static equivalent (ingestion runs only exist in Supabase).
// Supabase source: ingestion_runs table
// Returns empty array when DB_MODE=static or Supabase not configured.

import type { DbListResult, DbResult } from '../types'
import type { IngestionRunRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode'

export interface IngestionRunRecord {
  id: string
  provider: string
  jobType: string
  status: string
  startedAt: string
  finishedAt?: string
  rowsSeen?: number
  rowsInserted?: number
  rowsUpdated?: number
  rowsFailed?: number
  errorMessage?: string
}

export async function getIngestionRuns(
  options: { provider?: string; limit?: number } = {},
): Promise<DbListResult<IngestionRunRecord>> {
  const { provider, limit = 20 } = options
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: [], source: 'static' }

      let rows: IngestionRunRow[] | null = null
      let fetchError: string | undefined
      if (provider) {
        const res = await db.from('ingestion_runs').select('*').eq('provider', provider).order('started_at', { ascending: false }).limit(limit)
        rows = res.data as unknown as IngestionRunRow[] | null; fetchError = res.error?.message
      } else {
        const res = await db.from('ingestion_runs').select('*').order('started_at', { ascending: false }).limit(limit)
        rows = res.data as unknown as IngestionRunRow[] | null; fetchError = res.error?.message
      }
      if (!rows) return { data: [], source: 'static', error: fetchError }
      return { data: rows.map(mapRow), source: 'supabase' }
    } catch {
      return { data: [], source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: [], source: 'static' }
}

export async function createIngestionRun(
  run: Omit<IngestionRunRecord, 'id' | 'startedAt'>,
): Promise<DbResult<IngestionRunRecord | null>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseAdminClient } = await import('../../supabase/admin')
      const db = getSupabaseAdminClient()
      if (!db) return { data: null, source: 'static', error: 'Admin client not available' }

      const insertData: IngestionRunRow = {
        id: '',
        provider: run.provider,
        job_type: run.jobType,
        status: run.status,
        started_at: new Date().toISOString(),
        finished_at: run.finishedAt ?? null,
        rows_seen: run.rowsSeen ?? null,
        rows_inserted: run.rowsInserted ?? null,
        rows_updated: run.rowsUpdated ?? null,
        rows_failed: run.rowsFailed ?? null,
        error_message: run.errorMessage ?? null,
        metadata: {},
      }
      const res = await db
        .from('ingestion_runs')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(insertData as unknown as any)
        .select()
        .single()
      const row = res.data as unknown as IngestionRunRow | null
      if (res.error || !row) return { data: null, source: 'supabase', error: res.error?.message }
      return { data: mapRow(row), source: 'supabase' }
    } catch {
      return { data: null, source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: null, source: 'static', error: 'Supabase not configured' }
}

function mapRow(r: IngestionRunRow): IngestionRunRecord {
  return {
    id: r.id,
    provider: r.provider,
    jobType: r.job_type,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    rowsSeen: r.rows_seen ?? undefined,
    rowsInserted: r.rows_inserted ?? undefined,
    rowsUpdated: r.rows_updated ?? undefined,
    rowsFailed: r.rows_failed ?? undefined,
    errorMessage: r.error_message ?? undefined,
  }
}
