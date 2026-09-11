// R13.6F — POST /api/admin/users/[id]/invitation : RESEND an invitation.
//
// Mints a fresh one-time link for an account that was invited and has not yet
// accepted, and emails it. It changes NO access: not the role, not the principal,
// not one module grant. That distinction matters — re-running provisioning would
// silently rewrite the account's access from whatever the resend form happened to
// contain, which is not what an administrator means by "resend".
//
// WHY THE STATE CHECK IS HERE AND NOT IN THE RPC
// ──────────────────────────────────────────────
// Nothing is being provisioned, so no provisioning RPC runs and its
// `already_activated` guard never fires. The two states that must be refused are
// therefore checked against the directory read directly:
//
//   ACTIVE   — already has a password and can sign in. Sending a fresh invite link
//              would mint a session-bearing credential for a live account by email,
//              which is what `/forgot-password` is for and is deliberately the
//              account holder's own action, never an administrator's.
//   DISABLED — deliberately switched off. Sending it a way back in would defeat
//              the disable.
//
// Both refuse with a stable code and change nothing.
//
// D0B1 — RE-INVITATION IS ALSO HOW A MANUAL LINK IS RETIRED
// ─────────────────────────────────────────────────────────
// A manual invitation URL is shown once and never stored, so there is no way to
// look an old one up — by design (§3). Re-inviting is the recovery: it mints a
// FRESH token through the same `generateLink` call, GoTrue supersedes the
// previous one, and the new URL comes back on this response. A link that was
// lost, mistyped or handed to the wrong person is therefore not merely
// irretrievable, it stops working.

import { NextResponse, type NextRequest } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { buildInviteRedirectUrl, isUsableOrigin } from '@/lib/admin/inviteLink'
import { buildInvitePorts } from '@/lib/admin/inviteRuntime'
import { runResend } from '@/lib/admin/inviteOrchestration'
import {
  parseInviteDelivery,
  resendSuccessBody,
  inviteErrorBody,
} from '@/lib/admin/inviteDelivery'
import { accountStatusOf } from '@/lib/admin/userDirectory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TargetRow {
  username: string | null
  email: string | null
  display_name: string | null
  invited_at: string | null
  activated_at: string | null
  disabled_at: string | null
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const admin = getSupabaseAdminClient()
  const session = await getSupabaseUserClient()
  if (!admin || !session) {
    return NextResponse.json(inviteErrorBody('not_configured'), { status: 503, headers: NO_STORE_HEADERS })
  }

  // The body is OPTIONAL — the pre-D0B1 console posts none at all, and that must
  // keep meaning exactly what it meant before: send by email.
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const delivery = parseInviteDelivery(body?.delivery)
  if (!delivery.ok) {
    return NextResponse.json(inviteErrorBody(delivery.code), { status: 400, headers: NO_STORE_HEADERS })
  }

  const { id } = await context.params
  if (typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json(inviteErrorBody('invalid_target'), { status: 400, headers: NO_STORE_HEADERS })
  }

  const { data, error } = await (session as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => {
          maybeSingle: () => Promise<{ data: TargetRow | null; error: unknown }>
        }
      }
    }
  })
    .from('user_profiles')
    .select('username, email, display_name, invited_at, activated_at, disabled_at')
    .eq('id', id)
    .maybeSingle()

  // A failed read is a 503, never "no such user": telling an administrator the
  // account is missing when the database simply did not answer sends them to
  // recreate an account that already exists.
  if (error) {
    return NextResponse.json(inviteErrorBody('read_failed'), { status: 503, headers: NO_STORE_HEADERS })
  }
  if (!data) {
    return NextResponse.json(inviteErrorBody('target_not_found'), { status: 404, headers: NO_STORE_HEADERS })
  }

  const status = accountStatusOf(data)
  if (status === 'active') {
    return NextResponse.json(inviteErrorBody('already_activated'), { status: 409, headers: NO_STORE_HEADERS })
  }
  if (status === 'disabled') {
    return NextResponse.json(inviteErrorBody('account_disabled'), { status: 409, headers: NO_STORE_HEADERS })
  }

  const email = (data.email ?? '').trim()
  const username = (data.username ?? '').trim()
  if (!email || !username) {
    return NextResponse.json(inviteErrorBody('target_incomplete'), { status: 409, headers: NO_STORE_HEADERS })
  }

  const origin = request.nextUrl.origin
  if (!isUsableOrigin(origin)) {
    return NextResponse.json(inviteErrorBody('invalid_origin'), { status: 500, headers: NO_STORE_HEADERS })
  }

  // Same identity, fresh link. `generateLink` is called for an address that already
  // has an Auth identity, so no second account is created — the installed API
  // returns the existing user with a new one-time link.
  const outcome = await runResend({
    identity: { username, email, displayName: (data.display_name ?? username).trim() || username },
    redirectTo: buildInviteRedirectUrl(origin),
    delivery: delivery.mode,
    ports: buildInvitePorts(admin as never, session as never),
  })

  if (!outcome.ok) {
    return NextResponse.json(
      inviteErrorBody(outcome.code),
      { status: outcome.status, headers: NO_STORE_HEADERS },
    )
  }

  // Carries a bearer credential in manual mode, and only here. `NO_STORE_HEADERS`
  // keeps it out of every cache between this server and the administrator.
  return NextResponse.json(resendSuccessBody(outcome), { headers: NO_STORE_HEADERS })
}
