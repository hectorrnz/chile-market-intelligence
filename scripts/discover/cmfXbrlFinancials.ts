// Phase 8C.1 — CMF/XBRL discovery and (very limited) ingestion CLI.
//
// This script is HONEST about the current state of the CMF/XBRL provider
// (see docs/cmf_xbrl_provider_discovery.md and
// src/lib/financials/providers/cmfXbrlProvider.ts): the two-step public
// fetch chain is real and verified, but this provider does not yet unzip
// the downloaded archive (no zip dependency was added in this phase), so
// `--write` for this specific source cannot complete an end-to-end import
// today. Discovery mode still reports real, live-verified coverage/feasibility
// per ticker — it does not pretend ingestion works when it doesn't.
//
// Usage:
//   npm run discover:cmf-financials                  # feasibility report for all mapped tickers (default mode)
//   npm run discover:cmf-financials -- --ticker SQM-B # feasibility report for one ticker
//   npm run ingest:cmf-financials:dry -- --ticker COPEC
//   npm run ingest:cmf-financials -- --ticker COPEC --write
//
// Sanitized logs only — no secrets, no raw HTML/XBRL dumped to stdout.

import pkg from '@next/env'
import { CMF_ISSUER_MAP, UNMAPPED_TICKERS, getCmfIssuer } from '../../src/lib/financials/cmfIssuerMap.ts'
import { cmfXbrlProvider, candidateRecentPeriods } from '../../src/lib/financials/providers/cmfXbrlProvider.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const INGESTION_VERSION = '8C.1'
const PROVIDER = 'CMF XBRL'
const JOB_TYPE = 'cmf_xbrl_discovery'
const SOURCE_TYPE = 'xbrl'

function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***')
    .replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***')
    .slice(0, 300)
}

function parseArgs(argv: string[]): { mode: 'discover' | 'ingest-dry' | 'ingest-write'; ticker?: string; write: boolean } {
  const args: { ticker?: string; write: boolean } = { write: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ticker') args.ticker = argv[++i]
    else if (a === '--write') args.write = true
  }
  const scriptName = process.env.npm_lifecycle_event ?? ''
  const mode = scriptName.startsWith('ingest:cmf-financials') ? (args.write ? 'ingest-write' : 'ingest-dry') : 'discover'
  return { mode, ticker: args.ticker, write: args.write }
}

