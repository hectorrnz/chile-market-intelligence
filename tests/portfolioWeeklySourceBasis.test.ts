// POST-R13.8 follow-up B — "weekly" means ONE WEEK again.
//
// ── THE BUG, IN ONE SENTENCE ───────────────────────────────────────────────
//
// Weekly Changes computed its change by subtracting the PREVIOUS PUBLICATION,
// and after the first real catch-up import the previous publication is five
// weeks earlier than the previous week.
//
// R13.8's locked architecture is ONE UPLOAD → N EVOLUTION HISTORY POINTS → ONE
// NEW PUBLICATION. The 2026-09-04 upload carried five frozen weeks and published
// the newest, so the publication spine jumps 2026-07-31 → 2026-09-04 while the
// source itself closed 08-07, 08-14, 08-21 and 08-28 in between. Subtracting
// 07-31 therefore measured FIVE weeks under a "Weekly Change" title — and mixed
// bases while doing it, because `flow` and `weekly_profit` are the source's own
// ONE-WEEK figures for 09-04. The identity
//
//     previous value + net flows + weekly P&L = current value
//
// was being asked to tie a five-week level change to one week of parts. It
// cannot, and the residual it produced is the reconciliation warning reported.
//
// ── THE FIX USES DATA THE BOOK ALREADY PUBLISHES ───────────────────────────
//
// Every published row carries its own previous-week value
// (`metadata.previousValue`), and every publication carries that column's DATE
// (`metadata.previousWeekDate`). So the true one-week comparison for 2026-09-04
// is 2026-08-28 → 2026-09-04, and it comes out of the 09-04 publication ALONE.
//
// No second publication is read. No catch-up week is manufactured. The locked
// import architecture is untouched — asserted in § 5 of
// `portfolioPostR138Followups.test.ts` and again at the bottom of this file.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildChangeNodes,
  buildTotalMetrics,
  deriveDrivers,
  hasSourceWeeklyBasis,
  reconcileFlowAndProfit,
  resolvePreviousPortfolioTotal,
  selectComparisonRange,
  sourcePreviousWeekRows,
  suppressSingleWeekMetrics,
  type WeeklyChangeInputRow,
} from '../src/lib/familyPortfolio/weeklyChanges.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const WEEKLY_ROUTE = 'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts'
const WEEKLY_PAGE = 'src/app/portfolio/weekly-changes/page.tsx'

// ─────────────────────────────────────────────────────────────────────────────
// A miniature of the real book, at the real dates.
//
// The 2026-09-04 publication states this week's values AND the source's own
// 2026-08-28 column. The 2026-07-31 publication is the previous PUBLICATION —
// five weeks earlier, and the wrong opening endpoint for a weekly change.
// ─────────────────────────────────────────────────────────────────────────────

const row = (
  rowKey: string,
  parentRowKey: string | null,
  rowType: string,
  displayOrder: number,
  value: number | null,
  previousValue: number | null,
): WeeklyChangeInputRow => ({
  rowKey,
  parentRowKey,
  depth: parentRowKey === null ? 0 : 1,
  displayOrder,
  rowType,
  labelEs: rowKey,
  labelEn: null,
  currency: 'USD',
  value,
  previousValue,
})

/** 2026-09-04, with its own 2026-08-28 column on every row. */
const CURRENT_ROWS: WeeklyChangeInputRow[] = [
  row('equities', null, 'asset_class', 0, 600, 560),
  row('credit', null, 'asset_class', 1, 400, 340),
  row('total', null, 'portfolio_total', 2, 1_000, 900),
]

/** 2026-07-31 — a real publication, five weeks before the one above. */
const PRIOR_PUBLICATION_ROWS: WeeklyChangeInputRow[] = [
  row('equities', null, 'asset_class', 0, 430, 425),
  row('credit', null, 'asset_class', 1, 270, 265),
  row('total', null, 'portfolio_total', 2, 700, 690),
]

