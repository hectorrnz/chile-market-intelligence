// R13.8A — the versioned Family Portfolio workbook contract.
//
// NO PRIVATE SOURCE DATA. Every fixture is a synthetic workbook built in memory
// with invented, obviously-fake values. The real workbook is never read, copied
// or approximated here; the STRUCTURES are reproduced from documents 02 and 03,
// the numbers are not.
//
// WHAT THESE TESTS ARE FOR
// ────────────────────────
// The contract's whole value rests on one property that is easy to state and
// easy to get wrong: the fingerprint must be STABLE across an ordinary week and
// UNSTABLE the moment the sheet is restructured. A fingerprint that moves every
// week is noise an operator learns to ignore; one that never moves is a rubber
// stamp. Both failure modes look fine in isolation, so both are asserted here
// against the same builder, from the same baseline.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'

import { indexToColumn } from '../src/lib/familyPortfolio/xlsx/cellRef.ts'
import {
  classifyWorkbook,
  WORKBOOK_CONTRACT_VERSION,
} from '../src/lib/familyPortfolio/workbookContract.ts'

// ---------------------------------------------------------------------------
// Synthetic .xlsx builder — the same shape tests/resumenParser.test.ts uses
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// A four-scope RESUMEN, structurally faithful to doc 02 and financially fake
// ---------------------------------------------------------------------------

const WEEK0 = 46000
const weekSerial = (i: number) => WEEK0 + i * 7

/**
 * Label vocabulary. Index positions are the shared-string ids the cells refer
 * to, so a rename in one test is a single-entry override rather than a rebuild.
 */
const LABELS = [
  'valores en dólares',        // 0
  'Precios en vivo',           // 1
  'Diferencia',                // 2
  'Resumen Portfolio',         // 3
  'PORTAFOLIO LÍQUIDO',        // 4
  'Caja y Equivalentes',       // 5
  'SUBTOTAL PORTFOLIO LÍQUIDO',// 6
  'SUBTOTAL',                  // 7
  'ACCIONES CHILENAS (USD)',   // 8
  'TOTAL',                     // 9
  'Retiros / Aportes',         // 10
  'Utilidad de la semana',     // 11
  'Jaime',                     // 12
  'LA ESPERANZA',              // 13
  'TOTAL JAIME',               // 14
  'Andrés',                    // 15
  'LOS SAUZALES',              // 16
  'TOTAL ANDRÉS (DIRECTO)',    // 17
  'Pablo',                     // 18
  'LOS LAURELES',              // 19
  'TOTAL PABLO (DIRECTO)',     // 20
  'CÁLCULO DE STOCKS',         // 21
]

interface BookOptions {
  /** Number of frozen weekly columns. The ordinary week increments this. */
  weeks?: number
  /** Override one shared string — a rename, which IS a restructure. */
  renameLabel?: { index: number; to: string }
  /** Insert an extra labelled row inside Main — also a restructure. */
  extraMainRow?: boolean
  omitLiveColumn?: boolean
  omitScope?: 'jaime' | 'andres' | 'pablo'
  duplicateWeekAt?: number
  /** Skip a week in the middle of the series, producing a > 10-day gap. */
  skipWeekAt?: number
  sheetName?: string
  extraSheets?: string[]
}

