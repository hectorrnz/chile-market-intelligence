// Phase 5B — Macro repository.
// Static source: src/data/macroIndicators.json + macroHistory.json
// Supabase source: macro_indicators + macro_observations tables
// Falls back to static when DB_MODE=static or Supabase not configured.

import type { DbListResult } from '../types'
import type { Json, MacroIndicatorRow, MacroObservationRow } from '../../supabase/database.types'
import { decideDbSource } from '../dbMode.ts'

export interface MacroIndicatorRecord {
  id: string
  region: string
  name: string
  shortName?: string
  category?: string
  unit?: string
  value?: number
  changeLabel?: string
  importance?: string
  source?: string
  live?: boolean
}

export interface MacroObservationRecord {
  indicatorId: string
  date: string
  value: number
}

function loadStaticIndicators(): MacroIndicatorRecord[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../../../data/macroIndicators.json') as Array<Record<string, unknown>>
  return raw.map((r) => ({
    id: r.id as string,
    region: (r.region as string) ?? 'CL',
    name: r.name as string,
    shortName: r.shortName as string | undefined,
    category: r.category as string | undefined,
    unit: r.unit as string | undefined,
    value: r.value as number | undefined,
    changeLabel: r.changeLabel as string | undefined,
    importance: r.importance as string | undefined,
    source: r.source as string | undefined,
  }))
}

export async function getMacroIndicators(): Promise<DbListResult<MacroIndicatorRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticIndicators(), source: 'static' }
      const res = await db.from('macro_indicators').select('*').order('region')
      const rows = res.data as unknown as MacroIndicatorRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticIndicators(), source: 'static', error: res.error?.message }
      }
      const records: MacroIndicatorRecord[] = rows.map((r) => ({
        id: r.id,
        region: r.region,
        name: r.name,
        shortName: r.short_name ?? undefined,
        category: r.category ?? undefined,
        unit: r.unit ?? undefined,
        source: r.source_provider ?? undefined,
        live: r.live_enabled,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticIndicators(), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticIndicators(), source: 'static' }
}

export async function getMacroHistory(
  indicatorId: string,
  limit = 48,
): Promise<DbListResult<MacroObservationRecord>> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticHistory(indicatorId, limit), source: 'static' }
      const res = await db
        .from('macro_observations')
        .select('*')
        .eq('indicator_id', indicatorId)
        .order('observation_date', { ascending: false })
        .limit(limit)
      const rows = res.data as unknown as MacroObservationRow[] | null
      if (res.error || !rows) {
        return { data: loadStaticHistory(indicatorId, limit), source: 'static', error: res.error?.message }
      }
      const records: MacroObservationRecord[] = rows.map((r) => ({
        indicatorId: r.indicator_id ?? indicatorId,
        date: r.observation_date,
        value: Number(r.value),
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticHistory(indicatorId, limit), source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticHistory(indicatorId, limit), source: 'static' }
}

function loadStaticHistory(indicatorId: string, limit: number): MacroObservationRecord[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../../../data/macroHistory.json') as Array<{ id: string; date: string; value: number }>
  return raw
    .filter((r) => r.id === indicatorId)
    .slice(0, limit)
    .map((r) => ({ indicatorId: r.id, date: r.date, value: r.value }))
}

// ─── Observation write (admin) ────────────────────────────────────────────────

/** Row shape accepted by the macro_observations upsert. */
export interface MacroObservationInsert {
  indicator_id: string | null
  observation_date: string        // YYYY-MM-DD
  value: number | null
  source_provider: string | null
  source_series_code: string | null
  fetched_at: string              // ISO timestamp
  metadata: Json
}

/**
 * Upsert macro observations using the service-role admin client.
 * Requires SUPABASE_SERVICE_ROLE_KEY. Batches into chunks of `batchSize`.
 * Returns total rows written and any per-batch errors.
 */
export async function upsertMacroObservations(
  rows: MacroObservationInsert[],
  batchSize = 500,
): Promise<{ written: number; errors: string[] }> {
  if (rows.length === 0) return { written: 0, errors: [] }
  const { getSupabaseAdminClient } = await import('../../supabase/admin')
  const db = getSupabaseAdminClient()
  if (!db) return { written: 0, errors: ['Admin Supabase client not configured'] }

  let written = 0
  const errors: string[] = []
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any)
      .from('macro_observations')
      .upsert(batch, { onConflict: 'indicator_id,observation_date,source_series_code' })
    if (error) errors.push((error as Error).message)
    else written += batch.length
  }
  return { written, errors }
}

