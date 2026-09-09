// R13.8B § 5/§ 6 — turning a stored workbook into an IMPORT PLAN PREVIEW.
//
// PURE. It takes bytes and Production's current state and returns a plan. It
// opens no connection and reads no environment, so every case below is unit
// testable without a database.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS MODULE EXISTS AT ALL
//
// `parseResumen(bytes)` with no options selects `detection.live` — the
// `=TODAY()` column whose cells are Bloomberg formulas and read `#NAME?`
// without the add-in. That default is right for a bare parse and WRONG for the
// publication path, which had been reaching it through `loadDraft`. The locked
// rule is that the workbook's FROZEN history leads and the live column is never
// publishable, so the application path must choose its column deliberately.
//
// `selectFrozenPublicationColumn` is that choice, and it is made ONCE, here.
// No caller hard-codes a column letter.
//
// ─────────────────────────────────────────────────────────────────────────────
// AMOUNTS. The draft review carries no figures, deliberately — publishing is a
// validity decision, not a reading of the portfolio. This preview keeps that
// rule with ONE narrow, deliberate exception: the before/after of an identity
// being OVERWRITTEN. An administrator cannot honestly authorize a correction
// without seeing what is being replaced, and only an overwrite has a "before".
// NEW and GAP_FILL dates are reported as dates and counts, never as values.

import { createHash } from 'node:crypto'

import { classifyWorkbook, type WorkbookContractReport } from './workbookContract.ts'
import { parseResumen, type ResumenDraft } from './resumen/parseResumen.ts'
import {
  extractEvolutionHistory,
  findPublishableHistoricalColumns,
  type EvolutionExtraction,
} from './resumen/evolutionHistory.ts'
import {
  planWeeklyImport,
  type SeriesObservation,
  type WeeklyImportPlan,
  type PlannedObservation,
  type HistoricalPublicationRestatement,
  type RowHistorySummary,
  type PerformanceHistorySummary,
} from './weeklyImportPlan.ts'
import type {
  PublicationComparison,
  PublicationDifference,
} from './publicationMaterialDiff.ts'
import { buildSnapshotRowPayload, buildPerformanceRowPayload } from './publicationPayload.ts'

/**
 * R13.8D.1 — one frozen column's publication payload, in the EXACT shape the
 * publication RPC receives.
 *
 * Typed off the builders rather than off the looser comparison interface, so a
 * payload captured here can be shipped to the RPC without a cast — the rows the
 * restatement was measured on are literally the rows that get written.
 */
export interface HistoricalColumnPayload {
  rows: ReturnType<typeof buildSnapshotRowPayload>
  performance: ReturnType<typeof buildPerformanceRowPayload>
  /**
   * R13.8E — THE COLUMN'S OWN ANCHOR DATES.
   *
   * Captured here because they are the only place they can be captured: the
   * parse that produced these rows is the only one that ever sees this column's
   * previous-week and beginning-of-year headers. Before this, a restatement
   * inherited the IMPORT's anchors and 2026-06-19 ended up recording
   * `previousWeekDate = 2026-08-28`.
   *
   * Null stays null — a column whose anchor the parser could not resolve
   * records none rather than a neighbour's.
   */
  previousWeekDate: string | null
  beginningOfYearDate: string | null
}

/**
 * Bumped whenever the preview's shape or selection rule changes.
 *
 * R13.8D.1 is a SEMANTICS change, not a refactor: the preview now reports a
 * fifth category — historical publication restatements — and the stale-plan
 * fingerprint covers it.
 */
export const IMPORT_PREVIEW_VERSION = 'r13.8d1.import_preview.1'

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Frozen column selection
// ─────────────────────────────────────────────────────────────────────────────

