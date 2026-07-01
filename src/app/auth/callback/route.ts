// Phase 6A — Auth callback: exchanges the PKCE code for a session.
// Supabase sends the user here after they click the magic-link email.
// Query params:  ?code=<pkce_code>&next=<redirect_path>

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url    = request.nextUrl
  const code   = url.searchParams.get('code')
  const next   = url.searchParams.get('next') ?? '/watchlist'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(new URL('/login?error=not_configured', request.url))
  }

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (newCookies) => {
          newCookies.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        },
      },
    })

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Ensure the redirect target is safe (same origin only).
      const safeNext = next.startsWith('/') ? next : '/watchlist'
      return NextResponse.redirect(new URL(safeNext, request.url))
    }
    // Log the actual Supabase error so Vercel function logs show the root cause.
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
}