// ─── Observation reads (server) ───────────────────────────────────────────────

export interface MacroObservationDetailRecord extends MacroObservationRecord {
  sourceProvider?: string
  sourceSeriesCode?: string
  fetchedAt?: string
}

/**
 * Fetch observations for one indicator, ordered by date ascending.
 * Falls back to static history on error or static mode.
 */
export async function getMacroObservations(
  indicatorId: string,
  opts?: { from?: string; to?: string; limit?: number },
): Promise<DbListResult<MacroObservationDetailRecord>> {
  const source = decideDbSource()
  const limit = opts?.limit ?? 1200

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (!db) return { data: loadStaticHistory(indicatorId, limit) as MacroObservationDetailRecord[], source: 'static' }

      let q = db.from('macro_observations').select('*').eq('indicator_id', indicatorId)
      if (opts?.from) q = q.gte('observation_date', opts.from)
      if (opts?.to)   q = q.lte('observation_date', opts.to)
      q = q.order('observation_date', { ascending: true }).limit(limit)

      const res = await q
      if (res.error || !res.data) {
        return { data: loadStaticHistory(indicatorId, limit) as MacroObservationDetailRecord[], source: 'static', error: res.error?.message }
      }
      const records: MacroObservationDetailRecord[] = (res.data as Array<Record<string, unknown>>).map(r => ({
        indicatorId: String(r.indicator_id ?? indicatorId),
        date: String(r.observation_date),
        value: Number(r.value),
        sourceProvider: r.source_provider != null ? String(r.source_provider) : undefined,
        sourceSeriesCode: r.source_series_code != null ? String(r.source_series_code) : undefined,
        fetchedAt: r.fetched_at != null ? String(r.fetched_at) : undefined,
      }))
      return { data: records, source: 'supabase' }
    } catch {
      return { data: loadStaticHistory(indicatorId, limit) as MacroObservationDetailRecord[], source: 'static', error: 'Supabase query failed' }
    }
  }

  return { data: loadStaticHistory(indicatorId, limit) as MacroObservationDetailRecord[], source: 'static' }
}

/** Return the most recent observation for an indicator. Falls back to static. */
export async function getLatestMacroObservation(
  indicatorId: string,
): Promise<{ data: MacroObservationDetailRecord | null; source: 'supabase' | 'static' }> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (db) {
        const res = await db
          .from('macro_observations')
          .select('*')
          .eq('indicator_id', indicatorId)
          .order('observation_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!res.error && res.data) {
          const r = res.data as Record<string, unknown>
          return {
            source: 'supabase',
            data: {
              indicatorId: String(r.indicator_id ?? indicatorId),
              date: String(r.observation_date),
              value: Number(r.value),
              sourceProvider: r.source_provider != null ? String(r.source_provider) : undefined,
              sourceSeriesCode: r.source_series_code != null ? String(r.source_series_code) : undefined,
              fetchedAt: r.fetched_at != null ? String(r.fetched_at) : undefined,
            },
          }
        }
      }
    } catch { /* fall through */ }
  }

  const staticRows = loadStaticHistory(indicatorId, 1)
  return { data: staticRows[0] ? { ...staticRows[0] } : null, source: 'static' }
}

export interface MacroObservationSummaryRow {
  indicatorId: string
  count: number
  minDate: string | null
  maxDate: string | null
}

/** Count observations per indicator_id stored in Supabase.
 *  Uses 2 targeted per-indicator queries instead of a full-table scan so the
 *  PostgREST 1,000-row default cap does not truncate results. */
