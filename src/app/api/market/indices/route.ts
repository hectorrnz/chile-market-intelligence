// Phase 4C — GET /api/market/indices
// Returns index snapshots (IPSA, LatAm, global) + source metadata.

import { NextResponse } from 'next/server'
import { resolveIndices, marketErrorResponse } from '@/lib/providers/market/marketProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    return NextResponse.json(await resolveIndices())
  } catch {
    return NextResponse.json(marketErrorResponse('indices'), { status: 200 })
  }
}
