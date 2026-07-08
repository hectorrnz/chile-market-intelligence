// Phase 8C.2 — CMF/XBRL automated financials ingestion cron route.
//
// GET /api/cron/financials/cmf-xbrl
//   Authorization: Bearer <CRON_SECRET>
//
// Runs the CMF/XBRL ingestion orchestrator for the mapped Chile issuers
// (SQM-B, COPEC) over their most recent ANNUAL filing(s) and writes normalized
// financials via the same source-agnostic repository upsert path manual CSV
// uses. XBRL rows (source_priority 210) supersede manual_csv (100) for the same
// period. No secrets and no raw XBRL are ever returned.
//
// NOT on a Vercel cron schedule yet (intentionally — see
// docs/cmf_xbrl_financials_ingestion.md): the CMF entidad.php surface is an
// undocumented HTML page, so ingestion stays a manually-triggered, reviewable
// run until its stability has been observed over time. The route is protected
// exactly like the macro/structured-notes crons so it can be triggered safely.
//
// Safe optional query params:
//   ?ticker=COPEC   — limit to one mapped ticker (validated against the map)
//   ?periods=2      — number of recent annual periods per issuer (1–5, clamped)
//   ?dryRun=1       — discover/parse/validate but do not write

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { runCmfXbrlIngestion } from '@/lib/financials/cmf/runCmfXbrlIngestion'
import { getMappedTickers } from '@/lib/financials/cmfIssuerMap'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const PROVIDER = 'CMF XBRL'
const JOB_TYPE = 'cmf_xbrl_financials'

function sanitize(msg: string): string {
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***').replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***').slice(0, 300)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Cron not configured — CRON_SECRET missing' }, { status: 500 })
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Safe params ─────────────────────────────────────────────────────────────
  const url = req.nextUrl
  const tickerParam = (url.searchParams.get('ticker') ?? '').trim().toUpperCase()
  const mapped = getMappedTickers()
  const tickers = tickerParam && mapped.includes(tickerParam) ? [tickerParam] : mapped
  const periodsRaw = Number(url.searchParams.get('periods') ?? '1')
  const annualPeriodsPerIssuer = Number.isFinite(periodsRaw) ? Math.min(5, Math.max(1, Math.trunc(periodsRaw))) : 1
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'

  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  // ── Ingestion-run audit row (created first, like macro/structured-notes) ────
  const startedAt = new Date().toISOString()
  let ingestionRunId: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (db as any)
      .from('ingestion_runs')
      .insert({ provider: PROVIDER, job_type: JOB_TYPE, status: 'running', started_at: startedAt, metadata: { phase: '8C.2', sourceType: 'xbrl', dryRun, tickers } })
      .select('id')
      .single()
    ingestionRunId = created.error ? null : (created.data?.id ?? null)
  } catch { ingestionRunId = null }

  try {
    const summary = await runCmfXbrlIngestion({
      tickers,
      annualPeriodsPerIssuer,
      write: !dryRun,
      ingestionRunId,
    })

    // ── Complete the audit row ────────────────────────────────────────────────
    if (ingestionRunId) {
      const runStatus = summary.status === 'success' ? 'done' : summary.status === 'failed' ? 'error' : 'done'
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from('ingestion_runs').update({
          status: runStatus,
          finished_at: new Date().toISOString(),
          rows_seen: summary.fieldsMapped + summary.fieldsUnmapped,
          rows_inserted: summary.normalizedFactsPersisted,
          rows_updated: 0,
          rows_failed: summary.issuersFailed,
          error_message: summary.errors.length > 0 ? sanitize(summary.errors.slice(0, 3).join('; ')) : null,
          metadata: { phase: '8C.2', sourceType: 'xbrl', dryRun, status: summary.status, issuersSucceeded: summary.issuersSucceeded, issuersPartial: summary.issuersPartial, issuersFailed: summary.issuersFailed },
        }).eq('id', ingestionRunId)
      } catch { /* audit update best-effort */ }
    }

    // ── Sanitized response (no secrets, no raw XBRL) ──────────────────────────
    return NextResponse.json({
      runId: ingestionRunId,
      status: summary.status,
      dryRun,
      issuersAttempted: summary.issuersAttempted,
      issuersSucceeded: summary.issuersSucceeded,
      issuersPartial: summary.issuersPartial,
      issuersFailed: summary.issuersFailed,
      filingsDiscovered: summary.filingsDiscovered,
      filingsDownloaded: summary.filingsDownloaded,
      filingsParsed: summary.filingsParsed,
      normalizedFactsPersisted: summary.normalizedFactsPersisted,
      fieldsMapped: summary.fieldsMapped,
      fieldsUnmapped: summary.fieldsUnmapped,
      validationWarnings: summary.validationWarnings,
      sourceTypes: summary.sourceTypes,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      issuers: summary.issuers.map((i) => ({
        ticker: i.ticker,
        status: i.status,
        filings: i.filings.map((f) => ({
          period: f.filingPeriodLabel,
          status: f.status,
          validationStatus: f.validationStatus,
          periodNature: f.periodNature,
          currency: f.currency,
          fieldsMapped: f.fieldsMapped,
          fieldsUnmapped: f.fieldsUnmapped,
          rowsWritten: f.rowsWritten,
          warningCodes: f.warningCodes,
          reason: f.reason ? sanitize(f.reason) : null,
        })),
      })),
      warnings: summary.warnings,
      errors: summary.errors.map(sanitize),
      dataPolicy: 'Official CMF XBRL filing data (Estados Financieros IFRS). Automated HTML-surface ingestion — reviewable, not yet on an unattended schedule.',
    })
  } catch (e) {
    const msg = sanitize(e instanceof Error ? e.message : 'Unknown error')
    if (ingestionRunId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from('ingestion_runs').update({ status: 'error', finished_at: new Date().toISOString(), error_message: msg }).eq('id', ingestionRunId)
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ runId: ingestionRunId, status: 'failed', error: 'CMF/XBRL ingestion run failed', detail: msg }, { status: 500 })
  }
}
