// Phase 5C — /companies/[ticker] re-skinned into the Fable institutional language.
//
// The contract this file locks down: the dynamic company-detail page LOOKS
// different and NOTHING about what it shows or does changed. Every section
// (breadcrumb, header/KPIs, business panels, chart, results, valuation,
// news), every KPI, every table column, every valuation metric, every
// source badge/footer/as-of, the ticker-parsing/not-found behaviour, the
// print path, the "Graph fundamentals" deep-link, and the honest "—" for
// unavailable data are still there — only the presentation layer changed
// (KpiCapsule/GlassSurface/ChangeIndicator/SegmentedControl/AsyncState/
// Reveal). No API, provider, calculation, or business-logic file was
// touched.
//
// Source-scan checks (this repo has no React render harness) — the same
// established convention as tests/fableStocksPage.test.ts and
// tests/fableWatchlistPage.test.ts. Real-logic checks are used wherever the
// underlying module is directly importable (src/lib/navigation.ts).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveActiveGroup, resolveActiveChild, getPageTitle } from '../src/lib/navigation.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const COMPANY = 'src/app/companies/[ticker]/page.tsx'
const I18N = 'src/lib/i18n.ts'

const src = read(COMPANY)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1
const t = dict.en

// ─── 1. Route and scope ───────────────────────────────────────────────────────

