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
import { createNotification, getActiveNotificationRecipientEmails } from '@/lib/db/repositories/notificationsRepository'
import { sendNotificationEmail } from '@/lib/notifications/emailProvider'
import type { StructuredNote } from '@/lib/structuredNotes/types'

/**
 * A note this cron just auto-called gets a shared in-app notification (bell
 * icon, unread badge) plus an email to every active recipient in
 * notification_recipients — see /settings/notifications. Never throws: email
 * delivery failures are swallowed here so a degraded mail provider can never
 * fail the whole monitoring run (the price-snapshot/observation work above is
 * the load-bearing part of this cron).
 */
async function notifyStructuredNoteCalled(
  client: ReturnType<typeof getSupabaseAdminClient>,
  note: StructuredNote,
  origin: string,
): Promise<void> {
  if (!client || !note.id) return
  const linkUrl = `${origin}/structured-notes/${note.id}`
  const label = note.isin ?? note.issuerDisplayName ?? note.id
  const title = `Structured note called: ${label}`
  const body = `${note.issuerDisplayName ?? 'Issuer'} note ${note.isin ?? note.id} was automatically called on today's scheduled autocall observation (monitoring estimate).`
  await createNotification(client, {
    notificationType: 'structured_note_called',
    title,
    body,
    linkUrl,
    relatedEntityType: 'structured_note',
    relatedEntityId: note.id,
  })
  try {
    const recipients = await getActiveNotificationRecipientEmails(client)
    if (recipients.length > 0) {
      const html = `<p>${body}</p><p><a href="${linkUrl}">View the note →</a></p>`
      await sendNotificationEmail(recipients, title, html)
    }
  } catch {
    // Email is best-effort — the in-app notification above already succeeded.
  }
}

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

    // ── Persist one snapshot row per underlying (with quote-quality metadata) ──
    const snapshotRows = notes.flatMap((note) => calculateStructuredNoteSnapshot(note, priceResult.prices, asOf, priceResult.quoteMeta))
    const insertRes = await insertStructuredNotePriceSnapshots(client, snapshotRows)
    if (!insertRes.ok) errors.push(insertRes.error ?? 'failed to persist price snapshots')

    // ── Evaluate due observations + apply conservative status transitions ──
    let observationsChecked = 0
    let observationsUpdated = 0
    let notesUpdated = 0
    const reviewRequiredObservationIds: string[] = []

    for (const note of notes) {
      for (const observation of note.observations) {
        const evalResult = evaluateObservation(note, observation, priceResult.prices, asOf, priceResult.quoteMeta)
        if (!evalResult) continue
        observationsChecked += 1
        if (!observation.id) continue

        if (evalResult.reviewRequired) reviewRequiredObservationIds.push(observation.id)

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
          metadata: { reviewReasons: evalResult.reviewReasons },
        })
        if (ok) observationsUpdated += 1
        else errors.push(`failed to update observation ${observation.id} for note ${note.id}`)

        const statusUpdate = shouldUpdateNoteStatus(note, evalResult)
        if (statusUpdate && note.id) {
          const noteOk = await updateNoteStatusFromObservation(client, note.id, statusUpdate.newStatus)
          if (noteOk) {
            notesUpdated += 1
            if (statusUpdate.newStatus === 'autocalled') await notifyStructuredNoteCalled(client, note, req.nextUrl.origin)
          } else {
            errors.push(`failed to update note ${note.id} status to ${statusUpdate.newStatus}`)
          }
        }
      }
    }

    const status = errors.length > 0 ? (priceResult.succeeded.length > 0 || snapshotRows.length > 0 ? 'partial_success' : 'failed') : priceResult.failed.length > 0 ? 'partial_success' : 'success'

    // Phase 9E monitoring-quality summary — written into the monitoring run's
    // existing `metadata jsonb` column (no migration needed) and echoed in the
    // response so the dashboard/monitoring-status route can surface it.
    const qualitySummary = {
      providerSummary: priceResult.providerSummary,
      unsupportedSymbols: priceResult.unsupportedSymbols,
      staleSymbols: priceResult.staleSymbols,
      reviewRequiredSymbols: priceResult.reviewRequiredSymbols,
      reviewRequiredObservations: reviewRequiredObservationIds,
      fallbackProviderUsed: priceResult.fallbackProviderUsed,
      providerDisagreement: priceResult.providerDisagreement,
    }

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
      metadata: { asOf, failedSymbols: priceResult.failed, ...qualitySummary },
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
      providerSummary: qualitySummary.providerSummary,
      unsupportedSymbols: qualitySummary.unsupportedSymbols,
      staleSymbols: qualitySummary.staleSymbols,
      reviewRequiredObservations: qualitySummary.reviewRequiredObservations,
      fallbackProviderUsed: qualitySummary.fallbackProviderUsed,
      providerDisagreement: qualitySummary.providerDisagreement,
      dataPolicy: 'Monitoring estimate — not an official calculation-agent determination.',
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
