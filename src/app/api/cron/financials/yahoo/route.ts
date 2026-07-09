// Phase 8C.5 — Yahoo Finance fundamentals ingestion cron route.
//
// GET /api/cron/financials/yahoo
//   Authorization: Bearer <CRON_SECRET>
//
// Refreshes Yahoo quarterly + annual fundamentals for the app tickers into the
// source-agnostic financials tables (source_type 'yahoo_finance', priority 80).
// CMF/XBRL annual (210) still supersedes Yahoo annual for the same FY. No
// secrets and no raw payloads are ever returned.
//
// NOT on a Vercel cron schedule — fundamentals change only quarterly, so the
// initial ingest already gives every stock a working quarterly+annual history;
// refreshes are manually triggered (or scheduled later) like the CMF/XBRL cron.
//
// Safe optional query params:
//   ?ticker=CCU   — limit to one app ticker
//   ?dryRun=1     — fetch/map but do not write

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { runYahooFinancialsIngestion, getYahooTickers } from '@/lib/financials/yahoo/runYahooFinancialsIngestion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const PROVIDER = 'Yahoo Financials'
const JOB_TYPE = 'yahoo_financials'

function sanitize(msg: string): string {
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***').replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***').slice(0, 300)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Cron not configured — CRON_SECRET missing' }, { status: 500 })
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl
  const tickerParam = (url.searchParams.get('ticker') ?? '').trim().toUpperCase()
  const all = getYahooTickers()
  const tickers = tickerParam && all.includes(tickerParam) ? [tickerParam] : all
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'

  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const startedAt = new Date().toISOString()
  let ingestionRunId: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (db as any)
      .from('ingestion_runs')
      .insert({ provider: PROVIDER, job_type: JOB_TYPE, status: 'running', started_at: startedAt, metadata: { phase: '8C.5', sourceType: 'yahoo_finance', dryRun, tickerCount: tickers.length } })
      .select('id').single()
    ingestionRunId = created.error ? null : (created.data?.id ?? null)
  } catch { ingestionRunId = null }

  try {
    const summary = await runYahooFinancialsIngestion({ tickers, write: !dryRun, ingestionRunId })
    if (ingestionRunId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from('ingestion_runs').update({
          status: summary.status === 'failed' ? 'error' : 'done',
          finished_at: new Date().toISOString(),
          rows_seen: summary.periodsSeen,
          rows_inserted: summary.rowsWritten,
          rows_failed: summary.tickersFailed,
          error_message: summary.errors.length > 0 ? sanitize(summary.errors.slice(0, 3).join('; ')) : null,
          metadata: { phase: '8C.5', sourceType: 'yahoo_finance', dryRun, status: summary.status },
        }).eq('id', ingestionRunId)
      } catch { /* best-effort audit */ }
    }
    return NextResponse.json({
      runId: ingestionRunId,
      status: summary.status,
      dryRun,
      tickersAttempted: summary.tickersAttempted,
      tickersSucceeded: summary.tickersSucceeded,
      tickersFailed: summary.tickersFailed,
      periodsSeen: summary.periodsSeen,
      rowsWritten: summary.rowsWritten,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      tickers: summary.tickers.map((t) => ({ ticker: t.ticker, status: t.status, currency: t.currency, annualPeriods: t.annualPeriods, quarterlyPeriods: t.quarterlyPeriods, rowsWritten: t.rowsWritten, reason: t.reason ? sanitize(t.reason) : null })),
      errors: summary.errors.map(sanitize),
      dataPolicy: 'Unofficial third-party fundamentals from Yahoo Finance. CMF/XBRL official filings supersede Yahoo annual where present.',
    })
  } catch (e) {
    const msg = sanitize(e instanceof Error ? e.message : 'Unknown error')
    if (ingestionRunId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from('ingestion_runs').update({ status: 'error', finished_at: new Date().toISOString(), error_message: msg }).eq('id', ingestionRunId)
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ runId: ingestionRunId, status: 'failed', error: 'Yahoo financials ingestion failed', detail: msg }, { status: 500 })
  }
}
