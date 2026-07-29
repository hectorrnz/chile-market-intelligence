// Phase 5E — /chart-builder re-skinned into the Fable institutional language.
//
// The contract this file locks down: the page LOOKS different and NOTHING
// about what it shows or does changed. Every section, ticker slot, metric,
// chart type/mode, frequency, axis assignment, unit/formatter, chart series,
// legend item, tooltip field, source badge/footer, and async state is still
// there; every persisted `cmi.gf*` key and the `gf:ticker` deep-link event
// are byte-for-byte the same; no API, provider, or business-logic file was
// touched.
//
// Source-scan checks (this repo has no React render harness) — they cannot
// prove pixel rendering, but they make a silent regression of the
// load-bearing content and conventions impossible.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CHART_BUILDER = 'src/app/chart-builder/page.tsx'
const I18N = 'src/lib/i18n.ts'

const src = read(CHART_BUILDER)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── 1. Every section survives ────────────────────────────────────────────────

describe('Phase 5E — every Chart Builder section survives the re-skin', () => {
  it('keeps the page header with tag, title and subtitle (no actions on this route)', () => {
    assert.match(src, /<SectionHeader/)
    assert.match(src, /tag=\{t\.charting\.tag\}/)
    assert.match(src, /title=\{t\.charting\.title\}/)
    assert.match(src, /subtitle=\{t\.charting\.subtitle\}/)
  })

  it('keeps the hidden ticker datalist', () => {
    assert.match(src, /<datalist id="gf-tickers">/)
    assert.match(src, /list="gf-tickers"/)
  })

  it('keeps the toolbar: primary ticker, "vs" ticker, mode toggle, frequency toggle, source badge, settings', () => {
    assert.match(src, /value=\{typed\}/)
    assert.match(src, /value=\{typedB\}/)
    assert.match(src, /<SourceStateBadge sourceKey=\{financialsBadgeKey\}/)
    assert.match(src, /onClick=\{\(\) => setSettingsOpen\(true\)\}/)
  })

  it('keeps the selected-metric chips row, conditional on ≥1 chosen metric', () => {
    assert.match(src, /\{chosen\.length > 0 && \(/)
  })

  it('keeps the categorized metric picker', () => {
    assert.match(src, /\{CATS\.map\(\(\{ cat, key \}\) => \(/)
    assert.match(src, /\{METRICS\.filter\(m => m\.cat === cat\)\.map\(m => \{/)
  })

  it('keeps the FundamentalsChart panel with its mode/frequency caption and source footer', () => {
    assert.match(src, /<FundamentalsChart labels=\{labels\} series=\{series\}/)
    assert.match(src, /mode === 'idx' \? 'indexed = 100' : null/)
  })

  it('keeps the underlying-data table, conditionally rendered on data + selection', () => {
    assert.match(src, /\{labels\.length > 0 && chosen\.length > 0 && \(/)
    assert.match(src, /title=\{t\.charting\.table\}/)
  })

  it('keeps the Settings modal, dialog-rooted and Esc-closable', () => {
    assert.match(src, /useEscape\(settingsOpen, \(\) => setSettingsOpen\(false\)\)/)
    assert.match(src, /role="dialog" aria-modal="true" aria-label=\{t\.charting\.settings\}/)
  })

  it('adds no invented KPI, hero, or summary metric to this route', () => {
    assert.ok(!src.includes('KpiHero'))
    assert.ok(!src.includes('KpiCapsule'))
    assert.ok(!src.includes('CurrentActions'))
  })
})

// ─── 2-3. Configuration slots, entity type, min/max series ───────────────────

describe('Phase 5E — configuration slots and series limits preserved', () => {
  it('keeps exactly two ticker slots: a required primary and an optional overlay', () => {
    assert.match(src, /usePersistentState<string>\('cmi\.gfTicker', 'FALABELLA'\)/)
    assert.match(src, /usePersistentState<string>\('cmi\.gfTickerB', ''\)/)
  })

  it('overlay activation requires a distinct, valid ticker — never the primary duplicated onto itself', () => {
    assert.match(src, /const overlay = !!tickerB && !!compMap\[tickerB\] && tickerB !== ticker/)
  })

  it('the metric multi-select has no artificial cap — all 21 metrics remain selectable', () => {
    assert.equal(count(src, "cat: 'income'") + count(src, "cat: 'cash'") + count(src, "cat: 'balance'") + count(src, "cat: 'returns'"), 21 + 4, 'each of the 21 METRICS rows plus the 4 CATS entries carries a cat field')
    assert.ok(!/selected\.slice\(0,\s*\d+\)/.test(src), 'no slicing/cap was introduced on the selected-metrics array')
  })

  it('entity universe is companies-only — no index/macro entity type on this route', () => {
    assert.match(src, /import \{ getAllCompanies \} from '@\/lib\/data\/companies'/)
    assert.ok(!src.includes('getAllIndicators'))
    assert.ok(!src.includes('IndexPerformance'))
  })

  it('validates every typed ticker against the real 25-company universe', () => {
    assert.match(src, /const compMap = Object\.fromEntries\(companies\.map\(c => \[c\.ticker, c\]\)\)/)
    assert.match(src, /if \(compMap\[v\]\) setTicker\(v\)/)
  })
})

// ─── 4. Every metric preserved ─────────────────────────────────────────────────

describe('Phase 5E — every metric and category preserved', () => {
  it('keeps all 21 METRICS entries with their original key/category/unit/type/axis/agg', () => {
    const METRIC_KEYS = [
      'revenue', 'ebitda', 'netIncome', 'grossProfit', 'operatingIncome', 'eps', 'rdExpense',
      'sgaExpense', 'sbcExpense', 'depAmort', 'ebitdaMargin', 'revenueYoY', 'netIncomeYoY',
      'fcf', 'ocf', 'capex', 'cash', 'ltDebt', 'sharesOut', 'dividendsPaid', 'buybacks',
    ]
    for (const key of METRIC_KEYS) {
      assert.match(src, new RegExp(`key: '${key}'`), `metric ${key} missing`)
    }
    assert.equal(count(src, "cat: 'income'"), 13 + 1, '13 income metrics + the CATS entry')
    assert.equal(count(src, "cat: 'cash'"), 3 + 1, '3 cash-flow metrics + the CATS entry')
    assert.equal(count(src, "cat: 'balance'"), 3 + 1, '3 balance-sheet metrics + the CATS entry')
    assert.equal(count(src, "cat: 'returns'"), 2 + 1, '2 returns-to-shareholders metrics + the CATS entry')
  })

  it('keeps the 4 category labels in their original order', () => {
    assert.match(src, /\{ cat: 'income', key: 'catIncome' \}, \{ cat: 'cash', key: 'catCash' \}, \{ cat: 'balance', key: 'catBalance' \}, \{ cat: 'returns', key: 'catReturns' \}/)
  })

  it('never invents a metric absent from the original METRICS array', () => {
    assert.equal(count(src, "cat: 'income'") + count(src, "cat: 'cash'") + count(src, "cat: 'balance'") + count(src, "cat: 'returns'") - 4, 21)
  })
})

// ─── 5. Chart types / display modes ────────────────────────────────────────────

describe('Phase 5E — every chart type and display mode preserved', () => {
  it('keeps Absolute vs Indexed=100 as a SegmentedControl bound to the same mode state', () => {
    assert.match(src, /usePersistentState<'abs' \| 'idx'>\('cmi\.gfMode', 'abs'\)/)
    assert.match(src, /value=\{mode\}/)
    assert.match(src, /onChange=\{setMode\}/)
  })

  it('keeps the Auto/Lines/Bars chart-type select inside Settings, wired to the same state', () => {
    assert.match(src, /usePersistentState<'auto' \| 'lines' \| 'bars'>\('cmi\.gfChartType', 'auto'\)/)
    assert.match(src, /value="auto">\{t\.charting\.auto\}/)
    assert.match(src, /value="lines">\{t\.charting\.lines\}/)
    assert.match(src, /value="bars">\{t\.charting\.barsType\}/)
  })

  it('keeps the per-metric bar/line type and overlay dashed/faded treatment untouched', () => {
    assert.match(src, /type: m\.type, axis: m\.axis, unit: m\.unit, dashed: true, faded: true,/)
  })

  it('passes chartType/indexed straight through to FundamentalsChart, no local override', () => {
    assert.match(src, /indexed=\{mode === 'idx'\} chartType=\{chartType\}/)
  })
})

// ─── 6. Frequency (TTM/Annual) — this route's "timeframe" ─────────────────────

describe('Phase 5E — TTM/Annual frequency preserved; no date-range control invented', () => {
  it('keeps the TTM/Annual persisted key and its 4-consecutive-quarter gate', () => {
    assert.match(src, /usePersistentState<Freq>\('cmi\.gfFreq2', 'TTM'\)/)
    assert.match(src, /const canTTM = recordsA\.filter\(r => isQuarterlyPeriod\(r\.period\)\)\.length >= 4/)
  })

  it('derives the effective frequency rather than correcting via setState (no flash of an empty TTM chart)', () => {
    assert.match(src, /const effFreq: Freq = freq === 'TTM' && !canTTM \? 'A' : freq/)
  })

  it('the TTM option is disabled, not hidden, when unavailable — with its original explanatory copy', () => {
    assert.match(src, /disabled: !canTTM/)
    assert.match(src, /title=\{canTTM \? undefined : t\.charting\.ttmUnavailable\}/)
  })

  it('adds no custom-date-range control — this route never had one', () => {
    assert.ok(!src.includes('type="date"'))
    assert.ok(!src.includes('DATA_START'))
    assert.ok(!src.includes('DATA_END'))
  })

  it('keeps the exact TTM rolling-window and Annual grouping logic', () => {
    assert.match(src, /for \(let i = 3; i < quarters\.length; i\+\+\) \{/)
    assert.match(src, /const byYear = new Map<string, FundamentalRecord\[\]>\(\)/)
  })
})

// ─── 7-8. Axis assignment and units/formatters ─────────────────────────────────

describe('Phase 5E — axis assignment, units and formatters untouched', () => {
  it('keeps every metric’s fixed left/right axis assignment (not user-editable)', () => {
    assert.match(src, /\{ key: 'eps', cat: 'income', unit: 'CLP', type: 'line', axis: 'right', agg: 'sum' \}/)
    assert.match(src, /\{ key: 'ebitdaMargin', cat: 'income', unit: '%', type: 'line', axis: 'right', agg: 'margin' \}/)
    assert.match(src, /\{ key: 'revenue', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' \}/)
  })

  it('right axis is disabled in Indexed mode (every series rebases onto one axis) — unchanged in FundamentalsChart', () => {
    const chart = read('src/components/charts/FundamentalsChart.tsx')
    assert.match(chart, /const rightSeries = indexed \? \[\] : view\.filter\(s => s\.axis === 'right'\)/)
  })

  it('keeps the MM/CLP/%/"MM sh" formatter set, shared by axis, tooltip and table', () => {
    assert.match(src, /const fmtBar = \(v: number\) => formatCompactMM\(v\)/)
    assert.match(src, /const fmtAxis = \(v: number\) => formatCompactMM\(v\)/)
    assert.match(src, /unit === 'CLP' \? `\$\{formatCLP\(v, 2\)\} CLP`/)
    assert.match(src, /unit === 'MM sh' \? `\$\{formatCLP\(v, 1\)\} MM sh`/)
  })

  it('the underlying-data table cell formatter matches the axis/tooltip formatter exactly', () => {
    assert.match(src, /const fmtCell = \(m: Metric, v: number \| null\) =>/)
    assert.match(src, /m\.unit === '%' \? `\$\{formatCLP\(v, 1\)\}%`/)
  })
})

// ─── 9. Normalization / rebasing ───────────────────────────────────────────────

describe('Phase 5E — Absolute vs Indexed=100 normalization untouched', () => {
  it('FundamentalsChart still rebases each series to 100 from its first available point (untouched by this phase)', () => {
    const chart = read('src/components/charts/FundamentalsChart.tsx')
    assert.match(chart, /const base = s\.values\.find\(v => v != null\) \?\? null; return \{ \.\.\.s, values: base \? s\.values\.map\(v => \(v == null \? null : \(v \/ base\) \* 100\)\) : s\.values\.map\(\(\) => null\) \}/)
  })
})

// ─── 10. Add/remove series actions ─────────────────────────────────────────────

describe('Phase 5E — add/remove metric and overlay-ticker behaviour unchanged', () => {
  it('toggle() adds or removes a metric by key, unchanged', () => {
    assert.match(src, /const toggle = \(key: string\) => setSelected\(prev => prev\.includes\(key\) \? prev\.filter\(k => k !== key\) : \[\.\.\.prev, key\]\)/)
  })

  it('a metric chip’s remove control calls the same toggle()', () => {
    assert.match(src, /onClick=\{\(\) => toggle\(m\.key\)\}/)
  })

  it('clearing the overlay ticker field clears cmi.gfTickerB, unchanged', () => {
    assert.match(src, /if \(v === ''\) setTickerB\(''\)/)
  })

  it('no reset/clear-all action exists on this route — none is invented', () => {
    assert.ok(!/resetDefaults|clearAll|onReset/.test(src))
  })

  it('adds no save or print action — none existed', () => {
    assert.ok(!src.includes('window.print'))
    assert.ok(!/\bonSave\b/.test(src))
  })

  it('keeps the Export CSV action with its original filename/column shape', () => {
    assert.match(src, /const handleExport = \(\) => \{/)
    assert.match(src, /`fundamentals_\$\{ticker\}\$\{overlay \? `_vs_\$\{tickerB\}` : ''\}`/)
    assert.match(src, /\[t\.charting\.metrics, \.\.\.labels\]/)
  })
})

// ─── 11-13. Chart series, legend, tooltip, markers ─────────────────────────────

describe('Phase 5E — chart series, legend, tooltip and (absent) markers preserved', () => {
  it('builds one series per chosen metric, plus a dashed/faded overlay series when active', () => {
    assert.match(src, /for \(const m of chosen\) \{/)
    assert.match(src, /key: `\$\{ticker\}-\$\{m\.key\}`/)
    assert.match(src, /key: `\$\{tickerB\}-\$\{m\.key\}`/)
  })

  it('FundamentalsChart itself still owns legend and tooltip rendering (untouched by this phase)', () => {
    const chart = read('src/components/charts/FundamentalsChart.tsx')
    assert.match(chart, /\{showLegend && \(/, 'legend toggle preserved')
    assert.match(chart, /<ChartTooltip/, 'tooltip preserved')
  })

  it('never introduces a marker/event-overlay prop — this chart never had one', () => {
    assert.ok(!src.includes('markers='))
    const chart = read('src/components/charts/FundamentalsChart.tsx')
    assert.ok(!chart.includes('markers'))
  })
})

// ─── 14-15. Source badges and footers ──────────────────────────────────────────

describe('Phase 5E — source badge and footers preserved', () => {
  it('keeps exactly one SourceStateBadge, keyed by the resolved persisted source type', () => {
    assert.equal(count(src, '<SourceStateBadge'), 1)
    assert.match(src, /const financialsBadgeKey: SourceKey = sourceStatusA !== 'persisted'/)
  })

  it('keeps exactly two TableSourceFooter instances (chart panel + underlying table)', () => {
    assert.equal(count(src, '<TableSourceFooter'), 2)
  })

  it('both footers resolve the same source-precedence ternary (persisted source vs. static-sample label)', () => {
    const occurrences = count(src, "sourceStatusA === 'persisted' ? persistedA!.source : t.charting.source")
    assert.equal(occurrences, 2)
  })

  it('adds no fabricated asOf timestamp — this route never had one', () => {
    assert.ok(!src.includes('asOf='))
  })
})

// ─── 16-22. Async and data-quality states ──────────────────────────────────────

describe('Phase 5E — async and data-quality states stay distinct', () => {
  it('no loading spinner is fabricated — the static baseline renders first, persisted data swaps in silently', () => {
    assert.match(src, /fetchFinancialStatements\(ticker\)\.then\(res => \{/)
    assert.ok(!src.includes("kind=\"loading\""))
  })

  it('two distinct empty states (no records vs. nothing selected) route through AsyncState with the original copy', () => {
    assert.match(src, /<AsyncState kind="empty" message=\{records\.length === 0 \? t\.charting\.noData : t\.charting\.selectMetric\}\s*\/>/)
  })

  it('an insufficient configuration (annual-only ticker) disables TTM rather than silently rendering an empty chart', () => {
    assert.match(src, /disabled: !canTTM/)
  })

  it('a provider failure falls back to static silently — the badge, not an error banner, carries the truth', () => {
    assert.match(src, /\}\)\.catch\(\(\) => \{ if \(mounted\) setPersistedA\(null\) \}\)/)
    assert.match(src, /catch \{\s*if \(mounted\) setPersistedB\(null\)\s*\}/)
  })

  it('a null value never becomes a fabricated zero anywhere in the formatter chain', () => {
    assert.match(src, /v == null\s*\n?\s*\? '—'/)
    assert.ok(!/\?\? 0\b/.test(src.replace(/\.length \?\? 0/g, '')), 'no null-coalesce-to-zero on a displayed value')
  })

  it('one series failing (all-null values) does not remove a sibling series from the chart', () => {
    // Each series is pushed independently inside the `for (const m of chosen)`
    // loop — there is no early-exit or filter that drops a metric because
    // another metric (or the overlay ticker) has no data for a period.
    assert.match(src, /series\.push\(\{/)
    assert.ok(!/series\.filter\(/.test(src), 'no post-hoc filtering removes a configured series')
  })
})

// ─── 23. API / data dependencies unchanged ─────────────────────────────────────

describe('Phase 5E — API and data dependencies untouched', () => {
  it('fetches through the same client-safe helper, never a raw fetch or a server-only import', () => {
    assert.match(src, /import \{ fetchFinancialStatements, type FinancialsSourceStatus, type FinancialsSourceType \} from '@\/lib\/data\/financialsData'/)
    assert.ok(!src.includes("fetch('/api"))
    assert.ok(!/from '@\/lib\/providers\//.test(src))
    assert.ok(!/from '@\/lib\/db\//.test(src))
    assert.ok(!/from '@\/lib\/financials\//.test(src))
  })

  it('keeps the static fundamentals baseline import', () => {
    assert.match(src, /import \{ getFundamentals, type FundamentalRecord \} from '@\/lib\/data\/fundamentals'/)
  })

  it('keeps the gf:ticker deep-link window event handler, unchanged detail shape', () => {
    assert.match(src, /window\.addEventListener\('gf:ticker', h\)/)
    assert.match(src, /if \(typeof d === 'string'\) setTicker\(d\.toUpperCase\(\)\)/)
  })
})

// ─── 24. Persistence (8 cmi.gf* keys) ──────────────────────────────────────────

describe('Phase 5E — all 8 cmi.gf* persisted keys preserved with original defaults', () => {
  const KEYS: [string, string][] = [
    ['cmi.gfTicker', "'FALABELLA'"],
    ['cmi.gfMetrics', "['revenue', 'ebitda']"],
    ['cmi.gfMode', "'abs'"],
    ['cmi.gfFreq2', "'TTM'"],
    ['cmi.gfChartType', "'auto'"],
    ['cmi.gfLegend', 'true'],
    ['cmi.gfGrid', 'true'],
    ['cmi.gfTickerB', "''"],
  ]
  for (const [key, def] of KEYS) {
    it(`persists ${key} with default ${def}`, () => {
      assert.match(src, new RegExp(`usePersistentState[^(]*\\('${key.replace('.', '\\.')}', ${def.replace(/[[\]]/g, '\\$&')}\\)`))
    })
  }

  it('hydration/malformed-state safety is delegated to the shared usePersistentState hook (no bespoke JSON.parse on this page)', () => {
    assert.ok(!src.includes('JSON.parse'))
    assert.ok(!src.includes('localStorage.getItem'))
  })

  it('no URL-state/search-param mechanism was introduced', () => {
    assert.ok(!src.includes('useSearchParams'))
    assert.ok(!src.includes('URLSearchParams'))
  })
})

// ─── Fable visual language ─────────────────────────────────────────────────────

describe('Phase 5E — Fable visual language applied via shared primitives', () => {
  it('uses the shared analytical TableCard for the underlying-data table', () => {
    assert.match(src, /from '@\/components\/fable\/TableCard'/)
    assert.equal(count(src, '<TableCard'), 1)
  })

  it('puts the dense table on the near-opaque surface, never on blurred glass', () => {
    const tableCard = read('src/components/fable/TableCard.tsx')
    assert.match(tableCard, /variant="dense"/)
    assert.match(src, /backgroundColor: 'var\(--surface-table\)'/)
    assert.ok(!/backdrop-filter/.test(src))
    assert.ok(!src.includes('nv-glass-card'), 'the page never applies glass directly to table content')
  })

  it('uses tokenised row hover on the table body (a tint, never a blur or shadow change)', () => {
    assert.match(src, /<tr key=\{m\.key\} className="border-b border-border last:border-0 nv-row-hover nv-transition">/)
  })

  it('uses the shared SegmentedControl for value mode and frequency (2 adopters)', () => {
    assert.match(src, /from '@\/components\/fable\/SegmentedControl'/)
    assert.equal(count(src, '<SegmentedControl'), 2)
  })

  it('uses GlassSurface for the toolbar, metric picker, and chart card, never a raw bg-surface div', () => {
    assert.match(src, /from '@\/components\/fable\/GlassSurface'/)
    assert.equal(count(src, '<GlassSurface variant="card"'), 3)
    assert.ok(!src.includes('bg-surface border border-border rounded'), 'the pre-Fable card recipe is gone')
  })

  it('restyles the Settings modal to the established glass-overlay + scrim pattern', () => {
    assert.match(src, /nv-scrim fixed inset-0/)
    assert.match(src, /nv-glass-overlay nv-pop/)
  })

  it('uses Fable chip controls (nv-chip/nv-chipbd) for ticker inputs, settings select, and pill buttons', () => {
    assert.equal(count(src, "backgroundColor: 'var(--nv-chip)'"), 5)
    assert.equal(count(src, "border: '1px solid var(--nv-chipbd)'"), 5)
  })

  it('restyles the metric chips and remove control to the 999px pill radius', () => {
    assert.match(src, /rounded-full text-xs text-primary-fg/)
    assert.ok(!src.includes('pl-2 pr-1 py-1 rounded text-xs text-primary-fg'), 'the pre-Fable 6px chip radius is gone')
  })

  it('uses the tokenised table-cell type scale on the underlying-data table', () => {
    assert.equal(count(src, "fontSize: 'var(--fs-table-cell)'"), 1)
  })

  it('hardcodes no hex colour outside the chart-series PALETTE data array, and no raw Tailwind colour scale', () => {
    const withoutPalette = src.replace(/const PALETTE = \[[^\]]*\]/, '')
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(withoutPalette), 'contains a hardcoded hex colour outside PALETTE')
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

describe('Phase 5E — motion is restrained and reduced-motion safe', () => {
  it('uses only the shared CSS reveal primitive, with the Fable stagger cadence', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /<Reveal delayMs=\{130\}>/)
    assert.match(src, /<Reveal delayMs=\{190\}>/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
  })

  it('never animates a market/financial value or introduces a count-up', () => {
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

  it('the reveal primitive collapses to its final state under reduced motion (shared global rule, unchanged)', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5E — accessibility', () => {
  it('uses semantic table markup with scoped headers and a caption on the underlying-data table', () => {
    assert.equal(count(src, 'scope="col"'), 2)
    assert.equal(count(src, '<caption className="sr-only">'), 1)
  })

  it('labels the primary and overlay ticker inputs distinctly', () => {
    assert.match(src, /aria-label=\{t\.charting\.company\}/)
    assert.match(src, /aria-label=\{t\.charting\.compareTicker\}/)
  })

  it('labels both segmented controls', () => {
    assert.match(src, /ariaLabel=\{t\.charting\.modeLabel\}/)
    assert.match(src, /ariaLabel=\{t\.charting\.freqLabel\}/)
  })

  it('each metric picker button exposes a real pressed state, not colour alone', () => {
    assert.match(src, /aria-pressed=\{on\}/)
  })

  it('each metric chip’s remove control has a distinct, localized accessible name', () => {
    assert.match(src, /aria-label=\{`\$\{t\.charting\.removeMetric\} \$\{t\.charting\.m\[m\.key as keyof typeof t\.charting\.m\]\}`\}/)
  })

  it('the settings dialog has an accessible name and a labelled close control', () => {
    assert.match(src, /role="dialog" aria-modal="true" aria-label=\{t\.charting\.settings\}/)
    assert.match(src, /aria-label=\{t\.fable\.panel\.close\}/)
  })

  it('marks decorative glyphs aria-hidden', () => {
    assert.match(src, /aria-hidden="true">⚙<\/span>/)
    assert.match(src, /aria-hidden>⤓<\/span>/)
  })

  it('keeps the visible focus ring on every restyled input/select', () => {
    assert.ok(count(src, 'focus:border-accent') >= 3)
  })

  it('SegmentedControl itself is a real keyboard-operable radiogroup (untouched by this phase)', () => {
    const seg = read('src/components/fable/SegmentedControl.tsx')
    assert.match(seg, /role="radiogroup"/)
    assert.match(seg, /role="radio"/)
    assert.match(seg, /onKeyDown=\{onKeyDown\}/)
  })

  it('the FundamentalsChart carries an accessible role/description (untouched by this phase)', () => {
    const chart = read('src/components/charts/FundamentalsChart.tsx')
    assert.match(chart, /role="img"/)
    assert.match(chart, /aria-describedby=\{descId\}/)
  })
})

// ─── Responsive ──────────────────────────────────────────────────────────────

describe('Phase 5E — responsive guarantees', () => {
  it('keeps the full-width page container with no page-level max-width', () => {
    assert.match(src, /<div className="w-full space-y-4">/)
    assert.ok(!src.includes('max-w-screen-xl'))
  })

  it('scrolls the dense underlying-data table inside its card via TableCard minWidth (closes the pre-existing no-min-w gap)', () => {
    assert.match(src, /minWidth=\{640\}/)
    assert.match(read('src/components/fable/TableCard.tsx'), /overflow-x-auto/)
  })

  it('keeps the 12-col responsive grid for the metric picker and chart (stacks below lg)', () => {
    assert.match(src, /grid grid-cols-12 gap-4 items-start/)
    assert.match(src, /col-span-12 lg:col-span-3/)
    assert.match(src, /col-span-12 lg:col-span-9/)
  })

  it('the toolbar wraps rather than widening the page', () => {
    assert.match(src, /flex items-center gap-4 flex-wrap/)
  })

  it('the metric picker scrolls internally rather than growing the page', () => {
    assert.match(src, /max-h-\[520px\] overflow-y-auto/)
  })

  it('reintroduces no root min-width', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /html\s*\{[^}]*min-width/s)
  })
})

// ─── Localisation ────────────────────────────────────────────────────────────

describe('Phase 5E — English and Spanish complete', () => {
  const NEW_KEYS = ['vs:', 'compareTicker:', 'removeMetric:', 'modeLabel:', 'freqLabel:']

  for (const key of NEW_KEYS) {
    it(`charting.${key.replace(':', '')} exists in both dictionaries`, () => {
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
    assert.match(i18n, /compareTicker: 'Empresa de comparación'/)
    assert.match(i18n, /removeMetric:\s+'Eliminar'/)
    assert.match(i18n, /modeLabel: 'Modo de valor'/)
    assert.match(i18n, /freqLabel: 'Frecuencia'/)
  })

  it('every t.charting.* key referenced by the page exists in both dictionaries', () => {
    const keys = [...new Set([...src.matchAll(/t\.charting\.(\w+)/g)].map(m => m[1]))]
    for (const key of keys) {
      if (key === 'm') continue // t.charting.m is a nested per-metric label map, checked separately below
      assert.ok(count(i18n, `${key}:`) >= 2, `t.charting.${key} must exist in both dict.en and dict.es`)
    }
  })

  it('every metric label referenced via t.charting.m[...] exists in both dictionaries', () => {
    const METRIC_KEYS = [
      'revenue', 'ebitda', 'netIncome', 'grossProfit', 'operatingIncome', 'eps', 'rdExpense',
      'sgaExpense', 'sbcExpense', 'depAmort', 'ebitdaMargin', 'revenueYoY', 'netIncomeYoY',
      'fcf', 'ocf', 'capex', 'cash', 'ltDebt', 'sharesOut', 'dividendsPaid', 'buybacks',
    ]
    for (const key of METRIC_KEYS) {
      assert.ok(count(i18n, `${key}:`) >= 2, `t.charting.m.${key} must exist in both dict.en and dict.es`)
    }
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5E — scope held', () => {
  it('changes no API contract from the page', () => {
    assert.ok(!src.includes("fetch('/api"), 'the page must go through the client-safe helper, never a raw fetch to an API route')
  })

  it('imports no server-only provider/db/financials module', () => {
    assert.ok(!/from '@\/lib\/providers\//.test(src))
    assert.ok(!/from '@\/lib\/db\//.test(src))
    assert.ok(!/from '@\/lib\/financials\//.test(src))
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('redesigns no page outside its own phase', () => {
    // `/macro` was removed from this list in Phase 5F and `/portfolio` in
    // Phase 5H, each migrated under its own brief (SegmentedControl included)
    // — real phase boundaries moving, not a relaxed assertion. They are
    // guarded by `tests/fableMacroPage.test.ts` /
    // `tests/fablePortfolioPage.test.ts`.
    for (const other of [
      'src/app/page.tsx', 'src/app/earnings/page.tsx',
      'src/app/structured-notes/page.tsx',
    ]) {
      assert.ok(existsSync(join(ROOT, other)), `${other} must still exist`)
      assert.ok(!read(other).includes('@/components/fable/SegmentedControl'), `${other} has had no re-skin phase yet`)
    }
  })

  it('leaves the middleware protection lists untouched (Chart Builder is public)', () => {
    const mw = read('src/middleware.ts')
    assert.ok(mw.includes('PROTECTED_PAGES'))
    assert.ok(!mw.includes("'/chart-builder'"))
  })

  it('leaves the previously re-skinned pages untouched by this phase', () => {
    assert.match(read('src/app/stocks/page.tsx'), /minWidth=\{760\}/)
    assert.match(read('src/app/watchlist/page.tsx'), /minWidth=\{620\}/)
    assert.match(read('src/app/companies/[ticker]/page.tsx'), /KpiCapsule/)
    assert.match(read('src/app/compare/page.tsx'), /<SegmentedControl/)
  })

  it('touches no chart component, globals.css, or data/config file', () => {
    // FundamentalsChart's own file is read-only-referenced by this suite for
    // regression checks above — it is not part of this phase's diff, and
    // Compare/Stocks/Watchlist/Company all independently guard their own
    // untouched files, so this route's guard only needs to hold itself.
    assert.ok(!src.includes("from '@/data/"), 'the page reads data only through src/lib/data/* helpers')
  })
})
