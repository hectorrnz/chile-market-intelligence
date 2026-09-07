// R13.7B3.1 § 3, § 8 — THE RECONCILIATION MUTATION PACKET.
//
// Turns the pure analysis in `reconciliation.ts` into the exact, typed mutation
// list the atomic apply function consumes. Still no write path: this module
// builds a description of what should change and a deterministic identity for
// it, and nothing here can reach a database.
//
// WHY A PACKET AT ALL, rather than letting the RPC re-derive
// ─────────────────────────────────────────────────────────
// The database function is an APPLY mechanism, never a second decision engine.
// Every contractual conclusion — which date called, which leg bound, which rows
// are void — is made once, here, by the same code the reviewed dry run printed,
// and the RPC's only job is to verify the world still matches and then perform
// exactly these mutations. Two engines that could disagree would be worse than
// one, because the disagreement would surface as a silently different book.
//
// TOOLING/SERVER ONLY. `hashReconciliationPacket` uses `node:crypto`, so this
// module must never be imported by a client component; a test asserts that.

import { createHash } from 'node:crypto'
import type { StructuredNote, ObservationStatus, ObservationType } from './types.ts'
import type { NoteReconciliation } from './reconciliation.ts'
import { RECONCILIATION_REASON_CODE } from './reconciliation.ts'

/** One autocall row the contract defines but the defective import never wrote. */
export interface PacketObservationInsert {
  observationType: 'autocall'
  observationNumber: number
  valuationDate: string
  paymentDate: string | null
  redemptionDate: string | null
  autocallBarrierPct: number | null
  couponBarrierPct: number | null
}

/** A row to void, addressed by contractual identity and guarded by its reviewed status. */
export interface PacketObservationTarget {
  observationType: ObservationType
  valuationDate: string
  expectedStatus: ObservationStatus
}

/** The call-date autocall result, carrying the evidence that proved it. */
export interface PacketAutocallResult {
  valuationDate: string
  observedSource: string
  worstPerformerTicker: string | null
  observedLevels: Record<string, number | null>
  reviewRequired: boolean
  reviewReason: string | null
}

export interface PacketNote {
  noteId: string
  isin: string | null
  /** Pre-state assertions — the packet is refused if the book has moved. */
  expectedStatus: StructuredNote['status']
  expectedArchivedAt: string | null
  correctedStatus: StructuredNote['status']
  correctedArchivedAt: string | null
  callDate: string | null
  redemptionDate: string | null
  /** Audit only. Settlement is never persisted — it stays derived (§ 11). */
  settlement: NoteReconciliation['settlement']
  couponOnCallDate: NoteReconciliation['couponOnCallDate']
  classification: NoteReconciliation['classification']
  insertObservations: PacketObservationInsert[]
  cancelObservations: PacketObservationTarget[]
  preserveObservations: PacketObservationTarget[]
  autocallResult: PacketAutocallResult | null
  evidence: Record<string, unknown>[]
}

export interface PacketExpectedCounts {
  observationsInserted: number
  observationsAutocalled: number
  observationsCancelled: number
  notesCorrected: number
  notesUnchanged: number
}

export interface ReconciliationPacket {
  operationId: string
  actor: string
  reasonCode: string
  asOf: string
  packetHash: string
  expectedCounts: PacketExpectedCounts
  notes: PacketNote[]
}

export interface PacketEntry {
  note: StructuredNote
  result: NoteReconciliation
}

export interface PacketContext {
  operationId: string
  actor: string
  asOf: string
}

/**
 * The observation_number a synthesized autocall row takes.
 *
 * The table's own uniqueness is (note_id, observation_type, observation_number),
 * and it is scoped BY TYPE — so autocall rows number independently of the coupon
 * rows that already occupy 1..N. Numbering continues past any autocall row that
 * already exists rather than restarting, so a partially-backfilled note (a note
 * imported after the parser fix, say) cannot collide.
 */
export function nextAutocallObservationNumber(note: StructuredNote): number {
  const existing = note.observations
    .filter((o) => o.observationType === 'autocall')
    .map((o) => o.observationNumber)
  return existing.length === 0 ? 1 : Math.max(...existing) + 1
}

/** Midnight UTC of the contractual call date — the moment the note left the live book. */
export function archivedAtForCallDate(callDate: string): string {
  return `${callDate}T00:00:00.000Z`
}

