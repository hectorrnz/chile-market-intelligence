// R13.7 § 28–31 — HISTORICAL RECONCILIATION (pure analysis).
//
// PURE MODULE. Given a note, its contractual schedule and the closes for the
// relevant valuation dates, it decides what the note's state SHOULD be and
// describes exactly what would have to change for the stored state to match.
//
// IT PRODUCES A PROPOSAL, NEVER A MUTATION. There is deliberately no write
// path in this file and no `apply` flag anywhere in its API: the ability to
// change a production note is not something this module can be talked into.
// Applying a reconciliation is a separately authorized stage operating on a
// reviewed report.
//
// WHY THE AUTOCALL SCHEDULE MAY HAVE TO BE SYNTHESIZED
// ────────────────────────────────────────────────────
// The notes already in production were imported by the defective parsers, so
// they carry NO autocall-typed observations at all — the contractual test was
// discarded at import. Reconciliation therefore reconstructs the autocall
// schedule the term sheet defines, using the same rule the fixed parsers now
// use (`withAutocallObservations`): an autocall opportunity exists on each
// non-final scheduled observation date that carries a call level. Those
// reconstructed rows are reported as `observationsToInsert` — proposed, and
// clearly marked as not currently present.

import type { StructuredNote, StructuredNoteObservation } from './types.ts'
import {
  evaluateCouponEvent,
  evaluateAutocallEvent,
  deriveSettlementStatus,
  type ContractualEventEvaluation,
  type SettlementStatus,
} from './contractualEvents.ts'
import { toCloseMap, type ResolvedValuationClose } from './valuationClose.ts'

/**
 * The verdict for one note (§ 29). Only `confirmed_missed_autocall` is ever
 * eligible to enter a production correction, and even then only after review.
 */
export type ReconciliationClassification =
  | 'confirmed_missed_autocall'
  | 'not_called'
  | 'insufficient_data'
  | 'contract_ambiguous'

export interface ReconciliationLeg {
  underlyingName: string
  underlyingOrder: number
  /** The level the contract measures against — 100% of initial for these families. */
  autocallLevel: number | null
  /** The official close for the valuation date, and where it came from. */
  close: number | null
  closeSource: ResolvedValuationClose['source']
  corroborated: boolean
  disagreementPct: number | null
  passed: boolean | null
}

export interface ReconciliationDateResult {
  valuationDate: string
  redemptionDate: string | null
  /** True when no autocall-typed observation exists for this date in the stored data. */
  observationSynthesized: boolean
  observationId: string | undefined
  legs: ReconciliationLeg[]
  autocall: ContractualEventEvaluation
  coupon: ContractualEventEvaluation | null
  /** The coupon observation's stored state on this date, for cross-checking. */
  storedCouponStatus: StructuredNoteObservation['status'] | null
}

export interface ProposedObservationInsert {
  observationType: 'autocall'
  valuationDate: string
  redemptionDate: string | null
  autocallBarrierPct: number | null
}

export interface ProposedFieldChange {
  table: string
  /** Row identity in human terms — an id when one exists, otherwise the natural key. */
  row: string
  field: string
  from: unknown
  to: unknown
}

export interface NoteReconciliation {
  noteId: string
  isin: string | null
  issuerDisplayName: string | null
  classification: ReconciliationClassification
  /** Why this classification, in plain terms. Always populated. */
  rationale: string
  storedStatus: StructuredNote['status']
  expectedStatus: StructuredNote['status']
  /** The earliest valuation date whose autocall condition is met. */
  expectedCallDate: string | null
  expectedRedemptionDate: string | null
  settlement: SettlementStatus
  /** Coupon outcome on the calling date — a coupon is not lost because the note also called (§ 13). */
  couponOnCallDate: 'eligible' | 'not_eligible' | 'unknown' | null
  /** Valuation dates after the call that are no longer live observations. */
  voidedObservationDates: string[]
  perDate: ReconciliationDateResult[]
  observationsToInsert: ProposedObservationInsert[]
  proposedChanges: ProposedFieldChange[]
  /** What SHOULD happen about notifications for a historical event (§ 30). */
  proposedNotification: string
  /** Notional/AUM treatment implied by the call and its settlement (§ 12). */
  proposedNotionalTreatment: string
  /** Audit fields a later applying stage must record (§ 31). */
  proposedAuditRecord: Record<string, unknown>
}

/**
 * The contractual autocall schedule for a note.
 *
 * Prefers real autocall-typed observations when present (notes imported after
 * the parser fix). Falls back to reconstructing them from the non-final
 * scheduled observations that carry a call level — flagging each as
 * synthesized so a reader always knows which rows exist and which are proposed.
 */
