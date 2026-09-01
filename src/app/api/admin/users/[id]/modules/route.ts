// PUT /api/admin/users/[id]/modules — change ONE account's module grants.
//
// R13.6F REWROTE THE WRITE PATH. The endpoint, its request shape and its refusal
// codes are unchanged; what changed is that the writes are no longer three
// independent statements from a service-role client.
//
// WHAT WAS WRONG BEFORE
// ─────────────────────
// The previous implementation issued an INSERT for newly granted modules, a DELETE
// for revoked ones, and then an INSERT of the audit rows — three separate
// round-trips with no transaction around them. Any one could fail after an earlier
// one had committed, and the audit insert was explicitly allowed to fail on its
// own: the handler reported `audited: false` and returned 200. So "access changed,
// audit missing" was a representable, expected outcome — the exact boundary §15
// requires closing.
//
// It is now a single call to `nmi_admin_update_access`, whose body performs the
// grant changes AND their audit rows inside one PostgreSQL transaction. Either
// both land or neither does; there is no longer a code path that can grant a module
// without recording who granted it. `audited` is retained in the response for
// backward compatibility and is now always `true` on success, because a successful
// return is itself proof the audit committed.
//
// AUTHORIZATION also moved into the database: `nmi_assert_admin_actor()` resolves
// the actor from `auth.uid()` on the administrator's own session, so the route
// handler is a convenience check rather than the boundary.

import { NextResponse } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { normalizeModules } from '@/lib/admin/userProvisioning'
import { readAdminTargetFacts } from '@/lib/admin/adminUserReads'
import { classifyRpcError } from '@/lib/admin/adminRpc'
import { isPortfolioPrincipal } from '@/lib/portfolioAccess/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ShapeRow {
  role: string | null
  portfolio_principal: string | null
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const session = await getSupabaseUserClient()
  const admin = getSupabaseAdminClient()
  if (!session || !admin) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE_HEADERS })
  }

  const { id } = await context.params
  if (typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as { modules?: unknown } | null
  const modules = normalizeModules(body?.modules)
  if (modules === null) {
    return NextResponse.json({ error: 'invalid_module' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  // The same preconditions this endpoint has always enforced, so its refusal codes
  // do not change: an administrator target is rejected rather than silently having
  // its (ignored) grant rows rewritten, and a disabled or never-activated target is
  // rejected because `isApproved` now means USABLE.
  const target = await readAdminTargetFacts(admin, id)
  if (target.readFailed) {
    return NextResponse.json({ error: 'read_failed' }, { status: 500, headers: NO_STORE_HEADERS })
  }
  if (!target.exists) {
    return NextResponse.json({ error: 'target_not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  }
  if (!target.isApproved) {
    return NextResponse.json({ error: 'target_not_approved' }, { status: 409, headers: NO_STORE_HEADERS })
  }
  if (target.isAdministrator) {
    return NextResponse.json({ error: 'target_is_administrator' }, { status: 409, headers: NO_STORE_HEADERS })
  }

  // This endpoint changes ONLY modules, so the account's existing role and
  // principal are read and passed straight back. Sending defaults instead would
  // make a module edit quietly clear someone's Portfolio principal.
  const shapeRes = await (session as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => {
          maybeSingle: () => Promise<{ data: ShapeRow | null; error: unknown }>
        }
      }
    }
  })
    .from('user_profiles')
    .select('role, portfolio_principal')
    .eq('id', id)
    .maybeSingle()

  if (shapeRes.error || !shapeRes.data) {
    return NextResponse.json({ error: 'read_failed' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const currentPrincipal = isPortfolioPrincipal(shapeRes.data.portfolio_principal)
    ? shapeRes.data.portfolio_principal
    : null

  const changed =
    modules.length !== target.currentModules.length ||
    modules.some((m) => !target.currentModules.includes(m))

  if (!changed) {
    return NextResponse.json({ ok: true, changed: false, audited: true }, { headers: NO_STORE_HEADERS })
  }

  const { error } = await (session as never as {
    rpc: (fn: string, p: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  }).rpc('nmi_admin_update_access', {
    p_target_user_id: id,
    p_role: shapeRes.data.role ?? 'user',
    p_principal: currentPrincipal,
    p_modules: modules,
  })

  if (error) {
    const { code, status } = classifyRpcError(error)
    return NextResponse.json({ error: code }, { status, headers: NO_STORE_HEADERS })
  }

  // `audited` can only be true now: the audit rows are written inside the same
  // transaction as the grant changes, so a successful return proves both landed.
  return NextResponse.json({ ok: true, changed: true, audited: true }, { headers: NO_STORE_HEADERS })
}
