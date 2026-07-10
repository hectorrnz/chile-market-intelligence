// Phase 8D — Unit tests for the FRED client (pure CSV parsing + config check).
// No network calls in this file — fetchFredSeries requires live network and is
// exercised only via the manual dry-run ingestion script, not unit tests.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isFredConfigured, parseFredCsv } from '../src/lib/providers/fredClient.ts'

describe('isFredConfigured', () => {
  it('is always true — FRED CSV endpoint needs no credentials', () => {
    assert.equal(isFredConfigured(), true)
  })
})

describe('parseFredCsv', () => {
  it('parses a well-formed two-column CSV, skipping the header', () => {
    const csv = 'observation_date,FEDFUNDS\n2026-05-01,3.75\n2026-06-01,3.63\n'
    const points = parseFredCsv(csv)
    assert.equal(points.length, 2)
    assert.deepEqual(points[0], { date: '2026-05-01', value: 3.75 })
    assert.deepEqual(points[1], { date: '2026-06-01', value: 3.63 })
  })

  it('treats FRED\'s "." marker as a missing value (null), not zero or NaN', () => {
    const csv = 'DATE,VALUE\n2026-06-01,.\n2026-07-01,4.56\n'
    const points = parseFredCsv(csv)
    assert.equal(points.length, 2)
    assert.equal(points[0].value, null)
    assert.equal(points[1].value, 4.56)
  })

  it('treats an empty value cell as null', () => {
    const csv = 'DATE,VALUE\n2026-06-01,\n'
    const points = parseFredCsv(csv)
    assert.equal(points[0].value, null)
  })

  it('skips lines that are not YYYY-MM-DD (defensive against a bad/garbled response)', () => {
    const csv = 'DATE,VALUE\nnot-a-date,4.5\n2026-06-01,4.56\n'
    const points = parseFredCsv(csv)
    assert.equal(points.length, 1)
    assert.equal(points[0].date, '2026-06-01')
  })

  it('returns [] for an empty or header-only response', () => {
    assert.deepEqual(parseFredCsv(''), [])
    assert.deepEqual(parseFredCsv('DATE,VALUE\n'), [])
  })

  it('never throws on malformed input (blank lines, ragged columns)', () => {
    const csv = 'DATE,VALUE\n\n2026-06-01\n2026-07-01,4.56,extra\n'
    assert.doesNotThrow(() => parseFredCsv(csv))
  })

  it('a non-finite numeric string parses to null rather than NaN', () => {
    const csv = 'DATE,VALUE\n2026-06-01,not-a-number\n'
    const points = parseFredCsv(csv)
    assert.equal(points[0].value, null)
  })
})
