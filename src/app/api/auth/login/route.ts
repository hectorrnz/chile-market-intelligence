// Phase 6B — Username + password sign-in.
// Resolves username → email server-side (admin client, email never returned),
// then signs in with password and sets the session via server cookies.
//
// SECURITY: generic 'invalid_credentials' for any failure so we never reveal
// whether the username exists or the password was wrong.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSessionWriterClient } from '@/lib/auth/sessionCookies'
import { normalizeUsername } from '@/lib/auth/credentials'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const username = normalizeUsername(String(body.username ?? ''))
  const password = body.password
  if (!username || typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  // Resolve username → email (server-side only).
  const { data: profile } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { email: string | null; display_name: string | null } | null }>
        }
      }
    }
  })
    .from('user_profiles')
    .select('email, display_name')
    .eq('username', username)
    .maybeSingle()

  const email = profile?.email
  if (!email) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const { supabase, applyCookies } = createSessionWriterClient(request)
  if (!supabase) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data?.session) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const displayName =
    (data.user?.user_metadata?.display_name as string | undefined) ??
    profile?.display_name ??
    username

  const res = NextResponse.json({ ok: true, displayName })
  return applyCookies(res)
}