async function reportFeasibility(ticker: string): Promise<void> {
  const issuer = getCmfIssuer(ticker)
  if (!issuer) {
    const unmappedReason = UNMAPPED_TICKERS[ticker]
    console.log(`[cmf-xbrl-discover] ${ticker}: BLOCKED (issuer_not_mapped)${unmappedReason ? ` — ${unmappedReason}` : ' — no verified CMF RUT on file'}`)
    return
  }
  const candidates = candidateRecentPeriods(2)
  console.log(`[cmf-xbrl-discover] ${ticker}: mapped to ${issuer.cmfIssuerName} (RUT ${issuer.rut}) — feasible_with_mapping`)
  console.log(`[cmf-xbrl-discover]   candidate periods: ${candidates.map((c) => `${c.mm}/${c.aa}`).join(', ')}`)
  console.log(`[cmf-xbrl-discover]   verified download proof: ${issuer.notes}`)
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.mode === 'discover') {
    console.log('[cmf-xbrl-discover] CMF XBRL financials — discovery mode (no network calls, no writes)')
    console.log(`[cmf-xbrl-discover] verified mapped tickers: ${Object.keys(CMF_ISSUER_MAP).join(', ') || '(none)'}`)
    console.log(`[cmf-xbrl-discover] known unmapped tickers: ${Object.keys(UNMAPPED_TICKERS).join(', ') || '(none)'}`)
    const tickers = args.ticker ? [args.ticker] : [...Object.keys(CMF_ISSUER_MAP), ...Object.keys(UNMAPPED_TICKERS)]
    for (const t of tickers) await reportFeasibility(t)
    console.log('[cmf-xbrl-discover] See docs/cmf_xbrl_provider_discovery.md for the full feasibility assessment.')
    console.log('[cmf-xbrl-discover] Run with npm run ingest:cmf-financials:dry -- --ticker <TICKER> to attempt a real fetch+parse dry run.')
    return
  }

  const ticker = args.ticker
  if (!ticker) {
    console.error('[cmf-xbrl-discover] --ticker is required for ingest-dry/ingest-write modes')
    process.exitCode = 1
    return
  }

  console.log(args.mode === 'ingest-write' ? `[cmf-xbrl-discover] WRITE MODE for ${ticker}` : `[cmf-xbrl-discover] DRY RUN for ${ticker} (no writes)`)

  const filingsResult = await cmfXbrlProvider.discoverFilings(ticker)
  if (!filingsResult.ok) {
    console.error(`[cmf-xbrl-discover] BLOCKED: ${filingsResult.error.code} — ${filingsResult.error.reason}`)
    console.error(`[cmf-xbrl-discover] Next action: ${filingsResult.error.nextAction}`)
    process.exitCode = 1
    return
  }

  let db: Awaited<ReturnType<typeof import('../../src/lib/supabase/admin.ts').getSupabaseAdminClient>> = null
  let ingestionRunId: string | null = null
  if (args.mode === 'ingest-write') {
    const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
    db = getSupabaseAdminClient()
    if (!db) {
      console.error('[cmf-xbrl-discover] Admin Supabase client not configured — cannot write')
      process.exitCode = 1
      return
    }
    const startedAt = new Date().toISOString()
    const runMetadata = { ingestionVersion: INGESTION_VERSION, sourceType: SOURCE_TYPE, automationReadiness: 'feasible_with_mapping', ticker }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initialRun = await (db as any)
      .from('ingestion_runs')
      .insert({ provider: PROVIDER, job_type: JOB_TYPE, status: 'running', started_at: startedAt, rows_seen: filingsResult.value.length, metadata: runMetadata })
      .select('id')
      .single()
    ingestionRunId = initialRun.error ? null : (initialRun.data?.id ?? null)
    if (initialRun.error) console.warn(`[cmf-xbrl-discover] Could not create ingestion_runs row up front: ${sanitizeError(initialRun.error)}`)
  }

  let rowsInserted = 0
  const errors: string[] = []

  for (const ref of filingsResult.value.slice(0, 1)) {
    console.log(`[cmf-xbrl-discover] Attempting fetch: ${ref.description}`)
    const rawResult = await cmfXbrlProvider.fetchFiling(ref)
    if (!rawResult.ok) {
      console.log(`[cmf-xbrl-discover]   ${rawResult.error.code}: ${rawResult.error.reason}`)
      console.log(`[cmf-xbrl-discover]   Next action: ${rawResult.error.nextAction}`)
      errors.push(`${ref.description}: ${rawResult.error.reason}`)
      continue
    }

    const parsedResult = cmfXbrlProvider.parseFiling(rawResult.value)
    if (!parsedResult.ok) {
      console.log(`[cmf-xbrl-discover]   parse failed: ${parsedResult.error.reason}`)
      errors.push(`${ref.description}: ${parsedResult.error.reason}`)
      continue
    }

    const payloadResult = cmfXbrlProvider.normalizeToFinancialImportPayload(parsedResult.value)
    if (!payloadResult.ok) {
      console.log(`[cmf-xbrl-discover]   normalize failed: ${payloadResult.error.reason}`)
      errors.push(`${ref.description}: ${payloadResult.error.reason}`)
      continue
    }

    const dryRun = cmfXbrlProvider.dryRunImport(payloadResult.value)
    console.log(`[cmf-xbrl-discover]   dry-run: ${dryRun.summary}`)

    if (args.mode === 'ingest-write' && dryRun.valid) {
      const writeResult = await cmfXbrlProvider.writeImport(payloadResult.value, ingestionRunId)
      if (!writeResult.ok) {
        console.log(`[cmf-xbrl-discover]   write failed: ${writeResult.error.reason}`)
        errors.push(`${ref.description}: ${writeResult.error.reason}`)
      } else {
        rowsInserted += writeResult.value.rowsInserted
        console.log(`[cmf-xbrl-discover]   wrote ${writeResult.value.rowsInserted} row(s)`)
      }
    }
  }

  if (ingestionRunId) {
    const status = errors.length === 0 ? 'success' : rowsInserted > 0 ? 'partial_success' : 'failed'
    const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
    const adminDb = db ?? getSupabaseAdminClient()
    if (adminDb) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminDb as any)
        .from('ingestion_runs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          rows_inserted: rowsInserted,
          rows_updated: 0,
          rows_failed: errors.length,
          error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        })
        .eq('id', ingestionRunId)
    }
  }

  console.log(`[cmf-xbrl-discover] DONE — ${rowsInserted} row(s) written, ${errors.length} error(s)`)
}

main().catch((e) => {
  console.error(`[cmf-xbrl-discover] Fatal error: ${sanitizeError(e)}`)
  process.exitCode = 1
})
