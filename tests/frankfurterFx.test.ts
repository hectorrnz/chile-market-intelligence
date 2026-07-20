// FX Integrity Task — Unit tests for the Frankfurter Macro / US forex table.
// No live network calls — fetch is stubbed per-test with sanitized fixtures.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  isFrankfurterConfigured,
  fetchFrankfurterRates,
  fetchFrankfurterTimeSeries,
} from '../src/lib/providers/frankfurterClient.ts'
import {
  buildUsForexRows,
  groupRatesByDate,
  latestTwoDates,
  latestDateOnOrBefore,
  pctChange,
  resolveUsForexTable,
  __resetUsForexCacheForTests,
  FRANKFURTER_SOURCE_TYPE,
  FRANKFURTER_SYMBOLS,
} from '../src/lib/providers/frankfurterFxProvider.ts'

const ORIGINAL_FETCH = globalThis.fetch
function restoreFetch() { globalThis.fetch = ORIGINAL_FETCH }

function fakeArrayResponse(rows: Array<{ date: string; base?: string; quote: string; rate: number | string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => rows.map((r) => ({ date: r.date, base: r.base ?? 'USD', quote: r.quote, rate: r.rate })),
  }
}

// ── isFrankfurterConfigured — always true, no key ever needed ───────────────

describe('isFrankfurterConfigured', () => {
  it('is always true — Frankfurter needs no API key', () => {
    assert.equal(isFrankfurterConfigured(), true)
  })
})

// ── fetchFrankfurterRates — latest/historical parsing ────────────────────────

describe('fetchFrankfurterRates — response parsing', () => {
  afterEach(restoreFetch)

  it('parses a flat array of {date, base, quote, rate} into normalized points', async () => {
    globalThis.fetch = (async () => fakeArrayResponse([
      { date: '2026-07-14', quote: 'EUR', rate: 0.87529 },
      { date: '2026-07-14', quote: 'JPY', rate: 162.3 },
    ])) as unknown as typeof fetch
    const res = await fetchFrankfurterRates('USD', ['EUR', 'JPY'])
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.data.length, 2)
      assert.equal(res.data[0].quote, 'EUR')
      assert.equal(res.data[0].rate, 0.87529)
    }
  })

  it('parses a numeric-string rate correctly', async () => {
    globalThis.fetch = (async () => fakeArrayResponse([{ date: '2026-07-14', quote: 'EUR', rate: '0.9' as unknown as number }])) as unknown as typeof fetch
    const res = await fetchFrankfurterRates('USD', ['EUR'])
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.data[0].rate, 0.9)
  })

  it('rejects zero/negative/non-finite rates — never coerces to a number', async () => {
    globalThis.fetch = (async () => ({
      ok: true, status: 200,
      json: async () => [
        { date: '2026-07-14', base: 'USD', quote: 'GOOD', rate: 1.5 },
        { date: '2026-07-14', base: 'USD', quote: 'ZERO', rate: 0 },
        { date: '2026-07-14', base: 'USD', quote: 'NEG', rate: -3 },
        { date: '2026-07-14', base: 'USD', quote: 'BAD', rate: 'not-a-number' },
      ],
    })) as unknown as typeof fetch
    const res = await fetchFrankfurterRates('USD', ['GOOD', 'ZERO', 'NEG', 'BAD'])
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.deepEqual(res.data.map((d) => d.quote), ['GOOD'])
    }
  })

  it('passes date as a query param for historical single-date lookups', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = String(url)
      return fakeArrayResponse([{ date: '2025-12-31', quote: 'EUR', rate: 0.85 }])
    }) as unknown as typeof fetch
    await fetchFrankfurterRates('USD', ['EUR'], '2025-12-31')
    assert.match(capturedUrl, /date=2025-12-31/)
    assert.match(capturedUrl, /base=USD/)
    assert.match(capturedUrl, /quotes=EUR/)
  })

  it('fails when the response has no valid rates', async () => {
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch
    const res = await fetchFrankfurterRates('USD', ['EUR'])
    assert.equal(res.ok, false)
  })

  it('fails on a non-200 response, no key/secret ever involved', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const res = await fetchFrankfurterRates('USD', ['EUR'])
    assert.equal(res.ok, false)
  })
})

// ── fetchFrankfurterTimeSeries ────────────────────────────────────────────────