function buildBook(opts: BookOptions = {}): Buffer {
  const weeks = opts.weeks ?? 30
  const cells: Cell[] = []

  // --- Header row 5 (authoritative) plus the technical duplicate row 1.
  cells.push({ ref: 'B5', t: 's', v: 0 })
  let skipped = 0
  for (let i = 0; i < weeks; i++) {
    const col = indexToColumn(3 + i)
    let serial = weekSerial(i + skipped)
    if (opts.skipWeekAt === i) { skipped = 1; serial = weekSerial(i + 1) }
    if (opts.duplicateWeekAt === i) serial = weekSerial(i - 1)
    cells.push({ ref: `${col}5`, v: serial, s: 1 })
    cells.push({ ref: `${col}1`, v: serial, s: 1 })
  }
  const diffCol = indexToColumn(3 + weeks)
  cells.push({ ref: `${diffCol}5`, t: 's', v: 2 })
  if (!opts.omitLiveColumn) {
    const liveCol = indexToColumn(3 + weeks + 3)
    cells.push({ ref: `${liveCol}4`, t: 's', v: 1 })
    cells.push({ ref: `${liveCol}5`, f: '+DE$1', v: weekSerial(weeks + skipped), s: 1 })
  }

  const boy = indexToColumn(3)
  const prev = indexToColumn(3 + weeks - 1)
  const live = indexToColumn(3 + weeks + 3)

  const put = (row: number, label: number, v?: { boy?: number; prev?: number; live?: number }) => {
    cells.push({ ref: `B${row}`, t: 's', v: label })
    if (!v) return
    if (v.boy !== undefined) cells.push({ ref: `${boy}${row}`, v: v.boy })
    if (v.prev !== undefined) cells.push({ ref: `${prev}${row}`, v: v.prev })
    if (v.live !== undefined) cells.push({ ref: `${live}${row}`, v: v.live })
  }

  // --- Main.
  put(10, 3)
  put(11, 4)
  put(12, 5, { boy: 100, prev: 110, live: 120 })
  put(13, 6, { boy: 100, prev: 110, live: 120 })
  put(14, 7, { boy: 100, prev: 110, live: 120 })
  put(15, 8, { boy: 30, prev: 30, live: 35 })
  put(16, 9, { boy: 130, prev: 140, live: 155 })
  put(18, 10, { live: 0 })
  put(19, 11, { live: 15 })
  if (opts.extraMainRow) put(20, 5, { live: 1 })

  // --- Personal scopes.
  if (opts.omitScope !== 'jaime') {
    put(30, 12); put(31, 13, { boy: 40, prev: 50, live: 55 }); put(32, 14, { boy: 40, prev: 50, live: 55 })
  }
  if (opts.omitScope !== 'andres') {
    put(40, 15); put(41, 16, { boy: 40, prev: 50, live: 55 }); put(42, 17, { boy: 40, prev: 50, live: 55 })
  }
  if (opts.omitScope !== 'pablo') {
    put(50, 18); put(51, 19, { boy: 40, prev: 50, live: 55 }); put(52, 20, { boy: 40, prev: 50, live: 55 })
  }

  // --- Technical block (excluded from every scope range).
  put(60, 21)

  const labels = [...LABELS]
  if (opts.renameLabel) labels[opts.renameLabel.index] = opts.renameLabel.to

  const sheets = [{ name: opts.sheetName ?? 'RESUMEN', cells }]
  for (const extra of opts.extraSheets ?? []) sheets.push({ name: extra, cells: [{ ref: 'A1', v: 1 }] })
  return workbook(sheets, labels)
}

// ---------------------------------------------------------------------------
// An Alternatives sheet
// ---------------------------------------------------------------------------

const ALT_HEADERS = [
  'Nombre de la Inversión', 'Sociedad', 'Capital Committed', 'Contributions', 'Unfunded',
  'Fecha último statement', 'Última Valorización', 'Flujo desde último statement',
  'Valor Actual', 'TIR Informada', 'TIR Calculada',
]

function buildAlternatives(opts: { headerCount?: number; sheetName?: string } = {}): Buffer {
  const count = opts.headerCount ?? ALT_HEADERS.length
  const cells: Cell[] = []
  for (let i = 0; i < count; i++) cells.push({ ref: `${indexToColumn(2 + i)}5`, t: 's', v: i })
  return workbook([{ name: opts.sheetName ?? 'Alternatives', cells }], ALT_HEADERS)
}

// ===========================================================================

describe('R13.8A · the contract accepts the agreed workbook shape', () => {
  test('a four-scope RESUMEN is supported, with no findings at all', () => {
    const r = classifyWorkbook(buildBook(), 'portfolio')
    assert.equal(r.verdict, 'supported', JSON.stringify(r.findings))
    assert.equal(r.findings.length, 0)
    assert.equal(r.contractVersion, WORKBOOK_CONTRACT_VERSION)
  })

  test('the structure it reports is the skeleton, and every scope is present', () => {
    const r = classifyWorkbook(buildBook(), 'portfolio')
    assert.ok(r.structure)
    assert.equal(r.structure!.headerRow, 5, 'row 5 is authoritative, never row 1')
    assert.equal(r.structure!.historicalColumnCount, 30)
    assert.equal(r.structure!.liveColumnLetter !== null, true)
    assert.deepEqual(
      r.structure!.scopes.map((s) => s.scope).sort(),
      ['andres', 'jaime', 'main', 'pablo'],
    )
  })

  test('an Alternatives workbook is supported on its own master-data block', () => {
    const r = classifyWorkbook(buildAlternatives(), 'alternatives')
    assert.equal(r.verdict, 'supported', JSON.stringify(r.findings))
    assert.equal(r.structure!.alternativesHeaders.length, ALT_HEADERS.length)
  })
})

