// Phase 8D — FRED (US macro) ingestion route.
//
// NOT on a Vercel cron schedule (see vercel.json) — manually/reviewably
// triggered only, same policy as /api/cron/ingest-bcch-macro and the CMF/XBRL
// cron routes until stability is observed over time.
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
