// POST-R13.6B — the ROUTE → MODULE binding, in one place.
//
// `accessPolicy.ts` answers "does this path need an approved session?".
// `moduleAccess.ts` answers "may this account reach this module?". This file is
// the only thing that connects the two: it says which module, if any, owns a
// given path.
//
// PURE DATA + one resolver. No Next.js, Supabase or environment import.
//
// WIRED BY POST-R13.6CDE.2. Until that stage this table had no production
// consumer at all: `requestAccess.ts` asked only whether the caller could ENTER
// the platform, so an approved member holding one module reached every private
// page and API in the application simply by typing its URL. Step B of the
// request decision now resolves every private path through this table.
//
// FIVE OUTCOMES, NOT TWO. A private path is not simply "module X" or "no
// module" — the product genuinely has five kinds of private surface, and
// collapsing them would either lock members out of Settings or leave
// administrative surfaces ungated:
//
//   module              a grantable module owns this path
//   module_any          a FAMILY surface owned jointly by several modules and
//                       reachable by holding ANY one of them. Exactly ONE path
//                       needs it today — the Portfolio scope resolver, which the
//                       Portfolio layout mounts for the Alternatives pages too,
//                       and which already returns scopes narrowed by the module
//                       mask. It is deliberately NOT a general escape hatch:
//                       `module_any` widens reach, so every entry must name a
//                       genuinely shared surface and say why it leaks nothing.
//   always_available    every caller who passed the PLATFORM boundary reaches
//                       it: Overview, personal Settings, and the shell's own
//                       endpoints. Overview instead OMITS content from modules
//                       the member cannot reach. These bases are `exact` unless
//                       they have real children — see `BindingEntry.exact`.
//   administrator_only  a ROLE capability: the Portfolio publication console and
//                       notification-recipient administration. Never grantable,
//                       never a module key.
//   unmapped            DENY. A route added in a later phase is unreachable
//                       until it is declared here — the same default-deny
//                       posture `accessPolicy.ts` already takes for sessions.
//
// SPECIFICITY IS RESOLVED BY SORTING, NOT BY AUTHORING ORDER. `/portfolio/admin`
// is administrator-only while `/portfolio` is a module, and `/portfolio/
// alternatives` is a different module again. If matching depended on the order
// entries happen to be written in, a future insertion in the wrong place would
// silently downgrade an administrative path to a member module — a mistake that
// produces no error and no test failure unless something checks for it. The
// table is therefore sorted longest-base-first at module load, so the most
// specific declaration always wins regardless of how it was written.

import { canAccessModule, type ModuleAccessInput, type ModuleKey } from './moduleAccess.ts'

export type PathModuleBinding =
  | { readonly kind: 'module'; readonly module: ModuleKey }
  /** Reachable by holding ANY of these modules. Never empty. */
  | { readonly kind: 'module_any'; readonly modules: readonly ModuleKey[] }
  | { readonly kind: 'always_available' }
  | { readonly kind: 'administrator_only' }
  | { readonly kind: 'unmapped' }

interface BindingEntry {
  /** Path prefix, matched segment-aware (never a bare `startsWith`). */
  readonly base: string
  readonly binding: PathModuleBinding
  /**
   * Match this base EXACTLY, never as a prefix.
   *
   * Used for every `always_available` surface that has no legitimate children.
   * A prefix entry hands its whole subtree the same binding, and for an
   * always-available base that means a route added later inherits "every member
   * may reach this" silently — the exact opposite of the default-deny posture
   * this table exists to enforce. `/settings/billing` would have been reachable
   * by every member the moment the file was created, with no test failing.
   *
   * Bases with real children (`/api/notifications/<id>/read`) stay prefixes:
   * there the subtree genuinely belongs to the same surface. Module and
   * administrator bases stay prefixes too — inheriting "you need this module"
   * or "you need this role" is fail-closed, not fail-open.
   */
  readonly exact?: boolean
}

const UNMAPPED: PathModuleBinding = { kind: 'unmapped' }
const ALWAYS: PathModuleBinding = { kind: 'always_available' }
const ADMIN_ONLY: PathModuleBinding = { kind: 'administrator_only' }
const mod = (module: ModuleKey): PathModuleBinding => ({ kind: 'module', module })
const modAny = (modules: readonly ModuleKey[]): PathModuleBinding =>
  ({ kind: 'module_any', modules })

