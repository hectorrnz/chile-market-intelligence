// POST-R13.6B.1 — server-side resolution of the caller's module access.
//
// SERVER-ONLY. Never import from a client component.
//
// This is the bridge between the request and the pure rule in `moduleAccess.ts`,
// and it is deliberately the exact shape of `portfolioAccess/getEntitlement.ts`:
// both read the caller's own rows through the USER-SESSION client, so own-row
// RLS authorises the read and the service-role client is never used. A caller
// can therefore neither read another user's grants nor influence their own.
//
// The two authorization inputs — the profile row and the grant rows — come from
// the database on every request. Never from a header, a cookie payload, a query
// parameter, or Supabase `user_metadata` (which the user can write themselves
// through the public anon key).
//
// DEFENCE IN DEPTH, NOT THE ONLY DEFENCE. Route handlers use this to answer an
// honest 403 instead of letting a request reach PostgreSQL and come back as an
// opaque database error. PostgreSQL RLS is the authoritative layer:
// `public.nmi_can_access_module('structured_notes')` gates every Structured
// Notes read and `public.nmi_is_administrator()` gates every mutation, and both
// remain correct even if a handler forgets to call this.
//
// SCOPE. POST-R13.6B.1 wires this into the two sensitive surfaces only —
// Structured Notes and the notification recipient list. Global middleware and
// navigation integration is POST-R13.6E and is deliberately NOT done here.

import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/getUser'
import {
  moduleAccessFromProfile,
  canAccessModule,
  type ModuleAccessInput,
  type ModuleKey,
} from './moduleAccess.ts'

/** The caller's resolved module access, plus the administrator flag. */
export interface ResolvedModuleAccess {
  userId: string | null
  access: ModuleAccessInput
  /** `user_profiles.role === 'administrator'` AND approved. */
  isAdministrator: boolean
}

/** Fail-closed result used whenever anything is missing or unreadable. */
const DENIED: ResolvedModuleAccess = {
  userId: null,
  access: { isApproved: false, isAdministrator: false, grants: [] },
  isAdministrator: false,
}

/**
 * Resolves the calling user's module access.
 *
 * Returns a fully-denied result — never throws — when there is no session, no
 * Supabase configuration, no profile row, or a read error, so callers can treat
 * the result as authoritative without a try/catch.
 *
 * A grant-read failure is NOT treated as "no grants on an otherwise valid
 * profile": it denies outright. An administrator survives that case anyway,
 * because administrator status comes from the profile row anyone must already
 * have read successfully to get this far.
 */
export async function getCallerModuleAccess(): Promise<ResolvedModuleAccess> {
  const user = await getCurrentUser()
  if (!user) return DENIED

  const client = await getSupabaseUserClient()
  if (!client) return DENIED

  // Supabase JS type inference for user-scoped (auth) tables is unreliable at
  // this TypeScript recursion depth; the narrow casts match the existing
  // pattern in getEntitlement.ts / watchlistRepository.ts / middleware.ts.
  const profileRes = await (
    client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: { username: string | null; role: string | null } | null
              error: unknown
            }>
          }
        }
      }
    }
  )
    .from('user_profiles')
    .select('username, role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileRes.error || !profileRes.data) return { ...DENIED, userId: user.id }

  const grantRes = await (
    client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => Promise<{
            data: { module_key: string | null }[] | null
            error: unknown
          }>
        }
      }
    }
  )
    .from('user_module_grants')
    .select('module_key')
    .eq('user_id', user.id)

  if (grantRes.error) return { ...DENIED, userId: user.id }

  const access = moduleAccessFromProfile(profileRes.data, grantRes.data ?? [])
  return { userId: user.id, access, isAdministrator: access.isAdministrator && access.isApproved }
}

/** True when the caller may reach `module`. Denies unknown module names. */
export async function callerCanAccessModule(module: unknown): Promise<boolean> {
  const { access } = await getCallerModuleAccess()
  return canAccessModule(access, module)
}

/** True when the caller holds administrative capability. */
export async function callerIsPlatformAdministrator(): Promise<boolean> {
  return (await getCallerModuleAccess()).isAdministrator
}

/** Narrowing re-export so route handlers name the module through the union. */
export type { ModuleKey }
