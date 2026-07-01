// Phase 6B — Server-side session-cookie writer for auth route handlers.
// SERVER-ONLY. Creates a Supabase server client whose session-cookie writes are
// captured and then applied directly to a NextResponse via Set-Cookie headers.
// This is the reliable path (HTTP Set-Cookie) — the browser stores these even
// though the client-side document.cookie storage proved unreliable for PKCE.

import type { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from '../supabase/env'
import type { Database } from '../supabase/database.types'

type CapturedCookie = { name: string; value: string; options: CookieOptions }

/**
 * Returns a Supabase client that captures any session cookies it wants to set,
 * plus an `applyCookies(res)` that writes those cookies onto the given response.
 * Returns supabase:null when Supabase is not configured.
 */
export function createSessionWriterClient(request: NextRequest): {
  supabase: SupabaseClient<Database> | null
  applyCookies: (res: NextResponse) => NextResponse
} {
  const config = getSupabasePublicConfig()
  if (!config) return { supabase: null, applyCookies: (r) => r }

  const jar: CapturedCookie[] = []

  const supabase = createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const c of cookiesToSet) jar.push(c as CapturedCookie)
      },
    },
  })

  const applyCookies = (res: NextResponse): NextResponse => {
    for (const { name, value, options } of jar) res.cookies.set(name, value, options)
    return res
  }

  return { supabase, applyCookies }
}
