// Phase 8D — FRED (US macro) ingestion route.
//
// R13.R5C.1 § 4 — SCHEDULED weekdays at 12:50 UTC (vercel.json), 20 minutes
// after the BCCh macro run so the two never contend for the same window.
//
// It was previously unscheduled, "until stability is observed over time" and
// nominally by the same policy as /api/cron/ingest-bcch-macro — but that route
// has been on a weekday schedule since Phase 5D, so the stated parity was not
// real. The consequence was: persisted FRED observations only ever advanced
// when someone ran the job by hand, the last such run was 2026-07-21, and the
// health check correctly but unhelpfully reported six US series stale for
// weeks on end. FRED macro is the direct architectural twin of BCCh macro —
// the same MacroProvider contract, the same plausibility bands, the same
// verified-series-only registry, a keyless public endpoint, and live since
// Phase 8D — so it gets the same cadence as its twin.
//
// (Distinct from the CMF/XBRL and Yahoo-financials crons, which stay
// unscheduled: those read an undocumented HTML surface, which is the actual
// reason that policy exists.)
//
// Invoke with:
//   Authorization: Bearer <CRON_SECRET>
//
// curl:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-fred-macro
//
// Response: JSON summary (see IngestionResult). No credentials in responses
// (FRED itself requires none; only CRON_SECRET/Supabase admin keys exist server-side).

import { NextResponse } from 'next/server'
import { runFredMacroIngestion, sanitizeError } from '@/lib/ingestion/fredMacroIngestion'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { error: 'Cron not configured — CRON_SECRET missing' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Ingestion ────────────────────────────────────────────────────────────────
  try {
    const result = await runFredMacroIngestion({
      indicators: 'all',
      mode:       'incremental',
      daysBack:   14,
      dryRun:     false,
      source:     'cron',
    })

    return NextResponse.json({
      success:              result.success,
      status:               result.status,
      provider:             result.provider,
      jobType:              result.jobType,
      indicatorsRequested:  result.indicatorsRequested,
      indicatorsSucceeded:  result.indicatorsSucceeded,
      indicatorsFailed:     result.indicatorsFailed,
      rowsSeen:             result.rowsSeen,
      rowsInserted:         result.rowsInserted,
      rowsUpdated:          result.rowsUpdated,
      rowsFailed:           result.rowsFailed,
      startedAt:            result.startedAt,
      finishedAt:           result.finishedAt,
      durationMs:           result.durationMs,
      ...(result.ingestionRunId ? { ingestionRunId: result.ingestionRunId } : {}),
      ...(result.errorSummary   ? { errorSummary:   result.errorSummary   } : {}),
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Ingestion failed', detail: sanitizeError(e) },
      { status: 500 },
    )
  }
}
