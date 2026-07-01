// Phase 6A — Sign-out route handler.
// Accepts POST (form submission) or GET (link fallback).
// Clears the Supabase Auth session and redirects to /login.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

async function signOutAndRedirect(request: NextRequest): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (supabaseUrl && supabaseKey) {
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
    await supabase.auth.signOut()
  }

  return NextResponse.redirect(new URL('/', request.url))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(request)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(request)
}
