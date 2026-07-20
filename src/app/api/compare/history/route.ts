// 2026-07-20 — GET /api/compare/history?tickers=SQM-B,BSANTANDER&timeframe=1M
// Persisted history for Compare's Comparative Returns table + chart, where
// accumulated Supabase snapshot history genuinely covers the timeframe (see
// resolveCompareHistory.ts). Always returns 200 with a metadata envelope —
// the UI falls back to its own static series per ticker on any failure.

import { NextResponse } from 'next/server'
import { resolveCompareHistory, COMPARE_HISTORY_TIMEFRAMES } from '@/lib/compare/resolveCompareHistory'
import type { StockTimeframe } from '@/lib/providers/market/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers') ?? ''
  const tickers = tickersParam.split(',').map((t) => t.trim()).filter(Boolean)
  const timeframeParam = searchParams.get('timeframe') ?? ''
  const timeframe = COMPARE_HISTORY_TIMEFRAMES.find((tf) => tf === timeframeParam) as StockTimeframe | undefined

  if (tickers.length === 0 || !timeframe) {
    return NextResponse.json({ series: [], invalidTickers: tickers })
  }

  try {
    const result = await resolveCompareHistory(tickers, timeframe)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ series: [], invalidTickers: tickers })
  }
}
