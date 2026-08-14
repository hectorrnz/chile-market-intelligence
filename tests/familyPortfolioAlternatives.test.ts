// R13.9 — Alternatives member surface: pure view model, route discipline, and
// repository hygiene (doc 07 § 7.4, doc 08 Stage 9).
//
// Synthetic structural values ONLY — no private amount, name pattern, or
// worksheet range from the real workbook appears here.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyEventFilter,
  applyHoldingFilter,
  buildTimeline,
  currencyLabel,
  filterOptions,
  groupHoldings,
  statementAge,
  summarizeEvents,
  EMPTY_FILTER,
  type AlternativesEventRead,
  type AlternativesHoldingRead,
} from '../src/lib/familyPortfolio/alternativesView.ts'
import {
  altEventChipStyle,
  altEventColorVar,
  isAltEventType,
  ALT_EVENT_TYPES,
  ALT_EVENT_SOURCE_HEX,
} from '../src/lib/familyPortfolio/alternatives/eventPresentation.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** Source with comments stripped, so documentation prose never satisfies —
 *  or trips — a code-shape assertion. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\s\/\/[^\n]*$/gm, '')

// ---------------------------------------------------------------------------
// Synthetic fixture — two categories, two currencies, one shared fund held by
// two sociedades, one all-null column, one unclassified event.
// ---------------------------------------------------------------------------

function holding(over: Partial<AlternativesHoldingRead> & { id: string }): AlternativesHoldingRead {
  return {
    category: 'Private Debt',
    currency: 'dolares',
    investmentName: 'Fund One LP',
    sociedad: 'SOC-A',
    capitalCommitted: 100,
    contributions: 60,
    unfunded: 40,
    lastStatementDate: '2026-03-31',
    lastStatementLabel: null,
    lastValuation: 70,
    flowSinceStatement: -5,
    currentValue: 65,
    reportedIrr: 0.08,
    calculatedIrr: 0.075,
    ...over,
  }
}

const HOLDINGS: AlternativesHoldingRead[] = [
  holding({ id: 'h1' }),
  holding({ id: 'h2', investmentName: 'Fund One LP', sociedad: 'SOC-B', currentValue: 35, contributions: 30 }),
  holding({
    id: 'h3',
    category: 'Real Assets',
    currency: 'dolares',
    investmentName: 'Asset Fund USD',
    sociedad: 'SOC-A',
    currentValue: 200,
  }),
  holding({
    id: 'h4',
    category: 'Real Assets',
    currency: 'euros',
    investmentName: 'Asset Fund EUR',
    sociedad: 'SOC-C',
    capitalCommitted: null,
    contributions: null,
    unfunded: null,
    currentValue: 90,
    lastStatementDate: null,
    lastStatementLabel: 'Inversión Inicial',
  }),
]

const EVENTS: AlternativesEventRead[] = [
  { holdingId: 'h1', eventDate: '2026-05-31', amount: -10, currency: 'dolares', eventType: 'aporte' },
  { holdingId: 'h1', eventDate: '2026-06-30', amount: 4, currency: 'dolares', eventType: 'dividendo' },
  { holdingId: 'h2', eventDate: '2026-06-30', amount: 6, currency: 'dolares', eventType: 'distribucion' },
  // Negative amount, UNCLASSIFIED — must never become an aporte by its sign.
  { holdingId: 'h3', eventDate: '2026-06-30', amount: -7, currency: 'dolares', eventType: 'unclassified' },
  { holdingId: 'h4', eventDate: '2026-04-30', amount: 3, currency: 'euros', eventType: 'dividendo' },
  // Orphan link — surfaced honestly, never guessed into a holding.
  { holdingId: null, eventDate: '2026-06-30', amount: 2, currency: 'dolares', eventType: 'dividendo' },
]

// ---------------------------------------------------------------------------
// 1 · Currency labels
// ---------------------------------------------------------------------------

describe('R13.9 · currency display labels', () => {
  test('the four documented source declarations map to their codes', () => {
    assert.equal(currencyLabel('dolares'), 'USD')
    assert.equal(currencyLabel('euros'), 'EUR')
    assert.equal(currencyLabel('uf'), 'UF')
    assert.equal(currencyLabel('pesos'), 'CLP')
  })

  test('an unknown declaration is shown verbatim, never guessed into a code', () => {
    assert.equal(currencyLabel('libras'), 'LIBRAS')
  })
})

