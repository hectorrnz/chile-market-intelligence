// Phase 6B — Account setup: username + password (+ recovery email + display name).
// Creates a new Supabase auth user, OR attaches a password/username to an
// existing user with the same email (e.g. one created via the old magic-link
// flow). Establishes the session via server-set cookies and returns JSON.
//
// SECURITY:
//   • Uses the service-role admin client (server-only) — never exposed to client.
//   • Email is only used server-side; never returned to the browser.
//   • Optional AUTH_REGISTRATION_CODE gates open registration when set.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSessionWriterClient } from '@/lib/auth/sessionCookies'
import {
  normalizeUsername,
  isValidUsername,
  isValidPassword,
  isValidEmail,
  isValidDisplayName,
} from '@/lib/auth/credentials'

export const dynamic = 'force-dynamic'

async function findUserIdByEmail(
  admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  // Small user base: scan up to a few pages of users.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) break
    const match = data.users.find(u => (u.email ?? '').toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < 200) break
  }
  return null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  // ── Parse + validate ────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const username    = normalizeUsername(String(body.username ?? ''))
  const password    = body.password
  const email       = String(body.email ?? '').trim().toLowerCase()
  const displayName = String(body.displayName ?? '').trim()

  // Optional registration gate.
  const gate = process.env.AUTH_REGISTRATION_CODE?.trim()
  if (gate && String(body.code ?? '').trim() !== gate) {
    return NextResponse.json({ error: 'registration_closed' }, { status: 403 })
  }

  if (!isValidUsername(username)) {
    return NextResponse.json({ error: 'invalid_username' }, { status: 422 })
  }
  if (!isValidPassword(password)) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 422 })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }
  if (!isValidDisplayName(displayName)) {
    return NextResponse.json({ error: 'invalid_display_name' }, { status: 422 })
  }

  // ── Username uniqueness ───────────────────────────────────────────────────────
  const { data: existingProfile } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { id: string } | null }>
        }
      }
    }
  })
    .from('user_profiles').select('id').eq('username', username).maybeSingle()

  // ── Create or update the auth user ────────────────────────────────────────────
  const existingId = await findUserIdByEmail(admin, email)

  // If the username is taken by a DIFFERENT user, reject.
  if (existingProfile && existingProfile.id !== existingId) {
    return NextResponse.json({ error: 'username_taken' }, { status: 409 })
  }

  let userId = existingId
  const userMeta = { username, display_name: displayName }

  if (existingId) {
    const { error } = await admin.auth.admin.updateUserById(existingId, {
      password: password as string,
      email_confirm: true,
      user_metadata: userMeta,
    })
    if (error) {
      return NextResponse.json({ error: 'update_failed' }, { status: 500 })
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: password as string,
      email_confirm: true,
      user_metadata: userMeta,
    })
    if (error || !data?.user) {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 })
    }
    userId = data.user.id
  }

  // ── Upsert profile row (username/email/display_name) ──────────────────────────
  await (admin as unknown as {
    from: (t: string) => {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<unknown>
    }
  })
    .from('user_profiles')
    .upsert(
      { id: userId, username, email, display_name: displayName },
      { onConflict: 'id' },
    )

  // ── Establish the session via server-set cookies ──────────────────────────────
  const { supabase, applyCookies } = createSessionWriterClient(request)
  if (!supabase) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password: password as string,
  })
  if (signInErr) {
    // Account created but session not established — client can log in manually.
    return NextResponse.json({ ok: true, session: false }, { status: 201 })
  }

  const res = NextResponse.json({ ok: true, session: true, displayName }, { status: 201 })
  return applyCookies(res)
}
