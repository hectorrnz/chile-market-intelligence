// Phase 4C — GET /api/market/sectors
// Returns sector performance data (Chilean sectors heat map) + source metadata.

import { NextResponse } from 'next/server'
import { resolveSectors, marketErrorResponse } from '@/lib/providers/market/marketProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    return NextResponse.json(await resolveSectors())
  } catch {
    return NextResponse.json(marketErrorResponse('sectors'), { status: 200 })
  }
}
