// R13.7 § 19–25 — Vercel Cron route: T-1 POTENTIAL AUTOCALL WARNING.
//
// Fires ~15 minutes after the relevant market close on the trading session
// immediately BEFORE a contractual autocall valuation date, and tells the
// administrators that a note is currently on track to be called.
//
// IT NEVER CALLS A NOTE. This route writes no status, no observation result and
// no lifecycle state — it only reads closes and sends a warning. The actual
// call is a contractual event determined by the VALUATION DATE'S own closes and
// is applied solely by /api/cron/structured-notes/snapshot from T0 data
// (§ 18). A warning is not evidence of a call.
//
// TIMING (§ 19 / R13.7B2 § 7): the schedule is expressed in UTC because Vercel
// Cron has no timezone parameter, so a single slot cannot sit ~15 minutes after
// the 16:00 America/New_York close all year. Measured effective times:
//
//   20:20Z  EDT 16:20 ET (+20)  settled   |  EST 15:20 ET (-40)  DEFERRED
//   21:15Z  EDT 17:15 ET (+75)  settled   |  EST 16:15 ET (+15)  settled
//   21:45Z  EDT 17:45 ET (+105) settled   |  EST 16:45 ET (+45)  settled
//
// So each half of the year gets a primary at ~+15-20 minutes plus at least one
// retry. The third slot exists because winter previously had exactly ONE usable
// slot sitting precisely on the settle boundary: a single deferral there would
// have lost the whole day's warning. Repeats are free — the delivery claim
// (§ 6) makes a second run a no-op.
//
// The route never assumes the schedule was right: it re-derives the prior
// trading session from the contract's own valuation date and requires fresh
// closes, so an early firing defers rather than warning on unsettled data
// (§ 25).
//
// MARKET SCOPE: every underlying in the current book is a US index, so the
// exchange timezone default (America/New_York) applies. It is passed explicitly
// rather than assumed globally — a future non-US underlying needs its own
// session calendar, and `deferred_stale_data` is the safe behaviour until then.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  getActiveNotesForMonitoring,
  createStructuredNoteMonitoringRun,
  completeStructuredNoteMonitoringRun,
  getObservationNotificationState,
  claimObservationNotification,
  completeObservationNotification,
  releaseObservationNotification,
} from '@/lib/db/repositories/structuredNotesRepository'
import { resolveNoteValuationCloses } from '@/lib/structuredNotes/valuationCloseResolver'
import {
  evaluatePotentialAutocall,
  buildPotentialAutocallMessage,
  findNextAutocallObservation,
  downsideCushionPct,
  formatPct,
  type PotentialAutocallWarning,
  type WarningSkipReason,
} from '@/lib/structuredNotes/autocallWarning'
import { previousTradingDay, hasSessionSettled } from '@/lib/structuredNotes/marketDate'
import { createNotification, getActiveNotificationRecipientEmails } from '@/lib/db/repositories/notificationsRepository'
import { sendNotificationEmail } from '@/lib/notifications/emailProvider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const EVENT_TYPE = 'potential_autocall'

/**
 * The administrator email (§ 23).
 *
 * Every figure is produced programmatically from the contract and the session's
 * closes; nothing is hardcoded per note. The wording never says "called" — it
 * says the condition is currently satisfied and states what would follow.
 */
