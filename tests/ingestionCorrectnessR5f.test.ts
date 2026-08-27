// R13.R5F — FRED y/y correctness + ingestion error observability.
//
// Two defects exposed by the R13.R5D/R5E hosted repairs, fixed at the root here.
//
// 1. WRONG-BASE Y/Y. Incremental ingestion stores a 120-day monthly window but
//    fetched a flat "one extra year from today", so the oldest storable monthly
//    observation needed a base ~485 days back that was never fetched. `yearAgo`
//    then substituted the NEAREST available point without any distance guard.
//    Live consequence: CPI y/y for 2026-07-01 was persisted as 2.95 — that is
//    2026-07 measured against 2025-08 — when the true figure is 3.30. The
//    hosted value was corrected in R13.R5E, but the next scheduled incremental
//    run would have overwritten it again.
//
// 2. `[object Object]`. Supabase/PostgREST rejects with a plain object, and
//    `sanitizeUpsertError` did `String(e)` for anything that was not an Error,
//    so the failure of all 11 index rows on 2026-08-27 recorded no code, no
//    message, no details — the cause is permanently unrecoverable.
//
// CPI levels below are REAL CPIAUCSL values, read from FRED while writing this
// suite, so the arithmetic proved here is the arithmetic that actually ran.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deriveValueChange,
  transformSeries,
  transformLookbackDays,
  requiredFetchStart,
  earliestIso,
  YEAR_AGO_MAX_DRIFT_DAYS,
  FETCH_CONTEXT_TOLERANCE_DAYS,
} from '../src/lib/providers/transforms.ts'
import { sanitizeUpsertError } from '../src/lib/db/repositories/marketRepository.ts'
import { getEnabledBcchSeries, getEnabledFredSeries } from '../src/config/macroSeries.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const FRED_INGEST = 'src/lib/ingestion/fredMacroIngestion.ts'
const BCCH_INGEST = 'src/lib/ingestion/bcchMacroIngestion.ts'

// Real CPIAUCSL index levels.
const CPI = {
  '2025-06-01': 321.435,
  '2025-07-01': 322.169,
  '2025-08-01': 323.291,  // the WRONG base that produced 2.95
  '2026-06-01': 332.568,
  '2026-07-01': 332.813,
} as const

const DAY_MS = 86_400_000
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / DAY_MS)

// ── § 2 — the exact CPI regression ────────────────────────────────────────────

describe('R13.R5F § 2 — CPI y/y regression', () => {
  // The arithmetic the whole defect turns on, stated once so the two candidate
  // answers below are not just numbers a reader has to take on trust.
  test('the two candidate bases give 3.30 (correct) and 2.95 (the observed defect)', () => {
    const vs = (base: keyof typeof CPI) =>
      Math.round((CPI['2026-07-01'] / CPI[base] - 1) * 10000) / 100
    assert.equal(vs('2025-07-01'), 3.3)   // 332.813 / 322.169 − 1
    assert.equal(vs('2025-08-01'), 2.95)  // one month off — what was persisted
  })

  test('with the true 2025-07 base present, 2026-07-01 derives 3.30 — not 2.95', () => {
    const series = Object.entries(CPI).map(([date, value]) => ({ date, value }))
    const out = transformSeries(series, 'yoy')
    const july = out.find(p => p.date === '2026-07-01')
    assert.ok(july, '2026-07-01 must derive a value when its true base is present')
    assert.equal(july.value, 3.3)
    assert.notEqual(july.value, 2.95)
  })

  test('deriveValueChange reports the same 3.30 as the headline value', () => {
    const series = Object.entries(CPI).map(([date, value]) => ({ date, value }))
    const d = deriveValueChange(series, 'yoy')
    assert.ok(d)
    assert.equal(d.value, 3.3)
    assert.equal(d.asOf, '2026-07-01')
  })

  test('MISSING true base cannot substitute 2025-08 — the metric becomes unavailable', () => {
    // Exactly the R13.R5D fetch window: context begins 2025-08-27, so the
    // 2025-07 base is absent and 2025-08 is the nearest candidate.
    const truncated = [
      { date: '2025-08-01', value: CPI['2025-08-01'] },
      { date: '2026-06-01', value: CPI['2026-06-01'] },
      { date: '2026-07-01', value: CPI['2026-07-01'] },
    ]
    const out = transformSeries(truncated, 'yoy')
    const july = out.find(p => p.date === '2026-07-01')
    assert.equal(july, undefined, '2026-07-01 must be DROPPED, not derived from 2025-08')
    assert.ok(
      out.every(p => p.value !== 2.95),
      'the wrong-base figure 2.95 must not appear anywhere in the output',
    )
  })

  test('the nearest-neighbour substitution is rejected for every adjacent month', () => {
    // A month either side is >= 28 days from the target, so both must fail.
    for (const base of ['2025-06-01', '2025-08-01'] as const) {
      const out = transformSeries(
        [{ date: base, value: CPI[base] }, { date: '2026-07-01', value: CPI['2026-07-01'] }],
        'yoy',
      )
      assert.equal(
        out.find(p => p.date === '2026-07-01'), undefined,
        `${base} is an adjacent month, not a year-ago base`,
      )
    }
  })

  test('a base within tolerance IS accepted — real calendars drift', () => {
    // Daily/holiday jitter and month-end resampling move a genuine base by a
    // few days; the guard must not reject those.
    const out = transformSeries(
      [{ date: '2025-07-03', value: CPI['2025-07-01'] }, { date: '2026-07-01', value: CPI['2026-07-01'] }],
      'yoy',
    )
    assert.equal(out.find(p => p.date === '2026-07-01')?.value, 3.3)
  })

  test('the tolerance sits strictly below the shortest calendar month', () => {
    assert.ok(YEAR_AGO_MAX_DRIFT_DAYS < 28, 'must be unable to reach an adjacent month')
    assert.ok(YEAR_AGO_MAX_DRIFT_DAYS >= 7, 'must absorb ordinary weekend/holiday drift')
  })

  test('an unavailable y/y is null, never zero or a guess', () => {
    const d = deriveValueChange([{ date: '2026-07-01', value: CPI['2026-07-01'] }], 'yoy')
    assert.equal(d, null)
  })
})

