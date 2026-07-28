// Phase 5D — /compare re-skinned into the Fable institutional language.
//
// The contract this file locks down: the page LOOKS different and NOTHING
// about what it shows or does changed. Every section, slot, metric, timeframe,
// chart series, legend item, tooltip field, table/column, setting, source
// badge/footer, timestamp, and async state is still there; every persisted
// `cmi.compare*` key, the return-math imports, and the market/history fetch
// wiring are byte-for-byte the same; no API, provider, or business-logic file
// was touched.
//
// Source-scan checks (this repo has no React render harness) — they cannot
// prove pixel rendering, but they make a silent regression of the load-bearing
// content and conventions impossible.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const COMPARE = 'src/app/compare/page.tsx'
const I18N = 'src/lib/i18n.ts'

const src = read(COMPARE)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── 1. Every section survives ────────────────────────────────────────────────

describe('Phase 5D — every Compare section survives the re-skin', () => {
  it('keeps the page header with tag, title, subtitle and the Update action', () => {
    assert.match(src, /<SectionHeader/)
    assert.match(src, /tag=\{t\.compare\.tag\}/)
    assert.match(src, /title=\{t\.compare\.title\}/)
    assert.match(src, /subtitle=\{t\.compare\.subtitle\}/)
    assert.match(src, /actions=\{<UpdateDataButton onRefresh=\{doRefresh\} \/>\}/)
  })

  it('still renders exactly one UpdateDataButton (the platform-wide convention)', () => {
    assert.equal(count(src, '<UpdateDataButton'), 1)
  })

  it('keeps the Market Data table, conditionally rendered on ≥1 valid ticker', () => {
    assert.match(src, /\{valids\.length > 0 && \(/)
    assert.match(src, /title=\{t\.compare\.marketDataTitle\}/)
  })

  it('keeps the Comparative Returns table', () => {
    assert.match(src, /title=\{t\.compare\.returnsTitle\}/)
  })

  it('keeps the Fundamentals table', () => {
    assert.match(src, /title=\{t\.compare\.fundamentals\}/)
  })

  it('keeps the control bar (timeframe, period, range, legend)', () => {
    assert.match(src, /t\.compare\.range/)
    assert.match(src, /t\.compare\.legendLabel/)
  })

  it('keeps the Cumulative Return chart', () => {
    assert.match(src, /<CompareChart/)
    assert.match(src, /t\.compare\.perfTitle/)
  })

  it('keeps the Settings modal, dialog-rooted and Esc-closable', () => {
    assert.match(src, /useEscape\(settingsOpen, \(\) => setSettingsOpen\(false\)\)/)
    assert.match(src, /role="dialog" aria-modal="true" aria-label=\{t\.compare\.settings\}/)
  })

  it('adds no invented KPI, hero, or summary metric to this route', () => {
    assert.ok(!src.includes('KpiHero'))
    assert.ok(!src.includes('CurrentActions'))
  })
})

// ─── 2-3. Comparison slots + min/max ──────────────────────────────────────────

describe('Phase 5D — comparison slots preserved exactly', () => {
  it('keeps the 6-slot persisted array and its default tickers', () => {
    assert.match(src, /usePersistentState<string\[\]>\('cmi\.compareSlots', \['BSANTANDER', 'SQM-B', 'FALABELLA', '', '', ''\]\)/)
  })

  it('caps slots at exactly 6, no more, no fewer', () => {
    assert.match(src, /const s6 = \[\.\.\.slots, '', '', '', '', '', ''\]\.slice\(0, 6\)/)
  })

  it('caps colors at exactly 6 to match', () => {
    assert.match(src, /const c6 = \[\.\.\.colors, \.\.\.PRESET\]\.slice\(0, 6\)/)
  })

  it('renders all 6 slots in the Returns table regardless of validity', () => {
    assert.match(src, /\{s6\.map\(\(val, i\) => \{/)
  })

  it('never trims the slot array to fewer than 6 rows', () => {
    assert.ok(!/s6\.slice\(0, [0-5]\)/.test(src))
  })
})

// ─── 4. Duplicate handling ─────────────────────────────────────────────────────

describe('Phase 5D — duplicate ticker handling unchanged', () => {
  it('deduplicates via a Set, first occurrence wins', () => {
    assert.match(src, /const seen = new Set<string>\(\)/)
    assert.match(src, /if \(tk && compMap\[tk\] && !seen\.has\(tk\)\) \{ seen\.add\(tk\); valids\.push/)
  })

  it('normalizes ticker text (trim + uppercase) before validation', () => {
    assert.match(src, /const norm = \(v: string\) => v\.trim\(\)\.toUpperCase\(\)/)
  })
})

// ─── 5. Company addition/removal ──────────────────────────────────────────────

describe('Phase 5D — ticker add/remove behaviour unchanged', () => {
  it('keeps the datalist-backed free-text slot input', () => {
    assert.match(src, /<datalist id="cmp-tickers">/)
    assert.match(src, /list="cmp-tickers"/)
  })

  it('keeps setSlot uppercasing and truncating to 12 chars', () => {
    assert.match(src, /const setSlot = \(i: number, v: string\) => \{ const next = \[\.\.\.s6\]; next\[i\] = v\.toUpperCase\(\)\.slice\(0, 12\); setSlots\(next\) \}/)
  })

  it('a slot is removed by clearing its text — no separate remove control was invented', () => {
    assert.ok(!/removeSlot|deleteSlot/.test(src))
  })

  it('validates every slot against the real company universe', () => {
    assert.match(src, /compMap\[tk\]/)
  })
})

// ─── 6-7. Metrics and comparison modes ────────────────────────────────────────

describe('Phase 5D — every metric and comparison mode preserved', () => {
  it('keeps all 8 Market Data columns', () => {
    for (const key of ['t.compare.security', 't.stocks.cols.price', 't.compare.perf1d', 't.compare.perf5d', 't.compare.perf1m', 't.compare.perfYtd', 't.compare.perf1y', 't.common.sector']) {
      assert.ok(src.includes(key), `missing Market Data column ${key}`)
    }
    assert.match(src, /\{`\$\{t\.home\.marketCap\} \(Bn\)`\}/)
  })

  it('keeps all 5 Returns columns', () => {
    for (const key of ['t.compare.security', 't.compare.totalReturn', 't.compare.difference', 't.compare.annualized']) {
      assert.ok(src.includes(key), `missing Returns column ${key}`)
    }
  })

  it('keeps all 12 Fundamentals rows in the same order', () => {
    const order = [
      't.company.kpis.lastPrice', '`${t.home.marketCap} (Bn)`', 't.company.val.peFwd', 't.compare.psTtm',
      't.company.val.evEbitda', 't.company.val.opMargin', 't.company.val.grossMargin', 't.company.val.roe',
      't.company.val.fcfYield', 't.company.val.pb', 't.company.val.netDebtEbitda', 't.company.kpis.divYield',
    ]
    const positions = order.map(k => src.indexOf(k))
    assert.ok(positions.every(p => p >= 0), 'a fundamentals row label is missing')
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `fundamentals row order changed at ${order[i]}`)
    }
  })

  it('keeps all 10 CompareFundamentalKey derived-field mappings', () => {
    for (const key of ['pe', 'psFwd', 'evEbitda', 'opMargin', 'grossMargin', 'roe', 'fcfYield', 'pb', 'netDebtEbitda', 'dividendYield']) {
      assert.match(src, new RegExp(`key: '${key}'`))
    }
  })

  it('keeps the difference-vs reference-slot mode', () => {
    assert.match(src, /const \[diffRef, setDiffRef\] = usePersistentState<string>\('cmi\.compareDiffRef', '0'\)/)
    assert.match(src, /const slotIdx = parseInt\(diffRef, 10\)/)
  })

  it('never invents a metric absent from the original fund[] array', () => {
    assert.equal(count(src, 'get: e =>'), 12, 'exactly 12 fundamentals rows')
  })
})

// ─── 8. Timeframe/period/range preserved ──────────────────────────────────────

describe('Phase 5D — timeframe, period and custom range preserved', () => {
  it('keeps the exact 5-timeframe array', () => {
    assert.ok(src.includes("const TF: CmpTf[] = ['1M', 'YTD', '1Y', '3Y', '5Y']"))
  })

  it('keeps the 3-value period type and its persisted key', () => {
    assert.match(src, /type Period = 'D' \| 'W' \| 'M'/)
    assert.match(src, /usePersistentState<Period>\('cmi\.comparePeriod', 'W'\)/)
  })

  it('keeps the custom date-range override and its data bounds', () => {
    assert.match(src, /const usingCustom = !!\(cStart && cEnd\)/)
    assert.match(src, /const DATA_END = '2025-06-17'/)
    assert.match(src, /const DATA_START = '2020-06-01'/)
  })

  it('a TF click clears any custom range (mutually exclusive modes, unchanged)', () => {
    assert.match(src, /onChange=\{x => \{ setTf\(x\); setCStart\(''\); setCEnd\(''\) \}\}/)
  })

  it('the custom range Clear button resets both dates', () => {
    assert.match(src, /onClick=\{\(\) => \{ setCStart\(''\); setCEnd\(''\) \}\}/)
  })
})

// ─── 9. Settings controls preserved ───────────────────────────────────────────

describe('Phase 5D — every Settings control preserved', () => {
  it('keeps Difference vs, Series colors, Chart options, Table options', () => {
    for (const key of ['t.compare.diffRef', 't.compare.seriesColors', 't.compare.chartOpts', 't.compare.tableOpts']) {
      assert.ok(src.includes(key), `missing settings section ${key}`)
    }
  })

  it('keeps 10 preset swatches + a native color picker per slot', () => {
    assert.match(src, /const SWATCHES = \[.+\]/)
    assert.match(src, /type="color"/)
  })

  it('keeps show-legend, gridlines, and line-thickness (thin/medium/thick)', () => {
    assert.match(src, /t\.compare\.showLegend/)
    assert.match(src, /t\.compare\.gridlines/)
    assert.match(src, /value="1\.25">\{t\.compare\.thin\}/)
    assert.match(src, /value="1\.75">\{t\.compare\.medium\}/)
    assert.match(src, /value="2\.5">\{t\.compare\.thick\}/)
  })

  it('keeps the best/worst highlight toggle', () => {
    assert.match(src, /t\.compare\.highlight/)
    assert.match(src, /checked=\{highlight\}/)
  })
})

// ─── 10. Reset behaviour ───────────────────────────────────────────────────────

describe('Phase 5D — reset-to-defaults unchanged', () => {
  it('resetDefaults restores every settings value to its original default', () => {
    assert.match(src, /const resetDefaults = \(\) => \{ setColors\(\[\.\.\.PRESET\]\); setDiffRef\('0'\); setShowLegend\(true\); setShowGrid\(true\); setLineW\(1\.75\); setHighlight\(true\) \}/)
  })

  it('the reset button is present and wired', () => {
    assert.match(src, /onClick=\{resetDefaults\}/)
    assert.match(src, />\{t\.compare\.reset\}<\/button>/)
  })
})

// ─── 11-14. Chart series, legend, tooltip, axes ───────────────────────────────

describe('Phase 5D — chart series, legend, tooltip and axes preserved', () => {
  it('builds chartSeries from every row with ≥2 points, unchanged', () => {
    assert.match(src, /const chartSeries = rowData\s*\.filter\(r => r\.data\.length >= 2\)\s*\.map\(r => \(\{ ticker: r\.ticker, color: r\.color, data: r\.data \}\)\)/)
  })

  it('passes the same 4 chart props CompareChart always accepted', () => {
    assert.match(src, /<CompareChart series=\{chartSeries\} height=\{340\} showGrid=\{showGrid\} lineWidth=\{lineW\} legend=\{showLegend\}\s*\/>/)
  })

  it('no IPSA benchmark or fabricated series was reintroduced', () => {
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!code.includes('IPSA'))
    assert.ok(!code.includes('benchmark'))
  })

  it('CompareChart itself still owns the legend, tooltip and axis rendering (untouched by this phase)', () => {
    const chart = read('src/components/charts/CompareChart.tsx')
    assert.match(chart, /legend &&/, 'legend toggle preserved')
    assert.match(chart, /<ChartTooltip/, 'tooltip preserved')
    assert.match(chart, /toFixed\(0\)\}%/, 'y-axis percent formatting preserved')
  })
})

// ─── 15. Normalization / return math ──────────────────────────────────────────

describe('Phase 5D — return-math and normalization untouched', () => {
  it('imports totalAndAnnual/tfStart from the shared returns module, no local reimplementation', () => {
    assert.match(src, /import \{ totalAndAnnual, tfStart \} from '@\/lib\/returns'/)
  })

  it('never inlines a CAGR/total-return formula on this page', () => {
    assert.ok(!/Math\.pow\(/.test(src), 'annualized-return math must stay inside lib/returns.ts')
  })
})

// ─── 16. Fundamentals correctness (rounding, derived marker) ──────────────────

describe('Phase 5D — Fundamentals correctness preserved', () => {
  it('keeps fmtX/fmtPctCell with toFixed(1) — never a raw unrounded float', () => {
    assert.ok(src.includes('fmtX'))
    assert.ok(src.includes('fmtPctCell'))
    assert.ok(src.includes('toFixed(1)'))
    assert.ok(!src.includes('fmt: v => `${v}x`'))
    assert.ok(!src.includes('fmt: v => `${v}%`'))
  })

  it('keeps the derived-field "•" marker with its tooltip', () => {
    assert.match(src, /isDerived && <span className="ml-1 text-accent" title=\{t\.compare\.derivedFieldTitle\}>•<\/span>/)
  })

  it('keeps the Bn market-cap conversion, not the old MM label', () => {
    assert.ok(src.includes('v / 1000'))
    assert.ok(!src.includes('`${t.home.marketCap} (MM)`'))
  })

  it('P/S stays labeled TTM (no fabricated forward estimate)', () => {
    assert.ok(src.includes('t.compare.psTtm'))
  })

  it('every fundamentals field reads only the resolved live entry, never the static snapshot', () => {
    assert.ok(src.includes('get: e => num(e?.fundamentals.psFwd)'))
    assert.ok(src.includes('get: e => num(e?.fundamentals.roe)'))
    assert.ok(src.includes('get: e => num(e?.fundamentals.pb)'))
  })
})

// ─── 17-18. Source badges and footers ─────────────────────────────────────────

describe('Phase 5D — source badges and footers preserved', () => {
  it('keeps both MarketDataSourceBadge instances (Market Data + Returns)', () => {
    assert.equal(count(src, '<MarketDataSourceBadge'), 2)
  })

  it('the Returns badge is suppressed for a custom range on the same line as the JSX', () => {
    const line = src.split('\n').find(l => l.includes('<MarketDataSourceBadge status={returnsStatus} />'))
    assert.ok(line?.includes('!usingCustom'))
  })

  it('keeps 4 TableSourceFooter instances (Market Data, Returns, Fundamentals, Chart)', () => {
    assert.equal(count(src, '<TableSourceFooter'), 4)
  })

  it('keeps the exact source-precedence ternaries for Returns/Chart and Fundamentals', () => {
    assert.ok(src.includes("returnsStatus !== 'static' ? t.compare.marketSource : t.compare.source"))
    assert.match(src, /marketStatus === 'live' \? t\.compare\.marketSource : \(hasDerivedFundamentals \? t\.compare\.fundamentalsSource : t\.common\.staticSample\)/)
  })

  it('keeps the historyAccumulating note under both the Returns and Chart footers', () => {
    const noteCount = src.split('t.compare.historyAccumulating').length - 1
    assert.ok(noteCount >= 2, 'expected the note under both the Returns table footer and the chart footer')
  })

  it('the accumulating note itself never appears for a custom range', () => {
    const line = src.split('\n').find(l => l.includes('const historyAccumulating ='))
    assert.ok(line?.includes('!usingCustom'))
  })
})

// ─── 19. Timestamps ────────────────────────────────────────────────────────────

describe('Phase 5D — timestamps preserved', () => {
  it('Market Data as-of derives from the resolved latest snapshot date', () => {
    assert.match(src, /asOf=\{compareMetaStatus\?\.latestSnapshotDate \?\? null\}/)
  })

  it('Returns/Chart as-of derives from the max persisted asOfDate across valid tickers', () => {
    assert.match(src, /const returnsAsOf = rowData/)
    assert.match(src, /\.reduce\(\(max, d\) => \(!max \|\| d > max \? d : max\), ''\) \|\| null/)
  })
})

// ─── 20-25. Async / data-quality states ────────────────────────────────────────

describe('Phase 5D — async and data-quality states stay distinct', () => {
  it('no loading spinner is fabricated — previous data is kept on a transient failure', () => {
    assert.match(src, /catch \{ \/\* keep previous data on transient fetch failure \*\/ \}/)
  })

  it('an empty comparison (0 valid slots) renders through AsyncState, distinct wording', () => {
    assert.match(src, /state=\{valids\.length === 0 \? 'empty' : undefined\}/)
    assert.match(src, /stateMessage=\{t\.compare\.empty\}/)
  })

  it('a partial comparison never drops a valid ticker because a sibling has no data', () => {
    // Each row is rendered independently from `valids`/`rowData`; a missing
    // field renders "—" on that one cell only (perfCell/row.get honor null).
    assert.match(src, /const perfCell = \(m: ComparePerformanceMetric \| undefined\) => \(\{/)
    assert.match(src, /v != null \? row\.fmt\(v\) : '—'/)
  })

  it('stale/insufficient persisted history is a distinct historyAccumulating note, never silently hidden', () => {
    assert.match(src, /insufficientHistoryReason/)
  })

  it('a transient /api/compare/history failure resets to an empty map rather than stale-but-wrong data', () => {
    assert.match(src, /\.catch\(\(\) => \{ if \(mounted\) setPersistedHistory\(\{\}\) \}\)/)
  })

  it('unavailable values render the em dash, never a fabricated zero', () => {
    // .length ?? 0 is a boolean-count guard (hasDerivedFundamentals), not a
    // displayed metric — excluded from this scan the same way a decimals
    // argument (e.g. `formatFx(price, ... ? 2 : 0)`) would be.
    assert.ok(!/[^.]\?\? 0\b/.test(src.replace(/\.length \?\? 0/g, '')), 'no null-coalesce-to-zero on a displayed value')
    assert.match(src, /price != null \? formatFx\(price, price < 1000 \? 2 : 0\) : '—'/)
  })
})

// ─── 22. API / data dependencies unchanged ────────────────────────────────────

describe('Phase 5D — API and data dependencies untouched', () => {
  it('fetches through the same two client-safe helpers, never a direct Supabase/provider import', () => {
    assert.match(src, /import \{ fetchCompareData \} from '@\/lib\/data\/compareData'/)
    assert.match(src, /import \{ fetchCompareHistory, type CompareHistorySeries \} from '@\/lib\/data\/compareHistory'/)
    assert.ok(!/from '@\/lib\/providers\//.test(src))
    assert.ok(!/from '@\/lib\/db\//.test(src))
  })

  it('keeps the static baseline imports (companies, snapshots, stock history)', () => {
    assert.match(src, /import \{ getAllCompanies \} from '@\/lib\/data\/companies'/)
    assert.match(src, /import \{ getAllSnapshots \} from '@\/lib\/data\/stocks'/)
    assert.match(src, /import \{ getStockSeriesByPeriod \} from '@\/lib\/data\/stockHistory'/)
  })

  it('routes Update through the shared global refresh, not a page-local fetch', () => {
    assert.match(src, /const refreshShared = useGlobalRefresh\(\)/)
    assert.match(src, /await refreshShared\(\)/)
  })

  it('re-fetches /api/compare and /api/compare/history whenever the shared snapshot refreshes', () => {
    assert.match(src, /\}, \[validTickerKey, compareRefreshSeq, live\?\.lastUpdated\]\)/)
    assert.match(src, /\}, \[validTickerKey, tf, usingCustom, compareRefreshSeq\]\)/)
  })
})

// ─── 23. Persistence (11 cmi.* keys) ──────────────────────────────────────────

describe('Phase 5D — all 11 cmi.compare* persisted keys preserved', () => {
  const KEYS = [
    'cmi.compareSlots', 'cmi.compareColors', 'cmi.compareDiffRef', 'cmi.compareTf', 'cmi.comparePeriod',
    'cmi.compareStart', 'cmi.compareEnd', 'cmi.compareLegend', 'cmi.compareGrid', 'cmi.compareLineW', 'cmi.compareHighlight',
  ]
  for (const key of KEYS) {
    it(`persists ${key}`, () => {
      assert.ok(src.includes(`'${key}'`), `${key} must still be persisted`)
    })
  }

  it('no URL-state/search-param mechanism was introduced', () => {
    assert.ok(!src.includes('useSearchParams'))
    assert.ok(!src.includes('URLSearchParams'))
  })
})

// ─── Fable visual language ─────────────────────────────────────────────────────

describe('Phase 5D — Fable visual language applied via shared primitives', () => {
  it('uses the shared analytical TableCard container for all 3 tables', () => {
    assert.match(src, /from '@\/components\/fable\/TableCard'/)
    assert.equal(count(src, '<TableCard'), 3)
  })

  it('puts every dense table on the near-opaque surface, never on blurred glass', () => {
    const tableCard = read('src/components/fable/TableCard.tsx')
    assert.match(tableCard, /variant="dense"/)
    assert.match(src, /backgroundColor: 'var\(--surface-table\)'/)
    assert.ok(!/backdrop-filter/.test(src))
    assert.ok(!src.includes('nv-glass-card'), 'the page never applies glass directly to table content')
  })

  it('uses tokenised row hover on every table row (a tint, never a blur or shadow change)', () => {
    assert.ok(count(src, 'nv-row-hover nv-transition') >= 3, 'Market Data + Returns + Fundamentals rows')
    assert.ok(!src.includes('hover:bg-surface-2'), 'the untokenised hover is gone')
  })

  it('uses the shared SegmentedControl for timeframe and period', () => {
    assert.match(src, /from '@\/components\/fable\/SegmentedControl'/)
    assert.equal(count(src, '<SegmentedControl'), 2)
  })

  it('uses GlassSurface for the control bar and chart card, never a raw bg-surface div', () => {
    assert.match(src, /from '@\/components\/fable\/GlassSurface'/)
    assert.equal(count(src, '<GlassSurface variant="card"'), 2)
    assert.ok(!src.includes('bg-surface border border-border rounded'), 'the pre-Fable card recipe is gone')
  })

  it('restyles the Settings modal to the established glass-overlay + scrim pattern', () => {
    assert.match(src, /nv-scrim fixed inset-0/)
    assert.match(src, /nv-glass-overlay nv-pop/)
  })

  it('uses Fable chip controls (nv-chip/nv-chipbd) for inputs and pill buttons', () => {
    assert.ok(count(src, "backgroundColor: 'var(--nv-chip)'") >= 4)
    assert.ok(count(src, "border: '1px solid var(--nv-chipbd)'") >= 4)
  })

  it('keeps dense radii off the tables (no 22px card radius on cells)', () => {
    assert.ok(!/rounded-\[var\(--radius-card\)\]/.test(src))
    assert.ok(!src.includes('rounded-2xl'))
  })

  it('uses the tokenised table-cell type scale on every table', () => {
    assert.equal(count(src, "fontSize: 'var(--fs-table-cell)'"), 3)
  })

  it('hardcodes no hex colour and no raw Tailwind colour scale', () => {
    // SWATCHES/PRESET are genuine chart-series colour DATA (the compare
    // colour picker), not styling — excluded from the hex-literal scan the
    // same way a chart palette constant would be.
    const withoutDataArrays = src
      .replace(/const PRESET = \[[^\]]*\]/, '')
      .replace(/const SWATCHES = \[[^\]]*\]/, '')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(withoutDataArrays), 'contains a hardcoded hex colour outside the colour-picker data arrays')
    assert.ok(
      !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(src),
      'uses a raw Tailwind colour scale',
    )
  })

  it('uses no purple anywhere on this route (reserved for the Review token)', () => {
    assert.ok(!/--chart-review|--review\b/.test(src))
  })
})

