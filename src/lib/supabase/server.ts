// Phase 5B — Server-side Supabase client for route handlers and Server Components.
// SERVER-ONLY — do not import from client components or 'use client' files.
// Uses public anon key (safe for server-side queries with RLS).
// Returns null when Supabase is not configured.
//
// Phase 6A adds getSupabaseUserClient() — an auth-aware variant that reads the
// user's session cookies so RLS can identify the authenticated user.

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from './env.ts'
import type { Database } from './database.types.ts'

/**
 * Creates a Supabase server client using the public anon key.
 * Safe for anonymous server-side reads; subject to RLS policies.
 * Returns null when NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are absent.
 *
 * Use this for public data (macro, market, CMF). For user-scoped queries
 * (watchlist, profile) use getSupabaseUserClient() instead.
 */
export function getSupabaseServerClient(): SupabaseClient<Database> | null {
  const config = getSupabasePublicConfig()
  if (!config) return null
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      // No session cookies needed for anonymous public-data reads.
      getAll: () => [],
      setAll: () => {},
    },
  })
}

/**
 * Phase 6A — Auth-aware server client. Reads the user's session from cookies
 * so Supabase RLS can identify the authenticated user. Must only be called
 * from Server Components, Route Handlers, or Server Actions (where next/headers
 * cookies() is available). Returns null if Supabase is not configured.
 */
export async function getSupabaseUserClient(): Promise<SupabaseClient<Database> | null> {
  const config = getSupabasePublicConfig()
  if (!config) return null
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (newCookies) => {
        try {
          newCookies.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component (read-only context).
          // Middleware is responsible for refreshing session cookies.
        }
      },
    },
  })
}
