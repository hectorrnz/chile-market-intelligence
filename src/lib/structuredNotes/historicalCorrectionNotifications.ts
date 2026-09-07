// R13.7B3.2 — HISTORICAL-CORRECTION NOTIFICATIONS, SOURCED FROM THE AUDIT RECORD.
//
// The financial reconciliation commits atomically (R13.7B3.1). This is the step
// that comes AFTER it, and it is deliberately separate: a notification failure
// must never roll back a correct book, so it is its own retryable operation
// rather than another statement inside that transaction.
//
// WHY THE AUDIT RECORD IS THE INPUT, NOT AN OPERATOR'S LIST
// ────────────────────────────────────────────────────────
// Asking a human to retype eight ISINs after a reconciliation is exactly the
// step at which a note gets missed or an uncorrected one gets a false notice.
// The `backfill` audit row already states, durably and authoritatively, which
// notes were examined, which were actually corrected, each original contractual
// call date, when the correction was applied, and the settlement classification
// recorded at apply time. So the operator supplies ONE value — the operation id
// — and everything else is derived.
//
// A note is "corrected" iff its stored status was changed, i.e.
// correctedStatus !== expectedStatus. That is precisely the rule the apply
// function counted as `notesCorrected`, and the parser below re-derives it and
// refuses the audit record if the two disagree.
//
// PURE MODULE. It builds rows and plans; it cannot reach a database, and there
// is no email path anywhere in it — `emailRecipients` is `readonly never[]`, so
// a recipient list for this type cannot even be typed, let alone assembled.

import type { StructuredNote } from './types.ts'
import type { SettlementStatus } from './contractualEvents.ts'
import {
  HISTORICAL_CORRECTION_NOTIFICATION_TYPE,
  RECONCILIATION_REASON_CODE,
  RECONCILIATION_RUN_TYPE,
  historicalCorrectionTitle,
  historicalCorrectionBody,
  historicalCorrectionMetadata,
  type HistoricalCorrectionFacts,
} from './reconciliation.ts'

/**
 * The metadata field carrying the deterministic identity.
 *
 * The identity is `<operationId>:<noteId>` for the historical-correction type.
 * It is a stored field rather than a hash of the message, because message text
 * is presentation: rewording a sentence must never make an already-delivered
 * correction look like a new one.
 */
export const HISTORICAL_CORRECTION_KEY_FIELD = 'correctionKey'

/** One reconciliation operation + one corrected note = one notification, forever. */
export function historicalCorrectionKey(operationId: string, noteId: string): string {
  return `${operationId}:${noteId}`
}

/** One note as the audit record stores it (the packet's own note entry). */
export interface AuditNote {
  noteId: string
  isin: string | null
  expectedStatus: StructuredNote['status']
  correctedStatus: StructuredNote['status']
  callDate: string | null
  redemptionDate: string | null
  settlement: SettlementStatus
  classification?: string
}

export interface ParsedReconciliationAudit {
  auditRunId: string
  operationId: string
  actor: string
  reasonCode: string
  appliedAt: string
  packetHash: string
  notesExamined: AuditNote[]
  /** Only the notes whose stored state actually changed. */
  correctedNotes: AuditNote[]
}

/** The shape read back from `structured_note_monitoring_runs`. */
export interface AuditRunRow {
  id?: string | null
  run_type?: string | null
  status?: string | null
  metadata?: unknown
}

export type ParseAuditResult =
  | { ok: true; audit: ParsedReconciliationAudit }
  | { ok: false; errors: string[] }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

/**
 * Validates one audit row and extracts the corrected-note set.
 *
 * Refuses rather than guesses. A malformed record, a non-backfill run, a run
 * that did not complete, an operation-id mismatch, or a corrected-note count
 * that disagrees with the record's own `counts.notesCorrected` all produce
 * errors — because every one of those means the thing being described is not
 * the reconciliation the operator asked about.
 */
