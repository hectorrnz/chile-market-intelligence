// Phase 6C — POST /api/portfolios/[id]/positions  Add a position to a portfolio.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { addPosition } from '@/lib/db/repositories/portfolioRepository'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId } = await params

  let ticker = ''
  let quantity = NaN
  let averageCost: number | null | undefined
  let notes: string | undefined

  try {
    const body = await request.json()
    if (typeof body.ticker === 'string') ticker = body.ticker.trim().toUpperCase()
    if (typeof body.quantity === 'number') quantity = body.quantity
    if (typeof body.averageCost === 'number') averageCost = body.averageCost
    if (body.averageCost === null) averageCost = null
    if (typeof body.notes === 'string') notes = body.notes.trim().slice(0, 500) || undefined
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!ticker) {
    return NextResponse.json({ error: 'ticker_required' }, { status: 400 })
  }

  const result = await addPosition(client, portfolioId, { ticker, quantity, averageCost, notes })

  if (!result.ok) {
    const status =
      result.error === 'duplicate' ? 409 :
      result.error === 'invalid_ticker' || result.error === 'invalid_quantity' || result.error === 'invalid_average_cost' ? 422 :
      500
    return NextResponse.json({ error: result.error ?? 'insert_failed' }, { status })
  }

  return NextResponse.json({ position: result.position }, { status: 201 })
}
