// POST-R13.6CDE — the caller's OWN effective access, as one serializable fact.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, so the
// whole shape is unit-testable. The server resolver lives in
// `src/app/api/me/access/route.ts`; the client reads it through
// `src/lib/data/effectiveAccess.ts`.
//
// WHY THIS EXISTS
// ───────────────
// Before this stage the shell showed every module to every approved account and
// the Overview fetched every module's data unconditionally. Making navigation
// entitlement-aware needs the client to know what the caller may reach — and
// there was no honest way to tell it. Each surface guessing separately would
// mean several round-trips that can disagree with each other, which is exactly
// how a UI ends up offering a control the API refuses.
//
// So: ONE server resolution, derived from the same `moduleAccess.ts` rule the
// route guards and PostgreSQL use, delivered once and shared.
//
// PRESENTATION, NEVER PROTECTION
// ──────────────────────────────
// Everything here is for composition only. It describes the caller to itself and
// nothing else: it can only ever say "you may not", never "you may" in a way any
// server trusts. Every route handler re-derives authorization from the database
// on its own request, and PostgreSQL RLS holds underneath that. A caller who
// forged this payload entirely would change what their own browser draws and
// gain access to nothing — the established `/portfolio/admin` model, where the
// client is presentation and the server is protection.
//
// THE PORTFOLIO CEILING IS NOT NEGOTIABLE HERE EITHER
// ───────────────────────────────────────────────────
// `portfolioScopes` is the OUTPUT of `portfolioVisibleScopes()` — the frozen
// principal ceiling intersected with the module mask. It is computed on the
// server and only ever narrows. Nothing in this file can widen it, and the UI
// renders it as a derived statement rather than as editable checkboxes, because
// a sibling's personal portfolio is not a thing anyone can be granted.

import { APP_MODULE_KEYS, type ModuleKey } from './moduleAccess.ts'
import type { FamilyPortfolioScope, PortfolioPrincipal } from '../portfolioAccess/entitlements.ts'

/**
 * How the resolution ended.
 *
 * `unavailable` is NOT a denial: it means the entitlement store could not be
 * read, so no answer was reached. The shell must render it as a degraded state,
 * never as "you have no modules" — that would tell an administrator they had
 * lost access when the truth is that the deployment's database is behind its
 * code. See `getModuleAccess.ts` § "denial is not the same as unavailability".
 */
export type EffectiveAccessStatus = 'ok' | 'unauthenticated' | 'unavailable'

/** Everything a client surface may know about the caller's own reach. */
export interface EffectiveAccess {
  status: EffectiveAccessStatus
  /** Non-empty `user_profiles.username` — the platform approval marker. */
  isApproved: boolean
  isAdministrator: boolean
  /** Modules the caller may reach, canonical order. Administrators hold all. */
  modules: ModuleKey[]
  /** Ceiling ∩ module mask. Already narrowed; never widened on the client. */
  portfolioScopes: FamilyPortfolioScope[]
  /** The caller's own principal, for the derived "Main + Jaime" statement. */
  principal: PortfolioPrincipal | null
}

/**
 * The safe default: reachable nothing.
 *
 * Used before the fetch resolves and whenever it fails. A shell that renders
 * this shows Overview and Settings only — never a module it has not been told
 * the caller may reach. Optimistically showing everything and hiding it later
 * would flash denied modules on every page load.
 */
export const NO_ACCESS: EffectiveAccess = {
  status: 'unauthenticated',
  isApproved: false,
  isAdministrator: false,
  modules: [],
  portfolioScopes: [],
  principal: null,
}

/** Narrows a value read back from JSON to a known module key. */
function moduleKeysOf(value: unknown): ModuleKey[] {
  if (!Array.isArray(value)) return []
  const seen = new Set(value.filter((v): v is string => typeof v === 'string'))
  // Filtering the CANONICAL list rather than the input both orders the result
  // and drops anything this build does not recognise — a payload naming a
  // module that does not exist here can never produce one.
  return APP_MODULE_KEYS.filter((k) => seen.has(k))
}

const SCOPES: readonly FamilyPortfolioScope[] = ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin']
const PRINCIPALS: readonly PortfolioPrincipal[] = ['jaime', 'andres', 'pablo']

function scopesOf(value: unknown): FamilyPortfolioScope[] {
  if (!Array.isArray(value)) return []
  const seen = new Set(value.filter((v): v is string => typeof v === 'string'))
  return SCOPES.filter((s) => seen.has(s))
}

function principalOf(value: unknown): PortfolioPrincipal | null {
  return typeof value === 'string' && (PRINCIPALS as readonly string[]).includes(value)
    ? (value as PortfolioPrincipal)
    : null
}

/**
 * Parses an `/api/me/access` payload defensively.
 *
 * Every field is validated against this build's own vocabulary rather than
 * trusted, so a malformed or hostile body degrades to less access, never more.
 */
export function parseEffectiveAccess(body: unknown): EffectiveAccess {
  if (typeof body !== 'object' || body === null) return NO_ACCESS
  const b = body as Record<string, unknown>
  const status: EffectiveAccessStatus =
    b.status === 'ok' ? 'ok' : b.status === 'unavailable' ? 'unavailable' : 'unauthenticated'
  // A non-ok status carries no entitlement, whatever else the body claims.
  if (status !== 'ok') return { ...NO_ACCESS, status }
  return {
    status,
    isApproved: b.isApproved === true,
    isAdministrator: b.isAdministrator === true,
    modules: moduleKeysOf(b.modules),
    portfolioScopes: scopesOf(b.portfolioScopes),
    principal: principalOf(b.principal),
  }
}

/** True when the caller may reach `module`, per this resolved snapshot. */
export function hasModule(access: EffectiveAccess, module: ModuleKey): boolean {
  return access.status === 'ok' && access.isApproved && access.modules.includes(module)
}

/**
 * The Portfolio destination a caller should land on, or null when neither
 * sub-module is reachable.
 *
 * `portfolio` and `alternatives` are independently grantable (see
 * `portfolioModuleComposition.ts`), so "Portfolio" is not one destination but a
 * family. A member holding only `alternatives` still needs a coherent route to
 * it, and must not be sent to a personal-portfolio page that would deny them.
 */
export function portfolioLandingHref(access: EffectiveAccess): string | null {
  if (hasModule(access, 'portfolio')) return '/portfolio'
  if (hasModule(access, 'alternatives')) return '/portfolio/alternatives'
  return null
}

/**
 * The caller's Portfolio scopes as a display statement, e.g. "Main + Jaime".
 *
 * Deliberately a STATEMENT and not a control. `andres` and `pablo` are absent
 * from a Jaime member's ceiling entirely, so rendering unchecked boxes for them
 * would imply they are grantable. They are not, and no UI in this application
 * may suggest otherwise.
 */
export function describePortfolioScopes(
  scopes: readonly FamilyPortfolioScope[],
  labels: Partial<Record<FamilyPortfolioScope, string>> = {},
): string[] {
  return SCOPES.filter((s) => scopes.includes(s)).map((s) => labels[s] ?? s)
}
