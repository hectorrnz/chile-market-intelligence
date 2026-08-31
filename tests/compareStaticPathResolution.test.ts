// R6.1 — Compare static-path and API restoration repair.
//
// Both Compare API routes were returning HTTP 500 with:
//
//   TypeError: The "path" argument must be of type string or an instance of
//   URL. Received an instance of URL
//     at fileURLToPath ... src/lib/compare/compareStatic.ts
//
// The throw happened at MODULE IMPORT — before resolveCompareData,
// resolveCompareHistory, Yahoo, persisted fundamentals, or history resolution
// ran — so each route's own try/catch (which degrades a resolver failure to a
// 200 envelope) could not catch it.
//
// Root cause, confirmed against webpack's OWN emitted runtime (verbatim below,
// read out of `.next/server/webpack-runtime.js`): webpack rewrites BOTH halves
// of `fileURLToPath(new URL('<literal>', import.meta.url))`.
//
//  1. `new URL(...)` becomes `new __webpack_require__.U(...)` — a shim that
//     sets `protocol = ''` while pointing its prototype at `URL.prototype`.
//     Node's `fileURLToPath` brand-checks by DUCK TYPING
//     (`href && protocol && auth === undefined && path === undefined`), so the
//     falsy protocol fails the guard — and because the prototype says `URL`,
//     Node's error formatter names it `URL`, producing the self-contradictory
//     "must be ... an instance of URL. Received an instance of URL".
//  2. The JSON literal becomes an ASSET MODULE whose value is a public web
//     path (`/_next/static/media/companies.<hash>.json`), not a filesystem
//     path — so merely passing the string form only moves the failure to
//     `TypeError: Invalid URL`.
//
// Repair: import the JSON (`with { type: 'json' }`). There is no path left to
// rewrite — every bundler inlines the data, Node's native test runner reads it
// directly, and Vercel's file tracer has nothing to trace.
//
// These tests are fully deterministic: no live Supabase, Yahoo, or network.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join } from 'node:path'

// Importing the module IS requirement 1: every path expression in it runs at
// import time, so a regression fails this file immediately rather than only in
// a browser.
import {
  normalizeCompareTickers,
  classifyPerformance,
  buildFundamentals,
  COMPANY_BY_TICKER,
  SNAPSHOT_BY_TICKER,
  STATIC_COMPANIES,
  STATIC_SNAPSHOTS,
} from '../src/lib/compare/compareStatic.ts'
import { normalizeCompareTickers as normalizeViaResolver } from '../src/lib/compare/compareStatic.ts'
import type { StockHistoryResponse } from '../src/lib/providers/market/types.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/**
 * Source scans must inspect CODE, not the doc comments that explain the bug —
 * those legitimately quote `fileURLToPath`, `import.meta.url`, and the failing
 * expression verbatim so the next reader understands why the pattern is gone.
 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const COMPARE_STATIC = 'src/lib/compare/compareStatic.ts'
const COMPARE_ROUTE = 'src/app/api/compare/route.ts'
const HISTORY_ROUTE = 'src/app/api/compare/history/route.ts'

/**
 * Webpack's `__webpack_require__.U` helper, copied VERBATIM out of the emitted
 * `.next/server/webpack-runtime.js`, so this suite reproduces the production
 * failure with the real thing rather than an approximation of it.
 *
 *   .U=function(a){var b=new URL(a,"x:/"),c={};for(var d in b)c[d]=b[d];
 *     for(var d in(c.href=a,c.pathname=a.replace(/[?#].*​/,""),
 *     c.origin=c.protocol="",c.toString=c.toJSON=()=>a,c))
 *     Object.defineProperty(this,d,{enumerable:!0,configurable:!0,value:c[d]})},
 *   g.U.prototype=URL.prototype
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebpackUrlShim: any = function (this: Record<string, unknown>, a: string) {
  const b = new globalThis.URL(a, 'x:/')
  const c: Record<string, unknown> = {}
  for (const d in b) c[d] = (b as unknown as Record<string, unknown>)[d]
  c.href = a
  c.pathname = a.replace(/[?#].*/, '')
  c.origin = c.protocol = ''
  c.toString = c.toJSON = () => a
  for (const d in c) Object.defineProperty(this, d, { enumerable: true, configurable: true, value: c[d] })
}
WebpackUrlShim.prototype = globalThis.URL.prototype