export async function getMacroObservationSummary(): Promise<{ data: MacroObservationSummaryRow[]; source: 'supabase' | 'static' }> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (db) {
        // Step 1: get all indicator IDs from the reference table (small, ~28 rows)
        const { data: indRows, error: indErr } = await db
          .from('macro_indicators')
          .select('id')
          .order('id')
        if (indErr || !indRows) return { data: [], source: 'supabase' }

        // Step 2: per indicator, run count+min and max in parallel
        const rows: MacroObservationSummaryRow[] = []
        await Promise.all(
          (indRows as Array<{ id: string }>).map(async ({ id }) => {
            const [countMinRes, maxRes] = await Promise.all([
              // count: 'exact' returns total in .count; limit(1) returns earliest date
              db.from('macro_observations')
                .select('observation_date', { count: 'exact' })
                .eq('indicator_id', id)
                .order('observation_date', { ascending: true })
                .limit(1),
              db.from('macro_observations')
                .select('observation_date')
                .eq('indicator_id', id)
                .order('observation_date', { ascending: false })
                .limit(1),
            ])
            const count = countMinRes.count ?? 0
            if (count === 0) return
            const minDate = (countMinRes.data as Array<{ observation_date: string }> | null)?.[0]?.observation_date ?? null
            const maxDate = (maxRes.data as Array<{ observation_date: string }> | null)?.[0]?.observation_date ?? null
            rows.push({ indicatorId: id, count, minDate, maxDate })
          })
        )
        rows.sort((a, b) => a.indicatorId.localeCompare(b.indicatorId))
        return { data: rows, source: 'supabase' }
      }
    } catch { /* fall through */ }
  }

  return { data: [], source: 'static' }
}

export interface IngestionRunRecord {
  id: number
  provider: string
  jobType: string
  status: string
  startedAt: string
  finishedAt: string | null
  rowsSeen: number
  rowsInserted: number
  errorMessage: string | null
}

/** Fetch recent ingestion runs from the ingestion_runs table. */
export async function getMacroIngestionStatus(limit = 10): Promise<{ data: IngestionRunRecord[]; source: 'supabase' | 'static' }> {
  const source = decideDbSource()

  if (source === 'supabase') {
    try {
      const { getSupabaseServerClient } = await import('../../supabase/server')
      const db = getSupabaseServerClient()
      if (db) {
        const res = await db
          .from('ingestion_runs')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(limit)
        if (!res.error && res.data) {
          const runs: IngestionRunRecord[] = (res.data as Array<Record<string, unknown>>).map(r => ({
            id: Number(r.id),
            provider: String(r.provider ?? ''),
            jobType: String(r.job_type ?? ''),
            status: String(r.status ?? ''),
            startedAt: String(r.started_at ?? ''),
            finishedAt: r.finished_at != null ? String(r.finished_at) : null,
            rowsSeen: Number(r.rows_seen ?? 0),
            rowsInserted: Number(r.rows_inserted ?? 0),
            errorMessage: r.error_message != null ? String(r.error_message) : null,
          }))
          return { data: runs, source: 'supabase' }
        }
      }
    } catch { /* fall through */ }
  }

  return { data: [], source: 'static' }
}

/** Latest ingestion run, optionally filtered by provider / jobType. */
export async function getLatestIngestionRun(
  provider?: string,
  jobType?: string,
): Promise<{ data: IngestionRunRecord | null; source: 'supabase' | 'static' }> {
  const source = decideDbSource()
  if (source !== 'supabase') return { data: null, source: 'static' }

  try {
    const { getSupabaseServerClient } = await import('../../supabase/server')
    const db = getSupabaseServerClient()
    if (db) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (db as any).from('ingestion_runs').select('*').order('started_at', { ascending: false }).limit(1)
      if (provider) q = q.eq('provider', provider)
      if (jobType)  q = q.eq('job_type', jobType)
      const res = await q.maybeSingle()
      if (!res.error && res.data) {
        const r = res.data as Record<string, unknown>
        return {
          source: 'supabase',
          data: {
            id: Number(r.id),
            provider: String(r.provider ?? ''),
            jobType: String(r.job_type ?? ''),
            status: String(r.status ?? ''),
            startedAt: String(r.started_at ?? ''),
            finishedAt: r.finished_at != null ? String(r.finished_at) : null,
            rowsSeen: Number(r.rows_seen ?? 0),
            rowsInserted: Number(r.rows_inserted ?? 0),
            errorMessage: r.error_message != null ? String(r.error_message) : null,
          },
        }
      }
    }
  } catch { /* fall through */ }

  return { data: null, source: 'static' }
}

