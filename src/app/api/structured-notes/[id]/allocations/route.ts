// Phase 9A — POST /api/structured-notes/[id]/allocations
// Adds an internal entity/sociedad allocation. Allocations are internal data —
// they are NEVER extracted from a PDF term sheet.
//
// R7.1B — this route no longer treats "allocations must equal issue size" as a
// rule (see the response contract below). R7.1B.1 — custody is NOT part of an
// allocation: it is recorded once per note, because all of a note's accounts
// are traded through the same institution. This route only serves the
// suggestion list (GET) and writes account notionals (POST).

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { upsertAllocation, getStructuredNoteById, getKnownCustodians } from '@/lib/db/repositories/structuredNotesRepository'
import { calculateNevadaInvestmentNotional, classifyIssueSizePlausibility, nevadaInvestmentCurrency } from '@/lib/structuredNotes/calculations'
import { guardAdministrator, guardModuleRead } from '@/lib/auth/moduleApiGuard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The distinct custodians already recorded on notes across the book (suggestion list). */
export async function GET(): Promise<NextResponse> {
  const denied = await guardModuleRead('structured_notes')
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  return NextResponse.json({ custodians: await getKnownCustodians(client) })
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params

  let body: { entityName?: string; notionalAmount?: number; currency?: string; active?: boolean }
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

  // R7.1B.1 — an allocation carries an account and its notional only. Custody
  // is recorded once on the NOTE (all of a note's accounts trade through the
  // same custodian), so it is not part of this payload.
  const result = await upsertAllocation(client, id, {
    entityName: entityName.slice(0, 120),
    notionalAmount,
    currency: (body.currency ?? 'USD').slice(0, 8),
    active: body.active ?? true,
  })
  if (result !== 'ok') return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  // Response contract (R7.1B):
  //   nevadaInvestmentNotional — sum of this note's valid active account
  //                              allocations. The authoritative Nevada position.
  //   issueSize                — product metadata only (total issuance across
  //                              ALL investors). Never portfolio exposure.
  //   issueSizeComparison      — 'below' | 'equal' | 'review' | 'not_comparable'
  //                              (see classifyIssueSizePlausibility). Advisory.
  //   allocationTotal          — retained wire field, identical value to
  //                              nevadaInvestmentNotional (compatibility).
  //   allocationsMismatch      — retained wire field, but it no longer means
  //                              "differs from issue size" (they routinely and
  //                              legitimately differ). It is now true ONLY for
  //                              the review case — Nevada above a comparable
  //                              issue size — matching issueSizeComparison.
  const note = await getStructuredNoteById(client, id)
  const nevadaInvestmentNotional = note ? calculateNevadaInvestmentNotional(note.allocations) : null
  const issueSize = note?.issueSize ?? null
  // The Nevada side is expressed in its allocations' OWN currency; the issue
  // size in the note's. If the active allocations disagree on currency the two
  // are structurally incomparable — never silently converted, and never
  // compared anyway by falling back to the note currency. A note with no
  // active allocations has an UNKNOWN Nevada investment, not a zero one, so it
  // is passed as null rather than being reported as "below" the issue size.
  const activeAllocations = note?.allocations.filter((a) => a.active) ?? []
  const issueSizeComparison = classifyIssueSizePlausibility({
    nevadaInvestmentNotional: activeAllocations.length > 0 ? nevadaInvestmentNotional : null,
    nevadaCurrency: note ? nevadaInvestmentCurrency(note.allocations) : null,
    issueSize,
    issueSizeCurrency: note?.currency ?? null,
  })
  return NextResponse.json(
    {
      ok: true,
      nevadaInvestmentNotional,
      allocationTotal: nevadaInvestmentNotional,
      issueSize,
      issueSizeComparison,
      allocationsMismatch: issueSizeComparison === 'review',
    },
    { status: 201 },
  )
}
