// Phase 6A — Auth callback: exchanges the PKCE code for a session.
// Supabase sends the user here after they click the magic-link email.
// Query params:  ?code=<pkce_code>&next=<redirect_path>
//
// IMPORTANT: cookies must be set directly on the NextResponse object (not via
// next/headers cookieStore) so the Set-Cookie headers travel with the redirect.
// Using getSupabaseUserClient() (next/headers) caused cookieCount:0 — the
// browser never received the session cookies.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url  = request.nextUrl
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/watchlist'

  const config = getSupabasePublicConfig()
  if (!config) {
    return NextResponse.redirect(new URL('/login?error=not_configured', request.url))
  }

  if (code) {
    const safeNext = next.startsWith('/') ? next : '/watchlist'

    // Start with the redirect response. setAll will rebuild and mutate it so
    // that session cookies are baked into Set-Cookie headers on the redirect.
    let response = NextResponse.redirect(new URL(safeNext, request.url))

    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
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
    if (!error) {
      return response
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
}
