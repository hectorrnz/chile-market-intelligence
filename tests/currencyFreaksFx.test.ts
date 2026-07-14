// FX Data Task — Unit tests for the CurrencyFreaks Macro / US forex table.
// No live network calls — fetch is stubbed per-test. CURRENCYFREAKS_API_KEY is
// temporarily unset/reset per test via try/finally so this file never depends
// on (or leaks) a real key.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  isCurrencyFreaksConfigured,
  fetchCurrencyFreaksRates,
} from '../src/lib/providers/currencyFreaksClient.ts'
import {
  buildUsForexRows,
  resolveUsForexTable,
  __resetUsForexCacheForTests,
  CURRENCYFREAKS_SOURCE_TYPE,
} from '../src/lib/providers/currencyFreaksFxProvider.ts'

const ORIGINAL_KEY = process.env.CURRENCYFREAKS_API_KEY
const ORIGINAL_FETCH = globalThis.fetch

function restoreEnv() {
  if (ORIGINAL_KEY === undefined) delete process.env.CURRENCYFREAKS_API_KEY
  else process.env.CURRENCYFREAKS_API_KEY = ORIGINAL_KEY
}
function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH
}

function fakeRatesResponse(rates: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ date: '2026-07-14 00:00:00+00', base: 'USD', rates }),
  }
}

// ── isCurrencyFreaksConfigured / missing key ─────────────────────────────────

describe('isCurrencyFreaksConfigured', () => {
  afterEach(restoreEnv)

  it('false when CURRENCYFREAKS_API_KEY is unset', () => {
    delete process.env.CURRENCYFREAKS_API_KEY
    assert.equal(isCurrencyFreaksConfigured(), false)
  })

  it('true when CURRENCYFREAKS_API_KEY is set', () => {
    process.env.CURRENCYFREAKS_API_KEY = 'test-key-123'
    assert.equal(isCurrencyFreaksConfigured(), true)
  })
})

describe('fetchCurrencyFreaksRates — missing key', () => {
  afterEach(restoreEnv)

  it('returns ok:false without attempting a fetch', async () => {
    delete process.env.CURRENCYFREAKS_API_KEY
    const res = await fetchCurrencyFreaksRates(['EUR'])
    assert.equal(res.ok, false)
    if (!res.ok) assert.match(res.reason, /not configured/i)
  })
})

// ── URL / symbols / key never logged or exposed ──────────────────────────────

describe('fetchCurrencyFreaksRates — request shape', () => {
  beforeEach(() => { process.env.CURRENCYFREAKS_API_KEY = 'secret-test-key' })
  afterEach(() => { restoreEnv(); restoreFetch() })

  it('includes apikey and symbols query params in the request URL', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = String(url)
      return fakeRatesResponse({ EUR: '0.87' })
    }) as typeof fetch

    await fetchCurrencyFreaksRates(['EUR'])
    assert.match(capturedUrl, /apikey=secret-test-key/)
    assert.match(capturedUrl, /symbols=EUR/)
  })

  it('never includes the key in a thrown/returned error reason', async () => {
    globalThis.fetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['EUR'])
    assert.equal(res.ok, false)
    if (!res.ok) assert.ok(!res.reason.includes('secret-test-key'))
  })

  it('a non-200 response never leaks the key in the reason string', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['EUR'])
    assert.equal(res.ok, false)
    if (!res.ok) assert.ok(!res.reason.includes('secret-test-key'))
  })
})

// ── Numeric parsing + invalid-rate rejection ─────────────────────────────────

describe('fetchCurrencyFreaksRates — numeric parsing and rejection', () => {
  beforeEach(() => { process.env.CURRENCYFREAKS_API_KEY = 'k' })
  afterEach(() => { restoreEnv(); restoreFetch() })

  it('parses numeric-string rates into numbers', async () => {
    globalThis.fetch = (async () => fakeRatesResponse({ EUR: '0.878464', JPY: '162.42' })) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['EUR', 'JPY'])
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.equal(res.data.rates.EUR, 0.878464)
      assert.equal(res.data.rates.JPY, 162.42)
    }
  })

  it('rejects missing, zero, negative, and non-numeric rates — never coerces to a number', async () => {
    globalThis.fetch = (async () => fakeRatesResponse({
      GOOD: '1.5', ZERO: '0', NEG: '-3.2', BAD: 'not-a-number', EMPTY: '',
    })) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['GOOD', 'ZERO', 'NEG', 'BAD', 'EMPTY'])
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.deepEqual(Object.keys(res.data.rates), ['GOOD'])
      assert.equal(res.data.rates.GOOD, 1.5)
    }
  })

  it('fails when every rate is invalid (no valid rates at all)', async () => {
    globalThis.fetch = (async () => fakeRatesResponse({ ZERO: '0', NEG: '-1' })) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['ZERO', 'NEG'])
    assert.equal(res.ok, false)
  })

  it('fails when the response has no rates object', async () => {
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ base: 'USD' }) })) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['EUR'])
    assert.equal(res.ok, false)
  })

  it('preserves the provider timestamp', async () => {
    globalThis.fetch = (async () => fakeRatesResponse({ EUR: '0.9' })) as unknown as typeof fetch
    const res = await fetchCurrencyFreaksRates(['EUR'])
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.data.date, '2026-07-14 00:00:00+00')
  })
})

