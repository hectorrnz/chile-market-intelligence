// FOLLOW-UP G — the database, as the fail-closed suite decides it.
//
// Loaded in place of `@/lib/supabase/admin` by `aliasHooks.mjs`, and only inside
// the one suite that registers that hook. It reaches nothing: no network, no
// credentials, no environment variable. The test sets the client it wants and
// the repository under test uses it exactly as it would use the real one.

/** The client the suite installed, or null for "not configured". */
export function getSupabaseAdminClient() {
  const installed = globalThis.__NMI_TEST_ADMIN_CLIENT__
  return installed === undefined ? null : installed
}

export function getSupabaseAdminConfig() {
  return null
}
