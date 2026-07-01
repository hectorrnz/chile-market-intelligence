// Phase 6A — Auth callback: exchanges the PKCE code for a session.
// Supabase sends the user here after they click the magic-link email.
// Query params:  ?code=<pkce_code>&next=<redirect_path>

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url  = request.nextUrl
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/watchlist'

  if (code) {
    const supabase = await getSupabaseUserClient()
    if (!supabase) {
      return NextResponse.redirect(new URL('/login?error=not_configured', request.url))
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Ensure the redirect target is safe (same origin only).
      const safeNext = next.startsWith('/') ? next : '/watchlist'
      return NextResponse.redirect(new URL(safeNext, request.url))
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
}
