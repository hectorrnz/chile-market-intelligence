// Phase 6A/6B — Auth callback (PKCE code exchange).
// The primary sign-in flow is username + password (/api/auth/login); this route
// is what the password-recovery email link lands on, and it also serves any
// future provider that returns to /auth/callback?code=...
// Cookies are set directly on the redirect response.
//
// R1.5 adds two things:
//   · `next` is validated by the shared safe-redirect helper — the previous
//     `next.startsWith('/')` check accepted `//evil.example`, an open redirect.
//   · the APPROVAL BOUNDARY is enforced here, because this is the second way a
//     session can come into existence. /forgot-password will mail a recovery
//     link to any address present in `auth.users`, so without this check an
//     Auth-only identity with no approved `user_profiles` row could exchange
//     that code for a real session. An unapproved exchange is signed out
//     immediately and never leaves a usable cookie behind.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabasePublicConfig } from '@/lib/supabase/env'
import { toSafeInternalPath } from '@/lib/auth/safeRedirect'
import { isApprovedProfile, type ApprovalProfile } from '@/lib/auth/approval'

export const dynamic = 'force-dynamic'

/** Destination used when the recovery link carries no explicit `next`. */
const DEFAULT_NEXT = '/watchlist'

const NO_STORE = 'no-store, no-cache, must-revalidate, private'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url  = request.nextUrl
  const code = url.searchParams.get('code')
  const requestedNext = url.searchParams.get('next')

  const config = getSupabasePublicConfig()
  if (!config) {
    return NextResponse.redirect(new URL('/login?error=not_configured', request.url))
  }

  if (code) {
    // One authoritative validator, shared with middleware and the login page.
    const safeNext = requestedNext ? toSafeInternalPath(requestedNext) : DEFAULT_NEXT
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
    if (!error) {
      // ── R1.5 approval boundary ────────────────────────────────────────────
      // Read the profile with THIS client: its session lives in memory here,
      // while the refreshed cookies exist only on the outgoing response, so a
      // cookie-reading helper would see nothing. Own-row RLS authorises the read.
      const { data: { user } } = await supabase.auth.getUser()
      let profile: ApprovalProfile | null = null
      if (user) {
        const { data } = await (supabase as never as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, val: string) => {
                maybeSingle: () => Promise<{ data: ApprovalProfile | null }>
              }
            }
          }
        })
          .from('user_profiles')
          .select('id, username, email, display_name')
          .eq('id', user.id)
          .maybeSingle()
        profile = data ?? null
      }

      if (!isApprovedProfile(profile)) {
        // Tear the session down rather than leave a cookie an unapproved
        // identity could reuse, then send them back to the gateway.
        await supabase.auth.signOut().catch(() => {})
        const denied = NextResponse.redirect(new URL('/login?error=not_authorized', request.url))
        denied.headers.set('Cache-Control', NO_STORE)
        return denied
      }

      response.headers.set('Cache-Control', NO_STORE)
      return response
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', request.url))
}
