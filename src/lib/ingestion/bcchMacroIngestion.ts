// Phase 5D — Shared BCCh macro ingestion logic.
// SERVER-ONLY — never import from 'use client' files.
//
// Used by:
//   - src/app/api/cron/ingest-bcch-macro/route.ts (Vercel Cron)
//   - (future) manual-trigger API routes
//
// The CLI script (scripts/ingest/bcchMacro.ts) remains separate to avoid pulling
// Next.js env/module machinery into the CLI context.

import { transformSeries } from '../providers/transforms.ts'
import { fetchBcchSeries, isBcchConfigured } from '../providers/bcchClient.ts'
import { getEnabledSeries } from '../../config/macroSeries.ts'
import { bcchSeriesManualMap } from '../../config/bcchSeriesManualMap.ts'
import { upsertMacroObservations, type MacroObservationInsert } from '../db/repositories/macroRepository.ts'

export const SOURCE_PROVIDER = 'BCCh BDE'
export const INGESTION_VERSION = '5D.0'

const BATCH_SIZE = 500
const INTER_REQUEST_DELAY_MS = 150
// Extra history fetched before rangeFrom so yoy transforms have a year-ago base.
const EXTRA_YEARS_CONTEXT = 1

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IngestionOptions {
  /** 'all' fetches every verified BCCh series. Pass string[] of manualKey/fallbackStaticId to narrow. */
  indicators: 'all' | string[]
  mode: 'incremental' | 'backfill'
  /** Incremental: how many calendar days back to store. Default 14. */
  daysBack?: number
  /** Backfill: how many years back to store. Default 10. */
  yearsBack?: number
  dryRun?: boolean
  source: 'cron' | 'manual'
}

