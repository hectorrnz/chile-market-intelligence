// R13.8A — the versioned Family Portfolio workbook contract.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, so it
// runs under `node --test` directly and can be called from the upload route,
// the preview route or a CLI without dragging a server closure behind it.
//
// WHY THIS EXISTS
// ───────────────
// R13.2's `validateUploadCandidate` answers "is this a safe .xlsx?" — extension,
// MIME, macros, zip safety, entity expansion, size. R13.3's parsers answer "what
// are this week's numbers?". Nothing in between answers the question a RECURRING
// weekly upload actually turns on:
//
//     is this the SAME workbook we agreed to read, or a materially different one
//     that merely still parses?
//
// A parser that silently accepts a restructured workbook is the failure mode
// that matters here. The workbook is maintained by hand in Excel every week; a
// row inserted, a sociedad renamed, a section reordered or a sheet duplicated
// are all one keystroke away, and every one of them can leave a workbook that
// still opens, still carries 100+ date columns, and still produces a plausible
// parse — of the wrong thing.
//
// So the contract is deliberately NOT "did the parse succeed". It is a
// structural fingerprint taken BEFORE any value is read, and a verdict that
// separates "unchanged", "changed but still readable", and "changed enough that
// a human must look".
//
// WHAT IS AND IS NOT IN THE FINGERPRINT
// ─────────────────────────────────────
// IN  — the semantic skeleton: sheet names, the ordered role pattern of the
//       non-week columns, each scope's anchor label, and the ordered label list
//       inside each scope.
// OUT — every amount, every date, and the historical column COUNT.
//
// That split is the whole design. A normal week adds one frozen column and
// changes ~200 numbers; if any of that entered the hash the fingerprint would
// move every single week and mean nothing. Restructuring the sheet changes the
// skeleton and nothing else does, so a stable hash across weeks is real evidence
// and a changed hash is a real event.
//
// NO VALUE EVER LEAVES THIS MODULE. Findings carry codes, labels, counts and
// cell references — never an amount. Excel's own error literals are the single
// exception: a fixed, non-private vocabulary, and exactly what an operator needs
// in order to repair the cell.

import { createHash } from 'node:crypto'

import { readXlsx, textAt, type XlsxSheet, type XlsxWorkbook } from './xlsx/readXlsx.ts'
import {
  detectColumns,
  findHeaderRow,
  MAX_WEEK_GAP_DAYS,
  MIN_HEADER_DATES,
} from './resumen/dateDetection.ts'
import {
  detectScopes,
  normalizeLabel,
  technicalBlockStart,
  SCOPE_IDS,
  type ScopeId,
} from './resumen/hierarchy.ts'
import { findResumenSheet } from './resumen/parseResumen.ts'
import { findAlternativesSheet } from './alternatives/parseAlternatives.ts'

/**
 * The contract identifier. BUMP THIS, never edit it in place, when the workbook
 * shape this module accepts genuinely changes — a published week states which
 * contract read it, and two workbooks read under the same identifier must have
 * been read under the same rules.
 */
export const WORKBOOK_CONTRACT_VERSION = 'family_portfolio_workbook_v1'

export type WorkbookKind = 'portfolio' | 'alternatives'

/**
 * `supported`               — the skeleton matches; publish normally.
 * `supported_with_warnings` — readable, but something changed or is unusual; an
 *                             administrator should look before publishing.
 * `ambiguous`               — the workbook offers more than one reading of a
 *                             structure the contract requires to be singular.
 *                             NEVER resolved by picking one.
 * `unsupported_schema`      — a required structure is absent. A different
 *                             workbook, not a broken one.
 * `invalid`                 — not readable as an OOXML workbook at all.
 */
export type WorkbookVerdict =
  | 'supported'
  | 'supported_with_warnings'
  | 'ambiguous'
  | 'unsupported_schema'
  | 'invalid'

export type ContractSeverity = 'blocking' | 'warning' | 'info'

export interface ContractFinding {
  severity: ContractSeverity
  code: string
  /** Code-derived. Never an amount. */
  detail: string
  sourceCell?: string
}

