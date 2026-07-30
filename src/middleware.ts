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
// LATENCY. A private request costs TWO sequential Supabase round-trips:
// `auth.getUser()` (verifies the JWT with the Auth server — this is what rejects
// forged, expired, revoked, banned and deleted identities) and a single-row
// `user_profiles` read under own-row RLS (the current approval marker). The
// earlier zero-network `getSession()` gate was faster but authorised from
// unverified cookie state and could not revoke promptly; correctness wins. See
// docs/security_access_control.md § "Verified session".
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
import type { ApprovalProfile } from '@/lib/auth/approval'
import {
  decideRequestAccess,
  shouldClearSession,
  type AccessDecision,
} from '@/lib/auth/requestAccess'

/** A denial must never be cached by the browser, a CDN, or a shared proxy. */
const NO_STORE = 'no-store, no-cache, must-revalidate, private'

/** Supabase writes its session under `sb-*` cookies. */
const SESSION_COOKIE_PREFIX = 'sb-'

const REASON_TO_CODE: Record<'unauthenticated' | 'not_approved', string> = {
  unauthenticated: ACCESS_DENIED_REASONS.unauthenticated,
  not_approved: ACCESS_DENIED_REASONS.notApproved,
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
  const loginPath = buildLoginRedirectPath(`${pathname}${search}`)
  const target = new URL(loginPath, request.url)
  if (decision.reason === 'not_approved') target.searchParams.set('error', 'not_authorized')

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
    // Current approval marker, re-read per request so revocation is immediate.
    // Own-row RLS (`auth.uid() = id`) authorises the read; the service-role
    // client is never used here.
    async (userId) => {
      const { data } = await (supabase as never as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: ApprovalProfile | null }>
            }
          }
        }
      })
        .from('user_profiles')
        .select('id, username')
        .eq('id', userId)
        .maybeSingle()
      return data ?? null
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
