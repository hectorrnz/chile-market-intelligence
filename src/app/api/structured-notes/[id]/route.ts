// Phase 9A — GET/PATCH/DELETE /api/structured-notes/[id]
// GET returns the full note + live underlying prices + computed risk metrics.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getStructuredNoteById,
  updateStructuredNote,
  deleteStructuredNote,
} from '@/lib/db/repositories/structuredNotesRepository'
import { fetchUnderlyingPrices } from '@/lib/structuredNotes/structuredNoteMarketProvider'
import {
  calculateWorstPerformer,
  calculateCurrentRiskStatus,
  calculateNextObservation,
  calculateDaysToNextObservation,
  calculateCurrentNotional,
  calculateDistanceToBarrier,
} from '@/lib/structuredNotes/calculations'
import type { NoteStatus } from '@/lib/structuredNotes/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_STATUS: NoteStatus[] = ['active', 'autocalled', 'matured', 'defaulted', 'cancelled', 'draft']

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
  const distances = note.underlyings.map((u) => {
    const price = prices.find((p) => p.underlyingOrder === u.underlyingOrder)
    return {
      underlyingOrder: u.underlyingOrder,
      underlyingName: u.underlyingName,
      currentLevel: price?.price ?? null,
      priceSource: price?.source ?? 'unavailable',
      distanceToCouponBarrier: calculateDistanceToBarrier(price?.price ?? null, u.couponBarrierLevel),
      distanceToKnockInBarrier: calculateDistanceToBarrier(price?.price ?? null, u.knockInBarrierLevel),
      distanceToAutocallBarrier: calculateDistanceToBarrier(price?.price ?? null, u.autocallBarrierLevel),
    }
  })

  return NextResponse.json({
    note,
    prices,
    metrics: {
      riskStatus,
      worstPerformer: worst,
      nextObservation: nextObs,
      daysToNextObservation: calculateDaysToNextObservation(note.observations, asOf),
      currentNotional: calculateCurrentNotional(note, note.allocations),
      distances,
    },
  })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const patch: { status?: NoteStatus; issuerDisplayName?: string; productName?: string } = {}
  if (typeof body.status === 'string') {
    if (!VALID_STATUS.includes(body.status as NoteStatus)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    patch.status = body.status as NoteStatus
  }
  if (typeof body.issuerDisplayName === 'string') patch.issuerDisplayName = body.issuerDisplayName.slice(0, 80)
  if (typeof body.productName === 'string') patch.productName = body.productName.slice(0, 300)

  const ok = await updateStructuredNote(client, id, patch)
  if (!ok) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const { id } = await ctx.params
  const ok = await deleteStructuredNote(client, id)
  if (!ok) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
