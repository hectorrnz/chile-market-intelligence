// Tests for the live yield curve provider (today / 1 week ago / prior
// year-end), built from already-verified BCCh/FRED series. No live network —
// fetch is stubbed per test.

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  latestOnOrBefore,
  resolveLiveYieldCurve,
  __resetYieldCurveCacheForTests,
  CL_YIELD_CURVE_TENORS,
  US_YIELD_CURVE_TENORS,
} from '../src/lib/providers/yieldCurveProvider.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_BCCH_USER = process.env.BCCH_API_USER
const ORIGINAL_BCCH_PASS = process.env.BCCH_API_PASSWORD

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH
}
function restoreBcchEnv() {
  if (ORIGINAL_BCCH_USER === undefined) delete process.env.BCCH_API_USER
  else process.env.BCCH_API_USER = ORIGINAL_BCCH_USER
  if (ORIGINAL_BCCH_PASS === undefined) delete process.env.BCCH_API_PASSWORD
  else process.env.BCCH_API_PASSWORD = ORIGINAL_BCCH_PASS
}

describe('yield curve legend label — never a hardcoded year (regression)', () => {
  it('i18n.ts "Year-end"/"Cierre" labels carry no literal year — the year is appended dynamically in macro/page.tsx', async () => {
    // Regression for a real bug: the legend read "Year-end 2024" verbatim even
    // in 2026, because the year was baked into the i18n string instead of
    // being derived from the actual yearEndDate/current year. Guards against
    // it recurring by asserting the i18n strings never contain a 4-digit year.
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/lib/i18n.ts', import.meta.url), 'utf8')
    const yearEndLines = src.split('\n').filter((l) => /curveYearEnd:/.test(l))
    assert.ok(yearEndLines.length >= 2, 'expected both EN and ES curveYearEnd entries')
    for (const line of yearEndLines) {
      assert.ok(!/\b(19|20)\d{2}\b/.test(line), `curveYearEnd must not hardcode a year: ${line.trim()}`)
    }
  })

  it('macro/page.tsx derives the year-end year dynamically (from yearEndDate or current year - 1), never a literal', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/app/macro/page.tsx', import.meta.url), 'utf8')
    assert.ok(src.includes('curveYearEndYear'), 'expected a dynamically-computed year-end year variable')
    assert.ok(src.includes('getFullYear() - 1'), 'expected the fallback to derive from the current year, not a hardcoded literal')
  })
})

describe('latestOnOrBefore', () => {
  it('picks the latest point with date <= cutoff', () => {
    const points = [
      { date: '2026-01-05', value: 1 },
      { date: '2026-01-10', value: 2 },
      { date: '2026-01-20', value: 3 },
    ]
    assert.deepEqual(latestOnOrBefore(points, '2026-01-15'), { date: '2026-01-10', value: 2 })
  })

  it('returns null when no point is on or before the cutoff', () => {
    const points = [{ date: '2026-02-01', value: 1 }]
    assert.equal(latestOnOrBefore(points, '2026-01-01'), null)
  })

  it('ignores null-value points', () => {
    const points = [
      { date: '2026-01-05', value: null },
      { date: '2026-01-01', value: 5 },
    ]
    assert.deepEqual(latestOnOrBefore(points, '2026-01-10'), { date: '2026-01-01', value: 5 })
  })

  it('handles an empty array', () => {
    assert.equal(latestOnOrBefore([], '2026-01-01'), null)
  })

  it('works on unsorted input', () => {
    const points = [
      { date: '2026-01-20', value: 3 },
      { date: '2026-01-05', value: 1 },
      { date: '2026-01-10', value: 2 },
    ]
    assert.deepEqual(latestOnOrBefore(points, '2026-01-12'), { date: '2026-01-10', value: 2 })
  })
})

describe('yield curve tenor definitions — reuse only already-verified series', () => {
  it('US tenors reference exactly the 5 verified FRED manualKeys used by the indicators table', () => {
    const keys = US_YIELD_CURVE_TENORS.map((t) => t.manualKey).sort()
    assert.deepEqual(keys, ['us10y', 'us20y', 'us2y', 'us30y', 'us3m'])
    for (const t of US_YIELD_CURVE_TENORS) assert.equal(t.provider, 'FRED')
  })

  it('CL tenors reference exactly the 5 verified BCCh manualKeys used by the indicators table', () => {
    const keys = CL_YIELD_CURVE_TENORS.map((t) => t.manualKey).sort()
    assert.deepEqual(keys, ['btu-10', 'btu-5', 'camara-swap-1y', 'camara-swap-2y', 'tpm'])
    for (const t of CL_YIELD_CURVE_TENORS) assert.equal(t.provider, 'BCCh')
  })

  it('no BCCh tenor references a known-unverified series (btp-10, bcu-5, pdbc-90d, tpm-tna)', () => {
    const keys = CL_YIELD_CURVE_TENORS.map((t) => t.manualKey)
    for (const bad of ['btp-10', 'bcu-5', 'pdbc-90d', 'tpm-tna']) {
      assert.ok(!keys.includes(bad), `must not reference unverified series "${bad}"`)
    }
  })
})

