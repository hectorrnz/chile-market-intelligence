// Password-reset request: sends a Supabase Auth recovery email to the given
// address. Always responds with a generic ok:true — never reveals whether an
// account exists for that email (avoids user enumeration).
//
// SECURITY:
//   • redirectTo is built from the request's own origin — no env var required.
//   • The recovery link lands on /auth/callback (existing PKCE code-exchange
//     route), which then forwards to /auth/reset-password once a session
//     (with type=recovery) is established.
//
// IMPORTANT: resetPasswordForEmail() generates a PKCE code verifier that
// Supabase needs written to a cookie in the caller's browser — otherwise the
// later exchangeCodeForSession() call in /auth/callback has nothing to match
// the emailed code against and fails ("Authentication failed. Please sign in
// again."), which is exactly the bug this fix addresses. getSupabaseServerClient()
// stubs cookie writes to a no-op (fine for anonymous public-data reads, but it
// silently dropped this verifier). createSessionWriterClient() — the same
// client used by login/register — captures the write and applies it as a real
// Set-Cookie header on this route's HTTP response, so the browser persists it.

import { NextRequest, NextResponse } from 'next/server'
import { createSessionWriterClient } from '@/lib/auth/sessionCookies'
import { isValidEmail } from '@/lib/auth/credentials'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyCookies } = createSessionWriterClient(request)
  if (!supabase) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  const redirectTo = `${request.nextUrl.origin}/auth/callback?next=${encodeURIComponent('/auth/reset-password')}`

  // Errors are intentionally not surfaced to the caller — the response is
  // always the same generic "ok" regardless of whether the email exists or
  // the send failed, to avoid leaking account existence.
  await supabase.auth.resetPasswordForEmail(email, { redirectTo }).catch(() => {})

  return applyCookies(NextResponse.json({ ok: true }))
}