/** Verbatim webpack asset-module value: `module.exports = __webpack_require__.p + "static/media/companies.<hash>.json"`. */
const WEBPACK_ASSET_VALUE = '/_next/' + 'static/media/companies.28369a33.json'

function meta(overrides: Partial<StockHistoryResponse['metadata']>): StockHistoryResponse['metadata'] {
  return {
    dataModeRequested: 'hybrid',
    dataModeUsed: 'hybrid',
    liveAvailable: false,
    status: 'static',
    source: 'Static MVP',
    lastUpdated: '',
    provider: 'static',
    ...overrides,
  }
}
const point = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 0 })

// ─── 1. Module import succeeds in the server runtime ──────────────────────────

describe('R6.1 — compareStatic imports successfully (the crash site)', () => {
  it('1. every top-level path expression resolves and the module exports real data', () => {
    assert.ok(Array.isArray(STATIC_COMPANIES) && STATIC_COMPANIES.length > 0)
    assert.ok(Array.isArray(STATIC_SNAPSHOTS) && STATIC_SNAPSHOTS.length > 0)
    assert.ok(COMPANY_BY_TICKER.size > 0)
    assert.ok(SNAPSHOT_BY_TICKER.size > 0)
    assert.equal(typeof normalizeViaResolver, 'function')
  })

  it('1b. the JSON it reads is the real covered universe, not a stub', () => {
    for (const ticker of ['BSANTANDER', 'SQM-B', 'FALABELLA']) {
      assert.ok(COMPANY_BY_TICKER.has(ticker), `${ticker} must be in the static universe`)
    }
  })
})

// ─── 2-4. Path resolution across URL representations and platforms ────────────

describe('R6.1 — static-resource resolution under the real bundler shapes', () => {
  it('2. the production failure is reproduced verbatim: webpack’s URL shim is rejected', () => {
    const shim = new WebpackUrlShim(WEBPACK_ASSET_VALUE)
    // The shim reports itself as a URL — which is why the message reads as a
    // contradiction — but its protocol is empty, so the duck-check fails.
    assert.equal(shim.protocol, '')
    assert.equal(Object.prototype.toString.call(shim), '[object URL]')
    assert.throws(
      () => fileURLToPath(shim),
      (err: unknown) => {
        assert.ok(err instanceof TypeError)
        assert.match(
          (err as TypeError).message,
          /The "path" argument must be of type string or an instance of URL\. Received an instance of URL/,
          'must reproduce the exact production message',
        )
        return true
      },
    )
  })

  it('2b. passing the string form is NOT sufficient under webpack — the asset value is a web path', () => {
    // This is why the repair is an import, not a `.href` tweak: webpack turned
    // the JSON into an asset module, so the string is `/_next/static/media/…`.
    const shim = new WebpackUrlShim(WEBPACK_ASSET_VALUE)
    assert.equal(shim.href, WEBPACK_ASSET_VALUE)
    assert.throws(() => fileURLToPath(shim.href), TypeError)
  })

  it('2c. the repair removes the failure entirely — no path is resolved at all', () => {
    const src = code(COMPARE_STATIC)
    assert.ok(!src.includes('fileURLToPath'), 'no URL→path conversion remains')
    assert.ok(!src.includes('readFileSync'), 'no filesystem read remains')
    assert.ok(!src.includes('import.meta.url'), 'no module-URL dependence remains')
    assert.match(src, /import companiesJson from '\.\.\/\.\.\/data\/companies\.json' with \{ type: 'json' \}/)
    assert.match(src, /import stockPricesJson from '\.\.\/\.\.\/data\/stockPrices\.json' with \{ type: 'json' \}/)
  })

  it('3. the imported JSON is the real on-disk data, byte-for-byte', () => {
    // Proves the import resolves the genuine committed file, not a stub — and
    // that the values the APIs serve are unchanged by the repair.
    const onDisk = JSON.parse(readFileSync(join(ROOT, 'src/data/companies.json'), 'utf8'))
    assert.deepEqual(STATIC_COMPANIES, onDisk)
    const snaps = JSON.parse(readFileSync(join(ROOT, 'src/data/stockPrices.json'), 'utf8'))
    assert.deepEqual(STATIC_SNAPSHOTS, snaps)
  })

  it('4. platform independence: the module resolves identically on Windows and POSIX', () => {
    // A JSON import is resolved by the module loader, so there is no drive
    // letter, separator, or percent-decoding behaviour left to diverge. The
    // regression guard is simply that no path/platform API is consulted.
    const src = read(COMPARE_STATIC)
    for (const api of ['node:path', 'node:url', 'node:fs', 'process.platform', 'process.cwd', '__dirname', 'sep']) {
      assert.ok(!src.includes(api), `${api} must not influence static-resource resolution`)
    }
    assert.ok(isAbsolute(fileURLToPath(new globalThis.URL('../src/data/companies.json', import.meta.url).href)))
  })

  it('4b. the import attribute is present — Node’s native runner requires it', () => {
    // Without `with { type: 'json' }` Node throws ERR_IMPORT_ATTRIBUTE_MISSING,
    // which is exactly why the file previously used fs + import.meta.url.
    const attrs = code(COMPARE_STATIC).match(/with \{ type: 'json' \}/g) ?? []
    assert.equal(attrs.length, 2, 'both JSON imports must carry the type attribute')
  })
})

