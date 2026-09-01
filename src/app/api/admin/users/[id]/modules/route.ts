// POST-R13.6CDE — PUT /api/admin/users/[id]/modules
//
// Sets a member's module grants. ADMINISTRATOR ONLY.
//
// THE BODY IS THE COMPLETE DESIRED SET, not a delta: `{ modules: ModuleKey[] }`.
// The console renders checkboxes, and a checkbox grid IS a complete set — sending
// deltas from a UI that shows totals invites the two to drift apart whenever a
// save is retried or two tabs are open. The server diffs against what is stored
// and writes only the difference, so a repeated save is a no-op rather than a
// duplicate-key error.
//
// A CHECKED BOX MEANS A ROW EXISTS. There is no tri-state, no inheritance, and
// no runtime fallback to `app_modules.default_for_member` — that column is
// PROVISIONING metadata, the state a new invitation starts from, and
// `moduleAccess.ts` deliberately never reads it. So the grid is a faithful
// picture of `user_module_grants` and nothing else.
//
// AUTHORIZATION BEFORE ANY TARGET READ. `guardAdministrator()` resolves the
// CALLER through the user-session client and returns before the target id is
// used for anything. Only then does the service-role client appear — necessary
// because `user_module_grants` has no administrator policy for any verb (see the
// GET route's header for why that is correct, and why this layer must therefore
// be the boundary).
//
// WHY NOT AN RPC. A `security definer` function checking `nmi_is_administrator()`
// would put this boundary in the database, which would be stronger. It is the
// right next step and is recorded as such — but it is a new SQL surface with its
// own postconditions and pgTAP, and this stage cannot execute either against a
// real database. Shipping an untested database writer would be worse than
// shipping a tested application one behind the same pure decision layer.

import { NextResponse } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getCallerModuleAccess } from '@/lib/auth/getModuleAccess'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { decideGrantChange, buildGrantAuditEntries } from '@/lib/admin/userDirectory'
// The target's profile is read through this helper, not here. See its header:
// `tests/accessControl.test.ts` bars any file naming `user_profiles` from also
// containing a write verb, and this file writes grants. Splitting satisfies that
// rule honestly rather than relaxing it.
import { readAdminTargetFacts } from '@/lib/admin/adminUserReads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Denials the caller may act on; everything else is a generic failure. */
const DENIAL_STATUS: Record<string, number> = {
  actor_not_administrator: 403,
  invalid_target: 400,
  invalid_module: 400,
  target_not_found: 404,
  target_not_approved: 409,
  target_is_administrator: 409,
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const { userId: actorUserId, access: actorAccess, isAdministrator } = await getCallerModuleAccess()
  const admin = getSupabaseAdminClient()
  if (!admin || !actorUserId) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE_HEADERS })
  }

  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { modules?: unknown } | null

  // Target facts, read only after the actor cleared the guard above.
  const target = await readAdminTargetFacts(admin, id)
  if (target.readFailed) {
    return NextResponse.json({ error: 'read_failed' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const decision = decideGrantChange({
    actor: {
      userId: actorUserId,
      isApproved: actorAccess.isApproved,
      isAdministrator,
    },
    targetUserId: id,
    targetExists: target.exists,
    targetIsApproved: target.isApproved,
    targetIsAdministrator: target.isAdministrator,
    requestedModules: body?.modules,
    currentModules: target.currentModules,
  })

  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.code },
      { status: DENIAL_STATUS[decision.code] ?? 400, headers: NO_STORE_HEADERS },
    )
  }

  // Nothing to do. Answer success without writing a row or an audit entry — a
  // trail that records non-events is one nobody trusts when it matters.
  if (!decision.changed) {
    return NextResponse.json({ ok: true, changed: false }, { headers: NO_STORE_HEADERS })
  }

  const mut = admin as never as {
    from: (t: string) => {
      insert: (rows: unknown[]) => Promise<{ error: unknown }>
      delete: () => {
        eq: (c: string, v: string) => { in: (c: string, v: string[]) => Promise<{ error: unknown }> }
      }
    }
  }

  if (decision.toGrant.length > 0) {
    const res = await mut.from('user_module_grants').insert(
      decision.toGrant.map((module_key) => ({
        user_id: decision.targetUserId,
        module_key,
        granted_by: actorUserId,
      })),
    )
    if (res.error) {
      return NextResponse.json({ error: 'write_failed' }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  if (decision.toRevoke.length > 0) {
    const res = await mut
      .from('user_module_grants')
      .delete()
      .eq('user_id', decision.targetUserId)
      .in('module_key', decision.toRevoke)
    if (res.error) {
      return NextResponse.json({ error: 'write_failed' }, { status: 500, headers: NO_STORE_HEADERS })
    }
  }

  // Audit LAST, and never fatally. The grants are the authoritative state and
  // they are already correct; failing the request now would tell the
  // administrator their change did not happen when it did, and a retry would
  // then find nothing to change. The failure is surfaced honestly instead.
  const entries = buildGrantAuditEntries(decision, actorUserId)
  let audited = true
  if (entries.length > 0) {
    const res = await mut.from('family_portfolio_access_audit').insert(entries)
    if (res.error) audited = false
  }

  return NextResponse.json({ ok: true, changed: true, audited }, { headers: NO_STORE_HEADERS })
}
