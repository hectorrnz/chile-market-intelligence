// Phase 5B — Supabase environment detection.
// Pure functions, no side effects, safe to call during build.
// Never throws. Never logs secrets.

import type { SupabaseConfig, SupabaseAdminConfig } from './types'

/** Returns the public Supabase config if both public vars are present, else null. */
export function getSupabasePublicConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) return null
  return { url, publishableKey: key }
}

/** Returns the admin config if all required server-only vars are present, else null.
 *  SERVER-ONLY — never call from client components. */
export function getSupabaseAdminConfig(): SupabaseAdminConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key || !svc) return null
  return { url, publishableKey: key, serviceRoleKey: svc }
}

/** True when public Supabase vars are present — does not verify reachability. */
export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfig() !== null
}

/** True when the service-role key is present — does not verify reachability. */
export function isSupabaseAdminConfigured(): boolean {
  return getSupabaseAdminConfig() !== null
}
