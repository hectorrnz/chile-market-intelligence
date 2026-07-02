// Phase 8B — GET /api/compare?tickers=SQM-B,BSANTANDER,COPEC
// Returns normalized Compare data (market fields wired to persisted/live
// Supabase snapshots where available; fundamentals remain temporary static).
// Always returns 200 with a metadata envelope so the UI never breaks.

import { NextResponse } from 'next/server'
import { resolveCompareData } from '@/lib/compare/resolveCompareData'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers') ?? ''
  const tickers = tickersParam.split(',').map((t) => t.trim()).filter(Boolean)

  if (tickers.length === 0) {
    return NextResponse.json({
      data: [],
      metadata: {
        marketDataModeRequested: 'static',
        marketDataModeUsed: 'static',
        persistedAvailable: false,
        staticFallbackUsed: false,
        latestSnapshotDate: null,
        invalidTickers: [],
      },
    })
  }

  try {
    const result = await resolveCompareData(tickers)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({
      data: [],
      metadata: {
        marketDataModeRequested: 'static',
        marketDataModeUsed: 'static',
        persistedAvailable: false,
        staticFallbackUsed: false,
        latestSnapshotDate: null,
        invalidTickers: tickers,
      },
    }, { status: 200 })
  }
}
