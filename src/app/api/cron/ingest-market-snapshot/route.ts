// Phase 4C.2 — Market snapshot ingestion API route.
// Secured with Authorization: Bearer ${MARKET_INGEST_SECRET}.
// Called by GitHub Actions after static data refresh. Also supports manual trigger.
//
// GET  /api/cron/ingest-market-snapshot?snapshotType=midday|close|manual
// POST /api/cron/ingest-market-snapshot?snapshotType=midday|close|manual
//
// snapshotType defaults to 'midday' if UTC hour < 17, else 'close'.
// Pass ?snapshotType=manual for explicit manual runs.

import { NextRequest, NextResponse } from 'next/server'
import {
  runMarketSnapshotIngestion,
  sanitizeError,
  type SnapshotType,
} from '@/lib/ingestion/marketSnapshotIngestion'

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

const VALID_TYPES: SnapshotType[] = ['midday', 'close', 'manual', 'live_refresh']

function inferSnapshotType(): SnapshotType {
  const hour = new Date().getUTCHours()
  return hour < 17 ? 'midday' : 'close'
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const secret = process.env.MARKET_INGEST_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { error: 'Server misconfigured: MARKET_INGEST_SECRET not set' },
      { status: 500 },
    )
  }
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Params ────────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const rawType    = searchParams.get('snapshotType') ?? ''
  const snapshotType: SnapshotType = (
    VALID_TYPES.includes(rawType as SnapshotType) ? rawType : inferSnapshotType()
  ) as SnapshotType

  // ── Run ingestion ─────────────────────────────────────────────────────────────
  const startedAt = new Date().toISOString()
  let result
  try {
    result = await runMarketSnapshotIngestion({ snapshotType, source: 'api' })
  } catch (e) {
    return NextResponse.json(
      {
        error:       `Ingestion failed: ${sanitizeError(e)}`,
        provider:    'yahoo-finance',
        snapshotType,
        startedAt,
        finishedAt:  new Date().toISOString(),
      },
      { status: 500 },
    )
  }

  const httpStatus = result.status === 'failed' ? 500 : 200
  return NextResponse.json(
    {
      success:            result.success,
      status:             result.status,
      provider:           result.provider,
      snapshotType:       result.snapshotType,
      snapshotDate:       result.snapshotDate,
      rowsSeen:           result.rowsSeen,
      rowsInserted:       result.rowsInserted,
      rowsUpdated:        result.rowsUpdated,
      rowsFailed:         result.rowsFailed,
      symbolsSucceeded:   result.symbolsSucceeded,
      symbolsFailed:      result.symbolsFailed,
      stockRowsSeen:      result.stockRowsSeen,
      stockRowsInserted:  result.stockRowsInserted,
      indexRowsSeen:      result.indexRowsSeen,
      indexRowsInserted:  result.indexRowsInserted,
      sectorRowsSeen:     result.sectorRowsSeen,
      sectorRowsInserted: result.sectorRowsInserted,
      ingestionRunId:     result.ingestionRunId,
      startedAt:          result.startedAt,
      finishedAt:         result.finishedAt,
      durationMs:         result.durationMs,
      ...(result.errorSummary ? { errorSummary: result.errorSummary } : {}),
    },
    { status: httpStatus },
  )
}

export const GET  = handle
export const POST = handle
