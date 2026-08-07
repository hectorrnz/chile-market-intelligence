// R13.4 — Alternatives parser, colour normalisation, and schema posture.
//
// NO PRIVATE SOURCE DATA. Every workbook is synthetic and built in memory; the
// STRUCTURES come from doc 03, the amounts are invented. The three legend hexes
// ARE reproduced because they are colour definitions, not financial values, and
// the theme-index trap cannot be tested without them.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readXlsx, parseStyles, parseThemeColours } from '../src/lib/familyPortfolio/xlsx/readXlsx.ts'
import { indexToColumn } from '../src/lib/familyPortfolio/xlsx/cellRef.ts'
import {
  applyTint, resolveFill, classifyFill, hexToRgb, rgbToHsl, deltaE,
  HUE_TOLERANCE_DEGREES, type LegendEntry,
} from '../src/lib/familyPortfolio/alternatives/colour.ts'
import {
  parseAlternatives, findAlternativesSheet, detectLegend, ALTERNATIVES_PARSER_VERSION,
} from '../src/lib/familyPortfolio/alternatives/parseAlternatives.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

interface Cell { ref: string; v?: number | string; t?: 's' | 'e'; s?: number }

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
  return `<worksheet><sheetData>${[...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) =>
    `<row r="${r}">${cs.map((c) =>
      `<c r="${c.ref}"${c.t ? ` t="${c.t}"` : ''}${c.s !== undefined ? ` s="${c.s}"` : ''}>${c.v === undefined ? '' : `<v>${c.v}</v>`}</c>`,
    ).join('')}</row>`).join('')}</sheetData></worksheet>`
}

// Style indices: 0 General/no fill · 1 date · 2 navy · 3 green · 4 theme3@0.4 · 5 unknown grey
const STYLES = `<styleSheet>
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF002060"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor theme="3" tint="0.39997558519241921"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF808080"/></patternFill></fill>
</fills>
<cellXfs count="6">
<xf numFmtId="0" fillId="0"/>
<xf numFmtId="164" fillId="0"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fillId="2" applyFill="1"/>
<xf numFmtId="0" fillId="3" applyFill="1"/>
<xf numFmtId="0" fillId="4" applyFill="1"/>
<xf numFmtId="0" fillId="5" applyFill="1"/>
</cellXfs></styleSheet>`

// clrScheme in DOCUMENT order (dk1, lt1, dk2, lt2, ...) — the reader remaps.
const THEME = `<a:theme xmlns:a="x"><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2>
<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
</a:clrScheme></a:themeElements></a:theme>`

function workbook(sheets: { name: string; cells: Cell[] }[], shared: string[], opts: { theme?: boolean } = {}): Buffer {
  const wb = sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  const rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
  const parts = [
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'xl/workbook.xml', content: `<workbook><sheets>${wb}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<Relationships>${rels}</Relationships>` },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/sharedStrings.xml', content: `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s.cells) })),
  ]
  if (opts.theme !== false) parts.push({ name: 'xl/theme/theme1.xml', content: THEME })
  return zipOf(parts)
}

const MONTH0 = 46000
const monthSerial = (i: number) => MONTH0 + i * 30

// Shared-string indices
const S = {
  aporte: 0, dividendo: 1, distribucion: 2, header: 3, privateDebt: 4, usd: 5,
  fund: 6, socA: 7, socB: 8, realAssets: 9, eur: 10, fund2: 11, curncy: 12, inicial: 13,
}
const SHARED = [
  'Aporte', 'Dividendo', 'Distribución', 'Nombre de la Inversión', 'Private Debt',
  'inversiones en dólares', 'FI Compass', 'NAIDELT', 'RETBOY', 'Real Assets',
  'inversiones en euros', 'Euro Fund II', 'EUR Curncy', 'Inversión Inicial',
]

interface AltOpts {
  noLegend?: boolean
  noTheme?: boolean
  orphanHolding?: boolean
  derivedMismatch?: boolean
  unclassifiedNonZero?: boolean
  unknownFillNonZero?: boolean
  withResumenSheet?: boolean
}

