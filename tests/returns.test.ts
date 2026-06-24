// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { totalAndAnnual, tfStart } from '../src/lib/returns.ts'

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('totalAndAnnual returns null for <2 points', () => {
  assert.equal(totalAndAnnual([]), null)
  assert.equal(totalAndAnnual([{ date: '2024-01-01', value: 100 }]), null)
})

test('totalAndAnnual computes total return', () => {
  const r = totalAndAnnual([
    { date: '2024-01-01', value: 100 },
    { date: '2025-01-01', value: 110 },
  ])
  assert.ok(r)
  assert.ok(approx(r!.tr, 10), `tr was ${r!.tr}`)
})

test('totalAndAnnual: ~1y window annualizes near the total return', () => {
  const r = totalAndAnnual([
    { date: '2024-06-17', value: 100 },
    { date: '2025-06-17', value: 120 },
  ])
  assert.ok(r)
  assert.ok(approx(r!.tr, 20, 1e-9))
  // 365-day window → CAGR within ~0.1pp of the total return
  assert.ok(Math.abs(r!.annual - r!.tr) < 0.1, `annual ${r!.annual} vs tr ${r!.tr}`)
})

test('totalAndAnnual guards a zero starting price', () => {
  assert.equal(totalAndAnnual([
    { date: '2024-01-01', value: 0 },
    { date: '2025-01-01', value: 10 },
  ]), null)
})

test('tfStart resolves each timeframe against the end date', () => {
  assert.equal(tfStart('2025-06-17', 'YTD'), '2025-01-01')
  assert.equal(tfStart('2025-06-17', '1M'), '2025-05-17')
  assert.equal(tfStart('2025-06-17', '1Y'), '2024-06-17')
  assert.equal(tfStart('2025-06-17', '3Y'), '2022-06-17')
  assert.equal(tfStart('2025-06-17', '5Y'), '2020-06-17')
})
