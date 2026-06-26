// Phase 5C.1 — Read-only endpoint returning macro ingestion summary + recent runs.
// Returns empty arrays with a 'static' source indicator when DB_MODE=static.
// Never exposes credentials or raw provider errors.

import { NextResponse } from 'next/server'
import { getMacroObservationSummary, getMacroIngestionStatus } from '@/lib/db/repositories/macroRepository'

export async function GET() {
  try {
    const [summary, runs] = await Promise.all([
      getMacroObservationSummary(),
      getMacroIngestionStatus(5),
    ])
    return NextResponse.json({
      source: summary.source,
      observations: summary.data,
      recentRuns: runs.data,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Failed to fetch ingestion status', detail: msg }, { status: 500 })
  }
}
