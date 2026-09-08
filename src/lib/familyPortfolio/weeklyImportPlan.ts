// R13.8B § "WORKBOOK HISTORY LEADS" — the weekly import plan.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// WHAT THIS DECIDES
//
// One upload does not mean one reporting week. If the administrator misses two
// weeks, the next workbook carries three unpublished frozen columns, and all
// three are real reporting weeks the source already closed. This module reads
// the workbook's frozen history against Production's and answers one question
// per canonical identity: what does this import do to it.
//
// THE WORKBOOK LEADS. Production history + all newer frozen workbook history =
// new Production history. Whatever the workbook supplies and Production lacks
// is imported — whether it sits above Production's endpoint or inside a hole
// below it.
//
// AND THE WORKBOOK ALSO BOUNDS IT. A reporting week exists because the source
// froze a column for it, never because calendar time passed. If Production ends
// at 07-31 and the workbook carries 08-07 and 08-21 but no frozen 08-14, this
// module appends exactly two weeks. It does not invent 08-14, does not
// forward-fill it, does not interpolate it, and does not synthesise a zero or
// an `unavailable` point merely to make the cadence look weekly. A cadence gap
// is informational; it is never permission to fabricate history.
//
// ONE IMPORT, ONE CURRENT PUBLICATION, N HISTORY POINTS
//
// A catch-up produces ONE import operation: N history mutations plus ONE
// current publication, dated at the newest valid FROZEN reporting date. It does
// NOT mint a publication revision per intermediate week. The workbook was
// uploaded once, so the audit model says so once.
//
// THE ONE CLASS THAT NEEDS A HUMAN
//
//   * INSERTIONS — `new` above the endpoint, `gap_fill` at or below it — add a
//     historical identity Production does not have. Nothing is overwritten, so
//     no correction authorization is required, however many arrive at once.
//
//   * `changed` OVERWRITES an identity Production already holds. That needs
//     authorization AND a non-empty reason, because it restates a figure
//     somebody has already been shown.
//
//   Counting weeks is the wrong test for which of these is happening, and so is
//   comparing the date to the endpoint. The test is whether the canonical
//   Production identity ALREADY EXISTS.
//
// ABSENT IS NOT THE SAME AS UNAVAILABLE. A Production row whose status is
// `unavailable` is an existing historical state, not a hole. A workbook that
// now supplies a number for it is OVERWRITING that state — `changed`, with the
// authorization that implies — never `gap_fill`. `gap_fill` applies only when
// the canonical identity is genuinely absent.
//
// ATOMICITY IS PART OF THE PLAN, NOT AN AFTERTHOUGHT. A catch-up either lands
// whole or not at all: 08-07 committed while 08-21 failed would leave the chart
// showing a history no workbook ever stated. `applyImportPlan` below is the
// reference semantics for that, and `rollbackImport` is its exact inverse — it
// removes every insertion, restores every overwritten value AND status to its
// exact prior state, and restores the prior current publication.
//
// NO PRIVATE VALUE IS FORMATTED OR LOGGED HERE. Amounts appear only inside the
// records the caller was already holding, and inside the `corrections` array
// Preview needs in order to show a before/after to an administrator entitled to
// see it. Nothing here writes to a log, a stream or a file.

import { isCalendarDate } from './publication.ts'
import type { PublicationComparison, PublicationDifference } from './publicationMaterialDiff.ts'
import { MAX_WEEK_GAP_DAYS } from './resumen/dateDetection.ts'

/**
 * Bumped when planning semantics change; recorded on every import.
 *
 * R13.8D.1 adds HISTORICAL PUBLICATION RESTATEMENTS as a first-class outcome
 * alongside the evolution dispositions — a real semantics change, not a refactor.
 */
export const WEEKLY_IMPORT_PLAN_VERSION = 'r13.8d1.weekly_import_plan.1'

/**
 * Whether an observation carries a number or is an explicit absence of one.
 *
 * `unavailable` is a STATE, not a missing row. The distinction is the whole of
 * § 4: a Production row that says "unavailable" has already been published as
 * such, so replacing it with a number is an overwrite.
 */
export type ObservationStatus = 'stated' | 'unavailable'

/**
 * What this import does to one canonical identity.
 *
 * `invalid` is a classification rather than a silent drop. Dropping an
 * uninterpretable observation would shorten the history the workbook actually
 * states, which is the failure this whole module exists to prevent — so an
 * invalid point is named, counted, and blocks the import.
 */
export type WeekDisposition = 'unchanged' | 'new' | 'gap_fill' | 'changed' | 'invalid'

