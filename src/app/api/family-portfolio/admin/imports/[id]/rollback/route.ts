// R13.8B § 8 — POST /api/family-portfolio/admin/imports/[id]/rollback
//
// Reverses ONE IMPORT: every history point it inserted, every value it
// overwrote, and the publication it made current — together, or not at all.
//
// WHY THIS SITS BESIDE THE PUBLICATION ROLLBACK RATHER THAN REPLACING IT.
// `nmi_rollback_publication` is scoped to one `(kind, as_of_date)` series and
// never touches the evolution history. That is still the right operation for an
// alternatives publication, and for any portfolio publication made before this
// migration, which no import operation owns. It is the WRONG operation for a
// catch-up: a single upload can write five history points across three weeks,
// and moving one `is_current` pointer reverses none of them.
//
// ROLLBACK NEVER MATCHES ON A DATE OR A FILENAME. The caller names an import
// operation id; the database drives the reversal from that import's own
// before-image ledger.
//
// IT REFUSES RATHER THAN CLOBBERS. If a later import has already rewritten one
// of these rows, reversing to this import's before-image would silently discard
// the newer work — so the function raises instead. The refusal is reported here
// as a 409, not swallowed.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { rollbackPortfolioImport } from '@/lib/db/repositories/portfolioPublicationRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Refusals the administrator can act on, mapped to a status.
 *
 * Every one of these is a CONFLICT: the database looked at the book and declined
 * because reversing would have destroyed something. None is a server fault, and
 * none should read to an administrator as "try again".
 */
const REFUSAL_STATUS: Record<string, number> = {
  rollback_refused_import_not_found: 404,
  rollback_refused_already_rolled_back: 409,
  rollback_refused_superseded_by_later_import: 409,
  rollback_refused_publication_not_current: 409,
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!entitlement.isAdministrator || !entitlement.userId) {
    // Identical to every other non-administrator refusal: a caller learns
    // nothing about whether the import exists.
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

  const result = await rollbackPortfolioImport({
    importId: id,
    actorId: entitlement.userId,
    note,
  })

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

  return NextResponse.json(
    {
      importOperationId: id,
      // How much was undone. `removed` are the insertions (NEW and GAP_FILL
      // alike); `restored` are the overwrites put back to their before-image.
      observationsRemoved: Number(result.result.observationsRemoved ?? 0),
      observationsRestored: Number(result.result.observationsRestored ?? 0),
      // The publication that is current again, or null when this import created
      // the first publication for its week and nothing preceded it — in which
      // case the week simply stops being current, which is correct and is what
      // the partial unique index permits.
      promotedPublicationId:
        result.result.promotedPublicationId == null
          ? null
          : String(result.result.promotedPublicationId),
    },
    { headers: NO_STORE },
  )
}
