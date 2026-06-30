// Phase 4C.2 — Market snapshot ingestion status endpoint.
// Read-only, no auth required.
//
// GET /api/market/ingestion-status
//
// Returns latest market snapshot counts and the most recent ingestion run.
// Falls back to static counts when Supabase is not configured.

import { NextResponse } from 'next/server'
import {
  getMarketSnapshotSummary,
  getLatestMarketIngestionRun,
} from '@/lib/db/repositories/marketRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const [summary, latestRun] = await Promise.all([
    getMarketSnapshotSummary(),
    getLatestMarketIngestionRun(),
  ])

  return NextResponse.json(
    {
      source:             summary.source,
      stockCount:         summary.stockCount,
      indexCount:         summary.indexCount,
      sectorCount:        summary.sectorCount,
      latestSnapshotDate: summary.latestSnapshotDate,
      latestSnapshotType: summary.latestSnapshotType,
      latestRun,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
