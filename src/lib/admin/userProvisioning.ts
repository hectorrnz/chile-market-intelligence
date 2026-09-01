// R13.6F — the PURE provisioning decision layer.
//
// No Next.js, Supabase, environment or filesystem import, so every rule below is
// unit-testable without a database and is shared verbatim by the API routes, by
// the administrator UI (for its warnings) and by the tests.
//
// WHAT LIVES HERE AND WHAT DOES NOT
// ─────────────────────────────────
// Here: validating an administrator's requested account shape, deriving the module
// checkboxes a NEW member's form starts from, and computing the advisory warnings
// the console must show before saving.
//
// NOT here: authorization. Nothing in this file decides whether a request may
// proceed — `nmi_assert_admin_actor()` does that inside PostgreSQL, on every RPC,
// from `auth.uid()`. These functions run AFTER that check and only shape what is
// written. Treating validation as authorization is how a "server-side check" ends
// up being a client-side one wearing a server's clothes.

import { APP_MODULE_KEYS, isModuleKey, type ModuleKey } from '../auth/moduleAccess.ts'
import {
  PORTFOLIO_PRINCIPALS,
  isPortfolioPrincipal,
  scopesFor,
  type PortfolioPrincipal,
  type FamilyPortfolioScope,
} from '../portfolioAccess/entitlements.ts'
import { portfolioVisibleScopes } from '../portfolioAccess/portfolioModuleComposition.ts'

/** The two application roles an administrator may assign. */
export const ASSIGNABLE_ROLES = ['user', 'administrator'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value)
}

/** One row of `app_modules`, as the console reads it. */
export interface ModuleRegistryRow {
  module_key: string
  label?: string | null
  display_order?: number | null
  default_for_member?: boolean | null
}

/**
 * The module switches a NEW MEMBER's invitation form starts from.
 *
 * THIS IS FORM INITIALIZATION AND NOTHING ELSE. `default_for_member` is
 * provisioning metadata; it is never consulted at runtime, and saving must write
 * explicit `user_module_grants` rows for whatever the administrator actually left
 * switched on. `tests/userProvisioning.test.ts` asserts that this function is the
 * ONLY reader of the flag outside the registry query itself, and the module rule
 * in `auth/moduleAccess.ts` has no access to it at all.
 *
 * Unknown registry keys are dropped rather than offered: a module this build does
 * not declare cannot be granted meaningfully, and showing a switch for it would
 * invite an administrator to think they had granted something.
 */
export function defaultModulesForNewMember(registry: readonly ModuleRegistryRow[]): ModuleKey[] {
  const on = new Set(
    registry.filter((r) => r.default_for_member === true).map((r) => r.module_key),
  )
  return APP_MODULE_KEYS.filter((k) => on.has(k))
}

/** Normalizes a requested module list. Returns null when anything is unrecognised. */
export function normalizeModules(value: unknown): ModuleKey[] | null {
  if (!Array.isArray(value)) return null
  const out = new Set<ModuleKey>()
  for (const entry of value) {
    if (!isModuleKey(entry)) return null
    out.add(entry)
  }
  // Canonical order, deduplicated — so two requests that mean the same thing
  // produce byte-identical writes and byte-identical audit rows.
  return APP_MODULE_KEYS.filter((k) => out.has(k))
}

/** The account shape an administrator asked for, after validation. */
export interface AccountShape {
  readonly role: AssignableRole
  readonly principal: PortfolioPrincipal | null
  readonly modules: ModuleKey[]
}

export type ShapeDenialCode =
  | 'invalid_role'
  | 'invalid_principal'
  | 'invalid_module'

export type ShapeResult =
  | { readonly ok: true; readonly shape: AccountShape }
  | { readonly ok: false; readonly code: ShapeDenialCode }

/**
 * Validates and CANONICALIZES a requested account shape.
 *
 * THE ADMINISTRATOR CANONICALIZATION, stated once here and mirrored in
 * `nmi_admin_provision_invite` / `nmi_admin_update_access` so the API and the
 * database cannot disagree:
 *
 *   role = administrator  ->  principal := null, modules := []
 *
 * Both because an administrator already holds every module by role and every
 * Portfolio scope by role, so stored grants and a stored principal would be
 * decoration that changes nothing — until the account is DEMOTED, at which point
 * they would silently spring to life and hand the new member an access set nobody
 * chose. Canonicalizing at write time means a demotion always starts from an
 * explicit, deliberate module selection (§17), never from a fossil.
 *
 * The invariant is therefore: an administrator's stored grants are empty, and
 * demotion REQUIRES the caller to supply the module set they want.
 */
