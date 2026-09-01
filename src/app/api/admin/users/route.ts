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

import { NextResponse } from 'next/server'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { NO_STORE_HEADERS } from '@/lib/auth/apiGuard'
import { accountStatusOf, type DirectoryUser } from '@/lib/admin/userDirectory'
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
    .select('id, email, display_name, username, role, portfolio_principal')
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
    const access = moduleAccessFromProfile(p, [...held].filter(isModuleKey).map((k) => ({ module_key: k })))
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
