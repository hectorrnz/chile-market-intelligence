// R13.3 — RESUMEN date and column detection (doc 02 § 3).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// NEVER USE FIXED ROW OR COLUMN INDICES (doc 02 § 3.4). The sample's anchors
// (`BV`, `CZ`, `DB`, `DE`, row 5) are EVIDENCE, not a contract — the workbook's
// own weekly ritual inserts a column every week, so any positional assumption
// expires within days. Everything here resolves by structure and semantics.
//
// TWO TRAPS THIS MODULE EXISTS TO AVOID:
//
//   Row 1 vs row 5 (doc 02 § 3.3). The workbook carries two "identical" header
//   rows that already disagree: row 1 is MISSING the `2026-01-02` column —
//   exactly the Beginning-of-Year baseline. A parser keyed to row 1 silently
//   loses YTD for every row in the book. Row 5 is authoritative; if it cannot
//   be found we fail closed rather than falling back to row 1.
//
//   The `Diferencia` column (doc 02 § 4). It is the PREVIOUS week's difference
//   (`31-07 − 24-07`), not this week's. Importing it would misstate every delta
//   by one week, so it is classified explicitly and never treated as a value
//   column.

import { textAt, serialToIsoDate, type XlsxSheet, type XlsxCell } from '../xlsx/readXlsx.ts'
import { indexToColumn } from '../xlsx/cellRef.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnRole =
  | 'historical'
  | 'live'
  | 'difference'
  | 'marker'
  | 'allocation'
  | 'ignored'

export interface ClassifiedColumn {
  column: number
  letter: string
  role: ColumnRole
  /** ISO date for `historical` and `live` columns; null otherwise. */
  date: string | null
  /** True when the header cell carried a formula (the live-column signal). */
  hasFormula: boolean
}

export interface DateDetection {
  headerRow: number | null
  columns: ClassifiedColumn[]
  /** Historical columns in ascending date order. */
  historical: ClassifiedColumn[]
  live: ClassifiedColumn | null
  difference: ClassifiedColumn | null
  blocking: DetectionFinding[]
  warnings: DetectionFinding[]
}

export interface DetectionFinding {
  code: DetectionCode
  detail: string
  sourceCell?: string
}

export type DetectionCode =
  | 'header_row_not_found'
  | 'duplicate_week_date'
  | 'out_of_order_week_date'
  | 'ambiguous_live_column'
  | 'live_date_unavailable'
  | 'beginning_of_year_not_found'
  | 'previous_week_not_found'
  | 'date_not_advancing'
  | 'week_gap_unusual'
  | 'difference_column_inconsistent'

/** Doc 02 § 3.4 A: a real header row carries at least this many weekly dates. */
export const MIN_HEADER_DATES = 20

/** Doc 02 § 3.4 E: a gap beyond this many days between weeks is a warning. */
export const MAX_WEEK_GAP_DAYS = 10

const LIVE_LABEL = /precios\s+en\s+vivo/i
const DIFFERENCE_LABEL = /^diferencia$/i
const MARKER_LABEL = /insertar\s+columna|reemplazar/i
const ALLOCATION_LABEL = /allocation/i

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

// ---------------------------------------------------------------------------
// A. Locate the header row
// ---------------------------------------------------------------------------

interface HeaderCandidate {
  row: number
  dateCount: number
  hasLabelInB: boolean
}

/**
 * Doc 02 § 3.4 A — the header row is the one with the greatest count of
 * date-formatted numeric cells forming a strictly ascending weekly series.
 *
 * Ties resolve to the LOWEST-numbered row that also carries a label in column B
 * (row 5 carries `valores en dólares`). That tiebreak is what keeps row 1 from
 * winning: row 1 has no column-B label and one fewer date.
 */
export function findHeaderRow(sheet: XlsxSheet, scanRows = 20): number | null {
  const candidates: HeaderCandidate[] = []

  for (let row = 1; row <= Math.min(scanRows, sheet.maxRow); row++) {
    let dateCount = 0
    for (let col = 1; col <= sheet.maxColumn; col++) {
      const c = sheet.cells.get(`${row}:${col}`)
      if (!c || c.kind !== 'number' || !c.isDateFormatted) continue
      if (c.formula !== null) continue // a live/derived header is not part of the series
      dateCount++
    }
    if (dateCount >= MIN_HEADER_DATES) {
      candidates.push({ row, dateCount, hasLabelInB: textAt(sheet, row, 2) !== null })
    }
  }

  if (candidates.length === 0) return null

  const best = Math.max(...candidates.map((c) => c.dateCount))
  const top = candidates.filter((c) => c.dateCount === best)
  const labelled = top.filter((c) => c.hasLabelInB)
  const pool = labelled.length > 0 ? labelled : top
  return pool.reduce((a, b) => (b.row < a.row ? b : a)).row
}