/** The semantic skeleton. Every field is structure; none is a value. */
export interface WorkbookStructure {
  sheetNames: string[]
  headerRow: number | null
  historicalColumnCount: number
  firstWeek: string | null
  lastWeek: string | null
  liveColumnLetter: string | null
  /** The live column's CACHED `TODAY()` result — a proposal, never authority. */
  liveColumnDate: string | null
  differenceColumnLetter: string | null
  scopes: Array<{ scope: ScopeId; anchorLabel: string; labelCount: number }>
  /** Alternatives only: the ordered master-data header labels. */
  alternativesHeaders: string[]
}

export interface WorkbookContractReport {
  contractVersion: string
  uploadKind: WorkbookKind
  verdict: WorkbookVerdict
  /**
   * sha256 over the semantic skeleton — stable across a normal week, different
   * the moment the sheet is restructured. Null when no skeleton could be
   * derived: an `invalid` or `unsupported_schema` workbook has none.
   */
  structureHash: string | null
  structure: WorkbookStructure | null
  findings: ContractFinding[]
}

function f(
  severity: ContractSeverity,
  code: string,
  detail: string,
  sourceCell?: string,
): ContractFinding {
  return sourceCell ? { severity, code, detail, sourceCell } : { severity, code, detail }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

/**
 * The ordered, normalized labels in column B inside one scope's range.
 *
 * Normalized (accent- and case-folded) so a cosmetic capitalisation edit does
 * not read as a restructure, and ORDERED because order is the hierarchy: the
 * same labels in a different sequence is a different workbook.
 */
function scopeLabels(sheet: XlsxSheet, startRow: number, endRow: number): string[] {
  const out: string[] = []
  for (let row = startRow; row <= endRow; row++) {
    const t = textAt(sheet, row, 2)
    if (t && t.trim().length > 0) out.push(normalizeLabel(t))
  }
  return out
}

/**
 * Canonical skeleton string, hashed to produce `structureHash`.
 *
 * Built by hand rather than by `JSON.stringify(structure)` because the two must
 * be free to diverge: `structure` is a HUMAN-FACING report and will grow fields
 * (counts, dates) that must never enter the hash. Deriving the hash from the
 * report would silently make every future field part of the identity.
 */
function skeletonOf(
  sheetNames: readonly string[],
  columnRolePattern: readonly string[],
  scopes: ReadonlyArray<{ scope: ScopeId; anchorLabel: string; labels: string[] }>,
  alternativesHeaders: readonly string[],
): string {
  return [
    'v1',
    'sheets:' + [...sheetNames].map(normalizeLabel).sort().join(','),
    'cols:' + columnRolePattern.join(','),
    ...scopes.map((s) => `scope:${s.scope}:${normalizeLabel(s.anchorLabel)}:${s.labels.join('|')}`),
    'alt:' + alternativesHeaders.map(normalizeLabel).join('|'),
  ].join('\n')
}

function hashSkeleton(skeleton: string): string {
  return createHash('sha256').update(skeleton, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// RESUMEN (upload kind `portfolio`)
// ---------------------------------------------------------------------------

interface KindResult {
  structure: WorkbookStructure | null
  skeleton: string | null
  ambiguous: boolean
}

function classifyResumen(workbook: XlsxWorkbook, findings: ContractFinding[]): KindResult {
  const sheetNames = workbook.sheets.map((s) => s.name)
  const sheet = findResumenSheet(workbook.sheets)
  if (!sheet) {
    findings.push(f('blocking', 'resumen_sheet_missing', 'the workbook carries no RESUMEN sheet'))
    return { structure: null, skeleton: null, ambiguous: false }
  }

  const headerRow = findHeaderRow(sheet)
  if (headerRow === null) {
    findings.push(
      f(
        'blocking',
        'header_row_not_found',
        `no row carries at least ${MIN_HEADER_DATES} ascending weekly dates`,
      ),
    )
    return { structure: null, skeleton: null, ambiguous: false }
  }

  const detection = detectColumns(sheet, workbook.date1904)

  let ambiguous = false
  for (const b of detection.blocking) {
    // A duplicated week or a second live column is a genuine ambiguity about
    // WHICH column a week is — not a missing structure. It must never be
    // resolved by picking one, so it gets its own verdict.
    if (b.code === 'ambiguous_live_column' || b.code === 'duplicate_week_date') ambiguous = true
    findings.push(f('blocking', b.code, b.detail, b.sourceCell))
  }
  for (const w of detection.warnings) findings.push(f('warning', w.code, w.detail, w.sourceCell))

  if (detection.historical.length < MIN_HEADER_DATES) {
    findings.push(
      f(
        'blocking',
        'weekly_series_too_short',
        `the weekly series carries ${detection.historical.length} columns, below the ${MIN_HEADER_DATES} this contract requires`,
      ),
    )
  }

  // Exactly one live column. ZERO is as disqualifying as two: without it there
  // is no `TODAY()` column to propose a date from, and the sheet is not the
  // workbook this contract describes.
  if (!detection.live) {
    findings.push(
      f('blocking', 'live_column_missing', 'no "Precios en vivo" / formula-headed live column was found'),
    )
  }

  // Cadence. A gap beyond tolerance is REPORTED, never repaired: a skipped week
  // is a legitimate portfolio-history event and this contract must not invent
  // the missing column.
  for (let i = 1; i < detection.historical.length; i++) {
    const previous = detection.historical[i - 1].date
    const current = detection.historical[i].date
    if (previous === null || current === null) continue
    const gap = daysBetween(previous, current)
    if (gap > MAX_WEEK_GAP_DAYS) {
      findings.push(
        f(
          'warning',
          'week_gap_unusual',
          `a ${gap}-day gap separates two consecutive weekly columns`,
          `${detection.historical[i].letter}${headerRow}`,
        ),
      )
    }
  }

  const ranges = detectScopes(sheet)
  const technicalStart = technicalBlockStart(sheet, headerRow)
  const present = new Set(ranges.map((r) => r.scope))
  for (const scope of SCOPE_IDS) {
    if (!present.has(scope)) {
      findings.push(f('blocking', 'scope_anchor_missing', `the ${scope} section anchor was not found`))
    }
  }

  const scopes = ranges.map((r) => {
    const endRow = technicalStart !== null && r.endRow >= technicalStart ? technicalStart - 1 : r.endRow
    return { scope: r.scope, anchorLabel: r.anchorLabel, labels: scopeLabels(sheet, r.startRow, endRow) }
  })

  // The column ROLE pattern with the week columns COLLAPSED. `historical` is
  // written once however many weeks there are, which is precisely what keeps a
  // normal week from moving the fingerprint.
  const rolePattern: string[] = []
  for (const c of detection.columns) {
    if (c.role === 'historical' && rolePattern[rolePattern.length - 1] === 'historical') continue
    rolePattern.push(c.role)
  }

  const structure: WorkbookStructure = {
    sheetNames,
    headerRow,
    historicalColumnCount: detection.historical.length,
    firstWeek: detection.historical[0]?.date ?? null,
    lastWeek: detection.historical[detection.historical.length - 1]?.date ?? null,
    liveColumnLetter: detection.live?.letter ?? null,
    liveColumnDate: detection.live?.date ?? null,
    differenceColumnLetter: detection.difference?.letter ?? null,
    scopes: scopes.map((s) => ({
      scope: s.scope,
      anchorLabel: s.anchorLabel,
      labelCount: s.labels.length,
    })),
    alternativesHeaders: [],
  }

  return { structure, skeleton: skeletonOf(sheetNames, rolePattern, scopes, []), ambiguous }
}

// ---------------------------------------------------------------------------
// Alternatives (upload kind `alternatives`)
// ---------------------------------------------------------------------------

/** Doc 03 § 6.1 — the anchor that locates the master-data header row. */
const ALTERNATIVES_HEADER_B = /nombre de la inversi[oó]n/i

/** The master-data block the Alternatives economics are read from. */
const ALTERNATIVES_MIN_HEADERS = 8

function classifyAlternatives(workbook: XlsxWorkbook, findings: ContractFinding[]): KindResult {
  const sheetNames = workbook.sheets.map((s) => s.name)
  const sheet = findAlternativesSheet(workbook.sheets)
  if (!sheet) {
    findings.push(f('blocking', 'alternatives_sheet_missing', 'the workbook carries no Alternatives sheet'))
    return { structure: null, skeleton: null, ambiguous: false }
  }

  let headerRow: number | null = null
  for (let row = 1; row <= Math.min(30, sheet.maxRow); row++) {
    const b = textAt(sheet, row, 2)
    if (b && ALTERNATIVES_HEADER_B.test(b)) {
      headerRow = row
      break
    }
  }
  if (headerRow === null) {
    findings.push(
      f(
        'blocking',
        'alternatives_header_not_found',
        'no row carries the investment-name header in column B',
      ),
    )
    return { structure: null, skeleton: null, ambiguous: false }
  }

  const headers: string[] = []
  for (let col = 2; col <= 12; col++) {
    const t = textAt(sheet, headerRow, col)
    if (t && t.trim().length > 0) headers.push(t.trim())
  }
  if (headers.length < ALTERNATIVES_MIN_HEADERS) {
    findings.push(
      f(
        'blocking',
        'alternatives_headers_incomplete',
        `the master-data block states ${headers.length} column headers, fewer than the ${ALTERNATIVES_MIN_HEADERS} this contract requires`,
      ),
    )
  }

  const structure: WorkbookStructure = {
    sheetNames,
    headerRow,
    historicalColumnCount: 0,
    firstWeek: null,
    lastWeek: null,
    liveColumnLetter: null,
    liveColumnDate: null,
    differenceColumnLetter: null,
    scopes: [],
    alternativesHeaders: headers,
  }

  return { structure, skeleton: skeletonOf(sheetNames, [], [], headers), ambiguous: false }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Classify a workbook against `family_portfolio_workbook_v1`.
 *
 * Runs BEFORE any value is read, and reads none itself. A caller that gets
 * anything other than `supported` / `supported_with_warnings` must not go on to
 * parse the workbook for publication.
 */
export function classifyWorkbook(bytes: Buffer, uploadKind: WorkbookKind): WorkbookContractReport {
  const findings: ContractFinding[] = []

  const read = readXlsx(bytes)
  if (!read.ok) {
    findings.push(f('blocking', read.code, read.detail))
    return {
      contractVersion: WORKBOOK_CONTRACT_VERSION,
      uploadKind,
      verdict: 'invalid',
      structureHash: null,
      structure: null,
      findings,
    }
  }

  const result =
    uploadKind === 'portfolio'
      ? classifyResumen(read.workbook, findings)
      : classifyAlternatives(read.workbook, findings)

  const blocked = findings.some((x) => x.severity === 'blocking')
  const warned = findings.some((x) => x.severity === 'warning')

  // Ambiguity outranks a plain structural refusal: "this workbook offers two
  // readings" and "this workbook is missing a section" call for different
  // operator action, and collapsing them would hide which one happened.
  const verdict: WorkbookVerdict = result.ambiguous
    ? 'ambiguous'
    : blocked
      ? 'unsupported_schema'
      : warned
        ? 'supported_with_warnings'
        : 'supported'

  return {
    contractVersion: WORKBOOK_CONTRACT_VERSION,
    uploadKind,
    verdict,
    // A workbook that failed the contract has no fingerprint to record. Emitting
    // one anyway would let a rejected shape be compared against an accepted one
    // as though the two were commensurable.
    // `invalid` returned above, so only `unsupported_schema` needs suppressing here.
    structureHash:
      result.skeleton === null || verdict === 'unsupported_schema'
        ? null
        : hashSkeleton(result.skeleton),
    structure: result.structure,
    findings,
  }
}