const DISPOSITIONS: readonly WeekDisposition[] = [
  'unchanged',
  'new',
  'gap_fill',
  'changed',
  'invalid',
] as const

/** Severity order used to summarise a whole week from its per-series rows. */
const DISPOSITION_RANK: Record<WeekDisposition, number> = {
  invalid: 4,
  changed: 3,
  gap_fill: 2,
  new: 1,
  unchanged: 0,
}

/** The dispositions that write a row. `unchanged` and `invalid` do not. */
export type WriteDisposition = 'new' | 'gap_fill' | 'changed'

const WRITING: readonly WeekDisposition[] = ['new', 'gap_fill', 'changed'] as const

export interface SeriesObservation {
  scope: string
  basis: string
  /** The frozen source column's own header date. Never a clock, never inferred. */
  observationDate: string
  /** Null iff the status is `unavailable`. */
  value: number | null
  /**
   * Omitted is inferred: a finite number is `stated`, an explicit null is
   * `unavailable`. Anything else is invalid rather than guessed.
   */
  status?: ObservationStatus
  /**
   * Discriminates two series that share a scope and basis. Part of the
   * canonical identity tuple; defaults to empty, which is today's behaviour.
   */
  seriesIdentity?: string
}

/** A `SeriesObservation` whose status has been resolved and validated. */
export interface CanonicalObservation {
  scope: string
  basis: string
  observationDate: string
  seriesIdentity: string
  value: number | null
  status: ObservationStatus
}

export interface PlannedObservation extends CanonicalObservation {
  disposition: WeekDisposition
  /** What Production holds today. A null STATUS means the identity is ABSENT. */
  priorValue: number | null
  priorStatus: ObservationStatus | null
}

export interface PlannedWeek {
  observationDate: string
  /** The most consequential disposition among this week's series rows. */
  disposition: WeekDisposition
  counts: Record<WeekDisposition, number>
}

/**
 * One overwritten identity, carried so Preview can show `before → after`.
 *
 * Only `changed` points appear here. An insertion has no before.
 */
export interface PlannedCorrection {
  scope: string
  basis: string
  seriesIdentity: string
  observationDate: string
  beforeValue: number | null
  beforeStatus: ObservationStatus
  afterValue: number | null
  afterStatus: ObservationStatus
}

/**
 * A run of calendar time longer than one ordinary week between two consecutive
 * reporting dates in the region this import touches.
 *
 * Informational by construction. It says "the source did not freeze a column
 * here", which is a fact about the workbook — not a reason to refuse the import
 * and never a licence to manufacture the missing week. It is measured over the
 * POST-import sequence, so a gap this import fills correctly stops being
 * reported.
 */
export interface CadenceGap {
  from: string
  to: string
  days: number
}

/**
 * R13.8D.1 — ONE ALREADY-PUBLISHED WEEK THE WORKBOOK NOW STATES DIFFERENTLY.
 *
 * WHY THIS IS NOT AN EVOLUTION `changed`. The evolution series is
 * `(scope, basis, date) → portfolio value`. A publication is far more than that:
 * ~195 snapshot rows and ~25 performance rows per week, carrying weekly P&L, net
 * flows, YTD, every holding and every sociedad total. A workbook can leave every
 * evolution VALUE identical — so the planner correctly reports zero CHANGED —
 * and still restate how that same value was ATTRIBUTED: move an amount from net
 * flows into weekly profit and the level never moves while the published
 * performance figures do.
 *
 * R13.8C.2 established that history equality is not publication equality for the
 * week being published. This is the same asymmetry one step back: settling a
 * past week does not make the workbook's current view of it irrelevant. Left
 * undetected, the import appends new weeks and quietly leaves published weeks
 * disagreeing with the authoritative source — the exact silent-staleness failure
 * the no-op guard exists to prevent, only earlier in the series.
 *
 * These are deliberately NOT folded into `corrections`/`changedDates`. Merging
 * them would mislabel a publication restatement as an evolution overwrite, and
 * the two have different payloads, different write paths and different
 * before-images. They share only the AUTHORIZATION GATE, because both overwrite
 * settled financial history.
 */
export interface HistoricalPublicationRestatement {
  /** The already-published reporting date being restated. */
  asOfDate: string
  /**
   * The standing publication this restatement was computed against, and the row
   * the write will supersede. Carried into the plan fingerprint: if a different
   * revision becomes current between preview and confirm, the id moves and the
   * confirmation is refused rather than applied to a book nobody reviewed.
   */
  publicationId: string
  revision: number
  /** The true total, even when `differences` was capped for display. */
  differenceCount: number
  /** A BOUNDED sample. A week has ~220 rows; a preview never dumps them all. */
  differences: PublicationDifference[]
}

