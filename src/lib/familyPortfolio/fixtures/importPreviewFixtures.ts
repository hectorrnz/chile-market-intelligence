// R13.8C § 12 — OWNER-REVIEW FIXTURES FOR THE WEEKLY IMPORT PREVIEW.
//
// WHY THIS EXISTS
// ───────────────
// The only real workbook is already fully reflected in Production, so every
// real upload previews as `nothing_to_append`. The owner therefore cannot see a
// one-week append, a three-week catch-up, a gap fill, a historical correction
// or a mixed plan on any real data — and creating such states in Production to
// look at them is expressly forbidden, and would be wrong regardless.
//
// This module is the alternative: eight deterministic synthetic states, each
// PLANNED BY THE REAL PLANNER (`planWeeklyImport`) and MAPPED BY THE REAL PREVIEW
// (`previewFromPlan`), served through the real admin routes and rendered by the
// real admin page. Nothing here is a mock-up of the UI and nothing here is a
// second financial planner: only the INPUT observations are supplied rather than
// extracted from a workbook, so what the owner approves is the shipped
// component showing the shipped classification.
//
// SAFETY PROPERTIES, each load-bearing
// ────────────────────────────────────
//   · NOT A PRODUCTION SURFACE. Every route that serves a fixture consults
//     `reviewFixturesEnabled()` first; on the production deployment these ids
//     are simply unknown uploads and 404.
//   · NO QUERY-CONTROLLED STATE. The only input is one of eight fixed ids. A
//     caller cannot ask for an arbitrary date, value or disposition.
//   · NO AUTHORIZATION BYPASS. A fixture is served AFTER the same session and
//     administrator guard as a real upload.
//   · READ-ONLY. The publish and rollback routes refuse a fixture id outright
//     (`read_only_fixture`); nothing here can reach a table.
//   · NO PRODUCTION READ OR WRITE. Pure: no database client, no fetch, no
//     environment, no clock — which is also what makes it deterministic.
//   · NO PRIVATE DATA. Every amount is a small synthetic integer; every filename
//     says FIXTURE; the scope keys are the parser's own identifiers, already
//     public in this repository. No real workbook value appears here.

import {
  planWeeklyImport,
  type SeriesObservation,
} from '../weeklyImportPlan.ts'
import {
  previewFromPlan,
  type FrozenColumnSelection,
  type WeeklyImportPreview,
} from '../weeklyImportPreview.ts'
import type { DraftReview, ReviewFinding } from '../draftReview.ts'
import type { PublicationDifference } from '../publicationMaterialDiff.ts'
import type { UploadKind } from '../publication.ts'

// ── Identities ───────────────────────────────────────────────────────────────

/** `…0f1c` reads "fixture"; the trailing pair names the state. */
const PREFIX = '00000000-0000-4000-8000-0000000f1c'

export const IMPORT_FIXTURE_IDS = {
  /** A — the workbook is already reflected: `nothing_to_append`. */
  noChanges: `${PREFIX}0a`,
  /** B — one NEW week above the endpoint. */
  oneNewWeek: `${PREFIX}0b`,
  /** C — a catch-up: three NEW weeks, the newest becomes current. */
  threeNewWeeks: `${PREFIX}0c`,
  /** D — one GAP_FILL below the endpoint plus one NEW week. */
  gapFillAndNew: `${PREFIX}0d`,
  /** E — two CHANGED identities, nothing added: a correction needs a reason. */
  changedRequiresReason: `${PREFIX}0e`,
  /** F — NEW + GAP_FILL + CHANGED together. */
  mixed: `${PREFIX}0f`,
  /** G — the workbook did not parse at any frozen week. */
  validationFailure: `${PREFIX}10`,
  /**
   * H (R13.8C.2) — history settled, STANDING SNAPSHOT RESTATED.
   *
   * The state R13.8C.1 got wrong and the one real data can least produce: every
   * evolution point matches Production, so the old console said "nothing to
   * apply" and disabled Apply, while the current week's published figures had
   * genuinely moved. The owner needs to SEE that this now reads as a proposed
   * publication change with an enabled Apply.
   */
  publicationCorrection: `${PREFIX}11`,
} as const

export type ImportFixtureKey = keyof typeof IMPORT_FIXTURE_IDS