// ---------------------------------------------------------------------------
// 2 · Grouping and per-currency subtotals
// ---------------------------------------------------------------------------

describe('R13.9 · (category, currency) grouping', () => {
  test('the same category in two currencies forms two distinct groups, semantically ordered', () => {
    const groups = groupHoldings(HOLDINGS)
    // (category, display currency label): EUR sorts before USD.
    assert.deepEqual(
      groups.map((g) => `${g.category}|${g.currency}`),
      ['Private Debt|dolares', 'Real Assets|euros', 'Real Assets|dolares'],
    )
  })

  test('PRESENTATION IS INVARIANT TO SOURCE-ROW PLACEMENT: shuffled input, identical output', () => {
    // No R13 document commits a presentation order for Alternatives, so the
    // worksheet's physical row sequence is an artifact and must never leak
    // into the member view — inserting or moving a source row cannot
    // reshuffle it (R13.9 audit).
    const baseline = groupHoldings(HOLDINGS)
    for (const permuted of [
      [...HOLDINGS].reverse(),
      [HOLDINGS[2], HOLDINGS[0], HOLDINGS[3], HOLDINGS[1]],
    ]) {
      assert.deepEqual(groupHoldings(permuted), baseline)
    }
  })

  test('holdings inside a group order by (investment, sociedad), never input position', () => {
    const g = groupHoldings([...HOLDINGS].reverse()).find((x) => x.category === 'Private Debt')!
    assert.deepEqual(g.holdings.map((h) => h.sociedad), ['SOC-A', 'SOC-B'])
  })

  test('a category/currency name containing spaces cannot collapse two groups into one', () => {
    const tricky = [
      holding({ id: 'x1', category: 'Real Assets', currency: 'usd extra' }),
      holding({ id: 'x2', category: 'Real Assets usd', currency: 'extra' }),
    ]
    assert.equal(groupHoldings(tricky).length, 2)
  })

  test('subtotals sum available values per group and NEVER across currencies', () => {
    const groups = groupHoldings(HOLDINGS)
    const usd = groups.find((g) => g.category === 'Real Assets' && g.currency === 'dolares')!
    const eur = groups.find((g) => g.category === 'Real Assets' && g.currency === 'euros')!
    assert.equal(usd.subtotal.currentValue.value, 200)
    assert.equal(eur.subtotal.currentValue.value, 90)
    // No group's subtotal equals the cross-currency 290 — no such figure exists.
    for (const g of groups) assert.notEqual(g.subtotal.currentValue.value, 290)
  })

  test('an all-null column stays null — never 0 — and missing counts are disclosed', () => {
    const eur = groupHoldings(HOLDINGS).find((g) => g.currency === 'euros')!
    assert.equal(eur.subtotal.capitalCommitted.value, null)
    assert.equal(eur.subtotal.capitalCommitted.missing, 1)
    const pd = groupHoldings(HOLDINGS).find((g) => g.category === 'Private Debt')!
    assert.equal(pd.subtotal.currentValue.value, 100)
    assert.equal(pd.subtotal.currentValue.missing, 0)
  })

  test('a partially-null column sums the available rows and reports the gap', () => {
    const partial = [
      holding({ id: 'p1', currentValue: 10 }),
      holding({ id: 'p2', sociedad: 'SOC-B', currentValue: null }),
    ]
    const g = groupHoldings(partial)[0]
    assert.equal(g.subtotal.currentValue.value, 10)
    assert.equal(g.subtotal.currentValue.missing, 1)
  })

  test('the pure module exposes no cross-currency aggregation helper at all', () => {
    const src = read('src/lib/familyPortfolio/alternativesView.ts')
    assert.ok(!/grandTotal|crossCurrency|toUsd|convert/i.test(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')),
      'no cross-currency or FX-conversion code may exist in the view model')
  })
})

// ---------------------------------------------------------------------------
// 3 · Statement age — a fact, never a verdict
// ---------------------------------------------------------------------------

describe('R13.9 · statement age', () => {
  test('whole-month age from the string components, day-adjusted', () => {
    assert.deepEqual(statementAge('2026-03-31', '2026-08-06'), { months: 4 })
    assert.deepEqual(statementAge('2026-07-31', '2026-08-31'), { months: 1 })
    assert.deepEqual(statementAge('2025-07-06', '2026-08-06'), { months: 13 })
  })

  test('NO stale classification exists — the contract authorizes no threshold', () => {
    // The docs require a staleness INDICATOR but define no numeric threshold,
    // cadence rule, or qualitative stale state (re-verified docs 01–09,
    // R13.9 audit). An age is an observation; a "stale"/"fresh"/"aging"
    // bucket would be an invented policy judgment.
    const result = statementAge('2020-01-31', '2026-08-06')
    assert.deepEqual(Object.keys(result!), ['months'], 'the age carries ONLY the observation')
    const src = codeOf(read('src/lib/familyPortfolio/alternativesView.ts'))
    assert.ok(!/stale|fresh|aging/i.test(src), 'no normative freshness vocabulary in the model')
    for (const rel of [
      'src/app/family-portfolio/alternatives/page.tsx',
      'src/components/familyPortfolio/EventTimeline.tsx',
    ]) {
      assert.ok(!/\bstale\b|staleFlag|STALE_MONTHS/i.test(codeOf(read(rel))),
        `${rel} must not render a staleness verdict`)
    }
  })

  test('the basis is the publication as-of — a revision never ages by the viewer clock', () => {
    // Deterministic: the same pair of dates always yields the same age.
    assert.deepEqual(statementAge('2025-06-30', '2026-08-06'), { months: 13 })
    assert.deepEqual(statementAge('2025-06-30', '2026-08-06'), { months: 13 })
    const src = codeOf(read('src/lib/familyPortfolio/alternativesView.ts'))
    assert.ok(!/new Date\(|Date\.now\(/.test(src), 'no wall-clock input to any financial fact')
  })

  test('a statement dated after the as-of yields 0 months', () => {
    assert.deepEqual(statementAge('2026-09-30', '2026-08-06'), { months: 0 })
  })

  test('missing or malformed dates yield null — never a fabricated age', () => {
    assert.equal(statementAge(null, '2026-08-06'), null)
    assert.equal(statementAge('2026-03-31', null), null)
    assert.equal(statementAge('Inversión Inicial', '2026-08-06'), null)
  })
})

// ---------------------------------------------------------------------------
// 4 · Filters
// ---------------------------------------------------------------------------

describe('R13.9 · filters', () => {
  test('filter options are the distinct present values, deterministically ordered', () => {
    const o = filterOptions(HOLDINGS, EVENTS)
    assert.deepEqual(o.sociedades, ['SOC-A', 'SOC-B', 'SOC-C'])
    assert.deepEqual(o.categories, ['Private Debt', 'Real Assets'])
    // By display label: EUR before USD.
    assert.deepEqual(o.currencies, ['euros', 'dolares'])
    // Legend order, never source-cell order.
    assert.deepEqual(o.eventTypes, ['aporte', 'dividendo', 'distribucion', 'unclassified'])
    // Invariant to input order.
    assert.deepEqual(filterOptions([...HOLDINGS].reverse(), [...EVENTS].reverse()), o)
  })

  test('sociedad/category/currency narrow holdings; event type never does', () => {
    assert.equal(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, sociedad: 'SOC-A' }).length, 2)
    assert.equal(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, category: 'Real Assets' }).length, 2)
    assert.equal(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, currency: 'euros' }).length, 1)
    assert.equal(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, eventType: 'aporte' }).length, 4)
  })

  test('event sociedad/category resolve through the holding link, never a name match', () => {
    const bySoc = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, sociedad: 'SOC-A' })
    assert.deepEqual(bySoc.map((e) => e.holdingId), ['h1', 'h1', 'h3'])
    const byCat = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, category: 'Real Assets' })
    assert.deepEqual(byCat.map((e) => e.holdingId).sort(), ['h3', 'h4'])
  })

  test('an event with no holding link is excluded by sociedad/category filters — never guessed in', () => {
    const bySoc = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, sociedad: 'SOC-A' })
    assert.ok(!bySoc.some((e) => e.holdingId === null))
    // But it survives dimensions it carries itself.
    const byType = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, eventType: 'dividendo' })
    assert.ok(byType.some((e) => e.holdingId === null))
  })

  test('filtering a grouped view re-derives subtotals over the SAME pure path', () => {
    const narrowed = groupHoldings(applyHoldingFilter(HOLDINGS, { ...EMPTY_FILTER, sociedad: 'SOC-A' }))
    const pd = narrowed.find((g) => g.category === 'Private Debt')!
    assert.equal(pd.subtotal.currentValue.value, 65)
    assert.equal(pd.holdings.length, 1)
  })
})