/**
 * What the import DOES, across both halves of the book.
 *
 * R13.8C.2 split the question in two. `nothing_to_append` used to mean "the
 * evolution series is unchanged"; it now means the FULL import mutates nothing —
 * unchanged history AND a current publication materially equivalent to the one
 * already standing. The two actions that name a publication change exist because
 * the old vocabulary could not distinguish "there is nothing to do" from "the
 * history is settled but this week's snapshot has been restated", and collapsing
 * them refused the second as if it were the first.
 */
export type ImportAction =
  | 'nothing_to_append'
  | 'append_single_week'
  | 'multi_week_append'
  | 'historical_correction_only'
  | 'append_with_correction'
  /** History settled; this week's published snapshot has materially changed. */
  | 'publication_correction'
  /** An overwrite of history AND a restatement of the standing snapshot. */
  | 'mixed_correction'

export type PlanBlockCode =
  | 'historical_correction_required'
  | 'correction_reason_required'
  | 'invalid_observation'
  | 'duplicate_workbook_observation'

export interface WeeklyImportInput {
  /** Every observation the workbook's frozen columns yielded. */
  workbookObservations: readonly SeriesObservation[]
  /** Every observation Production already holds, including `unavailable` ones. */
  publishedObservations: readonly SeriesObservation[]
  /**
   * The latest published reporting date, when it is known independently of the
   * observation series — normally the current publication's `as_of_date`.
   * Passing it lets a week published without an evolution point still bound the
   * endpoint, so a hole below it is classified as a gap fill rather than
   * mistaken for a new week.
   */
  latestPublishedAsOf?: string | null
  /** An administrator has authorized OVERWRITING already-published history. */
  historicalCorrectionAuthorized?: boolean
  correctionReason?: string | null
  /**
   * Whether the current publication this import would mint is materially the
   * same as the one already standing for its week (R13.8C.2).
   *
   * OMITTING IT IS NOT "unchanged" AND NOT "changed" — it is `not_compared`, the
   * absence of an observation, which this planner treats as no evidence of a
   * publication change. That keeps every pure-planner call and every review
   * fixture behaving exactly as it did before R13.8C.2, and it never invents a
   * change nobody looked for. The real path always supplies it: the preview
   * server reads the standing publication and compares it, and the DATABASE
   * repeats the comparison against its own rows regardless of what arrives here.
   */
  publicationComparison?: PublicationComparison
  /**
   * R13.8D.1 — already-published weeks this workbook materially restates.
   *
   * OMITTING IT IS "none observed", never "none exist" — the same discipline as
   * `publicationComparison`. A pure caller that never read Production's
   * publications must not have restatements invented for it, and must keep its
   * pre-R13.8D.1 classification exactly. The real path always supplies the set,
   * and the DATABASE re-derives it from its own rows before writing anything.
   */
  historicalPublicationRestatements?: readonly HistoricalPublicationRestatement[]
}

export interface WeeklyImportPlan {
  planVersion: string
  /** Newest reporting date Production holds, or null when Production is empty. */
  productionEndpoint: string | null
  /**
   * The newest VALID frozen reporting date in the workbook — the single date
   * the current publication snapshot will carry. Null when the workbook yielded
   * no interpretable observation.
   */
  publicationDate: string | null
  workbookLatest: string | null
  /** Ascending. Preview lists these three groups separately, never merged. */
  newDates: string[]
  gapFillDates: string[]
  changedDates: string[]
  unchangedDates: string[]
  invalidDates: string[]
  weeks: PlannedWeek[]
  /**
   * What the import writes. UNCHANGED weeks are excluded — re-stating ~500
   * identical rows on every upload is how a silent history rewrite hides.
   */
  observationsToWrite: PlannedObservation[]
  /** Every overwrite, with its before-image, for Preview's corrections block. */
  corrections: PlannedCorrection[]
  cadenceGaps: CadenceGap[]
  action: ImportAction
  /**
   * The publication half of the no-op question (R13.8C.2). `not_compared` when
   * the caller supplied no comparison — see `WeeklyImportInput`.
   */
  publicationComparison: PublicationComparison
  /** True when this week's standing snapshot is materially restated. */
  publicationChanged: boolean
  /**
   * R13.8D.1 — already-published weeks this workbook restates, ascending by
   * date. Reported separately from `corrections`, which are evolution
   * overwrites; a plan can carry either, both or neither.
   */
  historicalPublicationRestatements: HistoricalPublicationRestatement[]
  historicalRestatementDates: string[]
  /**
   * True when an existing EVOLUTION identity is being overwritten OR an
   * already-published week is being restated.
   *
   * Both overwrite settled financial history, so both pass through the one
   * authorization gate. The plan still reports the two causes separately, so an
   * administrator is never shown "historical correction required" without being
   * told which kind — see `corrections` and `historicalPublicationRestatements`.
   */
  requiresHistoricalCorrection: boolean
  /** Which of the two causes triggered the gate. Either, both, or neither. */
  requiresEvolutionCorrection: boolean
  requiresPublicationRestatementCorrection: boolean
  correctionReason: string | null
  blocked: boolean
  blockCodes: PlanBlockCode[]
  /** Structural: every planned mutation commits together or none of them do. */
  readonly atomic: true
}

