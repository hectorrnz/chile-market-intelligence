// R13.9 — GET /api/family-portfolio/alternatives
//
// The shared Alternatives surface (doc 07 § 7.4, doc 08 Stage 9): the CURRENT
// alternatives publication's holdings grouped by `(category, currency)`, its
// event timeline, and its OWN as-of stamp — independent of the portfolio's
// (doc 03 § 1), which is why this route never touches Upload A's spine.
//
// AUTHORIZATION ORDER: approved session → entitlement → explicit
// `canReadScope('alternatives')` → database. The identical ladder to every
// other member read; a denial carries nothing. Alternatives is the SHARED
// scope — every entitled principal and the administrator hold it (doc 05
// § 2.3) — but an approved account with a null principal holds no scope and is
// refused here AND by RLS.
//
// CLIENT DISCIPLINE (unchanged): the publication SPINE via the service-role
// client AFTER the entitlement decision — operational metadata only — and
// every holding and event row via the CALLER'S OWN session, so the R13.4
// `nmi_can_access_scope` policies re-derive entitlement independently.
//
// CURRENT PUBLICATION ONLY. `listCurrentPublications('alternatives')` is
// `is_current`-filtered, so drafts never appear (they are not publications)
// and superseded or rolled-back revisions are invisible. There is no
// nearest-date fallback and no historical selector — doc 07 § 7.4 defines a
// single current Alternatives view with its own as-of.
//
// FINANCIAL SEMANTICS LIVE IN THE PURE MODULE. Groups and per-currency
// subtotals are computed here by `alternativesView.ts` — the same functions
// the page re-runs when a filter narrows the view — and NO cross-currency
// total exists anywhere in the payload (doc 03 § 4.2, decision D4).

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canReadScope } from '@/lib/portfolioAccess/entitlements'
import {
  groupHoldings,
  summarizeEvents,
} from '@/lib/familyPortfolio/alternativesView'
import {
  listCurrentPublications,
  getAlternativesHoldings,
  getAlternativesEvents,
} from '@/lib/db/repositories/familyPortfolioReadRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function fail(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: NO_STORE })
}

export async function GET() {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!canReadScope(entitlement.input, 'alternatives')) return fail('not_authorized', 403)

  // --- Publication spine (operational metadata only, after entitlement).
  const spine = await listCurrentPublications('alternatives')
  if (!spine.ok) return fail(spine.code, spine.code === 'not_configured' ? 503 : 502)

  // Newest current publication. The list is already newest-first.
  const current = spine.publications[0] ?? null
  if (current === null) {
    return NextResponse.json({ state: 'no_publication', publication: null }, { headers: NO_STORE })
  }

  const publication = {
    id: current.id,
    asOfDate: current.asOfDate,
    revision: current.revision,
    publishedAt: current.publishedAt,
    parserVersion: current.parserVersion,
  }

  // --- Financial rows: the caller's own session, RLS is the authority.
  const [holdingsResult, eventsResult] = await Promise.all([
    getAlternativesHoldings(current.id),
    getAlternativesEvents(current.id),
  ])
  if (!holdingsResult.ok) {
    return fail(holdingsResult.code, holdingsResult.code === 'not_configured' ? 503 : 502)
  }
  if (!eventsResult.ok) {
    return fail(eventsResult.code, eventsResult.code === 'not_configured' ? 503 : 502)
  }

  if (holdingsResult.holdings.length === 0) {
    return NextResponse.json({ state: 'empty', publication }, { headers: NO_STORE })
  }

  const holdings = holdingsResult.holdings
  const events = eventsResult.events

  return NextResponse.json(
    {
      state: 'ok',
      publication,
      holdings,
      events,
      /** Per-(category, currency) groups — NEVER a cross-currency total. */
      groups: groupHoldings(holdings),
      eventSummary: summarizeEvents(events),
    },
    { headers: NO_STORE },
  )
}
