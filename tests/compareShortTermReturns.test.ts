// R6.2 — short-term return math + Compare analytical hierarchy.
//
// The reported defect: every security showed 1D +0.00% and 5D +0.00%, with a
// Market Data as-of several days stale. Diagnosis against the live provider
// (2026-07-31) found the DATA, not the arithmetic, was at fault, in three
// compounding ways:
//
//  1. Yahoo's daily chart for Santiago (`.SN`) tickers emitted CARRIED-FORWARD
//     FILLER BARS — 2026-07-20…07-30 repeated the 07-17 close with volume 0 on
//     every tracked ticker (BSANTANDER 77, CHILE 188.5, FALABELLA 5835,
//     CENCOSUD 1995). "Latest vs previous bar" therefore compared a filler
//     against a filler: exactly 0.00%, for everything.
//  2. The chart request used `period2 = today`, which Yahoo treats as
//     EXCLUSIVE, so the genuine current session was never fetched — the stale
//     as-of date.
//  3. 1D never consulted the quote, whose `regularMarketPreviousClose` is the
//     authoritative prior close and was healthy throughout (CHILE 192.82 vs
//     196.8 = −2.02%).
//
// All fixtures below are deterministic and hand-written — no live network.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeDailyBars,
  stripNonTradingFillers,
  buildSessionSeries,
  oneDayReturn,
  fiveDayReturn,
  FIVE_SESSION_LOOKBACK,
  type DailyBar,
  type QuoteBasis,
} from '../src/lib/market/shortTermReturns.ts'
import { resolveLiveHistoryDateRange } from '../src/lib/market/marketHistory.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGE = 'src/app/compare/page.tsx'
const RESOLVER = 'src/lib/compare/resolveCompareData.ts'

const bar = (date: string, close: number | null, volume: number | null = 1000): DailyBar => ({ date, close, volume })
/** Six genuine consecutive sessions, monotonically rising 100 → 106. */
const SIX = [bar('2026-07-20', 100), bar('2026-07-21', 101), bar('2026-07-22', 102), bar('2026-07-23', 103), bar('2026-07-24', 104), bar('2026-07-27', 106)]

// ─── 1-2. Core definitions ────────────────────────────────────────────────────

describe('R6.2 — 1D and 5D definitions', () => {
  it('1. 1D uses the latest valid price against the previous trading-session close', () => {
    // Live-shaped: the quote is the numerator, its own previousClose the base.
    const quote: QuoteBasis = { price: 192.82, previousClose: 196.8, asOf: '2026-07-31' }
    const r = oneDayReturn(quote, SIX)
    assert.ok(r.value !== null)
    assert.ok(Math.abs(r.value! - ((192.82 / 196.8 - 1) * 100)) < 1e-9)
    assert.ok(r.value! < 0, 'a real decline stays negative')
    assert.equal(r.asOf, '2026-07-31')
  })

  it('1b. with no quote, 1D falls back to the two most recent genuine sessions', () => {
    const r = oneDayReturn(null, SIX)
    assert.ok(Math.abs(r.value! - ((106 / 104 - 1) * 100)) < 1e-9)
    assert.equal(r.asOf, '2026-07-27')
    assert.equal(r.baseDate, '2026-07-24')
  })

  it('2. 5D uses the latest valid price against the close five TRADING sessions earlier', () => {
    const r = fiveDayReturn(null, SIX)
    assert.equal(FIVE_SESSION_LOOKBACK, 5)
    // 6 sessions → base is the first one, five sessions back from the last.
    assert.ok(Math.abs(r.value! - ((106 / 100 - 1) * 100)) < 1e-9)
    assert.equal(r.baseDate, '2026-07-20')
    assert.equal(r.asOf, '2026-07-27')
  })

  it('2b. a live quote becomes the 5D numerator without shortening the lookback', () => {
    const quote: QuoteBasis = { price: 110, previousClose: 106, asOf: '2026-07-28' }
    const r = fiveDayReturn(quote, SIX)
    // Sessions become 7; base is still exactly five back from the latest.
    assert.equal(r.asOf, '2026-07-28')
    assert.equal(r.baseDate, '2026-07-21')
    assert.ok(Math.abs(r.value! - ((110 / 101 - 1) * 100)) < 1e-9)
  })
})

