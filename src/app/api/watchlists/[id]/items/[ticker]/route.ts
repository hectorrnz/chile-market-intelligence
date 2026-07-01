// Phase 6A — DELETE /api/watchlists/[id]/items/[ticker]  Remove a ticker.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { removeTickerFromWatchlist } from '@/lib/db/repositories/watchlistRepository'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ticker: string }> },
): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const { id: watchlistId, ticker } = await params

  if (!ticker) {
    return NextResponse.json({ error: 'ticker_required' }, { status: 400 })
  }

  const result = await removeTickerFromWatchlist(client, watchlistId, decodeURIComponent(ticker))

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'delete_failed' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
