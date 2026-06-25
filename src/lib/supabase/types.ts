// Phase 5B — Shared Supabase utility types.
// This file is import-safe from both client and server code.

/** Whether the Supabase client is available and configured. */
export type SupabaseAvailability = 'available' | 'unconfigured' | 'error'

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

export interface SupabaseAdminConfig extends SupabaseConfig {
  serviceRoleKey: string
}
