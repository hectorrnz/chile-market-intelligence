// Temporary diagnostic endpoint — NOT protected by middleware.
// Shows what session state the server can see from the request cookies.
// Remove after debugging is complete.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const config = getSupabasePublicConfig()
  if (!config) return NextResponse.json({ configured: false })

  const cookieNames = request.cookies.getAll().map(c => c.name)

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  })

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  return NextResponse.json({
    cookieCount: cookieNames.length,
    cookieNames,
    hasSession: !!session,
    sessionExpiry: session?.expires_at ?? null,
    hasUser: !!user,
    userEmail: user?.email ?? null,
    sessionError: sessionError?.message ?? null,
    userError: userError?.message ?? null,
  })
}
