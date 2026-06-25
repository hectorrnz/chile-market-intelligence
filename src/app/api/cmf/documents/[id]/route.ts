// GET /api/cmf/documents/[id]
// Returns a single CMF document record by id.

import { NextRequest, NextResponse } from 'next/server'
import { resolveCmfDocument, cmfErrorResponse } from '@/lib/providers/cmf/cmfProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params
    const result = await resolveCmfDocument(id)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(cmfErrorResponse('documents'), { status: 200 })
  }
}
