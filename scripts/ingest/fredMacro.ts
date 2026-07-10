// Phase 8D — FRED (US macro) observations ingestion script.
//
// Fetches verified FRED series and persists normalized observations into
// Supabase macro_observations. All writes are opt-in via --write. No API key
// required — FRED's public CSV "graph" endpoint is unauthenticated.
//
// Usage:
//   npm run ingest:fred-macro:dry                       # dry-run all (default)
//   npm run ingest:fred-macro -- --all --write          # write all (10Y)
//   npm run ingest:fred-macro -- --indicator us10y --years 1 --write
//
// Prerequisites:
//   Ensure .env.local has Supabase admin credentials (no FRED credentials needed).

// @next/env is CJS — import via default.
import pkg from '@next/env'
import { createClient } from '@supabase/supabase-js'
import {
  parseArgs, firstDateFor, todayIso, sanitizeError,
  buildObservationRows, chunk,
  INGESTION_VERSION, SOURCE_PROVIDER,
  type ObservationUpsertRow, type IndicatorResult,
} from './fredMacroCore.ts'
import { fetchFredSeries, isFredConfigured } from '../../src/lib/providers/fredClient.ts'
import { getEnabledFredSeries } from '../../src/config/macroSeries.ts'
import { usFredSeriesManualMap } from '../../src/config/usFredSeriesManualMap.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const BATCH_SIZE = 500
const INTER_REQUEST_DELAY_MS = 200

// ─── Env / client setup ───────────────────────────────────────────────────────

function getAdminClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const url = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!url || !svcKey) return null
  return createClient(url, svcKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── Upsert helpers ───────────────────────────────────────────────────────────

async function upsertBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rows: ObservationUpsertRow[],
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from('macro_observations')
    .upsert(rows, { onConflict: 'indicator_id,observation_date,source_series_code' })
  if (error) return { ok: false, error: sanitizeError(error) }
  return { ok: true }
}

async function upsertAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rows: ObservationUpsertRow[],
): Promise<{ totalWritten: number; errors: string[] }> {
  const batches = chunk(rows, BATCH_SIZE)
  let totalWritten = 0
  const errors: string[] = []
  for (const batch of batches) {
    const res = await upsertBatch(db, batch)
    if (res.ok) totalWritten += batch.length
    else errors.push(res.error ?? 'unknown')
  }
  return { totalWritten, errors }
}

// ─── Ingestion run record ──────────────────────────────────────────────────────

interface RunMeta {
  indicatorsRequested: string[]
  indicatorsSucceeded: string[]
  indicatorsFailed: string[]
  dryRun: boolean
  years: number
  from: string
  to: string
  ingestionVersion: string
}

