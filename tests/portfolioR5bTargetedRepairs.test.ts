// R13.R5B — the three targeted repairs from the owner's live visual review.
//
// Source-scan checks (no browser), the same technique `responsiveLayout.test.ts`
// uses: they cannot prove pixel geometry, but they make the load-bearing
// contracts impossible to revert silently.
//
// NO PRIVATE DATA. Nothing below carries an amount, a holding or a scope label.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Source with comments stripped — the same helper `fableHomePage.test.ts` uses.
 * A "this must not appear" assertion has to run against CODE: the comments here
 * deliberately NAME the legacy path they replaced, and matching that prose
 * would fail a passing repair.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const STRIP = read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx')
const SUMMARY = read('src/app/portfolio/page.tsx')
const HOME = read('src/app/page.tsx')
const HOME_CODE = code(HOME)

// ─── 1 · Weekly Performance alignment ────────────────────────────────────────
//
// The defect: on Main, the weekly row carries TWO metrics per basis and the
// supporting row carries THREE, at different slot measures and different
// gutters. Both rows sit in the same outer grid column with the same padding,
// so the FIRST group's left edge always coincided — which is why "incl.
// Chilean equities" looked right — while a flowed second group began after
// however wide its own row's first group happened to be. "Excl. Chilean
// equities" therefore started in a different place in each row.