function altWorkbook(o: AltOpts = {}): Buffer {
  const cells: Cell[] = []
  const HEADER = 5
  const T0 = 14 // first timeline column (N)

  // Legend above the header row. Column DC-equivalent = last timeline column.
  const legendCol = T0 + 2
  if (!o.noLegend) {
    cells.push({ ref: `${indexToColumn(legendCol)}1`, t: 's', v: S.aporte, s: 2 })
    cells.push({ ref: `${indexToColumn(legendCol)}2`, t: 's', v: S.dividendo, s: 3 })
    cells.push({ ref: `${indexToColumn(legendCol)}3`, t: 's', v: S.distribucion, s: 4 })
  }

  cells.push({ ref: `B${HEADER}`, t: 's', v: S.header })
  for (let i = 0; i < 3; i++) {
    cells.push({ ref: `${indexToColumn(T0 + i)}${HEADER}`, v: monthSerial(i), s: 1 })
  }

  // Private Debt / USD
  cells.push({ ref: 'B7', t: 's', v: S.privateDebt }, { ref: 'D7', t: 's', v: S.usd })
  cells.push({ ref: 'B8', t: 's', v: S.fund })
  // holding row: capital 100, contributions 40, unfunded 60 (or mismatched)
  cells.push(
    { ref: 'B9', t: 's', v: S.fund }, { ref: 'C9', t: 's', v: S.socA },
    { ref: 'D9', v: 100 }, { ref: 'E9', v: 40 }, { ref: 'F9', v: o.derivedMismatch ? 99 : 60 },
    { ref: 'G9', v: monthSerial(2), s: 1 },
    { ref: 'H9', v: 70 }, { ref: 'I9', v: 5 }, { ref: 'J9', v: 75 },
    { ref: 'K9', v: 0.11 }, { ref: 'L9', v: 0.12 },
  )
  // events: aporte (negative, navy), dividendo (positive, green), distribución (theme3)
  cells.push({ ref: `${indexToColumn(T0)}9`, v: -25, s: 2 })
  cells.push({ ref: `${indexToColumn(T0 + 1)}9`, v: 10, s: 3 })
  cells.push({ ref: `${indexToColumn(T0 + 2)}9`, v: 15, s: 4 })

  // second sociedad on the same fund, with an uncoloured zero (padding)
  cells.push(
    { ref: 'B10', t: 's', v: S.fund }, { ref: 'C10', t: 's', v: S.socB },
    { ref: 'D10', v: 50 }, { ref: 'E10', v: 50 }, { ref: 'F10', v: 0 },
    { ref: 'G10', t: 's', v: S.inicial },
    { ref: 'H10', v: 20 }, { ref: 'I10', v: 0 }, { ref: 'J10', v: 20 },
  )
  cells.push({ ref: `${indexToColumn(T0)}10`, v: 0, s: 0 })
  if (o.unclassifiedNonZero) cells.push({ ref: `${indexToColumn(T0 + 1)}10`, v: 1234, s: 0 })
  if (o.unknownFillNonZero) cells.push({ ref: `${indexToColumn(T0 + 2)}10`, v: 999, s: 5 })

  // Real Assets / EUR — proves multi-currency grouping
  cells.push({ ref: 'B12', t: 's', v: S.realAssets }, { ref: 'D12', t: 's', v: S.eur })
  cells.push({ ref: 'B13', t: 's', v: S.fund2 })
  cells.push(
    { ref: 'B14', t: 's', v: S.fund2 }, { ref: 'C14', t: 's', v: S.socA },
    { ref: 'D14', v: 200 }, { ref: 'E14', v: 80 }, { ref: 'F14', v: 120 },
    { ref: 'H14', v: 90 }, { ref: 'I14', v: 0 }, { ref: 'J14', v: 90 },
  )

  if (o.orphanHolding) {
    // A holding row ABOVE any category header.
    cells.push({ ref: 'B6', t: 's', v: S.fund }, { ref: 'C6', t: 's', v: S.socA }, { ref: 'D6', v: 1 })
  }

  // Technical zone — `… Curncy` tickers; everything below is excluded.
  cells.push({ ref: 'E20', t: 's', v: S.curncy }, { ref: 'B21', t: 's', v: S.fund }, { ref: 'C21', t: 's', v: S.socA }, { ref: 'D21', v: 999999 })

  const sheets = [{ name: 'Alternatives', cells }]
  if (o.withResumenSheet) sheets.unshift({ name: 'RESUMEN', cells: [{ ref: 'B1', t: 's', v: S.fund }] })
  return workbook(sheets, SHARED, { theme: !o.noTheme })
}

