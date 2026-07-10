// Phase 8D — Unit tests for FRED (US macro) ingestion pure functions.
// Run: npm test
// Mirrors tests/bcchMacroIngest.test.ts — tests only pure functions in
// fredMacroCore.ts (no I/O, no env reads, no network).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseArgs, firstDateFor, todayIso, sanitizeError,
  buildObservationRows, chunk,
  INGESTION_VERSION, SOURCE_PROVIDER,
} from '../scripts/ingest/fredMacroCore.ts'
import type { MacroSeriesDef } from '../src/config/macroSeries.ts'

function makeDef(overrides: Partial<MacroSeriesDef> = {}): MacroSeriesDef {
  return {
    id: 'us10y',
    displayName: 'US 10-Year Treasury Yield',
    region: 'US',
    category: 'US Rates',
    source: 'US Treasury (via FRED)',
    sourceProvider: 'FRED',
    manualKey: 'us10y',
    providerSeriesCode: 'DGS10',
    unit: '%',
    frequency: 'daily',
    transformation: 'none',
    fallbackStaticId: 'us10y',
    enabled: true,
    confidence: 'high',
    verified: true,
    verificationDate: '2026-07-10',
    notes: '',
    ...overrides,
  }
}

describe('fredMacroCore: SOURCE_PROVIDER label', () => {
  it('names FRED / St. Louis Fed, never claims BCCh', () => {
    assert.match(SOURCE_PROVIDER, /FRED/)
    assert.ok(!SOURCE_PROVIDER.includes('BCCh'))
  })
})

describe('fredMacroCore parseArgs', () => {
  it('defaults: dry-run, years=10, no indicator', () => {
    const a = parseArgs(['node', 'script.ts'])
    assert.equal(a.write, false)
    assert.equal(a.all, false)
    assert.equal(a.indicator, null)
    assert.equal(a.years, 10)
  })

  it('--write and --all flags set true', () => {
    const a = parseArgs(['node', 'script.ts', '--write', '--all'])
    assert.equal(a.write, true)
    assert.equal(a.all, true)
  })

  it('--indicator sets the indicator key', () => {
    const a = parseArgs(['node', 'script.ts', '--indicator', 'us10y'])
    assert.equal(a.indicator, 'us10y')
  })

  it('invalid --years falls back to 10', () => {
    const a = parseArgs(['node', 'script.ts', '--years', 'abc'])
    assert.equal(a.years, 10)
  })
})

describe('fredMacroCore sanitizeError', () => {
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

  it('handles non-Error input', () => {
    assert.equal(typeof sanitizeError('plain string'), 'string')
  })
})

describe('fredMacroCore chunk', () => {
  it('splits evenly and unevenly', () => {
    assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]])
    assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]])
  })
})

describe('fredMacroCore buildObservationRows — transform: none (daily yield)', () => {
  const def = makeDef()
  const fetchedAt = '2026-07-10T00:00:00.000Z'
  const dateRange = { from: '2024-01-01', to: '2024-12-31' }

  it('returns one row per non-null point in range, tagged provider fred', () => {
    const raw = [
      { date: '2024-01-15', value: 4.05 },
      { date: '2024-02-15', value: 4.10 },
    ]
    const rows = buildObservationRows(def, 'US Treasury (via FRED)', raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].indicator_id, 'us10y')
    assert.equal(rows[0].source_provider, SOURCE_PROVIDER)
    assert.equal(rows[0].source_series_code, 'DGS10')
    assert.equal(rows[0].metadata.provider, 'fred')
    assert.equal(rows[0].metadata.rowSource, 'live_fred')
    assert.equal(rows[0].metadata.isDerived, false)
    assert.equal(rows[0].metadata.ingestionVersion, INGESTION_VERSION)
  })

  it('drops null values (FRED "." marker already parsed to null upstream)', () => {
    const raw = [
      { date: '2024-01-15', value: null },
      { date: '2024-02-15', value: 4.10 },
    ]
    const rows = buildObservationRows(def, null, raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].observation_date, '2024-02-15')
  })

  it('filters out points outside the date range', () => {
    const raw = [
      { date: '2023-12-31', value: 3.9 },
      { date: '2024-06-01', value: 4.2 },
      { date: '2025-01-01', value: 4.5 },
    ]
    const rows = buildObservationRows(def, null, raw, dateRange, fetchedAt, null)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].observation_date, '2024-06-01')
  })

  it('returns [] when providerSeriesCode is null', () => {
    const defNoCode = makeDef({ providerSeriesCode: null })
    const rows = buildObservationRows(defNoCode, null, [{ date: '2024-01-01', value: 4 }], dateRange, fetchedAt, null)
    assert.equal(rows.length, 0)
  })

  it('applies limit (takes last N)', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      date: `2024-${String(i + 1).padStart(2, '0')}-01`,
      value: 4 + i * 0.01,
    }))
    const rows = buildObservationRows(def, null, raw, { from: '2024-01-01', to: '2024-12-31' }, fetchedAt, 5)
    assert.equal(rows.length, 5)
  })
})

describe('fredMacroCore buildObservationRows — transform: mom/yoy (CPI index level)', () => {
  const defMom = makeDef({ id: 'us-cpi-mensual', fallbackStaticId: 'us-cpi-mensual', manualKey: 'us-cpi-mensual', providerSeriesCode: 'CPIAUCSL', transformation: 'mom', unit: '%' })
  const defYoy = makeDef({ id: 'us-cpi-anual', fallbackStaticId: 'us-cpi-anual', manualKey: 'us-cpi-anual', providerSeriesCode: 'CPIAUCSL', transformation: 'yoy', unit: '%' })
  const fetchedAt = '2026-07-10T00:00:00.000Z'
  const dateRange = { from: '2024-01-01', to: '2024-12-31' }

  it('derives mom % from a monthly index-level series', () => {
    const raw = Array.from({ length: 13 }, (_, i) => ({
      date: `2023-${String((i % 12) + 1).padStart(2, '0')}-01`,
      value: 300 + i,
    }))
    const rows = buildObservationRows(defMom, 'BLS (via FRED)', raw, { from: '2023-01-01', to: '2024-12-31' }, fetchedAt, null)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.metadata.isDerived, true)
      assert.equal(row.metadata.transformation, 'mom')
    }
  })

  it('derives yoy % from the SAME index-level series with a different transform', () => {
    const raw = Array.from({ length: 24 }, (_, i) => {
      const year = i < 12 ? 2023 : 2024
      const month = (i % 12) + 1
      return { date: `${year}-${String(month).padStart(2, '0')}-01`, value: (year === 2023 ? 300 : 310) + month }
    })
    const rows = buildObservationRows(defYoy, 'BLS (via FRED)', raw, dateRange, fetchedAt, null)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.metadata.transformation, 'yoy')
      assert.equal(typeof row.value, 'number')
    }
  })
})

describe('fredMacroCore date helpers', () => {
  it('todayIso returns YYYY-MM-DD', () => {
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('firstDateFor(10) is ~10 years before today', () => {
    const d = new Date(firstDateFor(10))
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 365)
    assert.ok(diff >= 9.9 && diff <= 10.1)
  })
})