describe('Phase 5C — route and scope', () => {
  it('the dynamic route file still exists at the canonical path', () => {
    assert.ok(existsSync(join(ROOT, COMPANY)))
  })

  it('parses and normalizes the ticker from the dynamic segment', () => {
    assert.match(src, /const \{ ticker \} = useParams<\{ ticker: string \}>\(\)/)
    assert.match(src, /const sym = \(ticker \?\? ''\)\.toUpperCase\(\)/)
    assert.equal(count(src, '.toUpperCase()'), 1, 'normalization happens exactly once, at the top')
  })

  it('renders an honest not-found state for an unknown/invalid ticker, never a crash or a fabricated company', () => {
    assert.match(src, /if \(!company\) \{/)
    assert.match(src, /<EmptyState message=\{t\.company\.noData\} \/>/)
    assert.equal(count(src, '<EmptyState'), 1)
  })

  it('the not-found branch still shows the breadcrumb with the requested ticker (the URL stays legible even for a bad ticker)', () => {
    const notFoundBlock = src.slice(src.indexOf('if (!company)'), src.indexOf('const lv = live?.stocks[sym]'))
    assert.match(notFoundBlock, /<Link href="\/stocks" className="hover:text-foreground transition-colors">\{t\.company\.breadcrumb\}<\/Link>/)
    assert.match(notFoundBlock, /<span className="font-mono text-primary">\{sym\}<\/span>/)
  })

  it('direct company URLs stay canonical — no alternate static company route exists', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/company')), 'no singular /company route was introduced')
    assert.ok(!existsSync(join(ROOT, 'src/app/companies/page.tsx')), 'no companies index page was introduced')
  })

  it('Markets navigation resolves active for a dynamic company route (real logic, not a source guess)', () => {
    const group1 = resolveActiveGroup('/companies/SQM-B')
    assert.equal(group1?.key, 'markets')
    assert.equal(resolveActiveChild('/companies/SQM-B', group1)?.key, 'stocks')

    const group2 = resolveActiveGroup('/companies/bsantander')
    assert.equal(group2?.key, 'markets', 'case must not affect prefix matching')
    assert.equal(resolveActiveChild('/companies/bsantander', group2)?.key, 'stocks')
  })

  it('the page title still resolves to "Stocks · TICKER" for a company route', () => {
    assert.equal(getPageTitle('/companies/sqm-b', 'en', t), `${t.stocks.tag} · SQM-B`)
    assert.equal(getPageTitle('/companies/', 'en', t), t.stocks.tag, 'a bare /companies/ falls back to the group title, never a crash')
  })

  it('company routes have no standalone nav entry — they resolve through the Markets → Stocks prefix match, unchanged', () => {
    const nav = read('src/lib/navigation.ts')
    assert.match(nav, /matchPrefixes:\s*\[['"]\/companies['"]\]/)
  })

  it('redesigns no other page — Phase 5C is /companies/[ticker] only', () => {
    // `/compare` was removed from this list in Phase 5D, `/chart-builder` in
    // Phase 5E, `/macro` + `/macro/calendar` in Phase 5F, `/portfolio` in
    // Phase 5H, and `/structured-notes` in Phase R3, each migrated under its
    // own brief (SegmentedControl included) — real phase boundaries moving,
    // not relaxed assertions. They are guarded by
    // `tests/fableComparePage.test.ts`, `tests/fableChartBuilderPage.test.ts`,
    // `tests/fableMacroPage.test.ts`, `tests/fableMacroCalendarPage.test.ts`,
    // `tests/fablePortfolioPage.test.ts`, and
    // `tests/fableStructuredNotesPage.test.ts` respectively.
    for (const other of [
      'src/app/page.tsx', 'src/app/earnings/page.tsx',
    ]) {
      const otherSrc = read(other)
      assert.ok(!otherSrc.includes('KpiCapsule'), `${other} is not part of Phase 5C`)
      assert.ok(!otherSrc.includes('@/components/fable/SegmentedControl'), `${other} is not part of Phase 5C`)
    }
  })

  it('leaves the Phase 5A/5B pages untouched by this phase', () => {
    const stocks = read('src/app/stocks/page.tsx')
    assert.match(stocks, /minWidth=\{760\}/)
    const watchlist = read('src/app/watchlist/page.tsx')
    assert.match(watchlist, /minWidth=\{620\}/)
  })

  it('changes no src/app/api/** file — every route this page depends on still exports the same handler', () => {
    assert.match(read('src/app/api/valuation/[ticker]/route.ts'), /export async function GET/)
    assert.match(read('src/app/api/earnings/results/route.ts'), /export async function GET/)
    assert.match(read('src/app/api/earnings/calendar/route.ts'), /export async function GET/)
    assert.match(read('src/app/api/market/stocks/[ticker]/route.ts'), /export async function GET/)
    assert.match(read('src/app/api/market/stocks/[ticker]/history/route.ts'), /export async function GET/)
  })

  it('imports no server-only provider, db, or Supabase module directly into the client page', () => {
    assert.ok(!/@\/lib\/providers\/(?!market\/types|types)/.test(src), 'only type-only provider imports are allowed')
    assert.ok(!src.includes('@/lib/db/'))
    assert.ok(!src.includes('@/lib/supabase/'))
  })

  it('adds no runtime dependency (package.json unchanged)', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('the company route and valuation API are now private (R1.5)', async () => {
    // DELIBERATE REVERSAL. This test previously asserted the company route and
    // /api/valuation stayed PUBLIC. R1.5 made Nevada Market Intelligence a
    // private platform: company detail and its valuation data are family-office
    // information and are gated like everything else. The original intent — this
    // page's own auth posture is unchanged, it never authenticates itself — is
    // preserved below. See docs/security_access_control.md.
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/companies/SQM-B'), 'private_page')
    assert.equal(classifyPath('/api/valuation/SQM-B'), 'private_api')
    assert.ok(!/getCurrentUser|requireCurrentUser|supabase/.test(src), 'the page still relies on the shell gate')
  })

  it('reads no environment variable directly — a client page never touches process.env', () => {
    assert.ok(!src.includes('process.env'), 'server-only config belongs in a route handler, never in this client page')
    assert.ok(!/NEXT_PUBLIC_/.test(src))
  })
})

// ─── 2. Section preservation (all 7 content areas) ───────────────────────────

describe('Phase 5C — all seven content sections survive the re-skin', () => {
  it('1. breadcrumb — appears in both the found and not-found states', () => {
    assert.equal(count(src, 't.company.breadcrumb'), 2)
  })

  it('2. company header + KPI strip', () => {
    assert.match(src, /<SectionHeader/)
    assert.match(src, /tag=\{sym\}/)
    assert.match(src, /title=\{company\.name\}/)
    assert.match(src, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3/)
  })

  it('3. business summary / model / drivers / risks', () => {
    assert.match(src, /\{company\.businessSummary && \(/)
    assert.match(src, /\{\(company\.businessModel \|\| company\.keyRevenueDrivers \|\| company\.keyRisks\) && \(/)
  })

  it('4. price chart', () => {
    assert.match(src, /t\.company\.priceHistory/)
    assert.match(src, /<LineChart/)
  })

  it('5. recent results', () => {
    assert.match(src, /t\.company\.earnings/)
    assert.match(src, /<table/)
  })

  it('6. valuation', () => {
    assert.match(src, /t\.company\.valuation/)
    assert.match(src, /grid grid-cols-3 gap-2/)
  })

  it('7. recent news — the section itself is unconditional; only its body branches (see the repair test block below)', () => {
    assert.match(src, /t\.company\.recentNews/)
    assert.doesNotMatch(src, /\{news\.length > 0 && \(/, 'the whole News section must no longer be gated on having articles')
  })

  it('the seven sections appear in their original top-to-bottom order', () => {
    const order = [
      't.company.breadcrumb',
      '<SectionHeader',
      't.company.businessSummary',
      't.company.priceHistory',
      't.company.earnings',
      't.company.valuation',
      't.company.recentNews',
    ]
    const positions = order.map(marker => src.indexOf(marker))
    for (const p of positions) assert.ok(p > 0, 'every section marker must be present')
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'section order changed')
  })
})

// ─── 3. Header and actions ────────────────────────────────────────────────────

describe('Phase 5C — header and actions preserved', () => {
  it('shows the ticker and the company name', () => {
    assert.match(src, /tag=\{sym\}/)
    assert.match(src, /title=\{company\.name\}/)
    assert.match(src, /subtitle=\{`\$\{company\.sector\} · \$\{company\.industry\} · \$\{company\.exchange\}`\}/)
  })

  it('keeps the Print action calling window.print(), marked no-print', () => {
    assert.equal(count(src, 'window.print()'), 1)
    assert.equal(count(src, 'no-print'), 1)
    assert.match(src, /onClick=\{\(\) => window\.print\(\)\}[\s\S]{0,80}className="no-print/)
  })

  it('keeps the Watchlist link pointing at /watchlist with its original label', () => {
    assert.match(src, /href="\/watchlist"/)
    assert.match(src, /\{t\.company\.watchlistPill\}/)
  })

  // R11 supersedes the byte-exact form of these two derivations. The enduring
  // contract is what they must GUARANTEE, not the literal expression: the badge
  // and the as-of describe the price actually on screen. Both previously keyed
  // off `live` (the page-wide snapshot) while the price itself already fell
  // back per-ticker via `lv`, so a symbol missing from an otherwise-successful
  // snapshot rendered a persisted/static number under a "Live, as of <now>"
  // claim. They now gate on `lv` — this ticker's own quote.
  it('the badge is gated on THIS ticker’s own live quote, never the page-wide fetch', () => {
    assert.equal(count(src, '<MarketDataSourceBadge'), 1)
    assert.match(src, /const priceStatus: DataSourceStatus = lv \? 'live' : \(valuation\?\.marketDataStatus \?\? \(supaSnap \? 'persisted' : 'static'\)\)/)
    // The same variable that drives the displayed price drives the claim.
    assert.match(src, /const livePrice\s+= lv\?\.price/)
    assert.doesNotMatch(src, /priceStatus: DataSourceStatus = live \?/)
  })

  it('the as-of is gated the same way, so badge and timestamp can never disagree', () => {
    assert.match(src, /const priceAsOf = lv && live \? live\.lastUpdated : \(supaSnap\?\.lastUpdated \?\? null\)/)
    assert.match(src, /asOf=\{priceAsOf\}/)
  })

  it('keeps exactly one UpdateDataButton (the platform-wide convention)', () => {
    assert.equal(count(src, '<UpdateDataButton'), 1)
  })
})

// ─── 4. KPI preservation ──────────────────────────────────────────────────────

describe('Phase 5C — KPI preservation', () => {
  const KPI_KEYS = [
    't.company.kpis.lastPrice',
    't.company.kpis.dayChg',
    't.company.kpis.ytd',
    't.company.kpis.marketCap',
    't.company.kpis.divYield',
  ]

  it('all five non-branching KPI definitions remain (the fifth slot — P/E or P/B — is asserted separately, see the bank-KPI block below)', () => {
    for (const key of KPI_KEYS) assert.ok(src.includes(key), `${key} is missing`)
  })

  it('keeps them in their original order', () => {
    const positions = KPI_KEYS.map(k => src.indexOf(k))
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'KPI order changed')
  })

  it('the P/E-or-P/B ternary sits in the fifth slot, between Mkt Cap and Div Yield', () => {
    const mktCapPos = src.indexOf('t.company.kpis.marketCap')
    const ternaryPos = src.indexOf('isBank ? (')
    const divYieldPos = src.indexOf('t.company.kpis.divYield')
    assert.ok(mktCapPos > 0 && ternaryPos > mktCapPos && divYieldPos > ternaryPos, 'the bank-KPI ternary must render exactly where P/E used to sit')
  })

  it('renders exactly five KpiCapsule call sites in source (Last Price, Mkt Cap, the P/B branch, the P/E branch, Div Yield — only one of P/B/P/E renders for any given ticker at runtime)', () => {
    assert.equal(count(src, '<KpiCapsule'), 5)
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.lastPrice\}/)
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.marketCap\}/)
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.pb\} value=\{pbVal/)
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.pe\} value=\{peVal/)
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.divYield\}/)
  })

  it('Day Chg. and YTD remain as their own tiles, using ChangeIndicator', () => {
    assert.match(src, /<span className="ui-label text-muted-fg">\{t\.company\.kpis\.dayChg\}<\/span>\s*<ChangeIndicator value=\{liveDayPct \?\? null\}/)
    assert.match(src, /<span className="ui-label text-muted-fg">\{t\.company\.kpis\.ytd\}<\/span>\s*<ChangeIndicator value=\{ytdVal\}/)
  })

  it('ChangeIndicator drives every directional KPI/chart-change value on the page', () => {
    // Day Chg. tile, YTD tile, and the price-chart period-change badge.
    assert.equal(count(src, '<ChangeIndicator'), 3)
  })

  it('directional meaning is never color-only — ChangeIndicator itself always pairs a glyph with its color', () => {
    const ci = read('src/components/fable/ChangeIndicator.tsx')
    assert.match(ci, /aria-hidden="true">\{GLYPH\[direction\]\}<\/span>/)
    assert.match(ci, /style=\{\{ color: COLOR\[direction\] \}\}/)
    for (const glyph of ['▲', '▼']) assert.ok(ci.includes(glyph), `ChangeIndicator must still carry the ${glyph} glyph`)
  })

  it('unavailable KPI values are never coerced to zero', () => {
    assert.ok(!/\?\?\s*0\b/.test(src), 'a missing KPI value must never fall back to 0')
    assert.match(src, /livePrice != null \? `\$\{formatCLP\(livePrice\)\} CLP` : null/)
    assert.match(src, /mktCapVal != null \? formatMarketCapMM\(mktCapVal\) : null/)
    assert.match(src, /peVal != null \? `\$\{peVal\}x` : null/)
    assert.match(src, /pbVal != null \? `\$\{pbVal\}x` : null/)
    assert.match(src, /divVal != null \? `\$\{divVal\}%` : null/)
  })

  it('KpiCapsule itself renders an honest "Unavailable" word for a null value, never a fabricated number', () => {
    const kc = read('src/components/fable/KpiCapsule.tsx')
    assert.match(kc, /value === null\s*\n?\s*\? t\.fable\.kpi\.unavailable/)
  })
})

// ─── 4b. Bank KPI — P/B (or P/TBV) replaces P/E for banks only ───────────────

describe('Phase 5C repair — bank header KPI shows P/B instead of P/E', () => {
  it('identifies banks from the authoritative bank registry, never from company-name text', () => {
    assert.match(src, /import \{ isBankTicker \} from '@\/lib\/financials\/banks\/bankRegistry'/)
    assert.match(src, /const isBank = isBankTicker\(sym\)/)
    assert.doesNotMatch(src, /sym\.includes\('BANCO'\)|company\.name\.includes\('Banco'\)|\/banco\//i, 'bank status must never be inferred from a name string')
  })

  it('the bank registry itself identifies exactly the four bank tickers, with no RUT or name guessed', () => {
    const reg = read('src/lib/financials/banks/bankRegistry.ts')
    assert.match(reg, /export function isBankTicker/)
    for (const ticker of ['BSANTANDER', 'CHILE', 'BCI', 'ITAUCL']) {
      assert.match(reg, new RegExp(`${ticker}:\\s*\\{`))
    }
    assert.match(reg, /rut: null/, 'the registry documents that RUTs were never guessed')
  })

  it('P/B is precedence-first over P/E for banks; no P/TBV field exists anywhere to prefer instead (never fabricated to fill the precedence)', () => {
    assert.match(src, /const pbVal = lf\('pb'\)/, 'pb is the same live/derived field Compare and the Valuation grid already use')
    assert.doesNotMatch(src, /ptbv|tangibleBook/i, 'no P/TBV field is invented — none is sourced anywhere in the data model')
  })

  it('non-bank tickers keep P/E in the fifth KPI slot (SQM-B and every other non-bank ticker)', () => {
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.pe\} value=\{peVal != null \? `\$\{peVal\}x` : null\} \/>/)
  })

  it('bank tickers show P/B, formatted identically to the old P/E cell, never a zero-filled placeholder', () => {
    assert.match(src, /<KpiCapsule label=\{t\.company\.kpis\.pb\} value=\{pbVal != null \? `\$\{pbVal\}x` : null\} \/>/)
    assert.doesNotMatch(src, /pbVal \?\? 0/)
  })

  it('the six-KPI count and every other slot are unchanged by the bank branch', () => {
    // lastPrice, dayChg, ytd, marketCap, [pb|pe], divYield — still 6 tiles.
    assert.equal(count(src, 't.company.kpis.'), 7, 'lastPrice + dayChg + ytd + marketCap + pb + pe + divYield = 7 label references for 6 rendered slots (one slot branches)')
  })

  it('P/B has a real EN/ES label distinct from P/E, in the same kpis namespace as every other KPI label', () => {
    assert.match(i18n, /pb:\s*'P\/B'/)
    assert.match(i18n, /pb:\s*'P\/VL'/)
  })

  it('does not touch the detailed Valuation section\'s own P/B field — it already existed and is unchanged', () => {
    assert.match(src, /t\.company\.val\.pb/, 'the Valuation grid\'s own P/B tile (already existing before this repair) is untouched')
  })

  it('does not change the API contract, source precedence, or derivedFields gating used to compute pbVal', () => {
    assert.match(src, /vf && vf\.derivedFields\.includes\(key\) \? \(vf\[key\] \?\? null\) : null/, 'pbVal flows through the exact same lf() gate as every other fundamental — no bank-specific bypass')
  })
})

