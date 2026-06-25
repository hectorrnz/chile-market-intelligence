// Phase 5B — Server-side Supabase client for route handlers and Server Components.
// SERVER-ONLY — do not import from client components or 'use client' files.
// Uses public anon key (safe for server-side queries with RLS).
// Returns null when Supabase is not configured.

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from './env'
import type { Database } from './database.types'

/**
 * Creates a Supabase server client using the public anon key.
 * Safe for server-side reads; subject to RLS policies.
 * Returns null when NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are absent.
 *
 * Usage in a Next.js route handler:
 *   const db = getSupabaseServerClient()
 *   if (!db) return staticFallback()
 *   const { data } = await db.from('companies').select('*')
 */
export function getSupabaseServerClient(): SupabaseClient<Database> | null {
  const config = getSupabasePublicConfig()
  if (!config) return null
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      // No cookie management in this phase — auth is not implemented yet.
      // Replace with proper cookie helpers (next/headers) when auth is added in Phase 6.
      getAll: () => [],
      setAll: () => {},
    },
  })
}
