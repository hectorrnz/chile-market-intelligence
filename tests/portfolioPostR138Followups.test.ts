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
  test('the boundary is four weekly intervals back — not a calendar month', () => {
    assert.equal(TRAILING_MONTH_DAYS, 28)
    // THE regression. A calendar-month shift from 2026-09-04 lands on
    // 2026-08-04; four weekly intervals land on 2026-08-07, which is the week
    // the owner named — the fourth interval back from the endpoint.
    assert.equal(periodBoundary('2026-09-04', '1M'), '2026-08-07')
    assert.equal(shiftIsoDays('2026-09-04', -28), '2026-08-07')
    // Month-end clamping cannot reappear through the back door: the reach is
    // the same 28 days from any endpoint, in any month, across a year and a
    // leap day.
    assert.equal(periodBoundary('2026-03-05', '1M'), '2026-02-05')
    assert.equal(periodBoundary('2026-01-02', '1M'), '2025-12-05')
    assert.equal(periodBoundary('2024-03-06', '1M'), '2024-02-07')
  })

  test('the four intervals ARE 08-07 → 08-14 → 08-21 → 08-28 → 09-04', () => {
    const r = selectEvolutionRange(observations, '1M')
    assert.deepEqual(
      r.points.map((p) => p.date),
      ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04'],
    )
    // Five endpoints, four intervals — the owner's own arithmetic.
    assert.equal(r.points.length - 1, 4)
    assert.equal(r.startDate, '2026-08-07')
    assert.equal(r.endDate, '2026-09-04')
  })

  test('the value-change card covers 2026-08-07 → 2026-09-04 using AUGUST history', () => {
    const r = selectValueChangeRange(spine, '1M')
    assert.equal(r.state, 'ok', 'the trailing month must resolve to a real comparison')
    assert.equal(r.toDate, '2026-09-04')
    // The book publishes nothing at the boundary, so the window opens at the
    // last publication BEFORE it. It therefore CONTAINS the trailing month
    // rather than being contained by it.
    assert.equal(r.fromDate, '2026-07-31')
    assert.ok((r.fromDate as string) <= (r.boundary as string))
    assert.equal(r.openingPrecedesBoundary, true)
    assert.equal(r.weekCount, 2)
  })

  test('it does NOT behave as September month-to-date', () => {
    const r = selectValueChangeRange(spine, '1M')
    // MTD would have been: boundary inside September, one publication in the
    // window, nothing to compare — the exact defect reported.
    assert.notEqual(r.state, 'single_week')
    assert.ok((r.fromDate as string) < '2026-09-01', 'the window reaches into August')
    // And the message that used to render is not reachable for this spine.
    const single = selectValueChangeRange(spine, '1M').state === 'single_week'
    assert.equal(single, false)
  })

  test('both endpoints stay REAL publications — a catch-up week never becomes one', () => {
    const published = new Set(PUBLISHED)
    const r = selectValueChangeRange(spine, '1M')
    assert.ok(published.has(r.fromDate as string))
    assert.ok(published.has(r.toDate as string))
    for (const d of CATCH_UP) {
      assert.notEqual(r.fromDate, d, `${d} has no publication and must never open the window`)
      assert.notEqual(r.toDate, d)
    }
  })

  test('Main and a personal portfolio resolve by the SAME rule', () => {
    // The selector is scope-agnostic by construction — it is handed a spine and
    // knows nothing else. A personal book that skipped a week the family book
    // published gets the same treatment, from the same function.
    const personal = PUBLISHED.filter((d) => d !== '2026-07-24').map((asOfDate) => ({ asOfDate }))
    const main = selectValueChangeRange(spine, '1M')
    const own = selectValueChangeRange(personal, '1M')
    assert.equal(main.state, 'ok')
    assert.equal(own.state, 'ok')
    assert.equal(own.toDate, '2026-09-04')
    assert.equal(own.fromDate, '2026-07-31')
    assert.equal(own.openingPrecedesBoundary, true)
  })

  test('a genuinely short history degrades honestly — never a fabricated endpoint', () => {
    // History begins INSIDE the window: the earliest real week opens it, and
    // the range says the record — not the book's weeks — cut it short.
    const young = [{ asOfDate: '2026-08-28' }, { asOfDate: '2026-09-04' }]
    const r = selectValueChangeRange(young, '1M')
    assert.equal(r.state, 'ok')
    assert.equal(r.fromDate, '2026-08-28')
    assert.equal(r.truncatedByHistory, true)
    assert.equal(r.openingPrecedesBoundary, false)

    // One published week is one week. No zero change, no invented opening.
    const lone = selectValueChangeRange([{ asOfDate: '2026-09-04' }], '1M')
    assert.equal(lone.state, 'single_week')
    assert.equal(lone.fromDate, null)
    assert.equal(lone.toDate, '2026-09-04')
    assert.equal(selectValueChangeRange([], '1M').state, 'no_publications')
  })

  test('3M / YTD / 1Y / ALL are NOT redefined by this change', () => {
    // Same sparse spine. Each still opens at the first publication ON OR AFTER
    // its own boundary — the pre-existing rule, deliberately untouched, because
    // none of them exhibited the defect.
    for (const period of ['3M', 'YTD', '1Y'] as const) {
      const r = selectValueChangeRange(spine, period)
      assert.equal(r.state, 'ok')
      assert.ok(
        (r.fromDate as string) >= (r.boundary as string),
        `${period} must not reach back past its boundary`,
      )
      assert.equal(r.openingPrecedesBoundary, false)
    }
    const all = selectValueChangeRange(spine, 'ALL')
    assert.equal(all.fromDate, '2026-06-12')
    assert.equal(all.boundary, null)
    assert.equal(all.openingPrecedesBoundary, false)
    // The calendar arithmetic those three depend on is untouched.
    assert.equal(periodBoundary('2026-09-04', '3M'), '2026-06-04')
    assert.equal(periodBoundary('2026-09-04', 'YTD'), '2026-01-01')
    assert.equal(periodBoundary('2026-09-04', '1Y'), '2025-09-04')
  })

  test('the rails are unchanged — no period was added or removed', () => {
    assert.deepEqual([...VALUE_CHANGE_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
    assert.deepEqual([...EVOLUTION_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
  })

  test('a window wider than its label SAYS so, in both languages', () => {
    assert.match(card, /range\?\.openingPrecedesBoundary === true/)
    assert.match(card, /o\.vwfWiderWindow/)
    for (const lang of ['en', 'es'] as const) {
      const s = dict[lang].fp.overview.vwfWiderWindow
      assert.equal(typeof s, 'string')
      assert.ok(s.length > 30, `${lang} disclosure must be a real sentence`)
    }
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

  test('turning Compare on keeps the pair on screen, then hands over both dates', () => {
    assert.match(weeklyPage, /setAsOf\(pub\.asOfDate\)\s*\n\s*setCompareOn\(true\)/)
    // The FROM select shows the resolved previous week until the reader picks
    // another — never a blank, never a sentinel word.
    assert.match(weeklyPage, /value=\{compareFrom \?\? prevPub\?\.asOfDate \?\? earlierWeeks\[0\]\.asOfDate\}/)
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
  test('Weekly Changes needs a full publication at BOTH endpoints', () => {
    const route = codeOf(read(WEEKLY_ROUTE))
    // Both snapshot reads are keyed by a publication id — which is precisely
    // why an evolution-only week can never be an endpoint here.
    assert.match(route, /getSnapshotRowsForScope\(current\.id, scope\)/)
    assert.match(route, /getSnapshotRowsForScope\(previous\.id, scope\)/)
    assert.match(route, /listCurrentPublications\('portfolio'\)/)
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
