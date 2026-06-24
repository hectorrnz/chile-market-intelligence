// Run with: npm test  (Node strips TS types natively — no toolchain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBcchDate, normalizeBcchSeries } from '../src/lib/providers/bcchClient.ts'

test('normalizeBcchDate converts DD-MM-YYYY to YYYY-MM-DD', () => {
  assert.equal(normalizeBcchDate('17-06-2025'), '2025-06-17')
  assert.equal(normalizeBcchDate(' 01-12-2024 '), '2024-12-01')
})

test('normalizeBcchDate leaves unrecognized strings unchanged', () => {
  assert.equal(normalizeBcchDate('2025-06-17'), '2025-06-17')
  assert.equal(normalizeBcchDate('garbage'), 'garbage')
})

test('normalizeBcchSeries parses a well-formed GetSeries payload', () => {
  const json = {
    Codigo: 0,
    Series: {
      Obs: [
        { indexDateString: '15-04-2025', value: '5.25', statusCode: 'OK' },
        { indexDateString: '17-06-2025', value: '5.00', statusCode: 'OK' },
      ],
    },
  }
  const r = normalizeBcchSeries(json)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.data.length, 2)
    assert.deepEqual(r.data[0], { date: '2025-04-15', value: 5.25 })
    assert.equal(r.data[1].value, 5)
    assert.equal(r.lastUpdated, '2025-06-17')
  }
})

test('normalizeBcchSeries treats empty/NaN observations as null values', () => {
  const json = {
    Codigo: 0,
    Series: { Obs: [
      { indexDateString: '17-06-2025', value: '' },
      { indexDateString: '18-06-2025', value: 'NaN' },
      { indexDateString: '19-06-2025', value: '4.20' },
    ] },
  }
  const r = normalizeBcchSeries(json)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.data[0].value, null)
    assert.equal(r.data[1].value, null)
    assert.equal(r.data[2].value, 4.2)
  }
})

test('normalizeBcchSeries rejects a non-zero response code', () => {
  const r = normalizeBcchSeries({ Codigo: 1, Series: { Obs: [] } })
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /code 1/)
})

test('normalizeBcchSeries rejects malformed / empty payloads', () => {
  assert.equal(normalizeBcchSeries(null).ok, false)
  assert.equal(normalizeBcchSeries({}).ok, false)
  assert.equal(normalizeBcchSeries({ Series: {} }).ok, false)
  assert.equal(normalizeBcchSeries({ Series: { Obs: [] } }).ok, false)
})
