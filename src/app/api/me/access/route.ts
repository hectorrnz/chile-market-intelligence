// POST-R13.6CDE — GET /api/me/access
//
// The caller's OWN effective access, resolved server-side once per app load and
// shared by the shell: navigation, Overview composition and the Settings entry
// all read this instead of each guessing separately.
//
// SELF ONLY. There is no user parameter and there never will be — this route
// answers "what may I reach", never "what may they reach". Reading another
// account's entitlement is the Users & Access console's job, and that is
// administrator-gated separately. Both reads here go through the USER-SESSION
// client, so own-row RLS authorises them and the service-role client is never
// touched on this path.
//
// PRESENTATION, NEVER PROTECTION. The response drives what the browser draws.
// It authorises nothing: every other route re-derives its own answer from the
// database per request, with PostgreSQL RLS underneath. A caller who fabricated
// this payload would change their own chrome and reach no additional data.
//
// UNAVAILABLE IS NOT DENIED. When the entitlement store cannot be read the
// status is `unavailable`, not an empty module list. An empty list would tell an
// administrator they had lost every module, when the truth is that this
// deployment's database is behind its code — the exact confusion that made the
// reported Structured Notes failure unreadable.

import { NextResponse } from 'next/server'
import { getCallerModuleAccess, isAccessUnavailable } from '@/lib/auth/getModuleAccess'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { modulesFor } from '@/lib/auth/moduleAccess'
import { portfolioVisibleScopes } from '@/lib/portfolioAccess/portfolioModuleComposition'
import { isPortfolioPrincipal } from '@/lib/portfolioAccess/entitlements'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import type { EffectiveAccess } from '@/lib/auth/effectiveAccess'

export const dynamic = 'force-dynamic'

const EMPTY: Omit<EffectiveAccess, 'status'> = {
  isApproved: false,
  isAdministrator: false,
  modules: [],
  portfolioScopes: [],
  principal: null,
}

export async function GET(): Promise<NextResponse> {
  const resolved = await getCallerModuleAccess()

  // Degraded deployment: say so. Never a denial, never an empty grant set.
  if (isAccessUnavailable(resolved.reason)) {
    return NextResponse.json({ ...EMPTY, status: 'unavailable' }, { headers: NO_STORE_HEADERS })
  }
  // No session or no approved profile. 200 with an honest empty body rather than
  // 401: the shell asks this on every load, including on public pages, and a
  // stream of 401s in the console would be noise, not signal.
  if (resolved.reason !== 'ok' || !resolved.access.isApproved) {
    return NextResponse.json({ ...EMPTY, status: 'unauthenticated' }, { headers: NO_STORE_HEADERS })
  }

  // The Portfolio ceiling comes from the frozen entitlement resolver, and the
  // module mask is applied ABOVE it by `portfolioVisibleScopes`. Intersection
  // can only narrow, so no combination of grants reaches a sibling's portfolio.
  const entitlement = await getFamilyPortfolioEntitlement()

  const body: EffectiveAccess = {
    status: 'ok',
    isApproved: true,
    isAdministrator: resolved.isAdministrator,
    modules: modulesFor(resolved.access),
    portfolioScopes: portfolioVisibleScopes(entitlement.input, resolved.access),
    // Narrowed through the canonical guard: the stored column is free text, and
    // an unrecognised value must present as "no principal", never as itself.
    principal: isPortfolioPrincipal(entitlement.input.principal) ? entitlement.input.principal : null,
  }
  return NextResponse.json(body, { headers: NO_STORE_HEADERS })
}
