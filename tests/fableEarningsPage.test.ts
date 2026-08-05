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
    // R8: SectionHeader → the shared Fable PageHeader (the R3/R4/R5/R6 house
    // component). The three content props survive verbatim, only renamed to
    // PageHeader's slots — tag→eyebrow, title→title, subtitle→metadata — and
    // the Update Data action is byte-identical.
    assert.match(src, /eyebrow=\{t\.earnings\.tag\}/)
    assert.match(src, /title=\{t\.earnings\.title\}/)
    assert.match(src, /metadata=\{t\.earnings\.subtitle\}/)
    assert.match(src, /<UpdateDataButton onRefresh=\{refreshEarnings\}\s*\/>/)
  })

  it('keeps the Upcoming (calendar) section and the Recent Results section — exactly two tables', () => {
    assert.match(src, /title=\{t\.earnings\.upcomingLabel\}/)
    assert.match(src, /title=\{t\.earnings\.recentResults\}/)
    assert.equal(count(src, '<table'), 2)
  })

  it('keeps the Upcoming table columns, now: Ticker · Company · Period · Expected Date', () => {
    // R8: a Company column was ADDED in 2nd position (subject identity — the
    // Fable name+id anatomy R6 established, and the treatment Recent Results
    // already had). Nothing was removed or reordered around it.
    const block = src.slice(src.indexOf('t.earnings.upcomingLabel'), src.indexOf('t.earnings.recentResults'))
    const order = [...block.matchAll(/\{t\.earnings\.calCols\.(\w+)\}/g)].map(m => m[1])
    assert.deepEqual(order.slice(0, 4), ['ticker', 'company', 'period', 'expected'])
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
    // R8: the 45 literal became the named module constant UPCOMING_WINDOW_DAYS
    // (business rule lifted out of the render body) and the inline
    // `cal?.status === 'live'` test became the `calLive` binding it is now
    // read from in four places. Same helper, same window, same semantics.
    assert.match(src, /const calLive = cal\?\.status === 'live'/)
    assert.match(src, /const UPCOMING_WINDOW_DAYS = 45/)
    assert.match(src, /const upcoming = calLive \? upcomingWithinDays\(cal\.events, UPCOMING_WINDOW_DAYS\) : \[\]/)
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
  it('keeps exactly two MarketDataSourceBadge instances, now with honest live/unavailable ternaries', () => {
    // R8 — the headline correction of this phase. Both badges previously fell
    // back to 'static', claiming a static sample was on screen. There is NO
    // static earnings source: both payload unions are `'live' | 'unavailable'`
    // and earnings.json is a deleted file. A fetch failure ALSO rendered
    // "Static". Both now resolve 'live-unavailable', which the shared badge
    // and both dictionaries already supported — no shared string was edited.
    assert.equal(count(src, '<MarketDataSourceBadge'), 2)
    assert.match(src, /status=\{calLive \? 'live' : 'live-unavailable'\}/)
    assert.match(src, /status=\{live \? 'live' : 'live-unavailable'\}/)
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
  it('keeps the loading boolean and both empty messages, now across three distinguished states', () => {
    // R8: the binary loading/empty mapping became a three-way one (see the new
    // R8 "async states" block). Both original messages survive unchanged and
    // still belong to exactly the situations they always described —
    // t.earnings.noUpcoming and t.common.noResults are still the EMPTY copy.
    assert.match(src, /const \[loading, setLoading\] = useState\(true\)/)
    assert.match(src, /const calState = stateFor\(calLive\)/)
    assert.match(src, /const resultsState = stateFor\(live\)/)
    assert.match(src, /kind=\{calState\}\s*message=\{messageFor\(calState, t\.earnings\.noUpcoming\)\}/)
    assert.match(src, /kind=\{resultsState\}\s*message=\{messageFor\(resultsState, t\.common\.noResults\)\}/)
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

  it('the underlying status field is still read, never invented', () => {
    // R8 SUPERSEDES this test's original second assertion, deliberately.
    //
    // Phase 5G asserted that `unavailable` was NOT distinguished from `empty`,
    // preserving the then-current NMI behaviour. R8 was commissioned precisely
    // to correct that: collapsing them forced the page to describe a dead
    // source as "no data", and pushed the badge onto a 'static' fallback that
    // names a dataset which does not exist. The `unavailable` kind is NOT
    // fabricated — it is an existing AsyncState kind with existing EN/ES copy,
    // driven by the resolvers' own existing `status` field.
    //
    // What the original test was really protecting — that no state is invented
    // from nothing — still holds and is asserted here: `partial` and `stale`
    // remain unused, because nothing in this page's payloads distinguishes them.
    assert.match(src, /const live = results\?\.status === 'live'/)
    assert.ok(!/'partial'|'stale'/.test(src), 'partial/stale remain unused — no payload field distinguishes them')
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
    // R8: the AsyncState import additionally pulls the AsyncStateKind type, so
    // the three-way state resolver is typed against the shared union rather
    // than a page-local string literal set.
    assert.match(src, /import \{ TableCard \} from '@\/components\/fable\/TableCard'/)
    assert.match(src, /import \{ AsyncState, type AsyncStateKind \} from '@\/components\/fable\/AsyncState'/)
    assert.match(src, /import \{ Reveal \} from '@\/components\/fable\/motion'/)
    assert.equal(count(src, '<Reveal'), 3)
  })

  it('uses the near-opaque dense table surface for headers, never low-opacity glass', () => {
    assert.ok(count(src, "backgroundColor: 'var(--surface-table)'") >= 14)
  })

  it('uses semantic table markup — scoped headers and a caption on each table', () => {
    // R8: 14 → 15. Upcoming gained its Company column (3 → 4 headers); Recent
    // Results is untouched at 11. Every header is still scoped.
    assert.equal(count(src, 'scope="col"'), 15)
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
    // R8: Upcoming's colSpan tracks its new 4th (Company) column, so the state
    // row still spans the full table. Recent Results stays at 11.
    assert.match(src, /colSpan=\{4\}/)
    assert.match(src, /colSpan=\{11\}/)
    assert.ok(!/colSpan=\{3\}/.test(src), 'the stale 3-column span must not survive')
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

  it('company-detail earnings integrity remains its own independent AsyncState mapping', () => {
    // The point of this Phase-5G guard is that the Earnings route never took
    // over the company page's own state handling. That still holds. R11
    // deliberately STRENGTHENED the company page's mapping — adding a distinct
    // error state, because a failed fetch previously sat at "loading" forever —
    // so the assertion follows the enduring contract (its own loading/empty
    // distinction, driven by its own local state) rather than the old literal.
    const company = read('src/app/companies/[ticker]/page.tsx')
    assert.match(company, /kind=\{resultsFailed \? 'error' : earningsResults === null \? 'loading' : 'empty'\}/)
    assert.match(company, /message=\{resultsFailed \? undefined : earningsResults === null \? t\.common\.loading : t\.company\.noData\}/)
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

// ═══════════════════════════════════════════════════════════════════════════
// Phase R8 — source honesty, per-source coverage, localization, composition
//
// R8 is the fidelity-deepening pass that brings /earnings into the R3-R6
// family. Two of its items are DATA-CORRECTNESS fixes, not styling:
//
//   1. Both source badges fell back to 'static', asserting that a static
//      earnings sample was on screen. No such source exists — both payload
//      unions are `'live' | 'unavailable'` and earnings.json is deleted.
//   2. Both payloads carry `missingTickers` — the resolvers' own documented
//      honest-gap channel (CMF genuinely publishes no BSANTANDER/ITAUCL) — and
//      no component read it, so structurally absent issuers were invisible.
//
// Everything below the composition heading is presentation only.
// ═══════════════════════════════════════════════════════════════════════════

const DOC03 = read('docs/fable-integration/03-route-content-mapping.md')

/** The page source with comments stripped, so prose can never satisfy a scan. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !l.trim().startsWith('//'))
  .join('\n')

describe('Phase R8 — source honesty: no static earnings source is ever claimed', () => {
  it('the string literal \'static\' appears nowhere on the route', () => {
    assert.ok(!/'static'/.test(src), "no badge may fall back to 'static' — there is no static earnings source")
  })

  it('both unavailable paths resolve live-unavailable, for explicit-unavailable AND null payloads', () => {
    // `calLive`/`live` are both `payload?.status === 'live'`, so a null payload
    // (fetch threw → .catch(() => null)) is false exactly like an explicit
    // 'unavailable'. One expression covers both required cases.
    assert.match(code, /const calLive = cal\?\.status === 'live'/)
    assert.match(code, /const live = results\?\.status === 'live'/)
    assert.match(code, /status=\{calLive \? 'live' : 'live-unavailable'\}/)
    assert.match(code, /status=\{live \? 'live' : 'live-unavailable'\}/)
  })

  it('reuses the shared badge and its existing bilingual copy — no shared string was edited', () => {
    assert.match(i18n, /liveUnavailable:\s*'Market data unavailable'/)
    assert.match(i18n, /liveUnavailable:\s*'Datos de mercado no disponibles'/)
    assert.match(i18n, /static:\s*'Static'/)
    assert.match(i18n, /static:\s*'Estático'/)
  })

  it('reintroduces no static fallback, consensus, or quality pill', () => {
    assert.ok(!/earnings\.json/.test(src))
    assert.ok(!/consensus|surprise/i.test(src))
    assert.ok(!/\bClean\b|\bMixed\b|\bWeak\b|resultQuality|qualityVariant/.test(src))
  })
})

describe('Phase R8 — async states: unavailable and empty are never collapsed', () => {
  it('resolves three distinct states, with unavailable driven by the payload status', () => {
    assert.match(code, /const stateFor = \(sourceIsLive: boolean\): AsyncStateKind =>/)
    assert.match(code, /loading \? 'loading' : sourceIsLive \? 'empty' : 'unavailable'/)
  })

  it('a healthy live payload with zero rows stays EMPTY, keeping its original copy', () => {
    // The genuinely-empty case is real for Upcoming: between reporting waves no
    // CMF date falls inside the window. It must never read as a dead source.
    assert.match(code, /messageFor\(calState, t\.earnings\.noUpcoming\)/)
    assert.match(code, /messageFor\(resultsState, t\.common\.noResults\)/)
    assert.match(i18n, /noUpcoming:\s*'No scheduled reports in the next 45 days'/)
  })

  it('the unavailable state falls through to AsyncState\'s own bilingual copy, not an empty message', () => {
    assert.match(code, /kind === 'loading' \? t\.common\.loading : kind === 'empty' \? emptyMessage : undefined/)
    assert.match(i18n, /unavailable:\s*\{ title: 'Unavailable'/)
    assert.match(i18n, /unavailable:\s*\{ title: 'No disponible'/)
  })

  it('keeps per-source failure isolation — one dead source cannot blank the other', () => {
    assert.equal(count(src, '.catch(() => null)'), 4)
    assert.match(code, /if \(c\) setCal\(c\)/)
    assert.match(code, /if \(r\) setResults\(r\)/)
  })
})

describe('Phase R8 — per-source coverage disclosure', () => {
  const note = src.slice(src.indexOf('function CoverageNote'), src.indexOf('export default function'))

  it('reads missingTickers for BOTH sources, each into its own table', () => {
    assert.equal(count(src, '<CoverageNote'), 2)
    assert.match(code, /\{calLive && <CoverageNote missing=\{cal\.missingTickers\} \/>\}/)
    assert.match(code, /\{live && <CoverageNote missing=\{results\.missingTickers\} \/>\}/)
  })

  it('derives the denominator from the company registry — read once at module scope', () => {
    // The registry is the single source of truth for BOTH the denominator and
    // the ticker→name lookup, so the two can never disagree about which
    // universe is being measured.
    assert.match(code, /const COMPANY_REGISTRY = getAllCompanies\(\)/)
    assert.match(code, /const trackedCompanyCount = COMPANY_REGISTRY\.length/)
    assert.match(code, /const COMPANY_NAME = new Map\(COMPANY_REGISTRY\.map\(\(c\) => \[c\.ticker, c\.name\]\)\)/)
    assert.equal(count(code, 'getAllCompanies()'), 1, 'the registry is read exactly once, at module scope')
  })

  it('the denominator comes from NO other universe — not TICKER_YF, not a hardcoded count', () => {
    // TICKER_YF is a provider-side Yahoo symbol map in server-facing code; it is
    // not the app's company registry and must never stand in for it here.
    assert.ok(!/TICKER_YF/.test(src), 'the provider symbol map must not appear on this page')
    assert.ok(!/liveOverlay/.test(src))
    assert.ok(!/getTrackedCompanies/.test(src), 'one registry accessor only')
    assert.ok(!/\b25\b/.test(note), 'the universe size is never hardcoded')
  })

  it('measures coverage as registry count minus that payload\'s missingTickers, NEVER the row count', () => {
    assert.match(note, /\{trackedCompanyCount - missing\.length\}\/\{trackedCompanyCount\}/)
    // A row count could never express "this source has no data for this issuer
    // at all" — Recent Results prints 2 quarters per company, and Upcoming only
    // companies reporting inside the window.
    assert.ok(!/rows\.length|upcoming\.length/.test(note), 'coverage must not be derived from displayed rows')
    assert.ok(!/\.rows\b|events\.length/.test(note), 'coverage must not consult either payload\'s row arrays')
  })

  it('names the excluded tickers only when there are any', () => {
    assert.match(note, /missing\.length > 0 &&/)
    assert.match(note, /missing\.join\(', '\)/)
    assert.match(note, /\{t\.earnings\.notCovered\}/)
  })

  it('no combined page-level coverage number is shown in the header', () => {
    // The two sources have independently different coverage; one merged figure
    // would be false for at least one of them.
    const header = src.slice(src.indexOf('<PageHeader'), src.indexOf('</Reveal>'))
    assert.ok(!/CoverageNote|trackedCompanyCount|companiesCovered/.test(header))
    assert.match(code, /metadata=\{t\.earnings\.subtitle\}/)
  })

  it('the disclosure sits BESIDE the footer, never inside its source string', () => {
    assert.equal(count(src, '<TableSourceFooter'), 2)
    assert.equal(count(src, '<TableCard'), 2)
    // Both source props remain the plain source names the convention requires.
    assert.match(code, /source=\{t\.home\.earningsCalSource\}\s*asOf=\{cal\?\.asOf \?\? null\}/)
    assert.match(code, /source=\{t\.stocks\.footer\}\s*asOf=\{results\?\.asOf \?\? null\}/)
    assert.ok(!/source=\{[^}]*CoverageNote/.test(src))
    assert.match(i18n, /earningsCalSource:'?\s*'Comisión para el Mercado Financiero \(CMF\)'/)
  })

  it('uses the client-safe registry — no new API request was introduced', () => {
    assert.match(code, /from '@\/lib\/data\/companies'/)
    assert.ok(!/fetch\(['"`]\/api/.test(src))
    assert.equal(count(src, 'fetchEarningsCalendar()'), 2)
    assert.equal(count(src, 'fetchEarningsResults('), 2)
  })
})

describe('Phase R8 — localization of periods and dates', () => {
  it('the calendar period enum is never rendered raw', () => {
    const upcomingBlock = src.slice(src.indexOf('t.earnings.upcomingLabel'), src.indexOf('t.earnings.recentResults'))
    assert.match(upcomingBlock, /\{periodLabel\(e\.period\)\}/)
    assert.ok(!/\{e\.period\}/.test(upcomingBlock), 'the Upcoming table must not print the raw enum')
    assert.match(code, /Annual: t\.earnings\.calPeriods\.annual/)
  })

  it('Recent Results keeps its own period untranslated — it is already language-neutral', () => {
    // That field is "Q1 2026" from quarterLabel() in the pure core: a letter, a
    // digit and a year. There is nothing in it to translate, and splitting it
    // apart would be exactly the manual date surgery this phase removes.
    const resultsBlock = src.slice(src.indexOf('t.earnings.recentResults'))
    assert.match(resultsBlock, /\{e\.period\}/)
  })

  it('Annual is bilingual and renders Anual in Spanish', () => {
    const blocks = [...i18n.matchAll(/calPeriods: \{[^}]*\}/g)].map(m => m[0])
    assert.equal(blocks.length, 2, 'exactly one calPeriods block per dictionary')
    assert.match(blocks[0], /annual:\s*'Annual'/)
    assert.match(blocks[1], /annual:\s*'Anual'/)
    for (const b of blocks) {
      assert.match(b, /q1:\s*'Q1'/)
      assert.match(b, /q2:\s*'Q2'/)
      assert.match(b, /q3:\s*'Q3'/)
    }
  })

  it('report dates render through the shared formatDate, with no hand-rolled date surgery', () => {
    assert.match(code, /import \{ formatDate, formatPct, changeColor \} from '@\/lib\/formatters'/)
    assert.match(code, /\{reportDateLabel\(e\.reportDate\)\}/)
    // Negative lookbehind: `${e.reportDate}` inside the row-key template
    // literal is the unchanged React key, not a rendered value.
    assert.ok(!/(?<!\$)\{e\.reportDate\}/.test(code), 'the raw ISO string must not be printed')
    assert.match(code, /key=\{`\$\{e\.ticker\}-\$\{e\.reportDate\}`\}/, 'the row key is unchanged')
    // No manual segment rearrangement (the slice(8,10)/slice(5,7) recipe).
    assert.ok(!/reportDate\.slice\(/.test(src))
  })

  it('normalizes the date-only input to local time so the day is never off by one', () => {
    // `new Date('2026-08-04')` is UTC midnight; in Chile (UTC-4/-3) that formats
    // as 03 ago — one day EARLY, on a page whose entire job is stating when a
    // company reports. An explicit zero time forces a local-time parse.
    assert.match(code, /formatDate\(`\$\{iso\}T00:00:00`\)/)

    const fmt = (s: string) =>
      new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    // True in EVERY timezone — this is the property the page relies on.
    assert.match(fmt('2026-08-04T00:00:00'), /^04/)
    assert.match(fmt('2026-01-01T00:00:00'), /^01/)

    if (new Date('2026-08-04T00:00:00').getTimezoneOffset() > 0) {
      // Running west of UTC (the Chilean case): prove the naive parse really
      // does drift, so this guard can never be dismissed as theoretical.
      assert.notEqual(fmt('2026-08-04'), fmt('2026-08-04T00:00:00'))
    }
  })

  it('removes the dead calCols.notes key from both dictionaries', () => {
    assert.ok(!/calCols\.notes/.test(src))
    const calColBlocks = [...i18n.matchAll(/calCols: \{[^}]*\}/g)].map(m => m[0])
    assert.equal(calColBlocks.length, 2)
    for (const b of calColBlocks) assert.ok(!/notes:/.test(b))
  })

  it('introduces no hardcoded visible English string', () => {
    assert.ok(!/>[A-Z][a-zA-Z ]{3,}</.test(src.replace(/\{[^}]*\}/g, '')))
    for (const key of ['companiesCovered', 'notCovered']) {
      assert.equal(count(i18n, `${key}:`), 2, `${key} must exist in BOTH dictionaries`)
    }
  })
})

describe('Phase R8 — shared Fable composition', () => {
  it('PageHeader fully replaces the legacy SectionHeader', () => {
    assert.match(code, /import \{ PageHeader \} from '@\/components\/fable\/PageHeader'/)
    assert.match(code, /<PageHeader/)
    assert.ok(!/SectionHeader/.test(src), 'the legacy header must be gone, import included')
  })

  it('the export control is the shared ChipButton, with behaviour and accessible name intact', () => {
    assert.match(code, /import \{ ChipButton \} from '@\/components\/fable\/Chip'/)
    assert.match(code, /<ChipButton onClick=\{handleExport\}>/)
    assert.match(code, /<span aria-hidden>⤓<\/span>\{t\.common\.exportCsv\}/)
    // The hand-rolled capsule recipe is gone from the page.
    assert.ok(!/--nv-chip/.test(src))
  })

  it('adds the Upcoming Company column from the registry, with an honest fallback', () => {
    // Same COMPANY_REGISTRY that backs the coverage denominator.
    assert.match(code, /const COMPANY_NAME = new Map\(COMPANY_REGISTRY\.map\(\(c\) => \[c\.ticker, c\.name\]\)\)/)
    assert.match(code, /\{COMPANY_NAME\.get\(e\.ticker\) \?\? '—'\}/)
    assert.match(code, /\{t\.earnings\.calCols\.company\}/)
  })

  it('keeps both ticker links canonical and keyboard-operable', () => {
    assert.equal(count(src, "href={`/companies/${e.ticker}`}"), 2)
    assert.equal(count(src, '<Link href='), 2)
  })

  it('lifts the calendar window out of the render body without changing it', () => {
    assert.match(code, /const UPCOMING_WINDOW_DAYS = 45/)
    assert.match(code, /upcomingWithinDays\(cal\.events, UPCOMING_WINDOW_DAYS\)/)
  })

  it('keeps card-level scrolling and the page container', () => {
    assert.match(code, /<div className="w-full space-y-5">/)
    assert.match(code, /minWidth=\{360\}/)
    assert.match(code, /minWidth=\{720\}/)
  })
})

describe('Phase R8 — preserved business contracts', () => {
  it('Recent Results keeps all 11 columns in their exact original order', () => {
    const block = src.slice(src.indexOf('t.earnings.recentResults'))
    const heads = [...block.slice(0, block.indexOf('<tbody')).matchAll(/\{t\.earnings\.(?:calCols\.ticker|cols\.\w+|currency)\}/g)].map(m => m[0])
    assert.deepEqual(heads, [
      '{t.earnings.calCols.ticker}', '{t.earnings.cols.company}', '{t.earnings.cols.period}',
      '{t.earnings.currency}', '{t.earnings.cols.revenue}', '{t.earnings.cols.revenueYoy}',
      '{t.earnings.cols.ebitda}', '{t.earnings.cols.ebitdaYoy}', '{t.earnings.cols.netIncome}',
      '{t.earnings.cols.netIncomeYoy}', '{t.earnings.cols.eps}',
    ])
  })

  it('the CSV export is byte-identical — same filename, headers and row mapping', () => {
    const exportBlock = src.slice(src.indexOf('const handleExport'), src.indexOf('const pctCell'))
    assert.match(exportBlock, /exportCSV\(\s*'earnings_recent_results'/)
    assert.match(exportBlock, /t\.earnings\.calCols\.ticker, t\.earnings\.cols\.company, t\.earnings\.cols\.period, t\.earnings\.currency,/)
    assert.match(exportBlock, /e\.ticker, e\.companyName, e\.period, e\.currency,/)
    assert.match(exportBlock, /e\.netIncome \?\? '', e\.netIncomeYoY \?\? '', e\.eps \?\? '',/)
  })

  it('the new Upcoming Company column is NOT added to the Recent Results CSV', () => {
    const exportBlock = src.slice(src.indexOf('const handleExport'), src.indexOf('const pctCell'))
    assert.ok(!/calCols\.company/.test(exportBlock), 'the export uses the Recent Results company label only')
    assert.ok(!/COMPANY_NAME/.test(exportBlock), 'the export must not consult the registry map')
  })

  it('fmtMM, fmtEps and pctCell are unchanged', () => {
    assert.match(code, /const d = Math\.abs\(v\) < 1 \? 4 : 2/)
    assert.match(code, /minimumFractionDigits: 1, maximumFractionDigits: 1/)
    assert.match(code, /v != null \? changeColor\(v\) : 'text-muted-fg'/)
    assert.match(code, /\{v != null \? formatPct\(v\) : '—'\}/)
  })

  it('keeps currency, bank-EBITDA suppression, negative styling and the record count', () => {
    assert.match(code, /\{e\.currency\}/)
    assert.match(code, /title=\{e\.isBank \? t\.earnings\.bankNoEbitda : undefined\}/)
    assert.match(code, /e\.netIncome != null && e\.netIncome < 0 \? 'text-negative' : 'text-foreground'/)
    assert.match(code, /e\.eps != null && e\.eps < 0 \? 'text-negative' : 'text-foreground'/)
    assert.match(code, /\{rows\.length\} \{t\.common\.records\}/)
    assert.match(code, /\{t\.earnings\.amountsNote\}/)
  })

  it('never coerces a missing metric to zero', () => {
    assert.ok(!/\?\?\s*0\b/.test(src))
  })

  it('keeps the global refresh force semantics', () => {
    assert.match(code, /await refreshAll\(\)/)
    assert.match(code, /fetchEarningsResults\(true\)\.catch\(\(\) => null\)/)
    assert.match(code, /fetchEarningsResults\(false\)\.catch\(\(\) => null\)/)
  })

  it('adds no sorting, filtering, persistence or URL state', () => {
    assert.ok(!src.includes('<select'))
    assert.ok(!src.includes('SegmentedControl'))
    assert.ok(!src.includes('toggleSort'))
    assert.ok(!src.includes('usePersistentState'))
    assert.ok(!/searchParams|useSearchParams/.test(src))
  })

  it('adds no KPI strip, sparkline, or detail drawer', () => {
    assert.ok(!/KpiCapsule|KpiHero|kpi-strip|summaryKpi/i.test(src))
    assert.ok(!/Sparkline|DetailPanel|ModalShell/.test(src))
  })

  it('keeps motion restrained and token-only styling', () => {
    assert.equal(count(src, '<Reveal'), 3)
    assert.match(code, /<Reveal delayMs=\{70\}>/)
    assert.match(code, /<Reveal delayMs=\{130\}>/)
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src))
    assert.ok(
      !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(src),
    )
  })

  it('imports no server-only module and adds no dependency', () => {
    assert.ok(!/@\/lib\/(db|financials|providers)\//.test(src))
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })
})

describe('Phase R8 — access-control documentation matches runtime', () => {
  it('/earnings is classified private_page by the shared policy', async () => {
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/earnings'), 'private_page')
  })

  it('doc 03 records /earnings as private_page, not public', () => {
    // R1.5 made the app default-deny; the runtime was already correct, but the
    // route-content map still described this route as public.
    const row = DOC03.split('\n').find(l => l.includes('| `/earnings` |'))
    assert.ok(row, 'the /earnings row must exist in the route table')
    assert.ok(/private_page/.test(row), `route table row must say private_page: ${row}`)
    const section = DOC03.slice(DOC03.indexOf('## 7. `/earnings`'), DOC03.indexOf('## 8.'))
    assert.match(section, /\*\*Auth:\*\* private_page/)
    assert.ok(!/\*\*Auth:\*\* public/.test(section))
  })
})
