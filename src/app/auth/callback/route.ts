// Phase 6A/6B — Auth callback (kept for OAuth/PKCE code exchanges).
// The primary sign-in flow is now username + password (/api/auth/login), but
// this route remains so any provider that returns to /auth/callback?code=...
// still completes correctly. Cookies are set directly on the redirect response.

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
    let response = NextResponse.redirect(new URL(safeNext, request.url))

    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.redirect(new URL(safeNext, request.url))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    })

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return response
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
}
