// R1.5 — Default-deny gate with VERIFIED identity and PER-REQUEST approval.
//
// Nevada Market Intelligence is a private family-office platform: nothing but
// sign-in and account recovery is reachable without an approved session.
//
// Responsibilities:
//   1. Refresh Supabase Auth session cookies so Server Components and Route
//      Handlers see fresh session state.
//   2. For every path the shared policy marks private, verify the identity with
//      the Auth server and re-read the approval record, then allow, redirect, or
//      answer JSON — per `decideRequestAccess`.
//
// The allowlist lives in `src/lib/auth/accessPolicy.ts` and is DEFAULT-DENY, so
// a route added in a later phase is protected the moment it exists. The decision
// table lives in `src/lib/auth/requestAccess.ts` and is unit-tested against
// every case; this file only binds it to Supabase and to HTTP.
//
// POST-R13.6CDE.1 adds the PLATFORM-ACCESS BOUNDARY to the same gate: an
// approved account that holds no module at all is refused the application
// entirely — Overview and personal Settings included — because approval now
// means the account exists and entitlement is what admits it. Refusing here is
// what makes § 4 true: the shell never renders, so a zero-grant member never
// issues the private requests the shell would have made on load.
//
// POST-R13.6CDE.2 adds the SECOND layer to the same gate: entering the platform
// is not entering every module. Each private path is resolved through
// `moduleRoutes.ts` and refused unless the caller's grants satisfy it, so a
// member holding `macro` alone can no longer reach Stocks or Portfolio by
// typing the URL. Denials stay in their route's own language — a page redirects,
// an API answers JSON — because `json` is computed from the route class before
// any authorization reasoning happens.
//
// LATENCY. A private request costs exactly TWO sequential Supabase round-trips,
// for every caller and every route: `auth.getUser()` (verifies the JWT with the
// Auth server — this is what rejects forged, expired, revoked, banned and
// deleted identities) and ONE authorization-state read. POST-R13.6CDE.1 needed a
// third for members, because approval and grants were fetched separately;
// POST-R13.6CDE.2 embeds the grants in the profile read, so the extra
// round-trip is gone AND both facts now come from one snapshot that cannot
// disagree with itself. The earlier zero-network `getSession()` gate was faster
// still but authorised from unverified cookie state and could not revoke
// promptly; correctness wins. See docs/security_access_control.md §
// "Verified session".
//
// Bearer-token endpoints (/api/cron/*) are classified `bearer_auth_api` and are
// left untouched: each validates CRON_SECRET / MARKET_INGEST_SECRET itself and
// fails closed, and scheduled callers have no session.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'
import { requiresApprovedSession, deniesWithJson } from '@/lib/auth/accessPolicy'
import { buildLoginRedirectPath } from '@/lib/auth/safeRedirect'
import { ACCESS_DENIED_REASONS } from '@/lib/auth/approval'
import {
  decideRequestAccess,
  shouldClearSession,
  type AccessDecision,
  type DenialReason,
} from '@/lib/auth/requestAccess'
import {
  parseAuthorizationRow,
  AUTHORIZATION_STATE_SELECT,
  type AuthorizationRow,
  type AuthorizationStateResult,
} from '@/lib/auth/authorizationState'

/** A denial must never be cached by the browser, a CDN, or a shared proxy. */
const NO_STORE = 'no-store, no-cache, must-revalidate, private'

/** Supabase writes its session under `sb-*` cookies. */
const SESSION_COOKIE_PREFIX = 'sb-'

const REASON_TO_CODE: Record<DenialReason, string> = {
  unauthenticated: ACCESS_DENIED_REASONS.unauthenticated,
  not_approved: ACCESS_DENIED_REASONS.notApproved,
  no_platform_access: ACCESS_DENIED_REASONS.noPlatformAccess,
  module_not_granted: ACCESS_DENIED_REASONS.moduleNotGranted,
  administrator_required: ACCESS_DENIED_REASONS.administratorRequired,
  access_unavailable: ACCESS_DENIED_REASONS.accessUnavailable,
}

/**
 * The `?error=` value the login gateway renders for a page denial.
 *
 * `unauthenticated` is absent on purpose: there is nothing to explain, and a
 * banner would appear every time a session simply expired.
 */
const PAGE_ERROR_PARAM: Partial<Record<DenialReason, string>> = {
  not_approved: 'not_authorized',
  no_platform_access: ACCESS_DENIED_REASONS.noPlatformAccess,
  module_not_granted: ACCESS_DENIED_REASONS.moduleNotGranted,
  administrator_required: ACCESS_DENIED_REASONS.administratorRequired,
  access_unavailable: ACCESS_DENIED_REASONS.accessUnavailable,
}

/**
 * Whether the original destination is worth carrying through `?next=`.
 *
 * Only when the caller has no usable session yet. `not_approved` clears the
 * cookies, so signing in as a different, approved account and landing on the
 * requested page is exactly right. Every other reason KEEPS the session:
 * replaying `next` would send the very same account straight back into the very
 * same denial, so the gateway would look like it were bouncing. Landing on a
 * plain `/login?error=…` is terminal and readable, and no automatic redirect
 * follows it — the login page never forwards an existing session into the app,
 * so there is no loop to enter.
 *
 * This covers the POST-R13.6CDE.2 reasons for free: a member who typed the URL
 * of a module they do not hold must not have that URL replayed after signing in
 * again, because holding the module is what was missing, not the session.
 */