// ---------------------------------------------------------------------------
// 5 · Timeline and classification integrity
// ---------------------------------------------------------------------------

describe('R13.9 · event timeline', () => {
  test('months are newest-first; events inside a month are deterministic', () => {
    const months = buildTimeline(EVENTS, HOLDINGS)
    assert.deepEqual(months.map((m) => m.month), ['2026-06', '2026-05', '2026-04'])
    assert.equal(months[0].events.length, 4)
  })

  test('the timeline is invariant to the events transport/source order', () => {
    const baseline = buildTimeline(EVENTS, HOLDINGS)
    assert.deepEqual(buildTimeline([...EVENTS].reverse(), [...HOLDINGS].reverse()), baseline)
  })

  test('investment and sociedad resolve through the link; an orphan stays honestly unknown', () => {
    const june = buildTimeline(EVENTS, HOLDINGS)[0]
    const orphan = june.events.find((e) => e.holdingId === null)!
    assert.equal(orphan.investmentName, null)
    assert.equal(orphan.sociedad, null)
  })

  test('an unclassified event stays unclassified through every derivation — sign never classifies', () => {
    const negativeUnclassified = EVENTS.find((e) => e.eventType === 'unclassified')!
    assert.ok(negativeUnclassified.amount < 0, 'the fixture must tempt a sign-based shortcut')
    const months = buildTimeline(EVENTS, HOLDINGS)
    const inTimeline = months.flatMap((m) => m.events).find((e) => e.holdingId === 'h3')!
    assert.equal(inTimeline.eventType, 'unclassified')
    const summary = summarizeEvents(EVENTS)
    assert.equal(summary.unclassified, 1)
    assert.equal(summary.byType['aporte'], 1)
    const filtered = applyEventFilter(EVENTS, HOLDINGS, { ...EMPTY_FILTER, eventType: 'unclassified' })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].amount, -7)
  })

  test('summarizeEvents counts every persisted type and never folds unclassified away', () => {
    const s = summarizeEvents(EVENTS)
    assert.equal(s.total, 6)
    assert.deepEqual(
      Object.keys(s.byType).sort(),
      ['aporte', 'distribucion', 'dividendo', 'unclassified'],
    )
  })
})