export function contractualAutocallSchedule(note: Pick<StructuredNote, 'observations' | 'autocallBarrierPct'>): {
  valuationDate: string
  redemptionDate: string | null
  observationId: string | undefined
  synthesized: boolean
  autocallBarrierPct: number | null
}[] {
  const real = note.observations.filter((o) => o.observationType === 'autocall')
  if (real.length > 0) {
    return real.map((o) => ({
      valuationDate: o.valuationDate,
      redemptionDate: o.redemptionDate ?? o.paymentDate ?? null,
      observationId: o.id,
      synthesized: false,
      autocallBarrierPct: o.autocallBarrierPct ?? note.autocallBarrierPct ?? null,
    }))
  }
  const finalDates = new Set(note.observations.filter((o) => o.observationType === 'final').map((o) => o.valuationDate))
  return note.observations
    .filter((o) => o.observationType === 'coupon' && !finalDates.has(o.valuationDate))
    .filter((o) => (o.autocallBarrierPct ?? note.autocallBarrierPct) !== null)
    .map((o) => ({
      valuationDate: o.valuationDate,
      redemptionDate: o.redemptionDate ?? o.paymentDate ?? null,
      observationId: undefined,
      synthesized: true,
      autocallBarrierPct: o.autocallBarrierPct ?? note.autocallBarrierPct ?? null,
    }))
    .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
}

export interface ReconcileInput {
  note: StructuredNote
  /** Closes per valuation date, from `resolveNoteValuationCloses`. */
  closesByDate: ReadonlyMap<string, ResolvedValuationClose[]>
  /** Evaluate only dates on or before this (a future opportunity has not happened yet). */
  asOf: string
}

/**
 * Independently re-derives what a note's contractual state should be.
 *
 * Deliberately re-proves everything from the contract and the closes rather
 * than trusting any earlier finding (§ 3): a note appearing in a prior audit is
 * not evidence, and this returns `not_called` for one that does not hold up.
 */