const MS_PER_DAY = 86_400_000

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY)
}

/**
 * The canonical identity: (scope, basis, series identity, reporting date).
 *
 * `|` cannot occur in a scope, a basis or an ISO date, so the key is
 * unambiguous. Never derive an identity from a filename or an upload id — those
 * change between imports that describe the same week.
 */
function identityKey(o: {
  scope: string
  basis: string
  observationDate: string
  seriesIdentity?: string
}): string {
  return [o.scope, o.basis, o.seriesIdentity ?? '', o.observationDate].join('|')
}

function emptyCounts(): Record<WeekDisposition, number> {
  return { unchanged: 0, new: 0, gap_fill: 0, changed: 0, invalid: 0 }
}

/**
 * Resolves an observation's status, or reports that it cannot be interpreted.
 *
 * Contradictions are refused, never reconciled: a `stated` row without a finite
 * number, or an `unavailable` row carrying one, is INVALID. Guessing which half
 * of a contradiction the source meant is how a fabricated figure gets in.
 */
export function canonicalize(o: SeriesObservation): CanonicalObservation | null {
  if (!isCalendarDate(o.observationDate)) return null

  const finite = typeof o.value === 'number' && Number.isFinite(o.value)
  let status: ObservationStatus
  if (o.status === undefined) {
    if (finite) status = 'stated'
    else if (o.value === null) status = 'unavailable'
    else return null
  } else if (o.status === 'stated') {
    if (!finite) return null
    status = 'stated'
  } else if (o.status === 'unavailable') {
    if (o.value !== null && o.value !== undefined) return null
    status = 'unavailable'
  } else {
    return null
  }

  return {
    scope: o.scope,
    basis: o.basis,
    observationDate: o.observationDate,
    seriesIdentity: o.seriesIdentity ?? '',
    value: status === 'stated' ? (o.value as number) : null,
    status,
  }
}

/** Two states are the same only when both status AND value agree. */
function sameState(
  a: { value: number | null; status: ObservationStatus },
  b: { value: number | null; status: ObservationStatus },
): boolean {
  if (a.status !== b.status) return false
  if (a.status === 'unavailable') return true
  return a.value === b.value
}

/**
 * Classifies every workbook observation against Production and produces the
 * complete import plan.
 *
 * Never mutates its inputs, never reads a clock, and never emits a reporting
 * date that did not come from a workbook observation.
 */
