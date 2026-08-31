// R13.R4A.5 — multi-select filters, and the arithmetic behind the Dashboard's
// Current Value KPI.
//
// TWO HALVES, AND THE FIRST IS THE REASON THE SECOND IS SAFE TO CHANGE.
//
// 1 · RECONCILIATION. The owner could not reproduce the USD Current Value by
//     hand, so this file locks the chain that produces it: which rows of the
//     workbook become holdings, that each one is summed exactly once, that no
//     aggregate row joins its own children, and that the figure on screen is
//     the whole-unit rendering of that exact sum. The workbook is driven
//     through the REAL parser and the REAL view model — no re-implementation of
//     either, because a reconciliation computed a second way proves only that
//     the second way agrees with itself.
//
// 2 · MULTI-SELECT. Every dimension became a set in this pass. The contract —
//     OR within a dimension, AND across dimensions, and the empty set as the
//     single spelling of "all" — is asserted on the pure module, then the three
//     views are checked to read that one narrowed set rather than each deriving
//     its own.
//
// NO PRIVATE SOURCE DATA. The workbook below is synthetic and built in memory.
// Its STRUCTURE mirrors the real sheet — three categories under one currency, a
// category name reused under a second currency, funds held by several
// sociedades at once, and a technical-zone roll-up that repeats the detail —
// while every amount is invented. That is the standing fixture policy in this
// repo (the structured-notes issuer fixtures set it), and it is what lets the
// awkward cases be tested without committing the family's own figures.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import { parseAlternatives } from '../src/lib/familyPortfolio/alternatives/parseAlternatives.ts'
import {
  clampPopoverLeft,
  POPOVER_GUTTER_PX,
} from '../src/lib/familyPortfolio/alternatives/popoverPosition.ts'
import { indexToColumn } from '../src/lib/familyPortfolio/xlsx/cellRef.ts'
import {
  applyEventFilter,
  applyHoldingFilter,
  currencyCashFlows,
  currencyPositions,
  eventsInPeriods,
  filterOptions,
  groupHoldings,
  isFilterActive,
  matchesSelection,
  periodColumns,
  toggleSelection,
  EMPTY_FILTER,
  type AlternativesEventRead,
  type AlternativesHoldingRead,
} from '../src/lib/familyPortfolio/alternativesView.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const DASHBOARD = 'src/app/portfolio/alternatives/page.tsx'
const HOLDINGS_PAGE = 'src/app/portfolio/alternatives/holdings/page.tsx'
const CASHFLOWS = 'src/app/portfolio/alternatives/cash-flows/page.tsx'
const FILTERS = 'src/components/familyPortfolio/AlternativesFilters.tsx'
const VIEW = 'src/lib/familyPortfolio/alternativesView.ts'

/** Source with comments stripped, so a doc reference never satisfies a check. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
}

// ===========================================================================
// A synthetic workbook shaped like the real Alternatives sheet
// ===========================================================================

interface Cell {
  ref: string
  v?: number | string
  t?: 's' | 'e'
  s?: number
}

function zipOf(parts: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const p of parts) {
    const nb = Buffer.from(p.name, 'utf8')
    const raw = Buffer.from(p.content, 'utf8')
    const comp = deflateRawSync(raw)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(8, 8)
    l.writeUInt32LE(comp.length, 18)
    l.writeUInt32LE(raw.length, 22)
    l.writeUInt16LE(nb.length, 26)
    locals.push(l, nb, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(8, 10)
    c.writeUInt32LE(comp.length, 20)
    c.writeUInt32LE(raw.length, 24)
    c.writeUInt16LE(nb.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, nb)
    offset += l.length + nb.length + comp.length
  }
  const cd = Buffer.concat(central)
  const lb = Buffer.concat(locals)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0)
  e.writeUInt16LE(parts.length, 8)
  e.writeUInt16LE(parts.length, 10)
  e.writeUInt32LE(cd.length, 12)
  e.writeUInt32LE(lb.length, 16)
  return Buffer.concat([lb, cd, e])
}

function sheetXml(cells: Cell[]): string {
  const byRow = new Map<number, Cell[]>()
  for (const c of cells) {
    const r = Number(/[0-9]+$/.exec(c.ref)![0])
    if (!byRow.has(r)) byRow.set(r, [])
    byRow.get(r)!.push(c)
  }
  return `<worksheet><sheetData>${[...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([r, cs]) =>
        `<row r="${r}">${cs
          .map(
            (c) =>
              `<c r="${c.ref}"${c.t ? ` t="${c.t}"` : ''}${c.s !== undefined ? ` s="${c.s}"` : ''}>${
                c.v === undefined ? '' : `<v>${c.v}</v>`
              }</c>`,
          )
          .join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`
}

// 0 no fill · 1 date · 2 navy (aporte) · 3 green (dividendo) · 4 theme3 (distribución)
const STYLES = `<styleSheet>
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF002060"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor theme="3" tint="0.39997558519241921"/></patternFill></fill>
</fills>
<cellXfs count="5">
<xf numFmtId="0" fillId="0"/>
<xf numFmtId="164" fillId="0"/>
<xf numFmtId="0" fillId="2" applyFill="1"/>
<xf numFmtId="0" fillId="3" applyFill="1"/>
<xf numFmtId="0" fillId="4" applyFill="1"/>
</cellXfs></styleSheet>`

const THEME = `<a:theme xmlns:a="x"><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2>
<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
</a:clrScheme></a:themeElements></a:theme>`

const SHARED = [
  'Aporte', // 0
  'Dividendo', // 1
  'Distribución', // 2
  'Nombre de la Inversión', // 3
  'inversiones en dólares', // 4
  'inversiones en euros', // 5
  'Private Debt', // 6
  'Private Equity', // 7
  'Real Assets', // 8
  'Compass Fund', // 9
  'Trinity Fund II', // 10
  'Drake Fund V', // 11
  'Aurora Holdings', // 12
  'Med Estate I', // 13
  'LA ESPERANZA', // 14
  'WATERMILL', // 15
  'STATEN', // 16
  'NAIDELT', // 17
  'RETBOY', // 18
  'COVAL', // 19
  'EUR Curncy', // 20
  'Total', // 21
  'Dólares', // 22
]
const S = {
  aporte: 0, dividendo: 1, distribucion: 2, header: 3,
  usd: 4, eur: 5,
  privateDebt: 6, privateEquity: 7, realAssets: 8,
  compass: 9, trinity: 10, drake: 11, aurora: 12, med: 13,
  esperanza: 14, watermill: 15, staten: 16, naidelt: 17, retboy: 18, coval: 19,
  curncy: 20, total: 21, dolares: 22,
}

const MONTH0 = 45000
const monthSerial = (i: number) => MONTH0 + i * 31

/**
 * The eight USD rows, with FICTIONAL values chosen so the total carries a
 * fraction that rounds UP — the real workbook's total ends in a fraction too,
 * and a fixture whose sum happened to be whole would not exercise the one
 * thing the owner's manual reconciliation could plausibly have tripped on.
 */
