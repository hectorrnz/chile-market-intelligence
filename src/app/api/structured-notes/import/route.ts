// Phase 9A — POST /api/structured-notes/import
// Persists a reviewed extraction payload as a real note. Validates critical
// fields server-side before writing (an invalid extraction is never persisted).

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { importStructuredNote } from '@/lib/db/repositories/structuredNotesRepository'
import type { StructuredNote } from '@/lib/structuredNotes/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Re-validates the critical fields server-side; the client cannot bypass this. */
function validateNote(note: StructuredNote): string[] {
  const errors: string[] = []
  if (!note.isin) errors.push('missing ISIN')
  if (!note.issuerName && !note.issuerDisplayName) errors.push('missing issuer')
  if (!note.tradeDate) errors.push('missing trade date')
  if (!note.maturityDate) errors.push('missing maturity date')
  if (!Array.isArray(note.underlyings) || note.underlyings.length === 0) errors.push('missing underlyings')
  if (note.knockInBarrierPct === null || note.knockInBarrierPct === undefined) errors.push('missing barriers')
  if (note.couponRatePeriodic === null && note.couponRateAnnualized === null) errors.push('missing coupon rate')
  if (!Array.isArray(note.observations) || note.observations.length === 0) errors.push('missing observation schedule')
  return errors
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  let body: { note?: StructuredNote; extractionRunId?: string | null; sourceFileHash?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const note = body.note
  if (!note || typeof note !== 'object') return NextResponse.json({ error: 'missing_note' }, { status: 400 })

  const errors = validateNote(note)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'validation_failed', errors }, { status: 422 })
  }

  const result = await importStructuredNote(client, note, {
    extractionRunId: body.extractionRunId ?? null,
    sourceFileHash: body.sourceFileHash ?? null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: 'import_failed', detail: result.error }, { status: 500 })
  }
  return NextResponse.json({ noteId: result.noteId }, { status: 201 })
}
