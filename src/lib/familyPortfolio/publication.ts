// R13.5 — draft review and publication lifecycle (doc 08 Stage 5, doc 05 § 6).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// This is the decision layer between "a workbook was parsed into a draft" and
// "a week is published". Everything that decides WHETHER a publication may
// happen — and what it would supersede — lives here so it is directly testable
// without a database.
//
// The database still enforces the same guarantees independently (the R13.5
// migration's partial unique index, CHECK constraints and RPCs). This module is
// the server-side gate, not the only gate: doc 05 § 2.1's layered posture
// applies to the publication path exactly as it applies to reads.
//
// THREE RULES DRIVE EVERY DECISION BELOW, and each of them exists because the
// naive alternative silently produces a wrong book:
//
//   1. A BLOCKING FINDING BLOCKS THE WHOLE UPLOAD, not the offending row.
//      Doc 02 § 6.3: because Chilean equities feed Main's `TOTAL`, a `#NAME?`
//      there invalidates the Main scope as a whole. Dropping the row and
//      publishing a total that no longer reconciles is explicitly forbidden, as
//      is carrying the previous week forward or substituting 0.
//
//   2. A DATE IS PROPOSED, NEVER ASSERTED. The live column's date comes from
//      `TODAY()`, so it is whatever day the workbook was last recalculated
//      (doc 04 § 6). Detection proposes; an administrator confirms; a divergent
//      confirmation requires a written justification.
//
//   3. NOTHING IS EVER DELETED. A re-publish supersedes; a rollback re-points
//      `is_current` at a retained revision. Both are reversible because both
//      are additive (doc 05 § 5.1).

import type { ParseFinding } from './resumen/parseResumen.ts'
import type { AlternativesEvent, AlternativesFinding } from './alternatives/parseAlternatives.ts'
import type { EventType, ClassificationMethod } from './alternatives/colour.ts'

/** Bumped when publication semantics change; recorded on every publication. */
export const PUBLICATION_LIFECYCLE_VERSION = 'r13.5.publication.1'

export type UploadKind = 'portfolio' | 'alternatives'

/** Every reason this module refuses to publish. Codes, never prose. */
export type PublicationRefusalCode =
  | 'blocking_findings'
  | 'no_publication_date'
  | 'date_override_note_required'
  | 'invalid_publication_date'
  | 'unclassified_events'
  | 'draft_not_parsed'
  | 'nothing_to_publish'
  | 'cross_currency_total'

// ---------------------------------------------------------------------------
// 1 · Publication date (doc 02 § 3.2, § 8; doc 05 § 5.1)
// ---------------------------------------------------------------------------

export interface PublicationDateRequest {
  /** What detection proposed. May be null when detection failed entirely. */
  detected: string | null
  /** What the administrator confirmed. Null means "accept the proposal". */
  confirmed?: string | null
  /** Justification. REQUIRED when `confirmed` differs from `detected`. */
  overrideNote?: string | null
}

export type PublicationDateResult =
  | { ok: true; date: string; overridden: boolean; overrideNote: string | null }
  | { ok: false; code: PublicationRefusalCode }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar date in `YYYY-MM-DD`, rejecting e.g. `2026-02-30`. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  )
}

/**
 * Resolves the date a publication will carry.
 *
 * The override note is not paperwork. `detected` is a cached `TODAY()` artefact,
 * so an administrator overriding it is asserting something the file does not
 * say — and a published week is immutable, so the reason has to be recorded at
 * the moment the assertion is made or it is lost. The same rule is enforced
 * again by a CHECK constraint on `portfolio_source_uploads`, so no code path can
 * bypass it.
 *
 * Confirming the SAME date detection proposed is not an override and needs no
 * note.
 */
