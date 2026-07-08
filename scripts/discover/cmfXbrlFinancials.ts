// Phase 8C.2 — CMF/XBRL discovery and ingestion CLI.
//
// The two-step public CMF fetch chain is real and verified, and as of Phase
// 8C.2 the provider unzips the downloaded archive (dependency-free, node:zlib)
// and parses the .xbrl instance with honest period-matching — so `--write`
// now completes a real end-to-end import. Discovery mode still reports
// live-verified coverage/feasibility per ticker.
//
// Usage:
//   npm run discover:cmf-financials                       # feasibility report for all mapped tickers (no network)
//   npm run discover:cmf-financials -- --ticker SQM-B     # feasibility report for one ticker
//   npm run ingest:cmf-financials:dry -- --ticker COPEC   # real fetch+parse+validate, no write
//   npm run ingest:cmf-financials -- --ticker COPEC --write --periods 2
//
// Sanitized logs only — no secrets, no raw HTML/XBRL dumped to stdout.

import pkg from '@next/env'
import { CMF_ISSUER_MAP, UNMAPPED_TICKERS, getCmfIssuer } from '../../src/lib/financials/cmfIssuerMap.ts'
import { candidateAnnualPeriods } from '../../src/lib/financials/providers/cmfXbrlProvider.ts'
import { runCmfXbrlIngestion } from '../../src/lib/financials/cmf/runCmfXbrlIngestion.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const PROVIDER = 'CMF XBRL'
const JOB_TYPE = 'cmf_xbrl_financials'

function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg
    .replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***')
    .replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***')
    .slice(0, 300)
}

function parseArgs(argv: string[]): { mode: 'discover' | 'ingest-dry' | 'ingest-write'; ticker?: string; write: boolean; periods: number } {
  const args: { ticker?: string; write: boolean; periods: number } = { write: false, periods: 1 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ticker') args.ticker = argv[++i]
    else if (a === '--write') args.write = true
    else if (a === '--periods') args.periods = Math.min(5, Math.max(1, Number(argv[++i]) || 1))
  }
  const scriptName = process.env.npm_lifecycle_event ?? ''
  const mode = scriptName.startsWith('ingest:cmf-financials') ? (args.write ? 'ingest-write' : 'ingest-dry') : 'discover'
  return { mode, ticker: args.ticker, write: args.write, periods: args.periods }
}

async function reportFeasibility(ticker: string): Promise<void> {
  const issuer = getCmfIssuer(ticker)
  if (!issuer) {
    const unmappedReason = UNMAPPED_TICKERS[ticker]
    console.log(`[cmf-xbrl] ${ticker}: BLOCKED (issuer_not_mapped)${unmappedReason ? ` — ${unmappedReason}` : ' — no verified CMF RUT on file'}`)
    return
  }
  const candidates = candidateAnnualPeriods(2)
  console.log(`[cmf-xbrl] ${ticker}: mapped to ${issuer.cmfIssuerName} (RUT ${issuer.rut}) — feasible_with_mapping`)
  console.log(`[cmf-xbrl]   candidate annual periods: ${candidates.map((c) => `${c.mm}/${c.aa}`).join(', ')}`)
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.mode === 'discover') {
    console.log('[cmf-xbrl] CMF XBRL financials — discovery mode (no network calls, no writes)')
    console.log(`[cmf-xbrl] verified mapped tickers: ${Object.keys(CMF_ISSUER_MAP).join(', ') || '(none)'}`)
    console.log(`[cmf-xbrl] known unmapped tickers: ${Object.keys(UNMAPPED_TICKERS).join(', ') || '(none)'}`)
    const tickers = args.ticker ? [args.ticker] : [...Object.keys(CMF_ISSUER_MAP), ...Object.keys(UNMAPPED_TICKERS)]
    for (const t of tickers) await reportFeasibility(t)
    console.log('[cmf-xbrl] See docs/cmf_xbrl_financials_ingestion.md for the full ingestion design.')
    console.log('[cmf-xbrl] Run: npm run ingest:cmf-financials:dry -- --ticker <TICKER>   (real fetch+parse+validate, no write)')
    return
  }

  const write = args.mode === 'ingest-write'
  console.log(write ? `[cmf-xbrl] WRITE MODE${args.ticker ? ` for ${args.ticker}` : ' (all mapped issuers)'}` : `[cmf-xbrl] DRY RUN${args.ticker ? ` for ${args.ticker}` : ' (all mapped issuers)'} — no writes`)

  // Create an ingestion_runs row up front when writing (mirrors the cron route).
  let ingestionRunId: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminDb: any = null
  if (write) {
    const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
    adminDb = getSupabaseAdminClient()
    if (!adminDb) {
      console.error('[cmf-xbrl] Admin Supabase client not configured — cannot write')
      process.exitCode = 1
      return
    }
    const created = await adminDb
      .from('ingestion_runs')
      .insert({ provider: PROVIDER, job_type: JOB_TYPE, status: 'running', started_at: new Date().toISOString(), metadata: { phase: '8C.2', sourceType: 'xbrl', cli: true, ticker: args.ticker ?? null } })
      .select('id')
      .single()
    ingestionRunId = created.error ? null : (created.data?.id ?? null)
  }

  const summary = await runCmfXbrlIngestion({
    tickers: args.ticker ? [args.ticker] : undefined,
    annualPeriodsPerIssuer: args.periods,
    write,
    ingestionRunId,
  })

  for (const iss of summary.issuers) {
    console.log(`[cmf-xbrl] ${iss.ticker}: ${iss.status}`)
    for (const f of iss.filings) {
      console.log(`[cmf-xbrl]   ${f.filingPeriodLabel} [${f.status}] val=${f.validationStatus ?? '-'} nature=${f.periodNature ?? '-'} cur=${f.currency ?? '-'} mapped=${f.fieldsMapped} unmapped=${f.fieldsUnmapped} rows=${f.rowsWritten}${f.reason ? ` reason: ${sanitizeError(f.reason)}` : ''}`)
    }
  }

  if (ingestionRunId && adminDb) {
    const runStatus = summary.status === 'success' ? 'done' : summary.status === 'failed' ? 'error' : 'done'
    await adminDb.from('ingestion_runs').update({
      status: runStatus,
      finished_at: new Date().toISOString(),
      rows_seen: summary.fieldsMapped + summary.fieldsUnmapped,
      rows_inserted: summary.normalizedFactsPersisted,
      rows_failed: summary.issuersFailed,
      error_message: summary.errors.length > 0 ? summary.errors.slice(0, 5).join('; ') : null,
      metadata: { phase: '8C.2', sourceType: 'xbrl', status: summary.status },
    }).eq('id', ingestionRunId)
  }

  console.log(`[cmf-xbrl] DONE — status ${summary.status}, ${summary.normalizedFactsPersisted} row(s) written, ${summary.issuersFailed} issuer(s) failed`)
}

main().catch((e) => {
  console.error(`[cmf-xbrl] Fatal error: ${sanitizeError(e)}`)
  process.exitCode = 1
})