function buildWarningEmailHtml(w: PotentialAutocallWarning, linkUrl: string): string {
  const rows = w.legs
    .map((l) => {
      const cushion = downsideCushionPct(l)
      const binding = w.bindingLeg && l.underlyingOrder === w.bindingLeg.underlyingOrder ? ' <strong>(binding)</strong>' : ''
      return `<tr><td>${l.underlyingName}${binding}</td><td align="right">${l.close ?? '—'}</td><td align="right">${l.threshold ?? '—'}</td><td align="right">${formatPct(l.relativeToThresholdPct)}</td><td align="right">${formatPct(cushion)}</td></tr>`
    })
    .join('')
  return `
    <p><strong>Pre-valuation warning — the note has NOT been called.</strong></p>
    <p>${w.isin ?? w.noteId} (${w.issuerDisplayName ?? 'issuer unavailable'}) has a contractual autocall valuation date on <strong>${w.valuationDate}</strong>.
    Based on the official closes of ${w.sessionDate}, its autocall condition is currently satisfied.</p>
    <table cellpadding="6" border="1" style="border-collapse:collapse">
      <thead><tr><th align="left">Underlying</th><th>Latest close</th><th>Call level</th><th>Above level</th><th>Downside to level</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>If the contractual condition remains satisfied at the ${w.valuationDate} valuation close, the note is expected to be called${w.redemptionDate ? `, with proceeds due on ${w.redemptionDate}` : ''}.</p>
    <p><a href="${linkUrl}">View the note →</a></p>
    <p style="color:#666">Monitoring estimate — not an official calculation-agent determination.</p>
  `
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Cron not configured — CRON_SECRET missing' }, { status: 500 })
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = getSupabaseAdminClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  // `?sessionDate=` exists for a controlled replay of a specific session during
  // review. It changes WHICH session is evaluated, never whether a warning may
  // be sent twice — that is governed by the persisted delivery marker below.
  const sessionDate = req.nextUrl.searchParams.get('sessionDate') ?? new Date().toISOString().slice(0, 10)
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'

  const warnings: string[] = []
  const errors: string[] = []

  // § 25 — MARKET-DATA ORDERING GATE, enforced here rather than trusted to the
  // schedule. A provider queried mid-session still returns a bar for today
  // carrying the CURRENT level, so without this the winter cron slot (which
  // lands before the 16:00 America/New_York close) would evaluate the
  // contractual condition against an intraday tick and warn on it. Deferring
  // costs nothing: the later slot the same day retries, and idempotency makes
  // the retry safe.
  if (!hasSessionSettled(new Date(), sessionDate)) {
    return NextResponse.json({
      status: 'deferred',
      sessionDate,
      reason: 'session_not_settled',
      detail: 'The market session for this date has not closed (plus the settle buffer). Warning deferred to a later run rather than evaluated on an unsettled level.',
      warningsSent: 0,
    })
  }

  const runId = await createStructuredNoteMonitoringRun(client, { runType: 'observation_check' })
  if (!runId) return NextResponse.json({ error: 'failed_to_start_run' }, { status: 500 })

  try {
    const notes = await getActiveNotesForMonitoring(client)
    const skipped: Record<WarningSkipReason, number> = {
      note_not_live: 0, no_upcoming_autocall_observation: 0, not_the_prior_trading_session: 0,
      deferred_stale_data: 0, condition_not_currently_satisfied: 0, already_warned: 0,
    }
    const sent: { isin: string | null; valuationDate: string; bindingUnderlying: string | null; cushionPct: number | null }[] = []
    let evaluated = 0

    for (const note of notes) {
      const next = findNextAutocallObservation(note.observations, sessionDate)
      // Cheap structural filter before any I/O: only notes whose next autocall
      // valuation date is the very next session are candidates.
      if (!next || previousTradingDay(next.valuationDate) !== sessionDate) {
        skipped[next ? 'not_the_prior_trading_session' : 'no_upcoming_autocall_observation'] += 1
        continue
      }
      evaluated += 1

      // Delivery state is read BEFORE the market data work — an already-warned
      // valuation date costs nothing further.
      const alreadyWarned = new Set<string>()
      if (next.id) {
        const state = await getObservationNotificationState(client, next.id)
        if (state[EVENT_TYPE]) alreadyWarned.add(next.valuationDate)
      }

      let sessionCloses
      try {
        const resolved = await resolveNoteValuationCloses(client, note, [sessionDate])
        sessionCloses = resolved.byDate.get(sessionDate) ?? []
      } catch (e) {
        errors.push(`failed to resolve session closes for note ${note.id}: ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`)
        continue
      }

      const result = evaluatePotentialAutocall({ note, sessionCloses, sessionDate, alreadyWarned })
      if (!result.warn) {
        skipped[result.reason] += 1
        continue
      }

      const w = result.warning
      const { title, body } = buildPotentialAutocallMessage(w)
      const linkUrl = `${req.nextUrl.origin}/structured-notes/${w.noteId}`

      if (!dryRun) {
        // R13.7B2 § 6 — CLAIM BEFORE SENDING, never "check then send".
        // The pure `alreadyWarned` gate above is for explainability; this
        // compare-and-swap is what makes the alert at-most-once when two cron
        // slots (or a slot and a manual invocation) overlap. Only the worker
        // that wins the claim may deliver anything at all.
        if (!w.observationId) {
          warnings.push(`no observation id for ${w.isin ?? w.noteId} (${w.valuationDate}) — cannot claim delivery, skipping`)
          continue
        }
        const claim = await claimObservationNotification(client, w.observationId, EVENT_TYPE)
        if (!claim.claimed) {
          skipped['already_warned'] += 1
          continue
        }

        let delivered = true
        try {
          await createNotification(client, {
            notificationType: 'structured_note_potential_autocall',
            title,
            body,
            linkUrl,
            relatedEntityType: 'structured_note',
            relatedEntityId: w.noteId,
          })
          const recipients = await getActiveNotificationRecipientEmails(client)
          if (recipients.length > 0) await sendNotificationEmail(recipients, title, buildWarningEmailHtml(w, linkUrl))
        } catch {
          // § 24 — a failed delivery is NOT recorded as delivered. Releasing
          // the claim hands the slot back so the next run retries, rather than
          // leaving an optimistic marker that would suppress the alert forever.
          delivered = false
          warnings.push(`delivery failed for ${w.isin ?? w.noteId} (${w.valuationDate}) — claim released, will retry on the next run`)
          await releaseObservationNotification(client, w.observationId, EVENT_TYPE, claim.token)
        }
        if (delivered) {
          await completeObservationNotification(client, w.observationId, EVENT_TYPE, claim.token, {
            valuationDate: w.valuationDate,
            sessionDate: w.sessionDate,
            bindingUnderlying: w.bindingLeg?.underlyingName ?? null,
          })
        } else {
          continue
        }
      }

      sent.push({
        isin: w.isin,
        valuationDate: w.valuationDate,
        bindingUnderlying: w.bindingLeg?.underlyingName ?? null,
        cushionPct: w.bindingLeg ? downsideCushionPct(w.bindingLeg) : null,
      })
    }

    const status = errors.length > 0 ? 'partial_success' : 'success'
    await completeStructuredNoteMonitoringRun(client, runId, {
      status,
      activeNoteCount: notes.length,
      underlyingCount: notes.reduce((n, x) => n + x.underlyings.length, 0),
      pricesRequested: 0, pricesSucceeded: 0, pricesFailed: 0,
      observationsChecked: evaluated, observationsUpdated: 0, notesUpdated: 0,
      warnings, errors,
      metadata: { runKind: 't_minus_1_autocall_warning', sessionDate, dryRun, sent, skipped },
    })

    return NextResponse.json({
      runId, status, sessionDate, dryRun,
      candidatesEvaluated: evaluated,
      warningsSent: sent.length,
      sent, skipped, warnings, errors,
      dataPolicy: 'Pre-valuation warning — the note has not been called. Monitoring estimate, not an official calculation-agent determination.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'Unknown error'
    await completeStructuredNoteMonitoringRun(client, runId, {
      status: 'failed', activeNoteCount: 0, underlyingCount: 0,
      pricesRequested: 0, pricesSucceeded: 0, pricesFailed: 0,
      observationsChecked: 0, observationsUpdated: 0, notesUpdated: 0,
      warnings, errors: [...errors, msg],
    })
    return NextResponse.json({ runId, status: 'failed', error: 'Autocall warning run failed', detail: msg }, { status: 500 })
  }
}
