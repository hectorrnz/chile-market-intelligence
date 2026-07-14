// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatCLP, formatPercent, formatPct, formatFx, formatEPS, formatNetDebt,
  formatMarketCapMM, surprisePct, changeColor, formatSourceDate,
} from '../src/lib/formatters.ts'

test('formatSourceDate renders "Mon/DD/YY" for the standardized table footnote', () => {
  assert.equal(formatSourceDate('2026-07-14'), 'Jul/14/26')
  assert.equal(formatSourceDate('2026-01-05'), 'Jan/05/26')
  assert.equal(formatSourceDate('2026-12-31T10:15:00.000Z'), 'Dec/31/26')
})

test('formatSourceDate never shifts by a day regardless of timezone (no Date() parsing)', () => {
  // A naive `new Date('2026-01-01')` + toLocaleDateString in a negative-UTC-offset
  // timezone can render Dec 31 — formatSourceDate must not reproduce that bug.
  assert.equal(formatSourceDate('2026-01-01'), 'Jan/01/26')
})

test('formatSourceDate returns the input unchanged for a malformed date', () => {
  assert.equal(formatSourceDate('not-a-date'), 'not-a-date')
  assert.equal(formatSourceDate(''), '')
})

test('formatCLP groups thousands with Chilean periods', () => {
  assert.equal(formatCLP(1234567), '1.234.567')
  assert.equal(formatCLP(0), '0')
  assert.equal(formatCLP(1234.5, 2), '1.234,50')
})

test('formatPercent / formatPct add sign and comma decimal', () => {
  assert.equal(formatPercent(3.2), '+3,2%')
  assert.equal(formatPercent(-1.5), '-1,5%')
  assert.equal(formatPercent(0), '0,0%')        // zero gets no leading +
  assert.equal(formatPct(12.34, 2), '+12,34%')
})

test('formatFx respects decimals', () => {
  assert.equal(formatFx(934.5, 2), '934,50')
  assert.equal(formatFx(1.2345, 4), '1,2345')
})

test('formatEPS handles null and negatives', () => {
  assert.equal(formatEPS(null), '—')
  assert.equal(formatEPS(undefined), '—')
  assert.equal(formatEPS(405), '405,00')
})

test('formatNetDebt shows em-dash for null and parens for net cash', () => {
  assert.equal(formatNetDebt(null), '—')
  assert.equal(formatNetDebt(-100000).startsWith('('), true)
  assert.equal(formatNetDebt(-100000).endsWith(')'), true)
})

test('formatMarketCapMM appends a single MM CLP suffix', () => {
  const out = formatMarketCapMM(12000000)
  assert.equal(out.endsWith('MM CLP'), true)
  assert.equal((out.match(/MM/g) ?? []).length, 1)  // no "MM MM CLP" bug
})

test('surprisePct computes beat/miss vs consensus', () => {
  assert.ok(Math.abs(surprisePct(110, 100)! - 10) < 1e-9)
  assert.ok(Math.abs(surprisePct(90, 100)! - -10) < 1e-9)
  assert.equal(surprisePct(100, 100), 0)
  assert.equal(surprisePct(null, 100), null)
  assert.equal(surprisePct(100, null), null)
  assert.equal(surprisePct(100, 0), null)
})

test('changeColor maps direction to semantic token classes', () => {
  assert.equal(changeColor(5), 'text-positive')
  assert.equal(changeColor(-3), 'text-negative')
  assert.equal(changeColor(0), 'text-muted-fg')
})