/** The 2026-09-04 publication's own performance block: ONE-WEEK figures. */
const PERFORMANCE = [
  { basis: 'total', metric: 'flow', value: 20, boundRowKey: 'total' },
  { basis: 'total', metric: 'weekly_profit', value: 80, boundRowKey: 'total' },
  { basis: 'total', metric: 'weekly_return', value: 0.0889, boundRowKey: 'total' },
  { basis: 'total', metric: 'ytd_profit', value: 250, boundRowKey: 'total' },
  { basis: 'total', metric: 'ytd_return', value: 0.33, boundRowKey: 'total' },
]

const PREVIOUS_WEEK_DATE = '2026-08-28'
const CURRENT_WEEK_DATE = '2026-09-04'
const PREVIOUS_PUBLICATION_DATE = '2026-07-31'

/** The weekly (Compare OFF) pipeline, exactly as the route composes it. */
function weeklyFromSource() {
  const previousRows = sourcePreviousWeekRows(CURRENT_ROWS)
  const previousTotal = resolvePreviousPortfolioTotal(CURRENT_ROWS, previousRows, 'total')
  const nodes = buildChangeNodes(CURRENT_ROWS, previousRows, previousTotal)
  const total = buildTotalMetrics(nodes, PERFORMANCE, 'total')
  return { nodes, total, reconciliation: reconcileFlowAndProfit(total) }
}

/** The old pipeline, kept as the counter-example the fix has to beat. */
function weeklyFromPreviousPublication() {
  const previousTotal = resolvePreviousPortfolioTotal(CURRENT_ROWS, PRIOR_PUBLICATION_ROWS, 'total')
  const nodes = buildChangeNodes(CURRENT_ROWS, PRIOR_PUBLICATION_ROWS, previousTotal)
  const total = buildTotalMetrics(nodes, PERFORMANCE, 'total')
  return { nodes, total, reconciliation: reconcileFlowAndProfit(total) }
}