// ── § 2 — fetch horizon covers the store window ──────────────────────────────

describe('R13.R5F § 2 — fetch context >= store window + transform lookback', () => {
  test('a 120-day monthly y/y window reaches back past the true prior-year base', () => {
    // The concrete failing case: oldest storable point 2026-04-29 needs 2025-04-29.
    const storeStart = '2026-04-29'
    const fetchStart = requiredFetchStart(storeStart, 'yoy', 'monthly')
    assert.ok(fetchStart <= '2025-04-29', `${fetchStart} must reach 2025-04-29`)
    assert.ok(daysBetween(fetchStart, storeStart) >= 366)
  })

  test('the old flat "one year from today" horizon does NOT satisfy the rule', () => {
    // Documents why the constant was insufficient rather than merely tight.
    const today = '2026-08-27'
    const storeStart = '2026-04-29'                       // today − 120d
    const oldFetchStart = '2025-08-27'                    // today − 1y
    assert.ok(daysBetween(oldFetchStart, storeStart) < 366)
    assert.ok(requiredFetchStart(storeStart, 'yoy', 'monthly') < oldFetchStart)
    assert.equal(daysBetween(storeStart, today), 120)
  })

  test('every enabled series: horizon covers its store window + lookback', () => {
    // Store windows read from the module itself, so a future change to either
    // number is caught here rather than in production.
    const fredSrc = read(FRED_INGEST)
    const monthly = Number(/monthly:\s*(\d+)/.exec(fredSrc)?.[1])
    const quarterly = Number(/quarterly:\s*(\d+)/.exec(fredSrc)?.[1])
    assert.equal(monthly, 120, 'the 120-day monthly store window must remain intact')
    assert.equal(quarterly, 400, 'the 400-day quarterly store window must remain intact')

    const windowDaysFor = (freq: string) =>
      freq === 'monthly' ? monthly : freq === 'quarterly' ? quarterly : 14

    const today = '2026-08-27'
    let checked = 0
    for (const s of [...getEnabledBcchSeries(), ...getEnabledFredSeries()]) {
      const windowDays = windowDaysFor(String(s.frequency))
      const storeStart = new Date(new Date(today + 'T00:00:00Z').getTime() - windowDays * DAY_MS)
        .toISOString().slice(0, 10)
      const fetchStart = requiredFetchStart(storeStart, s.transformation, String(s.frequency))
      const lookback = transformLookbackDays(s.transformation, String(s.frequency))
      assert.ok(
        daysBetween(fetchStart, storeStart) >= lookback,
        `${s.id} (${s.frequency}/${s.transformation}): horizon ${fetchStart} short of ${lookback}d lookback`,
      )
      checked++
    }
    assert.ok(checked >= 25, `expected the full enabled registry, checked ${checked}`)
  })

  test('the two lookback-transform series are the ones this protects', () => {
    const withLookback = [...getEnabledBcchSeries(), ...getEnabledFredSeries()]
      .filter(s => transformLookbackDays(s.transformation, String(s.frequency)) >= 366)
      .map(s => s.fallbackStaticId)
      .sort()
    assert.deepEqual(withLookback, ['imacec-anual', 'us-cpi-anual'])
  })

  test('lookback is 366 days for y/y, one period for m/m, zero for pass-through', () => {
    assert.equal(transformLookbackDays('yoy', 'monthly'), 366)
    assert.equal(transformLookbackDays('level-to-yoy', 'monthly'), 366)
    assert.equal(transformLookbackDays('mom', 'monthly'), 31)
    assert.equal(transformLookbackDays('level-diff', 'quarterly'), 92)
    assert.equal(transformLookbackDays('none', 'daily'), 0)
    assert.equal(transformLookbackDays('bp-to-pct', 'daily'), 0)
  })

  test('a lookback-free transform leaves the store window untouched', () => {
    assert.equal(requiredFetchStart('2026-08-13', 'none', 'daily'), '2026-08-13')
  })

  test('the horizon includes calendar tolerance on top of the lookback', () => {
    assert.ok(FETCH_CONTEXT_TOLERANCE_DAYS > 0)
    assert.equal(
      daysBetween(requiredFetchStart('2026-04-29', 'yoy', 'monthly'), '2026-04-29'),
      366 + FETCH_CONTEXT_TOLERANCE_DAYS,
    )
  })

  test('earliestIso never narrows a range', () => {
    assert.equal(earliestIso('2025-08-27', '2025-03-15'), '2025-03-15')
    assert.equal(earliestIso('2024-01-01', '2025-03-15'), '2024-01-01')
  })
})

