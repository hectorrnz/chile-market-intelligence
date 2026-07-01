// Phase 6A — GET /api/watchlists  List current user's watchlists.
//           — POST /api/watchlists Create a new watchlist.
// Middleware enforces auth: unauthenticated requests never reach this handler.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getUserWatchlists,
  ensureDefaultWatchlist,
  createWatchlist,
} from '@/lib/db/repositories/watchlistRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const watchlists = await getUserWatchlists(client)

  // If the user has no watchlists yet, auto-create the default one.
  if (watchlists.length === 0) {
    const created = await ensureDefaultWatchlist(client, 'Default')
    return NextResponse.json({ watchlists: created ? [created] : [] })
  }

  return NextResponse.json({ watchlists })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  let name = 'Default'
  try {
    const body = await request.json()
    if (typeof body.name === 'string' && body.name.trim()) {
      name = body.name.trim().slice(0, 80)
    }
  } catch {
    // name stays as 'Default'
  }

  const created = await createWatchlist(client, name)
  if (!created) {
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ watchlist: created }, { status: 201 })
}
