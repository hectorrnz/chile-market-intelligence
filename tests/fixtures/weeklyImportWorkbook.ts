// R13.8B — a synthetic RESUMEN workbook carrying a FULL frozen history.
//
// NO PRIVATE SOURCE DATA. Every value here is invented and obviously fake (small
// integers derived from a week index). The real workbook is never read, copied
// or approximated; the STRUCTURE is reproduced from documents 02 and 04, the
// numbers are not.
//
// WHY THIS EXISTS SEPARATELY FROM `resumenParser.test.ts`'s fixture. That one
// populates three columns — beginning-of-year, previous week and live — because
// it tests a SINGLE week's parse. R13.8B's whole subject is the frozen history
// grid: the evolution extractor reads a value out of every historical column, so
// a fixture that leaves them empty cannot exercise a catch-up at all.
//
// The live column is deliberately `#NAME?` in every row, exactly as the real
// workbook reads on a machine without the Bloomberg add-in. A fixture whose live
// column parsed cleanly would let a regression that publishes off the live
// column pass unnoticed.

import { deflateRawSync } from 'node:zlib'

import { indexToColumn } from '../../src/lib/familyPortfolio/xlsx/cellRef.ts'

interface Cell { ref: string; v?: number | string; t?: 's' | 'e' | 'str'; f?: string; s?: number }

function zipOf(parts: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const p of parts) {
    const nb = Buffer.from(p.name, 'utf8')
    const raw = Buffer.from(p.content, 'utf8')
    const comp = deflateRawSync(raw)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8)
    l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(nb.length, 26)
    locals.push(l, nb, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24)
    c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, nb)
    offset += l.length + nb.length + comp.length
  }
  const cd = Buffer.concat(central)
  const lb = Buffer.concat(locals)
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

const STYLES_XML =
  '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>' +
  '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"><alignment horizontal="center"/></xf></cellXfs></styleSheet>'