export const IMPORT_FIXTURE_ID_LIST: readonly string[] = Object.values(IMPORT_FIXTURE_IDS)

export function isImportFixtureId(id: string): boolean {
  return IMPORT_FIXTURE_ID_LIST.includes(id)
}

/** Two synthetic import-ledger rows, so the rollback control can be reviewed. */
export const IMPORT_FIXTURE_OPERATION_IDS = {
  activeCatchUp: `${PREFIX}1a`,
  rolledBackCorrection: `${PREFIX}1b`,
} as const

export function isImportFixtureOperationId(id: string): boolean {
  return (Object.values(IMPORT_FIXTURE_OPERATION_IDS) as readonly string[]).includes(id)
}

// ── Synthetic series ─────────────────────────────────────────────────────────
//
// Five series, one per published scope/basis, over a run of Friday reporting
// dates. Values are small synthetic integers with a per-series slope so every
// point is distinct and no figure resembles a real portfolio amount.

const SERIES: readonly { scope: string; basis: string }[] = [
  { scope: 'main', basis: 'ex_chilean_equities' },
  { scope: 'main', basis: 'with_chilean_equities' },
  { scope: 'jaime', basis: 'total' },
  { scope: 'andres', basis: 'total' },
  { scope: 'pablo', basis: 'total' },
]

/** The first frozen Friday of the synthetic history. */
const FIRST_FRIDAY_UTC = Date.UTC(2026, 4, 1) // 2026-05-01
const MS_PER_WEEK = 7 * 86_400_000

/** Production's endpoint in every state: the fourteenth week, 2026-07-31. */
const PRODUCTION_WEEKS = 14

export function fixtureWeekIso(i: number): string {
  return new Date(FIRST_FRIDAY_UTC + i * MS_PER_WEEK).toISOString().slice(0, 10)
}

export function fixtureValue(seriesIndex: number, weekIndex: number): number {
  return 20_000 + seriesIndex * 3_000 + weekIndex * 175 + ((weekIndex * (seriesIndex + 1) + 3) % 4) * 40
}

function weekObservations(i: number, adjust: (seriesIndex: number, weekIndex: number, value: number) => number = (_s, _w, v) => v): SeriesObservation[] {
  return SERIES.map((s, si) => ({
    scope: s.scope,
    basis: s.basis,
    observationDate: fixtureWeekIso(i),
    value: adjust(si, i, fixtureValue(si, i)),
    status: 'stated' as const,
  }))
}

function observationsFor(weeks: number, opts: { skip?: number[]; adjust?: (si: number, wi: number, v: number) => number } = {}): SeriesObservation[] {
  const out: SeriesObservation[] = []
  for (let i = 0; i < weeks; i++) {
    if (opts.skip?.includes(i)) continue
    out.push(...weekObservations(i, opts.adjust))
  }
  return out
}

/** The week the two CHANGED states overwrite: 2026-07-17. */
const CORRECTED_WEEK = 11

/** Alters two identities at the corrected week — one up, one down. */
function correctedWorkbookValue(si: number, wi: number, v: number): number {
  if (wi !== CORRECTED_WEEK) return v
  if (si === 1) return v + 860 // main / with_chilean_equities
  if (si === 2) return v - 415 // jaime / total
  return v
}

// ── Workbook identity (presentation metadata, no financial meaning) ──────────

const CONTRACT_VERSION = 'family_portfolio_workbook_v1'
const SHEETS = ['RESUMEN', '1 Pager', 'Alternatives']

/** Zero-based column index → spreadsheet letters, for the frozen/live diagnostics. */
function columnLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** The frozen history starts at column C in the synthetic sheet. */
const FIRST_HISTORY_COLUMN = 2

function frozenSelection(weeks: number): FrozenColumnSelection {
  const frozenDates: string[] = []
  for (let i = 0; i < weeks; i++) frozenDates.push(fixtureWeekIso(i))
  return {
    publicationColumnLetter: columnLetter(FIRST_HISTORY_COLUMN + weeks - 1),
    publicationDate: frozenDates[weeks - 1],
    frozenDates,
    historicalColumnCount: weeks,
    liveColumnLetter: columnLetter(FIRST_HISTORY_COLUMN + weeks),
    // The live `=TODAY()` column carries a later date than any frozen week —
    // exactly the proposal the selector must refuse.
    liveColumnDate: fixtureWeekIso(weeks + 1),
    liveColumnPublishable: false,
    refusal: null,
  }
}

