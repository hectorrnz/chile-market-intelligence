// R13.R2E.2 § 6 — the contribution/withdrawal cell FAILS CLOSED.
//
// THE LATENT DEFECT THIS CLOSES. The sparse-event convention (doc 02 § 8) says a
// genuinely empty flow cell means NO MONEY MOVED, and the parser expressed that
// as `numberAt(sheet, row, col) ?? 0`. But `numberAt` returns null for EVERY
// non-numeric cell kind, so an Excel error, an amount typed as text or a stray
// boolean collapsed onto exactly the same zero as a genuine blank. A corrupted
// capital movement would then have been published as PERFORMANCE — silently,
// and looking entirely plausible.
//
// No such cell exists in the current workbook: across the five flow rows × 102
// week columns, all 477 blanks are literally absent cells and all 33 values are
// numbers, so nothing was ever mis-read and every published figure stands. These
// tests close the door before one appears.
//
// THE RULE, in one table:
//
//   no cell at all / empty without formula / empty-string text  → BLANK    → 0
//   any finite number, literal 0 included                       → STATED   → that number
//   Excel error / text / boolean / uncached formula             → UNREADABLE → refuse
//
// NO PRIVATE DATA. Every fixture below is synthetic and hand-written; nothing is
// read from the real workbook and nothing is written anywhere.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyFlowCell,
  flowValueClass,
  type FlowCellReading,
} from '../src/lib/familyPortfolio/resumen/hierarchy.ts'
import { bindBlockToCandidate } from '../src/lib/familyPortfolio/resumen/parseResumen.ts'
import {
  buildFlowAdjustedSeries,
  netFlowOf,
  type FlowObservation,
} from '../src/lib/familyPortfolio/flowAdjustedEvolution.ts'
import type { XlsxCell, XlsxSheet } from '../src/lib/familyPortfolio/xlsx/readXlsx.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PARSER = read('src/lib/familyPortfolio/resumen/parseResumen.ts')
const HIERARCHY = read('src/lib/familyPortfolio/resumen/hierarchy.ts')
const DOC = read('docs/portfolio-r13/02-resumen-source-contract.md')
const MIGRATION = read('supabase/migrations/20260808000000_family_portfolio_snapshots.sql')

// ── a one-cell synthetic sheet ──────────────────────────────────────────────
const ROW = 97
const COL = 5

function cell(partial: Partial<XlsxCell>): XlsxCell {
  return {
    ref: 'E97', column: COL, row: ROW, kind: 'empty',
    number: null, text: null, formula: null, isDateFormatted: false, fill: null,
    ...partial,
  }
}

/** A sheet holding exactly one cell at E97 — or none at all when given null. */
function sheetWith(c: XlsxCell | null): XlsxSheet {
  const cells = new Map<string, XlsxCell>()
  if (c !== null) cells.set(`${ROW}:${COL}`, c)
  return { name: 'RESUMEN', cells, maxRow: ROW, maxColumn: COL }
}

const readingOf = (c: XlsxCell | null): FlowCellReading => classifyFlowCell(sheetWith(c), ROW, COL)

