// R13.3 — RESUMEN parser: workbook → validated draft (doc 08 Stage 3).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import.
//
// PARSES ONLY. It writes nothing and publishes nothing — publication is
// Stage 5. Its whole job is to turn Upload A into a DRAFT plus an honest set of
// findings, and to refuse rather than guess.
//
// SIX CONTRACT RULES ENFORCED HERE:
//
//   1. UPLOAD A IS RESUMEN ONLY (doc 02 § 1). A workbook that also contains an
//      `Alternatives` sheet must never write alternatives data.
//
//   2. THE `Diferencia` COLUMN IS NEVER INGESTED (doc 02 § 4). It is the
//      PREVIOUS week's difference; the published difference is always derived
//      by NMI. `Diferencia` is read ONLY as a cross-check.
//
//   3. A REQUIRED CELL IN ERROR BLOCKS (doc 02 § 6.3). Never carry forward,
//      never substitute 0, never recalculate, never publish a total that no
//      longer reconciles.
//
//   4. A LEAF WITH NO BoY BASELINE IS `unavailable`, NOT 0 (doc 02 § 9).
//
//   5. HIERARCHY DEPTH IS SEMANTIC (doc 02 §§ 5.1, 5.2, 5.4). The two leaf
//      kinds are distinguished by their PARENT, not by indentation: a value row
//      under an `asset_class` is a SUB-ASSET CLASS; a value row under a
//      `sociedad_header` is an INDIVIDUAL ASSET. The two shapes differ —
//      Main is `asset class → sub-asset class` in the liquid block and
//      `asset class → sociedad → asset` in alternatives, while a personal
//      portfolio is `sociedad → asset class → sub-asset class`.
//
//   6. A PERFORMANCE BLOCK IS BOUND BY NUMERIC VERIFICATION, NEVER BY ORDER
//      (doc 02 § 2.1, established in doc 04 § 4). Main publishes TWO bases and
//      both blocks sit BELOW both candidate rows, so adjacency cannot
//      distinguish them. Each block is instead matched against every candidate
//      total by recomputing the flow-adjusted weekly profit; the basis follows
//      from which candidate reconciles. No unique match ⇒ blocking, never a
//      guess.

import { readXlsx, cellAt, textAt, type XlsxSheet } from '../xlsx/readXlsx.ts'
import { sourceCell } from '../xlsx/cellRef.ts'
import {
  detectColumns,
  resolveAnchors,
  type ClassifiedColumn,
  type DetectionFinding,
} from './dateDetection.ts'
import {
  detectScopes,
  technicalBlockStart,
  classifyRow,
  isAnnotationRow,
  isPerformanceBasisCandidate,
  performanceMetricOf,
  buildRowKey,
  childRowKey,
  REQUIRED_ROW_TYPES,
  classifyFlowCell,
  flowValueClass,
  type ScopeId,
  type RowType,
  type ValueClass,
} from './hierarchy.ts'
import {
  weeklyProfit,
  weeklyReturn,
  crossCheck,
  PERFORMANCE_TOLERANCE,
  type PerformanceCrossCheck,
} from './performance.ts'

/** Recorded on every upload (doc 08 Stage 3). Bump when parse semantics change.
 *
 * r13.r1.1.resumen.5 — R13.R1.1: full historical normalization. Four changes,
 * each removing a way a LEGITIMATE portfolio-history event was being reported
 * as a defective week (6 of 102 weeks parsed before; 102 parse now):
 *
 *   § 9  Row type is decided over EVERY date column, not the publication column
 *        alone, so a position that did not exist yet keeps its type, identity
 *        and parentage. This alone fixed 95 weeks of `duplicate_row_key`.
 *   § 8  A performance block with no figures at all is ABSENT, not ambiguous —
 *        it is skipped, and the week publishes.
 *   § 8  Only a scope's genuine performance BASES are offered as reconciliation
 *        candidates, so Main's section aggregates can neither tie with
 *        `SUBTOTAL` nor be silently published under its name.
 *   § 11 The earliest column on record resolves with null predecessor/baseline
 *        instead of blocking; its comparisons are unavailable, never zero.
 *
 * r13.r1.resumen.4 — R13.R1 § 4: `PORTAFOLIO EX/CON ACCIONES CHILENAS` are
 * recognised as `performance_header` rows. They title the two Main performance
 * blocks and are no longer emitted as snapshot rows, which is what put two
 * valueless rows into the Holdings table after the true portfolio TOTAL. The
 * blocks themselves are unchanged: each basis is still decided by numeric
 * reconciliation (rule 6), and the title is retained on the block as
 * corroborating provenance.
 *
 * r13.8.resumen.3 — the single final version for ALL R13.8 parser changes:
 * year performance metrics emit their PERSISTED ids (`ytd_profit`/`ytd_return`
 * — the prior 'annual_*' ids could never clear the portfolio_performance_rows
 * metric CHECK), plus the D4 personal-hierarchy normalization (annotation-row
 * skipping, the value-bearing personal `Alternativos` line, the
 * `sociedad_subtotal`/`sociedad_total` split, Main's above-header anchor, and
 * performance blocks surviving the source's blank separator line). */
