// Phase 5A — /stocks re-skinned into the Fable institutional language.
//
// The contract this file locks down: the page LOOKS different and NOTHING
// about what it shows or does changed. Every section, column, filter, sort
// key, link, source badge, footer, timestamp, and honest "—" is still there;
// the data-merge order (live → persisted → static) is byte-for-byte the same;
// no API, provider, or business-logic file was touched.
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

const STOCKS = 'src/app/stocks/page.tsx'
const SEARCH_INPUT = 'src/components/ui/SearchInput.tsx'
const I18N = 'src/lib/i18n.ts'

const src = read(STOCKS)
const searchSrc = read(SEARCH_INPUT)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── Sections ────────────────────────────────────────────────────────────────

describe('Phase 5A — every Stocks section survives the re-skin', () => {
  it('keeps the page header with tag, title, subtitle and the Update action', () => {
    assert.match(src, /<SectionHeader/)
    assert.match(src, /tag=\{t\.stocks\.tag\}/)
    assert.match(src, /title=\{t\.stocks\.title\}/)
    assert.match(src, /subtitle=\{t\.stocks\.subtitle\}/)
    assert.match(src, /actions=\{<UpdateDataButton onRefresh=\{refresh\} \/>\}/)
  })

  it('still renders exactly one UpdateDataButton (the platform-wide convention)', () => {
    assert.equal(count(src, '<UpdateDataButton'), 1)
  })

  it('keeps the toolbar: search, sector filter, source badge, Export CSV', () => {
    assert.match(src, /<SearchInput/)
    assert.match(src, /<select/)
    assert.match(src, /<MarketDataSourceBadge status=\{priceStatus\}/)
    assert.match(src, /t\.common\.exportCsv/)
    assert.match(src, /onClick=\{handleExport\}/)
  })

  it('keeps the table and the footer strip (source line + row count)', () => {
    assert.match(src, /<table/)
    assert.match(src, /<TableSourceFooter source=\{t\.stocks\.footer\}/)
    assert.match(src, /\{rows\.length\} \{t\.common\.companies\}/)
  })

  it('adds no invented KPI, hero, chart, or sector heat map to this route', () => {
    // /stocks has never had a chart or a heat map, and its only "summary"
    // figure is the row count. Inventing market/portfolio numbers here would
    // be fabricated data, not a re-skin.
    for (const forbidden of ['KpiCapsule', 'KpiHero', 'LineChart', 'Sparkline', 'BarrierGauge', 'CurrentActions']) {
      assert.ok(!src.includes(forbidden), `${forbidden} must not appear on /stocks — no data backs it`)
    }
  })
})

// ─── Columns ─────────────────────────────────────────────────────────────────

describe('Phase 5A — all nine table columns preserved, in order', () => {
  const COLUMNS = [
    't.stocks.cols.ticker',
    't.stocks.cols.company',
    't.stocks.cols.sector',
    't.stocks.cols.price',
    't.stocks.cols.dayChg',
    't.stocks.cols.ytd',
    't.stocks.cols.marketCap',
    't.stocks.cols.pe',
    't.stocks.cols.divYield',
  ]

  for (const col of COLUMNS) {
    it(`renders the ${col} column header`, () => {
      assert.ok(src.includes(col), `${col} is missing from the headers table`)
    })
  }

  it('declares them in the original order', () => {
    const positions = COLUMNS.map(c => src.indexOf(`label: ${c}`))
    for (const p of positions) assert.ok(p > 0, 'every column must appear in the headers array')
    const sorted = [...positions].sort((a, b) => a - b)
    assert.deepEqual(positions, sorted, 'column order changed')
  })

  it('exports the same nine columns to CSV, unchanged', () => {
    const start = src.indexOf("exportCSV(")
    const block = src.slice(start, start + 700)
    for (const col of COLUMNS) assert.ok(block.includes(col), `${col} missing from the CSV header row`)
    assert.ok(block.includes("'chilean_stocks'"), 'CSV filename changed')
    assert.ok(block.includes('c.ticker, c.shortName, c.sector, s?.price'), 'CSV row shape changed')
  })
})

// ─── Data merge + values ─────────────────────────────────────────────────────