export interface FrozenColumnSelection {
  /** The newest frozen historical column whose FULL parse is clean. */
  publicationColumnLetter: string | null
  publicationDate: string | null
  /** Every frozen historical date the workbook carries, ascending. */
  frozenDates: string[]
  historicalColumnCount: number
  /**
   * The live `=TODAY()` column, reported for DIAGNOSTICS ONLY.
   *
   * It is never the publication column. Its cached date is a proposal the
   * workbook makes about itself; its cells are Bloomberg-dependent and routinely
   * `#NAME?` on a machine without the add-in. A failure there says nothing about
   * whether the frozen history is publishable, so it never blocks.
   */
  liveColumnLetter: string | null
  liveColumnDate: string | null
  /** Structural, not a computed verdict: the live column is never publishable. */
  readonly liveColumnPublishable: false
  /** Set when no frozen column parsed cleanly — the one blocking outcome here. */
  refusal: 'no_publishable_frozen_column' | 'not_a_portfolio_workbook' | null
}

/**
 * Chooses the column a publication will carry: the NEWEST VALID FROZEN one.
 *
 * "Valid" means the real parser accepts a full parse of that column, not merely
 * that a header date was detected — a week that cannot produce a publication
 * must not become one. The scan is newest-first and stops at the first clean
 * column, so the ordinary case costs one extra parse.
 */
export function selectFrozenPublicationColumn(
  bytes: Buffer,
  /**
   * R13.8D.1 — see `findPublishableHistoricalColumns`. Forwarded so the caller
   * can capture every clean column's draft from the ONE scan that already runs
   * here, instead of paying for a second full pass over the workbook.
   */
  visit?: (column: { date: string; letter: string }, draft: ResumenDraft) => void,
): FrozenColumnSelection {
  const contract = classifyWorkbook(bytes, 'portfolio')
  const structure = contract.structure

  const base = {
    frozenDates: [] as string[],
    historicalColumnCount: structure?.historicalColumnCount ?? 0,
    liveColumnLetter: structure?.liveColumnLetter ?? null,
    liveColumnDate: structure?.liveColumnDate ?? null,
    liveColumnPublishable: false as const,
  }

  if (!structure) {
    return { ...base, publicationColumnLetter: null, publicationDate: null, refusal: 'not_a_portfolio_workbook' }
  }

  // Unbounded: the frozen inventory is part of the preview, and the evolution
  // extractor walks every column anyway.
  const publishable = findPublishableHistoricalColumns(bytes, Number.POSITIVE_INFINITY, visit)
  const frozenDates = publishable.map((c) => c.date)

  if (publishable.length === 0) {
    return {
      ...base,
      frozenDates,
      publicationColumnLetter: null,
      publicationDate: null,
      refusal: 'no_publishable_frozen_column',
    }
  }

  // `findPublishableHistoricalColumns` returns ascending, so the newest is last.
  const newest = publishable[publishable.length - 1]
  return {
    ...base,
    frozenDates,
    publicationColumnLetter: newest.letter,
    publicationDate: newest.date,
    refusal: null,
  }
}

/**
 * Parses the workbook at its newest valid frozen column.
 *
 * This is the ONLY parse the application publication path should perform for a
 * portfolio workbook. It never falls back to the live column: a workbook with no
 * clean frozen week is refused, not published off `=TODAY()`.
 */
