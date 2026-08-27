// R13.1 — Server-side resolution of the caller's Family Portfolio entitlement.
//
// SERVER-ONLY. Never import from a client component.
//
// This is the bridge between the request and the pure rule in
// `entitlements.ts`. It reads the caller's own `user_profiles` row through the
// USER-SESSION client, so own-row RLS (`auth.uid() = id`) authorises the read —
// the service-role client is deliberately NOT used here, exactly as
// `src/middleware.ts` does for the approval marker.
//
// A caller can therefore never read another user's role or principal through
// this path, and never influence their own: the three authorization inputs come
// from the database, never from a header, cookie payload, query parameter, or
// Supabase `user_metadata` (which the user can write themselves via the public
// anon key).
//
// DEFENCE IN DEPTH, NOT THE ONLY DEFENCE. Route handlers use this to filter and
// to answer 403. PostgreSQL RLS (`public.nmi_can_access_scope`) is the
// authoritative layer for any future R13 table, and remains correct even if a
// handler forgets to filter.

import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/getUser'
import {
  entitlementFromProfile,
  scopesFor,
  canReadScope,
  canAdminister,
  type EntitlementInput,
  type FamilyPortfolioScope,
} from './entitlements'

/** The caller's resolved entitlement, plus the derived scope list. */
export interface ResolvedEntitlement {
  userId: string | null
  input: EntitlementInput
  scopes: FamilyPortfolioScope[]
  isAdministrator: boolean
}

/** Fail-closed result used whenever anything is missing or unreadable. */
const DENIED: ResolvedEntitlement = {
  userId: null,
  input: { isApproved: false, isAdministrator: false, principal: null },
  scopes: [],
  isAdministrator: false,
}

/**
 * Resolves the calling user's Family Portfolio entitlement.
 *
 * Returns a fully-denied entitlement — never throws — when there is no session,
 * no Supabase configuration, no profile row, or a read error. Callers can treat
 * the result as authoritative for filtering without a try/catch.
 */
export async function getFamilyPortfolioEntitlement(): Promise<ResolvedEntitlement> {
  const user = await getCurrentUser()
  if (!user) return DENIED

  const client = await getSupabaseUserClient()
  if (!client) return DENIED

  // Supabase JS type inference for user-scoped (auth) tables is unreliable at
  // this TypeScript recursion depth; the narrow cast matches the existing
  // pattern in watchlistRepository.ts / macroRepository.ts / middleware.ts.
  const { data, error } = await (
    client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: { username: string | null; role: string | null; portfolio_principal: string | null } | null
              error: unknown
            }>
          }
        }
      }
    }
  )
    .from('user_profiles')
    .select('username, role, portfolio_principal')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data) return { ...DENIED, userId: user.id }

  const input = entitlementFromProfile(data)
  return {
    userId: user.id,
    input,
    scopes: scopesFor(input),
    isAdministrator: canAdminister(input),
  }
}

/** True when the caller may read `requested`. Denies unknown scope names. */
export async function callerCanReadScope(requested: unknown): Promise<boolean> {
  const { input } = await getFamilyPortfolioEntitlement()
  return canReadScope(input, requested)
}

/** True when the caller holds administrative capability. */
export async function callerIsAdministrator(): Promise<boolean> {
  return (await getFamilyPortfolioEntitlement()).isAdministrator
}
