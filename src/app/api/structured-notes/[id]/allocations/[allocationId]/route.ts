// Phase 9A — DELETE /api/structured-notes/[id]/allocations/[allocationId]

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { deleteAllocation } from '@/lib/db/repositories/structuredNotesRepository'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; allocationId: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { allocationId } = await ctx.params
  const ok = await deleteAllocation(client, allocationId)
  if (!ok) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
