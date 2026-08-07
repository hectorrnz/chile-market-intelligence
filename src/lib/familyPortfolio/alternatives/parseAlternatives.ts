// R13.4 — Alternatives parser: Upload B → validated draft (doc 08 Stage 4).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// PARSES ONLY. Publication is Stage 5.
//
// SIX CONTRACT RULES ENFORCED HERE:
//
//   1. UPLOAD B IS ALTERNATIVES ONLY (doc 03 § 1). A `RESUMEN` sheet in the same
//      file is ignored — an Upload B must never write portfolio data, exactly as
//      Upload A must never write alternatives data.
//
//   2. `(category, currency)` IS THE GROUPING KEY (doc 03 § 2.1). The sheet is
//      multi-currency and `Real Assets` appears three times in three currencies,
//      so category alone is ambiguous. Amounts in D–J are denominated in the
//      currency of the nearest category header ABOVE the row — never USD.
//
//   3. NO CROSS-CURRENCY TOTAL IS EVER PRODUCED (doc 03 § 4.2). The workbook's
//      own USD roll-up is `#NAME?` because it needs Bloomberg FX. NMI must not
//      invent one; per-currency subtotals only.
//
//   4. THE LEGEND IS THE WORKBOOK'S, AND MISSING MEANS BLOCK (doc 03 §§ 3.2,
//      6). The legend is `DC1:DC3` SPECIFICALLY — above the header row — while
//      column DC is simultaneously the last timeline column. Reading all of DC
//      as legend discards a month of real events; reading all of it as timeline
//      reads labels as data.
//
//   5. UNCOLOURED IS NOT AUTOMATICALLY AN ERROR (doc 03 § 3.4). A zero/empty
//      uncoloured cell is padding and is silent; a NON-ZERO uncoloured cell is
//      `unclassified_event` and requires administrator classification before
//      publication. Blocking outright would make the module unusable (73 such
//      cells exist); allowing silently would fabricate event semantics.
//
//   6. `TIR Calculada` IS INGESTED AS A CACHED SOURCE VALUE (doc 03 § 4.1).
//      Excel's IRR is an iterative solver; reproducing it to the digit adds risk
//      for no user benefit. It is labelled source-provided and never recomputed.

import { readXlsx, cellAt, textAt, serialToIsoDate, type XlsxSheet } from '../xlsx/readXlsx.ts'
import { sourceCell } from '../xlsx/cellRef.ts'
import {
  resolveFill,
  classifyFill,
  type EventType,
  type ClassificationMethod,
  type LegendEntry,
} from './colour.ts'

export const ALTERNATIVES_PARSER_VERSION = 'r13.4.alternatives.1'

/** Cross-check tolerance for the derived columns (doc 03 § 2.3). */
export const DERIVED_TOLERANCE = 1e-6

const ERROR_LITERALS = ['#NAME?', '#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NULL!', '#NUM!']

export interface AlternativesHolding {
  category: string
  currency: string
  investmentName: string
  sociedad: string
  capitalCommitted: number | null
  contributions: number | null
  unfunded: number | null
  lastStatementDate: string | null
  lastStatementLabel: string | null
  lastValuation: number | null
  flowSinceStatement: number | null
  currentValue: number | null
  reportedIrr: number | null
  calculatedIrr: number | null
  sourceSheet: string
  sourceRow: number
  sourceCell: string
}

export interface AlternativesEvent {
  investmentName: string
  sociedad: string
  currency: string
  /** Month-end date from the timeline header. */
  eventDate: string
  amount: number
  eventType: EventType
  /** Raw fill exactly as stored, e.g. `rgb:FF002060` or `theme:3@0.4`. */
  rawFill: string | null
  resolvedHex: string | null
  classificationMethod: ClassificationMethod | null
  sourceSheet: string
  sourceCell: string
  sourceRow: number
}

export interface AlternativesFinding {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  detail: string
  sourceSheet?: string
  sourceCell?: string
  rowLabel?: string
}

export interface AlternativesDraft {
  ok: boolean
  parserVersion: string
  legend: LegendEntry[]
  holdings: AlternativesHolding[]
  events: AlternativesEvent[]
  /** Per-(category, currency) subtotals. NEVER a cross-currency total. */
  subtotals: Array<{ category: string; currency: string; currentValue: number | null; holdings: number }>
  findings: AlternativesFinding[]
}

