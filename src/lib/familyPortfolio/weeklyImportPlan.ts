// R13.8A § "WORKBOOK HISTORY LEADS" — the weekly import plan.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// WHAT THIS DECIDES
//
// One upload does not mean one reporting week. If the administrator misses two
// weeks, the next workbook carries three unpublished frozen columns, and all
// three are real reporting weeks the source already closed. This module reads
// the workbook's frozen history against Production's and answers one question
// per (scope, basis, week): is this week NEW, UNCHANGED, CHANGED, or a
// BACKFILL of a hole below Production's endpoint.
//
// THE WORKBOOK LEADS. Production history + all newer frozen workbook history =
// new Production history. The newest frozen column is the week that becomes the
// current publication snapshot, but it never arrives alone: every valid
// unpublished frozen column between Production's endpoint and that newest
// column is persisted in the SAME import.
//
// AND THE WORKBOOK ALSO BOUNDS IT. A reporting week exists because the source
// froze a column for it, never because calendar time passed. If Production ends
// at 07-31 and the workbook carries 08-07 and 08-21 but no frozen 08-14, this
// module appends exactly two weeks. It does not invent 08-14, does not
// forward-fill it, does not interpolate it, and does not copy a neighbour into
// it. The absence is surfaced as a cadence gap for a human to read — a missing
// calendar week is an observation about the source, not a conflict.
//
// THE TWO CLASSES THAT MUST NEVER BE CONFLATED
//
//   * A week PRESENT in the workbook and NEWER than Production  → MUST import.
//     This is ordinary recurring behaviour even when several arrive at once.
//     Appending three weeks in one upload is a catch-up, NOT a historical
//     correction, and it requires no correction authorization.
//
//   * A week ALREADY IN PRODUCTION whose value the workbook now states
//     differently → a historical correction. That needs authorization and a
//     reason, because it changes a figure somebody has already been shown.
//
//   Counting weeks is the wrong test for which of these is happening. The test
//   is whether the reporting date already exists in Production.
//
// ATOMICITY IS PART OF THE PLAN, NOT AN AFTERTHOUGHT. A catch-up either lands
// whole or not at all: 08-07 committed while 08-21 failed would leave the chart
// showing a history that no workbook ever stated. `applyImportPlan` below is the
// reference semantics for that, and `rollbackImport` is its exact inverse — a
// rollback removes or restores EVERY point the import touched, not just the
// newest.
//
// NO PRIVATE VALUE IS FORMATTED OR LOGGED HERE. The plan carries dates, codes
// and counts for Preview; amounts appear only inside the observation records
// that the caller was already holding.

import { isCalendarDate } from './publication.ts'
import { MAX_WEEK_GAP_DAYS } from './resumen/dateDetection.ts'

/** Bumped when planning semantics change; recorded on every import. */
export const WEEKLY_IMPORT_PLAN_VERSION = 'r13.8a.weekly_import_plan.1'

/**
 * What this import does to one (scope, basis, week).
 *
 * `historical_backfill` is deliberately its own class rather than a flavour of
 * `new`. A date at or below Production's endpoint that Production has no row
 * for is a hole inside a period an administrator already reviewed — filling it
 * is a change to settled history, so it is authorized like a correction rather
 * than waved through like a new week.
 */
export type WeekDisposition = 'new' | 'unchanged' | 'changed' | 'historical_backfill'

const DISPOSITIONS: readonly WeekDisposition[] = [
  'new',
  'unchanged',
  'changed',
  'historical_backfill',
] as const

/** Severity order used to summarise a whole week from its per-series rows. */
const DISPOSITION_RANK: Record<WeekDisposition, number> = {
  changed: 3,
  historical_backfill: 2,
  new: 1,
  unchanged: 0,
}

export interface SeriesObservation {
  scope: string
  basis: string
  /** The frozen source column's own header date. Never a clock, never inferred. */
  observationDate: string
  value: number
}