describe('R13.8A · the fingerprint is stable across an ordinary week', () => {
  // THE central property. A weekly upload adds one frozen column and rewrites
  // every amount; if either moved the hash, the fingerprint would change every
  // week and an operator would correctly learn to ignore it.
  test('adding a week does not move the structure hash', () => {
    const before = classifyWorkbook(buildBook({ weeks: 30 }), 'portfolio')
    const after = classifyWorkbook(buildBook({ weeks: 31 }), 'portfolio')
    assert.equal(before.verdict, 'supported')
    assert.equal(after.verdict, 'supported')
    assert.equal(after.structureHash, before.structureHash)
    assert.notEqual(after.structure!.historicalColumnCount, before.structure!.historicalColumnCount)
  })

  test('the hash is deterministic — the same bytes classify identically twice', () => {
    const bytes = buildBook()
    assert.equal(
      classifyWorkbook(bytes, 'portfolio').structureHash,
      classifyWorkbook(bytes, 'portfolio').structureHash,
    )
  })

  test('an Alternatives sheet appearing alongside RESUMEN DOES move the hash', () => {
    // Sheet inventory is part of the skeleton on purpose: a duplicated or
    // renamed sheet is exactly the accident that makes a parser read the wrong
    // grid while every other signal still looks correct.
    const plain = classifyWorkbook(buildBook(), 'portfolio')
    const withSheet = classifyWorkbook(buildBook({ extraSheets: ['Alternatives'] }), 'portfolio')
    assert.notEqual(withSheet.structureHash, plain.structureHash)
  })
})

describe('R13.8A · the fingerprint moves when the workbook is restructured', () => {
  test('renaming a row label changes the hash', () => {
    const base = classifyWorkbook(buildBook(), 'portfolio')
    const renamed = classifyWorkbook(
      buildBook({ renameLabel: { index: 5, to: 'SUBTOTAL LIQUIDO CONSOLIDADO' } }),
      'portfolio',
    )
    assert.equal(renamed.verdict, 'supported', 'it still parses — that is the point')
    assert.notEqual(renamed.structureHash, base.structureHash)
  })

  test('inserting a row inside Main changes the hash', () => {
    const base = classifyWorkbook(buildBook(), 'portfolio')
    const inserted = classifyWorkbook(buildBook({ extraMainRow: true }), 'portfolio')
    assert.notEqual(inserted.structureHash, base.structureHash)
  })

  test('a cosmetic case or accent edit does NOT change the hash', () => {
    // Labels are normalized before hashing. An operator retyping `Andrés` as
    // `ANDRES` has not restructured anything, and a fingerprint that fired on it
    // would be indistinguishable from one that fired on a real change.
    const base = classifyWorkbook(buildBook(), 'portfolio')
    const recased = classifyWorkbook(
      buildBook({ renameLabel: { index: 5, to: 'caja y equivalentes' } }),
      'portfolio',
    )
    assert.equal(recased.structureHash, base.structureHash)
  })
})

describe('R13.8A · a materially different workbook is refused, not parsed', () => {
  test('no RESUMEN sheet is unsupported_schema, and carries no fingerprint', () => {
    const r = classifyWorkbook(buildBook({ sheetName: 'Hoja1' }), 'portfolio')
    assert.equal(r.verdict, 'unsupported_schema')
    assert.equal(r.structureHash, null, 'a refused shape must not be comparable to an accepted one')
    assert.ok(r.findings.some((x) => x.code === 'resumen_sheet_missing'))
  })

  test('a missing personal scope is unsupported_schema', () => {
    const r = classifyWorkbook(buildBook({ omitScope: 'pablo' }), 'portfolio')
    assert.equal(r.verdict, 'unsupported_schema')
    assert.ok(r.findings.some((x) => x.code === 'scope_anchor_missing' && /pablo/.test(x.detail)))
  })

  test('a missing live column is unsupported_schema', () => {
    const r = classifyWorkbook(buildBook({ omitLiveColumn: true }), 'portfolio')
    assert.equal(r.verdict, 'unsupported_schema')
    assert.ok(r.findings.some((x) => x.code === 'live_column_missing'))
  })

  test('too short a weekly series is unsupported_schema', () => {
    const r = classifyWorkbook(buildBook({ weeks: 8 }), 'portfolio')
    assert.equal(r.verdict, 'unsupported_schema')
  })

  test('bytes that are not a workbook are invalid, not unsupported', () => {
    const r = classifyWorkbook(Buffer.from('this is not a spreadsheet'), 'portfolio')
    assert.equal(r.verdict, 'invalid')
    assert.equal(r.structureHash, null)
    assert.equal(r.structure, null)
  })

  test('an Alternatives sheet missing its master-data block is unsupported_schema', () => {
    const r = classifyWorkbook(buildAlternatives({ sheetName: 'Hoja2' }), 'alternatives')
    assert.equal(r.verdict, 'unsupported_schema')
  })

  test('a truncated Alternatives header block is unsupported_schema', () => {
    const r = classifyWorkbook(buildAlternatives({ headerCount: 4 }), 'alternatives')
    assert.equal(r.verdict, 'unsupported_schema')
    assert.ok(r.findings.some((x) => x.code === 'alternatives_headers_incomplete'))
  })
})