// ---------------------------------------------------------------------------
// 1 - Theme index and tint
// ---------------------------------------------------------------------------

describe('theme resolution (doc 03 section 3.2)', () => {
  test('theme=3 resolves to dk2, NOT lt2', () => {
    const t = parseThemeColours(THEME)
    assert.equal(t[3], '#1F497D', 'theme index 3 must be dk2')
    assert.equal(t[2], '#EEECE1', 'theme index 2 must be lt2')
    assert.equal(t[0], '#FFFFFF', 'theme index 0 must be lt1')
    assert.equal(t[1], '#000000', 'theme index 1 must be dk1')
  })

  test('inverting the mapping would turn Distribución near-white', () => {
    const t = parseThemeColours(THEME)
    assert.notEqual(t[3], '#EEECE1', 'the classic inversion bug')
  })

  test('a positive tint lightens and a negative tint darkens, preserving hue', () => {
    const lighter = applyTint('#1F497D', 0.4)
    const darker = applyTint('#1F497D', -0.4)
    const base = rgbToHsl(hexToRgb('#1F497D')!)
    assert.ok(rgbToHsl(hexToRgb(lighter)!).l > base.l)
    assert.ok(rgbToHsl(hexToRgb(darker)!).l < base.l)
    assert.ok(Math.abs(rgbToHsl(hexToRgb(lighter)!).h - base.h) < 1, 'tint must not move hue')
  })
})

// ---------------------------------------------------------------------------
// 2 - Fill resolution
// ---------------------------------------------------------------------------

describe('fill resolution preserves provenance and fails closed', () => {
  const theme = parseThemeColours(THEME)

  test('an rgb fill resolves and keeps its raw form', () => {
    const r = resolveFill({ rgb: 'FF002060', theme: null, tint: null, indexed: null, patternType: 'solid' }, theme)
    assert.equal(r.hex, '#002060')
    assert.equal(r.raw, 'rgb:FF002060')
    assert.equal(r.unfilled, false)
  })

  test('a theme+tint fill resolves through the remapped palette', () => {
    const r = resolveFill({ rgb: null, theme: 3, tint: 0.4, indexed: null, patternType: 'solid' }, theme)
    assert.equal(r.raw, 'theme:3@0.4')
    assert.ok(r.hex && r.hex !== '#1F497D', 'the tint must be applied')
  })

  test('an unresolvable theme index yields null, never a fallback colour', () => {
    const r = resolveFill({ rgb: null, theme: 99, tint: null, indexed: null, patternType: 'solid' }, theme)
    assert.equal(r.hex, null)
    assert.equal(r.unfilled, false, 'it is filled but unresolvable — not the same as unfilled')
  })

  test('no fill is reported as unfilled', () => {
    assert.equal(resolveFill(null, theme).unfilled, true)
  })
})

// ---------------------------------------------------------------------------
// 3 - Legend matching
// ---------------------------------------------------------------------------

