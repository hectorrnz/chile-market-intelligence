// R13.6F — PUT /api/admin/users/[id] : role, Portfolio principal and module
// grants, changed together in ONE database transaction.
//
// WHY ONE ROUTE AND NOT THREE
// ───────────────────────────
// Role, principal and grants compose into a single effective access set. Changing
// them through three endpoints would mean three transactions, three audit
// timestamps, and windows in between where the account holds a combination nobody
// chose — a member demoted from administrator would, for a moment, hold neither
// the administrator's role-based access nor any grants. `nmi_admin_update_access`
// applies all three at once or none of them, and writes every audit row inside
// that same transaction (§15).
//
// AUTHORIZATION IS NOT DECIDED HERE
// ─────────────────────────────────
// `guardAdministrator()` below is a fast, honest refusal for the common case. The
// binding check is `nmi_assert_admin_actor()` inside the RPC, resolved from
// `auth.uid()` on the administrator's own session. A bug in this handler therefore
// cannot authorize a write, and the last-administrator trigger fires underneath
// both regardless of which path reached it.

import { NextResponse } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { resolveAccountShape } from '@/lib/admin/userProvisioning'
import { classifyRpcError } from '@/lib/admin/adminRpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const session = await getSupabaseUserClient()
  if (!session) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE_HEADERS })
  }

  const { id } = await context.params
  if (typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  // Validated and CANONICALIZED before the call: an administrator target has its
  // principal cleared and its grant set emptied, so promoting someone can never
  // leave fossil grants that would spring back on a later demotion. The RPC
  // repeats the same canonicalization, so a direct SQL caller gets it too.
  const shaped = resolveAccountShape({
    role: body.role,
    principal: body.principal ?? null,
    modules: body.modules ?? [],
  })
  if (!shaped.ok) {
    return NextResponse.json({ error: shaped.code }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const { error } = await (session as never as {
    rpc: (fn: string, p: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  }).rpc('nmi_admin_update_access', {
    p_target_user_id: id,
    p_role: shaped.shape.role,
    p_principal: shaped.shape.principal,
    p_modules: shaped.shape.modules,
  })

  if (error) {
    // `last_administrator` arrives here as a 409 — the demotion was refused by the
    // database trigger, not by this handler, so the same refusal protects the CLI
    // and the service-role key too.
    const { code, status } = classifyRpcError(error)
    return NextResponse.json({ error: code }, { status, headers: NO_STORE_HEADERS })
  }

  return NextResponse.json(
    {
      ok: true,
      role: shaped.shape.role,
      principal: shaped.shape.principal,
      modules: shaped.shape.modules,
    },
    { headers: NO_STORE_HEADERS },
  )
}
