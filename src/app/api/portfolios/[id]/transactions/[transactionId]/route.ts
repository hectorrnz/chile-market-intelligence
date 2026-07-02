// Phase 6D — PATCH  /api/portfolios/[id]/transactions/[transactionId]  Edit a transaction.
//           — DELETE /api/portfolios/[id]/transactions/[transactionId]  Remove a transaction.
//
// Ownership: the transaction row itself is scoped by RLS (auth.uid() = user_id)
// so a transactionId belonging to another user simply resolves to "not found".

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  updatePortfolioTransaction,
  deletePortfolioTransaction,
} from '@/lib/db/repositories/portfolioTransactionRepository'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; transactionId: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { transactionId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const result = await updatePortfolioTransaction(client, transactionId, {
    tradeDate: typeof body.tradeDate === 'string' ? body.tradeDate : undefined,
    quantity: typeof body.quantity === 'number' ? body.quantity : undefined,
    price: typeof body.price === 'number' ? body.price : undefined,
    fees: typeof body.fees === 'number' ? body.fees : undefined,
    taxes: typeof body.taxes === 'number' ? body.taxes : undefined,
    notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : undefined,
  })

  if (!result.ok) {
    const status =
      result.error === 'not_found' ? 404 :
      result.error === 'insufficient_quantity' ? 409 :
      result.error === 'invalid_quantity' || result.error === 'invalid_price' ||
        result.error === 'invalid_fees' || result.error === 'invalid_taxes' ||
        result.error === 'invalid_trade_date' ? 422 :
      500
    return NextResponse.json({ error: result.error ?? 'update_failed' }, { status })
  }

  return NextResponse.json({ transaction: result.transaction })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; transactionId: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { transactionId } = await params
  const result = await deletePortfolioTransaction(client, transactionId)

  if (!result.ok) {
    const status =
      result.error === 'not_found' ? 404 :
      result.error === 'insufficient_quantity' ? 409 :
      500
    return NextResponse.json({ error: result.error ?? 'delete_failed' }, { status })
  }

  return new NextResponse(null, { status: 204 })
}