describe('R13.R5B § 1 · Weekly Performance — both rows share one basis grid', () => {
  test('the per-basis tracks are literal class strings, stacked below lg', () => {
    assert.match(STRIP, /const BASIS_COLUMNS: Record<number, string> = \{/)
    // Whole literal strings — Tailwind scans source text.
    assert.match(STRIP, /2: 'grid-cols-1 lg:grid-cols-2'/)
    assert.match(STRIP, /3: 'grid-cols-1 lg:grid-cols-3'/)
    // Stacked below lg, so two groups of figures never crowd a phone.
    for (const [, cls] of [...STRIP.matchAll(/\d: '(grid-cols-1 lg:grid-cols-\d)'/g)]) {
      assert.ok(cls.startsWith('grid-cols-1 '), `${cls} must stack below lg`)
    }
  })

  test('ONE column gap serves both rows — the alignment depends on it', () => {
    // With `1fr` tracks the second basis begins at (width + gap) / 2, so a
    // per-row gap would reintroduce the very offset this fixes.
    assert.match(STRIP, /const BASIS_COLUMN_GAP = '[^']+'/)
    const gap = /const BASIS_COLUMN_GAP = '([^']+)'/.exec(STRIP)?.[1] ?? ''
    assert.ok(gap.length > 0)
    const usages = STRIP.match(/BASIS_COLUMN_GAP/g) ?? []
    // Declared once, consumed once, in the single aligned container.
    assert.equal(usages.length, 2, 'one declaration and one use — never a per-row gap')
    // The aligned container must not also carry a row-varying horizontal gap.
    const alignedBranch = /aligned\s*\?\s*`grid \$\{BASIS_COLUMNS\[columns\]\} \$\{BASIS_COLUMN_GAP\} \$\{lead \? 'gap-y-4' : 'gap-y-3'\}`/
    assert.match(STRIP, alignedBranch, 'aligned mode varies only the VERTICAL rhythm by row')
  })

  test('both portfolio rows receive the same column count', () => {
    // Computed once from the groups actually passed, then handed to both.
    assert.match(STRIP, /const basisColumns =/)
    assert.equal((STRIP.match(/columns=\{basisColumns\}/g) ?? []).length, 2)
  })

  test('it engages only when the two rows describe the SAME bases', () => {
    assert.match(
      STRIP,
      /portfolioPrimary\.length > 1 && portfolioPrimary\.length === portfolioSecondary\.length/,
    )
    // A single-group (personal) column keeps the original flow.
    assert.match(STRIP, /const aligned = columns > 1 && BASIS_COLUMNS\[columns\] !== undefined/)
  })

  test('the untouched paths still flow exactly as before', () => {
    // The original flex-wrap branch survives verbatim for every other column.
    assert.match(
      STRIP,
      /flex flex-wrap \$\{\s*\n\s*lead \? 'gap-x-10 2xl:gap-x-14 gap-y-4' : 'gap-x-8 2xl:gap-x-11 gap-y-3'/,
    )
    // Markets never receives a column count, in any of its four call sites
    // (two in the card layout, two in the frameless personal layout).
    const marketsCalls = [...STRIP.matchAll(/<GroupStack[\s\S]{0,260}?\/>/g)].filter((m) =>
      /groups=\{markets(Primary|Secondary)\}/.test(m[0]),
    )
    assert.equal(marketsCalls.length, 4, 'all four Markets call sites must be found')
    for (const m of marketsCalls) {
      assert.doesNotMatch(m[0], /columns=/, 'the Markets column keeps the original flow')
    }
    // The frameless (personal) layout is untouched too — it passes no columns.
    const framelessPortfolio = /<GroupStack groups=\{portfolio(Primary|Secondary)\} lead(=\{false\})? masked=\{masked\} \/>/g
    assert.equal((STRIP.match(framelessPortfolio) ?? []).length, 2)
    // `reserveTitleRow`, the pre-existing cross-column baseline mechanism, is
    // untouched.
    assert.equal((STRIP.match(/reserveTitleRow=\{/g) ?? []).length, 4)
  })

  test('no financial value, label or metric changed', () => {
    // The two rows still carry exactly the figures they carried before.
    for (const key of ['metricReturn', 'metricProfit', 'ytdReturn', 'flow']) {
      assert.match(SUMMARY, new RegExp(`o\\.${key}\\b`), `${key} must still render`)
    }
    // Row 1 = return + P&L; row 2 = YTD return + YTD P&L + net flows.
    assert.match(SUMMARY, /key: `\$\{b\.basis\}-return`/)
    assert.match(SUMMARY, /key: `\$\{b\.basis\}-pl`/)
    assert.match(SUMMARY, /key: `\$\{b\.basis\}-ytd-return`/)
    assert.match(SUMMARY, /key: `\$\{b\.basis\}-ytd-pl`/)
    assert.match(SUMMARY, /key: `\$\{b\.basis\}-flow`/)
    // The strip still formats no amount itself — `MaskedAmount` owns that.
    assert.match(STRIP, /<MaskedAmount/)
    assert.doesNotMatch(STRIP, /toLocaleString/)
  })
})

// ─── 2 · Visible naming ──────────────────────────────────────────────────────

describe('R13.R5B § 2 · "Family Portfolio" is gone from user-visible copy', () => {
  /** Every string a user can read, from both dictionaries. */
  function visibleStrings(node: unknown, out: string[] = []): string[] {
    if (typeof node === 'string') out.push(node)
    else if (node && typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) visibleStrings(v, out)
    }
    return out
  }

  test('no dictionary string names the product "Family Portfolio"', () => {
    for (const lang of ['en', 'es'] as const) {
      for (const s of visibleStrings(dict[lang])) {
        assert.doesNotMatch(s, /Family Portfolio/i, `${lang}: "${s}"`)
        assert.doesNotMatch(s, /Portafolio Familiar/i, `${lang}: "${s}"`)
      }
    }
  })

  test('the scope headings are untouched — a personal portfolio is never relabelled Main', () => {
    // The heading is a TEMPLATE filled with the server-supplied scope, so no
    // scope name is hardcoded and none can be swapped for another.
    assert.equal(dict.en.fp.scopeHeading, '{scope} PORTFOLIO')
    assert.equal(dict.es.fp.scopeHeading, 'PORTAFOLIO {scope}')
    assert.match(SUMMARY, /scopeHeading/)
    for (const lang of ['en', 'es'] as const) {
      for (const s of visibleStrings(dict[lang])) {
        // No dictionary string hardcodes a principal's portfolio heading.
        assert.doesNotMatch(s, /\b(JAIME|ANDR[ÉE]S|PABLO) PORTFOLIO\b/i, `${lang}: "${s}"`)
      }
    }
  })

  test('the module keeps its neutral product name in both languages', () => {
    assert.equal(dict.en.fp.tag, 'Portfolio')
    assert.equal(dict.es.fp.tag, 'Portafolio')
  })

  test('the two changed strings stay scope-agnostic, because their subject is', () => {
    // The admin footer covers uploads AND publications, and a RESUMEN workbook
    // publishes every scope — naming Main there would misdescribe the file.
    assert.doesNotMatch(dict.en.fpAdmin.source, /Main|Family/i)
    assert.doesNotMatch(dict.es.fpAdmin.source, /Principal|Familiar/i)
    // The zero-scope message is about the module, not any one portfolio.
    assert.doesNotMatch(dict.en.fp.noAccess, /Main|Family/i)
    assert.doesNotMatch(dict.es.fp.noAccess, /Principal|Familiar/i)
  })

  test('internal identifiers are deliberately NOT renamed', () => {
    // R13.R5B was copy-only: the module and API names stayed even as the
    // member-facing wording changed. POST-R13.5 moved the ROUTE from
    // `/family-portfolio` to `/portfolio` and nothing else - the API namespace,
    // the provider, the data helpers and every internal identifier are
    // untouched, which is what keeps this a routing change rather than a rename.
    assert.ok(read('src/app/portfolio/page.tsx').length > 0)
    assert.ok(read('src/components/familyPortfolio/FamilyPortfolioProvider.tsx').length > 0)
    assert.ok(existsSync(join(ROOT, 'src/app/api/family-portfolio')), 'the API namespace is unchanged')
    assert.match(HOME, /href=\{PORTFOLIO_SUMMARY\}/)
    assert.match(HOME, /fetchFamilyPortfolioOverview/)
  })
})

