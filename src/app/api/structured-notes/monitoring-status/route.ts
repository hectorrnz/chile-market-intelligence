// Phase 9D — GET /api/structured-notes/monitoring-status
// Authenticated-only (middleware + shared-book RLS). Read-only summary of the
// scheduled monitoring job's health: latest run, latest snapshot date, active
// note count, unsupported/stale underlying counts, and which notes have an
// observation due soon or flagged for review.

import { NextResponse } from 'next/server'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import {
  getActiveNotesForMonitoring,
  getLatestStructuredNotePriceSnapshots,
  getStructuredNoteMonitoringStatus,
} from '@/lib/db/repositories/structuredNotesRepository'
import { calculateDaysToNextObservation } from '@/lib/structuredNotes/calculations'
import { detectStalePrice } from '@/lib/structuredNotes/monitoring'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const asOf = new Date().toISOString().slice(0, 10)
  const [summary, notes] = await Promise.all([
    getStructuredNoteMonitoringStatus(client),
    getActiveNotesForMonitoring(client),
  ])

  const noteIds = notes.map((n) => n.id).filter((id): id is string => !!id)
  const latestSnapshots = await getLatestStructuredNotePriceSnapshots(client, noteIds)

  let staleNoteCount = 0
  let dueSoonCount = 0
  let reviewRequiredCount = 0
  const dueSoonNotes: { noteId: string; isin: string | null; daysToNextObservation: number }[] = []
  const reviewRequiredNotes: { noteId: string; isin: string | null; reasons: string[] }[] = []

  for (const note of notes) {
    // A note is "stale" if ANY underlying's latest snapshot predates the
    // freshness window — one missing/old symbol is enough to flag the whole
    // note for review, rather than averaging it away.
    const isStale = note.underlyings.some((u) => {
      const snap = u.id ? latestSnapshots.get(u.id) : undefined
      return detectStalePrice(snap ? { priceDate: snap.priceDate, price: snap.price } : null, asOf)
    })
    if (isStale) staleNoteCount += 1

    const days = calculateDaysToNextObservation(note.observations, asOf)
    if (days !== null && days >= 0 && days <= 7) {
      dueSoonCount += 1
      dueSoonNotes.push({ noteId: note.id ?? '', isin: note.isin, daysToNextObservation: days })
    }

    const reasons = note.observations.filter((o) => o.reviewRequired && o.reviewReason).map((o) => o.reviewReason as string)
    if (reasons.length > 0) {
      reviewRequiredCount += 1
      reviewRequiredNotes.push({ noteId: note.id ?? '', isin: note.isin, reasons: [...new Set(reasons)] })
    }
  }

  return NextResponse.json({
    latestRun: summary.latestRun,
    latestSnapshotDate: summary.latestSnapshotDate,
    activeNoteCount: summary.activeNoteCount,
    unsupportedUnderlyingCount: summary.unsupportedUnderlyingCount,
    staleNoteCount,
    dueSoonCount,
    dueSoonNotes,
    reviewRequiredCount,
    reviewRequiredNotes,
    failedSymbols: (summary.latestRun?.warnings ?? []),
    sourceMetadata: {
      provider: 'yahoo-finance',
      note: 'Monitoring estimate only — not an official calculation-agent determination.',
    },
  })
}
