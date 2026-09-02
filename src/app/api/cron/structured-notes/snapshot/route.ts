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
  claimObservationNotification,
  completeObservationNotification,
  releaseObservationNotification,
  updateNoteStatusFromObservation,
} from '@/lib/db/repositories/structuredNotesRepository'
import { fetchMonitoringPrices } from '@/lib/structuredNotes/structuredNoteMonitoringProvider'
import {
  getUniqueUnderlyingSymbols,
  calculateStructuredNoteSnapshot,
  evaluateObservation,
  deriveObservationStatus,
  shouldUpdateNoteStatus,
  type ObservationEvaluation,
} from '@/lib/structuredNotes/monitoring'
import { resolveNoteValuationCloses } from '@/lib/structuredNotes/valuationCloseResolver'
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
  valuationDate: string,
  redemptionDate: string | null,
  evaluation: ObservationEvaluation,
): Promise<void> {
  if (!client || !note.id) return
  const linkUrl = `${origin}/structured-notes/${note.id}`
  const label = note.isin ?? note.issuerDisplayName ?? note.id
  const title = `Structured note called: ${label}`

  // R13.7 § 18 — the message states the CONTRACTUAL basis rather than "called
  // today": the call belongs to its valuation date, which is not necessarily
  // the day the run detected it (a catch-up run may confirm an earlier date).
  const legLines = (evaluation.event?.legs ?? [])
    .map((l) => `${l.underlyingName}: close ${l.close ?? '—'} vs call level ${l.threshold ?? '—'}`)
    .join(' · ')
  const settlementLine = redemptionDate
    ? ` Proceeds are due on the mandatory early redemption date ${redemptionDate}; the position remains outstanding until then.`
    : ' The mandatory early redemption date is not recorded for this observation — settlement is unconfirmed.'
  const body = `${note.issuerDisplayName ?? 'Issuer'} note ${note.isin ?? note.id} met its autocall condition on the contractual valuation date ${valuationDate}: every underlying closed at or above its own call level (${legLines}).${settlementLine} Monitoring estimate — not an official calculation-agent determination.`

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

/** R13.7B2 § 24 — deliberately distinct from the T-1 `potential_autocall` identity so a warning and a confirmation can never suppress one another. */
const CALL_EVENT_TYPE = 'autocall_confirmed'

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
      // R13.7 § 9/§ 18 — resolve the OFFICIAL CLOSE FOR EACH OBSERVATION'S OWN
      // VALUATION DATE before evaluating anything. Previously every due
      // observation was decided with the price map fetched for today, so a
      // missed run silently evaluated a past contractual date against a later
      // day's level.
      //
      // Observations are processed in valuation-date order so that when a run
      // catches up on several at once, an earlier autocall terminates the note
      // before any later observation is treated as live (§ 7 precedence).
      const dueObservations = note.observations
        .filter((o) => o.status === 'scheduled' && o.valuationDate <= asOf)
        .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
      if (dueObservations.length === 0) continue

      // Today's snapshot rows were just written above; inject them so the
      // same-run evaluation sees them without a read-back round trip.
      const orderByUnderlyingId = new Map((note.underlyings ?? []).filter((u) => u.id).map((u) => [u.id!, u.underlyingOrder]))
      const todaysSnapshots = snapshotRows
        .filter((r) => r.noteId === note.id && orderByUnderlyingId.has(r.underlyingId))
        .map((r) => ({ underlyingOrder: orderByUnderlyingId.get(r.underlyingId)!, priceDate: r.priceDate, close: r.price, source: r.source }))

      let closes: Awaited<ReturnType<typeof resolveNoteValuationCloses>>
      try {
        closes = await resolveNoteValuationCloses(client, note, dueObservations.map((o) => o.valuationDate), todaysSnapshots)
      } catch (e) {
        errors.push(`failed to resolve valuation-date closes for note ${note.id}: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`)
        continue
      }

      // Tracks a call detected earlier in THIS loop, so subsequent
      // observations of the same note are not evaluated as live events.
      let terminatedOn: string | null = null

      for (const observation of dueObservations) {
        // § 11 — once called, later contractual observations are no longer live
        // observations of an existing note; they are left untouched for the
        // reconciliation stage rather than evaluated or silently finalized.
        if (terminatedOn !== null && observation.valuationDate > terminatedOn) continue

        const resolved = closes.byDate.get(observation.valuationDate) ?? []
        const evalResult = evaluateObservation(note, observation, resolved, asOf, priceResult.quoteMeta)
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
        }, 'scheduled')
        // R13.7B2 § 6 — the write above is conditional on the observation still
        // being `scheduled`, so it is an atomic claim on PROCESSING this
        // observation. Filtering on `scheduled` when the list was read is not
        // enough: two concurrent runs both read it as scheduled. Exactly one
        // update can now match a row.
        if (!ok) {
          // Either a concurrent run claimed it, or the write failed. In both
          // cases this worker must not continue down the note's schedule: the
          // claimant may be applying a call that would void the later
          // observations this loop is about to reach.
          warnings.push(`observation ${observation.id} for note ${note.id} was not applied by this run (claimed by a concurrent run, or the write failed) — skipping the rest of this note`)
          break
        }
        observationsUpdated += 1

        const statusUpdate = shouldUpdateNoteStatus(note, evalResult)
        if (statusUpdate && note.id) {
          const noteOk = await updateNoteStatusFromObservation(client, note.id, statusUpdate.newStatus)
          if (noteOk) {
            notesUpdated += 1
            terminatedOn = observation.valuationDate
            if (statusUpdate.newStatus === 'autocalled') {
              // § 24 — event identity is (note, event type, valuation date),
              // and the observation row IS that identity. The claim is taken
              // atomically rather than inferred from the observation status:
              // the status transition above already gates sequential reruns,
              // but only a compare-and-swap makes the alert at-most-once when
              // two runs overlap.
              const claim = await claimObservationNotification(client, observation.id, CALL_EVENT_TYPE)
              if (claim.claimed) {
                try {
                  await notifyStructuredNoteCalled(client, note, req.nextUrl.origin, observation.valuationDate, observation.redemptionDate ?? null, evalResult)
                  await completeObservationNotification(client, observation.id, CALL_EVENT_TYPE, claim.token, {
                    valuationDate: observation.valuationDate,
                    redemptionDate: observation.redemptionDate ?? null,
                  })
                } catch {
                  await releaseObservationNotification(client, observation.id, CALL_EVENT_TYPE, claim.token)
                  warnings.push(`call notification delivery failed for note ${note.id} (${observation.valuationDate}) — claim released, will retry on the next run`)
                }
              }
            }
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