// ─── 3-4. Gaps must never fabricate a zero ────────────────────────────────────

describe('R6.2 — weekend, holiday and filler gaps never create zero returns', () => {
  it('3. a weekend gap does not create a zero return', () => {
    // Fri → Mon, no bars for Sat/Sun (they simply do not exist).
    const bars = [bar('2026-07-24', 104), bar('2026-07-27', 106)]
    const r = oneDayReturn(null, bars)
    assert.ok(Math.abs(r.value! - ((106 / 104 - 1) * 100)) < 1e-9)
    assert.notEqual(r.value, 0)
  })

  it('4. carried-forward holiday/non-trading filler bars are excluded, not compared', () => {
    // The exact live shape: a real 07-17 close, then repeated volume-0 fillers.
    const bars = [
      bar('2026-07-15', 188.88), bar('2026-07-17', 188.5),
      bar('2026-07-20', 188.5, 0), bar('2026-07-21', 188.5, 0), bar('2026-07-22', 188.5, 0),
      bar('2026-07-30', 188.5, 0), bar('2026-07-31', 192.8),
    ]
    const sessions = stripNonTradingFillers(normalizeDailyBars(bars))
    assert.deepEqual(sessions.map((s) => s.date), ['2026-07-15', '2026-07-17', '2026-07-31'])
    const r = oneDayReturn(null, bars)
    assert.notEqual(r.value, 0, 'the pre-fix bug produced exactly 0 here')
    assert.ok(Math.abs(r.value! - ((192.8 / 188.5 - 1) * 100)) < 1e-9)
    assert.equal(r.baseDate, '2026-07-17')
  })

  it('4b. filler removal is conservative — volume null is not volume 0, and a moved close is kept', () => {
    const notReported = [bar('2026-07-20', 100, null), bar('2026-07-21', 100, null)]
    assert.equal(stripNonTradingFillers(notReported).length, 2, 'null volume must never be treated as zero')
    const movedOnZeroVolume = [bar('2026-07-20', 100, 0), bar('2026-07-21', 101, 0)]
    assert.equal(stripNonTradingFillers(movedOnZeroVolume).length, 2, 'a zero-volume bar whose close moved is real')
  })
})

// ─── 5-9. Null vs zero semantics ──────────────────────────────────────────────

describe('R6.2 — missing data never becomes 0.00%', () => {
  it('5. fewer than two observations yields a null 1D', () => {
    const r = oneDayReturn(null, [bar('2026-07-27', 106)])
    assert.equal(r.value, null)
    assert.equal(r.reason, 'insufficient-sessions')
  })

  it('6. fewer than six observations yields a null 5D', () => {
    const r = fiveDayReturn(null, SIX.slice(0, 5))
    assert.equal(r.value, null)
    assert.equal(r.reason, 'insufficient-sessions')
    assert.equal(fiveDayReturn(null, SIX).value !== null, true, 'exactly six is enough')
  })

  it('7. a genuinely unchanged price produces a real 0.00%', () => {
    const quote: QuoteBasis = { price: 100, previousClose: 100, asOf: '2026-07-31' }
    const r = oneDayReturn(quote, SIX)
    assert.equal(r.value, 0)
    assert.equal(r.reason, undefined, 'a real zero is a value, not an unavailable state')
  })

  it('8. missing/invalid inputs stay null rather than collapsing to zero', () => {
    assert.equal(oneDayReturn(null, []).value, null)
    assert.equal(fiveDayReturn(null, []).value, null)
    assert.equal(oneDayReturn({ price: null, previousClose: 196.8, asOf: '2026-07-31' }, []).value, null)
    // A zero base is not a 0% return — it is an invalid denominator.
    const zeroBase = oneDayReturn(null, [bar('2026-07-24', 0), bar('2026-07-27', 106)])
    assert.equal(zeroBase.value, null)
    assert.equal(zeroBase.reason, 'invalid-base')
  })

  it('9. negative returns remain negative', () => {
    const r = fiveDayReturn(null, [bar('2026-07-20', 110), bar('2026-07-21', 108), bar('2026-07-22', 107), bar('2026-07-23', 105), bar('2026-07-24', 103), bar('2026-07-27', 100)])
    assert.ok(r.value! < 0)
    assert.ok(Math.abs(r.value! - ((100 / 110 - 1) * 100)) < 1e-9)
  })
})

