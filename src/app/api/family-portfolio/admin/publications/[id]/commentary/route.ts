// R13.5 — POST /api/family-portfolio/admin/publications/[id]/commentary
//
// Administrator commentary on a published scope (doc 05 § 5.6, doc 08 Stage 5).
//
// WHY THIS ROUTE EXISTS. Doc 05 § 7.4's binding table fixes the MODULE's route
// architecture and entitlement boundaries; it does not enumerate every
// administrative sub-action, and it predates commentary being scheduled. Doc 08
// Stage 5 names "administrator commentary (optional, audited revisions)" as a
// deliverable, and a deliverable with no reachable write path is the same defect
// class as the R13.1 role deadlock — a column nothing could ever write. The
// route therefore sits inside the already-administrator-only
// `/api/family-portfolio/admin/publications/[id]/` namespace and adds no new
// entitlement surface.
//
// COMMENTARY IS NEVER GENERATED. There is no code path that writes
// `portfolio_commentary` other than this administrator submission — not an AI
// summary, not a derivation from price movements. Editing appends a new revision
// and supersedes the previous one, so what was said at publication time survives
// every later edit.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import { normalizeCommentary } from '@/lib/familyPortfolio/publication'
import { upsertCommentary, getPublication } from '@/lib/db/repositories/portfolioPublicationRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mirrors the CHECK on `portfolio_commentary.scope`. `admin` is not a data scope. */
const COMMENTABLE_SCOPES: readonly string[] = ['main', 'jaime', 'andres', 'pablo', 'alternatives']

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

  const scope = body.scope
  // Two gates, both required. `COMMENTABLE_SCOPES` is the set the table's CHECK
  // constraint accepts — `admin` is a capability scope, not a portfolio one, and
  // nothing is published under it. `canReadScope` then rejects a scope the
  // caller could not read; an administrator passes it for all five, so in
  // practice this catches a typo before it becomes an opaque 500.
  if (!COMMENTABLE_SCOPES.includes(scope as string) || !canReadScope(entitlement.input, scope)) {
    return NextResponse.json({ error: 'unknown_scope' }, { status: 422, headers: NO_STORE })
  }

  const normalized = normalizeCommentary(body.body)
  if (!normalized.ok) {
    return NextResponse.json({ error: `commentary_${normalized.code}` }, { status: 422, headers: NO_STORE })
  }

  const publication = await getPublication(id)
  if (!publication) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  const written = await upsertCommentary({
    publicationId: id,
    scope: scope as string,
    body: normalized.body,
    author: entitlement.userId,
  })
  if (!written.ok) {
    if (written.code === 'not_configured') {
      return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE })
    }
    const reason = written.code === 'rpc_failed' ? written.reason : written.code
    return NextResponse.json({ error: reason }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json(
    { commentaryId: written.id, publicationId: id, scope },
    { status: 201, headers: NO_STORE },
  )
}