describe('legend classification', () => {
  const legend: LegendEntry[] = [
    { event: 'aporte', hex: '#002060', raw: 'rgb:FF002060' },
    { event: 'dividendo', hex: '#92D050', raw: 'rgb:FF92D050' },
    { event: 'distribucion', hex: applyTint('#1F497D', 0.4), raw: 'theme:3@0.4' },
  ]

  test('exact matches classify by legend_exact', () => {
    const r = classifyFill({ hex: '#002060', unfilled: false, raw: 'rgb:FF002060' }, legend)
    assert.equal(r.event, 'aporte')
    assert.equal(r.method, 'legend_exact')
  })

  test('navy and tinted medium blue stay distinct — the doc-critical pair', () => {
    // They are only ~7 degrees apart in HUE, so the hue gate alone cannot
    // separate them; the nearest-by-deltaE half of the rule is what does.
    const navy = rgbToHsl(hexToRgb('#002060')!)
    const medium = rgbToHsl(hexToRgb(legend[2].hex)!)
    assert.ok(Math.abs(navy.h - medium.h) < HUE_TOLERANCE_DEGREES,
      'both pass the hue gate — so deltaE must do the work')

    const asNavy = classifyFill({ hex: '#002060', unfilled: false, raw: null }, legend)
    const asMedium = classifyFill({ hex: legend[2].hex, unfilled: false, raw: null }, legend)
    assert.equal(asNavy.event, 'aporte')
    assert.equal(asMedium.event, 'distribucion')
  })

  test('a genuine tint of navy still matches Aporte by family', () => {
    const shade = applyTint('#002060', -0.1)
    const r = classifyFill({ hex: shade, unfilled: false, raw: null }, legend)
    assert.equal(r.event, 'aporte')
    assert.equal(r.method, 'legend_family')
  })

  test('an unrelated colour is unclassified, never guessed', () => {
    const r = classifyFill({ hex: '#FF00FF', unfilled: false, raw: null }, legend)
    assert.equal(r.event, 'unclassified')
    assert.equal(r.method, null)
  })

  test('an equidistant fill is ambiguous rather than a coin flip', () => {
    const twins: LegendEntry[] = [
      { event: 'aporte', hex: '#002060', raw: null },
      { event: 'distribucion', hex: '#002061', raw: null },
    ]
    const r = classifyFill({ hex: '#002062', unfilled: false, raw: null }, twins)
    assert.equal(r.ambiguous, true)
    assert.equal(r.event, 'unclassified')
  })

  test('deltaE separates the navy/medium-blue pair by a wide margin', () => {
    const d = deltaE(hexToRgb('#002060')!, hexToRgb(legend[2].hex)!)
    assert.ok(d > 50, `expected a wide separation, got ${d}`)
  })
})

// ---------------------------------------------------------------------------
// 4 - Parser end to end
// ---------------------------------------------------------------------------