const USD_ROWS = [
  { row: 10, category: 'Private Debt', investment: 'Compass Fund', sociedad: 'LA ESPERANZA', value: 100000.4 },
  { row: 15, category: 'Private Equity', investment: 'Trinity Fund II', sociedad: 'WATERMILL', value: 250000.4 },
  { row: 16, category: 'Private Equity', investment: 'Trinity Fund II', sociedad: 'STATEN', value: 125000.4 },
  { row: 17, category: 'Private Equity', investment: 'Trinity Fund II', sociedad: 'NAIDELT', value: 75000.4 },
  { row: 20, category: 'Private Equity', investment: 'Drake Fund V', sociedad: 'NAIDELT', value: 60000.4 },
  { row: 21, category: 'Private Equity', investment: 'Drake Fund V', sociedad: 'RETBOY', value: 40000.4 },
  { row: 25, category: 'Real Assets', investment: 'Aurora Holdings', sociedad: 'COVAL', value: 30000.4 },
  { row: 26, category: 'Real Assets', investment: 'Aurora Holdings', sociedad: 'WATERMILL', value: 9999.44479 },
] as const

/** The exact sum, as decimal arithmetic rather than a float accumulation. */
const USD_EXACT = 690002.24479
/** What the KPI prints — whole units, the app's own amount formatting. */
const USD_DISPLAYED = 690002

/**
 * Agreement at a scale far below the smallest unit anything is reported in.
 *
 * `columnSum` adds IEEE doubles, so its total differs from exact decimal
 * arithmetic in the last bits — on this fixture by about 1e-10 on a figure of
 * 690,002. Asserting strict float equality against a decimal constant would
 * fail for that reason alone and would be testing IEEE-754, not the
 * reconciliation. What matters, and what is asserted, is that the two agree far
 * inside a cent and therefore round to the same reported figure.
 */
function assertReconciles(actual: number | null, expected: number, what: string): void {
  assert.ok(actual !== null, `${what}: unavailable`)
  assert.ok(
    Math.abs(actual - expected) < 1e-5,
    `${what}: ${actual} does not reconcile to ${expected}`,
  )
}

