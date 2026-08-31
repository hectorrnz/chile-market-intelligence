// R13.9 — Alternatives UI: composition, privacy, i18n, tokens, responsive and
// accessibility invariants (doc 07 §§ 7.4, 8; doc 08 Stage 9).
//
// RETARGETED FOR R13.R4A. Through R13.9 the module was ONE page; it is now
// three views over one publication (`Dashboard`, `Holdings`, `Cash Flows`) under
// a shared layout. Every invariant below is unchanged in substance — each is
// simply asserted against the file that now owns it, or across the whole
// surface where it belongs to the module rather than to one view. Nothing was
// relaxed to accommodate the redesign: where a check moved, it moved to a
// stricter place (e.g. the source-footer count is now per view).
//
// The R4A-specific contract — metric semantics, currency separation, cash-flow
// correctness — lives in `portfolioR4aAlternatives.test.ts`.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const LAYOUT = 'src/app/portfolio/alternatives/layout.tsx'
const DASHBOARD = 'src/app/portfolio/alternatives/page.tsx'
const HOLDINGS = 'src/app/portfolio/alternatives/holdings/page.tsx'
const CASHFLOWS = 'src/app/portfolio/alternatives/cash-flows/page.tsx'
const FILTERS = 'src/components/familyPortfolio/AlternativesFilters.tsx'
const CHROME = 'src/components/familyPortfolio/AlternativesEventChrome.tsx'
const CHART = 'src/components/familyPortfolio/AlternativesCashFlowChart.tsx'
const SUBNAV = 'src/components/familyPortfolio/AlternativesSubnav.tsx'
const DRILLDOWNS = 'src/components/familyPortfolio/AlternativesDrilldowns.tsx'
const CSS = 'src/app/globals.css'

const VIEWS = [LAYOUT, DASHBOARD, HOLDINGS, CASHFLOWS]
const SURFACE_FILES = [...VIEWS, FILTERS, CHROME, CHART, SUBNAV, DRILLDOWNS]
const surface = () => SURFACE_FILES.map(read).join('\n')

