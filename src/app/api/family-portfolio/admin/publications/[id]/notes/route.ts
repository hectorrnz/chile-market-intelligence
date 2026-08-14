// R13.R2C §§ 8-12 — POST /api/family-portfolio/admin/publications/[id]/notes
//
// Creates ONE Weekly Note on a published week.
//
// WHY HERE. The route sits inside the already-administrator-only
// `/api/family-portfolio/admin/publications/[id]/` namespace, beside the
// commentary route it deliberately does NOT replace, so it adds no new
// entitlement surface. Authorization is established server-side on every call:
// the client's `canEditNotes` flag decides only whether a control is drawn.
//
// NOTES ARE NEVER GENERATED. There is no code path that writes
// `family_portfolio_weekly_notes` other than an administrator submission — not
// an AI summary, not a derivation from the week's figures, and nothing in the
// RESUMEN parse.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import {
  normalizeWeeklyNote,
  nextDisplayOrder,
  scopeHasWeeklyNotes,
  weeklyNoteFailureStatus,
} from '@/lib/familyPortfolio/weeklyNotes'
import { getPublication } from '@/lib/db/repositories/portfolioPublicationRepository'
import {
  createWeeklyNote,
  getWeeklyNotes,
} from '@/lib/db/repositories/familyPortfolioWeeklyNotesRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!entitlement.isAdministrator || !entitlement.userId) {
    return NextResponse.json({ error: 'not_authorized' }, { status: 403, headers: NO_STORE })
  }

  const { id } = await context.params
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await request.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE })
  }

  const scope = typeof body.scope === 'string' ? body.scope : ''
  // Two gates. `scopeHasWeeklyNotes` is the PRODUCT rule (§ 7 — Main only, and
  // notes are never invented for a personal scope to balance a layout);
  // `canReadScope` then rejects a scope the caller could not read at all.
  if (!scopeHasWeeklyNotes(scope) || !canReadScope(entitlement.input, scope)) {
    return NextResponse.json({ error: 'unknown_scope' }, { status: 422, headers: NO_STORE })
  }

  const normalized = normalizeWeeklyNote(body.body)
  if (!normalized.ok) {
    return NextResponse.json({ error: `note_${normalized.code}` }, { status: 422, headers: NO_STORE })
  }

  const publication = await getPublication(id)
  if (!publication) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  // A new note lands at the END of the list — one past the highest position in
  // use, never the array length, so a tombstoned note in the middle cannot make
  // it collide with a live one.
  const existing = await getWeeklyNotes(id, scope)
  const displayOrder = existing.ok ? nextDisplayOrder(existing.notes) : 0

  const written = await createWeeklyNote({
    publicationId: id,
    scope,
    body: normalized.body,
    displayOrder,
    author: entitlement.userId,
  })
  if (!written.ok) {
    // R13.R2 PASS 4 § 1 — `schema_missing` is reported AS ITSELF, at 503, so the
    // interface can say the notes schema has not been applied instead of a bare
    // "could not be saved". It is a service-state answer, not a client error:
    // nothing about the submission was wrong.
    return NextResponse.json(
      { error: written.code },
      { status: weeklyNoteFailureStatus(written.code), headers: NO_STORE },
    )
  }

  return NextResponse.json({ note: written.note }, { status: 201, headers: NO_STORE })
}
