// POST-R13.6B — THE canonical application MODULE entitlement rule, in TypeScript.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import — so it
// is directly unit-testable and can be consumed identically by middleware, by
// server route handlers, and (for presentation only) by the client. This mirrors
// how `accessPolicy.ts` and `portfolioAccess/entitlements.ts` are shared.
//
// THIS FILE IS ONE HALF OF A TWO-SIDED CONTRACT. The other half is
// `public.nmi_module_allowed(boolean, boolean, boolean, boolean)` in
// supabase/migrations/20260814000000_module_entitlements.sql.
// `tests/moduleEntitlements.test.ts` asserts that both sides return the same
// answer for every case in the shared truth table, and that the truth table
// embedded in the migration is the same table used here. A parity mismatch is a
// blocking failure — TypeScript must never invent authorization semantics that
// differ from PostgreSQL.
//
// WHAT A MODULE GRANT ANSWERS, AND WHAT IT DOES NOT
// ─────────────────────────────────────────────────
// A grant answers exactly one question: MAY THIS ACCOUNT REACH THIS MODULE AT
// ALL? It never answers WHOSE DATA they may see. Inside the Portfolio module the
// visible scope set stays governed by the frozen principal ceiling in
// `portfolioAccess/entitlements.ts`, and a grant can only SUBTRACT from it — see
// `portfolioAccess/portfolioModuleComposition.ts`.
//
// `jaime`, `andres` and `pablo` are deliberately NOT module keys, and never will
// be. A cross-principal grant is therefore not merely rejected at runtime: it is
// UNREPRESENTABLE, because `user_module_grants.module_key` is a foreign key into
// `app_modules` and no such row exists to point at. Making the dangerous state
// impossible to store is stronger than validating against it.
//
// DEFAULTS ARE NOT AUTHORIZATION. `app_modules.default_for_member` is
// PROVISIONING metadata — the checkbox state a NEW member's invitation starts
// from. It is deliberately absent from every function in this file. At runtime a
// member is allowed a module if and only if an explicit `user_module_grants` row
// exists. See `tests/moduleEntitlements.test.ts` § "defaults are not
// authorization", which exists to stop a future change from quietly converting
// one into the other.
//
// WHERE THIS IS CONSUMED. POST-R13.6B established the substrate; it is now
// wired. POST-R13.6B.1 attached the PostgreSQL-level enforcement for Structured
// Notes and notification recipients; POST-R13.6CDE drove navigation, Overview
// composition and the Users & Access console from it; POST-R13.6CDE.1 added
// `canEnterPlatform` and bound it into the middleware gate, so an approved
// member holding nothing no longer enters the application at all.

/**
 * The grantable application modules, in canonical order.
 *
 * Deliberately EXCLUDED, each for a reason that is about security or product
 * shape rather than convenience:
 *
 *   main / jaime / andres / pablo  — Portfolio security ceilings, never grants.
 *   portfolio_admin               — the publication console is a ROLE capability.
 *   notification_recipients       — administering the outbound family
 *                                   distribution list is a ROLE capability; it
 *                                   is not member-configurable and must never be
 *                                   modelled as an ordinary module grant.
 *   overview                      — not grantable, because it is not a
 *                                   destination anyone is given: it is what the
 *                                   application opens on, and it OMITS content
 *                                   belonging to modules the member cannot
 *                                   reach. Reaching it at all is governed by
 *                                   `canEnterPlatform` below, which POST-R13.6-
 *                                   CDE.1 made conditional on holding at least
 *                                   one real module.
 *   settings                      — personal account infrastructure, reachable
 *                                   on the same condition as Overview.
 *   news                          — currently exists only as an Overview
 *                                   surface, with no route of its own. Adding a
 *                                   key purely for symmetry would invent a
 *                                   module the product does not have.
 *   watchlist                     — follows the Markets module, and keeps its
 *                                   own per-user `auth.uid() = user_id` RLS.
 */
export const APP_MODULE_KEYS = [
  'markets',
  'analysis',
  'macro',
  'earnings',
  'portfolio',
  'alternatives',
  'structured_notes',
] as const

export type ModuleKey = (typeof APP_MODULE_KEYS)[number]

/** Narrowing guard for a module key. Anything else is denied by construction. */
export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (APP_MODULE_KEYS as readonly string[]).includes(value)
}

/**
 * A caller's explicit grants, as read from `user_module_grants`.
 *
 * Typed as `readonly unknown[]` on purpose: the rows come from the database, and
 * a future registry row or a corrupted read could carry a string this build does
 * not know. Unknown entries are ignored rather than trusted — an unrecognised
 * grant can never allow anything, because the module being asked about is itself
 * validated against `APP_MODULE_KEYS` first.
 */
export type ModuleGrantSet = readonly unknown[]

/** The authorization inputs, read from the caller's own profile and grants. */
export interface ModuleAccessInput {
  /** Non-empty `user_profiles.username` — the platform approval marker. */
  isApproved: boolean
  /** `user_profiles.role === 'administrator'`. */
  isAdministrator: boolean
  /** Explicit `user_module_grants` rows for this user. */
  grants: ModuleGrantSet
}

/** Machine-readable denial reasons, for logs and JSON bodies. */
export const MODULE_DENIAL_REASONS = {
  /** No approved application profile — the outer gate. */
  notApproved: 'not_approved',
  /** The requested module is not a declared key (unknown, malformed, or new). */
  unknownModule: 'unknown_module',
  /** Approved and the module exists, but no explicit grant row is present. */
  noGrant: 'no_grant',
} as const

export type ModuleDenialReason =
  (typeof MODULE_DENIAL_REASONS)[keyof typeof MODULE_DENIAL_REASONS]

