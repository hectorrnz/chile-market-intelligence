// R13.5 — POST /api/family-portfolio/admin/publications/[id]/rollback
//
// Restores a retained revision as the current one (doc 05 §§ 5.1, 6, 7.4).
//
// ROLLBACK IS A POINTER MOVE, NEVER A DELETE. Both revisions keep every row they
// wrote; only `is_current` moves. That is what makes the operation reversible —
// a rollback can itself be rolled forward — and it is why the ledger can answer
// "what did we publish on the 6th, before the correction?" months later.
//
// The move is performed by a single Postgres function so the demote and the
// promote commit together. Doing them as two client calls would leave a window
// with NO current publication for that week, during which every reader would see
// an empty book.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { rollbackPublication, getPublication } from '@/lib/db/repositories/portfolioPublicationRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Refusals the caller can act on, mapped to a status. Anything else is a 500. */
const REFUSAL_STATUS: Record<string, number> = {
  rollback_refused_publication_not_found: 404,
  rollback_refused_already_current: 409,
  rollback_refused_no_current_publication: 409,
}

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

  let note: string | null = null
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object') {
      const raw = (body as Record<string, unknown>).note
      if (typeof raw === 'string' && raw.trim().length > 0) note = raw.trim()
    }
  } catch {
    // A rollback needs no body; the note is optional context, not a gate.
  }

  const result = await rollbackPublication({ targetId: id, actorId: entitlement.userId, note })
  if (!result.ok) {
    if (result.code === 'not_configured') {
      return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE })
    }
    const reason = result.code === 'rpc_failed' ? result.reason : result.code
    return NextResponse.json(
      { error: reason },
      { status: REFUSAL_STATUS[reason] ?? 500, headers: NO_STORE },
    )
  }

  const restored = await getPublication(result.id)
  return NextResponse.json(
    {
      publicationId: result.id,
      uploadKind: restored?.uploadKind ?? null,
      asOfDate: restored?.asOfDate ?? null,
      revision: restored?.revision ?? null,
      isCurrent: restored?.isCurrent ?? null,
    },
    { headers: NO_STORE },
  )
}