describe('Phase 5A — data resolution is untouched', () => {
  it('keeps the live → persisted → static merge for every merged cell', () => {
    assert.match(src, /const price\s+= lv\?\.price\s+\?\? ss\?\.price\s+\?\? s\?\.price/)
    assert.match(src, /const dayPct = lv\?\.dayChangePct \?\? ss\?\.dayChangePct \?\? s\?\.dayChangePct/)
    assert.match(src, /const mktCap = lv\?\.marketCapCLP \?\? ss\?\.marketCapCLP \?\? c\.marketCapCLP/)
  })

  it('sorts on the same merged values shown on screen', () => {
    assert.match(src, /dayChangePct: lv\?\.dayChangePct \?\? ss\?\.dayChangePct \?\? s\?\.dayChangePct/)
    assert.match(src, /marketCapCLP: lv\?\.marketCapCLP \?\? ss\?\.marketCapCLP \?\? c\.marketCapCLP/)
  })

  it('keeps every existing formatter and never inlines a locale call', () => {
    for (const fn of ['formatCLP', 'formatPct', 'formatLargeCLP', 'changeColor']) {
      assert.ok(src.includes(fn), `${fn} must still format its column`)
    }
    assert.ok(!src.includes('toLocaleString'), 'formatting must stay in src/lib/formatters.ts')
  })

  it('renders unavailable values as an em dash — never as zero', () => {
    assert.equal(count(src, "'—'"), 6, 'all six nullable numeric columns keep their "—" fallback')
    assert.ok(!/\?\?\s*0\b/.test(src), 'a missing value must never be coerced to 0')
  })

  it('keeps tabular numerals on every numeric cell', () => {
    assert.equal(count(src, 'ui-number'), 7, '6 numeric columns + the row-count meta line')
  })
})

// ─── Filters + sorting ───────────────────────────────────────────────────────

describe('Phase 5A — filters and sorting behave exactly as before', () => {
  it('keeps the free-text filter across ticker, name and shortName', () => {
    assert.match(src, /c\.ticker\.toLowerCase\(\)\.includes\(q\)/)
    assert.match(src, /c\.name\.toLowerCase\(\)\.includes\(q\)/)
    assert.match(src, /c\.shortName\.toLowerCase\(\)\.includes\(q\)/)
  })

  it('keeps the sector filter with its All Sectors default', () => {
    assert.match(src, /!sector \|\| c\.sector === sector/)
    assert.match(src, /<option value="">\{t\.stocks\.allSectors\}<\/option>/)
    assert.match(src, /sectors\.map\(s => <option key=\{s\} value=\{s\}>\{s\}<\/option>\)/)
  })

  it('keeps the sector control as a single-select (a 10+ option pill rail would overflow)', () => {
    assert.ok(src.includes('<select'), 'sector filtering must stay a native select')
    assert.ok(!src.includes('SegmentedControl'), 'a segmented rail cannot hold the full sector list without overflow')
  })

  it('keeps the derived default sort and the refresh-clears-manual-sort rule', () => {
    assert.ok(src.includes("const sortKey: SortKey = userSort?.key ?? (live ? 'dayChangePct' : 'marketCapCLP')"))
    assert.ok(src.includes("const sortDir: 'asc' | 'desc' = userSort?.dir ?? 'desc'"))
    assert.ok(src.includes('if (refreshSeq !== seenSeq)'))
    assert.ok(src.includes('setUserSort(null)'))
  })

  it('keeps all six sortable keys and the three non-sortable columns', () => {
    for (const key of ["'ticker'", "'dayChangePct'", "'ytdChangePct'", "'marketCapCLP'", "'pe'", "'dividendYield'"]) {
      assert.ok(src.includes(`key: ${key}`), `sortable column ${key} lost its sort key`)
    }
    assert.equal(count(src, 'key: null'), 3, 'Company, Sector and Price stay non-sortable')
  })

  it('keeps the asc/desc toggle semantics', () => {
    assert.match(src, /sortKey === key\s*\?\s*\{ key, dir: sortDir === 'asc' \? 'desc' : 'asc' \}\s*:\s*\{ key, dir: 'desc' \}/)
  })

  it('still sorts nulls last via -Infinity rather than dropping the row', () => {
    assert.ok(src.includes('-Infinity'))
  })
})

// ─── Links + actions ─────────────────────────────────────────────────────────

