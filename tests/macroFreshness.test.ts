// Macro freshness: every US indicator must have a live source, and the index
// YTD baseline must exist so IPSA's YTD is computed rather than frozen.
//
// Root cause these guard against (2026-07-21): `dxy`, `bitcoin` and `us-gdp`
// had NO live mapping in any provider, so they fell back to static values
// stamped 2025-06-17 forever — Bitcoin additionally attributed to
// "CoinMarketCap", a vendor this project has no relationship with.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { YAHOO_MACRO_SYMBOLS, isYahooMacroIndicator } from '../src/config/yahooMacroSeries.ts'
import { usFredSeriesManualMap, isFredSeriesLive } from '../src/config/usFredSeriesManualMap.ts'
import { PLAUSIBILITY, isPlausible } from '../src/lib/providers/plausibility.ts'

const ROOT = join(import.meta.dirname, '..')
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

describe('Yahoo-backed macro indicators (BTC, DXY)', () => {
  test('maps exactly bitcoin + dxy to real Yahoo symbols', () => {
    assert.deepEqual(Object.keys(YAHOO_MACRO_SYMBOLS).sort(), ['bitcoin', 'dxy'])
    assert.equal(YAHOO_MACRO_SYMBOLS.bitcoin, 'BTC-USD')
    // ICE DXY, deliberately NOT FRED's broad trade-weighted index (DTWEXBGS).
    assert.equal(YAHOO_MACRO_SYMBOLS.dxy, 'DX-Y.NYB')
  })

  test('isYahooMacroIndicator only claims those two', () => {
    assert.ok(isYahooMacroIndicator('bitcoin'))
    assert.ok(isYahooMacroIndicator('dxy'))
    assert.ok(!isYahooMacroIndicator('us10y'))
    assert.ok(!isYahooMacroIndicator('tpm'))
  })

  test('plausibility bands reject a wrong symbol mapping', () => {
    assert.ok(isPlausible('bitcoin', 66_800))
    assert.ok(!isPlausible('bitcoin', 3), 'a percentage-looking value is not a BTC price')
    assert.ok(isPlausible('dxy', 101.1))
    assert.ok(!isPlausible('dxy', 66_800), 'a BTC price is not a DXY level')
  })

  test('the map lives in config/ so client components can import it without the server-only provider', () => {
    const src = readFileSync(join(ROOT, 'src/config/yahooMacroSeries.ts'), 'utf8')
    assert.doesNotMatch(src, /yahoo-finance2/)
    assert.doesNotMatch(src, /from '@\/lib\/providers/)
  })
})

describe('US macro indicators all have a live source', () => {
  test('us-gdp is wired to a verified FRED series (was static-only)', () => {
    const e = usFredSeriesManualMap['us-gdp']
    assert.ok(e, 'us-gdp mapping exists')
    assert.equal(e.seriesId, 'A191RL1Q225SBEA')
    assert.ok(isFredSeriesLive(e))
    assert.equal(e.transformation, 'none', 'already a % change — never transformed again')
  })

  test('fed-funds stays the FOMC target range UPPER limit', () => {
    assert.equal(usFredSeriesManualMap['fed-funds'].seriesId, 'DFEDTARU')
  })

  test('every US indicator in the static JSON is covered by FRED or Yahoo', () => {
    const indicators = readJson('src/data/macroIndicators.json') as { id: string; region: string }[]
    const fredStaticIds = new Set(
      Object.values(usFredSeriesManualMap).filter(isFredSeriesLive).map((e) => e.staticId),
    )
    const uncovered = indicators
      .filter((i) => i.region === 'US')
      .map((i) => i.id)
      .filter((id) => !fredStaticIds.has(id) && !isYahooMacroIndicator(id))
    assert.deepEqual(uncovered, [], `US indicators with no live source: ${uncovered.join(', ')}`)
  })

  test('bitcoin is no longer attributed to CoinMarketCap', () => {
    const indicators = readJson('src/data/macroIndicators.json') as { id: string; source: string }[]
    const btc = indicators.find((i) => i.id === 'bitcoin')!
    assert.doesNotMatch(btc.source, /CoinMarketCap/i)
    assert.match(btc.source, /Yahoo/i)
  })
})

describe('index YTD baseline (IPSA)', () => {
  test('every index carries a positive yearStartClose baseline', () => {
    const indices = readJson('src/data/indexPerformance.json') as { id: string; yearStartClose?: number }[]
    for (const idx of indices) {
      assert.equal(typeof idx.yearStartClose, 'number', `${idx.id} has a yearStartClose`)
      assert.ok(idx.yearStartClose! > 0, `${idx.id} baseline is positive`)
    }
  })

  test('the baseline reproduces the committed YTD (so it is a real basis, not a placeholder)', () => {
    const indices = readJson('src/data/indexPerformance.json') as
      { id: string; value: number; ytdChangePct: number; yearStartClose: number }[]
    for (const i of indices) {
      const implied = (i.value / i.yearStartClose - 1) * 100
      assert.ok(
        Math.abs(implied - i.ytdChangePct) < 0.05,
        `${i.id}: baseline implies ${implied.toFixed(2)}% vs committed ${i.ytdChangePct}%`,
      )
    }
  })

  test('the refresh script writes yearStartClose so it stays current', () => {
    const py = readFileSync(join(ROOT, 'scripts/refresh/refreshMarketData.py'), 'utf8')
    assert.match(py, /yearStartClose/)
    assert.match(py, /def _year_start/)
  })

  test('the live-snapshot route seeds baselines from the committed file (covers ^IPSA)', () => {
    const src = readFileSync(join(ROOT, 'src/app/api/market/live-snapshot/route.ts'), 'utf8')
    assert.match(src, /committedYearStarts/)
    assert.match(src, /yearStartClose/)
    // The chart-derived baseline must not be trusted for a sparse series.
    assert.match(src, /MIN_YEAR_BARS/)
  })
})

describe('plausibility bands cover the new indicators', () => {
  test('bands exist for us-gdp, dxy and bitcoin', () => {
    for (const key of ['us-gdp', 'dxy', 'bitcoin']) {
      assert.ok(PLAUSIBILITY[key], `band for ${key}`)
    }
  })
})
