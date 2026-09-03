// GET /api/notifications — list the shared notification feed with per-user
// isRead computed against notification_reads. Middleware enforces auth.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getApprovedUser } from '@/lib/auth/getUser'
import { unauthenticatedJson, notAuthorizedJson } from '@/lib/auth/apiGuard'
import { listNotifications } from '@/lib/db/repositories/notificationsRepository'
import { callerIsPlatformAdministrator } from '@/lib/auth/getModuleAccess'

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

  // R13.7B2.1 — the feed is administrator-only, and this is the SECOND of two
  // independent barriers. `notifications_admin_select` (20260818000000) denies
  // a member at the database, so a REST client with a member's token reads
  // nothing either; this gate means the route never depends on that policy
  // being right. Every notification this application produces is a Structured
  // Notes operational alert carrying the ISIN, the contractual valuation date
  // and each underlying's level against its own call threshold.
  //
  // An empty feed rather than a 403: for a member there genuinely are no
  // notifications to see, and NotificationBell already renders that as its
  // empty state. A member-visible notification class would be a deliberate
  // redesign that revisits both barriers together.
  if (!(await callerIsPlatformAdministrator())) {
    return NextResponse.json({ notifications: [], unreadCount: 0 })
  }

  const notifications = await listNotifications(client, user.id)
  const unreadCount = notifications.filter((n) => !n.isRead).length
  return NextResponse.json({ notifications, unreadCount })
}
