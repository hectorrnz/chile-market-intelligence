// Phase 9A — GET /api/structured-notes  List the current user's structured notes.
// Middleware enforces auth: unauthenticated requests never reach this handler.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { listStructuredNotes } from '@/lib/db/repositories/structuredNotesRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const notes = await listStructuredNotes(client)
  return NextResponse.json({ notes })
}