const UPLOADED_AT = '2026-09-08T12:00:00.000Z'
const KIND: UploadKind = 'portfolio'

export interface FixtureUploadRow {
  id: string
  uploadKind: UploadKind
  originalFilename: string
  fileSha256: string
  fileSizeBytes: number
  uploadedAt: string
  status: string
  detectedAsOfDate: string | null
  confirmedAsOfDate: string | null
}

export interface FixtureImportOperationRow {
  id: string
  uploadId: string
  asOfDate: string
  publicationId: string | null
  previousPublicationId: string | null
  planVersion: string
  counts: Record<string, unknown>
  correctionAuthorized: boolean
  correctionReason: string | null
  createdAt: string
  rolledBackAt: string | null
  rollbackNote: string | null
}

/** The status the console shows for a fixture row — never a real lifecycle state. */
export const FIXTURE_UPLOAD_STATUS = 'review_fixture'

function uploadRow(id: string, filename: string, detected: string | null): FixtureUploadRow {
  return {
    id,
    uploadKind: KIND,
    originalFilename: `FIXTURE-${filename}.xlsx`,
    // Openly synthetic: a digest of this shape can never match a stored object.
    fileSha256: `f1c${id.slice(-2)}`.padEnd(64, '0'),
    fileSizeBytes: 0,
    uploadedAt: UPLOADED_AT,
    status: FIXTURE_UPLOAD_STATUS,
    detectedAsOfDate: detected,
    confirmedAsOfDate: null,
  }
}

interface StateSpec {
  key: ImportFixtureKey
  filename: string
  /** Frozen weeks the synthetic workbook carries. */
  workbookWeeks: number
  /** Weeks Production is missing below its endpoint (gap fills). */
  productionSkips: number[]
  corrected: boolean
  /** A non-blocking finding so the warnings section can be reviewed. */
  warning: boolean
  /**
   * R13.8C.2 — how many rows of the CURRENT publication this workbook restates.
   *
   * Supplied rather than diffed because a fixture has no stored publication to
   * diff against. The verdict it produces still runs through the real planner
   * and the real preview mapper; only the observation is injected, exactly as
   * the workbook observations are.
   */
  publicationDifferences?: number
}

const STATES: readonly StateSpec[] = [
  { key: 'noChanges', filename: 'A-no-changes', workbookWeeks: PRODUCTION_WEEKS, productionSkips: [], corrected: false, warning: false },
  { key: 'oneNewWeek', filename: 'B-one-new-week', workbookWeeks: PRODUCTION_WEEKS + 1, productionSkips: [], corrected: false, warning: false },
  { key: 'threeNewWeeks', filename: 'C-three-new-weeks', workbookWeeks: PRODUCTION_WEEKS + 3, productionSkips: [], corrected: false, warning: false },
  { key: 'gapFillAndNew', filename: 'D-gap-fill-and-new', workbookWeeks: PRODUCTION_WEEKS + 1, productionSkips: [9], corrected: false, warning: false },
  { key: 'changedRequiresReason', filename: 'E-historical-change', workbookWeeks: PRODUCTION_WEEKS, productionSkips: [], corrected: true, warning: false },
  { key: 'mixed', filename: 'F-mixed-new-gap-fill-change', workbookWeeks: PRODUCTION_WEEKS + 2, productionSkips: [6], corrected: true, warning: true },
  { key: 'publicationCorrection', filename: 'H-publication-correction', workbookWeeks: PRODUCTION_WEEKS, productionSkips: [], corrected: false, warning: false, publicationDifferences: 3 },
]

const ROW_COUNTS: ReadonlyArray<{ scope: string; rowCount: number }> = [
  { scope: 'main', rowCount: 66 },
  { scope: 'jaime', rowCount: 43 },
  { scope: 'andres', rowCount: 43 },
  { scope: 'pablo', rowCount: 43 },
]

