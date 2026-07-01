// Phase 6A — Auth callback: exchanges the PKCE code for a session.
// Supabase sends the user here after they click the magic-link email.
// Query params:  ?code=<pkce_code>&next=<redirect_path>
//
// IMPORTANT: cookies must be set directly on the NextResponse object (not via
// next/headers cookieStore) so the Set-Cookie headers travel with the redirect.
// Using getSupabaseUserClient() (next/headers) caused cookieCount:0 — the
// browser never received the session cookies.
//
// TEMP DIAGNOSTIC: emits x-cb-* response headers so we can see, from the
// Network tab, exactly what the exchange did. Remove after debugging.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url  = request.nextUrl
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/watchlist'

  // What cookies did the browser send TO the callback? (verifier should be here)
  const incomingCookieNames = request.cookies.getAll().map(c => c.name)
  const hadVerifier = incomingCookieNames.some(n => n.includes('code-verifier'))

  const config = getSupabasePublicConfig()
  if (!config) {
    const r = NextResponse.redirect(new URL('/login?error=not_configured', request.url))
    r.headers.set('x-cb-status', 'not_configured')
    return r
  }

  if (code) {
    const safeNext = next.startsWith('/') ? next : '/watchlist'

    let cookiesSetNames: string[] = []

    // Start with the redirect response. setAll will rebuild and mutate it so
    // that session cookies are baked into Set-Cookie headers on the redirect.
    let response = NextResponse.redirect(new URL(safeNext, request.url))

    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesSetNames = cookiesToSet.map(c => c.name)
          // Mirror each cookie onto the mutable request so subsequent
          // server code in this handler can read them, then rebuild the
          // redirect response with the cookies set directly on it.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.redirect(new URL(safeNext, request.url))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    })

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    // Always log diagnostics so we can read them from Vercel runtime logs.
    console.log('[auth/callback DIAG]', JSON.stringify({
      hadCode: true,
      hadVerifier,
      incomingCookies: incomingCookieNames,
      exchangeError: error ? `${error.status}:${error.message}` : null,
      cookiesSetCount: cookiesSetNames.length,
      cookiesSet: cookiesSetNames,
    }))

    // Attach diagnostics to whichever response we return.
    const applyDiag = (r: NextResponse) => {
      r.headers.set('x-cb-had-code', '1')
      r.headers.set('x-cb-had-verifier', hadVerifier ? '1' : '0')
      r.headers.set('x-cb-incoming-cookies', incomingCookieNames.join(',') || 'none')
      r.headers.set('x-cb-exchange-error', error ? `${error.status}:${error.message}` : 'none')
      r.headers.set('x-cb-cookies-set-count', String(cookiesSetNames.length))
      r.headers.set('x-cb-cookies-set', cookiesSetNames.join(',') || 'none')
      return r
    }

    if (!error) {
      return applyDiag(response)
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
    const fail = NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
    return applyDiag(fail)
  }

  const r = NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
  r.headers.set('x-cb-had-code', '0')
  r.headers.set('x-cb-had-verifier', hadVerifier ? '1' : '0')
  r.headers.set('x-cb-incoming-cookies', incomingCookieNames.join(',') || 'none')
  return r
}