export interface PlannedObservation extends SeriesObservation {
  disposition: WeekDisposition
  /** What Production holds today, or null when Production has no row. */
  priorValue: number | null
}

export interface PlannedWeek {
  observationDate: string
  /** The most consequential disposition among this week's series rows. */
  disposition: WeekDisposition
  counts: Record<WeekDisposition, number>
}

/**
 * A run of calendar time between two consecutive APPENDED reporting dates that
 * is longer than one ordinary week.
 *
 * Informational by construction. It says "the source did not freeze a column
 * here", which is a fact about the workbook — not a reason to refuse the import
 * and never a licence to manufacture the missing week.
 */
export interface CadenceGap {
  from: string
  to: string
  days: number
}

export type ImportAction =
  | 'nothing_to_append'
  | 'append_single_week'
  | 'multi_week_append'
  | 'historical_correction_only'

export type PlanBlockCode =
  | 'historical_correction_required'
  | 'invalid_observation_date'
  | 'non_finite_value'
  | 'duplicate_workbook_observation'

export interface WeeklyImportInput {
  /** Every observation the workbook's frozen columns yielded. */
  workbookObservations: readonly SeriesObservation[]
  /** Every observation Production already holds. */
  publishedObservations: readonly SeriesObservation[]
  /**
   * The latest published reporting date, when it is known independently of the
   * observation series. Passing it lets a week that was published without an
   * evolution point still count as Production's endpoint, so a hole below it is
   * classified as a backfill rather than mistaken for a new week.
   */
  latestPublishedAsOf?: string | null
  /** An administrator has authorized changing already-published history. */
  historicalCorrectionAuthorized?: boolean
  correctionReason?: string | null
}

export interface WeeklyImportPlan {
  planVersion: string
  /** Newest reporting date Production holds, or null when Production is empty. */
  productionEndpoint: string | null
  workbookLatest: string | null
  /** Ascending. Exactly what Preview must list as "will be added". */
  newDates: string[]
  changedDates: string[]
  backfillDates: string[]
  unchangedDates: string[]
  weeks: PlannedWeek[]
  /**
   * What the import writes. UNCHANGED weeks are excluded — re-stating ~500
   * identical rows on every upload is how a silent history rewrite hides.
   */
  observationsToWrite: PlannedObservation[]
  cadenceGaps: CadenceGap[]
  action: ImportAction
  requiresHistoricalCorrection: boolean
  correctionReason: string | null
  blocked: boolean
  blockCodes: PlanBlockCode[]
  /** Structural: every planned week commits together or none of them do. */
  readonly atomic: true
}

const MS_PER_DAY = 86_400_000

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY)
}

function seriesKey(o: { scope: string; basis: string; observationDate: string }): string {
  return `${o.scope}|${o.basis}|${o.observationDate}`
}

function emptyCounts(): Record<WeekDisposition, number> {
  return { new: 0, unchanged: 0, changed: 0, historical_backfill: 0 }
}

/**
 * Classifies every workbook observation against Production and produces the
 * complete import plan.
 *
 * Never mutates its inputs, never reads a clock, and never emits a date that
 * did not come from a workbook observation.
 */
