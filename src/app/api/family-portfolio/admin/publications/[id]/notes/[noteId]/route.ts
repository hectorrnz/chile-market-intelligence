// R13.R2C §§ 8-12 — PATCH / DELETE
// /api/family-portfolio/admin/publications/[id]/notes/[noteId]
//
// Edits or withdraws ONE Weekly Note, BY ITS OWN IDENTITY. That is the whole
// point of the separate table: a note has an id, so editing or deleting it can
// never disturb a sibling (§ 33).
//
// DELETE IS A TOMBSTONE (§ 11). The row is stamped `deleted_at`/`deleted_by` and
// then falls out of the RLS read predicate. Ordinary members never see it; the
// record that a note existed and was withdrawn survives for audit. Nothing here
// removes a row.
//
// Authorization is established server-side on every call, exactly as the sibling
// create route does.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { normalizeWeeklyNote, weeklyNoteFailureStatus } from '@/lib/familyPortfolio/weeklyNotes'
import {
  deleteWeeklyNote,
  updateWeeklyNote,
} from '@/lib/db/repositories/familyPortfolioWeeklyNotesRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireAdministrator(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const denied = await guardPrivateApi()
  if (denied) return { ok: false, response: denied as NextResponse }
  const entitlement = await getFamilyPortfolioEntitlement()
  if (!entitlement.isAdministrator || !entitlement.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'not_authorized' }, { status: 403, headers: NO_STORE }),
    }
  }
  return { ok: true, userId: entitlement.userId }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; noteId: string }> },
) {
  const auth = await requireAdministrator()
  if (!auth.ok) return auth.response

  const { id, noteId } = await context.params
  if (!UUID.test(id) || !UUID.test(noteId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await request.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE })
  }

  const normalized = normalizeWeeklyNote(body.body)
  if (!normalized.ok) {
    return NextResponse.json({ error: `note_${normalized.code}` }, { status: 422, headers: NO_STORE })
  }

  const written = await updateWeeklyNote({
    id: noteId,
    body: normalized.body,
    author: auth.userId,
  })
  if (!written.ok) {
    // `not_found` covers both "no such note" and "already withdrawn" — a
    // tombstone must not be editable back into existence. `schema_missing`
    // answers 503 through the shared mapper (R13.R2 pass 4 § 1).
    return NextResponse.json(
      { error: written.code },
      { status: weeklyNoteFailureStatus(written.code), headers: NO_STORE },
    )
  }

  return NextResponse.json({ note: written.note }, { headers: NO_STORE })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; noteId: string }> },
) {
  const auth = await requireAdministrator()
  if (!auth.ok) return auth.response

  const { id, noteId } = await context.params
  if (!UUID.test(id) || !UUID.test(noteId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  const removed = await deleteWeeklyNote({ id: noteId, author: auth.userId })
  if (!removed.ok) {
    return NextResponse.json(
      { error: removed.code },
      { status: weeklyNoteFailureStatus(removed.code), headers: NO_STORE },
    )
  }

  return NextResponse.json({ deleted: noteId }, { headers: NO_STORE })
}