// ── Pair methodology: direct vs inverted ─────────────────────────────────────

describe('buildUsForexRows — direct pairs (USD/XXX = raw rate)', () => {
  it('USD/JPY, USD/CHF, USD/CAD, USD/MXN, USD/BRL, USD/CNY, USD/KRW, USD/TWD use the raw rate as-is', () => {
    const rates = { JPY: 162.42, CHF: 0.81475, CAD: 1.415, MXN: 17.5215, BRL: 5.13455, CNY: 6.78, KRW: 1497.95, TWD: 32.177 }
    const rows = buildUsForexRows(rates)
    const byPair = Object.fromEntries(rows.map(r => [r.pair, r]))
    for (const [pair, code] of [['USDJPY', 'JPY'], ['USDCHF', 'CHF'], ['USDCAD', 'CAD'], ['USDMXN', 'MXN'], ['USDBRL', 'BRL'], ['USDCNY', 'CNY'], ['USDKRW', 'KRW'], ['USDTWD', 'TWD']] as const) {
      assert.ok(byPair[pair], `missing ${pair}`)
      assert.equal(byPair[pair].last, rates[code as keyof typeof rates])
      assert.equal(byPair[pair].direction, 'direct')
    }
  })
})

describe('buildUsForexRows — inverted pairs (XXX/USD = 1 / raw rate)', () => {
  it('EUR/USD, GBP/USD, AUD/USD, NZD/USD are the reciprocal of the USD-base rate', () => {
    const rates = { EUR: 0.878464, GBP: 0.74912, AUD: 1.4453, NZD: 1.73506 }
    const rows = buildUsForexRows(rates)
    const byPair = Object.fromEntries(rows.map(r => [r.pair, r]))
    for (const [pair, code] of [['EURUSD', 'EUR'], ['GBPUSD', 'GBP'], ['AUDUSD', 'AUD'], ['NZDUSD', 'NZD']] as const) {
      assert.ok(byPair[pair], `missing ${pair}`)
      assert.ok(Math.abs(byPair[pair].last - 1 / rates[code as keyof typeof rates]) < 1e-9)
      assert.equal(byPair[pair].direction, 'inverted')
    }
  })
})

describe('buildUsForexRows — missing-rate and never-fabricate behavior', () => {
  it('a pair with no source rate is simply omitted, never fabricated as 0 or null-filled', () => {
    const rows = buildUsForexRows({ EUR: 0.9 }) // only EUR present
    assert.equal(rows.length, 1)
    assert.equal(rows[0].pair, 'EURUSD')
  })

  it('never produces a dayChangePct/ytdChangePct — the source has no such field', () => {
    const rows = buildUsForexRows({ EUR: 0.9, JPY: 150 })
    for (const r of rows) {
      assert.equal(r.dayChangePct, null)
      assert.equal(r.ytdChangePct, null)
    }
  })

  it('empty rates map yields an empty row list, not an error', () => {
    assert.deepEqual(buildUsForexRows({}), [])
  })
})

// ── resolveUsForexTable — orchestration + source labeling ────────────────────

