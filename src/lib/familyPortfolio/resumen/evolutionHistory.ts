// R13.R1 § 9 — the owner-confirmed weekly Portfolio Evolution history.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// `parseResumen` reads ONE publication column and produces one week's complete
// row-level snapshot. That is the right shape for a publication and the wrong
// shape for a two-year evolution line: publishing 102 weeks would require 102
// clean full parses, and R13.R1's inventory established that only the six most
// recent weeks produce one (see `docs/portfolio-r13/10-r1-historical-grain.md`).
//
// The EVOLUTION series needs far less: the value of two specific rows, read
// across every historical column. Those two rows carry a number in all 102
// columns with no errors and no blanks, so the series is complete and entirely
// source-backed even where a full snapshot is not.
//
// THE TWO ROWS ARE IDENTIFIED STRUCTURALLY, NEVER BY LABEL GUESSING. They are
// the rows `parseResumen` NUMERICALLY BOUND to Main's two performance blocks
// when the newest clean column was parsed — `ex_chilean_equities` → SUBTOTAL,
// `with_chilean_equities` → TOTAL (doc 02 § 2.1, doc 04 § 4). The binding was
// proven against the source's own arithmetic; matching `^TOTAL$` against a
// column of Spanish labels would not be. If a basis has no binding, that basis
// yields NO series — never a fallback row that merely looks right.
//
// HONESTY RULES ENFORCED HERE
//   * NO INTERPOLATION, NO CARRY-FORWARD. A column where the bound row is
//     blank or in error contributes no point. Gaps stay gaps.
//   * NO FABRICATED DATES. Every observation date is a historical column's own
//     header date; the live column is excluded entirely (its cached date is the
//     workbook's last recalculation, not a closed week).
//   * NO VIEWER-CURRENT-DATE DEPENDENCE. Nothing here reads a clock.
//   * PROVENANCE PER POINT. Every observation carries the sheet, the cell it
//     was read from, and the source row label.

import { readXlsx, cellAt, type XlsxSheet } from '../xlsx/readXlsx.ts'
import { sourceCell } from '../xlsx/cellRef.ts'
import { detectColumns } from './dateDetection.ts'
import {
  findResumenSheet,
  parseResumen,
  RESUMEN_PARSER_VERSION,
  type PerformanceBasis,
  type ResumenDraft,
} from './parseResumen.ts'

/** Bumped when the extraction semantics change, independently of the row parser. */
export const EVOLUTION_EXTRACTOR_VERSION = 'r13.r1.evolution.1'

/** The bases this extractor publishes a Main series for (doc 02 § 2.1). */
export const MAIN_EVOLUTION_BASES: readonly PerformanceBasis[] = [
  'ex_chilean_equities',
  'with_chilean_equities',
] as const

export interface EvolutionObservation {
  scope: 'main'
  basis: PerformanceBasis
  /** ISO date of the historical week column this value was read from. */
  observationDate: string
  value: number
  sourceSheet: string
  sourceCell: string
  /** The source's own label for the row, for audit. */
  sourceRowLabel: string
}

export interface EvolutionSeriesReport {
  basis: PerformanceBasis
  /** The row the basis was numerically bound to, or null when unbound. */
  boundRowKey: string | null
  boundRowLabel: string | null
  sourceRow: number | null
  observationCount: number
  earliestDate: string | null
  latestDate: string | null
  /** Historical columns that carried no usable number for this row. */
  gapDates: string[]
}

