// R1.5 — THE approval boundary predicate.
//
// A valid Supabase Auth identity is NOT the same thing as an approved Nevada
// Market Intelligence user. The application's own identity record is the
// approval boundary, and it already existed before R1.5 — no new schema, no new
// role system, no migration.
//
// WHAT MAKES AN ACCOUNT USABLE
// ────────────────────────────
// `/api/auth/login` signs users in by USERNAME. It resolves username → email
// against `user_profiles` (service-role read, email never returned to the
// browser) and fails with `invalid_credentials` when no row matches. So a usable
// account requires BOTH:
//
//   1. an `auth.users` row  — Supabase Auth identity, holds the password
//   2. a `user_profiles` row keyed by that user's id, carrying:
//        · `username`     (citext, UNIQUE)  ← the approval marker; login is
//                                             impossible without it
//        · `email`                          ← how username resolves to Auth
//        · `display_name`                   ← shown in the shell
//
// `user_profiles.role` was unread at R1.5, and this comment used to say so.
// R13.1 activated it: `role` and `portfolio_principal` are now THE Family
// Portfolio authorization inputs, read in TypeScript by
// `portfolioAccess/entitlements.ts` and in PostgreSQL by
// `public.nmi_portfolio_scopes(...)`. POST-R13.6B adds a second reader —
// `auth/moduleAccess.ts` and `public.nmi_module_allowed(...)` — for application
// module access.
//
// APPROVAL ITSELF IS STILL PRESENCE-BASED, and that has not changed: a non-empty
// `username` is the marker, and it remains the OUTER gate. Every downstream rule
// — every scope, every module, administrator capability included — returns
// nothing for an unapproved account. Role and grants decide what an approved
// account may reach; they never decide whether it is approved.
//
// WHY A PREDICATE IS NEEDED AT ALL
// ────────────────────────────────
// `/api/auth/login` enforces the profile requirement structurally, but it is not
// the only way to obtain a session: `/forgot-password` will send a recovery link
// to ANY address present in `auth.users`, and `/auth/callback` then exchanges
// that code for a real session. Before R1.5 an Auth-only identity with no
// `user_profiles` row could therefore acquire a session and, with the old
// denylist middleware, read the entire market/macro/financials API surface.
// Both session-minting paths now apply this same predicate.
//
// REVOCATION
// ──────────
// See `docs/security_access_control.md`. Deleting the Auth user (cascades to
// `user_profiles` and every user-scoped table) or banning it in the Supabase
// Dashboard revokes the refresh token; clearing `user_profiles.username` blocks
// username sign-in and every subsequent session mint.

/** The shape read from `user_profiles` when checking approval. */
export interface ApprovalProfile {
  id?: string | null
  username?: string | null
  email?: string | null
  display_name?: string | null
}

/**
 * True when this profile row represents an approved platform user.
 *
 * Presence of a non-empty `username` is the marker: it is exactly what the
 * username-based login flow requires, it is UNIQUE at the database level, and it
 * is only ever written by an administrator (the provisioning script) now that
 * public self-registration is removed.
 *
 * Deliberately NOT derived from Supabase `user_metadata`: metadata is writable
 * by the user themselves through the public anon key, so it can never be an
 * authorization claim.
 */
export function isApprovedProfile(profile: ApprovalProfile | null | undefined): boolean {
  if (!profile) return false
  const username = typeof profile.username === 'string' ? profile.username.trim() : ''
  return username.length > 0
}

/** Machine-readable denial reasons, for logs and JSON bodies. */
export const ACCESS_DENIED_REASONS = {
  /** No session at all, or the session could not be verified. */
  unauthenticated: 'unauthenticated',
  /** Verified Auth identity, but no approved application profile. */
  notApproved: 'not_authorized',
} as const

export type AccessDeniedReason =
  (typeof ACCESS_DENIED_REASONS)[keyof typeof ACCESS_DENIED_REASONS]
