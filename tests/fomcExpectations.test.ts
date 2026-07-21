import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSharedStrings,
  excelSerialToIso,
  parseDataSheet,
  summarizeLatest,
} from '../src/lib/providers/fomc/mptXlsx.ts'
import { formatBpsRange, windowLabelFor } from '../src/lib/providers/fomc/fomcExpectations.ts'

describe('MPT xlsx — shared strings + serial dates', () => {
  test('parseSharedStrings extracts each <si> text', () => {
    const xml = `<sst count="3" uniqueCount="3"><si><t>date</t></si><si><t>Prob: cut</t></si><si><t> 465.53</t></si></sst>`
    assert.deepEqual(parseSharedStrings(xml), ['date', 'Prob: cut', ' 465.53'])
  })
  test('decodes XML entities in shared strings', () => {
    const xml = `<sst><si><t>a &amp; b</t></si></sst>`
    assert.deepEqual(parseSharedStrings(xml), ['a & b'])
  })
  test('excelSerialToIso maps the 1900 system correctly', () => {
    // =DATE(2023,6,19) in Excel is serial 45096 (1899-12-30 epoch, valid for
    // all post-1900-03-01 serials, which is every date in this workbook).
    assert.equal(excelSerialToIso(45096), '2023-06-19')
    assert.equal(excelSerialToIso(45098), '2023-06-21')
  })
})

describe('MPT xlsx — data sheet parsing', () => {
  const serial = (y: number, m: number, d: number) =>
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000)

  // shared[i]: 0 date, 1 targetRange, 2 'Prob: cut', 3 'Prob: hike', 4 'Rate: mode', 5..'values'
  const shared = [
    '2026-07-17', '350bps - 375bps', 'Prob: cut', 'Prob: hike', 'Rate: mode',
    '1.05', '71.22', '376.93', // quarter A values
    '7.66', '71.88', '378.42', // quarter B values
  ]
  const qA = serial(2026, 9, 16)
  const qB = serial(2026, 12, 16)
  // Value column is a shared string (numbers stored as text), date is a shared
  // string, reference_start is a numeric cell — exactly the real workbook shape.
  const cell = (ref: string, si: number) => `<c r="${ref}" t="s"><v>${si}</v></c>`
  const numCell = (ref: string, v: number) => `<c r="${ref}" t="n"><v>${v}</v></c>`
  const row = (r: number, refSerial: number, cutHikeModeIdx: [number, number, number]) => `
    <row r="${r}">${cell(`A${r}`, 0)}${numCell(`B${r}`, refSerial)}${cell(`C${r}`, 1)}${cell(`D${r}`, 2)}${cell(`E${r}`, cutHikeModeIdx[0])}</row>
    <row r="${r + 1}">${cell(`A${r + 1}`, 0)}${numCell(`B${r + 1}`, refSerial)}${cell(`C${r + 1}`, 1)}${cell(`D${r + 1}`, 3)}${cell(`E${r + 1}`, cutHikeModeIdx[1])}</row>
    <row r="${r + 2}">${cell(`A${r + 2}`, 0)}${numCell(`B${r + 2}`, refSerial)}${cell(`C${r + 2}`, 1)}${cell(`D${r + 2}`, 4)}${cell(`E${r + 2}`, cutHikeModeIdx[2])}</row>`
  const sheet = `<worksheet><sheetData>${row(2, qA, [5, 6, 7])}${row(5, qB, [8, 9, 10])}</sheetData></worksheet>`

  test('parseDataSheet resolves shared-string cells and numeric serials', () => {
    const rows = parseDataSheet(sheet, shared)
    assert.equal(rows.length, 6)
    const first = rows[0]
    assert.equal(first.date, '2026-07-17')
    assert.equal(first.referenceStart, '2026-09-16')
    assert.equal(first.targetRange, '350bps - 375bps')
    assert.equal(first.field, 'Prob: cut')
    assert.equal(first.value, 1.05)
  })

  test('summarizeLatest computes per-quarter below/in/above + hold', () => {
    const latest = summarizeLatest(parseDataSheet(sheet, shared))!
    assert.equal(latest.date, '2026-07-17')
    assert.equal(latest.quarters.length, 2)
    const a = latest.quarters[0]
    assert.equal(a.referenceStart, '2026-09-16')
    assert.equal(a.probCut, 1.05)
    assert.equal(a.probHike, 71.22)
    // hold = 100 − cut − hike, clamped ≥ 0
    assert.ok(Math.abs((a.probHold ?? 0) - (100 - 1.05 - 71.22)) < 1e-9)
    assert.equal(a.modeBps, 376.93)
  })

  test('summarizeLatest returns null for no rows', () => {
    assert.equal(summarizeLatest([]), null)
  })
})

describe('FOMC formatting helpers', () => {
  test('formatBpsRange', () => {
    assert.equal(formatBpsRange('350bps - 375bps'), '3.50%–3.75%')
    assert.equal(formatBpsRange('400bps - 425bps'), '4.00%–4.25%')
    assert.equal(formatBpsRange('nonsense'), null)
  })
  test('windowLabelFor names the 3-month SOFR window', () => {
    assert.equal(windowLabelFor('2026-09-16'), 'Sep–Dec 2026')
    assert.equal(windowLabelFor('2026-12-16'), 'Dec 2026–Mar 2027')
  })
})