// ─── 5. Business-information preservation ────────────────────────────────────

describe('Phase 5C — business-information preservation', () => {
  it('keeps the business summary conditional and content untouched', () => {
    assert.match(src, /\{company\.businessSummary && \(/)
    assert.match(src, /\{company\.businessSummary\}<\/p>/)
  })

  it('keeps the business model, revenue drivers and risks conditionals untouched', () => {
    assert.match(src, /\{company\.businessModel && \(/)
    assert.match(src, /\{company\.keyRevenueDrivers && company\.keyRevenueDrivers\.length > 0 && \(/)
    assert.match(src, /\{company\.keyRisks && company\.keyRisks\.length > 0 && \(/)
  })

  it('renders drivers and risks as their original bulleted lists, from real company data only', () => {
    assert.match(src, /\{company\.keyRevenueDrivers\.map\(\(d, i\) => \(/)
    assert.match(src, /\{company\.keyRisks\.map\(\(r, i\) => \(/)
  })

  it('introduces no investment opinion, recommendation, or price target', () => {
    const forbidden = [
      /price target/i, /\brecommend(ation)?\b/i, /buy rating/i, /sell rating/i,
      /\boverweight\b/i, /\bunderweight\b/i, /\bhold rating\b/i, /expected return/i,
    ]
    for (const re of forbidden) assert.doesNotMatch(src, re, `business panels must not introduce ${re}`)
  })

  it('introduces no Fable sample company text', () => {
    assert.ok(!/lorem ipsum/i.test(src))
    assert.ok(!/sample compan(y|ies)/i.test(src))
  })
})

// ─── 6. Chart preservation ────────────────────────────────────────────────────

describe('Phase 5C — chart preservation', () => {
  it('the LineChart call keeps data/unit/height/valueFormatter/primaryLabel/markers exactly', () => {
    const start = src.indexOf('<LineChart')
    const end = src.indexOf('/>', start)
    const call = src.slice(start, end)
    assert.match(call, /data=\{chartData\}/)
    assert.match(call, /unit=""/)
    assert.match(call, /height=\{240\}/)
    assert.match(call, /valueFormatter=\{priceFmt\}/)
    assert.match(call, /primaryLabel=\{sym\}/)
    assert.match(call, /markers=\{markers\}/)
  })

  it('keeps every one of the eight original timeframe options, in order', () => {
    assert.match(src, /const STOCK_TIMEFRAMES: StockTimeframe\[\] = \['1D', '5D', '1M', 'MTD', 'YTD', '1Y', '3Y', '5Y'\]/)
  })

  it('keeps the cmi.chartTimeframe persistence key', () => {
    assert.match(src, /usePersistentState<StockTimeframe>\('cmi\.chartTimeframe', '1Y'\)/)
  })

  it('the timeframe control is the approved SegmentedControl, wired to the same state', () => {
    assert.match(src, /<SegmentedControl/)
    assert.match(src, /options=\{STOCK_TIMEFRAMES\.map\(tf => \(\{ value: tf, label: tf \}\)\)\}/)
    assert.match(src, /value=\{chartTimeframe\}/)
    assert.match(src, /onChange=\{setChartTimeframe\}/)
  })

  it('SegmentedControl is genuinely keyboard-operable (real component check, not just import presence)', () => {
    const sc = read('src/components/fable/SegmentedControl.tsx')
    assert.match(sc, /role="radiogroup"/)
    assert.match(sc, /role="radio"/)
    assert.match(sc, /onKeyDown=\{onKeyDown\}/)
    assert.match(sc, /ArrowRight.*ArrowDown/s)
  })

  it('the chart empty state is distinct from loading — AsyncState "empty", not a bare box', () => {
    assert.match(src, /stockHistory\.length >= 2 \? \(/)
    assert.match(src, /<AsyncState kind="empty" message=\{t\.common\.noData\} \/>/)
  })

  it('no chart series, benchmark, or calculation was added — periodChange formula and markers logic unchanged', () => {
    assert.match(src, /const periodChange = stockHistory\.length >= 2\s*\n\s*\? \(\(stockHistory\[stockHistory\.length - 1\]\.value - stockHistory\[0\]\.value\) \/ stockHistory\[0\]\.value\) \* 100\s*\n\s*: null/)
    assert.match(src, /const markers: ChartMarker\[\] = earningsCal\?\.status === 'live'/)
    assert.ok(!/compareData=/.test(src), 'no benchmark/IPSA series exists in this page\'s data — none may be invented')
  })
})

// ─── 7. Recent-results preservation ──────────────────────────────────────────

describe('Phase 5C — recent-results preservation', () => {
  const COLUMNS = [
    't.earnings.cols.period',
    't.earnings.currency',
    't.earnings.cols.revenue',
    't.earnings.cols.revenueYoy',
    't.earnings.cols.ebitda',
    't.earnings.cols.netIncome',
    't.earnings.cols.netIncomeYoy',
    't.earnings.cols.eps',
  ]

  it('all eight columns remain', () => {
    for (const col of COLUMNS) assert.ok(src.includes(col), `${col} is missing`)
  })

  it('columns keep their original order', () => {
    const positions = COLUMNS.map(c => src.indexOf(c))
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'Recent Results column order changed')
  })

  it('renders real reporting period, currency, and YoY figures per row — no static substitute', () => {
    assert.match(src, /\{e\.period\}/)
    assert.match(src, /\{e\.currency\}/)
    assert.match(src, /e\.revenueYoY != null \? formatPct\(e\.revenueYoY\) : '—'/)
    assert.match(src, /e\.netIncomeYoY != null \? formatPct\(e\.netIncomeYoY\) : '—'/)
  })

  it('unavailable figures render as "—", never as zero', () => {
    const fmtMM = src.match(/const fmtMM = \(v: number \| null\): string =>\s*\n\s*v == null \? '—'/)
    const fmtEps = src.match(/const fmtEps = \(v: number \| null\): string => \{\s*\n\s*if \(v == null\) return '—'/)
    assert.ok(fmtMM, 'fmtMM must still fall back to "—" for null')
    assert.ok(fmtEps, 'fmtEps must still fall back to "—" for null')
  })

  it('rows come from the live earnings-results resolver, never the fabricated static sample', () => {
    assert.match(src, /fetchEarningsResults/)
    assert.match(src, /earningsResults\?\.status === 'live'/)
    assert.doesNotMatch(src, /getEarningsByTicker/)
  })

  it('no editorial Clean/Mixed/Weak quality label or machinery exists', () => {
    assert.doesNotMatch(src, /resultQuality/)
    assert.doesNotMatch(src, /qualityVariant/)
    assert.doesNotMatch(src, /StatusPill/)
    assert.doesNotMatch(src, /'Clean'|'Mixed'|'Weak'/)
  })

  it('keeps the Recent Results source footer, with as-of gated on a genuinely live payload', () => {
    assert.match(src, /source=\{t\.stocks\.footer\} asOf=\{earningsResults\?\.status === 'live' \? \(earningsResults\.asOf \?\? null\) : null\}/)
  })
})

// ─── 8. Valuation preservation ────────────────────────────────────────────────

describe('Phase 5C — valuation preservation', () => {
  const METRICS = [
    't.company.val.peFwd', 't.company.val.psFwd', 't.company.val.evEbitda',
    't.company.val.opMargin', 't.company.val.grossMargin', 't.company.val.roe',
    't.company.val.fcfYield', 't.company.val.pb', 't.company.val.netDebtEbitda',
  ]

  it('all nine valuation metrics remain', () => {
    for (const m of METRICS) assert.ok(src.includes(m), `${m} is missing`)
  })

  it('keeps their original ordering', () => {
    const positions = METRICS.map(m => src.indexOf(m))
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'valuation metric order changed')
  })

  it('keeps the sector-median calculation and its display alongside every metric', () => {
    // Superseded in R12: the "med Xx" sublabels were computed from the frozen
    // Phase-2D synthetic ratio fields in stockPrices.json (peFwd/psFwd/roe/…),
    // which the twice-daily refresh never rewrites — fabricated peer context
    // rendered beside live Yahoo figures inside a card footed "Yahoo Finance".
    // Removed under the no-fabrication rule (the same class as the fake
    // quality pills and the "View Summary" column removed in earlier passes);
    // no live per-peer valuation source exists to recompute them honestly.
    // The enduring contract: the valuation tiles render ONLY live-resolved
    // figures.
    assert.ok(!src.includes('medStr('), 'the synthetic sector-median helper must not return')
    assert.ok(!src.includes('getAllSnapshots()'), 'no synthetic peer snapshots feed the valuation card')
    assert.match(src, /vf && vf\.derivedFields\.includes\(key\)/, 'tiles stay live-only')
  })

  it('keeps the measured-height pinning mechanism (ResizeObserver on the Valuation card)', () => {
    assert.match(src, /const valRef = useRef<HTMLDivElement>\(null\)/)
    assert.match(src, /const ro = new ResizeObserver\(update\)/)
    assert.match(src, /lg:h-\(--pin-h\)/)
    assert.doesNotMatch(src, /style=\{\{ height: valH/, 'must stay the CSS-var pin, never an inline fixed height')
  })

  it('keeps the "Graph fundamentals" deep-link into Charting, with the same event contract', () => {
    assert.match(src, /href="\/chart-builder"/)
    assert.match(src, /localStorage\.setItem\('cmi\.gfTicker', JSON\.stringify\(sym\)\)/)
    assert.match(src, /window\.dispatchEvent\(new CustomEvent\('gf:ticker', \{ detail: sym \}\)\)/)
    assert.equal(count(src, 'cmi.gfTicker'), 1)
    assert.equal(count(src, "'gf:ticker'"), 1)
  })

  it('keeps the Valuation source footer with no fabricated as-of', () => {
    assert.match(src, /<TableSourceFooter source=\{t\.stocks\.footer\} \/>/)
  })

  it('introduces no price target, expected return, or investment recommendation in the valuation grid', () => {
    const block = src.slice(src.indexOf('{/* Valuation'), src.indexOf('{/* Recent news'))
    for (const re of [/price target/i, /expected return/i, /\brecommend/i]) {
      assert.doesNotMatch(block, re)
    }
  })
})

// ─── 9. News preservation ─────────────────────────────────────────────────────

describe('Phase 5C — news preservation', () => {
  it('keeps the headline, linked to its real source URL', () => {
    assert.match(src, /\{item\.headline\}/)
    assert.match(src, /href=\{item\.sourceUrl\} target="_blank" rel="noopener noreferrer"/)
  })

  it('keeps the source-code chip and its color mapping', () => {
    assert.match(src, /getNewsSourceCode\(item\.source\)/)
    assert.match(src, /getNewsSourceColor\(item\.source\)/)
  })

  it('keeps the high-impact full-bleed treatment', () => {
    assert.match(src, /const isHigh = item\.impactLevel === 'High'/)
    assert.match(src, /backgroundColor: 'var\(--negative\)'/)
  })

  it('keeps the ticker-filtered, 4-item news query untouched', () => {
    assert.match(src, /const news\s+= \(newsResult\?\.data \?\? \[\]\)\.filter\(n => n\.affectedTickers\.includes\(sym\)\)\.slice\(0, 4\)/)
  })

  it('changes no news API or classification logic — same live fetch helper, same import path', () => {
    assert.match(src, /from '@\/lib\/data\/newsLive'/)
    assert.ok(!src.includes("from '@/lib/data/news'"), 'the static/fabricated news module must never be reintroduced')
    assert.match(src, /fetchLiveNews\(\)/)
  })
})

// ─── 9b. News section always renders (repair) ────────────────────────────────

describe('Phase 5C repair — News section is never omitted', () => {
  it('the News GlassSurface card and its heading render unconditionally, outside any news.length gate', () => {
    const start = src.indexOf('{/* Recent news')
    const end = src.indexOf('{newsState ?', start)
    assert.ok(start > 0 && end > start)
    const header = src.slice(start, end)
    // R11: `dense`, not `card` — the rule is that dense content (these are
    // 12px news rows) never sits on low-opacity glass, and Home's identical
    // news module already used the dense tier. The contract this test exists
    // for — the card and heading render unconditionally — is unchanged.
    assert.match(header, /<GlassSurface variant="dense" className="overflow-hidden">/)
    assert.match(header, /<span className="ui-label text-muted-fg">\{t\.company\.recentNews\}<\/span>/)
    assert.doesNotMatch(header, /news\.length/, 'the heading/card must not be gated on article count')
  })

  it('derives four distinct, honest states — loading, unavailable, empty, error — never collapsed into one generic panel', () => {
    assert.match(src, /const newsState: 'loading' \| 'unavailable' \| 'empty' \| 'error' \| null =/)
    assert.match(src, /newsFailed \? 'error'/)
    assert.match(src, /newsResult === null \? 'loading'/)
    assert.match(src, /newsResult\.status === 'unavailable' \? 'unavailable'/)
    assert.match(src, /news\.length === 0 \? 'empty'/)
  })

  it('renders the branching state through the shared AsyncState component, not a bespoke box', () => {
    assert.match(src, /\{newsState \? \(\s*<AsyncState/)
  })

  it('empty state reuses the existing localized "no news" copy (t.home.newsEmpty) — no new fabricated string, no static headline', () => {
    assert.match(src, /newsState === 'empty' \? t\.home\.newsEmpty/)
    assert.match(i18n, /newsEmpty:\s*'No news items available right now\.'/)
    assert.match(i18n, /newsEmpty:\s*'No hay noticias disponibles en este momento\.'/)
  })

  it('loading and unavailable states reuse the existing localized News copy, not new strings', () => {
    assert.match(src, /newsState === 'loading' \? t\.home\.newsLoading/)
    assert.match(src, /newsState === 'unavailable' \? t\.home\.newsUnavailable/)
  })

  it('a genuine fetch failure (not just an empty/unavailable payload) is tracked and mapped to the error state', () => {
    assert.match(src, /const \[newsFailed, setNewsFailed\] = useState\(false\)/)
    assert.match(src, /else setNewsFailed\(true\)/)
  })

  it('populated behaviour is preserved verbatim — the exact same item-rendering JSX, only reached when newsState is null', () => {
    const start = src.indexOf('{newsState ?')
    const populatedStart = src.indexOf(') : (', start)
    const block = src.slice(populatedStart, populatedStart + 1400)
    assert.match(block, /divide-y divide-border/)
    assert.match(block, /\{news\.map\(item => \{/)
    assert.match(block, /const isHigh = item\.impactLevel === 'High'/)
  })

  it('does not add a static headline or fabricate an article to fill the empty state', () => {
    assert.doesNotMatch(src, /headline:\s*['"`]/, 'no hand-written headline literal was introduced')
  })

  it('does not change the News API call shape or the fetch helper import', () => {
    assert.equal(count(src, 'fetchLiveNews('), 2, 'same two call sites as before (mount effect + doRefresh) — no new call added')
  })
})

// ─── 10. Source integrity ─────────────────────────────────────────────────────

describe('Phase 5C — source integrity', () => {
  it('keeps exactly one MarketDataSourceBadge', () => {
    assert.equal(count(src, '<MarketDataSourceBadge'), 1)
  })

  it('keeps exactly four TableSourceFooter instances', () => {
    assert.equal(count(src, '<TableSourceFooter'), 4)
  })

  it('keeps the live → persisted → static price precedence exactly', () => {
    assert.match(src, /const livePrice\s+= lv\?\.price\s+\?\? valuation\?\.latestPrice \?\? supaSnap\?\.price\s+\?\? snap\?\.price/)
    assert.match(src, /const liveDayPct = lv\?\.dayChangePct \?\? supaSnap\?\.dayChangePct \?\? snap\?\.dayChangePct/)
  })

  it('keeps the honest static-fallback chart source label, distinct from the live label', () => {
    assert.match(src, /source=\{chartStatus !== 'static' \? t\.stocks\.footer : t\.company\.stockChartSource\}/)
  })

  it('keeps the Recent Results honest empty/loading distinction (no data never silently becomes "0 results" with no explanation)', () => {
    // R11 strengthens this: the loading/empty split stays, and a THIRD state —
    // error — is now distinguished. Previously a failed fetch left the module
    // at "loading" forever, so a real failure was indistinguishable from a
    // request still in flight.
    assert.match(src, /kind=\{resultsFailed \? 'error' : earningsResults === null \? 'loading' : 'empty'\}/)
    assert.match(src, /message=\{resultsFailed \? undefined : earningsResults === null \? t\.common\.loading : t\.company\.noData\}/)
  })

  it('the source badge is rendered visibly in the header actions, never hidden solely behind a tooltip', () => {
    const actionsStart = src.indexOf('actions={')
    const actionsBlock = src.slice(actionsStart, actionsStart + 900)
    assert.ok(actionsBlock.includes('<MarketDataSourceBadge'), 'the badge sits in the always-visible actions row')
  })

  it('the badge component itself surfaces its status word as visible text, with the provider detail only in the title tooltip', () => {
    const badge = read('src/components/ui/MarketDataSourceBadge.tsx')
    assert.match(badge, /title=\{title\}/, 'provider detail belongs in the hover tooltip')
    assert.match(badge, /\{label\}\s*<\/span>/, 'the status word itself must render as visible JSX text, not only inside the title attribute')
  })
})

// ─── 10b. KPI source metadata stays in normal document flow (repair) ────────

describe('Phase 5C repair — KPI source/as-of line no longer overlaps the KPI grid', () => {
  it('the KPI-strip TableSourceFooter carries no negative margin', () => {
    assert.doesNotMatch(src, /-mt-2/, 'a negative top margin pulled the footer up into the KPI cards')
    assert.match(src, /<TableSourceFooter source=\{t\.stocks\.footer\} asOf=\{priceAsOf\} className="mt-2" \/>/)
  })

  it('no KPI-area element uses absolute positioning', () => {
    const start = src.indexOf('{/* KPI strip */}')
    const end = src.indexOf('{/* Business summary */}')
    const block = src.slice(start, end)
    assert.doesNotMatch(block, /\babsolute\b/, 'the KPI strip and its source line must stay in normal document flow')
  })

  it('the footer sits as a normal-flow sibling immediately after the KPI grid, inside the same Reveal wrapper', () => {
    const start = src.indexOf('{/* KPI strip */}')
    const gridEnd = src.indexOf('</div>', src.indexOf('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'))
    const footerPos = src.indexOf('<TableSourceFooter source={t.stocks.footer} asOf={priceAsOf}')
    assert.ok(start > 0 && gridEnd > start && footerPos > gridEnd, 'the footer must render after the KPI grid closes, not overlapping it')
  })

  it('preserves the exact provider label and as-of derivation (R11: now per-ticker)', () => {
    assert.match(src, /source=\{t\.stocks\.footer\}/)
    assert.match(src, /const priceAsOf = lv && live \? live\.lastUpdated : \(supaSnap\?\.lastUpdated \?\? null\)/)
  })

  it('preserves tabular numerals on every KPI value (KpiCapsule/ChangeIndicator already carry ui-number/ui-capsule-value styling)', () => {
    const kc = read('src/components/fable/KpiCapsule.tsx')
    assert.match(kc, /ui-capsule-value/)
    const ci = read('src/components/fable/ChangeIndicator.tsx')
    assert.match(ci, /ui-number/)
  })

  it('the disclosure remains visible in print — no .no-print class was added to it or its wrapper', () => {
    const start = src.indexOf('{/* KPI strip */}')
    const end = src.indexOf('{/* Business summary */}')
    assert.doesNotMatch(src.slice(start, end), /no-print/)
  })
})

// ─── 11. Fable implementation ──────────────────────────────────────────────────

describe('Phase 5C — Fable visual language applied via shared primitives', () => {
  it('uses KpiCapsule, GlassSurface, ChangeIndicator, SegmentedControl, AsyncState and Reveal', () => {
    assert.match(src, /from '@\/components\/fable\/GlassSurface'/)
    assert.match(src, /from '@\/components\/fable\/KpiCapsule'/)
    assert.match(src, /from '@\/components\/fable\/ChangeIndicator'/)
    assert.match(src, /from '@\/components\/fable\/AsyncState'/)
    assert.match(src, /from '@\/components\/fable\/SegmentedControl'/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
    assert.ok(count(src, '<GlassSurface') > 0)
    assert.ok(count(src, '<KpiCapsule') > 0)
    assert.ok(count(src, '<ChangeIndicator') > 0)
    assert.ok(count(src, '<AsyncState') > 0)
    assert.ok(count(src, '<SegmentedControl') > 0)
    assert.ok(count(src, '<Reveal') > 0)
  })

  it('uses exactly twelve GlassSurface material instances (every card, its dense inner region, and the two KPI change tiles)', () => {
    assert.equal(count(src, '<GlassSurface'), 12)
  })

  it('uses semantic Nevada tokens for internal card dividers and dense-cell radii', () => {
    assert.match(src, /var\(--nv-chip\)/)
    assert.match(src, /var\(--nv-chipbd\)/)
    assert.match(src, /var\(--nv-line\)/)
    assert.match(src, /var\(--radius-cell\)/)
  })

  it('introduces no new hardcoded hex color — the only hex present is the three pre-existing news high-impact "#fff" values', () => {
    const hexMatches = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    assert.equal(hexMatches.length, 3, 'hex-color count changed — a new hardcoded color may have been introduced')
    for (const m of hexMatches) assert.equal(m, '#fff', `unexpected hex color ${m}`)
  })

  it('introduces no raw gray/slate/zinc or other raw Tailwind color-scale class', () => {
    assert.doesNotMatch(
      src,
      /\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    )
  })

  it('never applies backdrop-filter directly in the page — dense areas rely on GlassSurface\'s near-opaque "dense" tier, not per-row/per-cell blur', () => {
    assert.doesNotMatch(src, /backdrop-filter/)
    const glass = read('src/components/fable/GlassSurface.tsx')
    assert.match(glass, /dense: 'nv-surface-dense'/)
    const css = read('src/app/globals.css')
    const denseBlock = css.slice(css.indexOf('.nv-surface-dense'), css.indexOf('.nv-surface-dense') + 300)
    assert.doesNotMatch(denseBlock, /backdrop-filter/, 'the dense tier must stay blur-free per design_principles §8')
  })

  it('never animates a high-frequency market value (no count-up on price/KPI figures)', () => {
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('ValueChangeTransition'))
  })

  it('uses no purple anywhere on this route (reserved for the Review token)', () => {
    assert.ok(!/--chart-review|--review\b/.test(src))
  })
})

// ─── 12. Accessibility ─────────────────────────────────────────────────────────

describe('Phase 5C — accessibility', () => {
  it('keeps a meaningful heading hierarchy via SectionHeader\'s <h1>', () => {
    const sh = read('src/components/ui/SectionHeader.tsx')
    assert.match(sh, /<h1 className="text-xl font-semibold text-foreground leading-snug">\{title\}<\/h1>/)
    assert.match(src, /<SectionHeader/)
  })

  it('Print and Watchlist controls carry real visible text, not icon-only affordances', () => {
    assert.match(src, /<span aria-hidden>⎙<\/span>\{t\.common\.print\}/)
    assert.match(src, /\{t\.company\.watchlistPill\}\s*<\/Link>/)
  })

  it('directional KPI/chart changes always print a signed label alongside color (never color alone)', () => {
    assert.match(src, /label=\{liveDayPct != null \? formatPct\(liveDayPct\) : undefined\}/)
    assert.match(src, /label=\{ytdVal != null \? formatPct\(ytdVal\) : undefined\}/)
    assert.match(src, /label=\{`\$\{formatPct\(periodChange\)\} \$\{chartTimeframe\}`\}/)
  })

  it('the chart timeframe control is keyboard-operable as a real radiogroup (re-verified at the page call site)', () => {
    assert.match(src, /<SegmentedControl\s*\n\s*options=\{STOCK_TIMEFRAMES/)
    assert.match(src, /ariaLabel=\{t\.company\.chartTimeframeLabel\}/)
  })

  it('empty/loading/unavailable states stay accessible — AsyncState announces itself politely', () => {
    const as = read('src/components/fable/AsyncState.tsx')
    assert.match(as, /role=\{kind === 'error' \? 'alert' : 'status'\}/)
    assert.match(as, /aria-live="polite"/)
  })

  it('reduced motion leaves every Reveal-wrapped section visible immediately', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── 13. Responsive behavior ───────────────────────────────────────────────────

describe('Phase 5C — responsive behavior', () => {
  it('introduces no root min-width', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /html\s*\{[^}]*min-width/s)
  })

  it('keeps the full-width page container with no fixed page width', () => {
    assert.match(src, /<div className="w-full space-y-4">/)
    assert.ok(!src.includes('max-w-screen-xl'))
    assert.ok(!/width:\s*\d+px/.test(src), 'no fixed pixel width introduced on a layout container')
  })

  it('the price chart lets its container drive width — no fixed pixel width passed to LineChart', () => {
    const start = src.indexOf('<LineChart')
    const end = src.indexOf('/>', start)
    assert.doesNotMatch(src.slice(start, end), /width=\{?\d/, 'LineChart must stay responsive via its own ResizeObserver, not a hardcoded width')
  })

  it('Recent Results contains its own horizontal overflow, scoped to the dense table only', () => {
    assert.equal(count(src, 'overflow-x-auto'), 1)
    assert.match(src, /min-w-\[520px\]/)
  })

  it('the Valuation dense area has no horizontal overflow of its own (a 3-col grid never needs it) but still sits on the dense surface', () => {
    const valStart = src.indexOf('{/* Valuation')
    const block = src.slice(valStart, valStart + 1800)
    assert.match(block, /<GlassSurface variant="dense"/)
  })

  it('header actions and the chart header/footer rows wrap instead of forcing page-level overflow', () => {
    assert.match(src, /flex items-start justify-between mb-3 gap-3 flex-wrap/)
    assert.match(src, /flex items-center justify-between mt-2 gap-3 flex-wrap/)
    assert.equal(count(src, 'flex-wrap'), 2)
  })

  it('the company route is covered by the shared responsive-layout regression suite', () => {
    const responsiveTest = read('tests/responsiveLayout.test.ts')
    assert.ok(responsiveTest.includes('src/app/companies/[ticker]/page.tsx'), 'responsiveLayout.test.ts must still assert on this route')
    assert.ok(responsiveTest.includes('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'))
    assert.ok(responsiveTest.includes('lg:h-\\(--pin-h\\)'), 'responsiveLayout.test.ts keeps its pin-height regex assertion for this route')
  })
})

// ─── 14. Localization ──────────────────────────────────────────────────────────

describe('Phase 5C — localization', () => {
  it('the new chartTimeframeLabel string exists in both dictionaries', () => {
    assert.equal(count(i18n, 'chartTimeframeLabel:'), 2, 'chartTimeframeLabel must be present in dict.en.company and dict.es.company')
    assert.match(i18n, /chartTimeframeLabel: 'Chart timeframe'/)
    assert.match(i18n, /chartTimeframeLabel: 'Periodo del gráfico'/)
  })

  it('dict.en.company and dict.es.company carry the exact same key set, recursively (fills a pre-existing coverage gap)', () => {
    const keysOf = (obj: unknown, prefix = ''): string[] =>
      Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        v !== null && typeof v === 'object' && !Array.isArray(v)
          ? keysOf(v, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      )
    const en = keysOf(dict.en.company).sort()
    const es = keysOf(dict.es.company).sort()
    assert.deepEqual(en, es, 'dict.en.company and dict.es.company key sets diverge')
  })

  it('no unlocalized visible English literal was added — the only literal JSX text is the pre-existing "EEFF" filing-type code', () => {
    const literals = src.match(/>[A-Za-z][A-Za-z .,'()/-]{3,}</g) ?? []
    assert.deepEqual(literals, ['>EEFF<'], `unexpected literal(s): ${literals.join(' | ')}`)
  })

  it('company names and financial figures are never routed through translation — they render verbatim from data', () => {
    assert.match(src, /\{company\.name\}/)
    assert.ok(!/t\.company\.name/.test(src), 'a company name must never be looked up in the dictionary')
  })
})

// ─── 15. Integrity boundaries ──────────────────────────────────────────────────

describe('Phase 5C — integrity boundaries', () => {
  it('no Fable sample company data was introduced', () => {
    // Uppercase, word-bounded: this file's own comments legitimately use the
    // lowercase prose "...never the fabricated static sample" to describe
    // what is NOT used — a case-insensitive scan would false-positive on
    // that honest documentation. A real fabricated-data constant would be an
    // uppercase identifier (SAMPLE_DATA, MOCK_COMPANY, …), which this catches.
    assert.ok(!/\bSAMPLE\b|\bMOCK\b|\bDEMO\b/.test(src))
  })

  it('no fabricated earnings quarter source remains reachable from this page', () => {
    assert.doesNotMatch(src, /getEarningsByTicker/)
    assert.ok(!existsSync(join(ROOT, 'src/lib/data/earnings.ts')), 'the fabricated static earnings accessor stays deleted')
  })

  it('no editorial quality pill exists anywhere on the page', () => {
    assert.doesNotMatch(src, /resultQuality/)
    assert.doesNotMatch(src, /qualityVariant/)
    assert.doesNotMatch(src, /StatusPill/)
  })

  it('no API path was altered — every fetch helper import matches its pre-existing module', () => {
    assert.match(src, /from '@\/lib\/data\/valuation'/)
    assert.match(src, /from '@\/lib\/data\/earningsResults'/)
    assert.match(src, /from '@\/lib\/data\/earningsCalendar'/)
    assert.match(src, /from '@\/lib\/data\/marketData'/)
    assert.match(src, /from '@\/lib\/data\/newsLive'/)
  })

  it('no financial or valuation calculation was altered on this page — the sector-median and derived-field math is untouched', () => {
    assert.match(src, /const r1 = \(n: number \| null \| undefined\) => \(n == null \? null : Math\.round\(n \* 10\) \/ 10\)/)
    assert.match(src, /const xMult = \(n: number \| null \| undefined\) => \{ const v = r1\(n\); return v != null \? `\$\{v\}x` : '—' \}/)
    assert.match(src, /const pctVal = \(n: number \| null \| undefined\) => \{ const v = r1\(n\); return v != null \? `\$\{v\}%` : '—' \}/)
    assert.match(src, /vf && vf\.derivedFields\.includes\(key\) \? \(vf\[key\] \?\? null\) : null/)
  })

  it('no source-precedence order was altered', () => {
    assert.match(src, /lv\?\.price\s+\?\? valuation\?\.latestPrice \?\? supaSnap\?\.price\s+\?\? snap\?\.price/)
  })

  it('no unrelated page migration occurred alongside this phase', () => {
    // `/compare` was removed from this list in Phase 5D and `/macro` in
    // Phase 5F (each its own, later brief) — see the scope-held guard above
    // for the same boundary note.
    for (const other of ['src/app/earnings/page.tsx']) {
      assert.ok(!read(other).includes("from '@/components/fable/GlassSurface'"), `${other} is out of scope for Phase 5C`)
    }
  })
})

// ─── 16. Navigation shell — Settings visibility (repair) ─────────────────────
//
// A narrow shared-shell defect repair (PrimaryNav.tsx + TopBar.tsx spacing
// only) — not a shell redesign. Every item, order, and behaviour asserted by
// tests/topNavigation.test.ts and tests/responsiveLayout.test.ts continues to
// pass unmodified; these tests add the specific "Settings is reachable and
// unclipped" guarantee.

describe('Phase 5C repair — Settings is not hidden or truncated in the top nav', () => {
  const navSrc = read('src/components/layout/PrimaryNav.tsx')
  const topBarSrc = read('src/components/layout/TopBar.tsx')
  const navModule = read('src/lib/navigation.ts')

  it('every primary-nav item and its order are unchanged (still sourced from navGroups, nothing hardcoded)', () => {
    // AMENDED by POST-R13.6CDE: rendered from `visibleNavGroups(access)`, i.e.
    // `navGroups` filtered by module. The group ORDER and MEMBERSHIP asserted
    // below are the property this case protects, and they are unchanged.
    assert.match(navSrc, /\{groups\.map\(\(group\) => \{/)
    assert.match(navSrc, /visibleNavGroups\(access\)/)
    // POST-R13.6CDE inserted an optional `module:` line between `key` and
    // `href`; the ORDER and MEMBERSHIP this case protects are unchanged.
    const keys = [...navModule.matchAll(/key:\s*'(\w+)',\n(?:\s*module:[^\n]*\n)?\s*href:/g)].map(m => m[1])
    assert.deepEqual(keys, ['overview', 'markets', 'analysis', 'macro', 'earnings', 'portfolio', 'structuredNotes', 'settings'], 'group order/membership must be exactly as before — Settings stays last, nothing removed or reordered')
  })

  it('Settings keeps its real label and href — never hidden, never icon-only', () => {
    // R9.2 — href repointed to the canonical /settings. The property this case
    // protects (Settings keeps a real label and href, never hidden, never
    // icon-only) is unchanged; only the destination moved.
    assert.match(navModule, /key:\s*'settings',\s*\n\s*href:\s*'\/settings',\s*\n\s*icon:\s*'settings',\s*\n\s*label:\s*\(t\) => t\.nav\.settings,/)
    assert.doesNotMatch(navSrc, /settings.*display:\s*none|settings.*hidden/i, 'Settings must never be conditionally hidden')
  })

  it('pills never truncate their text — no truncate/overflow-ellipsis class on a nav item', () => {
    assert.doesNotMatch(navSrc, /\btruncate\b/)
    assert.match(navSrc, /whitespace-nowrap/, 'labels stay on one line and simply take the width they need')
  })

  it('the rail reserves real trailing padding so the last pill (Settings) never sits flush against the clipping edge', () => {
    assert.match(navSrc, /pr-2\.5/, 'trailing padding on the scrollable rail container')
    assert.doesNotMatch(navSrc, /\bpx-1 py-1\b.*overflow-x-auto/, 'the old symmetric 4px padding (no reserved trailing space) is gone')
  })

  it('padding was tightened, not scrolling removed — internal horizontal scroll is still the documented fallback', () => {
    assert.match(navSrc, /px-3 py-1\.5/, 'pill padding tightened from the old px-3.5')
    assert.match(navSrc, /overflow-x-auto nv-scrollbar-hidden/, 'still scrolls internally to the pill — never page-level overflow')
  })

  it('preserves active-route behavior — aria-current and the measured sliding indicator are untouched', () => {
    assert.match(navSrc, /aria-current=\{active \? 'page' : undefined\}/)
    assert.match(navSrc, /useNavIndicator\(\s*activeGroup\?\.key \?\? null/)
  })

  it('preserves keyboard reachability — every pill is a real, focusable <Link>, not a div', () => {
    assert.match(navSrc, /<Link\s*\n\s*key=\{group\.key\}\s*\n\s*href=\{group\.href\}/)
  })

  it('no page-level horizontal overflow is introduced — the rail keeps its own scroll container, root min-width still absent', () => {
    assert.match(navSrc, /overflow-x-auto/)
    assert.doesNotMatch(read('src/app/globals.css'), /html\s*\{[^}]*min-width/s)
  })

  it('reclaims room via existing responsive priority (tightened gaps), not by removing a TopBar control', () => {
    for (const control of ['NotificationBell', 'LangToggle', 'ThemeToggle', "cmdk:open", 't.auth.signOut', 't.auth.signIn']) {
      assert.ok(topBarSrc.includes(control), `${control} must remain in TopBar`)
    }
    assert.match(topBarSrc, /gap-1\.5 sm:gap-3/, 'header gap tightened')
    assert.match(topBarSrc, /gap-1 sm:gap-2 shrink-0 ml-auto/, 'right-cluster gap tightened')
  })

  it('the ⌘K keyboard hint hides earlier (xl) to free width for the rail — the Search label/button itself is never removed', () => {
    assert.match(topBarSrc, /<kbd className="border border-border rounded px-1\.5 text-xs hidden xl:inline">⌘K<\/kbd>/)
    assert.match(topBarSrc, /title=\{t\.common\.search\}/)
  })

  it('verified on /stocks, /watchlist, and /companies/[ticker] — all three mount the same single TopBar/PrimaryNav via AppShell, so the fix applies uniformly', () => {
    for (const page of ['src/app/stocks/page.tsx', 'src/app/watchlist/page.tsx', 'src/app/companies/[ticker]/page.tsx']) {
      assert.ok(!read(page).includes('<PrimaryNav'), `${page} must not mount its own nav — it inherits the shared shell`)
    }
    assert.match(read('src/components/layout/AppShell.tsx'), /<TopBar \/>/)
  })
})

// ─── 17. SONDA historical-price diagnosis (repair — verified no code defect) ─
//
// Diagnosis (see the diagnostic report): TICKER_YF['SONDA'] is correct, and a
// direct Yahoo Finance probe (bypassing the app) returned 249 real daily bars
// for SONDA.SN. The local "No data available" is the honest, correct result
// of MARKET_DATA_MODE defaulting to 'static' with no env vars set (by design)
// combined with a static seed file that only ever covered 9 of 25 tickers —
// not a SONDA-specific bug, and not fixable without seeding data or touching
// env files, both explicitly out of scope. These tests lock in the verified
// facts so a future change can't silently break the real, working live path.

describe('Phase 5C repair — SONDA historical-price mapping (verified correct, no code change)', () => {
  it('SONDA has a correct, real Yahoo Finance symbol mapping', () => {
    const overlay = read('src/lib/market/liveOverlay.ts')
    assert.match(overlay, /'SONDA':\s*'SONDA\.SN'/)
  })

  it('the live history provider resolves SONDA through the same TICKER_YF map every other ticker uses — no special-cased branch', () => {
    const provider = read('src/lib/providers/market/yahooHistoryProvider.ts')
    assert.match(provider, /function yahooSymbolFor\(ticker: string\): string \| null \{\s*\n\s*return TICKER_YF\[ticker\] \?\? \(ticker === 'IPSA' \? INDEX_YF\.ipsa : null\) \?\? null/)
    assert.doesNotMatch(provider, /SONDA/, 'no SONDA-specific branch was added — the general mapping already works')
  })

  it('resolveStockHistory still tries live Yahoo history before any static fallback, for every ticker alike', () => {
    const marketProvider = read('src/lib/providers/market/marketProvider.ts')
    assert.match(marketProvider, /const liveHistory = await getYahooStockHistory\(ticker, timeframe\)/)
  })

  it('no historical prices were seeded, copied, or hand-written into the static data file for SONDA', () => {
    const stockHistory = JSON.parse(read('src/data/stockHistory.json')) as Array<{ ticker: string }>
    const tickers = new Set(stockHistory.map(r => r.ticker))
    assert.ok(!tickers.has('SONDA'), 'SONDA must not appear in the static seed — adding it would be exactly the forbidden hand-seeding')
  })

  it('every other ticker\'s static/live wiring is unchanged by this diagnosis', () => {
    const overlay = read('src/lib/market/liveOverlay.ts')
    for (const [ticker, symbol] of [['SQM-B', 'SQM-B.SN'], ['BSANTANDER', 'BSANTANDER.SN'], ['CHILE', 'CHILE.SN'], ['ENTEL', 'ENTEL.SN']]) {
      assert.match(overlay, new RegExp(`'${ticker}':\\s*'${symbol.replace('.', '\\.')}'`), `${ticker} mapping must be untouched`)
    }
  })

  // NOTE: this originally read .env.local directly, which was mis-scoped —
  // .env.local is a gitignored, developer-owned file, so the test failed as
  // soon as an operator legitimately configured MARKET_DATA_MODE (exactly the
  // correct action for enabling live history). The real intent is "this repair
  // did not change how the mode is configured", which is verifiable from the
  // repository alone.
  it('MARKET_DATA_MODE / environment files were not touched by this repair', () => {
    // Env files can never enter the repo, so no repair can have changed one.
    const gitignore = read('.gitignore')
    assert.match(gitignore, /^\.env\*$/m, '.env* must stay gitignored')
    assert.match(gitignore, /^!\.env\.example$/m, 'only the example template is tracked')
    // The mode is read from the environment and never forced in code.
    for (const rel of [
      'src/lib/providers/market/marketDataMode.ts',
      'src/lib/providers/market/marketProvider.ts',
      'src/app/companies/[ticker]/page.tsx',
    ]) {
      assert.doesNotMatch(read(rel), /process\.env\.MARKET_DATA_MODE\s*=/, `${rel} must never assign MARKET_DATA_MODE`)
    }
    // The example template still documents the setting for operators.
    assert.match(read('.env.example'), /MARKET_DATA_MODE=/)
  })

  it('the company page still routes history through the unmodified client helper — no direct Yahoo call from the page itself', () => {
    assert.match(src, /fetchStockHistory\(sym, chartTimeframe\)/)
    assert.doesNotMatch(src, /yahoo-finance2/i, 'the page never imports the Yahoo SDK directly — only the server route does')
  })

  it('the chart empty state remains the same honest AsyncState — not silently replaced with a fabricated series', () => {
    assert.match(src, /<AsyncState kind="empty" message=\{t\.common\.noData\} \/>/)
  })
})
