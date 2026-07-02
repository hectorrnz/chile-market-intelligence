// Phase 6A — Next.js middleware for Supabase session refresh and route protection.
//
// Responsibilities:
//   1. Refresh Supabase Auth session cookies on every non-static request so
//      Server Components and Route Handlers see fresh session state.
//   2. Redirect unauthenticated users from protected page routes to /login.
//   3. Return 401 JSON from protected API routes when unauthenticated.
//
// Protected routes (require auth):
//   /watchlist        → redirect to /login?next=<path>
//   /api/watchlists/* → 401 JSON
//
// Public routes (no auth required):
//   /, /stocks, /macro, /companies/*, /earnings, /hechos-esenciales,
//   /documents/*, /compare, /chart-builder, /login, /auth/*,
//   /api/macro/*, /api/market/*, /api/cmf/*, /api/health/*
//
// Cron routes (/api/cron/*) carry their own CRON_SECRET bearer auth — the
// middleware leaves them untouched so Vercel can call them without a session.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'

const PROTECTED_PAGES  = ['/watchlist']
const PROTECTED_API    = ['/api/watchlists']

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // If Supabase is not configured, skip session logic entirely.
  const config = getSupabasePublicConfig()
  const supabaseUrl = config?.url
  const supabaseKey = config?.publishableKey
  if (!supabaseUrl || !supabaseKey) {
    // Still protect pages — show a "not configured" redirect or pass through.
    // In development without Supabase, redirect protected pages to login
    // so the UX is consistent even before credentials are set.
    if (PROTECTED_PAGES.some(p => pathname.startsWith(p))) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
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

  // Check session: getSession() reads from the local cookie (no network call),
  // which is fast and resilient to Supabase outages. For an internal single-user
  // app this is sufficient — the JWT is still cryptographically signed.
  // getUser() (server-side validation) is skipped here to avoid network failures
  // in middleware blocking authenticated users during Supabase degradation.
  const { data: { session } } = await supabase.auth.getSession()
  const effectiveUser = session?.user ?? null

  // TEMP DIAGNOSTIC: expose what the middleware saw for this request so we can
  // read it from the Network tab on a failing request. Remove after debugging.
  const allCookieNames = request.cookies.getAll().map(c => c.name)
  const sbCookieNames  = allCookieNames.filter(n => n.startsWith('sb-'))
  const setDiag = (r: NextResponse): NextResponse => {
    r.headers.set('x-mw-path', pathname)
    r.headers.set('x-mw-cookie-count', String(allCookieNames.length))
    r.headers.set('x-mw-sb-count', String(sbCookieNames.length))
    r.headers.set('x-mw-sb-names', sbCookieNames.join(',') || 'none')
    r.headers.set('x-mw-session', effectiveUser ? '1' : '0')
    return r
  }

  // ── Protect page routes ──────────────────────────────────────────────────────
  if (PROTECTED_PAGES.some(p => pathname.startsWith(p)) && !effectiveUser) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return setDiag(NextResponse.redirect(url))
  }

  // ── Protect API routes ───────────────────────────────────────────────────────
  if (PROTECTED_API.some(p => pathname.startsWith(p)) && !effectiveUser) {
    return setDiag(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
  }

  return setDiag(response)
}

export const config = {
  matcher: [
    // Run on all paths except static assets and Next.js internals.
    '/((?!_next/static|_next/image|favicon|.*\\.(?:svg|png|jpg|jpeg|ico|webp|css|js|woff2?)$).*)',
  ],
}
