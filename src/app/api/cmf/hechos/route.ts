// GET /api/cmf/hechos
// Query params: limit, ticker, entity, from, to, category, materiality
// Always returns 200 with static fallback if live CMF is unavailable.

import { NextRequest, NextResponse } from 'next/server'
import { resolveCmfHechos, cmfErrorResponse } from '@/lib/providers/cmf/cmfProvider'
import type { CmfFilingFilters } from '@/lib/providers/cmf/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const sp = req.nextUrl.searchParams
    const filters: CmfFilingFilters = {
      limit:       sp.has('limit')       ? Number(sp.get('limit'))    : 100,
      ticker:      sp.get('ticker')      || null,
      entity:      sp.get('entity')      || null,
      from:        sp.get('from')        || null,
      to:          sp.get('to')          || null,
      category:    sp.get('category')    || null,
      materiality: sp.get('materiality') || null,
    }
    const result = await resolveCmfHechos(filters)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(cmfErrorResponse('hechos'), { status: 200 })
  }
}
