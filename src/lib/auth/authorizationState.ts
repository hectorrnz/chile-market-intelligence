// POST-R13.6CDE.2 — ONE authorization state per request.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, so the
// whole parse is unit-testable without a database.
//
// WHY THIS EXISTS
// ───────────────
// Authorizing a private request needs three facts about the caller: are they
// approved, what is their role, and which modules do they hold. Before this
// stage those arrived from TWO separate queries — `user_profiles`, then
// `user_module_grants` — which cost an extra sequential round-trip on every
// member request and, more importantly, produced two snapshots taken at two
// different instants. A grant revoked between them would leave the request
// authorizing against a profile that no longer matched its own grant list.
//
// One query, one row, one state. `user_module_grants.user_id` is a real foreign
// key into `user_profiles(id)`, so PostgREST can embed the grants in the profile
// read:
//
//   .select('id, username, role, user_module_grants(module_key)')
//   .eq('id', userId)
//
// RLS still authorises BOTH halves independently — `users_own_profile_select`
// (`auth.uid() = id`) for the parent and `user_module_grants_own_select`
// (`auth.uid() = user_id`) for the embedded rows, because PostgREST applies row
// level security to embedded resources as well. The caller therefore cannot read
// another account's profile or another account's grants through this shape any
// more than through two separate reads, and the service-role client is never
// used on this path.
//
// EXPLICIT COLUMNS, NEVER `select('*')`. The profile row carries the caller's
// email and display name; nothing here needs them, and a wildcard would ship
// them into middleware and into every guard that resolves access.
//
// FAILURE IS NOT AN EMPTY GRANT SET
// ─────────────────────────────────
// This is the single most important property in the file. If the query fails —
// a database outage, or a deployment whose database has not yet received
// 20260814000000 and therefore has no `user_module_grants` relation to embed —
// the caller has told us NOTHING. Reading that as "holds no modules" would
// answer 403 to a correctly-provisioned member for what is really a 503, and
// would blame the account for the deployment's schema version. `{ ok: false }`
// is a distinct outcome and every caller must keep it distinct.
//
// It is equally not a reason to be permissive. Failure DENIES. "If the grant
// table is missing, let them in" is the compatibility fallback that would defeat
// the entire entitlement design, and it stays rejected here as it is in
// `getModuleAccess.ts`.

import type { ModuleAccessInput } from './moduleAccess.ts'

/** The three authorization facts, resolved together from one row. */
export interface AuthorizationState {
  readonly userId: string
  /** Non-empty `user_profiles.username` — the platform approval marker. */
  readonly approved: boolean
  /** `user_profiles.role`, raw. Only ever compared to `'administrator'`. */
  readonly role: string | null
  /** Explicit `user_module_grants.module_key` values, unvalidated strings. */
  readonly grants: readonly string[]
}

/**
 * The outcome of resolving authorization state.
 *
 *   { ok: true,  state }        the query answered, and the account exists
 *   { ok: true,  state: null }  the query answered: there is NO profile row
 *   { ok: false }               the query did not answer at all
 *
 * The middle case is an authorization ANSWER (not approved); the last is an
 * availability FAILURE. Collapsing them is exactly the confusion POST-R13.6CDE
 * was opened to fix.
 */
export type AuthorizationStateResult =
  | { readonly ok: true; readonly state: AuthorizationState | null }
  | { readonly ok: false }

/** Reads the caller's authorization state. Never throws; failures are `ok:false`. */
export type AuthorizationStateLookup = (userId: string) => Promise<AuthorizationStateResult>

/** The row shape the embedded select returns. Every field is treated as hostile. */
export interface AuthorizationRow {
  id?: unknown
  username?: unknown
  role?: unknown
  /** PostgREST names the embedded resource after the related table. */
  user_module_grants?: unknown
}

/**
 * Parses one embedded profile row into authorization state.
 *
 * Defensive at every field, and fail-closed in one direction only — a value this
 * build does not understand can reduce access, never widen it:
 *
 *   · `username` non-string or blank            -> not approved
 *   · `role` non-string                         -> null, so never administrator
 *   · embedded grants NOT AN ARRAY              -> `{ ok: false }`, see below
 *   · an individual grant row malformed          -> that row is dropped
 *
 * The array check is the one that must not be softened. PostgREST returns `[]`
 * for a member with no grants and an ERROR when the relation is absent, so the
 * only way to observe a non-array here is a shape nobody predicted — and
 * silently reading that as "no grants" is precisely the failure-becomes-empty-set
 * bug this module exists to prevent. Refusing to guess costs a member a 503 in a
 * situation that should never occur; guessing wrong costs them their access with
 * no explanation.
 */
export function parseAuthorizationRow(
  userId: string,
  row: AuthorizationRow | null | undefined,
): AuthorizationStateResult {
  if (row === null || row === undefined) return { ok: true, state: null }

  const embedded = row.user_module_grants
  if (!Array.isArray(embedded)) return { ok: false }

  const grants = embedded
    .map((g) => (g && typeof g === 'object' ? (g as { module_key?: unknown }).module_key : null))
    .filter((k): k is string => typeof k === 'string' && k.length > 0)

  const username = typeof row.username === 'string' ? row.username.trim() : ''

  return {
    ok: true,
    state: {
      userId,
      approved: username.length > 0,
      role: typeof row.role === 'string' ? row.role : null,
      grants,
    },
  }
}

/**
 * The module-rule inputs implied by an authorization state.
 *
 * Approval remains the outer gate: an unapproved state yields
 * `isAdministrator: false` regardless of the stored role, so a role string can
 * never substitute for provisioning. This matches `moduleAccessFromProfile`, and
 * both are asserted against the same truth table.
 */
export function moduleAccessOf(state: AuthorizationState): ModuleAccessInput {
  return {
    isApproved: state.approved,
    isAdministrator: state.approved && state.role === 'administrator',
    grants: state.grants,
  }
}

/**
 * The explicit column list for the one authorization query.
 *
 * Exported so middleware, the server resolver and the tests all name the same
 * string. Two hand-written copies would be two things to keep in step, and the
 * one that drifted would be the one nobody looked at.
 */
export const AUTHORIZATION_STATE_SELECT = 'id, username, role, user_module_grants(module_key)'