// ---------------------------------------------------------------------------
// B/C. Classify columns and derive anchors
// ---------------------------------------------------------------------------

function labelAbove(sheet: XlsxSheet, headerRow: number, column: number, within = 2): string | null {
  for (let r = headerRow - 1; r >= Math.max(1, headerRow - within); r--) {
    const t = textAt(sheet, r, column)
    if (t) return t
  }
  return null
}

/**
 * Doc 02 § 3.4 B/C — classifies every column on the header row and derives the
 * anchors.
 *
 * The live column is identified by EITHER a formula on the header cell (the
 * sample's `=+DE$1` → `TODAY()`) OR a `precios en vivo` label within two rows
 * above. Both signals are present in the sample; the contract says either alone
 * suffices, and both must agree when both are present. More than one candidate
 * is ambiguous and blocks — guessing which is "the" live column would silently
 * publish the wrong week.
 */
export function detectColumns(sheet: XlsxSheet, date1904 = false): DateDetection {
  const blocking: DetectionFinding[] = []
  const warnings: DetectionFinding[] = []

  const headerRow = findHeaderRow(sheet)
  if (headerRow === null) {
    blocking.push({
      code: 'header_row_not_found',
      detail: `no row in the first 20 carries ${MIN_HEADER_DATES}+ date-formatted weekly columns`,
    })
    return { headerRow: null, columns: [], historical: [], live: null, difference: null, blocking, warnings }
  }

  const columns: ClassifiedColumn[] = []
  const liveCandidates: ClassifiedColumn[] = []
  let allocationFrom = Number.POSITIVE_INFINITY

  for (let col = 1; col <= sheet.maxColumn; col++) {
    const cell: XlsxCell | undefined = sheet.cells.get(`${headerRow}:${col}`)
    const letter = indexToColumn(col)
    const header = cell && cell.kind === 'text' ? (cell.text ?? '').trim() : ''
    const above = labelAbove(sheet, headerRow, col)

    // Doc 02 § 3.4 B: everything at or right of an `allocation` header is out
    // of scope for the value grid.
    if (ALLOCATION_LABEL.test(header) || (above !== null && ALLOCATION_LABEL.test(above))) {
      allocationFrom = Math.min(allocationFrom, col)
    }
    if (col >= allocationFrom) {
      columns.push({ column: col, letter, role: 'allocation', date: null, hasFormula: false })
      continue
    }

    if (DIFFERENCE_LABEL.test(header)) {
      columns.push({ column: col, letter, role: 'difference', date: null, hasFormula: false })
      continue
    }
    if (MARKER_LABEL.test(header) || (above !== null && MARKER_LABEL.test(above))) {
      columns.push({ column: col, letter, role: 'marker', date: null, hasFormula: false })
      continue
    }

    if (!cell) {
      columns.push({ column: col, letter, role: 'ignored', date: null, hasFormula: false })
      continue
    }

    const hasFormula = cell.formula !== null
    const liveByLabel = above !== null && LIVE_LABEL.test(above)

    if (cell.kind === 'number' && cell.isDateFormatted) {
      const iso = serialToIsoDate(cell.number ?? Number.NaN, date1904)
      if (hasFormula || liveByLabel) {
        const c: ClassifiedColumn = { column: col, letter, role: 'live', date: iso, hasFormula }
        columns.push(c)
        liveCandidates.push(c)
      } else {
        columns.push({ column: col, letter, role: 'historical', date: iso, hasFormula: false })
      }
      continue
    }

    // A live column whose cached date is missing still has to be RECOGNISED, so
    // that its absence blocks rather than being silently skipped (doc 02 § 3.2).
    if (hasFormula || liveByLabel) {
      const c: ClassifiedColumn = { column: col, letter, role: 'live', date: null, hasFormula }
      columns.push(c)
      liveCandidates.push(c)
      continue
    }

    columns.push({ column: col, letter, role: 'ignored', date: null, hasFormula: false })
  }

  const historical = columns
    .filter((c) => c.role === 'historical' && c.date !== null)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0))

  // Duplicate / ordering checks run over the series as READ, not as sorted, so
  // an out-of-order sheet is detected rather than quietly repaired.
  const asRead = columns.filter((c) => c.role === 'historical' && c.date !== null)
  const seen = new Map<string, string>()
  for (const c of asRead) {
    const prior = seen.get(c.date!)
    if (prior) {
      blocking.push({
        code: 'duplicate_week_date',
        detail: `${c.date} appears in both column ${prior} and column ${c.letter}`,
        sourceCell: `${c.letter}${headerRow}`,
      })
    } else {
      seen.set(c.date!, c.letter)
    }
  }
  for (let i = 1; i < asRead.length; i++) {
    if (!(asRead[i].date! > asRead[i - 1].date!)) {
      blocking.push({
        code: 'out_of_order_week_date',
        detail: `column ${asRead[i].letter} (${asRead[i].date}) does not advance on ${asRead[i - 1].letter} (${asRead[i - 1].date})`,
        sourceCell: `${asRead[i].letter}${headerRow}`,
      })
    }
  }

  for (let i = 1; i < historical.length; i++) {
    const gap = daysBetween(historical[i - 1].date!, historical[i].date!)
    if (gap > MAX_WEEK_GAP_DAYS) {
      warnings.push({
        code: 'week_gap_unusual',
        detail: `${gap} days between ${historical[i - 1].date} and ${historical[i].date}`,
      })
    }
  }

  let live: ClassifiedColumn | null = null
  if (liveCandidates.length > 1) {
    blocking.push({
      code: 'ambiguous_live_column',
      detail: `more than one live-column candidate: ${liveCandidates.map((c) => c.letter).join(', ')}`,
    })
  } else if (liveCandidates.length === 1) {
    live = liveCandidates[0]
    if (live.date === null) {
      // Doc 02 § 3.2 rule 3: NEVER substitute the server's date here.
      blocking.push({
        code: 'live_date_unavailable',
        detail: 'the live column has no cached date value; an explicit administrator date is required',
        sourceCell: `${live.letter}${headerRow}`,
      })
    }
  }

  const difference = columns.find((c) => c.role === 'difference') ?? null

  return { headerRow, columns, historical, live, difference, blocking, warnings }
}

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

