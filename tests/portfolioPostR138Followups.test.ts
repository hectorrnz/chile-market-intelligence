// POST-R13.8 Portfolio follow-ups — rolling 1M, date-only selectors, and the
// rebuilt Weekly Changes compare controls.
//
// WHY THESE FOUR SIT IN ONE FILE. They are one bug report from the owner after
// the first real weekly import, and they share one root cause: R13.8 changed
// what the publication spine LOOKS LIKE. A catch-up upload writes N evolution
// history points and ONE publication, so the spine now jumps 2026-07-31 →
// 2026-09-04 with four real weeks in between that were never published. Every
// surface that assumed "one week = one publication, evenly spaced" started
// reading wrong: 1M resolved to a single publication and reported nothing;
// seven weeks lifted to a new revision at once turned the week selector into a
// revision browser; and the FROM/TO controls, built when the spine was dense,
// asked the reader to configure a comparison the page performs by itself.
//
// The catch-up architecture itself is NOT under test here to be changed — it is
// under test to be PRESERVED. § 5 below asserts that nothing in this patch
// invents a publication for an evolution-only week.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import {
  EVOLUTION_PERIODS,
  TRAILING_MONTH_DAYS,
  TRAILING_MONTH_INTERVALS,
  openingByIntervals,
  periodBoundary,
  selectEvolutionRange,
  shiftIsoDays,
} from '../src/lib/familyPortfolio/evolutionRange.ts'
import {
  VALUE_CHANGE_PERIODS,
  selectValueChangeRange,
} from '../src/lib/familyPortfolio/valueChangeRange.ts'
import { selectComparisonRange, selectWeekPair } from '../src/lib/familyPortfolio/weeklyChanges.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Strips comments so hygiene regexes cannot be tripped by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const WEEKLY_PAGE = 'src/app/portfolio/weekly-changes/page.tsx'
const HOLDINGS_PAGE = 'src/app/portfolio/holdings/page.tsx'
const SELECTOR = 'src/components/familyPortfolio/WeekSelector.tsx'
const CARD = 'src/components/familyPortfolio/PeriodValueChangeCard.tsx'
const WEEKLY_ROUTE = 'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts'

const weeklyPage = read(WEEKLY_PAGE)
const holdings = read(HOLDINGS_PAGE)
const selector = read(SELECTOR)
const card = read(CARD)

// ─────────────────────────────────────────────────────────────────────────────
// THE REAL PRODUCTION SHAPE, after the first catch-up import.
//
// PUBLICATIONS jump 2026-07-31 → 2026-09-04: the 2026-09-04 upload carried five
// unpublished frozen weeks and published only the newest, exactly as the locked
// architecture requires.
//
// EVOLUTION holds every one of those weeks. Both lists are the same book.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLISHED = [
  '2026-06-12', '2026-06-19', '2026-06-26', '2026-07-03',
  '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31',
  '2026-09-04',
]
const CATCH_UP = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']
const EVOLUTION = [...PUBLISHED.filter((d) => d < '2026-09-04'), ...CATCH_UP, '2026-09-04'].sort()

const spine = PUBLISHED.map((asOfDate) => ({ asOfDate }))
const observations = EVOLUTION.map((date, i) => ({ date, value: 1_000 + i }))

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 1M is a TRAILING FOUR-WEEK window, never month-to-date
// ═══════════════════════════════════════════════════════════════════════════

