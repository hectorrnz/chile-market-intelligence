// 2026-07-20, third round — nine user-reported items. These cover the three
// non-obvious defects found while implementing them, each of which was a real
// data-correctness bug rather than the cosmetic issue originally reported.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { formatCompactMM } from '../src/lib/formatters.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('Charting — fundamentals amounts are normalized to millions', () => {
  const src = read('src/lib/financials/resolveFinancials.ts')

  it('runs every currency amount through toMillionsClp', () => {
    // The METRICS table declares these as unit "MM", but the repository stores
    // each source's own raw scale (live providers write raw CLP). Returning
    // the raw value rendered Revenue as "1.463.576.000.000 MM" — a millionfold
    // overstatement that the chart axis inherited.
    assert.ok(src.includes('toMillionsClp'))
    for (const field of ['revenue', 'gross_profit', 'operating_income', 'net_income', 'ocf', 'capex', 'cash', 'total_debt', 'dividends_paid', 'buybacks']) {
      assert.ok(src.includes(`getMM('${field}')`), `${field} must be scale-normalized`)
    }
    assert.ok(src.includes("metricMM('fcf')"), 'fcf comes from financial_metrics and needs the same normalization')
  })

  it('leaves per-share and percentage fields unscaled', () => {
    // eps is CLP per share and ebitdaMargin is a percentage — neither carries
    // a currency scale, so applying toMillionsClp would corrupt them.
    assert.ok(src.includes("eps: numOrNull(get('eps'))"))
    assert.ok(src.includes("ebitdaMargin: numOrNull(metricMap.get('ebitda_margin')?.value)"))
  })
})

describe('Charting — TTM windows are built from quarters only', () => {
  const src = read('src/app/chart-builder/page.tsx')

  it('filters to quarterly records before rolling the 4-period window', () => {
    // Issuers that publish BOTH discrete quarters and a native FY row had the
    // FY row sorted adjacent to Q4 (qIdx puts FY at year-end), so an
    // unfiltered rolling window summed a full year together with individual
    // quarters — producing a decaying series (4,59 B -> 1,16 B for ITAUCL)
    // and a nonsensical "FY'25 TTM" data point.
    assert.ok(src.includes('const quarters = recs.filter(r => isQuarterlyPeriod(r.period))'))
    assert.ok(src.includes('quarters.slice(i - 3, i + 1)'))
    assert.ok(!src.includes('recs.slice(i - 3, i + 1)'), 'must not roll over the unfiltered record list')
  })

  it('Quarterly is no longer a selectable frequency', () => {
    assert.ok(src.includes("type Freq = 'TTM' | 'A'"))
    assert.ok(!src.includes("setFreq('Q')"))
    assert.ok(!src.includes('t.charting.quarterly'))
  })

  it('uses a fresh storage key so a persisted "Q" cannot rehydrate', () => {
    assert.ok(src.includes("'cmi.gfFreq2'"))
  })

  it('derives an effective frequency so an annual-only ticker never renders an empty TTM chart', () => {
    assert.ok(src.includes("const effFreq: Freq = freq === 'TTM' && !canTTM ? 'A' : freq"))
  })
})

describe('formatCompactMM — magnitude-adaptive, never a wall of digits', () => {
  it('scales a millions-denominated value to a readable unit', () => {
    // 1.463.576 MM CLP is 1,46 billones — the axis previously showed the raw
    // 7-digit number and clipped it.
    assert.equal(formatCompactMM(1_463_576), '1,46 B')
    assert.equal(formatCompactMM(153_262), '153,3 MM')
  })

  it('keeps small magnitudes readable rather than forcing a suffix', () => {
    assert.equal(formatCompactMM(0), '0')
    assert.ok(/^-/.test(formatCompactMM(-1_463_576)), 'negatives keep their sign')
  })

  it('never emits NaN/Infinity', () => {
    assert.equal(formatCompactMM(Number.NaN), '—')
    assert.equal(formatCompactMM(Number.POSITIVE_INFINITY), '—')
  })
})