export interface Anchors {
  thisWeek: ClassifiedColumn
  previousWeek: ClassifiedColumn
  beginningOfYear: ClassifiedColumn
}

export type AnchorResult =
  | { ok: true; anchors: Anchors; warnings: DetectionFinding[] }
  | { ok: false; blocking: DetectionFinding[] }

/**
 * Doc 02 § 3.4 C — resolves `thisWeek`, `previousWeek` and `beginningOfYear`.
 *
 * `beginningOfYear` is the EARLIEST historical column in `thisWeek`'s calendar
 * year — never a hardcoded "first week of January". In the sample that is
 * `2026-01-02`, but a workbook whose year starts on a different weekday must
 * still resolve correctly.
 *
 * `previousWeek` is the immediately preceding HISTORICAL column. When the
 * publication column is itself historical (a back-publication), the predecessor
 * is that column's own predecessor — never the live column.
 */
export function resolveAnchors(
  detection: DateDetection,
  publicationColumn: ClassifiedColumn,
): AnchorResult {
  const blocking: DetectionFinding[] = []
  const warnings: DetectionFinding[] = []

  const asOf = publicationColumn.date
  if (asOf === null) {
    return {
      ok: false,
      blocking: [{ code: 'live_date_unavailable', detail: 'the publication column has no resolved date' }],
    }
  }

  const priors = detection.historical.filter((c) => c.date !== null && c.date < asOf)
  const previousWeek = priors.length > 0 ? priors[priors.length - 1] : null
  if (!previousWeek || previousWeek.column === publicationColumn.column) {
    blocking.push({
      code: 'previous_week_not_found',
      detail: `no historical column precedes ${asOf}`,
    })
  }

  const year = asOf.slice(0, 4)
  const inYear = detection.historical.filter((c) => c.date !== null && c.date.slice(0, 4) === year)
  const beginningOfYear = inYear.length > 0 ? inYear[0] : null
  if (!beginningOfYear) {
    blocking.push({
      code: 'beginning_of_year_not_found',
      detail: `no historical column falls in ${year}`,
    })
  }

  if (blocking.length > 0) return { ok: false, blocking }

  return {
    ok: true,
    anchors: { thisWeek: publicationColumn, previousWeek: previousWeek!, beginningOfYear: beginningOfYear! },
    warnings,
  }
}

/**
 * Doc 02 § 3.4 D — a confirmed date must advance on what is already published.
 *
 * Not a hard refusal: doc 02 § 8 permits a same-date REVISION. The caller
 * decides; this reports the condition.
 */
export function checkDateAdvancing(
  confirmed: string,
  latestPublished: string | null,
): DetectionFinding | null {
  if (latestPublished === null) return null
  if (confirmed > latestPublished) return null
  return {
    code: 'date_not_advancing',
    detail: `${confirmed} does not advance on the latest published date ${latestPublished}; publishing requires an explicit revision`,
  }
}