export const RESUMEN_PARSER_VERSION = 'r13.r1.1.resumen.5'

/** Excel error literals that make a cell unusable (doc 02 § 6.3). */
const ERROR_LITERALS = ['#NAME?', '#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NULL!', '#NUM!']

/**
 * Performance basis identifiers — the vocabulary doc 05 § 5.3 already fixes.
 *
 * Main publishes `ex_chilean_equities` and `with_chilean_equities` (doc 02
 * § 2.1); a personal portfolio publishes `total`. Every performance row carries
 * one explicitly, so no downstream stage ever infers which Main series it is
 * looking at from row order or label text.
 */
export type PerformanceBasis = 'ex_chilean_equities' | 'with_chilean_equities' | 'total'

export const PERFORMANCE_BASES: readonly PerformanceBasis[] =
  ['ex_chilean_equities', 'with_chilean_equities', 'total'] as const

export interface ParsedSnapshotRow {
  scope: ScopeId
  rowKey: string
  parentRowKey: string | null
  depth: number
  displayOrder: number
  rowType: RowType
  labelEs: string
  value: number | null
  valueClass: ValueClass
  previousValue: number | null
  beginningOfYearValue: number | null
  /** NMI-derived: `value − previousValue`. Never imported from `Diferencia`. */
  difference: number | null
  differenceClass: ValueClass
  sourceSheet: string
  sourceCell: string
  /** Observed source row, for audit only — NEVER part of `rowKey`. */
  sourceRow: number
}

export interface ParsedPerformanceRow {
  scope: ScopeId
  basis: PerformanceBasis
  metric: string
  /** The source's own stored figure — authoritative for display. */
  sourceValue: number | null
  valueClass: ValueClass
  sourceSheet: string
  sourceCell: string
  sourceRow: number
  /** The snapshot row this block was proven to measure. */
  boundRowKey: string | null
  boundSourceCell: string | null
  /**
   * R13.R1 § 4 — the source title of the block this metric belongs to, when the
   * source provides one. Parser/model-level provenance, NOT persisted and never
   * used to decide a basis (see `PerformanceBlock.headerLabel`).
   */
  blockHeaderLabel: string | null
  crossChecks: PerformanceCrossCheck[]
}

export interface ParseFinding {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  detail: string
  scope?: ScopeId
  sourceSheet?: string
  sourceCell?: string
  rowLabel?: string
}

export interface ResumenDraft {
  ok: boolean
  parserVersion: string
  detectedAsOfDate: string | null
  previousWeekDate: string | null
  beginningOfYearDate: string | null
  rows: ParsedSnapshotRow[]
  performance: ParsedPerformanceRow[]
  findings: ParseFinding[]
}

function finding(
  severity: ParseFinding['severity'],
  code: string,
  detail: string,
  extra: Partial<ParseFinding> = {},
): ParseFinding {
  return { severity, code, detail, ...extra }
}

function fromDetection(f: DetectionFinding, severity: ParseFinding['severity']): ParseFinding {
  return { severity, code: f.code, detail: f.detail, sourceCell: f.sourceCell }
}

function numberAt(sheet: XlsxSheet, row: number, col: number): number | null {
  const c = cellAt(sheet, row, col)
  if (!c || c.kind !== 'number') return null
  return c.number
}

function errorAt(sheet: XlsxSheet, row: number, col: number): string | null {
  const c = cellAt(sheet, row, col)
  if (!c || c.kind !== 'error') return null
  const t = (c.text ?? '').trim()
  return ERROR_LITERALS.includes(t) ? t : t.length > 0 ? t : '#ERROR'
}

/** Doc 02 § 1: locate RESUMEN, ignoring any Alternatives / 1 Pager sheet. */
export function findResumenSheet(sheets: XlsxSheet[]): XlsxSheet | null {
  return sheets.find((s) => s.name.trim().toUpperCase() === 'RESUMEN') ?? null
}

