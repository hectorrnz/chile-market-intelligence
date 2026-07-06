// Phase 9A/9B — GET /api/structured-notes
// Returns the shared book of structured notes plus live per-note metrics and a
// book-level dashboard summary (live count, in/out of the money, about to
// autocall, issuer exposure). Middleware enforces auth.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { listStructuredNotes } from '@/lib/db/repositories/structuredNotesRepository'
import { fetchYahooPriceMap } from '@/lib/structuredNotes/structuredNoteMarketProvider'
import { buildBookDashboard } from '@/lib/structuredNotes/dashboard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const notes = await listStructuredNotes(client)

  // One batched Yahoo call for every underlying symbol across the whole book.
  const symbols = notes.flatMap((n) => n.underlyings.map((u) => u.yahooSymbol).filter((s): s is string => !!s))
  const { prices, asOf } = symbols.length > 0 ? await fetchYahooPriceMap(symbols) : { prices: new Map<string, number>(), asOf: null }

  const today = new Date().toISOString().slice(0, 10)
  const { metrics, summary } = buildBookDashboard(notes, prices, asOf, today)

  return NextResponse.json({ notes, metrics, summary })
}