export function reconcileNote(input: ReconcileInput): NoteReconciliation {
  const { note, closesByDate, asOf } = input
  const schedule = contractualAutocallSchedule(note).filter((s) => s.valuationDate <= asOf)

  const perDate: ReconciliationDateResult[] = []
  for (const s of schedule) {
    const resolved = closesByDate.get(s.valuationDate) ?? []
    const closeMap = toCloseMap(resolved)
    const autocall = evaluateAutocallEvent(note.underlyings, closeMap)
    const coupon = evaluateCouponEvent(note.underlyings, closeMap)
    const storedCoupon = note.observations.find((o) => o.observationType === 'coupon' && o.valuationDate === s.valuationDate) ?? null

    perDate.push({
      valuationDate: s.valuationDate,
      redemptionDate: s.redemptionDate,
      observationSynthesized: s.synthesized,
      observationId: s.observationId,
      legs: note.underlyings.map((u) => {
        const r = resolved.find((x) => x.underlyingOrder === u.underlyingOrder)
        const leg = autocall.legs.find((l) => l.underlyingOrder === u.underlyingOrder)
        return {
          underlyingName: u.underlyingName,
          underlyingOrder: u.underlyingOrder,
          autocallLevel: u.autocallBarrierLevel,
          close: r?.close ?? null,
          closeSource: r?.source ?? 'unavailable',
          corroborated: r?.corroborated ?? false,
          disagreementPct: r?.disagreementPct ?? null,
          passed: leg?.met ?? null,
        }
      }),
      autocall,
      coupon,
      storedCouponStatus: storedCoupon?.status ?? null,
    })
  }

  const called = perDate.find((d) => d.autocall.outcome === 'met') ?? null
  const anyUnknown = perDate.some((d) => d.autocall.outcome === 'unknown')

  // A note with a real autocall schedule whose first opportunity is still in
  // the future is NOT ambiguous — nothing has happened yet. Only a note for
  // which no contractual call opportunity can be established AT ALL is.
  const fullSchedule = contractualAutocallSchedule(note)

  let classification: ReconciliationClassification
  let rationale: string
  if (fullSchedule.length === 0) {
    classification = 'contract_ambiguous'
    rationale = 'No contractual autocall opportunity could be established for this note: it has no autocall-typed observation and no scheduled observation carrying a call level.'
  } else if (schedule.length === 0) {
    classification = 'not_called'
    const firstFuture = fullSchedule[0]?.valuationDate ?? 'unknown'
    rationale = `The note has a contractual autocall schedule, but no opportunity has occurred on or before ${asOf} — the first is ${firstFuture}. Nothing to reconcile.`
  } else if (called) {
    classification = 'confirmed_missed_autocall'
    const src = [...new Set(called.legs.map((l) => l.closeSource))].join(' + ')
    rationale = `Every underlying closed at or above its own autocall level on ${called.valuationDate}, evaluated on that date's closes (${src}). The stored status is "${note.status}".`
  } else if (anyUnknown) {
    classification = 'insufficient_data'
    const missing = perDate.filter((d) => d.autocall.outcome === 'unknown').map((d) => d.valuationDate)
    rationale = `The autocall condition could not be determined for ${missing.join(', ')} because a valuation-date close is unavailable. Reported as undetermined rather than "not called".`
  } else {
    classification = 'not_called'
    rationale = `No autocall opportunity on or before ${asOf} had every underlying at or above its own call level.`
  }

  const expectedStatus: StructuredNote['status'] = classification === 'confirmed_missed_autocall' ? 'autocalled' : note.status
  const expectedCallDate = called?.valuationDate ?? null
  const expectedRedemptionDate = called?.redemptionDate ?? null
  const settlement = called ? deriveSettlementStatus(expectedRedemptionDate, asOf) : 'unknown'

  const couponOnCallDate = called
    ? called.coupon === null
      ? null
      : called.coupon.outcome === 'met' ? 'eligible' : called.coupon.outcome === 'not_met' ? 'not_eligible' : 'unknown'
    : null

  const voidedObservationDates = called
    ? note.observations.filter((o) => o.valuationDate > called.valuationDate).map((o) => o.valuationDate).filter((d, i, a) => a.indexOf(d) === i).sort()
    : []

  const observationsToInsert: ProposedObservationInsert[] = contractualAutocallSchedule(note)
    .filter((s) => s.synthesized)
    .map((s) => ({ observationType: 'autocall', valuationDate: s.valuationDate, redemptionDate: s.redemptionDate, autocallBarrierPct: s.autocallBarrierPct }))

  const proposedChanges: ProposedFieldChange[] = []
  if (classification === 'confirmed_missed_autocall' && called) {
    proposedChanges.push({ table: 'structured_notes', row: note.id ?? note.isin ?? 'unknown', field: 'status', from: note.status, to: 'autocalled' })
    proposedChanges.push({ table: 'structured_notes', row: note.id ?? note.isin ?? 'unknown', field: 'archived_at', from: note.archivedAt, to: `${called.valuationDate} (contractual call date)` })
    const target = called.observationId ?? `autocall @ ${called.valuationDate} (row does not exist yet)`
    proposedChanges.push({ table: 'structured_note_observations', row: target, field: 'status', from: called.observationId ? 'scheduled' : '(absent)', to: 'autocalled' })
    proposedChanges.push({ table: 'structured_note_observations', row: target, field: 'autocall_eligible', from: called.observationId ? null : '(absent)', to: true })
    for (const d of voidedObservationDates) {
      proposedChanges.push({ table: 'structured_note_observations', row: `observations @ ${d}`, field: 'status', from: 'scheduled', to: 'cancelled (post-call, no longer a live observation)' })
    }
  }

  // § 30 — never an automatic "just called" message for a historical event.
  const proposedNotification = classification === 'confirmed_missed_autocall'
    ? `Recommended: option (B) — a single administrator notification explicitly labelled "Historical correction", stating the original contractual event date (${expectedCallDate}), the correction date, and that this is a reconciliation of a missed detection rather than a new live call. Do NOT emit a standard "structured note called" alert, which reads as a live event and would be materially misleading ${expectedCallDate ? `about a call that occurred on ${expectedCallDate}` : ''}.`
    : 'No notification: nothing to reconcile.'

  const proposedNotionalTreatment = classification === 'confirmed_missed_autocall'
    ? settlement === 'settled'
      ? `Redemption date ${expectedRedemptionDate ?? 'unknown'} has passed: the position is settled and its notional leaves the live book (current notional 0), while remaining visible in historical exposure as of the call date.`
      : `Contractually called on ${expectedCallDate} but settlement is ${settlement}: the notional REMAINS OUTSTANDING until ${expectedRedemptionDate ?? 'the (unrecorded) redemption date'} — the position no longer tracks the underlyings, but the money is still at the issuer, so issuer exposure and AUM must continue to include it.`
    : 'Unchanged.'

  const proposedAuditRecord = {
    targetNoteId: note.id ?? null,
    targetIsin: note.isin,
    previousStatus: note.status,
    correctedStatus: expectedStatus,
    originalContractualEventDate: expectedCallDate,
    redemptionDate: expectedRedemptionDate,
    reasonCode: 'r13_7_missed_autocall_detection',
    reason: 'The autocall contractual test was never evaluated because the importing parser emitted no autocall observation.',
    evidence: called
      ? called.legs.map((l) => ({ underlying: l.underlyingName, close: l.close, autocallLevel: l.autocallLevel, source: l.closeSource, corroborated: l.corroborated }))
      : [],
    actor: 'system:r13.7-reconciliation (requires named operator at apply time)',
    reconciliationTimestamp: '(set at apply time)',
  }

  return {
    noteId: note.id ?? '',
    isin: note.isin,
    issuerDisplayName: note.issuerDisplayName,
    classification,
    rationale,
    storedStatus: note.status,
    expectedStatus,
    expectedCallDate,
    expectedRedemptionDate,
    settlement,
    couponOnCallDate,
    voidedObservationDates,
    perDate,
    observationsToInsert,
    proposedChanges,
    proposedNotification,
    proposedNotionalTreatment,
    proposedAuditRecord,
  }
}

/** Book-level roll-up of a reconciliation sweep. */
export function summarizeReconciliation(results: NoteReconciliation[]): Record<ReconciliationClassification, number> {
  const out: Record<ReconciliationClassification, number> = {
    confirmed_missed_autocall: 0, not_called: 0, insufficient_data: 0, contract_ambiguous: 0,
  }
  for (const r of results) out[r.classification] += 1
  return out
}
