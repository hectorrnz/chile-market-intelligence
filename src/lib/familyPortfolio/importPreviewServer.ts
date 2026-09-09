// R13.8B — the server-side half of the import preview.
//
// SERVER-ONLY. Never import from a client component.
//
// `weeklyImportPreview.ts` is pure: it takes bytes and Production's state and
// returns a plan. This module is the thin part that READS Production's state, so
// the preview route and the confirm route can never disagree about what "current"
// means — they call the same function, one request apart.

import {
  buildWeeklyImportPreview,
  type WeeklyImportPreview,
} from './weeklyImportPreview.ts'
import type { WeeklyImportPlan } from './weeklyImportPlan.ts'
import type { EvolutionExtraction } from './resumen/evolutionHistory.ts'
import type { LoadedDraft } from './draftReview.ts'
import type {
  SnapshotRowPayload,
  PerformanceRowPayload,
  ImportHistoricalPublicationPayload,
} from '@/lib/db/repositories/portfolioPublicationRepository'
import {
  listPersistedEvolutionObservations,
  listPublications,
  getStandingPublicationPayload,
  listStandingPublicationPayloads,
  listPersistedRowHistory,
  listPersistedPerformanceHistory,
} from '@/lib/db/repositories/portfolioPublicationRepository'
import type { HistoricalPublicationRestatement } from './weeklyImportPlan.ts'
import { buildSnapshotRowPayload, buildPerformanceRowPayload } from './publicationPayload.ts'
import { comparePublicationPayload } from './publicationMaterialDiff.ts'
import { planRowHistory, type RowHistoryPlan } from './rowHistory.ts'
import {
  planPerformanceHistory,
  type PerformanceHistoryPlan,
} from './performanceHistory.ts'
import { RESUMEN_PARSER_VERSION } from './resumen/parseResumen.ts'

export type ImportPreviewFailure =
  | { ok: false; code: 'not_configured' }
  | { ok: false; code: 'evolution_read_failed' }
  | { ok: false; code: 'not_a_portfolio_draft' }
  | { ok: false; code: 'publication_read_failed' }
  /** R13.8D.1 — the already-published weeks could not be read and compared. */
  | { ok: false; code: 'historical_publication_read_failed' }
  /**
   * R13.8E — Production's existing row history could not be read.
   *
   * A FAILURE, never an assumed-empty book. Treating an unreadable table as
   * "holds nothing" would classify ~19,757 existing identities as insertions,
   * and the import would then be refused by the database's own uniqueness key
   * after an administrator had already authorized it.
   */
  | { ok: false; code: 'row_history_read_failed' }
  | { ok: false; code: 'performance_history_read_failed' }

export interface ImportPreviewSuccess {
  ok: true
  preview: WeeklyImportPreview
  plan: WeeklyImportPlan
  extraction: EvolutionExtraction
  /**
   * The exact publication payload the plan was compared against and that the
   * confirm route sends to the RPC. Returned rather than rebuilt so the diff and
   * the write can never describe different rows.
   */
  rows: SnapshotRowPayload[]
  performance: PerformanceRowPayload[]
  /**
   * R13.8D.1 — for every already-published week this workbook restates, the
   * payload that corrects it, in the same shape and from the same builders.
   * The confirm route ships these to the RPC alongside the current publication,
   * so the seven corrections and the five new weeks commit as one operation.
   */
  historicalPublications: ImportHistoricalPublicationPayload[]
  /**
   * R13.8E — the row-level history this import would write, already classified.
   * The confirm route stages exactly `rowHistory.rows` and passes the batch id
   * to the same RPC call, so the preview and the write can never describe
   * different rows.
   */
  rowHistory: RowHistoryPlan
  /**
   * FOLLOW-UP D — the performance-history plan, staged the same way. The confirm
   * route stages exactly `performanceHistory.rows` and passes that batch id.
   */
  performanceHistory: PerformanceHistoryPlan
}

/**
 * Reads Production's current history and plans the import for one loaded draft.
 *
 * `latestPublishedAsOf` is the newest CURRENT portfolio publication. It matters
 * because `is_current` is unique per `(upload_kind, as_of_date)` rather than
 * globally — each week stays current for itself — so the book's endpoint is the
 * maximum such date, not "the one current row". A week published without ever
 * yielding an evolution point still bounds the endpoint through it, which is
 * what keeps a hole below that week a GAP_FILL instead of a spurious NEW week.
 */
