// R13.8E — ROW-LEVEL HISTORY PLANNING.
//
// PURE. Nothing here reads the database or the network. It takes the workbook's
// per-date row payloads and what Production already holds, and returns the rows
// one import should stage.
//
// WHY THIS EXISTS. `portfolio_snapshot_rows` is keyed by `publication_id`, so a
// row-level value exists only for a week the book PUBLISHED. After a catch-up
// import the book holds 2026-08-07 as a portfolio LEVEL and knows nothing about
// which holding stood at what value on that date. A rolling four-interval
// Contributors/Detractors chart needs exactly that, and the parser already
// computes it for every clean frozen column before discarding all but one.
//
// THE CLASSIFICATION MIRRORS THE EVOLUTION PLANNER EXACTLY, one grain down:
//
//   absent, above the endpoint   -> `new`       (an insertion, no authorization)
//   absent, at or below it       -> `gap_fill`  (an insertion, no authorization)
//   present and identical        -> written nowhere at all
//   present and materially moved -> `changed`   (an OVERWRITE — authorization
//                                                and a written reason)
//
// "Materially" is `value` and `value_class` together, and nothing else. A row
// whose number and status are unchanged is not restated because a display order
// shifted underneath it; and a row whose SOURCE became unreadable moves to
// `unavailable` with a NULL value, which is a real change and never a zero.

import type { RowHistoryStagedRow } from '@/lib/db/repositories/portfolioPublicationRepository'
import type { SnapshotRowPayload } from '@/lib/db/repositories/portfolioPublicationRepository'

/** Bumped whenever the staged row shape or the classification rule changes. */
export const ROW_HISTORY_VERSION = 'r13.8e.row_history.1'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type RowHistoryDisposition = 'new' | 'gap_fill' | 'changed'

/** One row-history identity as Production currently holds it. */
export interface PersistedRowHistoryEntry {
  scope: string
  observationDate: string
  rowKey: string
  value: number | null
  valueClass: string
}

export interface RowHistoryPlanInput {
  /** The workbook's clean frozen columns: reporting date -> its snapshot rows. */
  workbook: ReadonlyMap<string, readonly SnapshotRowPayload[]>
  /** Every identity Production already holds. */
  persisted: readonly PersistedRowHistoryEntry[]
  /** Stamped on every staged row so a value can be traced to the parser that read it. */
  parserVersion: string
}

export interface RowHistoryPlanCounts {
  new: number
  gap_fill: number
  changed: number
  unchanged: number
}

/** One overwritten identity, with the amounts an authorization decision needs. */
export interface RowHistoryCorrection {
  scope: string
  observationDate: string
  rowKey: string
  label: string
  beforeValue: number | null
  beforeValueClass: string
  afterValue: number | null
  afterValueClass: string
}

export interface RowHistoryPlan {
  version: string
  /** Exactly the rows to stage. An `unchanged` identity appears nowhere. */
  rows: RowHistoryStagedRow[]
  counts: RowHistoryPlanCounts
  /** Reporting dates gaining row-level history for the first time, ascending. */
  datesInserted: string[]
  /** Reporting dates with at least one overwritten identity, ascending. */
  datesChanged: string[]
  /** Every overwrite, capped for presentation by the caller. */
  corrections: RowHistoryCorrection[]
  /** The newest date Production held BEFORE this import. Null when empty. */
  endpoint: string | null
  /** Dates the workbook offered that could not be planned, with the reason. */
  skipped: Array<{ date: string; reason: 'invalid_date' | 'no_rows' | 'duplicate_identity' }>
}

function identity(scope: string, date: string, rowKey: string): string {
  return `${scope}|${date}|${rowKey}`
}

/**
 * Two row states are the same when the NUMBER and the STATUS are both the same.
 *
 * `null === null` is sameness, not absence: a row that was unreadable last week
 * and is unreadable this week has not changed. Distinguishing them would demand
 * an authorized correction every single week for every unavailable row.
 */
function sameState(
  a: { value: number | null; valueClass: string },
  b: { value: number | null; valueClass: string },
): boolean {
  return a.value === b.value && a.valueClass === b.valueClass
}

