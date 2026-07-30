// R1.5 — THE authoritative access policy for Nevada Market Intelligence.
//
// Nevada Market Intelligence is a private family-office platform. This module is
// the single source of truth for which paths may be reached without an
// authenticated session. It is deliberately DEFAULT-DENY: anything not matched
// by an explicit allowlist below is private, so a route added in a later phase
// is protected the moment it exists rather than the moment someone remembers to
// list it.
//
// Pure module — no Next.js, Supabase, or environment imports — so the policy can
// be exercised directly in tests and consumed identically by middleware and by
// server-side route guards. Do NOT re-derive these lists anywhere else.
//
// Before R1.5 the model was the inverse (an explicit PROTECTED_PAGES /
// PROTECTED_API denylist) and every route absent from those two arrays was
// world-readable — including the entire market, macro, earnings, financials,
// valuation, compare and news API surface.

/**
 * Browser routes reachable with no session. Only what sign-in and account
 * recovery genuinely require before a session can exist.
 *   /login                 — the sign-in gateway itself
 *   /forgot-password       — recovery request form
 *   /auth/reset-password   — recovery completion form, reached from the emailed
 *                            link via /auth/callback
 */
export const PUBLIC_PAGE_PATHS = [
  '/login',
  '/forgot-password',
  '/auth/reset-password',
] as const

/**
 * Session-minting / session-clearing endpoints. Public by necessity — they are
 * how a session comes into or goes out of existence.
 *   /auth/callback — Supabase PKCE code exchange (recovery links, any future
 *                    OAuth provider). Enforces the approval boundary itself.
 *   /logout        — must work with or without a session, or sign-out loops.
 */
export const SESSION_MINT_PATHS = [
  '/auth/callback',
  '/logout',
] as const

/**
 * API endpoints reachable with no session. Exactly the three the pre-session
 * flows call. NOTE: /api/auth/register is deliberately absent — public
 * self-registration was removed in R1.5 and the route no longer exists.
 */
export const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
] as const

/**
 * Endpoints that carry their own `Authorization: Bearer <secret>` check inside
 * the handler (CRON_SECRET / MARKET_INGEST_SECRET). Scheduled callers have no
 * session, so session gating must not apply — but these are NOT public: every
 * one fails closed on a missing or wrong bearer token.
 */
export const BEARER_AUTH_API_PREFIXES = ['/api/cron'] as const

/**
 * Framework and static prefixes that must never be gated. The middleware
 * matcher already excludes most of these; they are repeated here so the policy
 * is correct on its own terms and stays correct if the matcher is ever widened.
 */
export const FRAMEWORK_PATH_PREFIXES = ['/_next', '/__nextjs'] as const

/**
 * Static-asset extensions served from /public. Deliberately an ALLOWLIST rather
 * than "any path containing a dot": a broad dot heuristic would silently exempt
 * any private route whose dynamic segment happened to contain a period, and it
 * exempted attacker-chosen paths like `/%5C%5Cevil.example` from the gate
 * entirely. Mirrors the extensions excluded by the middleware matcher.
 */
export const STATIC_ASSET_EXTENSIONS = [
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.css', '.js', '.mjs', '.map', '.woff', '.woff2', '.ttf', '.otf',
  '.txt', '.xml', '.webmanifest', '.pdf',
] as const

/** Exact framework files served from the app root. */
export const FRAMEWORK_FILE_PATHS = [
  '/favicon.ico',
  '/favicon.svg',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
  '/manifest.webmanifest',
] as const

export type RouteClass =
  | 'framework'        // static / Next.js internals — never gated
  | 'public_page'      // pre-session browser route
  | 'session_mint'     // establishes or clears a session
  | 'public_api'       // pre-session JSON endpoint
  | 'bearer_auth_api'  // self-guarded scheduled endpoint
  | 'private_api'      // requires an approved session; denial must be JSON 401
  | 'private_page'     // requires an approved session; denial must redirect

/**
 * Segment-aware prefix match. `/login` matches `/login` and `/login/help` but
 * NOT `/loginfoo` — a plain `startsWith` would treat an attacker-chosen sibling
 * path as public.
 */
function matchesPath(pathname: string, base: string): boolean {
  if (pathname === base) return true
  return pathname.startsWith(base.endsWith('/') ? base : `${base}/`)
}

function matchesAny(pathname: string, bases: readonly string[]): boolean {
  return bases.some((base) => matchesPath(pathname, base))
}

/** True for `/api/**` — determines whether denial is JSON 401 or a redirect. */
export function isApiPath(pathname: string): boolean {
  return matchesPath(pathname, '/api')
}

/**
 * True for anything the protection model must leave completely alone: Next.js
 * internals, root-level framework files, and requests for a static asset with a
 * KNOWN extension (images, fonts, css, js, source maps, the login photograph…).
 *
 * Anything else — including a path that merely contains a period — is an
 * application route and is subject to the gate.
 */
export function isFrameworkPath(pathname: string): boolean {
  if (matchesAny(pathname, FRAMEWORK_PATH_PREFIXES)) return true
  if ((FRAMEWORK_FILE_PATHS as readonly string[]).includes(pathname)) return true
  const lower = pathname.toLowerCase()
  return STATIC_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Classifies any pathname under the default-deny policy. */
export function classifyPath(pathname: string): RouteClass {
  if (isFrameworkPath(pathname)) return 'framework'
  if (matchesAny(pathname, SESSION_MINT_PATHS)) return 'session_mint'

  if (isApiPath(pathname)) {
    if (matchesAny(pathname, BEARER_AUTH_API_PREFIXES)) return 'bearer_auth_api'
    if (matchesAny(pathname, PUBLIC_API_PATHS)) return 'public_api'
    return 'private_api'
  }

  if (matchesAny(pathname, PUBLIC_PAGE_PATHS)) return 'public_page'
  return 'private_page'
}

/**
 * THE gate predicate. True when a request for this path must present a valid
 * approved session. Default-deny: every class except the five explicitly
 * exempt ones requires a session.
 */
export function requiresApprovedSession(pathname: string): boolean {
  const routeClass = classifyPath(pathname)
  return routeClass === 'private_api' || routeClass === 'private_page'
}

/** True when an unauthenticated denial must be JSON rather than a redirect. */
export function deniesWithJson(pathname: string): boolean {
  return classifyPath(pathname) === 'private_api'
}
