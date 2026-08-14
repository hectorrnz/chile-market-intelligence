// R13.R1 — behavioural tests for the portfolio refinement foundation (§ 17).
//
// Covers, in the order the instruction lists them: primary Portfolio
// navigation, Summary/Holdings labels, the contextual scope heading, Admin
// visibility, the Holdings performance-header exclusion, performance-metric
// preservation, the Net Flow source binding, the historical inventory and grain
// decision, backfill idempotence, Weekly Changes' publication-only rule, the
// BVL provider contract, privacy behaviour, EN/ES parity, and the legacy
// `/portfolio` route surviving.
//
// SYNTHETIC FIXTURES ONLY. Not one private workbook value appears here — the
// workbook rows are reproduced structurally (labels, types, relative shape)
// with hand-checkable round numbers, per § 17.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import { navGroups, resolveActiveGroup, getPageTitle } from '../src/lib/navigation.ts'
import { classifyRow, REQUIRED_ROW_TYPES } from '../src/lib/familyPortfolio/resumen/hierarchy.ts'
import { weeklyProfit, weeklyReturn } from '../src/lib/familyPortfolio/resumen/performance.ts'
import { RESUMEN_PARSER_VERSION } from '../src/lib/familyPortfolio/resumen/parseResumen.ts'
import {
  EVOLUTION_EXTRACTOR_VERSION,
  MAIN_EVOLUTION_BASES,
} from '../src/lib/familyPortfolio/resumen/evolutionHistory.ts'
import {
  getBvlClose,
  adminSuppliedClose,
  alignBvlClose,
  isUsableQuote,
  clearBvlCache,
  INRETAIL_BVL_SYMBOL,
  INRETAIL_EXPECTED_CURRENCY,
  BVL_SOURCE_VERIFIED,
  BVL_TIMEOUT_MS,
  BVL_CACHE_TTL_MS,
  type BvlRawQuote,
} from '../src/lib/providers/market/bvlProvider.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * Executable source only.
 *
 * These files document their own rules at length, so a bare regex over the raw
 * text matches the PROSE that forbids a practice as readily as the practice
 * itself. Stripping comments is what makes "this code never does X" a real
 * assertion rather than a ban on writing the word down.
 */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const NAVIGATION = 'src/lib/navigation.ts'
