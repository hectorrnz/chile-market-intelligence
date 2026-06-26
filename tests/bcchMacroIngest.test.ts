// Phase 5C — Unit tests for BCCh macro ingestion pure functions.
// Run: npm test
// Tests only the pure functions in bcchMacroCore.ts (no I/O, no env reads, no network).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// bcchMacroCore imports from transforms.ts which is pure — no side effects.
import {
  parseArgs, firstDateFor, todayIso, sanitizeError,
  buildObservationRows, chunk,
  INGESTION_VERSION,
} from '../scripts/ingest/bcchMacroCore.ts'
import type { MacroSeriesDef } from '../src/config/macroSeries.ts'

// ─── Minimal MacroSeriesDef fixtures ─────────────────────────────────────────

function makeDef(overrides: Partial<MacroSeriesDef> = {}): MacroSeriesDef {
  return {
    id: 'tpm',
    displayName: 'TPM',
    region: 'CL',
    source: 'BCCh',
    sourceProvider: 'BCCh',
    manualKey: 'tpm',
    providerSeriesCode: 'F022.BCB.TAC.N.7.D',
    unit: '%',
    frequency: 'daily',
    transformation: 'none',
    fallbackStaticId: 'tpm',
    enabled: true,
    confidence: 'high',
    verified: true,
    verificationDate: '2025-01-01',
    notes: '',
    ...overrides,
  }
}

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('defaults: dry-run, years=10, no indicator', () => {
    const a = parseArgs(['node', 'script.ts'])
    assert.equal(a.write, false)
    assert.equal(a.all, false)
    assert.equal(a.indicator, null)
    assert.equal(a.years, 10)
    assert.equal(a.from, null)
    assert.equal(a.to, null)
    assert.equal(a.limit, null)
  })

  it('--write flag sets write=true', () => {
    const a = parseArgs(['node', 'script.ts', '--write'])
    assert.equal(a.write, true)
  })

  it('--all flag sets all=true', () => {
    const a = parseArgs(['node', 'script.ts', '--all'])
    assert.equal(a.all, true)
  })

  it('--indicator sets the indicator key', () => {
    const a = parseArgs(['node', 'script.ts', '--indicator', 'tpm'])
    assert.equal(a.indicator, 'tpm')
  })

  it('--years parses an integer', () => {
    const a = parseArgs(['node', 'script.ts', '--years', '5'])
    assert.equal(a.years, 5)
  })

  it('invalid --years falls back to 10', () => {
    const a = parseArgs(['node', 'script.ts', '--years', 'abc'])
    assert.equal(a.years, 10)
  })

  it('--from and --to are parsed as strings', () => {
    const a = parseArgs(['node', 'script.ts', '--from', '2020-01-01', '--to', '2024-12-31'])
    assert.equal(a.from, '2020-01-01')
    assert.equal(a.to, '2024-12-31')
  })

  it('--limit parses an integer', () => {
    const a = parseArgs(['node', 'script.ts', '--limit', '100'])
    assert.equal(a.limit, 100)
  })

  it('all flags together', () => {
    const a = parseArgs(['node', 's.ts', '--all', '--write', '--years', '3', '--limit', '50'])
    assert.equal(a.write, true)
    assert.equal(a.all, true)
    assert.equal(a.years, 3)
    assert.equal(a.limit, 50)
  })
})

// ─── sanitizeError ────────────────────────────────────────────────────────────

describe('sanitizeError', () => {
  it('strips user= query param', () => {
    const msg = 'Failed: https://api.bcch.cl?user=myuser&pass=secret&other=ok'
    assert.ok(!sanitizeError(msg).includes('myuser'))
    assert.ok(!sanitizeError(msg).includes('secret'))
  })

  it('strips Supabase service key (long alphanumeric after key=)', () => {
    const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const msg = `Error with key=${key} in request`
    assert.ok(!sanitizeError(msg).includes(key))
  })

  it('strips JWT tokens (eyJ...)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const msg = `Authorization: Bearer ${jwt}`
    assert.ok(!sanitizeError(msg).includes(jwt))
  })

  it('preserves non-sensitive content', () => {
    const msg = 'Could not connect to database host=localhost port=5432'
    const result = sanitizeError(msg)
    assert.ok(result.includes('localhost'))
    assert.ok(result.includes('5432'))
  })

  it('handles non-Error (string, object)', () => {
    assert.equal(typeof sanitizeError('plain string'), 'string')
    assert.equal(typeof sanitizeError({ code: 42 }), 'string')
  })
})

// ─── chunk ────────────────────────────────────────────────────────────────────

describe('chunk', () => {
  it('splits evenly', () => {
    assert.deepEqual(chunk([1,2,3,4,5,6], 2), [[1,2],[3,4],[5,6]])
  })

  it('last chunk is smaller when not even', () => {
    assert.deepEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]])
  })

  it('empty array → empty result', () => {
    assert.deepEqual(chunk([], 10), [])
  })

  it('size larger than array → one chunk', () => {
    assert.deepEqual(chunk([1,2,3], 100), [[1,2,3]])
  })
})

// ─── buildObservationRows ─────────────────────────────────────────────────────