export interface IngestionResult {
  success: boolean
  status: 'success' | 'partial_success' | 'failed' | 'dry_run' | 'not_configured'
  provider: string
  jobType: string
  indicatorsRequested: string[]
  indicatorsSucceeded: string[]
  indicatorsFailed: string[]
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  rowsFailed: number
  startedAt: string
  finishedAt: string
  durationMs: number
  ingestionRunId?: string
  errorSummary?: string
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function yearsAgoIso(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/user=[^&\s]+/gi, 'user=***')
    .replace(/pass(word)?=[^&\s]+/gi, '$1=***')
    .replace(/key=[A-Za-z0-9_.\\-]{20,}/gi, 'key=***')
    .replace(/eyJ[A-Za-z0-9_.\\-]{40,}/g, '***JWT***')
    .slice(0, 500)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function recordIngestionRun(
  status: 'success' | 'partial_success' | 'failed' | 'dry_run',
  startedAt: string,
  jobType: string,
  meta: {
    indicatorsRequested: string[]
    indicatorsSucceeded: string[]
    indicatorsFailed: string[]
    rowsSeen: number
    rowsInserted: number
    source: string
    ingestionVersion: string
  },
  errorMessage: string | null,
): Promise<string | undefined> {
  try {
    const { getSupabaseAdminClient } = await import('../supabase/admin.ts')
    const db = getSupabaseAdminClient()
    if (!db) return undefined
    const row = {
      provider:      SOURCE_PROVIDER,
      job_type:      jobType,
      status,
      started_at:    startedAt,
      finished_at:   new Date().toISOString(),
      rows_seen:     meta.rowsSeen,
      rows_inserted: meta.rowsInserted,
      rows_updated:  0,
      rows_failed:   0,
      error_message: errorMessage,
      metadata:      meta,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (db as any).from('ingestion_runs').insert(row).select('id').single()
    return res.data?.id ? String(res.data.id) : undefined
  } catch {
    return undefined
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runBcchMacroIngestion(opts: IngestionOptions): Promise<IngestionResult> {
  const startedAt = new Date().toISOString()
  const dryRun = opts.dryRun ?? false

  if (!isBcchConfigured()) {
    return {
      success: false,
      status: 'not_configured',
      provider: SOURCE_PROVIDER,
      jobType: opts.mode === 'incremental'
        ? 'macro_observations_incremental'
        : 'macro_observations_backfill',
      indicatorsRequested: [],
      indicatorsSucceeded: [],
      indicatorsFailed:    [],
      rowsSeen: 0, rowsInserted: 0, rowsUpdated: 0, rowsFailed: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      errorSummary: 'BCCh credentials not configured',
    }
  }

  // ── Date range ───────────────────────────────────────────────────────────────
  const today = todayIso()
  const rangeTo = today
  let rangeFrom: string
  let fetchFrom: string

  if (opts.mode === 'incremental') {
    const days = opts.daysBack ?? 14
    rangeFrom = daysAgoIso(days)
    // Fetch 1 extra year so yoy-transform indicators have a year-ago base.
    fetchFrom = yearsAgoIso(EXTRA_YEARS_CONTEXT)
  } else {
    const years = opts.yearsBack ?? 10
    rangeFrom = yearsAgoIso(years)
    fetchFrom = yearsAgoIso(years + EXTRA_YEARS_CONTEXT)
  }

  // ── Indicator selection ──────────────────────────────────────────────────────
  const allEnabled = getEnabledSeries()
  let targets = allEnabled

  if (opts.indicators !== 'all') {
    const filter = new Set(opts.indicators)
    targets = allEnabled.filter(
      d => filter.has(d.manualKey) || filter.has(d.fallbackStaticId) || filter.has(d.id)
    )
    if (targets.length === 0) {
      const finishedAt = new Date().toISOString()
      return {
        success: false,
        status: 'failed',
        provider: SOURCE_PROVIDER,
        jobType: 'macro_observations_incremental',
        indicatorsRequested: Array.isArray(opts.indicators) ? opts.indicators : [],
        indicatorsSucceeded: [],
        indicatorsFailed:    Array.isArray(opts.indicators) ? opts.indicators : [],
        rowsSeen: 0, rowsInserted: 0, rowsUpdated: 0, rowsFailed: 0,
        startedAt, finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        errorSummary: 'No enabled series found for requested indicators',
      }
    }
  }

  const jobType = opts.mode === 'incremental'
    ? 'macro_observations_incremental'
    : 'macro_observations_backfill'

  const indicatorsRequested = targets.map(d => d.manualKey)
  const indicatorsSucceeded: string[] = []
  const indicatorsFailed:    string[] = []
  let rowsSeen = 0
  let rowsInserted = 0
  let rowsFailed = 0
  const errorMessages: string[] = []

  // ── Fetch + upsert loop ──────────────────────────────────────────────────────
  for (const def of targets) {
    const manualEntry = bcchSeriesManualMap[def.manualKey]
    const sourceName  = manualEntry?.sourceName ?? null
    const seriesCode  = def.providerSeriesCode!

    const res = await fetchBcchSeries(seriesCode, { firstDate: fetchFrom, lastDate: rangeTo })
    if (!res.ok) {
      indicatorsFailed.push(def.manualKey)
      errorMessages.push(`${def.manualKey}: ${res.reason}`)
      await sleep(INTER_REQUEST_DELAY_MS)
      continue
    }

    rowsSeen += res.data.length

    const transformed = transformSeries(res.data, def.transformation)
    const isDerived   = def.transformation !== 'none'
    const fetchedAt   = new Date().toISOString()

    const insertRows: MacroObservationInsert[] = transformed
      .filter(p => p.value != null && p.date >= rangeFrom && p.date <= rangeTo)
      .map(p => ({
        indicator_id:       def.fallbackStaticId,
        observation_date:   p.date,
        value:              p.value,
        source_provider:    SOURCE_PROVIDER,
        source_series_code: seriesCode,
        fetched_at:         fetchedAt,
        metadata: {
          transformation:   def.transformation,
          provider:         'bcch',
          sourceName,
          ingestionVersion: INGESTION_VERSION,
          isDerived,
          rowSource:        'live_bcch',
        },
      }))

    if (dryRun) {
      indicatorsSucceeded.push(def.manualKey)
      rowsInserted += insertRows.length
    } else if (insertRows.length === 0) {
      // No new observations in this window — still a success
      indicatorsSucceeded.push(def.manualKey)
    } else {
      const { written, errors } = await upsertMacroObservations(insertRows, BATCH_SIZE)
      if (errors.length > 0) {
        if (written > 0) {
          // Partial: some batches succeeded
          indicatorsSucceeded.push(def.manualKey)
          rowsInserted += written
          rowsFailed   += insertRows.length - written
          errorMessages.push(`${def.manualKey} (partial): ${sanitizeError(errors[0])}`)
        } else {
          indicatorsFailed.push(def.manualKey)
          rowsFailed += insertRows.length
          errorMessages.push(`${def.manualKey}: ${sanitizeError(errors[0])}`)
        }
      } else {
        indicatorsSucceeded.push(def.manualKey)
        rowsInserted += written
      }
    }

    await sleep(INTER_REQUEST_DELAY_MS)
  }

  const status: IngestionResult['status'] = dryRun ? 'dry_run'
    : indicatorsFailed.length === 0 ? 'success'
    : indicatorsSucceeded.length === 0 ? 'failed'
    : 'partial_success'

  const finishedAt  = new Date().toISOString()
  const durationMs  = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  const errorSummary = errorMessages.length > 0
    ? errorMessages.join('; ').slice(0, 500)
    : undefined

  let ingestionRunId: string | undefined
  if (!dryRun) {
    ingestionRunId = await recordIngestionRun(
      status,
      startedAt,
      jobType,
      {
        indicatorsRequested,
        indicatorsSucceeded,
        indicatorsFailed,
        rowsSeen,
        rowsInserted,
        source: opts.source,
        ingestionVersion: INGESTION_VERSION,
      },
      errorSummary ?? null,
    )
  }

  return {
    success: indicatorsFailed.length === 0 || indicatorsSucceeded.length > 0,
    status,
    provider: SOURCE_PROVIDER,
    jobType,
    indicatorsRequested,
    indicatorsSucceeded,
    indicatorsFailed,
    rowsSeen,
    rowsInserted,
    rowsUpdated: 0,
    rowsFailed,
    startedAt,
    finishedAt,
    durationMs,
    ingestionRunId,
    errorSummary,
  }
}