function reviewFor(upload: FixtureUploadRow, frozen: FrozenColumnSelection | null, findings: ReviewFinding[], mismatchScope: string | null): DraftReview {
  const parsed = frozen !== null && frozen.refusal === null
  const blocking = findings.some((f) => f.severity === 'blocking')
  const refusals: DraftReview['refusals'] = []
  if (!parsed) refusals.push('draft_not_parsed')
  if (blocking) refusals.push('blocking_findings')

  return {
    uploadId: upload.id,
    uploadKind: KIND,
    status: upload.status,
    originalFilename: upload.originalFilename,
    fileSha256: upload.fileSha256,
    uploadedAt: upload.uploadedAt,
    parserVersion: 'fixture',
    parsed,
    frozen,
    detectedAsOfDate: parsed ? frozen.publicationDate : null,
    previousWeekDate: parsed && frozen.frozenDates.length > 1 ? frozen.frozenDates[frozen.frozenDates.length - 2] : null,
    beginningOfYearDate: parsed ? '2025-12-31' : null,
    confirmedAsOfDate: null,
    scopes: parsed ? ROW_COUNTS.map((r) => ({ ...r, unavailableCount: 0, rowTypes: {} })) : [],
    performance: parsed
      ? SERIES.map((s) => ({
          scope: s.scope,
          basis: s.basis,
          metric: 'weekly_profit',
          agrees: s.scope !== mismatchScope,
          indeterminate: false,
        }))
      : [],
    groups: [],
    legend: [],
    unclassifiedEventCells: [],
    findings,
    storedFindings: [],
    recordCount: parsed ? ROW_COUNTS.reduce((n, r) => n + r.rowCount, 0) : 0,
    publishable: parsed && !blocking,
    refusals,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
  }
}

/**
 * Synthetic material differences for fixture H. Small round integers, chosen so
 * the before/after reads clearly and can never be mistaken for a real holding.
 */
function buildPublicationDifferences(n: number): PublicationDifference[] {
  const SPEC: ReadonlyArray<{ identity: string; label: string; before: number; after: number }> = [
    { identity: 'main|watermill-total', label: 'FIXTURE — TOTAL WATERMILL', before: 1_200_000, after: 1_235_000 },
    { identity: 'main|dubai-cash', label: 'FIXTURE — Dubai / Caja', before: 90_000, after: 55_000 },
    { identity: 'jaime|staten-total', label: 'FIXTURE — TOTAL STATEN', before: 410_000, after: 410_500 },
  ]
  return SPEC.slice(0, n).map((d) => ({
    area: 'snapshot' as const,
    identity: d.identity,
    kind: 'changed' as const,
    field: 'value',
    label: d.label,
    beforeValue: d.before,
    afterValue: d.after,
  }))
}

export interface ImportFixture {
  key: ImportFixtureKey
  upload: FixtureUploadRow
  review: DraftReview
  importPlan: WeeklyImportPreview | null
}

function buildState(spec: StateSpec): ImportFixture {
  const id = IMPORT_FIXTURE_IDS[spec.key]
  const frozen = frozenSelection(spec.workbookWeeks)
  const upload = uploadRow(id, spec.filename, frozen.publicationDate)

  const workbook = observationsFor(spec.workbookWeeks, {
    adjust: spec.corrected ? correctedWorkbookValue : undefined,
  })
  const published = observationsFor(PRODUCTION_WEEKS, { skip: spec.productionSkips })

  // THE REAL PLANNER, with no authorization — the "what would happen" view the
  // draft route computes, so a corrected state comes back blocked exactly as a
  // real one would.
  // R13.8C.2 — the publication half. `not_compared` for every state that does
  // not exercise it, which is what every pre-R13.8C.2 fixture asserted anyway.
  const publicationDiffs = buildPublicationDifferences(spec.publicationDifferences ?? 0)

  const plan = planWeeklyImport({
    workbookObservations: workbook,
    publishedObservations: published,
    latestPublishedAsOf: fixtureWeekIso(PRODUCTION_WEEKS - 1),
    publicationComparison: publicationDiffs.length > 0 ? 'changed' : 'not_compared',
  })

  const findings: ReviewFinding[] = spec.warning
    ? [{
        severity: 'warning',
        code: 'performance_definition_mismatch',
        detail: 'FIXTURE — the source-stated weekly profit differs from the recomputation for one scope.',
        scope: 'pablo',
        sourceSheet: 'RESUMEN',
        sourceCell: `${frozen.publicationColumnLetter}94`,
      }]
    : []

  return {
    key: spec.key,
    upload,
    review: reviewFor(upload, frozen, findings, spec.warning ? 'pablo' : null),
    importPlan: previewFromPlan(plan, {
      contractVersion: CONTRACT_VERSION,
      contractVerdict: 'supported',
      sheetNames: SHEETS,
      frozen,
      publicationDifferences: publicationDiffs,
      publicationDifferenceCount: publicationDiffs.length,
    }),
  }
}

