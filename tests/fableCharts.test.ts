// Fable integration — Phase 4 (shared chart & financial-visualization system).
//
// Source-scan tests, matching this repo's established convention for the
// Fable phases (no React-rendering harness exists, and this phase adds none):
// chart-token declarations, no hardcoded colors, prop/series preservation,
// shared tooltip adoption, accessible summaries, i18n completeness, no new
// network calls in presentational chart components, no new dependency.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CHART_FILES = [
  'src/components/charts/LineChart.tsx',
  'src/components/charts/CompareChart.tsx',
  'src/components/charts/FundamentalsChart.tsx',
  'src/components/charts/YieldCurveChart.tsx',
]
const NEW_FILES = [
  'src/components/fable/chart/ChartTooltip.tsx',
  'src/components/fable/chart/chartA11y.ts',
]
const OTHER_CHANGED = ['src/components/macro/EconomicCalendarTable.tsx']

// ── File existence ──────────────────────────────────────────────────────────

describe('Phase 4 shared chart files exist', () => {
  for (const file of [...CHART_FILES, ...NEW_FILES, ...OTHER_CHANGED]) {
    test(`${file} exists`, () => {
      assert.ok(existsSync(join(ROOT, file)), `missing ${file}`)
    })
  }
})

// ── Chart semantic tokens declared in globals.css ───────────────────────────