export interface ModuleAccessDecision {
  readonly allowed: boolean
  /** Null exactly when `allowed` is true. */
  readonly reason: ModuleDenialReason | null
}

const ALLOWED: ModuleAccessDecision = { allowed: true, reason: null }

/**
 * THE rule. Decides whether a caller may reach one module.
 *
 * Fail-closed properties, each mirrored exactly in the SQL function:
 *   - not approved                          -> denied, even for an administrator
 *   - unknown / malformed / new module      -> denied (future-module default deny)
 *   - approved administrator, known module  -> allowed without any grant row
 *   - approved member, no explicit grant    -> denied, whatever the registry default says
 *   - approved member, explicit grant       -> allowed
 *
 * `module` is deliberately typed `unknown`: it is routinely derived from a URL.
 */
export function decideModuleAccess(
  input: ModuleAccessInput,
  module: unknown,
): ModuleAccessDecision {
  // Approval is the outer gate, exactly as in `scopesFor`. A revoked account
  // (username cleared) loses every module on its next request, administrator or
  // not.
  if (input.isApproved !== true) {
    return { allowed: false, reason: MODULE_DENIAL_REASONS.notApproved }
  }
  // An undeclared module is denied. This is the future-module safety property: a
  // route added in a later phase is unreachable until it is declared AND
  // granted, rather than reachable until someone remembers to gate it.
  if (!isModuleKey(module)) {
    return { allowed: false, reason: MODULE_DENIAL_REASONS.unknownModule }
  }
  // Administrators hold every ordinary module by role. They are deliberately not
  // given grant rows, so administrative access can never be revoked by deleting
  // one — and an empty grant table cannot lock the platform out.
  if (input.isAdministrator === true) return ALLOWED

  // Members require an EXPLICIT row. Absence is denial; there is no runtime
  // fallback to `app_modules.default_for_member`.
  const granted = Array.isArray(input.grants) && input.grants.includes(module)
  return granted ? ALLOWED : { allowed: false, reason: MODULE_DENIAL_REASONS.noGrant }
}

/** Convenience predicate over `decideModuleAccess`. */
export function canAccessModule(input: ModuleAccessInput, module: unknown): boolean {
  return decideModuleAccess(input, module).allowed
}

/**
 * Every module the caller may reach, in canonical order.
 *
 * Returns a fresh array, so a caller cannot mutate module state through it.
 */
export function modulesFor(input: ModuleAccessInput): ModuleKey[] {
  return APP_MODULE_KEYS.filter((m) => canAccessModule(input, m))
}

/**
 * POST-R13.6CDE.1 — THE platform-access boundary.
 *
 * True when this account may enter the authenticated application AT ALL.
 * Distinct from `canAccessModule`, which decides one module once the caller is
 * already inside.
 *
 *   approved administrator                -> yes, with no grant rows at all
 *   approved member, >= 1 reachable module -> yes, then filtered per module
 *   approved member, zero modules          -> NO — not Overview, not Settings
 *   unapproved / no profile / no session   -> no
 *
 * WHY ZERO MODULES IS ZERO ACCESS. Overview and personal Settings used to be
 * unconditional for any approved member. The owner replaced that: an account
 * with nothing granted has nothing to do inside the shell, and letting it in
 * would present an application that is entirely empty — while still exposing the
 * chrome, the account surface and every private request the shell makes on load.
 * "Approved" now means the account EXISTS; entitlement is what admits it.
 *
 * COUNTED THROUGH `modulesFor`, NOT `grants.length`. A stored grant naming a key
 * this build does not declare — a retired module, a registry row added by a
 * newer deployment, a corrupted read — must not be what lets someone in. Counting
 * only modules that actually resolve keeps the boundary equal to what the caller
 * could truly reach, and it is strictly the stricter of the two readings.
 *
 * `app_modules.default_for_member` is never consulted here either. A member is
 * admitted by explicit grants alone.
 *
 * PRESENTATION NEVER CALLS THIS TO GRANT. It is used by middleware to REFUSE,
 * and by the administrator console to LABEL. Every route still re-derives its
 * own answer, and PostgreSQL RLS holds underneath: a zero-grant member who
 * bypassed this boundary entirely would still read nothing.
 */
export function canEnterPlatform(input: ModuleAccessInput): boolean {
  if (input.isApproved !== true) return false
  // Administrators hold every module by role and are deliberately given no
  // grant rows, so an empty grant table can never lock administration out.
  if (input.isAdministrator === true) return true
  return modulesFor(input).length > 0
}

/**
 * Builds the module-access inputs from a raw `user_profiles` row and the
 * caller's grant rows.
 *
 * Approval matches `isApprovedProfile()` in `src/lib/auth/approval.ts` and
 * `entitlementFromProfile()` in `portfolioAccess/entitlements.ts` — a non-empty
 * trimmed `username`. Keeping the three definitions identical means the module
 * boundary can never disagree with the platform approval boundary about who is
 * approved.
 *
 * Never derived from Supabase `user_metadata`: metadata is writable by the user
 * through the public anon key, so it can never be an authorization claim.
 */
export function moduleAccessFromProfile(
  profile: { username?: string | null; role?: string | null } | null | undefined,
  grantRows: readonly { module_key?: string | null }[] | null | undefined,
): ModuleAccessInput {
  const username = typeof profile?.username === 'string' ? profile.username.trim() : ''
  const grants = Array.isArray(grantRows)
    ? grantRows
        .map((r) => r?.module_key)
        .filter((k): k is string => typeof k === 'string' && k.length > 0)
    : []
  return {
    isApproved: username.length > 0,
    isAdministrator: profile?.role === 'administrator',
    grants,
  }
}