function carriesNext(reason: DenialReason): boolean {
  return reason === 'unauthenticated' || reason === 'not_approved'
}

/** JSON 401/403 for a private API route. Carries only a reason code. */
function apiDenial(decision: Extract<AccessDecision, { outcome: 'deny' }>): NextResponse {
  return NextResponse.json(
    { error: REASON_TO_CODE[decision.reason] },
    { status: decision.status, headers: { 'Cache-Control': NO_STORE } },
  )
}

/**
 * Redirect a private browser route to the login gateway, carrying the original
 * destination through the shared validator so a hostile URL can never be
 * reflected back out of /login. An unapproved identity additionally gets an
 * honest reason and has its stale session cookies dropped.
 */
function pageDenial(
  request: NextRequest,
  decision: Extract<AccessDecision, { outcome: 'deny' }>,
): NextResponse {
  const { pathname, search } = request.nextUrl
  const loginPath = carriesNext(decision.reason)
    ? buildLoginRedirectPath(`${pathname}${search}`)
    : '/login'
  const target = new URL(loginPath, request.url)
  const errorParam = PAGE_ERROR_PARAM[decision.reason]
  if (errorParam) target.searchParams.set('error', errorParam)

  const response = NextResponse.redirect(target)
  response.headers.set('Cache-Control', NO_STORE)

  if (shouldClearSession(decision)) {
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith(SESSION_COOKIE_PREFIX)) response.cookies.delete(cookie.name)
    }
  }
  return response
}

/** One place decides how a denial is expressed, for every branch. */
function deny(
  request: NextRequest,
  decision: Extract<AccessDecision, { outcome: 'deny' }>,
): NextResponse {
  return decision.json ? apiDenial(decision) : pageDenial(request, decision)
}

/** The fail-closed decision used when there is no auth mechanism at all. */
function unauthenticatedDecision(pathname: string): Extract<AccessDecision, { outcome: 'deny' }> {
  return { outcome: 'deny', reason: 'unauthenticated', status: 401, json: deniesWithJson(pathname) }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const isPrivate = requiresApprovedSession(pathname)

  const config = getSupabasePublicConfig()
  const supabaseUrl = config?.url
  const supabaseKey = config?.publishableKey

  // No Supabase credentials means there is no authentication mechanism, so no
  // request can be authorised. Fail CLOSED for private paths rather than serving
  // private market data to anonymous callers. Public pages, framework assets and
  // the auth endpoints still respond, so the app builds, deploys and renders
  // /login with zero env vars.
  if (!supabaseUrl || !supabaseKey) {
    return isPrivate ? deny(request, unauthenticatedDecision(pathname)) : NextResponse.next()
  }

  // Build a response we can mutate (needed to write refreshed session cookies).
  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Write refreshed cookies back to both request and response.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  const decision = await decideRequestAccess(
    pathname,
    // Authoritative verification: getUser() validates the token with the Auth
    // server. It returns no user for a malformed cookie, a forged or expired
    // token, or a banned or deleted account — none of which a local decode
    // would catch.
    async () => {
      const { data, error } = await supabase.auth.getUser()
      return { user: error ? null : (data.user ?? null) }
    },
    // THE authorization state — approval marker, role and module grants — in
    // ONE query, re-read per request so revoking either the username or the
    // last grant denies immediately. `user_module_grants.user_id` is a real
    // foreign key into `user_profiles(id)`, so PostgREST embeds the grants in
    // the profile row; RLS authorises both halves independently
    // (`auth.uid() = id` on the parent, `auth.uid() = user_id` on the embedded
    // rows), and the service-role client is never used here.
    //
    // Explicit columns only. The profile row also carries the caller's email and
    // display name, and neither belongs in an authorization decision.
    //
    // A read error is reported as a FAILURE, never as an empty grant set. On a
    // deployment whose database is behind its code — no `user_module_grants`
    // relation to embed — this refuses every caller and says why, rather than
    // either inventing access or accusing a member of holding none.
    async (userId): Promise<AuthorizationStateResult> => {
      const { data, error } = await (supabase as never as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: AuthorizationRow | null; error: unknown }>
            }
          }
        }
      })
        .from('user_profiles')
        .select(AUTHORIZATION_STATE_SELECT)
        .eq('id', userId)
        .maybeSingle()

      if (error) return { ok: false }
      return parseAuthorizationRow(userId, data)
    },
  )

  if (decision.outcome === 'deny') return deny(request, decision)

  // Private responses must never be cached by a CDN or shared between users.
  if (isPrivate) response.headers.set('Cache-Control', NO_STORE)

  return response
}

export const config = {
  matcher: [
    // Run on all paths except static assets and Next.js internals. This MUST
    // continue to cover /api/** — the default-deny policy is what protects the
    // private API surface, and narrowing this matcher would silently reopen it.
    '/((?!_next/static|_next/image|favicon|.*\\.(?:svg|png|jpg|jpeg|ico|webp|css|js|woff2?)$).*)',
  ],
}
