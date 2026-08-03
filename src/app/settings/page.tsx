// R9.2 — the canonical Settings route.
//
// SERVER COMPONENT. This is the only place account authority is read, and it is
// read the same way every other authoritative check in this app is:
//   · `getCurrentUser()`  → `supabase.auth.getUser()`, verified against the Auth
//                            server, not a cookie-only session read.
//   · `getApprovalProfile()` → the session-bound client, so the own-row
//                            `users_own_profile_select` RLS policy authorises the
//                            read. The service-role client is never involved.
//
// Only sanitized, serializable facts cross into the client composition — no
// Supabase client, no token, no raw error, and never `user_profiles.role`
// (which R1.5 deliberately left inactive). Middleware already guarantees an
// approved session before this page renders; the degraded branches below exist
// so a failed profile read renders honestly instead of fabricating a value.
//
// No new API route was added: the account facts come from these existing server
// helpers, and Data Sources reuses the existing `/api/health/ingestion`.

import { getCurrentUser, getApprovalProfile } from '@/lib/auth/getUser'
import { isApprovedProfile } from '@/lib/auth/approval'
import { SettingsClient, type SettingsAccount } from './SettingsClient'

export const dynamic = 'force-dynamic'

/** Trimmed non-empty string, or null — never an empty label. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export default async function SettingsPage() {
  const user = await getCurrentUser()
  const profile = user ? await getApprovalProfile(user.id) : null

  // Presentation only, mirroring the existing `useAuthDisplay` chain but
  // preferring the authoritative record. Metadata is user-writable through the
  // anon key, so it can name a person — never authorise one.
  const meta = (user?.user_metadata ?? {}) as { display_name?: unknown; username?: unknown }

  const account: SettingsAccount = {
    displayName: text(profile?.display_name) ?? text(meta.display_name) ?? text(meta.username),
    email: text(user?.email),
    // Authoritative record ONLY. A failed read stays null and renders as
    // "Unavailable" rather than borrowing the username from metadata.
    username: text(profile?.username),
    // Tri-state: a profile we could not read is `unavailable`, never silently
    // downgraded to a denial we did not actually establish.
    access: profile === null ? 'unavailable' : isApprovedProfile(profile) ? 'approved' : 'not_approved',
  }

  return <SettingsClient account={account} />
}