/** Source with comments stripped, so doc references never satisfy a check. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
}

// ---------------------------------------------------------------------------
// 1 · Composition (doc 07 § 7.4 — the exact contract sections)
// ---------------------------------------------------------------------------

describe('R13.9 · Alternatives composition', () => {
  test('the surface is the real member experience behind the member gate', () => {
    const layout = read(LAYOUT)
    assert.match(layout, /<MemberGate>/)
    assert.match(layout, /PageHeader/)
    assert.match(read('src/components/familyPortfolio/AlternativesProvider.tsx'), /fetchFamilyPortfolioAlternatives/)
    assert.ok(!surface().includes('alternativesPending'), 'the placeholder state is gone')
  })

  test('every § 7.4 section is present somewhere on the surface', () => {
    const all = surface()
    // Investment summary with commitment / contributions / unfunded.
    for (const k of ['colCommitted', 'colContributions', 'colUnfunded', 'colCurrentValue']) {
      assert.match(all, new RegExp(k), `missing ${k}`)
    }
    // Valuation with the statement date and its staleness indicator.
    assert.match(read(HOLDINGS), /StatementCell/)
    assert.match(read(HOLDINGS), /colLastStatement/)
    // Both IRRs, labelled source-provided.
    assert.match(read(HOLDINGS), /colReportedIrr/)
    assert.match(read(HOLDINGS), /colCalculatedIrr/)
    assert.match(read(HOLDINGS), /irrSourceNote/)
    // Event history with the semantic legend.
    assert.match(read(CASHFLOWS), /EventLegend/)
    assert.match(read(CHROME), /legendTitle/)
    // Filters by sociedad, category, currency and event type.
    for (const f of ['filterSociedad', 'filterCategory', 'filterCurrency', 'filterEventType']) {
      assert.match(read(FILTERS), new RegExp(f), `missing ${f}`)
    }
    // Unclassified events, surfaced as an actionable state.
    assert.match(read(CASHFLOWS), /unclassifiedTitle/)
    // The module's own as-of.
    assert.match(read(LAYOUT), /asOfLabel/)
  })

  test('holdings render by (category, currency) with a per-group subtotal and no grand total', () => {
    const page = read(HOLDINGS)
    assert.match(page, /GroupRows/)
    assert.match(page, /currencyLabel\(group\.currency\)/)
    assert.match(page, /noCrossCurrencyNote/)
    assert.ok(!/grandTotal|allGroupsTotal|portfolioTotal/i.test(codeOf(surface())),
      'no cross-currency total may be assembled anywhere on the surface')
  })

  test('filters re-derive through the SAME pure functions the server used', () => {
    assert.match(read(HOLDINGS), /groupHoldings\(applyHoldingFilter\(holdings, filter\)\)/)
    // R13.R4A.4 — Cash Flows passes a year-cleared copy of the shared filter
    // (the year control is gone; the view always reads every recorded year).
    // Every other dimension still goes through the same pure function.
    assert.match(read(CASHFLOWS), /applyEventFilter\(events, holdings, allYears\)/)
    assert.match(read(CASHFLOWS), /const allYears = useMemo\(\(\) => \(\{ \.\.\.filter, year: \[\] \}\)/)
    // Unfiltered → the server's own groups, so parity holds by construction.
    assert.match(read(HOLDINGS), /if \(!filterActive\) return data\?\.groups \?\? \[\]/)
  })

  test('the unclassified callout reports the WHOLE publication, not the filtered view', () => {
    const page = read(CASHFLOWS)
    assert.match(page, /data\?\.eventSummary\?\.unclassified/)
    assert.match(page, /role="status"/)
  })

  test('honest states are all distinct, and answered once in the layout', () => {
    const layout = read(LAYOUT)
    for (const s of ["'loading'", "'error'", "'denied'", 'no_publication', "'empty'"]) {
      assert.ok(layout.includes(s), `state ${s} must be handled`)
    }
    assert.match(layout, /noPublication/)
    assert.match(layout, /a\.empty/)
  })

  test('no source-shape logic leaks into any view', () => {
    for (const rel of SURFACE_FILES) {
      const src = read(rel)
      assert.ok(!/parseAlternatives|readXlsx|resolveFill|classifyFill/.test(src),
        `${rel} never parses or classifies`)
      assert.ok(!/from '@\/lib\/db\/repositories/.test(src),
        `${rel}: no repository import in a client component`)
    }
  })
})

// ---------------------------------------------------------------------------
// 2 · Privacy
// ---------------------------------------------------------------------------

describe('R13.9 · privacy completeness', () => {
  test('every monetary value renders through MaskedAmount — no direct formatUsd anywhere', () => {
    for (const rel of SURFACE_FILES) {
      assert.ok(!/\bformatUsd\b/.test(codeOf(read(rel))),
        `${rel} must not format an amount outside MaskedAmount`)
    }
    // The ledger's amounts and the holdings' monetary columns both go through it.
    assert.match(read(CASHFLOWS), /<MaskedAmount value=\{e\.amount\} masked=\{masked\} signed \/>/)
    const holdingCells = (read(HOLDINGS).match(/<MaskedAmount/g) ?? []).length
    assert.ok(holdingCells >= 10,
      `expected >=10 MaskedAmount call sites in the holdings table, found ${holdingCells}`)
  })

  test('IRRs are percentages and follow the app-wide percentage policy (visible, unsigned formatter)', () => {
    assert.match(read(HOLDINGS), /formatWeightPct\(h\.reportedIrr\)/)
    assert.match(read(HOLDINGS), /formatWeightPct\(h\.calculatedIrr\)/)
  })

  test('the privacy state is the shared app-wide preference with its toggle in the header', () => {
    assert.match(read(LAYOUT), /usePrivacyMode\(\)/)
    assert.match(read(LAYOUT), /PrivacyToggle/)
  })
})

// ---------------------------------------------------------------------------
// 3 · Event colours: tokens in BOTH themes, never colour alone
// ---------------------------------------------------------------------------

describe('R13.9 · event colour tokens', () => {
  const css = read(CSS)

  test('all four --alt-event-* tokens are declared for light AND dark', () => {
    for (const token of ['aporte', 'dividendo', 'distribucion', 'unclassified']) {
      const occurrences = css.split(`--alt-event-${token}:`).length - 1
      assert.equal(occurrences, 2, `--alt-event-${token} must be declared exactly twice (light + dark)`)
    }
  })

  test('components consume the tokens through eventPresentation, never hex', () => {
    for (const rel of SURFACE_FILES) {
      const src = codeOf(read(rel))
      assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(src), `${rel}: no hardcoded colour`)
      assert.ok(!/--alt-event-[a-z]+:/.test(src), `${rel}: tokens are declared only in globals.css`)
    }
    assert.match(read(CHROME), /altEventColorVar/)
    assert.match(read(CHART), /altEventColorVar/)
  })

  test('the type is always named in text beside its chip — never colour alone', () => {
    const chrome = read(CHROME)
    assert.match(chrome, /eventTypeLabel\(eventType, t\)/)
    assert.match(chrome, /aria-hidden="true"/)
    // Both surfaces that show an event use the tag, which carries the label.
    assert.match(read(CASHFLOWS), /EventTypeTag/)
    assert.match(read(DASHBOARD), /EventTypeTag/)
  })

  test('unclassified renders the explicit needs-attention treatment', () => {
    assert.match(read(CHROME), /eventType === 'unclassified' \? 'text-warning font-medium'/)
  })
})

// ---------------------------------------------------------------------------
// 4 · Staleness and dates
// ---------------------------------------------------------------------------

describe('R13.9 · statement-age indicator and calendar-safe dates', () => {
  test('the statement cell shows the date and its FACTUAL age — never a stale verdict', () => {
    const page = read(HOLDINGS)
    assert.match(page, /statementAge\(holding\.lastStatementDate, asOfDate\)/)
    assert.match(page, /age\.months/)
    assert.match(page, /title=\{t\.ageTitle\}/)
    assert.ok(!/age\.stale|staleFlag|staleTitle|\bStale\b/.test(codeOf(page)),
      'the contract authorizes no staleness threshold — the age is the indicator')
  })

  test('the age basis is the publication as-of, never the viewer clock', () => {
    const page = read(HOLDINGS)
    assert.ok(!/new Date\(|Date\.now\(/.test(codeOf(page)))
    assert.match(page, /asOfDate = data\?\.publication\?\.asOfDate \?\? null/)
  })

  test('a dateless row shows its source label verbatim — no fabricated age', () => {
    assert.match(read(HOLDINGS), /holding\.lastStatementLabel \?\? '—'/)
  })

  test('no date-only string ever passes through new Date() anywhere on the surface', () => {
    for (const rel of SURFACE_FILES) {
      assert.ok(!/new Date\(|Date\.now\(/.test(codeOf(read(rel))), `${rel} must not construct a Date`)
    }
    assert.match(read(CASHFLOWS), /formatIsoDateLabel/)
  })
})

// ---------------------------------------------------------------------------
// 5 · Provenance / freshness
// ---------------------------------------------------------------------------

describe('R13.9 · provenance and independent as-of', () => {
  test('every card carries exactly one TableSourceFooter naming the Alternatives source', () => {
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      const src = read(rel)
      const cards = (src.match(/<TableCard/g) ?? []).length
      const footers = (src.match(/<TableSourceFooter/g) ?? []).length
      assert.equal(footers, cards, `${rel}: ${cards} card(s) but ${footers} footer(s)`)
      if (cards > 0) assert.match(src, /source=\{a\.source\}/)
    }
  })

  test('the as-of is the ALTERNATIVES publication own stamp, independent of the portfolio', () => {
    assert.match(read(LAYOUT), /data\?\.publication\?\.asOfDate/)
    assert.ok(!/listCurrentPublications\('portfolio'\)|portfolioAsOf|snapshot\.publishedAt/.test(surface()),
      'the portfolio spine never feeds this surface')
  })
})

// ---------------------------------------------------------------------------
// 6 · i18n
// ---------------------------------------------------------------------------

describe('R13.9 · i18n', () => {
  test('EN and ES alternatives vocabularies have identical key sets', () => {
    const en = Object.keys(dict.en.fp.alternatives).sort()
    const es = Object.keys(dict.es.fp.alternatives).sort()
    assert.deepEqual(en, es)
    assert.ok(en.length >= 35, `expected a full vocabulary, found ${en.length} keys`)
  })

  test('the source legend vocabulary is preserved verbatim, never loosely translated', () => {
    for (const lang of ['en', 'es'] as const) {
      assert.equal(dict[lang].fp.alternatives.eventAporte, 'Aporte')
      assert.equal(dict[lang].fp.alternatives.eventDividendo, 'Dividendo')
      assert.equal(dict[lang].fp.alternatives.eventDistribucion, 'Distribución')
    }
    // Unclassified is NMI vocabulary, translated normally.
    assert.notEqual(dict.en.fp.alternatives.eventUnclassified, dict.es.fp.alternatives.eventUnclassified)
  })

  test('the dead placeholder keys are gone from both dictionaries', () => {
    assert.ok(!('alternativesPending' in dict.en.fp))
    assert.ok(!('alternativesPendingTitle' in dict.en.fp))
    assert.ok(!('alternativesPending' in dict.es.fp))
    assert.ok(!('alternativesPendingTitle' in dict.es.fp))
  })

  test('no user-facing hardcoded English anywhere on the surface', () => {
    for (const rel of SURFACE_FILES) {
      const src = codeOf(read(rel))
      for (const banned of ['>Investment<', '>Subtotal<', '>Stale<', '>Unclassified<', "'Alternatives'"]) {
        assert.ok(!src.includes(banned), `${rel}: hardcoded label ${banned}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 7 · Responsive and accessibility
// ---------------------------------------------------------------------------

describe('R13.9 · responsive and accessibility invariants', () => {
  test('the dense tables scroll inside their card with a minWidth', () => {
    assert.match(read(HOLDINGS), /minWidth=\{1080\}/)
    assert.match(read(CASHFLOWS), /minWidth=\{\d+\}/)
    assert.match(read(LAYOUT), /className="w-full"/)
  })

  test('filters wrap instead of widening the page; long names truncate with a title', () => {
    assert.match(read(FILTERS), /flex flex-wrap items-center/)
    assert.match(read(HOLDINGS), /truncate max-w-\[16rem\]" title=\{h\.investmentName\}/)
    assert.match(read(CASHFLOWS), /truncate[^"]*" title=\{e\.investmentName/)
  })

  test('table headers carry scope, selects are labelled, the callout is a status region', () => {
    assert.ok((read(HOLDINGS).match(/scope="col"/g) ?? []).length >= 11)
    assert.ok((read(CASHFLOWS).match(/scope="col"/g) ?? []).length >= 6)
    // R13.R4A.5 — the filter controls are popover checklists now, so the
    // label is associated by `aria-labelledby` rather than `htmlFor`, and the
    // options are real checkboxes inside a named group.
    assert.match(read(FILTERS), /aria-labelledby=\{`\$\{id\}-label/)
    assert.match(read(FILTERS), /<input\s+type="checkbox"/)
    assert.match(read(CASHFLOWS), /role="status"/)
    assert.match(read(CHROME), /aria-label=\{t\.legendTitle\}/)
  })

  test('the sub-navigation is keyboard reachable and marks the current view', () => {
    const nav = read(SUBNAV)
    assert.match(nav, /aria-current=\{active \? 'page' : undefined\}/)
    assert.match(nav, /aria-label=\{a\.subnavLabel\}/)
  })

  test('no alignment utility collides on one element', () => {
    for (const rel of [DASHBOARD, HOLDINGS, CASHFLOWS]) {
      assert.ok(!/text-right[^"'`]*text-left|text-left[^"'`]*text-right/.test(read(rel)),
        `${rel}: left/right alignment must be explicit per column, never stacked`)
    }
  })
})

// ---------------------------------------------------------------------------
// 8 · Stage-boundary graduation
// ---------------------------------------------------------------------------

describe('R13.9 · stage boundaries', () => {
  test('Weekly Changes files still never touch the Alternatives surface', () => {
    for (const rel of [
      'src/lib/familyPortfolio/weeklyChanges.ts',
      'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts',
    ]) {
      const code = codeOf(read(rel)).replace(/s\.id !== 'alternatives'/g, '')
      assert.ok(!/alternatives/i.test(code), `${rel} must not touch Alternatives`)
    }
  })

  test('no release/smoke tooling ships with the member surface', () => {
    assert.ok(!surface().includes('smoke'), 'no smoke-test machinery in a view')
  })
})
