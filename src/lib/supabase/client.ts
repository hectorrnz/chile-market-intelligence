'use client'
// Phase 5B — Browser-safe Supabase client.
// Uses ONLY public (NEXT_PUBLIC_*) env vars. Safe to import from client components.
// Returns null when Supabase is not configured — callers must handle null gracefully.

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from './env'
import type { Database } from './database.types'

let _client: SupabaseClient<Database> | null = null

/**
 * Returns a singleton browser Supabase client, or null if public env vars are absent.
 * Safe to call from React components and client-side hooks.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (_client) return _client
  const config = getSupabasePublicConfig()
  if (!config) return null
  _client = createBrowserClient<Database>(config.url, config.publishableKey)
  return _client
}
