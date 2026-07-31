// Phase 5F — /macro re-skinned into the Fable institutional language.
// Phase R5 — deepened to full approved-Fable fidelity: the shared PageHeader
// (the same 19px/650 baseline row as the R3/R4 routes), an always-visible
// calendar link in the header metadata (previously the Chile region had no
// in-page path to /macro/calendar at all), the region chip on the shared
// ChipLabel primitive, and the hand-rolled chart popup replaced by the shared
// ModalShell (R4.1 dialog system: focus trap + restore, Escape, scrim,
// body-scroll lock — dense analytical surface preserved).
//
// The contract this file locks down: the page LOOKS different and NOTHING
// about what it shows or does changed. Every section, category band, series,
// yield-curve tenor, FX pair, chart, timeframe, source badge/footer, and
// async state is still there; every computed value, fetch effect, and the
// `cmi.macroRegion`/`macro:region` wiring are byte-for-byte the same; no API,
// provider, or business-logic file was touched.
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

const MACRO = 'src/app/macro/page.tsx'
const I18N = 'src/lib/i18n.ts'
const MACRO_SERIES = 'src/config/macroSeries.ts'
const INDICATORS_JSON = 'src/data/macroIndicators.json'

const src = read(MACRO)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── 1. Every section survives ────────────────────────────────────────────────

