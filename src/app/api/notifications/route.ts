// GET /api/notifications — list the shared notification feed with per-user
// isRead computed against notification_reads. Middleware enforces auth.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getApprovedUser } from '@/lib/auth/getUser'
import { unauthenticatedJson, notAuthorizedJson } from '@/lib/auth/apiGuard'
import { listNotifications } from '@/lib/db/repositories/notificationsRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
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
  const unreadCount = notifications.filter((n) => !n.isRead).length
  return NextResponse.json({ notifications, unreadCount })
}