describe('Macro — an explicit Update bypasses the 6h server-side caches', () => {
  it('resolveLiveYieldCurve accepts force and skips only the cache READ', () => {
    const src = read('src/lib/providers/yieldCurveProvider.ts')
    assert.ok(src.includes('opts?: { force?: boolean }'))
    assert.ok(src.includes('if (!opts?.force && cached'))
    // The write must still happen, so a forced refresh warms the cache for
    // subsequent ordinary navigation.
    assert.ok(src.includes('if (result.ok) cache.set(region,'))
  })

  it('resolveUsForexTable accepts the same force option', () => {
    const src = read('src/lib/providers/frankfurterFxProvider.ts')
    assert.ok(src.includes('opts?: { force?: boolean }'))
    assert.ok(src.includes('if (!opts?.force && cached'))
  })

  it('both routes read ?force=1 and both client helpers can send it', () => {
    assert.ok(read('src/app/api/macro/yield-curve/route.ts').includes("searchParams.get('force') === '1'"))
    assert.ok(read('src/app/api/macro/fx/us/route.ts').includes("searchParams.get('force') === '1'"))
    assert.ok(read('src/lib/data/yieldCurveLive.ts').includes("force ? '&force=1' : ''"))
    assert.ok(read('src/lib/data/frankfurterFx.ts').includes("force ? '?force=1' : ''"))
  })

  it('the Macro page forces only on a refresh, never on first mount', () => {
    const src = read('src/app/macro/page.tsx')
    assert.ok(src.includes('fetchLiveYieldCurve(region, ac.signal, macroRefreshSeq > 0)'))
    assert.ok(src.includes('fetchUsForexTable(ac.signal, macroRefreshSeq > 0)'))
  })

  it('every Macro fetch effect re-runs when any tab triggers a refresh', () => {
    const src = read('src/app/macro/page.tsx')
    const deps = src.match(/\}, \[[^\]]*macroRefreshSeq[^\]]*\]\)/g) ?? []
    assert.ok(deps.length >= 4, `expected indicators, curve, forex and calendar effects to key on the shared seq, found ${deps.length}`)
  })
})

describe('Macro Chile — calendar and FX depth removed', () => {
  const src = read('src/app/macro/page.tsx')

  it('the release calendar block renders for US only', () => {
    assert.ok(!src.includes('t.cal.chileUnavailable'), 'no empty Chile calendar card')
  })

  it('the FX depth card renders for US only, and Chile gets a full-width curve', () => {
    assert.ok(!src.includes('fxClDepthRemoved'))
    assert.ok(src.includes("region === 'CL' ? 'grid-cols-1' : 'grid-cols-2'"))
  })
})

describe('Compare fundamentals — live ratios are currency-corrected', () => {
  const src = read('src/lib/providers/market/yahooRatiosProvider.ts')

  it('divides price-based ratios by the quote/financial FX rate', () => {
    // SQM-B, CAP, ENELAM, COLBUN and LTM quote in CLP but report in USD, so
    // Yahoo's raw priceToBook for SQM-B is 3096.9 rather than ~3.3. The
    // correction now runs through a shared `correct()` helper (raw / fx).
    assert.ok(src.includes('correct(rawPb)'))
    assert.ok(src.includes('correct(rawPs)'))
  })

  it('never applies the FX correction to ROE', () => {
    // ROE is a ratio of two same-currency statement figures — the currency
    // cancels, so dividing by fx would corrupt a correct number.
    assert.ok(src.includes('rawRoe != null ? rawRoe * 100 : null'))
    assert.ok(!/roe:[^\n]*\/ fx/.test(src))
  })

  it('returns null rather than an uncorrected figure when the rate is unavailable', () => {
    assert.ok(src.includes('fx != null && raw != null ? raw / fx : null'))
    assert.ok(src.includes("financialCurrency === 'USD' && quoteCurrency === 'CLP' ? usdClp : null"))
  })

  it('P/S, ROE and P/B never fall back to the fabricated static sample', () => {
    const page = read('src/app/compare/page.tsx')
    assert.ok(page.includes("get: e => num(e?.fundamentals.psFwd)"), 'P/S must not read the static snapshot')
    assert.ok(page.includes("get: e => num(e?.fundamentals.roe)"), 'ROE must not read the static snapshot')
    assert.ok(page.includes("get: e => num(e?.fundamentals.pb)"), 'P/B must not read the static snapshot')
  })

  it('P/S is labeled TTM, not forward — no free forward sales estimate exists', () => {
    assert.ok(read('src/app/compare/page.tsx').includes('t.compare.psTtm'))
    const i18n = read('src/lib/i18n.ts')
    assert.ok(i18n.includes("psTtm:        'P/S (TTM)'"))
  })
})

describe('Home macro card — one plain source name per band', () => {
  it('replaces the six-source chain with a per-band footer', () => {
    const i18n = read('src/lib/i18n.ts')
    assert.ok(!i18n.includes('Banco Central de Chile · INE · LME'), 'the chained source string must be gone')
    assert.ok(i18n.includes("macroSourceCl:    'Banco Central de Chile (BCCh)'"))
    assert.ok(i18n.includes("macroSourceUs:    'FRED (Federal Reserve Bank of St. Louis)'"))
    const page = read('src/app/page.tsx')
    assert.ok(page.includes('t.home.macroSourceCl'))
    assert.ok(page.includes('t.home.macroSourceUs'))
  })

  it('each band carries its own as-of, so the fresher half cannot mask the staler one', () => {
    const page = read('src/app/page.tsx')
    assert.ok(page.includes('macroChileAsOf'))
    assert.ok(page.includes('macroUsAsOf'))
  })

  it('the dead Phase-3 chartNote keys are removed', () => {
    assert.ok(!read('src/lib/i18n.ts').includes('chartNote'))
  })
})