function altWorkbook(): Buffer {
  const cells: Cell[] = []
  const HEADER = 5
  const T0 = 14
  const legendCol = T0 + 2
  cells.push({ ref: `${indexToColumn(legendCol)}1`, t: 's', v: S.aporte, s: 2 })
  cells.push({ ref: `${indexToColumn(legendCol)}2`, t: 's', v: S.dividendo, s: 3 })
  cells.push({ ref: `${indexToColumn(legendCol)}3`, t: 's', v: S.distribucion, s: 4 })
  cells.push({ ref: `B${HEADER}`, t: 's', v: S.header })
  for (let i = 0; i < 3; i++) {
    cells.push({ ref: `${indexToColumn(T0 + i)}${HEADER}`, v: monthSerial(i), s: 1 })
  }

  const sid: Record<string, number> = {
    'LA ESPERANZA': S.esperanza, WATERMILL: S.watermill, STATEN: S.staten,
    NAIDELT: S.naidelt, RETBOY: S.retboy, COVAL: S.coval,
  }
  const iid: Record<string, number> = {
    'Compass Fund': S.compass, 'Trinity Fund II': S.trinity,
    'Drake Fund V': S.drake, 'Aurora Holdings': S.aurora,
  }
  const cid: Record<string, number> = {
    'Private Debt': S.privateDebt, 'Private Equity': S.privateEquity, 'Real Assets': S.realAssets,
  }

  // Category header, investment row, then its holding rows — the real shape.
  let lastCategory = ''
  let lastInvestment = ''
  for (const r of USD_ROWS) {
    if (r.category !== lastCategory) {
      cells.push({ ref: `B${r.row - 3}`, t: 's', v: cid[r.category] }, { ref: `D${r.row - 3}`, t: 's', v: S.usd })
      lastCategory = r.category
      lastInvestment = ''
    }
    if (r.investment !== lastInvestment) {
      cells.push({ ref: `B${r.row - 1}`, t: 's', v: iid[r.investment] })
      lastInvestment = r.investment
    }
    cells.push(
      // Column B on a holding row carries the LEGAL ENTITY, not the fund — the
      // fund name comes from the investment row above it. Reproduced because
      // reading B as the investment name is exactly how a hand reconciliation
      // loses track of which rows belong to which fund.
      { ref: `B${r.row}`, t: 's', v: sid[r.sociedad] },
      { ref: `C${r.row}`, t: 's', v: sid[r.sociedad] },
      { ref: `J${r.row}`, v: r.value },
    )
  }

  // One event per timeline column on the first holding, so the fixture carries
  // a real event stream without making the amounts meaningful.
  cells.push({ ref: `${indexToColumn(T0)}10`, v: -500, s: 2 })
  cells.push({ ref: `${indexToColumn(T0 + 1)}15`, v: 120, s: 3 })
  cells.push({ ref: `${indexToColumn(T0 + 2)}25`, v: 80, s: 4 })

  // `Real Assets` again, under a DIFFERENT currency — the case that makes
  // category alone an ambiguous key, and the one a hand reconciliation folds
  // into the USD block by accident.
  cells.push({ ref: 'B30', t: 's', v: S.realAssets }, { ref: 'D30', t: 's', v: S.eur })
  cells.push({ ref: 'B32', t: 's', v: S.med })
  cells.push({ ref: 'B33', t: 's', v: S.coval }, { ref: 'C33', t: 's', v: S.coval }, { ref: 'J33', v: 777777 })

  // TECHNICAL ZONE — the workbook's own roll-up, which repeats every USD figure
  // and adds its own `Total`. It sits below a `… Curncy` ticker and must never
  // reach a holding: summing it alongside the detail is the single largest
  // double-count available in this sheet.
  cells.push({ ref: 'E40', t: 's', v: S.curncy })
  cells.push({ ref: 'D42', t: 's', v: S.dolares })
  cells.push({ ref: 'B44', t: 's', v: S.coval }, { ref: 'C44', t: 's', v: S.coval }, { ref: 'D44', v: USD_EXACT })
  cells.push({ ref: 'C46', t: 's', v: S.total }, { ref: 'D46', v: USD_EXACT }, { ref: 'J46', v: USD_EXACT })

  return zipOf([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: 'xl/workbook.xml', content: '<workbook><sheets><sheet name="Alternatives" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/sharedStrings.xml', content: `<sst>${SHARED.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(cells) },
    { name: 'xl/theme/theme1.xml', content: THEME },
  ])
}

/** The parsed draft, promoted to the shape the member read model consumes. */
function parsedHoldings(): AlternativesHoldingRead[] {
  const draft = parseAlternatives(altWorkbook())
  assert.equal(draft.ok, true, JSON.stringify(draft.findings))
  return draft.holdings.map((h, i) => ({
    id: `h${i}`,
    category: h.category,
    currency: h.currency,
    investmentName: h.investmentName,
    sociedad: h.sociedad,
    capitalCommitted: h.capitalCommitted,
    contributions: h.contributions,
    unfunded: h.unfunded,
    lastStatementDate: h.lastStatementDate,
    lastStatementLabel: h.lastStatementLabel,
    lastValuation: h.lastValuation,
    flowSinceStatement: h.flowSinceStatement,
    currentValue: h.currentValue,
    reportedIrr: h.reportedIrr,
    calculatedIrr: h.calculatedIrr,
  }))
}

/**
 * Exact decimal sum, in hundred-thousandths — never a float accumulation.
 *
 * Each value is read off its own DECIMAL rendering rather than multiplied, so
 * the integer is exact by construction rather than by a rounding that happens
 * to land. Amounts here stay far below `Number.MAX_SAFE_INTEGER` once scaled,
 * so plain integers suffice; BigInt literals would need an ES2020 target this
 * project's tsconfig does not set.
 */
function exactSum(values: ReadonlyArray<number | null>): number {
  let units = 0
  for (const v of values) {
    if (v === null) continue
    const [i, f] = v.toFixed(5).split('.')
    const whole = Number(i)
    const frac = Number(f)
    units += whole * 100000 + (i.startsWith('-') ? -frac : frac)
  }
  return units / 1e5
}

// ===========================================================================
// 1 · The Current Value KPI reconciles to its own rows, exactly
// ===========================================================================

describe('R13.R4A.5 · Current Value reconciles to the source rows', () => {
  test('the KPI is the plain sum of that currency’s holding rows, to the cent', () => {
    const usd = currencyPositions(parsedHoldings()).find((p) => p.currency === 'dolares')
    assert.ok(usd)
    assertReconciles(usd.currentValue.value, exactSum(USD_ROWS.map((r) => r.value)), 'row sum')
    assertReconciles(usd.currentValue.value, USD_EXACT, 'exact decimal sum')
    // Rounded to the reported precision the two are the same number.
    assert.equal(usd.currentValue.value!.toFixed(5), USD_EXACT.toFixed(5))
    // Nothing was dropped, so the sum is complete rather than partial.
    assert.equal(usd.currentValue.missing, 0)
  })

  test('the displayed figure is that exact sum in whole units — no other rounding', () => {
    const usd = currencyPositions(parsedHoldings()).find((p) => p.currency === 'dolares')!
    assert.equal(Math.round(usd.currentValue.value!), USD_DISPLAYED)
    // The fraction genuinely moves the printed figure, so a reconciliation that
    // summed row-by-row ROUNDED values would land on a different number — the
    // most likely way a hand check misses by one.
    assert.notEqual(
      USD_ROWS.reduce((s, r) => s + Math.round(r.value), 0),
      USD_DISPLAYED,
    )
  })

  test('every source row appears exactly once, at the (investment × sociedad) grain', () => {
    const usd = parsedHoldings().filter((h) => h.currency === 'dolares')
    assert.equal(usd.length, USD_ROWS.length)
    const keys = usd.map((h) => `${h.investmentName}\u0000${h.sociedad}`)
    assert.equal(new Set(keys).size, keys.length, 'a grain key repeats')
    for (const r of USD_ROWS) {
      const match = usd.filter((h) => h.investmentName === r.investment && h.sociedad === r.sociedad)
      assert.equal(match.length, 1, `${r.investment} / ${r.sociedad}`)
      assert.equal(match[0].currentValue, r.value)
      assert.equal(match[0].category, r.category)
    }
  })

  test('one investment across several sociedades is several holdings and one investment', () => {
    const usd = currencyPositions(parsedHoldings()).find((p) => p.currency === 'dolares')!
    const distinct = new Set(USD_ROWS.map((r) => r.investment)).size
    assert.equal(usd.holdings, USD_ROWS.length)
    assert.equal(usd.investments, distinct)
    assert.ok(usd.holdings > usd.investments, 'the fixture shares funds across sociedades')
    // Deduplicating by fund would UNDERSTATE the position; the rows are
    // different economic holdings that happen to share a fund name.
    assert.equal(usd.sociedades, new Set(USD_ROWS.map((r) => r.sociedad)).size)
  })

  test('the workbook’s own roll-up never joins its children', () => {
    const holdings = parsedHoldings()
    // The technical zone repeats the whole USD total twice — as a sociedad-like
    // row and as a `Total` row. Either one entering would double the KPI.
    assert.equal(holdings.filter((h) => h.currentValue === USD_EXACT).length, 0)
    const usd = currencyPositions(holdings).find((p) => p.currency === 'dolares')!
    assertReconciles(usd.currentValue.value, USD_EXACT, 'roll-up excluded')
    assert.notEqual(Math.round(usd.currentValue.value!), Math.round(USD_EXACT * 2))
  })

  test('a category reused under another currency never joins the USD sum', () => {
    const holdings = parsedHoldings()
    const realAssets = holdings.filter((h) => h.category === 'Real Assets')
    assert.equal(new Set(realAssets.map((h) => h.currency)).size, 2, 'the fixture reuses the name')
    const usd = currencyPositions(holdings).find((p) => p.currency === 'dolares')!
    assertReconciles(usd.currentValue.value, USD_EXACT, 'currency fence')
    // And the grouped view keys on the PAIR, so the two never merge.
    const groups = groupHoldings(holdings).filter((g) => g.category === 'Real Assets')
    assert.equal(groups.length, 2)
    assert.equal(new Set(groups.map((g) => g.currency)).size, 2)
  })

  test('category and sociedad subtotals each re-sum to the same grand total', () => {
    const usd = parsedHoldings().filter((h) => h.currency === 'dolares')
    for (const key of ['category', 'sociedad'] as const) {
      const byKey = new Map<string, number[]>()
      for (const h of usd) byKey.set(h[key], [...(byKey.get(h[key]) ?? []), h.currentValue!])
      const total = exactSum([...byKey.values()].map((vs) => exactSum(vs)))
      assertReconciles(total, USD_EXACT, `${key} subtotals`)
    }
  })

  test('the KPI reads currencyPositions and nothing else', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /sum=\{position\.currentValue\}/)
    assert.match(code, /<CurrentValueHero label=\{t\.kpiCurrentValue\}/)
    // The figure is never recomputed on the page, and never crosses currencies.
    assert.equal(/currentValue[^\n]*\+/.test(code), false)
  })

  test('no cross-currency total exists anywhere in the model', () => {
    const positions = currencyPositions(parsedHoldings())
    assert.ok(positions.length > 1, 'the fixture is multi-currency')
    const view = codeOf(read(VIEW))
    assert.equal(/function\s+\w*grandTotal/i.test(view), false)
    assert.equal(/crossCurrency/i.test(view), false)
    // Every summary is keyed by a currency it names.
    for (const p of positions) assert.ok(p.currency.length > 0)
  })
})

// ===========================================================================
// 2 · The multi-select contract
// ===========================================================================

const HOLDINGS: AlternativesHoldingRead[] = [
  { id: 'h1', category: 'Private Equity', currency: 'dolares', investmentName: 'Fund A', sociedad: 'WATERMILL', capitalCommitted: 100, contributions: 40, unfunded: 60, lastStatementDate: null, lastStatementLabel: null, lastValuation: 50, flowSinceStatement: 0, currentValue: 50, reportedIrr: null, calculatedIrr: null },
  { id: 'h2', category: 'Private Equity', currency: 'euros', investmentName: 'Fund B', sociedad: 'NAIDELT', capitalCommitted: 100, contributions: 40, unfunded: 60, lastStatementDate: null, lastStatementLabel: null, lastValuation: 20, flowSinceStatement: 0, currentValue: 20, reportedIrr: null, calculatedIrr: null },
  { id: 'h3', category: 'Real Assets', currency: 'dolares', investmentName: 'Fund C', sociedad: 'COVAL', capitalCommitted: 100, contributions: 40, unfunded: 60, lastStatementDate: null, lastStatementLabel: null, lastValuation: 30, flowSinceStatement: 0, currentValue: 30, reportedIrr: null, calculatedIrr: null },
  { id: 'h4', category: 'Private Debt', currency: 'pesos', investmentName: 'Fund D', sociedad: 'STATEN', capitalCommitted: 100, contributions: 40, unfunded: 60, lastStatementDate: null, lastStatementLabel: null, lastValuation: 90, flowSinceStatement: 0, currentValue: 90, reportedIrr: null, calculatedIrr: null },
]

const EVENTS: AlternativesEventRead[] = [
  { holdingId: 'h1', eventDate: '2022-11-30', amount: -10, currency: 'dolares', eventType: 'aporte' },
  { holdingId: 'h1', eventDate: '2023-06-30', amount: 20, currency: 'dolares', eventType: 'dividendo' },
  { holdingId: 'h3', eventDate: '2023-09-30', amount: 30, currency: 'dolares', eventType: 'distribucion' },
  { holdingId: 'h3', eventDate: '2024-03-31', amount: -40, currency: 'dolares', eventType: 'aporte' },
  { holdingId: 'h2', eventDate: '2024-05-31', amount: 50, currency: 'euros', eventType: 'dividendo' },
  { holdingId: 'h4', eventDate: '2025-01-31', amount: -60, currency: 'pesos', eventType: 'unclassified' },
]

describe('R13.R4A.5 · set semantics — empty is all, OR within, AND across', () => {
  test('the empty set admits everything, and is the only spelling of “all”', () => {
    assert.equal(matchesSelection('anything', []), true)
    assert.equal(isFilterActive(EMPTY_FILTER), false)
    for (const dim of ['sociedad', 'category', 'currency', 'eventType', 'year'] as const) {
      assert.deepEqual(EMPTY_FILTER[dim], [])
      assert.equal(isFilterActive({ ...EMPTY_FILTER, [dim]: ['x'] }), true)
    }
    assert.equal(applyHoldingFilter(HOLDINGS, EMPTY_FILTER).length, HOLDINGS.length)
    assert.equal(applyEventFilter(EVENTS, HOLDINGS, EMPTY_FILTER).length, EVENTS.length)
  })

  test('several sociedades are a union, not an intersection', () => {
    const both = applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, sociedad: ['WATERMILL', 'COVAL'] })
    assert.deepEqual(both.map((h) => h.id).sort(), ['h1', 'h3'])
    // Each alone is a strict subset of the pair — the definition of OR.
    for (const one of ['WATERMILL', 'COVAL']) {
      const single = applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, sociedad: [one] })
      assert.equal(single.length, 1)
      assert.ok(single.every((h) => both.some((b) => b.id === h.id)))
    }
  })

  test('several categories are a union', () => {
    const rows = applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, category: ['Real Assets', 'Private Debt'] })
    assert.deepEqual(rows.map((h) => h.id).sort(), ['h3', 'h4'])
  })

  test('several currencies are a union', () => {
    const rows = applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, currency: ['dolares', 'euros'] })
    assert.deepEqual(rows.map((h) => h.id).sort(), ['h1', 'h2', 'h3'])
    const events = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, currency: ['euros', 'pesos'] })
    assert.deepEqual(events.map((e) => e.currency).sort(), ['euros', 'pesos'])
  })

  test('several event types are a union, and unclassified is selectable like any other', () => {
    const rows = applyEventFilter(EVENTS, HOLDINGS, {
      ...EMPTY_FILTER,
      eventType: ['dividendo', 'unclassified'],
    })
    assert.deepEqual(rows.map((e) => e.eventType).sort(), ['dividendo', 'dividendo', 'unclassified'])
  })

  test('several years are a union', () => {
    const rows = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, year: ['2022', '2024'] })
    assert.deepEqual(rows.map((e) => e.eventDate.slice(0, 4)).sort(), ['2022', '2024', '2024'])
  })

  test('dimensions compose with AND — never widening one another', () => {
    const usdOnly = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, currency: ['dolares'] })
    const andYears = applyEventFilter(EVENTS, HOLDINGS, {
      ...EMPTY_FILTER,
      currency: ['dolares'],
      year: ['2023', '2024'],
    })
    assert.equal(usdOnly.length, 4)
    assert.equal(andYears.length, 3)
    // Adding a dimension can only ever remove rows.
    assert.ok(andYears.every((e) => usdOnly.some((u) => u.eventDate === e.eventDate)))

    const three = applyHoldingFilter(HOLDINGS, {
      ...EMPTY_FILTER,
      sociedad: ['WATERMILL', 'COVAL'],
      currency: ['dolares', 'euros'],
      category: ['Private Equity'],
    })
    assert.deepEqual(three.map((h) => h.id), ['h1'])
  })

  test('a selection matching nothing yields nothing — never everything', () => {
    assert.equal(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, sociedad: ['NO SUCH'] }).length, 0)
    assert.equal(applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, year: ['2099'] }).length, 0)
  })
})

describe('R13.R4A.5 · toggling, and the return to “all”', () => {
  const OPTIONS = ['ALPHA', 'BETA', 'GAMMA']

  test('selecting while all is active removes all', () => {
    assert.deepEqual(toggleSelection([], 'BETA', OPTIONS), ['BETA'])
    assert.equal(isFilterActive({ ...EMPTY_FILTER, sociedad: toggleSelection([], 'BETA', OPTIONS) }), true)
  })

  test('deselecting the last specific value returns to all, not to an empty filter', () => {
    const one = toggleSelection([], 'BETA', OPTIONS)
    const none = toggleSelection(one, 'BETA', OPTIONS)
    assert.deepEqual(none, [])
    // And "none" behaves as ALL rather than as "match nothing" — the ambiguity
    // the empty-set contract exists to make unrepresentable.
    assert.equal(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, sociedad: none }).length, HOLDINGS.length)
  })

  test('choosing all clears the specifics', () => {
    // The control writes `[]` directly; this is that value's meaning.
    const some = ['ALPHA', 'GAMMA']
    assert.equal(isFilterActive({ ...EMPTY_FILTER, category: some }), true)
    assert.equal(isFilterActive({ ...EMPTY_FILTER, category: [] }), false)
  })

  test('the selection always carries the options’ own order, not the click order', () => {
    let sel: string[] = []
    for (const v of ['GAMMA', 'ALPHA', 'BETA']) sel = toggleSelection(sel, v, OPTIONS)
    assert.deepEqual(sel, OPTIONS)
  })

  test('a value outside the options is dropped, never added', () => {
    assert.deepEqual(toggleSelection(['ALPHA'], 'STALE', OPTIONS), ['ALPHA'])
    // A stale value already in the selection is dropped on the next toggle, so
    // a dimension can never be pinned to something no row can match.
    assert.deepEqual(toggleSelection(['ALPHA', 'STALE'], 'BETA', OPTIONS), ['ALPHA', 'BETA'])
  })

  test('every option offered comes from the source’s own values', () => {
    const o = filterOptions(HOLDINGS, EVENTS)
    for (const s of o.sociedades) assert.ok(HOLDINGS.some((h) => h.sociedad === s))
    for (const c of o.categories) assert.ok(HOLDINGS.some((h) => h.category === c))
    for (const c of o.currencies) assert.ok(HOLDINGS.some((h) => h.currency === c))
    for (const t of o.eventTypes) assert.ok(EVENTS.some((e) => e.eventType === t))
    for (const y of o.years) assert.ok(EVENTS.some((e) => e.eventDate.startsWith(y)))
  })
})

// ===========================================================================
// 3 · Dashboard multi-year
// ===========================================================================

describe('R13.R4A.5 · the Dashboard’s year set drives figures and chart alike', () => {
  const USD = EVENTS.filter((e) => e.currency === 'dolares')

  test('no year selected gives one annual column per recorded year', () => {
    const cols = periodColumns(USD, 'dolares', [])
    assert.deepEqual(cols.map((c) => c.period), ['2022', '2023', '2024'])
    assert.ok(cols.every((c) => c.unit === 'year'))
  })

  test('exactly one year keeps the monthly series', () => {
    const cols = periodColumns(USD, 'dolares', ['2023'])
    assert.ok(cols.every((c) => c.unit === 'month'))
    assert.ok(cols.every((c) => c.period.startsWith('2023-')))
    assert.ok(cols.length > 1, 'a year is more than one column')
  })

  test('several years give ANNUAL columns for exactly those years', () => {
    const cols = periodColumns(USD, 'dolares', ['2022', '2024'])
    assert.deepEqual(cols.map((c) => c.period), ['2022', '2024'])
    assert.ok(cols.every((c) => c.unit === 'year'))
    // Never a continuous monthly axis across the gap, and never the years
    // BETWEEN the two, which nobody selected.
    assert.equal(cols.some((c) => c.period === '2023'), false)
    assert.equal(cols.some((c) => c.unit === 'month'), false)
  })

  test('a selected year the currency does not record contributes no column', () => {
    const cols = periodColumns(USD, 'dolares', ['2023', '2099'])
    assert.deepEqual(cols.map((c) => c.period), ['2023'])
    // An invented zero column is indistinguishable from an observed one, and
    // only one of the two is a fact.
    assert.equal(cols.some((c) => c.period === '2099'), false)
  })

  test('the multi-year columns sum back to the same figures the tiles show', () => {
    const years = ['2022', '2024']
    const scoped = eventsInPeriods(USD, years)
    const flow = currencyCashFlows(scoped)[0]
    const cols = periodColumns(USD, 'dolares', years)
    assert.equal(cols.reduce((s, c) => s + c.calls, 0), flow.calls.amount)
    assert.equal(cols.reduce((s, c) => s + c.distributions, 0), flow.distributions.amount)
    assert.equal(cols.reduce((s, c) => s + c.events, 0), scoped.length)
  })

  test('eventsInPeriods treats the empty set as every period', () => {
    assert.equal(eventsInPeriods(EVENTS, []).length, EVENTS.length)
    assert.equal(eventsInPeriods(EVENTS, ['2024']).length, 2)
    assert.equal(eventsInPeriods(EVENTS, ['2024', '2025']).length, 3)
    // A month prefix still works, so a drill-down key passes straight through.
    assert.equal(eventsInPeriods(EVENTS, ['2023-06']).length, 1)
  })

  test('the card derives figures and chart from ONE scoped set', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /const scoped = useMemo\(\(\) => eventsInPeriods\(ownEvents, selectedYears\)/)
    assert.match(code, /currencyCashFlows\(scoped\)/)
    assert.match(code, /periodColumns\(ownEvents, position\.currency, selectedYears\)/)
    // The selector still offers only the years THIS currency records.
    assert.match(code, /cashFlowYears\(ownEvents\)/)
  })

  test('the heading names what is plotted at each of the three shapes', () => {
    const code = codeOf(read(DASHBOARD))
    assert.match(code, /function chartTitle\(selectedYears: readonly string\[\], t: AltT\)/)
    assert.match(code, /if \(selectedYears\.length === 0\) return t\.annualFlowTitle/)
    assert.match(code, /t\.monthlyTitle/)
    assert.match(code, /t\.selectedYears\.replace\('\{n\}'/)
  })
})

// ===========================================================================
// 4 · The three views read one narrowed set
// ===========================================================================

describe('R13.R4A.5 · every surface honours the same selection', () => {
  test('Holdings re-derives its groups over the filtered rows', () => {
    const code = codeOf(read(HOLDINGS_PAGE))
    assert.match(code, /groupHoldings\(applyHoldingFilter\(holdings, filter\)\)/)
    assert.match(code, /filter\.sociedad\.length > 0/)
    assert.match(code, /filter\.category\.length > 0/)
    assert.match(code, /filter\.currency\.length > 0/)
  })

  test('Holdings subtotals are the filtered rows’ own sum', () => {
    const filter = { ...EMPTY_FILTER, currency: ['dolares', 'euros'] }
    const groups = groupHoldings(applyHoldingFilter(HOLDINGS, filter))
    const seen = groups.flatMap((g) => g.holdings.map((h) => h.id)).sort()
    assert.deepEqual(seen, ['h1', 'h2', 'h3'])
    for (const g of groups) {
      assert.equal(
        g.subtotal.currentValue.value,
        exactSum(g.holdings.map((h) => h.currentValue)),
      )
    }
  })

  test('Cash Flows drives tiles, chart and ledger from one filtered set', () => {
    const code = codeOf(read(CASHFLOWS))
    assert.match(code, /applyEventFilter\(events, holdings, allYears\)/)
    assert.match(code, /currencyCashFlows\(visibleEvents\)/)
    assert.match(code, /periodColumns\(visibleEvents, c\.currency, \[\]\)/)
    assert.match(code, /buildTimeline\(visibleEvents, holdings\)/)
    // The drill-down opens over the SAME set, so it can never show an event the
    // filter excluded.
    assert.match(code, /periodBreakdown\(visibleEvents, holdings,/)
    assert.equal(/periodBreakdown\(events,/.test(code), false)
  })

  test('Cash Flows still has no Year filter and still reads every year', () => {
    assert.equal(/showYear/.test(read(CASHFLOWS)), false)
    assert.match(codeOf(read(CASHFLOWS)), /\{ \.\.\.filter, year: \[\] \}/)
    const filters = codeOf(read(FILTERS))
    assert.equal(/a\.filterYear/.test(filters), false)
    assert.equal(/a\.allYears/.test(filters), false)
  })

  test('a drill-down period is always inside the active selection', () => {
    // The column a user clicks IS a period of the scoped set, so the breakdown
    // is bounded by construction rather than by a second filter pass.
    const years = ['2022', '2024']
    const scoped = eventsInPeriods(EVENTS.filter((e) => e.currency === 'dolares'), years)
    for (const c of periodColumns(EVENTS.filter((e) => e.currency === 'dolares'), 'dolares', years)) {
      assert.ok(years.includes(c.period.slice(0, 4)))
      const inColumn = scoped.filter((e) => e.eventDate.startsWith(c.period))
      assert.equal(inColumn.length, c.events)
    }
  })

  test('the shared filter still reaches Holdings and Cash Flows, and not the Dashboard', () => {
    // The Dashboard is the book-level overview; a filtered overview presented
    // as the whole book would misstate the position (the R13.R4A decision).
    for (const f of [HOLDINGS_PAGE, CASHFLOWS]) {
      assert.match(codeOf(read(f)), /useAlternatives\(\)/)
      assert.match(codeOf(read(f)), /<AlternativesFilters/)
    }
    assert.equal(/<AlternativesFilters/.test(codeOf(read(DASHBOARD))), false)
  })
})

// ===========================================================================
// 5 · Where the panel is allowed to sit
// ===========================================================================

describe('R13.R4A.5 · the popover stays inside the page', () => {
  const G = POPOVER_GUTTER_PX

  test('a panel that already fits is left flush with its trigger', () => {
    // A menu reads from the control it belongs to; it only moves under duress.
    assert.equal(clampPopoverLeft({ anchorLeft: 26, panelWidth: 306, viewportWidth: 1440 }), 0)
    assert.equal(clampPopoverLeft({ anchorLeft: 505, panelWidth: 306, viewportWidth: 1440 }), 0)
  })

  test('a panel near the right edge slides left just far enough', () => {
    // The measured 390px Dashboard case: the year selector sits right-aligned
    // in its card, and a flush panel would run ~170px past the viewport.
    const shift = clampPopoverLeft({ anchorLeft: 251, panelWidth: 306, viewportWidth: 390 })
    assert.ok(shift < 0, 'it must move')
    assert.equal(251 + shift + 306, 390 - G, 'its right edge lands on the gutter, not beyond it')
  })

  test('it never slides past the left gutter, even when it cannot fit', () => {
    // A panel wider than the space between the gutters pins left rather than
    // losing the checkmarks and the start of every label off-screen.
    const shift = clampPopoverLeft({ anchorLeft: 40, panelWidth: 900, viewportWidth: 390 })
    assert.equal(40 + shift, G)
  })

  test('a trigger already inside the left gutter is nudged in, never out', () => {
    // The page's own padding is narrower than the gutter at 390 (12px vs 16px),
    // so the leftmost control shifts a few pixels RIGHT — the only positive
    // direction this function ever returns, and only to honour rule 2.
    const shift = clampPopoverLeft({ anchorLeft: 13, panelWidth: 306, viewportWidth: 390 })
    assert.equal(shift, 3)
    assert.equal(13 + shift, G)
  })

  test('it is never pushed further right than its trigger when it fits', () => {
    for (const anchorLeft of [100, 400, 800]) {
      assert.ok(clampPopoverLeft({ anchorLeft, panelWidth: 306, viewportWidth: 1440 }) <= 0)
    }
  })

  test('an unmeasurable panel renders where the markup already puts it', () => {
    for (const bad of [
      { anchorLeft: Number.NaN, panelWidth: 306, viewportWidth: 390 },
      { anchorLeft: 10, panelWidth: Number.POSITIVE_INFINITY, viewportWidth: 390 },
      { anchorLeft: 10, panelWidth: 306, viewportWidth: Number.NaN },
    ]) {
      assert.equal(clampPopoverLeft(bad), 0)
    }
  })

  test('the module sets no width — the cap belongs to the class', () => {
    // An inline width would OVERRIDE the class cap and let the panel grow to
    // the full gutter-to-gutter span; measured at 1408px on a 1440 viewport
    // while this was briefly wired the other way.
    const mod = read('src/lib/familyPortfolio/alternatives/popoverPosition.ts')
    assert.equal(/export function popoverMaxWidth/.test(mod), false)
    const ctl = codeOf(read(FILTERS))
    assert.equal(/style\.maxWidth/.test(ctl), false)
    assert.match(ctl, /max-w-\[min\(18rem,calc\(100vw-2rem\)\)\]/)
  })

  test('the component places the panel through this function, not its own maths', () => {
    const ctl = codeOf(read(FILTERS))
    assert.match(ctl, /clampPopoverLeft\(\{/)
    assert.match(ctl, /anchorLeft: wrap\.getBoundingClientRect\(\)\.left/)
    assert.match(ctl, /panelWidth: panel\.offsetWidth/)
    assert.match(ctl, /viewportWidth: document\.documentElement\.clientWidth/)
    // `clientWidth`, never `100vw` — the two differ by a classic scrollbar.
    assert.equal(/100vw/.test(ctl.replace(/max-w-\[[^\]]*\]/g, '')), false)
    // Style writes only — the accepted measurement-effect shape, no setState.
    assert.match(ctl, /useLayoutEffect/)
    assert.equal(/useLayoutEffect\([\s\S]{0,400}?setOpen/.test(ctl), false)
  })
})

// ===========================================================================
// 6 · The control, and how it reads
// ===========================================================================

describe('R13.R4A.5 · the multi-select control', () => {
  test('every dimension in the bar is multi-select', () => {
    const code = codeOf(read(FILTERS))
    assert.equal((code.match(/<AlternativesMultiSelect/g) ?? []).length, 4)
    assert.equal(/AlternativesSelect\b(?!\w)/.test(code.replace(/AlternativesMultiSelect/g, '')), false)
    for (const dim of ['sociedad', 'category', 'currency', 'eventType']) {
      assert.match(code, new RegExp(`value=\\{filter\\.${dim}\\}`), dim)
    }
  })

  test('the closed state is All, the one label, or a count — never a chip pile', () => {
    const code = codeOf(read(FILTERS))
    assert.match(code, /value\.length === 0\s*\?\s*allLabel/)
    assert.match(code, /value\.length === 1\s*\?\s*show\(value\[0\]\)/)
    assert.match(code, /selectedLabel\.replace\('\{n\}', String\(value\.length\)\)/)
  })

  test('the summary never repeats the dimension’s own noun', () => {
    for (const lang of ['en', 'es'] as const) {
      const a = dict[lang].fp.alternatives
      for (const k of ['allSociedades', 'allCategories', 'allCurrencies', 'allEventTypes', 'allYears'] as const) {
        assert.equal(a[k].split(' ').length, 1, `${lang}.${k} must be one word`)
      }
      for (const k of ['selectedSociedades', 'selectedCategories', 'selectedCurrencies', 'selectedEventTypes', 'selectedYears'] as const) {
        assert.match(a[k], /^\{n\} \S+$/, `${lang}.${k}`)
        assert.equal(/sociedad|categor|moneda|currenc|tipo|type|año|year/i.test(a[k]), false, `${lang}.${k}`)
      }
    }
  })

  test('Spanish agrees with the noun each option stands for', () => {
    const es = dict.es.fp.alternatives
    assert.equal(es.allSociedades, 'Todas')
    assert.equal(es.allCategories, 'Todas')
    assert.equal(es.allCurrencies, 'Todas')
    assert.equal(es.allEventTypes, 'Todos')
    assert.equal(es.allYears, 'Todos')
    assert.match(es.selectedSociedades, /seleccionadas$/)
    assert.match(es.selectedCategories, /seleccionadas$/)
    assert.match(es.selectedCurrencies, /seleccionadas$/)
    assert.match(es.selectedEventTypes, /seleccionados$/)
    assert.match(es.selectedYears, /seleccionados$/)
  })

  test('English and Spanish carry the same keys, and Spanish is not a copy', () => {
    const en = dict.en.fp.alternatives as Record<string, unknown>
    const es = dict.es.fp.alternatives as Record<string, unknown>
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort())
    for (const k of ['selectedSociedades', 'selectedEventTypes'] as const) {
      assert.notEqual(en[k], es[k], k)
    }
  })

  test('the panel is keyboard-operable and dismissible without a mouse', () => {
    const code = codeOf(read(FILTERS))
    assert.match(code, /<input\s+type="checkbox"/)
    assert.match(code, /aria-expanded=\{open\}/)
    assert.match(code, /aria-haspopup="true"/)
    assert.match(code, /role="group"/)
    assert.match(code, /e\.key === 'Escape'/)
    assert.match(code, /onBlur=/)
    // Both listeners are torn down with the panel.
    assert.match(code, /removeEventListener\('keydown'/)
    assert.match(code, /removeEventListener\('pointerdown'/)
  })

  test('the control writes tokens and shared primitives, never raw material values', () => {
    const code = codeOf(read(FILTERS))
    assert.match(code, /<GlassSurface\s+variant="overlay"/)
    assert.match(code, /<ChipButton/)
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(code), false, 'no hardcoded colour')
    assert.equal(/blur\(|box-shadow:|rgba\(/.test(code), false, 'no hardcoded material')
    assert.equal(/bg-(white|black)|text-(white|black)\b/.test(code), false)
  })

  test('the panel obeys the documented layering scale', () => {
    // globals.css publishes the scale beside `.nv-glass-overlay`: page content
    // never escalates past z-20, and z-[80]/z-[90]/z-[100] belong to the
    // drawer, dialogs and the command palette. A filter popover is an in-card
    // affordance — it must never out-stack a dialog opened over it.
    const code = codeOf(read(FILTERS))
    const zs = [...code.matchAll(/\bz-(\[?\d+\]?)\b/g)].map((m) => m[1])
    assert.ok(zs.length > 0, 'the panel is stacked at all')
    for (const z of zs) {
      assert.ok(/^\d+$/.test(z), `z-${z} escalates to a page-level tier`)
      assert.ok(Number(z) <= 20, `z-${z} exceeds the documented page-content ceiling`)
    }
  })

  test('the panel cannot push the page sideways', () => {
    const code = codeOf(read(FILTERS))
    assert.match(code, /max-w-\[min\(18rem,calc\(100vw-2rem\)\)\]/)
    assert.match(code, /max-h-72 overflow-y-auto/)
    assert.match(code, /flex flex-wrap items-center/)
  })

  test('“all” is an act of clearing, not a checkbox that could sit beside others', () => {
    const code = codeOf(read(FILTERS))
    assert.match(code, /onClick=\{\(\) => onChange\(\[\]\)\}/)
    assert.match(code, /aria-pressed=\{value\.length === 0\}/)
    // One checkbox per real option, and none for "all".
    assert.equal((code.match(/type="checkbox"/g) ?? []).length, 1)
  })
})
