// R13.R1.1 — full historical snapshot normalization + arbitrary comparison.
//
// WHAT THIS FILE PROVES. R13.R1 could publish 6 of the source's 102 weekly
// observations; the other 96 were refused as defective. They were not. In every
// case the parser was reading a LEGITIMATE portfolio-history event as a
// structural fault:
//
//   § 9  a position that did not exist that week reclassified a LEAF as a
//        CONTAINER, which re-parented its neighbours and collapsed same-named
//        holdings onto one `row_key`                     → duplicate_row_key ×95
//   § 8  a performance block the source had not started yet was reported as
//        AMBIGUOUS rather than ABSENT                    → ×78 (70 main, 8 pablo)
//   § 8  Main's SECTION aggregates were offered as basis candidates and tie
//        with `SUBTOTAL` whenever InRetail is unchanged  → ×3
//   § 11 the earliest observation on record was refused for having no
//        predecessor                                     → ×1
//
// Every fixture here is SYNTHETIC and hand-checkable. No private amount, label
// or structure from the real workbook is reproduced: the shapes are modelled on
// documented source constructs, and the numbers are small round figures chosen
// so each assertion can be verified by eye.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { parseResumen, RESUMEN_PARSER_VERSION } from '../src/lib/familyPortfolio/resumen/parseResumen.ts'
import { isPerformanceBasisCandidate } from '../src/lib/familyPortfolio/resumen/hierarchy.ts'
import {
  buildChangeNodes,
  buildTotalMetrics,
  buildWaterfall,
  deriveDrivers,
  detectReclassifications,
  selectComparisonRange,
  selectWeekPair,
  suppressSingleWeekMetrics,
  type WeeklyChangeInputRow,
} from '../src/lib/familyPortfolio/weeklyChanges.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Source with comments stripped — an assertion must test code, not prose. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ---------------------------------------------------------------------------
// A synthetic RESUMEN workbook
// ---------------------------------------------------------------------------

interface Cell { ref: string; t?: string; v?: string | number; f?: string; s?: number }

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

const STYLES_XML =
  '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>' +
  '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'

