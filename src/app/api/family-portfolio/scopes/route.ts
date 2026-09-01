// R13.6 — GET /api/family-portfolio/scopes
//
// The ONLY source the module shell and every member page have for "which
// scopes may I see" (doc 05 § 7.4). It returns the CALLER'S scopes and nothing
// else — an unentitled scope is omitted entirely, never returned-and-hidden
// (doc 05 § 2.1, risk R2).
//
// SCOPE DISPLAY LABELS ARE SERVER-SUPPLIED, deliberately. Putting the four
// principal display names in `i18n.ts` would ship every family member's name
// in the client bundle of every user; doc 07 § 7 requires that for Jaime,
// "Andrés's and Pablo's names never reach the browser". Here each caller
// receives only the labels of scopes they hold.
//
// `admin` is a capability, not a data scope: it is surfaced as the
// `isAdministrator` flag (which drives the Admin navigation item), never as a
// selectable portfolio scope.
//
// POST-R13.6CDE — MODULE COMPOSITION. The returned set is now the frozen
// principal ceiling INTERSECTED with the caller's module grants
// (`portfolioVisibleScopes`), so revoking `portfolio` or `alternatives` removes
// the corresponding sub-navigation and scope selector wherever this route feeds
// them — which is everywhere in the module shell.
//
// Composition can only ever NARROW. `scopesFor()` is unchanged and still runs
// first; intersection cannot produce a scope the ceiling did not contain, so no
// grant configuration reaches a sibling's personal portfolio. Every downstream
// route re-checks its own scope server-side regardless of what this returns.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { getCallerModuleAccess } from '@/lib/auth/getModuleAccess'
import { portfolioVisibleScopes } from '@/lib/portfolioAccess/portfolioModuleComposition'
import type { FamilyPortfolioScope } from '@/lib/portfolioAccess/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * Server-side only — see the module header. `Main`/`Alternatives` are module
 * labels; the three personal scopes display their principal's name in both
 * languages (a proper name is not translated).
 */
const SCOPE_LABELS: Partial<Record<FamilyPortfolioScope, { en: string; es: string }>> = {
  main: { en: 'Main', es: 'Principal' },
  jaime: { en: 'Jaime', es: 'Jaime' },
  andres: { en: 'Andrés', es: 'Andrés' },
  pablo: { en: 'Pablo', es: 'Pablo' },
  alternatives: { en: 'Alternatives', es: 'Alternativos' },
}

export async function GET() {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  const { access } = await getCallerModuleAccess()

  const scopes = portfolioVisibleScopes(entitlement.input, access)
    .filter((s) => s !== 'admin')
    .map((s) => {
      const label = SCOPE_LABELS[s]
      return { id: s, labelEn: label?.en ?? s, labelEs: label?.es ?? s }
    })

  return NextResponse.json(
    { scopes, isAdministrator: entitlement.isAdministrator },
    { headers: NO_STORE },
  )
}