describe('Phase 5A — links and user actions preserved', () => {
  it('keeps the company link on every ticker', () => {
    assert.match(src, /<Link href=\{`\/companies\/\$\{c\.ticker\}`\}/)
    assert.match(src, /font-mono text-primary hover:underline/, 'ticker stays a monospace identifier')
  })

  it('routes Update through the shared global refresh, not a page-local fetch', () => {
    assert.match(src, /const refresh = useGlobalRefresh\(\)/)
  })

  it('keeps the mount-time persisted-snapshot fetch and its silent static fallback', () => {
    assert.match(src, /fetchStockSnapshots\(\)/)
    assert.match(src, /\.catch\(\(\) => \{\}\)/, 'a failed fetch still degrades silently to static')
  })
})

// ─── Source, timestamp, and state disclosures ────────────────────────────────

describe('Phase 5A — source and data-quality disclosures stay visible', () => {
  it('keeps exactly one TableSourceFooter with a plain source name', () => {
    assert.equal(count(src, '<TableSourceFooter'), 1)
    assert.match(src, /source=\{t\.stocks\.footer\}/)
  })

  it('keeps the single derived as-of, and no second timestamp chip', () => {
    assert.ok(src.includes('const priceAsOf = live ? live.lastUpdated'))
    assert.ok(src.includes('asOf={priceAsOf}'))
    assert.ok(!src.includes('formatLiveTimestamp'))
    assert.ok(!src.includes('t.common.marketUpdated'))
  })

  it('keeps the live/persisted/static status derivation and its badge', () => {
    assert.ok(src.includes("live ? 'live' : Object.keys(supaSnapMap).length ? 'persisted' : 'static'"))
    assert.equal(count(src, '<MarketDataSourceBadge'), 1)
  })

  it('renders the badge in the toolbar, not hidden behind a tooltip-only surface', () => {
    const controlsStart = src.indexOf('controls={')
    const controlsEnd = src.indexOf('footer={')
    assert.ok(controlsStart > 0 && controlsEnd > controlsStart)
    assert.ok(src.slice(controlsStart, controlsEnd).includes('<MarketDataSourceBadge'))
  })
})

describe('Phase 5A — async states stay distinct and honest', () => {
  it('renders the filtered-empty state through AsyncState with its own precise wording', () => {
    assert.match(src, /<AsyncState kind="empty" message=\{t\.common\.noResults\} \/>/)
    assert.match(src, /colSpan=\{headers\.length\}/)
  })

  it('does not fabricate a loading spinner where the page renders synchronously', () => {
    // Static data renders immediately and live overlays swap in; a spinner here
    // would delay readable data for no informational gain (motion rules §12.2).
    assert.ok(!src.includes('kind="loading"'))
  })

  it('AsyncState still distinguishes all seven states (no generic catch-all)', () => {
    const async = read('src/components/fable/AsyncState.tsx')
    for (const kind of ['loading', 'empty', 'error', 'unavailable', 'blocked', 'partial', 'stale']) {
      assert.ok(async.includes(`'${kind}'`), `AsyncState lost the ${kind} state`)
    }
  })
})

// ─── Fable visual language ───────────────────────────────────────────────────

describe('Phase 5A — Fable visual language applied via shared primitives', () => {
  it('uses the shared analytical TableCard container', () => {
    assert.match(src, /<TableCard/)
    assert.match(src, /from '@\/components\/fable\/TableCard'/)
  })

  it('puts the dense table on the near-opaque surface, never on blurred glass', () => {
    const tableCard = read('src/components/fable/TableCard.tsx')
    assert.match(tableCard, /variant="dense"/, 'the table body must sit on the dense tier')
    assert.match(src, /backgroundColor: 'var\(--surface-table\)'/, 'the sticky header keeps a high-opacity fill (§8)')
    assert.ok(!/backdrop-filter/.test(src), 'no blur on rows or cells')
    assert.ok(!src.includes('nv-glass-card'), 'the page never applies glass directly to table content')
  })

  it('uses tokenised row hover (a tint, never a blur or shadow change)', () => {
    assert.match(src, /nv-row-hover nv-transition/)
    assert.ok(!src.includes('hover:bg-surface-2'), 'the untokenised hover is gone')
    assert.ok(!/shadow-/.test(src), 'no shadow on a table row, cell, or control (§10)')
  })

  it('uses Fable pill controls for search, sector filter and export', () => {
    assert.equal(count(src, 'rounded-full'), 2, 'sector select + export chip')
    assert.match(searchSrc, /rounded-full/, 'the search field is a pill')
    assert.match(src, /bg-\[var\(--nv-chip\)\]/)
    assert.match(src, /border-\[var\(--nv-chipbd\)\]/)
  })

  it('keeps dense radii off the table (no 22px card radius on cells)', () => {
    assert.ok(!/rounded-\[var\(--radius-card\)\]/.test(src))
    assert.ok(!src.includes('rounded-2xl'))
  })

  it('uses the tokenised table-cell type scale', () => {
    assert.match(src, /fontSize: 'var\(--fs-table-cell\)'/)
  })

  it('hardcodes no hex colour and no raw Tailwind colour scale', () => {
    for (const file of [STOCKS, SEARCH_INPUT]) {
      const s = read(file)
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(s), `${file} contains a hardcoded hex colour`)
      assert.ok(
        !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(s),
        `${file} uses a raw Tailwind colour scale`,
      )
    }
  })

  it('uses no purple anywhere on this route (reserved for the Review token)', () => {
    assert.ok(!/--chart-review|--review\b/.test(src))
  })
})

