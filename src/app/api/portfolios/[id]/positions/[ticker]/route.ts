// Phase 6C — PATCH  /api/portfolios/[id]/positions/[ticker]  Edit a position.
//           — DELETE /api/portfolios/[id]/positions/[ticker]  Remove a position.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { updatePosition, removePosition } from '@/lib/db/repositories/portfolioRepository'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ticker: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId, ticker } = await params
  if (!ticker) {
    return NextResponse.json({ error: 'ticker_required' }, { status: 400 })
  }

  let quantity: number | undefined
  let averageCost: number | null | undefined
  let notes: string | undefined

  try {
    const body = await request.json()
    if (typeof body.quantity === 'number') quantity = body.quantity
    if (typeof body.averageCost === 'number') averageCost = body.averageCost
    if (body.averageCost === null) averageCost = null
    if (typeof body.notes === 'string') notes = body.notes.trim().slice(0, 500)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const result = await updatePosition(client, portfolioId, decodeURIComponent(ticker), {
    quantity,
    averageCost,
    notes,
  })

  if (!result.ok) {
    const status =
      result.error === 'invalid_quantity' || result.error === 'invalid_average_cost' ? 422 :
      result.error === 'not_found' ? 404 :
      500
    return NextResponse.json({ error: result.error ?? 'update_failed' }, { status })
  }

  return NextResponse.json({ position: result.position })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ticker: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId, ticker } = await params
  if (!ticker) {
    return NextResponse.json({ error: 'ticker_required' }, { status: 400 })
  }

  const result = await removePosition(client, portfolioId, decodeURIComponent(ticker))

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'delete_failed' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
