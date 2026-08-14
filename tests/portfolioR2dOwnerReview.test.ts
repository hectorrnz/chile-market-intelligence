// R13.R2 OWNER-REVIEW PASS 4 — behavioural tests for the fourth owner-review
// pass.
//
// The four subjects, and what actually carries risk in each:
//
//   * WEEKLY NOTES CANNOT BE SAVED (§ 1). The failure itself is expected — the
//     weekly-notes migration is deliberately unapplied during owner review — but
//     the app reported it in two DISHONEST ways: a read that returned an empty
//     list (so the panel claimed "no note has been written for this week", a
//     statement about the week) and a write that said only "the note could not
//     be saved". The tests assert the missing schema is now detected, carried as
//     its own code through repository → route → payload → panel, and stated in
//     words — and that no control silently disappears in the process.
//
//   * THE EVOLUTION LINE MUST EXCLUDE CAPITAL MOVEMENTS (§ 2). The risk here is
//     fabrication: subtracting a flow that was never published, or splicing raw
//     levels beside adjusted ones so one line is drawn from two constructions.
//     The tests assert the arithmetic (each adjusted step equals the source's
//     own published weekly P&L), the anchoring (the displayed window's own
//     opening level), the refusal (an unpublished flow makes its step
//     unadjustable rather than zero), and the disclosure.
//
//   * THE PRINTED SHEET (§ 3). Colour must follow MEANING: a gain green, a loss
//     red, and a NET FLOW neither — capital moving in is not a profit. And a
//     masked figure must never be toned, or the mask leaks its direction.
//
//   * THE PERFORMANCE BAND (§ 4). Amounts entered the band in this pass, so the
//     tests assert they obey the page mask, that Incl. Chilean equities leads,
//     that the market comparators sit adjacent to the weekly figures, and that
//     no Main basis word reaches a personal scope.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import {
  attachFlows,
  buildFlowAdjustedSeries,
  type FlowObservation,
} from '../src/lib/familyPortfolio/flowAdjustedEvolution.ts'
import {
  isSchemaMissing,
  scopeHasWeeklyNotes,
  weeklyNoteFailureStatus,
} from '../src/lib/familyPortfolio/weeklyNotes.ts'
import { selectEvolutionRange, valueChange } from '../src/lib/familyPortfolio/evolutionRange.ts'
import { highWaterMarket } from '../src/lib/familyPortfolio/highWaterMarket.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strips comments — a negative assertion must never be satisfied by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/family-portfolio/page.tsx')
const STRIP = read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx')
const PANEL = read('src/components/familyPortfolio/WeeklyNotesPanel.tsx')
const PRINT = read('src/components/familyPortfolio/SummaryPrintSheet.tsx')
const CSS = read('src/app/globals.css')
const ROUTE = read('src/app/api/family-portfolio/overview/[scope]/route.ts')
const NOTES_REPO = read('src/lib/db/repositories/familyPortfolioWeeklyNotesRepository.ts')
const READ_REPO = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
const NOTES_CREATE = read('src/app/api/family-portfolio/admin/publications/[id]/notes/route.ts')
const NOTES_ITEM = read('src/app/api/family-portfolio/admin/publications/[id]/notes/[noteId]/route.ts')

const en = dict.en.fp.overview
const es = dict.es.fp.overview