describe('R13.8A · ambiguity is its own verdict, never resolved by picking', () => {
  test('a duplicated week date is ambiguous, not merely unsupported', () => {
    const r = classifyWorkbook(buildBook({ duplicateWeekAt: 12 }), 'portfolio')
    assert.equal(r.verdict, 'ambiguous')
    assert.ok(r.findings.some((x) => x.code === 'duplicate_week_date'))
  })

  test('ambiguity outranks a co-occurring structural refusal', () => {
    // Both conditions hold. Reporting only "unsupported_schema" would send the
    // operator to look for a missing section when the real defect is two columns
    // claiming the same week.
    const r = classifyWorkbook(
      buildBook({ duplicateWeekAt: 12, omitScope: 'andres' }),
      'portfolio',
    )
    assert.equal(r.verdict, 'ambiguous')
    assert.ok(r.findings.some((x) => x.code === 'scope_anchor_missing'))
  })
})

describe('R13.8A · an unusual but readable workbook warns rather than blocks', () => {
  test('a skipped week is supported_with_warnings and still fingerprinted', () => {
    // A skipped week is a legitimate portfolio-history event. The contract
    // reports it and never invents the missing column.
    const r = classifyWorkbook(buildBook({ skipWeekAt: 10 }), 'portfolio')
    assert.equal(r.verdict, 'supported_with_warnings', JSON.stringify(r.findings))
    assert.ok(r.findings.some((x) => x.code === 'week_gap_unusual'))
    assert.ok(r.structureHash, 'a readable workbook keeps its fingerprint')
  })

  test('a gap does not move the hash — cadence is not structure', () => {
    const base = classifyWorkbook(buildBook(), 'portfolio')
    const gapped = classifyWorkbook(buildBook({ skipWeekAt: 10 }), 'portfolio')
    assert.equal(gapped.structureHash, base.structureHash)
  })
})

describe('R13.8A · the contract never leaks a portfolio amount', () => {
  test('no finding detail contains any of the fixture amounts', () => {
    const books: Array<[Buffer, 'portfolio' | 'alternatives']> = [
      [buildBook({ duplicateWeekAt: 12 }), 'portfolio'],
      [buildBook({ skipWeekAt: 10 }), 'portfolio'],
      [buildBook({ omitScope: 'pablo' }), 'portfolio'],
      [buildAlternatives({ headerCount: 4 }), 'alternatives'],
    ]
    // Every distinct amount the builders write.
    const amounts = ['100', '110', '120', '130', '140', '155', '30', '35', '15', '40', '50', '55']
    for (const [bytes, kind] of books) {
      for (const finding of classifyWorkbook(bytes, kind).findings) {
        for (const amount of amounts) {
          assert.ok(
            !new RegExp(`(^|[^0-9])${amount}([^0-9]|$)`).test(finding.detail),
            `finding ${finding.code} leaked the amount ${amount}: ${finding.detail}`,
          )
        }
      }
    }
  })

  test('the reported structure carries counts and labels, never a value', () => {
    const r = classifyWorkbook(buildBook(), 'portfolio')
    const serialized = JSON.stringify(r.structure)
    for (const amount of ['155', '130', '120']) {
      assert.ok(!serialized.includes(amount), `structure leaked ${amount}`)
    }
  })
})

describe('R13.8A · the module stays pure and server-agnostic', () => {
  test('it imports no Next.js, Supabase or environment closure', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(
      fileURLToPath(new URL('../src/lib/familyPortfolio/workbookContract.ts', import.meta.url)),
      'utf8',
    )
    for (const forbidden of ['next/', '@supabase', 'process.env', 'getSupabase']) {
      assert.ok(!src.includes(forbidden), `workbookContract.ts must not import ${forbidden}`)
    }
  })

  test('the contract version is explicit and versioned, never a bare date', () => {
    assert.match(WORKBOOK_CONTRACT_VERSION, /^family_portfolio_workbook_v[0-9]+$/)
  })
})
