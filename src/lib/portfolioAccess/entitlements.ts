// R13.1 — THE canonical Family Portfolio authorization rule, in TypeScript.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import — so it
// is directly unit-testable and is consumed identically by server route
// handlers, server components, and (for presentation only) the client. This
// mirrors how `accessPolicy.ts` is shared by middleware and route guards.
//
// THIS FILE IS ONE HALF OF A TWO-SIDED CONTRACT. The other half is
// `public.nmi_portfolio_scopes(boolean, boolean, text)` in
// supabase/migrations/20260806000000_family_portfolio_entitlements.sql.
// `tests/familyPortfolioEntitlements.test.ts` asserts that both sides return
// the same scope set for every case in the shared truth table, and that the
// truth table embedded in the migration is the same table used here. A parity
// mismatch is a blocking failure — TypeScript must never invent authorization
// semantics that differ from PostgreSQL.
//
// TWO ORTHOGONAL DIMENSIONS (docs/portfolio-r13/05 § 2.2):
//   1. application role     — what administrative capability does this account have?
//   2. portfolio principal  — which personal family portfolio may it see?
//
// `administrator` is NOT a principal value. Administrative capability comes from
// the role dimension only.
//
// PRESENTATION IS NOT PROTECTION. Every function here is a *decision* helper.
// The authoritative denials happen in PostgreSQL (RLS via
// `public.nmi_can_access_scope`) and in the server route handler. Client code
// may use these results to decide what to render; it may never be the only
// thing standing between a caller and another family member's data.

/** Canonical Family Portfolio scope identifiers. */
export const FAMILY_PORTFOLIO_SCOPES = [
  'main',
  'jaime',
  'andres',
  'pablo',
  'alternatives',
  'admin',
] as const

export type FamilyPortfolioScope = (typeof FAMILY_PORTFOLIO_SCOPES)[number]

/**
 * Portfolio principals. `administrator` is deliberately absent — it is a role,
 * not a principal, and the database CHECK constraint rejects it too.
 */
export const PORTFOLIO_PRINCIPALS = ['jaime', 'andres', 'pablo'] as const

export type PortfolioPrincipal = (typeof PORTFOLIO_PRINCIPALS)[number]

/** Application roles. */
export const APPLICATION_ROLES = ['user', 'administrator'] as const

export type ApplicationRole = (typeof APPLICATION_ROLES)[number]

/**
 * The three authorization inputs, read from the caller's own `user_profiles`
 * row. Never from session metadata, a URL parameter, a header, or any other
 * client-controlled source: Supabase `user_metadata` is writable by the user
 * through the public anon key, so it can never be an authorization claim.
 */
export interface EntitlementInput {
  /** Non-empty `user_profiles.username` — the platform approval marker. */
  isApproved: boolean
  /** `user_profiles.role === 'administrator'`. */
  isAdministrator: boolean
  /** `user_profiles.portfolio_principal`, or null. */
  principal: string | null | undefined
}

/** Scopes granted to an approved administrator, in canonical order. */
const ADMIN_SCOPES: readonly FamilyPortfolioScope[] = [
  'main',
  'jaime',
  'andres',
  'pablo',
  'alternatives',
  'admin',
]

/**
 * Scopes per family principal, in canonical order. Every principal sees the
 * Main Portfolio and the shared Alternatives, plus their own personal portfolio
 * — and nothing else. One brother can never reach another brother's scope.
 */
const PRINCIPAL_SCOPES: Readonly<Record<PortfolioPrincipal, readonly FamilyPortfolioScope[]>> = {
  jaime: ['main', 'jaime', 'alternatives'],
  andres: ['main', 'andres', 'alternatives'],
  pablo: ['main', 'pablo', 'alternatives'],
}

/** Narrowing guard for a stored principal value. */
export function isPortfolioPrincipal(value: unknown): value is PortfolioPrincipal {
  return typeof value === 'string' && (PORTFOLIO_PRINCIPALS as readonly string[]).includes(value)
}

/** Narrowing guard for a scope name. Anything else is denied by construction. */
export function isFamilyPortfolioScope(value: unknown): value is FamilyPortfolioScope {
  return (
    typeof value === 'string' && (FAMILY_PORTFOLIO_SCOPES as readonly string[]).includes(value)
  )
}

/**
 * THE rule. Returns the caller's authorized scopes in canonical order.
 *
 * Fail-closed properties, each mirrored exactly in the SQL function:
 *   - not approved (or unknown approval)      -> [] even when isAdministrator is true
 *   - approved administrator                  -> every scope, regardless of principal
 *   - approved, non-admin, valid principal    -> main + own + alternatives
 *   - approved, non-admin, null principal     -> []
 *   - approved, non-admin, unknown/malformed  -> []
 *
 * A returned array is always a fresh copy, so a caller cannot mutate the
 * module-level tables through it.
 */
export function scopesFor(input: EntitlementInput): FamilyPortfolioScope[] {
  // Approval is the outer gate. A revoked account (username cleared) loses every
  // scope on its next request, including an administrator's.
  if (input.isApproved !== true) return []
  if (input.isAdministrator === true) return [...ADMIN_SCOPES]
  if (isPortfolioPrincipal(input.principal)) return [...PRINCIPAL_SCOPES[input.principal]]
  return []
}

/**
 * True when the caller may read one requested scope.
 *
 * `requested` is deliberately typed `unknown`: it routinely arrives from a URL
 * segment or query string. An unknown, null, malformed, or non-string scope is
 * denied because it can never be present in the caller's scope list.
 */
export function canReadScope(input: EntitlementInput, requested: unknown): boolean {
  if (!isFamilyPortfolioScope(requested)) return false
  return scopesFor(input).includes(requested)
}

/**
 * True when the caller holds administrative capability.
 *
 * Derived ONLY from the role dimension, and gated on approval — never from a
 * principal value, a username, an email allowlist, or a client-supplied claim.
 */
export function canAdminister(input: EntitlementInput): boolean {
  return input.isApproved === true && input.isAdministrator === true
}

/**
 * Builds the entitlement inputs from a raw `user_profiles` row.
 *
 * Approval matches `isApprovedProfile()` in `src/lib/auth/approval.ts` — a
 * non-empty trimmed `username`. Keeping the definition identical here means the
 * Family Portfolio boundary can never disagree with the platform approval
 * boundary about who is approved.
 *
 * A role value that is not exactly `'administrator'` — including a malformed or
 * unexpected one that somehow evaded the database CHECK — yields a
 * non-administrator. Fail-closed.
 */
export function entitlementFromProfile(
  profile:
    | { username?: string | null; role?: string | null; portfolio_principal?: string | null }
    | null
    | undefined,
): EntitlementInput {
  if (!profile) return { isApproved: false, isAdministrator: false, principal: null }
  const username = typeof profile.username === 'string' ? profile.username.trim() : ''
  return {
    isApproved: username.length > 0,
    isAdministrator: profile.role === 'administrator',
    principal: isPortfolioPrincipal(profile.portfolio_principal)
      ? profile.portfolio_principal
      : null,
  }
}