export interface EvolutionExtraction {
  ok: boolean
  extractorVersion: string
  parserVersion: string
  /** Every historical column date, ascending — the inventory doc 08 § 7 asks for. */
  historicalDates: string[]
  /** Distinct day-gaps observed between consecutive weeks, ascending. */
  cadenceGapDays: number[]
  duplicateDates: string[]
  observations: EvolutionObservation[]
  series: EvolutionSeriesReport[]
  findings: Array<{ severity: 'blocking' | 'warning'; code: string; detail: string }>
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/**
 * Extracts Main's two weekly evolution series from a RESUMEN workbook.
 *
 * `bindingDraft` supplies the BINDINGS ONLY — which row each basis measures.
 * The caller passes the draft it has already parsed and validated (the publish
 * path passes the very draft it is publishing), so the series can never be
 * bound to a different reading of the workbook than the publication itself. It
 * is not a source of values: every value below is read from the historical
 * column grid, including the many columns that could never produce a full
 * publication.
 *
 * When no draft is supplied, the newest historical column is parsed to obtain
 * the bindings — convenient for a standalone ingest, and refused outright if
 * that column does not parse cleanly.
 */
export function extractEvolutionHistory(
  bytes: Buffer,
  options: { bindingDraft?: ResumenDraft; bindingColumnLetter?: string } = {},
): EvolutionExtraction {
  const findings: EvolutionExtraction['findings'] = []
  const empty = (): EvolutionExtraction => ({
    ok: false,
    extractorVersion: EVOLUTION_EXTRACTOR_VERSION,
    parserVersion: RESUMEN_PARSER_VERSION,
    historicalDates: [],
    cadenceGapDays: [],
    duplicateDates: [],
    observations: [],
    series: [],
    findings,
  })

  const read = readXlsx(bytes)
  if (!read.ok) {
    findings.push({ severity: 'blocking', code: read.code, detail: read.detail })
    return empty()
  }
  const sheet: XlsxSheet | null = findResumenSheet(read.workbook.sheets)
  if (!sheet) {
    findings.push({
      severity: 'blocking',
      code: 'resumen_sheet_not_found',
      detail: 'the workbook contains no RESUMEN sheet',
    })
    return empty()
  }

  const detection = detectColumns(sheet, read.workbook.date1904)
  if (detection.headerRow === null || detection.historical.length === 0) {
    findings.push({
      severity: 'blocking',
      code: 'no_historical_columns',
      detail: 'no historical weekly columns could be identified',
    })
    return empty()
  }

  const historicalDates = detection.historical.map((c) => c.date as string)
  const duplicateDates = historicalDates.filter((d, i) => historicalDates.indexOf(d) !== i)
  const gaps = new Set<number>()
  for (let i = 1; i < historicalDates.length; i++) {
    gaps.add(daysBetween(historicalDates[i - 1], historicalDates[i]))
  }
  const cadenceGapDays = [...gaps].sort((a, b) => a - b)

  // --- Establish the bindings. They come from a draft the caller has already
  // validated, or from one clean column parsed here. Either way the binding is
  // the parser's own numeric reconciliation, never a label match.
  const bindingLetter =
    options.bindingColumnLetter ?? detection.historical[detection.historical.length - 1].letter
  const bound =
    options.bindingDraft ?? parseResumen(bytes, { publicationColumnLetter: bindingLetter })
  if (!bound.ok) {
    findings.push({
      severity: 'blocking',
      code: 'binding_column_not_parsable',
      detail: options.bindingDraft
        ? 'the supplied draft did not parse cleanly, so the performance bases cannot be bound'
        : `column ${bindingLetter} does not parse cleanly, so the performance bases cannot be bound`,
    })
    return empty()
  }

  const observations: EvolutionObservation[] = []
  const series: EvolutionSeriesReport[] = []

  for (const basis of MAIN_EVOLUTION_BASES) {
    const binding = bound.performance.find(
      (p) => p.scope === 'main' && p.basis === basis && p.boundRowKey !== null,
    )
    const row = binding
      ? (bound.rows.find((r) => r.scope === 'main' && r.rowKey === binding.boundRowKey) ?? null)
      : null

    if (!binding || !row) {
      // A basis with no proven binding produces NO series. Falling back to a
      // label match would be exactly the guess this module exists to avoid.
      findings.push({
        severity: 'warning',
        code: 'evolution_basis_unbound',
        detail: `no performance binding resolves the ${basis} row, so that series is unavailable`,
      })
      series.push({
        basis,
        boundRowKey: binding?.boundRowKey ?? null,
        boundRowLabel: null,
        sourceRow: null,
        observationCount: 0,
        earliestDate: null,
        latestDate: null,
        gapDates: [],
      })
      continue
    }

    const gapDates: string[] = []
    let first: string | null = null
    let last: string | null = null

    for (const column of detection.historical) {
      const date = column.date as string
      const cell = cellAt(sheet, row.sourceRow, column.column)
      if (!cell || cell.kind !== 'number' || !Number.isFinite(cell.number)) {
        // Blank OR an Excel error literal — either way there is no observation.
        gapDates.push(date)
        continue
      }
      observations.push({
        scope: 'main',
        basis,
        observationDate: date,
        value: cell.number as number,
        sourceSheet: sheet.name,
        sourceCell: sourceCell(sheet.name, column.column, row.sourceRow),
        sourceRowLabel: row.labelEs,
      })
      if (first === null) first = date
      last = date
    }

    series.push({
      basis,
      boundRowKey: binding.boundRowKey,
      boundRowLabel: row.labelEs,
      sourceRow: row.sourceRow,
      observationCount: observations.filter((o) => o.basis === basis).length,
      earliestDate: first,
      latestDate: last,
      gapDates,
    })
  }

  if (duplicateDates.length > 0) {
    findings.push({
      severity: 'blocking',
      code: 'duplicate_week_date',
      detail: `historical columns repeat ${duplicateDates.join(', ')}`,
    })
  }

  const blocking = findings.filter((f) => f.severity === 'blocking')
  return {
    ok: blocking.length === 0 && observations.length > 0,
    extractorVersion: EVOLUTION_EXTRACTOR_VERSION,
    parserVersion: RESUMEN_PARSER_VERSION,
    historicalDates,
    cadenceGapDays,
    duplicateDates,
    observations,
    series,
    findings,
  }
}

/**
 * The newest historical column whose FULL parse is clean, or null.
 *
 * Used for two things, both of which need a genuinely publishable week: binding
 * the evolution bases above, and choosing the weeks a historical backfill may
 * publish (R13.R1 § 10). Scans newest-first and stops at the first clean column
 * when `limit` is 1.
 */
export function findPublishableHistoricalColumns(
  bytes: Buffer,
  limit = Number.POSITIVE_INFINITY,
): Array<{ date: string; letter: string; rowCount: number; performanceCount: number }> {
  const read = readXlsx(bytes)
  if (!read.ok) return []
  const sheet = findResumenSheet(read.workbook.sheets)
  if (!sheet) return []
  const detection = detectColumns(sheet, read.workbook.date1904)

  const out: Array<{ date: string; letter: string; rowCount: number; performanceCount: number }> = []
  // Newest-first: the recent weeks are the ones the source maintains completely,
  // so a bounded scan finds them immediately instead of parsing two years of
  // columns that will be refused anyway.
  for (let i = detection.historical.length - 1; i >= 0 && out.length < limit; i--) {
    const column = detection.historical[i]
    const draft = parseResumen(bytes, { publicationColumnLetter: column.letter })
    if (!draft.ok) continue
    out.push({
      date: column.date as string,
      letter: column.letter,
      rowCount: draft.rows.length,
      performanceCount: draft.performance.length,
    })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}