describe('buildObservationRows — transform: none', () => {
  const def = makeDef({ transformation: 'none', fallbackStaticId: 'tpm', providerSeriesCode: 'F022.BCB.TAC.N.7.D' })
  const fetchedAt = '2026-06-26T00:00:00.000Z'
  const dateRange = { from: '2024-01-01', to: '2024-12-31' }

  it('returns one row per non-null point in range', () => {
    const raw = [
      { date: '2024-01-15', value: 8.25 },
      { date: '2024-02-15', value: 8.00 },
    ]
    const rows = buildObservationRows(def, 'BCCh', raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].indicator_id, 'tpm')
    assert.equal(rows[0].observation_date, '2024-01-15')
    assert.equal(rows[0].value, 8.25)
    assert.equal(rows[0].source_provider, 'BCCh BDE')
    assert.equal(rows[0].source_series_code, 'F022.BCB.TAC.N.7.D')
    assert.equal(rows[0].fetched_at, fetchedAt)
    assert.equal(rows[0].metadata.transformation, 'none')
    assert.equal(rows[0].metadata.isDerived, false)
    assert.equal(rows[0].metadata.ingestionVersion, INGESTION_VERSION)
    assert.equal(rows[0].metadata.rowSource, 'live_bcch')
  })

  it('drops null values', () => {
    const raw = [
      { date: '2024-01-15', value: null },
      { date: '2024-02-15', value: 8.00 },
    ]
    const rows = buildObservationRows(def, 'BCCh', raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].observation_date, '2024-02-15')
  })

  it('filters out points outside date range', () => {
    const raw = [
      { date: '2023-12-31', value: 9.0 },  // before range
      { date: '2024-06-01', value: 7.5 },  // in range
      { date: '2025-01-01', value: 6.0 },  // after range
    ]
    const rows = buildObservationRows(def, 'BCCh', raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].observation_date, '2024-06-01')
  })

  it('applies limit (takes last N)', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      date: `2024-${String(i + 1).padStart(2, '0')}-01`,
      value: i + 1.0,
    }))
    const rows = buildObservationRows(def, 'BCCh', raw, { from: '2024-01-01', to: '2024-12-31' }, fetchedAt, 5)
    assert.equal(rows.length, 5)
    assert.equal(rows[0].observation_date, '2024-08-01')  // last 5 of 12 (Jan–Dec)
  })

  it('returns [] when providerSeriesCode is null', () => {
    const defNoCode = makeDef({ providerSeriesCode: null })
    const rows = buildObservationRows(defNoCode, null, [{ date: '2024-01-01', value: 5 }], dateRange, fetchedAt, null)
    assert.equal(rows.length, 0)
  })
})

describe('buildObservationRows — transform: yoy (imacec)', () => {
  const def = makeDef({
    transformation: 'yoy',
    fallbackStaticId: 'imacec-anual',
    providerSeriesCode: 'F032.IMC.IND.N.Z.Z.EP17.Z.M',
    manualKey: 'imacec-yoy',
  })
  const fetchedAt = '2026-06-26T00:00:00.000Z'
  const dateRange = { from: '2024-01-01', to: '2024-12-31' }

  it('derives yoy % from level series (early points dropped)', () => {
    // Give 2 years of monthly data so yoy can be derived.
    const raw = Array.from({ length: 24 }, (_, i) => {
      const year = i < 12 ? 2023 : 2024
      const month = (i % 12) + 1
      const date = `${year}-${String(month).padStart(2, '0')}-01`
      // Artificial level: 100 + month in 2023, 105 + month in 2024 → ~5% growth
      return { date, value: (year === 2023 ? 100 : 105) + month }
    })
    const rows = buildObservationRows(def, 'BCCh', raw, dateRange, fetchedAt, null)
    // 2024 points should be derivable (each has a year-ago point in 2023)
    assert.ok(rows.length > 0, 'Expected yoy-derived rows')
    for (const row of rows) {
      assert.equal(row.metadata.isDerived, true)
      assert.equal(row.metadata.transformation, 'yoy')
      assert.equal(typeof row.value, 'number')
    }
  })

  it('returns [] when all raw points are null', () => {
    const raw = [{ date: '2024-06-01', value: null }, { date: '2023-06-01', value: null }]
    const rows = buildObservationRows(def, 'BCCh', raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 0)
  })
})

// ─── Date helpers ─────────────────────────────────────────────────────────────

describe('firstDateFor and todayIso', () => {
  it('todayIso returns YYYY-MM-DD', () => {
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('firstDateFor(10) is 10 years before today', () => {
    const d = new Date(firstDateFor(10))
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365)
    assert.ok(diff >= 9.9 && diff <= 10.1, `Expected ~10 years, got ${diff.toFixed(2)}`)
  })

  it('firstDateFor(0, 1) is 1 extra year before today', () => {
    const d = new Date(firstDateFor(0, 1))
    const d10 = new Date(firstDateFor(1, 0))
    // firstDateFor(0, 1) and firstDateFor(1, 0) should be approximately the same date
    assert.ok(Math.abs(d.getTime() - d10.getTime()) < 1000 * 60 * 60 * 24, 'Should be within 1 day')
  })
})