describe('Phase 5A — motion is restrained and reduced-motion safe', () => {
  it('uses only the shared CSS reveal primitive, with the Fable 70ms stagger', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
  })

  it('never animates a market value', () => {
    assert.ok(!src.includes('countUp'), 'live prices must not count up (§12.2)')
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('ValueChangeTransition'))
  })

  it('introduces no page-local keyframes or animation utility', () => {
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('the reveal primitive collapses to its final state under reduced motion', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5A — accessibility', () => {
  it('uses semantic table markup with scoped headers and a caption', () => {
    assert.match(src, /<th\s|scope="col"/)
    assert.match(src, /scope="col"/)
    assert.match(src, /<caption className="sr-only">/)
  })

  it('exposes sort state via aria-sort, not the arrow glyph alone', () => {
    assert.match(src, /aria-sort=\{ariaSort\(key\)\}/)
    assert.match(src, /'ascending'/)
    assert.match(src, /'descending'/)
    assert.match(src, /'none'/)
    assert.match(src, /aria-hidden="true">\{arrow\(key\)\}/, 'the glyph is decorative, the aria-sort is authoritative')
  })

  it('makes sortable headers real keyboard-operable buttons', () => {
    const thStart = src.indexOf('<th')
    const thEnd = src.indexOf('</thead>')
    assert.match(src.slice(thStart, thEnd), /<button\s+type="button"\s+onClick=\{\(\) => toggleSort\(key\)\}/)
  })

  it('labels every filter control', () => {
    assert.match(src, /role="group" aria-label=\{t\.stocks\.filters\}/)
    assert.match(src, /aria-label=\{t\.stocks\.sectorFilter\}/)
    assert.match(src, /ariaLabel=\{t\.common\.search\}/)
    assert.match(searchSrc, /aria-label=\{ariaLabel \?\? placeholder\}/)
  })

  it('announces the filtered result count politely', () => {
    assert.match(src, /aria-live="polite"/)
  })

  it('marks decorative glyphs aria-hidden', () => {
    assert.match(src, /aria-hidden>⤓<\/span>/)
    assert.equal(count(src, 'aria-hidden="true"'), 2, 'sort arrow + select chevron')
    assert.equal(count(searchSrc, 'aria-hidden="true"'), 1, 'the search glyph')
  })

  it('never conveys change direction by colour alone (sign is always printed)', () => {
    assert.match(src, /formatPct\(dayPct\)/)
    assert.match(src, /formatPct\(s\.ytdChangePct\)/)
  })

  it('keeps the visible focus ring (no outline suppression beyond the token ring)', () => {
    assert.ok(!/focus:outline-none(?!.*focus:border-accent)/.test(searchSrc))
    assert.match(searchSrc, /focus:border-accent/)
  })
})

// ─── Responsive ──────────────────────────────────────────────────────────────

describe('Phase 5A — responsive guarantees', () => {
  it('keeps the full-width page container with no page-level max-width', () => {
    assert.match(src, /<div className="w-full">/)
    assert.ok(!src.includes('max-w-screen-xl'))
  })

  it('scrolls the dense table inside its card at the same 760px floor', () => {
    assert.match(src, /minWidth=\{760\}/)
    assert.match(read('src/components/fable/TableCard.tsx'), /overflow-x-auto/)
  })

  it('lets the toolbar wrap rather than widen the page', () => {
    assert.match(src, /flex flex-wrap items-center gap-2\.5 w-full/)
    assert.match(src, /flex flex-wrap items-center gap-2\.5 min-w-0/)
  })

  it('lets the search field shrink instead of holding a fixed pixel width', () => {
    assert.match(searchSrc, /min-w-0 flex-1/)
    assert.match(searchSrc, /maxWidth: width/)
    assert.ok(!/style=\{\{ width \}\}/.test(searchSrc), 'the old fixed width is gone')
  })

  it('reintroduces no root min-width', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /html\s*\{[^}]*min-width/s)
  })
})