// ---------------------------------------------------------------------------
// 6 · Event presentation mapping
// ---------------------------------------------------------------------------

describe('R13.9 · event presentation', () => {
  test('the three semantic types map to their own tokens; unclassified to the warning treatment', () => {
    assert.equal(altEventColorVar('aporte'), 'var(--alt-event-aporte)')
    assert.equal(altEventColorVar('dividendo'), 'var(--alt-event-dividendo)')
    assert.equal(altEventColorVar('distribucion'), 'var(--alt-event-distribucion)')
    assert.equal(altEventColorVar('unclassified'), 'var(--alt-event-unclassified)')
  })

  test('an unknown future type presents as needs-attention, never as a semantic colour', () => {
    assert.equal(altEventColorVar('mystery'), 'var(--alt-event-unclassified)')
    assert.equal(altEventChipStyle('mystery'), 'hollow')
    assert.equal(altEventChipStyle('unclassified'), 'hollow')
    assert.equal(altEventChipStyle('aporte'), 'filled')
  })

  test('the vocabulary matches the persisted CHECK enum exactly', () => {
    assert.deepEqual([...ALT_EVENT_TYPES], ['aporte', 'dividendo', 'distribucion', 'unclassified'])
    const migration = read('supabase/migrations/20260809000000_family_portfolio_alternatives.sql')
    for (const t of ALT_EVENT_TYPES) {
      assert.ok(migration.includes(`'${t}'`), `persisted enum must carry ${t}`)
      assert.ok(isAltEventType(t))
    }
    assert.ok(!isAltEventType('mystery'))
  })

  test('the canonical source-legend colours are recorded verbatim (doc 03 § 3.2)', () => {
    assert.deepEqual(ALT_EVENT_SOURCE_HEX, {
      aporte: '#002060',
      dividendo: '#92D050',
      distribucion: '#1F497D',
    })
    assert.ok(!('unclassified' in ALT_EVENT_SOURCE_HEX),
      'unclassified has NO source colour by definition')
  })

  test('light theme renders the LITERAL source colours; dark carries derivative tints', () => {
    const css = read('src/app/globals.css')
    for (const [type, hex] of Object.entries(ALT_EVENT_SOURCE_HEX)) {
      // Two declarations per token: :root (light) first, .dark second.
      const all = [...css.matchAll(new RegExp(`--alt-event-${type}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))]
      assert.equal(all.length, 2, `--alt-event-${type} must be declared in both themes`)
      assert.equal(all[0][1].toUpperCase(), hex.toUpperCase(),
        `the light token IS the source colour for ${type}`)
    }
  })

  test('theme presentation can never change an event type — meaning is the text label', () => {
    // The colour function maps type → token; nothing consults a theme, and the
    // type label path is colour-independent.
    const src = codeOf(read('src/lib/familyPortfolio/alternatives/eventPresentation.ts'))
    assert.ok(!/dark|theme|matchMedia|prefers-color/i.test(src.replace(/ALT_EVENT_SOURCE_HEX/g, '')),
      'no theme branch in the presentation mapping')
    assert.equal(altEventColorVar('aporte'), 'var(--alt-event-aporte)')
  })

  test('rendering hexes appear ONLY in the canonical source record, and classification is never re-run', () => {
    const src = read('src/lib/familyPortfolio/alternatives/eventPresentation.ts')
    const code = codeOf(src)
    const hexes = code.match(/#[0-9A-Fa-f]{6}/g) ?? []
    assert.equal(hexes.length, 3, 'exactly the three canonical source hexes, nowhere else')
    const afterRecord = code.slice(code.indexOf('altEventColorVar'))
    assert.ok(!/#[0-9A-Fa-f]{6}/.test(afterRecord), 'no hex in any rendering path')
    assert.ok(!/resolveFill|classifyFill|resolved_hex|resolvedHex/.test(src),
      'the parser owns classification; presentation never repeats it')
  })
})

// ---------------------------------------------------------------------------
// 6b · SAN ROQUE — interim treatment with a durable release flag (doc 09 D2)
// ---------------------------------------------------------------------------

describe('R13.9 · SAN ROQUE release control', () => {
  test('NO special-cased financial code path exists for SAN ROQUE anywhere in src/', () => {
    for (const rel of [
      'src/lib/familyPortfolio/alternativesView.ts',
      'src/lib/familyPortfolio/alternatives/eventPresentation.ts',
      'src/app/api/family-portfolio/alternatives/route.ts',
      'src/app/family-portfolio/alternatives/page.tsx',
      'src/components/familyPortfolio/EventTimeline.tsx',
      'src/lib/db/repositories/familyPortfolioReadRepository.ts',
      'src/lib/i18n.ts',
    ]) {
      assert.ok(!/san\s*_?roque/i.test(read(rel)),
        `${rel} must treat SAN ROQUE exactly like every other sociedad`)
    }
  })

  test('the outstanding ownership confirmation is durably recorded in the release-control path', () => {
    const doc = read('docs/portfolio-r13/09-open-decisions.md')
    assert.match(doc, /OUTSTANDING RELEASE CONDITION/)
    assert.match(doc, /SAN ROQUE ownership must be confirmed/)
    assert.match(doc, /before the Stage-11 production release/)
  })

  test('no member-facing vocabulary mentions the internal decision machinery', () => {
    const page = read('src/app/family-portfolio/alternatives/page.tsx')
    const i18n = read('src/lib/i18n.ts')
    for (const banned of [/ownership/i, /\bD2\b/, /release blocker/i]) {
      assert.ok(!banned.test(page), `page must not surface ${banned}`)
      const alt = i18n.slice(i18n.indexOf('alternatives: {'), i18n.indexOf('alternatives: {') + 4000)
      assert.ok(!banned.test(alt), `member vocabulary must not surface ${banned}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 7 · Route discipline
// ---------------------------------------------------------------------------

describe('R13.9 · /api/family-portfolio/alternatives route', () => {
  const ROUTE = 'src/app/api/family-portfolio/alternatives/route.ts'
  // Comment-stripped: the route's documentation names the very patterns these
  // shape checks assert about the CODE.
  const route = codeOf(read(ROUTE))

  test('the authorization ladder is intact and ordered', () => {
    const guard = route.indexOf('guardPrivateApi()')
    const entitlement = route.indexOf('getFamilyPortfolioEntitlement()')
    const scopeCheck = route.indexOf("canReadScope(entitlement.input, 'alternatives')")
    const spineRead = route.indexOf("listCurrentPublications('alternatives')")
    assert.ok(guard > -1 && entitlement > guard && scopeCheck > entitlement && spineRead > scopeCheck,
      'guard → entitlement → explicit scope check → data, in that order')
    assert.match(route, /not_authorized', 403/)
  })

  test('current alternatives publications only — no drafts, no fallback, no Upload A spine', () => {
    assert.ok(!route.includes("listCurrentPublications('portfolio')"),
      'the Alternatives as-of is its OWN, never the portfolio spine')
    assert.match(route, /spine\.publications\[0\] \?\? null/)
    assert.ok(!/portfolio_source_uploads|getUpload|storage/i.test(route),
      'no upload table or storage object is ever read by the member route')
    assert.ok(!/nearest|closest|fallbackDate/i.test(route), 'no nearest-date fallback exists')
  })

  test('financial rows go through the user-session repository readers', () => {
    assert.match(route, /getAlternativesHoldings\(current\.id\)/)
    assert.match(route, /getAlternativesEvents\(current\.id\)/)
    const repo = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
    const holdingsFn = repo.slice(repo.indexOf('export async function getAlternativesHoldings'))
    assert.match(holdingsFn, /getSupabaseUserClient/)
    assert.ok(!holdingsFn.slice(0, holdingsFn.indexOf('export interface CurrentCommentary')).includes('getSupabaseAdminClient'),
      'holdings and events are NEVER read with the service-role client')
  })

  test('the payload exposes no source coordinates, fills, or admin machinery', () => {
    const repo = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
    const select = /select\(\s*'([^']+)'/g
    let m: RegExpExecArray | null
    const altSelects: string[] = []
    while ((m = select.exec(repo)) !== null) {
      if (m[1].includes('investment_name') || m[1].includes('event_type')) altSelects.push(m[1])
    }
    assert.ok(altSelects.length >= 2, 'both alternatives selects must be found')
    for (const s of altSelects) {
      for (const banned of ['source_cell', 'raw_fill', 'resolved_hex', 'metadata', 'classification_method']) {
        assert.ok(!s.includes(banned), `member select must not carry ${banned}`)
      }
    }
    assert.ok(!/adminNote|admin_note|uploadId|upload_id/.test(read('src/app/api/family-portfolio/alternatives/route.ts')))
  })

  test('groups and summaries come from the pure module the page also uses', () => {
    assert.match(route, /groupHoldings\(holdings\)/)
    assert.match(route, /summarizeEvents\(events\)/)
    assert.match(route, /from '@\/lib\/familyPortfolio\/alternativesView'/)
  })

  test('honest states and cache discipline', () => {
    assert.match(route, /state: 'no_publication'/)
    assert.match(route, /state: 'empty'/)
    assert.match(route, /state: 'ok'/)
    assert.match(route, /Cache-Control': 'no-store'/)
    assert.match(route, /export const dynamic = 'force-dynamic'/)
  })
})

// ---------------------------------------------------------------------------
// 8 · Stage boundaries
// ---------------------------------------------------------------------------

describe('R13.9 · stage boundaries', () => {
  test('no schema or migration change ships with Stage 9', () => {
    // The alternatives tables were finalized in R13.4; Stage 9 is read-only.
    const migration = read('supabase/migrations/20260809000000_family_portfolio_alternatives.sql')
    assert.match(migration, /R13\.4/)
  })

  test('the Chilean-equities /portfolio module remains untouched', () => {
    const chilean = read('src/app/portfolio/page.tsx')
    assert.ok(!chilean.includes('alternatives'))
    assert.ok(!chilean.includes('family-portfolio'))
  })

  test('the view model never imports the parser, a repository, or Next.js', () => {
    const src = read('src/lib/familyPortfolio/alternativesView.ts')
    assert.ok(!/from '.*parseAlternatives|from '.*repositories|from 'next|from '@supabase/.test(src),
      'the pure module stays pure')
  })
})