// ═══════════════════════════════════════════════════════════════════════════
// 1 · § 1 — the notes save failure is reported honestly
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 pass 4 § 1 — Weekly Notes name the real blocker', () => {
  test('the EXACT error the live database returns today is classified as schema_missing', () => {
    // Verbatim from a read-only probe of the hosted project on 2026-08-12, with
    // the weekly-notes migration deliberately unapplied. This is the error the
    // owner's failed save actually produced.
    assert.equal(
      isSchemaMissing({
        code: 'PGRST205',
        message: "Could not find the table 'public.family_portfolio_weekly_notes' in the schema cache",
      }),
      true,
    )
    // PostgreSQL's own undefined_table, for a path that reaches SQL directly.
    assert.equal(isSchemaMissing({ code: '42P01', message: 'relation "x" does not exist' }), true)
    // The message is a LAST RESORT, not the contract — an error string is not an
    // API and would break the moment PostgREST rewords it.
    assert.equal(isSchemaMissing({ message: 'Could not find the table foo' }), true)
    // And an ordinary failure must NOT be dressed up as a missing schema, or the
    // interface would blame the migration for a real fault.
    assert.equal(isSchemaMissing({ code: '23505', message: 'duplicate key value' }), false)
    assert.equal(isSchemaMissing({ code: '42501', message: 'permission denied' }), false)
    assert.equal(isSchemaMissing(null), false)
    assert.equal(isSchemaMissing({}), false)
  })

  test('the classifier is a PURE export, testable without a Supabase client', () => {
    const pure = read('src/lib/familyPortfolio/weeklyNotes.ts')
    assert.match(pure, /export function isSchemaMissing/)
    assert.ok(!/from '@\/lib\/supabase|next\/|node:fs/.test(pure),
      'the weekly-notes domain module must stay pure')
    assert.ok(NOTES_REPO.includes("import { isSchemaMissing, sortWeeklyNotes } from '@/lib/familyPortfolio/weeklyNotes'"),
      'the repository must use the one shared classifier, not a private copy')
  })

  test('every read and write path classifies it, so no surface can flatten it', () => {
    const code = codeOf(NOTES_REPO)
    // One occurrence per persistence function: read, create, update, delete.
    assert.ok((code.match(/isSchemaMissing\(error\)/g) ?? []).length >= 4,
      'each of the four persistence paths must classify the failure')
    assert.ok(/'schema_missing'/.test(code))
  })

  test('the HTTP mapping says "cannot yet", not "broke"', () => {
    // A valid submission from an authorized caller that the SERVICE cannot
    // accept is a 503, beside not_configured — never a 500, which reads as a
    // fault and is exactly the misdiagnosis this pass removes.
    assert.equal(weeklyNoteFailureStatus('schema_missing'), 503)
    assert.equal(weeklyNoteFailureStatus('not_configured'), 503)
    assert.equal(weeklyNoteFailureStatus('not_found'), 404)
    assert.equal(weeklyNoteFailureStatus('write_failed'), 500)
    assert.equal(weeklyNoteFailureStatus('read_failed'), 500)
  })

  test('both mutation routes go through the ONE shared mapper', () => {
    for (const [name, src] of [['create', NOTES_CREATE], ['edit/delete', NOTES_ITEM]] as const) {
      assert.ok(src.includes('weeklyNoteFailureStatus'), `${name} must use the shared mapper`)
      // No hand-rolled ternary can drift away from it.
      assert.ok(!/code === 'not_configured' \? 503 : 500/.test(codeOf(src)),
        `${name} must not re-derive the status inline`)
    }
    // The mapper is a PURE module export, so it is testable and cannot become a
    // stray extra export on a route file.
    assert.ok(read('src/lib/familyPortfolio/weeklyNotes.ts').includes('export function weeklyNoteFailureStatus'))
  })

  test('the overview payload distinguishes "empty week" from "no table"', () => {
    assert.match(ROUTE, /weeklyNotesState: 'ok' \| 'schema_missing' \| 'unavailable'/)
    assert.match(ROUTE, /notesResult\.code === 'schema_missing'/)
    assert.match(ROUTE, /weeklyNotesState,/)
    // The list itself still degrades to [] — the STATE is what stops that empty
    // list being presented as a fact about the week.
    assert.match(ROUTE, /notesResult\.ok \? notesResult\.notes : \[\]/)
  })

  test('the panel states the blocker and never claims the week is simply empty', () => {
    assert.match(PANEL, /availability !== 'ok'/)
    assert.match(PANEL, /availability === 'schema_missing' \? labels\.schemaMissing : labels\.unavailable/)
    // The "no note has been written" branch is unreachable while blocked.
    assert.match(PANEL, /\{blocked \? null : notes\.length === 0/)
    // And a failed SAVE names the same blocker rather than the generic error.
    assert.match(PANEL, /outcome === 'unavailable'\s*\n?\s*\?\s*labels\.schemaMissing/)
  })

  test('the controls stay visible and disabled — the capability exists, it is blocked', () => {
    // Hiding "+ Add note" would misrepresent a blocked capability as an absent
    // feature, and would hide from the owner that the control was built.
    assert.match(PANEL, /disabled=\{blocked\}/)
    assert.match(PANEL, /title=\{blocked \? blockedText : undefined\}/)
    for (const label of ['labels.add', 'labels.edit', 'labels.delete', 'labels.save']) {
      assert.ok(PANEL.includes(label), `${label} must still be rendered`)
    }
    // Multiple notes: a list keyed by each note's own id, not one textarea.
    assert.match(PANEL, /notes\.map\(\(note\) =>/)
    assert.match(PANEL, /onDelete\(confirmId\)/)
  })

  test('the page carries the code through instead of collapsing it to "error"', () => {
    assert.match(PAGE, /if \(code === 'schema_missing' \|\| code === 'not_configured'\) return 'unavailable'/)
    assert.match(PAGE, /availability=\{data\.weeklyNotesState \?\? 'ok'\}/)
  })

  test('the wording names the schema, in both languages', () => {
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      assert.ok(o.notesSchemaMissing.length > 0, `${lang} schemaMissing`)
      assert.ok(o.notesUnavailable.length > 0, `${lang} unavailable`)
      assert.ok(/schema|esquema/i.test(o.notesSchemaMissing),
        `${lang} must name the missing schema, not just "unavailable"`)
      // It must not be confusable with the empty-week sentence.
      assert.notEqual(o.notesSchemaMissing, o.notesEmpty)
      assert.notEqual(o.notesSchemaMissing, o.notesSaveError)
    }
    assert.notEqual(en.notesSchemaMissing, es.notesSchemaMissing)
  })

  test('§ 1 — notes stay MAIN ONLY, on the server and in the composition', () => {
    assert.equal(scopeHasWeeklyNotes('main'), true)
    for (const scope of ['jaime', 'andres', 'pablo', 'alternatives']) {
      assert.equal(scopeHasWeeklyNotes(scope), false, `${scope} must not carry notes`)
    }
    assert.match(ROUTE, /scopeHasWeeklyNotes\(scope\)/)
    assert.match(NOTES_CREATE, /!scopeHasWeeklyNotes\(scope\)/)
    assert.match(PAGE, /const showNotes = activeScope !== null && scopeHasWeeklyNotes\(activeScope\)/)
  })

  test('nothing in this pass writes to the hosted database', () => {
    // The pass is a preview: the migration stays unapplied and no code path may
    // quietly create the table, seed a row, or retry around the absence.
    const code = codeOf(NOTES_REPO)
    assert.ok(!/create table|CREATE TABLE|rpc\(/i.test(code))
    assert.ok(!/retry|setTimeout/i.test(code))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · § 2 — the plotted evolution excludes contributions and withdrawals
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 pass 4 § 2 — flow-adjusted evolution arithmetic', () => {
  // A hand-checkable week series. Values and flows are invented; the identity
  // `Δvalue = weekly_profit + flow` holds by construction, exactly as the
  // publication contract guarantees for the real book.
  //   w1 1000  (anchor)
  //   w2 1100  flow  +50  → profit  +50
  //   w3 1080  flow    0  → profit  −20
  //   w4 1580  flow +400  → profit +100
  const SERIES: FlowObservation[] = [
    { date: '2026-01-02', value: 1000, flow: null },
    { date: '2026-01-09', value: 1100, flow: 50 },
    { date: '2026-01-16', value: 1080, flow: 0 },
    { date: '2026-01-23', value: 1580, flow: 400 },
  ]

  test('each adjusted step is the source\'s OWN published weekly profit', () => {
    const out = buildFlowAdjustedSeries(SERIES)
    assert.equal(out.adjusted, true)
    assert.equal(out.anchorDate, '2026-01-02')
    assert.deepEqual(
      out.points,
      [
        { date: '2026-01-02', value: 1000 },
        { date: '2026-01-09', value: 1050 },
        { date: '2026-01-16', value: 1030 },
        { date: '2026-01-23', value: 1130 },
      ],
    )
    // The whole point, stated as arithmetic: step by step the line moves by the
    // week's profit and by nothing else.
    const profits = [50, -20, 100]
    for (let i = 1; i < out.points.length; i++) {
      assert.equal(out.points[i].value - out.points[i - 1].value, profits[i - 1])
    }
  })

  test('the raw line would have jumped on the flow; the adjusted one does not', () => {
    const raw = SERIES[3].value - SERIES[2].value // +500, of which 400 is capital
    const adjusted = buildFlowAdjustedSeries(SERIES).points
    assert.equal(raw, 500)
    assert.equal(adjusted[3].value - adjusted[2].value, 100)
  })

  test('the anchor is the window\'s own real opening level, never a rebased index', () => {
    const out = buildFlowAdjustedSeries(SERIES)
    assert.equal(out.points[0].value, SERIES[0].value)
    assert.notEqual(out.points[0].value, 100)
    assert.notEqual(out.points[0].value, 0)
  })

  test('the total change across the window equals the published P&L across it', () => {
    const out = buildFlowAdjustedSeries(SERIES)
    const change = valueChange(out.points)
    assert.equal(change.absolute, 50 - 20 + 100)
    assert.equal(out.netFlowExcluded, 450)
  })

  // R13.R2E.1 § 2 — THE NEXT THREE ARE RE-POINTED, NOT WEAKENED. They fired on a
  // BLANK flow, which the owner-authoritative sparse-event rule defines as ZERO:
  // contributions and withdrawals are unusual events, so an empty cell records
  // that none occurred. The refusal-to-assume behaviour they protect is intact
  // and asserted just as strictly — it now fires on the case that is genuinely
  // unknown, a flow the source published in a form that cannot be read.
  test('an UNREADABLE flow is never treated as zero — the step is refused', () => {
    // Week 3's flow was published unreadably. Assuming zero would silently assert
    // that no money moved that week, which the source never said.
    const gapped: FlowObservation[] = [
      { date: '2026-01-02', value: 1000, flow: null },
      { date: '2026-01-09', value: 1100, flow: 50 },
      { date: '2026-01-16', value: 1080, flow: null, flowUnavailable: true },
      { date: '2026-01-23', value: 1580, flow: 400 },
    ]
    const out = buildFlowAdjustedSeries(gapped)
    // The path starts at the last observation before the gap's far side, so
    // every plotted step is genuinely adjusted.
    assert.equal(out.anchorDate, '2026-01-16')
    assert.equal(out.omittedLeading, 2)
    assert.equal(out.adjustableFrom, '2026-01-16')
    assert.deepEqual(out.points, [
      { date: '2026-01-16', value: 1080 },
      { date: '2026-01-23', value: 1180 },
    ])
  })

  test('a NaN or non-numeric flow is unreadable too, and is never coerced', () => {
    // A present-but-unusable value is malformed, not empty. It must take the
    // unknown path, not the zero path.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = buildFlowAdjustedSeries([
        { date: '2026-01-02', value: 1000, flow: 0 },
        { date: '2026-01-09', value: 1100, flow: bad },
      ])
      assert.equal(out.adjusted, false, String(bad))
      assert.deepEqual(out.points, [], String(bad))
    }
  })

  test('an absent `flow` property is treated exactly like an explicit null — both are ZERO', () => {
    const undefinedFlow = [
      { date: '2026-01-02', value: 1000 },
      { date: '2026-01-09', value: 1100 },
    ]
    const explicitNull: FlowObservation[] = [
      { date: '2026-01-02', value: 1000, flow: null },
      { date: '2026-01-09', value: 1100, flow: null },
    ]
    const a = buildFlowAdjustedSeries(undefinedFlow)
    const b = buildFlowAdjustedSeries(explicitNull)
    assert.deepEqual(a.points, b.points)
    // Blank means no money moved, so the levels stand unadjusted-but-adjusted:
    // zero was subtracted, which is the whole record's real path.
    assert.equal(a.adjusted, true)
    assert.deepEqual(a.points, [
      { date: '2026-01-02', value: 1000 },
      { date: '2026-01-09', value: 1100 },
    ])
    assert.equal(a.netFlowExcluded, 0)
    assert.equal(a.adjustableFrom, null)
  })

  test('when NOTHING can be adjusted the raw line is not quietly restored', () => {
    const none: FlowObservation[] = [
      { date: '2026-01-02', value: 1000, flow: null, flowUnavailable: true },
      { date: '2026-01-09', value: 1100, flow: null, flowUnavailable: true },
    ]
    const out = buildFlowAdjustedSeries(none)
    assert.equal(out.adjusted, false)
    assert.deepEqual(out.points, [])
    assert.equal(out.netFlowExcluded, null)
  })

  test('a single observation is a level, and is not claimed as adjusted', () => {
    const one = buildFlowAdjustedSeries([{ date: '2026-01-02', value: 1000, flow: 5 }])
    assert.equal(one.adjusted, false)
    assert.equal(one.points.length, 1)
    assert.equal(one.netFlowExcluded, null)
  })

  test('an empty window yields an empty path, never a fabricated point', () => {
    const out = buildFlowAdjustedSeries([])
    assert.deepEqual(out.points, [])
    assert.equal(out.anchorDate, null)
  })

  test('out-of-order and non-finite input cannot corrupt the path', () => {
    const messy: FlowObservation[] = [
      { date: '2026-01-16', value: 1080, flow: 0 },
      { date: '2026-01-02', value: 1000, flow: null },
      { date: 'not-a-date', value: 5, flow: 0 },
      { date: '2026-01-09', value: Number.NaN, flow: 50 },
    ]
    const out = buildFlowAdjustedSeries(messy)
    assert.deepEqual(out.points.map((p) => p.date), ['2026-01-02', '2026-01-16'])
  })

  test('flows attach by EXACT week date — never a nearest match', () => {
    const attached = attachFlows(
      [
        { date: '2026-01-02', value: 1000 },
        { date: '2026-01-09', value: 1100 },
      ],
      new Map([
        ['2026-01-09', 50],
        // A date the series does not carry must not bleed onto a neighbour.
        ['2026-01-08', 999],
      ]),
    )
    assert.equal(attached[0].flow, null)
    assert.equal(attached[1].flow, 50)
  })

  // R13.R2E § 12 SUPERSEDED THIS TEST'S PREMISE, and R13.R2E.1 leaves the
  // supersession standing: the series is adjusted ONCE over the whole record and
  // the range rail SLICES it, because adjusting per window made one calendar date
  // carry five different values across the five ranges (13.80% of Jaime's book
  // between 1M and ALL). The arithmetic below still holds — `buildFlowAdjustedSeries`
  // is window-agnostic and anchors at whatever it is given — so it is kept as a
  // unit check that a slice opens at its own real level, NOT as a claim about
  // where the page adjusts. `portfolioR2eStableEvolution.test.ts` owns that claim.
  test('the path always opens at the real published level of its own first observation', () => {
    const full: FlowObservation[] = [
      { date: '2025-01-03', value: 500, flow: null },
      { date: '2025-06-06', value: 900, flow: 300 },
      { date: '2026-01-02', value: 1000, flow: 0 },
      { date: '2026-01-09', value: 1100, flow: 50 },
    ]
    const window = selectEvolutionRange(full, '1M')
    const out = buildFlowAdjustedSeries(window.points)
    assert.equal(out.points[0].value, 1000, 'the window opens at its own real level')
    assert.equal(out.points[out.points.length - 1].value, 1050)
  })

  test('the High Water Market is the peak of the ADJUSTED line, not the raw one', () => {
    const out = buildFlowAdjustedSeries(SERIES)
    const rawPeak = highWaterMarket(SERIES.map((p) => ({ date: p.date, value: p.value })))
    const adjustedPeak = highWaterMarket(out.points)
    assert.equal(rawPeak!.value, 1580)
    assert.equal(adjustedPeak!.value, 1130)
    assert.notEqual(rawPeak!.value, adjustedPeak!.value)
  })
})

