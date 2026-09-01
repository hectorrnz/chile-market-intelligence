// POST-R13.6B — how a module grant composes with the Portfolio principal ceiling.
//
// PURE MODULE. No Next.js, Supabase or environment import.
//
// THE ONE SECURITY PROPERTY THIS FILE EXISTS TO GUARANTEE
// ──────────────────────────────────────────────────────
//
//     visible(user) = ceiling(user) ∩ mask(grants)
//
// A module grant SUBTRACTS within the ceiling. It can never add across it.
//
// That is true by construction, not by rule: set intersection is mathematically
// incapable of producing a member the left operand does not already contain. So
// even a fully-populated, corrupted, or maliciously-written `user_module_grants`
// table cannot give a Jaime member `andres` or `pablo`, because `ceiling` — the
// frozen `scopesFor()` — never contained them in the first place. The dangerous
// outcome is not merely rejected; it is unreachable.
//
// `entitlements.ts` IS FROZEN. This module composes with it and does not alter
// it. `scopesFor()`, `nmi_portfolio_scopes()` and the R13.1 truth table are
// byte-unchanged by POST-R13.6B — deliberately, because they are mirrored in SQL
// and asserted by an in-database truth table that executes at migration time.
// The mask is applied ABOVE the ceiling, in the application layer, so the
// database keeps enforcing the ceiling independently of anything here.
//
// WHY ALTERNATIVES IS A SEPARATE MODULE
// ────────────────────────────────────
// The `alternatives` scope is SHARED family data, not a personal portfolio, and
// it already has its own routes (`/portfolio/alternatives*`) and its own API
// (`/api/family-portfolio/alternatives`). Treating it as a distinct module is
// therefore not a new concept — it is naming a separation the product already
// has. It also makes the owner's "optionally Alternatives" requirement
// expressible without touching the ceiling: today every principal receives
// `alternatives` automatically, and the grant now decides whether they keep it.
//
// The consequence, stated plainly because the brief asked for it to be decided
// rather than left implicit: a member holding `alternatives` but NOT `portfolio`
// reaches the Alternatives sub-module only, and resolves to exactly
// `['alternatives']`. That is coherent — shared data, reached through its own
// module, with no personal portfolio attached — and it is what the two-module
// split means. It is not a loophole: `alternatives` is in every principal's
// ceiling already, so the intersection grants nothing new.

import {
  type EntitlementInput,
  type FamilyPortfolioScope,
  scopesFor,
} from './entitlements.ts'
import {
  type ModuleAccessInput,
  canAccessModule,
} from '../auth/moduleAccess.ts'

/**
 * Scopes reachable through the `portfolio` module: the Main Portfolio, the three
 * personal portfolios, and the administrative scope.
 *
 * Listing all three personal scopes here is NOT a grant of them. This is the
 * mask — the right-hand operand of an intersection whose left-hand operand is
 * the caller's own ceiling. A Jaime member's ceiling contains no `andres`, so
 * intersecting with this set can only ever yield `main` and `jaime`.
 */
const PORTFOLIO_MODULE_SCOPES: readonly FamilyPortfolioScope[] = [
  'main',
  'jaime',
  'andres',
  'pablo',
  'admin',
]

/** The single scope reachable through the `alternatives` module. */
const ALTERNATIVES_MODULE_SCOPES: readonly FamilyPortfolioScope[] = ['alternatives']

/**
 * The scope mask implied by a caller's module grants.
 *
 * Administrators pass `canAccessModule` on both modules by role, so their mask
 * is the union — and intersecting an administrator's full ceiling with it
 * returns the full ceiling, i.e. administrators are unaffected by grants.
 */
function moduleMask(access: ModuleAccessInput): Set<FamilyPortfolioScope> {
  const mask = new Set<FamilyPortfolioScope>()
  if (canAccessModule(access, 'portfolio')) {
    for (const s of PORTFOLIO_MODULE_SCOPES) mask.add(s)
  }
  if (canAccessModule(access, 'alternatives')) {
    for (const s of ALTERNATIVES_MODULE_SCOPES) mask.add(s)
  }
  return mask
}

/**
 * THE composition. Returns the scopes a caller may actually see, in canonical
 * order, after applying their module grants to their principal ceiling.
 *
 * Fail-closed properties:
 *   - unapproved                       -> [] (the ceiling is already empty)
 *   - no portfolio and no alternatives -> []
 *   - portfolio only                   -> ceiling minus `alternatives`
 *   - alternatives only                -> `['alternatives']` if in the ceiling
 *   - both                             -> the full ceiling, unchanged
 *   - administrator                    -> the full ceiling, grants irrelevant
 *
 * The result is always a subset of `scopesFor(entitlement)`. That invariant is
 * asserted exhaustively over every (role x principal x arbitrary grant subset)
 * combination in `tests/moduleEntitlements.test.ts`.
 */
export function portfolioVisibleScopes(
  entitlement: EntitlementInput,
  access: ModuleAccessInput,
): FamilyPortfolioScope[] {
  const ceiling = scopesFor(entitlement)
  const mask = moduleMask(access)
  // Filtering the ceiling — never building up from the mask — is what makes the
  // subset property structural. Reversing these operands would be the bug.
  return ceiling.filter((scope) => mask.has(scope))
}

/**
 * True when the caller may see one scope after module composition.
 *
 * `requested` is deliberately typed `unknown`: it routinely arrives from a URL
 * query parameter. `canReadScope` already denies a malformed value; this adds
 * the module mask on top and can only ever be MORE restrictive, never less.
 */
export function canViewScopeWithModules(
  entitlement: EntitlementInput,
  access: ModuleAccessInput,
  requested: unknown,
): boolean {
  if (typeof requested !== 'string') return false
  return (portfolioVisibleScopes(entitlement, access) as readonly string[]).includes(requested)
}