// ═══════════════════════════════════════════════════════════════════════════
// 1 · §§ 2-3 — blank stays zero; anything unreadable refuses
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.2 §§ 2-3 — flow-cell classification', () => {
  test('1-2 · a genuinely blank cell is ZERO, however the file expresses it', () => {
    // No cell written at all — every one of the workbook's 477 real blanks.
    assert.deepEqual(readingOf(null), { state: 'blank', value: 0, detail: null })
    // A stored-but-empty cell with no formula.
    assert.equal(readingOf(cell({ kind: 'empty' })).state, 'blank')
    // A formula that returned the empty string says nothing happened.
    assert.equal(readingOf(cell({ kind: 'text', text: '', formula: 'IF(A1,"",B1)' })).state, 'blank')
    assert.equal(readingOf(cell({ kind: 'text', text: '   ' })).state, 'blank')
    for (const c of [null, cell({ kind: 'empty' }), cell({ kind: 'text', text: '' })]) {
      assert.equal(readingOf(c).value, 0)
      assert.equal(flowValueClass(readingOf(c)), 'source_provided_flow')
    }
  })

  test('3-4 · a stated numeric flow is preserved exactly, either sign', () => {
    const positive = readingOf(cell({ kind: 'number', number: 1_655_600 }))
    assert.deepEqual(positive, { state: 'stated', value: 1_655_600, detail: null })
    const negative = readingOf(cell({ kind: 'number', number: -420_000.25 }))
    assert.deepEqual(negative, { state: 'stated', value: -420_000.25, detail: null })
    assert.equal(flowValueClass(positive), 'source_provided_flow')
    assert.equal(flowValueClass(negative), 'source_provided_flow')
  })

  test('5 · a LITERAL numeric zero is preserved as a stated zero, not folded into blank', () => {
    const zero = readingOf(cell({ kind: 'number', number: 0 }))
    assert.equal(zero.state, 'stated', 'the source stating 0 is a statement, not an absence')
    assert.equal(zero.value, 0)
    assert.equal(flowValueClass(zero), 'source_provided_flow')
    // It reads identically downstream, which is correct — both mean no money moved.
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: zero.value }), 0)
  })

  test('6 · every Excel error is UNREADABLE and quotes only the fixed error vocabulary', () => {
    for (const literal of ['#NAME?', '#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NULL!', '#NUM!']) {
      const r = readingOf(cell({ kind: 'error', text: literal }))
      assert.equal(r.state, 'unreadable', literal)
      assert.equal(r.value, null, literal)
      assert.equal(r.detail, literal, literal)
      assert.equal(flowValueClass(r), 'unavailable', literal)
    }
    // An error outside that vocabulary is still unreadable, and is NOT echoed.
    const odd = readingOf(cell({ kind: 'error', text: 'something private 1.655.600' }))
    assert.equal(odd.state, 'unreadable')
    assert.equal(odd.detail, '#ERROR')
    assert.ok(!/1\.655\.600/.test(odd.detail as string), 'cell content must never reach a finding')
  })

  test('7 · malformed text is UNREADABLE and its content is never echoed', () => {
    for (const text of ['1.655.600', 'n/a', 'TBD', '—', '1,234 USD']) {
      const r = readingOf(cell({ kind: 'text', text }))
      assert.equal(r.state, 'unreadable', text)
      assert.equal(r.value, null, text)
      assert.equal(flowValueClass(r), 'unavailable', text)
      assert.ok(!(r.detail as string).includes(text), `"${text}" must not appear in the detail`)
    }
  })

  test('8 · an unsupported type or an uncached formula is UNREADABLE, never zero', () => {
    const bool = readingOf(cell({ kind: 'boolean', text: 'TRUE' }))
    assert.equal(bool.state, 'unreadable')
    // A formula whose cached result the file does not carry: unknown, not absent.
    const uncached = readingOf(cell({ kind: 'empty', formula: 'CZ97' }))
    assert.equal(uncached.state, 'unreadable')
    assert.equal(uncached.value, null)
    // A non-finite cached number is not a number either.
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(readingOf(cell({ kind: 'number', number: n })).state, 'unreadable', String(n))
    }
  })

  test('a blank and an unreadable cell can never produce the same reading', () => {
    const blanks = [null, cell({ kind: 'empty' }), cell({ kind: 'text', text: '' })]
    const unreadables = [
      cell({ kind: 'error', text: '#REF!' }),
      cell({ kind: 'text', text: 'n/a' }),
      cell({ kind: 'boolean', text: 'TRUE' }),
      cell({ kind: 'empty', formula: 'CZ97' }),
    ]
    for (const b of blanks) assert.equal(readingOf(b).value, 0)
    for (const u of unreadables) {
      assert.equal(readingOf(u).value, null)
      assert.notEqual(readingOf(u).state, 'blank')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · § 3 — the refusal propagates; nothing downstream sees a fabricated zero
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.2 § 3 — the parser fails the week closed', () => {
  const CANDIDATES = [
    { rowKey: 'main.subtotal', rowType: 'portfolio_subtotal' as const, label: 'SUBTOTAL',
      value: 1100, previousValue: 1000, sourceCell: 'E80' },
    { rowKey: 'main.total', rowType: 'portfolio_total' as const, label: 'TOTAL',
      value: 2100, previousValue: 2000, sourceCell: 'E85' },
  ]
  const block = (over: Record<string, unknown>) => ({
    flow: null, flowCell: 'E97', flowUnreadable: null, headerLabel: null, headerCell: null,
    metrics: new Map([['weekly_profit', { value: 100, cell: 'E98', row: 98, error: null }]]),
    ...over,
  })

  test('9 · an unreadable flow makes the block unbindable — no zero is substituted', () => {
    // With a readable (blank ⇒ zero) flow both candidates move by exactly 100,
    // so the binding is ambiguous and already returns null. Give one candidate a
    // different move so a UNIQUE match exists, then prove the unreadable flow
    // still refuses it.
    const unique = [CANDIDATES[0], { ...CANDIDATES[1], value: 2500 }]
    assert.equal(bindBlockToCandidate(block({}) as never, unique as never), unique[0],
      'a blank flow binds normally')
    assert.equal(
      bindBlockToCandidate(block({ flowUnreadable: '#REF!' }) as never, unique as never),
      null,
      'an unreadable flow must never bind',
    )
  })

  test('the unreadable check runs BEFORE every early exit that would drop the block', () => {
    // A dropped block publishes no flow row, and an absent flow row is read
    // downstream as a blank — i.e. as ZERO. So the refusal must come first, or a
    // corrupted cell would be converted into a confident "no money moved".
    // Comments stripped first: the prose above the refusal legitimately NAMES
    // the later exits, and matching those mentions would compare documentation
    // order instead of execution order.
    const code = codeOf(PARSER)
    const loop = code.slice(code.indexOf('for (const block of blocks)'))
    const refusal = loop.indexOf('flow_cell_unreadable')
    assert.ok(refusal !== -1, 'the refusal must live inside the binding loop')
    for (const laterExit of ['block.metrics.size === 0', 'performance_block_absent',
      'performance_block_unbindable', 'ambiguous_performance_basis']) {
      const at = loop.indexOf(laterExit)
      assert.ok(at > refusal, `${laterExit} must come after the refusal`)
    }
  })

  test('the refusal is BLOCKING, so the week is never published with a guessed flow', () => {
    assert.match(PARSER, /finding\('blocking', 'flow_cell_unreadable'/)
    // And it names the cell so the administrator can fix the workbook.
    assert.match(PARSER, /sourceCell: block\.flowCell \?\? undefined/)
  })

  test('`?? 0` no longer stands between a flow CELL and its reading', () => {
    const code = codeOf(PARSER)
    assert.ok(
      !/numberAt\(sheet, row, thisWeek\.column\) \?\? 0/.test(code),
      'the coercion that collapsed error onto blank must be gone',
    )
    assert.match(code, /classifyFlowCell\(sheet, row, thisWeek\.column\)/)
    // `block.flow ?? 0` survives deliberately: it means "this block has no flow
    // ROW", which under the sparse-event convention is genuinely zero — and it
    // is now guarded by the unreadable check above it.
    assert.match(code, /block\.flowUnreadable !== null\) return null/)
  })

  test('10-14 · a fully-blank record still adjusts every one of its observations', () => {
    // The Main Incl. shape: 102 weekly levels, no flow cell written in any of
    // them. Hardening must not cost a single observation.
    const record: FlowObservation[] = Array.from({ length: 102 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 7, 23) + i * 7 * 86_400_000).toISOString().slice(0, 10),
      value: 1000 + i * 10,
      flow: classifyFlowCell(sheetWith(null), ROW, COL).value,
    }))
    const out = buildFlowAdjustedSeries(record)
    assert.equal(out.points.length, 102)
    assert.equal(out.adjustableFrom, null)
    assert.equal(out.netFlowExcluded, 0)
    // And Pablo's shorter record keeps its own full length.
    assert.equal(buildFlowAdjustedSeries(record.slice(8)).points.length, 94)
  })

  test('9 (downstream) · an unreadable flow propagates to an unadjustable step', () => {
    const record: FlowObservation[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 2).padStart(2, '0')}`,
      value: 1000 + i * 10,
      flow: 0,
    }))
    const reading = readingOf(cell({ kind: 'error', text: '#REF!' }))
    record[4] = { ...record[4], flow: reading.value, flowUnavailable: reading.state === 'unreadable' }
    const out = buildFlowAdjustedSeries(record)
    assert.equal(out.points.length, 6, 'the unreadable step and everything before it is refused')
    assert.equal(out.adjustableFrom, record[4].date)
  })

  test('16 · no share-count inference was introduced anywhere on this path', () => {
    for (const src of [codeOf(PARSER), codeOf(HIERARCHY)]) {
      assert.ok(!/inferFlow|shareCount|deriveFlowFrom/i.test(src))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · § 4 — one classification, no new schema
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.2 §§ 4-5 — one classifier, existing schema, documented', () => {
  test('the decision is made in exactly ONE place', () => {
    // The parser must not re-derive it, and no second copy may appear.
    const parserBody = codeOf(PARSER)
    assert.equal((parserBody.match(/classifyFlowCell\(/g) ?? []).length, 1,
      'classified once, at the single flow-cell read')
    // The flow branch itself must delegate entirely — no second opinion on the
    // cell's kind alongside the classifier's.
    const branch = parserBody.slice(
      parserBody.indexOf("if (rowType === 'flow') {"),
      parserBody.indexOf('} else {', parserBody.indexOf("if (rowType === 'flow') {")),
    )
    assert.ok(branch.length > 0)
    assert.ok(!/\.kind|numberAt|errorAt/.test(branch),
      'the flow branch must not re-inspect the cell')
    assert.match(parserBody, /flowValueClass\(/, 'the value class is derived, never restated')
    assert.ok(!/valueClass: 'source_provided_flow'/.test(parserBody),
      'no hard-coded flow value class may remain')
  })

  test('it reuses the EXISTING value-class vocabulary — no new schema', () => {
    // `unavailable` is already in the published CHECK constraint, so nothing
    // about the database changes.
    assert.match(MIGRATION, /value_class\s+text not null check \(value_class in/)
    assert.match(MIGRATION, /'nmi_calculated','unavailable','not_reproducible'/)
    assert.equal(flowValueClass({ state: 'unreadable', value: null, detail: '#REF!' }), 'unavailable')
  })

  test('the classifier is pure — no clock, no I/O, no environment', () => {
    const pure = codeOf(HIERARCHY)
    assert.ok(!/Date\.now\(\)|new Date\(\)|process\.env|readFileSync|createClient/.test(pure))
  })

  test('§ 5 · the contract documents blank, numeric and error separately', () => {
    // Compared with the markdown emphasis stripped and whitespace collapsed, so
    // the assertion pins the STATEMENT rather than its formatting or its
    // line wrapping.
    const plain = DOC.replace(/\*/g, '').replace(/\s+/g, ' ')
    assert.match(plain, /sparse event row/i)
    assert.match(plain, /malformed or errored cell does not mean zero/i)
    assert.match(plain, /only a genuine blank receives zero semantics/i)
    // The narrow repair: the old over-general sentence must not stand unqualified.
    assert.ok(!/An empty flow cell means zero flow, not missing data/.test(plain))
    assert.match(plain, /A genuinely empty flow cell means zero flow/)
  })
})