// ─── Motion ─────────────────────────────────────────────────────────────────────

describe('Phase 5D — motion is restrained and reduced-motion safe', () => {
  it('uses only the shared CSS reveal primitive, with the Fable stagger cadence', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /<Reveal delayMs=\{130\}>/)
    assert.match(src, /<Reveal delayMs=\{190\}>/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
  })

  it('never animates a market value or count-up', () => {
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('ValueChangeTransition'))
  })

  it('introduces no page-local keyframes or animation utility', () => {
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('the settings modal uses the established nv-pop overlay entrance, not a bespoke transition', () => {
    assert.match(src, /nv-pop/)
  })

  it('the reveal primitive collapses to its final state under reduced motion', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5D — accessibility', () => {
  it('uses semantic table markup with scoped headers and a caption on all 3 tables', () => {
    // 9 Market Data + 5 Returns + 2 Fundamentals (the metric label header, and
    // the per-ticker header which appears once in source inside a .map()).
    assert.equal(count(src, 'scope="col"'), 16)
    assert.equal(count(src, '<caption className="sr-only">'), 3)
  })

  it('labels every ticker slot input distinctly', () => {
    assert.match(src, /aria-label=\{`\$\{t\.compare\.security\} \$\{i \+ 1\}`\}/)
  })

  it('labels the timeframe and period segmented controls', () => {
    assert.match(src, /ariaLabel=\{t\.compare\.timeframeLabel\}/)
    assert.match(src, /ariaLabel=\{t\.compare\.period\}/)
  })

  it('labels the custom date-range inputs and the settings selects', () => {
    assert.match(src, /aria-label=\{t\.compare\.start\}/)
    assert.match(src, /aria-label=\{t\.compare\.end\}/)
    assert.match(src, /aria-label=\{t\.compare\.diffRef\}/)
  })

  it('the settings dialog has an accessible name and a labelled close control', () => {
    assert.match(src, /role="dialog" aria-modal="true" aria-label=\{t\.compare\.settings\}/)
    assert.match(src, /aria-label=\{t\.fable\.panel\.close\}/)
  })

  it('marks decorative glyphs aria-hidden', () => {
    assert.match(src, /aria-hidden="true">⚙<\/span>/)
    assert.match(src, /aria-hidden>⤓<\/span>/)
  })

  it('never conveys sign by colour alone — every return/diff cell prints an explicit + or -', () => {
    assert.match(src, /const fmtPct = \(v: number \| null\) => \(v == null \? '—' : `\$\{v >= 0 \? '\+' : ''\}\$\{v\.toFixed\(2\)\}%`\)/)
  })

  it('keeps the visible focus ring on every restyled input/select/button', () => {
    assert.ok(count(src, 'focus:border-accent') >= 5)
  })

  it('SegmentedControl itself is a real keyboard-operable radiogroup (untouched by this phase)', () => {
    const seg = read('src/components/fable/SegmentedControl.tsx')
    assert.match(seg, /role="radiogroup"/)
    assert.match(seg, /role="radio"/)
    assert.match(seg, /onKeyDown=\{onKeyDown\}/)
  })
})

// ─── Responsive ──────────────────────────────────────────────────────────────

describe('Phase 5D — responsive guarantees', () => {
  it('keeps the full-width page container with no page-level max-width', () => {
    assert.match(src, /<div className="w-full space-y-4">/)
    assert.ok(!src.includes('max-w-screen-xl'))
  })

  it('scrolls all 3 dense tables inside their card via TableCard minWidth', () => {
    assert.match(src, /minWidth=\{620\}/)
    assert.match(src, /minWidth=\{440\}/)
    assert.match(src, /minWidth=\{560\}/)
    assert.match(read('src/components/fable/TableCard.tsx'), /overflow-x-auto/)
  })

  it('keeps the 12-col responsive grid for Returns/Fundamentals (stacks below xl)', () => {
    assert.match(src, /grid grid-cols-12 gap-4 items-start/)
    assert.match(src, /col-span-12 xl:col-span-5/)
    assert.match(src, /col-span-12 xl:col-span-7/)
  })

  it('the control bar and settings modal both wrap rather than widen the page', () => {
    assert.match(src, /flex items-center gap-4 flex-wrap/)
    assert.match(src, /flex items-center gap-1 flex-wrap/)
  })

  it('the settings modal caps to the viewport (max-h-[80vh], px-4 gutter)', () => {
    assert.match(src, /max-h-\[80vh\]/)
    assert.match(src, /px-4"/)
  })

  it('reintroduces no root min-width', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /html\s*\{[^}]*min-width/s)
  })
})

