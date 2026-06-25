// GET /api/cmf/hechos/[documentNumber]
// Returns a single CMF filing by document number (or internal id for static data).

import { NextRequest, NextResponse } from 'next/server'
import { resolveCmfHecho, cmfErrorResponse } from '@/lib/providers/cmf/cmfProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ documentNumber: string }> },
): Promise<NextResponse> {
  try {
    const { documentNumber } = await params
    const result = await resolveCmfHecho(documentNumber)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(cmfErrorResponse('hechos'), { status: 200 })
  }
}
