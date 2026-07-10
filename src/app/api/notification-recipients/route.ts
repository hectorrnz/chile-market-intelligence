// GET /api/notification-recipients  — list the email distribution list.
// POST /api/notification-recipients — add a recipient.
// Middleware enforces auth. Managed from /settings/notifications.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { isValidEmail } from '@/lib/auth/credentials'
import { listNotificationRecipients, addNotificationRecipient } from '@/lib/db/repositories/notificationsRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const recipients = await listNotificationRecipients(client)
  return NextResponse.json({ recipients })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
