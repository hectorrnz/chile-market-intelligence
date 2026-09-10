// POST-R13.8 FOLLOW-UP E — Weekly Changes and Compare are two surfaces.
//
// ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────
//
// The owner's decision: a week and an arbitrary period are different questions
// and belong on different tabs. Weekly Changes had been carrying both behind a
// switch, and the range borrowed the weekly page's title, its controls, its
// column headers and — in three whole blocks — its vocabulary. Over
// 30-04-2026 → 04-09-2026 the page headed its ranked panels "Largest WEEKLY
// Value Increases" and its listing "All WEEKLY Value Changes" for a five-month
// comparison.
//
// The fix is structural rather than editorial. There is now ONE surface
// component that both routes render, and ONE presentation contract that
// resolves every interval-dependent word. So this suite tests three things:
//
//   1 · WEEKLY holds no range. Every control the compare switch needed is gone
//       from it, and the measurement it always made is unchanged.
//   2 · COMPARE holds no week. Not one weekly word reaches its main surfaces,
//       in either language, and its reconciliation ALWAYS renders four rows —
//       including on a Preview where the analytical history is not loaded.
//   3 · The two are the SAME page. Not by inspection but by construction: one
//       component, one contract, and no second copy of the markup to drift.
//
// ── THE §21 REGRESSION IS THE POINT ─────────────────────────────────────────
//
// The owner's own range, 30-04-2026 → 04-09-2026, is asserted directly: every
// weekly phrase from the screenshot must be absent from the period surface, and
// each one's period equivalent present. That list is not paraphrased — it is
// the exact set of strings the reported page displayed.
//
// NO PRIVATE DATA. Every figure below is synthetic; the only real values are
// public route strings and the dictionary's own copy.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import {
  changesLabels,
  WEEKLY_VOCABULARY,
  type ChangesLabels,
} from '../src/lib/familyPortfolio/changesPresentation.ts'
import {
  buildPeriodPerformance,
  periodIntervals,
} from '../src/lib/familyPortfolio/periodPerformance.ts'
import {
  PORTFOLIO_COMPARE,
  PORTFOLIO_WEEKLY_CHANGES,
  SCOPE_AWARE_ROUTES,
  activeScope,
  scopeHref,
} from '../src/lib/familyPortfolio/portfolioScopeRoutes.ts'
import { canReadScope } from '../src/lib/portfolioAccess/entitlements.ts'
import type { EntitlementInput } from '../src/lib/portfolioAccess/entitlements.ts'
import { classifyPath } from '../src/lib/auth/accessPolicy.ts'
import { moduleForPath, resolvePathModule } from '../src/lib/auth/moduleRoutes.ts'
import { selectWeekPair } from '../src/lib/familyPortfolio/weeklyChanges.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Strips comments so hygiene regexes cannot be tripped by prose. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const WEEKLY_PAGE = 'src/app/portfolio/weekly-changes/page.tsx'
const COMPARE_PAGE = 'src/app/portfolio/compare/page.tsx'
const SURFACE = 'src/components/familyPortfolio/ChangesSurface.tsx'
const CONTRACT = 'src/lib/familyPortfolio/changesPresentation.ts'
const NAV = 'src/components/familyPortfolio/FamilyPortfolioNav.tsx'
const ROUTE = 'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts'
const SELECTOR = 'src/components/familyPortfolio/WeekSelector.tsx'
const HOLDINGS = 'src/app/portfolio/holdings/page.tsx'

const weekly = read(WEEKLY_PAGE)
const compare = read(COMPARE_PAGE)
const surface = read(SURFACE)
const contract = read(CONTRACT)
const route = read(ROUTE)

const ADMIN: EntitlementInput = { isApproved: true, isAdministrator: true, principal: null }
const JAIME: EntitlementInput = { isApproved: true, isAdministrator: false, principal: 'jaime' }
const ANDRES: EntitlementInput = { isApproved: true, isAdministrator: false, principal: 'andres' }
const PABLO: EntitlementInput = { isApproved: true, isAdministrator: false, principal: 'pablo' }
const NO_PRINCIPAL: EntitlementInput = { isApproved: true, isAdministrator: false, principal: null }

// ─────────────────────────────────────────────────────────────────────────────
// The real production spine, after the first catch-up import.
//
// 103 publications jump 2026-07-31 → 2026-09-04; row history holds all 107
// reporting dates, including the four weeks the source closed in between.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLISHED = [
  '2026-04-30', '2026-05-08', '2026-05-15', '2026-05-22', '2026-05-29',
  '2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26', '2026-07-03',
  '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31', '2026-09-04',
]
const CATCH_UP = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']
const ELIGIBLE = [...PUBLISHED, ...CATCH_UP].sort()

const FROM = '2026-04-30'
const TO = '2026-09-04'

// ═══════════════════════════════════════════════════════════════════════════
// A–C · Navigation and access
// ═══════════════════════════════════════════════════════════════════════════