export async function planImportForDraft(
  loaded: LoadedDraft,
  options: { historicalCorrectionAuthorized?: boolean; correctionReason?: string | null } = {},
): Promise<ImportPreviewSuccess | ImportPreviewFailure> {
  if (!loaded.resumen || !loaded.frozen) return { ok: false, code: 'not_a_portfolio_draft' }

  const persisted = await listPersistedEvolutionObservations()
  if (!persisted.ok) {
    return persisted.code === 'not_configured'
      ? { ok: false, code: 'not_configured' }
      : { ok: false, code: 'evolution_read_failed' }
  }

  const publications = await listPublications()
  const latestPublishedAsOf =
    publications
      .filter((p) => p.uploadKind === 'portfolio' && p.isCurrent)
      .map((p) => p.asOfDate)
      .sort()
      .pop() ?? null

  // ── R13.8C.2 — THE PUBLICATION HALF OF THE NO-OP QUESTION.
  //
  // The history series is not a proxy for the standing snapshot. A workbook can
  // leave every evolution point identical and still restate a holding, a flow or
  // a performance figure inside the current publication; classifying that as
  // "nothing to append" refused a real correction and left the stale figure
  // published.
  //
  // The comparison runs against the payload this import WOULD ACTUALLY SEND —
  // `buildSnapshotRowPayload`/`buildPerformanceRowPayload` are the same functions
  // the confirm route uses to build the RPC arguments, so the diff can never be
  // computed against rows nobody publishes.
  //
  // The week compared is the one this import would publish: the newest valid
  // frozen date. When the workbook proposes a NEWER week than anything standing,
  // no publication exists at that date and the comparison is trivially
  // "changed" — which is correct, an append always publishes.
  //
  // A FAILED READ IS A FAILURE, never a silent `not_compared`: guessing would
  // either refuse a legitimate correction or offer an Apply the database will
  // refuse. The database repeats this comparison against its own rows under the
  // publication lock and remains the authority.
  const rows = buildSnapshotRowPayload(loaded.resumen)
  const performance = buildPerformanceRowPayload(loaded.resumen)

  const publicationDate = loaded.frozen.publicationDate
  let publicationDiff: NonNullable<Parameters<typeof buildWeeklyImportPreview>[0]['publicationDiff']>
  if (publicationDate === null) {
    // No publishable frozen column at all. There is no week to compare, and the
    // plan is blocked on other grounds long before a no-op verdict matters.
    publicationDiff = { comparison: 'not_compared', differences: [], differenceCount: 0 }
  } else {
    const standing = await getStandingPublicationPayload(publicationDate)
    if (!standing.ok) {
      return standing.code === 'not_configured'
        ? { ok: false, code: 'not_configured' }
        : { ok: false, code: 'publication_read_failed' }
    }
    const diff = comparePublicationPayload(standing.payload, { rows, performance })
    publicationDiff = {
      comparison: diff.comparison,
      differences: diff.differences,
      differenceCount: diff.differenceCount,
    }
  }

  // ── R13.8D.1 — HISTORICAL PUBLICATION RESTATEMENTS.
  //
  // The evolution series answers "did this week's LEVEL move?". It cannot answer
  // "did this week's published FIGURES move?" — a workbook can hold every level
  // identical and still restate weekly P&L, net flows and YTD by reattributing an
  // amount between them. R13.8C.2 closed that gap for the week being published;
  // this closes it for the weeks already settled below it.
  //
  // Every workbook date that already carries a CURRENT publication is compared,
  // through the SAME `comparePublicationPayload` used for the current week, so
  // there is exactly one definition of "materially different" in the codebase.
  // The workbook side comes from `loaded.historicalPayloads`, captured during the
  // column scan the preview already runs, so this costs Production reads but no
  // extra parse.
  //
  // The week being published is EXCLUDED: it is the current-publication axis
  // above, and counting it twice would demand historical-correction authorization
  // for an ordinary same-week republication that R13.5 has always allowed.
  //
  // A FAILED READ IS A FAILURE. Treating an unreadable book as "no restatements"
  // would let a correction-requiring import through the gate unauthorized.
  const candidateDates = [...loaded.historicalPayloads.keys()].filter((d) => d !== publicationDate)
  const historicalRestatements: HistoricalPublicationRestatement[] = []
  const historicalPublications: ImportHistoricalPublicationPayload[] = []
  if (candidateDates.length > 0) {
    const standingWeeks = await listStandingPublicationPayloads(candidateDates)
    if (!standingWeeks.ok) {
      return standingWeeks.code === 'not_configured'
        ? { ok: false, code: 'not_configured' }
        : { ok: false, code: 'historical_publication_read_failed' }
    }
    for (const week of standingWeeks.payloads) {
      const workbookPayload = loaded.historicalPayloads.get(week.asOfDate)
      if (!workbookPayload) continue
      const diff = comparePublicationPayload(
        { rows: week.rows, performance: week.performance },
        workbookPayload,
      )
      if (diff.comparison !== 'changed') continue
      historicalRestatements.push({
        asOfDate: week.asOfDate,
        publicationId: week.publicationId,
        revision: week.revision,
        differenceCount: diff.differenceCount,
        differences: diff.differences,
      })
      historicalPublications.push({
        as_of_date: week.asOfDate,
        prior_publication_id: week.publicationId,
        snapshot_rows: workbookPayload.rows,
        performance_rows: workbookPayload.performance,
        difference_count: diff.differenceCount,
        // R13.8E — each restated week's OWN anchors, off its own frozen column.
        // Passing the import's here is exactly the defect that left seven
        // published weeks claiming a previous week two months in their future.
        previous_week_date: workbookPayload.previousWeekDate,
        beginning_of_year_date: workbookPayload.beginningOfYearDate,
      })
    }
  }
  historicalRestatements.sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1))
  historicalPublications.sort((a, b) => (a.as_of_date < b.as_of_date ? -1 : 1))

  // ── R13.8E — ROW-LEVEL HISTORY.
  //
  // Every clean frozen column the workbook holds, including the one being
  // published, is offered at row grain. `loaded.historicalPayloads` is keyed by
  // reporting date and was captured during the column scan the preview already
  // ran, so this costs one Production read and no additional parse.
  //
  // A FAILED READ IS A FAILURE. An unreadable row-history table treated as
  // empty would classify every existing identity as an insertion, and the
  // database's own uniqueness key would then refuse an import an administrator
  // had already authorized.
  const persistedRows = await listPersistedRowHistory()
  if (!persistedRows.ok) {
    return persistedRows.code === 'not_configured'
      ? { ok: false, code: 'not_configured' }
      : { ok: false, code: 'row_history_read_failed' }
  }
  const rowHistory = planRowHistory({
    workbook: new Map([...loaded.historicalPayloads].map(([date, p]) => [date, p.rows])),
    persisted: persistedRows.rows,
    parserVersion: RESUMEN_PARSER_VERSION,
  })

  // ── FOLLOW-UP D — PERFORMANCE HISTORY.
  //
  // The same payloads, at metric grain: the source's own weekly flow, profit and
  // return for every clean frozen column. Read and planned beside row history so
  // one preview describes everything one import would write.
  //
  // A FAILED READ IS A FAILURE, for the identical reason: an unreadable table
  // treated as empty would classify every settled metric as an insertion.
  const persistedPerf = await listPersistedPerformanceHistory()
  if (!persistedPerf.ok) {
    return persistedPerf.code === 'not_configured'
      ? { ok: false, code: 'not_configured' }
      : { ok: false, code: 'performance_history_read_failed' }
  }
  const performanceHistory = planPerformanceHistory({
    workbook: new Map([...loaded.historicalPayloads].map(([date, p]) => [date, p.performance])),
    persisted: persistedPerf.rows,
    parserVersion: RESUMEN_PARSER_VERSION,
  })

  const built = buildWeeklyImportPreview({
    bytes: loaded.bytes,
    selection: loaded.frozen,
    draft: loaded.resumen,
    published: persisted.observations,
    latestPublishedAsOf,
    historicalCorrectionAuthorized: options.historicalCorrectionAuthorized,
    correctionReason: options.correctionReason,
    publicationDiff,
    historicalPublicationRestatements: historicalRestatements,
    rowHistory: {
      insertedCount: rowHistory.counts.new + rowHistory.counts.gap_fill,
      changedCount: rowHistory.counts.changed,
      datesInserted: rowHistory.datesInserted,
      datesChanged: rowHistory.datesChanged,
    },
    performanceHistory: {
      insertedCount: performanceHistory.counts.new + performanceHistory.counts.gap_fill,
      changedCount: performanceHistory.counts.changed,
      datesInserted: performanceHistory.datesInserted,
      datesChanged: performanceHistory.datesChanged,
    },
  })

  return {
    ok: true,
    preview: built.preview,
    plan: built.plan,
    extraction: built.extraction,
    rows,
    performance,
    historicalPublications,
    rowHistory,
    performanceHistory,
  }
}