export function planWeeklyImport(input: WeeklyImportInput): WeeklyImportPlan {
  const blockCodes = new Set<PlanBlockCode>()

  // ── 1. Production's shape. Built first, because classification is defined
  //       against it. An unreadable Production row is skipped rather than
  //       blocking: this import did not create it and cannot repair it.
  const published = new Map<string, CanonicalObservation>()
  let endpoint: string | null = null
  for (const raw of input.publishedObservations) {
    const o = canonicalize(raw)
    if (o === null) continue
    published.set(identityKey(o), o)
    if (endpoint === null || o.observationDate > endpoint) endpoint = o.observationDate
  }
  const declared = input.latestPublishedAsOf
  if (typeof declared === 'string' && isCalendarDate(declared)) {
    if (endpoint === null || declared > endpoint) endpoint = declared
  }

  // ── 2. Classify the workbook side. An observation that cannot be interpreted
  //       is named INVALID and blocks — never silently dropped.
  const seen = new Set<string>()
  const planned: PlannedObservation[] = []
  const invalidWeeks = new Set<string>()

  for (const raw of input.workbookObservations) {
    const o = canonicalize(raw)
    if (o === null) {
      blockCodes.add('invalid_observation')
      if (typeof raw.observationDate === 'string' && isCalendarDate(raw.observationDate)) {
        invalidWeeks.add(raw.observationDate)
      }
      continue
    }

    const key = identityKey(o)
    if (seen.has(key)) {
      blockCodes.add('duplicate_workbook_observation')
      invalidWeeks.add(o.observationDate)
      continue
    }
    seen.add(key)

    const prior = published.get(key)
    let disposition: WeekDisposition
    if (prior !== undefined) {
      // The identity EXISTS — including when its state is `unavailable`.
      disposition = sameState(prior, o) ? 'unchanged' : 'changed'
    } else if (endpoint === null || o.observationDate > endpoint) {
      disposition = 'new'
    } else {
      // Genuinely absent, at or below the endpoint. An insertion, not an
      // overwrite: the workbook leads, and nothing is being replaced.
      disposition = 'gap_fill'
    }

    planned.push({
      ...o,
      disposition,
      priorValue: prior === undefined ? null : prior.value,
      priorStatus: prior === undefined ? null : prior.status,
    })
  }

  // ── 3. Roll up to weeks.
  const byDate = new Map<string, Record<WeekDisposition, number>>()
  const bump = (date: string, d: WeekDisposition) => {
    let counts = byDate.get(date)
    if (!counts) {
      counts = emptyCounts()
      byDate.set(date, counts)
    }
    counts[d] += 1
  }
  for (const p of planned) bump(p.observationDate, p.disposition)
  for (const date of invalidWeeks) bump(date, 'invalid')

  const weeks: PlannedWeek[] = [...byDate.entries()]
    .map(([observationDate, counts]) => {
      let disposition: WeekDisposition = 'unchanged'
      for (const d of DISPOSITIONS) {
        if (counts[d] > 0 && DISPOSITION_RANK[d] > DISPOSITION_RANK[disposition]) disposition = d
      }
      return { observationDate, disposition, counts }
    })
    .sort((a, b) => (a.observationDate < b.observationDate ? -1 : 1))

  const datesWith = (d: WeekDisposition): string[] =>
    weeks.filter((w) => w.counts[d] > 0).map((w) => w.observationDate)

  const newDates = datesWith('new')
  const gapFillDates = datesWith('gap_fill')
  const changedDates = datesWith('changed')
  const invalidDates = datesWith('invalid')
  const unchangedDates = weeks
    .filter((w) => w.disposition === 'unchanged' && w.counts.unchanged > 0)
    .map((w) => w.observationDate)

  // ── 4. The single current publication: the newest VALID frozen reporting
  //       date. Intermediate weeks contribute history points, never revisions
  //       of their own — the workbook was uploaded once.
  const validDates = planned.map((p) => p.observationDate).sort()
  const publicationDate = validDates.length > 0 ? validDates[validDates.length - 1] : null

  // ── 5. Cadence, over the POST-import sequence in the region this import
  //       touches. Anchored at the latest pre-existing date at or below the
  //       earliest insertion, so a gap this import FILLS stops being reported
  //       and one it cannot fill still is. A gap NEVER produces a date.
  const inserted = [...new Set([...newDates, ...gapFillDates])].sort()
  const cadenceGaps: CadenceGap[] = []
  if (inserted.length > 0) {
    const existing = [...new Set([...published.values()].map((o) => o.observationDate))].sort()
    const atOrBelow = existing.filter((d) => d <= inserted[0])
    const anchor = atOrBelow.length > 0 ? [atOrBelow[atOrBelow.length - 1]] : []
    const forward = existing.filter((d) => d > inserted[0])
    const chain = [...new Set([...anchor, ...inserted, ...forward])].sort()
    for (let i = 1; i < chain.length; i += 1) {
      const days = daysBetween(chain[i - 1], chain[i])
      if (days > MAX_WEEK_GAP_DAYS) cadenceGaps.push({ from: chain[i - 1], to: chain[i], days })
    }
  }

  // ── 6. Authorization. ONLY AN OVERWRITE OF SETTLED HISTORY TRIGGERS IT.
  //       Neither the number of weeks nor a date sitting below the endpoint does.
  //
  //       R13.8D.1 — settled history has TWO forms, and both are overwrites:
  //       an evolution identity whose value moves, and an already-published
  //       week whose publication payload the workbook now states differently.
  //       The second used to pass through unauthorized and unreported, because
  //       the gate only looked at the evolution series. They share this gate and
  //       nothing else: the causes stay separately reported so an administrator
  //       is told WHICH kind of history is being rewritten.
  const changed = planned.filter((p) => p.disposition === 'changed')
  const restatements = [...(input.historicalPublicationRestatements ?? [])]
    .filter((r) => isCalendarDate(r.asOfDate) && r.differenceCount > 0)
    .sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : a.asOfDate > b.asOfDate ? 1 : 0))
  const historicalRestatementDates = [...new Set(restatements.map((r) => r.asOfDate))]

  const requiresEvolutionCorrection = changed.length > 0
  const requiresPublicationRestatementCorrection = restatements.length > 0
  const requiresHistoricalCorrection =
    requiresEvolutionCorrection || requiresPublicationRestatementCorrection

  const reason = typeof input.correctionReason === 'string' ? input.correctionReason.trim() : ''
  if (requiresHistoricalCorrection) {
    if (input.historicalCorrectionAuthorized !== true) {
      blockCodes.add('historical_correction_required')
    } else if (reason.length === 0) {
      blockCodes.add('correction_reason_required')
    }
  }

  // ── 7. THE FULL-IMPORT CLASSIFICATION (R13.8C.2).
  //
  // History and publication are two independent axes and are read as two. The
  // publication axis only ever DOWNGRADES a would-be no-op into a real import —
  // it can never gate, block or authorize anything, and it can never turn an
  // append into something else. An append necessarily republishes, so naming
  // that separately would add a category without adding a fact.
  //
  // `not_compared` behaves as "no publication change observed", which reproduces
  // the pre-R13.8C.2 classification exactly for every caller that does not read
  // the standing publication.
  const publicationComparison: PublicationComparison = input.publicationComparison ?? 'not_compared'
  const publicationChanged = publicationComparison === 'changed'

  const insertCount = inserted.length
  let action: ImportAction
  if (insertCount === 0) {
    if (requiresHistoricalCorrection) {
      // An overwrite of settled history that ALSO restates this week's standing
      // snapshot is both corrections at once, and the preview must say so.
      action = publicationChanged ? 'mixed_correction' : 'historical_correction_only'
    } else {
      // The R13.8C.2 correction. History is settled; if the snapshot moved, this
      // is a real publication mutation and must not be refused as a no-op.
      action = publicationChanged ? 'publication_correction' : 'nothing_to_append'
    }
  } else if (requiresHistoricalCorrection) {
    action = 'append_with_correction'
  } else if (insertCount === 1) {
    action = 'append_single_week'
  } else {
    action = 'multi_week_append'
  }

  const observationsToWrite = planned.filter((p) => WRITING.includes(p.disposition))

  const corrections: PlannedCorrection[] = changed.map((p) => ({
    scope: p.scope,
    basis: p.basis,
    seriesIdentity: p.seriesIdentity,
    observationDate: p.observationDate,
    beforeValue: p.priorValue,
    beforeStatus: p.priorStatus as ObservationStatus,
    afterValue: p.value,
    afterStatus: p.status,
  }))

  const allWeekDates = weeks.map((w) => w.observationDate)

  return {
    planVersion: WEEKLY_IMPORT_PLAN_VERSION,
    productionEndpoint: endpoint,
    publicationDate,
    workbookLatest: allWeekDates.length > 0 ? allWeekDates[allWeekDates.length - 1] : null,
    newDates,
    gapFillDates,
    changedDates,
    unchangedDates,
    invalidDates,
    weeks,
    observationsToWrite,
    corrections,
    cadenceGaps,
    action,
    publicationComparison,
    publicationChanged,
    historicalPublicationRestatements: restatements,
    historicalRestatementDates,
    requiresHistoricalCorrection,
    requiresEvolutionCorrection,
    requiresPublicationRestatementCorrection,
    correctionReason: reason.length > 0 ? reason : null,
    blocked: blockCodes.size > 0,
    blockCodes: [...blockCodes],
    atomic: true,
  }
}