/** G — no frozen week parsed cleanly, so there is no draft and no plan. */
function buildValidationFailure(): ImportFixture {
  const id = IMPORT_FIXTURE_IDS.validationFailure
  const upload = uploadRow(id, 'G-validation-failure', null)
  const frozen: FrozenColumnSelection = {
    publicationColumnLetter: null,
    publicationDate: null,
    frozenDates: [],
    historicalColumnCount: 0,
    liveColumnLetter: 'DE',
    liveColumnDate: fixtureWeekIso(PRODUCTION_WEEKS + 1),
    liveColumnPublishable: false,
    refusal: 'no_publishable_frozen_column',
  }
  const findings: ReviewFinding[] = [
    {
      severity: 'blocking',
      code: 'no_publishable_frozen_column',
      detail: 'FIXTURE — no frozen historical week parsed cleanly; the live column is never publishable.',
      sourceSheet: 'RESUMEN',
    },
    {
      severity: 'warning',
      code: 'live_column_formula_errors',
      detail: 'FIXTURE — the live =TODAY() column reads #NAME? without the Bloomberg add-in.',
      sourceSheet: 'RESUMEN',
      sourceCell: 'DE22',
    },
  ]
  return {
    key: 'validationFailure',
    upload,
    review: reviewFor(upload, frozen, findings, null),
    importPlan: null,
  }
}

/**
 * Resolves one fixed id to its fixture, or null for anything else. There is no
 * other way in: no parameter shapes a fixture.
 */
export function buildImportFixture(id: string): ImportFixture | null {
  if (!isImportFixtureId(id)) return null
  if (id === IMPORT_FIXTURE_IDS.validationFailure) return buildValidationFailure()
  const spec = STATES.find((s) => IMPORT_FIXTURE_IDS[s.key] === id)
  return spec ? buildState(spec) : null
}

/** Every fixture's upload row, for the console index. */
export function listImportFixtureUploads(): FixtureUploadRow[] {
  return IMPORT_FIXTURE_ID_LIST.map((id) => buildImportFixture(id)!.upload)
}

/**
 * Two synthetic ledger rows: an active catch-up (rollback offered) and an
 * already-reversed correction (no control, reason shown). Their counts are
 * copied from the plans the fixtures above actually produce, so the ledger and
 * the preview describe the same states.
 */
export function listImportFixtureOperations(): FixtureImportOperationRow[] {
  const catchUp = buildImportFixture(IMPORT_FIXTURE_IDS.threeNewWeeks)!
  const corrected = buildImportFixture(IMPORT_FIXTURE_IDS.changedRequiresReason)!
  return [
    {
      id: IMPORT_FIXTURE_OPERATION_IDS.activeCatchUp,
      uploadId: catchUp.upload.id,
      asOfDate: catchUp.importPlan!.publicationDate!,
      publicationId: null,
      previousPublicationId: null,
      planVersion: catchUp.importPlan!.planVersion,
      counts: catchUp.importPlan!.counts,
      correctionAuthorized: false,
      correctionReason: null,
      createdAt: UPLOADED_AT,
      rolledBackAt: null,
      rollbackNote: null,
    },
    {
      id: IMPORT_FIXTURE_OPERATION_IDS.rolledBackCorrection,
      uploadId: corrected.upload.id,
      asOfDate: corrected.importPlan!.publicationDate!,
      publicationId: null,
      previousPublicationId: null,
      planVersion: corrected.importPlan!.planVersion,
      // What the ledger would record had the correction been authorized.
      counts: { ...corrected.importPlan!.counts, changed: corrected.importPlan!.corrections.length },
      correctionAuthorized: true,
      correctionReason: 'FIXTURE — synthetic correction reason, for presentation only.',
      createdAt: '2026-09-07T12:00:00.000Z',
      rolledBackAt: '2026-09-07T15:30:00.000Z',
      rollbackNote: null,
    },
  ]
}