/**
 * Every private page and API path the application serves today, bound to the
 * module that owns it.
 *
 * Public, session-mint, bearer-auth and framework paths are deliberately absent:
 * `classifyPath()` in `accessPolicy.ts` already exempts them before module
 * resolution is ever reached, and repeating them here would create a second
 * place for the exemption list to drift.
 */
const BINDINGS: readonly BindingEntry[] = [
  // -- Overview: always available, filters its own content per module --------
  { base: '/', binding: ALWAYS, exact: true },
  { base: '/api/news', binding: ALWAYS },
  { base: '/api/notifications', binding: ALWAYS },
  // The shell's own entitlement snapshot. It must be reachable by anyone who
  // passed the platform boundary, because it is what tells the shell which
  // modules to draw: gating it behind a module would make the answer depend on
  // the question. It is SELF-only and authorises nothing — see the route header.
  { base: '/api/me/access', binding: ALWAYS, exact: true },

  // -- Personal Settings: account infrastructure, not a grantable module -----
  { base: '/settings', binding: ALWAYS, exact: true },
  { base: '/api/health/ingestion', binding: ALWAYS, exact: true },

  // -- Administrator-only ROLE capabilities ----------------------------------
  // Notification-recipient administration edits the outbound family email
  // distribution list. It is never member-configurable and never a module.
  { base: '/settings/notifications', binding: ADMIN_ONLY },
  { base: '/api/notification-recipients', binding: ADMIN_ONLY },
  // The Users & Access console. It sits UNDER `/settings`, which is
  // always-available, so without this entry the sort resolves it through the
  // shorter `/settings` base and the table would classify the administrator
  // console as reachable by every member. Its page re-checks the role
  // server-side regardless, but a table that says "always available" about it
  // is wrong on its face and would be copied by the next reader.
  { base: '/settings/users', binding: ADMIN_ONLY },
  { base: '/api/admin', binding: ADMIN_ONLY },
  // The Portfolio publication console.
  { base: '/portfolio/admin', binding: ADMIN_ONLY },
  { base: '/api/family-portfolio/admin', binding: ADMIN_ONLY },

  // -- Markets (Watchlist follows Markets, keeping its own per-user RLS) -----
  { base: '/stocks', binding: mod('markets') },
  { base: '/companies', binding: mod('markets') },
  { base: '/watchlist', binding: mod('markets') },
  { base: '/api/market', binding: mod('markets') },
  { base: '/api/watchlists', binding: mod('markets') },
  { base: '/api/valuation', binding: mod('markets') },

  // -- Analysis --------------------------------------------------------------
  { base: '/compare', binding: mod('analysis') },
  { base: '/chart-builder', binding: mod('analysis') },
  { base: '/api/compare', binding: mod('analysis') },
  { base: '/api/financials', binding: mod('analysis') },

  // -- Macro -----------------------------------------------------------------
  { base: '/macro', binding: mod('macro') },
  { base: '/api/macro', binding: mod('macro') },

  // -- Earnings --------------------------------------------------------------
  { base: '/earnings', binding: mod('earnings') },
  { base: '/api/earnings', binding: mod('earnings') },

  // -- Alternatives: a distinct module over the shared `alternatives` scope --
  // Declared BEFORE Portfolio conceptually; ordering is handled by sorting.
  { base: '/portfolio/alternatives', binding: mod('alternatives') },
  { base: '/api/family-portfolio/alternatives', binding: mod('alternatives') },

  // -- The one Portfolio FAMILY surface: either module reaches the ROUTE -----
  // `/api/family-portfolio/scopes` is a shared ENTRY POINT, not portfolio data.
  // The Portfolio layout mounts it for the Alternatives pages as well, so an
  // alternatives-only member genuinely needs it; and it returns
  // `portfolioVisibleScopes` — the principal ceiling ALREADY intersected with
  // the module mask — so `module_any` widens reach to the route only and can
  // never widen reach to another principal's data.
  //
  // Nothing else in the family qualifies. `/api/family-portfolio/overview`
  // deliberately does NOT: it serves `main` and the three personal scopes and
  // 404s on `alternatives`, so it is portfolio data outright and an
  // alternatives-only caller has nothing to read there. Binding it to
  // `portfolio` also improves the Overview card, which now shows an honest
  // "denied" instead of an "error" produced by that 404.
  { base: '/api/family-portfolio/scopes', binding: modAny(['portfolio', 'alternatives']) },

  // -- Portfolio proper ------------------------------------------------------
  { base: '/portfolio', binding: mod('portfolio') },
  { base: '/api/family-portfolio', binding: mod('portfolio') },

  // -- Structured Notes ------------------------------------------------------
  { base: '/structured-notes', binding: mod('structured_notes') },
  { base: '/api/structured-notes', binding: mod('structured_notes') },
]