describe('R13.R2 pass 4 § 2 — the flow-adjusted path is what the surface shows', () => {
  test('the route attaches the SOURCE-STATED flow, by basis and by week', () => {
    assert.match(ROUTE, /getPerformanceMetricSeries\(publicationIds, scope, 'flow'\)/)
    assert.match(ROUTE, /const key = `\$\{point\.basis\}\|\$\{date\}`/)
    assert.match(ROUTE, /flowByBasisDate\.set\(key, point\.value\)/)
    // R13.R2E.1 § 2 — RE-POINTED. A null, non-finite or `unavailable` published
    // value is routed to the UNKNOWN set, never silently coalesced to 0 and never
    // silently dropped into the same bucket as a blank sparse-event cell.
    assert.match(
      ROUTE,
      /point\.value === null \|\| !Number\.isFinite\(point\.value\) \|\| point\.valueClass === 'unavailable'/,
    )
    assert.match(ROUTE, /unavailable\.add\(key\)/)
    assert.match(ROUTE, /if \(unavailable\.has\(key\)\) return \{ \.\.\.p, flow: null, flowUnavailable: true \}/)
    assert.match(ROUTE, /flow: flow === undefined \? null : flow/)
    assert.ok(!/flow: [^\n]*\?\? 0/.test(codeOf(ROUTE)), 'a flow must never be coerced with ?? 0')
  })

  test('the flow read is scoped and goes through the caller\'s own session', () => {
    const fn = READ_REPO.slice(
      READ_REPO.indexOf('export async function getPerformanceMetricSeries'),
      READ_REPO.indexOf('export interface BoundRowValue'),
    )
    assert.ok(fn.length > 0)
    assert.match(fn, /getSupabaseUserClient\(\)/)
    assert.ok(!fn.includes('getSupabaseAdminClient'), 'a portfolio amount never reads service-role')
    assert.match(fn, /\.eq\('scope', scope\)/)
    assert.match(fn, /\.eq\('metric', metric\)/)
  })

  test('the chart, the change and the reference all read the adjusted path', () => {
    // R13.R2E § 12 — adjusted ONCE from the record, then SLICED (see the
    // dedicated stable-series suite below for the invariant itself).
    assert.match(PAGE, /const inclAdjusted = useMemo\(\(\) => buildFlowAdjustedSeries\(inclPoints\)/)
    assert.match(PAGE, /const exclAdjusted = useMemo\(\(\) => buildFlowAdjustedSeries\(exclPoints\)/)
    assert.match(PAGE, /points: inclRange\.points/)
    assert.match(PAGE, /points: exclRange\.points/)
    assert.match(PAGE, /const headlinePoints = headlineRange\.points/)
    // valueChange and the HWM both derive from those same points, so no figure
    // on the card can describe a different line from the one drawn.
    assert.match(PAGE, /const headlineChange = valueChange\(headlinePoints\)/)
    assert.match(PAGE, /highWaterMarket\(chartSeries\[0\]\?\.points \?\? \[\]\)/)
  })

  test('the disclosure is visible without hover, and for EVERY scope', () => {
    // A chip on the title line — the reader must know the line is not the raw
    // account value before interpreting it.
    assert.match(PAGE, /\{o\.evoFlowAdjustedChip\}/)
    assert.match(PAGE, /\{o\.evoValueChangeNote\}/)
    // Neither is gated on `isMain`: the personal scopes plot the same
    // construction and carry the same disclosure.
    const chipAt = PAGE.indexOf('o.evoFlowAdjustedChip')
    const context = PAGE.slice(chipAt - 900, chipAt)
    assert.ok(!/isMain \?|isMain &&/.test(context), 'the chip must not be Main-gated')
    // Paper carries it too — a printed sheet has no tooltip.
    assert.match(PAGE, /evolutionNote=\{o\.evoValueChangeNote\}/)
    assert.match(PRINT, /\{evolutionNote && <p className="nv-print-meta">\{evolutionNote\}<\/p>\}/)
  })

  test('a truncated adjustment is disclosed with the date it becomes possible', () => {
    assert.match(PAGE, /\{adjustableFrom !== null && \(/)
    assert.match(PAGE, /\{o\.evoFlowAdjustedFrom\} \{formatIsoDateLabel\(adjustableFrom\)\}/)
    // And BOTH the count and the reported span follow the PLOTTED points, so a
    // dropped week is never claimed as one on screen.
    assert.match(PAGE, /const rangeTotalPoints = activeRanges\.reduce/)
    assert.match(PAGE, /formatIsoDateLabel\(headlinePoints\[0\]\.date\)/)
    assert.ok(!/headlineRange\.startDate/.test(codeOf(PAGE)),
      'the reported span must not come from the raw window')
  })

  test('an entirely unadjustable window gets its own honest empty state', () => {
    assert.match(PAGE, /flowAdjustmentImpossible \? o\.evoFlowAdjustedUnavailable : o\.evoNoRange/)
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      assert.ok(/net-flow|flujo neto/i.test(o.evoFlowAdjustedUnavailable), `${lang}`)
      // It says outright that the raw path is NOT substituted.
      assert.ok(/not shown|no se muestra/i.test(o.evoFlowAdjustedUnavailable), `${lang}`)
    }
  })

  test('the vocabulary is corrected, not merely extended', () => {
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      // The plotted level is named as adjusted wherever it is read out.
      assert.ok(/flow-adjusted|ajustado por flujos/i.test(o.evoAdjustedValueLabel), `${lang} label`)
      // The old note asserted the OPPOSITE of what the line now shows.
      assert.ok(!/includes the effect of contributions|incluye el efecto de aportes/i.test(o.evoValueChangeNote),
        `${lang}: the superseded claim must be gone, not left beside the new one`)
      assert.ok(/excluded|excluidos/i.test(o.evoValueChangeNote), `${lang} states the exclusion`)
      // And it still refuses the return reading (§ 18 is unchanged).
      assert.ok(/not an investment[- ]return|no es un cálculo de retorno/i.test(o.evoValueChangeNote), `${lang}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · § 3 — the printed sheet
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 pass 4 § 3 — print colour follows meaning', () => {
  test('the two classes carry the APPROVED palette values, and print them', () => {
    assert.match(CSS, /\.nv-print-sheet \.nv-print-pos \{[\s\S]*?color: #1a6630/i)
    assert.match(CSS, /\.nv-print-sheet \.nv-print-neg \{[\s\S]*?color: #a34a3d/i)
    // The light-theme values of --positive / --negative, pinned so a reader
    // printing from dark mode does not get the dark pair on white paper.
    assert.match(CSS, /--positive:\s*#1A6630/i)
    assert.match(CSS, /--negative:\s*#A34A3D/i)
    // Browsers drop print colour by default.
    assert.match(CSS, /\.nv-print-pos \{[\s\S]*?print-color-adjust: exact/)
    assert.match(CSS, /\.nv-print-neg \{[\s\S]*?print-color-adjust: exact/)
    // Print-scoped, so none of it can reach the screen.
    assert.ok(CSS.indexOf('.nv-print-pos') > CSS.indexOf('@page { size: A4 portrait'))
  })

  test('the printed chart\'s own strokes are pinned, and SCOPED to that chart', () => {
    // Its stroke reads `var(--fp-series-incl)`, which under a dark theme is the
    // light-backdrop value and prints washed out on white.
    assert.match(CSS, /\.nv-print-sheet \.nv-print-evo path \{[\s\S]*?stroke: #004a64/i)
    assert.match(CSS, /\.nv-print-sheet \.nv-print-evo line \{[\s\S]*?stroke: #5b6770/i)
    assert.match(CSS, /--fp-series-incl: #004A64/)
    assert.match(CSS, /--fp-hwm:\s*#5B6770/)
    // SCOPED, not blanket: the allocation donut draws its slice separators with
    // their own `stroke="var(--surface)"`, and a bare `svg path` rule would
    // repaint every one of them.
    assert.ok(!/\.nv-print-sheet svg path \{/.test(CSS))
    assert.match(PRINT, /className="nv-print-evo"/)
    assert.match(read('src/components/familyPortfolio/AllocationDonut.tsx'), /stroke="var\(--surface\)"/)
  })

  test('a masked figure is never toned — the mask would leak its direction', () => {
    assert.match(PRINT, /function toneClass\(value: number \| null \| undefined, masked: boolean\)/)
    assert.match(PRINT, /if \(masked \|\| value === null \|\| value === undefined \|\| !Number\.isFinite\(value\)\) return ''/)
  })

  test('a NET FLOW is not coloured — capital moving in is not a profit', () => {
    assert.match(PAGE, /!m\.key\.endsWith\('-flow'\) \? m\.value : null/)
    // A listed price is a level, not a result.
    assert.match(PAGE, /m\.state === 'ok' && m\.kind !== 'price' \? m\.value : null/)
  })

  test('only the CHANGE row of the snapshot ledger is toned', () => {
    assert.match(PRINT, /r\.isDifference === true \? toneClass\(r\.value, masked\) : ''/)
  })

  test('LEVELS are never toned — a balance is not a gain', () => {
    // The masthead's total value and the High Water Market are both levels. A
    // green portfolio value would assert a result the figure does not carry.
    const hero = PRINT.slice(PRINT.indexOf('nv-print-heroblock'), PRINT.indexOf('nv-print-block'))
    assert.ok(!/toneClass/.test(hero), 'the hero value must not be toned')
    const hwm = PRINT.slice(PRINT.indexOf('{hwmValue !== null && ('), PRINT.indexOf('</section>'))
    assert.ok(!/toneClass/.test(hwm), 'the High Water Market is a level, not a result')
    // Four occurrences in total: the definition, the ONE shared `MetricValue`
    // cell (which serves all three metric lists), the snapshot change row, and
    // the evolution change. A fifth must fail this test rather than tone a level
    // by accident.
    assert.equal(codeOf(PRINT).split('toneClass(').length - 1, 4,
      'toneClass call sites changed — re-audit each against "is this a result?"')
  })

  test('the sheet still formats no amount of its own', () => {
    const sheet = codeOf(PRINT)
    assert.ok(!/formatUsd|toLocaleString|Intl\./.test(sheet))
    assert.match(PRINT, /<MaskedAmount value=\{metric\.amount \?\? null\} masked=\{masked\} signed \/>/)
  })

  test('the market labels are renamed, on paper and on screen alike', () => {
    assert.equal(en.globalEquity, 'Global Equity')
    assert.equal(en.globalFixedIncome, 'Global Fixed Income')
    assert.equal(es.globalEquity, 'Renta Variable Mundial')
    assert.equal(es.globalFixedIncome, 'Renta Fija Mundial')
    // The benchmark's composition was not lost with the "avg." — it moved to
    // the metric's own tooltip.
    assert.ok(/average|promedio/i.test(en.globalFixedIncomeDetail + es.globalFixedIncomeDetail))
    assert.match(PAGE, /title: metricTitle\(mc\?\.globalFixedIncome, o\.globalFixedIncomeDetail\)/)
  })

  test('the sheet stays A4, print-only, and driven by the page\'s own payload', () => {
    assert.match(CSS, /@page \{ size: A4 portrait; margin: 12mm; \}/)
    assert.match(PRINT, /className="nv-print-sheet print-only"/)
    // Still no second fetch and no second entitlement decision.
    assert.ok(!/fetch\(/.test(codeOf(PRINT)))
    assert.match(PAGE, /masked=\{masked\}\s*\n\s*formatDate=\{formatIsoDateLabel\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · § 4 — the recomposed performance band
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 pass 4 § 4 — the 2 × 2 performance band', () => {
  test('row 1 is weekly, row 2 is supporting, in one shared grid', () => {
    assert.match(STRIP, /portfolioPrimary: StripGroup\[\]/)
    assert.match(STRIP, /marketsPrimary: StripGroup\[\]/)
    assert.match(STRIP, /portfolioSecondary\?: StripGroup\[\]/)
    assert.match(STRIP, /marketsSecondary\?: StripGroup\[\]/)
    // ONE grid, so the divider between the columns is straight across both rows.
    assert.match(STRIP, /lg:grid-cols-\[minmax\(0,auto\)_minmax\(0,auto\)_minmax\(0,1fr\)\]/)
    assert.match(STRIP, /const hasSecondary =/)
  })

  test('an AMOUNT in the band obeys the page mask', () => {
    // Amounts entered this component in pass 4 — before it, it carried only
    // ratios and public prices and formatted them directly.
    assert.match(STRIP, /kind: 'return' \| 'price' \| 'amount'/)
    assert.match(STRIP, /metric\.kind === 'amount' \? \(/)
    assert.match(STRIP, /<MaskedAmount\s*\n?\s*value=\{metric\.value\}\s*\n?\s*masked=\{masked\}/)
    // `formatUsd` appears in the band exactly twice — the import and the PRICE
    // branch — so an amount cannot be formatted straight past the mask. A third
    // use must fail this test rather than ship one.
    const code = codeOf(STRIP)
    assert.equal(code.split('formatUsd').length - 1, 2,
      'formatUsd occurrences in the band changed — re-audit each against the mask')
    assert.match(code, /metric\.kind === 'price' \? \(\s*\n?\s*<span[^>]*>\{formatUsd\(metric\.value!, 2\)\}/)
  })

  test('Incl. Chilean equities leads, and both bases carry return + P&L', () => {
    assert.match(PAGE, /\['with_chilean_equities', 'ex_chilean_equities'\]/)
    assert.match(PAGE, /key: `\$\{b\.basis\}-return`/)
    assert.match(PAGE, /key: `\$\{b\.basis\}-pl`/)
    assert.equal(en.metricReturn, 'Return')
    assert.equal(en.metricProfit, 'P&L')
    assert.equal(es.metricProfit, 'P&L')
  })

  test('the market comparators sit beside the weekly figures, not at the card edge', () => {
    // The third grid track absorbs the leftover width, which is what keeps the
    // markets column adjacent on a personal scope's short portfolio column.
    assert.match(STRIP, /minmax\(0,1fr\)\]/)
    assert.match(STRIP, /<div aria-hidden className="hidden lg:block" \/>/)
  })

  test('a personal scope gets no basis wording and no InRetail', () => {
    const primary = PAGE.slice(PAGE.indexOf("key: 'personal-weekly'"), PAGE.indexOf('// ── ROW 2'))
    assert.ok(primary.length > 0)
    assert.ok(!/blockLabel|blockExChilean|blockWithChilean|title:/.test(primary))
    assert.match(PAGE, /const marketsSecondary: StripGroup\[\] = isMain/)
  })

  test('nothing was dropped: every figure the pass-3 band carried is still composed', () => {
    for (const key of ['o.flow', 'o.weeklyProfit', 'o.ytdReturn', 'o.ytdProfit', 'o.personalWeekly']) {
      assert.ok(PAGE.includes(key), `${key} must still render`)
    }
    // The InRetail PORTFOLIO-VALUE impact stays out of the band entirely — it is
    // a line of the Weekly close by line table and is not featured twice.
    assert.ok(!/data\.inretailImpact/.test(PAGE))
  })

  test('the print sheet is driven by the SAME groups, so paper cannot drift', () => {
    assert.match(PAGE, /portfolioMetrics=\{portfolioPrimary\.flatMap/)
    assert.match(PAGE, /marketMetrics=\{marketsPrimary\.concat\(marketsSecondary\)\.flatMap/)
    assert.match(PAGE, /detailGroups=\{portfolioSecondary\.map/)
  })
})
