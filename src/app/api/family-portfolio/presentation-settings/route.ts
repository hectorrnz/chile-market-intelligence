// R13.R2 §§ 14-15 — GET/PUT /api/family-portfolio/presentation-settings
//
// The GLOBAL Asset Allocation presentation configuration: what an administrator
// approves is what every authorized member sees.
//
// AUTHORIZATION ORDER, unchanged from every other module route: approved
// session → entitlement → shape check → database.
//   * GET  — any caller holding at least one Family Portfolio scope.
//   * PUT  — `canAdminister` only, AND the RLS write policy independently. A
//            member's PUT is refused here at 403 and would be refused again by
//            PostgreSQL if it somehow arrived; neither layer is load-bearing
//            alone.
//
// THIS ROUTE CARRIES NO FINANCIAL DATA. It reads and writes six enum fields.
// It never touches a publication, a snapshot row or a performance row, so it
// cannot become a side channel into portfolio values — and it is deliberately
// NOT placed under `/admin/`, because members must be able to READ it.
//
// THE PAYLOAD IS CLOSED. `validateAllocationSettings` rejects anything outside
// the approved enum members and names the offending fields; unknown extra
// properties are dropped rather than stored, so no free-form style can reach
// the database even before the CHECK constraints see it.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { canAdminister, scopesFor } from '@/lib/portfolioAccess/entitlements'
import { validateAllocationSettings } from '@/lib/familyPortfolio/allocationSettings'
import {
  getPresentationSettings,
  updatePresentationSettings,
} from '@/lib/db/repositories/familyPortfolioSettingsRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET() {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  // A caller with no Family Portfolio scope sees no allocation chart, so it has
  // no presentation to configure and learns nothing here.
  if (scopesFor(entitlement.input).length === 0) {
    return NextResponse.json({ error: 'not_authorized' }, { status: 403, headers: NO_STORE })
  }

  const read = await getPresentationSettings()
  return NextResponse.json(
    {
      settings: read.settings,
      updatedAt: read.updatedAt,
      persisted: read.persisted,
      // Presentation convenience ONLY — the PUT below re-derives this
      // server-side and the database re-derives it again. A client that flips
      // this flag changes what its own browser draws and nothing else.
      canEdit: canAdminister(entitlement.input),
    },
    { headers: NO_STORE },
  )
}

export async function PUT(request: Request) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!canAdminister(entitlement.input) || !entitlement.userId) {
    return NextResponse.json({ error: 'not_authorized' }, { status: 403, headers: NO_STORE })
  }

  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE })
  }

  const validation = validateAllocationSettings(parsed)
  if (!validation.ok) {
    // The offending FIELD NAMES are returned so an administrator can correct
    // the request; no submitted value is echoed back.
    return NextResponse.json(
      { error: 'invalid_settings', invalidFields: validation.invalidFields },
      { status: 400, headers: NO_STORE },
    )
  }

  const written = await updatePresentationSettings(validation.settings, entitlement.userId)
  if (!written.ok) {
    const status =
      written.code === 'not_configured' ? 503 : written.code === 'not_authorized' ? 403 : 502
    return NextResponse.json({ error: written.code }, { status, headers: NO_STORE })
  }

  return NextResponse.json(
    { settings: written.settings, updatedAt: written.updatedAt, persisted: true, canEdit: true },
    { headers: NO_STORE },
  )
}