describe('fetchFrankfurterTimeSeries — response parsing', () => {
  afterEach(restoreFetch)

  it('passes from/to as query params and parses multi-date results', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = String(url)
      return fakeArrayResponse([
        { date: '2026-07-10', quote: 'EUR', rate: 0.874 },
        { date: '2026-07-13', quote: 'EUR', rate: 0.8751 },
        { date: '2026-07-14', quote: 'EUR', rate: 0.8753 },
      ])
    }) as unknown as typeof fetch
    const res = await fetchFrankfurterTimeSeries('USD', ['EUR'], '2026-07-10', '2026-07-14')
    assert.match(capturedUrl, /from=2026-07-10/)
    assert.match(capturedUrl, /to=2026-07-14/)
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.data.length, 3)
  })
})

// ── Pure helpers: date grouping / selection ──────────────────────────────────

describe('groupRatesByDate / latestTwoDates / latestDateOnOrBefore', () => {
  it('groups flat points into a date -> {code: rate} map', () => {
    const map = groupRatesByDate([
      { date: '2026-07-10', quote: 'EUR', rate: 0.87 },
      { date: '2026-07-10', quote: 'JPY', rate: 160 },
      { date: '2026-07-14', quote: 'EUR', rate: 0.88 },
    ])
    assert.deepEqual(map.get('2026-07-10'), { EUR: 0.87, JPY: 160 })
    assert.deepEqual(map.get('2026-07-14'), { EUR: 0.88 })
  })

  it('latestTwoDates returns the two most recent distinct dates, descending', () => {
    const map = groupRatesByDate([
      { date: '2026-07-08', quote: 'EUR', rate: 1 },
      { date: '2026-07-10', quote: 'EUR', rate: 1 },
      { date: '2026-07-14', quote: 'EUR', rate: 1 },
    ])
    const { current, previous } = latestTwoDates(map)
    assert.equal(current, '2026-07-14')
    assert.equal(previous, '2026-07-10')
  })

  it('latestTwoDates: previous is null when only one date is present — a real gap, not fabricated', () => {
    const map = groupRatesByDate([{ date: '2026-07-14', quote: 'EUR', rate: 1 }])
    const { current, previous } = latestTwoDates(map)
    assert.equal(current, '2026-07-14')
    assert.equal(previous, null)
  })

  it('latestTwoDates: an empty map yields both null (never fabricated)', () => {
    const { current, previous } = latestTwoDates(new Map())
    assert.equal(current, null)
    assert.equal(previous, null)
  })

  it('latestDateOnOrBefore finds the closest prior-year-end business day (weekend/holiday-tolerant)', () => {
    // 2025-12-31 was a Wednesday (real trading day) but simulate a gap where
    // only 2025-12-29 has data — the bounded window must find that, not fail.
    const map = groupRatesByDate([
      { date: '2025-12-24', quote: 'EUR', rate: 1 },
      { date: '2025-12-29', quote: 'EUR', rate: 1 },
    ])
    assert.equal(latestDateOnOrBefore(map, '2025-12-31'), '2025-12-29')
  })

  it('latestDateOnOrBefore returns null when nothing in the window qualifies — never fabricated', () => {
    const map = groupRatesByDate([{ date: '2026-01-05', quote: 'EUR', rate: 1 }]) // after cutoff
    assert.equal(latestDateOnOrBefore(map, '2025-12-31'), null)
  })
})

// ── pctChange ─────────────────────────────────────────────────────────────────

describe('pctChange', () => {
  it('computes a standard percentage change', () => {
    assert.ok(Math.abs(pctChange(110, 100)! - 10) < 1e-9)
    assert.ok(Math.abs(pctChange(90, 100)! - -10) < 1e-9)
  })

  it('returns null (never 0) when either snapshot is missing', () => {
    assert.equal(pctChange(undefined, 100), null)
    assert.equal(pctChange(100, undefined), null)
    assert.equal(pctChange(undefined, undefined), null)
  })

  it('returns null on a zero base to avoid dividing by zero', () => {
    assert.equal(pctChange(100, 0), null)
  })
})

// ── buildUsForexRows — direct pair methodology ───────────────────────────────

