// Phase 5B — Supabase admin client (service-role key).
// SERVER-ONLY — NEVER import from client components or 'use client' files.
// The service-role key bypasses RLS — use only for trusted server-side ingestion.
// Returns null when service-role credentials are absent.

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdminConfig } from './env.ts'
import type { Database } from './database.types.ts'

/**
 * Creates a Supabase admin client using the service-role key.
 * Bypasses RLS — only call from server route handlers and ingestion scripts.
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is absent.
 *
 * SECURITY: This client must never be returned to the browser or exposed in
 * client bundles. Import only from server-side files (route handlers, scripts).
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> | null {
  const config = getSupabaseAdminConfig()
  if (!config) return null
  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
