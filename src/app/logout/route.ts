// Phase 6A — Sign-out route handler.
// Accepts POST (form submission) or GET (link fallback).
// Clears the Supabase Auth session and redirects to /login.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

async function signOutAndRedirect(request: NextRequest): Promise<NextResponse> {
  const config = getSupabasePublicConfig()

  // Redirect to /login and clear session cookies directly on that response.
  let response = NextResponse.redirect(new URL('/login', request.url))

  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.redirect(new URL('/login', request.url))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    })
    await supabase.auth.signOut()
  }

  return response
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(request)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(request)
}