export function resolvePublicationDate(request: PublicationDateRequest): PublicationDateResult {
  const confirmed = request.confirmed ?? null
  const detected = request.detected ?? null

  if (confirmed === null && detected === null) return { ok: false, code: 'no_publication_date' }

  const chosen = confirmed ?? detected
  if (!isCalendarDate(chosen)) return { ok: false, code: 'invalid_publication_date' }
  if (detected !== null && !isCalendarDate(detected)) return { ok: false, code: 'invalid_publication_date' }

  const overridden = detected !== null && confirmed !== null && confirmed !== detected
  if (!overridden) return { ok: true, date: chosen, overridden: false, overrideNote: null }

  const note = typeof request.overrideNote === 'string' ? request.overrideNote.trim() : ''
  if (note.length === 0) return { ok: false, code: 'date_override_note_required' }

  return { ok: true, date: chosen, overridden: true, overrideNote: note }
}

// ---------------------------------------------------------------------------
// 2 · Administrator classification of unclassified events (doc 03 § 3.4)
// ---------------------------------------------------------------------------

/**
 * The three real event types. `unclassified` is deliberately absent: an
 * administrator resolves an event INTO a real type, and can never mark one back
 * to unclassified through this path.
 */
export const CLASSIFIABLE_EVENT_TYPES: readonly EventType[] = ['aporte', 'dividendo', 'distribucion'] as const

export interface EventClassificationDecision {
  /** Provenance-addressed, e.g. `Alternatives!J14`. Never a row index. */
  sourceCell: string
  eventType: EventType
}

export interface EventClassificationOutcome {
  events: AlternativesEvent[]
  /** Source cells still carrying `unclassified` after the decisions were applied. */
  unresolved: string[]
  /** Decisions that matched no draft event — reported, never silently dropped. */
  unmatched: string[]
  /** Decisions naming an event the parser had already classified. */
  ignoredAlreadyClassified: string[]
}

export function isClassifiableEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (CLASSIFIABLE_EVENT_TYPES as readonly string[]).includes(value)
}

export type ClassificationRejection =
  | { code: 'duplicate_event_classification'; cells: string[] }
  | { code: 'unknown_event_classification'; cells: string[] }
  | { code: 'event_already_classified'; cells: string[] }

/**
 * Fails closed on any classification the server cannot honour exactly.
 *
 * The browser may express administrator JUDGEMENT; it may not define source
 * facts. Three distinct submissions are refused rather than absorbed:
 *
 *   DUPLICATE — two decisions naming the same cell. Applying them by map order
 *     would let the last one silently win, so a conflicting pair would resolve
 *     differently depending on array order. There is no defensible way to pick.
 *
 *   UNKNOWN — a cell that the server-side reparse produced no event for. It is
 *     already inert (nothing matches it), but accepting it silently would let a
 *     caller believe they had classified something. It may also mean the
 *     administrator is looking at a preview of DIFFERENT bytes than the ones
 *     about to be published.
 *
 *   ALREADY CLASSIFIED — a cell the workbook's own legend resolved. Doc 03 § 3.4
 *     gives the administrator authority over UNCLASSIFIED events only;
 *     re-labelling a legend-matched colour would rewrite the source's semantics
 *     from a request body.
 *
 * Returns every rejection at once, so one publish attempt reports the full list.
 */
export function validateEventClassifications(
  events: readonly AlternativesEvent[],
  decisions: readonly EventClassificationDecision[],
): ClassificationRejection[] {
  const rejections: ClassificationRejection[] = []

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const d of decisions) {
    if (seen.has(d.sourceCell)) duplicates.add(d.sourceCell)
    seen.add(d.sourceCell)
  }
  if (duplicates.size > 0) {
    rejections.push({ code: 'duplicate_event_classification', cells: [...duplicates].sort() })
  }

  const byCell = new Map(events.map((e) => [e.sourceCell, e]))
  const unknown = decisions.filter((d) => !byCell.has(d.sourceCell)).map((d) => d.sourceCell)
  if (unknown.length > 0) {
    rejections.push({ code: 'unknown_event_classification', cells: [...new Set(unknown)].sort() })
  }

  const already = decisions
    .filter((d) => byCell.get(d.sourceCell)?.eventType !== undefined
      && byCell.get(d.sourceCell)!.eventType !== 'unclassified')
    .map((d) => d.sourceCell)
  if (already.length > 0) {
    rejections.push({ code: 'event_already_classified', cells: [...new Set(already)].sort() })
  }

  return rejections
}