// ─── 3 · Overview reads the canonical Main Portfolio ─────────────────────────

describe('R13.R5B § 3 · the Overview portfolio card and the Summary agree', () => {
  test('the Overview reads the SAME endpoint the Summary hero reads', () => {
    assert.match(HOME, /fetchFamilyPortfolioOverview\(scope\)/)
    assert.match(SUMMARY, /fetchFamilyPortfolioOverview\(activeScope\)/)
  })

  test('scope resolution is the Summary’s own rule, so they cannot describe different portfolios', () => {
    // R13.R5C.4 — STRONGER than the original form of this test. Both surfaces
    // used to spell the same rule out separately (`filter(s => s.id !==
    // 'alternatives')` … `[0]?.id ?? null`) and this test compared the two
    // spellings. They now call the SAME function, so they cannot describe
    // different portfolios by construction rather than by agreement.
    const shared = /from '@\/lib\/familyPortfolio\/portfolioScopeRoutes'/
    assert.match(HOME, shared)
    assert.match(SUMMARY, shared)
    // Home has no scope selector, so it asks for the Summary's own default.
    assert.match(HOME, /function firstPortfolioScope[\s\S]{0,120}?return activeScope\(null, scopes\)/)
    // The Summary asks for whatever the URL selected, falling back to the same
    // default — one function, two arguments.
    assert.match(SUMMARY, /resolveActiveScope\(searchParams\.get\(SCOPE_PARAM\), scopes\)/)
    const routes = read('src/lib/familyPortfolio/portfolioScopeRoutes.ts')
    assert.match(routes, /portfolioScopesOf\(scopes\)\[0\]\?\.id \?\? null/)
  })

  test('actual AUM is the published total, and it includes Chilean equities', () => {
    // Both surfaces render the hero's own `totalValue` — the row bound to
    // `with_chilean_equities` (see overview.ts's OverviewHero).
    assert.match(HOME, /fpHero\?\.totalValue/)
    assert.match(SUMMARY, /value=\{data\.hero\?\.totalValue \?\? null\}/)
    const overview = read('src/lib/familyPortfolio/overview.ts')
    assert.match(overview, /TOTAL portfolio value — the row bound to `with_chilean_equities`/)
    // The basis is STATED on the Overview, and only for the scope it is true of.
    assert.match(HOME, /fpScope === 'main' && \([\s\S]{0,120}?t\.fp\.overview\.aumBasis/)
    assert.equal(dict.en.fp.overview.aumBasis, 'Including Chilean equities')
  })

  test('the analytical Evolution series is never used as current AUM', () => {
    // Home plots no portfolio series at all and must not start: the
    // flow-adjusted path is a DERIVED analytical series, not observed AUM.
    assert.doesNotMatch(HOME, /buildFlowAdjustedSeries|flowAdjusted|evolution/i)
    // On the Summary the two remain distinct: the hero reads `hero.totalValue`
    // while the chart reads the adjusted series.
    assert.match(SUMMARY, /buildFlowAdjustedSeries/)
    assert.doesNotMatch(SUMMARY, /value=\{chartSeries/)
  })

  test('the legacy positions tracker is no longer a source for the Overview', () => {
    assert.doesNotMatch(HOME_CODE, /\/api\/portfolios/)
    assert.doesNotMatch(HOME_CODE, /valuePositions|calculatePortfolioTotals|PortfolioTotals/)
    // …and the legacy module itself is untouched — this was a repair, not a
    // cleanup. Both still exist and still carry their own logic.
    // POST-R13.5 finished the job R13.R5B deliberately left: the tracker this
    // card was un-wired from is now retired outright, so there is no second
    // portfolio source left in the codebase to drift back to.
    assert.ok(!existsSync(join(ROOT, 'src/app/api/portfolios')))
    assert.ok(!existsSync(join(ROOT, 'src/lib/portfolio')))
  })

  test('it fails closed: no fallback source, no invented value, no stale substitute', () => {
    // A denial and a failure render different honest states, and neither
    // renders a figure.
    assert.match(HOME, /fpState === 'denied' && <AsyncState kind="empty"/)
    assert.match(HOME, /fpState === 'error' && <AsyncState kind="error"/)
    // Nothing published yet is its own state, not a zero.
    assert.match(HOME, /fpPublication === null \? \(/)
    assert.match(HOME, /message=\{t\.fp\.portfolio\.noPublication\}/)
    // No zero-coalescing anywhere in the card.
    assert.doesNotMatch(HOME, /fpHero\?\.\w+ \?\? 0/)
    assert.doesNotMatch(HOME, /fpData\?\.\w+ \?\? 0/)
    // No hardcoded amount was introduced.
    assert.doesNotMatch(HOME, /totalValue[^\n]*=\s*\d{4,}/)
  })

  test('privacy masking cannot be bypassed on the Overview card', () => {
    // Both amounts go through the module's ONE guarded renderer.
    for (const expr of ['value={fpHero?.totalValue ?? null}', 'value={fpHero?.weeklyDifference ?? null}']) {
      const at = HOME.indexOf(expr)
      assert.ok(at > -1, `${expr} must render`)
      assert.ok(HOME.slice(Math.max(0, at - 120), at).includes('<MaskedAmount'))
      assert.ok(HOME.slice(at, at + 200).includes('masked={masked}'))
    }
    // The amounts are never formatted directly on the page.
    assert.doesNotMatch(HOME, /formatUsd\(fpHero/)
    // Returns are ratios and stay public — the module's standing policy.
    assert.match(HOME, /formatRatioPct\(fpHero\?\.ytdReturn \?\? null\)/)
  })

  test('access control is the server’s, and the card only reflects it', () => {
    // The card holds no entitlement logic of its own: it renders whatever the
    // server-filtered scopes response allowed, and both 401 and 403 deny.
    assert.match(HOME, /status === 401 \|\| \w+\.status === 403 \? 'denied' : 'error'/)
    assert.doesNotMatch(HOME_CODE, /isAdministrator|canReadScope|entitlement/i)
  })

  test('provenance is the publication’s own as-of date and revision', () => {
    assert.match(HOME, /<TableSourceFooter source=\{t\.fp\.portfolio\.source\} asOf=\{fpPublication\.asOfDate\}/)
    assert.match(HOME, /String\(fpPublication\.revision\)/)
    // ONE AS-OF PER SURFACE — the publication date is carried by the footer and
    // never repeated beside the figure (the app-wide rule that removed the old
    // duplicate "Updated …" chips from Home/Stocks/Company/Portfolio).
    assert.equal((HOME.match(/fpPublication\.asOfDate/g) ?? []).length, 1)
    // Same source string the Summary's own tables carry.
    assert.match(SUMMARY, /source=\{t\.fp\.portfolio\.source\}/)
  })
})