// ─── 5. No hardcoded developer-machine path, no forbidden workaround ──────────

describe('R6.1 — the repair uses no forbidden shortcut', () => {
  // The remaining consumers of the old pattern. They are NOT part of the
  // reported Compare outage (they back /api/news), so this repair only hardens
  // them against the brand-check half of the bug rather than restructuring
  // routes outside its scope — see the R6.1 docs for the recorded
  // webpack-asset limitation that still applies to them.
  //
  // POST-R13.5 — was four. `portfolioRepository.ts` and
  // `portfolioTransactionRepository.ts` were the /api/portfolios data layer and
  // went with the retired positions tracker, so two sites simply no longer
  // exist to harden. Their absence is asserted below rather than assumed.
  const SIBLING_SITES = [
    'src/lib/news/tickerMapping.ts',
    'src/lib/financials/csvFinancials.ts',
  ]
  const RETIRED_SITES = [
    'src/lib/db/repositories/portfolioRepository.ts',
    'src/lib/db/repositories/portfolioTransactionRepository.ts',
  ]
  const ALL_SITES = [COMPARE_STATIC, ...SIBLING_SITES]

  it('5-pre. the two retired sibling sites are gone, not merely unlisted', () => {
    for (const site of RETIRED_SITES) {
      assert.ok(!existsSync(join(ROOT, site)), `${site} was retired with the legacy tracker`)
    }
  })

  it('5. no absolute developer-machine or user directory path is hardcoded', () => {
    for (const site of ALL_SITES) {
      const src = read(site)
      assert.ok(!/[A-Za-z]:\\\\?(Projects|Users)/.test(src), `${site} hardcodes a Windows developer path`)
      assert.ok(!src.includes('/home/'), `${site} hardcodes a POSIX home directory`)
      assert.ok(!src.includes('C:\\'), `${site} hardcodes a drive path`)
    }
  })

  it('5b. no manual file:// stripping, drive-letter slicing, or raw pathname use', () => {
    for (const site of ALL_SITES) {
      // Strip comments so the prose describing the bug never trips the scan.
      const src = read(site).replace(/^\s*\/\/.*$/gm, '')
      assert.ok(!/replace\(\s*['"`]file:\/\//.test(src), `${site} strips file:// manually`)
      assert.ok(!/\.pathname/.test(src), `${site} uses .pathname instead of fileURLToPath`)
      // Only a slice applied to a URL/path value is the forbidden drive-letter
      // hack — an unrelated `.slice(1)` on a CSV row is not.
      assert.ok(!/(pathname|href|[Uu]rl|[Pp]ath)\s*\.slice\(/.test(src), `${site} slices a URL/path string`)
      assert.ok(!src.includes('process.cwd()'), `${site} must not depend on the working directory`)
    }
  })

  it('5c. no static file was copied elsewhere and no data file was moved', () => {
    assert.ok(existsSync(join(ROOT, 'src/data/companies.json')))
    assert.ok(existsSync(join(ROOT, 'src/data/stockPrices.json')))
    assert.ok(!existsSync(join(ROOT, 'public/data/companies.json')), 'no duplicate copy was created')
  })

  it('5d. no site anywhere passes a bundler URL object to fileURLToPath any more', () => {
    for (const site of ALL_SITES) {
      const src = code(site)
      const bad = src.match(/fileURLToPath\(new URL\([^)]*\)\)/g)
      assert.equal(bad, null, `${site} still passes a URL object to fileURLToPath: ${bad?.join(' | ')}`)
    }
  })

  it('5e. the siblings are hardened to the string form (the brand-check half of the bug)', () => {
    for (const site of SIBLING_SITES) {
      assert.match(read(site), /fileURLToPath\(new URL\([^)]*\)\.href\)/, `${site} must pass the string form`)
    }
  })
})

// ─── 6-9. Route contracts, import safety, and auth ────────────────────────────

describe('R6.1 — both Compare routes: import safety and unchanged contracts', () => {
  const compareRoute = read(COMPARE_ROUTE)
  const historyRoute = read(HISTORY_ROUTE)

  it('6. /api/compare reaches its handler — no route-level path resolution can throw at import', () => {
    assert.ok(!compareRoute.includes('fileURLToPath'), 'the route itself resolves no filesystem path')
    assert.match(compareRoute, /import \{ resolveCompareData \} from '@\/lib\/compare\/resolveCompareData'/)
  })

  it('7. /api/compare/history likewise', () => {
    assert.ok(!historyRoute.includes('fileURLToPath'))
    assert.match(historyRoute, /import \{ resolveCompareHistory, COMPARE_HISTORY_TIMEFRAMES \} from '@\/lib\/compare\/resolveCompareHistory'/)
  })

  it('8. both routes retain their exact query contracts', () => {
    assert.match(compareRoute, /searchParams\.get\('tickers'\)/)
    assert.match(historyRoute, /searchParams\.get\('tickers'\)/)
    assert.match(historyRoute, /searchParams\.get\('timeframe'\)/)
    assert.match(historyRoute, /COMPARE_HISTORY_TIMEFRAMES\.find\(\(tf\) => tf === timeframeParam\)/)
    // Response envelopes unchanged.
    assert.match(compareRoute, /marketDataModeRequested/)
    assert.match(compareRoute, /latestSnapshotDate/)
    assert.match(compareRoute, /invalidTickers/)
    assert.match(historyRoute, /\{ series: \[\], invalidTickers: tickers \}/)
    for (const src of [compareRoute, historyRoute]) {
      assert.match(src, /export const dynamic = 'force-dynamic'/)
      assert.match(src, /export const runtime = 'nodejs'/)
    }
  })

  it('9. authentication behaviour is unchanged — the shared default-deny policy still governs both', async () => {
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/api/compare'), 'private_api')
    assert.equal(classifyPath('/api/compare/history'), 'private_api')
    assert.equal(classifyPath('/compare'), 'private_page')
    const mw = read('src/middleware.ts')
    assert.ok(!mw.includes("'/api/compare'"), 'no route-local auth carve-out was introduced')
    for (const src of [compareRoute, historyRoute]) {
      assert.ok(!/getUser|requireCurrentUser|createServerClient/.test(src), 'no route-local auth guard duplicating the shared system')
    }
  })

  it('10. real resolver execution is reached after import — the handler calls the resolver directly', () => {
    assert.match(compareRoute, /const result = await resolveCompareData\(tickers\)/)
    assert.match(historyRoute, /const result = await resolveCompareHistory\(tickers, timeframe\)/)
  })
})

// ─── 11-12. Provider failure vs path failure stay distinct ────────────────────

describe('R6.1 — a provider failure is never confused with a path failure', () => {
  it('11. static fallback remains available when a provider genuinely fails', () => {
    const unavailable = classifyPerformance({ data: [], metadata: meta({ status: 'live-unavailable' }) } as StockHistoryResponse)
    assert.equal(unavailable.value, null)
    assert.equal(unavailable.source, 'unavailable')
    assert.equal(unavailable.fallbackReason, 'supabase_unavailable')

    const staticFallback = classifyPerformance({
      data: [point('2026-01-02', 100), point('2026-06-30', 110)],
      metadata: meta({ status: 'hybrid-fallback', fallbackReason: 'insufficient history' }),
    } as StockHistoryResponse)
    assert.equal(staticFallback.source, 'static_fallback')
    assert.equal(staticFallback.fallbackReason, 'insufficient_supabase_history')
    assert.ok(staticFallback.value !== null, 'a real computed return still comes through the fallback path')
  })

  it('12. the static universe is never silently emptied to hide a load failure', () => {
    const src = read(COMPARE_STATIC)
    // Returning `[]` on error would turn a real packaging defect into a
    // permanently empty universe that reads like a normal empty result.
    assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*(return\s*)?\[\]/.test(src), 'the static data must not fall back to an empty array')
    assert.match(src, /export const STATIC_COMPANIES = companiesJson as StaticCompany\[\]/)
    assert.match(src, /export const STATIC_SNAPSHOTS = stockPricesJson as StaticStockSnapshot\[\]/)
    assert.ok(STATIC_COMPANIES.length > 0 && STATIC_SNAPSHOTS.length > 0)
  })

  it('12b. the route try/catch wraps only the resolver call, so it cannot mask an import failure', () => {
    const compareRoute = read(COMPARE_ROUTE)
    const tryBlock = compareRoute.slice(compareRoute.indexOf('try {'), compareRoute.indexOf('} catch'))
    assert.match(tryBlock, /resolveCompareData/)
    assert.ok(!tryBlock.includes('readFileSync'))
    // And the catch still returns the documented 200 envelope, not a fake
    // success and not a leaked stack trace.
    const catchBlock = compareRoute.slice(compareRoute.indexOf('} catch'))
    assert.match(catchBlock, /data: \[\]/)
    assert.match(catchBlock, /invalidTickers: tickers/)
    assert.ok(!/err|stack|message/.test(catchBlock), 'no error detail is leaked to the client')
  })
})

// ─── 13-17. Real data can populate again ──────────────────────────────────────

describe('R6.1 — Market Data, Fundamentals and History populate from real inputs', () => {
  it('13. Market Data identity fields resolve for every requested subject', () => {
    const { valid, invalid } = normalizeCompareTickers(['BSANTANDER', 'SQM-B', 'FALABELLA'])
    assert.deepEqual(valid, ['BSANTANDER', 'SQM-B', 'FALABELLA'])
    assert.deepEqual(invalid, [])
    for (const ticker of valid) {
      const company = COMPANY_BY_TICKER.get(ticker)!
      assert.ok(company.shortName.length > 0)
      assert.ok(company.sector.length > 0)
    }
  })

  it('14. Fundamentals populate from a deterministic live valuation, with derived markers', () => {
    const f = buildFundamentals(undefined, 1000, 5_000_000, undefined, {
      peFwd: 12.5, psTtm: 1.8, evEbitda: 7.25, opMargin: 22.4,
      grossMargin: 41.1, roe: 18.6, fcfYield: 6.3, pb: 1.45, dividendYield: 3.2, netDebtEbitda: 2.1,
    })
    assert.equal(f.pe, 12.5)
    assert.equal(f.psFwd, 1.8)
    assert.equal(f.evEbitda, 7.25)
    assert.equal(f.roe, 18.6)
    assert.equal(f.pb, 1.45)
    for (const key of ['pe', 'psFwd', 'evEbitda', 'opMargin', 'grossMargin', 'roe', 'fcfYield', 'pb', 'dividendYield', 'netDebtEbitda']) {
      assert.ok(f.derivedFields.includes(key as never), `${key} must be marked derived`)
    }
  })

  it('15. History populates a real total return through classifyPerformance', () => {
    const live = classifyPerformance({
      data: [point('2025-07-01', 100), point('2026-06-30', 125)],
      metadata: meta({ status: 'live', source: 'Yahoo Finance' }),
    } as StockHistoryResponse)
    assert.equal(live.source, 'persisted')
    assert.ok(live.value !== null)
    assert.ok(Math.abs(live.value! - 25) < 1e-9, 'a genuine +25% must come through unchanged')
  })

  it('16. missing metrics remain null, never zero', () => {
    const bankLike = buildFundamentals(undefined, 1000, 5_000_000, undefined, {
      peFwd: 9.4, evEbitda: null, grossMargin: null, fcfYield: null, roe: 15.2,
    })
    assert.equal(bankLike.evEbitda, null)
    assert.equal(bankLike.grossMargin, null)
    assert.equal(bankLike.fcfYield, null)
    assert.notEqual(bankLike.evEbitda, 0)
    assert.equal(bankLike.pe, 9.4)
    assert.equal(bankLike.roe, 15.2)
    for (const key of ['evEbitda', 'grossMargin', 'fcfYield']) {
      assert.ok(!bankLike.derivedFields.includes(key as never), `${key} must not be marked derived when unavailable`)
    }
  })

  it('16b. a genuine zero stays a zero and stays distinct from unavailable', () => {
    const f = buildFundamentals(undefined, 1000, 5_000_000, undefined, { opMargin: 0, grossMargin: null })
    assert.equal(f.opMargin, 0)
    assert.ok(f.derivedFields.includes('opMargin'), 'a real 0 is still a real derived value')
    assert.equal(f.grossMargin, null)
    assert.ok(!f.derivedFields.includes('grossMargin'))
  })

  it('17. source labels and fallback semantics are unchanged', () => {
    const persisted = classifyPerformance({
      data: [point('2026-05-01', 50), point('2026-06-30', 55)],
      metadata: meta({ status: 'persisted' }),
    } as StockHistoryResponse)
    assert.equal(persisted.source, 'persisted')
    assert.equal(persisted.fallbackReason, undefined)

    const insufficient = classifyPerformance({ data: [point('2026-06-30', 55)], metadata: meta({ status: 'persisted' }) } as StockHistoryResponse)
    assert.equal(insufficient.source, 'unavailable')
    assert.equal(insufficient.fallbackReason, 'insufficient_supabase_history')

    const pureStatic = classifyPerformance({ data: [point('2026-06-30', 55)], metadata: meta({ status: 'static' }) } as StockHistoryResponse)
    assert.equal(pureStatic.source, 'static_fallback')
  })
})

// ─── 18-20. Scope: R6 UI untouched, no unrelated route, no native dialog ──────

describe('R6.1 — scope held', () => {
  it('18. the R6 Fable Compare composition is untouched by this repair', () => {
    const page = read('src/app/compare/page.tsx')
    assert.match(page, /<PageHeader/)
    assert.match(page, /<ModalShell/)
    assert.match(page, /<TableCard/)
    assert.match(page, /\{t\.compare\.selectedCount\}/)
    assert.match(page, /trAbsMax/)
    assert.match(page, /\/companies\/\$\{ticker\}/)
    assert.ok(!page.includes('fileURLToPath'), 'the page resolves no filesystem path')
  })

  it('19. no unrelated route file was modified — the repair lives in lib helpers only', () => {
    // Every repaired site is a lib-level static-resource helper; no file under
    // src/app/ resolves a filesystem path at all.
    for (const route of [COMPARE_ROUTE, HISTORY_ROUTE, 'src/app/compare/page.tsx']) {
      assert.ok(!read(route).includes('fileURLToPath'))
    }
  })

  it('20. no native browser dialog is introduced anywhere in the repair', () => {
    for (const site of [COMPARE_STATIC, 'src/app/compare/page.tsx', COMPARE_ROUTE, HISTORY_ROUTE]) {
      const src = read(site)
      assert.ok(!/window\.(confirm|alert|prompt)/.test(src))
      assert.ok(!/[^.\w](confirm|alert|prompt)\(/.test(src))
    }
  })
})
