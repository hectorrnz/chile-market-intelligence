// GET /api/notification-recipients  — list the email distribution list.
// POST /api/notification-recipients — add a recipient.
//
// ADMINISTRATOR ONLY (POST-R13.6B.1). The recipient list is an outbound-data
// administration capability, not a module: it decides where family financial
// notifications are delivered, so it is deliberately NOT grantable through
// `user_module_grants` and has no `app_modules` row. Middleware still enforces
// authentication; `guardAdministrator` enforces capability; and
// `notification_recipients` RLS refuses every verb to a non-administrator even
// if a handler here were ever to forget. Managed from /settings.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { isValidEmail } from '@/lib/auth/credentials'
import { listNotificationRecipients, addNotificationRecipient } from '@/lib/db/repositories/notificationsRepository'
import { guardAdministrator } from '@/lib/auth/moduleApiGuard'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const recipients = await listNotificationRecipients(client)
  return NextResponse.json({ recipients })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim()
  if (!isValidEmail(email)) return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) || null : null

  const result = await addNotificationRecipient(client, email, label)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'insert_failed' }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 201 })
}
