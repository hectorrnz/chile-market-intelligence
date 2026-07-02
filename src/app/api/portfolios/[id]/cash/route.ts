// Phase 6D — GET  /api/portfolios/[id]/cash  Cash ledger + balance + summary.
//           — POST /api/portfolios/[id]/cash  Add a manual deposit/withdrawal/adjustment.
//
// Buy/sell cash entries (buy_cash_outflow, sell_cash_inflow) are created
// internally by addPortfolioTransaction — this route only accepts the three
// user-facing manual entry types.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getCashLedger,
  addCashLedgerEntry,
  getPortfolioCashSummary,
} from '@/lib/db/repositories/portfolioTransactionRepository'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: portfolioId } = await params
  const entries = await getCashLedger(client, portfolioId)
  const summary = await getPortfolioCashSummary(client, portfolioId)

  return NextResponse.json({ entries, summary })
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

  const entryType = body.entryType
  const amount = typeof body.amount === 'number' ? body.amount : NaN
  const ledgerDate = typeof body.ledgerDate === 'string' ? body.ledgerDate : ''
  const currency = typeof body.currency === 'string' ? body.currency : undefined
  const description = typeof body.description === 'string' ? body.description : undefined

  if (entryType !== 'deposit' && entryType !== 'withdrawal' && entryType !== 'adjustment') {
    return NextResponse.json({ error: 'invalid_entry_type' }, { status: 422 })
  }
  if (!ledgerDate) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 422 })
  }

  const result = await addCashLedgerEntry(client, portfolioId, {
    entryType,
    amount,
    ledgerDate,
    currency,
    description,
  })

  if (!result.ok) {
    const status = result.error === 'insert_failed' ? 500 : 422
    return NextResponse.json({ error: result.error ?? 'insert_failed' }, { status })
  }

  return NextResponse.json({ entry: result.entry }, { status: 201 })
}
