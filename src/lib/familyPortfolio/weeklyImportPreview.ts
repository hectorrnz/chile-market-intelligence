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
} from './weeklyImportPlan.ts'

/** Bumped whenever the preview's shape or selection rule changes. */
export const IMPORT_PREVIEW_VERSION = 'r13.8b.import_preview.1'

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
export function selectFrozenPublicationColumn(bytes: Buffer): FrozenColumnSelection {
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
  const publishable = findPublishableHistoricalColumns(bytes)
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
): { selection: FrozenColumnSelection; draft: ResumenDraft | null } {
  const selection = selectFrozenPublicationColumn(bytes)
  if (selection.publicationColumnLetter === null) return { selection, draft: null }
  return {
    selection,
    draft: parseResumen(bytes, { publicationColumnLetter: selection.publicationColumnLetter }),
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
  })

  const counted = countDispositions(plan.observationsToWrite)

  const preview: WeeklyImportPreview = {
    previewVersion: IMPORT_PREVIEW_VERSION,
    planVersion: plan.planVersion,
    contractVersion: contract.contractVersion,
    contractVerdict: contract.verdict,
    sheetNames: contract.structure?.sheetNames ?? [],
    frozen: input.selection,
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

  return { preview, plan, extraction }
}
