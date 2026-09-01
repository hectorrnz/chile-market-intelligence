// POST-R13.6CDE — GET /api/admin/users
//
// The Users & Access console's read model. ADMINISTRATOR ONLY.
//
// AUTHORIZATION HAPPENS BEFORE ANY TARGET DATA IS READ. `guardAdministrator()`
// resolves the CALLER through the user-session client — own-row RLS, no
// service-role, no `user_metadata` — and returns before a single other account's
// row is touched. Only after that does the service-role client come out.
//
// WHY THE SERVICE-ROLE CLIENT IS NECESSARY HERE, AND WHY THAT IS SAFE
// ───────────────────────────────────────────────────────────────────
// `user_profiles` and `user_module_grants` both grant `authenticated` own-row
// SELECT only (20260730000000 and 20260814000000). There is deliberately no
// administrator read policy on either: the database's answer to "may I read
// another user's authorization" is no, for everyone. So a console that lists
// accounts must run above RLS, and the application layer becomes the boundary on
// this one path.
//
// That is why the guard is the FIRST statement, why the rules it depends on live
// in a pure, exhaustively-tested module, and why this route reads a fixed narrow
// column list rather than `select('*')` — a future column carrying something
// sensitive must not start appearing in an admin response because nobody
// remembered this file existed.
//
// WHAT IS DELIBERATELY NOT HERE
// ─────────────────────────────
// No password, no token, no session, no preferences blob, no financial value.
// `email` IS included: an administrator managing accounts has to tell two people
// apart and a display name is not unique. It never leaves an administrator
// response and is never logged.

import { NextResponse, type NextRequest } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { resolveAccountShape } from '@/lib/admin/userProvisioning'
import { buildInviteRedirectUrl, isUsableOrigin } from '@/lib/admin/inviteLink'
import { buildInvitePorts } from '@/lib/admin/inviteRuntime'
import { runInvite } from '@/lib/admin/inviteOrchestration'
import {
  normalizeUsername,
  isValidUsername,
  isValidEmail,
  isValidDisplayName,
} from '@/lib/auth/credentials'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { accountStatusOf, accountUsableOf, type DirectoryUser } from '@/lib/admin/userDirectory'
import {
  isModuleKey,
  APP_MODULE_KEYS,
  moduleAccessFromProfile,
  canEnterPlatform,
} from '@/lib/auth/moduleAccess'
import { isPortfolioPrincipal } from '@/lib/portfolioAccess/entitlements'
import { portfolioVisibleScopes } from '@/lib/portfolioAccess/portfolioModuleComposition'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProfileRow {
  id: string
  email: string | null
  display_name: string | null
  username: string | null
  role: string | null
  portfolio_principal: string | null
  invited_at: string | null
  activated_at: string | null
  disabled_at: string | null
}

