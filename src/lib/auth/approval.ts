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
  /**
   * POST-R13.6CDE.1 — read by the platform-access boundary, NOT by approval.
   *
   * `isApprovedProfile` still ignores it entirely: approval remains presence of
   * a username. Role decides whether an approved account needs module grants to
   * enter (a member does, an administrator does not) — it never decides whether
   * the account is approved. Keeping the two separate is what stops "promote to
   * administrator" from ever being able to substitute for provisioning.
   */
  role?: string | null
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
  /**
   * R13.6F — provisioned, but an administrator has switched the account off.
   *
   * Distinct from `not_authorized` on purpose. That code means "this account was
   * never provisioned here"; this one means "it was, and it has been suspended".
   * The remedies are opposite — reactivate versus provision — and the account's
   * role, principal and grants are all still intact waiting for the first.
   */
  accountDisabled: 'account_disabled',
  /**
   * R13.6F — invited, but the invitation has never been accepted.
   *
   * Nothing is wrong with the account: the person has simply not followed their
   * link yet. Told apart from the two above so an administrator reading a report
   * resends an invitation instead of editing access that is already correct.
   */
  accountNotActivated: 'account_not_activated',
  /**
   * POST-R13.6CDE.1 — approved, but holds no module at all.
   *
   * A distinct code from `not_authorized` on purpose: the account IS
   * provisioned, and the fix is to grant it a module, not to provision it
   * again. Collapsing the two would send the administrator to the wrong screen.
   */
  noPlatformAccess: 'no_platform_access',
  /**
   * POST-R13.6CDE.2 — approved, entitled to enter, but not to THIS module.
   *
   * The second layer. `no_platform_access` says "you may not enter Nevada
   * Market Intelligence"; this says "you are inside it, and this is not one of
   * your modules". Distinct codes because the remedies differ: the first needs
   * any grant at all, the second needs one specific grant.
   */
  moduleNotGranted: 'module_not_granted',
  /**
   * POST-R13.6CDE.2 — approved and entitled, but the surface is a ROLE
   * capability. No module grant can ever satisfy it; that is the entire point.
   */
  administratorRequired: 'administrator_required',
  /**
   * The entitlement store could not be READ — not an authorization answer.
   *
   * The request is still refused, but the cause is this deployment (a database
   * behind its code), not the caller. Kept separate for the same reason
   * `getModuleAccess.ts` keeps `grant_store_unavailable` separate: a 403 asserts
   * "we checked and you may not", and saying that when nothing was checked sends
   * everyone after the wrong problem.
   */
  accessUnavailable: 'module_access_unavailable',
} as const

export type AccessDeniedReason =
  (typeof ACCESS_DENIED_REASONS)[keyof typeof ACCESS_DENIED_REASONS]
