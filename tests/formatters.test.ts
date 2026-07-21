// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatCLP, formatPercent, formatPct, formatFx, formatEPS, formatNetDebt,
  formatMarketCapMM, changeColor, formatSourceDate,
} from '../src/lib/formatters.ts'

test('formatSourceDate renders "DD-MM" for a date-only string (no time to show)', () => {
  assert.equal(formatSourceDate('2026-07-14'), '14-07')
  assert.equal(formatSourceDate('2026-01-05'), '05-01')
})

test('formatSourceDate never shifts by a day regardless of timezone (no Date() parsing for date-only input)', () => {
  // A naive `new Date('2026-01-01')` + toLocaleDateString in a negative-UTC-offset
  // timezone can render Dec 31 — formatSourceDate must not reproduce that bug.
  assert.equal(formatSourceDate('2026-01-01'), '01-01')
})

test('formatSourceDate renders "HH:MM" (Chile local time) for a timestamp from earlier today', () => {
  const now = new Date()
  const earlierToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5).toISOString()
  assert.match(formatSourceDate(earlierToday), /^\d{2}:\d{2}$/)
})

test('formatSourceDate renders "DD-MM" (Chile local date) for a timestamp from a prior day', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const label = formatSourceDate(threeDaysAgo.toISOString())
  assert.match(label, /^\d{2}-\d{2}$/)
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

// surprisePct removed (2026-07-21 audit): the consensus/beat-miss machinery is
// gone platform-wide — no component computes a synthetic surprise anymore.

test('changeColor maps direction to semantic token classes', () => {
  assert.equal(changeColor(5), 'text-positive')
  assert.equal(changeColor(-3), 'text-negative')
  assert.equal(changeColor(0), 'text-muted-fg')
})
