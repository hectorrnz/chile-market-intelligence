// Phase 4C — GET /api/market/stocks/[ticker]/history?timeframe=1D|5D|1M|MTD|YTD|1Y|3Y|5Y
// Returns OHLCV history for a single ticker at the requested timeframe.

import { NextResponse } from 'next/server'
import { resolveStockHistory } from '@/lib/providers/market/marketProvider'
import type { StockTimeframe } from '@/lib/providers/market/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_TIMEFRAMES: StockTimeframe[] = ['1D', '5D', '1M', 'MTD', 'YTD', '1Y', '3Y', '5Y']

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params
    const { searchParams } = new URL(req.url)
    const tf = searchParams.get('timeframe')?.toUpperCase() as StockTimeframe | null
    const timeframe: StockTimeframe = tf && VALID_TIMEFRAMES.includes(tf) ? tf : '1Y'
    return NextResponse.json(await resolveStockHistory(ticker.toUpperCase(), timeframe))
  } catch {
    return NextResponse.json(
      { data: [], metadata: { dataModeRequested: 'static', dataModeUsed: 'static', liveAvailable: false, status: 'static', source: 'Static MVP', lastUpdated: '', fallbackReason: 'Unexpected server error', provider: 'static' } },
      { status: 200 }
    )
  }
}