/**
 * Applies administrator decisions to a draft's events.
 *
 * A decision addresses an event by its SOURCE CELL, which is stable provenance,
 * rather than by array position — a re-parse must not silently re-target a
 * decision at a different event.
 *
 * A resolved event is stamped `classification_method = 'administrator'`, so the
 * book records that a human, not the legend, assigned the type. An administrator
 * decision NEVER overwrites a type the legend already produced: reclassifying an
 * exactly-matched legend colour is a different action from resolving an
 * ambiguous one, and silently allowing it here would let a publish request
 * rewrite the workbook's own semantics.
 */
export function applyEventClassifications(
  events: readonly AlternativesEvent[],
  decisions: readonly EventClassificationDecision[],
): EventClassificationOutcome {
  const byCell = new Map<string, EventClassificationDecision>()
  for (const d of decisions) byCell.set(d.sourceCell, d)

  const matched = new Set<string>()
  const ignoredAlreadyClassified: string[] = []

  const out = events.map((event) => {
    const decision = byCell.get(event.sourceCell)
    if (!decision) return event
    matched.add(event.sourceCell)
    if (event.eventType !== 'unclassified') {
      ignoredAlreadyClassified.push(event.sourceCell)
      return event
    }
    const method: ClassificationMethod = 'administrator'
    return { ...event, eventType: decision.eventType, classificationMethod: method }
  })

  return {
    events: out,
    unresolved: out.filter((e) => e.eventType === 'unclassified').map((e) => e.sourceCell),
    unmatched: [...byCell.keys()].filter((c) => !matched.has(c)),
    ignoredAlreadyClassified,
  }
}

// ---------------------------------------------------------------------------
// 3 · Cross-currency guard (doc 03 § 4.2, decision D4)
// ---------------------------------------------------------------------------

export interface CurrencySubtotal {
  category: string
  currency: string
  currentValue: number | null
}

/**
 * True when a set of subtotals would be combined across currencies.
 *
 * The interim rule under decision D4 is that no cross-currency aggregate total
 * exists: per-currency subtotals are preserved and the USD-equivalent view stays
 * deferred. The workbook's own USD roll-up is `#NAME?` because it depends on
 * Bloomberg FX, so producing one here would be NMI's number, not the source's.
 *
 * This guard makes that rule executable rather than merely documented: any
 * publication payload that carries a single total spanning more than one
 * currency is refused before it reaches the database.
 */
export function spansMultipleCurrencies(subtotals: readonly CurrencySubtotal[]): boolean {
  return new Set(subtotals.map((s) => s.currency)).size > 1
}

/**
 * Verifies a proposed aggregate is confined to one currency.
 *
 * Returns the offending currencies when it is not, so the refusal can name what
 * was wrong without echoing any amount.
 */
export function assertSingleCurrencyAggregate(
  subtotals: readonly CurrencySubtotal[],
): { ok: true } | { ok: false; currencies: string[] } {
  const currencies = [...new Set(subtotals.map((s) => s.currency))].sort()
  return currencies.length <= 1 ? { ok: true } : { ok: false, currencies }
}

export interface CurrencyBearingHolding {
  category: string
  currency: string
}

/**
 * Verifies the subtotal set really is PER CURRENCY, not merged.
 *
 * `Real Assets` appears three times in three currencies (doc 03 § 2.1), so a
 * category alone is not a grouping key. The failure this catches is a subtotal
 * set that carries ONE `Real Assets` entry covering holdings denominated in
 * three different currencies — arithmetic that adds unlike units and looks
 * entirely plausible on screen.
 *
 * A category present in N currencies must therefore have exactly N subtotal
 * entries, one per currency, with no currency missing and none invented.
 */
