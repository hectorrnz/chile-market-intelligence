// R13.6 — GET /api/family-portfolio/[scope]/snapshot?asOf=YYYY-MM-DD
//
// The four-dated-column hierarchical view of one entitled portfolio scope for
// one published week (doc 05 § 7.4, doc 07 § 7.2). `asOf` selects a historical
// week; omitted, the latest published week is served.
//
// AUTHORIZATION ORDER: approved session → explicit `canReadScope` → database.
// A denial carries nothing, not even whether the week exists. The scope segment
// and `asOf` are untrusted input: the scope must be one of the four portfolio
// scopes (the shared Alternatives experience is its own Stage-9 surface and has
// no snapshot here), and `asOf` must exactly match a CURRENT published week —
// anything else is `week_not_found`, never a nearest-match guess.
//
// TWO CLIENTS, BY DESIGN (see familyPortfolioReadRepository.ts): the current-
// publication spine is resolved service-role AFTER the entitlement check
// (operational metadata only), and the rows themselves are read through the
// caller's OWN session so RLS independently enforces the scope. Only current
// publications are readable; draft uploads and superseded revisions never
// reach this route.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import { selectPublicationWeek } from '@/lib/familyPortfolio/memberRead'
import {
  listCurrentPublications,
  getSnapshotRowsForScope,
} from '@/lib/db/repositories/familyPortfolioReadRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const PORTFOLIO_SCOPES = new Set(['main', 'jaime', 'andres', 'pablo'])

function fail(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE })
}

export async function GET(request: Request, context: { params: Promise<{ scope: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const { scope } = await context.params

  const entitlement = await getFamilyPortfolioEntitlement()
  // The entitlement decision comes FIRST, so an unentitled caller learns
  // nothing — not even that this endpoint only serves portfolio scopes.
  if (!canReadScope(entitlement.input, scope)) return fail('not_authorized', 403)
  if (!PORTFOLIO_SCOPES.has(scope)) return fail('not_found', 404)

  const spine = await listCurrentPublications('portfolio')
  if (!spine.ok) {
    return fail(spine.code, spine.code === 'not_configured' ? 503 : 502)
  }

  const weeks = spine.publications.map((p) => ({
    asOfDate: p.asOfDate,
    revision: p.revision,
    publishedAt: p.publishedAt,
  }))

  // Honest empty state: no week has ever been published.
  if (spine.publications.length === 0) {
    return NextResponse.json({ scope, weeks, snapshot: null }, { headers: NO_STORE })
  }

  const url = new URL(request.url)
  const asOf = url.searchParams.get('asOf')
  // Exact-match-or-refuse; latest by the dates themselves. The rule lives in
  // the pure module so its historical-week semantics are unit-tested.
  const selection = selectPublicationWeek(spine.publications, asOf)
  if (!selection.ok) return fail('week_not_found', 404)
  const selected = selection.selected

  const rows = await getSnapshotRowsForScope(selected.id, scope)
  if (!rows.ok) {
    return fail(rows.code, rows.code === 'not_configured' ? 503 : 502)
  }

  return NextResponse.json(
    {
      scope,
      weeks,
      snapshot: {
        asOfDate: selected.asOfDate,
        revision: selected.revision,
        publishedAt: selected.publishedAt,
        parserVersion: selected.parserVersion,
        dates: {
          beginningOfYear: selected.beginningOfYearDate,
          previousWeek: selected.previousWeekDate,
          thisWeek: selected.asOfDate,
        },
        rows: rows.rows,
      },
    },
    { headers: NO_STORE },
  )
}
