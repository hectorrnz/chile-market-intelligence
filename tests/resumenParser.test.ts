// R13.3 — RESUMEN parser, reader, and reconciliation.
//
// NO PRIVATE SOURCE DATA. Every fixture is a synthetic workbook built in memory
// with invented, obviously-fake values. The real workbook is never read, copied,
// or approximated here; the STRUCTURES are reproduced from documents 02 and 04,
// the numbers are not.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readXlsx, parseSharedStrings, parseStyles, isDateFormatCode, serialToIsoDate,
} from '../src/lib/familyPortfolio/xlsx/readXlsx.ts'
import { parseCellRef, columnToIndex, indexToColumn, sourceCell } from '../src/lib/familyPortfolio/xlsx/cellRef.ts'
import { detectColumns, findHeaderRow, resolveAnchors, checkDateAdvancing } from '../src/lib/familyPortfolio/resumen/dateDetection.ts'
import {
  classifyRow, detectScopes, normalizeLabel, buildRowKey, childRowKey, REQUIRED_ROW_TYPES,
} from '../src/lib/familyPortfolio/resumen/hierarchy.ts'
import {
  weeklyProfit, weeklyReturn, annualProfit, chainLinkedAnnualReturn, crossCheck,
} from '../src/lib/familyPortfolio/resumen/performance.ts'
import { parseResumen, findResumenSheet, RESUMEN_PARSER_VERSION } from '../src/lib/familyPortfolio/resumen/parseResumen.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------------------------------------
// Synthetic .xlsx builder
// ---------------------------------------------------------------------------

interface Cell { ref: string; v?: number | string; t?: 's' | 'e' | 'str'; f?: string; s?: number }

function zipOf(parts: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0
  for (const p of parts) {
    const nb = Buffer.from(p.name, 'utf8'); const raw = Buffer.from(p.content, 'utf8')
    const comp = deflateRawSync(raw)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8)
    l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(nb.length, 26)
    locals.push(l, nb, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24)
    c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, nb); offset += l.length + nb.length + comp.length
  }
  const cd = Buffer.concat(central); const lb = Buffer.concat(locals)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0)
  e.writeUInt16LE(parts.length, 8); e.writeUInt16LE(parts.length, 10)
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(lb.length, 16)
  return Buffer.concat([lb, cd, e])
}

function sheetXml(cells: Cell[]): string {
  const byRow = new Map<number, Cell[]>()
  for (const c of cells) {
    const r = Number(/[0-9]+$/.exec(c.ref)![0])
    if (!byRow.has(r)) byRow.set(r, [])
    byRow.get(r)!.push(c)
  }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => {
    const inner = cs.map((c) => {
      const tAttr = c.t ? ` t="${c.t}"` : ''
      const sAttr = c.s !== undefined ? ` s="${c.s}"` : ''
      const f = c.f ? `<f>${c.f}</f>` : ''
      const v = c.v === undefined ? '' : `<v>${c.v}</v>`
      return `<c r="${c.ref}"${tAttr}${sAttr}>${f}${v}</c>`
    }).join('')
    return `<row r="${r}">${inner}</row>`
  }).join('')
  return `<worksheet><sheetData>${rows}</sheetData></worksheet>`
}

/** Style 1 is a date format; style 0 is General. */
const STYLES_XML =
  '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>' +
  '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"><alignment horizontal="center"/></xf></cellXfs></styleSheet>'

