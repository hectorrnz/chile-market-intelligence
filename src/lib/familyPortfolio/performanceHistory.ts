// POST-R13.8 FOLLOW-UP D — PERFORMANCE-HISTORY PLANNING.
//
// PURE. Nothing here reads the database or the network. It takes the workbook's
// per-date performance payloads and what Production already holds, and returns
// the metrics one import should stage.
//
// WHY THIS EXISTS. `portfolio_performance_rows` is keyed by `publication_id`,
// so the source's own weekly flow, profit and return exist only for a week the
// book PUBLISHED. Row history fixed the equivalent gap at row grain, but a
// custom FROM → TO comparison needs both: the levels say the portfolio moved by
// X, and only the weekly FLOWS say how much of X was money arriving rather than
// money earned. Every one of those flows sits in a week that mostly has no
// publication, and the parser already reads all of them.
//
// THE CLASSIFICATION IS `rowHistory.ts`'s, one identity dimension across:
//
//   absent, above the endpoint   -> `new`       (an insertion, no authorization)
//   absent, at or below it       -> `gap_fill`  (an insertion, no authorization)
//   present and identical        -> written nowhere at all
//   present and materially moved -> `changed`   (an OVERWRITE — authorization
//                                                and a written reason)
//
// "Materially" is `value` and `value_class` together, and nothing else.
//
// IDENTITY. `(scope, basis, metric, observation_date)` — the publication
// performance identity with the publication replaced by the date it observes.
// `basis` is present here and absent from row history for a real reason, not a
// stylistic one: it is part of the performance identity (Main publishes both
// `ex_chilean_equities` and `with_chilean_equities`) and is not part of the
// snapshot-row identity. Neither table invents a dimension its source lacks.

import type {
  PerformanceRowPayload,
  PerformanceHistoryStagedRow,
} from '@/lib/db/repositories/portfolioPublicationRepository'

/** Bumped whenever the staged shape or the classification rule changes. */
export const PERFORMANCE_HISTORY_VERSION = 'r13.8f.performance_history.1'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type PerformanceHistoryDisposition = 'new' | 'gap_fill' | 'changed'

/** One performance-history identity as Production currently holds it. */
export interface PersistedPerformanceHistoryEntry {
  scope: string
  basis: string
  metric: string
  observationDate: string
  value: number | null
  valueClass: string
}

export interface PerformanceHistoryPlanInput {
  /** The workbook's clean frozen columns: reporting date → its performance rows. */
  workbook: ReadonlyMap<string, readonly PerformanceRowPayload[]>
  /** Every identity Production already holds. */
  persisted: readonly PersistedPerformanceHistoryEntry[]
  /** Stamped on every staged row so a value can be traced to the parser that read it. */
  parserVersion: string
}

export interface PerformanceHistoryPlanCounts {
  new: number
  gap_fill: number
  changed: number
  unchanged: number
}

/** One overwritten identity, with the amounts an authorization decision needs. */
export interface PerformanceHistoryCorrection {
  scope: string
  basis: string
  metric: string
  observationDate: string
  beforeValue: number | null
  beforeValueClass: string
  afterValue: number | null
  afterValueClass: string
}

export interface PerformanceHistoryPlan {
  version: string
  /** Exactly the metrics to stage. An `unchanged` identity appears nowhere. */
  rows: PerformanceHistoryStagedRow[]
  counts: PerformanceHistoryPlanCounts
  /** Reporting dates gaining performance history for the first time, ascending. */
  datesInserted: string[]
  /** Reporting dates with at least one overwritten identity, ascending. */
  datesChanged: string[]
  corrections: PerformanceHistoryCorrection[]
  /** The newest date Production held BEFORE this import. Null when empty. */
  endpoint: string | null
  /** Dates the workbook offered that could not be planned, with the reason. */
  skipped: Array<{ date: string; reason: 'invalid_date' | 'no_metrics' | 'duplicate_identity' }>
}

function identity(scope: string, basis: string, metric: string, date: string): string {
  return `${scope}|${basis}|${metric}|${date}`
}

/**
 * Two metric states are the same when the NUMBER and the STATUS are both the
 * same. `null === null` is sameness, not absence — a metric the source has
 * never stated has not changed by still not being stated.
 */
function sameState(
  a: { value: number | null; valueClass: string },
  b: { value: number | null; valueClass: string },
): boolean {
  return a.value === b.value && a.valueClass === b.valueClass
}

