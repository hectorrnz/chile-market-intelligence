// Phase 8C.5 — Yahoo Finance fundamentals ingestion CLI.
//
// Fetches Yahoo quarterly + annual fundamentals for every app ticker (all 25,
// banks included) and writes them into the source-agnostic financials tables.
// Yahoo rows carry source_type 'yahoo_finance' (priority 80) — CMF/XBRL annual
// (210) supersedes Yahoo annual for the same FY; Yahoo quarterly always shows.
//
// Usage:
//   npm run ingest:yahoo-financials:dry                    # fetch + map + report, NO write (all tickers)
//   npm run ingest:yahoo-financials:dry -- --ticker CCU    # one ticker
//   npm run ingest:yahoo-financials -- --write             # real write (all tickers)
//   npm run ingest:yahoo-financials -- --ticker CCU --write
//
// Sanitized logs only — no secrets, no raw payloads.

import pkg from '@next/env'
import { runYahooFinancialsIngestion, getYahooTickers } from '../../src/lib/financials/yahoo/runYahooFinancialsIngestion.ts'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const PROVIDER = 'Yahoo Financials'
const JOB_TYPE = 'yahoo_financials'

function sanitize(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***').replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***').slice(0, 300)
}

function parseArgs(argv: string[]): { ticker?: string; write: boolean } {
  const args: { ticker?: string; write: boolean } = { write: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--ticker') args.ticker = argv[++i]?.toUpperCase()
    else if (argv[i] === '--write') args.write = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  const write = args.write
  const tickers = args.ticker ? [args.ticker] : getYahooTickers()
  console.log(write ? `[yahoo-fin] WRITE MODE — ${tickers.length} ticker(s)` : `[yahoo-fin] DRY RUN — ${tickers.length} ticker(s) (no writes)`)

  let ingestionRunId: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminDb: any = null
  if (write) {
    const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
    adminDb = getSupabaseAdminClient()
    if (!adminDb) { console.error('[yahoo-fin] Admin Supabase client not configured — cannot write'); process.exitCode = 1; return }
    const created = await adminDb
      .from('ingestion_runs')
      .insert({ provider: PROVIDER, job_type: JOB_TYPE, status: 'running', started_at: new Date().toISOString(), metadata: { phase: '8C.5', sourceType: 'yahoo_finance', cli: true, ticker: args.ticker ?? null } })
      .select('id').single()
    ingestionRunId = created.error ? null : (created.data?.id ?? null)
  }

  const summary = await runYahooFinancialsIngestion({ tickers, write, ingestionRunId })

  for (const t of summary.tickers) {
    console.log(`[yahoo-fin] ${t.ticker.padEnd(12)} ${t.status.padEnd(11)} cur=${(t.currency ?? '-').padEnd(3)} annual=${t.annualPeriods} qtr=${t.quarterlyPeriods} items=${t.statementItems} metrics=${t.metrics} rows=${t.rowsWritten}${t.reason ? ` reason: ${sanitize(t.reason)}` : ''}`)
  }

  if (ingestionRunId && adminDb) {
    await adminDb.from('ingestion_runs').update({
      status: summary.status === 'failed' ? 'error' : 'done',
      finished_at: new Date().toISOString(),
      rows_seen: summary.periodsSeen,
      rows_inserted: summary.rowsWritten,
      rows_failed: summary.tickersFailed,
      error_message: summary.errors.length > 0 ? sanitize(summary.errors.slice(0, 5).join('; ')) : null,
      metadata: { phase: '8C.5', sourceType: 'yahoo_finance', status: summary.status },
    }).eq('id', ingestionRunId)
  }

  console.log(`[yahoo-fin] DONE — status ${summary.status}, ${summary.tickersSucceeded}/${summary.tickersAttempted} ok, ${summary.rowsWritten} row(s) written, ${summary.tickersFailed} failed`)
}

main().catch((e) => { console.error(`[yahoo-fin] Fatal: ${sanitize(e)}`); process.exitCode = 1 })