export function parseReconciliationAuditRecord(row: AuditRunRow | null, expectedOperationId: string): ParseAuditResult {
  const errors: string[] = []
  if (!row) return { ok: false, errors: [`no reconciliation audit record found for operation "${expectedOperationId}"`] }

  if (row.run_type !== RECONCILIATION_RUN_TYPE) {
    errors.push(`audit record is run_type "${row.run_type ?? 'null'}", expected "${RECONCILIATION_RUN_TYPE}"`)
  }
  if (row.status !== 'success') {
    errors.push(`audit record status is "${row.status ?? 'null'}" — only a completed, successful reconciliation may be announced`)
  }

  const md = row.metadata
  if (!md || typeof md !== 'object' || Array.isArray(md)) {
    errors.push('audit record metadata is not an object')
    return { ok: false, errors }
  }
  const m = md as Record<string, unknown>

  const operationId = str(m.operationId)
  const actor = str(m.actor)
  const appliedAt = str(m.appliedAt)
  const packetHash = str(m.packetHash)
  const reasonCode = str(m.reasonCode)

  if (!operationId) errors.push('audit metadata has no operationId')
  else if (operationId !== expectedOperationId) {
    errors.push(`audit metadata operationId "${operationId}" does not match the requested "${expectedOperationId}"`)
  }
  if (!actor) errors.push('audit metadata has no actor')
  if (!appliedAt) errors.push('audit metadata has no appliedAt')
  if (!packetHash) errors.push('audit metadata has no packetHash')
  if (reasonCode !== RECONCILIATION_REASON_CODE) {
    errors.push(`audit metadata reasonCode is "${reasonCode ?? 'null'}", expected "${RECONCILIATION_REASON_CODE}"`)
  }

  const rawNotes = m.notes
  if (!Array.isArray(rawNotes) || rawNotes.length === 0) {
    errors.push('audit metadata has no notes array')
    return { ok: false, errors }
  }

  const notesExamined: AuditNote[] = []
  for (const [i, raw] of rawNotes.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`audit note ${i} is not an object`)
      continue
    }
    const n = raw as Record<string, unknown>
    const noteId = str(n.noteId)
    const expectedStatus = str(n.expectedStatus)
    const correctedStatus = str(n.correctedStatus)
    if (!noteId) { errors.push(`audit note ${i} has no noteId`); continue }
    if (!expectedStatus || !correctedStatus) {
      errors.push(`audit note ${noteId} is missing expectedStatus or correctedStatus`)
      continue
    }
    notesExamined.push({
      noteId,
      isin: str(n.isin),
      expectedStatus: expectedStatus as StructuredNote['status'],
      correctedStatus: correctedStatus as StructuredNote['status'],
      callDate: str(n.callDate),
      redemptionDate: str(n.redemptionDate),
      settlement: (str(n.settlement) ?? 'unknown') as SettlementStatus,
      classification: str(n.classification) ?? undefined,
    })
  }

  const correctedNotes = notesExamined.filter((n) => n.correctedStatus !== n.expectedStatus)

  // Cross-check against the record's own tally. If the notes array and the
  // counts disagree, one of them is wrong and neither can be trusted to decide
  // who gets told their note changed state.
  const counts = m.counts
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    const declared = (counts as Record<string, unknown>).notesCorrected
    if (typeof declared === 'number' && declared !== correctedNotes.length) {
      errors.push(
        `audit metadata is inconsistent: counts.notesCorrected is ${declared} but ${correctedNotes.length} note(s) show a status change`,
      )
    }
  } else {
    errors.push('audit metadata has no counts object')
  }

  // A corrected note with no call date cannot be described honestly.
  for (const n of correctedNotes) {
    if (!n.callDate) errors.push(`corrected note ${n.isin ?? n.noteId} has no original call date in the audit record`)
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    audit: {
      auditRunId: str(row.id) ?? '',
      operationId: operationId!,
      actor: actor!,
      reasonCode: RECONCILIATION_REASON_CODE,
      appliedAt: appliedAt!,
      packetHash: packetHash!,
      notesExamined,
      correctedNotes,
    },
  }
}

/**
 * One notification row, ready to insert.
 *
 * `emailRecipients` is `readonly never[]` — the same construction R13.7B2.1
 * chose, and the reason this type can never carry an address: there is no
 * value assignable to it other than the empty array.
 */
export interface HistoricalCorrectionRow {
  correctionKey: string
  notificationType: typeof HISTORICAL_CORRECTION_NOTIFICATION_TYPE
  title: string
  body: string
  linkUrl: string
  relatedEntityType: 'structured_note'
  relatedEntityId: string
  metadata: Record<string, unknown>
  emailRecipients: readonly never[]
}

/** The correction date shown to a reader — the date the reconciliation was applied. */
export function correctionDateFromAudit(audit: ParsedReconciliationAudit): string {
  return audit.appliedAt.slice(0, 10)
}

/**
 * Exactly one row per note the reconciliation actually corrected.
 *
 * A note that was examined and deliberately left alone produces nothing: it did
 * not change, so there is nothing to correct anyone's understanding of.
 */
export function buildHistoricalCorrectionRows(audit: ParsedReconciliationAudit): HistoricalCorrectionRow[] {
  const correctionDate = correctionDateFromAudit(audit)
  return audit.correctedNotes.map((n) => {
    const facts: HistoricalCorrectionFacts = {
      noteId: n.noteId,
      label: n.isin ?? n.noteId,
      callDate: n.callDate,
      redemptionDate: n.redemptionDate,
      settlement: n.settlement,
      previousStatus: n.expectedStatus,
      correctedStatus: n.correctedStatus,
    }
    const correctionKey = historicalCorrectionKey(audit.operationId, n.noteId)
    return {
      correctionKey,
      notificationType: HISTORICAL_CORRECTION_NOTIFICATION_TYPE,
      title: historicalCorrectionTitle(facts.label),
      body: historicalCorrectionBody(facts, correctionDate),
      linkUrl: `/structured-notes/${n.noteId}`,
      relatedEntityType: 'structured_note',
      relatedEntityId: n.noteId,
      metadata: {
        ...historicalCorrectionMetadata(facts, correctionDate),
        [HISTORICAL_CORRECTION_KEY_FIELD]: correctionKey,
        operationId: audit.operationId,
        auditRunId: audit.auditRunId,
        packetHash: audit.packetHash,
        appliedBy: audit.actor,
        appliedAt: audit.appliedAt,
      },
      emailRecipients: [],
    }
  })
}

export interface HistoricalCorrectionPlan {
  expected: HistoricalCorrectionRow[]
  toCreate: HistoricalCorrectionRow[]
  alreadyPresent: HistoricalCorrectionRow[]
}

/**
 * Splits the expected rows against what the feed already holds.
 *
 * This is what makes a RETRY safe and a PARTIAL retry correct: after a run that
 * created five of eight, re-running plans exactly the missing three. The unique
 * index is still the hard guarantee — this is the readable half, not the
 * enforcement.
 */
export function planHistoricalCorrectionNotifications(
  expected: HistoricalCorrectionRow[],
  existingKeys: readonly string[],
): HistoricalCorrectionPlan {
  const have = new Set(existingKeys)
  return {
    expected,
    toCreate: expected.filter((r) => !have.has(r.correctionKey)),
    alreadyPresent: expected.filter((r) => have.has(r.correctionKey)),
  }
}
