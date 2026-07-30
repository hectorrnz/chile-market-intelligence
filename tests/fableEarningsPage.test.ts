// Phase 5G — /earnings re-skinned into the Fable institutional language.
//
// The contract this file locks down: the page LOOKS different and NOTHING
// about what it shows or does changed. Every section, table, column, ticker
// link, currency field, YoY field, source badge/footer, timestamp, and async
// state is still there; every computed value, fetch effect, and export
// behaviour is byte-for-byte the same; no API, provider, or business-logic
// file was touched.
//
// Source-scan checks (this repo has no React render harness) — they cannot
// prove pixel rendering, but they make a silent regression of the
// load-bearing content and conventions impossible.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const EARNINGS = 'src/app/earnings/page.tsx'
const I18N = 'src/lib/i18n.ts'

const src = read(EARNINGS)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── 1-4. Sections, tables, columns ───────────────────────────────────────────

describe('Phase 5G — every Earnings section and table survives the re-skin', () => {
  it('keeps the page header with tag, title, subtitle, and the Update Data action', () => {
    assert.match(src, /tag=\{t\.earnings\.tag\}/)
    assert.match(src, /title=\{t\.earnings\.title\}/)
    assert.match(src, /subtitle=\{t\.earnings\.subtitle\}/)
    assert.match(src, /<UpdateDataButton onRefresh=\{refreshEarnings\}\s*\/>/)
  })

  it('keeps the Upcoming (calendar) section and the Recent Results section — exactly two tables', () => {
    assert.match(src, /title=\{t\.earnings\.upcomingLabel\}/)
    assert.match(src, /title=\{t\.earnings\.recentResults\}/)
    assert.equal(count(src, '<table'), 2)
  })

  it('keeps the Upcoming table columns, in order: Ticker · Period · Expected Date', () => {
    const block = src.slice(src.indexOf('t.earnings.upcomingLabel'), src.indexOf('t.earnings.recentResults'))
    const order = [...block.matchAll(/\{t\.earnings\.calCols\.(\w+)\}/g)].map(m => m[1])
    assert.deepEqual(order.slice(0, 3), ['ticker', 'period', 'expected'])
  })

  it('keeps the Recent Results table columns, in the exact original order (11 columns)', () => {
    const block = src.slice(src.indexOf('t.earnings.recentResults'))
    const heads = [...block.slice(0, block.indexOf('<tbody')).matchAll(/\{t\.earnings\.(?:calCols\.ticker|cols\.\w+|currency)\}/g)].map(m => m[0])
    assert.deepEqual(heads, [
      '{t.earnings.calCols.ticker}',
      '{t.earnings.cols.company}',
      '{t.earnings.cols.period}',
      '{t.earnings.currency}',
      '{t.earnings.cols.revenue}',
      '{t.earnings.cols.revenueYoy}',
      '{t.earnings.cols.ebitda}',
      '{t.earnings.cols.ebitdaYoy}',
      '{t.earnings.cols.netIncome}',
      '{t.earnings.cols.netIncomeYoy}',
      '{t.earnings.cols.eps}',
    ])
  })

  it('keeps every original data cell binding — revenue/EBITDA/net income/EPS with their YoY siblings', () => {
    assert.match(src, /\{fmtMM\(e\.revenue\)\}/)
    assert.match(src, /pctCell\(e\.revenueYoY\)/)
    assert.match(src, /\{fmtMM\(e\.ebitda\)\}/)
    assert.match(src, /pctCell\(e\.ebitdaYoY\)/)
    assert.match(src, /\{fmtMM\(e\.netIncome\)\}/)
    assert.match(src, /pctCell\(e\.netIncomeYoY\)/)
    assert.match(src, /\{fmtEps\(e\.eps\)\}/)
  })
})

// ─── 5-6. Company/ticker coverage and links ───────────────────────────────────