// ---------------------------------------------------------------------------
// Apply / rollback — the reference semantics R13.8B's transaction must match
// ---------------------------------------------------------------------------
//
// This is a pure model of the write, not the write itself. It exists so the
// all-or-nothing property and the exact inverse of a rollback are provable
// without a database, and so the RPC that performs the write has a
// specification it can be tested against rather than a paragraph of prose.

export interface PublicationState {
  asOfDate: string
  revision: number
  /** The import operation that made this publication current, when there was one. */
  importId: string | null
}

export interface HistoryStore {
  observations: readonly CanonicalObservation[]
  currentPublication: PublicationState | null
  /**
   * R13.8D.1 — the standing publication of every already-published week, keyed
   * by reporting date.
   *
   * `is_current` is unique per `(upload_kind, as_of_date)`, not globally: every
   * past week keeps its own current row. Correcting one of those is a revision
   * OF THAT WEEK and never touches which week is newest, so this map is what a
   * historical restatement moves and `currentPublication` is not.
   *
   * Optional so every pre-R13.8D.1 caller and fixture keeps working unchanged.
   */
  publications?: Readonly<Record<string, PublicationState>>
}

/**
 * R13.8D.1 — one already-published week this import re-published, with the exact
 * revision it displaced so rollback can put that revision back.
 */
