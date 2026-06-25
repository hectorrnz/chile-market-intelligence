// Phase 4C — GET /api/market/stocks/[ticker]
// Returns a single stock snapshot. data: null when ticker is not found.

import { NextResponse } from 'next/server'
import { resolveStockSnapshot } from '@/lib/providers/market/marketProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params
    return NextResponse.json(await resolveStockSnapshot(ticker.toUpperCase()))
  } catch {
    return NextResponse.json(
      { data: null, metadata: { dataModeRequested: 'static', dataModeUsed: 'static', liveAvailable: false, status: 'static', source: 'Static MVP', lastUpdated: '', fallbackReason: 'Unexpected server error', provider: 'static' } },
      { status: 200 }
    )
  }
}
