// Phase 5D — Vercel Cron route: incremental BCCh macro ingestion.
//
// Vercel Cron invokes this via GET with:
//   Authorization: Bearer <CRON_SECRET>
//
// Manual trigger (local dev / PowerShell):
//   $h = @{ Authorization = "Bearer $env:CRON_SECRET" }
//   Invoke-RestMethod -Uri http://localhost:3000/api/cron/ingest-bcch-macro -Headers $h
//
// curl:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-bcch-macro
//
// Response: JSON summary (see IngestionResult). Credentials never appear in responses.

import { NextResponse } from 'next/server'
import { runBcchMacroIngestion, sanitizeError } from '@/lib/ingestion/bcchMacroIngestion'

export const dynamic = 'force-dynamic'
// Vercel max duration: 60s on Hobby, 300s on Pro.
// 11 indicators × ~2s each + delays ≈ ~25s — within Hobby limits.
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
    const result = await runBcchMacroIngestion({
      indicators: 'all',
      mode:       'incremental',
      daysBack:   14,
      dryRun:     false,
      source:     'cron',
    })

    // Return only the sanitized summary — no credentials, no raw errors.
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