/**
 * Builds the exact mutation packet for one reviewed reconciliation sweep.
 *
 * EVERY note examined is included, including notes that change nothing: the
 * apply function asserts those are still untouched afterwards, which is how
 * "we looked and deliberately changed nothing" becomes a checked claim rather
 * than an omission.
 */
export function buildReconciliationPacket(entries: PacketEntry[], ctx: PacketContext): ReconciliationPacket {
  const notes: PacketNote[] = entries.map(({ note, result }) => {
    const called = result.classification === 'confirmed_missed_autocall' ? result.expectedCallDate : null

    // ── rows to insert ──────────────────────────────────────────────────────
    let n = nextAutocallObservationNumber(note)
    const insertObservations: PacketObservationInsert[] = [...result.observationsToInsert]
      .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
      .map((o) => ({
        observationType: 'autocall' as const,
        observationNumber: n++,
        valuationDate: o.valuationDate,
        paymentDate: null,
        redemptionDate: o.redemptionDate,
        autocallBarrierPct: o.autocallBarrierPct,
        couponBarrierPct: null,
      }))

    // ── rows to void ────────────────────────────────────────────────────────
    // Everything stored after the call date, plus the autocall rows this same
    // packet is inserting on those dates. A row that is void the moment it is
    // written is still written: the schedule must be complete and honest about
    // what the contract defined, with the post-call rows marked void rather
    // than silently absent.
    const cancelObservations: PacketObservationTarget[] = []
    if (called) {
      for (const o of note.observations) {
        if (o.valuationDate > called) {
          cancelObservations.push({
            observationType: o.observationType,
            valuationDate: o.valuationDate,
            expectedStatus: o.status,
          })
        }
      }
      for (const ins of insertObservations) {
        if (ins.valuationDate > called) {
          cancelObservations.push({
            observationType: 'autocall',
            valuationDate: ins.valuationDate,
            expectedStatus: 'scheduled',
          })
        }
      }
    }
    cancelObservations.sort(
      (a, b) => a.valuationDate.localeCompare(b.valuationDate) || a.observationType.localeCompare(b.observationType),
    )

    // ── rows that must survive untouched ────────────────────────────────────
    // The coupon settled on the calling date. A coupon is not lost because the
    // note also called, so it is named explicitly and re-checked after apply.
    const preserveObservations: PacketObservationTarget[] = called
      ? note.observations
          .filter((o) => o.valuationDate === called && o.observationType === 'coupon')
          .map((o) => ({
            observationType: o.observationType,
            valuationDate: o.valuationDate,
            expectedStatus: o.status,
          }))
      : []

    // ── the call-date result and its evidence ───────────────────────────────
    const callDay = called ? result.perDate.find((d) => d.valuationDate === called) ?? null : null
    const autocallResult: PacketAutocallResult | null =
      called && callDay
        ? {
            valuationDate: called,
            observedSource: [...new Set(callDay.legs.map((l) => l.closeSource))].sort().join('+'),
            worstPerformerTicker: callDay.autocall.bindingLeg?.underlyingName ?? null,
            observedLevels: Object.fromEntries(callDay.legs.map((l) => [l.underlyingName, l.close])),
            // A historical correction is always operator-reviewed by construction:
            // it is applied from a report a human read, never by a scheduled job.
            reviewRequired: false,
            reviewReason: null,
          }
        : null

    const evidence: Record<string, unknown>[] = callDay
      ? callDay.legs.map((l) => ({
          underlying: l.underlyingName,
          close: l.close,
          autocallLevel: l.autocallLevel,
          source: l.closeSource,
          corroborated: l.corroborated,
          disagreementPct: l.disagreementPct,
        }))
      : []

    return {
      noteId: result.noteId,
      isin: result.isin,
      expectedStatus: result.storedStatus,
      expectedArchivedAt: note.archivedAt,
      correctedStatus: result.expectedStatus,
      correctedArchivedAt: called ? archivedAtForCallDate(called) : note.archivedAt,
      callDate: called,
      redemptionDate: result.expectedRedemptionDate,
      settlement: result.settlement,
      couponOnCallDate: result.couponOnCallDate,
      classification: result.classification,
      insertObservations,
      cancelObservations,
      preserveObservations,
      autocallResult,
      evidence,
    }
  })

  const expectedCounts: PacketExpectedCounts = {
    observationsInserted: notes.reduce((a, x) => a + x.insertObservations.length, 0),
    observationsAutocalled: notes.filter((x) => x.autocallResult !== null).length,
    observationsCancelled: notes.reduce((a, x) => a + x.cancelObservations.length, 0),
    notesCorrected: notes.filter((x) => x.correctedStatus !== x.expectedStatus).length,
    notesUnchanged: notes.filter((x) => x.correctedStatus === x.expectedStatus).length,
  }

  const packet: ReconciliationPacket = {
    operationId: ctx.operationId,
    actor: ctx.actor,
    reasonCode: RECONCILIATION_REASON_CODE,
    asOf: ctx.asOf,
    packetHash: '',
    expectedCounts,
    notes,
  }
  return { ...packet, packetHash: hashReconciliationPacket(packet) }
}