export function verifyPerCurrencySubtotals(
  holdings: readonly CurrencyBearingHolding[],
  subtotals: readonly CurrencySubtotal[],
): { ok: true } | { ok: false; category: string; expected: string[]; found: string[] } {
  const byCategory = new Map<string, Set<string>>()
  for (const h of holdings) {
    const set = byCategory.get(h.category) ?? new Set<string>()
    set.add(h.currency)
    byCategory.set(h.category, set)
  }

  for (const [category, currencies] of byCategory) {
    const expected = [...currencies].sort()
    const found = subtotals.filter((s) => s.category === category).map((s) => s.currency).sort()
    const same = expected.length === found.length && expected.every((c, i) => c === found[i])
    if (!same) return { ok: false, category, expected, found }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 4 · Publishability
// ---------------------------------------------------------------------------

type AnyFinding = ParseFinding | AlternativesFinding

export interface PublishabilityInput {
  /** Parser findings for the draft under review. */
  findings: readonly AnyFinding[]
  /** True when the parser produced a usable draft at all. */
  parsed: boolean
  /** Rows (portfolio) or holdings (alternatives) the publication would write. */
  recordCount: number
  /** Source cells still unclassified AFTER administrator decisions were applied. */
  unresolvedEventCells?: readonly string[]
}

export interface PublishabilityVerdict {
  publishable: boolean
  refusals: PublicationRefusalCode[]
  blockingFindings: AnyFinding[]
  warningCount: number
  unresolvedEventCells: string[]
}

/**
 * Decides whether a reviewed draft may be published.
 *
 * Every refusal is additive: the caller is told EVERY reason at once, because
 * fixing one and rediscovering the next on the following attempt wastes a
 * recalculation round-trip through Excel.
 *
 * An unresolved event is a refusal, not a warning, at this point in the
 * lifecycle. Doc 03 § 3.4 makes it a warning at PARSE time — the draft ingests
 * fine — and doc 05 § 5.4 turns it into a publication block. Publishing a
 * holding whose timeline silently omits a value-bearing cell would present an
 * incomplete event history as though it were complete.
 */
export function assessPublishability(input: PublishabilityInput): PublishabilityVerdict {
  const refusals: PublicationRefusalCode[] = []
  const blockingFindings = input.findings.filter((f) => f.severity === 'blocking')
  const unresolved = [...(input.unresolvedEventCells ?? [])]

  if (!input.parsed) refusals.push('draft_not_parsed')
  if (blockingFindings.length > 0) refusals.push('blocking_findings')
  if (input.recordCount <= 0) refusals.push('nothing_to_publish')
  if (unresolved.length > 0) refusals.push('unclassified_events')

  return {
    publishable: refusals.length === 0,
    refusals,
    blockingFindings,
    warningCount: input.findings.filter((f) => f.severity === 'warning').length,
    unresolvedEventCells: unresolved,
  }
}

// ---------------------------------------------------------------------------
// 5 · Revisions, supersession and rollback (doc 05 § 5.1, § 6)
// ---------------------------------------------------------------------------

export interface ExistingPublication {
  id: string
  uploadKind: UploadKind
  asOfDate: string
  revision: number
  isCurrent: boolean
}

/**
 * The revision a new publication of `asOfDate` will take.
 *
 * Derived from the highest revision ALREADY RECORDED for that (kind, date), not
 * from the count of rows: a rolled-back or superseded revision is retained, so
 * counting would eventually reissue a number that already exists and collide
 * with the `(upload_kind, as_of_date, revision)` unique constraint.
 */
export function nextRevision(existing: readonly ExistingPublication[], asOfDate: string, kind: UploadKind): number {
  const revisions = existing
    .filter((p) => p.uploadKind === kind && p.asOfDate === asOfDate)
    .map((p) => p.revision)
  return revisions.length === 0 ? 1 : Math.max(...revisions) + 1
}

export interface PublicationPlan {
  asOfDate: string
  uploadKind: UploadKind
  revision: number
  /** The publication this one supersedes, or null for a first publication. */
  supersedes: string | null
  /** True when a prior revision of this exact date is being replaced. */
  isRevision: boolean
  overridden: boolean
  overrideNote: string | null
}

/**
 * Builds the plan a publication will execute.
 *
 * `supersedes` is the CURRENT publication of the same (kind, date) — never the
 * highest revision, which may itself already be superseded after a rollback. If
 * revision 2 was rolled back to revision 1, publishing again produces revision 3
 * and supersedes revision 1, because revision 1 is what readers are seeing.
 */
export function planPublication(params: {
  uploadKind: UploadKind
  date: PublicationDateResult
  existing: readonly ExistingPublication[]
}): { ok: true; plan: PublicationPlan } | { ok: false; code: PublicationRefusalCode } {
  if (!params.date.ok) return { ok: false, code: params.date.code }

  const { date, overridden, overrideNote } = params.date
  const sameDate = params.existing.filter(
    (p) => p.uploadKind === params.uploadKind && p.asOfDate === date,
  )
  const current = sameDate.find((p) => p.isCurrent) ?? null

  return {
    ok: true,
    plan: {
      asOfDate: date,
      uploadKind: params.uploadKind,
      revision: nextRevision(params.existing, date, params.uploadKind),
      supersedes: current?.id ?? null,
      isRevision: sameDate.length > 0,
      overridden,
      overrideNote,
    },
  }
}

export type RollbackRefusalCode =
  | 'publication_not_found'
  | 'already_current'
  | 'no_current_publication'
  | 'kind_mismatch'
  | 'date_mismatch'

export interface RollbackPlan {
  /** The revision becoming current again. */
  restore: ExistingPublication
  /** The revision losing `is_current`. */
  demote: ExistingPublication
}

/**
 * Builds a rollback plan, or names why one is impossible.
 *
 * Rollback is a POINTER MOVE, never a delete: both revisions survive, and the
 * restored one can be rolled forward again. The target must belong to the same
 * (kind, date) series as the current publication, because "roll back" means
 * "show an earlier revision of this week", not "show a different week".
 */
export function planRollback(
  targetId: string,
  existing: readonly ExistingPublication[],
): { ok: true; plan: RollbackPlan } | { ok: false; code: RollbackRefusalCode } {
  const target = existing.find((p) => p.id === targetId)
  if (!target) return { ok: false, code: 'publication_not_found' }
  if (target.isCurrent) return { ok: false, code: 'already_current' }

  const current = existing.find(
    (p) => p.isCurrent && p.uploadKind === target.uploadKind && p.asOfDate === target.asOfDate,
  )
  if (!current) {
    // A current publication exists for another series, or none at all. Either
    // way there is nothing in THIS series to step back from.
    const otherSeriesCurrent = existing.find((p) => p.isCurrent)
    if (!otherSeriesCurrent) return { ok: false, code: 'no_current_publication' }
    return {
      ok: false,
      code: otherSeriesCurrent.uploadKind !== target.uploadKind ? 'kind_mismatch' : 'date_mismatch',
    }
  }

  return { ok: true, plan: { restore: target, demote: current } }
}

// ---------------------------------------------------------------------------
// 6 · Administrator commentary (doc 05 § 5.6)
// ---------------------------------------------------------------------------

export interface CommentaryRevision {
  revision: number
  supersededBy: string | null
}

/**
 * The revision a commentary edit will take for one (publication, scope).
 *
 * Editing is append-and-supersede, never an in-place update, so the record of
 * what an administrator said at publication time survives every later edit.
 */
export function nextCommentaryRevision(existing: readonly CommentaryRevision[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing.map((c) => c.revision)) + 1
}

/**
 * Commentary body validation.
 *
 * Deliberately narrow: commentary is optional, is never required for
 * publication, and is never generated — there is no code path that writes it
 * other than an administrator submission (doc 05 § 5.6).
 */
export const MAX_COMMENTARY_LENGTH = 4000

export function normalizeCommentary(body: unknown): { ok: true; body: string } | { ok: false; code: 'empty' | 'too_long' } {
  if (typeof body !== 'string') return { ok: false, code: 'empty' }
  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, code: 'empty' }
  if (trimmed.length > MAX_COMMENTARY_LENGTH) return { ok: false, code: 'too_long' }
  return { ok: true, body: trimmed }
}