describe('parseAlternatives', () => {
  test('a canonical sheet parses', () => {
    const d = parseAlternatives(altWorkbook())
    assert.equal(d.ok, true, JSON.stringify(d.findings))
    assert.equal(d.parserVersion, ALTERNATIVES_PARSER_VERSION)
    assert.equal(d.legend.length, 3)
    assert.equal(d.holdings.length, 3)
  })

  test('the three event types classify correctly with the documented signs', () => {
    const d = parseAlternatives(altWorkbook())
    const byType = (t: string) => d.events.filter((e) => e.eventType === t)
    assert.equal(byType('aporte').length, 1)
    assert.equal(byType('dividendo').length, 1)
    assert.equal(byType('distribucion').length, 1)
    assert.ok(byType('aporte')[0].amount < 0, 'Aporte is cash out')
    assert.ok(byType('dividendo')[0].amount > 0, 'Dividendo is cash in')
    assert.ok(byType('distribucion')[0].amount > 0, 'Distribución is cash in')
  })

  test('(category, currency) is the grouping key and currencies never mix', () => {
    const d = parseAlternatives(altWorkbook())
    const keys = d.subtotals.map((s) => `${s.category}|${s.currency}`).sort()
    assert.deepEqual(keys, ['Private Debt|dolares', 'Real Assets|euros'])
    for (const h of d.holdings) assert.ok(h.currency.length > 0, 'every holding carries its currency')
  })

  test('NO cross-currency total is ever produced', () => {
    const d = parseAlternatives(altWorkbook())
    const currencies = new Set(d.subtotals.map((s) => s.currency))
    assert.ok(currencies.size > 1, 'the fixture is multi-currency')
    // Every subtotal belongs to exactly one currency; there is no combined row.
    for (const s of d.subtotals) assert.ok(s.currency && s.category)
    assert.equal(d.subtotals.filter((s) => s.currency === '').length, 0)
  })

  test('a zero uncoloured cell is silent padding', () => {
    const d = parseAlternatives(altWorkbook())
    assert.ok(!d.findings.some((f) => f.code === 'unclassified_event'),
      'a zero uncoloured cell must not warn')
    assert.ok(!d.events.some((e) => e.amount === 0), 'a zero produces no event row')
  })

  test('a NON-ZERO uncoloured cell requires administrator classification', () => {
    const d = parseAlternatives(altWorkbook({ unclassifiedNonZero: true }))
    const w = d.findings.find((f) => f.code === 'unclassified_event')
    assert.ok(w, 'a non-zero uncoloured cell must warn')
    assert.equal(w.severity, 'warning', 'it warns — it does not block')
    assert.equal(d.ok, true, 'the draft still parses')
    assert.ok(d.events.some((e) => e.eventType === 'unclassified'))
  })

  test('a non-zero UNKNOWN fill is also unclassified, never guessed', () => {
    const d = parseAlternatives(altWorkbook({ unknownFillNonZero: true }))
    assert.ok(d.events.some((e) => e.eventType === 'unclassified' && e.resolvedHex !== null))
  })

  test('a missing legend blocks', () => {
    const d = parseAlternatives(altWorkbook({ noLegend: true }))
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.severity === 'blocking' && f.code === 'alternatives_legend_missing'))
  })

  test('a missing theme part makes the theme legend colour unresolvable and blocks', () => {
    const d = parseAlternatives(altWorkbook({ noTheme: true }))
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.code === 'alternatives_legend_missing'),
      'an unresolvable legend colour must not silently reduce the palette')
  })

  test('a holding with no category above it blocks', () => {
    const d = parseAlternatives(altWorkbook({ orphanHolding: true }))
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.code === 'alternatives_orphan_holding_row'))
  })

  test('the derived columns are cross-checked, not corrected', () => {
    const d = parseAlternatives(altWorkbook({ derivedMismatch: true }))
    const w = d.findings.find((f) => f.code === 'alternatives_derived_mismatch')
    assert.ok(w, 'a derived mismatch must warn')
    assert.equal(w.severity, 'warning', 'never a block')
    const h = d.holdings.find((x) => x.sociedad === 'NAIDELT')!
    assert.equal(h.unfunded, 99, 'the CACHED source value is stored, not the recomputation')
  })

  test('the technical zone is excluded', () => {
    const d = parseAlternatives(altWorkbook())
    assert.ok(!d.holdings.some((h) => h.capitalCommitted === 999999),
      'rows at or below the Curncy tickers must never be ingested')
  })

  test('an Upload B containing RESUMEN never ingests portfolio data', () => {
    const bytes = altWorkbook({ withResumenSheet: true })
    const r = readXlsx(bytes)
    assert.equal(r.ok, true); if (!r.ok) return
    // The RESUMEN sheet is present in the container...
    assert.ok(r.workbook.sheets.some((s) => s.name === 'RESUMEN'))
    // ...and is ignored: selection resolves to Alternatives only.
    assert.equal(findAlternativesSheet(r.workbook.sheets)!.name, 'Alternatives')

    const d = parseAlternatives(bytes)
    assert.equal(d.ok, true)
    for (const h of d.holdings) {
      assert.equal(h.sourceSheet, 'Alternatives', 'no row may originate from RESUMEN')
    }
    for (const e of d.events) assert.equal(e.sourceSheet, 'Alternatives')
  })

  test('a non-date statement label is preserved verbatim, never coerced', () => {
    const d = parseAlternatives(altWorkbook())
    const h = d.holdings.find((x) => x.sociedad === 'RETBOY')!
    assert.equal(h.lastStatementDate, null)
    assert.equal(h.lastStatementLabel, 'Inversión Inicial')
  })

  test('TIR Calculada is ingested as a cached source value', () => {
    const d = parseAlternatives(altWorkbook())
    const h = d.holdings.find((x) => x.sociedad === 'NAIDELT')!
    assert.equal(h.calculatedIrr, 0.12)
  })

  test('every event carries full provenance including the raw fill', () => {
    const d = parseAlternatives(altWorkbook())
    for (const e of d.events) {
      assert.match(e.sourceCell, /^Alternatives![A-Z]+[0-9]+$/)
      assert.ok(e.sourceRow > 0)
      assert.ok(e.currency.length > 0)
      if (e.eventType !== 'unclassified') {
        assert.ok(e.rawFill, 'a classified event must record the raw fill it came from')
        assert.ok(e.classificationMethod)
      }
    }
  })

  test('parsing is deterministic', () => {
    const b = altWorkbook()
    assert.deepEqual(parseAlternatives(b).events, parseAlternatives(b).events)
  })

  test('no finding leaks a source amount', () => {
    const d = parseAlternatives(altWorkbook({ unclassifiedNonZero: true, derivedMismatch: true }))
    for (const f of d.findings) assert.ok(!/\d{3,}/.test(f.detail), `leaked: ${f.detail}`)
  })

  test('a workbook with no Alternatives sheet is refused', () => {
    const d = parseAlternatives(workbook([{ name: 'RESUMEN', cells: [{ ref: 'A1', v: 1 }] }], SHARED))
    assert.equal(d.ok, false)
    assert.ok(d.findings.some((f) => f.code === 'alternatives_sheet_not_found'))
  })

  test('detectLegend reads the workbook legend, never a hardcoded palette', () => {
    const r = readXlsx(altWorkbook())
    assert.equal(r.ok, true); if (!r.ok) return
    const sheet = r.workbook.sheets[0]
    const legend = detectLegend(sheet, 5, r.workbook.themeColours)
    assert.equal(legend.length, 3)
    assert.equal(legend.find((l) => l.event === 'aporte')!.hex, '#002060')
  })
})