// ─── 10-13. Series hygiene ────────────────────────────────────────────────────

describe('R6.2 — observation selection is deterministic and ordered', () => {
  it('10. observations are sorted chronologically regardless of input order', () => {
    const shuffled = [bar('2026-07-27', 106), bar('2026-07-20', 100), bar('2026-07-24', 104)]
    assert.deepEqual(normalizeDailyBars(shuffled).map((b) => b.date), ['2026-07-20', '2026-07-24', '2026-07-27'])
  })

  it('11. duplicate dates are handled deterministically — the last occurrence wins', () => {
    const dup = [bar('2026-07-27', 100), bar('2026-07-27', 106)]
    const n = normalizeDailyBars(dup)
    assert.equal(n.length, 1)
    assert.equal(n[0].close, 106, 'a revised print supersedes the earlier one for the same session')
  })

  it('12. invalid observations (null/NaN close, missing date) are excluded', () => {
    const messy = [bar('2026-07-20', 100), bar('2026-07-21', null), { date: '2026-07-22', close: NaN }, { date: '', close: 5 }, bar('2026-07-23', 103)]
    assert.deepEqual(normalizeDailyBars(messy as DailyBar[]).map((b) => b.date), ['2026-07-20', '2026-07-23'])
  })

  it('13. a quote newer than every bar extends the series; a same-dated quote supersedes that bar', () => {
    const newer = buildSessionSeries(SIX, { price: 120, previousClose: 106, asOf: '2026-07-28' })
    assert.equal(newer.length, SIX.length + 1)
    assert.equal(newer[newer.length - 1].close, 120)

    const sameDay = buildSessionSeries(SIX, { price: 120, previousClose: 104, asOf: '2026-07-27' })
    assert.equal(sameDay.length, SIX.length, 'no duplicate session is appended')
    assert.equal(sameDay[sameDay.length - 1].close, 120, 'the intraday price supersedes the provisional bar')
  })
})

// ─── 14-16. As-of, staleness and price basis ──────────────────────────────────

