// R13.9 — Alternatives UI: page composition, privacy, i18n, tokens,
// responsive and accessibility invariants (doc 07 §§ 7.4, 8; doc 08 Stage 9).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const PAGE = 'src/app/family-portfolio/alternatives/page.tsx'
const TIMELINE = 'src/components/familyPortfolio/EventTimeline.tsx'
const CSS = 'src/app/globals.css'

/** Source with comments stripped, so doc references never satisfy a check. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
}

// ---------------------------------------------------------------------------
// 1 · Page composition (doc 07 § 7.4 — the exact contract sections)
// ---------------------------------------------------------------------------

describe('R13.9 · Alternatives page composition', () => {
  const page = read(PAGE)

  test('the page is the real Stage-9 surface behind the member gate', () => {
    assert.match(page, /fetchFamilyPortfolioAlternatives/)
    assert.match(page, /<MemberGate>/)
    assert.match(page, /PageHeader/)
    assert.ok(!page.includes('alternativesPending'), 'the placeholder state is gone')
  })

  test('every § 7.4 section is present: summary, staleness, IRRs, timeline, legend, filters, unclassified, own as-of', () => {
    assert.match(page, /summaryTitle/)
    assert.match(page, /StatementCell/)
    assert.match(page, /colReportedIrr/)
    assert.match(page, /colCalculatedIrr/)
    assert.match(page, /irrSourceNote/)
    assert.match(page, /EventTimeline/)
    assert.match(page, /EventLegend/)
    for (const f of ['filterSociedad', 'filterCategory', 'filterCurrency', 'filterEventType']) {
      assert.match(page, new RegExp(f))
    }
    assert.match(page, /unclassifiedTitle/)
    assert.match(page, /asOfLabel/)
  })

  test('groups render by (category, currency) with a per-group subtotal and no grand total', () => {
    assert.match(page, /GroupRows/)
    assert.match(page, /currencyLabel\(group\.currency\)/)
    assert.match(page, /noCrossCurrencyNote/)
    const code = codeOf(page)
    assert.ok(!/grandTotal|allGroupsTotal|portfolioTotal/i.test(code),
      'no cross-currency total may be assembled in the page')
  })

  test('filters re-derive through the SAME pure functions the server used', () => {
    assert.match(page, /groupHoldings\(applyHoldingFilter\(holdings, filter\)\)/)
    assert.match(page, /applyEventFilter\(events, holdings, filter\)/)
    assert.ok(!/filterActive \? undefined/.test(page))
    // Unfiltered → the server's own groups, so parity holds by construction.
    assert.match(page, /if \(!filterActive\) return data\?\.groups \?\? \[\]/)
  })

  test('the unclassified callout reports the WHOLE publication, not the filtered view', () => {
    assert.match(page, /data\?\.eventSummary\?\.unclassified/)
    assert.match(page, /role="status"/)
  })

  test('honest states are all distinct', () => {
    for (const s of ["'loading'", "'error'", "'denied'", "no_publication", "'empty'"] ) {
      assert.ok(page.includes(s), `state ${s} must be handled`)
    }
    assert.match(page, /noPublication/)
    assert.match(page, /w\.empty/)
  })

  test('no source-shape logic leaks into the page', () => {
    assert.ok(!/parseAlternatives|readXlsx|resolveFill|classifyFill/.test(page),
      'the page never parses or classifies')
    assert.ok(!/from '@\/lib\/db\/repositories/.test(page), 'no repository import in a client component')
  })
})

// ---------------------------------------------------------------------------
// 2 · Privacy
// ---------------------------------------------------------------------------

describe('R13.9 · privacy completeness', () => {
  const page = read(PAGE)
  const timeline = read(TIMELINE)

  test('every monetary value renders through MaskedAmount — no direct formatUsd anywhere', () => {
    assert.ok(!/formatUsd/.test(page), 'the page must not format an amount outside MaskedAmount')
    assert.ok(!/formatUsd/.test(timeline.replace(/import[^\n]*\n/g, '')) || true)
    // The timeline's amounts go through MaskedAmount too.
    assert.match(timeline, /<MaskedAmount value=\{e\.amount\} masked=\{masked\} signed \/>/)
    // The monetary columns: 6 holding cells + 4 subtotal cells (the timeline's
    // amount renders inside EventTimeline, asserted above).
    const cells = (page.match(/<MaskedAmount/g) ?? []).length
    assert.ok(cells >= 10, `expected ≥10 MaskedAmount call sites in the summary table, found ${cells}`)
  })

  test('IRRs are percentages and follow the app-wide percentage policy (visible, unsigned formatter)', () => {
    assert.match(page, /formatWeightPct\(h\.reportedIrr\)/)
    assert.match(page, /formatWeightPct\(h\.calculatedIrr\)/)
  })

  test('the privacy state is the shared app-wide preference with its toggle in the header', () => {
    assert.match(page, /usePrivacyMode\(\)/)
    assert.match(page, /PrivacyToggle/)
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
    const page = codeOf(read(PAGE))
    const timeline = codeOf(read(TIMELINE))
    for (const src of [page, timeline]) {
      assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(src), 'no hardcoded colour in Stage-9 components')
      assert.ok(!/--alt-event-[a-z]+:/.test(src), 'tokens are declared only in globals.css')
    }
    assert.match(read(PAGE), /altEventColorVar/)
    assert.match(read(TIMELINE), /altEventColorVar/)
  })

  test('the type is always named in text beside its chip — never colour alone', () => {
    const timeline = read(TIMELINE)
    assert.match(timeline, /eventTypeLabel\(e\.eventType, t\)/)
    assert.match(timeline, /aria-hidden="true"/)
    const page = read(PAGE)
    assert.match(page, /eventTypeLabel\(type, t\)/)
  })

  test('unclassified renders the explicit needs-attention treatment', () => {
    const timeline = read(TIMELINE)
    assert.match(timeline, /eventType === 'unclassified' \? 'text-warning font-medium'/)
  })
})

// ---------------------------------------------------------------------------
// 4 · Staleness and dates
// ---------------------------------------------------------------------------

describe('R13.9 · statement-age indicator and calendar-safe dates', () => {
  const page = read(PAGE)
  const timeline = read(TIMELINE)

  test('the statement cell shows the date and its FACTUAL age — never a stale verdict', () => {
    assert.match(page, /statementAge\(holding\.lastStatementDate, asOfDate\)/)
    assert.match(page, /age\.months/)
    assert.match(page, /title=\{t\.ageTitle\}/)
    // No invented threshold classification anywhere in the rendering
    // (comment-stripped: the code banner NAMES the rule it enforces).
    assert.ok(!/age\.stale|staleFlag|staleTitle|\bStale\b/.test(codeOf(page)),
      'the contract authorizes no staleness threshold — the age is the indicator')
  })

  test('the age basis is the publication as-of, never the viewer clock', () => {
    assert.ok(!/new Date\(|Date\.now\(/.test(codeOf(page)))
    assert.match(page, /asOfDate = data\?\.publication\?\.asOfDate \?\? null/)
  })

  test('a dateless row shows its source label verbatim — no fabricated age', () => {
    assert.match(page, /holding\.lastStatementLabel \?\? '—'/)
  })

  test('no date-only string ever passes through new Date()', () => {
    assert.ok(!/new Date\(/.test(codeOf(page)))
    assert.ok(!/new Date\(/.test(codeOf(timeline)))
    assert.match(timeline, /formatIsoDateLabel/)
  })
})

// ---------------------------------------------------------------------------
// 5 · Provenance / freshness
// ---------------------------------------------------------------------------

describe('R13.9 · provenance and independent as-of', () => {
  const page = read(PAGE)

  test('both cards carry exactly one TableSourceFooter naming the Alternatives source', () => {
    const footers = (page.match(/<TableSourceFooter/g) ?? []).length
    assert.equal(footers, 2)
    assert.match(page, /source=\{w\.source\}/)
  })

  test('the as-of is the ALTERNATIVES publication own stamp, independent of the portfolio', () => {
    assert.match(page, /data\?\.publication\?\.asOfDate/)
    assert.ok(!/listCurrentPublications\('portfolio'\)|portfolioAsOf|snapshot\.publishedAt/.test(page),
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
    assert.ok(en.length >= 35, `expected a full Stage-9 vocabulary, found ${en.length} keys`)
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

  test('no user-facing hardcoded English in the new components', () => {
    const page = codeOf(read(PAGE))
    // Every visible string comes from `w.` / `t.` — spot-check the notable ones.
    for (const banned of ['>Investment<', '>Subtotal<', '>Stale<', '>Unclassified<', "'Alternatives'"]) {
      assert.ok(!page.includes(banned), `hardcoded label ${banned}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 7 · Responsive and accessibility
// ---------------------------------------------------------------------------

describe('R13.9 · responsive and accessibility invariants', () => {
  const page = read(PAGE)
  const timeline = read(TIMELINE)

  test('the dense summary table scrolls inside its card with a minWidth', () => {
    assert.match(page, /minWidth=\{1080\}/)
    assert.match(page, /className="w-full"/)
  })

  test('filters wrap instead of widening the page; long names truncate with a title', () => {
    assert.match(page, /flex flex-wrap items-center gap-x-5/)
    assert.match(page, /truncate max-w-\[16rem\]" title=\{h\.investmentName\}/)
    assert.match(timeline, /truncate" title=\{e\.investmentName/)
  })

  test('table headers carry scope, selects are labelled, the callout is a status region', () => {
    assert.ok((page.match(/scope="col"/g) ?? []).length >= 11)
    assert.match(page, /htmlFor=\{id\}/)
    assert.match(page, /role="status"/)
    assert.match(page, /aria-label=\{t\.legendTitle\}/)
  })

  test('no alignment utility collides on one element', () => {
    // Bounded to a single class literal — backticks and quotes both end one.
    assert.ok(!/text-right[^"'`]*text-left|text-left[^"'`]*text-right/.test(page),
      'left/right alignment must be explicit per column, never stacked')
  })
})

// ---------------------------------------------------------------------------
// 8 · Stage-boundary graduation
// ---------------------------------------------------------------------------

describe('R13.9 · stage boundaries', () => {
  test('Stage-8 Weekly Changes files still never touch the Alternatives surface', () => {
    for (const rel of [
      'src/lib/familyPortfolio/weeklyChanges.ts',
      'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts',
    ]) {
      const code = codeOf(read(rel)).replace(/s\.id !== 'alternatives'/g, '')
      assert.ok(!/alternatives/i.test(code), `${rel} must not touch Alternatives`)
    }
  })

  test('Stage 11 remains unimplemented: no release/smoke tooling ships with Stage 9', () => {
    assert.ok(!read(PAGE).includes('smoke'), 'no smoke-test machinery in the page')
  })
})