describe('post-R13.8 · 1M rolling semantics', () => {
  test('1M is FOUR REPORTING INTERVALS, counted on the spine the source closed', () => {
    assert.equal(TRAILING_MONTH_INTERVALS, 4)
    // Counted over the real reporting weeks, four intervals back from 2026-09-04
    // is 2026-08-07 - the week the owner named.
    assert.equal(openingByIntervals(EVOLUTION, '2026-09-04', 4), '2026-08-07')
    // The nominal calendar boundary is retained for DISCLOSURE only, and agrees
    // here because this book freezes a column every seven days.
    assert.equal(TRAILING_MONTH_DAYS, 28)
    assert.equal(periodBoundary('2026-09-04', '1M'), '2026-08-07')
    assert.equal(shiftIsoDays('2026-09-04', -28), '2026-08-07')
  })

  test('a skipped source week does NOT shorten the period - 28 days would have', () => {
    // THE reason the boundary is no longer the selector. Drop 08-14 from the
    // book: 28 days still reaches 08-07, but only three intervals sit inside it.
    // Interval counting reaches a real fourth step back instead.
    const skipped = EVOLUTION.filter((d) => d !== '2026-08-14')
    const withinDays = skipped.filter((d) => d >= '2026-08-07' && d <= '2026-09-04')
    assert.equal(withinDays.length - 1, 3, 'the 28-day reach would measure three intervals')
    assert.equal(openingByIntervals(skipped, '2026-09-04', 4), '2026-07-31')
    const r = selectEvolutionRange(
      skipped.map((date, i) => ({ date, value: 1_000 + i })),
      '1M',
    )
    assert.equal(r.points.length - 1, 4, 'four intervals, whatever the calendar did')
  })

  test('the four intervals ARE 08-07 / 08-14 / 08-21 / 08-28 / 09-04', () => {
    const r = selectEvolutionRange(observations, '1M')
    assert.deepEqual(
      r.points.map((p) => p.date),
      ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04'],
    )
    // Five endpoints, four intervals - the owner's own arithmetic.
    assert.equal(r.points.length - 1, 4)
    assert.equal(r.startDate, '2026-08-07')
    assert.equal(r.endDate, '2026-09-04')
  })

  test('the value-change card requires 2026-08-07 exactly, and REFUSES to approximate', () => {
    // THE regression this pass exists for. The first patch resolved this to
    // 2026-07-31 -> 2026-09-04, five intervals under a four-interval label, and
    // the owner rejected it. 08-07 is a real reporting week with no publication,
    // so the decomposition cannot be built and the range says which week.
    const r = selectValueChangeRange(spine, '1M', null, EVOLUTION)
    assert.equal(r.state, 'opening_not_published')
    assert.equal(r.requiredOpeningDate, '2026-08-07')
    assert.equal(r.toDate, '2026-09-04')
    assert.equal(r.fromDate, null, 'no opening endpoint is asserted')
    // The rejected approximation must not be reachable by any path.
    assert.notEqual(r.fromDate, '2026-07-31')
  })

  test('it is not September month-to-date either', () => {
    // MTD would have put the boundary inside September with one publication in
    // the window. The required opening reaches into AUGUST, as a month should.
    const r = selectValueChangeRange(spine, '1M', null, EVOLUTION)
    assert.ok((r.requiredOpeningDate as string) < '2026-09-01')
    assert.equal((periodBoundary('2026-09-04', '1M') as string).slice(0, 7), '2026-08')
  })

  test('a catch-up week is never promoted to an endpoint', () => {
    const published = new Set(PUBLISHED)
    const r = selectValueChangeRange(spine, '1M', null, EVOLUTION)
    assert.ok(r.toDate === null || published.has(r.toDate))
    for (const d of CATCH_UP) {
      assert.notEqual(r.fromDate, d, `${d} has no publication and must never open the window`)
      assert.notEqual(r.toDate, d)
    }
    // Naming the missing week is not the same as selecting it.
    assert.ok(CATCH_UP.includes(r.requiredOpeningDate as string))
    assert.equal(r.state, 'opening_not_published')
  })

  test('Main and a personal portfolio resolve by the SAME rule', () => {
    // The selector is scope-agnostic by construction - it is handed two spines
    // and knows nothing else. A personal book shorter than the family's gets the
    // same treatment, from the same function.
    const personalEvolution = EVOLUTION.filter((d) => d !== '2026-06-12')
    const personalSpine = PUBLISHED.filter((d) => d !== '2026-06-12').map((asOfDate) => ({ asOfDate }))
    const main = selectValueChangeRange(spine, '1M', null, EVOLUTION)
    const own = selectValueChangeRange(personalSpine, '1M', null, personalEvolution)
    assert.equal(main.state, own.state)
    assert.equal(main.requiredOpeningDate, own.requiredOpeningDate)
    assert.equal(own.requiredOpeningDate, '2026-08-07')
  })

  test('a fully published spine resolves 1M to a real four-interval comparison', () => {
    // The same rule on a book with no catch-up gap: four intervals back is a
    // published week, so the window opens there and the card draws.
    const dense = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04']
    const r = selectValueChangeRange(
      dense.map((asOfDate) => ({ asOfDate })),
      '1M',
      null,
      dense,
    )
    assert.equal(r.state, 'ok')
    assert.equal(r.fromDate, '2026-08-07')
    assert.equal(r.toDate, '2026-09-04')
    assert.equal(r.weekCount, 5)
    assert.equal(r.requiredOpeningDate, null)
  })

  test('a genuinely short history degrades honestly - never a fabricated endpoint', () => {
    // Fewer than four intervals on record: truncated, and reported as the
    // single-week emptiness it is rather than as a shorter "month".
    const young = ['2026-08-28', '2026-09-04']
    const r = selectValueChangeRange(
      young.map((asOfDate) => ({ asOfDate })),
      '1M',
      null,
      young,
    )
    assert.equal(r.state, 'single_week')
    assert.equal(r.fromDate, null)
    assert.equal(r.truncatedByHistory, true)
    assert.equal(r.requiredOpeningDate, null)

    const lone = selectValueChangeRange([{ asOfDate: '2026-09-04' }], '1M', null, ['2026-09-04'])
    assert.equal(lone.state, 'single_week')
    assert.equal(lone.toDate, '2026-09-04')
    assert.equal(selectValueChangeRange([], '1M').state, 'no_publications')
  })

  test('omitting the reporting spine falls back to publications, never to a guess', () => {
    // Every pre-existing caller passes no spine. It then counts intervals over
    // the publications it does have - a subset, so it can only ever reach
    // FURTHER back, never onto a week that does not exist.
    const r = selectValueChangeRange(spine, '1M')
    assert.equal(r.state, 'ok')
    assert.equal(r.toDate, '2026-09-04')
    assert.equal(r.fromDate, '2026-07-10')
    assert.ok(PUBLISHED.includes(r.fromDate as string))
  })

  test('3M / YTD / 1Y / ALL are NOT redefined by this change', () => {
    // Same sparse spine. Each still opens at the first publication ON OR AFTER
    // its own boundary - the pre-existing CALENDAR rule, deliberately untouched,
    // because none of them exhibited the defect.
    for (const period of ['3M', 'YTD', '1Y'] as const) {
      const r = selectValueChangeRange(spine, period, null, EVOLUTION)
      assert.equal(r.state, 'ok')
      assert.ok(
        (r.fromDate as string) >= (r.boundary as string),
        `${period} must not reach back past its boundary`,
      )
      assert.equal(r.requiredOpeningDate, null)
    }
    const all = selectValueChangeRange(spine, 'ALL', null, EVOLUTION)
    assert.equal(all.fromDate, '2026-06-12')
    assert.equal(all.boundary, null)
    // The calendar arithmetic those three depend on is untouched.
    assert.equal(periodBoundary('2026-09-04', '3M'), '2026-06-04')
    assert.equal(periodBoundary('2026-09-04', 'YTD'), '2026-01-01')
    assert.equal(periodBoundary('2026-09-04', '1Y'), '2025-09-04')
    // 3M over this spine holds many publications, so it does NOT share the old
    // 1M defect. Its boundary is still a calendar shift - recorded here so a
    // later reader can see the audit was performed, not assumed.
    const threeMonth = selectValueChangeRange(spine, '3M', null, EVOLUTION)
    assert.ok((threeMonth.weekCount as number) >= 8)
  })

  test('the rails are unchanged - no period was added or removed', () => {
    assert.deepEqual([...VALUE_CHANGE_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
    assert.deepEqual([...EVOLUTION_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
  })

  test('an unbuildable 1M window NAMES the missing week, in both languages', () => {
    assert.match(card, /range\.state === 'opening_not_published'/)
    assert.match(card, /o\.vwfOpeningNotPublished/)
    assert.match(card, /range\.requiredOpeningDate/)
    for (const lang of ['en', 'es'] as const) {
      const msg = dict[lang].fp.overview.vwfOpeningNotPublished
      assert.equal(typeof msg, 'string')
      assert.ok(msg.length > 30, `${lang} disclosure must be a real sentence`)
    }
    // The rejected "wider window" wording is gone with the behaviour it described.
    assert.ok(!/vwfWiderWindow/.test(card))
    assert.ok(!/openingPrecedesBoundary/.test(card))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · The week selector shows DATES, not revisions
// ═══════════════════════════════════════════════════════════════════════════

describe('post-R13.8 · date-only week selectors', () => {
  test('the shared selector renders the date alone', () => {
    assert.match(selector, /\{formatIsoDateLabel\(w\.asOfDate\)\}/)
    const code = codeOf(selector)
    assert.ok(!/revisionShort/.test(code), 'no "Rev. N" suffix in the option label')
    assert.ok(!/w\.revision/.test(code), 'the option label reads no revision at all')
  })

  test('both member-facing selectors are the shared one — the change cannot be partial', () => {
    for (const [name, src] of [['holdings', holdings], ['weekly changes', weeklyPage]] as const) {
      assert.match(src, /<WeekSelector/, `${name} uses the shared control`)
      // No page builds its own dated option list beside it.
      assert.ok(!/<option[^>]*>\s*\{formatIsoDateLabel/.test(src), `${name} builds no rival selector`)
    }
  })

  test('revision identity survives — it is unlabelled here, not discarded', () => {
    // The field still travels on every week…
    assert.match(read('src/lib/data/familyPortfolio.ts'), /revision: number/)
    // …the route still returns it with each week…
    assert.match(read(WEEKLY_ROUTE), /asOfDate: p\.asOfDate, revision: p\.revision/)
    // …and the surfaces that exist to state provenance still print it.
    assert.match(holdings, /t\.fp\.portfolio\.revisionShort\} \{snapshot\.revision\}/)
    assert.match(weeklyPage, /t\.fp\.portfolio\.revisionShort\} \{pub\.revision\}/)
  })

  test('only the CURRENT revision of a date is ever selectable', () => {
    // The spine the selector is handed comes from `listCurrentPublications`, so
    // a superseded revision is unreachable from a member surface by
    // construction — not by the label having been removed.
    assert.match(read(WEEKLY_ROUTE), /listCurrentPublications\('portfolio'\)/)
    assert.match(read('src/app/api/family-portfolio/[scope]/snapshot/route.ts'), /listCurrentPublications/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Compare — off by default, both endpoints read-only until asked for
// ═══════════════════════════════════════════════════════════════════════════

describe('post-R13.8 · compare controls', () => {
  test('Compare is OFF by default and is not persisted', () => {
    assert.match(weeklyPage, /const \[compareOn, setCompareOn\] = useState\(false\)/)
    // A comparison is a question, not a preference: it must not be restored
    // from storage on the next visit.
    assert.ok(!/usePersistentState<[^>]*>\('cmi\.fpCompare/.test(weeklyPage))
    assert.ok(!/compareOn.*usePersistentState/.test(weeklyPage))
  })

  test('the "Weekly" pseudo-range option is GONE, control and string alike', () => {
    const code = codeOf(weeklyPage)
    assert.ok(!/WEEKLY_DEFAULT/.test(code), 'the sentinel is removed')
    assert.ok(!/leadingOption/.test(code), 'no extra option sits above the dates')
    assert.ok(!/leadingOption/.test(codeOf(selector)), 'the control no longer offers one')
    for (const lang of ['en', 'es'] as const) {
      assert.ok(
        !('compareWeekly' in dict[lang].fp.weeklyChanges),
        `${lang}: the dead "Weekly" range string is deleted`,
      )
    }
  })

  test('FROM and TO are both read-only while Compare is off', () => {
    // One expression, used by both selects: the page is loading, or compare is
    // off. Neither endpoint can be changed in standard weekly mode.
    assert.equal((weeklyPage.match(/disabled=\{loading \|\| !compareOn\}/g) ?? []).length, 2)
  })

  test('FROM sits physically LEFT of TO', () => {
    const toggle = weeklyPage.indexOf('w.compareToggle')
    const from = weeklyPage.indexOf('label={w.compareFrom}')
    const to = weeklyPage.indexOf('label={w.compareTo}')
    assert.ok(toggle > 0 && from > 0 && to > 0, 'all three controls render')
    assert.ok(toggle < from, 'the switch introduces the pair')
    assert.ok(from < to, 'FROM precedes TO in the control row')
  })

  test('off compare, the endpoints are the page\'s own — latest week, preceding week', () => {
    // Nothing is chosen: `asOf` null resolves to the latest publication and
    // `compareFrom` null to the immediately preceding one, server-side.
    const pair = selectWeekPair(spine, null)
    assert.ok(pair.ok)
    assert.equal(pair.selection.current.asOfDate, '2026-09-04')
    assert.equal(pair.selection.previous?.asOfDate, '2026-07-31')
    // Turning compare off resets BOTH endpoints, so the page returns to exactly
    // that pair rather than stranding the reader on a week they cannot leave.
    assert.match(weeklyPage, /setCompareOn\(false\)\s*\n\s*setCompareFrom\(null\)\s*\n\s*setAsOf\(null\)/)
  })

  test('turning Compare on opens on a real PUBLICATION pair, not the weekly one', () => {
    // Compare is an endpoint comparison, so it must open on two endpoints that
    // can carry one. The weekly opening endpoint is the source's own
    // previous-week column — a week the book never published — so entering
    // compare seeds FROM with the most recent earlier PUBLICATION instead.
    assert.match(weeklyPage, /setAsOf\(pub\.asOfDate\)\s*\n\s*setCompareFrom\(earlierWeeks\[0\]\.asOfDate\)\s*\n\s*setCompareOn\(true\)/)
    // The FROM select always shows a real date — never a blank, never a
    // sentinel word — from whichever option list the current mode supplies.
    assert.match(weeklyPage, /value=\{compareFrom \?\? fromOptions\[0\]\.asOfDate\}/)
  })

  test('FROM offers publications in compare, and the resolved weekly week off it', () => {
    // OFF: one read-only option, the week the page is actually measuring from.
    // That week is deliberately absent from the publication list after a
    // catch-up import, so the control carries it rather than rendering blank.
    assert.match(weeklyPage, /if \(compareOn \|\| prevPub === null\) return earlierWeeks/)
    assert.match(weeklyPage, /asOfDate: prevPub\.asOfDate, revision: 0/)
    // ON: only published weeks, because a custom comparison needs a full
    // snapshot at both ends. No evolution-only week is ever offered.
    assert.match(weeklyPage, /weeks=\{fromOptions\}/)
  })

  test('a reversed range cannot be built in the UI, and is refused server-side', () => {
    // The FROM list holds only weeks strictly earlier than the selected TO…
    assert.match(weeklyPage, /\.filter\(\(x\) => selectedWeek !== null && x\.asOfDate < selectedWeek\)/)
    // …and moving TO onto or before the chosen FROM drops FROM rather than
    // carrying an impossible pair.
    assert.match(weeklyPage, /if \(compareFrom !== null && compareFrom >= next\) setCompareFrom\(null\)/)
    // The server refuses independently, whatever any client sends.
    assert.equal(selectComparisonRange(spine, '2026-09-04', '2026-07-31').ok, false)
    const reversed = selectComparisonRange(spine, '2026-09-04', '2026-07-31')
    assert.equal(reversed.ok === false && reversed.code, 'from_not_before_to')
    assert.equal(
      selectComparisonRange(spine, '2026-07-31', '2026-07-31').ok === false &&
        (selectComparisonRange(spine, '2026-07-31', '2026-07-31') as { code: string }).code,
      'from_not_before_to',
    )
    // A valid explicit pair still resolves, and reports itself as custom.
    const ok = selectComparisonRange(spine, '2026-06-19', '2026-09-04')
    assert.ok(ok.ok)
    assert.equal(ok.selection.mode, 'custom')
  })

  test('a scope switch resets the comparison rather than carrying it across', () => {
    assert.match(
      weeklyPage,
      /setCompareFrom\(null\)\s*\n\s*setAsOf\(null\)\s*\n\s*setCompareOn\(false\)/,
    )
  })

  test('the toggle is a real switch, named in both languages', () => {
    assert.match(weeklyPage, /<Switch\b/)
    assert.match(weeklyPage, /aria-label=\{w\.compareModeLabel\}/)
    for (const lang of ['en', 'es'] as const) {
      const d = dict[lang].fp.weeklyChanges
      assert.equal(typeof d.compareToggle, 'string')
      assert.ok(d.compareToggle.length > 0)
      assert.equal(typeof d.compareModeLabel, 'string')
    }
  })

  test('a disabled date control stays legible — dimmed, never greyed into the background', () => {
    assert.match(selector, /disabled:opacity-60 disabled:cursor-not-allowed/)
    // The value keeps the full-contrast foreground token: it is the comparison
    // the page is showing, not decoration.
    assert.match(selector, /text-foreground ui-number disabled:opacity-60/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Copy follows the controls
// ═══════════════════════════════════════════════════════════════════════════

describe('post-R13.8 · copy', () => {
  test('the standard-mode note still names the comparison the page performs', () => {
    for (const lang of ['en', 'es'] as const) {
      const note = dict[lang].fp.weeklyChanges.pairNote
      assert.ok(/preceding|anterior/i.test(note), `${lang}: names the preceding published week`)
    }
    assert.match(weeklyPage, /w\.pairNote/)
    assert.match(weeklyPage, /w\.customPairNote/)
  })

  test('no copy anywhere still describes a "Weekly" range option', () => {
    for (const lang of ['en', 'es'] as const) {
      const values = JSON.stringify(dict[lang].fp.weeklyChanges)
      assert.ok(!/"Weekly"/.test(values) && !/"Semanal"/.test(values))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The catch-up architecture is PRESERVED, not worked around
// ═══════════════════════════════════════════════════════════════════════════

describe('post-R13.8 · catch-up weeks stay evolution-only', () => {
  test('CUSTOM compare still needs a full publication at BOTH endpoints', () => {
    const route = codeOf(read(WEEKLY_ROUTE))
    // Every snapshot read is keyed by a PUBLICATION ID, so an evolution-only
    // week can never be a selectable custom endpoint — the catch-up
    // architecture is preserved, not worked around.
    assert.match(route, /getSnapshotRowsForScope\(current\.id, scope\)/)
    assert.match(route, /getSnapshotRowsForScope\(previous\.id, scope\)/)
    assert.match(route, /listCurrentPublications\('portfolio'\)/)
  })

  test('WEEKLY default reads the source previous-week column, not a second publication', () => {
    const route = codeOf(read(WEEKLY_ROUTE))
    // The one-week comparison comes out of the SELECTED publication alone:
    // its recorded previous-week date plus each row's own previous value.
    assert.match(route, /hasSourceWeeklyBasis\(currentRows\.rows, current\.previousWeekDate, current\.asOfDate\)/)
    assert.match(route, /previousRowSet = sourcePreviousWeekRows\(currentRows\.rows\)/)
    // And it applies ONLY in weekly mode — a custom range is two real endpoints.
    assert.match(route, /mode === 'weekly' &&\s*\n?\s*hasSourceWeeklyBasis/)
  })

  test('no surface manufactures a publication for 08-07 … 08-28', () => {
    const pub = new Set(PUBLISHED)
    for (const d of CATCH_UP) {
      assert.ok(!pub.has(d), 'fixture sanity: these weeks are unpublished')
      // The week list the selectors render is the publication spine itself.
      assert.equal(selectWeekPair(spine, d).ok, false)
      const miss = selectWeekPair(spine, d)
      assert.equal(miss.ok === false && miss.code, 'week_not_found')
      assert.equal(selectComparisonRange(spine, d, '2026-09-04').ok, false)
    }
  })

  test('the intermediate weeks ARE present where the source supports them', () => {
    // Evolution carries the real weekly chronology, so the trailing-month
    // window over observations is the true four intervals — the distinction the
    // patch preserves rather than erases.
    const r = selectEvolutionRange(observations, '1M')
    for (const d of CATCH_UP) {
      assert.ok(r.points.some((p) => p.date === d), `${d} is a real evolution point`)
    }
  })

  test('no page code fabricates or interpolates a week', () => {
    for (const [name, src] of [
      ['weekly changes', weeklyPage],
      ['holdings', holdings],
      ['value-change card', card],
    ] as const) {
      const code = codeOf(src)
      assert.ok(!/interpolat|synthesi[sz]e|nearestWeek|snapToWeek/i.test(code), `${name}`)
    }
  })
})