describe('resolveUsForexTable', () => {
  beforeEach(() => { __resetUsForexCacheForTests() })
  afterEach(() => { restoreEnv(); restoreFetch(); __resetUsForexCacheForTests() })

  it('reports configured:false and empty rows when no key is set — never errors', async () => {
    delete process.env.CURRENCYFREAKS_API_KEY
    const res = await resolveUsForexTable()
    assert.equal(res.ok, false)
    assert.equal(res.configured, false)
    assert.deepEqual(res.rows, [])
    assert.equal(res.sourceType, CURRENCYFREAKS_SOURCE_TYPE)
  })

  it('labels the source as CurrencyFreaks / unofficial_third_party_fx on success', async () => {
    process.env.CURRENCYFREAKS_API_KEY = 'k'
    globalThis.fetch = (async () => fakeRatesResponse({ EUR: '0.9', JPY: '150' })) as unknown as typeof fetch
    const res = await resolveUsForexTable()
    assert.equal(res.ok, true)
    assert.equal(res.source, 'CurrencyFreaks')
    assert.equal(res.sourceType, 'unofficial_third_party_fx')
    assert.equal(res.base, 'USD')
    assert.ok(res.rows.length > 0)
  })

  it('fails closed (does not fabricate USD base) if the provider reports a non-USD base', async () => {
    process.env.CURRENCYFREAKS_API_KEY = 'k'
    globalThis.fetch = (async () => ({
      ok: true, status: 200, json: async () => ({ date: '2026-07-14', base: 'EUR', rates: { USD: '1.14' } }),
    })) as unknown as typeof fetch
    const res = await resolveUsForexTable()
    assert.equal(res.ok, false)
    assert.deepEqual(res.rows, [])
  })

  it('caches a successful result — a second call within the TTL does not refetch', async () => {
    process.env.CURRENCYFREAKS_API_KEY = 'k'
    let calls = 0
    globalThis.fetch = (async () => { calls++; return fakeRatesResponse({ EUR: '0.9' }) }) as unknown as typeof fetch
    const first = await resolveUsForexTable()
    const second = await resolveUsForexTable()
    assert.equal(calls, 1)
    assert.equal(first.asOf, second.asOf)
  })

  it('never returns raw provider payload fields beyond the derived rows', async () => {
    process.env.CURRENCYFREAKS_API_KEY = 'distinctive-test-secret-xyz789'
    globalThis.fetch = (async () => fakeRatesResponse({ EUR: '0.9' })) as unknown as typeof fetch
    const res = await resolveUsForexTable()
    const json = JSON.parse(JSON.stringify(res))
    assert.ok(!('apikey' in json))
    assert.ok(!JSON.stringify(json).includes('distinctive-test-secret-xyz789'))
  })
})

// ── Macro/US wiring + Chile-FX-untouched regression ──────────────────────────

const repoRoot = path.resolve(import.meta.dirname, '..')
const macroPageSrc = fs.readFileSync(path.join(repoRoot, 'src/app/macro/page.tsx'), 'utf8')

describe('Macro page — US forex table uses CurrencyFreaks, Chile stays BCCh/static', () => {
  it('imports fetchUsForexTable and wires it under a region === "US" branch', () => {
    assert.match(macroPageSrc, /fetchUsForexTable/)
    assert.match(macroPageSrc, /region\s*!==\s*'US'/)
  })

  it('Chile FX depth table still uses getFxRates() filtered by CL_FX — untouched', () => {
    assert.match(macroPageSrc, /CL_FX\.includes\(f\.id\)/)
  })

  it('no hardcoded US_FX static list remains (fully replaced by the CurrencyFreaks row set)', () => {
    assert.doesNotMatch(macroPageSrc, /const US_FX/)
  })

  it('does not fabricate day/YTD change for the CurrencyFreaks rows (no formatPct call on usForex rows)', () => {
    const usForexBlock = macroPageSrc.slice(macroPageSrc.indexOf('usForex?.ok'))
    assert.doesNotMatch(usForexBlock.slice(0, 3000), /formatPct\(r\./)
  })
})

describe('CurrencyFreaks client/provider — no NEXT_PUBLIC env var, no key logging', () => {
  const clientSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/providers/currencyFreaksClient.ts'), 'utf8')
  const providerSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/providers/currencyFreaksFxProvider.ts'), 'utf8')
  const routeSrc = fs.readFileSync(path.join(repoRoot, 'src/app/api/macro/fx/us/route.ts'), 'utf8')

  it('never defines a NEXT_PUBLIC_CURRENCYFREAKS_API_KEY', () => {
    for (const src of [clientSrc, providerSrc, routeSrc]) {
      assert.doesNotMatch(src, /NEXT_PUBLIC_CURRENCYFREAKS/)
    }
  })

  it('reads the key only via process.env.CURRENCYFREAKS_API_KEY, never hardcoded', () => {
    assert.match(clientSrc, /process\.env\.CURRENCYFREAKS_API_KEY/)
  })

  it('the API route never reads process.env.CURRENCYFREAKS_API_KEY directly — only the provider does', () => {
    assert.doesNotMatch(routeSrc, /process\.env\.CURRENCYFREAKS_API_KEY/)
  })
})
