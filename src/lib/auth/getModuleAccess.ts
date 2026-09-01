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
// SCOPE. POST-R13.6B.1 wired this into the two sensitive surfaces. POST-R13.6CDE
// additionally drives navigation, Overview composition and the Users & Access
// console from it, through `GET /api/me/access`.
//
// ONE QUERY. POST-R13.6CDE.2 collapsed the profile read and the grant read into
// a single embedded select, shared with middleware through
// `authorizationState.ts`. Two reads cost an extra sequential round-trip on
// every guarded route and, worse, gave one request two snapshots taken at two
// instants — a grant revoked between them would authorise against a profile
// that no longer matched its own grant list. There is now exactly one snapshot
// and one place that parses it.
//
// DENIAL IS NOT THE SAME AS UNAVAILABILITY
// ────────────────────────────────────────
// Both outcomes withhold access, so it is tempting to collapse them. They must
// not be. "You do not hold this module" is an ANSWER — the system worked and the
// answer is no. "I could not read your grants" is a FAILURE — the system did not
// work and no answer was reached.
//
// POST-R13.6CDE found the cost of conflating them. The grant store is created by
// 20260814000000; against a database that has not received it the grant read
// ERRORS, this module denied, the route answered 403 `module_not_granted`, and
// the page rendered that as "Something went wrong". Three different things —
// a schema-version mismatch, an authorization denial, and a crash — all looked
// identical, so the real cause was invisible from the UI.
//
// `reason` now carries that distinction outward. It never makes anything MORE
// permissive: a store failure still denies, exactly as before. It only lets the
// caller say WHICH kind of no it is.

import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/getUser'
import {
  canAccessModule,
  type ModuleAccessInput,
  type ModuleKey,
} from './moduleAccess.ts'
import {
  parseAuthorizationRow,
  moduleAccessOf,
  AUTHORIZATION_STATE_SELECT,
  type AuthorizationRow,
} from './authorizationState.ts'

/**
 * Why the resolution ended as it did.
 *
 * The first three are AUTHORIZATION outcomes — the system reached an answer.
 * The last two are AVAILABILITY failures — it did not. A caller that treats
 * them alike produces exactly the misleading UI this discriminator exists to
 * prevent.
 */
export type ModuleAccessResolution =
  | 'ok'
  /** No verified session. Middleware normally answers this first. */
  | 'no_session'
  /** Session exists but carries no application profile row. */
  | 'no_profile'
  /** Supabase is not configured in this environment. */
  | 'not_configured'
  /** `user_module_grants` could not be read — missing table, or a DB failure. */
  | 'grant_store_unavailable'

/** True when the resolution failed rather than answered. */
export function isAccessUnavailable(reason: ModuleAccessResolution): boolean {
  return reason === 'not_configured' || reason === 'grant_store_unavailable'
}

/** The caller's resolved module access, plus the administrator flag. */
export interface ResolvedModuleAccess {
  userId: string | null
  access: ModuleAccessInput
  /** `user_profiles.role === 'administrator'` AND approved. */
  isAdministrator: boolean
  /** Why this resolution ended as it did. Always set. */
  reason: ModuleAccessResolution
}

/** Fail-closed base used whenever anything is missing or unreadable. */
const DENIED: Omit<ResolvedModuleAccess, 'reason'> = {
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
 * profile": it denies outright, ADMINISTRATORS INCLUDED. That is deliberate and
 * it is why the reported bug presented the way it did — `decideModuleAccess`
 * would let an approved administrator through with an empty grant list, so an
 * administrator being refused is positive proof that the grant READ failed
 * rather than returned nothing.
 *
 * Honouring the administrator through a failed grant read was considered and
 * rejected: "if the grant table is missing, let someone in" is precisely the
 * permissive compatibility fallback that would defeat the design, even narrowed
 * to one role. The fix is to report `grant_store_unavailable` honestly and let
 * the release advance the schema — never to widen access to compensate for a
 * database that is behind the code.
 */
export async function getCallerModuleAccess(): Promise<ResolvedModuleAccess> {
  const user = await getCurrentUser()
  if (!user) return { ...DENIED, reason: 'no_session' }

  const client = await getSupabaseUserClient()
  if (!client) return { ...DENIED, reason: 'not_configured' }

  // ONE read: the approval marker, the role and the module grants together.
  // `user_module_grants.user_id` is a foreign key into `user_profiles(id)`, so
  // PostgREST embeds them; own-row RLS authorises both halves and the
  // service-role client is never used on this path.
  //
  // Supabase JS type inference for user-scoped (auth) tables is unreliable at
  // this TypeScript recursion depth; the narrow cast matches the existing
  // pattern in getEntitlement.ts / watchlistRepository.ts / middleware.ts.
  const res = await (
    client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: AuthorizationRow | null; error: unknown }>
          }
        }
      }
    }
  )
    .from('user_profiles')
    .select(AUTHORIZATION_STATE_SELECT)
    .eq('id', user.id)
    .maybeSingle()

  // The store failed — a database outage, or a deployment with no
  // `user_module_grants` relation to embed. Deny, and say WHY, so the caller
  // answers 503 rather than a 403 that would blame the user for a
  // schema-version mismatch. Never read as "holds no grants".
  if (res.error) return { ...DENIED, userId: user.id, reason: 'grant_store_unavailable' }

  const resolved = parseAuthorizationRow(user.id, res.data)
  if (!resolved.ok) return { ...DENIED, userId: user.id, reason: 'grant_store_unavailable' }
  if (resolved.state === null) return { ...DENIED, userId: user.id, reason: 'no_profile' }

  const access = moduleAccessOf(resolved.state)
  return {
    userId: user.id,
    access,
    isAdministrator: access.isAdministrator && access.isApproved,
    reason: 'ok',
  }
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