// ─── Chart-ready observation helpers (5C.1) ───────────────────────────────────

/** Last observation per calendar month — preserves ascending sort. */
export function downsampleMonthly(
  points: { date: string; value: number }[],
): { date: string; value: number }[] {
  const map = new Map<string, { date: string; value: number }>()
  for (const p of points) map.set(p.date.slice(0, 7), p) // ascending → last wins
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Last observation per ISO week (Mon–Sun) — preserves ascending sort. */
export function downsampleWeekly(
  points: { date: string; value: number }[],
): { date: string; value: number }[] {
  const map = new Map<string, { date: string; value: number }>()
  for (const p of points) {
    const d = new Date(p.date + 'T00:00:00Z')
    const day = d.getUTCDay() // 0=Sun
    const mon = new Date(d)
    mon.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
    map.set(mon.toISOString().slice(0, 10), p)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Downsample to chart-appropriate density for the requested timeframe. */
export function downsampleForTimeframe(
  points: { date: string; value: number }[],
  years: 1 | 3 | 5 | 10,
): { date: string; value: number }[] {
  if (years === 1) return points          // daily — keep all (~365 max)
  if (years === 3) return downsampleWeekly(points)
  return downsampleMonthly(points)        // 5Y / 10Y
}

/**
 * True when the data spans at least 70% of the requested timeframe and
 * the latest point is within the last 6 months (not stale).
 * Exported for unit testing.
 */
export function isSufficientHistory(
  data: { date: string; value: number }[],
  years: number,
): boolean {
  if (data.length < 2) return false
  const last = new Date(data[data.length - 1].date + 'T00:00:00Z')
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6)
  if (last < sixMonthsAgo) return false
  const first = new Date(data[0].date + 'T00:00:00Z')
  const spanDays = (last.getTime() - first.getTime()) / 86_400_000
  return spanDays >= years * 365 * 0.7
}

/**
 * Fetch persisted BCCh observations for one indicator from Supabase,
 * downsampled to chart-appropriate density. Returns `source:'supabase'` on
 * success, `source:'static'` when Supabase is unconfigured or the query
 * fails — the caller decides whether to fall back.
 */
export async function getMacroObservationsForTimeframe(
  indicatorId: string,
  years: 1 | 3 | 5 | 10,
): Promise<DbListResult<{ date: string; value: number }>> {
  const src = decideDbSource()
  if (src !== 'supabase') return { data: [], source: 'static' }

  try {
    const { getSupabaseServerClient } = await import('../../supabase/server')
    const db = getSupabaseServerClient()
    if (!db) return { data: [], source: 'static' }

    // Fetch 1 extra year so yoy-transformed series have enough context
    const cutoff = new Date()
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
    const fetchFrom = new Date(cutoff)
    fetchFrom.setUTCFullYear(fetchFrom.getUTCFullYear() - 1)

    const res = await db
      .from('macro_observations')
      .select('observation_date, value')
      .eq('indicator_id', indicatorId)
      .gte('observation_date', fetchFrom.toISOString().slice(0, 10))
      .order('observation_date', { ascending: true })

    if (res.error || !res.data) {
      return { data: [], source: 'static', error: res.error?.message }
    }

    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const valid = (res.data as Array<{ observation_date: string; value: number | null }>)
      .filter(r => r.value != null && r.observation_date >= cutoffStr)
      .map(r => ({ date: r.observation_date, value: Number(r.value) }))

    return { data: downsampleForTimeframe(valid, years), source: 'supabase' }
  } catch {
    return { data: [], source: 'static', error: 'Supabase query failed' }
  }
}

/** Thin helper — true when persisted Supabase data is sufficient for the timeframe. */
export async function hasSufficientMacroHistory(
  indicatorId: string,
  years: 1 | 3 | 5 | 10,
): Promise<boolean> {
  const result = await getMacroObservationsForTimeframe(indicatorId, years)
  return result.source === 'supabase' && isSufficientHistory(result.data, years)
}