interface GrantRow {
  user_id: string
  module_key: string
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

export async function GET(): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE_HEADERS })
  }

  // Narrow, explicit column list — never `*`.
  const profilesRes = await (
    admin as never as {
      from: (t: string) => {
        select: (c: string) => {
          order: (c: string, o: { ascending: boolean }) => Promise<{ data: ProfileRow[] | null; error: unknown }>
        }
      }
    }
  )
    .from('user_profiles')
    .select('id, email, display_name, username, role, portfolio_principal, invited_at, activated_at, disabled_at')
    .order('username', { ascending: true })

  if (profilesRes.error || !profilesRes.data) {
    return NextResponse.json({ error: 'read_failed' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const grantsRes = await (
    admin as never as {
      from: (t: string) => {
        select: (c: string) => Promise<{ data: GrantRow[] | null; error: unknown }>
      }
    }
  )
    .from('user_module_grants')
    .select('user_id, module_key')

  // A failed grant read must not render as "nobody holds anything" — an
  // administrator would then revoke access that was never actually granted away.
  if (grantsRes.error) {
    return NextResponse.json({ error: 'read_failed' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const byUser = new Map<string, Set<string>>()
  for (const g of grantsRes.data ?? []) {
    if (!byUser.has(g.user_id)) byUser.set(g.user_id, new Set())
    byUser.get(g.user_id)!.add(g.module_key)
  }

  const users: DirectoryUser[] = profilesRes.data.map((p) => {
    const held = byUser.get(p.id) ?? new Set<string>()
    const modules = APP_MODULE_KEYS.filter((k) => held.has(k))
    const principal = isPortfolioPrincipal(p.portfolio_principal) ? p.portfolio_principal : null
    // The SAME composition the runtime uses, so the console cannot show a scope
    // set the application would not actually serve.
    //
    // R13.6F — `isApproved` is overridden with USABILITY for exactly that reason.
    // `moduleAccessFromProfile` reads approval from the username alone, which was
    // the whole truth before lifecycle existed; leaving it would make the directory
    // claim a disabled account still reaches its modules and its Portfolio scopes,
    // while every runtime path correctly refuses it. The console must describe the
    // access the platform would really grant, not the access it once would have.
    const rawAccess = moduleAccessFromProfile(
      p,
      [...held].filter(isModuleKey).map((k) => ({ module_key: k })),
    )
    const usable = accountUsableOf(p)
    const access = {
      ...rawAccess,
      isApproved: usable,
      isAdministrator: usable && rawAccess.isAdministrator,
    }
    const entitlement = {
      isApproved: access.isApproved,
      isAdministrator: access.isAdministrator,
      principal,
    }
    return {
      id: p.id,
      displayName: text(p.display_name),
      username: text(p.username),
      email: text(p.email),
      status: accountStatusOf(p),
      invitedAt: p.invited_at,
      activatedAt: p.activated_at,
      disabledAt: p.disabled_at,
      isAdministrator: access.isAdministrator,
      principal,
      modules,
      portfolioScopes: portfolioVisibleScopes(entitlement, access),
      // The same predicate middleware refuses with — never `modules.length > 0`
      // re-derived here, so the console and the gate cannot disagree.
      hasPlatformAccess: canEnterPlatform(access),
    }
  })

  return NextResponse.json({ users }, { headers: NO_STORE_HEADERS })
}


/**
 * POST /api/admin/users — INVITE a new user.
 *
 * Administrator only, re-checked here AND again inside every RPC from
 * `auth.uid()`, so reaching this handler is never what authorizes the write.
 *
 * Spans three systems that cannot share a transaction (Auth, PostgreSQL, email);
 * the sequencing and the partial-failure model live in
 * `lib/admin/inviteOrchestration.ts`, which is where they are tested. This handler
 * only validates the request, resolves the destination, and reports the outcome.
 *
 * A 200 with `emailSent: false` is a REAL outcome, not a soft failure: the account
 * exists and is correctly restricted, but nobody has the link yet. Reporting that
 * as an unqualified success is exactly what §13 forbids.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const admin = getSupabaseAdminClient()
  const session = await getSupabaseUserClient()
  if (!admin || !session) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const username = normalizeUsername(String(body.username ?? ''))
  const email = String(body.email ?? '').trim().toLowerCase()
  const displayName = String(body.displayName ?? '').trim() || username

  if (!isValidUsername(username)) {
    return NextResponse.json({ error: 'invalid_username' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  if (!isValidDisplayName(displayName)) {
    return NextResponse.json({ error: 'invalid_display_name' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const shaped = resolveAccountShape({
    role: body.role,
    principal: body.principal ?? null,
    modules: body.modules ?? [],
  })
  if (!shaped.ok) {
    return NextResponse.json({ error: shaped.code }, { status: 400, headers: NO_STORE_HEADERS })
  }

  // The origin of THIS request — so a Preview invitation lands on that Preview and
  // never on Production. Never a configured hostname; see lib/admin/inviteLink.ts.
  const origin = request.nextUrl.origin
  if (!isUsableOrigin(origin)) {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const outcome = await runInvite({
    identity: { username, email, displayName },
    shape: shaped.shape,
    redirectTo: buildInviteRedirectUrl(origin),
    ports: buildInvitePorts(admin as never, session as never),
  })

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.code, authIdentity: outcome.authIdentity },
      { status: outcome.status, headers: NO_STORE_HEADERS },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      userId: outcome.userId,
      emailSent: outcome.emailSent,
      emailFailure: outcome.emailFailure,
      reusedAuthIdentity: outcome.reusedAuthIdentity,
    },
    { headers: NO_STORE_HEADERS },
  )
}