export interface PublicationCorrectionEntry {
  asOfDate: string
  /** Null only if the week somehow had no standing revision — never expected. */
  priorPublication: PublicationState | null
  newPublication: PublicationState
}

export interface ImportRecordEntry {
  scope: string
  basis: string
  seriesIdentity: string
  observationDate: string
  disposition: WriteDisposition
  /**
   * The before-image. `priorStatus === null` means the identity was ABSENT —
   * which is why rollback can tell an insertion from an overwrite without ever
   * guessing from a date or a filename.
   */
  priorValue: number | null
  priorStatus: ObservationStatus | null
  newValue: number | null
  newStatus: ObservationStatus
}

export interface ImportRecord {
  importId: string
  planVersion: string
  /** Reporting dates this import inserted above the endpoint, ascending. */
  appendedDates: string[]
  /** Reporting dates this import inserted into holes, ascending. */
  gapFilledDates: string[]
  /** Reporting dates this import overwrote, ascending. */
  correctedDates: string[]
  /** R13.8D.1 — already-published weeks this import re-published, ascending. */
  restatedDates: string[]
  correctionReason: string | null
  entries: ImportRecordEntry[]
  /** The publication this import made current, and the one it displaced. */
  publication: PublicationState
  previousPublication: PublicationState | null
  /**
   * R13.8D.1 — the before-image of every historical week this import
   * re-published. Rollback restores each of these, so a mixed import reverses
   * whole rather than leaving corrected historical revisions standing.
   */
  publicationCorrections: PublicationCorrectionEntry[]
}

export type ApplyFailureCode =
  | 'plan_blocked'
  | 'nothing_to_write'
  | 'no_publication_date'
  | 'uninterpretable_observation'

export type ApplyResult =
  | { ok: true; store: HistoryStore; record: ImportRecord; written: number }
  | { ok: false; code: ApplyFailureCode; store: HistoryStore }

/**
 * Applies a plan whole, or not at all.
 *
 * Every mutation is staged and verified BEFORE anything is committed, so a
 * failure on the last of five history inserts leaves zero of the five behind
 * AND leaves the current publication exactly where it was. On failure the
 * caller gets back the very store object it passed in — identity, not a copy —
 * so "nothing moved" is checkable rather than merely asserted.
 */
export function applyImportPlan(
  store: HistoryStore,
  plan: WeeklyImportPlan,
  importId: string,
): ApplyResult {
  if (plan.blocked) return { ok: false, code: 'plan_blocked', store }
  // R13.8C.2 — NOTHING TO WRITE IS A PROPERTY OF THE WHOLE IMPORT, NOT ONLY ITS
  // HISTORY. An import that appends no week but materially restates this week's
  // standing snapshot writes a real publication revision, and refusing it here
  // would make this reference model contradict the RPC it specifies.
  // R13.8D.1 — a restated historical week is a durable financial mutation too.
  // An import that appends nothing and leaves this week's snapshot equivalent can
  // still be correcting seven published weeks, and refusing it here would make
  // this model contradict the RPC it specifies.
  if (
    plan.observationsToWrite.length === 0 &&
    !plan.publicationChanged &&
    plan.historicalPublicationRestatements.length === 0
  ) {
    return { ok: false, code: 'nothing_to_write', store }
  }
  if (plan.publicationDate === null) return { ok: false, code: 'no_publication_date', store }

  const index = new Map<string, number>()
  store.observations.forEach((o, i) => index.set(identityKey(o), i))

  const next = store.observations.map((o) => ({ ...o }))
  const entries: ImportRecordEntry[] = []
  const appended = new Set<string>()
  const gapFilled = new Set<string>()
  const corrected = new Set<string>()

  for (const p of plan.observationsToWrite) {
    // Re-verified at the boundary. The planner already refused these, and a
    // second check here costs nothing next to committing a NaN into a chart.
    const canonical = canonicalize(p)
    if (canonical === null) return { ok: false, code: 'uninterpretable_observation', store }

    const key = identityKey(canonical)
    const at = index.get(key)
    const priorValue = at === undefined ? null : next[at].value
    const priorStatus = at === undefined ? null : next[at].status

    entries.push({
      scope: canonical.scope,
      basis: canonical.basis,
      seriesIdentity: canonical.seriesIdentity,
      observationDate: canonical.observationDate,
      disposition: p.disposition as WriteDisposition,
      priorValue,
      priorStatus,
      newValue: canonical.value,
      newStatus: canonical.status,
    })

    if (at === undefined) {
      index.set(key, next.length)
      next.push(canonical)
      if (p.disposition === 'gap_fill') gapFilled.add(canonical.observationDate)
      else appended.add(canonical.observationDate)
    } else {
      next[at] = { ...next[at], value: canonical.value, status: canonical.status }
      corrected.add(canonical.observationDate)
    }
  }

  const previousPublication = store.currentPublication
  const publication: PublicationState = {
    asOfDate: plan.publicationDate,
    revision:
      previousPublication !== null && previousPublication.asOfDate === plan.publicationDate
        ? previousPublication.revision + 1
        : 1,
    importId,
  }

  // R13.8D.1 — the historical weeks, each getting the NEXT revision OF ITS OWN
  // DATE. None of them becomes "the current publication": that stays the newest
  // frozen week, exactly as the one-upload/one-current-publication rule requires.
  const priorPublications = store.publications ?? {}
  const nextPublications: Record<string, PublicationState> = { ...priorPublications }
  const publicationCorrections: PublicationCorrectionEntry[] = []
  for (const restatement of plan.historicalPublicationRestatements) {
    const prior = priorPublications[restatement.asOfDate] ?? null
    const corrected: PublicationState = {
      asOfDate: restatement.asOfDate,
      revision: (prior?.revision ?? 0) + 1,
      importId,
    }
    nextPublications[restatement.asOfDate] = corrected
    publicationCorrections.push({
      asOfDate: restatement.asOfDate,
      priorPublication: prior,
      newPublication: corrected,
    })
  }

  const sorted = (s: Set<string>) => [...s].sort()

  return {
    ok: true,
    store: {
      observations: next,
      currentPublication: publication,
      publications: nextPublications,
    },
    record: {
      importId,
      planVersion: plan.planVersion,
      appendedDates: sorted(appended),
      gapFilledDates: sorted(gapFilled),
      correctedDates: sorted(corrected),
      restatedDates: publicationCorrections.map((c) => c.asOfDate),
      correctionReason: plan.correctionReason,
      entries,
      publication,
      previousPublication,
      publicationCorrections,
    },
    written: entries.length,
  }
}

