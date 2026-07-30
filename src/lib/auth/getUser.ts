// Phase 6A — Server-side auth helpers.
// SERVER-ONLY — never import from 'use client' files or client components.
// Uses getSupabaseUserClient() (cookie-aware) to read the current session.

import type { User } from '@supabase/supabase-js'
import { isApprovedProfile, type ApprovalProfile } from './approval.ts'

/**
 * Returns the currently authenticated user, or null if unauthenticated.
 * Safe to call from Server Components, Route Handlers, and Server Actions.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const { getSupabaseUserClient } = await import('../supabase/server.ts')
    const db = await getSupabaseUserClient()
    if (!db) return null
    const { data: { user } } = await db.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
}

/**
 * Returns the current user's UUID, or null if unauthenticated.
 * Convenience wrapper around getCurrentUser().
 */
export async function getUserIdOrNull(): Promise<string | null> {
  const user = await getCurrentUser()
  return user?.id ?? null
}

/**
 * Returns the current user or throws an Error with code 'UNAUTHENTICATED'.
 * Use in Route Handlers that must be protected (check for the error code to
 * return a 401 rather than a 500).
 */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    const err = new Error('Unauthenticated')
    ;(err as Error & { code: string }).code = 'UNAUTHENTICATED'
    throw err
  }
  return user
}

/**
 * R1.5 — Reads the approval profile for a verified user id.
 *
 * Uses the SESSION-bound client, so the `users_own_profile_select` RLS policy
 * (`auth.uid() = id`) is what authorises the read — the service-role client is
 * deliberately not used here, keeping this path unable to see anyone else's row.
 * Returns null when Supabase is unconfigured or no row exists.
 *
 * The `as never` cast mirrors the documented workaround used across this
 * codebase for user-scoped tables (see macroRepository.ts) — Supabase's
 * generated types exceed TypeScript's instantiation depth on these tables.
 */
export async function getApprovalProfile(userId: string): Promise<ApprovalProfile | null> {
  try {
    const { getSupabaseUserClient } = await import('../supabase/server.ts')
    const db = await getSupabaseUserClient()
    if (!db) return null
    const { data } = await (db as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: ApprovalProfile | null }>
          }
        }
      }
    })
      .from('user_profiles')
      .select('id, username, email, display_name')
      .eq('id', userId)
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}

/** Outcome of the authoritative server-side access check. */
export type ApprovedUserResult =
  | { ok: true; user: User; profile: ApprovalProfile }
  | { ok: false; reason: 'unauthenticated' | 'not_approved' }

/**
 * R1.5 — THE authoritative server-side access check.
 *
 * Two independent conditions, both required:
 *   1. `getCurrentUser()` — a session Supabase itself VERIFIES (`getUser()`
 *      validates the JWT against the Auth server, unlike the cookie-only
 *      `getSession()` the middleware gate uses).
 *   2. an approved `user_profiles` row (see `approval.ts`).
 *
 * Never throws: callers branch on `ok`. Use `guardPrivateApi()` in
 * `apiGuard.ts` when the caller is a route handler that needs a JSON response.
 */
export async function getApprovedUser(): Promise<ApprovedUserResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, reason: 'unauthenticated' }

  const profile = await getApprovalProfile(user.id)
  if (!isApprovedProfile(profile)) return { ok: false, reason: 'not_approved' }

  return { ok: true, user, profile: profile as ApprovalProfile }
}