function f(
  severity: AlternativesFinding['severity'],
  code: string,
  detail: string,
  extra: Partial<AlternativesFinding> = {},
): AlternativesFinding {
  return { severity, code, detail, ...extra }
}

function num(sheet: XlsxSheet, row: number, col: number): number | null {
  const c = cellAt(sheet, row, col)
  return c && c.kind === 'number' ? c.number : null
}

function errAt(sheet: XlsxSheet, row: number, col: number): string | null {
  const c = cellAt(sheet, row, col)
  if (!c || c.kind !== 'error') return null
  const t = (c.text ?? '').trim()
  return ERROR_LITERALS.includes(t) ? t : '#ERROR'
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Doc 03 § 1: locate the Alternatives sheet, ignoring RESUMEN / 1 Pager. */
export function findAlternativesSheet(sheets: XlsxSheet[]): XlsxSheet | null {
  return sheets.find((s) => normalize(s.name) === 'alternatives') ?? null
}

const HEADER_B = /nombre de la inversi[oó]n/i
const CURRENCY_DECL = /inversiones en (.+)/i
const CURNCY_TICKER = /curncy$/i

const LEGEND_LABELS: ReadonlyArray<{ event: EventType; pattern: RegExp }> = [
  { event: 'aporte', pattern: /^aporte$/ },
  { event: 'dividendo', pattern: /^dividendo$/ },
  { event: 'distribucion', pattern: /^distribucion$/ },
]

/**
 * Doc 03 § 6.3 — the legend is read from the cells the workbook LABELS, not
 * from a fixed address. `DC1:DC3` is where it sits in the sample; the rule is
 * "labelled cells above the header row", which survives the column moving.
 */
export function detectLegend(sheet: XlsxSheet, headerRow: number, themeColours: string[]): LegendEntry[] {
  const out: LegendEntry[] = []
  for (let row = 1; row < headerRow; row++) {
    for (let col = 1; col <= sheet.maxColumn; col++) {
      const t = textAt(sheet, row, col)
      if (!t) continue
      const n = normalize(t)
      const match = LEGEND_LABELS.find((l) => l.pattern.test(n))
      if (!match || out.some((o) => o.event === match.event)) continue
      const cell = cellAt(sheet, row, col)
      const resolved = resolveFill(cell?.fill ?? null, themeColours)
      if (resolved.hex) out.push({ event: match.event, hex: resolved.hex, raw: resolved.raw })
    }
  }
  return out
}

export function parseAlternatives(bytes: Buffer): AlternativesDraft {
  const findings: AlternativesFinding[] = []
  const empty = (): AlternativesDraft => ({
    ok: false,
    parserVersion: ALTERNATIVES_PARSER_VERSION,
    legend: [],
    holdings: [],
    events: [],
    subtotals: [],
    findings,
  })

  const read = readXlsx(bytes)
  if (!read.ok) {
    findings.push(f('blocking', read.code, read.detail))
    return empty()
  }

  const sheet = findAlternativesSheet(read.workbook.sheets)
  if (!sheet) {
    findings.push(f('blocking', 'alternatives_sheet_not_found', 'the workbook contains no Alternatives sheet'))
    return empty()
  }

  // --- Anchor 1: header row (doc 03 § 6.1).
  let headerRow: number | null = null
  for (let row = 1; row <= Math.min(30, sheet.maxRow); row++) {
    const b = textAt(sheet, row, 2)
    if (b && HEADER_B.test(b)) { headerRow = row; break }
  }
  if (headerRow === null) {
    findings.push(f('blocking', 'alternatives_header_not_found',
      'no row carries the investment-name header in column B'))
    return empty()
  }

  // --- Anchor 2: timeline (doc 03 § 6.2) — date-formatted header cells right
  // of the master-data block. Column DC is BOTH the last timeline column and
  // the legend column; the legend lives ABOVE the header row, so scanning the
  // header row alone cannot confuse them (rule 4).
  const timeline: Array<{ column: number; date: string }> = []
  for (let col = 13; col <= sheet.maxColumn; col++) {
    const c = cellAt(sheet, headerRow, col)
    if (!c || c.kind !== 'number' || !c.isDateFormatted) continue
    const iso = serialToIsoDate(c.number ?? Number.NaN, read.workbook.date1904)
    if (iso) timeline.push({ column: col, date: iso })
  }
  if (timeline.length === 0) {
    findings.push(f('blocking', 'alternatives_timeline_not_found',
      'no date-formatted timeline columns were found on the header row'))
    return empty()
  }
  for (let i = 1; i < timeline.length; i++) {
    if (!(timeline[i].date > timeline[i - 1].date)) {
      findings.push(f('warning', 'alternatives_timeline_out_of_order',
        `timeline column ${i} does not advance`))
      break
    }
  }

  // --- Anchor 3: legend (doc 03 § 6.3). Missing → block (rule 4).
  const legend = detectLegend(sheet, headerRow, read.workbook.themeColours)
  if (legend.length < LEGEND_LABELS.length) {
    findings.push(f('blocking', 'alternatives_legend_missing',
      `the legend defines ${legend.length} of ${LEGEND_LABELS.length} event colours`))
    return empty()
  }

  // --- Anchor 7: technical zone (doc 03 § 6.7) — everything at or below the
  // first row whose E/F/G carry `… Curncy` tickers. Its `#NAME?` cascade is a
  // WARNING, not a block: it is derived, not ingested (doc 03 § 4.1).
  let technicalStart: number | null = null
  for (let row = headerRow + 1; row <= sheet.maxRow; row++) {
    for (const col of [5, 6, 7]) {
      const t = textAt(sheet, row, col)
      if (t && CURNCY_TICKER.test(t)) { technicalStart = row; break }
    }
    if (technicalStart !== null) break
  }
  const lastRow = technicalStart !== null ? technicalStart - 1 : sheet.maxRow

  const holdings: AlternativesHolding[] = []
  const events: AlternativesEvent[] = []
  let category: string | null = null
  let currency: string | null = null
  let investment: string | null = null

  for (let row = headerRow + 1; row <= lastRow; row++) {
    const b = textAt(sheet, row, 2)
    const c = textAt(sheet, row, 3)
    const d = textAt(sheet, row, 4)

    // --- Anchor 4: category row — B set, C empty, D declares a currency.
    if (b && !c && d) {
      const m = CURRENCY_DECL.exec(d)
      if (m) {
        category = b
        currency = normalize(m[1]).replace(/[^a-z]/g, '') || null
        investment = null
        continue
      }
    }

    // --- Anchor 5: investment row — B set, C empty, no currency declaration.
    if (b && !c) { investment = b; continue }

    // --- Anchor 6: holding row — C carries the sociedad.
    if (!c) continue

    if (!category || !currency) {
      findings.push(f('blocking', 'alternatives_orphan_holding_row',
        'a holding row appears with no category header above it',
        { sourceSheet: sheet.name, sourceCell: sourceCell(sheet.name, 3, row), rowLabel: c }))
      continue
    }
    if (!investment) {
      findings.push(f('blocking', 'alternatives_orphan_holding_row',
        'a holding row appears with no investment name above it',
        { sourceSheet: sheet.name, sourceCell: sourceCell(sheet.name, 3, row), rowLabel: c }))
      continue
    }

    const capital = num(sheet, row, 4)
    const contributions = num(sheet, row, 5)
    const unfunded = num(sheet, row, 6)
    const gCell = cellAt(sheet, row, 7)
    const gText = textAt(sheet, row, 7)
    const lastStatementDate = gCell && gCell.kind === 'number' && gCell.isDateFormatted
      ? serialToIsoDate(gCell.number ?? Number.NaN, read.workbook.date1904)
      : null
    const lastValuation = num(sheet, row, 8)
    const flow = num(sheet, row, 9)
    const currentValue = num(sheet, row, 10)
    const reportedIrr = num(sheet, row, 11)
    const calculatedIrr = num(sheet, row, 12)

    // Doc 03 § 2.3 — recompute the derived columns as a CROSS-CHECK. The cached
    // source value is what is stored; a mismatch is a warning, never a
    // correction, and never a block.
    if (capital !== null && contributions !== null && unfunded !== null) {
      if (Math.abs(unfunded - (capital - contributions)) > DERIVED_TOLERANCE * Math.max(1, Math.abs(unfunded))) {
        findings.push(f('warning', 'alternatives_derived_mismatch',
          'Unfunded does not equal Capital Committed minus Contributions',
          { sourceSheet: sheet.name, sourceCell: sourceCell(sheet.name, 6, row), rowLabel: c }))
      }
    }
    if (currentValue !== null && flow !== null && lastValuation !== null) {
      if (Math.abs(currentValue - (flow + lastValuation)) > DERIVED_TOLERANCE * Math.max(1, Math.abs(currentValue))) {
        findings.push(f('warning', 'alternatives_derived_mismatch',
          'Valor Actual does not equal Flujo desde ultimo statement plus Ultima Valorizacion',
          { sourceSheet: sheet.name, sourceCell: sourceCell(sheet.name, 10, row), rowLabel: c }))
      }
    }
    for (const [col, label] of [[8, 'Ultima Valorizacion'], [10, 'Valor Actual'], [12, 'TIR Calculada']] as const) {
      const e = errAt(sheet, row, col)
      if (e) {
        findings.push(f('warning', 'alternatives_source_cell_error',
          `${label} is ${e}`,
          { sourceSheet: sheet.name, sourceCell: sourceCell(sheet.name, col, row), rowLabel: c }))
      }
    }

    holdings.push({
      category, currency, investmentName: investment, sociedad: c,
      capitalCommitted: capital, contributions, unfunded,
      lastStatementDate,
      lastStatementLabel: lastStatementDate === null ? gText : null,
      lastValuation, flowSinceStatement: flow, currentValue,
      reportedIrr, calculatedIrr,
      sourceSheet: sheet.name, sourceRow: row, sourceCell: sourceCell(sheet.name, 2, row),
    })

    // --- Timeline events (rule 5).
    for (const t of timeline) {
      const cell = cellAt(sheet, row, t.column)
      if (!cell) continue
      const amount = cell.kind === 'number' ? cell.number : null
      const resolved = resolveFill(cell.fill, read.workbook.themeColours)
      const cellRef = sourceCell(sheet.name, t.column, row)

      if (amount === null || amount === 0) {
        // Padding, or a legend-coloured zero: ingested silently, no event row.
        if (!resolved.unfilled && resolved.hex === null) {
          findings.push(f('info', 'unknown_fill_no_value',
            'a cell carries an unresolvable fill and no value',
            { sourceSheet: sheet.name, sourceCell: cellRef, rowLabel: c }))
        }
        continue
      }

      const classified = classifyFill(resolved, legend)
      if (classified.event === 'unclassified') {
        findings.push(f('warning',
          classified.ambiguous ? 'ambiguous_fill_classification' : 'unclassified_event',
          classified.ambiguous
            ? 'a fill is equally close to two legend colours and must be classified by an administrator'
            : 'a value-bearing cell carries no recognised event colour and must be classified by an administrator',
          { sourceSheet: sheet.name, sourceCell: cellRef, rowLabel: c }))
      }

      events.push({
        investmentName: investment, sociedad: c, currency,
        eventDate: t.date, amount,
        eventType: classified.event,
        rawFill: resolved.raw,
        resolvedHex: resolved.hex,
        classificationMethod: classified.method,
        sourceSheet: sheet.name, sourceCell: cellRef, sourceRow: row,
      })
    }
  }

  // --- Per-(category, currency) subtotals ONLY (rule 3).
  const groups = new Map<string, { category: string; currency: string; currentValue: number | null; holdings: number }>()
  for (const h of holdings) {
    const key = `${h.category} ${h.currency}`
    const g = groups.get(key) ?? { category: h.category, currency: h.currency, currentValue: null, holdings: 0 }
    if (h.currentValue !== null) g.currentValue = (g.currentValue ?? 0) + h.currentValue
    g.holdings += 1
    groups.set(key, g)
  }

  const blocking = findings.filter((x) => x.severity === 'blocking')
  return {
    ok: blocking.length === 0,
    parserVersion: ALTERNATIVES_PARSER_VERSION,
    legend,
    holdings,
    events,
    subtotals: [...groups.values()],
    findings,
  }
}