describe('buildUsForexRows — direct pairs (USD/XXX = raw rate)', () => {
  it('all 8 direct pairs use the raw current rate as-is', () => {
    const current = { JPY: 162.42, CHF: 0.81475, CAD: 1.415, MXN: 17.5215, BRL: 5.13455, CNY: 6.78, KRW: 1497.95, TWD: 32.177 }
    const rows = buildUsForexRows(current, undefined, undefined)
    const byPair = Object.fromEntries(rows.map((r) => [r.pair, r]))
    for (const [pair, code] of [['USDJPY', 'JPY'], ['USDCHF', 'CHF'], ['USDCAD', 'CAD'], ['USDMXN', 'MXN'], ['USDBRL', 'BRL'], ['USDCNY', 'CNY'], ['USDKRW', 'KRW'], ['USDTWD', 'TWD']] as const) {
      assert.ok(byPair[pair], `missing ${pair}`)
      assert.equal(byPair[pair].value, current[code as keyof typeof current])
      assert.equal(byPair[pair].direction, 'direct')
      assert.equal(byPair[pair].derived, false)
      assert.equal(byPair[pair].calculationMethod, 'direct_usd_base')
    }
  })

  it('direct pair 1D change: (current/previous - 1) * 100, on the raw rate', () => {
    const rows = buildUsForexRows({ JPY: 162.0 }, { JPY: 160.0 }, undefined)
    const row = rows.find((r) => r.pair === 'USDJPY')!
    assert.ok(Math.abs(row.oneDayChangePct! - ((162.0 / 160.0 - 1) * 100)) < 1e-9)
  })

  it('direct pair YTD change: (current/ytdBase - 1) * 100, on the raw rate', () => {
    const rows = buildUsForexRows({ JPY: 165.0 }, undefined, { JPY: 150.0 })
    const row = rows.find((r) => r.pair === 'USDJPY')!
    assert.ok(Math.abs(row.ytdChangePct! - ((165.0 / 150.0 - 1) * 100)) < 1e-9)
  })
})

// ── buildUsForexRows — inverted pair methodology ─────────────────────────────

describe('buildUsForexRows — inverted pairs (XXX/USD = 1 / raw rate)', () => {
  it('all 4 inverted pairs are the reciprocal of the USD-base rate', () => {
    const current = { EUR: 0.878464, GBP: 0.74912, AUD: 1.4453, NZD: 1.73506 }
    const rows = buildUsForexRows(current, undefined, undefined)
    const byPair = Object.fromEntries(rows.map((r) => [r.pair, r]))
    for (const [pair, code] of [['EURUSD', 'EUR'], ['GBPUSD', 'GBP'], ['AUDUSD', 'AUD'], ['NZDUSD', 'NZD']] as const) {
      assert.ok(byPair[pair], `missing ${pair}`)
      assert.ok(Math.abs(byPair[pair].value - 1 / current[code as keyof typeof current]) < 1e-9)
      assert.equal(byPair[pair].direction, 'inverted')
      assert.equal(byPair[pair].derived, true)
      assert.equal(byPair[pair].calculationMethod, 'inverted_usd_base')
    }
  })

  it('inverted pair 1D change: invert BOTH snapshots first, then compute % change (not on the raw quote)', () => {
    // EUR strengthens vs USD: raw USD-base EUR rate goes DOWN (0.90 -> 0.85),
    // meaning EUR/USD (the inverted pair) goes UP. If the code wrongly used
    // the raw quote's own % change, the sign would be inverted (wrong).
    const rows = buildUsForexRows({ EUR: 0.85 }, { EUR: 0.90 }, undefined)
    const row = rows.find((r) => r.pair === 'EURUSD')!
    const expected = ((1 / 0.85) / (1 / 0.90) - 1) * 100
    assert.ok(expected > 0, 'sanity: EUR/USD should be UP when the raw USD-base EUR rate falls')
    assert.ok(Math.abs(row.oneDayChangePct! - expected) < 1e-9)
  })

  it('inverted pair YTD change: invert both snapshots first, then compute % change', () => {
    const rows = buildUsForexRows({ EUR: 0.90 }, undefined, { EUR: 1.00 })
    const row = rows.find((r) => r.pair === 'EURUSD')!
    const expected = ((1 / 0.90) / (1 / 1.00) - 1) * 100
    assert.ok(Math.abs(row.ytdChangePct! - expected) < 1e-9)
  })
})

// ── Missing-data / never-fabricate behavior ──────────────────────────────────