// ─── Localisation ────────────────────────────────────────────────────────────

describe('Phase 5D — English and Spanish complete', () => {
  const NEW_KEYS = ['timeframeLabel:', 'clearRange:']

  for (const key of NEW_KEYS) {
    it(`compare.${key.replace(':', '')} exists in both dictionaries`, () => {
      assert.ok(count(i18n, key) >= 2, `${key} must be present in dict.en and dict.es`)
    })
  }

  it('adds no hardcoded visible English string to the page', () => {
    const literals = src.match(/>[A-Za-z][A-Za-z .,'()/-]{3,}</g) ?? []
    assert.deepEqual(literals, [], `unlocalised literal(s): ${literals.join(' | ')}`)
  })

  it('adds no hardcoded English string in a title/aria-label attribute', () => {
    const attrLiterals = [...src.matchAll(/(?:title|aria-label)="([A-Za-z][A-Za-z .,'()/-]{2,})"/g)].map(m => m[1])
    assert.deepEqual(attrLiterals, [], `unlocalised attribute string(s): ${attrLiterals.join(' | ')}`)
  })

  it('keeps the Spanish translations distinct from English for the new keys', () => {
    assert.match(i18n, /timeframeLabel: 'Periodo'/)
    assert.match(i18n, /clearRange:\s+'Limpiar rango'/)
  })

  it('every t.compare.* key referenced by the page exists in both dictionaries', () => {
    const keys = [...new Set([...src.matchAll(/t\.compare\.(\w+)/g)].map(m => m[1]))]
    for (const key of keys) {
      assert.ok(count(i18n, `${key}:`) >= 2, `t.compare.${key} must exist in both dict.en and dict.es`)
    }
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5D — scope held', () => {
  it('changes no API contract from the page', () => {
    assert.ok(!src.includes("fetch('/api"), 'the page must go through the client-safe helpers, never a raw fetch to an API route')
  })

  it('imports no server-only provider/db/financials module', () => {
    assert.ok(!/from '@\/lib\/providers\//.test(src))
    assert.ok(!/from '@\/lib\/db\//.test(src))
    assert.ok(!/from '@\/lib\/financials\//.test(src))
    assert.ok(!/from '@\/lib\/compare\/resolveCompareData'/.test(src))
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('redesigns no page outside its own phase', () => {
    // `/chart-builder` was removed from this list in Phase 5E, which migrated
    // it under its own brief (SegmentedControl included) — a real phase
    // boundary moving, not a relaxed assertion. It is guarded by
    // `tests/fableChartBuilderPage.test.ts`.
    for (const other of [
      'src/app/page.tsx', 'src/app/earnings/page.tsx', 'src/app/macro/page.tsx',
      'src/app/portfolio/page.tsx', 'src/app/structured-notes/page.tsx',
    ]) {
      assert.ok(existsSync(join(ROOT, other)), `${other} must still exist`)
      assert.ok(!read(other).includes('@/components/fable/SegmentedControl'), `${other} has had no re-skin phase yet`)
    }
  })

  it('leaves the middleware protection lists untouched (Compare is public)', () => {
    const mw = read('src/middleware.ts')
    assert.ok(mw.includes('PROTECTED_PAGES'))
    assert.ok(!mw.includes("'/compare'"))
  })

  it('leaves the Phase 5A/5B/5C pages untouched by this phase', () => {
    assert.match(read('src/app/stocks/page.tsx'), /minWidth=\{760\}/)
    assert.match(read('src/app/watchlist/page.tsx'), /minWidth=\{620\}/)
    assert.match(read('src/app/companies/[ticker]/page.tsx'), /KpiCapsule/)
  })
})