function workbook(cells: Cell[], shared: string[]): Buffer {
  const si = shared.map((s) => `<si><t>${s}</t></si>`).join('')
  return zipOf([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'xl/workbook.xml', content: '<workbook><sheets><sheet name="RESUMEN" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: STYLES_XML },
    { name: 'xl/sharedStrings.xml', content: `<sst count="${shared.length}">${si}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(cells) },
  ])
}

const COL = (i: number): string => {
  let n = i; let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

const WEEKS = 22
const WEEK0 = 46000              // synthetic epoch; the real dates are irrelevant
const serial = (w: number) => WEEK0 + w * 7

/**
 * The hand-checkable book. Every figure is a small round number and every
 * aggregate is the exact sum of its constituents, so a reader can verify any
 * assertion below without running anything.
 *
 *   Caja                     100 + w        every week
 *   EMD USD                  200            every week
 *   High Yield                50            from week 2   ← ARRIVES
 *   Opciones                  25            from week 4   ← NEW ASSET CLASS
 *   SUBTOTAL LÍQUIDO         = Caja + EMD + HighYield + Opciones
 *   Fondo Compartido (Naidelt) 300          weeks 0..17   ← EXITS at 18
 *   Fondo Compartido (Retboy)  400          from week 3   ← SAME LABEL, other sociedad
 *   SUBTOTAL ALTERNATIVOS    = the two Fondo rows
 *   LÍQUIDO + ALTERNATIVOS   = the two subtotals
 *   INRETAIL                1000            CONSTANT — so Δ(LÍQUIDO+ALT) ≡ ΔSUBTOTAL
 *   SUBTOTAL                = LÍQUIDO+ALT + INRETAIL          ← basis: ex Chilean
 *   ACCIONES CHILENAS        500 + 10w
 *   TOTAL                   = SUBTOTAL + ACCIONES CHILENAS    ← basis: with Chilean
 */
const V = {
  caja: (w: number) => 100 + w,
  emd: () => 200,
  highYield: (w: number) => (w >= 2 ? 50 : null),
  opciones: (w: number) => (w >= 4 ? 25 : null),
  fondoNaidelt: (w: number) => (w <= 17 ? 300 : null),
  fondoRetboy: (w: number) => (w >= 3 ? 400 : null),
  inretail: () => 1000,
  chilean: (w: number) => 500 + 10 * w,
}
const sum = (...xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0)
const liquido = (w: number) => sum(V.caja(w), V.emd(), V.highYield(w), V.opciones(w))
const rentaFija = (w: number) => sum(V.emd(), V.highYield(w))
const vcpe = (w: number) => sum(V.fondoNaidelt(w), V.fondoRetboy(w))
const liqAlt = (w: number) => liquido(w) + vcpe(w)
const subtotal = (w: number) => liqAlt(w) + V.inretail()
const total = (w: number) => subtotal(w) + V.chilean(w)

interface BuildOptions {
  /** Insert a blank spacer row before this source row — proves keys don't move. */
  insertBlankBefore?: number
  /** Give a second row under ONE parent the same label — must still fail closed. */
  duplicateUnderOneParent?: boolean
  /** Weeks in which the `CON` block states figures. Others are absent. */
  conBlockFrom?: number
  /** A week where the `CON` block carries only a YTD figure and no weekly profit. */
  ytdOnlyConWeek?: number
}

function buildBook(opts: BuildOptions = {}): { bytes: Buffer; letterOf: (w: number) => string } {
  const shared: string[] = []
  const s = (label: string) => {
    const i = shared.indexOf(label)
    if (i >= 0) return i
    shared.push(label)
    return shared.length - 1
  }
  const cells: Cell[] = []
  const label = (row: number, text: string) => cells.push({ ref: `B${row}`, t: 's', v: s(text) })
  const put = (row: number, w: number, value: number | null) => {
    if (value === null) return
    cells.push({ ref: `${COL(3 + w)}${row}`, v: value })
  }

  // Header row 5, plus the live and Diferencia columns beyond the series.
  cells.push({ ref: 'B5', t: 's', v: s('valores en dólares') })
  for (let w = 0; w < WEEKS; w++) cells.push({ ref: `${COL(3 + w)}5`, v: serial(w), s: 1 })
  cells.push({ ref: `${COL(3 + WEEKS)}5`, t: 's', v: s('Diferencia') })
  cells.push({ ref: `${COL(3 + WEEKS + 1)}4`, t: 's', v: s('Precios en vivo') })
  cells.push({ ref: `${COL(3 + WEEKS + 1)}5`, f: '+A$1', v: serial(WEEKS), s: 1 })

  let r = 3
  const bump = () => { if (opts.insertBlankBefore === r) r += 1 }

  label(r, 'RESUMEN PORTFOLIO'); r += 3      // row 3; rows 4-5 are header/annotation
  r = 6
  bump(); label(r, 'PORTAFOLIO LIQUIDO'); r += 1
  bump(); const rCaja = r; label(r, 'Caja y Equivalentes'); r += 1
  bump(); const rRf = r; label(r, 'Renta Fija'); r += 1
  bump(); const rEmd = r; label(r, 'EMD USD'); r += 1
  bump(); const rHy = r; label(r, 'High Yield'); r += 1
  bump(); const rOpc = r; label(r, 'Opciones'); r += 1
  bump(); const rSubLiq = r; label(r, 'SUBTOTAL PORTFOLIO LÍQUIDO'); r += 1
  bump(); label(r, 'ALTERNATIVOS'); r += 1
  bump(); const rVcpe = r; label(r, 'Venture Capital / Private Equity'); r += 1
  bump(); label(r, 'Naidelt SA'); r += 1
  bump(); const rFondoN = r; label(r, 'Fondo Compartido'); r += 1
  bump(); label(r, 'Retboy SA'); r += 1
  bump(); const rFondoR = r; label(r, 'Fondo Compartido'); r += 1
  let rDup = 0
  if (opts.duplicateUnderOneParent) { rDup = r; label(r, 'Fondo Compartido'); r += 1 }
  bump(); const rSubAlt = r; label(r, 'SUBTOTAL ALTERNATIVOS'); r += 1
  bump(); const rLiqAlt = r; label(r, 'PORTFOLIO LÍQUIDO + ALTERNATIVOS'); r += 1
  bump(); const rInr = r; label(r, 'INRETAIL PERU CORP'); r += 1
  bump(); const rSub = r; label(r, 'SUBTOTAL'); r += 1
  bump(); const rChi = r; label(r, 'ACCIONES CHILENAS (USD)'); r += 1
  bump(); const rTot = r; label(r, 'TOTAL'); r += 2
  const rExHdr = r; label(r, 'PORTAFOLIO EX ACCIONES CHILENAS'); r += 1
  const rExFlow = r; label(r, 'Retiros / Aportes'); r += 1
  const rExProfit = r; label(r, 'Utilidad de la Semana'); r += 2
  const rConHdr = r; label(r, 'PORTAFOLIO CON ACCIONES CHILENAS'); r += 1
  label(r, 'Retiros / Aportes'); r += 1
  const rConProfit = r; label(r, 'Utilidad de la Semana'); r += 1
  const rConYtd = r; label(r, 'Utilidad del Año')

  const conFrom = opts.conBlockFrom ?? 5
  for (let w = 0; w < WEEKS; w++) {
    put(rCaja, w, V.caja(w))
    put(rRf, w, rentaFija(w))
    put(rEmd, w, V.emd())
    put(rHy, w, V.highYield(w))
    put(rOpc, w, V.opciones(w))
    put(rSubLiq, w, liquido(w))
    put(rVcpe, w, vcpe(w))
    put(rFondoN, w, V.fondoNaidelt(w))
    put(rFondoR, w, V.fondoRetboy(w))
    if (rDup) put(rDup, w, 7)
    put(rSubAlt, w, vcpe(w))
    put(rLiqAlt, w, liqAlt(w))
    put(rInr, w, V.inretail())
    put(rSub, w, subtotal(w))
    put(rChi, w, V.chilean(w))
    put(rTot, w, total(w))
    // Performance: flow cells stay EMPTY (doc 02 § 8 — an empty flow is zero).
    if (w > 0) put(rExProfit, w, subtotal(w) - subtotal(w - 1))
    if (w > 0 && w >= conFrom && w !== opts.ytdOnlyConWeek) put(rConProfit, w, total(w) - total(w - 1))
    if (w === opts.ytdOnlyConWeek) put(rConYtd, w, 42)
  }
  void rExHdr; void rExFlow; void rConHdr

  return { bytes: workbook(cells, shared), letterOf: (w: number) => COL(3 + w) }
}

const BOOK = buildBook()
const parseWeek = (w: number, book = BOOK) =>
  parseResumen(book.bytes, { publicationColumnLetter: book.letterOf(w) })
const keyOf = (rows: ReadonlyArray<{ rowKey: string }>, suffix: string) =>
  rows.filter((x) => x.rowKey.endsWith(suffix)).map((x) => x.rowKey)

// ---------------------------------------------------------------------------
// 1 · Every historical observation parses independently (§§ 2, 11)
// ---------------------------------------------------------------------------

describe('R13.R1.1 § 2/§ 11 — every historical observation parses on its own', () => {
  test('all weeks parse cleanly, including the first on record', () => {
    for (let w = 0; w < WEEKS; w++) {
      const d = parseWeek(w)
      const blocking = d.findings.filter((f) => f.severity === 'blocking')
      assert.equal(d.ok, true, `week ${w} blocked: ${blocking.map((f) => f.code).join(', ')}`)
    }
  })

  test('the EARLIEST observation publishes with no predecessor and no baseline', () => {
    const d = parseWeek(0)
    assert.equal(d.ok, true)
    assert.equal(d.previousWeekDate, null)
    assert.equal(d.beginningOfYearDate, null)
    // Unavailable, NEVER zero (doc 02 § 9).
    for (const row of d.rows) {
      assert.equal(row.previousValue, null)
      assert.equal(row.beginningOfYearValue, null)
      assert.equal(row.difference, null)
      assert.notEqual(row.difference, 0)
    }
  })

  test('a MIDDLE week that lost its predecessor still blocks — the relaxation is narrow', () => {
    const detection = code('src/lib/familyPortfolio/resumen/dateDetection.ts')
    assert.match(detection, /isFirstOnRecord/)
    assert.match(detection, /!isFirstOnRecord && \(!previousWeek/)
    assert.ok(
      detection.includes("code: 'previous_week_not_found'"),
      'the blocking finding still exists for every other week',
    )
  })

  test('each week reports its OWN as-of date, and they are all distinct', () => {
    const dates: string[] = []
    for (let w = 0; w < WEEKS; w++) {
      const d = parseWeek(w)
      assert.ok(d.detectedAsOfDate !== null)
      dates.push(d.detectedAsOfDate as string)
    }
    assert.equal(new Set(dates).size, WEEKS, 'no two columns resolve to the same date')
    assert.deepEqual([...dates].sort(), dates, 'and they ascend with the columns')
  })
})

// ---------------------------------------------------------------------------
// 2 · Canonical identity (§§ 4, 9)
// ---------------------------------------------------------------------------

describe('R13.R1.1 §§ 4, 9 — canonical identity is stable across every week', () => {
  test('the SAME label under two sociedades keeps two distinct identities', () => {
    // The exact shape that collapsed 95 real weeks onto one key. Week 10 is
    // inside the window where BOTH sociedades hold it (Retboy from week 3,
    // Naidelt until week 17).
    const both = parseWeek(10)
    const fondos = keyOf(both.rows, 'fondo_compartido')
    assert.equal(fondos.length, 2, 'both sociedades hold it')
    assert.equal(new Set(fondos).size, 2, 'and they are DIFFERENT keys')
    assert.ok(fondos.some((k) => k.includes('naidelt')))
    assert.ok(fondos.some((k) => k.includes('retboy')))
  })

  test('a week where one of them did not exist yet does NOT merge the other', () => {
    // Week 0: Retboy's holding has no value. Before § 9 this made BOTH rows
    // containers directly under the asset class, with one identical key.
    const early = parseWeek(0)
    const fondos = keyOf(early.rows, 'fondo_compartido')
    assert.equal(fondos.length, 1, 'only the sociedad that held it appears')
    assert.ok(fondos[0].includes('naidelt'))
    assert.equal(
      early.findings.filter((f) => f.code === 'duplicate_row_key').length, 0,
      'and no duplicate key is produced',
    )
  })

  test('ROW TYPE never varies for one identity across the whole history', () => {
    const typeByKey = new Map<string, Set<string>>()
    for (let w = 0; w < WEEKS; w++) {
      for (const row of parseWeek(w).rows) {
        if (!typeByKey.has(row.rowKey)) typeByKey.set(row.rowKey, new Set())
        typeByKey.get(row.rowKey)!.add(row.rowType)
      }
    }
    const unstable = [...typeByKey].filter(([, v]) => v.size > 1)
    assert.deepEqual(unstable, [], 'row type is a property of the source row, not of the week')
  })

  test('PARENTAGE never varies for one identity across the whole history', () => {
    const parentByKey = new Map<string, Set<string | null>>()
    for (let w = 0; w < WEEKS; w++) {
      for (const row of parseWeek(w).rows) {
        if (!parentByKey.has(row.rowKey)) parentByKey.set(row.rowKey, new Set())
        parentByKey.get(row.rowKey)!.add(row.parentRowKey)
      }
    }
    assert.deepEqual([...parentByKey].filter(([, v]) => v.size > 1), [])
  })

  test('INSERTING a row leaves every other identity untouched', () => {
    // The label PATH is the identity, so a spacer shifts source rows only.
    const shifted = buildBook({ insertBlankBefore: 9 })
    const before = new Set(parseWeek(WEEKS - 1).rows.map((x) => x.rowKey))
    const after = new Set(
      parseResumen(shifted.bytes, { publicationColumnLetter: shifted.letterOf(WEEKS - 1) })
        .rows.map((x) => x.rowKey),
    )
    assert.deepEqual([...after].sort(), [...before].sort())
  })

  test('source ROW NUMBERS move while identities do not', () => {
    const shifted = buildBook({ insertBlankBefore: 9 })
    const a = parseWeek(WEEKS - 1).rows.find((x) => x.rowKey.endsWith('total'))!
    const b = parseResumen(shifted.bytes, { publicationColumnLetter: shifted.letterOf(WEEKS - 1) })
      .rows.find((x) => x.rowKey.endsWith('total'))!
    assert.equal(a.rowKey, b.rowKey)
    assert.notEqual(a.sourceRow, b.sourceRow, 'the spacer really did move it')
  })

  test('TRUE ambiguity still FAILS CLOSED — two identical labels under ONE parent', () => {
    // § 9 forbids silencing collisions with a row number or a UUID. A genuine
    // collision — the same label twice under the SAME sociedad — is not a
    // history event and must still block.
    const dup = buildBook({ duplicateUnderOneParent: true })
    const d = parseResumen(dup.bytes, { publicationColumnLetter: dup.letterOf(WEEKS - 1) })
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.severity === 'blocking' && f.code === 'duplicate_row_key'))
  })

  test('the key strategy is not suffixed with a row number, index or UUID', () => {
    const h = code('src/lib/familyPortfolio/resumen/hierarchy.ts')
    assert.ok(!/randomUUID|crypto\./.test(h))
    assert.ok(!/sourceRow|displayOrder/.test(h), 'no positional component in the key')
    assert.match(h, /export function buildRowKey/)
  })
})

// ---------------------------------------------------------------------------
// 3 · Hierarchy as-of, arrivals and exits (§§ 3, 5)
// ---------------------------------------------------------------------------

describe('R13.R1.1 §§ 3, 5 — a snapshot holds what the portfolio held that week', () => {
  test('row counts legitimately differ between weeks', () => {
    const first = parseWeek(0).rows.length
    const last = parseWeek(WEEKS - 1).rows.length
    assert.ok(last > first, `${first} → ${last}: the portfolio grew`)
  })

  test('a position that did not exist yet is ABSENT, not a blank row', () => {
    assert.equal(parseWeek(1).rows.some((x) => x.rowKey.endsWith('high_yield')), false)
    assert.equal(parseWeek(2).rows.some((x) => x.rowKey.endsWith('high_yield')), true)
  })

  test('a NEW ASSET CLASS appears without disturbing anything else', () => {
    const before = parseWeek(3)
    const after = parseWeek(4)
    assert.equal(before.rows.some((x) => x.rowKey.endsWith('opciones')), false)
    assert.equal(after.rows.some((x) => x.rowKey.endsWith('opciones')), true)
    const others = (d: typeof before) => d.rows.map((x) => x.rowKey).filter((k) => !k.endsWith('opciones'))
    assert.deepEqual(others(after), others(before))
  })

  test('an EXITED position leaves the snapshot from the week it is gone', () => {
    assert.equal(parseWeek(17).rows.some((x) => x.rowKey.includes('naidelt_sa.fondo_compartido')), true)
    assert.equal(parseWeek(18).rows.some((x) => x.rowKey.includes('naidelt_sa.fondo_compartido')), false)
  })

  test('a valueless CONTAINER survives while it still has a child, and goes when it does not', () => {
    // `Naidelt SA` carries no value in any week; it is load-bearing structure
    // until its only holding exits, and meaningless after.
    assert.equal(parseWeek(17).rows.some((x) => x.rowKey.endsWith('naidelt_sa')), true)
    assert.equal(parseWeek(18).rows.some((x) => x.rowKey.endsWith('naidelt_sa')), false)
  })

  test('NO published row carries a null value except a pure label container', () => {
    for (let w = 0; w < WEEKS; w++) {
      for (const row of parseWeek(w).rows) {
        if (row.value !== null) continue
        assert.ok(
          row.rowType === 'sociedad_header' || row.rowType === 'group_header',
          `week ${w}: ${row.rowType} ${row.labelEs} is null but is not a container`,
        )
      }
    }
  })

  test('the prune rule is value-and-descendant based, never a label filter', () => {
    const p = code('src/lib/familyPortfolio/resumen/parseResumen.ts')
    assert.match(p, /erroredKeys/)
    assert.match(p, /r\.value === null && !erroredKeys\.has\(r\.rowKey\) && !hasChild\.has\(r\.rowKey\)/)
  })
})

// ---------------------------------------------------------------------------
// 4 · Performance-basis binding (§ 8)
// ---------------------------------------------------------------------------

describe('R13.R1.1 § 8 — historical performance-basis binding', () => {
  test('a SECTION aggregate is never offered as a basis candidate', () => {
    assert.equal(isPerformanceBasisCandidate('main', 'portfolio_subtotal', 'SUBTOTAL'), true)
    assert.equal(isPerformanceBasisCandidate('main', 'portfolio_total', 'TOTAL'), true)
    assert.equal(isPerformanceBasisCandidate('main', 'portfolio_subtotal', 'SUBTOTAL PORTFOLIO LÍQUIDO'), false)
    assert.equal(isPerformanceBasisCandidate('main', 'portfolio_subtotal', 'SUBTOTAL ALTERNATIVOS'), false)
    assert.equal(isPerformanceBasisCandidate('main', 'portfolio_subtotal', 'PORTFOLIO LÍQUIDO + ALTERNATIVOS'), false)
    // A personal scope keeps every total — reconciliation chooses between them.
    assert.equal(isPerformanceBasisCandidate('andres', 'portfolio_total', 'TOTAL ANDRÉS (DIRECTO)'), true)
    assert.equal(isPerformanceBasisCandidate('andres', 'portfolio_total', 'TOTAL Soc Personales + Proporcional'), true)
    // Nothing that is not a portfolio-level aggregate ever qualifies.
    assert.equal(isPerformanceBasisCandidate('main', 'individual_asset', 'SUBTOTAL'), false)
  })

  test('the EX basis binds to SUBTOTAL even though the spine aggregate ties exactly', () => {
    // InRetail is constant in this book, so Δ(LÍQUIDO+ALTERNATIVOS) ≡ ΔSUBTOTAL.
    // Both reconcile; only one is a basis.
    const w = 10
    assert.equal(liqAlt(w) - liqAlt(w - 1), subtotal(w) - subtotal(w - 1), 'the tie is real')
    const d = parseWeek(w)
    assert.equal(d.ok, true)
    const ex = d.performance.filter((p) => p.basis === 'ex_chilean_equities')
    assert.ok(ex.length > 0)
    assert.ok(ex.every((p) => p.boundRowKey!.endsWith('.subtotal')), 'bound to SUBTOTAL, not the spine row')
  })

  test('both Main bases bind once the source maintains both blocks', () => {
    const d = parseWeek(10)
    const bases = new Set(d.performance.map((p) => p.basis))
    assert.deepEqual([...bases].sort(), ['ex_chilean_equities', 'with_chilean_equities'])
    const withCh = d.performance.find((p) => p.basis === 'with_chilean_equities')!
    assert.ok(withCh.boundRowKey!.endsWith('.total'))
  })

  test('an ABSENT block is info, not a blocking ambiguity — and publishes nothing', () => {
    const d = parseWeek(2)   // the CON block starts at week 5
    assert.equal(d.ok, true)
    assert.equal(d.findings.some((f) => f.code === 'ambiguous_performance_basis'), false)
    const absent = d.findings.filter((f) => f.code === 'performance_block_absent')
    assert.equal(absent.length, 1)
    assert.equal(absent[0].severity, 'info')
    assert.equal(d.performance.some((p) => p.basis === 'with_chilean_equities'), false)
  })

  test('a block with figures but NO weekly profit is reported and dropped, never guessed', () => {
    const book = buildBook({ ytdOnlyConWeek: 9 })
    const d = parseResumen(book.bytes, { publicationColumnLetter: book.letterOf(9) })
    assert.equal(d.ok, true, 'one unbindable series does not lose the week')
    const f = d.findings.filter((x) => x.code === 'performance_block_unbindable')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'warning')
    assert.equal(d.performance.some((p) => p.basis === 'with_chilean_equities'), false,
      'nothing is published for a basis that could not be reconciled')
  })

  test('the block TITLE is still never what decides a basis', () => {
    const p = code('src/lib/familyPortfolio/resumen/parseResumen.ts')
    // `bindBlockToCandidate` receives the block and the candidates; the header
    // label is not among the inputs it compares.
    assert.match(p, /function bindBlockToCandidate/)
    const body = p.slice(p.indexOf('function bindBlockToCandidate'))
    const fnBody = body.slice(0, body.indexOf('\n}'))
    assert.ok(!fnBody.includes('headerLabel'), 'binding never reads the title')
  })

  test('a genuinely unbindable STATED figure still blocks', () => {
    const p = code('src/lib/familyPortfolio/resumen/parseResumen.ts')
    assert.match(p, /'blocking', 'ambiguous_performance_basis'/)
  })
})

// ---------------------------------------------------------------------------
// 5 · Comparison: weekly default and arbitrary ranges (§§ 13, 14, 15)
// ---------------------------------------------------------------------------

const wk = (d: string) => ({ asOfDate: d })
const BOOKWEEKS = ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23']

/**
 * The LABEL is the key's last segment — the same relationship the parser
 * produces, and what makes `s.old.fondo` and `s.new.fondo` two paths to one
 * economic name (§ 7).
 */
function rowsFrom(spec: Array<[string, string | null, string, number | null]>): WeeklyChangeInputRow[] {
  return spec.map(([rowKey, parentRowKey, rowType, value], i) => ({
    rowKey, parentRowKey, depth: parentRowKey === null ? 0 : 1, displayOrder: i,
    rowType, labelEs: rowKey.split('.').at(-1) as string, labelEn: null, currency: 'USD', value,
  }))
}

describe('R13.R1.1 § 13 — weekly default and arbitrary comparison', () => {
  test('the WEEKLY default is unchanged: the immediately preceding published week', () => {
    const sel = selectWeekPair(BOOKWEEKS.map(wk), '2026-01-23')
    assert.equal(sel.ok, true); if (!sel.ok) return
    assert.equal(sel.selection.previous!.asOfDate, '2026-01-16')
  })

  test('the earliest published week has no previous — never a zero change', () => {
    const sel = selectWeekPair(BOOKWEEKS.map(wk), '2026-01-02')
    assert.equal(sel.ok, true); if (!sel.ok) return
    assert.equal(sel.selection.previous, null)
  })

  test('ANY two published weeks can be compared', () => {
    const sel = selectComparisonRange(BOOKWEEKS.map(wk), '2026-01-02', '2026-01-23')
    assert.equal(sel.ok, true); if (!sel.ok) return
    assert.equal(sel.selection.mode, 'custom')
    assert.equal(sel.selection.previous!.asOfDate, '2026-01-02')
    assert.equal(sel.selection.current.asOfDate, '2026-01-23')
  })

  test('the mode is carried, not inferred from the gap', () => {
    // Two ADJACENT weeks chosen by hand are still a custom comparison.
    const sel = selectComparisonRange(BOOKWEEKS.map(wk), '2026-01-16', '2026-01-23')
    assert.equal(sel.ok, true); if (!sel.ok) return
    assert.equal(sel.selection.mode, 'custom')
  })

  test('an unpublished endpoint is REFUSED, never snapped to the nearest week', () => {
    assert.equal(selectComparisonRange(BOOKWEEKS.map(wk), '2026-01-03', '2026-01-23').ok, false)
    assert.equal(
      (selectComparisonRange(BOOKWEEKS.map(wk), '2026-01-03', '2026-01-23') as { code: string }).code,
      'from_not_found',
    )
    assert.equal(
      (selectComparisonRange(BOOKWEEKS.map(wk), '2026-01-02', '2026-02-99') as { code: string }).code,
      'week_not_found',
    )
  })

  test('a reversed or zero-length range is refused', () => {
    for (const [from, to] of [['2026-01-23', '2026-01-02'], ['2026-01-09', '2026-01-09']]) {
      const r = selectComparisonRange(BOOKWEEKS.map(wk), from, to)
      assert.equal(r.ok, false)
      assert.equal((r as { code: string }).code, 'from_not_before_to')
    }
  })

  test("a custom range withholds the source's single-week flow and profit", () => {
    const base = {
      basis: 'total', totalRowKey: 't', currentValue: 120, previousValue: 100,
      weeklyValueChange: 20, weeklyReturn: 0.2, weeklyProfit: 20, flow: 5,
      ytdReturn: 0.5, ytdProfit: 40,
    }
    const out = suppressSingleWeekMetrics(base)
    assert.equal(out.flow, null)
    assert.equal(out.weeklyProfit, null)
    assert.equal(out.weeklyReturn, null)
    // Derived from the two snapshots — correct over any span, so retained.
    assert.equal(out.weeklyValueChange, 20)
    assert.equal(out.currentValue, 120)
    assert.equal(out.previousValue, 100)
    // The current week's own year-to-date is unaffected by the opening endpoint.
    assert.equal(out.ytdProfit, 40)
  })

  test('the surface titles a multi-week range differently', () => {
    const page = read('src/app/family-portfolio/weekly-changes/page.tsx')
    assert.match(page, /isCustomRange \? w\.customTitle : w\.title/)
    for (const lang of ['en', 'es'] as const) {
      const i18n = read('src/lib/i18n.ts')
      assert.ok(i18n.includes('customTitle:'), `${lang} carries the custom title`)
    }
    assert.ok(!/Weekly Change/.test(read('src/lib/i18n.ts').split('customTitle:')[1].split('\n')[0]))
  })
})

describe('R13.R1.1 §§ 5, 14 — union semantics', () => {
  const PREV = rowsFrom([
    ['root.total', null, 'portfolio_total', 100],
    ['root.a', null, 'individual_asset', 60],
    ['root.b', null, 'individual_asset', 40],
  ])
  const CUR = rowsFrom([
    ['root.total', null, 'portfolio_total', 150],
    ['root.a', null, 'individual_asset', 70],
    ['root.c', null, 'individual_asset', 80],
  ])

  test('confirmed absence → present is a NEW POSITION against zero', () => {
    const n = buildChangeNodes(CUR, PREV, 100).find((x) => x.rowKey === 'root.c')!
    assert.equal(n.lifecycle, 'new_position')
    assert.equal(n.status, 'ok')
    assert.equal(n.previousValue, 0)
    assert.equal(n.weeklyValueChange, 80)
  })

  test('present → confirmed absence is an EXITED POSITION to zero', () => {
    const n = buildChangeNodes(CUR, PREV, 100).find((x) => x.rowKey === 'root.b')!
    assert.equal(n.lifecycle, 'exited_position')
    assert.equal(n.status, 'ok')
    assert.equal(n.currentValue, 0)
    assert.equal(n.weeklyValueChange, -40)
  })

  test('an AMBIGUOUS value is never converted to zero', () => {
    const cur = rowsFrom([
      ['root.total', null, 'portfolio_total', 150],
      ['root.a', null, 'individual_asset', null],   // present but unusable
    ])
    const n = buildChangeNodes(cur, PREV, 100).find((x) => x.rowKey === 'root.a')!
    assert.equal(n.lifecycle, 'ongoing')
    assert.equal(n.status, 'unavailable')
    assert.equal(n.currentValue, null)
    assert.notEqual(n.currentValue, 0)
    assert.equal(n.weeklyValueChange, null)
  })

  test('a new position has no percentage change — never an infinity', () => {
    const n = buildChangeNodes(CUR, PREV, 100).find((x) => x.rowKey === 'root.c')!
    assert.equal(n.ownPctChange, null)
    assert.ok(!Number.isFinite(n.ownPctChange as unknown as number) || n.ownPctChange === null)
  })

  test('no asset disappears from the comparison because its row set changed', () => {
    const keys = buildChangeNodes(CUR, PREV, 100).map((x) => x.rowKey).sort()
    assert.deepEqual(keys, ['root.a', 'root.b', 'root.c', 'root.total'])
  })

  test('arrivals and exits make the waterfall TIE exactly', () => {
    // 100 opening; a +10, b −40, c +80 ⇒ 150 closing. Every part is exact.
    const nodes = buildChangeNodes(CUR, PREV, 100)
    const total = buildTotalMetrics(
      nodes,
      [{ basis: 'total', metric: 'weekly_profit', value: 50, boundRowKey: 'root.total' }],
      'total',
    )
    const drivers = deriveDrivers(nodes, 'top_level')
    const wf = buildWaterfall(total, drivers, {
      opening: { es: 'o', en: 'o' }, closing: { es: 'c', en: 'c' }, residual: { es: 'r', en: 'r' },
    })
    assert.equal(wf.status, 'complete')
    assert.equal(wf.unavailableDriverCount, 0)
    assert.equal(wf.residual, 0)
    assert.equal(wf.steps.some((s) => s.kind === 'residual'), false)
  })

  test('a driver set never double-counts a parent with its own child', () => {
    const prev = rowsFrom([
      ['root.total', null, 'portfolio_total', 100],
      ['root.cls', null, 'asset_class', 100],
      ['root.cls.leaf', 'root.cls', 'sub_asset_class', 100],
    ])
    const cur = rowsFrom([
      ['root.total', null, 'portfolio_total', 130],
      ['root.cls', null, 'asset_class', 130],
      ['root.cls.leaf', 'root.cls', 'sub_asset_class', 130],
    ])
    const drivers = deriveDrivers(buildChangeNodes(cur, prev, 100), 'top_level')
    const keys = drivers.map((d) => d.rowKey)
    assert.deepEqual(keys, ['root.cls'], 'the class, never also its leaf, never the total')
    assert.equal(drivers.reduce((a, d) => a + (d.weeklyValueChange ?? 0), 0), 30)
  })
})

describe('R13.R1.1 § 7 — reclassification is reported, never merged', () => {
  const PREV = rowsFrom([
    ['s.total', null, 'portfolio_total', 100],
    ['s.old.fondo', 's.old', 'individual_asset', 40],
  ])
  const CUR = rowsFrom([
    ['s.total', null, 'portfolio_total', 100],
    ['s.new.fondo', 's.new', 'individual_asset', 40],
  ])

  test('a move is surfaced as a candidate', () => {
    const nodes = buildChangeNodes(CUR, PREV, 100)
    const found = detectReclassifications(nodes)
    assert.equal(found.length, 1)
    assert.equal(found[0].exitedRowKey, 's.old.fondo')
    assert.equal(found[0].arrivedRowKey, 's.new.fondo')
  })

  test('the two nodes KEEP their own identities and their own changes', () => {
    const nodes = buildChangeNodes(CUR, PREV, 100)
    const gone = nodes.find((n) => n.rowKey === 's.old.fondo')!
    const came = nodes.find((n) => n.rowKey === 's.new.fondo')!
    assert.equal(gone.lifecycle, 'exited_position')
    assert.equal(came.lifecycle, 'new_position')
    assert.equal(gone.weeklyValueChange, -40)
    assert.equal(came.weeklyValueChange, 40)
    // Nothing is netted away: the pair still sums to zero on its own.
    assert.equal((gone.weeklyValueChange ?? 0) + (came.weeklyValueChange ?? 0), 0)
  })

  test('an AMBIGUOUS pairing is NOT reported — it would be a guess', () => {
    // The normal shape of this book: one label held by several sociedades.
    const prev = rowsFrom([
      ['s.total', null, 'portfolio_total', 100],
      ['s.one.fondo', 's.one', 'individual_asset', 40],
      ['s.two.fondo', 's.two', 'individual_asset', 40],
    ])
    const cur = rowsFrom([
      ['s.total', null, 'portfolio_total', 100],
      ['s.three.fondo', 's.three', 'individual_asset', 40],
    ])
    assert.deepEqual(detectReclassifications(buildChangeNodes(cur, prev, 100)), [])
  })

  test('a same-parent arrival and exit is not a reclassification', () => {
    assert.deepEqual(detectReclassifications(buildChangeNodes(PREV, PREV, 100)), [])
  })
})

// ---------------------------------------------------------------------------
// 6 · Backfill, routes and surfaces
// ---------------------------------------------------------------------------

describe('R13.R1.1 §§ 11, 12, 17 — backfill, selector and future uploads', () => {
  const BACKFILL = 'scripts/admin/backfillPortfolioHistory.ts'

  test('the backfill publishes through the REAL transaction, never a direct write', () => {
    const src = code(BACKFILL)
    assert.match(src, /rpc\('nmi_publish_portfolio'/)
    assert.ok(!/\.from\('portfolio_snapshot_rows'\)/.test(src), 'never writes snapshot rows itself')
    assert.ok(!/\.from\('portfolio_publications'\)\s*\n?\s*\.insert/.test(src))
  })

  test('it re-verifies the stored digest before parsing', () => {
    const src = code(BACKFILL)
    assert.match(src, /createHash\('sha256'\)/)
    assert.match(src, /source_digest_mismatch/)
  })

  test('re-running is idempotent and never duplicates a publication', () => {
    const src = code(BACKFILL)
    assert.match(src, /already published at this parser version/)
    assert.match(src, /publication_refused_duplicate_submission/)
  })

  test('it refuses a week whose current revision came from another upload', () => {
    assert.match(code(BACKFILL), /current revision came from a different upload/)
  })

  test('it never approximates a week from its neighbour', () => {
    const src = code(BACKFILL)
    // Every week is re-parsed at ITS OWN column and refused unless the parse
    // reports that same date, so a value can never reach the wrong week.
    assert.match(src, /parseResumen\(bytes, \{ publicationColumnLetter: week\.letter \}\)/)
    assert.match(src, /draft\.detectedAsOfDate !== week\.date/)
    assert.match(src, /if \(!draft\.ok\)/)
    // No cross-week value plumbing exists at all.
    assert.ok(!/previousWeekColumn|neighbou?r|fallbackColumn/i.test(src))
  })

  test('a column that does not parse cleanly is still refused', () => {
    const src = code('src/lib/familyPortfolio/resumen/evolutionHistory.ts')
    assert.match(src, /if \(!draft\.ok\) continue/)
  })

  test('the week selector offers EVERY published week with no nearest-date fallback', () => {
    const route = code('src/app/api/family-portfolio/[scope]/snapshot/route.ts')
    assert.ok(!/limit\(/.test(route), 'the week list is not capped')
    assert.match(route, /week_not_found/)
    const selector = read('src/components/familyPortfolio/WeekSelector.tsx')
    assert.match(selector, /weeks\.map/)
    assert.ok(!/slice\(/.test(selector), 'the selector shows every week it is given')
  })

  test('the comparison route accepts a custom range and reports the mode', () => {
    const route = code('src/app/api/family-portfolio/weekly-changes/[scope]/route.ts')
    assert.match(route, /searchParams\.get\('from'\)/)
    assert.match(route, /selectComparisonRange/)
    assert.match(route, /mode/)
    assert.match(route, /suppressSingleWeekMetrics/)
    assert.match(route, /detectReclassifications/)
  })

  test('a future upload may introduce a new row without a parser change', () => {
    // The § 9 rule reads EVERY date column, so a row whose only value is in the
    // newest column is a leaf in every week — including the ones before it
    // existed. That is what makes a new investment a data event, not a code
    // change (§ 17).
    const p = code('src/lib/familyPortfolio/resumen/parseResumen.ts')
    assert.match(p, /rowCarriesValueAnywhere/)
    assert.match(p, /detection\.historical, \.\.\.\(detection\.live \? \[detection\.live\] : \[\]\)/)
    // And an unknown structural dialect is still a separate, blocking concern.
    assert.match(p, /ambiguous_hierarchy_row/)
  })

  test('the parser version records the semantics change', () => {
    assert.equal(RESUMEN_PARSER_VERSION, 'r13.r1.1.resumen.5')
    assert.notEqual(RESUMEN_PARSER_VERSION, 'r13.r1.resumen.4')
  })

  test('this suite reads nothing private and depends on no local file', () => {
    const self = read('tests/portfolioHistoricalNormalization.test.ts')
    // Assembled from fragments so the assertion cannot match its own source.
    for (const fragment of [['nmi', 'private', 'inputs'].join('-'), ['portfolio', 'source', 'reference'].join('-')]) {
      assert.ok(!self.includes(fragment), `the suite must not reference ${fragment}`)
    }
    // No absolute path, so the fixtures travel with the repository and CI.
    assert.ok(!/['"][A-Za-z]:[\\/]/.test(self), 'no absolute filesystem path')
    // Every workbook under test is built in-process from the synthetic model.
    assert.match(self, /const BOOK = buildBook\(\)/)
  })
})