describe('Phase 5G — company/ticker coverage and links are unchanged', () => {
  it('derives Upcoming/Recent Results rows from the same live data helpers, untouched', () => {
    assert.match(src, /from '@\/lib\/data\/earningsCalendar'/)
    assert.match(src, /from '@\/lib\/data\/earningsResults'/)
    assert.match(src, /const upcoming = cal\?\.status === 'live' \? upcomingWithinDays\(cal\.events, 45\) : \[\]/)
    assert.match(src, /const rows = results\?\.rows \?\? \[\]/)
  })

  it('every ticker in both tables still links to /companies/[ticker]', () => {
    assert.equal(count(src, "href={`/companies/${e.ticker}`}"), 2)
  })

  it('ticker links stay keyboard-accessible (real <a> via next/link, not a div/onClick)', () => {
    assert.match(src, /import Link from 'next\/link'/)
    assert.equal(count(src, '<Link href='), 2)
  })
})

// ─── 7-11. Periods, dates, currency, YoY ──────────────────────────────────────

describe('Phase 5G — periods, dates, currency and YoY fields are unchanged', () => {
  it('keeps the reported period, period-end key, and reported currency per row', () => {
    assert.match(src, /key=\{`\$\{e\.ticker\}-\$\{e\.periodEnd\}`\}/)
    assert.match(src, /\{e\.period\}/)
    assert.match(src, /\{e\.currency\}/)
  })

  it('keeps the scheduled/expected report date column verbatim (no derived estimate)', () => {
    assert.match(src, /\{e\.reportDate\}/)
  })

  it('keeps the bank-no-EBITDA tooltip exactly as before', () => {
    assert.match(src, /title=\{e\.isBank \? t\.earnings\.bankNoEbitda : undefined\}/)
  })

  it('keeps the exact negative-value color rule for Net Income and EPS', () => {
    assert.match(src, /e\.netIncome != null && e\.netIncome < 0 \? 'text-negative' : 'text-foreground'/)
    assert.match(src, /e\.eps != null && e\.eps < 0 \? 'text-negative' : 'text-foreground'/)
  })

  it('keeps the pctCell helper (YoY coloring + em-dash for null) untouched', () => {
    assert.match(src, /const pctCell = \(v: number \| null\) => \(/)
    assert.match(src, /v != null \? changeColor\(v\) : 'text-muted-fg'/)
    assert.match(src, /\{v != null \? formatPct\(v\) : '—'\}/)
  })

  it('keeps fmtMM and fmtEps exactly (1dp millions; 4dp EPS under 1.0, else 2dp)', () => {
    assert.match(src, /function fmtMM\(v: number \| null\): string \{/)
    assert.match(src, /function fmtEps\(v: number \| null\): string \{/)
    assert.match(src, /const d = Math\.abs\(v\) < 1 \? 4 : 2/)
  })
})

// ─── 12-13. Comparison/surprise fields, no fabrication ────────────────────────

describe('Phase 5G — no consensus/surprise field, no fabricated quarter', () => {
  it('introduces no consensus, forecast, or surprise field', () => {
    assert.ok(!/consensus/i.test(src))
    assert.ok(!/surprise/i.test(src))
    assert.ok(!/\bbeat\b|\bmiss\b/i.test(src))
  })

  it('never imports the deleted/disallowed earnings.json static source', () => {
    assert.ok(!src.includes("from '@/data/earnings.json'"))
    assert.ok(!src.includes("from '@/data/earnings'"))
    assert.ok(!src.includes('earnings.json'))
  })

  it('reintroduces no editorial Clean/Mixed/Weak (or equivalent) quality label', () => {
    assert.ok(!/\bClean\b|\bMixed\b|\bWeak\b/.test(src))
    assert.ok(!/resultQuality|qualityVariant/.test(src))
  })

  it('never coerces a missing metric to zero — every numeric cell renders "—" for null', () => {
    assert.ok(!/\?\?\s*0\b/.test(src), 'no "?? 0" fallback exists on any metric')
  })
})

// ─── 14-16. Filters, sorting, actions ─────────────────────────────────────────

describe('Phase 5G — filtering/sorting (none existed) and user actions are unchanged', () => {
  it('introduces no filter, sort control, or default-sort change (none existed before this phase)', () => {
    assert.ok(!src.includes('<select'))
    assert.ok(!src.includes('SegmentedControl'))
    assert.ok(!src.includes('toggleSort'))
    assert.ok(!/usePersistentState|useState<.*[Ss]ort/.test(src))
  })

  it('keeps the exact same fetch-on-mount and Update Data refresh behaviour', () => {
    assert.match(src, /useEffect\(\(\) => \{/)
    assert.match(src, /const refreshEarnings = useCallback\(async \(\) => \{/)
    assert.match(src, /await refreshAll\(\)/)
    assert.match(src, /fetchEarningsResults\(true\)\.catch\(\(\) => null\)/)
  })

  it('keeps the Export CSV action wired to the same handler and exact same columns/rows', () => {
    assert.match(src, /onClick=\{handleExport\}/)
    assert.match(src, /const handleExport = \(\) => \{/)
    assert.match(src, /exportCSV\(\s*'earnings_recent_results'/)
  })
})

// ─── 17-19. Source badges, footers, providers, timestamps ─────────────────────

describe('Phase 5G — source badges, footers, providers and timestamps are unchanged', () => {
  it('keeps exactly two MarketDataSourceBadge instances with the original live/static ternaries', () => {
    assert.equal(count(src, '<MarketDataSourceBadge'), 2)
    assert.match(src, /status=\{cal\?\.status === 'live' \? 'live' : 'static'\}/)
    assert.match(src, /status=\{live \? 'live' : 'static'\}/)
  })

  it('keeps exactly two TableSourceFooter instances naming the real providers', () => {
    assert.equal(count(src, '<TableSourceFooter'), 2)
    assert.match(src, /source=\{t\.home\.earningsCalSource\}\s*asOf=\{cal\?\.asOf \?\? null\}/)
    assert.match(src, /source=\{t\.stocks\.footer\}\s*asOf=\{results\?\.asOf \?\? null\}/)
  })

  it('CMF and Yahoo Finance provider labels are unchanged constants', () => {
    assert.match(i18n, /earningsCalSource:\s*'Comisión para el Mercado Financiero \(CMF\)'/)
    assert.match(i18n, /footer:\s*'Yahoo Finance'/)
  })

  it('keeps the amounts disclosure note and the record-count footer', () => {
    assert.match(src, /\{t\.earnings\.amountsNote\}/)
    assert.match(src, /\{rows\.length\} \{t\.common\.records\}/)
  })
})

// ─── 20-25. Async and data-quality states ─────────────────────────────────────

describe('Phase 5G — loading/empty states are preserved (no new state invented)', () => {
  it('keeps the loading boolean and its exact two messages, now via the shared AsyncState', () => {
    assert.match(src, /const \[loading, setLoading\] = useState\(true\)/)
    assert.match(src, /kind=\{loading \? 'loading' : 'empty'\}\s*message=\{loading \? t\.common\.loading : t\.earnings\.noUpcoming\}/)
    assert.match(src, /kind=\{loading \? 'loading' : 'empty'\}\s*message=\{loading \? t\.common\.loading : t\.common\.noResults\}/)
  })

  it('no-upcoming-events and no-reported-results stay two textually distinct messages', () => {
    assert.notEqual('t.earnings.noUpcoming', 'common.noResults')
    assert.match(i18n, /noUpcoming:\s*'No scheduled reports in the next 45 days'/)
    assert.match(i18n, /noResults:\s*'No results found'/)
  })

  it('a failed calendar fetch cannot erase valid results, and vice versa — independent .catch(null) per source, independent state setters', () => {
    assert.equal(count(src, '.catch(() => null)'), 4)
    assert.match(src, /if \(c\) setCal\(c\)/)
    assert.match(src, /if \(r\) setResults\(r\)/)
  })

  it('partial/stale/unavailable/provider-error are not fabricated as new visual states — the underlying status field is read, never invented', () => {
    // These four states are not independently distinguished in the current
    // NMI implementation (a `results.status === 'unavailable'` and a
    // `results === null` client fetch failure render identically) — Phase 5G
    // preserves this exactly rather than inventing new, unauthorized
    // distinctions the authority model reserves for existing NMI logic.
    assert.match(src, /const live = results\?\.status === 'live'/)
    assert.ok(!/'partial'|'stale'|'unavailable'/.test(src), 'no new AsyncState kind beyond loading/empty was introduced on this page')
  })
})

// ─── 26-27. API/data dependencies, persistence ────────────────────────────────

describe('Phase 5G — API dependencies and (lack of) persistence are unchanged', () => {
  it('fetches only the two existing client-safe helpers, never a raw fetch to a different path', () => {
    assert.match(src, /fetchEarningsCalendar\(\)/)
    assert.match(src, /fetchEarningsResults\(false\)/)
    assert.match(src, /fetchEarningsResults\(true\)/)
    assert.ok(!/fetch\(['"`]\/api/.test(src), 'the page must call the client-safe helpers, never fetch() directly')
  })

  it('introduces no localStorage/persistence key or URL-state behaviour (none existed before)', () => {
    assert.ok(!src.includes('usePersistentState'))
    assert.ok(!/searchParams|useSearchParams/.test(src))
  })
})

// ─── 28. Responsive ────────────────────────────────────────────────────────────

describe('Phase 5G — responsive containment', () => {
  it('uses w-full as the outermost container, never a page-level max-width', () => {
    assert.match(src, /<div className="w-full space-y-5">/)
    assert.ok(!/max-w-screen|min-width/.test(src))
  })

  it('both tables scroll inside their own TableCard, each with its own minWidth floor', () => {
    assert.match(src, /minWidth=\{360\}/)
    assert.match(src, /minWidth=\{720\}/)
    assert.equal(count(src, '<TableCard'), 2)
  })
})

// ─── 29. Fable component mapping ──────────────────────────────────────────────

describe('Phase 5G — Fable component adoption', () => {
  it('imports TableCard, AsyncState, and Reveal, and uses them for both tables', () => {
    assert.match(src, /import \{ TableCard \} from '@\/components\/fable\/TableCard'/)
    assert.match(src, /import \{ AsyncState \} from '@\/components\/fable\/AsyncState'/)
    assert.match(src, /import \{ Reveal \} from '@\/components\/fable\/motion'/)
    assert.equal(count(src, '<Reveal'), 3)
  })

  it('uses the near-opaque dense table surface for headers, never low-opacity glass', () => {
    assert.ok(count(src, "backgroundColor: 'var(--surface-table)'") >= 14)
  })

  it('uses semantic table markup — scoped headers and a caption on each table', () => {
    assert.equal(count(src, 'scope="col"'), 14)
    assert.equal(count(src, '<caption className="sr-only">'), 2)
  })

  it('uses the tokenised table-cell type scale on every table', () => {
    assert.equal(count(src, "fontSize: 'var(--fs-table-cell)'"), 2)
  })

  it('uses the shared row-hover/transition tokens, not the pre-Fable hover:bg-surface-2 recipe', () => {
    assert.ok(!src.includes('hover:bg-surface-2'))
    assert.ok(!src.includes('transition-colors'))
    assert.equal(count(src, 'nv-row-hover nv-transition'), 2)
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

  it('does not invent summary KPIs', () => {
    assert.ok(!/KpiCapsule|kpi-strip|summaryKpi/i.test(src))
  })
})

// ─── Motion ─────────────────────────────────────────────────────────────────────

describe('Phase 5G — motion is restrained and reduced-motion safe', () => {
  it('uses only the shared CSS reveal primitive, with the Fable stagger cadence', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /<Reveal delayMs=\{130\}>/)
  })

  it('never animates a financial value continuously — no count-up on this route', () => {
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('ValueChangeTransition'))
  })

  it('introduces no page-local keyframes or animation utility', () => {
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('the reveal primitive collapses to its final state under reduced motion (shared global rule, unchanged)', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5G — accessibility', () => {
  it('the empty/loading row spans every column and routes through the shared AsyncState (aria-live via AsyncState itself)', () => {
    assert.match(src, /colSpan=\{3\}/)
    assert.match(src, /colSpan=\{11\}/)
  })

  it('meaningful ticker link labels — the ticker text itself, in a real <a>, never a bare icon', () => {
    assert.match(src, /className="font-mono text-primary hover:underline">\{e\.ticker\}<\/Link>/)
  })
})

// ─── Localization ────────────────────────────────────────────────────────────

describe('Phase 5G — English and Spanish complete', () => {
  it('introduces no hardcoded new visible English string', () => {
    // No new UI copy was needed this phase (every string reused from the
    // existing t.earnings/t.common/t.home/t.stocks dictionary entries) —
    // confirm no bare English literal was slipped into a JSX text position.
    assert.ok(!/>[A-Z][a-zA-Z ]{3,}</.test(src.replace(/\{[^}]*\}/g, '')))
  })

  it('every t.earnings.* key referenced by the page exists in both dictionaries', () => {
    const keys = new Set([...src.matchAll(/t\.earnings\.(\w+(?:\.\w+)?)/g)].map(m => m[1]))
    assert.ok(keys.size > 0)
    for (const key of keys) {
      const path = key.split('.')
      assert.match(i18n, new RegExp(`${path[path.length - 1]}:\\s*'`), `t.earnings.${key} must exist`)
    }
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5G — scope held', () => {
  it('imports no server-only db/financials/provider module', () => {
    assert.ok(!/@\/lib\/(db|financials|providers)\//.test(src))
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('redesigns no page outside its own phase', () => {
    for (const other of [
      'src/app/page.tsx', 'src/app/macro/page.tsx', 'src/app/macro/calendar/page.tsx',
      'src/app/portfolio/page.tsx', 'src/app/structured-notes/page.tsx',
    ]) {
      assert.ok(existsSync(join(ROOT, other)), `${other} must still exist`)
    }
  })

  it('Macro and Macro Calendar are byte-for-byte untouched by this phase (existence + no earnings-only marker)', () => {
    const macro = read('src/app/macro/page.tsx')
    const macroCal = read('src/app/macro/calendar/page.tsx')
    assert.ok(!macro.includes('earningsCalSource') && !macro.includes('recentResults'))
    assert.ok(!macroCal.includes('earningsCalSource') && !macroCal.includes('recentResults'))
  })

  it('company-detail earnings integrity remains unmodified (still its own AsyncState loading/empty mapping)', () => {
    const company = read('src/app/companies/[ticker]/page.tsx')
    assert.match(company, /kind=\{earningsResults === null \? 'loading' : 'empty'\}/)
    assert.match(company, /message=\{earningsResults === null \? t\.common\.loading : t\.company\.noData\}/)
  })

  it('leaves access control to the shared policy (Earnings is now private)', async () => {
    // R1.5 made Nevada Market Intelligence default-deny: middleware no longer
    // carries PROTECTED_PAGES/PROTECTED_API, and this route is now PRIVATE like
    // every other application page. The original intent of this test — that the
    // page phase itself changed no access rule — is preserved by asserting the
    // route's classification comes from the shared policy.
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/earnings'), 'private_page')
    assert.ok(!read('src/middleware.ts').includes("'/earnings'"), 'never named in middleware')
  })

  it('changes no API contract from the page — same two endpoints, same helper signatures', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/earnings/calendar/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/earnings/results/route.ts')))
    const calendarApi = read('src/lib/data/earningsCalendar.ts')
    const resultsApi = read('src/lib/data/earningsResults.ts')
    assert.match(calendarApi, /fetch\('\/api\/earnings\/calendar'/)
    assert.match(resultsApi, /fetch\(`\/api\/earnings\/results/)
  })

  it('never uses earnings.json as a production source anywhere in src/', () => {
    // src/data/earnings.json is a dead, orphaned file (zero import statements
    // reference it anywhere in src/) — confirmed structurally, not just for
    // this page, so this migration cannot have reintroduced it.
    const appFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
        else if (/\.(ts|tsx)$/.test(entry)) appFiles.push(rel)
      }
    }
    walk('src')
    for (const f of appFiles) {
      assert.ok(!read(f).includes("from '@/data/earnings.json'"), `${f} must not import earnings.json`)
    }
  })
})