/**
 * Plans one import's performance history.
 *
 * The workbook LEADS, exactly as it does for row history: every clean frozen
 * column it carries is offered, a date absent from it is never invented, and
 * overwriting a settled metric stays explicit.
 *
 * A DATE WITH NO PERFORMANCE BLOCK IS SKIPPED, NOT ZEROED. The earliest frozen
 * column in the authoritative workbook (2024-08-23) genuinely carries no
 * performance rows at all — the book had not started stating them. Recording
 * zeros there would put a fabricated "no money moved" into the one series a
 * period reconciliation subtracts.
 */
export function planPerformanceHistory(
  input: PerformanceHistoryPlanInput,
): PerformanceHistoryPlan {
  const persistedByIdentity = new Map<string, PersistedPerformanceHistoryEntry>()
  let endpoint: string | null = null
  for (const p of input.persisted) {
    persistedByIdentity.set(identity(p.scope, p.basis, p.metric, p.observationDate), p)
    if (endpoint === null || p.observationDate > endpoint) endpoint = p.observationDate
  }

  const rows: PerformanceHistoryStagedRow[] = []
  const counts: PerformanceHistoryPlanCounts = { new: 0, gap_fill: 0, changed: 0, unchanged: 0 }
  const corrections: PerformanceHistoryCorrection[] = []
  const insertedDates = new Set<string>()
  const changedDates = new Set<string>()
  const skipped: PerformanceHistoryPlan['skipped'] = []

  for (const date of [...input.workbook.keys()].sort()) {
    if (!ISO_DATE.test(date)) {
      skipped.push({ date, reason: 'invalid_date' })
      continue
    }
    const payload = input.workbook.get(date) ?? []
    if (payload.length === 0) {
      skipped.push({ date, reason: 'no_metrics' })
      continue
    }

    const seen = new Set<string>()
    let duplicate = false
    for (const p of payload) {
      const key = identity(p.scope, p.basis, p.metric, date)
      if (seen.has(key)) {
        duplicate = true
        break
      }
      seen.add(key)
    }
    if (duplicate) {
      // The unique key would refuse this in the database. Naming the date here
      // is better than surfacing a constraint violation.
      skipped.push({ date, reason: 'duplicate_identity' })
      continue
    }

    for (const p of payload) {
      const key = identity(p.scope, p.basis, p.metric, date)
      const prior = persistedByIdentity.get(key)
      const next = { value: p.value, valueClass: p.value_class }

      let disposition: PerformanceHistoryDisposition
      if (prior !== undefined) {
        if (sameState({ value: prior.value, valueClass: prior.valueClass }, next)) {
          counts.unchanged += 1
          continue
        }
        disposition = 'changed'
        changedDates.add(date)
        corrections.push({
          scope: p.scope,
          basis: p.basis,
          metric: p.metric,
          observationDate: date,
          beforeValue: prior.value,
          beforeValueClass: prior.valueClass,
          afterValue: p.value,
          afterValueClass: p.value_class,
        })
      } else if (endpoint === null || date > endpoint) {
        disposition = 'new'
        insertedDates.add(date)
      } else {
        disposition = 'gap_fill'
        insertedDates.add(date)
      }

      counts[disposition] += 1
      rows.push({
        scope: p.scope,
        basis: p.basis,
        metric: p.metric,
        observation_date: date,
        // NULL stays NULL at every hop. A flow the source did not state is
        // `unavailable` with no number — never 0, which would assert that no
        // money moved that week and silently understate a period's flows.
        value: p.value,
        value_class: p.value_class,
        source_sheet: p.source_sheet,
        source_cell: p.source_cell,
        source_row: readSourceRow(p.metadata),
        parser_version: input.parserVersion,
        disposition,
        prior_value: disposition === 'changed' ? (prior?.value ?? null) : null,
        prior_value_class: disposition === 'changed' ? (prior?.valueClass ?? null) : null,
      })
    }
  }

  return {
    version: PERFORMANCE_HISTORY_VERSION,
    rows,
    counts,
    datesInserted: [...insertedDates].sort(),
    datesChanged: [...changedDates].sort(),
    corrections,
    endpoint,
    skipped,
  }
}

function readSourceRow(metadata: PerformanceRowPayload['metadata']): number | null {
  const v = (metadata as { sourceRow?: unknown } | null | undefined)?.sourceRow
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Does this plan overwrite settled history?
 *
 * The single question the confirm route asks before deciding whether an
 * administrator's authorization and written reason are required. Insertions
 * never require them, however many.
 */
export function performanceHistoryRequiresCorrection(plan: PerformanceHistoryPlan): boolean {
  return plan.counts.changed > 0
}
