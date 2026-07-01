// Phase 6A — GET  /api/watchlists/[id]/items  List items in a watchlist.
//           — POST /api/watchlists/[id]/items  Add a ticker to a watchlist.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  addTickerToWatchlist,
  getWatchlistItems,
} from '@/lib/db/repositories/watchlistRepository'
import { getAllCompanies } from '@/lib/data/companies'

export const dynamic = 'force-dynamic'

const VALID_TICKERS = new Set(getAllCompanies().map(c => c.ticker.toUpperCase()))

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: watchlistId } = await params
  const items = await getWatchlistItems(client, watchlistId)
  return NextResponse.json({ items })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: watchlistId } = await params

  let ticker = ''
  let notes: string | undefined
  try {
    const body = await request.json()
    if (typeof body.ticker === 'string') ticker = body.ticker.trim().toUpperCase()
    if (typeof body.notes === 'string') notes = body.notes.trim().slice(0, 500) || undefined
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!ticker) {
    return NextResponse.json({ error: 'ticker_required' }, { status: 400 })
  }
  if (!VALID_TICKERS.has(ticker)) {
    return NextResponse.json({ error: 'invalid_ticker' }, { status: 422 })
  }

  const result = await addTickerToWatchlist(client, watchlistId, ticker, notes)

  if (!result.ok) {
    if (result.error === 'duplicate') {
      return NextResponse.json({ error: 'duplicate' }, { status: 409 })
    }
    return NextResponse.json({ error: result.error ?? 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ item: result.item }, { status: 201 })
}
