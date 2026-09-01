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
import { isApprovedProfile } from '@/lib/auth/approval'

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
  const { data: profile, error: lookupError } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{
            data: { username: string | null; email: string | null; display_name: string | null } | null
            error: unknown
          }>
        }
      }
    }
  })
    .from('user_profiles')
    .select('username, email, display_name')
    .eq('username', username)
    .maybeSingle()

  // POST-R13.6R1.1 — A FAILED LOOKUP IS NOT "NO SUCH USER".
  //
  // This error used to be destructured away, so an unreachable database, an
  // invalid or rotated service-role key, or any PostgREST error produced a
  // `profile` of null and therefore the same 401 as a wrong password. Every
  // cause — the account's, the deployment's, the network's — arrived at the
  // reader as "Incorrect username or password", which is the one message that
  // sends someone to re-type a password that was never the problem. Diagnosing
  // exactly that took an entire stage.
  //
  // This is NOT a user-enumeration leak. It distinguishes "this deployment
  // could not answer" from "these credentials were refused" — it says nothing
  // about whether the username exists, because it is returned before the
  // username is compared to anything. A caller with a valid username and a
  // caller with a nonsense one get byte-identical responses in both branches.
  if (lookupError) {
    return NextResponse.json({ error: 'lookup_unavailable' }, { status: 503 })
  }

  // R1.5 — the approval boundary, applied at the session-minting point. A
  // Supabase Auth identity with no approved `user_profiles` row can never
  // obtain a session here (see src/lib/auth/approval.ts). Same generic error as
  // a wrong password, so an unapproved account is indistinguishable from a
  // non-existent one.
  const email = profile?.email
  if (!isApprovedProfile(profile) || !email) {
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