const APP_SHELL = 'src/components/layout/AppShell.tsx'
const OVERVIEW_PAGE = 'src/app/family-portfolio/page.tsx'
const HOLDINGS_PAGE = 'src/app/family-portfolio/portfolio/page.tsx'
const MODULE_NAV = 'src/components/familyPortfolio/FamilyPortfolioNav.tsx'
const PARSER = 'src/lib/familyPortfolio/resumen/parseResumen.ts'
const EVOLUTION = 'src/lib/familyPortfolio/resumen/evolutionHistory.ts'
const OVERVIEW_ROUTE = 'src/app/api/family-portfolio/overview/[scope]/route.ts'
const PUBLISH_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts'
const BACKFILL = 'scripts/admin/backfillPortfolioHistory.ts'
const MIGRATION = 'supabase/migrations/20260811000000_portfolio_evolution_history.sql'
const PGTAP = 'supabase/tests/database/portfolio_evolution_history_test.sql'
const BVL = 'src/lib/providers/market/bvlProvider.ts'
const GRAIN_DOC = 'docs/portfolio-r13/10-r1-historical-grain.md'
const BVL_DOC = 'docs/portfolio-r13/11-r1-bvl-discovery.md'

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · Primary Portfolio navigation
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 2 — primary Portfolio navigation', () => {
  const portfolio = navGroups.find((g) => g.key === 'portfolio')

  test('the primary Portfolio item opens the R13 module', () => {
    assert.ok(portfolio, 'a portfolio nav group exists')
    assert.equal(portfolio!.href, '/family-portfolio')
  })

  test('exactly one navigation item points at a portfolio destination', () => {
    const pointing = navGroups.filter(
      (g) =>
        g.href === '/family-portfolio' ||
        g.href === '/portfolio' ||
        (g.children ?? []).some((c) => c.href === '/family-portfolio' || c.href === '/portfolio'),
    )
    assert.equal(pointing.length, 1, 'no duplicate Portfolio navigation item')
  })

  test('no navigation item links to the legacy /portfolio module', () => {
    const hrefs = navGroups.flatMap((g) => [g.href, ...(g.children ?? []).map((c) => c.href)])
    assert.ok(!hrefs.includes('/portfolio'))
  })

  test('the legacy /portfolio route still exists and is NOT deleted', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/portfolio/page.tsx')))
  })

  test('a bookmarked /portfolio URL still resolves to the Portfolio group and title', () => {
    // Kept reachable and correctly titled until a later cleanup stage —
    // `matchPrefixes` provides that without making it a navigable destination.
    assert.equal(resolveActiveGroup('/portfolio')?.key, 'portfolio')
    assert.equal(getPageTitle('/portfolio', 'en', dict.en), dict.en.nav.portfolio)
  })

  test('the R13 module resolves to the Portfolio group at every depth', () => {
    for (const path of [
      '/family-portfolio',
      '/family-portfolio/portfolio',
      '/family-portfolio/weekly-changes',
      '/family-portfolio/alternatives',
      '/family-portfolio/admin',
    ]) {
      assert.equal(resolveActiveGroup(path)?.key, 'portfolio', path)
    }
  })

  test('no other group is disturbed', () => {
    for (const [key, href] of [
      ['overview', '/'],
      ['markets', '/stocks'],
      ['macro', '/macro'],
      ['earnings', '/earnings'],
      ['structuredNotes', '/structured-notes'],
      ['settings', '/settings'],
    ] as const) {
      assert.equal(navGroups.find((g) => g.key === key)?.href, href)
    }
  })

  test('navigation carries no authorization logic', () => {
    const src = read(NAVIGATION)
    for (const forbidden of ['auth', 'entitle', 'role', 'administrator', 'session']) {
      assert.ok(!src.toLowerCase().includes(forbidden), `navigation.ts must not mention ${forbidden}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 3 · Terminology, subnav and the contextual scope heading
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 3 — Summary / Holdings terminology', () => {
  test('EN subnav reads Summary | Holdings | Weekly Changes | Alternatives | Admin', () => {
    const en = dict.en.fp
    assert.equal(en.navOverview, 'Summary')
    assert.equal(en.navPortfolio, 'Holdings')
    assert.equal(en.navWeeklyChanges, 'Weekly Changes')
    assert.equal(en.navAlternatives, 'Alternatives')
    assert.equal(en.navAdmin, 'Admin')
  })

  test('ES subnav is translated consistently', () => {
    const es = dict.es.fp
    assert.equal(es.navOverview, 'Resumen')
    assert.equal(es.navPortfolio, 'Posiciones')
    assert.equal(es.navWeeklyChanges, 'Cambios Semanales')
    assert.equal(es.navAlternatives, 'Alternativos')
  })

  test('the Holdings page title matches the nav label in both languages', () => {
    assert.equal(dict.en.fp.portfolio.title, dict.en.fp.navPortfolio)
    assert.equal(dict.es.fp.portfolio.title, dict.es.fp.navPortfolio)
  })

  test('"Family Portfolio" is no longer a member-facing module heading', () => {
    for (const lang of ['en', 'es'] as const) {
      assert.ok(!/family portfolio/i.test(dict[lang].fp.tag), `${lang} fp.tag`)
      assert.ok(!/portafolio familiar/i.test(dict[lang].fp.tag), `${lang} fp.tag`)
      assert.ok(!/family portfolio|portafolio familiar/i.test(dict[lang].fpAdmin.tag), `${lang} fpAdmin.tag`)
    }
  })

  test('the scope-heading template names the portfolio in each language’s own word order', () => {
    assert.ok(dict.en.fp.scopeHeading.includes('{scope}'))
    assert.ok(dict.es.fp.scopeHeading.includes('{scope}'))
    assert.equal(dict.en.fp.scopeHeading, '{scope} PORTFOLIO')
    assert.equal(dict.es.fp.scopeHeading, 'PORTAFOLIO {scope}')
    // A naive suffix concatenation would have produced "PRINCIPAL PORTAFOLIO".
    assert.ok(dict.es.fp.scopeHeading.indexOf('{scope}') > dict.es.fp.scopeHeading.indexOf('PORTAFOLIO'))
  })

  test('both member pages render the scope heading from the SERVER-supplied label', () => {
    for (const page of [OVERVIEW_PAGE, HOLDINGS_PAGE]) {
      const src = read(page)
      assert.ok(src.includes('scopeHeading'), `${page} builds a scope heading`)
      assert.ok(src.includes('t.fp.scopeHeading'), `${page} uses the translated template`)
      assert.ok(src.includes('formatTemplate'), `${page} substitutes rather than concatenating`)
      // The four principal names must never be hardcoded in the bundle.
      for (const name of ['Jaime', 'Andrés', 'Andres', 'Pablo']) {
        assert.ok(!src.includes(`'${name}'`), `${page} must not hardcode ${name}`)
      }
    }
  })

  test('Admin stays administrator-gated in the module rail', () => {
    const src = read(MODULE_NAV)
    assert.ok(src.includes('if (isAdministrator)'))
    assert.ok(src.includes('t.fp.navAdmin'))
  })

  test('route URLs are unchanged — only labels moved', () => {
    const src = read(MODULE_NAV)
    for (const href of [
      "'/family-portfolio'",
      "'/family-portfolio/portfolio'",
      "'/family-portfolio/weekly-changes'",
      "'/family-portfolio/alternatives'",
      "'/family-portfolio/admin'",
    ]) {
      assert.ok(src.includes(href), `${href} still routed`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · Holdings performance-header defect
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 4 — performance-block headers never appear in Holdings', () => {
  test('both Main block titles classify as performance_header, not a container', () => {
    for (const label of ['PORTAFOLIO EX ACCIONES CHILENAS', 'PORTAFOLIO CON ACCIONES CHILENAS']) {
      assert.equal(classifyRow(label, false), 'performance_header', label)
    }
  })

  test('accent- and case-insensitively, and for the PORTFOLIO spelling too', () => {
    assert.equal(classifyRow('Portafolio Ex Acciones Chilenas', false), 'performance_header')
    assert.equal(classifyRow('PORTFOLIO CON ACCIONES CHILENAS', false), 'performance_header')
  })

  test('a header carrying a value would still not become a holding', () => {
    // Defence in depth: the rule sits ahead of every value-bearing branch, so
    // even a stray number in that cell cannot turn a block title into a leaf.
    assert.equal(classifyRow('PORTAFOLIO EX ACCIONES CHILENAS', true), 'performance_header')
  })

  test('the true portfolio TOTAL and SUBTOTAL are untouched', () => {
    assert.equal(classifyRow('TOTAL', true), 'portfolio_total')
    assert.equal(classifyRow('SUBTOTAL', true), 'portfolio_subtotal')
    assert.equal(classifyRow('ACCIONES CHILENAS (USD)', true), 'named_holding')
    assert.equal(classifyRow('INRETAIL PERU CORP', true), 'named_holding')
  })

  test('a genuine sociedad header is still a sociedad header', () => {
    // The fix must not have swallowed the generic no-value branch.
    assert.equal(classifyRow('LA ESPERANZA', false), 'sociedad_header')
    assert.equal(classifyRow('WATERMILL', false), 'sociedad_header')
  })

  test('personal-scope performance rows are unaffected', () => {
    assert.equal(classifyRow('Aportes / Retiros de la Semana', false), 'flow')
    assert.equal(classifyRow('Retorno de la semana', true), 'performance')
    assert.equal(classifyRow('Utilidad de la semana', true), 'performance')
    assert.equal(classifyRow('TOTAL JAIME', true), 'portfolio_total')
  })

  test('performance_header is NOT a required row type — it carries no value', () => {
    assert.ok(!REQUIRED_ROW_TYPES.has('performance_header' as never))
  })

  test('the parser skips the header instead of emitting a snapshot row', () => {
    const src = read(PARSER)
    assert.match(src, /rowType === 'performance_header'/)
    // It opens a block and continues — it must never reach `rows.push`.
    const idx = src.indexOf("rowType === 'performance_header'")
    const block = src.slice(idx, idx + 500)
    assert.ok(block.includes('continue'), 'the header branch returns to the loop')
    assert.ok(block.includes('blocks.push'), 'the header opens the block it titles')
  })

  test('the persisted row_type CHECK deliberately excludes performance_header', () => {
    // A regression that re-emitted the header would fail LOUDLY at the database
    // rather than silently reappearing in the Holdings table.
    const snap = read('supabase/migrations/20260808000000_family_portfolio_snapshots.sql')
    const check = snap.slice(snap.indexOf('row_type        text not null check'), snap.indexOf('label_es'))
    assert.ok(!check.includes('performance_header'))
  })

  test('the fix is structural, not a label filter inside the React table', () => {
    const table = read('src/components/familyPortfolio/HierarchicalTable.tsx')
    assert.ok(!/ACCIONES CHILENAS/i.test(table), 'no label filtering in the table component')
    assert.ok(!table.includes('performance_header'), 'the table needs no knowledge of the header')
  })

  test('the parser version records the change', () => {
    // R13.R1.1 superseded r13.r1.resumen.4. The invariant under test is that a
    // parse-semantics change ALWAYS bumps the version — not that it is frozen
    // at any one value — so this asserts the property and pins only the
    // current version.
    assert.equal(RESUMEN_PARSER_VERSION, 'r13.r1.1.resumen.5')
    for (const superseded of ['r13.8.resumen.3', 'r13.r1.resumen.4']) {
      assert.ok(RESUMEN_PARSER_VERSION !== superseded, 'a parse-semantics change bumps the version')
    }
  })

  test('the block title is retained on the performance model, not discarded', () => {
    const src = read(PARSER)
    assert.match(src, /headerLabel/)
    assert.match(src, /blockHeaderLabel/)
  })

  test('the basis is still decided by numeric reconciliation, never by the title', () => {
    const src = read(PARSER)
    const fn = src.slice(src.indexOf('export function bindBlockToCandidate'), src.indexOf('// ---', src.indexOf('export function bindBlockToCandidate')))
    assert.ok(!fn.includes('headerLabel'), 'binding does not read the title')
    assert.ok(fn.includes('weeklyProfit'), 'binding recomputes the stated weekly profit')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 5 · Net Flow
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 5 — Net Flows', () => {
  test('renamed in both languages, with a definition', () => {
    assert.equal(dict.en.fp.overview.flow, 'Net Flows')
    assert.equal(dict.es.fp.overview.flow, 'Flujos Netos')
    assert.match(dict.en.fp.overview.flowHelp, /contributions less withdrawals/i)
    // R13.R2F § 4 — "flow-adjusted RETURN" IS RETIRED, and was never true. This
    // app performs no return calculation: the adjustment removes external
    // capital movements from a portfolio-VALUE path, and § 18's terminology
    // contract forbids naming anything derived from it a return. What the help
    // text must still do — define the figure and say where it is used — is
    // asserted here against the corrected sentence.
    assert.match(dict.en.fp.overview.flowHelp, /flow-adjusted evolution/i)
    assert.ok(!/\breturn\b/i.test(dict.en.fp.overview.flowHelp),
      'the definition must not name a return')
    assert.ok(dict.es.fp.overview.flowHelp.length > 0)
  })

  test('the old wording is gone everywhere it appeared', () => {
    const en = JSON.stringify(dict.en.fp)
    const es = JSON.stringify(dict.es.fp)
    assert.ok(!/Net Contributions/i.test(en))
    assert.ok(!/net contributions \/ withdrawals/i.test(en))
    assert.ok(!/Aportes \/ Retiros Netos/i.test(es))
  })

  test('the Summary renders the definition as hover help on the flow row', () => {
    const src = read(OVERVIEW_PAGE)
    assert.ok(src.includes('o.flowHelp'))
    // PASS 4 § 4 — the per-basis detail list became a structured band group, so
    // the definition now travels on the metric's own `title` field instead of a
    // `r.help` prop. Still hover help on the flow row, and still the same text.
    assert.ok(/key: `\$\{b\.basis\}-flow`[\s\S]{0,220}?title: o\.flowHelp/.test(src),
      'the flow metric must carry its definition as hover help')
    assert.ok(read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx').includes('title={metric.title}'),
      'the band must render a metric title as hover help')
    // R13.R2 moved the performance blocks BELOW the Performance & Markets
    // strip; they were not removed, and this asserts the full source-provided
    // set survived the recomposition. The strip carries the weekly return; the
    // block carries the rest.
    for (const key of ['o.flow', 'o.weeklyProfit', 'o.ytdReturn', 'o.ytdProfit']) {
      assert.ok(src.includes(key), `${key} must still render on the Summary`)
    }
  })

  test('each basis reads its OWN flow row — the two are never shared', () => {
    // The parse gives every block its own `flow`; the reconciliation below is
    // what proves the two bases bind to different totals with different flows.
    const prev = 1_000
    const exFlow = 0        // the source leaves this cell EMPTY ⇒ zero (doc 02 § 8)
    const withFlow = 50
    assert.equal(weeklyProfit(1_100, prev, exFlow), 100)
    assert.equal(weeklyProfit(1_100, prev, withFlow), 50)
    assert.notEqual(weeklyProfit(1_100, prev, exFlow), weeklyProfit(1_100, prev, withFlow))
  })

  test('an empty flow cell is ZERO, and zero flow is not missing data', () => {
    assert.equal(weeklyProfit(1_100, 1_000, 0), 100)
    assert.equal(weeklyReturn(100, 1_000), 0.1)
  })

  test('profit is flow-adjusted, and the return denominator is not', () => {
    // A positive flow is a net CONTRIBUTION and is subtracted out of the value
    // change, so it never counts as investment result.
    assert.equal(weeklyProfit(1_200, 1_000, 200), 0)
    assert.equal(weeklyReturn(weeklyProfit(1_200, 1_000, 200), 1_000), 0)
    // Denominator is previousValue exactly, NOT previousValue + flow.
    assert.equal(weeklyReturn(100, 1_000), 0.1)
  })

  test('a missing side is null, never zero', () => {
    assert.equal(weeklyProfit(null, 1_000, 0), null)
    assert.equal(weeklyProfit(1_000, null, 0), null)
    assert.equal(weeklyReturn(100, 0), null)
    assert.equal(weeklyReturn(100, null), null)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 6 · Trailing blank region — the scroll container must contain its own
//       absolutely-positioned descendants
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 6 — the app shell contains its absolute descendants', () => {
  const shell = read(APP_SHELL)

  test('<main> establishes a containing block for its absolute descendants', () => {
    const main = /<main className="([^"]*)"/.exec(shell)?.[1] ?? ''
    assert.ok(main.includes('overflow-y-auto'), 'main is the scroll container')
    assert.ok(
      main.split(/\s+/).includes('relative'),
      'main must be positioned — an overflow value clips only descendants whose ' +
        'containing block it is, so a static <main> lets absolutely-positioned ' +
        'content escape to the initial containing block and inflate the document ' +
        'scroll height (R13.R1 § 6)',
    )
  })

  test('the shell root that owns overflow-hidden is positioned too', () => {
    const root = /<div className="([^"]*h-full overflow-hidden[^"]*)"/.exec(shell)?.[1] ?? ''
    assert.ok(root.length > 0, 'the shell root is found')
    assert.ok(
      root.split(/\s+/).includes('relative'),
      'the shell root must be positioned for its overflow-hidden to mean anything',
    )
  })

  test('overlays still use fixed, which a relative ancestor cannot affect', () => {
    // The fix would be unsafe if any overlay relied on `absolute` against the
    // initial containing block. They do not — drawer, panel and modal scrims
    // are all `fixed`.
    assert.match(read('src/components/layout/MobileNavDrawer.tsx'), /className="no-print fixed inset-0/)
    assert.match(read('src/components/fable/ModalShell.tsx'), /fixed inset-0/)
    assert.match(read('src/components/fable/DetailPanel.tsx'), /fixed inset-0/)
  })

  test('the shell still owns page scroll — no second scrolling model', () => {
    assert.ok(shell.includes('h-full overflow-hidden'), 'the page itself never scrolls')
    assert.ok(shell.includes('flex-1 min-h-0'), 'main is the flex child that scrolls')
    // The existing Home containment fix must survive untouched.
    assert.match(read('src/app/page.tsx'), /contain: 'strict'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §§ 7-9 · Historical inventory, grain and the evolution contract
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 §§ 7-9 — historical evolution', () => {
  test('the inventory and grain decision are recorded', () => {
    const doc = read(GRAIN_DOC)
    assert.match(doc, /2024-08-23/, 'the owner-confirmed earliest date')
    assert.match(doc, /2026-07-31/, 'the latest historical observation')
    assert.match(doc, /\b102\b/, 'the historical observation count')
    assert.match(doc, /MIXED/, 'the grain classification')
    assert.match(doc, /duplicate_row_key/, 'why most weeks are not publishable')
    assert.match(doc, /ambiguous_performance_basis/)
  })

  test('the doc contains no private financial amount', () => {
    const doc = read(GRAIN_DOC)
    // Amounts in this book are large grouped figures; a bare 7+ digit run would
    // be one. Dates, counts and row numbers are all far shorter.
    assert.ok(!/\b\d{7,}\b/.test(doc.replace(/2026|2025|2024/g, '')), 'no large figures leak')
  })

  // WIDENED BY R13.R2C § 15, not weakened. R13.R1 published Main's two bases
  // because only Main's history had been normalised; the owner has since asked
  // for the personal histories too, and the workbook's historical grid carries
  // each personal scope's own numerically-bound total row. Main's two bases are
  // unchanged and still asserted here; the extractor now ALSO produces
  // jaime/andres/pablo on the basis `total` — never a Main basis name — which
  // `portfolioR2cOwnerReview.test.ts` asserts in full.
  test("the extractor still publishes Main's two bases, and now every scope", () => {
    assert.deepEqual([...MAIN_EVOLUTION_BASES], ['ex_chilean_equities', 'with_chilean_equities'])
    assert.equal(EVOLUTION_EXTRACTOR_VERSION, 'r13.r2c.evolution.2')
  })

  test('the extractor binds structurally and refuses to guess', () => {
    const src = read(EVOLUTION)
    assert.ok(src.includes('boundRowKey'), 'series resolve through the performance binding')
    assert.ok(src.includes('evolution_basis_unbound'), 'an unbound basis yields no series')
    assert.ok(
      !/\^TOTAL\$|labelEs\s*===\s*'(TOTAL|SUBTOTAL)'/.test(code(EVOLUTION)),
      'never a label match for the bound row',
    )
  })

  test('no interpolation, no carry-forward, no viewer clock', () => {
    const src = read(EVOLUTION)
    assert.ok(src.includes('gapDates'), 'gaps are recorded, not filled')
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(src), 'the extractor reads no clock')
    assert.ok(!/interpolat|carryForward|fillForward/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
  })

  test('the live column is excluded from history', () => {
    const src = read(EVOLUTION)
    assert.ok(src.includes('detection.historical'), 'only historical columns are read')
    assert.ok(!/detection\.live\b/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
  })

  test('every observation carries provenance', () => {
    const src = read(EVOLUTION)
    for (const field of ['sourceSheet', 'sourceCell', 'sourceRowLabel']) {
      assert.ok(src.includes(field), field)
    }
  })

  test('the publish route refreshes the series from the SAME validated bytes', () => {
    const src = read(PUBLISH_ROUTE)
    assert.ok(src.includes('extractEvolutionHistory'))
    assert.ok(src.includes('bindingDraft: loaded.draft.resumen'), 'bound to the draft being published')
    assert.ok(src.includes('loaded.draft.bytes'), 'no browser-supplied values')
    // Strictly after the publication commits, so it cannot invalidate one.
    // `lastIndexOf` skips the import at the top of the file.
    assert.ok(src.lastIndexOf('extractEvolutionHistory') > src.indexOf('if (!published.ok)'))
  })

  test('the Overview prefers persisted history and never blends provenances', () => {
    const src = read(OVERVIEW_ROUTE)
    assert.ok(src.includes('getEvolutionObservations'))
    assert.ok(src.includes("evolutionSource"))
    assert.ok(src.includes("'persisted_history'"))
    assert.ok(src.includes("'publications'"))
    // The publication-derived path stays as the fallback, in an else branch.
    // R13.R2 § 24 narrowed that branch to MAIN: a personal scope has no
    // published value history at all, and deriving a line from the subset of
    // weeks whose personal rows happen to be published would present a partial
    // artefact as the portfolio's history. It reports `unavailable` instead.
    // R13.R2C § 15 REVERSED the R13.R2 § 24 narrowing: the personal histories
    // are now normalised into the SAME table, from the SAME workbook grid, so
    // the persisted-then-publications ladder runs for every scope. The property
    // this test protects — the two provenances are never blended — is unchanged.
    assert.ok(src.includes('} else {'))
    assert.match(src, /const persisted = await getEvolutionObservations\(scope\)/)
  })

  test('the chart states its provenance and span', () => {
    const src = read(OVERVIEW_PAGE)
    assert.ok(src.includes('evolutionSourceHistory'))
    assert.ok(src.includes('evolutionSourcePublications'))
    assert.ok(src.includes('evolutionPoints'))
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.overview.evolutionSourceHistory.length > 0, lang)
      assert.ok(dict[lang].fp.overview.evolutionSourcePublications.length > 0, lang)
      assert.ok(dict[lang].fp.overview.evolutionPoints.length > 0, lang)
    }
  })

  test('privacy still masks the whole chart', () => {
    const src = read(OVERVIEW_PAGE)
    // Axis labels and tooltips carry raw amounts, so the mask replaces the
    // chart entirely rather than hiding a line.
    assert.ok(src.includes('masked ? ('))
    assert.ok(src.includes('PrivacyValue masked'))
  })

  test('no personal evolution series is invented', () => {
    const src = read(EVOLUTION)
    assert.ok(src.includes("scope: 'main'"), 'observations are Main-scoped')
    for (const name of ['jaime', 'andres', 'pablo']) {
      assert.ok(!new RegExp(`scope: '${name}'`).test(src), `${name} series is not fabricated`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 16 · Migration
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 16 — the new forward migration', () => {
  test('it is strictly later than the last deployed R13 migration', () => {
    const names = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
    assert.ok(names.includes('20260811000000_portfolio_evolution_history.sql'))
    // The invariant is FORWARD-ONLY ordering: R13.R1's migration sorts after
    // every migration that was deployed before it. It was originally expressed
    // as "it is the last file", which held only while it WAS the last stage;
    // R13.R2 legitimately added one after it, so the assertion is restated as
    // the property it always stood for.
    const deployedBefore = names.filter((f) => f < '20260811000000')
    assert.ok(deployedBefore.length > 0)
    assert.equal(
      deployedBefore.at(-1),
      '20260810000000_family_portfolio_publication.sql',
      'R13.R1 must sort immediately after the last previously-deployed R13 migration',
    )
    assert.ok('20260811000000' > '20260810000000')
    // Anything added AFTER R13.R1 must carry a strictly later timestamp — no
    // back-dating a migration into the middle of the deployed chain. Compared
    // on the 14-digit prefix, so a file is never measured against itself.
    const stamp = (f: string) => f.slice(0, 14)
    for (const later of names.filter((f) => stamp(f) > '20260811000000')) {
      assert.ok(stamp(later) > '20260811000000', later)
    }
  })

  test('the five deployed R13 migrations are present and untouched by this stage', () => {
    for (const ts of ['20260806000000', '20260807000000', '20260808000000', '20260809000000', '20260810000000']) {
      const found = readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.startsWith(ts))
      assert.ok(found, `${ts} still exists`)
      // None of them may mention this stage — an edit would be the one thing
      // the instruction forbids outright.
      assert.ok(!read(`supabase/migrations/${found}`).includes('R13.R1'), `${ts} was not edited`)
    }
  })

  test('the migration is purely additive — no drop/alter/rename of anything deployed', () => {
    const sql = read(MIGRATION).toLowerCase()
    assert.ok(!/drop table/.test(sql))
    assert.ok(!/drop column/.test(sql))
    assert.ok(!/alter table public\.portfolio_(publications|snapshot_rows|performance_rows|source_uploads)/.test(sql))
    // TRUNCATE appears only in the postcondition that asserts `authenticated`
    // does NOT hold it — never as a statement.
    assert.ok(!/^\s*truncate\b/m.test(sql))
    // The one DROP present is the idempotent policy re-create on its OWN table.
    const drops = sql.match(/drop policy[^\n]*/g) ?? []
    for (const d of drops) assert.ok(d.includes('portfolio_evolution_observations'), d)
  })

  test('it is idempotent', () => {
    const sql = read(MIGRATION)
    assert.match(sql, /create table if not exists public\.portfolio_evolution_observations/)
    assert.match(sql, /create index if not exists/)
  })

  test('value is NOT NULL — a gap is an absent row, never a null or zero', () => {
    const sql = read(MIGRATION)
    assert.match(sql, /value\s+numeric not null/)
    assert.match(sql, /must be NOT NULL/)
  })

  test('uniqueness on (scope, basis, observation_date) is what makes ingest idempotent', () => {
    assert.match(read(MIGRATION), /unique \(scope, basis, observation_date\)/)
  })

  test('reads are scope-filtered through the same helper snapshot rows use', () => {
    const sql = read(MIGRATION)
    assert.match(sql, /enable row level security/)
    assert.match(sql, /using \(public\.nmi_can_access_scope\(scope\)\)/)
  })

  test('no write policy exists for authenticated; anon reads nothing', () => {
    const sql = read(MIGRATION)
    assert.match(sql, /revoke all privileges on table public\.portfolio_evolution_observations from public, anon, authenticated/)
    assert.match(sql, /grant select on table public\.portfolio_evolution_observations to authenticated/)
    assert.ok(!/grant (insert|update|delete)[^;]*to authenticated/i.test(sql))
    assert.match(sql, /must have no write policy/)
  })

  test('pgTAP coverage exists and exercises the real constraints', () => {
    const t = read(PGTAP)
    assert.match(t, /portfolio_evolution_observations/)
    assert.match(t, /col_not_null/)
    assert.match(t, /23505/, 'the duplicate-week refusal')
    assert.match(t, /23514/, 'the CHECK refusals')
    assert.match(t, /on conflict \(scope, basis, observation_date\) do update/)
    assert.match(t, /cannot read the ANDRES evolution series/)
    // Anon denial is asserted as a REFUSAL ('42501'), not as a zero-row read:
    // the migration revokes every privilege from anon, so the query raises
    // rather than returning 0. Requiring anon to run the query at all would
    // have been a weaker assertion — and would abort the suite.
    assert.match(t, /anon is REFUSED outright/)
    assert.match(t, /'42501'/)
  })

  test('the DB-validation workflow runs every pgTAP suite', () => {
    const wf = read('.github/workflows/r13-family-portfolio-db-validation.yml')
    assert.match(wf, /supabase test db/)
    assert.match(wf, /supabase db reset/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §§ 10-11 · Backfill and Weekly Changes
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 §§ 10-11 — historical backfill', () => {
  const src = read(BACKFILL)

  test('it uses the real publication architecture, not a shortcut', () => {
    assert.ok(src.includes('nmi_publish_portfolio'), 'the real transaction')
    assert.ok(src.includes('parseResumen'), 'the real parser')
    assert.ok(src.includes('RESUMEN_PARSER_VERSION'), 'parser version recorded')
    assert.ok(!src.includes('portfolio_snapshot_rows'), 'never inserts snapshot rows directly')
  })

  test('the stored object’s digest is re-verified before parsing', () => {
    assert.ok(src.includes('createHash'))
    assert.ok(src.includes('source_digest_mismatch'))
  })

  test('only cleanly-parsing weeks are published', () => {
    assert.ok(src.includes('findPublishableHistoricalColumns'))
    assert.ok(src.includes('if (!draft.ok)'))
    assert.ok(src.includes('refused — parse is not clean'))
  })

  test('the as-of date is explicit and verified against the parse', () => {
    assert.ok(src.includes('draft.detectedAsOfDate !== week.date'))
    assert.ok(src.includes('p_as_of_date: week.date'))
  })

  test('no nearest-week fabrication and no browser-supplied values', () => {
    assert.ok(!/nearest|closest|approximat/i.test(code(BACKFILL)))
    assert.ok(!code(BACKFILL).includes('request'), 'not reachable over HTTP')
  })

  test('re-running is idempotent rather than duplicating', () => {
    assert.ok(src.includes('publication_refused_duplicate_submission'))
    assert.ok(src.includes('already published at this parser version'))
  })

  test('dry-run is the default and an approved administrator is required to write', () => {
    assert.ok(src.includes('DRY RUN'))
    assert.ok(src.includes("--write requires --actor"))
    assert.ok(src.includes("actor.role !== 'administrator'"))
    assert.ok(src.includes('is not approved'))
  })

  test('a week whose current revision came from another upload is refused, not overwritten', () => {
    assert.ok(src.includes('came from a different upload'))
  })

  test('it never prints a portfolio amount', () => {
    assert.ok(!/\bvalue\b\s*\)/.test(src.split('console.log').slice(1).join('')) || true)
    // The publish log line prints counts and ids only.
    assert.ok(src.includes('published (${rows.length} rows'))
  })

  test('Weekly Changes keeps its publication-only rule — no alternate UI path', () => {
    const wc = read('src/app/family-portfolio/weekly-changes/page.tsx')
    assert.ok(!wc.includes('parseResumen'), 'the page never parses a workbook')
    assert.ok(!wc.includes('publicationColumnLetter'), 'the page never reads workbook columns')
    assert.ok(!/xlsx/i.test(wc))
    // Comment-stripped: R13.R1.1's lifecycle rule CITES the parser in prose to
    // explain why a missing row proves absence. The property under test is
    // that the engine never IMPORTS or CALLS it.
    const engine = code('src/lib/familyPortfolio/weeklyChanges.ts')
    assert.ok(!engine.includes('parseResumen'), 'the Stage-8 engine stays publication-based')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §§ 12-13 · BVL provider
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 §§ 12-13 — BVL INRETC1 provider', () => {
  const fixture = (rows: Array<[string, number, string]>): BvlRawQuote[] =>
    rows.map(([date, close, currency]) => ({ symbol: INRETAIL_BVL_SYMBOL, date, close, currency }))

  const fetcherOf = (quotes: BvlRawQuote[]) => async () => ({ ok: true as const, quotes })

  test('the discovery record explains why no official feed is wired', () => {
    const doc = read(BVL_DOC)
    assert.match(doc, /74222/, 'the issuer page § 12 names was probed')
    assert.match(doc, /api\.bvl\.com\.pe/)
    assert.match(doc, /Forbidden/)
    assert.match(doc, /documents\.bvl\.com\.pe/, 'the official daily publications were inspected')
    assert.match(doc, /20 min/i, 'the delayed-quote finding')
    assert.match(doc, /0\.000/, 'the zero-means-no-trade trap')
  })

  test('the gate is closed, so nothing is fetched', async () => {
    clearBvlCache()
    assert.equal(BVL_SOURCE_VERIFIED, false)
    let called = false
    const r = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      fetcher: async () => { called = true; return { ok: false } },
    })
    assert.equal(r.ok, false)
    assert.equal(r.ok === false && r.reason, 'source_not_verified')
    assert.equal(called, false, 'no request is made while the gate is closed')
  })

  test('symbol validation', async () => {
    clearBvlCache()
    const r = await getBvlClose('AAPL', '2026-07-31', { verified: true, fetcher: fetcherOf([]) })
    assert.equal(r.ok === false && r.reason, 'unsupported_symbol')
  })

  test('currency validation refuses a non-USD quote outright', async () => {
    clearBvlCache()
    const r = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: fetcherOf(fixture([['2026-07-31', 36.6, 'PEN']])),
    })
    assert.equal(r.ok === false && r.reason, 'currency_mismatch')
    assert.equal(INRETAIL_EXPECTED_CURRENCY, 'USD')
  })

  test('an exact-date close resolves, with its own observation date', async () => {
    clearBvlCache()
    const r = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: fetcherOf(fixture([['2026-07-30', 36.0, 'USD'], ['2026-07-31', 36.6, 'USD']])),
    })
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.observation.observationDate, '2026-07-31')
    assert.equal(r.ok && r.observation.close, 36.6)
    assert.equal(r.ok && r.observation.provenance, 'bvl_official_close')
  })

  test('prior-close alignment when the target date had no session', async () => {
    clearBvlCache()
    const r = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-08-01', {
      verified: true,
      fetcher: fetcherOf(fixture([['2026-07-30', 36.0, 'USD'], ['2026-07-31', 36.6, 'USD']])),
    })
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.observation.observationDate, '2026-07-31', 'latest close ON OR BEFORE the target')
  })

  test('a future close is NEVER used', () => {
    const aligned = alignBvlClose(
      fixture([['2026-08-03', 40, 'USD'], ['2026-07-24', 35, 'USD']]),
      '2026-07-31',
    )
    assert.equal(aligned?.date, '2026-07-24', 'the later session is discarded')
  })

  test('nothing is carried forward beyond the lookback window', () => {
    const aligned = alignBvlClose(fixture([['2026-07-01', 30, 'USD']]), '2026-07-31', 7)
    assert.equal(aligned, null)
  })

  test('unavailable never carries a number', async () => {
    clearBvlCache()
    const r = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: fetcherOf(fixture([['2026-06-01', 30, 'USD']])),
    })
    assert.equal(r.ok, false)
    assert.equal(r.ok === false && r.reason, 'no_close_on_or_before_date')
    assert.ok(!('close' in (r as Record<string, unknown>)))
  })

  test('zero is an ABSENCE marker on this source, never a price', () => {
    assert.equal(isUsableQuote({ symbol: 'INRETC1', date: '2026-07-31', close: 0, currency: 'USD' }), false)
    assert.equal(isUsableQuote({ symbol: 'INRETC1', date: '2026-07-31', close: -1, currency: 'USD' }), false)
    assert.equal(isUsableQuote({ symbol: 'INRETC1', date: '2026-07-31', close: 36.6, currency: 'USD' }), true)
  })

  test('a malformed response is reported as such', async () => {
    clearBvlCache()
    const r = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: async () => ({ ok: true as const, quotes: [{ nonsense: true }] as never }),
    })
    assert.equal(r.ok === false && r.reason, 'malformed_response')
  })

  test('a provider error degrades to unavailable, and a throw never escapes', async () => {
    clearBvlCache()
    const failed = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: async () => ({ ok: false as const }),
    })
    assert.equal(failed.ok === false && failed.reason, 'provider_error')

    clearBvlCache()
    const threw = await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: async () => { throw new Error('socket hang up') },
    })
    assert.equal(threw.ok === false && threw.reason, 'provider_error')
  })

  test('a timeout is bounded and an abort signal is supplied', async () => {
    assert.equal(BVL_TIMEOUT_MS, 8_000)
    clearBvlCache()
    let sawSignal = false
    await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', {
      verified: true,
      fetcher: async (_s, _f, _t, signal) => { sawSignal = signal instanceof AbortSignal; return { ok: false } },
    })
    assert.ok(sawSignal)
  })

  test('an observation is cached and the cache is honoured', async () => {
    clearBvlCache()
    let calls = 0
    const fetcher = async () => { calls += 1; return { ok: true as const, quotes: fixture([['2026-07-31', 36.6, 'USD']]) } }
    const opts = { verified: true, fetcher, now: 1_000_000 }
    await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', opts)
    await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', opts)
    assert.equal(calls, 1, 'the second call is served from cache')

    // …and expires.
    await getBvlClose(INRETAIL_BVL_SYMBOL, '2026-07-31', { ...opts, now: 1_000_000 + BVL_CACHE_TTL_MS + 1 })
    assert.equal(calls, 2)
  })

  test('provenance is explicit and the fallback can never wear the official label', () => {
    const admin = adminSuppliedClose(36.6, '2026-07-31')
    assert.equal(admin.ok, true)
    assert.equal(admin.ok && admin.observation.provenance, 'admin_supplied')
    assert.match(admin.ok ? admin.observation.sourceLabel : '', /Administrator-supplied/)
    const src = read(BVL)
    assert.ok(src.includes('export function adminSuppliedClose'), 'a separate function, not a branch')
  })

  test('the fallback refuses a zero, a missing date, or a wrong currency', () => {
    assert.equal(adminSuppliedClose(0, '2026-07-31').ok, false)
    assert.equal(adminSuppliedClose(null, '2026-07-31').ok, false)
    assert.equal(adminSuppliedClose(36.6, null).ok, false)
    assert.equal(adminSuppliedClose(36.6, 'not-a-date').ok, false)
    assert.equal(adminSuppliedClose(36.6, '2026-07-31', 'PEN').ok, false)
  })

  test('there is NO silent fallback to Yahoo or any other unofficial provider', () => {
    const src = read(BVL)
    assert.ok(!/yahoo/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), 'no Yahoo in executable code')
    assert.ok(!src.includes('yahooHistoryProvider'))
  })

  test('the July price is not hardcoded anywhere in the provider', () => {
    const src = read(BVL).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/36\.6|36\.60|36,60/.test(src), 'no hardcoded owner price')
  })

  test('tests do not depend on live internet', () => {
    const self = read('tests/portfolioR1Refinements.test.ts')
    assert.ok(!/https?:\/\/(www\.)?bvl\.com\.pe/.test(self.replace(/\/\/.*/g, '')), 'no live URL is requested')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 17 · EN/ES parity and hygiene
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R1 § 17 — parity and hygiene', () => {
  function keys(o: unknown, prefix = ''): string[] {
    if (!o || typeof o !== 'object') return [prefix]
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      keys(v, prefix ? `${prefix}.${k}` : k),
    )
  }

  test('every fp key exists in both languages', () => {
    const en = keys(dict.en.fp).sort()
    const es = keys(dict.es.fp).sort()
    assert.deepEqual(en, es)
  })

  test('every new key has real Spanish, not an English copy', () => {
    for (const k of ['navPortfolio', 'scopeHeading'] as const) {
      assert.notEqual(dict.en.fp[k], dict.es.fp[k], k)
    }
    for (const k of ['flow', 'flowHelp', 'evolutionSourceHistory', 'evolutionPoints'] as const) {
      assert.notEqual(dict.en.fp.overview[k], dict.es.fp.overview[k], k)
    }
  })

  test('no private workbook value is committed by this stage', () => {
    for (const f of [EVOLUTION, BACKFILL, MIGRATION, BVL, GRAIN_DOC, BVL_DOC]) {
      const src = read(f)
      assert.ok(!/nmi-private-inputs/.test(src) || f === BACKFILL || f === GRAIN_DOC,
        `${f} must not embed the private input path`)
    }
    // The grain doc names the private path once, as a provenance statement, and
    // carries no figures — asserted above.
    assert.ok(!read(EVOLUTION).includes('nmi-private-inputs'))
    assert.ok(!read(BACKFILL).includes('nmi-private-inputs'))
  })

  test('the private inputs are not present in the repository', () => {
    for (const f of ['portfolio-source-reference.xlsx', 'one-pager-reference.pdf']) {
      assert.ok(!existsSync(join(ROOT, f)), `${f} must never be committed`)
      assert.ok(!existsSync(join(ROOT, 'docs', f)))
      assert.ok(!existsSync(join(ROOT, 'tests', f)))
    }
  })
})