describe('Phase 5F — every Macro section survives the re-skin', () => {
  it('keeps the page header with tag, title, region-aware subtitle and actions (R5: shared Fable PageHeader)', () => {
    assert.match(src, /<PageHeader/)
    assert.match(src, /from '@\/components\/fable\/PageHeader'/)
    assert.match(src, /eyebrow=\{t\.macro\.tag\}/)
    assert.match(src, /title=\{t\.macro\.title\}/)
    assert.match(src, /\{region === 'CL' \? t\.macro\.clSubtitle : t\.macro\.usSubtitle\}/)
    assert.match(src, /<UpdateDataButton onRefresh=\{doRefresh\}\s*\/>/)
    assert.match(src, /<DataSourceBadge status=\{srcStatus\} provider=\{srcProvider\}\s*\/>/)
    assert.ok(!src.includes('SectionHeader'), 'the pre-Fable SectionHeader is superseded by the shared PageHeader (R5)')
  })

  it('keeps the US-only economic calendar embed with its link to the full calendar', () => {
    assert.match(src, /\{region === 'US' && \(/)
    assert.match(src, /title=\{t\.macro\.calToday\}/)
    assert.match(src, /href="\/macro\/calendar"/)
    assert.match(src, /t\.macro\.viewFull/)
  })

  it('keeps the banded indicators table', () => {
    assert.match(src, /\{groups\.map\(\(\{ cat, rows \}\) => \(/)
  })

  it('keeps the yield-curve card (always rendered)', () => {
    assert.match(src, /<YieldCurveChart/)
    assert.match(src, /t\.macro\.yieldCurve/)
  })

  it('keeps the US-only FX depth card', () => {
    assert.match(src, /title=\{t\.macro\.fxDepth\}/)
  })

  it('keeps the chart popup modal, Esc-closable (R5: via the shared ModalShell, which owns Escape/focus/scrim)', () => {
    assert.match(src, /from '@\/components\/fable\/ModalShell'/)
    assert.match(src, /\{selected && \(\s*\n\s*<ModalShell/)
    assert.match(src, /onClose=\{\(\) => setSelected\(null\)\}/)
    assert.ok(!src.includes('useEscape'), 'Escape handling moved into the shared ModalShell — no page-local copy')
    const shell = read('src/components/fable/ModalShell.tsx')
    assert.match(shell, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(shell, /aria-modal="true"/)
  })

  it('adds no invented KPI, hero, or summary metric to this route', () => {
    assert.ok(!src.includes('KpiHero'))
    assert.ok(!src.includes('KpiCapsule'))
    assert.ok(!src.includes('CurrentActions'))
  })
})

// ─── 2-3. Categories and series membership ─────────────────────────────────────

describe('Phase 5F — every macro category and its series membership preserved', () => {
  it('keeps the exact CL category order (Rates, Inflation, FX, Activity, Commodities, Labor)', () => {
    assert.match(src, /\[\{ cat: 'Rates', rows: clRatesRows \}, \.\.\.indByCat\(\['Inflation', 'FX', 'Activity', 'Commodities', 'Labor'\]\)\]/)
  })

  it('keeps the exact US category order (US Rates, US Inflation, US Activity, US Labor, US FX, Crypto)', () => {
    assert.match(src, /indByCat\(\['US Rates', 'US Inflation', 'US Activity', 'US Labor', 'US FX', 'Crypto'\]\)/)
  })

  it('keeps all 12 catLabel entries mapping category → translated band label', () => {
    const catLabelBlock = src.slice(src.indexOf('const catLabel'), src.indexOf('const toRow'))
    for (const cat of ['Rates', "'US Rates'", 'Inflation', "'US Inflation'", 'FX', "'US FX'", 'Activity', "'US Activity'", 'Labor', "'US Labor'", 'Commodities', 'Crypto']) {
      assert.ok(catLabelBlock.includes(cat), `catLabel missing ${cat}`)
    }
  })

  it('never hardcodes a category list in place of one that already reads live category data', () => {
    // The `indicators` array itself is fetched (live BCCh/FRED) — filtering it
    // by category (`i.category === cat`) is unchanged; only the JSX changed.
    assert.match(src, /indicators\.filter\(i => i\.category === cat\)/)
  })

  it('MacroSeriesDef categories are unchanged by this phase (config file untouched)', () => {
    const cfg = read(MACRO_SERIES)
    assert.match(cfg, /export type MacroCategory =/)
    assert.match(cfg, /'Rates' \| 'Inflation' \| 'FX' \| 'Activity' \| 'Commodities' \| 'Labor'/)
  })
})

// ─── 4. Every macro series preserved ───────────────────────────────────────────

describe('Phase 5F — every macro series preserved (data files untouched)', () => {
  it('macroIndicators.json still carries all 26 indicators', () => {
    const json = JSON.parse(read(INDICATORS_JSON)) as { id: string }[]
    assert.equal(json.length, 26)
  })

  it('the 7 Chilean-rate rows (RATE_HIST) are unchanged', () => {
    assert.match(src, /const RATE_HIST: Record<string, string> = \{/)
    for (const key of ["'tpm-tna': 'tpm'", 'btu10: ', 'btp10: ', 'btu5: ', 'swap2y: ', 'swap1y: ', 'pdbc90: ']) {
      assert.ok(src.includes(key), `RATE_HIST missing ${key}`)
    }
  })

  it('the Chile-rates overlay logic (live BCCh value via fallbackStaticId) is unchanged', () => {
    assert.match(src, /const liveId = getSeriesByStaticId\(r\.id\)\?\.fallbackStaticId \?\? r\.id/)
  })
})

// ─── 5. Chile/US region context ───────────────────────────────────────────────

describe('Phase 5F — Chile/US region context preserved', () => {
  it('region is still persisted under cmi.macroRegion, driven by the shell event', () => {
    assert.match(src, /usePersistentState<Region>\('cmi\.macroRegion', 'CL'\)/)
    assert.match(src, /window\.addEventListener\('macro:region', h\)/)
  })

  it('the region chip shows a translated word, not a hardcoded "Chile"/"US" literal', () => {
    assert.match(src, /\{region === 'CL' \? t\.macro\.regionCL : t\.macro\.regionUS\}/)
    assert.ok(!/>\{region === 'CL' \? 'Chile' : 'US'\}</.test(src), 'the old hardcoded-English region span must be gone')
  })

  it('per-region source status/provider are unchanged (BCCh for CL, FRED for US)', () => {
    assert.match(src, /const srcStatus = region === 'CL' \? clStatus : usStatus/)
    assert.match(src, /const srcProvider = region === 'CL' \? 'BCCh' : 'FRED'/)
  })
})

// ─── 6-9. Charts, timeframes, axes, tenors ─────────────────────────────────────

describe('Phase 5F — chart series, timeframes, axis/unit and yield-curve tenors preserved', () => {
  it('keeps the exact 1/3/5/10-year timeframe set for the popup chart', () => {
    assert.match(src, /type Timeframe = 1 \| 3 \| 5 \| 10/)
    assert.match(src, /const TIMEFRAMES: Timeframe\[\] = \[1, 3, 5, 10\]/)
  })

  it('the timeframe SegmentedControl maps to/from the same numeric Timeframe type — no logic change', () => {
    assert.match(src, /value=\{String\(timeframe\)\}/)
    assert.match(src, /onChange=\{v => setTimeframe\(Number\(v\) as Timeframe\)\}/)
  })

  it('keeps the exact live/static tenor, series-value and source precedence for the yield curve', () => {
    assert.match(src, /const curveOk = liveCurve\?\.ok === true/)
    assert.match(src, /const curveTenors = curveOk \? liveCurve\.tenors : staticCurve\.tenors/)
    assert.match(src, /const curveToday = curveOk \? liveCurve\.today : staticCurve\.today/)
    assert.match(src, /const curveWeekAgo = curveOk \? liveCurve\.weekAgo : staticCurve\.weekAgo/)
    assert.match(src, /const curveYearEnd = curveOk \? liveCurve\.yearEnd : staticCurve\.yearEnd/)
  })

  it('keeps the dynamically-derived year-end year (never a hardcoded literal)', () => {
    assert.match(src, /const curveYearEndYear = curveOk && liveCurve\.yearEndDate/)
    assert.match(src, /getFullYear\(\) - 1/)
  })

  it('passes the same 3 series (today/week-ago/year-end) with unchanged colors and dash treatment to YieldCurveChart', () => {
    assert.match(src, /\{ label: t\.macro\.curveToday, color: 'var\(--primary\)', values: curveToday \}/)
    assert.match(src, /\{ label: t\.macro\.curveWeek, color: 'var\(--accent\)', values: curveWeekAgo \}/)
    assert.match(src, /\{ label: `\$\{t\.macro\.curveYearEnd\} \$\{curveYearEndYear\}`, color: 'var\(--muted\)', dashed: true, values: curveYearEnd \}/)
  })

  it('LineChart and YieldCurveChart props/call signatures are untouched by this phase', () => {
    assert.match(src, /<LineChart data=\{liveChart \?\? historyData\} unit=\{selected\.unit === '%' \? '%' : ''\} height=\{240\}\s*\/>/)
    assert.match(src, /<YieldCurveChart\s*\n\s*tenors=\{curveTenors\}\s*\n\s*unit=\{staticCurve\.unit\}/)
  })
})

// ─── 10. Legends and tooltips (chart-internal, untouched) ─────────────────────

describe('Phase 5F — legends and tooltips remain (chart components untouched)', () => {
  it('YieldCurveChart still owns its own legend and tooltip rendering', () => {
    const chart = read('src/components/charts/YieldCurveChart.tsx')
    assert.match(chart, /<ChartTooltip/)
    assert.match(chart, /flex items-center gap-4 flex-wrap mt-2/)
  })
})

// ─── 11-12. Yield-curve tenors + order, untouched provider ────────────────────

describe('Phase 5F — yield-curve tenor set and order untouched (provider file not modified)', () => {
  it('CL_YIELD_CURVE_TENORS keeps its exact 5-tenor order', () => {
    const provider = read('src/lib/providers/yieldCurveProvider.ts')
    assert.match(provider, /export const CL_YIELD_CURVE_TENORS: TenorDef\[\] = \[\s*\{ tenor: 'TPM'.*\{ tenor: '1Y'.*\{ tenor: '2Y'.*\{ tenor: '5Y \(UF\)'.*\{ tenor: '10Y \(UF\)'/s)
  })

  it('US_YIELD_CURVE_TENORS keeps its exact 5-tenor order', () => {
    const provider = read('src/lib/providers/yieldCurveProvider.ts')
    assert.match(provider, /export const US_YIELD_CURVE_TENORS: TenorDef\[\] = \[\s*\{ tenor: '3M'.*\{ tenor: '2Y'.*\{ tenor: '10Y'.*\{ tenor: '20Y'.*\{ tenor: '30Y'/s)
  })

  it('static yieldCurves.json keeps its full tenor arrays (US 11, CL 7)', () => {
    const json = JSON.parse(read('src/data/yieldCurves.json')) as Record<string, { tenors: string[] }>
    assert.equal(json.US.tenors.length, 11)
    assert.equal(json.CL.tenors.length, 7)
  })
})

// ─── 13. FX pairs preserved ─────────────────────────────────────────────────────

describe('Phase 5F — every FX pair and quote direction preserved (Frankfurter, unchanged)', () => {
  it('the 12-pair universe (8 direct + 4 inverted) is unchanged in the provider', () => {
    const provider = read('src/lib/providers/frankfurterFxProvider.ts')
    for (const pair of ['USDJPY', 'USDCHF', 'USDCAD', 'USDMXN', 'USDBRL', 'USDCNY', 'USDKRW', 'USDTWD']) {
      assert.ok(provider.includes(`pair: '${pair}'`), `direct pair ${pair} missing`)
    }
    for (const pair of ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD']) {
      assert.ok(provider.includes(`pair: '${pair}'`), `inverted pair ${pair} missing`)
    }
  })

  it('never reintroduces CurrencyFreaks on this page', () => {
    assert.ok(!src.includes('currencyFreaks'))
    assert.match(src, /import \{ fetchUsForexTable \} from '@\/lib\/data\/frankfurterFx'/)
  })

  it('the FX table renders only when Frankfurter has real rows — never a fabricated fallback', () => {
    assert.match(src, /usForex\?\.ok && usForex\.rows\.length > 0/)
  })

  it('derived (inverted) pairs keep their † marker and tooltip, direct pairs do not', () => {
    assert.match(src, /\{r\.derived && \(/)
    assert.match(src, /title=\{t\.macro\.fxDerived\}>†<\/span>/)
  })

  it('FX day/YTD change never becomes zero when unavailable — the exact null-guarded ternary survives', () => {
    assert.match(src, /\{r\.oneDayChangePct != null \? formatPct\(r\.oneDayChangePct\) : '—'\}/)
    assert.match(src, /\{r\.ytdChangePct != null \? formatPct\(r\.ytdChangePct\) : '—'\}/)
  })
})

// ─── 16. User actions ───────────────────────────────────────────────────────────

describe('Phase 5F — every user action preserved', () => {
  it('Update Data still bumps the shared macroRefreshSeq via useGlobalRefresh, re-running all 4 effects', () => {
    assert.match(src, /const doRefresh = useGlobalRefresh\(\)/)
    const deps = src.match(/\}, \[[^\]]*macroRefreshSeq[^\]]*\]\)/g) ?? []
    assert.ok(deps.length >= 4, `expected ≥4 effects keyed on macroRefreshSeq, found ${deps.length}`)
  })

  it('row click still opens the chart popup via openRow, unchanged', () => {
    assert.match(src, /const openRow = \(r: Row\) => \{ if \(r\.histId\) \{ setSelected\(r\); setTimeframe\(5\) \} \}/)
    assert.match(src, /onClick=\{\(\) => openRow\(r\)\}/)
  })

  it('a chartable row is now also keyboard-operable (Enter/Space), a real a11y addition, not a behaviour removal', () => {
    assert.match(src, /onKeyDown=\{r\.histId \? \(e => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); openRow\(r\) \} \}\) : undefined\}/)
    assert.match(src, /role=\{r\.histId \? 'button' : undefined\}/)
  })
})

// ─── 17-19. Source badges, footers, timestamps ─────────────────────────────────

describe('Phase 5F — source badges, footers and timestamps preserved', () => {
  it('keeps all 3 DataSourceBadge instances (header, yield curve, popup)', () => {
    assert.equal(count(src, '<DataSourceBadge'), 3)
  })

  it('keeps the SourceStateBadge for the FX depth table (frankfurterLive/Unavailable)', () => {
    assert.match(src, /sourceKey=\{usForex && usForex\.ok \? 'frankfurterLive' : 'frankfurterUnavailable'\}/)
  })

  it('keeps 4 TableSourceFooter instances (calendar embed, indicators, yield curve, FX)', () => {
    assert.equal(count(src, '<TableSourceFooter'), 4)
  })

  it('the indicators table as-of derives from the latest fetched indicator, unchanged', () => {
    assert.match(src, /const latestAsOf = indicators\.reduce\(\(max, i\) => \(i\.lastUpdated > max \? i\.lastUpdated : max\), ''\)/)
  })

  it('the calendar embed footer always names FRED with a null as-of, unchanged', () => {
    assert.match(src, /<TableSourceFooter source="FRED \(Federal Reserve Bank of St\. Louis\)" asOf=\{null\}\s*\/>/)
  })
})

// ─── 20-25. Async and data-quality states ──────────────────────────────────────

describe('Phase 5F — async and data-quality states stay distinct', () => {
  it('no loading spinner is fabricated — indicators render static-first, live swaps in silently', () => {
    assert.match(src, /useState<MacroIndicator\[\]>\(\(\) => getAllIndicators\(\)\)/)
    assert.ok(!src.includes('kind="loading"'))
  })

  it('the calendar embed "not configured" state routes through TableCard/AsyncState with the original message', () => {
    assert.match(src, /state=\{calendar && !calendar\.configured \? 'unavailable' : undefined\}/)
    assert.match(src, /stateMessage=\{t\.cal\.fredUnavailable\}/)
  })

  it('the FX depth "unavailable" state (not ok, or zero rows) routes through TableCard/AsyncState with the original message', () => {
    assert.match(src, /state=\{!\(usForex && usForex\.ok\) \|\| usForex\.rows\.length === 0 \? 'unavailable' : undefined\}/)
    assert.match(src, /stateMessage=\{t\.macro\.fxUnavailable\}/)
  })

  it('the popup chart "no history" state routes through AsyncState with the original message', () => {
    assert.match(src, /<AsyncState kind="unavailable" message=\{t\.macro\.noHistory\}\s*\/>/)
  })

  it('a provider failure on the history fetch keeps the previous chart, never crashes or blanks it', () => {
    assert.match(src, /if \(!res\) return/)
  })

  it('one indicator series being unavailable never removes a sibling row — rows render independently from `groups`', () => {
    assert.match(src, /\{rows\.map\(r => \{/)
    assert.ok(!/rows\.filter\(/.test(src), 'no post-hoc filtering removes a configured row')
  })

  it('unavailable values never become a fabricated zero anywhere on this page', () => {
    assert.ok(!/[^.]\?\? 0\b/.test(src.replace(/\.length \?\? 0/g, '')), 'no null-coalesce-to-zero on a displayed value')
  })
})

// ─── API / data dependencies unchanged ─────────────────────────────────────────

describe('Phase 5F — API and data dependencies untouched', () => {
  it('fetches through the same 6 client-safe helpers, never a raw fetch or a server-only import', () => {
    for (const helper of ['fetchMacroIndicators', 'fetchLiveYieldCurve', 'fetchUsForexTable', 'fetchFredReleaseCalendarRange', 'fetchMacroHistory']) {
      assert.ok(src.includes(helper), `missing ${helper}`)
    }
    assert.ok(!src.includes("fetch('/api"), 'the page must go through client-safe helpers, never a raw fetch to an API route')
    assert.ok(!/from '@\/lib\/providers\//.test(src) || /from '@\/lib\/providers\/types'/.test(src), 'only the type-only providers/types import is allowed')
    assert.ok(!/from '@\/lib\/db\//.test(src))
  })

  it('keeps the static baseline imports (indicators, chilean rates, yield curve, macro history)', () => {
    assert.match(src, /import \{ getAllIndicators, fetchMacroIndicators \} from '@\/lib\/data\/macro'/)
    assert.match(src, /import \{ getChileanRates \} from '@\/lib\/data\/chileanRates'/)
    assert.match(src, /import \{ getYieldCurve \} from '@\/lib\/data\/yieldCurves'/)
    assert.match(src, /import \{ getMacroHistoryForTimeframe, fetchMacroHistory \} from '@\/lib\/data\/macroHistory'/)
  })
})

// ─── Persistence ────────────────────────────────────────────────────────────────

describe('Phase 5F — persistence unchanged', () => {
  it('cmi.macroRegion is the only persisted key on this page (shared with the shell)', () => {
    assert.equal(count(src, "usePersistentState<Region>('cmi.macroRegion', 'CL')"), 1)
  })

  it('no new persistence key or URL-state mechanism was introduced', () => {
    assert.ok(!src.includes('useSearchParams'))
    assert.ok(!src.includes('URLSearchParams'))
  })
})

// ─── Fable visual language ─────────────────────────────────────────────────────

describe('Phase 5F — Fable visual language applied via shared primitives', () => {
  it('uses the shared analytical TableCard for all 3 tables (calendar embed, indicators, FX)', () => {
    assert.match(src, /from '@\/components\/fable\/TableCard'/)
    assert.equal(count(src, '<TableCard'), 3)
  })

  it('puts every dense table on the near-opaque surface, never on blurred glass', () => {
    const tableCard = read('src/components/fable/TableCard.tsx')
    assert.match(tableCard, /variant="dense"/)
    assert.ok(count(src, "backgroundColor: 'var(--surface-table)'") >= 9, 'expected near-opaque header cells across the indicators + FX tables')
    assert.ok(!src.includes('nv-glass-card'), 'the page never applies glass directly to table content')
  })

  it('uses tokenised row hover on clickable/data rows, never the untokenised hover:bg-surface-2', () => {
    assert.ok(count(src, 'nv-row-hover') >= 2)
    assert.ok(!src.includes('hover:bg-surface-2'), 'the untokenised hover recipe is gone')
  })

  it('uses GlassSurface for the yield-curve chart card, never a raw bg-surface div', () => {
    assert.match(src, /from '@\/components\/fable\/GlassSurface'/)
    assert.match(src, /<GlassSurface variant="card" className="p-4">/)
    assert.ok(!src.includes('bg-surface border border-border rounded'), 'the pre-Fable card recipe is gone')
  })

  it('uses the shared SegmentedControl for the popup chart timeframe', () => {
    assert.match(src, /from '@\/components\/fable\/SegmentedControl'/)
    assert.equal(count(src, '<SegmentedControl'), 1)
  })

  it('renders the chart popup on the scrim + near-opaque dense analytical surface, never low-opacity glass (R5: ModalShell dense mode)', () => {
    // The dense-surface guarantee moved into the shared ModalShell (`dense`
    // prop) — tests/fableMacroChartModalOpacity.test.ts locks the tier itself.
    assert.match(src, /size="lg"\s*\n\s*dense/)
    assert.ok(!src.includes('nv-glass-overlay'), 'the popup must not use the translucent Tier-5 overlay glass (opacity/readability defect)')
    const shell = read('src/components/fable/ModalShell.tsx')
    assert.match(shell, /dense \? 'nv-surface-dense' : 'nv-glass-overlay'/)
  })

  it('restyles the region chip to the shared Fable ChipLabel primitive (R5 — no hand-rolled chip recipe left on the page)', () => {
    assert.match(src, /from '@\/components\/fable\/Chip'/)
    assert.match(src, /<ChipLabel/)
    assert.ok(!src.includes("backgroundColor: 'var(--nv-chip)'"), 'the inline chip recipe is superseded by ChipLabel')
  })

  it('uses the tokenised table-cell type scale on every table', () => {
    assert.equal(count(src, "fontSize: 'var(--fs-table-cell)'"), 2)
  })

  it('hardcodes no hex colour and no raw Tailwind colour scale', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), 'contains a hardcoded hex colour')
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

describe('Phase 5F — motion is restrained and reduced-motion safe', () => {
  it('uses only the shared CSS reveal primitive, with the Fable stagger cadence', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /<Reveal delayMs=\{130\}>/)
    assert.match(src, /<Reveal delayMs=\{190\}>/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
  })

  it('never animates a market/macro value continuously — no count-up on this route', () => {
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('ValueChangeTransition'))
  })

  it('introduces no page-local keyframes or animation utility', () => {
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('the chart popup uses the established nv-pop overlay entrance, not a bespoke transition (R5: carried by ModalShell)', () => {
    assert.match(read('src/components/fable/ModalShell.tsx'), /nv-pop/)
    assert.ok(!src.includes('@keyframes'), 'no page-local entrance animation')
  })

  it('the reveal primitive collapses to its final state under reduced motion (shared global rule, unchanged)', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5F — accessibility', () => {
  it('uses semantic table markup with scoped headers and captions', () => {
    assert.ok(count(src, 'scope="col"') >= 9)
    assert.ok(count(src, '<caption className="sr-only">') >= 2)
  })

  it('labels the popup chart timeframe control', () => {
    assert.match(src, /ariaLabel=\{t\.macro\.timeframeLabel\}/)
  })

  it('the popup dialog has a data-driven accessible name and a labelled close control (R5: via ModalShell)', () => {
    // ModalShell labels the dialog from its `title` prop via aria-labelledby
    // and renders the localized close control itself.
    assert.match(src, /title=\{selected\.label\}/)
    const shell = read('src/components/fable/ModalShell.tsx')
    assert.match(shell, /aria-labelledby=\{titleId\}/)
    assert.match(shell, /aria-label=\{t\.fable\.panel\.close\}/)
  })

  it('a chartable row exposes a distinct, localized accessible name', () => {
    assert.match(src, /aria-label=\{r\.histId \? `\$\{r\.label\} — \$\{t\.macro\.viewChart\}` : undefined\}/)
  })

  it('the "Chartable" dot title is localized, not hardcoded English', () => {
    assert.match(src, /title=\{t\.macro\.chartable\}/)
    assert.ok(!src.includes('title="Chartable"'), 'the old hardcoded-English title must be gone')
  })

  it('the popup close button uses the shared localized label, not hardcoded English', () => {
    assert.ok(!src.includes('aria-label="Close chart"'), 'the old hardcoded-English aria-label must be gone')
  })

  it('SegmentedControl itself is a real keyboard-operable radiogroup (untouched by this phase)', () => {
    const seg = read('src/components/fable/SegmentedControl.tsx')
    assert.match(seg, /role="radiogroup"/)
    assert.match(seg, /role="radio"/)
    assert.match(seg, /onKeyDown=\{onKeyDown\}/)
  })

  it('YieldCurveChart carries an accessible role/description (untouched by this phase)', () => {
    const chart = read('src/components/charts/YieldCurveChart.tsx')
    assert.match(chart, /role="img"/)
    assert.match(chart, /aria-describedby=\{descId\}/)
  })
})

// ─── Responsive ──────────────────────────────────────────────────────────────

describe('Phase 5F — responsive guarantees', () => {
  it('keeps the full-width page container with no page-level max-width', () => {
    assert.match(src, /<div className="w-full space-y-4">/)
    assert.ok(!src.includes('max-w-screen-xl'))
  })

  it('scrolls all 3 dense tables inside their card via TableCard minWidth', () => {
    assert.match(src, /minWidth=\{720\}/)
    assert.match(src, /minWidth=\{660\}/)
    assert.match(src, /minWidth=\{420\}/)
    assert.match(read('src/components/fable/TableCard.tsx'), /overflow-x-auto/)
  })

  it('keeps the exact CL/US responsive grid class for the yield-curve/FX row', () => {
    assert.match(src, /region === 'CL' \? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'/)
  })

  it('reintroduces no root min-width', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /html\s*\{[^}]*min-width/s)
  })
})

// ─── Localisation ────────────────────────────────────────────────────────────

describe('Phase 5F — English and Spanish complete', () => {
  const NEW_KEYS = ['chartable:', 'viewChart:', 'regionCL:', 'regionUS:', 'timeframeLabel:']

  for (const key of NEW_KEYS) {
    it(`macro.${key.replace(':', '')} exists in both dictionaries`, () => {
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
    assert.match(i18n, /chartable:\s+'Graficable'/)
    assert.match(i18n, /viewChart:\s+'Ver gráfico'/)
    assert.match(i18n, /regionUS:\s+'EE\.UU\.'/)
    assert.match(i18n, /timeframeLabel: 'Periodo'/)
  })

  it('every t.macro.* key referenced by the page exists in both dictionaries', () => {
    const keys = [...new Set([...src.matchAll(/t\.macro\.(\w+)/g)].map(m => m[1]))]
    for (const key of keys) {
      assert.ok(count(i18n, `${key}:`) >= 2, `t.macro.${key} must exist in both dict.en and dict.es`)
    }
  })

  it('every t.cal.* key referenced by the page exists in both dictionaries', () => {
    const keys = [...new Set([...src.matchAll(/t\.cal\.(\w+)/g)].map(m => m[1]))]
    for (const key of keys) {
      assert.ok(count(i18n, `${key}:`) >= 2, `t.cal.${key} must exist in both dict.en and dict.es`)
    }
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5F — scope held', () => {
  it('imports no server-only db/financials module (types-only provider imports are fine)', () => {
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
    // `/portfolio` was removed from this list in Phase 5H and
    // `/structured-notes` in Phase R3, each migrated under its own brief
    // (SegmentedControl included) — real phase boundaries moving, not a
    // relaxed assertion. They are guarded by
    // `tests/fablePortfolioPage.test.ts` /
    // `tests/fableStructuredNotesPage.test.ts`.
    for (const other of [
      'src/app/page.tsx', 'src/app/earnings/page.tsx',
    ]) {
      assert.ok(existsSync(join(ROOT, other)), `${other} must still exist`)
      assert.ok(!read(other).includes('@/components/fable/SegmentedControl'), `${other} has had no re-skin phase yet`)
    }
  })

  it('Chart Builder, Compare and Company Detail are untouched by this phase', () => {
    assert.match(read('src/app/chart-builder/page.tsx'), /<SegmentedControl/)
    assert.match(read('src/app/compare/page.tsx'), /<TableCard/)
    assert.match(read('src/app/companies/[ticker]/page.tsx'), /KpiCapsule/)
  })

  it('leaves access control to the shared policy (Macro is now private)', async () => {
    // R1.5 made Nevada Market Intelligence default-deny: middleware no longer
    // carries PROTECTED_PAGES/PROTECTED_API, and this route is now PRIVATE like
    // every other application page. The original intent of this test — that the
    // page phase itself changed no access rule — is preserved by asserting the
    // route's classification comes from the shared policy.
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/macro'), 'private_page')
    assert.ok(!read('src/middleware.ts').includes("'/macro'"), 'never named in middleware')
  })

  it('changes no API contract from the page', () => {
    assert.ok(!src.includes("fetch('/api"))
  })
})

// ─── Phase R5 — approved-Fable deepening ──────────────────────────────────────

describe('Phase R5 — /macro joins the shared Fable header/dialog family', () => {
  it('the calendar link is always visible in the header metadata — both regions, not only inside the US embed', () => {
    // Before R5 the only in-page path to /macro/calendar sat inside the
    // US-only calendar embed, so the Chile region had no link at all.
    assert.equal(count(src, 'href="/macro/calendar"'), 2, 'header metadata link + US embed link')
    assert.equal(count(src, 't.macro.viewFull'), 2)
    assert.match(src, /metadata=\{[\s\S]{0,400}?href="\/macro\/calendar"/, 'the header metadata carries the calendar link')
  })

  it('route navigation between Macro and Calendar stays real links — shell pill rail + header metadata, no client-only fake navigation', () => {
    const nav = read('src/lib/navigation.ts')
    assert.match(nav, /\{ key: 'macroIndicators', href: '\/macro', label: \(t\) => t\.nav\.macroIndicators \}/)
    assert.match(nav, /\{ key: 'macroCalendar', href: '\/macro\/calendar', label: \(t\) => t\.nav\.macroCalendar \}/)
    const secondary = read('src/components/layout/SecondaryNav.tsx')
    assert.match(secondary, /aria-current=\{active \? 'page' : undefined\}/)
  })

  it('the chart popup is the shared ModalShell — no page-local dialog markup remains', () => {
    assert.ok(!src.includes('role="dialog"'), 'no hand-rolled dialog role on the page')
    assert.ok(!src.includes('aria-modal'), 'aria-modal is ModalShell responsibility')
    assert.ok(!src.includes('nv-scrim'), 'the scrim is ModalShell responsibility')
    assert.ok(!src.includes('stopPropagation'), 'no manual scrim-click plumbing')
  })

  it('no browser-native dialog is introduced on this route', () => {
    assert.ok(!/window\.(confirm|alert|prompt)\(/.test(src))
    assert.ok(!/globalThis\.(confirm|alert|prompt)\(/.test(src))
  })

  it('the header family matches R3/R4 (PageHeader eyebrow/title/metadata anatomy, ui-page-title scale)', () => {
    const header = read('src/components/fable/PageHeader.tsx')
    assert.match(header, /ui-page-title/)
    assert.match(src, /metadata=\{/)
  })
})
