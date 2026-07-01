// Temporary diagnostic endpoint — NOT protected by middleware.
// Shows what session state the server can see from the request cookies.
// Remove after debugging is complete.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

// Bump this string whenever we redeploy so we can confirm the live build.
const BUILD_MARKER = 'debug-v2-cookie-fix'

export async function GET(request: NextRequest) {
  const config = getSupabasePublicConfig()
  if (!config) return NextResponse.json({ configured: false, buildMarker: BUILD_MARKER })

  const allCookies  = request.cookies.getAll()
  const cookieNames = allCookies.map(c => c.name)
  const sbCookies   = cookieNames.filter(n => n.startsWith('sb-'))
  const rawCookie   = request.headers.get('cookie') ?? ''

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  })

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  return NextResponse.json({
    buildMarker: BUILD_MARKER,
    host: request.headers.get('host'),
    normalizedSupabaseUrl: config.url,
    cookieCount: cookieNames.length,
    cookieNames,
    sbCookieCount: sbCookies.length,
    sbCookieNames: sbCookies,
    rawCookieHeaderLength: rawCookie.length,
    hasSession: !!session,
    sessionExpiry: session?.expires_at ?? null,
    hasUser: !!user,
    userEmail: user?.email ?? null,
    sessionError: sessionError?.message ?? null,
    userError: userError?.message ?? null,
  })
}