/**
 * Plans one import's row history.
 *
 * The workbook LEADS: every clean frozen column it carries is offered, and a
 * date absent from it is never invented. But overwriting settled history stays
 * explicit — a `changed` count above zero is what makes the console demand
 * authorization and a written reason, exactly as an evolution overwrite does.
 */
export function planRowHistory(input: RowHistoryPlanInput): RowHistoryPlan {
  const persistedByIdentity = new Map<string, PersistedRowHistoryEntry>()
  let endpoint: string | null = null
  for (const p of input.persisted) {
    persistedByIdentity.set(identity(p.scope, p.observationDate, p.rowKey), p)
    if (endpoint === null || p.observationDate > endpoint) endpoint = p.observationDate
  }

  const rows: RowHistoryStagedRow[] = []
  const counts: RowHistoryPlanCounts = { new: 0, gap_fill: 0, changed: 0, unchanged: 0 }
  const corrections: RowHistoryCorrection[] = []
  const insertedDates = new Set<string>()
  const changedDates = new Set<string>()
  const skipped: RowHistoryPlan['skipped'] = []

  for (const date of [...input.workbook.keys()].sort()) {
    if (!ISO_DATE.test(date)) {
      skipped.push({ date, reason: 'invalid_date' })
      continue
    }
    const payload = input.workbook.get(date) ?? []
    if (payload.length === 0) {
      // A frozen column that produced no rows is reported, never inferred from
      // a neighbour. Nothing is fabricated to fill it.
      skipped.push({ date, reason: 'no_rows' })
      continue
    }

    const seen = new Set<string>()
    let duplicate = false
    for (const r of payload) {
      const key = identity(r.scope, date, r.row_key)
      if (seen.has(key)) {
        duplicate = true
        break
      }
      seen.add(key)
    }
    if (duplicate) {
      // The unique key would refuse this in the database. Refusing the whole
      // date here names it instead of surfacing a constraint violation.
      skipped.push({ date, reason: 'duplicate_identity' })
      continue
    }

    for (const r of payload) {
      const key = identity(r.scope, date, r.row_key)
      const prior = persistedByIdentity.get(key)
      const next = { value: r.value, valueClass: r.value_class }

      let disposition: RowHistoryDisposition
      if (prior !== undefined) {
        if (sameState({ value: prior.value, valueClass: prior.valueClass }, next)) {
          counts.unchanged += 1
          continue
        }
        disposition = 'changed'
        changedDates.add(date)
        corrections.push({
          scope: r.scope,
          observationDate: date,
          rowKey: r.row_key,
          label: r.label_es,
          beforeValue: prior.value,
          beforeValueClass: prior.valueClass,
          afterValue: r.value,
          afterValueClass: r.value_class,
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
        scope: r.scope,
        observation_date: date,
        row_key: r.row_key,
        parent_row_key: r.parent_row_key,
        depth: r.depth,
        display_order: r.display_order,
        row_type: r.row_type,
        label_es: r.label_es,
        label_en: r.label_en,
        currency: r.currency,
        // NULL stays NULL at every hop. An unreadable cell is `unavailable`
        // with no number — never 0, which reads as a position that vanished.
        value: r.value,
        value_class: r.value_class,
        source_sheet: r.source_sheet,
        source_cell: r.source_cell,
        source_row: readSourceRow(r.metadata),
        parser_version: input.parserVersion,
        disposition,
        prior_value: disposition === 'changed' ? (prior?.value ?? null) : null,
        prior_value_class: disposition === 'changed' ? (prior?.valueClass ?? null) : null,
      })
    }
  }

  return {
    version: ROW_HISTORY_VERSION,
    rows,
    counts,
    datesInserted: [...insertedDates].sort(),
    datesChanged: [...changedDates].sort(),
    corrections,
    endpoint,
    skipped,
  }
}

function readSourceRow(metadata: SnapshotRowPayload['metadata']): number | null {
  const v = (metadata as { sourceRow?: unknown } | null | undefined)?.sourceRow
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Does this plan overwrite settled history?
 *
 * The single question the confirm route asks before deciding whether an
 * administrator's authorization and written reason are required. Insertions
 * never require them, however many there are.
 */
export function rowHistoryRequiresCorrection(plan: RowHistoryPlan): boolean {
  return plan.counts.changed > 0
}