describe('chart semantic tokens are declared once, in :root', () => {
  const css = read('src/app/globals.css')

  const REQUIRED_TOKENS = [
    '--chart-primary', '--chart-secondary', '--chart-tertiary', '--chart-comparison',
    '--chart-positive', '--chart-negative', '--chart-neutral', '--chart-review',
    '--chart-warning', '--chart-unavailable',
    '--chart-grid', '--chart-axis', '--chart-border', '--chart-bg',
    '--chart-tooltip-bg', '--chart-tooltip-fg', '--chart-tooltip-border',
    '--chart-crosshair', '--chart-selected-point', '--chart-reference-line',
    '--chart-threshold-line', '--chart-confidence-band',
    '--legend-text', '--legend-inactive-opacity',
  ]

  for (const token of REQUIRED_TOKENS) {
    test(`${token} is declared`, () => {
      assert.match(css, new RegExp(`${token.replace(/[-]/g, '\\-')}:\\s*`), `missing token ${token}`)
    })
  }

  test('every chart token aliases an existing token or a plain non-color value — no new raw hex introduced', () => {
    const block = css.match(/Chart semantic tokens[\s\S]*?--legend-inactive-opacity:\s*([^;]+);/)
    assert.ok(block, 'chart token block must exist')
    assert.doesNotMatch(block![0], /#[0-9a-fA-F]{3,8}\b/, 'chart token block must not hardcode a hex color')
  })
})

// ── No hardcoded colors in any chart file ───────────────────────────────────

describe('no hardcoded hex colors in chart components', () => {
  for (const file of [...CHART_FILES, ...NEW_FILES, ...OTHER_CHANGED]) {
    test(`${file} has no hardcoded hex`, () => {
      const src = read(file)
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${file} must not hardcode a hex color`)
    })
  }
})

describe('no raw Tailwind color-scale classes in chart components', () => {
  for (const file of [...CHART_FILES, ...NEW_FILES, ...OTHER_CHANGED]) {
    test(`${file} has no raw color-scale utility`, () => {
      const src = read(file)
      assert.doesNotMatch(
        src,
        /\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
        `${file} must use semantic tokens, not a raw Tailwind color scale`,
      )
    })
  }
})

// ── Series/prop preservation — every existing prop name is still there ─────

describe('every chart prop is preserved (no functionality dropped)', () => {
  test('LineChart keeps data/unit/height/valueFormatter/compareData/compareLabel/primaryLabel/markers', () => {
    const src = read('src/components/charts/LineChart.tsx')
    for (const prop of ['data:', 'unit?:', 'height?:', 'valueFormatter?:', 'compareData?:', 'compareLabel?:', 'primaryLabel?:', 'markers?:']) {
      assert.match(src, new RegExp(prop.replace(/[?]/g, '\\?')), `LineChart must still declare ${prop}`)
    }
    assert.match(src, /export interface ChartMarker/)
  })

  test('CompareChart keeps series/height/showGrid/lineWidth/legend', () => {
    const src = read('src/components/charts/CompareChart.tsx')
    for (const prop of ['series:', 'height?:', 'showGrid?:', 'lineWidth?:', 'legend?:']) {
      assert.match(src, new RegExp(prop.replace(/[?]/g, '\\?')))
    }
  })

  test('FundamentalsChart keeps labels/series/height/indexed/chartType/showLegend/showGrid/fmtBar/fmtLine/fmtAxis', () => {
    const src = read('src/components/charts/FundamentalsChart.tsx')
    for (const prop of ['labels:', 'series:', 'height?:', 'indexed?:', 'chartType?:', 'showLegend?:', 'showGrid?:', 'fmtBar?:', 'fmtLine?:', 'fmtAxis?:']) {
      assert.match(src, new RegExp(prop.replace(/[?]/g, '\\?')))
    }
    assert.match(src, /export interface FundSeries/)
  })

  test('YieldCurveChart keeps tenors/series/unit/height', () => {
    const src = read('src/components/charts/YieldCurveChart.tsx')
    for (const prop of ['tenors:', 'series:', 'unit?:', 'height?:']) {
      assert.match(src, new RegExp(prop.replace(/[?]/g, '\\?')))
    }
  })

  test('EconomicCalendarTable keeps events/emptyMessage', () => {
    const src = read('src/components/macro/EconomicCalendarTable.tsx')
    assert.match(src, /events:\s*EnrichedFredCalendarEvent\[\]/)
    assert.match(src, /emptyMessage:\s*string/)
  })

  test('no chart type was removed (bar+line dual-axis, indexed mode, compare series, markers, categorical tenor axis all still implemented)', () => {
    const fund = read('src/components/charts/FundamentalsChart.tsx')
    assert.match(fund, /asBar/)
    assert.match(fund, /indexed/)
    assert.match(fund, /useDual/)
    const line = read('src/components/charts/LineChart.tsx')
    assert.match(line, /hasCompare/)
    assert.match(line, /markerPts/)
    const curve = read('src/components/charts/YieldCurveChart.tsx')
    assert.match(curve, /tenors/)
  })
})

// ── Shared tooltip adoption ──────────────────────────────────────────────────

describe('all four charts use the shared institutional ChartTooltip', () => {
  for (const file of CHART_FILES) {
    test(`${file} imports and renders ChartTooltip`, () => {
      const src = read(file)
      assert.match(src, /import \{ ChartTooltip \} from '@\/components\/fable\/chart\/ChartTooltip'/)
      assert.match(src, /<ChartTooltip left=\{tipLeft\}>/)
    })
  }

  test('ChartTooltip renders on the tokenized tooltip surface (near-opaque, not translucent glass)', () => {
    const src = read('src/components/fable/chart/ChartTooltip.tsx')
    assert.match(src, /var\(--chart-tooltip-bg\)/)
    assert.match(src, /var\(--chart-tooltip-fg\)/)
    assert.match(src, /var\(--chart-tooltip-border\)/)
    assert.match(src, /var\(--radius-menu\)/)
    assert.match(src, /var\(--shadow-card\)/)
    assert.doesNotMatch(src, /backdrop-filter/)
  })

  test('no chart duplicates its own ad hoc tooltip box styling anymore', () => {
    for (const file of CHART_FILES) {
      const src = read(file)
      assert.doesNotMatch(src, /px-2 py-1 shadow-md/, `${file} should use the shared ChartTooltip, not its own inline tooltip box`)
    }
  })
})

// ── Accessible summaries — a real text alternative, not just a <title> ─────

describe('every chart has a real accessible alternative, not merely an SVG <title>', () => {
  for (const file of CHART_FILES) {
    test(`${file} has role="img" + aria-describedby on its wrapper, plus a visible <title> and an sr-only long-form summary`, () => {
      const src = read(file)
      assert.match(src, /role="img"/)
      assert.match(src, /aria-describedby=\{descId\}/)
      assert.match(src, /<title>\{t\.fable\.chart\./)
      assert.match(src, /className="sr-only"/)
      assert.match(src, /aria-hidden="true"/, `${file}'s <svg> should be aria-hidden (the wrapper already carries the accessible name/description)`)
    })
  }

  test('the underlying svg is not the sole accessibility carrier — the wrapper aria-label uses a translated chart-kind name, not the data itself', () => {
    const line = read('src/components/charts/LineChart.tsx')
    assert.match(line, /aria-label=\{t\.fable\.chart\.lineChart\}/)
  })

  test('accessible summaries are built from real chart data (point/series/tenor counts, dates, latest values), never a static placeholder', () => {
    const line = read('src/components/charts/LineChart.tsx')
    assert.match(line, /formatTemplate\(t\.fable\.chart\.lineChartSummary,/)
    assert.match(line, /count: String\(data\.length\)/)
    const cmp = read('src/components/charts/CompareChart.tsx')
    assert.match(cmp, /formatTemplate\(t\.fable\.chart\.compareChartSummary,/)
    const fund = read('src/components/charts/FundamentalsChart.tsx')
    assert.match(fund, /formatTemplate\(t\.fable\.chart\.fundamentalsChartSummary,/)
    const curve = read('src/components/charts/YieldCurveChart.tsx')
    assert.match(curve, /formatTemplate\(t\.fable\.chart\.yieldCurveChartSummary,/)
  })
})

// ── i18n: fable.chart namespace complete in both languages ─────────────────

describe('i18n: fable.chart keys exist and are complete in both languages', () => {
  test('dict.en.fable.chart and dict.es.fable.chart both exist', () => {
    assert.ok('chart' in dict.en.fable, 'dict.en.fable.chart must exist')
    assert.ok('chart' in dict.es.fable, 'dict.es.fable.chart must exist')
  })

  const REQUIRED_KEYS = [
    'lineChart', 'lineChartSummary', 'compareSuffix', 'comparisonSeries', 'markersSuffix',
    'compareChart', 'compareChartSummary', 'fundamentalsChart', 'fundamentalsChartSummary',
    'yieldCurveChart', 'yieldCurveChartSummary',
  ]

  for (const key of REQUIRED_KEYS) {
    test(`dict.en.fable.chart.${key} and dict.es.fable.chart.${key} are both non-empty`, () => {
      const en = (dict.en.fable.chart as Record<string, string>)[key]
      const es = (dict.es.fable.chart as Record<string, string>)[key]
      assert.ok(typeof en === 'string' && en.length > 0, `dict.en.fable.chart.${key} must be non-empty`)
      assert.ok(typeof es === 'string' && es.length > 0, `dict.es.fable.chart.${key} must be non-empty`)
    })
  }

  test('no chart component hardcodes a UI-facing English fallback string outside useLang()/t.*', () => {
    for (const file of CHART_FILES) {
      const src = read(file)
      assert.match(src, /useLang/, `${file} must consume useLang() for its visible text`)
      assert.doesNotMatch(src, />No data available</, `${file} must not hardcode "No data available"`)
      assert.doesNotMatch(src, />No data</, `${file} must not hardcode "No data"`)
      assert.doesNotMatch(src, /Select a company and at least one metric\./, `${file} must not hardcode the select-metric fallback`)
    }
  })
})

// ── No new API calls, no new dependency ─────────────────────────────────────

describe('chart components stay purely presentational', () => {
  for (const file of [...CHART_FILES, ...NEW_FILES]) {
    test(`${file} makes no network call`, () => {
      const src = read(file)
      assert.doesNotMatch(src, /fetch\(/, `${file} must not call fetch() — chart components only render props`)
      assert.doesNotMatch(src, /await /, `${file} must not perform async data loading`)
    })
  }

  test('package.json has no new runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    const deps = Object.keys(pkg.dependencies)
    assert.deepEqual(
      deps.sort(),
      ['@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2'].sort(),
    )
  })
})

// ── Reduced motion / no new animation ───────────────────────────────────────

describe('no animation introduced in chart components (nothing new to gate behind prefers-reduced-motion)', () => {
  for (const file of [...CHART_FILES, ...NEW_FILES]) {
    test(`${file} declares no @keyframes and no CSS animation`, () => {
      const src = read(file)
      assert.doesNotMatch(src, /@keyframes/)
      assert.doesNotMatch(src, /animation:/)
    })
  }
})

// ── Formatter centralization ─────────────────────────────────────────────────

describe('LineChart uses the centralized chart-value formatter, not an ad hoc toLocaleString call', () => {
  test('formatChartValue exists in formatters.ts and is used by LineChart', () => {
    const formatters = read('src/lib/formatters.ts')
    assert.match(formatters, /export function formatChartValue/)
    const line = read('src/components/charts/LineChart.tsx')
    assert.match(line, /import \{ formatChartValue \} from '@\/lib\/formatters'/)
    assert.match(line, /formatChartValue\(v, unit\)/)
    assert.doesNotMatch(line, /toLocaleString/, 'LineChart should no longer call toLocaleString inline')
  })
})

// ── EconomicCalendarTable — Fable row-hover convention ──────────────────────

describe('EconomicCalendarTable adopts the shared Fable row-hover/transition utilities', () => {
  test('uses nv-row-hover + nv-transition instead of an ad hoc hover class', () => {
    const src = read('src/components/macro/EconomicCalendarTable.tsx')
    assert.match(src, /nv-row-hover nv-transition/)
    assert.doesNotMatch(src, /hover:bg-surface-2 transition-colors/)
  })
})

// ── Scope guard — no page, API, or business-logic file touched this phase ──

describe('scope stays within the chart/token layer', () => {
  test('no page.tsx that consumes these charts changed its import path or call signature', () => {
    const pages = [
      'src/app/macro/page.tsx',
      'src/app/compare/page.tsx',
      'src/app/chart-builder/page.tsx',
      'src/app/companies/[ticker]/page.tsx',
      'src/app/macro/calendar/page.tsx',
    ]
    for (const p of pages) {
      const src = read(p)
      assert.doesNotMatch(src, /from '@\/components\/fable\/chart\//, `${p} should not import the new internal chart-a11y/tooltip modules directly`)
    }
  })

  test('middleware and auth routes untouched (existence + shape check)', () => {
    // R1.5 replaced the PROTECTED_PAGES/PROTECTED_API denylist with the
    // default-deny policy module; middleware now delegates the decision.
    assert.ok(existsSync(join(ROOT, 'src/middleware.ts')))
    const mw = read('src/middleware.ts')
    assert.match(mw, /requiresApprovedSession/)
    assert.match(mw, /decideRequestAccess/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// R13.7 — chart x values are CALENDAR DATES, not instants
//
// `new Date("2026-08-07")` is an instant at UTC midnight, so the local getters
// the axis and tooltip used returned the PRIOR day in every negative UTC
// offset: a 7 August publication rendered "6 Aug" for a viewer in Chile — the
// entire client base of the family-portfolio module, whose evolution charts
// plot publication dates. These are BEHAVIOURAL tests: they run the real
// formatters under real timezones, and first prove the timezone is actually in
// effect so they can never pass vacuously in a UTC-only environment.
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7 · chart date axis is timezone-invariant', () => {
  const ORIGINAL_TZ = process.env.TZ
  const withTz = <T>(tz: string, fn: () => T): T => {
    process.env.TZ = tz
    try {
      return fn()
    } finally {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ
      else process.env.TZ = ORIGINAL_TZ
    }
  }

  test('the negative-offset case that produced the defect now renders the right day', async () => {
    const { formatAxisDate, formatChartTooltipDate, calendarSpanDays } = await import('../src/lib/charts/dateAxis.ts')

    withTz('America/Santiago', () => {
      // Proof the timezone is genuinely applied — this is the old behaviour.
      assert.equal(new Date('2026-08-07').getDate(), 6,
        'expected a negative UTC offset; without it this test proves nothing')

      const span = calendarSpanDays('2026-07-31', '2026-08-07')
      assert.equal(span, 7)
      assert.equal(formatAxisDate('2026-08-07', span), '7 Aug')
      assert.equal(formatChartTooltipDate('2026-08-07', span), '7 Aug 2026')
    })
  })

  test('the same value renders identically across positive, zero and negative offsets', async () => {
    const { formatAxisDate, formatChartTooltipDate, calendarSpanDays } = await import('../src/lib/charts/dateAxis.ts')
    const ZONES = ['America/Santiago', 'Pacific/Kiritimati', 'UTC', 'Asia/Tokyo', 'America/Anchorage']

    const axis = new Set<string>()
    const tip = new Set<string>()
    const spans = new Set<number>()
    for (const tz of ZONES) {
      withTz(tz, () => {
        const span = calendarSpanDays('2026-01-02', '2026-08-07')
        spans.add(span)
        axis.add(formatAxisDate('2026-08-07', 7))
        tip.add(formatChartTooltipDate('2026-08-07', 7))
      })
    }
    assert.equal(axis.size, 1, `axis label shifted across timezones: ${[...axis].join(' | ')}`)
    assert.equal(tip.size, 1, `tooltip label shifted across timezones: ${[...tip].join(' | ')}`)
    assert.equal(spans.size, 1, 'the span must be whole UTC-anchored days, never DST-dependent')
    assert.deepEqual([...axis], ['7 Aug'])
    assert.deepEqual([...tip], ['7 Aug 2026'])
  })

  test('axis and tooltip agree on the day, and month-only values resolve to the 1st', async () => {
    const { formatAxisDate, formatChartTooltipDate } = await import('../src/lib/charts/dateAxis.ts')
    withTz('America/Santiago', () => {
      // Every day of a DST-transition month, both formatters, same day number.
      for (let d = 1; d <= 30; d++) {
        const iso = `2026-09-${String(d).padStart(2, '0')}`
        assert.equal(formatAxisDate(iso, 7), `${d} Sep`, `axis wrong for ${iso}`)
        assert.equal(formatChartTooltipDate(iso, 7), `${d} Sep 2026`, `tooltip wrong for ${iso}`)
      }
      // Long spans switch format but never change the calendar month/year.
      assert.equal(formatAxisDate('2026-08-07', 400), "Aug '26")
      assert.equal(formatChartTooltipDate('2026-08-07', 401), 'Aug 2026')
      // `YYYY-MM` (quarterly/monthly series) resolves to the first of the month.
      assert.equal(formatAxisDate('2026-08', 7), '1 Aug')
      assert.equal(formatChartTooltipDate('2026-08', 7), '1 Aug 2026')
    })
  })

  test('LineChart formats dates through the shared calendar-safe helpers, not new Date()', () => {
    const src = read('src/components/charts/LineChart.tsx')
    assert.match(src, /from '@\/lib\/charts\/dateAxis'/)
    assert.match(src, /calendarSpanDays\(data\[0\]\.date/)
    assert.ok(!/new Date\(/.test(src), 'LineChart must not parse a calendar date as an instant')
    assert.ok(!/getMonth\(\)|getFullYear\(\)|getDate\(\)/.test(src),
      'local date getters shift a UTC-parsed calendar date by a day')
  })
})
