// Phase 6A — Server-side auth helpers.
// SERVER-ONLY — never import from 'use client' files or client components.
// Uses getSupabaseUserClient() (cookie-aware) to read the current session.

import type { User } from '@supabase/supabase-js'

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
