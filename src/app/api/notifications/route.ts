// GET /api/notifications — list the shared notification feed with per-user
// isRead computed against notification_reads. Middleware enforces auth.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { requireCurrentUser } from '@/lib/auth/getUser'
import { listNotifications } from '@/lib/db/repositories/notificationsRepository'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const user = await requireCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const notifications = await listNotifications(client, user.id)
  const unreadCount = notifications.filter((n) => !n.isRead).length
  return NextResponse.json({ notifications, unreadCount })
}