// ── § 2 — both ingestion modules actually use the derived horizon ────────────

describe('R13.R5F § 2 — ingestion modules wire the derived horizon', () => {
  for (const [label, path] of [['FRED', FRED_INGEST], ['BCCh', BCCH_INGEST]] as const) {
    test(`${label} ingestion derives a per-series horizon instead of the flat constant`, () => {
      const src = read(path)
      assert.match(src, /requiredFetchStart\(/, 'must derive the horizon')
      assert.match(src, /const seriesFetchFrom = earliestIso\(/, 'must never narrow the range')
      assert.match(src, /seriesRangeFrom,\s*def\.transformation,\s*def\.frequency/,
        'the horizon must come from the store window and the transform, not from today')
    })
  }

  test('FRED ingestion passes seriesFetchFrom to the client', () => {
    assert.match(read(FRED_INGEST), /fetchFredSeries\(seriesCode, \{ startDate: seriesFetchFrom \}\)/)
  })

  test('BCCh ingestion passes seriesFetchFrom to the client', () => {
    assert.match(read(BCCH_INGEST), /fetchBcchSeries\(seriesCode, \{ firstDate: seriesFetchFrom/)
  })

  test('both CLI scripts derive the horizon too', () => {
    for (const p of ['scripts/ingest/fredMacro.ts', 'scripts/ingest/bcchMacro.ts']) {
      const src = read(p)
      assert.match(src, /requiredFetchStart\(/, `${p} must derive the horizon`)
      assert.match(src, /seriesFetchFrom/, `${p} must fetch with it`)
    }
  })

  test('the store windows themselves are unchanged by this repair', () => {
    assert.match(read(FRED_INGEST), /monthly:\s*120/)
    assert.match(read(FRED_INGEST), /quarterly:\s*400/)
    assert.match(read(BCCH_INGEST), /MONTHLY_INCREMENTAL_DAYS_BACK = 120/)
  })
})

// ── § 1A — the live chart providers share the defect and the fix ─────────────

describe('R13.R5F § 1A — live macro providers', () => {
  const FRED_PROV = 'src/lib/providers/fredMacroProvider.ts'
  const BCCH_PROV = 'src/lib/providers/bcchMacroProvider.ts'

  test('both derive the fetch horizon from the display window and the transform', () => {
    for (const p of [FRED_PROV, BCCH_PROV]) {
      const src = read(p)
      assert.match(src, /requiredFetchStart\(\s*cutoffIso,\s*def\.transformation,\s*def\.frequency,?\s*\)/,
        `${p} must derive its horizon`)
      assert.match(src, /earliestIso\(/, `${p} must never narrow the range`)
    }
  })

  test('both window AFTER transforming, so the fetched context is actually used', () => {
    // Windowing first threw away the very context the request went and got —
    // the transform then had no year-ago base inside the data.
    for (const p of [FRED_PROV, BCCH_PROV]) {
      const src = read(p)
      assert.match(
        src,
        /transformSeries\([\s\S]{0,120}?\)\s*\n\s*\.filter\(\(?p\)? => p\.date >= cutoffIso\)/,
        `${p} must transform first, then filter to the window`,
      )
      assert.doesNotMatch(
        src,
        /\.filter\(\(?p\)? => p\.date >= cutoffIso\)\s*\n?\s*(const data[^\n]*)?\n?\s*[^\n]*transformSeries/,
        `${p} must not filter before transforming`,
      )
    }
  })

  test('BCCh history no longer fetches exactly the display window', () => {
    const src = read(BCCH_PROV)
    assert.doesNotMatch(src, /fetchBcchSeries\(def\.providerSeriesCode, \{ firstDate: firstDateFor\(years\) \}\)/)
    assert.match(src, /fetchBcchSeries\(def\.providerSeriesCode, \{ firstDate \}\)/)
  })
})

// ── § 2.5 / 2.6 — m/m and pass-through non-regression ────────────────────────

describe('R13.R5F § 2 — MOM and NONE unaffected', () => {
  test('m/m still derives from the immediately prior observation', () => {
    const series = [
      { date: '2026-06-01', value: CPI['2026-06-01'] },
      { date: '2026-07-01', value: CPI['2026-07-01'] },
    ]
    const out = transformSeries(series, 'mom')
    // 332.813 / 332.568 − 1 = 0.0737% → 0.07
    assert.equal(out.find(p => p.date === '2026-07-01')?.value, 0.07)
  })

  test('m/m is unaffected by a missing year-ago base', () => {
    const truncated = [
      { date: '2026-06-01', value: CPI['2026-06-01'] },
      { date: '2026-07-01', value: CPI['2026-07-01'] },
    ]
    assert.equal(deriveValueChange(truncated, 'mom')?.value, 0.07)
  })

  test('level-diff still returns a raw difference', () => {
    const out = transformSeries(
      [{ date: '2026-06-01', value: 158_927 }, { date: '2026-07-01', value: 158_984 }],
      'level-diff',
    )
    assert.equal(out.find(p => p.date === '2026-07-01')?.value, 57)
  })

  test('none and bp-to-pct pass values through unchanged', () => {
    const pts = [{ date: '2026-08-24', value: 4.7 }, { date: '2026-08-25', value: 4.64 }]
    assert.deepEqual(transformSeries(pts, 'none'), pts)
    assert.equal(deriveValueChange(pts, 'none')?.value, 4.64)
    assert.equal(transformSeries([{ date: '2026-08-25', value: 464 }], 'bp-to-pct')[0].value, 4.64)
  })

  test('a full daily pass-through series keeps every point', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      value: 4.5 + i / 100,
    }))
    assert.equal(transformSeries(pts, 'none').length, 30)
  })
})

// ── § 3 — PostgREST error serialization ──────────────────────────────────────

describe('R13.R5F § 3 — sanitizeUpsertError', () => {
  test('an ordinary Error still yields its message', () => {
    assert.equal(sanitizeUpsertError(new Error('connection reset')), 'connection reset')
  })

  test('a string still passes through', () => {
    assert.equal(sanitizeUpsertError('plain failure'), 'plain failure')
  })

  test('a PostgREST-style object keeps code, message, details and hint', () => {
    const out = sanitizeUpsertError({
      code: 'PGRST205',
      message: "Could not find the table 'public.index_snapshots' in the schema cache",
      details: null,
      hint: 'Reload the schema cache',
    })
    assert.match(out, /code=PGRST205/)
    assert.match(out, /message=Could not find the table/)
    assert.match(out, /hint=Reload the schema cache/)
    assert.doesNotMatch(out, /details=/, 'a null field is omitted, not rendered as "null"')
  })

  test('the exact 2026-08-27 failure is no longer "[object Object]"', () => {
    const out = sanitizeUpsertError({ code: '42P10', message: 'no unique constraint matching ON CONFLICT' })
    assert.doesNotMatch(out, /\[object Object\]/)
    assert.equal(out, 'code=42P10 | message=no unique constraint matching ON CONFLICT')
  })

  test('no input of any shape can produce "[object Object]", and none throws', () => {
    // Labelled by index: a null-prototype object cannot be String()-ed, which
    // is precisely the class of value the serializer has to survive.
    const inputs: unknown[] = [
      {}, { code: 'X' }, { unrelated: 1 }, Object.create(null),
      new Error('e'), 'str', 42, true, null, undefined, [], [1, 2],
    ]
    inputs.forEach((input, i) => {
      let out: string
      assert.doesNotThrow(() => { out = sanitizeUpsertError(input) }, `input #${i} threw`)
      assert.doesNotMatch(out!, /\[object Object\]/, `input #${i} collapsed to [object Object]`)
      assert.ok(out!.length > 0, `input #${i} produced an empty string`)
    })
  })

  test('field order is deterministic — allowlist order, not key order', () => {
    const a = sanitizeUpsertError({ hint: 'h', message: 'm', code: 'c', details: 'd' })
    const b = sanitizeUpsertError({ code: 'c', details: 'd', hint: 'h', message: 'm' })
    assert.equal(a, b)
    assert.equal(a, 'code=c | message=m | details=d | hint=h')
  })

  test('an unrecognized object says so instead of dumping itself', () => {
    assert.equal(sanitizeUpsertError({ foo: 'bar' }), 'unrecognized error object')
    assert.equal(sanitizeUpsertError({}), 'unrecognized error object')
  })

  test('null and undefined fail safely', () => {
    assert.equal(sanitizeUpsertError(null), 'unknown error')
    assert.equal(sanitizeUpsertError(undefined), 'unknown error')
  })

  test('secret-like unrelated properties are never serialized', () => {
    const out = sanitizeUpsertError({
      code: 'PGRST301',
      message: 'JWT expired',
      apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super-secret-service-role-key-value-here.sig',
      authorization: 'Bearer sk_live_0123456789abcdefghij',
      connectionString: 'postgresql://postgres:hunter2@db.example.supabase.co:5432/postgres',
      headers: { cookie: 'sb-access-token=abcdef' },
    })
    assert.equal(out, 'code=PGRST301 | message=JWT expired')
    for (const leak of ['super-secret', 'sk_live_', 'hunter2', 'sb-access-token', 'eyJhbGci']) {
      assert.doesNotMatch(out, new RegExp(leak), `must not leak ${leak}`)
    }
  })

  test('a token embedded in an allowlisted field is still redacted', () => {
    const out = sanitizeUpsertError({
      message: 'auth failed for eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz012345',
    })
    assert.match(out, /\*\*\*JWT\*\*\*/)
    assert.doesNotMatch(out, /eyJhbGci/)
  })

  test('output is bounded', () => {
    assert.ok(sanitizeUpsertError({ message: 'x'.repeat(5000) }).length <= 300)
    assert.ok(sanitizeUpsertError(new Error('y'.repeat(5000))).length <= 300)
  })

  test('every branch returns a non-empty string, so failure semantics are unchanged', () => {
    for (const input of [new Error('e'), 'str', { code: 'c' }, {}, null, undefined, 0]) {
      const out = sanitizeUpsertError(input)
      assert.equal(typeof out, 'string')
      assert.ok(out.length > 0, `empty for ${String(input)}`)
    }
  })

  test('the repaired serializer is the one the upsert helpers use', () => {
    const src = read('src/lib/db/repositories/marketRepository.ts')
    assert.match(src, /const SAFE_ERROR_FIELDS = \['code', 'message', 'details', 'hint'\] as const/)
    assert.doesNotMatch(
      src,
      /const msg = e instanceof Error \? e\.message : String\(e\)/,
      'the String(e) collapse must be gone',
    )
    for (const fn of ['upsertStockSnapshots', 'upsertIndexSnapshots', 'upsertSectorPerformanceSnapshots']) {
      assert.match(src, new RegExp(`${fn}[\\s\\S]{0,600}?sanitizeUpsertError\\(res\\.error\\)`))
    }
  })
})
