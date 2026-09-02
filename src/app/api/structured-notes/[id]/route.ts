// Phase 9A — GET/PATCH/DELETE /api/structured-notes/[id]
// GET returns the full note + live underlying prices + computed risk metrics.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getStructuredNoteById,
  updateStructuredNote,
  deleteStructuredNote,
  getLatestStructuredNotePriceSnapshots,
} from '@/lib/db/repositories/structuredNotesRepository'
import { fetchUnderlyingPrices } from '@/lib/structuredNotes/structuredNoteMarketProvider'
import { detectStalePrice } from '@/lib/structuredNotes/monitoring'
import {
  calculateWorstPerformer,
  calculateCurrentRiskStatus,
  calculateNextObservation,
  calculateDaysToNextObservation,
  calculateCurrentNotional,
  noteSettlementStatus,
  calculateDistanceToBarrier,
} from '@/lib/structuredNotes/calculations'
import type { NoteStatus } from '@/lib/structuredNotes/types'
import { guardAdministrator, guardModuleReadWithCapability } from '@/lib/auth/moduleApiGuard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_STATUS: NoteStatus[] = ['active', 'autocalled', 'matured', 'defaulted', 'cancelled', 'draft']

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { denied, canManage } = await guardModuleReadWithCapability('structured_notes')
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params

  const note = await getStructuredNoteById(client, id)
  if (!note) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const prices = await fetchUnderlyingPrices(
    note.underlyings.map((u) => ({
      underlyingOrder: u.underlyingOrder,
      sourceTicker: u.sourceTicker,
      underlyingName: u.underlyingName,
      yahooSymbol: u.yahooSymbol,
    })),
  )

  const asOf = new Date().toISOString().slice(0, 10)
  const worst = calculateWorstPerformer(note.underlyings, prices)
  const riskStatus = calculateCurrentRiskStatus(note, prices)
  const nextObs = calculateNextObservation(note.observations, asOf)

  // Latest PERSISTED snapshot per underlying (from the scheduled monitoring
  // cron) — distinct from the live `prices` above (fetched fresh on every
  // page load for the "Update" button's immediate-refresh behavior).
  const latestSnapshots = note.id ? await getLatestStructuredNotePriceSnapshots(client, [note.id]) : new Map()

  const distances = note.underlyings.map((u) => {
    const price = prices.find((p) => p.underlyingOrder === u.underlyingOrder)
    const snapshot = u.id ? latestSnapshots.get(u.id) : undefined
    return {
      underlyingOrder: u.underlyingOrder,
      underlyingName: u.underlyingName,
      currentLevel: price?.price ?? null,
      priceSource: price?.source ?? 'unavailable',
      distanceToCouponBarrier: calculateDistanceToBarrier(price?.price ?? null, u.couponBarrierLevel),
      distanceToKnockInBarrier: calculateDistanceToBarrier(price?.price ?? null, u.knockInBarrierLevel),
      distanceToAutocallBarrier: calculateDistanceToBarrier(price?.price ?? null, u.autocallBarrierLevel),
      lastMonitoredPrice: snapshot?.price ?? null,
      lastMonitoredDate: snapshot?.priceDate ?? null,
      lastMonitoredStale: snapshot ? detectStalePrice({ priceDate: snapshot.priceDate, price: snapshot.price }, asOf) : true,
    }
  })

  return NextResponse.json({
    // See the list route: a UI courtesy, never the boundary.
    canManage,
    note,
    prices,
    metrics: {
      riskStatus,
      worstPerformer: worst,
      nextObservation: nextObs,
      daysToNextObservation: calculateDaysToNextObservation(note.observations, asOf),
      currentNotional: calculateCurrentNotional(note, note.allocations, noteSettlementStatus(note, new Date().toISOString().slice(0, 10))),
      distances,
    },
  })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const patch: { status?: NoteStatus; issuerDisplayName?: string; productName?: string; custodian?: string | null } = {}
  if (typeof body.status === 'string') {
    if (!VALID_STATUS.includes(body.status as NoteStatus)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    patch.status = body.status as NoteStatus
  }
  if (typeof body.issuerDisplayName === 'string') patch.issuerDisplayName = body.issuerDisplayName.slice(0, 80)
  if (typeof body.productName === 'string') patch.productName = body.productName.slice(0, 300)
  // R7.1B.1 — note-level custody, user-entered. Sent only when the user edits
  // it; an explicit null clears it. Never defaulted from any other field.
  if (Object.prototype.hasOwnProperty.call(body, 'custodian')) {
    patch.custodian = typeof body.custodian === 'string' ? body.custodian.slice(0, 120) : null
  }

  const ok = await updateStructuredNote(client, id, patch)
  if (!ok) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * R7.1B — DELETE /api/structured-notes/{id}. Access is enforced upstream by the
 * default-deny middleware (this path classifies as `private_api`, so an
 * unauthenticated or unapproved caller never reaches this handler and receives
 * the standard JSON 401); the query itself additionally runs on the user-session
 * client, so RLS applies. One transactional statement — see
 * `deleteStructuredNote` for the per-child-table deletion contract.
 *
 * Not idempotent by design: a second DELETE of the same id returns a controlled
 * 404 `not_found` rather than a silent 200, so a UI can distinguish "removed by
 * this action" from "was already gone". Every failure path returns structured
 * JSON — never an HTML error page, a stack trace, a path, or SQL.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await guardAdministrator()
  if (denied) return denied

  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  const result = await deleteStructuredNote(client, id)
  if (result === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (result !== 'ok') return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
