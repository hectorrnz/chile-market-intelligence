// R13.6 — GET /api/family-portfolio/[scope]/weeks
//
// The published-week list for one entitled scope (doc 05 § 7.4) — dates,
// revisions and publication timestamps only, no financial content.
//
// AUTHORIZATION ORDER IS DELIBERATE: approved session first, then the explicit
// `canReadScope` decision, and only then any database read. An unentitled or
// unknown scope gets a 403 carrying nothing — not even whether publications
// exist. The scope segment is treated as untrusted input throughout
// (`canReadScope` denies non-scope strings by construction).

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import { listCurrentPublications } from '@/lib/db/repositories/familyPortfolioReadRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function fail(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE })
}

export async function GET(_request: Request, context: { params: Promise<{ scope: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const { scope } = await context.params

  const entitlement = await getFamilyPortfolioEntitlement()
  if (scope === 'admin' || !canReadScope(entitlement.input, scope)) {
    return fail('not_authorized', 403)
  }

  // Portfolio scopes share the RESUMEN publication series; the shared
  // Alternatives scope has its own independent lifecycle (doc 05 § 6).
  const kind = scope === 'alternatives' ? 'alternatives' : 'portfolio'

  const result = await listCurrentPublications(kind)
  if (!result.ok) {
    return fail(result.code, result.code === 'not_configured' ? 503 : 502)
  }

  return NextResponse.json(
    {
      scope,
      weeks: result.publications.map((p) => ({
        asOfDate: p.asOfDate,
        revision: p.revision,
        publishedAt: p.publishedAt,
      })),
    },
    { headers: NO_STORE },
  )
}