/**
 * A deterministic string for a packet (§ 8).
 *
 * Object keys are emitted in sorted order and arrays keep their own order, so
 * the same reviewed content always canonicalizes identically regardless of how
 * the JSON happened to be constructed. `packetHash` is excluded — a value
 * cannot contribute to its own hash.
 */
export function canonicalizeReconciliationPacket(packet: ReconciliationPacket): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(src).sort()) {
        if (src[k] === undefined) continue
        out[k] = canon(src[k])
      }
      return out
    }
    return v
  }
  const { packetHash: _ignored, ...rest } = packet
  void _ignored
  return JSON.stringify(canon(rest))
}

/** SHA-256 of the canonical form — the identity the audit record stores. */
export function hashReconciliationPacket(packet: ReconciliationPacket): string {
  return createHash('sha256').update(canonicalizeReconciliationPacket(packet), 'utf8').digest('hex')
}

/**
 * Local shape validation, run before the packet is ever sent.
 *
 * Catches an obviously malformed packet on this side of the wire so the failure
 * is a readable message rather than a database exception, and so a dry run can
 * report it without a connection. It is NOT the security boundary — the apply
 * function re-validates everything against locked rows regardless.
 */
export function validateReconciliationPacket(packet: ReconciliationPacket): string[] {
  const errors: string[] = []
  if (!packet.operationId?.trim()) errors.push('operationId is required')
  if (!packet.actor?.trim()) errors.push('actor is required')
  if (!packet.reasonCode?.trim()) errors.push('reasonCode is required')
  if (!packet.packetHash?.trim()) errors.push('packetHash is required')
  if (!Array.isArray(packet.notes) || packet.notes.length === 0) errors.push('notes must be a non-empty array')

  const counts = {
    observationsInserted: 0,
    observationsAutocalled: 0,
    observationsCancelled: 0,
    notesCorrected: 0,
    notesUnchanged: 0,
  }
  for (const n of packet.notes ?? []) {
    if (!n.noteId) errors.push('every note requires a noteId')
    if (!n.expectedStatus) errors.push(`${n.isin ?? n.noteId}: expectedStatus is required`)
    if (!n.correctedStatus) errors.push(`${n.isin ?? n.noteId}: correctedStatus is required`)
    if (n.autocallResult && n.correctedStatus !== 'autocalled') {
      errors.push(`${n.isin ?? n.noteId}: carries an autocall result but is not corrected to autocalled`)
    }
    if (n.correctedStatus === 'autocalled' && !n.autocallResult) {
      errors.push(`${n.isin ?? n.noteId}: corrected to autocalled without a call-date result`)
    }
    const seen = new Set<string>()
    for (const i of n.insertObservations) {
      const k = `${i.observationType}|${i.valuationDate}`
      if (seen.has(k)) errors.push(`${n.isin ?? n.noteId}: duplicate insert identity ${k}`)
      seen.add(k)
    }
    counts.observationsInserted += n.insertObservations.length
    counts.observationsCancelled += n.cancelObservations.length
    if (n.autocallResult) counts.observationsAutocalled += 1
    if (n.correctedStatus !== n.expectedStatus) counts.notesCorrected += 1
    else counts.notesUnchanged += 1
  }

  for (const k of Object.keys(counts) as (keyof PacketExpectedCounts)[]) {
    if (packet.expectedCounts?.[k] !== counts[k]) {
      errors.push(`expectedCounts.${k} says ${packet.expectedCounts?.[k]}, packet contains ${counts[k]}`)
    }
  }

  const recomputed = hashReconciliationPacket(packet)
  if (packet.packetHash && packet.packetHash !== recomputed) {
    errors.push(`packetHash does not match the packet content (expected ${recomputed})`)
  }
  return errors
}