// ---------------------------------------------------------------------------
// Performance blocks
// ---------------------------------------------------------------------------

interface BlockMetric { value: number | null; cell: string; row: number; error: string | null }

interface PerformanceBlock {
  /**
   * Flow for THIS block. Main's two bases carry different flows.
   *
   * `null` means the block carries no flow ROW at all, which under the
   * sparse-event convention is zero. It NEVER means "unreadable" — that is
   * `flowUnreadable`, and the two must not be conflated (R13.R2E.2 § 3).
   */
  flow: number | null
  flowCell: string | null
  /**
   * R13.R2E.2 — set when the block's flow cell holds something that is not a
   * readable number (Excel error, text, boolean, uncached formula). Names the
   * KIND of problem, never the cell's content. While it is set the block cannot
   * be reconciled at all: `bindBlockToCandidate` needs the flow to recompute the
   * weekly profit, and feeding it a fabricated zero could bind the block to the
   * WRONG total — the silent, plausible-looking error doc 02 § 2.1 exists to
   * prevent.
   */
  flowUnreadable: string | null
  /**
   * R13.R1 § 4 — the source's own title for this block, when it carries one
   * (`PORTAFOLIO EX/CON ACCIONES CHILENAS`). CORROBORATING EVIDENCE ONLY: the
   * basis is still decided by `bindBlockToCandidate`'s numeric reconciliation
   * (rule 6), never by this label. Retaining it keeps the header row available
   * to the performance model — which is why the row is skipped rather than
   * deleted — and makes a mis-binding visible instead of silent.
   */
  headerLabel: string | null
  headerCell: string | null
  metrics: Map<string, BlockMetric>
}

interface Candidate {
  rowKey: string
  rowType: RowType
  label: string
  value: number | null
  previousValue: number | null
  sourceCell: string
}

/** Basis implied by the candidate a block reconciles against (doc 02 § 2.1). */
function basisFor(scope: ScopeId, candidate: Candidate): PerformanceBasis {
  if (scope !== 'main') return 'total'
  return candidate.rowType === 'portfolio_subtotal' ? 'ex_chilean_equities' : 'with_chilean_equities'
}

/**
 * Binds one block to the candidate whose recomputation reproduces the block's
 * own stated weekly profit.
 *
 * This is the method doc 04 § 4 used to establish the bindings in the first
 * place, so it reproduces the documented result rather than re-deriving a rule.
 * Returns null when zero or MORE THAN ONE candidate matches — an ambiguous
 * binding must fail closed, because binding a personal block to the wrong total
 * is a silent, plausible-looking error (doc 02 § 2.1).
 */