function workbook(sheets: { name: string; cells: Cell[] }[], shared: string[]): Buffer {
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

const SHARED = ['valores en dólares', 'Precios en vivo', 'Diferencia']

const L = {
  mainAnchor: 3, liquido: 4, caja: 5, cajaUsd: 6, mmarket: 7, subLiquido: 8,
  alternativos: 9, inmobiliario: 10, watermill: 11, fund: 12, spine: 13,
  inretail: 14, subtotal: 15, accionesCl: 16, total: 17, flow: 18, utilidad: 19,
  retorno: 20, jaime: 21, laEsperanza: 22, subEsperanza: 23, totalEsperanza: 24,
  totalJaime: 25, calculo: 26, stock: 27,
}

const LABELS = [
  ...SHARED,
  'Resumen Portfolio', 'PORTAFOLIO LÍQUIDO', 'Caja y Equivalentes', 'Caja USD', 'MMarket USD',
  'SUBTOTAL PORTFOLIO LÍQUIDO', 'ALTERNATIVOS', 'Inmobiliario', 'Watermill', 'Some Fund LP',
  'PORTFOLIO LÍQUIDO + ALTERNATIVOS', 'INRETAIL PERU CORP', 'SUBTOTAL', 'ACCIONES CHILENAS (USD)',
  'TOTAL', 'Retiros / Aportes', 'Utilidad de la semana', 'Retorno de la semana',
  'Jaime', 'LA ESPERANZA', 'SUBTOTAL LA ESPERANZA', 'TOTAL LA ESPERANZA', 'TOTAL JAIME',
  'CÁLCULO DE STOCKS', 'STOCK ACCIONES CHILENAS USD',
]

/** 46000 → 2025-12-09. Weeks advance by exactly 7 days. */
export const WEEK0_SERIAL = 46000
export const weekSerial = (i: number) => WEEK0_SERIAL + i * 7

/** The ISO date of frozen week `i`, without going through the parser. */
export function weekIso(i: number): string {
  const ms = Date.UTC(1899, 11, 30) + weekSerial(i) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export interface FixtureOptions {
  /** How many frozen historical week columns the workbook carries. */
  weeks: number
  /**
   * Weeks whose value cells are left EMPTY — the workbook never froze a value
   * there. Used to prove a hole is reported, never invented.
   */
  omitWeeks?: number[]
  /** When false the live column parses cleanly (used only to prove selection). */
  liveErrors?: boolean
}

/**
 * Deterministic, obviously-synthetic value for week `i` of a given row.
 *
 * Small integers, so a real monetary figure could never be mistaken for one of
 * these and none of this file's numbers resembles the private workbook.
 *
 * EACH ROW ADVANCES AT ITS OWN RATE (`row` units per week). That is not
 * decoration: the parser binds a performance block to a row by finding the
 * UNIQUE row whose weekly profit matches the block's stated `Utilidad`. If two
 * rows moved by the same amount the binding would be ambiguous and the series
 * would come back unbound — which is exactly what the parser does rather than
 * guess by label.
 */
export const valueFor = (row: number, i: number) => row * 100 + row * i

/** The rows the three evolution series bind to. */
export const ROW_SUBTOTAL = 22   // main / ex_chilean_equities
export const ROW_TOTAL = 24      // main / with_chilean_equities
export const ROW_JAIME_TOTAL = 46 // jaime / total

/**
 * Builds a RESUMEN workbook with `weeks` frozen historical columns, each
 * carrying a full set of values, plus a live column.
 */
export function weeklyWorkbook(opts: FixtureOptions): Buffer {
  const { weeks, omitWeeks = [], liveErrors = true } = opts
  const cells: Cell[] = []

  // Row 5 is the authoritative header; it carries a column-B label.
  cells.push({ ref: 'B5', t: 's', v: 0 })
  for (let i = 0; i < weeks; i++) {
    const col = indexToColumn(3 + i)
    cells.push({ ref: `${col}5`, v: weekSerial(i), s: 1 })
  }
  const diffCol = indexToColumn(3 + weeks)
  cells.push({ ref: `${diffCol}5`, t: 's', v: 2 })

  // The live column sits past the Diferencia column, headed by its own label and
  // carrying a cached `=TODAY()`-style serial one week beyond the last frozen one.
  const liveIdx = 3 + weeks + 3
  const liveCol = indexToColumn(liveIdx)
  cells.push({ ref: `${liveCol}4`, t: 's', v: 1 })
  cells.push({ ref: `${liveCol}5`, f: '+DE$1', v: weekSerial(weeks), s: 1 })

  const put = (row: number, label: number, opt: { values?: boolean } = {}) => {
    cells.push({ ref: `B${row}`, t: 's', v: label })
    if (opt.values === false) return
    for (let i = 0; i < weeks; i++) {
      if (omitWeeks.includes(i)) continue
      cells.push({ ref: `${indexToColumn(3 + i)}${row}`, v: valueFor(row, i) })
    }
    // The live column: `#NAME?` in every row, as the real workbook reads without
    // the Bloomberg add-in.
    if (liveErrors) cells.push({ ref: `${liveCol}${row}`, t: 'e', v: '#NAME?' })
    else cells.push({ ref: `${liveCol}${row}`, v: valueFor(row, weeks) })
  }

  /**
   * A performance-block row, written ONLY at the publication column.
   *
   * These are not part of the historical grid — the parser reads them for the
   * week being published, reconciles them numerically against a candidate value
   * row, and that reconciliation is what BINDS each evolution series. Writing
   * them across every week would make `Retiros / Aportes` a moving figure and
   * break the profit arithmetic the binding depends on.
   */
  const putPerf = (row: number, label: number, value: number) => {
    cells.push({ ref: `B${row}`, t: 's', v: label })
    cells.push({ ref: `${indexToColumn(3 + weeks - 1)}${row}`, v: value })
  }

  // The publication column is the last frozen week; the previous week is the one
  // before it. Weekly profit is `value(pub) - value(prev) - flow`, and with a
  // flow of zero that is exactly the row's own per-week increment.
  const pub = weeks - 1
  const prev = weeks - 2
  const profitOf = (row: number) => valueFor(row, pub) - valueFor(row, prev)

  // ── Main ─────────────────────────────────────────────────────────────────
  put(10, L.mainAnchor, { values: false })
  put(11, L.liquido, { values: false })
  put(12, L.caja)
  put(13, L.cajaUsd)
  put(14, L.mmarket)
  put(15, L.subLiquido)
  put(16, L.alternativos, { values: false })
  put(17, L.inmobiliario)
  put(18, L.watermill, { values: false })
  put(19, L.fund)
  put(20, L.spine)
  put(21, L.inretail)
  put(22, L.subtotal)          // → main / ex_chilean_equities
  put(23, L.accionesCl)
  put(24, L.total)             // → main / with_chilean_equities

  // Performance block 1 — reconciles against SUBTOTAL, binding
  // `main / ex_chilean_equities`. Row 29 is left blank, which closes the block.
  putPerf(26, L.flow, 0)
  putPerf(27, L.utilidad, profitOf(ROW_SUBTOTAL))
  putPerf(28, L.retorno, profitOf(ROW_SUBTOTAL) / valueFor(ROW_SUBTOTAL, prev))

  // Performance block 2 — reconciles against TOTAL, binding
  // `main / with_chilean_equities`.
  putPerf(30, L.flow, 0)
  putPerf(31, L.utilidad, profitOf(ROW_TOTAL))
  putPerf(32, L.retorno, profitOf(ROW_TOTAL) / valueFor(ROW_TOTAL, prev))

  // ── Jaime ────────────────────────────────────────────────────────────────
  put(40, L.jaime, { values: false })
  put(41, L.laEsperanza, { values: false })
  put(42, L.caja)
  put(43, L.cajaUsd)
  put(44, L.subEsperanza)
  put(45, L.totalEsperanza)
  put(46, L.totalJaime)        // → jaime / total

  // Jaime's performance block — binds `jaime / total`.
  putPerf(48, L.flow, 0)
  putPerf(49, L.utilidad, profitOf(ROW_JAIME_TOTAL))

  // ── Technical block (excluded from every scope) ───────────────────────────
  put(60, L.calculo, { values: false })
  put(61, L.stock)

  return workbook([{ name: 'RESUMEN', cells }], LABELS)
}