export function parseAtFrozenPublicationColumn(
  bytes: Buffer,
  options: {
    /**
     * R13.8D.1 — also return the comparable publication payload of EVERY clean
     * frozen column, keyed by reporting date.
     *
     * That is what historical-publication-restatement detection compares against
     * Production, and — since R13.8E — it is also the SOURCE OF ROW HISTORY:
     * every one of these payloads is persisted at its own reporting date, not
     * only the handful that turn out to restate a publication. It is captured
     * from the scan `selectFrozenPublicationColumn` already performs, so
     * switching it on costs no additional parse. Off by default: the
     * alternatives path and every pure test that only wants the publication
     * column should not carry ~100 payloads it will never read.
     */
    captureHistoricalPayloads?: boolean
  } = {},
): {
  selection: FrozenColumnSelection
  draft: ResumenDraft | null
  historicalPayloads: Map<string, HistoricalColumnPayload>
} {
  const historicalPayloads = new Map<string, HistoricalColumnPayload>()
  const visit = options.captureHistoricalPayloads
    ? (column: { date: string; letter: string }, draft: ResumenDraft) => {
        historicalPayloads.set(column.date, {
          rows: buildSnapshotRowPayload(draft),
          performance: buildPerformanceRowPayload(draft),
          previousWeekDate: draft.previousWeekDate,
          beginningOfYearDate: draft.beginningOfYearDate,
        })
      }
    : undefined

  const selection = selectFrozenPublicationColumn(bytes, visit)
  if (selection.publicationColumnLetter === null) {
    return { selection, draft: null, historicalPayloads }
  }
  return {
    selection,
    draft: parseResumen(bytes, { publicationColumnLetter: selection.publicationColumnLetter }),
    historicalPayloads,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The preview
// ─────────────────────────────────────────────────────────────────────────────

/** One overwritten identity, with the amounts an authorization decision needs. */
export interface PreviewCorrection {
  scope: string
  basis: string
  seriesIdentity: string
  observationDate: string
  beforeValue: number | null
  afterValue: number | null
}

/**
 * R13.8D.1 — one restated field of one already-published week, flattened for
 * display: what Production holds, what the workbook says, and the difference.
 *
 * `delta` is computed here, once, rather than in the component: a number the
 * screen shows must come from the same place the authorization decision was made
 * on, and two subtractions are two chances to disagree.
 */
export interface PreviewRestatedField {
  area: 'snapshot' | 'performance'
  identity: string
  kind: 'added' | 'removed' | 'changed'
  scope: string
  basis: string | null
  metric: string | null
  rowKey: string | null
  label: string | null
  field: string | null
  productionValue: number | null
  workbookValue: number | null
  /** Null unless BOTH sides are numbers — a delta against absence is not zero. */
  delta: number | null
}

/** One already-published week the workbook now states differently. */
export interface PreviewHistoricalRestatement {
  asOfDate: string
  publicationId: string
  revision: number
  /** True total, even when `fields` was capped. */
  differenceCount: number
  /** BOUNDED. A week has ~220 rows; the unchanged ones are never listed. */
  fields: PreviewRestatedField[]
}

export interface WeeklyImportPreview {
  previewVersion: string
  planVersion: string

  /** Contract identity — the workbook's schema, not its contents. */
  contractVersion: string
  contractVerdict: WorkbookContractReport['verdict']
  sheetNames: string[]

  frozen: FrozenColumnSelection

  /** Newest reporting date Production holds today. */
  productionEndpoint: string | null
  /** Newest frozen date the workbook carries. */
  workbookLatest: string | null
  /** The date the current publication will carry: newest VALID frozen date. */
  publicationDate: string | null

  newDates: string[]
  gapFillDates: string[]
  corrections: PreviewCorrection[]
  /** A count, never a dump: ~500 identical identities restate on every upload. */
  unchangedCount: number
  invalidDates: string[]

  /** Informational. A week the workbook never froze is never invented. */
  cadenceGaps: Array<{ from: string; to: string; days: number }>

  action: WeeklyImportPlan['action']
  requiresHistoricalCorrection: boolean
  /** Which cause armed the gate (R13.8D.1, R13.8E). Any, all, or none. */
  requiresEvolutionCorrection: boolean
  requiresPublicationRestatementCorrection: boolean
  /** R13.8E — a row-level identity at a frozen date whose value the workbook moves. */
  requiresRowHistoryCorrection: boolean
  /** FOLLOW-UP D — a performance metric at a frozen date whose value the workbook moves. */
  requiresPerformanceHistoryCorrection: boolean
  /** R13.8E — what this import would do to row-level history. */
  rowHistory: RowHistorySummary
  /** FOLLOW-UP D — what this import would do to performance history. */
  performanceHistory: PerformanceHistorySummary

  /**
   * R13.8D.1 — ALREADY-PUBLISHED WEEKS THE WORKBOOK NOW STATES DIFFERENTLY.
   *
   * A fifth category, reported separately from `newDates`, `gapFillDates`,
   * `corrections` (evolution overwrites) and the current-publication change.
   * These weeks' portfolio LEVELS may be untouched while their published
   * attribution — net flows against weekly profit, YTD — has moved.
   */
  historicalRestatements: PreviewHistoricalRestatement[]
  historicalRestatementDates: string[]
  historicalRestatementCount: number

  /**
   * R13.8C.2 — the publication half of the plan.
   *
   * `publicationComparison` says whether this week's STANDING snapshot would be
   * materially restated. `publicationDifferences` is a BOUNDED sample, never a
   * dump: a portfolio publication carries ~500 rows and listing the unchanged
   * ones would bury the handful that moved. `publicationDifferenceCount` is the
   * true total even when the sample was capped.
   */
  publicationComparison: PublicationComparison
  publicationChanged: boolean
  publicationDifferences: PublicationDifference[]
  publicationDifferenceCount: number

  blocked: boolean
  blockCodes: WeeklyImportPlan['blockCodes']

  /** Counts recorded on the import operation row. */
  counts: { new: number; gapFill: number; changed: number; unchanged: number; invalid: number }

  /**
   * A stable digest of everything this plan asserts about Production's current
   * state. Confirm sends it back; the server recomputes the plan and refuses if
   * the digest moved. See `planFingerprint`.
   */
  planFingerprint: string
}

/**
 * A digest over the plan's ASSERTIONS ABOUT PRODUCTION, not over its output.
 *
 * It covers each written identity's disposition and its asserted before-image,
 * plus the publication date. That is exactly the set of facts a confirmation is
 * agreeing to — so if any of them moved between preview and confirm, the digest
 * changes and the confirmation is refused rather than silently applied to a
 * different book.
 *
 * It deliberately does NOT cover the workbook bytes: those are re-hashed against
 * the upload record by `loadDraft` on every parse, which is a stronger check.
 */
export function planFingerprint(plan: WeeklyImportPlan): string {
  const canonical = plan.observationsToWrite
    .map((o) =>
      [
        o.scope,
        o.basis,
        o.seriesIdentity,
        o.observationDate,
        o.disposition,
        o.priorStatus ?? 'absent',
        o.priorValue === null ? 'null' : String(o.priorValue),
        o.status,
        o.value === null ? 'null' : String(o.value),
      ].join('|'),
    )
    .sort()
  canonical.push(`endpoint|${plan.productionEndpoint ?? 'none'}`)
  canonical.push(`publication|${plan.publicationDate ?? 'none'}`)
  // R13.8C.2 — the standing snapshot is an assertion about Production too. If
  // another publication landed between preview and confirm, an administrator who
  // approved a PUBLICATION CORRECTION may now be confirming a no-op, or the
  // reverse. Covering the verdict makes that a refusal rather than a surprise.
  canonical.push(`snapshot|${plan.publicationComparison}`)
  // R13.8D.1 — every already-published week this import would re-publish is an
  // assertion about Production as well, and the sharpest one available: the
  // PUBLICATION ID it was compared against. If any of those weeks gains a new
  // revision between preview and confirm — another import, a rollback, a manual
  // republication — the id moves, the digest moves, and the confirmation is
  // refused with zero writes instead of superseding a revision nobody reviewed.
  // The difference count rides along so a same-revision content change (which
  // cannot happen today, and must not pass silently if it ever can) also moves it.
  for (const r of plan.historicalPublicationRestatements) {
    canonical.push(`restatement|${r.asOfDate}|${r.publicationId}|${r.revision}|${r.differenceCount}`)
  }
  // R13.8E — the row-level history this import would write is an assertion about
  // Production too, and the one an administrator authorizing an OVERWRITE is
  // agreeing to most directly. Covering the counts and the dates means a row
  // history that moved between preview and confirm — another import landed, a
  // rollback ran — refuses the confirmation instead of applying an authorization
  // that was given for a different set of rows.
  canonical.push(
    `rowHistory|${plan.rowHistory.insertedCount}|${plan.rowHistory.changedCount}|` +
      `${plan.rowHistory.datesInserted.join(',')}|${plan.rowHistory.datesChanged.join(',')}`,
    // FOLLOW-UP D — performance history joins the digest for the same reason row
    // history did: an approval given when nothing would be written to it must
    // not silently authorize 2,260 metrics staged a minute later.
    `performanceHistory|${plan.performanceHistory.insertedCount}|` +
      `${plan.performanceHistory.changedCount}|` +
      `${plan.performanceHistory.datesInserted.join(',')}|` +
      `${plan.performanceHistory.datesChanged.join(',')}`,
  )
  canonical.push(`plan|${plan.planVersion}`)
  return createHash('sha256').update(canonical.join('\n')).digest('hex')
}

function countDispositions(written: readonly PlannedObservation[]) {
  let created = 0
  let gapFill = 0
  let changed = 0
  for (const o of written) {
    if (o.disposition === 'new') created += 1
    else if (o.disposition === 'gap_fill') gapFill += 1
    else if (o.disposition === 'changed') changed += 1
  }
  return { created, gapFill, changed }
}

export interface PreviewInput {
  bytes: Buffer
  /** The draft already parsed at the frozen publication column. */
  selection: FrozenColumnSelection
  draft: ResumenDraft
  /** Production's persisted evolution observations, every scope. */
  published: readonly SeriesObservation[]
  /** Newest current publication date, so a week with no evolution point counts. */
  latestPublishedAsOf: string | null
  historicalCorrectionAuthorized?: boolean
  correctionReason?: string | null
  /**
   * R13.8C.2 — the standing publication for this week, already compared against
   * the payload this import would send. Omitted by a caller that cannot read it,
   * which is `not_compared` and reproduces the pre-R13.8C.2 behaviour exactly.
   */
  publicationDiff?: {
    comparison: PublicationComparison
    differences: readonly PublicationDifference[]
    differenceCount: number
  }
  /**
   * R13.8D.1 — already-published weeks this workbook materially restates, as
   * computed by the caller against Production's own publications. Omitted by a
   * caller that cannot read them, which is "none observed" — never "none exist".
   */
  historicalPublicationRestatements?: readonly HistoricalPublicationRestatement[]
  /**
   * R13.8E — what this import would do to row-level history, as classified by
   * the caller against Production's own rows. Omitted by a caller that cannot
   * read them, which is "none observed" — never "none exist".
   */
  rowHistory?: RowHistorySummary
  /** FOLLOW-UP D — passed straight through to `planImportForDraft`. */
  performanceHistory?: PerformanceHistorySummary
}

/** The workbook's schema identity — everything in a preview that is not the plan. */
export interface PreviewIdentity {
  /**
   * The bounded sample of material publication differences, when the caller read
   * the standing publication. Absent for a pure planner call or a review fixture,
   * which is `not_compared` and shows no publication block at all.
   */
  publicationDifferences?: readonly PublicationDifference[]
  publicationDifferenceCount?: number
  contractVersion: string
  contractVerdict: WorkbookContractReport['verdict']
  sheetNames: string[]
  frozen: FrozenColumnSelection
}

/**
 * The ONE mapping from a plan to what an administrator sees.
 *
 * R13.8C — split out of `buildWeeklyImportPreview` so the owner-review fixtures
 * can present a plan produced by the real planner through this same mapping.
 * There is no second presentation model: a synthetic state and a real upload
 * reach the screen through exactly this function.
 */
/** Flattens one canonical difference into the row the preview shows. */
function restatedField(d: PublicationDifference): PreviewRestatedField {
  const before = d.beforeValue ?? null
  const after = d.afterValue ?? null
  return {
    area: d.area,
    identity: d.identity,
    kind: d.kind,
    scope: d.scope,
    basis: d.basis ?? null,
    metric: d.metric ?? null,
    rowKey: d.rowKey ?? null,
    label: d.label ?? null,
    field: d.field ?? null,
    productionValue: before,
    workbookValue: after,
    // A delta needs two numbers. Against an added or removed row there is no
    // subtraction to make, and reporting the present side as the difference
    // would overstate a movement that is really an appearance.
    delta:
      typeof before === 'number' && typeof after === 'number' && d.kind === 'changed'
        ? after - before
        : null,
  }
}

export function previewFromPlan(plan: WeeklyImportPlan, identity: PreviewIdentity): WeeklyImportPreview {
  const counted = countDispositions(plan.observationsToWrite)

  const historicalRestatements: PreviewHistoricalRestatement[] =
    plan.historicalPublicationRestatements.map((r) => ({
      asOfDate: r.asOfDate,
      publicationId: r.publicationId,
      revision: r.revision,
      differenceCount: r.differenceCount,
      fields: r.differences.map(restatedField),
    }))

  return {
    previewVersion: IMPORT_PREVIEW_VERSION,
    planVersion: plan.planVersion,
    contractVersion: identity.contractVersion,
    contractVerdict: identity.contractVerdict,
    sheetNames: identity.sheetNames,
    frozen: identity.frozen,
    productionEndpoint: plan.productionEndpoint,
    workbookLatest: plan.workbookLatest,
    publicationDate: plan.publicationDate,
    newDates: plan.newDates,
    gapFillDates: plan.gapFillDates,
    corrections: plan.corrections.map((c) => ({
      scope: c.scope,
      basis: c.basis,
      seriesIdentity: c.seriesIdentity,
      observationDate: c.observationDate,
      beforeValue: c.beforeValue,
      afterValue: c.afterValue,
    })),
    unchangedCount: plan.unchangedDates.length,
    invalidDates: plan.invalidDates,
    cadenceGaps: plan.cadenceGaps.map((g) => ({ from: g.from, to: g.to, days: g.days })),
    action: plan.action,
    requiresHistoricalCorrection: plan.requiresHistoricalCorrection,
    requiresEvolutionCorrection: plan.requiresEvolutionCorrection,
    requiresPublicationRestatementCorrection: plan.requiresPublicationRestatementCorrection,
    requiresRowHistoryCorrection: plan.requiresRowHistoryCorrection,
    requiresPerformanceHistoryCorrection: plan.requiresPerformanceHistoryCorrection,
    rowHistory: plan.rowHistory,
    performanceHistory: plan.performanceHistory,
    historicalRestatements,
    historicalRestatementDates: plan.historicalRestatementDates,
    historicalRestatementCount: plan.historicalPublicationRestatements.length,
    publicationComparison: plan.publicationComparison,
    publicationChanged: plan.publicationChanged,
    publicationDifferences: [...(identity.publicationDifferences ?? [])],
    publicationDifferenceCount:
      identity.publicationDifferenceCount ?? (identity.publicationDifferences ?? []).length,
    blocked: plan.blocked,
    blockCodes: plan.blockCodes,
    counts: {
      new: counted.created,
      gapFill: counted.gapFill,
      changed: counted.changed,
      unchanged: plan.unchangedDates.length,
      invalid: plan.invalidDates.length,
    },
    planFingerprint: planFingerprint(plan),
  }
}

/**
 * Builds the administrator-facing import plan.
 *
 * The bindings come from the draft that was parsed at the frozen publication
 * column, so the series can never measure different rows than the publication
 * does. The VALUES come from the historical column grid — every frozen week,
 * including weeks that could never produce a full publication of their own.
 */
export function buildWeeklyImportPreview(
  input: PreviewInput,
): { preview: WeeklyImportPreview; plan: WeeklyImportPlan; extraction: EvolutionExtraction } {
  const contract = classifyWorkbook(input.bytes, 'portfolio')

  const extraction = extractEvolutionHistory(input.bytes, { bindingDraft: input.draft })

  const workbookObservations: SeriesObservation[] = extraction.observations.map((o) => ({
    scope: o.scope,
    basis: o.basis,
    observationDate: o.observationDate,
    value: o.value,
    status: 'stated',
  }))

  const plan = planWeeklyImport({
    workbookObservations,
    publishedObservations: input.published,
    latestPublishedAsOf: input.latestPublishedAsOf,
    historicalCorrectionAuthorized: input.historicalCorrectionAuthorized,
    correctionReason: input.correctionReason,
    publicationComparison: input.publicationDiff?.comparison,
    historicalPublicationRestatements: input.historicalPublicationRestatements,
    rowHistory: input.rowHistory,
    performanceHistory: input.performanceHistory,
  })

  const preview = previewFromPlan(plan, {
    contractVersion: contract.contractVersion,
    contractVerdict: contract.verdict,
    sheetNames: contract.structure?.sheetNames ?? [],
    frozen: input.selection,
    publicationDifferences: input.publicationDiff?.differences,
    publicationDifferenceCount: input.publicationDiff?.differenceCount,
  })

  return { preview, plan, extraction }
}