export function bindBlockToCandidate(block: PerformanceBlock, candidates: Candidate[]): Candidate | null {
  const stated = block.metrics.get('weekly_profit')?.value ?? null
  if (stated === null) return null
  // R13.R2E.2 § 3 — an UNREADABLE flow cannot be reconciled against anything.
  // Substituting zero here would silently reconcile the block against whichever
  // total happens to fit a flow-free week, so this fails closed exactly as an
  // ambiguous candidate set does. The caller refuses the week before reaching
  // here; this is the guarantee at the function's own boundary.
  if (block.flowUnreadable !== null) return null
  // An absent flow ROW is a blank sparse-event cell, which is zero.
  const flow = block.flow ?? 0

  const matches = candidates.filter((c) => {
    const recomputed = weeklyProfit(c.value, c.previousValue, flow)
    if (recomputed === null) return false
    const scale = Math.max(1, Math.abs(stated))
    return Math.abs(recomputed - stated) / scale <= PERFORMANCE_TOLERANCE
  })

  return matches.length === 1 ? matches[0] : null
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

interface StackEntry { type: RowType; key: string; label: string }

export function parseResumen(
  bytes: Buffer,
  options: { publicationColumnLetter?: string } = {},
): ResumenDraft {
  const findings: ParseFinding[] = []
  const empty = (): ResumenDraft => ({
    ok: false,
    parserVersion: RESUMEN_PARSER_VERSION,
    detectedAsOfDate: null,
    previousWeekDate: null,
    beginningOfYearDate: null,
    rows: [],
    performance: [],
    findings,
  })

  const read = readXlsx(bytes)
  if (!read.ok) {
    findings.push(finding('blocking', read.code, read.detail))
    return empty()
  }

  const sheet = findResumenSheet(read.workbook.sheets)
  if (!sheet) {
    findings.push(finding('blocking', 'resumen_sheet_not_found', 'the workbook contains no RESUMEN sheet'))
    return empty()
  }

  const detection = detectColumns(sheet, read.workbook.date1904)
  for (const b of detection.blocking) findings.push(fromDetection(b, 'blocking'))
  for (const w of detection.warnings) findings.push(fromDetection(w, 'warning'))
  if (detection.headerRow === null) return empty()

  let publicationColumn: ClassifiedColumn | null = null
  if (options.publicationColumnLetter) {
    publicationColumn = detection.columns.find(
      (c) => c.letter === options.publicationColumnLetter!.toUpperCase() && c.role === 'historical',
    ) ?? null
    if (!publicationColumn) {
      findings.push(finding('blocking', 'publication_column_not_found',
        `column ${options.publicationColumnLetter} is not a historical week column`))
      return empty()
    }
  } else {
    publicationColumn = detection.live
    if (!publicationColumn) {
      findings.push(finding('blocking', 'live_column_not_found', 'no live column could be identified'))
      return empty()
    }
  }

  const anchorRes = resolveAnchors(detection, publicationColumn)
  if (!anchorRes.ok) {
    for (const b of anchorRes.blocking) findings.push(fromDetection(b, 'blocking'))
    return empty()
  }
  const { thisWeek, previousWeek, beginningOfYear } = anchorRes.anchors

  const scopes = detectScopes(sheet)
  if (scopes.length === 0) {
    findings.push(finding('blocking', 'no_portfolio_scope_found', 'no portfolio section anchor was found'))
    return empty()
  }
  const technicalStart = technicalBlockStart(sheet, detection.headerRow)

  // --- R13.R1.1 § 9: ROW TYPE IS A PROPERTY OF THE SOURCE ROW, NOT OF THE WEEK.
  //
  // A row is value-BEARING if it carries a number or an error in ANY date
  // column of the sheet. Asking only the publication column made a leaf whose
  // position did not exist that week classify as a CONTAINER, which both
  // re-parented its neighbours and collapsed same-named holdings onto one key
  // (see `classifyRow`). Scanning every date column makes the answer identical
  // for all 102 weeks, so a week's own emptiness can only change VALUES.
  const valueColumns = [...detection.historical, ...(detection.live ? [detection.live] : [])]
  const carriesValue = new Map<number, boolean>()
  const rowCarriesValueAnywhere = (row: number): boolean => {
    const memo = carriesValue.get(row)
    if (memo !== undefined) return memo
    let found = false
    for (const c of valueColumns) {
      const cell = cellAt(sheet, row, c.column)
      if (cell && (cell.kind === 'number' || cell.kind === 'error')) { found = true; break }
    }
    carriesValue.set(row, found)
    return found
  }

  const rows: ParsedSnapshotRow[] = []
  const performance: ParsedPerformanceRow[] = []

  for (const range of scopes) {
    const endRow = technicalStart !== null && range.endRow >= technicalStart
      ? technicalStart - 1
      : range.endRow

    let order = 0
    const scopeRows: ParsedSnapshotRow[] = []
    /** Rows whose publication cell is an Excel error — absent is not the same. */
    const erroredKeys = new Set<string>()
    const stack: StackEntry[] = []
    const candidates: Candidate[] = []
    const blocks: PerformanceBlock[] = []
    let current: PerformanceBlock | null = null

    const top = () => (stack.length > 0 ? stack[stack.length - 1] : null)

    for (let row = range.startRow + 1; row <= endRow; row++) {
      const label = textAt(sheet, row, 2)
      if (!label) {
        // A blank row CLOSES a performance block — but ONLY once the block
        // carries a metric. Main's two blocks are separated by blank rows and
        // must not merge; the personal scopes separate the FLOW row from its
        // own metrics with a blank line (verified, R13.8 D4), and closing
        // there detached every personal flow and broke the basis binding.
        if (current !== null && current.metrics.size > 0) current = null
        continue
      }

      // Presentation annotations (`valores en dólares` and its date cells,
      // Main's subtitle) are never economic nodes (R13.8 D4).
      if (isAnnotationRow(label)) continue

      const hasValue = rowCarriesValueAnywhere(row)
      const sociedadLabel =
        [...stack].reverse().find((e) => e.type === 'sociedad_header')?.label ?? null
      const rowType = classifyRow(label, hasValue, top()?.type ?? null, sociedadLabel)

      const cellName = sourceCell(sheet.name, thisWeek.column, row)
      const err = errorAt(sheet, row, thisWeek.column)

      // --- R13.R1 § 4: a performance-block TITLE opens a block and is never
      // emitted as a snapshot row. Opening here (rather than merely skipping)
      // is what guarantees the title can never merge two blocks: it closes any
      // block still open and starts the one it names.
      if (rowType === 'performance_header') {
        current = { flow: null, flowCell: null, flowUnreadable: null, headerLabel: label, headerCell: cellName, metrics: new Map() }
        blocks.push(current)
        continue
      }

      // --- Performance blocks (rule 6). A run of flow/performance rows forms
      // one block; any other row closes it.
      if (rowType === 'performance' || rowType === 'flow') {
        if (!current) {
          current = { flow: null, flowCell: null, flowUnreadable: null, headerLabel: null, headerCell: null, metrics: new Map() }
          blocks.push(current)
        }
        if (rowType === 'flow') {
          // Doc 02 § 8: an EMPTY flow cell means ZERO flow, not missing data.
          //
          // R13.R2E.2 § 3 — BUT ONLY AN EMPTY ONE. This was `numberAt(...) ?? 0`,
          // and `numberAt` returns null for every non-numeric cell — so an Excel
          // error, a number typed as text or a stray boolean fell into the same
          // zero as a genuine blank, and a corrupted capital movement would have
          // published as performance. `classifyFlowCell` separates the two, and
          // it is the ONLY place that decision is made.
          const reading = classifyFlowCell(sheet, row, thisWeek.column)
          current.flow = reading.state === 'unreadable' ? null : reading.value
          current.flowUnreadable = reading.state === 'unreadable' ? reading.detail : null
          current.flowCell = cellName
        } else {
          const metric = performanceMetricOf(label) ?? 'unknown'
          current.metrics.set(metric, {
            value: numberAt(sheet, row, thisWeek.column), cell: cellName, row, error: err,
          })
          if (err !== null) {
            findings.push(finding('warning', 'source_cell_error',
              `${label} is ${err} in the publication column`,
              { scope: range.scope, sourceSheet: sheet.name, sourceCell: cellName, rowLabel: label }))
          }
        }
        continue
      }
      current = null

      // --- Required-cell error policy (rule 3).
      if (err !== null) {
        const required = REQUIRED_ROW_TYPES.has(rowType)
        findings.push(finding(required ? 'blocking' : 'warning', 'source_cell_error',
          `${label} is ${err} in the publication column`,
          { scope: range.scope, sourceSheet: sheet.name, sourceCell: cellName, rowLabel: label }))
      }

      // --- Container stack (rule 5). Depth is the stack depth, so both the
      // Main and personal shapes are represented without a per-type constant.
      switch (rowType) {
        case 'group_header':
          stack.length = 0
          break
        case 'sociedad_header':
          // Consecutive sociedades are siblings; a sociedad nests under an
          // asset class in Main's alternatives block and stands at the top of a
          // personal portfolio (doc 02 §§ 5.2, 5.4).
          while (top()?.type === 'sociedad_header') stack.pop()
          break
        case 'asset_class':
          while (
            top()?.type === 'asset_class' ||
            (top()?.type === 'sociedad_header' && stack[stack.length - 2]?.type === 'asset_class')
          ) stack.pop()
          break
        case 'sociedad_subtotal':
        case 'sociedad_total':
          // Keeps the sociedad as its parent.
          while (top()?.type === 'asset_class') stack.pop()
          break
        case 'portfolio_subtotal':
        case 'portfolio_total':
        case 'named_holding':
          stack.length = 0
          break
        default:
          break
      }

      const parent = top()
      const parentRowKey = parent ? parent.key : null
      const depth = stack.length

      // Fail closed rather than silently flattening (rule 5).
      if ((rowType === 'individual_asset' || rowType === 'sub_asset_class') && parent === null) {
        findings.push(finding('blocking', 'ambiguous_hierarchy_row',
          `${label} carries a value but sits under no asset class or sociedad`,
          { scope: range.scope, sourceSheet: sheet.name, sourceCell: cellName, rowLabel: label }))
      }

      // Derived from the LABEL PATH, never the row number (doc 05 § 5.2, A8).
      const rowKey = parentRowKey ? childRowKey(parentRowKey, label) : buildRowKey(range.scope, [label])
      if (rowType === 'group_header' || rowType === 'asset_class' || rowType === 'sociedad_header') {
        stack.push({ type: rowType, key: rowKey, label })
      }

      const value = err !== null ? null : numberAt(sheet, row, thisWeek.column)
      // Both anchors are null for the first observation on record (R13.R1.1
      // § 11); every derived comparison is then unavailable rather than zero.
      const prev = previousWeek ? numberAt(sheet, row, previousWeek.column) : null
      const boy = beginningOfYear ? numberAt(sheet, row, beginningOfYear.column) : null
      const difference = value !== null && prev !== null ? value - prev : null

      // R13.R1.1 § 8 — only a genuine performance BASIS may be offered; a
      // section aggregate is not one. See `isPerformanceBasisCandidate`.
      if (isPerformanceBasisCandidate(range.scope, rowType, label)) {
        candidates.push({
          rowKey, rowType, label, value, previousValue: prev, sourceCell: cellName,
        })
      }

      scopeRows.push({
        scope: range.scope,
        rowKey,
        parentRowKey,
        depth,
        displayOrder: order++,
        rowType,
        labelEs: label,
        value,
        valueClass: err !== null
          ? 'unavailable'
          : value === null ? 'unavailable' : 'source_value',
        previousValue: prev,
        beginningOfYearValue: boy,
        difference,
        differenceClass: difference === null ? 'unavailable' : 'nmi_calculated',
        sourceSheet: sheet.name,
        sourceCell: cellName,
        sourceRow: row,
      })

      // A sociedad's TERMINAL total completes the sociedad — the next row can
      // never belong to it (R13.8 D4; doc 02 § 5.4).
      if (rowType === 'sociedad_total' && top()?.type === 'sociedad_header') stack.pop()
      if (err !== null) erroredKeys.add(rowKey)
    }

    // --- R13.R1.1 §§ 3, 5: A SNAPSHOT CONTAINS WHAT THE PORTFOLIO HELD THAT
    // WEEK — nothing more.
    //
    // ONE RULE, applied to a fixed point: a row that carries NO VALUE and has
    // NO SURVIVING DESCENDANT was not part of the portfolio that week, and is
    // not part of its snapshot. It drops out.
    //
    //   · An empty leaf is a position that did not exist yet, or had been sold.
    //     Emitting it as a blank row states that the family held something
    //     worth nothing — and would have put nine blank fund rows into a 2024
    //     Holdings table, the very defect R13.R1 § 4 removed from the live one.
    //   · A label container (`sociedad_header`, `group_header`) whose every
    //     child dropped out labels nothing, so it goes too.
    //   · A valueless row that still HAS a surviving descendant is KEPT — it is
    //     load-bearing structure, and dropping it would orphan its children.
    //
    // AN ERROR CELL IS NOT AN ABSENCE and is never pruned (doc 02 § 6.3): it
    // stays, `unavailable`. That gives the comparison layer the invariant it
    // needs — a row MISSING from a cleanly-published snapshot is DEFINITIVELY
    // absent, never merely unknown — which is what lets § 14 read an arrival as
    // a New Position rather than as missing data.
    {
      const surviving = new Map(scopeRows.map((r) => [r.rowKey, r]))
      for (let pass = 0; pass < 64; pass++) {
        const hasChild = new Set<string>()
        for (const r of surviving.values()) if (r.parentRowKey !== null) hasChild.add(r.parentRowKey)
        const doomed = [...surviving.values()].filter(
          (r) => r.value === null && !erroredKeys.has(r.rowKey) && !hasChild.has(r.rowKey),
        )
        if (doomed.length === 0) break
        for (const r of doomed) surviving.delete(r.rowKey)
      }
      for (const r of scopeRows) if (surviving.has(r.rowKey)) rows.push(r)
    }

    // --- Bind each block (rule 6).
    const usedBases = new Set<PerformanceBasis>()
    for (const block of blocks) {
      // --- R13.R2E.2 § 3: AN UNREADABLE FLOW CELL FAILS THE WEEK CLOSED.
      //
      // This is checked FIRST — ahead of every other early exit below —
      // because those exits DROP the block, and a dropped block publishes no
      // flow row at all. Downstream, an absent flow row is a blank sparse-event
      // cell and therefore ZERO (doc 02 § 8), so quietly dropping a block whose
      // flow cell is corrupted would convert an ERROR into a confident "no money
      // moved" — the precise failure this rule exists to prevent.
      //
      // Nor can the block simply be published with an `unavailable` flow: the
      // basis is established by reconciling the stated weekly profit against
      // each candidate total, and that reconciliation needs the flow. Without
      // it there is no basis to publish the row under, and guessing one is
      // exactly what doc 02 § 2.1 forbids.
      //
      // So the week is REFUSED — blocking, like `ambiguous_performance_basis`,
      // and for the same reason: a real cell we cannot read must not become a
      // plausible-looking number. The administrator gets the sheet and the cell,
      // fixes the workbook, and re-uploads. No week in the current book reaches
      // this (all 477 blank flow cells are genuinely absent cells, all 33 values
      // are numbers), so nothing that publishes today is affected.
      if (block.flowUnreadable !== null) {
        findings.push(finding('blocking', 'flow_cell_unreadable',
          `the contribution/withdrawal cell for ${range.scope} holds ${block.flowUnreadable}, ` +
          'so this week\'s net flow cannot be read; it is not treated as zero',
          { scope: range.scope, sourceSheet: sheet.name,
            sourceCell: block.flowCell ?? undefined,
            rowLabel: block.headerLabel ?? undefined }))
        continue
      }

      if (block.metrics.size === 0) continue

      // --- R13.R1.1 § 8: AN ABSENT BLOCK IS NOT AN AMBIGUOUS ONE.
      //
      // The block's LABEL rows exist in every column, so a block the source did
      // not maintain that week still reaches here — with every metric cell
      // empty. Binding needs a stated weekly profit, so `bindBlockToCandidate`
      // returned null and the week was reported as ambiguous. Nothing was
      // ambiguous: the block simply did not exist yet.
      //
      // Verified across the 102-week history: Main's `PORTAFOLIO CON ACCIONES
      // CHILENAS` block carries no figures at all before 2026 (70 weeks), and
      // Pablo's block is likewise unmaintained in the first 8. Publishing
      // nothing for such a block is the honest outcome; a WEEK is not defective
      // because a series had not started.
      //
      // This narrows only the empty case. A block that DOES state a figure and
      // still fails to match exactly one candidate remains blocking below — an
      // unbindable real figure is the silent, plausible-looking error doc 02
      // § 2.1 exists to prevent.
      if ([...block.metrics.values()].every((m) => m.value === null && m.error === null)) {
        findings.push(finding('info', 'performance_block_absent',
          `a performance block for ${range.scope} carries no figures in this week and was not published`,
          { scope: range.scope, sourceSheet: sheet.name, sourceCell: block.headerCell ?? undefined,
            rowLabel: block.headerLabel ?? undefined }))
        continue
      }

      // --- R13.R1.1 § 8: A BLOCK WITH FIGURES BUT NO STATED WEEKLY PROFIT
      // CANNOT BE RECONCILED, AND IS NEVER GUESSED.
      //
      // Reconciliation is the only admissible evidence for a basis (rule 6),
      // and it needs the block's own weekly profit. One block-week in the whole
      // 102-week history has this shape — 2025-12-26's `PORTAFOLIO CON ACCIONES
      // CHILENAS`, filled with year-end YTD figures only. The block's title
      // names a portfolio, but promoting that title to a decider is exactly
      // what doc 02 § 2.1 forbids, so the block is DROPPED and the week is
      // reported rather than attributed on a guess.
      //
      // It is a warning, not a blocker: 195 valid rows and every other block
      // are unaffected, and a week must not be lost because one derived series
      // is incomplete.
      if (block.metrics.get('weekly_profit')?.value == null) {
        findings.push(finding('warning', 'performance_block_unbindable',
          `a performance block for ${range.scope} states no weekly profit, so its basis cannot be reconciled; it was not published`,
          { scope: range.scope, sourceSheet: sheet.name, sourceCell: block.headerCell ?? undefined,
            rowLabel: block.headerLabel ?? undefined }))
        continue
      }

      const bound = bindBlockToCandidate(block, candidates)

      if (!bound) {
        findings.push(finding('blocking', 'ambiguous_performance_basis',
          `a performance block for ${range.scope} could not be matched to exactly one total row`,
          { scope: range.scope, sourceSheet: sheet.name }))
        continue
      }

      const basis = basisFor(range.scope, bound)
      if (usedBases.has(basis)) {
        // One basis must never overwrite another.
        findings.push(finding('blocking', 'duplicate_performance_basis',
          `two performance blocks for ${range.scope} both resolved to ${basis}`,
          { scope: range.scope, sourceSheet: sheet.name }))
        continue
      }
      usedBases.add(basis)

      const profit = weeklyProfit(bound.value, bound.previousValue, block.flow ?? 0)
      const ret = weeklyReturn(profit, bound.previousValue)

      if (block.flowCell) {
        // R13.R2E.2 § 4 — the value class comes from the ONE classifier, never
        // from a literal here. `flowUnreadable` is null by this point (the week
        // is refused above if it is not), so this resolves to
        // `source_provided_flow` today — but deriving it keeps the single source
        // of truth intact rather than restating it and letting the two drift.
        performance.push({
          scope: range.scope, basis, metric: 'flow',
          sourceValue: block.flow,
          valueClass: flowValueClass(
            block.flowUnreadable !== null
              ? { state: 'unreadable', value: null, detail: block.flowUnreadable }
              : { state: 'stated', value: block.flow ?? 0, detail: null },
          ),
          sourceSheet: sheet.name, sourceCell: block.flowCell,
          sourceRow: Number(/[0-9]+$/.exec(block.flowCell)?.[0] ?? 0),
          boundRowKey: bound.rowKey, boundSourceCell: bound.sourceCell,
          blockHeaderLabel: block.headerLabel,
          crossChecks: [],
        })
      }

      for (const [metric, m] of block.metrics) {
        const checks: PerformanceCrossCheck[] = []
        if (metric === 'weekly_profit') checks.push(crossCheck('weekly_profit', m.value, profit))
        if (metric === 'weekly_return') checks.push(crossCheck('weekly_return', m.value, ret))
        performance.push({
          scope: range.scope, basis, metric,
          sourceValue: m.error !== null ? null : m.value,
          valueClass: m.error !== null ? 'unavailable' : 'source_provided_return',
          sourceSheet: sheet.name, sourceCell: m.cell, sourceRow: m.row,
          boundRowKey: bound.rowKey, boundSourceCell: bound.sourceCell,
          blockHeaderLabel: block.headerLabel,
          crossChecks: checks,
        })
      }
    }
  }

  // R13.8 D4 — economic identity must be unique WITHIN the parse, not just at
  // the database: a duplicate row key means two source rows would silently
  // claim the same identity in every week-over-week comparison, so it blocks
  // here rather than surfacing later as a DB unique-constraint error.
  const seenKeys = new Set<string>()
  for (const r of rows) {
    if (seenKeys.has(r.rowKey)) {
      findings.push(finding('blocking', 'duplicate_row_key',
        `${r.labelEs} produces a duplicate row key (${r.rowKey})`,
        { scope: r.scope, sourceSheet: r.sourceSheet, sourceCell: r.sourceCell, rowLabel: r.labelEs }))
    }
    seenKeys.add(r.rowKey)
  }

  for (const p of performance) {
    for (const c of p.crossChecks) {
      if (!c.indeterminate && !c.agrees) {
        findings.push(finding('warning', 'performance_definition_mismatch',
          `${p.metric} (${p.basis}) for ${p.scope} differs from NMI's recomputation`,
          { scope: p.scope, sourceCell: p.sourceCell }))
      }
    }
  }

  // Rule 2 cross-check: `Diferencia` must equal last-closed minus its
  // predecessor. Never a data source; disagreement is a warning.
  if (detection.difference && detection.historical.length >= 2) {
    const last = detection.historical[detection.historical.length - 1]
    const beforeLast = detection.historical[detection.historical.length - 2]
    for (const r of rows.slice(0, 40)) {
      const stated = numberAt(sheet, r.sourceRow, detection.difference.column)
      const a = numberAt(sheet, r.sourceRow, last.column)
      const b = numberAt(sheet, r.sourceRow, beforeLast.column)
      if (stated === null || a === null || b === null) continue
      if (Math.abs(stated - (a - b)) > 1e-6 * Math.max(1, Math.abs(stated))) {
        findings.push(finding('warning', 'difference_column_inconsistent',
          `the Diferencia column does not equal ${last.date} − ${beforeLast.date} for ${r.labelEs}`,
          { scope: r.scope, sourceSheet: sheet.name, rowLabel: r.labelEs }))
        break
      }
    }
  }

  const blocking = findings.filter((f) => f.severity === 'blocking')
  return {
    ok: blocking.length === 0,
    parserVersion: RESUMEN_PARSER_VERSION,
    detectedAsOfDate: thisWeek.date,
    previousWeekDate: previousWeek?.date ?? null,
    beginningOfYearDate: beginningOfYear?.date ?? null,
    rows,
    performance,
    findings,
  }
}