// ---------------------------------------------------------------------------
// 5 - Style/fill regression (doc 03 section 5)
// ---------------------------------------------------------------------------

describe('the fill half of styles is parsed with the same discipline', () => {
  test('fills are indexed by fillId, across both xf element forms', () => {
    const st = parseStyles(STYLES)
    assert.equal(st.isDate.length, 6)
    assert.equal(st.fill[0], null, 'patternType none is unfilled')
    assert.equal(st.fill[2]?.rgb, 'FF002060')
    assert.equal(st.fill[4]?.theme, 3)
    assert.ok((st.fill[4]?.tint ?? 0) > 0.39)
  })
})

// ---------------------------------------------------------------------------
// 6 - Migration posture
// ---------------------------------------------------------------------------

describe('the R13.4 migration', () => {
  const SQL = read('supabase/migrations/20260809000000_family_portfolio_alternatives.sql')

  test('creates both alternatives tables', () => {
    assert.match(SQL, /create table if not exists public\.alternatives_holdings/)
    assert.match(SQL, /create table if not exists public\.alternatives_events/)
  })

  test('currency is mandatory on both tables', () => {
    assert.match(SQL, /currency\s+text\s+not null/)
    assert.match(SQL, /currency must be NOT NULL/)
  })

  test('reads are scope-filtered through the R13.1 helper', () => {
    assert.match(SQL, /using \(public\.nmi_can_access_scope\(scope\)\)/)
  })

  test('only SELECT policies exist', () => {
    for (const p of SQL.match(/create policy[\s\S]*?;/g) ?? []) assert.match(p, /for select/)
  })

  test('event_type can represent unclassified and classification provenance is enforced', () => {
    assert.match(SQL, /'aporte','dividendo','distribucion','unclassified'/)
    assert.match(SQL, /alternatives_events_method_check/)
  })

  test('the (investment x sociedad) grain is unique', () => {
    assert.match(SQL, /unique \(publication_id, category, currency, investment_name, sociedad\)/)
  })

  test('it guards on R13.1 and R13.3 and asserts its own end state', () => {
    assert.match(SQL, /nmi_can_access_scope\(text\)/)
    assert.match(SQL, /portfolio_publications is missing/)
    assert.match(SQL, /raise exception/)
    assert.match(SQL, /has_table_privilege\('anon'/)
  })

  test('it sorts after R13.3 and follows the naming convention', () => {
    assert.match('20260809000000_family_portfolio_alternatives.sql', /^\d{14}_[a-z0-9_]+\.sql$/)
    assert.ok('20260809000000' > '20260808000000')
  })
})
