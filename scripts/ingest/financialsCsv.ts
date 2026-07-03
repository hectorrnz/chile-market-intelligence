// Phase 8C — Manual CSV financial-statement ingestion script.
//
// Reads up to 4 CSV files (reporting periods, statement items, metrics,
// earnings events), validates every row, and upserts into Supabase. Dry-run
// by default; writes only with --write. Aborts before any write if any row
// fails validation, unless --allow-partial is passed (invalid rows are then
// skipped, not written).
//
// Usage:
//   npm run ingest:financials:dry -- --reporting-periods path.csv --statement-items path.csv --metrics path.csv --earnings path.csv
//   npm run ingest:financials -- --reporting-periods path.csv --statement-items path.csv --write
//
// Prerequisites:
//   1. Apply supabase/migrations/20260704000000_financials_foundation.sql
//   2. Ensure .env.local has Supabase admin credentials (SUPABASE_SERVICE_ROLE_KEY)

import pkg from '@next/env'
import { readFileSync } from 'node:fs'
import {
  parseCsvRows,
  buildFinancialImportPayload,
  deriveFinancialMetrics,
  type ParsedCsvRow,
} from '../../src/lib/financials/csvFinancials.ts'
import {
  upsertReportingPeriods,
  upsertStatementItems,
  upsertFinancialMetrics,
  upsertEarningsEvents,
} from '../../src/lib/db/repositories/financialsRepository.ts'
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const INGESTION_VERSION = '8C'
const PROVIDER = 'Manual CSV'
const JOB_TYPE = 'financials_csv_import'

function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***')
    .replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***')
    .slice(0, 300)
}

interface Args {
  write: boolean
  allowPartial: boolean
  reportingPeriods?: string
  statementItems?: string
  metrics?: string
  earnings?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { write: false, allowPartial: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') args.write = true
    else if (a === '--allow-partial') args.allowPartial = true
    else if (a === '--reporting-periods') args.reportingPeriods = argv[++i]
    else if (a === '--statement-items') args.statementItems = argv[++i]
    else if (a === '--metrics') args.metrics = argv[++i]
    else if (a === '--earnings') args.earnings = argv[++i]
  }
  return args
}

function readRows(path: string | undefined): ParsedCsvRow[] {
  if (!path) return []
  const text = readFileSync(path, 'utf8')
  return parseCsvRows(text).rows
}

async function main() {
  const args = parseArgs(process.argv)
  const isDryRun = !args.write

  if (!args.reportingPeriods && !args.statementItems && !args.metrics && !args.earnings) {
    console.error('[financials-ingest] Pass at least one of --reporting-periods, --statement-items, --metrics, --earnings <path>')
    console.error('[financials-ingest] Add --write to persist (default is dry-run). Add --allow-partial to skip invalid rows instead of aborting.')
    process.exit(1)
  }

  console.log(isDryRun
    ? '[financials-ingest] DRY RUN — no writes to Supabase (pass --write to persist)'
    : '[financials-ingest] WRITE MODE — rows will be upserted')
  console.log(`[financials-ingest] ingestionVersion=${INGESTION_VERSION}`)

  const payload = buildFinancialImportPayload({
    reportingPeriodRows: readRows(args.reportingPeriods),
    statementItemRows: readRows(args.statementItems),
    metricRows: readRows(args.metrics),
    earningsEventRows: readRows(args.earnings),
  })

  const rowsSeen =
    payload.reportingPeriods.length + payload.statementItems.length +
    payload.metrics.length + payload.earningsEvents.length + payload.errors.length

  if (payload.errors.length > 0) {
    console.warn(`[financials-ingest] ${payload.errors.length} row(s) failed validation:`)
    for (const e of payload.errors) console.warn(`  line ${e.line}: ${e.reason}`)
    if (!args.allowPartial) {
      console.error('[financials-ingest] Aborting — pass --allow-partial to import the valid rows and skip the rest.')
      process.exit(1)
    }
  }

  console.log(`[financials-ingest] Valid rows — reporting periods: ${payload.reportingPeriods.length}, statement items: ${payload.statementItems.length}, metrics: ${payload.metrics.length}, earnings events: ${payload.earningsEvents.length}`)

  if (isDryRun) {
    console.log('[financials-ingest] DRY RUN COMPLETE — no writes performed')
    return
  }

  const db = getSupabaseAdminClient()
  if (!db) {
    console.error('[financials-ingest] Supabase admin credentials not configured. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  const startedAt = new Date().toISOString()
  const errors: string[] = [...payload.errors.map((e) => `line ${e.line}: ${e.reason}`)]
  let rowsInserted = 0

  const periodResult = await upsertReportingPeriods(payload.reportingPeriods)
  errors.push(...periodResult.errors)
  rowsInserted += periodResult.inserted

  const itemResult = await upsertStatementItems(payload.statementItems, periodResult.idsByKey)
  errors.push(...itemResult.errors)
  rowsInserted += itemResult.inserted

  // Derive minimum-useful ratios (EBITDA margin, gross margin, FCF, net debt,
  // net debt/EBITDA) from the statement items just imported, grouped by period.
  const derivedGroups = new Map<string, { ticker: string; fiscalYear: number; fiscalPeriod: typeof payload.statementItems[number]['fiscalPeriod']; periodType: typeof payload.statementItems[number]['periodType']; itemsByCode: Map<string, number | null> }>()
  for (const item of payload.statementItems) {
    const key = `${item.ticker}|${item.fiscalYear}|${item.fiscalPeriod}|${item.periodType}`
    let group = derivedGroups.get(key)
    if (!group) {
      group = { ticker: item.ticker, fiscalYear: item.fiscalYear, fiscalPeriod: item.fiscalPeriod, periodType: item.periodType, itemsByCode: new Map() }
      derivedGroups.set(key, group)
    }
    group.itemsByCode.set(item.lineItemCode, item.value)
  }
  const derivedMetrics = Array.from(derivedGroups.values()).flatMap((g) => deriveFinancialMetrics(g))
  console.log(`[financials-ingest] Derived ${derivedMetrics.length} metric(s) from imported statement items`)

  const metricResult = await upsertFinancialMetrics([...payload.metrics, ...derivedMetrics], periodResult.idsByKey)
  errors.push(...metricResult.errors)
  rowsInserted += metricResult.inserted

  const earningsResult = await upsertEarningsEvents(payload.earningsEvents, periodResult.idsByKey)
  errors.push(...earningsResult.errors)
  rowsInserted += earningsResult.inserted

  const rowsFailed = errors.length
  const status = rowsFailed === 0 ? 'success' : rowsInserted > 0 ? 'partial_success' : 'failed'

  console.log(`[financials-ingest] ${status.toUpperCase()} — ${rowsInserted} row(s) upserted, ${rowsFailed} error(s)`)
  if (errors.length > 0) console.warn(`[financials-ingest] Errors: ${errors.slice(0, 10).join('; ')}`)

  const runRow = {
    provider: PROVIDER,
    job_type: JOB_TYPE,
    status,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    rows_seen: rowsSeen,
    rows_inserted: rowsInserted,
    rows_updated: 0,
    rows_failed: rowsFailed,
    error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
    metadata: { ingestionVersion: INGESTION_VERSION },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: runError } = await (db as any).from('ingestion_runs').insert(runRow)
  if (runError) console.warn(`[financials-ingest] ingestion_runs insert failed: ${sanitizeError(runError)}`)
  else console.log('[financials-ingest] Ingestion run recorded.')
}

main().catch((e) => {
  console.error('[financials-ingest] Fatal:', sanitizeError(e))
  process.exit(1)
})