// ═══════════════════════════════════════════════════════════════════════════
// A · The weekly default is 08-28 → 09-04
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · the weekly default is one week', () => {
  test('the selected publication answers the weekly question by itself', () => {
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, PREVIOUS_WEEK_DATE, CURRENT_WEEK_DATE), true)
    // Every half is required: a date with no values, or values with no date, is
    // not a usable basis and must fall back rather than half-answer.
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, null, CURRENT_WEEK_DATE), false)
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, 'not-a-date', CURRENT_WEEK_DATE), false)
    const bare = CURRENT_ROWS.map((r) => ({ ...r, previousValue: null }))
    assert.equal(hasSourceWeeklyBasis(bare, PREVIOUS_WEEK_DATE, CURRENT_WEEK_DATE), false)
  })

  test('a recorded previous-week date LATER than its own week is refused', () => {
    // THE Production hazard, reproduced. R13.8D.1's restatement path stamped the
    // import's anchor dates onto every week it re-published, so 2026-06-19
    // through 2026-07-31 each carry `previousWeekDate = 2026-08-28` - a date
    // after the week it claims to precede. Their ROW values are correct; the
    // recorded date is not, and believing it would draw a June comparison
    // opening in August.
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, '2026-08-28', '2026-07-17'), false)
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, '2026-08-28', '2026-06-19'), false)
    // Equal dates are refused too: a week is not its own predecessor.
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, '2026-09-04', '2026-09-04'), false)
    // And a malformed as-of cannot slip past the comparison.
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, PREVIOUS_WEEK_DATE, 'nope'), false)
  })

  test('the opening endpoint is 2026-08-28, not the 2026-07-31 publication', () => {
    // The source states which week it measured from; the page shows that date.
    assert.equal(PREVIOUS_WEEK_DATE, '2026-08-28')
    assert.notEqual(PREVIOUS_WEEK_DATE, PREVIOUS_PUBLICATION_DATE)
    // Exactly seven days — one weekly interval, which is what "weekly" claims.
    const ms = Date.parse(`${CURRENT_WEEK_DATE}T00:00:00Z`) - Date.parse(`${PREVIOUS_WEEK_DATE}T00:00:00Z`)
    assert.equal(ms / 86_400_000, 7)
  })

  test('the level change is the ONE-WEEK change', () => {
    const { total } = weeklyFromSource()
    assert.equal(total.previousValue, 900)
    assert.equal(total.currentValue, 1_000)
    assert.equal(total.weeklyValueChange, 100)

    // The rejected behaviour, for contrast: five weeks of level change under a
    // one-week label.
    const wrong = weeklyFromPreviousPublication()
    assert.equal(wrong.total.previousValue, 700)
    assert.equal(wrong.total.weeklyValueChange, 300)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// B · The weekly figures are the publication's own
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · source-provided weekly figures', () => {
  test('weekly P&L, net flows and weekly return come from the selected publication', () => {
    const { total } = weeklyFromSource()
    assert.equal(total.weeklyProfit, 80)
    assert.equal(total.flow, 20)
    assert.equal(total.weeklyReturn, 0.0889)
    // YTD describes this week's year to date and is unaffected by the basis.
    assert.equal(total.ytdProfit, 250)
  })

  test('they are still withheld over a CUSTOM range, where they describe the wrong period', () => {
    const { total } = weeklyFromSource()
    const custom = suppressSingleWeekMetrics(total)
    assert.equal(custom.flow, null)
    assert.equal(custom.weeklyProfit, null)
    assert.equal(custom.weeklyReturn, null)
    // The level change survives: it is a difference of two snapshots and is
    // correct over any span.
    assert.equal(custom.weeklyValueChange, 100)
    assert.equal(custom.ytdProfit, 250)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C · The reconciliation ties again
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · weekly reconciliation', () => {
  test('previous + net flows + weekly P&L = current, with no residual', () => {
    const { reconciliation } = weeklyFromSource()
    assert.equal(reconciliation.status, 'ok')
    assert.equal(reconciliation.previousValue, 900)
    assert.equal(reconciliation.flow, 20)
    assert.equal(reconciliation.profit, 80)
    assert.equal(reconciliation.expectedCurrent, 1_000)
    assert.equal(reconciliation.actualCurrent, 1_000)
    assert.equal(reconciliation.residual, 0)
  })

  test('THE reported warning: the same parts against the 07-31 publication do not tie', () => {
    // This is the defect, reproduced. A five-week level change cannot be
    // explained by one week of flows and profit, and the residual is exactly
    // the four weeks of movement the window swept up.
    const { reconciliation } = weeklyFromPreviousPublication()
    assert.equal(reconciliation.expectedCurrent, 800)
    assert.equal(reconciliation.actualCurrent, 1_000)
    assert.equal(reconciliation.residual, 200)
    assert.notEqual(reconciliation.status, 'ok')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// D · Row-level weekly changes, from the publication's own columns
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · row-level weekly changes', () => {
  test('each row ranks on its OWN one-week change', () => {
    const { nodes } = weeklyFromSource()
    const byKey = new Map(nodes.map((n) => [n.rowKey, n]))
    assert.equal(byKey.get('equities')?.weeklyValueChange, 40)
    assert.equal(byKey.get('credit')?.weeklyValueChange, 60)
    // They reconcile to the portfolio's own one-week change.
    assert.equal((byKey.get('equities')!.weeklyValueChange as number) +
      (byKey.get('credit')!.weeklyValueChange as number), 100)
  })

  test('impact on portfolio value divides by the ONE-WEEK opening total', () => {
    const { nodes } = weeklyFromSource()
    const credit = nodes.find((n) => n.rowKey === 'credit')!
    // 60 / 900, not 60 / 700 — the denominator is the same week the numerator is.
    assert.ok(Math.abs((credit.impactOnPortfolioValue as number) - 60 / 900) < 1e-12)
  })

  test('the drivers are those same rows, ranked by the same measure', () => {
    const { nodes } = weeklyFromSource()
    const drivers = deriveDrivers(nodes, 'top_level')
    assert.deepEqual(drivers.map((d) => d.rowKey).sort(), ['credit', 'equities'])
  })

  test('a row with no previous value is UNAVAILABLE, never a fabricated zero', () => {
    // A blank previous cell is not evidence that the position was not held —
    // that inference belongs only to a row genuinely ABSENT from a snapshot.
    // So it degrades to unavailable, exactly as the parser marks its own
    // `difference` for the same row.
    const rows = [...CURRENT_ROWS, row('newFund', null, 'asset_class', 3, 50, null)]
    const nodes = buildChangeNodes(rows, sourcePreviousWeekRows(rows), 900)
    const added = nodes.find((n) => n.rowKey === 'newFund')!
    assert.equal(added.status, 'unavailable')
    assert.equal(added.unavailableReason, 'missing_previous')
    assert.equal(added.weeklyValueChange, null)
    assert.equal(added.lifecycle, 'ongoing', 'absence was never established, so none is asserted')
  })

  test('sourcePreviousWeekRows keeps every row and invents no value', () => {
    const previous = sourcePreviousWeekRows(CURRENT_ROWS)
    assert.equal(previous.length, CURRENT_ROWS.length)
    assert.deepEqual(previous.map((r) => r.rowKey), CURRENT_ROWS.map((r) => r.rowKey))
    assert.deepEqual(previous.map((r) => r.value), [560, 340, 900])
    // The hierarchy is carried through untouched, so parentage and ordering
    // cannot drift between the two sides of the comparison.
    assert.deepEqual(previous.map((r) => r.parentRowKey), CURRENT_ROWS.map((r) => r.parentRowKey))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// E · Compare mode is unchanged — two real publications
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · compare mode', () => {
  const PUBLISHED = ['2026-07-24', '2026-07-31', '2026-09-04'].map((asOfDate) => ({ asOfDate }))
  const CATCH_UP = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']

  test('a custom range still resolves between two published weeks', () => {
    const r = selectComparisonRange(PUBLISHED, '2026-07-31', '2026-09-04')
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.selection.mode, 'custom')
    assert.equal(r.ok && r.selection.previous?.asOfDate, '2026-07-31')
  })

  test('an evolution-only week is refused as an endpoint, never manufactured', () => {
    for (const d of CATCH_UP) {
      const asFrom = selectComparisonRange(PUBLISHED, d, '2026-09-04')
      assert.equal(asFrom.ok, false)
      assert.equal(asFrom.ok === false && asFrom.code, 'from_not_found')
      const asTo = selectComparisonRange(PUBLISHED, '2026-07-24', d)
      assert.equal(asTo.ok, false)
      assert.equal(asTo.ok === false && asTo.code, 'week_not_found')
    }
  })

  test('the route applies the source basis in WEEKLY mode only', () => {
    const route = codeOf(read(WEEKLY_ROUTE))
    assert.match(route, /mode === 'weekly' &&\s*\n?\s*hasSourceWeeklyBasis/)
    // A custom range reads the second publication, as it always did.
    assert.match(route, /getSnapshotRowsForScope\(previous\.id, scope\)/)
    // And it reports which basis it used, so the client never has to guess.
    assert.match(route, /weeklyBasis,/)
  })

  test('the compare controls survive this pass unchanged in shape', () => {
    // FROM before TO in the source order, one switch, both read-only while off.
    const page = read(WEEKLY_PAGE)
    const from = page.indexOf('label={w.compareFrom}')
    const to = page.indexOf('label={w.compareTo}')
    assert.ok(from > 0 && to > from, 'FROM must be rendered before TO')
    assert.match(page, /disabled=\{loading \|\| !compareOn\}/)
    assert.equal((page.match(/disabled=\{loading \|\| !compareOn\}/g) ?? []).length, 2)
    // No "Weekly" range option was reintroduced.
    assert.ok(!/WEEKLY_DEFAULT/.test(page))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F · The locked import architecture is untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · the R13.8 architecture is preserved', () => {
  test('nothing in this change publishes a catch-up week', () => {
    // The planner still mints exactly ONE publication per import, at the newest
    // frozen date, and this pass adds no second write path.
    const plan = codeOf(read('src/lib/familyPortfolio/weeklyImportPlan.ts'))
    assert.match(plan, /const publicationDate = validDates\.length > 0/)
    assert.ok(!/PUBLICATION_GAP_FILL/i.test(plan), 'no new publication disposition was introduced')
    // The member read route stays a read: no RPC, no upsert, no import call.
    const route = codeOf(read(WEEKLY_ROUTE))
    for (const write of ['importPortfolioWorkbook', 'publishPortfolio', '.rpc(', '.insert(', '.upsert(']) {
      assert.ok(!route.includes(write), `weekly-changes route must not call ${write}`)
    }
  })

  test('the weekly basis reads only rows the caller was already served', () => {
    const route = codeOf(read(WEEKLY_ROUTE))
    // The previous week's values come out of the SAME row set RLS already
    // released for the current publication — no extra scope, no extra table.
    assert.match(route, /previousRowSet = sourcePreviousWeekRows\(currentRows\.rows\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// G · The copy describes the comparison actually made
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · disclosure', () => {
  test('the pair note is chosen by the BASIS the server reported', () => {
    const page = read(WEEKLY_PAGE)
    // Two bases, two accurate sentences. The page never guesses which one
    // applies — the server says, and the note follows.
    assert.match(page, /data\?\.weeklyBasis === 'source_previous_week' \? w\.sourcePairNote : w\.pairNote/)
    for (const lang of ['en', 'es'] as const) {
      const w = dict[lang].fp.weeklyChanges
      assert.ok(w.sourcePairNote.length > 40, `${lang} source pair note must be a real sentence`)
      assert.ok(w.pairNote.length > 40, `${lang} fallback pair note survives unchanged`)
      assert.notEqual(w.sourcePairNote, w.pairNote)
    }
    // The pre-existing wording for the fallback basis is untouched.
    assert.match(dict.en.fp.weeklyChanges.pairNote, /not necessarily seven calendar days earlier/)
  })

  test('an unpublished weekly opening week is EXPLAINED, not silently unselectable', () => {
    const page = read(WEEKLY_PAGE)
    // It renders only when the opening week is genuinely absent from the
    // publication list, so it appears for the catch-up shape and disappears
    // once the book catches up.
    assert.match(page, /const weeklyOpeningUnpublished =/)
    assert.match(page, /!\(data\?\.weeks \?\? \[\]\)\.some\(\(x\) => x\.asOfDate === prevPub\.asOfDate\)/)
    assert.match(page, /\{w\.weeklyOpeningUnpublished\}/)
    for (const lang of ['en', 'es'] as const) {
      const msg = dict[lang].fp.weeklyChanges.weeklyOpeningUnpublished
      assert.ok(msg.length > 60, `${lang} explanation must be a real sentence`)
    }
  })

  test('the methodology states the default the page performs', () => {
    // A methodology note describing a comparison the page no longer makes is
    // worse than none, so it moved with the behaviour.
    assert.match(dict.en.fp.weeklyChanges.methodologyPair, /the week the source closed immediately before this one/)
    assert.match(dict.es.fp.weeklyChanges.methodologyPair, /la semana que la fuente cerró inmediatamente antes de esta/)
    // And it still names the fallback, which remains reachable.
    assert.match(dict.en.fp.weeklyChanges.methodologyPair, /immediately preceding published week/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// H · An anchor date that cannot be true never reaches a surface
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up B · impossible anchor dates are dropped at the read layer', () => {
  const REPO = 'src/lib/db/repositories/familyPortfolioReadRepository.ts'

  test('the spine keeps a recorded anchor only when it precedes its own week', () => {
    const repo = read(REPO)
    // R13.8D.1's restatement path stamped the IMPORT's anchors onto every week
    // it re-published, so Production's 2026-06-19 … 2026-07-31 each carry
    // `previousWeekDate = 2026-08-28`. A "previous week" that falls after the
    // week it precedes is refused rather than printed.
    assert.match(repo, /function anchorBefore\(candidate: string \| null, asOfDate: string\)/)
    assert.match(repo, /return candidate < asOfDate \? candidate : null/)
    assert.match(repo, /previousWeekDate: anchorBefore\(spineDate\(p\.metadata, 'previousWeekDate'\), p\.as_of_date\)/)
    assert.match(repo, /beginningOfYearDate: anchorBefore\(/)
  })

  test('the route guards independently of the repository', () => {
    // Two layers, because the read layer serves several surfaces and the route
    // decides a financial basis. Neither relies on the other having run.
    const route = codeOf(read(WEEKLY_ROUTE))
    assert.match(route, /hasSourceWeeklyBasis\(currentRows\.rows, current\.previousWeekDate, current\.asOfDate\)/)
    assert.equal(hasSourceWeeklyBasis(CURRENT_ROWS, '2026-08-28', '2026-07-17'), false)
  })
})