/**
 * Sorted most-specific-first. A longer base is always a more specific
 * declaration, so `/portfolio/alternatives` is tested before `/portfolio` and
 * `/api/family-portfolio/admin` before `/api/family-portfolio`, whatever order
 * the table above happens to be written in.
 *
 * `'/'` sorts last, which is exactly right: it is the least specific entry and
 * must only match the Overview root itself (see `matchesBase`).
 */
const SORTED: readonly BindingEntry[] = [...BINDINGS].sort(
  (a, b) => b.base.length - a.base.length,
)

/**
 * Segment-aware prefix match, matching `accessPolicy.ts`'s `matchesPath`.
 * `/macro` matches `/macro` and `/macro/calendar` but NOT `/macrofoo` — a plain
 * `startsWith` would bind an attacker-chosen sibling path to a module the caller
 * holds.
 *
 * An `exact` entry matches only itself. `'/'` must be exact or it would match
 * every path in the application and turn the Overview entry into a blanket
 * allow; the other exact entries are always-available bases with no legitimate
 * children, where prefix inheritance would be fail-OPEN.
 */
function matchesBase(pathname: string, entry: BindingEntry): boolean {
  const { base } = entry
  if (entry.exact === true || base === '/') return pathname === base
  if (pathname === base) return true
  return pathname.startsWith(base.endsWith('/') ? base : `${base}/`)
}

/**
 * Resolves the module binding for a path. Returns `{ kind: 'unmapped' }` for
 * anything not declared above — which the policy engine must treat as a denial.
 */
export function resolvePathModule(pathname: string): PathModuleBinding {
  if (typeof pathname !== 'string' || pathname.length === 0) return UNMAPPED
  for (const entry of SORTED) {
    if (matchesBase(pathname, entry)) return entry.binding
  }
  return UNMAPPED
}

/**
 * The SINGLE module owning a path, or null.
 *
 * Null for always-available, administrator-only and unmapped paths — and also
 * for a `module_any` family surface, which by definition has no single owner.
 * Returning one of several here would let a caller check the wrong one, so
 * anything making an authorization decision must use `resolvePathModule` (or
 * `bindingSatisfiedBy`) and handle every kind explicitly.
 */
export function moduleForPath(pathname: string): ModuleKey | null {
  const binding = resolvePathModule(pathname)
  return binding.kind === 'module' ? binding.module : null
}

/**
 * Whether a caller's module access satisfies a path binding.
 *
 * THE Step-B predicate, in one place so middleware and any future server guard
 * cannot answer it differently. Fail-closed in every direction:
 *
 *   always_available    -> yes (the caller already passed the platform boundary)
 *   module              -> the explicit grant, or administrator by role
 *   module_any          -> ANY one of them, so an alternatives-only member
 *                          reaches a shared Portfolio-family entry point
 *   administrator_only  -> role only; a module grant can never satisfy it
 *   unmapped            -> NO, administrators included. A private surface added
 *                          later is unreachable until it is deliberately
 *                          classified here, which is the whole point of the
 *                          default-deny posture. Exempting administrators would
 *                          hide the omission from the only person able to fix
 *                          it, and it is a routing bug, not an entitlement one.
 */
export function bindingSatisfiedBy(
  binding: PathModuleBinding,
  access: ModuleAccessInput,
): boolean {
  switch (binding.kind) {
    case 'always_available':
      return true
    case 'module':
      return canAccessModule(access, binding.module)
    case 'module_any':
      return binding.modules.some((m) => canAccessModule(access, m))
    case 'administrator_only':
      return access.isApproved === true && access.isAdministrator === true
    case 'unmapped':
      return false
  }
}

/** Every declared base, for tests and for future navigation work. */
export const DECLARED_MODULE_ROUTE_BASES: readonly string[] = BINDINGS.map((b) => b.base)