describe('A–C · navigation and access', () => {
  test('A · Compare is a sub-tab directly beside Weekly Changes', () => {
    assert.equal(PORTFOLIO_COMPARE, '/portfolio/compare')
    assert.ok(existsSync(join(ROOT, COMPARE_PAGE)), 'the route has a page behind it')

    // Rail order: Summary · Holdings · Weekly Changes · Compare · Alternatives ·
    // Admin. Compare is pushed on the line after its neighbour, with nothing
    // between them.
    const nav = codeOf(read(NAV))
    const wc = nav.indexOf("scoped('weekly-changes', PORTFOLIO_WEEKLY_CHANGES")
    const cmp = nav.indexOf("scoped('compare', PORTFOLIO_COMPARE")
    const alt = nav.indexOf("shared('alternatives'")
    assert.ok(wc > 0 && cmp > wc, 'Compare follows Weekly Changes')
    assert.ok(alt > cmp, 'and precedes Alternatives')
    const between = nav.slice(wc, cmp)
    assert.ok(
      !/scoped\(|shared\(/.test(between.slice("scoped('weekly-changes',".length)),
      'no third item is pushed between the two — they are adjacent pills',
    )

    // The same pill language, with no styling of its own: the rail renders ONE
    // `<Link>` template for every item.
    assert.equal((nav.match(/<Link/g) ?? []).length, 1)
  })

  test('B · Compare is private by default and bound to the Portfolio module', () => {
    // Default-deny: it is private because it is not on any allowlist, not
    // because somebody remembered to list it.
    assert.equal(classifyPath(PORTFOLIO_COMPARE), 'private_page')
    // And it inherits the `/portfolio` module binding rather than declaring a
    // new entitlement — § 29's requirement, checked against the real resolver.
    assert.deepEqual(
      resolvePathModule(PORTFOLIO_COMPARE),
      resolvePathModule(PORTFOLIO_WEEKLY_CHANGES),
    )
    assert.equal(moduleForPath(PORTFOLIO_COMPARE), 'portfolio')
    // No new entitlement concept anywhere in the page.
    for (const invented of ['canCompare', 'compareEntitlement', 'COMPARE_SCOPE']) {
      assert.ok(!compare.includes(invented), `${invented} must not exist`)
    }
  })

  test('C · an unauthorized scope cannot leak through the Compare surface', () => {
    // The isolation matrix is unchanged and re-derived here for the new route:
    // no principal may read another's portfolio, and a member with no principal
    // has no personal scope at all.
    for (const [who, input] of [['jaime', JAIME], ['andres', ANDRES], ['pablo', PABLO]] as const) {
      assert.ok(canReadScope(input, 'main'), `${who} keeps Main`)
      assert.ok(canReadScope(input, who), `${who} keeps their own portfolio`)
      for (const other of ['jaime', 'andres', 'pablo'].filter((x) => x !== who)) {
        assert.ok(!canReadScope(input, other), `${who} must never read ${other}`)
      }
    }
    // No `portfolio_principal` means no portfolio scope AT ALL — not Main and
    // not anyone's personal book. Compare inherits that unchanged.
    for (const scope of ['main', 'jaime', 'andres', 'pablo']) {
      assert.ok(!canReadScope(NO_PRINCIPAL, scope), `a member with no principal cannot read ${scope}`)
    }
    for (const scope of ['main', 'jaime', 'andres', 'pablo']) {
      assert.ok(canReadScope(ADMIN, scope), 'administrators keep full family access')
    }

    // A forged `?scope=` resolves against the SERVER-granted list, so it can
    // never widen what the page asks for…
    assert.equal(activeScope('andres', [{ id: 'main' }, { id: 'jaime' }]), 'main')
    // …and the API re-checks independently of anything the client decided.
    assert.match(route, /if \(!canReadScope\(entitlement\.input, scope\)\) return fail\('not_authorized', 403\)/)
    // The page itself grants nothing: it holds no admin client and no policy.
    assert.ok(!compare.includes('service_role') && !compare.includes('SupabaseAdmin'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// D–J · Weekly Changes is a pure weekly page
// ═══════════════════════════════════════════════════════════════════════════

describe('D–J · Weekly Changes holds one week and nothing else', () => {
  const code = codeOf(weekly)

  test('D · no Compare toggle survives, in markup or in state', () => {
    for (const gone of ['<Switch', 'compareOn', 'setCompareOn', 'compareToggle', 'compareModeLabel']) {
      assert.ok(!code.includes(gone), `the weekly page must not carry ${gone}`)
    }
    // And the switch's strings are DELETED from the dictionary, not orphaned.
    for (const lang of ['en', 'es'] as const) {
      const d = dict[lang].fp.weeklyChanges as Record<string, unknown>
      for (const dead of ['compareToggle', 'compareModeLabel', 'compareCustom', 'rangeInvalid']) {
        assert.ok(!(dead in d), `${lang}: fp.weeklyChanges.${dead} is retired`)
      }
    }
  })

  test('E · no arbitrary FROM or TO control, and no custom-range state', () => {
    for (const gone of ['compareFrom', 'setCompareFrom', 'isCustomRange', 'earlierWeeks', 'fromOptions']) {
      assert.ok(!code.includes(gone), `${gone} belongs to Compare now`)
    }
    assert.ok(!/label=\{w\.compare(From|To)\}/.test(code), 'no endpoint labels render here')
    // The fetch never sends an opening endpoint — that is what would turn this
    // route back into a range.
    assert.match(code, /fetchFamilyPortfolioWeeklyChanges\(activeScope, asOf\)/)
    assert.ok(!/, *true\)/.test(code), 'and never asks for period semantics')
  })

  test('F · exactly ONE week control remains, and it is a real choice', () => {
    assert.equal((code.match(/<WeekSelector/g) ?? []).length, 1)
    assert.match(weekly, /weeks=\{data\.weeks\}/)
    assert.match(weekly, /value=\{asOf \?\? pub\.asOfDate\}/)
    assert.match(weekly, /onChange=\{\(next\) => setAsOf\(next\)\}/)
    // Enabled unless the page is loading — never disabled by a mode.
    assert.match(weekly, /disabled=\{loading\}/)
    assert.ok(!/!compareOn/.test(weekly))
  })

  test('G · 04-09-2026 resolves its prior SOURCE week, 28-08-2026', () => {
    // The publication spine's own answer would be 2026-07-31 — five weeks back,
    // because the catch-up import published only the newest of its five frozen
    // weeks. The weekly basis deliberately does NOT use it.
    const pair = selectWeekPair(PUBLISHED.map((asOfDate) => ({ asOfDate })), null)
    assert.ok(pair.ok)
    assert.equal(pair.selection.current.asOfDate, '2026-09-04')
    assert.equal(pair.selection.previous?.asOfDate, '2026-07-31')

    // The route prefers the publication's OWN previous-week column instead, and
    // reads the opening values out of that same publication's rows.
    assert.match(
      route,
      /hasSourceWeeklyBasis\(closingRowSet, closingPublication\.previousWeekDate, closingPublication\.asOfDate\)/,
    )
    assert.match(route, /previousRowSet = sourcePreviousWeekRows\(closingRowSet\)/)
    assert.match(route, /openingSource = 'source_previous_week'/)
    // Only in weekly mode: a period is two endpoints the reader chose.
    assert.match(route, /mode === 'weekly' &&\s*\n?\s*hasSourceWeeklyBasis/)
  })

  test('H · the weekly reconciliation is the SOURCE\'s own stated week', () => {
    // Nothing derives a weekly figure: the ledger reads `flowReconciliation`,
    // which is the source's own previous value, profit, flow and closing value.
    // A residual is REPORTED rather than absorbed, which is what keeps the
    // residual at zero honest when it is zero.
    assert.match(surface, /value: flowRecon\?\.previousValue \?\? null/)
    assert.match(surface, /value: flowRecon\?\.profit \?\? null/)
    assert.match(surface, /value: flowRecon\?\.flow \?\? null/)
    assert.match(surface, /value: flowRecon\?\.actualCurrent \?\? null/)
    assert.match(surface, /!isPeriod && flowRecon\?\.status === 'residual'/)
    assert.match(route, /reconcileFlowAndProfit\(total\)/)
    // The period aggregates are never computed in weekly mode, so a published
    // weekly number can never be replaced by a derived one.
    assert.match(route, /if \(mode === 'custom'\) \{/)
    assert.match(route, /WEEKLY MODE COMPUTES NONE OF THIS/)
  })

  test('I · every weekly label is preserved, in both languages', () => {
    const en = changesLabels('weekly', dict.en)
    const es = changesLabels('weekly', dict.es)
    assert.equal(en.title, 'Weekly Changes')
    assert.equal(en.valueChange, 'Weekly Value Change')
    assert.equal(en.reconOpening, 'Previous Week Portfolio Value')
    assert.equal(en.reconProfit, 'Weekly P&L')
    assert.equal(en.reconFlow, 'Weekly Net Flows')
    assert.equal(en.reconClosing, 'Ending Week Portfolio Value')
    assert.equal(en.returnLabel, 'Weekly Return')
    assert.equal(en.increasesTitle, 'Largest Weekly Value Increases')
    assert.equal(en.decreasesTitle, 'Largest Weekly Value Decreases')
    assert.equal(en.hierarchyTitle, 'Weekly Value Change by Portfolio Hierarchy')
    assert.equal(en.hierarchySubtitle, 'Contribution to Weekly Portfolio Value Change')
    assert.equal(en.fullTableTitle, 'All Weekly Value Changes')
    assert.equal(en.colOpening, 'Previous Week')
    assert.equal(en.colClosing, 'This Week')
    // Spanish carries the same interval, in its own words.
    assert.equal(es.title, 'Cambios Semanales')
    assert.equal(es.valueChange, 'Variación de Valor Semanal')
    assert.equal(es.colOpening, 'Semana Anterior')
    assert.equal(es.colClosing, 'Esta Semana')
  })

  test('J · no revision suffix reaches a member-facing date control', () => {
    // R13.8's restatement pass lifted seven weeks at once, which turned the
    // week selector into a revision browser. Dates only, everywhere a member
    // picks one — including Compare's two new endpoint controls.
    // Comments STRIPPED: both files EXPLAIN the retired suffix in prose, which
    // is the record of why it went rather than a rendering of it.
    const sel = codeOf(read(SELECTOR))
    assert.ok(!/Rev\.|revisionShort/.test(sel), 'the selector prints dates alone')
    assert.match(sel, /\{formatIsoDateLabel\(w\.asOfDate\)\}/)
    assert.ok(!/revisionShort/.test(codeOf(compare)), 'Compare states no revision at all')
    // Holdings picks its week through the SAME selector, so its options are
    // dates too. Its provenance footnote still prints the revision, which is
    // the preserved behaviour: the identity was unlabelled in the control,
    // never lost — see the weekly page's own header above.
    assert.match(read(HOLDINGS), /<WeekSelector/)
    assert.match(read(HOLDINGS), /t\.fp\.portfolio\.revisionShort\} \{snapshot\.revision\}/)
    // The identity is not lost — the weekly page still prints it beside the
    // publication it genuinely belongs to.
    assert.match(weekly, /t\.fp\.portfolio\.revisionShort\} \{pub\.revision\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// K–U · Compare
// ═══════════════════════════════════════════════════════════════════════════

describe('K–U · Compare is a period surface', () => {
  test('K · FROM is rendered physically before TO', () => {
    const from = compare.indexOf('label={w.compareFrom}')
    const to = compare.indexOf('label={w.compareTo}')
    assert.ok(from > 0 && to > from, 'FROM precedes TO in the control row')
    // Both are live: there is no mode left to be off.
    assert.equal((compare.match(/disabled=\{loading\}/g) ?? []).length, 2)
    assert.ok(!/<Switch\b/.test(compare), 'no toggle introduces them')
    // The header states the pair the server actually resolved, in the same
    // order, so the controls and the metadata line can never disagree.
    const metaFrom = compare.indexOf('{w.compareFrom} {formatIsoDateLabel(resolvedFrom)}')
    const metaTo = compare.indexOf('{w.compareTo} {formatIsoDateLabel(resolvedTo)}')
    assert.ok(metaFrom > 0 && metaTo > metaFrom)
  })

  test('L · FROM < TO is enforced in the control AND at the route', () => {
    // The FROM list holds only dates strictly earlier than the resolved TO, so
    // a reversed range cannot be built here at all…
    assert.match(compare, /allDates\.filter\(\(d\) => d < resolvedTo\)/)
    // …and moving TO onto or before the chosen FROM drops FROM rather than
    // carrying an impossible pair forward.
    assert.match(compare, /if \(fromDate !== null && fromDate >= next\) setFromDate\(null\)/)
    // The server refuses independently of any client.
    assert.match(route, /: !\(openingRequest < to\)\s*\n?\s*\? 'from_not_before_to'/)
    // A refused range is a NAMED state, rendered as an explanation.
    assert.match(compare, /state === 'from_not_before_to'/)
    assert.match(compare, /message=\{w\.compareFromAfterTo\}/)
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.weeklyChanges.compareFromAfterTo.length > 10)
    }
  })

  test('M · every period label is period-based, in both languages', () => {
    const en = changesLabels('period', dict.en)
    const es = changesLabels('period', dict.es)
    assert.equal(en.title, 'Portfolio Value Change')
    assert.equal(en.valueChange, 'Period Value Change')
    assert.equal(en.reconOpening, 'From Portfolio Value')
    assert.equal(en.reconProfit, 'Period P&L')
    assert.equal(en.reconFlow, 'Period Net Flows')
    assert.equal(en.reconClosing, 'To Portfolio Value')
    assert.equal(en.returnLabel, 'Period Return')
    assert.equal(en.increasesTitle, 'Largest Period Value Increases')
    assert.equal(en.decreasesTitle, 'Largest Period Value Decreases')
    assert.equal(en.hierarchyTitle, 'Period Value Change by Portfolio Hierarchy')
    assert.equal(
      en.hierarchySubtitle,
      'Contribution to Portfolio Value Change over the selected period',
    )
    assert.equal(en.fullTableTitle, 'All Period Value Changes')
    assert.equal(en.colOpening, 'From Value')
    assert.equal(en.colClosing, 'To Value')
    assert.equal(es.title, 'Variación del Valor del Portafolio')
    assert.equal(es.colOpening, 'Valor Desde')
    assert.equal(es.colClosing, 'Valor Hasta')
  })

  test('N · not one weekly word reaches the period surface, in either language', () => {
    // EVERY field of the contract, both languages, against the project's own
    // shared list — so a label added later is held to the same rule without
    // this test being edited.
    //
    // ONE FIELD IS EXEMPT, and § 18 says exactly why: a period metric is BUILT
    // from the source's own weekly observations, and the sentence that explains
    // where the flows come from may name them. Every other field — including
    // both methodology statements — clears the ban outright, which is the
    // measure of how narrow the carve-out is.
    const EXPLAINS_THE_UNDERLYING_OBSERVATIONS = new Set(['reconNote'])
    for (const lang of ['en', 'es'] as const) {
      const labels = changesLabels('period', dict[lang])
      for (const [field, value] of Object.entries(labels)) {
        if (EXPLAINS_THE_UNDERLYING_OBSERVATIONS.has(field)) continue
        for (const word of WEEKLY_VOCABULARY) {
          assert.ok(
            !value.toLowerCase().includes(word),
            `${lang}.${field} must not say "${word}": ${value}`,
          )
        }
      }
    }
    // The exemption is NARROW: the one exempt sentence must still be about the
    // period, and must be a different sentence from the weekly one it sits
    // beside — not the weekly note slipping through the gap.
    for (const lang of ['en', 'es'] as const) {
      const p = changesLabels('period', dict[lang]) as Record<string, string>
      const wk = changesLabels('weekly', dict[lang]) as Record<string, string>
      for (const field of EXPLAINS_THE_UNDERLYING_OBSERVATIONS) {
        assert.match(
          p[field],
          /period|período/i,
          `${lang}.${field} must still describe the period: ${p[field]}`,
        )
        assert.notEqual(p[field], wk[field], `${lang}.${field} must not be the weekly sentence`)
      }
    }
    // And the page itself never says it either — its title, its endpoint names
    // and its own notes.
    for (const word of ['Weekly', 'Semanal']) {
      assert.ok(!compare.includes(`'${word}`), `the Compare page must not print ${word}`)
    }
  })

  test('O–Q · the three period rows ALWAYS render, values or not', () => {
    // § 11 / § 22 — the state Preview is in until the analytical-history
    // migration is applied. The two ENDPOINTS come from the snapshots, which
    // exist whenever the surface renders at all; only the two MOVEMENTS can go
    // unavailable, and the labels stay either way.
    const ledger = surface.slice(
      surface.indexOf('const ledger = useMemo'),
      surface.indexOf('const reclassifications'),
    )
    assert.ok(!/return null/.test(ledger), 'the ledger never returns nothing')
    // O · Period P&L, P · Period Net Flows — present with a null value.
    assert.match(ledger, /label: labels\.reconProfit,\s*value: periodPerf\?\.profit \?\? null/)
    assert.match(ledger, /label: labels\.reconFlow,\s*value: periodPerf\?\.netFlows \?\? null/)
    // The endpoints fall back to the snapshot totals rather than vanishing with
    // the history that only the two movements need.
    assert.match(ledger, /periodPerf\?\.openingValue \?\? total\?\.previousValue \?\? null/)
    assert.match(ledger, /periodPerf\?\.closingValue \?\? total\?\.currentValue \?\? null/)
    // Q · the Period Return LABEL is unconditional — `formatRatioPct(null)` is
    // an em dash, so the hero reads "— Period Return" rather than losing a line.
    assert.match(surface, /changeLabel=\{`\$\{formatRatioPct\(/)
    assert.ok(
      !/changeLabel=\{[\s\S]{0,120}\? *[^:]*: *undefined/.test(surface),
      'the return label is never conditionally dropped',
    )
  })

  test('R · an unavailable figure shows a mark, and says why', () => {
    // The em dash comes from the shared formatter, which every ledger amount
    // passes through — so an unavailable movement can never print as a zero.
    assert.match(surface, /<MaskedAmount value=\{r\.value\} masked=\{masked\} signed=\{r\.signed\}/)
    // And the reason is named. The whole-history case is its own sentence,
    // because "flows unavailable" and "the table is not there yet" are
    // different facts and a reader can act on only one of them.
    assert.match(surface, /isPeriod && periodPerf === null/)
    assert.match(surface, /\{w\.periodHistoryUnavailable\}/)
    for (const lang of ['en', 'es'] as const) {
      const msg = dict[lang].fp.weeklyChanges.periodHistoryUnavailable
      assert.ok(msg.length > 80, `${lang}: the explanation is a real sentence`)
      // It must say the two portfolio values are unaffected — otherwise it
      // reads as though the whole comparison had failed.
      assert.ok(/unaffected|no se ven afectados/.test(msg), `${lang}: ${msg}`)
    }
  })

  test('T · the endpoint universe is the ELIGIBLE set, and nothing is substituted', () => {
    // THE RULE, stated once: a date is an eligible Compare endpoint when the
    // scope has a complete source-backed row set at it — a current publication,
    // or a frozen reporting date in `portfolio_row_history`.
    assert.match(
      route,
      /const compareDates = \[\s*\n?\s*\.\.\.new Set\(\[\.\.\.publicationByDate\.keys\(\), \.\.\.rowHistoryDates\]\),\s*\n?\s*\]\.sort\(\)/,
    )
    // Measured on the real book: 107 eligible dates against 103 publications.
    assert.equal(ELIGIBLE.length, PUBLISHED.length + CATCH_UP.length)
    for (const d of CATCH_UP) {
      assert.ok(!PUBLISHED.includes(d), 'fixture sanity: these weeks are unpublished')
      assert.ok(ELIGIBLE.includes(d), 'but they are eligible Compare endpoints')
    }
    // The client renders that set and nothing else — never `weeks`, which is
    // the publication list the WEEKLY selector reads.
    assert.match(compare, /const allDates = useMemo\(\(\) => data\?\.compareDates \?\? \[\], \[data\]\)/)
    assert.ok(!compare.includes('data.weeks'))
    // Eligibility is about ROWS. The period AGGREGATES need performance history
    // over the same window and degrade separately — the two are not conflated.
    assert.match(route, /WHAT ELIGIBILITY IS NOT/)
  })

  test('U · no nearest-date substitution, on either endpoint', () => {
    const routeCode = codeOf(route)
    assert.ok(!/nearest|closest|approximate/i.test(routeCode))
    assert.ok(!/nearest|closest/i.test(codeOf(compare)))
    // A date outside the eligible set is REFUSED, by name, on both sides.
    for (const code of ['from_not_found', 'week_not_found']) {
      assert.ok(route.includes(`'${code}'`), `the route must refuse with ${code}`)
    }
    // The default opening endpoint is an exact member of the set — the eligible
    // date immediately before the closing one — not a computed offset.
    assert.match(route, /from \?\? \[\.\.\.compareDates\]\.reverse\(\)\.find\(\(d\) => d < to\) \?\? null/)
    // Reproduced here over the real spine: the default FROM for 2026-09-04 is
    // 2026-08-28, a week the book never published.
    const defaultFrom = [...ELIGIBLE].reverse().find((d) => d < TO)
    assert.equal(defaultFrom, '2026-08-28')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// S · The 30-04-2026 → 04-09-2026 regression, verbatim
// ═══════════════════════════════════════════════════════════════════════════

describe('S · the reported range renders period vocabulary, never weekly', () => {
  /** Exactly the strings the reported screenshot displayed over this range. */
  const FROM_THE_SCREENSHOT = [
    'Weekly Value Change',
    'Previous Week Portfolio Value',
    'Weekly P&L',
    'Weekly Net Flows',
    'Ending Week Portfolio Value',
    'Largest Weekly Value Increases',
    'Largest Weekly Value Decreases',
    'Weekly Value Change by Portfolio Hierarchy',
    'Contribution to Weekly Portfolio Value Change',
    'All Weekly Value Changes',
    'Previous Week',
    'This Week',
  ] as const

  /** Every label the surface renders, in the mode Compare renders it in. */
  function renderedLabels(mode: 'weekly' | 'period'): ChangesLabels {
    return changesLabels(mode, dict.en)
  }

  test('S · none of the twelve reported weekly phrases survives on Compare', () => {
    const period = Object.values(renderedLabels('period'))
    for (const phrase of FROM_THE_SCREENSHOT) {
      assert.ok(
        !period.some((v) => v.includes(phrase)),
        `Compare must not display "${phrase}"`,
      )
    }
    // Non-vacuity: every one of them IS a weekly label, so the assertion above
    // is testing a real difference rather than a list of strings nothing uses.
    const weeklyLabels = Object.values(renderedLabels('weekly'))
    for (const phrase of FROM_THE_SCREENSHOT) {
      assert.ok(
        weeklyLabels.some((v) => v.includes(phrase)),
        `"${phrase}" must still be a WEEKLY label, or this test proves nothing`,
      )
    }
  })

  test('S · each one\'s period equivalent appears instead', () => {
    const p = renderedLabels('period')
    assert.equal(p.valueChange, 'Period Value Change')
    assert.equal(p.reconOpening, 'From Portfolio Value')
    assert.equal(p.reconProfit, 'Period P&L')
    assert.equal(p.reconFlow, 'Period Net Flows')
    assert.equal(p.reconClosing, 'To Portfolio Value')
    assert.equal(p.increasesTitle, 'Largest Period Value Increases')
    assert.equal(p.decreasesTitle, 'Largest Period Value Decreases')
    assert.equal(p.hierarchyTitle, 'Period Value Change by Portfolio Hierarchy')
    assert.match(p.hierarchySubtitle, /over the selected period$/)
    assert.equal(p.fullTableTitle, 'All Period Value Changes')
    assert.equal(p.colOpening, 'From Value')
    assert.equal(p.colClosing, 'To Value')
  })

  test('S · the range itself is eighteen source reporting intervals', () => {
    // 30-04 → 04-09 over the eligible spine. The FROM date is excluded and the
    // TO date included — the half-open window, made visible.
    const window = periodIntervals(ELIGIBLE, FROM, TO)
    assert.equal(window.length, 18)
    assert.ok(!window.includes(FROM), 'the From date opens the period, it is not in it')
    assert.equal(window[window.length - 1], TO)
    assert.ok(window.includes('2026-08-28'), 'the catch-up weeks are real intervals')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// V–AD · The period calculations
// ═══════════════════════════════════════════════════════════════════════════

describe('V–AD · period flows, P&L and return', () => {
  /** A four-interval book: 100 → 150 with +30 of contributions along the way. */
  const SPINE = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04']
  const flows = [
    { observationDate: '2026-08-07', value: 999 }, // the FROM week's own flow
    { observationDate: '2026-08-14', value: 10 },
    { observationDate: '2026-08-21', value: 0 },
    { observationDate: '2026-08-28', value: 20 },
    { observationDate: '2026-09-04', value: 0 },
  ]
  const profits = [
    { observationDate: '2026-08-07', value: 500 },
    { observationDate: '2026-08-14', value: 5 },
    { observationDate: '2026-08-21', value: 5 },
    { observationDate: '2026-08-28', value: 5 },
    { observationDate: '2026-09-04', value: 5 },
  ]
  const returns = [
    { observationDate: '2026-08-07', value: 0.5 },
    { observationDate: '2026-08-14', value: 0.01 },
    { observationDate: '2026-08-21', value: 0.02 },
    { observationDate: '2026-08-28', value: 0.03 },
    { observationDate: '2026-09-04', value: 0.04 },
  ]
  const base = {
    fromDate: '2026-08-07',
    toDate: '2026-09-04',
    reportingDates: SPINE,
    openingValue: 100,
    closingValue: 150,
    flows,
    profits,
    returns,
  }

  test('V · flows sum over the half-open window (FROM, TO]', () => {
    const out = buildPeriodPerformance(base)
    assert.deepEqual(out.intervals, ['2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04'])
    assert.equal(out.netFlows, 30)
  })

  test('W · the FROM week\'s own flow is EXCLUDED', () => {
    // It is already inside the value this comparison OPENS at. Counting it
    // again would double-count it — and the fixture's 999 makes that loud.
    const out = buildPeriodPerformance(base)
    assert.notEqual(out.netFlows, 1029)
    assert.equal(out.netFlows, 30)
    // Moving the FROM date back one interval pulls that flow in, which proves
    // the exclusion is the WINDOW's rule and not a filter on one date.
    const wider = buildPeriodPerformance({
      ...base,
      fromDate: '2026-08-07',
      reportingDates: ['2026-07-31', ...SPINE],
    })
    assert.equal(wider.netFlows, 30)
    const widest = buildPeriodPerformance({
      ...base,
      fromDate: '2026-07-31',
      reportingDates: ['2026-07-31', ...SPINE],
    })
    assert.equal(widest.netFlows, 1029)
  })

  test('X · the TO week\'s flow is INCLUDED', () => {
    const withToFlow = buildPeriodPerformance({
      ...base,
      flows: flows.map((f) => (f.observationDate === '2026-09-04' ? { ...f, value: 7 } : f)),
    })
    assert.equal(withToFlow.netFlows, 37)
  })

  test('Y · Period P&L = close − open − flows', () => {
    const out = buildPeriodPerformance(base)
    assert.equal(out.valueChange, 50)
    assert.equal(out.profit, 20)
    // The brief's own worked example: 100 → 150 with +30 of flows is a 20 P&L.
    assert.equal(base.closingValue - base.openingValue - (out.netFlows ?? NaN), 20)
  })

  test('Z · open + P&L + flows = close, by construction', () => {
    const out = buildPeriodPerformance(base)
    assert.equal(
      (out.openingValue ?? 0) + (out.profit ?? 0) + (out.netFlows ?? 0),
      out.closingValue,
    )
  })

  test('AA · the source\'s own weekly P&L is summed as an INDEPENDENT check', () => {
    const out = buildPeriodPerformance(base)
    // 5 + 5 + 5 + 5 over the same four intervals — the FROM week's 500 excluded.
    assert.equal(out.sourceProfitSum, 20)
    assert.equal(out.profitCrossCheck, 'ok')
    assert.equal(out.profitCrossCheckDelta, 0)
  })

  test('AB · a material disagreement is REPORTED, never resolved', () => {
    const skewed = buildPeriodPerformance({
      ...base,
      profits: profits.map((p) =>
        p.observationDate === '2026-08-14' ? { ...p, value: 5_000 } : p,
      ),
    })
    assert.equal(skewed.profitCrossCheck, 'mismatch')
    // BOTH numbers survive: neither is adjusted to agree with the other.
    assert.equal(skewed.profit, 20)
    assert.equal(skewed.sourceProfitSum, 5015)
    assert.notEqual(skewed.profitCrossCheckDelta, 0)
    // And the surface says so, in its own line.
    assert.match(surface, /periodPerf\?\.profitCrossCheck === 'mismatch'/)
    assert.match(surface, /\{w\.periodCrossMismatch\}/)
  })

  test('AC · a complete return series COMPOUNDS — it is never P&L over opening', () => {
    const out = buildPeriodPerformance(base)
    const expected = 1.01 * 1.02 * 1.03 * 1.04 - 1
    assert.ok(Math.abs((out.periodReturn ?? 0) - expected) < 1e-12)
    // The naive alternative is a DIFFERENT number, which is why the rule exists:
    // 20/100 = 20% against a compounded ~10.4%.
    const naive = (out.profit ?? 0) / (out.openingValue ?? 1)
    assert.notEqual(Number(naive.toFixed(6)), Number((out.periodReturn ?? 0).toFixed(6)))
    // And nothing anywhere divides P&L by the opening value to make a return.
    assert.ok(!/profit \/ .*opening/i.test(codeOf(read('src/lib/familyPortfolio/periodPerformance.ts'))))
    assert.ok(!/periodReturn = .*\/ /.test(codeOf(surface)))
  })

  test('AD · one missing weekly return makes the PERIOD return unavailable', () => {
    const gap = buildPeriodPerformance({
      ...base,
      returns: returns.filter((r) => r.observationDate !== '2026-08-21'),
    })
    assert.equal(gap.periodReturn, null)
    assert.equal(gap.returnUnavailableReason, 'incomplete_history')
    // Never partially compounded, and never invented.
    assert.ok(gap.periodReturn === null)
    // A missing FLOW does the same to the flows and, through the identity, to
    // the P&L — a partial sum would understate the money moved.
    const flowGap = buildPeriodPerformance({
      ...base,
      flows: flows.filter((f) => f.observationDate !== '2026-08-21'),
    })
    assert.equal(flowGap.netFlows, null)
    assert.equal(flowGap.profit, null)
    assert.equal(flowGap.flowsUnavailableReason, 'incomplete_history')
    // The value change survives: it is a difference of two snapshots and is
    // correct over any span.
    assert.equal(flowGap.valueChange, 50)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AE–AH · Rankings, charts, listing and the cash copy
// ═══════════════════════════════════════════════════════════════════════════

describe('AE–AH · the shared blocks speak their own interval', () => {
  test('AE · the ranked panels use ENDPOINT row values and period column names', () => {
    // The rows are the same change nodes either way — a row's change is its
    // closing value minus its opening one, over whatever window the endpoints
    // define. What changes is what the columns are CALLED.
    assert.match(surface, /<MaskedAmount value=\{n\.previousValue\} masked=\{masked\} \/>/)
    assert.match(surface, /<MaskedAmount value=\{n\.currentValue\} masked=\{masked\} \/>/)
    assert.match(surface, /\{labels\.colOpening\}/)
    assert.match(surface, /\{labels\.colClosing\}/)
    assert.match(surface, /\{labels\.valueChange\}/)
    // Each column header carries its own endpoint DATE beneath the name.
    assert.match(surface, /formatIsoDateLabel\(dates\.opening\)/)
    assert.match(surface, /formatIsoDateLabel\(dates\.closing\)/)
    // The period branch names its columns From/To, never Previous/This Week.
    const period = contract.slice(
      contract.indexOf("if (mode === 'period') {"),
      contract.indexOf('  return {\n    title: w.title,'),
    )
    assert.match(period, /colOpening: p\.colFrom/)
    assert.match(period, /colClosing: p\.colTo/)
    assert.ok(!period.includes('p.colPrev') && !period.includes('p.colThis'))
  })

  test('AF · the hierarchy chart is titled and captioned by the mode', () => {
    assert.match(surface, /<h2 className="ui-label text-muted-fg">\{labels\.hierarchyTitle\}<\/h2>/)
    assert.match(surface, /<p className="ui-meta text-muted-fg">\{labels\.hierarchySubtitle\}<\/p>/)
    assert.match(surface, /ariaLabel=\{labels\.hierarchyTitle\}/)
    // Its reconciliation footer is interval-neutral and stays shared.
    assert.match(surface, /\{w\.parentChange\}/)
  })

  test('AG · the full listing is titled by the mode, columns included', () => {
    assert.match(surface, /title=\{labels\.fullTableTitle\}/)
    const table = surface.slice(surface.indexOf('§ 6h item 7'))
    assert.match(table, /\{labels\.colOpening\}/)
    assert.match(table, /\{labels\.colClosing\}/)
    assert.match(table, /\{labels\.valueChange\}/)
    // The two interval-independent columns stay dictionary reads.
    assert.match(table, /\{w\.ownPctChange\}/)
    assert.match(table, /\{w\.impactOnPortfolio\}/)
    // A row the source could not compare names the ENDPOINT the reader chose.
    assert.match(surface, /reasonText\(n\.unavailableReason, labels, w\)/)
    assert.match(contract, /reasonMissingCurrent: w\.periodReasonMissingCurrent/)
    // The impact denominator is named for the endpoint the reader chose.
    assert.match(dict.en.fp.weeklyChanges.periodMethodologyImpact, /at the From date/)
    assert.match(dict.en.fp.weeklyChanges.periodReasonMissingPrevious, /From date/)
    assert.match(dict.en.fp.weeklyChanges.periodReasonMissingCurrent, /To date/)
  })

  test('AH · the Caja copy names the right interval, and the rule is unchanged', () => {
    // The ECONOMICS are identical — cash absorbs money on its way in or out —
    // so the rule, the default and the toggle are shared. Only the sentence's
    // timeframe differs, which is exactly what the contract is for.
    assert.match(surface, /rankWeeklyChanges\(nodes, \{ excludeCash: !includeCash \}\)/)
    assert.match(surface, /\{w\.cashToggleLabel\}/)
    assert.match(surface, /\{labels\.cashWhy\}/)
    assert.equal(changesLabels('weekly', dict.en).cashWhy, dict.en.fp.weeklyChanges.cashWhy)
    assert.equal(changesLabels('period', dict.en).cashWhy, dict.en.fp.weeklyChanges.periodCashWhy)
    // The period sentence must not call a five-month cash movement a weekly one.
    for (const lang of ['en', 'es'] as const) {
      const s = dict[lang].fp.weeklyChanges.periodCashWhy
      for (const word of WEEKLY_VOCABULARY) {
        assert.ok(!s.toLowerCase().includes(word), `${lang}: ${s}`)
      }
      assert.ok(/period|período/i.test(s), `${lang} names the period: ${s}`)
    }
  })

  test('AH · View All is the same control on both surfaces', () => {
    // ONE definition, so it cannot fork: the button, its target and its
    // reduced-motion path all live in the shared surface.
    assert.equal((surface.match(/\{w\.viewAll\} ↓/g) ?? []).length, 1)
    assert.match(surface, /fullTableRef\.current\?\.scrollIntoView/)
    assert.match(surface, /prefers-reduced-motion: reduce/)
    for (const page of [weekly, compare]) {
      assert.ok(!page.includes('viewAll'), 'neither page defines its own')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// AI–AJ · The shared presentation architecture
// ═══════════════════════════════════════════════════════════════════════════

describe('AI–AJ · one surface, one contract', () => {
  test('AI · both pages render the SAME component, and hold no markup of their own', () => {
    for (const [name, page] of [['weekly', weekly], ['compare', compare]] as const) {
      assert.match(page, /<ChangesSurface\b/, `${name} renders the shared surface`)
      assert.match(
        page,
        /from '@\/components\/familyPortfolio\/ChangesSurface'/,
        `${name} imports it`,
      )
    }
    assert.match(weekly, /<ChangesSurface mode="weekly"/)
    assert.match(compare, /<ChangesSurface mode="period"/)

    // NEITHER page contains a copy of the body. The blocks the owner asked to
    // stay synchronised are defined once, in the surface, and nowhere else.
    for (const block of ['KpiHero', 'ContributionChart', 'RankedPanel', 'structuralRowClasses', 'TableCard']) {
      assert.ok(surface.includes(block), `${block} lives in the shared surface`)
      assert.ok(!weekly.includes(block), `the weekly page must not redefine ${block}`)
      assert.ok(!compare.includes(block), `the Compare page must not redefine ${block}`)
    }
    // The layout classes the owner named — the hero/ledger split and the
    // movers/chart row — exist ONCE each in the whole app.
    for (const grid of [
      'grid-cols-1 xl:grid-cols-[minmax(0,0.8fr)_1fr]',
      'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]',
    ]) {
      assert.equal((surface.split(grid).length - 1), 1, `${grid} is defined once`)
      assert.ok(!weekly.includes(grid) && !compare.includes(grid))
    }
  })

  test('AI · the headline stays LEFT and vertically centred, for both intervals', () => {
    // The owner's layout, asserted on the ONE place it is now written.
    assert.match(surface, /className="justify-center border-b border-border pb-4 xl:border-b-0 xl:pb-0 xl:pr-6"/)
    assert.match(surface, /flex flex-col gap-2 min-w-0 xl:border-l xl:border-border xl:pl-6/)
    const hero = surface.indexOf('label={labels.valueChange}')
    const ledger = surface.indexOf('{labels.reconTitle}')
    assert.ok(hero > 0 && ledger > hero, 'the headline precedes the ledger in the DOM')
    assert.ok(!/xl:order-[12]/.test(surface), 'no order utility reverses the two halves')
    // Text stays left-aligned: nothing centres a line of type in that block.
    const block = surface.slice(
      surface.indexOf('grid-cols-1 xl:grid-cols-[minmax(0,0.8fr)_1fr]'),
      surface.indexOf('{labels.reconNote}'),
    )
    assert.ok(!/text-center/.test(block) && !/items-center/.test(block))
  })

  test('AJ · every interval-dependent word comes through the typed contract', () => {
    // THE ARCHITECTURAL RULE: no `mode === …` ternary at a label site. That
    // pattern is what left three blocks of the old page saying "Weekly" over a
    // five-month range — a ternary only fixes the site somebody remembered.
    const code = codeOf(surface)
    const ternaries = code.match(/isPeriod \?[^\n]*/g) ?? []
    for (const t of ternaries) {
      assert.ok(
        !/\bw\.[a-zA-Z]+\b[\s\S]*:[\s\S]*\bw\.[a-zA-Z]+\b/.test(t),
        `a label is being chosen by a ternary rather than the contract: ${t.trim()}`,
      )
    }
    // The contract is EXHAUSTIVE for both modes: the compiler demands every
    // field twice, and the two branches resolve disjoint interval vocabulary.
    const en = changesLabels('weekly', dict.en)
    const enPeriod = changesLabels('period', dict.en)
    assert.deepEqual(Object.keys(en), Object.keys(enPeriod))
    assert.ok(Object.keys(en).length >= 20, 'the contract covers the whole surface')
    // Non-vacuity: most fields genuinely differ between the two modes. The ones
    // that do not are interval-independent by design and named here.
    const same = Object.keys(en).filter((k) => (en as Record<string, string>)[k] === (enPeriod as Record<string, string>)[k])
    // `reconTitle` is shared on the owner's own instruction (§ 11: the heading
    // "Flow and investment-result reconciliation" may remain), and
    // `fullTableNote` describes published row ORDER. Nothing else is shared —
    // `methodologyImpact` looked interval-independent and was not, because its
    // weekly wording names "the previous week's portfolio total".
    assert.deepEqual(same.sort(), ['fullTableNote', 'reconTitle'])
  })

  test('AJ · the surface is presentation only — no fetch, no second calculator', () => {
    const code = codeOf(surface)
    assert.ok(!/fetch\(|useEffect|fetchFamilyPortfolio/.test(code), 'the surface never fetches')
    // Every figure comes from the response or from a LOCKED pure module.
    for (const pure of [
      'rankWeeklyChanges',
      'deriveDrivers',
      'buildWaterfall',
      'buildFullChangesTable',
      'buildContributionSet',
      'contributionChildren',
    ]) {
      assert.ok(code.includes(pure), `${pure} is called, not reimplemented`)
    }
    // And it computes no financial semantic of its own.
    for (const forbidden of ['.rpc(', '.insert(', '.upsert(', 'createClient']) {
      assert.ok(!code.includes(forbidden), `the surface must not call ${forbidden}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// The analytical-history architecture is PRESERVED, not reworked
// ═══════════════════════════════════════════════════════════════════════════

describe('the R13.8 architecture and the analytical history are untouched', () => {
  const MIGRATION = 'supabase/migrations/20260822000000_portfolio_analytical_history.sql'

  test('the migration is the same file, and still unapplied to Production', () => {
    assert.ok(existsSync(join(ROOT, MIGRATION)), 'the analytical-history migration is unchanged')
    const sql = read(MIGRATION)
    assert.match(sql, /create table if not exists public\.portfolio_row_history/)
    assert.match(sql, /create table if not exists public\.portfolio_performance_history/)
    // ONE upload -> ONE import operation -> N evolution points -> N row-history
    // dates -> N performance-history dates -> ONE newest full publication.
    assert.match(sql, /ONE upload -> ONE import operation -> N evolution points/)
  })

  test('this stage adds no second write path', () => {
    // A UI split cannot introduce a write. The member read route is still a
    // read, and neither new file touches an importer or a client.
    const routeCode = codeOf(route)
    for (const write of ['importPortfolioWorkbook', '.rpc(', '.insert(', '.upsert(']) {
      assert.ok(!routeCode.includes(write), `the weekly-changes route must not call ${write}`)
    }
    for (const [name, src] of [['compare page', compare], ['surface', surface], ['contract', contract]] as const) {
      assert.ok(!/supabase|createClient|\.rpc\(/i.test(codeOf(src)), `${name} touches no client`)
    }
  })

  test('the rolling 1M window still opens on ROW history, four intervals back', () => {
    // Unchanged by this stage: 1M is four source reporting intervals, and for
    // 2026-09-04 that opens at 2026-08-07 — a week with no publication.
    assert.match(route, /getRowHistoryForScope\(scope, openingRequested\)/)
    const fourBack = ELIGIBLE.filter((d) => d <= TO).slice(-5)[0]
    assert.equal(fourBack, '2026-08-07')
    assert.ok(!PUBLISHED.includes(fourBack), 'and it is not a publication')
  })

  test('the prospective previousWeekDate fix and its read guard are preserved', () => {
    const repo = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
    assert.match(repo, /function anchorBefore\(candidate: string \| null, asOfDate: string\)/)
    assert.match(repo, /return candidate < asOfDate \? candidate : null/)
    // The route guards independently of the repository.
    assert.match(route, /hasSourceWeeklyBasis\(/)
  })

  test('the scope parameter survives a click onto Compare', () => {
    assert.ok((SCOPE_AWARE_ROUTES as readonly string[]).includes(PORTFOLIO_COMPARE))
    assert.equal(scopeHref(PORTFOLIO_COMPARE, 'andres'), '/portfolio/compare?scope=andres')
    assert.equal(scopeHref(PORTFOLIO_COMPARE, null), '/portfolio/compare')
    assert.match(compare, /router\.replace\(scopeHref\(PORTFOLIO_COMPARE, next\)/)
  })
})