// ─── Localisation ────────────────────────────────────────────────────────────

describe('Phase 5A — English and Spanish complete', () => {
  const NEW_KEYS = ['filters:', 'sectorFilter:', 'sortBy:']

  for (const key of NEW_KEYS) {
    it(`stocks.${key.replace(':', '')} exists in both dictionaries`, () => {
      assert.ok(count(i18n, key) >= 2, `${key} must be present in dict.en and dict.es`)
    })
  }

  it('adds no hardcoded visible English string to the page', () => {
    // Every rendered word comes from the dictionary; the only literal glyphs
    // are the decorative arrows/chevron and the em dash placeholder.
    const literals = src.match(/>[A-Za-z][A-Za-z .,'()/-]{3,}</g) ?? []
    assert.deepEqual(literals, [], `unlocalised literal(s): ${literals.join(' | ')}`)
  })

  it('keeps the Spanish sector-filter and sort labels distinct from English', () => {
    assert.match(i18n, /sectorFilter: 'Filtro de sector'/)
    assert.match(i18n, /sortBy:\s+'Ordenar por'/)
    assert.match(i18n, /filters:\s+'Filtros'/)
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5A — scope held', () => {
  it('changes no API contract from the page', () => {
    assert.equal(count(src, 'fetch('), 0, 'the page never calls fetch directly')
    assert.match(src, /from '@\/lib\/data\/marketData'/, 'it still goes through the client-safe helper')
  })

  it('imports no server-only provider module', () => {
    assert.ok(!/@\/lib\/providers\/(?!market\/types|types)/.test(src), 'only the type-only provider imports are allowed')
    assert.ok(!src.includes('@/lib/db/'))
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('redesigns no page that has not had its own phase', () => {
    // Phase 5A is /stocks only. SearchInput is in scope solely because /stocks
    // is its only consumer in the whole repo (verified below).
    //
    // `/watchlist` was removed from this list in Phase 5B, `/compare` in
    // Phase 5D, `/macro` in Phase 5F, `/earnings` in Phase 5G, and
    // `/portfolio` in Phase 5H, each migrated to `TableCard` under its own
    // brief — real phase boundaries moving, not a relaxed assertion. They are
    // guarded by `tests/fableWatchlistPage.test.ts` /
    // `tests/fableComparePage.test.ts` / `tests/fableMacroPage.test.ts` /
    // `tests/fableEarningsPage.test.ts` / `tests/fablePortfolioPage.test.ts`.
    // `/` (Home) was removed from this list in Phase R10 — the last remaining
    // pre-Fable route, migrated to `TableCard` under its own brief; a real
    // phase boundary moving, not a relaxed assertion. It is guarded by
    // `tests/fableHomePage.test.ts`. The canonical route itself must remain.
    assert.ok(existsSync(join(ROOT, 'src/app/page.tsx')), 'src/app/page.tsx must still exist')
  })

  it('SearchInput is consumed only by /stocks', () => {
    assert.match(src, /import \{ SearchInput \}/)
    for (const other of ['src/app/page.tsx', 'src/app/watchlist/page.tsx', 'src/app/compare/page.tsx']) {
      assert.ok(!read(other).includes('SearchInput'), 'restyling SearchInput must not reach another page')
    }
  })

  it('leaves access control to the shared policy (Stocks is now private)', async () => {
    // R1.5 made Nevada Market Intelligence default-deny: middleware no longer
    // carries PROTECTED_PAGES/PROTECTED_API, and this route is now PRIVATE like
    // every other application page. The original intent of this test — that the
    // page phase itself changed no access rule — is preserved by asserting the
    // route's classification comes from the shared policy.
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/stocks'), 'private_page')
    assert.ok(!read('src/middleware.ts').includes("'/stocks'"), 'never named in middleware')
  })
})