async function recordIngestionRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any | null,
  meta: RunMeta,
  status: 'success' | 'partial_success' | 'failed' | 'dry_run',
  startedAt: string,
  rows_seen: number,
  rows_inserted: number,
  errorMessage: string | null,
) {
  if (!db) return
  const row = {
    provider:        SOURCE_PROVIDER,
    job_type:        rows_seen > 365 ? 'macro_observations_backfill' : 'macro_observations_incremental',
    status,
    started_at:      startedAt,
    finished_at:     new Date().toISOString(),
    rows_seen,
    rows_inserted,
    rows_updated:    0,
    rows_failed:     0,
    error_message:   errorMessage,
    metadata:        meta,
  }
  const { error } = await db.from('ingestion_runs').insert(row)
  if (error) console.warn(`[fred-ingest] ingestion_runs insert: ${sanitizeError(error)}`)
  else console.log('[fred-ingest] Ingestion run recorded.')
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)
  const isDryRun = !args.write

  console.log(isDryRun
    ? '[fred-ingest] DRY RUN — no writes to Supabase (pass --write to persist)'
    : '[fred-ingest] WRITE MODE — observations will be upserted')
  console.log(`[fred-ingest] ingestionVersion=${INGESTION_VERSION}`)

  if (!isFredConfigured()) {
    console.error('[fred-ingest] FRED not available (unexpected — no credentials required).')
    process.exit(1)
  }

  const db = getAdminClient()
  if (!isDryRun && !db) {
    console.error('[fred-ingest] Supabase admin credentials not configured. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  const today = todayIso()
  const rangeTo   = args.to   ?? today
  const rangeFrom = args.from ?? firstDateFor(args.years)
  // 1 extra year of fetch context so yoy/mom transforms have a year-ago base;
  // bounded via cosd so a daily series' full multi-decade history is never downloaded.
  const fetchFrom = args.from ? firstDateFor(0, 1) < args.from
    ? new Date(new Date(args.from).setFullYear(new Date(args.from).getFullYear() - 1)).toISOString().slice(0, 10)
    : args.from
    : firstDateFor(args.years, 1)

  console.log(`[fred-ingest] Date range: ${rangeFrom} → ${rangeTo} (fetch context from ${fetchFrom})`)

  const allEnabled = getEnabledFredSeries()
  let targets = allEnabled
  if (args.indicator) {
    targets = allEnabled.filter(
      d => d.manualKey === args.indicator || d.fallbackStaticId === args.indicator || d.id === args.indicator
    )
    if (targets.length === 0) {
      console.error(`[fred-ingest] No enabled series found for --indicator "${args.indicator}"`)
      console.error(`[fred-ingest] Enabled series: ${allEnabled.map(d => d.manualKey).join(', ')}`)
      process.exit(1)
    }
  } else if (!args.all) {
    console.error('[fred-ingest] Pass --all to ingest all enabled series, or --indicator <key> for one series.')
    process.exit(1)
  }

  console.log(`[fred-ingest] Processing ${targets.length} indicator(s): ${targets.map(d => d.manualKey).join(', ')}`)

  const startedAt = new Date().toISOString()
  const results: IndicatorResult[] = []

  for (const def of targets) {
    const manualEntry = usFredSeriesManualMap[def.manualKey]
    const sourceName = manualEntry?.sourceName ?? null
    const seriesCode = def.providerSeriesCode!

    process.stdout.write(`[fred-ingest] ${def.manualKey} (${seriesCode}): fetching... `)

    const res = await fetchFredSeries(seriesCode, { startDate: fetchFrom })
    if (!res.ok) {
      console.log(`SKIP — ${res.reason}`)
      results.push({ manualKey: def.manualKey, fallbackStaticId: def.fallbackStaticId, seriesCode, rawCount: 0, storedCount: 0, skipped: true, reason: res.reason, rows: [] })
      await sleep(INTER_REQUEST_DELAY_MS)
      continue
    }

    const rawCount = res.data.length
    const rows = buildObservationRows(def, sourceName, res.data, { from: rangeFrom, to: rangeTo }, startedAt, args.limit)
    const storedCount = rows.length

    if (isDryRun) {
      const firstDate = rows[0]?.observation_date ?? '-'
      const lastDate  = rows[rows.length - 1]?.observation_date ?? '-'
      console.log(`${rawCount} raw → ${storedCount} rows (${firstDate} to ${lastDate})${def.transformation !== 'none' ? ` [${def.transformation}]` : ''}`)
    } else {
      const { totalWritten, errors } = await upsertAllRows(db!, rows)
      if (errors.length > 0) {
        console.log(`${rawCount} raw → ${storedCount} rows — ERROR: ${errors[0]}`)
        results.push({ manualKey: def.manualKey, fallbackStaticId: def.fallbackStaticId, seriesCode, rawCount, storedCount, skipped: true, reason: errors[0], rows })
        await sleep(INTER_REQUEST_DELAY_MS)
        continue
      }
      console.log(`${rawCount} raw → ${totalWritten} upserted`)
    }

    results.push({ manualKey: def.manualKey, fallbackStaticId: def.fallbackStaticId, seriesCode, rawCount, storedCount, skipped: false, rows: isDryRun ? rows : [] })
    await sleep(INTER_REQUEST_DELAY_MS)
  }

  const succeeded = results.filter(r => !r.skipped)
  const failed    = results.filter(r => r.skipped)
  const totalRaw  = results.reduce((s, r) => s + r.rawCount, 0)
  const totalRows = results.reduce((s, r) => s + r.storedCount, 0)

  console.log('')
  console.log(`[fred-ingest] ${isDryRun ? 'DRY RUN COMPLETE' : 'DONE'} — ${succeeded.length}/${targets.length} indicators, ${totalRows.toLocaleString()} rows${isDryRun ? ' would be written' : ' upserted'}`)
  if (failed.length > 0) console.warn(`[fred-ingest] Skipped: ${failed.map(r => `${r.manualKey} (${r.reason})`).join(', ')}`)

  const runMeta: RunMeta = {
    indicatorsRequested:  targets.map(d => d.manualKey),
    indicatorsSucceeded:  succeeded.map(r => r.manualKey),
    indicatorsFailed:     failed.map(r => r.manualKey),
    dryRun: isDryRun,
    years: args.years,
    from: rangeFrom,
    to: rangeTo,
    ingestionVersion: INGESTION_VERSION,
  }

  const status = isDryRun ? 'dry_run'
    : failed.length === 0 ? 'success'
    : succeeded.length === 0 ? 'failed'
    : 'partial_success'

  await recordIngestionRun(db, runMeta, status, startedAt, totalRaw, isDryRun ? 0 : totalRows, failed.length > 0 ? failed.map(r => r.reason).join('; ') : null)
}

main().catch(e => {
  console.error('[fred-ingest] Fatal:', sanitizeError(e))
  process.exit(1)
})
