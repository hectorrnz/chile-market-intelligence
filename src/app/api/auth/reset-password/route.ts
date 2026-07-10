// Completes a password reset. Must be called after the user has followed a
// valid recovery email link — /auth/callback already exchanged the recovery
// code and set a session cookie by the time this route is hit, so this just
// updates the password on that session (no admin client, no email lookup).
//
// SECURITY: uses the session-bound client only — a request with no valid
// recovery session fails with 401, never falls back to the admin client.

import { NextRequest, NextResponse } from 'next/server'
import { createSessionWriterClient } from '@/lib/auth/sessionCookies'
import { isValidPassword } from '@/lib/auth/credentials'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const password = body.password
  if (!isValidPassword(password)) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 422 })
  }

  const { supabase, applyCookies } = createSessionWriterClient(request)
  if (!supabase) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 })
  }

  const { error } = await supabase.auth.updateUser({ password: password as string })
  if (error) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  return applyCookies(NextResponse.json({ ok: true }))
}
