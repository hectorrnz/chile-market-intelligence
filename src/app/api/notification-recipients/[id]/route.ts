// PATCH  /api/notification-recipients/[id] — edit email/label/active.
// DELETE /api/notification-recipients/[id] — remove a recipient.
// Middleware enforces auth. Managed from /settings/notifications.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { isValidEmail } from '@/lib/auth/credentials'
import { updateNotificationRecipient, deleteNotificationRecipient } from '@/lib/db/repositories/notificationsRepository'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const patch: { email?: string; label?: string | null; active?: boolean } = {}
  if (body.email !== undefined) {
    const email = String(body.email).trim()
    if (!isValidEmail(email)) return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
    patch.email = email
  }
  if (body.label !== undefined) patch.label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) || null : null
  if (typeof body.active === 'boolean') patch.active = body.active

  const { id } = await ctx.params
  const result = await updateNotificationRecipient(client, id, patch)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'update_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params
  const ok = await deleteNotificationRecipient(client, id)
  if (!ok) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
