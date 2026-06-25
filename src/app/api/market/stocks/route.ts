// Phase 4C — GET /api/market/stocks
// Returns all tracked stock snapshots + source metadata.
// Always returns 200 with static fallback so the UI never breaks.

import { NextResponse } from 'next/server'
import { resolveStockSnapshots, marketErrorResponse } from '@/lib/providers/market/marketProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    return NextResponse.json(await resolveStockSnapshots())
  } catch {
    return NextResponse.json(marketErrorResponse('stocks'), { status: 200 })
  }
}