export type RollbackFailureCode = 'superseded_by_later_import'

export type RollbackResult =
  | { ok: true; store: HistoryStore }
  | { ok: false; code: RollbackFailureCode; store: HistoryStore }

/**
 * The exact inverse of `applyImportPlan`.
 *
 * A rollback of a five-point catch-up removes all five insertions, restores
 * every overwritten value AND status, and restores the prior current
 * publication. Rolling back only the newest week would leave the ones the
 * operator never separately approved silently standing.
 *
 * It REFUSES when a later import has already moved the current publication on.
 * Reversing to a before-image that a subsequent import has since overwritten
 * would clobber that import's work — so a stale rollback is an error, not a
 * best effort.
 */
export function rollbackImport(store: HistoryStore, record: ImportRecord): RollbackResult {
  const current = store.currentPublication
  if (current === null || current.importId !== record.importId) {
    return { ok: false, code: 'superseded_by_later_import', store }
  }

  // R13.8D.1 — every historical week this import corrected must ALSO still
  // belong to it. A later import that re-published one of those weeks owns that
  // revision now, and demoting it back to this import's before-image would
  // silently discard the later correction. Refuse whole rather than reverse part.
  const priorPublications = store.publications ?? {}
  for (const correction of record.publicationCorrections) {
    const standing = priorPublications[correction.asOfDate] ?? null
    if (standing === null || standing.importId !== record.importId) {
      return { ok: false, code: 'superseded_by_later_import', store }
    }
  }

  const remove = new Set<string>()
  const restore = new Map<string, { value: number | null; status: ObservationStatus }>()
  for (const e of record.entries) {
    const key = identityKey(e)
    if (e.priorStatus === null) remove.add(key)
    else restore.set(key, { value: e.priorValue, status: e.priorStatus })
  }

  const observations = store.observations
    .filter((o) => !remove.has(identityKey(o)))
    .map((o) => {
      const prior = restore.get(identityKey(o))
      return prior === undefined ? { ...o } : { ...o, value: prior.value, status: prior.status }
    })

  // Put every corrected historical week back to the exact revision it displaced.
  // A week whose before-image was null had no standing revision at all, so it is
  // REMOVED from the map rather than left pointing at this import's work.
  const publications: Record<string, PublicationState> = { ...priorPublications }
  for (const correction of record.publicationCorrections) {
    if (correction.priorPublication === null) delete publications[correction.asOfDate]
    else publications[correction.asOfDate] = correction.priorPublication
  }

  return {
    ok: true,
    store: {
      observations,
      currentPublication: record.previousPublication,
      publications,
    },
  }
}