describe('resolveLiveYieldCurve — US (FRED), mocked network', () => {
  afterEach(() => { restoreFetch(); __resetYieldCurveCacheForTests() })

  it('builds today/weekAgo/yearEnd arrays aligned by tenor when every series succeeds', async () => {
    // One flat CSV per series so every tenor resolves to the same 3 dates.
    const csv = [
      'observation_date,VALUE',
      `${new Date().getFullYear() - 1}-12-15,4.00`,
      `${new Date().getFullYear() - 1}-12-31,4.10`,
      `${new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10)},4.20`,
      `${new Date().toISOString().slice(0, 10)},4.30`,
    ].join('\n')
    globalThis.fetch = (async () => ({ ok: true, text: async () => csv })) as unknown as typeof fetch

    const res = await resolveLiveYieldCurve('US')
    assert.equal(res.ok, true)
    assert.equal(res.tenors.length, 5)
    assert.equal(res.today.length, 5)
    assert.equal(res.weekAgo.length, 5)
    assert.equal(res.yearEnd.length, 5)
    assert.ok(res.today.every((v) => v === 4.3))
    assert.ok(res.yearEnd.every((v) => v === 4.1))
    assert.match(res.source, /FRED/)
  })

  it('drops a tenor entirely (never fabricates) if its series has no data before year-end', async () => {
    let call = 0
    globalThis.fetch = (async () => {
      call++
      // First tenor (3M) returns nothing usable; the rest return a full flat series.
      if (call === 1) return { ok: true, text: async () => 'observation_date,VALUE\n' }
      const csv = [
        'observation_date,VALUE',
        `${new Date().getFullYear() - 1}-12-31,5.00`,
        `${new Date().toISOString().slice(0, 10)},5.10`,
      ].join('\n')
      return { ok: true, text: async () => csv }
    }) as unknown as typeof fetch

    const res = await resolveLiveYieldCurve('US')
    assert.equal(res.ok, true)
    assert.equal(res.tenors.length, 4)
    assert.ok(!res.tenors.includes('3M'))
  })

  it('returns ok:false when fewer than 2 tenors succeed', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const res = await resolveLiveYieldCurve('US')
    assert.equal(res.ok, false)
    assert.deepEqual(res.tenors, [])
  })

  it('caches a successful resolution — a second call within the TTL makes no new fetch calls', async () => {
    let calls = 0
    const csv = [
      'observation_date,VALUE',
      `${new Date().getFullYear() - 1}-12-31,4.00`,
      `${new Date().toISOString().slice(0, 10)},4.10`,
    ].join('\n')
    globalThis.fetch = (async () => { calls++; return { ok: true, text: async () => csv } }) as unknown as typeof fetch

    const first = await resolveLiveYieldCurve('US')
    const callsAfterFirst = calls
    assert.ok(callsAfterFirst > 0)
    const second = await resolveLiveYieldCurve('US')
    assert.equal(calls, callsAfterFirst, 'second call should be served from cache, no new fetches')
    assert.deepEqual(second, first)
  })
})

describe('resolveLiveYieldCurve — CL (BCCh), mocked network', () => {
  afterEach(() => { restoreFetch(); restoreBcchEnv(); __resetYieldCurveCacheForTests() })

  it('returns ok:false (falls back to static) when BCCh credentials are not configured', async () => {
    delete process.env.BCCH_API_USER
    delete process.env.BCCH_API_PASSWORD
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; throw new Error('should not be called') }) as typeof fetch
    const res = await resolveLiveYieldCurve('CL')
    assert.equal(res.ok, false)
    assert.equal(fetchCalled, false)
  })

  it('builds a curve from mocked BCCh responses when credentials are present', async () => {
    process.env.BCCH_API_USER = 'test-user'
    process.env.BCCH_API_PASSWORD = 'test-pass'
    const y = new Date().getFullYear() - 1
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        Codigo: 0,
        Series: {
          Obs: [
            { indexDateString: `31-12-${y}`, value: '4.00' },
            { indexDateString: new Date().toISOString().slice(0, 10).split('-').reverse().join('-'), value: '4.20' },
          ],
        },
      }),
    })) as unknown as typeof fetch

    const res = await resolveLiveYieldCurve('CL')
    assert.equal(res.ok, true)
    assert.match(res.source, /Banco Central de Chile/)
    assert.ok(res.tenors.length >= 2)
  })
})