describe('R6.2 — as-of discipline and price basis', () => {
  it('14/15. the live chart window ends AFTER today, because Yahoo period2 is exclusive', () => {
    const r = resolveLiveHistoryDateRange('1M', '2026-07-31')
    assert.equal(r.to, '2026-08-01', 'passing today silently dropped the current session')
    assert.equal(resolveLiveHistoryDateRange('5D', '2026-07-31').to, '2026-08-01')
  })

  it('15b. the row as-of comes from the live quote, and the surface as-of is the newest row', () => {
    const src = code(RESOLVER)
    assert.match(src, /latestSnapshotDate: val\?\.priceAsOf \?\? snapshotsResp\.metadata\.latestSnapshotDate \?\? null/)
    assert.match(src, /const latestRowAsOf = data/)
    assert.match(src, /\(max === null \|\| d > max \? d : max\)/)
  })

  it('15c. a stale subject keeps its own as-of rather than being hidden or dropped', () => {
    // Per-row latestSnapshotDate is set per ticker, so a subject whose quote is
    // older retains its real date while remaining in the comparison.
    const src = code(RESOLVER)
    assert.ok(src.includes('latestSnapshotDate: val?.priceAsOf'))
    assert.ok(!/data = data\.filter/.test(src), 'no subject is removed for being stale')
  })

  it('16. market cap and the 1D basis come from the SAME quote snapshot', () => {
    const src = code(RESOLVER)
    // One QuoteBasis per ticker, built from the same `val` that supplies price
    // and market cap through buildTickerValuationCore.
    assert.match(src, /const quote: QuoteBasis \| null =\s*\n?\s*val\?\.price != null \? \{ price: val\.price, previousClose: val\.previousClose, asOf: val\.priceAsOf \} : null/)
    assert.match(src, /performance: await resolvePerformance\(ticker, quote\)/)
    const provider = code('src/lib/providers/market/yahooRatiosProvider.ts')
    assert.match(provider, /const previousClose = finite\(/)
    assert.match(provider, /regularMarketPreviousClose/)
  })
})

// ─── 17. Longer windows preserved ─────────────────────────────────────────────

describe('R6.2 — 1M, YTD and 1Y keep their existing definition', () => {
  it('17. they still resolve through classifyPerformance over their own window', () => {
    const src = code(RESOLVER)
    assert.match(src, /const LONG_TIMEFRAMES: StockTimeframe\[\] = \['1M', 'YTD', '1Y'\]/)
    assert.match(src, /oneMonth: classifyPerformance\(oneMonth\)/)
    assert.match(src, /ytd: classifyPerformance\(ytd\)/)
    assert.match(src, /oneYear: classifyPerformance\(oneYear\)/)
    // 1D/5D no longer go through the old narrow-window path.
    assert.ok(!src.includes("'1D'"), '1D is no longer fetched as its own chart window')
  })
})

// ─── 18-24. Analytical hierarchy ──────────────────────────────────────────────

describe('R6.2 — analytical hierarchy on /compare', () => {
  const src = read(PAGE)
  const at = (needle: string) => {
    const i = src.indexOf(needle)
    assert.ok(i >= 0, `missing marker: ${needle}`)
    return i
  }

  it('18. the chart appears before the Comparative Returns table', () => {
    assert.ok(at('<CompareChart') < at('t.compare.returnsTitle'))
  })

  it('19. the timeframe controls appear before the chart, and are not duplicated', () => {
    assert.ok(at('ariaLabel={t.compare.timeframeLabel}') < at('<CompareChart'))
    assert.equal(src.split('ariaLabel={t.compare.timeframeLabel}').length - 1, 1, 'exactly one timeframe control')
    assert.equal(src.split('<CompareChart').length - 1, 1, 'exactly one chart')
  })

  it('19b. subject selection precedes the timeframe controls', () => {
    assert.ok(at('t.compare.subjectsTitle') < at('ariaLabel={t.compare.timeframeLabel}'))
  })

  it('20. the returns-table title carries the active timeframe', () => {
    assert.match(src, /title=\{`\$\{t\.compare\.returnsTitle\} · \$\{tfLabel\}`\}/)
  })

  it('21. a custom range shows its real date window, not a timeframe code', () => {
    assert.match(src, /const tfLabel = usingCustom \? `\$\{cStart\} → \$\{cEnd\}` : tf/)
  })

  it('22/23/24. chart and table are driven by exactly the same window state', () => {
    // Both read the same `tfLabel`, and every derived figure (Total Return,
    // Difference, Annualized) comes from `rowData`, which is built from
    // seriesFor(...) over the same start/end the chart series uses.
    assert.match(src, /\{tfLabel\}/)
    assert.match(src, /const rowData = valids\.map/)
    assert.match(src, /const chartSeries = rowData/)
    assert.match(src, /const end = usingCustom \? cEnd : DATA_END/)
    assert.match(src, /const start = usingCustom \? cStart : tfStart\(end, tf\)/)
  })

  it('24b. the chart heading states its full analytical definition', () => {
    assert.match(src, /\{t\.compare\.perfTitle\}/)
    assert.match(src, /\{t\.compare\.rebasedZero\}/)
  })
})

// ─── 25-35. Preservation and scope ────────────────────────────────────────────

describe('R6.2 — preservation and scope', () => {
  const src = read(PAGE)

  it('25. chart normalization is untouched — still rebased to 0% inside CompareChart', () => {
    const chart = read('src/components/charts/CompareChart.tsx')
    assert.match(chart, /\(p\.value \/ base - 1\) \* 100/)
    assert.ok(!/smooth|interpolat|forecast|forwardFill/i.test(chart))
  })

  it('26. the API response shape stays backward-compatible', () => {
    const types = read('src/lib/compare/compareTypes.ts')
    assert.match(types, /value: number \| null/)
    assert.match(types, /source: CompareFieldSource/)
    // The new short-term diagnostics live in a separate pure module, not in
    // the wire types, so no consumer contract changed.
    const st = read('src/lib/market/shortTermReturns.ts')
    assert.match(st, /export type ShortTermUnavailableReason/)
  })

  it('27. add/remove/duplicate/max-selection behaviour is unchanged', () => {
    assert.match(src, /usePersistentState<string\[\]>\('cmi\.compareSlots'/)
    assert.match(src, /const s6 = \[\.\.\.slots, '', '', '', '', '', ''\]\.slice\(0, 6\)/)
    assert.match(src, /if \(tk && compMap\[tk\] && !seen\.has\(tk\)\) \{ seen\.add\(tk\); valids\.push/)
    assert.match(src, /next\[i\] = v\.toUpperCase\(\)\.slice\(0, 12\)/)
    assert.match(src, /onClick=\{\(\) => setSlot\(i, ''\)\}/)
  })

  it('28. source footers and badges remain accurate and unchanged in precedence', () => {
    assert.equal(src.split('<TableSourceFooter').length - 1, 4)
    assert.ok(src.includes("returnsStatus !== 'static' ? t.compare.marketSource : t.compare.source"))
    assert.equal(src.split('<MarketDataSourceBadge').length - 1, 2)
  })

  it('29. no mock or synthetic data is introduced', () => {
    // Comments legitimately describe the provider's filler/placeholder bars.
    for (const f of [code('src/lib/market/shortTermReturns.ts'), code('src/lib/compare/resolveCompareData.ts')]) {
      assert.ok(!/\bMath\.random\b/.test(f))
      assert.ok(!/sample|mock|fake|placeholder/i.test(f.replace(/Static MVP sample/g, '')))
    }
  })

  it('30. EN/ES are complete for every new key', () => {
    const i18n = read('src/lib/i18n.ts')
    for (const k of ['subjectsTitle:', 'emptySlot:', 'rebasedZero:']) {
      assert.ok(i18n.split(k).length - 1 >= 2, `${k} must exist in both dictionaries`)
    }
    assert.match(i18n, /subjectsTitle: 'Instrumentos comparados'/)
    assert.match(i18n, /rebasedZero:\s+'Rebasado a 0%'/)
  })

  it('31. styling stays token-driven for both themes', () => {
    const withoutData = src.replace(/const PRESET = \[[^\]]*\]/, '').replace(/const SWATCHES = \[[^\]]*\]/, '')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(withoutData))
    assert.ok(!/\b(bg|text|border)-(gray|slate|zinc|red|green|blue|emerald)-\d{2,3}\b/.test(src))
  })

  it('32. dense tables still scroll inside their cards; no page-level overflow rule added', () => {
    assert.match(src, /minWidth=\{620\}/)
    assert.match(src, /minWidth=\{440\}/)
    assert.match(src, /minWidth=\{560\}/)
    assert.doesNotMatch(read('src/app/globals.css'), /html\s*\{[^}]*min-width/s)
  })

  it('33. R1.5 access control is unchanged', async () => {
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/compare'), 'private_page')
    assert.equal(classifyPath('/api/compare'), 'private_api')
    assert.ok(!read('src/middleware.ts').includes("'/compare'"))
  })

  it('34. no native browser dialog is introduced', () => {
    assert.ok(!/window\.(confirm|alert|prompt)/.test(src))
    assert.ok(!/[^.\w](confirm|alert|prompt)\(/.test(src))
  })

  it('35. no route outside /compare is redesigned by this repair', () => {
    // The shared provider/history modules changed, but no other page.tsx did.
    for (const other of ['src/app/page.tsx', 'src/app/stocks/page.tsx', 'src/app/macro/page.tsx']) {
      assert.ok(!read(other).includes('shortTermReturns'), `${other} untouched by R6.2`)
    }
  })
})
