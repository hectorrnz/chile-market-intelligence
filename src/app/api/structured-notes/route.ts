// Phase 9A/9B — GET /api/structured-notes
// Returns the shared book of structured notes plus live per-note metrics and a
// book-level dashboard summary (live count, in/out of the money, about to
// autocall, issuer exposure).
//
// READ REQUIRES THE `structured_notes` MODULE (POST-R13.6B.1). Middleware
// enforces authentication; `guardModuleReadWithCapability` enforces the module
// grant; and RLS (`nmi_can_access_module`) is the authoritative boundary. A
// granted member reads the book but may not change it — every mutation route
// is administrator-only.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { listStructuredNotes } from '@/lib/db/repositories/structuredNotesRepository'
import { fetchYahooPriceMap } from '@/lib/structuredNotes/structuredNoteMarketProvider'
import { buildBookDashboard } from '@/lib/structuredNotes/dashboard'
import { guardModuleReadWithCapability } from '@/lib/auth/moduleApiGuard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const { denied, canManage } = await guardModuleReadWithCapability('structured_notes')
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const notes = await listStructuredNotes(client)

  // One batched Yahoo call for every underlying symbol across the whole book.
  const symbols = notes.flatMap((n) => n.underlyings.map((u) => u.yahooSymbol).filter((s): s is string => !!s))
  const { prices, asOf } = symbols.length > 0 ? await fetchYahooPriceMap(symbols) : { prices: new Map<string, number>(), asOf: null }

  const today = new Date().toISOString().slice(0, 10)
  const { metrics, summary } = buildBookDashboard(notes, prices, asOf, today)

  // `canManage` drives whether the page offers create/edit/delete controls.
  // It is a courtesy for the UI, never the boundary: every mutation route
  // re-checks administrator status and RLS refuses the write regardless.
  return NextResponse.json({ notes, metrics, summary, canManage })
}
