// POST /api/notifications/read-all — mark every currently-listed notification
// read for the current user in one round trip. Middleware enforces auth.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getApprovedUser } from '@/lib/auth/getUser'
import { unauthenticatedJson, notAuthorizedJson } from '@/lib/auth/apiGuard'
import { listNotifications, markAllNotificationsRead } from '@/lib/db/repositories/notificationsRepository'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  // R1.5 — defence in depth behind the middleware gate: verified identity plus
  // a CURRENT approval record, so a revoked user is refused here too.
  const access = await getApprovedUser()
  if (!access.ok) {
    return access.reason === 'unauthenticated' ? unauthenticatedJson() : notAuthorizedJson()
  }
  const user = access.user

  const notifications = await listNotifications(client, user.id)
  const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id)
  const ok = await markAllNotificationsRead(client, user.id, unreadIds)
  if (!ok) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, markedCount: unreadIds.length })
}