describe('buildUsForexRows — missing data never fabricated', () => {
  it('a pair with no current rate is omitted entirely, not zero-filled', () => {
    const rows = buildUsForexRows({ EUR: 0.9 }, undefined, undefined) // only EUR present
    assert.equal(rows.length, 1)
    assert.equal(rows[0].pair, 'EURUSD')
  })

  it('missing previous/ytd snapshot -> null change (never 0, never fabricated)', () => {
    const rows = buildUsForexRows({ JPY: 160, EUR: 0.9 }, undefined, undefined)
    for (const r of rows) {
      assert.equal(r.oneDayChangePct, null)
      assert.equal(r.ytdChangePct, null)
    }
  })

  it('a currency present in previous/ytd but absent from current is never used to fabricate a row', () => {
    const rows = buildUsForexRows({}, { JPY: 160 }, { JPY: 150 })
    assert.equal(rows.length, 0)
  })

  it('empty current rates yields an empty row list, not an error', () => {
    assert.deepEqual(buildUsForexRows({}, undefined, undefined), [])
  })
})

// ── FRANKFURTER_SYMBOLS — supported currency universe ────────────────────────

describe('FRANKFURTER_SYMBOLS — pair universe', () => {
  it('covers exactly the 12 target currencies (8 direct + 4 inverted)', () => {
    assert.deepEqual([...FRANKFURTER_SYMBOLS].sort(), ['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'JPY', 'KRW', 'MXN', 'NZD', 'TWD'])
  })
})

// ── resolveUsForexTable — orchestration + source labeling ────────────────────

describe('resolveUsForexTable', () => {
  beforeEach(() => __resetUsForexCacheForTests())
  afterEach(() => { restoreFetch(); __resetUsForexCacheForTests() })

  it('labels the source as Frankfurter FX reference / free_third_party_fx_reference on success', async () => {
    globalThis.fetch = (async (url: string) => {
      const isYtdWindow = String(url).includes('2025-12-20')
      if (isYtdWindow) return fakeArrayResponse([{ date: '2025-12-31', quote: 'EUR', rate: 0.85 }])
      return fakeArrayResponse([
        { date: '2026-07-10', quote: 'EUR', rate: 0.874 },
        { date: '2026-07-14', quote: 'EUR', rate: 0.8753 },
      ])
    }) as unknown as typeof fetch
    const res = await resolveUsForexTable()
    assert.equal(res.ok, true)
    assert.equal(res.source, 'Frankfurter FX reference')
    assert.equal(res.sourceType, FRANKFURTER_SOURCE_TYPE)
    assert.equal(res.base, 'USD')
    assert.ok(res.providerAttribution.length > 0)
    assert.equal(res.currentDate, '2026-07-14')
    assert.equal(res.previousDate, '2026-07-10')
    assert.equal(res.ytdBaseDate, '2025-12-31')
  })

  it('caches a successful result — a second call within the TTL does not refetch', async () => {
    let calls = 0
    globalThis.fetch = (async () => { calls++; return fakeArrayResponse([{ date: '2026-07-14', quote: 'EUR', rate: 0.9 }]) }) as unknown as typeof fetch
    const first = await resolveUsForexTable()
    const second = await resolveUsForexTable()
    assert.equal(calls, 2) // 2 calls (recent window + ytd window) on the FIRST resolve only
    assert.equal(first.currentDate, second.currentDate)
  })

  it('fails cleanly (ok:false, empty rows) when the recent-window fetch fails — never fabricates', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const res = await resolveUsForexTable()
    assert.equal(res.ok, false)
    assert.deepEqual(res.rows, [])
  })

  it('never returns a raw provider payload — only the derived, sanitized shape', async () => {
    globalThis.fetch = (async () => fakeArrayResponse([{ date: '2026-07-14', quote: 'EUR', rate: 0.9 }])) as unknown as typeof fetch
    const res = await resolveUsForexTable()
    const json = JSON.parse(JSON.stringify(res))
    assert.ok(!('rawQuote' in json))
    assert.ok(Array.isArray(json.rows))
  })
})

// ── Macro page wiring + production-import guards ─────────────────────────────

const repoRoot = path.resolve(import.meta.dirname, '..')
const macroPageSrc = fs.readFileSync(path.join(repoRoot, 'src/app/macro/page.tsx'), 'utf8')
const routeSrc = fs.readFileSync(path.join(repoRoot, 'src/app/api/macro/fx/us/route.ts'), 'utf8')

describe('Macro page — US forex table is Frankfurter-backed', () => {
  it('imports fetchUsForexTable from the frankfurter client-safe helper', () => {
    assert.match(macroPageSrc, /from '@\/lib\/data\/frankfurterFx'/)
  })

  it('the API route resolves via frankfurterFxProvider, not currencyFreaksFxProvider', () => {
    assert.match(routeSrc, /frankfurterFxProvider/)
    assert.doesNotMatch(routeSrc, /currencyFreaksFxProvider/)
  })

  it('renders real 1D/YTD change columns for the US table (day/ytd change no longer omitted)', () => {
    assert.match(macroPageSrc, /oneDayChangePct/)
    assert.match(macroPageSrc, /ytdChangePct/)
  })
})

describe('Chile Macro-page FX depth table — removed from production', () => {
  it('macro/page.tsx no longer imports getFxRates or references CL_FX', () => {
    assert.doesNotMatch(macroPageSrc, /getFxRates/)
    assert.doesNotMatch(macroPageSrc, /CL_FX/)
  })

  it('the CL region renders no FX depth card at all — not even an explanatory placeholder', () => {
    // Superseded by an explicit user request: the placeholder card ("A broader
    // Chilean FX depth table is not shown here — verified BCCh-live pairs are
    // in the table above") was itself clutter. Chile's two verified live pairs
    // are already visible in the indicators table, so the card is simply not
    // rendered and the yield curve takes the full width.
    assert.doesNotMatch(macroPageSrc, /fxClDepthRemoved/)
    assert.match(macroPageSrc, /region === 'CL' \? 'grid-cols-1' : 'grid-cols-2'/)
    // The FX depth card must be US-only.
    assert.match(macroPageSrc, /\{region === 'US' && \(/)
  })
})

describe('CurrencyFreaks removed from the production Macro/US FX path', () => {
  it('no production route/page imports currencyFreaksFxProvider or currencyFreaksClient', () => {
    const productionDirs = ['src/app', 'src/lib/data']
    const offenders: string[] = []
    for (const dir of productionDirs) {
      const abs = path.join(repoRoot, dir)
      const walk = (p: string) => {
        for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
          const full = path.join(p, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (/\.(ts|tsx)$/.test(entry.name)) {
            const content = fs.readFileSync(full, 'utf8')
            if (/currencyFreaksFxProvider|currencyFreaksClient/.test(content) && !full.includes('currencyFreaksFxProvider.ts') && !full.includes('currencyFreaksClient.ts') && !full.includes('currencyFreaksFx.ts')) {
              offenders.push(full)
            }
          }
        }
      }
      walk(abs)
    }
    assert.deepEqual(offenders, [], `CurrencyFreaks still imported by: ${offenders.join(', ')}`)
  })

  it('the deprecated CurrencyFreaks files are explicitly marked as such', () => {
    const clientSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/providers/currencyFreaksClient.ts'), 'utf8')
    const providerSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/providers/currencyFreaksFxProvider.ts'), 'utf8')
    assert.match(clientSrc, /DEPRECATED/)
    assert.match(providerSrc, /DEPRECATED/)
    assert.match(providerSrc, /NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE/)
  })
})

describe('static/sample FX data (fxRates.ts) not imported by production', () => {
  it('is marked test/demo-only', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src/lib/data/fxRates.ts'), 'utf8')
    assert.match(src, /TEST\/DEMO-ONLY/)
    assert.match(src, /NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE/)
  })

  it('no file under src/app or src/lib/data (other than fxRates.ts itself) imports it', () => {
    const productionDirs = ['src/app', 'src/lib/data']
    const offenders: string[] = []
    for (const dir of productionDirs) {
      const abs = path.join(repoRoot, dir)
      const walk = (p: string) => {
        for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
          const full = path.join(p, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith('fxRates.ts')) {
            const content = fs.readFileSync(full, 'utf8')
            if (/from ['"]@\/lib\/data\/fxRates['"]|from ['"]@\/data\/fxRates\.json['"]/.test(content)) {
              offenders.push(full)
            }
          }
        }
      }
      walk(abs)
    }
    assert.deepEqual(offenders, [], `fxRates.ts still imported by: ${offenders.join(', ')}`)
  })
})

describe('No fabricated FX values anywhere in the new code path', () => {
  it('macro/page.tsx never renders a hardcoded/zero fallback for missing FX change — uses "—"', () => {
    const usForexBlock = macroPageSrc.slice(macroPageSrc.indexOf('usForex?.ok'), macroPageSrc.indexOf('usForex?.ok') + 2500)
    assert.match(usForexBlock, /oneDayChangePct != null.*formatPct.*:\s*'—'/s)
    assert.match(usForexBlock, /ytdChangePct != null.*formatPct.*:\s*'—'/s)
  })
})