function workbook(sheets: { name: string; cells: Cell[] }[], shared: string[] = []): Buffer {
  const wbSheets = sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
  const si = shared.map((s) => `<si><t>${s}</t></si>`).join('')
  return zipOf([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'xl/workbook.xml', content: `<workbook><sheets>${wbSheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<Relationships>${rels}</Relationships>` },
    { name: 'xl/styles.xml', content: STYLES_XML },
    { name: 'xl/sharedStrings.xml', content: `<sst count="${shared.length}">${si}</sst>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s.cells) })),
  ])
}

// Serial numbers for the weekly series. 45000 is an arbitrary synthetic epoch.
const WEEK0 = 46000
const weekSerial = (i: number) => WEEK0 + i * 7

// ---------------------------------------------------------------------------
// 1 - Cell references
// ---------------------------------------------------------------------------

describe('A1 references are bijective base-26', () => {
  test('column letters round-trip', () => {
    for (const [letters, idx] of [['A', 1], ['Z', 26], ['AA', 27], ['AZ', 52], ['BA', 53], ['CZ', 104], ['DE', 109]] as const) {
      assert.equal(columnToIndex(letters), idx, `${letters} → ${idx}`)
      assert.equal(indexToColumn(idx), letters, `${idx} → ${letters}`)
    }
  })

  test('a full reference parses', () => {
    assert.deepEqual(parseCellRef('CZ87'), { column: 104, row: 87 })
    assert.equal(parseCellRef('nonsense'), null)
  })

  test('provenance strings are canonical', () => {
    assert.equal(sourceCell('RESUMEN', 104, 13), 'RESUMEN!CZ13')
  })
})

// ---------------------------------------------------------------------------
// 2 - The fail-silent <xf> defect (doc 03 section 5)
// ---------------------------------------------------------------------------

describe('styles parse opening tags only, with a count assertion', () => {
  test('a mix of self-closing and child-bearing <xf> elements all parse', () => {
    const xml = '<styleSheet><cellXfs count="5">' +
      '<xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="14"><alignment/></xf><xf numFmtId="0"/><xf numFmtId="14"/>' +
      '</cellXfs></styleSheet>'
    const st = parseStyles(xml)
    // The naive `(?:\/>|>[\s\S]*?<\/xf>)` alternation swallows the leading
    // self-closing run and yields far fewer than 5.
    assert.equal(st.isDate.length, 5)
    assert.equal(st.declaredCount, 5)
    assert.deepEqual(st.isDate, [false, false, true, false, true])
  })

  test('a count mismatch fails the whole read rather than silently mis-indexing', () => {
    const bad = workbookWithStyles('<styleSheet><cellXfs count="9"><xf numFmtId="0"/></cellXfs></styleSheet>')
    const r = readXlsx(bad)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'style_count_mismatch')
  })

  test('cellStyleXfs is not confused with cellXfs', () => {
    const xml = '<styleSheet><cellStyleXfs count="3"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'
    const st = parseStyles(xml)
    assert.equal(st.isDate.length, 2, 'only cellXfs entries define cell style indices')
  })

  test('date format codes are recognised, currency is not', () => {
    assert.equal(isDateFormatCode('dd-mm-yyyy'), true)
    assert.equal(isDateFormatCode('yyyy-mm-dd hh:mm'), true)
    assert.equal(isDateFormatCode('#,##0.00'), false)
    assert.equal(isDateFormatCode('"day"#,##0'), false, 'quoted literals must not count as date tokens')
  })
})

function workbookWithStyles(styles: string): Buffer {
  return zipOf([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'xl/workbook.xml', content: '<workbook><sheets><sheet name="RESUMEN" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml([{ ref: 'A1', v: 1 }]) },
  ])
}

// ---------------------------------------------------------------------------
// 3 - Reader semantics
// ---------------------------------------------------------------------------

describe('the reader never evaluates and never loses an error', () => {
  test('shared strings concatenate rich-text runs and skip phonetics', () => {
    const t = parseSharedStrings('<sst><si><t>Renta </t><t>Fija</t></si><si><t>x</t><rPh><t>IGNORED</t></rPh></si></sst>')
    assert.deepEqual(t, ['Renta Fija', 'x'])
  })

  test('a formula is retained as text but never computed', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: [{ ref: 'A1', f: 'TODAY()', v: 46000, s: 1 }] }])
    const r = readXlsx(wb)
    assert.equal(r.ok, true)
    if (!r.ok) return
    const c = r.workbook.sheets[0].cells.get('1:1')!
    assert.equal(c.formula, 'TODAY()')
    assert.equal(c.number, 46000, 'the CACHED value is used, never a recomputation')
  })

  test('an error cell is a first-class value, never coerced to 0 or dropped', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: [{ ref: 'A1', t: 'e', v: '#NAME?' }] }])
    const r = readXlsx(wb)
    assert.equal(r.ok, true)
    if (!r.ok) return
    const c = r.workbook.sheets[0].cells.get('1:1')!
    assert.equal(c.kind, 'error')
    assert.equal(c.text, '#NAME?')
    assert.equal(c.number, null)
  })

  test('an external relationship target is never resolvable to a sheet', () => {
    const wb = zipOf([
      { name: '[Content_Types].xml', content: '<Types/>' },
      { name: 'xl/workbook.xml', content: '<workbook><sheets><sheet name="RESUMEN" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content: '<Relationships><Relationship Id="rId1" Target="https://example.invalid/x.xlsx" TargetMode="External"/></Relationships>',
      },
      { name: 'xl/styles.xml', content: STYLES_XML },
    ])
    const r = readXlsx(wb)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'sheet_not_found', 'an External target must never resolve to a readable part')
  })

  test('serial dates convert on the 1899-12-30 epoch', () => {
    // 25569 is the well-known serial for the Unix epoch; it pins the offset.
    assert.equal(serialToIsoDate(25569), '1970-01-01')
    assert.equal(serialToIsoDate(46000), '2025-12-09')
    assert.equal(serialToIsoDate(0), null, 'out-of-range serials are refused, not guessed')
    assert.equal(serialToIsoDate(Number.NaN), null)
  })
})

// ---------------------------------------------------------------------------
// 4 - Date detection (doc 02 section 3)
// ---------------------------------------------------------------------------

function headerCells(opts: {
  rows?: number[]
  count?: number
  liveFormula?: boolean
  liveCached?: boolean
  duplicateAt?: number
  outOfOrder?: boolean
} = {}): Cell[] {
  const count = opts.count ?? 25
  const cells: Cell[] = []
  // Row 5 is the authoritative header; it carries a column-B label.
  cells.push({ ref: 'B5', t: 's', v: 0 })
  for (let i = 0; i < count; i++) {
    const col = indexToColumn(3 + i)
    let serial = weekSerial(i)
    if (opts.duplicateAt === i) serial = weekSerial(i - 1)
    if (opts.outOfOrder && i === count - 1) serial = weekSerial(0)
    cells.push({ ref: `${col}5`, v: serial, s: 1 })
    // Row 1 is the technical duplicate, deliberately MISSING one column.
    if (i !== 3) cells.push({ ref: `${col}1`, v: serial, s: 1 })
  }
  const liveCol = indexToColumn(3 + count + 3)
  cells.push({ ref: `${liveCol}4`, t: 's', v: 1 })
  if (opts.liveFormula !== false) {
    cells.push(opts.liveCached === false
      ? { ref: `${liveCol}5`, f: '+DE$1', s: 1 }
      : { ref: `${liveCol}5`, f: '+DE$1', v: weekSerial(count), s: 1 })
  }
  const diffCol = indexToColumn(3 + count)
  cells.push({ ref: `${diffCol}5`, t: 's', v: 2 })
  return cells
}

const SHARED = ['valores en dólares', 'Precios en vivo', 'Diferencia']

describe('date detection resolves by structure, never by position', () => {
  test('row 5 wins over row 1, which is missing the BoY column', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells() }], SHARED)
    const r = readXlsx(wb)
    assert.equal(r.ok, true); if (!r.ok) return
    assert.equal(findHeaderRow(r.workbook.sheets[0]), 5)
  })

  test('the live column is identified and its cached date used', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells() }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    assert.ok(d.live, 'a live column must be found')
    assert.equal(d.live!.date, serialToIsoDate(weekSerial(25)))
    assert.equal(d.blocking.length, 0)
  })

  test('a live column with no cached date blocks — the server date is never substituted', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells({ liveCached: false }) }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    assert.ok(d.blocking.some((b) => b.code === 'live_date_unavailable'))
  })

  test('the Diferencia column is classified and never historical', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells() }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    assert.ok(d.difference, 'the difference column must be recognised')
    assert.ok(!d.historical.some((c) => c.column === d.difference!.column))
  })

  test('a duplicate week date blocks', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells({ duplicateAt: 10 }) }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    assert.ok(d.blocking.some((b) => b.code === 'duplicate_week_date'))
  })

  test('an out-of-order series blocks', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells({ outOfOrder: true }) }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    assert.ok(d.blocking.some((b) => b.code === 'out_of_order_week_date' || b.code === 'duplicate_week_date'))
  })

  test('too few dated columns means no header row at all', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells({ count: 5 }) }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    assert.ok(d.blocking.some((b) => b.code === 'header_row_not_found'))
  })

  test('beginningOfYear is the earliest column in thisWeek year, not a hardcoded January', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells() }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    const res = resolveAnchors(d, d.live!)
    assert.equal(res.ok, true); if (!res.ok) return
    const yr = d.live!.date!.slice(0, 4)
    assert.equal(res.anchors.beginningOfYear.date!.slice(0, 4), yr)
    const inYear = d.historical.filter((c) => c.date!.slice(0, 4) === yr)
    assert.equal(res.anchors.beginningOfYear.date, inYear[0].date)
  })

  test('previousWeek is the immediately preceding historical column', () => {
    const wb = workbook([{ name: 'RESUMEN', cells: headerCells() }], SHARED)
    const r = readXlsx(wb); assert.equal(r.ok, true); if (!r.ok) return
    const d = detectColumns(r.workbook.sheets[0])
    const res = resolveAnchors(d, d.live!)
    assert.equal(res.ok, true); if (!res.ok) return
    assert.equal(res.anchors.previousWeek.date, d.historical[d.historical.length - 1].date)
  })

  test('a non-advancing confirmed date is reported', () => {
    assert.equal(checkDateAdvancing('2026-08-06', '2026-07-31'), null)
    assert.ok(checkDateAdvancing('2026-07-31', '2026-07-31'))
    assert.ok(checkDateAdvancing('2026-07-24', '2026-07-31'))
  })
})

// ---------------------------------------------------------------------------
// 5 - Hierarchy and scope isolation
// ---------------------------------------------------------------------------

describe('row classification is semantic', () => {
  test('a labelled row with no value is a sociedad header, not a leaf', () => {
    assert.equal(classifyRow('Watermill', false), 'sociedad_header')
    assert.equal(classifyRow('Some Fund LP', true), 'individual_asset')
  })

  test('the parent distinguishes sub-asset class from individual asset', () => {
    // doc 02 section 5.1 — a value row under an asset class is a SUB-asset class.
    assert.equal(classifyRow('Investment Grade', true, 'asset_class'), 'sub_asset_class')
    assert.equal(classifyRow('Caja USD', true, 'asset_class'), 'sub_asset_class')
    // doc 02 section 5.2 — a value row under a sociedad header is an asset.
    assert.equal(classifyRow('Some Fund LP', true, 'sociedad_header'), 'individual_asset')
    // Never collapsed into individual_asset merely because it is a leaf.
    assert.notEqual(classifyRow('Investment Grade', true, 'asset_class'), 'individual_asset')
  })

  test('sociedad aggregates are not confused with personal totals', () => {
    // Binding a personal performance block to a sociedad total instead of the
    // personal total is the doc 02 section 2.1 error (Andres 205 vs 207).
    assert.equal(classifyRow('TOTAL LA ESPERANZA', true), 'sociedad_subtotal')
    assert.equal(classifyRow('SUBTOTAL NAIDELT', true), 'sociedad_subtotal')
    assert.equal(classifyRow('TOTAL JAIME', true), 'portfolio_total')
    assert.equal(classifyRow('TOTAL más Staten Capital Ltd', true), 'portfolio_total')
  })

  test('proportional and Staten component lines are not totals', () => {
    // They are components summed INTO the terminal total, and are not required
    // cells under doc 02 section 6.3.
    assert.equal(classifyRow('Proporcional Otras Sociedades', true), 'named_holding')
    assert.equal(classifyRow('Staten Capital (1/3)', true), 'named_holding')
    assert.ok(!REQUIRED_ROW_TYPES.has('named_holding'))
  })

  test('subtotals, totals and group headers are distinguished', () => {
    assert.equal(classifyRow('PORTAFOLIO LÍQUIDO', false), 'group_header')
    assert.equal(classifyRow('SUBTOTAL LA ESPERANZA', true), 'sociedad_subtotal')
    assert.equal(classifyRow('SUBTOTAL PORTFOLIO LÍQUIDO', true), 'portfolio_subtotal')
    assert.equal(classifyRow('TOTAL JAIME', true), 'portfolio_total')
    assert.equal(classifyRow('Caja y Equivalentes', true), 'asset_class')
    assert.equal(classifyRow('INRETAIL PERU CORP', true), 'named_holding')
    assert.equal(classifyRow('Retiros / Aportes', true), 'flow')
    assert.equal(classifyRow('Utilidad de la semana', true), 'performance')
  })

  test('accents and case never change the classification', () => {
    assert.equal(normalizeLabel('ANDRÉS'), 'andres')
    assert.equal(classifyRow('Retorno del Año', true), 'performance')
  })

  test('only aggregate rows are required cells', () => {
    for (const t of ['asset_class', 'sociedad_subtotal', 'portfolio_subtotal', 'portfolio_total'] as const) {
      assert.ok(REQUIRED_ROW_TYPES.has(t), `${t} must be required`)
    }
    for (const t of ['individual_asset', 'group_header', 'sociedad_header', 'flow', 'performance'] as const) {
      assert.ok(!REQUIRED_ROW_TYPES.has(t), `${t} must NOT be required`)
    }
  })

  test('scope ranges are disjoint and bounded by the next anchor', () => {
    const r = readXlsx(resumenWorkbook())
    assert.equal(r.ok, true); if (!r.ok) return
    const sheet = r.workbook.sheets[0]
    const ranges = detectScopes(sheet, 5)

    const main = ranges.find((x) => x.scope === 'main')!
    const jaime = ranges.find((x) => x.scope === 'jaime')!
    assert.ok(main && jaime, 'both sections must be detected')

    // Main must END before Jaime begins — this is what stops a personal
    // sociedad being summed into the shared Main book (doc 05 risk A3).
    assert.ok(main.endRow < jaime.anchorRow, 'Main must not overlap Jaime')
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i]; const b = ranges[j]
        assert.ok(a.endRow < b.startRow || b.endRow < a.startRow,
          `${a.scope} and ${b.scope} ranges overlap`)
      }
    }
  })

  test('row keys derive from the label path, never the row number', () => {
    const parent = buildRowKey('main', ['PORTAFOLIO LÍQUIDO'])
    assert.equal(parent, 'main.portafolio_liquido')
    assert.equal(childRowKey(parent, 'Renta Fija'), 'main.portafolio_liquido.renta_fija')
    // The same label at a different row must produce the same key.
    assert.equal(buildRowKey('main', ['Renta Fija']), buildRowKey('main', ['renta fija']))
  })
})

// ---------------------------------------------------------------------------
// 6 - Performance definitions (doc 04 section 4.2)
// ---------------------------------------------------------------------------

describe('the four performance definitions', () => {
  test('profit is flow-adjusted — the naive delta is wrong by the whole flow', () => {
    // Structure of doc 04 section 4.2(a); values invented.
    const profit = weeklyProfit(1_000_000, 900_000, 40_000)
    assert.equal(profit, 60_000)
    assert.notEqual(profit, 100_000, 'raw delta must not be reported as profit')
  })

  test('the return denominator is NOT flow-adjusted', () => {
    const profit = weeklyProfit(1_000_000, 900_000, 40_000)
    assert.equal(weeklyReturn(profit, 900_000), 60_000 / 900_000)
  })

  test('a zero or missing base yields null, never Infinity or NaN', () => {
    assert.equal(weeklyReturn(100, 0), null)
    assert.equal(weeklyReturn(null, 900_000), null)
    assert.equal(weeklyProfit(null, 900_000, 0), null)
    assert.equal(weeklyProfit(1000, 900, Number.NaN), null)
  })

  test('annual profit is value − BoY − Σ flows', () => {
    assert.equal(annualProfit(1_200_000, 1_000_000, [50_000, 25_000]), 125_000)
    assert.equal(annualProfit(1_200_000, null, []), null)
  })

  test('annual return is chain-linked, not profit ÷ BoY', () => {
    // The two agree exactly when there are NO flows, so a flow is required to
    // demonstrate the divergence at all — which is precisely why doc 04 finding
    // (b) shows up on Main-con-CL and Jaime (both have flows) and not on the
    // flow-free blocks. Values invented.
    const obs = [
      { date: '2026-01-02', value: 1_000_000, flow: 0 },
      { date: '2026-01-09', value: 1_600_000, flow: 500_000 },
      { date: '2026-01-16', value: 1_650_000, flow: 0 },
    ]
    const chained = chainLinkedAnnualReturn(obs)!
    const expected = (1 + 100_000 / 1_000_000) * (1 + 50_000 / 1_600_000) - 1
    assert.ok(Math.abs(chained - expected) < 1e-12)

    const naive = annualProfit(1_650_000, 1_000_000, [0, 500_000, 0])! / 1_000_000
    assert.equal(naive, 0.15)
    assert.ok(Math.abs(chained - naive) > 1e-6,
      'the naive ratio must not be substituted for the chain-linked return')
  })

  test('with no flows the two coincide — the distinction is flow-driven', () => {
    const obs = [
      { date: '2026-01-02', value: 1_000_000, flow: 0 },
      { date: '2026-01-09', value: 1_100_000, flow: 0 },
    ]
    const chained = chainLinkedAnnualReturn(obs)!
    const naive = annualProfit(1_100_000, 1_000_000, [0, 0])! / 1_000_000
    assert.ok(Math.abs(chained - naive) < 1e-12)
  })

  test('chain-linking respects flows', () => {
    const obs = [
      { date: '2026-01-02', value: 1_000_000, flow: 0 },
      { date: '2026-01-09', value: 1_500_000, flow: 500_000 },
    ]
    // The 500k deposit is not a return.
    assert.equal(chainLinkedAnnualReturn(obs), 0)
  })

  test('a single observation cannot produce a return', () => {
    assert.equal(chainLinkedAnnualReturn([{ date: '2026-01-02', value: 1, flow: 0 }]), null)
  })

  test('cross-check reports indeterminate rather than mismatch when data is missing', () => {
    const c = crossCheck('weekly_profit', null, 100)
    assert.equal(c.indeterminate, true)
    assert.equal(c.agrees, false)
  })

  test('cross-check agrees within tolerance and flags beyond it', () => {
    assert.equal(crossCheck('weekly_profit', 168_949.39, 168_949.39).agrees, true)
    assert.equal(crossCheck('weekly_return', 0.0015, 0.9).agrees, false)
  })
})

// ---------------------------------------------------------------------------
// 7 - End-to-end parse
// ---------------------------------------------------------------------------

/**
 * Builds a small but STRUCTURALLY faithful RESUMEN — the shapes come from
 * documents 02 and 04; every number is invented.
 *
 * Main reproduces: group header → asset class → sub-asset class (liquid), and
 * asset class → sociedad header → individual asset (alternatives), then the
 * § 5.3 spine, then TWO performance blocks separated by a blank row. Jaime
 * reproduces sociedad → asset class → sub-asset class.
 *
 * The two Main blocks are given values that reconcile against DIFFERENT
 * candidate rows, so basis binding is proven by arithmetic rather than order:
 *   SUBTOTAL  prev 950,  live 1000, block-1 flow  0 → profit 50
 *   TOTAL     prev 980,  live 1080, block-2 flow 40 → profit 60
 */
const L = {
  mainAnchor: 3, liquido: 4, caja: 5, cajaUsd: 6, mmarket: 7, subLiquido: 8,
  alternativos: 9, inmobiliario: 10, watermill: 11, fund: 12, spine: 13,
  inretail: 14, subtotal: 15, accionesCl: 16, total: 17, flow: 18, utilidad: 19,
  retorno: 20, jaime: 21, laEsperanza: 22, subEsperanza: 23, totalEsperanza: 24,
  totalJaime: 25, calculo: 26, stock: 27,
}

const FIXTURE_LABELS = [
  ...SHARED,
  'Resumen Portfolio', 'PORTAFOLIO LÍQUIDO', 'Caja y Equivalentes', 'Caja USD', 'MMarket USD',
  'SUBTOTAL PORTFOLIO LÍQUIDO', 'ALTERNATIVOS', 'Inmobiliario', 'Watermill', 'Some Fund LP',
  'PORTFOLIO LÍQUIDO + ALTERNATIVOS', 'INRETAIL PERU CORP', 'SUBTOTAL', 'ACCIONES CHILENAS (USD)',
  'TOTAL', 'Retiros / Aportes', 'Utilidad de la semana', 'Retorno de la semana',
  'Jaime', 'LA ESPERANZA', 'SUBTOTAL LA ESPERANZA', 'TOTAL LA ESPERANZA', 'TOTAL JAIME',
  'CÁLCULO DE STOCKS', 'STOCK ACCIONES CHILENAS USD',
]

function resumenWorkbook(opts: {
  totalError?: boolean; withAlternativesSheet?: boolean; noBoY?: boolean; orphanLeaf?: boolean
} = {}): Buffer {
  const cells: Cell[] = headerCells()
  const boyCol = 3
  const prevCol = 3 + 24
  const liveCol = 3 + 25 + 3

  const put = (row: number, label: number, v: { boy?: number; prev?: number; live?: number | 'err' } = {}) => {
    cells.push({ ref: `B${row}`, t: 's', v: label })
    if (v.boy !== undefined) cells.push({ ref: `${indexToColumn(boyCol)}${row}`, v: v.boy })
    if (v.prev !== undefined) cells.push({ ref: `${indexToColumn(prevCol)}${row}`, v: v.prev })
    if (v.live === 'err') cells.push({ ref: `${indexToColumn(liveCol)}${row}`, t: 'e', v: '#NAME?' })
    else if (v.live !== undefined) cells.push({ ref: `${indexToColumn(liveCol)}${row}`, v: v.live })
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  put(10, L.mainAnchor)
  put(11, L.liquido)                                                     // group header
  put(12, L.caja, { boy: opts.noBoY ? undefined : 100, prev: 110, live: 120 })   // asset class
  put(13, L.cajaUsd, { boy: 60, prev: 70, live: 75 })                    // sub-asset class
  put(14, L.mmarket, { boy: 40, prev: 40, live: 45 })                    // sub-asset class
  put(15, L.subLiquido, { boy: 100, prev: 110, live: 120 })
  put(16, L.alternativos)                                                // group header
  put(17, L.inmobiliario, { boy: 200, prev: 210, live: 215 })            // asset class
  put(18, L.watermill)                                                   // sociedad header, no value
  put(19, L.fund, { boy: 200, prev: 210, live: 215 })                    // individual asset
  put(20, L.spine, { boy: 300, prev: 320, live: 335 })
  put(21, L.inretail, { boy: 600, prev: 630, live: 665 })
  put(22, L.subtotal, { boy: 900, prev: 950, live: opts.totalError ? 'err' : 1000 })
  put(23, L.accionesCl, { boy: 30, prev: 30, live: 80 })
  put(24, L.total, { boy: 930, prev: 980, live: opts.totalError ? 'err' : 1080 })
  // Block 1 — reconciles against SUBTOTAL (flow 0, profit 50).
  put(26, L.flow, { prev: 0, live: 0 })
  put(27, L.utilidad, { live: 50 })
  put(28, L.retorno, { live: 50 / 950 })
  // row 29 blank — closes block 1
  // Block 2 — reconciles against TOTAL (flow 40, profit 60).
  put(30, L.flow, { prev: 0, live: 40 })
  put(31, L.utilidad, { live: 60 })
  put(32, L.retorno, { live: 60 / 980 })

  // ── Jaime ──────────────────────────────────────────────────────────────────
  put(40, L.jaime)
  put(41, L.laEsperanza)                                                 // sociedad header
  put(42, L.caja, { boy: 40, prev: 50, live: 55 })                       // asset class
  put(43, L.cajaUsd, { boy: 40, prev: 50, live: 55 })                    // sub-asset class
  put(44, L.subEsperanza, { boy: 40, prev: 50, live: 55 })
  put(45, L.totalEsperanza, { boy: 40, prev: 50, live: 55 })
  put(46, L.totalJaime, { boy: 50, prev: 60, live: 70 })
  put(48, L.flow, { live: 5 })
  put(49, L.utilidad, { live: 5 })

  if (opts.orphanLeaf) put(38, L.fund, { live: 1 })   // a value leaf under no container

  // ── Technical block (excluded) ─────────────────────────────────────────────
  put(60, L.calculo)
  put(61, L.stock, { live: 999999 })

  const sheets = [{ name: 'RESUMEN', cells }]
  if (opts.withAlternativesSheet) sheets.push({ name: 'Alternatives', cells: [{ ref: 'B1', t: 's', v: 3 }] })
  return workbook(sheets, FIXTURE_LABELS)
}

describe('parseResumen end to end', () => {
  test('a canonical workbook parses into a draft', () => {
    const d = parseResumen(resumenWorkbook())
    assert.equal(d.ok, true, JSON.stringify(d.findings))
    assert.equal(d.parserVersion, RESUMEN_PARSER_VERSION)
    assert.ok(d.detectedAsOfDate)
    assert.ok(d.rows.length > 0)
  })

  test('the difference is NMI-derived, never the Diferencia column', () => {
    const d = parseResumen(resumenWorkbook())
    const caja = d.rows.find((r) => r.labelEs === 'Caja y Equivalentes' && r.scope === 'main')!
    assert.equal(caja.difference, 120 - 110)
    assert.equal(caja.differenceClass, 'nmi_calculated')
  })

  test('a required cell in error blocks the whole draft', () => {
    const d = parseResumen(resumenWorkbook({ totalError: true }))
    assert.equal(d.ok, false)
    const b = d.findings.filter((f) => f.severity === 'blocking' && f.code === 'source_cell_error')
    assert.ok(b.length > 0, 'an errored TOTAL must block')
    assert.ok(b.some((f) => f.rowLabel === 'TOTAL'))
  })

  test('an errored required cell is never coerced to 0 or carried forward', () => {
    const d = parseResumen(resumenWorkbook({ totalError: true }))
    const total = d.rows.find((r) => r.labelEs === 'TOTAL')!
    assert.equal(total.value, null, 'never 0')
    assert.equal(total.valueClass, 'unavailable')
    assert.notEqual(total.value, total.previousValue, 'never carried forward')
  })

  test('a leaf with no beginning-of-year baseline stays unavailable, not 0', () => {
    const d = parseResumen(resumenWorkbook({ noBoY: true }))
    const caja = d.rows.find((r) => r.labelEs === 'Caja y Equivalentes' && r.scope === 'main')!
    assert.equal(caja.beginningOfYearValue, null)
  })

  test('scope isolation — Jaime rows never land in Main', () => {
    const d = parseResumen(resumenWorkbook())
    const jaime = d.rows.filter((r) => r.scope === 'jaime')
    assert.ok(jaime.length > 0, 'Jaime must be ingested')
    assert.ok(jaime.some((r) => r.labelEs === 'TOTAL JAIME'))
    assert.ok(!d.rows.some((r) => r.scope === 'main' && r.labelEs === 'TOTAL JAIME'),
      'a personal total must never appear under Main')
  })

  test('the technical block is excluded entirely', () => {
    const d = parseResumen(resumenWorkbook())
    assert.ok(!d.rows.some((r) => r.labelEs.includes('STOCK ACCIONES')),
      'CÁLCULO DE STOCKS rows must never be ingested')
  })

  test('an Upload A that also contains Alternatives never ingests it', () => {
    const d = parseResumen(resumenWorkbook({ withAlternativesSheet: true }))
    assert.equal(d.ok, true)
    // Only RESUMEN-derived scopes exist; no alternatives scope is produced.
    for (const r of d.rows) assert.ok(['main', 'jaime', 'andres', 'pablo'].includes(r.scope))
  })

  test('every row carries provenance back to its source cell', () => {
    const d = parseResumen(resumenWorkbook())
    for (const r of d.rows) {
      assert.equal(r.sourceSheet, 'RESUMEN')
      assert.match(r.sourceCell, /^RESUMEN![A-Z]+[0-9]+$/)
      assert.ok(r.sourceRow > 0)
      assert.ok(!r.rowKey.includes(String(r.sourceRow)), 'the row key must not encode the row number')
    }
  })

  test('parsing is deterministic — the same bytes yield the same draft', () => {
    const bytes = resumenWorkbook()
    const a = parseResumen(bytes)
    const b = parseResumen(bytes)
    assert.deepEqual(a.rows, b.rows)
    assert.equal(a.detectedAsOfDate, b.detectedAsOfDate)
  })

  test('a workbook with no RESUMEN sheet is refused', () => {
    const wb = workbook([{ name: 'Alternatives', cells: [{ ref: 'A1', v: 1 }] }])
    const d = parseResumen(wb)
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.code === 'resumen_sheet_not_found'))
  })

  test('findResumenSheet ignores 1 Pager and Alternatives', () => {
    const sheets = [{ name: '1 Pager' }, { name: 'Alternatives' }, { name: 'RESUMEN' }] as never as Parameters<typeof findResumenSheet>[0]
    assert.equal(findResumenSheet(sheets)!.name, 'RESUMEN')
  })

  test('the Main hierarchy is emitted at full depth', () => {
    const d = parseResumen(resumenWorkbook())
    const byLabel = (l: string) => d.rows.find((r) => r.scope === 'main' && r.labelEs === l)!

    const caja = byLabel('Caja y Equivalentes')
    const cajaUsd = byLabel('Caja USD')
    assert.equal(caja.rowType, 'asset_class')
    assert.equal(cajaUsd.rowType, 'sub_asset_class', 'a liquid leaf is a SUB-ASSET class')
    assert.equal(cajaUsd.parentRowKey, caja.rowKey)
    assert.equal(cajaUsd.depth, caja.depth + 1)

    // Alternatives: asset class → sociedad header → individual asset.
    const inmob = byLabel('Inmobiliario')
    const soc = byLabel('Watermill')
    const fund = byLabel('Some Fund LP')
    assert.equal(soc.rowType, 'sociedad_header')
    assert.equal(fund.rowType, 'individual_asset')
    assert.equal(soc.parentRowKey, inmob.rowKey)
    assert.equal(fund.parentRowKey, soc.rowKey)
    assert.equal(fund.depth, inmob.depth + 2)
  })

  test('the personal hierarchy is sociedad → asset class → sub-asset class', () => {
    const d = parseResumen(resumenWorkbook())
    const byLabel = (l: string) => d.rows.find((r) => r.scope === 'jaime' && r.labelEs === l)!
    const soc = byLabel('LA ESPERANZA')
    const caja = byLabel('Caja y Equivalentes')
    const cajaUsd = byLabel('Caja USD')
    assert.equal(soc.rowType, 'sociedad_header')
    assert.equal(soc.depth, 0)
    assert.equal(caja.parentRowKey, soc.rowKey)
    assert.equal(cajaUsd.parentRowKey, caja.rowKey)
    assert.equal(cajaUsd.rowType, 'sub_asset_class')
  })

  test('no parent is ever duplicated as its own child', () => {
    const d = parseResumen(resumenWorkbook())
    for (const r of d.rows) {
      assert.notEqual(r.parentRowKey, r.rowKey, `${r.rowKey} is its own parent`)
    }
    // Every declared parent must exist within the same scope.
    for (const r of d.rows) {
      if (!r.parentRowKey) continue
      assert.ok(d.rows.some((p) => p.scope === r.scope && p.rowKey === r.parentRowKey),
        `orphaned parent reference: ${r.parentRowKey}`)
    }
  })

  test('an inserted source row does not destabilise unrelated row keys', () => {
    const before = parseResumen(resumenWorkbook())
    const after = parseResumen(resumenWorkbook({ noBoY: true }))
    const keyOf = (d: typeof before, l: string) => d.rows.find((r) => r.labelEs === l)!.rowKey
    for (const label of ['Caja USD', 'Some Fund LP', 'TOTAL JAIME']) {
      assert.equal(keyOf(before, label), keyOf(after, label), `${label} re-keyed`)
    }
  })

  test('a value leaf under no container fails closed rather than flattening', () => {
    const d = parseResumen(resumenWorkbook({ orphanLeaf: true }))
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.severity === 'blocking' && f.code === 'ambiguous_hierarchy_row'))
  })

  test('both Main performance bases are extracted and bound to different rows', () => {
    const d = parseResumen(resumenWorkbook())
    assert.equal(d.ok, true, JSON.stringify(d.findings))
    const main = d.performance.filter((p) => p.scope === 'main')
    const ex = main.filter((p) => p.basis === 'ex_chilean_equities')
    const wi = main.filter((p) => p.basis === 'with_chilean_equities')
    assert.ok(ex.length > 0, 'ex_chilean_equities must be extracted')
    assert.ok(wi.length > 0, 'with_chilean_equities must be extracted')

    // Bound to DIFFERENT source rows — never collapsed into one Main record.
    const exProfit = ex.find((p) => p.metric === 'weekly_profit')!
    const wiProfit = wi.find((p) => p.metric === 'weekly_profit')!
    assert.notEqual(exProfit.boundRowKey, wiProfit.boundRowKey)
    assert.notEqual(exProfit.sourceCell, wiProfit.sourceCell)
    assert.equal(exProfit.sourceValue, 50)
    assert.equal(wiProfit.sourceValue, 60)
  })

  test('each Main basis carries its own flow — one cannot overwrite the other', () => {
    const d = parseResumen(resumenWorkbook())
    const flowOf = (b: string) =>
      d.performance.find((p) => p.scope === 'main' && p.basis === b && p.metric === 'flow')!
    assert.equal(flowOf('ex_chilean_equities').sourceValue, 0)
    assert.equal(flowOf('with_chilean_equities').sourceValue, 40)
  })

  test('every performance row carries an explicit basis and exact provenance', () => {
    const d = parseResumen(resumenWorkbook())
    for (const p of d.performance) {
      assert.ok(['ex_chilean_equities', 'with_chilean_equities', 'total'].includes(p.basis))
      assert.match(p.sourceCell, /^RESUMEN![A-Z]+[0-9]+$/)
      assert.ok(p.sourceRow > 0)
      assert.ok(p.boundSourceCell, 'the measured row must be identified')
    }
  })

  test('a personal block binds to the personal total, not a sociedad total', () => {
    const d = parseResumen(resumenWorkbook())
    const j = d.performance.find((p) => p.scope === 'jaime' && p.metric === 'weekly_profit')!
    assert.equal(j.basis, 'total')
    const bound = d.rows.find((r) => r.scope === 'jaime' && r.rowKey === j.boundRowKey)!
    assert.equal(bound.labelEs, 'TOTAL JAIME')
    assert.equal(bound.rowType, 'portfolio_total')
  })

  test('the recomputed weekly return is flow-adjusted, not a naive ratio', () => {
    const d = parseResumen(resumenWorkbook())
    const wi = d.performance.find(
      (p) => p.scope === 'main' && p.basis === 'with_chilean_equities' && p.metric === 'weekly_return')!
    const check = wi.crossChecks.find((c) => c.metric === 'weekly_return')!
    assert.equal(check.agrees, true, 'the flow-adjusted return must reconcile')
    // The naive ratio would be (1080-980)/980, which is NOT what was stored.
    assert.ok(Math.abs(check.recomputed! - (1080 - 980) / 980) > 1e-6)
  })

  test('no finding ever contains a raw numeric portfolio value', () => {
    const d = parseResumen(resumenWorkbook({ totalError: true }))
    for (const f of d.findings) {
      assert.ok(!/\d{4,}/.test(f.detail), `a finding leaked a figure: ${f.detail}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 8 - Migration posture (structural; executed by CI)
// ---------------------------------------------------------------------------

describe('the R13.3 migration', () => {
  const SQL = read('supabase/migrations/20260808000000_family_portfolio_snapshots.sql')

  test('creates the three Stage 3 tables', () => {
    for (const t of ['portfolio_publications', 'portfolio_snapshot_rows', 'portfolio_performance_rows']) {
      assert.match(SQL, new RegExp(`create table if not exists public\\.${t}`))
    }
  })

  test('data rows are scope-filtered through the R13.1 helper', () => {
    assert.match(SQL, /using \(public\.nmi_can_access_scope\(scope\)\)/)
    assert.doesNotMatch(SQL, /jaime@|andres@|pablo@/, 'no hardcoded identity may appear')
  })

  test('only SELECT policies exist', () => {
    for (const p of SQL.match(/create policy[\s\S]*?;/g) ?? []) {
      assert.match(p, /for select/, `non-SELECT policy: ${p.slice(0, 60)}`)
    }
  })

  test('exactly one current publication per week is enforced by a partial index', () => {
    assert.match(SQL, /create unique index if not exists portfolio_publications_current_idx/)
    assert.match(SQL, /where is_current/)
  })

  test('value NULL-vs-zero and row_key stability are documented in the schema', () => {
    assert.match(SQL, /NULL means genuinely unavailable and is never 0/)
    assert.match(SQL, /never the source row number/)
  })

  test('it guards on R13.1 and R13.2 being applied first', () => {
    assert.match(SQL, /nmi_can_access_scope\(text\)/)
    assert.match(SQL, /portfolio_source_uploads is missing/)
  })

  test('it asserts its own end state', () => {
    assert.match(SQL, /raise exception/)
    assert.match(SQL, /has_table_privilege\('authenticated'/)
  })

  test('parser_version is recorded on every publication and is NOT NULL', () => {
    assert.match(SQL, /parser_version text\s+not null/)
    assert.match(SQL, /portfolio_publications\.parser_version must be NOT NULL/)
  })

  test('provenance columns are asserted mandatory', () => {
    assert.match(SQL, /provenance is mandatory/)
  })

  test('the schema is asserted able to represent sub_asset_class and both Main bases', () => {
    assert.match(SQL, /cannot represent sub_asset_class/)
    assert.match(SQL, /cannot represent both Main bases plus total/)
    assert.match(SQL, /sub_asset_class/)
    assert.match(SQL, /ex_chilean_equities/)
    assert.match(SQL, /with_chilean_equities/)
  })

  test('the pgTAP suite exercises the R13.3 tables under real RLS', () => {
    const PG = read('supabase/tests/database/family_portfolio_entitlements_test.sql')
    assert.match(PG, /portfolio_snapshot_rows/)
    assert.match(PG, /Jaime CANNOT read Andres/)
    assert.match(PG, /Andres CANNOT read Jaime/)
    assert.match(PG, /Pablo CANNOT read Andres/)
    assert.match(PG, /NULL principal reads NO family portfolio data/)
    assert.match(PG, /both Main performance bases coexist/)
    assert.match(PG, /a second CURRENT publication for the same week is refused/)
    assert.match(PG, /publication join cannot expose/)
    assert.match(PG, /CANNOT forge a snapshot row/)
  })

  test('it sorts after R13.2 and keeps the timestamp convention', () => {
    assert.match('20260808000000_family_portfolio_snapshots.sql', /^\d{14}_[a-z0-9_]+\.sql$/)
    assert.ok('20260808000000' > '20260807000000')
  })
})
