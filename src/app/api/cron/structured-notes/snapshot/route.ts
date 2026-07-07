// Phase 9D — Vercel Cron route: scheduled Structured Notes monitoring.
//
// Runs with NO authenticated user session, so it uses the service-role admin
// client (bypasses RLS) — the one place in this module a service-role client
// is intentional, per the shared-book model where user_id is an audit stamp,
// not an ownership mechanism. The service-role key never leaves this route.
//
// Auth: same Bearer CRON_SECRET pattern as /api/cron/check-ingestion-health.
//
// Manual trigger (curl):
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://nevada-market-intelligence.vercel.app/api/cron/structured-notes/snapshot
//
// Behavior per run:
//   1. Fetch all `active` notes (never touches archived/called notes).
//   2. Batch-fetch current levels for every distinct underlying Yahoo symbol.
//   3. Persist one price-snapshot row per underlying (upsert — safe to re-run
//      same-day).
//   4. Evaluate any observation whose valuation date is on/before today and
//      still `scheduled` (coupon/autocall/final) and record the result.
//   5. Apply the one conservative automatic status transition this app makes
//      (autocall eligible + clean data -> 'autocalled'); everything else is
//      surfaced as reviewRequired for a human, never silently finalized.
//   6. Record a structured_note_monitoring_runs audit row (success /
//      partial_success / failed) and return a sanitized summary.
//
// Every price here is a MONITORING ESTIMATE from a free provider — never an
// official calculation-agent determination. See docs/structured_notes_design.md.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  getActiveNotesForMonitoring,
  insertStructuredNotePriceSnapshots,
  createStructuredNoteMonitoringRun,
  completeStructuredNoteMonitoringRun,
  updateObservationResult,
  updateNoteStatusFromObservation,
} from '@/lib/db/repositories/structuredNotesRepository'
import { fetchMonitoringPrices } from '@/lib/structuredNotes/structuredNoteMonitoringProvider'
import {
  getUniqueUnderlyingSymbols,
  calculateStructuredNoteSnapshot,
  evaluateObservation,
  deriveObservationStatus,
  shouldUpdateNoteStatus,
} from '@/lib/structuredNotes/monitoring'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Cron not configured — CRON_SECRET missing' }, { status: 500 })
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = getSupabaseAdminClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  const asOf = new Date().toISOString().slice(0, 10)
  const warnings: string[] = []
  const errors: string[] = []

  const runId = await createStructuredNoteMonitoringRun(client, { runType: 'scheduled_snapshot' })
  if (!runId) return NextResponse.json({ error: 'failed_to_start_run' }, { status: 500 })

  try {
    const notes = await getActiveNotesForMonitoring(client)
    const symbols = getUniqueUnderlyingSymbols(notes)
    const underlyingCount = notes.reduce((n, note) => n + note.underlyings.length, 0)

    const priceResult = await fetchMonitoringPrices(symbols)
    warnings.push(...priceResult.warnings)

    // ── Persist one snapshot row per underlying ────────────────────────────
    const snapshotRows = notes.flatMap((note) => calculateStructuredNoteSnapshot(note, priceResult.prices, asOf))
    const insertRes = await insertStructuredNotePriceSnapshots(client, snapshotRows)
    if (!insertRes.ok) errors.push(insertRes.error ?? 'failed to persist price snapshots')

    // ── Evaluate due observations + apply conservative status transitions ──
    let observationsChecked = 0
    let observationsUpdated = 0
    let notesUpdated = 0

    for (const note of notes) {
      for (const observation of note.observations) {
        const evalResult = evaluateObservation(note, observation, priceResult.prices, asOf)
        if (!evalResult) continue
        observationsChecked += 1
        if (!observation.id) continue

        const status = deriveObservationStatus(evalResult)
        const ok = await updateObservationResult(client, observation.id, {
          status,
          observedAt: evalResult.observedAt,
          observedSource: evalResult.observedSource,
          observedSourceSymbol: null,
          observedLevels: evalResult.observedLevels,
          worstPerformerTicker: evalResult.worstPerformerTicker,
          worstPerformerReturn: evalResult.worstPerformerReturn,
          couponEligible: evalResult.couponEligible,
          autocallEligible: evalResult.autocallEligible,
          finalBarrierBreached: evalResult.finalBarrierBreached,
          reviewRequired: evalResult.reviewRequired,
          reviewReason: evalResult.reviewReason,
        })
        if (ok) observationsUpdated += 1
        else errors.push(`failed to update observation ${observation.id} for note ${note.id}`)

        const statusUpdate = shouldUpdateNoteStatus(note, evalResult)
        if (statusUpdate && note.id) {
          const noteOk = await updateNoteStatusFromObservation(client, note.id, statusUpdate.newStatus)
          if (noteOk) notesUpdated += 1
          else errors.push(`failed to update note ${note.id} status to ${statusUpdate.newStatus}`)
        }
      }
    }

    const status = errors.length > 0 ? (priceResult.succeeded.length > 0 || snapshotRows.length > 0 ? 'partial_success' : 'failed') : priceResult.failed.length > 0 ? 'partial_success' : 'success'

    await completeStructuredNoteMonitoringRun(client, runId, {
      status,
      activeNoteCount: notes.length,
      underlyingCount,
      pricesRequested: priceResult.requested.length,
      pricesSucceeded: priceResult.succeeded.length,
      pricesFailed: priceResult.failed.length,
      observationsChecked,
      observationsUpdated,
      notesUpdated,
      warnings,
      errors,
      metadata: { asOf, failedSymbols: priceResult.failed },
    })

    return NextResponse.json({
      runId,
      status,
      activeNotes: notes.length,
      underlyingsRequested: priceResult.requested.length,
      pricesSucceeded: priceResult.succeeded.length,
      pricesFailed: priceResult.failed.length,
      observationsChecked,
      observationsUpdated,
      notesUpdated,
      warnings,
      errors,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'Unknown error'
    await completeStructuredNoteMonitoringRun(client, runId, {
      status: 'failed',
      activeNoteCount: 0,
      underlyingCount: 0,
      pricesRequested: 0,
      pricesSucceeded: 0,
      pricesFailed: 0,
      observationsChecked: 0,
      observationsUpdated: 0,
      notesUpdated: 0,
      warnings,
      errors: [...errors, msg],
    })
    return NextResponse.json({ runId, status: 'failed', error: 'Monitoring run failed', detail: msg }, { status: 500 })
  }
}
