// Phase 9A — POST /api/structured-notes/[id]/allocations
// Adds an internal entity/sociedad allocation. Allocations are internal data —
// they are NEVER extracted from a PDF term sheet.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { upsertAllocation, getStructuredNoteById } from '@/lib/db/repositories/structuredNotesRepository'
import { calculateAllocationTotal } from '@/lib/structuredNotes/calculations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params

  let body: { entityName?: string; custodian?: string; notionalAmount?: number; currency?: string; active?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const entityName = (body.entityName ?? '').trim()
  const notionalAmount = Number(body.notionalAmount)
  if (!entityName) return NextResponse.json({ error: 'missing_entity' }, { status: 400 })
  // notional 0 is allowed here — it clears the entity's allocation (upsert-by-entity).
  if (!Number.isFinite(notionalAmount) || notionalAmount < 0) return NextResponse.json({ error: 'invalid_notional' }, { status: 400 })

  const ok = await upsertAllocation(client, id, {
    entityName: entityName.slice(0, 120),
    custodian: body.custodian?.slice(0, 120) ?? null,
    notionalAmount,
    currency: (body.currency ?? 'USD').slice(0, 8),
    active: body.active ?? true,
  })
  if (!ok) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  // Return the updated allocation total + a warning if it doesn't match issue size.
  const note = await getStructuredNoteById(client, id)
  const allocationTotal = note ? calculateAllocationTotal(note.allocations) : null
  const issueSize = note?.issueSize ?? null
  const mismatch = allocationTotal !== null && issueSize !== null && Math.abs(allocationTotal - issueSize) > 0.01
  return NextResponse.json(
    { ok: true, allocationTotal, issueSize, allocationsMismatch: mismatch },
    { status: 201 },
  )
}
