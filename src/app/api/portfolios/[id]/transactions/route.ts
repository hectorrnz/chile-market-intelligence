// Phase 6D — GET  /api/portfolios/[id]/transactions  List a portfolio's transactions.
//           — POST /api/portfolios/[id]/transactions  Add a buy/sell transaction.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getPortfolioTransactions,
  addPortfolioTransaction,
} from '@/lib/db/repositories/portfolioTransactionRepository'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId } = await params
  const ticker = request.nextUrl.searchParams.get('ticker') ?? undefined
  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = limitParam ? Number(limitParam) : undefined

  const transactions = await getPortfolioTransactions(client, portfolioId, {
    ticker: ticker ?? undefined,
    limit: limit && Number.isFinite(limit) ? limit : undefined,
  })

  return NextResponse.json({ transactions })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : ''
  const transactionType = body.transactionType === 'buy' || body.transactionType === 'sell' ? body.transactionType : ''
  const tradeDate = typeof body.tradeDate === 'string' ? body.tradeDate : ''
  const quantity = typeof body.quantity === 'number' ? body.quantity : NaN
  const price = typeof body.price === 'number' ? body.price : NaN
  const fees = typeof body.fees === 'number' ? body.fees : undefined
  const taxes = typeof body.taxes === 'number' ? body.taxes : undefined
  const currency = typeof body.currency === 'string' ? body.currency : undefined
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : undefined

  if (!ticker) return NextResponse.json({ error: 'ticker_required' }, { status: 400 })
  if (!transactionType) return NextResponse.json({ error: 'invalid_transaction_type' }, { status: 422 })
  if (!tradeDate) return NextResponse.json({ error: 'invalid_trade_date' }, { status: 422 })

  const result = await addPortfolioTransaction(client, portfolioId, {
    ticker,
    transactionType,
    tradeDate,
    quantity,
    price,
    fees,
    taxes,
    currency,
    notes,
  })

  if (!result.ok) {
    const status =
      result.error === 'manual_position_conflict' ? 409 :
      result.error === 'insufficient_quantity' ? 409 :
      result.error === 'invalid_ticker' || result.error === 'invalid_transaction_type' ||
        result.error === 'invalid_quantity' || result.error === 'invalid_price' ||
        result.error === 'invalid_fees' || result.error === 'invalid_taxes' ||
        result.error === 'invalid_trade_date' ? 422 :
      500
    return NextResponse.json({ error: result.error ?? 'insert_failed' }, { status })
  }

  return NextResponse.json({ transaction: result.transaction }, { status: 201 })
}
