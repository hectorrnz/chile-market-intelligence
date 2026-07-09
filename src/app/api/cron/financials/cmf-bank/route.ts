// Phase 8C.8 — CMF bank financials ingestion cron route.
//
// GET /api/cron/financials/cmf-bank
//   Authorization: Bearer <CRON_SECRET>
//
// Runs the CMF bank financials orchestrator for the 4 registered bank
// tickers (BSANTANDER, CHILE, BCI, ITAUCL) over the most recently completed
// ANNUAL release and writes normalized bank facts via the same
// source-agnostic repository upsert path every other financials source
// uses. cmf_bank rows (source_priority 180) supersede yahoo_finance (80) for
// the same fiscal year and mapped field; Yahoo remains active for bank
// quarterly/TTM/earlier-year/unmapped-field data. No secrets and no raw
// bank files are ever returned.
//
// NOT on a Vercel cron schedule — the CMF statistics-page listing this
// pipeline scrapes for the current month's ZIP link is an undocumented HTML
// surface (same caveat as the non-bank CMF/XBRL cron), so ingestion stays a
// manually-triggered, reviewable run. The route is protected exactly like
// the macro/structured-notes/cmf-xbrl crons.
//
// Safe optional query params:
//   ?ticker=BCI     — limit to one bank ticker (validated against the registry)
//   ?year=2025      — fiscal year of the annual release to target
//   ?dryRun=1       — discover/parse/validate but do not write

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { runCmfBankFinancialsIngestion } from '@/lib/financials/banks/runCmfBankFinancialsIngestion'
import { getAllBankTickers, isBankTicker } from '@/lib/financials/banks/bankRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const PROVIDER = 'CMF Bank Financials'
const JOB_TYPE = 'cmf_bank_financials'

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
  const tickers = tickerParam && isBankTicker(tickerParam) ? [tickerParam] : getAllBankTickers()
  const yearRaw = url.searchParams.get('year')
  const fiscalYear = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'

  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  // ── Ingestion-run audit row (created first, like the non-bank cron) ────────
  const startedAt = new Date().toISOString()
  let ingestionRunId: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (db as any)
      .from('ingestion_runs')
      .insert({ provider: PROVIDER, job_type: JOB_TYPE, status: 'running', started_at: startedAt, metadata: { phase: '8C.8', sourceType: 'cmf_bank', dryRun, tickers } })
      .select('id')
      .single()
    ingestionRunId = created.error ? null : (created.data?.id ?? null)
  } catch { ingestionRunId = null }

  try {
    const summary = await runCmfBankFinancialsIngestion({
      tickers,
      fiscalYear,
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
          rows_seen: summary.fieldsMapped,
          rows_inserted: summary.normalizedFactsPersisted,
          rows_updated: 0,
          rows_failed: summary.banksFailed,
          error_message: summary.errors.length > 0 ? sanitize(summary.errors.slice(0, 3).join('; ')) : null,
          metadata: { phase: '8C.8', sourceType: 'cmf_bank', dryRun, status: summary.status, banksSucceeded: summary.banksSucceeded, banksPartial: summary.banksPartial, banksDeferred: summary.banksDeferred, banksFailed: summary.banksFailed },
        }).eq('id', ingestionRunId)
      } catch { /* audit update best-effort */ }
    }

    // ── Sanitized response (no secrets, no raw bank files) ────────────────────
    return NextResponse.json({
      runId: ingestionRunId,
      status: summary.status,
      dryRun,
      banksAttempted: summary.banksAttempted,
      banksSucceeded: summary.banksSucceeded,
      banksPartial: summary.banksPartial,
      banksDeferred: summary.banksDeferred,
      banksFailed: summary.banksFailed,
      normalizedFactsPersisted: summary.normalizedFactsPersisted,
      fieldsMapped: summary.fieldsMapped,
      sourceTypes: summary.sourceTypes,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      banks: summary.banks.map((b) => ({
        ticker: b.ticker,
        bankCode: b.bankCode,
        fiscalYear: b.fiscalYear,
        status: b.status,
        validationStatus: b.validationStatus,
        currency: b.currency,
        fieldsMapped: b.fieldsMapped,
        fieldsExpected: b.fieldsExpected,
        rowsWritten: b.rowsWritten,
        warningCodes: b.warningCodes,
        reason: b.reason ? sanitize(b.reason) : null,
      })),
      errors: summary.errors.map(sanitize),
      dataPolicy: 'Official CMF bank regulatory data ("Balance y Estado de Situación Bancos"). Not XBRL. Automated HTML-surface ingestion — reviewable, not on an unattended schedule. Yahoo Finance remains the fallback for bank quarterly/TTM/earlier-year/unmapped-field data.',
    })
  } catch (e) {
    const msg = sanitize(e instanceof Error ? e.message : 'Unknown error')
    if (ingestionRunId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).from('ingestion_runs').update({ status: 'error', finished_at: new Date().toISOString(), error_message: msg }).eq('id', ingestionRunId)
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ runId: ingestionRunId, status: 'failed', error: 'CMF bank financials ingestion run failed', detail: msg }, { status: 500 })
  }
}
