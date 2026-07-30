// POST /api/notifications/[id]/read — mark one notification read for the
// current user. Middleware enforces auth.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { getApprovedUser } from '@/lib/auth/getUser'
import { unauthenticatedJson, notAuthorizedJson } from '@/lib/auth/apiGuard'
import { markNotificationRead } from '@/lib/db/repositories/notificationsRepository'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  // R1.5 — defence in depth behind the middleware gate: verified identity plus
  // a CURRENT approval record, so a revoked user is refused here too.
  const access = await getApprovedUser()
  if (!access.ok) {
    return access.reason === 'unauthenticated' ? unauthenticatedJson() : notAuthorizedJson()
  }
  const user = access.user

  const { id } = await params
  const ok = await markNotificationRead(client, id, user.id)
  if (!ok) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