export function resolveAccountShape(input: {
  role: unknown
  principal: unknown
  modules: unknown
}): ShapeResult {
  if (!isAssignableRole(input.role)) return { ok: false, code: 'invalid_role' }

  const rawPrincipal =
    input.principal === null || input.principal === undefined || input.principal === ''
      ? null
      : input.principal
  if (rawPrincipal !== null && !isPortfolioPrincipal(rawPrincipal)) {
    return { ok: false, code: 'invalid_principal' }
  }

  if (input.role === 'administrator') {
    // Modules are still VALIDATED before being discarded: silently accepting junk
    // would let a malformed request look successful.
    if (input.modules !== undefined && input.modules !== null && normalizeModules(input.modules) === null) {
      return { ok: false, code: 'invalid_module' }
    }
    return { ok: true, shape: { role: 'administrator', principal: null, modules: [] } }
  }

  const modules = normalizeModules(input.modules ?? [])
  if (modules === null) return { ok: false, code: 'invalid_module' }

  return { ok: true, shape: { role: 'user', principal: rawPrincipal, modules } }
}

/**
 * The Portfolio scopes this shape would actually produce, once activated.
 *
 * Composed from the FROZEN ceiling (`scopesFor`) masked by the module grants
 * (`portfolioVisibleScopes`) — the identical composition the runtime uses, so the
 * console can never promise a scope the application would refuse.
 *
 * The ceiling can only be SUBTRACTED from. There is no argument to this function
 * that widens it, which is what makes "a module grant broadens a principal's
 * ceiling" unrepresentable rather than merely rejected.
 */
export function projectedPortfolioScopes(shape: AccountShape): FamilyPortfolioScope[] {
  const entitlement = {
    isApproved: true,
    isAdministrator: shape.role === 'administrator',
    principal: shape.principal,
  }
  const access = {
    isApproved: true,
    isAdministrator: shape.role === 'administrator',
    grants: shape.modules as readonly string[],
  }
  return portfolioVisibleScopes(entitlement, access)
}

/** The immutable ceiling for a principal, independent of any module grant. */
export function principalCeiling(
  principal: PortfolioPrincipal | null,
  role: AssignableRole = 'user',
): FamilyPortfolioScope[] {
  return scopesFor({
    isApproved: true,
    isAdministrator: role === 'administrator',
    principal,
  })
}

/**
 * Advisory warnings the console must show BEFORE saving.
 *
 * Every one of these describes a configuration that is LEGAL and will be saved
 * exactly as asked. None of them is a validation error, and none of them causes a
 * module to be switched on or off behind the administrator's back — §8 is explicit
 * that a zero-module member must be creatable and must not be silently "fixed".
 */
export const PROVISIONING_WARNINGS = {
  /**
   * §8 — a member with no modules can complete activation and then cannot enter.
   * Worth saying plainly, because the account will look fine in the directory
   * while the person on the other end sees a locked door.
   */
  noModules: 'no_modules',
  /**
   * §9 — Portfolio is granted but no principal is set, so the ceiling is empty and
   * the module grants nothing. Deliberately NOT auto-assigning a principal and
   * deliberately NOT manufacturing `main`: which family portfolio someone may see
   * is not a default anyone should infer.
   */
  portfolioWithoutPrincipal: 'portfolio_without_principal',
  /**
   * §9 inverse — a principal is set but Portfolio is not granted, so the personal
   * scope is masked away. Also legal (the person may be here only for Markets),
   * but almost always a mistake worth surfacing.
   */
  principalWithoutPortfolio: 'principal_without_portfolio',
} as const

export type ProvisioningWarning =
  (typeof PROVISIONING_WARNINGS)[keyof typeof PROVISIONING_WARNINGS]

export function provisioningWarnings(shape: AccountShape): ProvisioningWarning[] {
  // An administrator holds everything by role: none of the three conditions can
  // arise, and reporting them would be noise on a form whose switches are disabled.
  if (shape.role === 'administrator') return []

  const warnings: ProvisioningWarning[] = []
  const hasPortfolio = shape.modules.includes('portfolio')

  if (shape.modules.length === 0) warnings.push(PROVISIONING_WARNINGS.noModules)
  if (hasPortfolio && shape.principal === null) {
    warnings.push(PROVISIONING_WARNINGS.portfolioWithoutPrincipal)
  }
  if (!hasPortfolio && shape.principal !== null) {
    warnings.push(PROVISIONING_WARNINGS.principalWithoutPortfolio)
  }
  return warnings
}

/** The principals an administrator may choose, plus the "none" option. */
export const PRINCIPAL_OPTIONS: readonly (PortfolioPrincipal | null)[] = [
  null,
  ...PORTFOLIO_PRINCIPALS,
]

export type { PortfolioPrincipal, FamilyPortfolioScope, ModuleKey }
