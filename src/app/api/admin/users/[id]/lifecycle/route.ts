// R13.6F — POST /api/admin/users/[id]/lifecycle : disable / reactivate.
//
// The normal removal mechanism for an activated account (§18). Deliberately NOT a
// delete: disabling preserves the module grants, the role, the Portfolio principal
// and every lifecycle timestamp, so reactivating restores exactly the access the
// account had rather than requiring it to be rebuilt from memory.
//
// WHAT MAKES THE DENIAL IMMEDIATE
// ───────────────────────────────
// Setting `disabled_at` is enough on its own, because nothing caches the answer:
//
//   · every private request re-reads the authorization state, and
//     `moduleAccessOf` collapses a disabled account's `isApproved` to false, so it
//     holds no module and cannot enter the platform;
//   · `nmi_profile_usable` is substituted into `nmi_is_administrator`,
//     `nmi_can_access_module`, `nmi_current_module_grants` and
//     `nmi_current_portfolio_scopes`, so PostgreSQL refuses the same account even
//     if it talks to PostgREST directly with its still-valid token;
//   · middleware additionally clears the session cookie, which is a convenience
//     for a cooperating browser and never the mechanism.
//
// A still-valid Supabase access token therefore buys nothing: the token proves who
// you are, and this changes what that identity is allowed to do.

import { NextResponse } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { classifyRpcError } from '@/lib/admin/adminRpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = new Set(['disable', 'reactivate'])

export async function POST(
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

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : ''
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const { data, error } = await (session as never as {
    rpc: (fn: string, p: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  }).rpc('nmi_admin_set_lifecycle', { p_target_user_id: id, p_action: action })

  if (error) {
    // Disabling the final active administrator raises `last_administrator` in the
    // trigger and arrives here as 409. Self-disable is covered by the same rule
    // rather than by a separate "is this me?" check: the invariant is about the
    // resulting population, so it holds however the request was addressed.
    const { code, status } = classifyRpcError(error)
    return NextResponse.json({ error: code }, { status, headers: NO_STORE_HEADERS })
  }

  const result = (data ?? {}) as { changed?: boolean; status?: string }
  return NextResponse.json(
    { ok: true, changed: result.changed === true, status: result.status ?? null },
    { headers: NO_STORE_HEADERS },
  )
}
