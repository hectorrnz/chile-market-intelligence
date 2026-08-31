// POST-R13.6B — the ROUTE → MODULE binding, in one place.
//
// `accessPolicy.ts` answers "does this path need an approved session?".
// `moduleAccess.ts` answers "may this account reach this module?". This file is
// the only thing that connects the two: it says which module, if any, owns a
// given path.
//
// PURE DATA + one resolver. No Next.js, Supabase or environment import.
//
// NOT WIRED YET. POST-R13.6E integrates this into middleware and navigation.
// Adding it now, with tests, is what makes the future-module default-deny
// property provable before anything depends on it.
//
// FOUR OUTCOMES, NOT TWO. A private path is not simply "module X" or "no
// module" — the product genuinely has four kinds of private surface, and
// collapsing them would either lock members out of Settings or leave
// administrative surfaces ungated:
//
//   module              a grantable module owns this path
//   always_available    approved members always reach it: Overview and personal
//                       Settings. Overview must instead OMIT content from
//                       modules the member cannot reach (a 6E requirement, not a
//                       6B behaviour).
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

import type { ModuleKey } from './moduleAccess.ts'

export type PathModuleBinding =
  | { readonly kind: 'module'; readonly module: ModuleKey }
  | { readonly kind: 'always_available' }
  | { readonly kind: 'administrator_only' }
  | { readonly kind: 'unmapped' }

interface BindingEntry {
  /** Path prefix, matched segment-aware (never a bare `startsWith`). */
  readonly base: string
  readonly binding: PathModuleBinding
}

const UNMAPPED: PathModuleBinding = { kind: 'unmapped' }
const ALWAYS: PathModuleBinding = { kind: 'always_available' }
const ADMIN_ONLY: PathModuleBinding = { kind: 'administrator_only' }
const mod = (module: ModuleKey): PathModuleBinding => ({ kind: 'module', module })

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
  // ── Overview: always available, must filter its own content in 6E ─────────
  { base: '/', binding: ALWAYS },
  { base: '/api/news', binding: ALWAYS },
  { base: '/api/notifications', binding: ALWAYS },

  // ── Personal Settings: account infrastructure, not a grantable module ─────
  { base: '/settings', binding: ALWAYS },
  { base: '/api/health/ingestion', binding: ALWAYS },

  // ── Administrator-only ROLE capabilities ──────────────────────────────────
  // Notification-recipient administration edits the outbound family email
  // distribution list. It is never member-configurable and never a module.
  { base: '/settings/notifications', binding: ADMIN_ONLY },
  { base: '/api/notification-recipients', binding: ADMIN_ONLY },
  // The Portfolio publication console.
  { base: '/portfolio/admin', binding: ADMIN_ONLY },
  { base: '/api/family-portfolio/admin', binding: ADMIN_ONLY },

  // ── Markets (Watchlist follows Markets, keeping its own per-user RLS) ─────
  { base: '/stocks', binding: mod('markets') },
  { base: '/companies', binding: mod('markets') },
  { base: '/watchlist', binding: mod('markets') },
  { base: '/api/market', binding: mod('markets') },
  { base: '/api/watchlists', binding: mod('markets') },
  { base: '/api/valuation', binding: mod('markets') },

  // ── Analysis ──────────────────────────────────────────────────────────────
  { base: '/compare', binding: mod('analysis') },
  { base: '/chart-builder', binding: mod('analysis') },
  { base: '/api/compare', binding: mod('analysis') },
  { base: '/api/financials', binding: mod('analysis') },

  // ── Macro ─────────────────────────────────────────────────────────────────
  { base: '/macro', binding: mod('macro') },
  { base: '/api/macro', binding: mod('macro') },

  // ── Earnings ──────────────────────────────────────────────────────────────
  { base: '/earnings', binding: mod('earnings') },
  { base: '/api/earnings', binding: mod('earnings') },

  // ── Alternatives: a distinct module over the shared `alternatives` scope ──
  // Declared BEFORE Portfolio conceptually; ordering is handled by sorting.
  { base: '/portfolio/alternatives', binding: mod('alternatives') },
  { base: '/api/family-portfolio/alternatives', binding: mod('alternatives') },

  // ── Portfolio proper ──────────────────────────────────────────────────────
  { base: '/portfolio', binding: mod('portfolio') },
  { base: '/api/family-portfolio', binding: mod('portfolio') },

  // ── Structured Notes ──────────────────────────────────────────────────────
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
 * `'/'` is special-cased to an EXACT match. Treated as an ordinary prefix it
 * would match every path in the application and make the whole table
 * unreachable — turning the Overview entry into a blanket allow.
 */
function matchesBase(pathname: string, base: string): boolean {
  if (base === '/') return pathname === '/'
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
    if (matchesBase(pathname, entry.base)) return entry.binding
  }
  return UNMAPPED
}

/**
 * The module owning a path, or null when the path is not owned by a grantable
 * module (always-available, administrator-only, or unmapped). Callers that need
 * to distinguish those three must use `resolvePathModule`.
 */
export function moduleForPath(pathname: string): ModuleKey | null {
  const binding = resolvePathModule(pathname)
  return binding.kind === 'module' ? binding.module : null
}

/** Every declared base, for tests and for future navigation work. */
export const DECLARED_MODULE_ROUTE_BASES: readonly string[] = BINDINGS.map((b) => b.base)