export function planWeeklyImport(input: WeeklyImportInput): WeeklyImportPlan {
  const blockCodes = new Set<PlanBlockCode>()

  // ── 1. Validate the workbook side. A malformed observation is refused, never
  //       quietly dropped: dropping it would shorten the history the workbook
  //       actually states, which is the failure this whole module exists to
  //       prevent.
  const seen = new Set<string>()
  const workbook: SeriesObservation[] = []
  for (const o of input.workbookObservations) {
    if (!isCalendarDate(o.observationDate)) {
      blockCodes.add('invalid_observation_date')
      continue
    }
    if (!Number.isFinite(o.value)) {
      blockCodes.add('non_finite_value')
      continue
    }
    const key = seriesKey(o)
    if (seen.has(key)) {
      blockCodes.add('duplicate_workbook_observation')
      continue
    }
    seen.add(key)
    workbook.push({ ...o })
  }

  // ── 2. Production's shape.
  const published = new Map<string, number>()
  let endpoint: string | null = null
  for (const o of input.publishedObservations) {
    if (!isCalendarDate(o.observationDate)) continue
    published.set(seriesKey(o), o.value)
    if (endpoint === null || o.observationDate > endpoint) endpoint = o.observationDate
  }
  const declared = input.latestPublishedAsOf
  if (typeof declared === 'string' && isCalendarDate(declared)) {
    if (endpoint === null || declared > endpoint) endpoint = declared
  }

  // ── 3. Classify. This is the whole rule in six lines: already present decides
  //       changed-vs-unchanged; newer-than-the-endpoint decides new-vs-backfill.
  const planned: PlannedObservation[] = []
  for (const o of workbook) {
    const key = seriesKey(o)
    const hasPrior = published.has(key)
    const priorValue = hasPrior ? (published.get(key) as number) : null
    let disposition: WeekDisposition
    if (hasPrior) {
      disposition = priorValue === o.value ? 'unchanged' : 'changed'
    } else if (endpoint === null || o.observationDate > endpoint) {
      disposition = 'new'
    } else {
      disposition = 'historical_backfill'
    }
    planned.push({ ...o, disposition, priorValue })
  }

  // ── 4. Roll up to weeks.
  const byDate = new Map<string, Record<WeekDisposition, number>>()
  for (const p of planned) {
    let counts = byDate.get(p.observationDate)
    if (!counts) {
      counts = emptyCounts()
      byDate.set(p.observationDate, counts)
    }
    counts[p.disposition] += 1
  }
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
  const changedDates = datesWith('changed')
  const backfillDates = datesWith('historical_backfill')
  // A week counts as unchanged only when nothing else is happening to it.
  const unchangedDates = weeks
    .filter((w) => w.disposition === 'unchanged' && w.counts.unchanged > 0)
    .map((w) => w.observationDate)

  // ── 5. Cadence. Measured across the dates this import APPENDS, anchored at
  //       Production's endpoint. A gap inside already-published history is not
  //       this import's business, and a gap here NEVER produces a date.
  const cadenceGaps: CadenceGap[] = []
  const chain = endpoint === null ? [...newDates] : [endpoint, ...newDates]
  for (let i = 1; i < chain.length; i += 1) {
    const days = daysBetween(chain[i - 1], chain[i])
    if (days > MAX_WEEK_GAP_DAYS) {
      cadenceGaps.push({ from: chain[i - 1], to: chain[i], days })
    }
  }

  // ── 6. Authorization. Multi-week append alone NEVER triggers this — only a
  //       reporting date that already exists in Production does.
  const requiresHistoricalCorrection = changedDates.length > 0 || backfillDates.length > 0
  const authorized = input.historicalCorrectionAuthorized === true
  if (requiresHistoricalCorrection && !authorized) {
    blockCodes.add('historical_correction_required')
  }

  let action: ImportAction
  if (newDates.length === 0) {
    action = requiresHistoricalCorrection ? 'historical_correction_only' : 'nothing_to_append'
  } else if (newDates.length === 1) {
    action = 'append_single_week'
  } else {
    action = 'multi_week_append'
  }

  const observationsToWrite = planned.filter((p) => p.disposition !== 'unchanged')
  const workbookDates = weeks.map((w) => w.observationDate)

  return {
    planVersion: WEEKLY_IMPORT_PLAN_VERSION,
    productionEndpoint: endpoint,
    workbookLatest: workbookDates.length > 0 ? workbookDates[workbookDates.length - 1] : null,
    newDates,
    changedDates,
    backfillDates,
    unchangedDates,
    weeks,
    observationsToWrite,
    cadenceGaps,
    action,
    requiresHistoricalCorrection,
    correctionReason: input.correctionReason ?? null,
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
// without a database, and so the RPC that eventually performs the write has a
// specification it can be tested against rather than a paragraph of prose.

export interface HistoryStore {
  observations: readonly SeriesObservation[]
}

export interface ImportRecordEntry {
  scope: string
  basis: string
  observationDate: string
  /** Null when the import CREATED the row — rollback then removes it. */
  priorValue: number | null
}

export interface ImportRecord {
  importId: string
  planVersion: string
  /** Reporting dates this import introduced, ascending. */
  appendedDates: string[]
  /** Reporting dates this import restated, ascending. */
  correctedDates: string[]
  entries: ImportRecordEntry[]
}

export type ApplyFailureCode =
  | 'plan_blocked'
  | 'nothing_to_write'
  | 'non_finite_value'
  | 'invalid_observation_date'

export type ApplyResult =
  | { ok: true; store: HistoryStore; record: ImportRecord; written: number }
  | { ok: false; code: ApplyFailureCode; store: HistoryStore }

/**
 * Applies a plan whole, or not at all.
 *
 * Every observation is staged and verified BEFORE anything is committed, so a
 * failure on the last week of a three-week catch-up leaves zero of the three
 * behind. On failure the caller gets back the very store object it passed in —
 * identity, not a copy — so "nothing moved" is checkable, not merely asserted.
 */
export function applyImportPlan(
  store: HistoryStore,
  plan: WeeklyImportPlan,
  importId: string,
): ApplyResult {
  if (plan.blocked) return { ok: false, code: 'plan_blocked', store }
  if (plan.observationsToWrite.length === 0) return { ok: false, code: 'nothing_to_write', store }

  const index = new Map<string, number>()
  store.observations.forEach((o, i) => index.set(seriesKey(o), i))

  const next = store.observations.map((o) => ({ ...o }))
  const entries: ImportRecordEntry[] = []
  const appended = new Set<string>()
  const corrected = new Set<string>()

  for (const p of plan.observationsToWrite) {
    // Re-verified at the boundary. The planner already refused these, and a
    // second check here costs nothing next to committing a NaN into a chart.
    if (!Number.isFinite(p.value)) return { ok: false, code: 'non_finite_value', store }
    if (!isCalendarDate(p.observationDate)) {
      return { ok: false, code: 'invalid_observation_date', store }
    }

    const key = seriesKey(p)
    const at = index.get(key)
    const priorValue = at === undefined ? null : next[at].value
    entries.push({
      scope: p.scope,
      basis: p.basis,
      observationDate: p.observationDate,
      priorValue,
    })
    if (at === undefined) {
      index.set(key, next.length)
      next.push({
        scope: p.scope,
        basis: p.basis,
        observationDate: p.observationDate,
        value: p.value,
      })
      appended.add(p.observationDate)
    } else {
      next[at] = { ...next[at], value: p.value }
      corrected.add(p.observationDate)
    }
  }

  return {
    ok: true,
    store: { observations: next },
    record: {
      importId,
      planVersion: plan.planVersion,
      appendedDates: [...appended].sort(),
      correctedDates: [...corrected].sort(),
      entries,
    },
    written: entries.length,
  }
}

/**
 * The exact inverse of `applyImportPlan`.
 *
 * A rollback of a three-week catch-up removes all three weeks and restores
 * every value the import overwrote. Rolling back only the newest week would
 * leave the two the operator never separately approved silently standing.
 */
export function rollbackImport(store: HistoryStore, record: ImportRecord): HistoryStore {
  const remove = new Set<string>()
  const restore = new Map<string, number>()
  for (const e of record.entries) {
    const key = seriesKey(e)
    if (e.priorValue === null) remove.add(key)
    else restore.set(key, e.priorValue)
  }
  const observations = store.observations
    .filter((o) => !remove.has(seriesKey(o)))
    .map((o) => {
      const prior = restore.get(seriesKey(o))
      return prior === undefined ? { ...o } : { ...o, value: prior }
    })
  return { observations }
}
