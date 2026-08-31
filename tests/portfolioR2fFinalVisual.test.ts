// R13.R2F § 29 — the final visual/product integration pass.
//
// WHAT THIS SUITE IS FOR. The pass that precedes it recomposed the Summary and
// the A4 sheet. Composition is where a financial page most easily starts lying:
// a derived level promoted into an AUM slot, a market comparator drifting away
// from the figures it exists to be compared against, a personal scope quietly
// inheriting a basis it does not have, a capital movement printed in profit
// green. So this suite pins the PRODUCT CONTRACT the composition has to keep —
// not one pass's markup.
//
// THE DATA GROUPS ARE BEHAVIOURAL. The 102-week histories, the stability of the
// adjusted path across ranges, the exclusion of flows and the High Water Market
// all run against the real pure modules on invented fixtures, so they prove the
// property rather than the presence of a line of code. The composition groups
// are source contracts, which is this module's established idiom (see
// portfolioR2b/c/d/e) — a React tree cannot be rendered under `node --test`.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import {
  buildFlowAdjustedSeries,
  netFlowOf,
  type FlowObservation,
} from '../src/lib/familyPortfolio/flowAdjustedEvolution.ts'
import {
  EVOLUTION_PERIODS,
  selectEvolutionRange,
  sharedEndpoint,
} from '../src/lib/familyPortfolio/evolutionRange.ts'
import {
  highWaterMarket,
  shouldShowHighWaterMarket,
} from '../src/lib/familyPortfolio/highWaterMarket.ts'
import { scopeHasWeeklyNotes } from '../src/lib/familyPortfolio/weeklyNotes.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strips comments — prose that DESCRIBES a superseded mechanism must never satisfy a check for it. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/portfolio/page.tsx')
const CODE = codeOf(PAGE)
const STRIP = read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx')
const SNAPCARD = read('src/components/familyPortfolio/WeeklySnapshotCard.tsx')
const NOTES = read('src/components/familyPortfolio/WeeklyNotesPanel.tsx')
const PRINT = read('src/components/familyPortfolio/SummaryPrintSheet.tsx')
const CHART = read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx')
const CSS = read('src/app/globals.css')
const en = dict.en.fp.overview
const es = dict.es.fp.overview

/** A Friday `n` weeks after 2024-08-23 — the live book's own first Main week. */
const friday = (n: number): string =>
  new Date(Date.UTC(2024, 7, 23) + n * 7 * 86_400_000).toISOString().slice(0, 10)

/**
 * A full-length weekly record. Flows are SPARSE: most weeks are blank (which
 * the contract reads as zero external flow), and a handful carry a real
 * movement. Every step satisfies `Δvalue = weekly_profit + flow` by
 * construction, which is the publication invariant the live book satisfies
 * across all 427 basis-weeks.
 */
function record(weeks: number, flows: Record<number, number> = {}): FlowObservation[] {
  const out: FlowObservation[] = []
  let value = 1_000_000
  for (let i = 0; i < weeks; i++) {
    const flow = flows[i] ?? 0
    // A deterministic, hand-checkable "profit": +0.4% of the running level.
    const profit = i === 0 ? 0 : Math.round(value * 0.004)
    value = value + profit + flow
    // A blank cell is the SPARSE-EVENT normal case: `flow` omitted, not zero-ed.
    out.push(flow === 0 ? { date: friday(i), value } : { date: friday(i), value, flow })
  }
  return out
}

// The five live scopes, at their real lengths and anchors. A mid-record
// contribution is placed on Main so a windowed adjustment WOULD disagree with a
// whole-record one unless the architecture forbids it.
const MAIN_INCL = record(102, { 71: 250_000, 74: -90_000 })
const MAIN_EXCL = record(102, { 71: 250_000 })
const JAIME = record(102, { 40: 120_000 })
const ANDRES = record(102)
const PABLO = record(94, { 12: -30_000 })

const adj = (points: FlowObservation[]) => buildFlowAdjustedSeries(points)

describe('R13.R2F § 29 · DATA — every series carries its full history', () => {
  test('Main Incl. and Main Excl. both adjust across all 102 weeks', () => {
    // R13.R2E.1's restoration is the premise of this whole pass: the default
    // Main basis may only be Incl. because Incl. is no longer short.
    assert.equal(adj(MAIN_INCL).points.length, 102)
    assert.equal(adj(MAIN_EXCL).points.length, 102)
    assert.equal(adj(MAIN_INCL).points[0].date, friday(0))
    assert.equal(adj(MAIN_EXCL).points[0].date, friday(0))
    // Nothing is withheld: no leading week is dropped and no later anchor is
    // disclosed, because every flow in the record is readable.
    for (const a of [adj(MAIN_INCL), adj(MAIN_EXCL)]) {
      assert.equal(a.omittedLeading, 0)
      assert.equal(a.adjustableFrom, null)
      assert.equal(a.adjusted, true)
    }
  })

  test('the personal histories are unchanged — Jaime 102, Andrés 102, Pablo 94', () => {
    assert.equal(adj(JAIME).points.length, 102)
    assert.equal(adj(ANDRES).points.length, 102)
    assert.equal(adj(PABLO).points.length, 94)
    for (const a of [adj(JAIME), adj(ANDRES), adj(PABLO)]) {
      assert.equal(a.adjustableFrom, null, 'a personal series withholds no leading week')
    }
  })

  test('Main Compare spans the full 102-week COMMON history', () => {
    const shared = sharedEndpoint(adj(MAIN_INCL).points, adj(MAIN_EXCL).points)
    assert.equal(shared, friday(101))
    for (const a of [adj(MAIN_INCL), adj(MAIN_EXCL)]) {
      const r = selectEvolutionRange(a.points, 'ALL', shared)
      assert.equal(r.points.length, 102, 'both Compare lines run the whole record')
      assert.equal(r.points[0].date, friday(0))
      assert.equal(r.points[r.points.length - 1].date, friday(101))
    }
  })

  test('Compare pins BOTH lines to one endpoint — neither is drawn past its own record', () => {
    // A shorter partner must shorten the pair, never extend it.
    const shared = sharedEndpoint(adj(MAIN_INCL).points, adj(PABLO).points)
    assert.equal(shared, adj(PABLO).points[adj(PABLO).points.length - 1].date)
    const r = selectEvolutionRange(adj(MAIN_INCL).points, 'ALL', shared)
    assert.equal(r.points[r.points.length - 1].date, shared)
  })
})

describe('R13.R2F § 29 · DATA — the adjusted path is STABLE across ranges', () => {
  test('one calendar date carries ONE adjusted value under every range', () => {
    // The defect this guards against: adjusting AFTER the window is chosen
    // anchors the path at the window's own opening level, so the same date
    // reads differently per range. Measured at up to 13.80% of a real
    // portfolio's value before R13.R2E.
    const stable = adj(MAIN_INCL).points
    const byDate = new Map(stable.map((p) => [p.date, p.value]))
    for (const period of EVOLUTION_PERIODS) {
      for (const p of selectEvolutionRange(stable, period, null).points) {
        assert.equal(p.value, byDate.get(p.date), `${period} moved ${p.date}`)
      }
    }
  })

  test('a range control SLICES the stable series — it never rebuilds it', () => {
    // Every windowed slice must be a contiguous run of the stable series.
    const stable = adj(MAIN_INCL).points
    for (const period of EVOLUTION_PERIODS) {
      const slice = selectEvolutionRange(stable, period, null).points
      if (slice.length === 0) continue
      const at = stable.findIndex((p) => p.date === slice[0].date)
      assert.ok(at >= 0)
      assert.deepEqual(slice, stable.slice(at, at + slice.length))
    }
    // And in code: the adjustment runs on the WHOLE record, the range on the
    // ADJUSTED result — never the other way round.
    assert.match(CODE, /buildFlowAdjustedSeries\(inclPoints\)/)
    assert.match(CODE, /selectEvolutionRange\(inclAdjusted\.points, safePeriod, endpointOverride\)/)
    assert.ok(!/buildFlowAdjustedSeries\((incl|excl)Range/.test(CODE),
      'the series must never be rebuilt from a windowed slice')
  })
})

describe('R13.R2F § 29 · DATA — contributions and withdrawals are excluded', () => {
  test('the adjusted step is the published P&L, with the flow removed', () => {
    const raw = MAIN_INCL
    const out = adj(raw).points
    for (let i = 1; i < out.length; i++) {
      const flow = netFlowOf(raw[i]) as number
      const expected = raw[i].value - raw[i - 1].value - flow
      assert.ok(
        Math.abs(out[i].value - out[i - 1].value - expected) < 1e-6,
        `step ${i} must exclude the flow`,
      )
    }
    // The contribution weeks are the ones that would otherwise read as gains.
    assert.equal(netFlowOf(raw[71]), 250_000)
    assert.equal(netFlowOf(raw[74]), -90_000)
    // Total removed over the record equals the sum of the stated flows.
    assert.equal(adj(raw).netFlowExcluded, 160_000)
  })

  test('a blank flow cell is ZERO external flow, and does not shorten the series', () => {
    // The sparse-event rule (R13.R2E.1): a blank contribution/withdrawal cell
    // means no money moved. It must never be read as "unknown".
    assert.equal(netFlowOf({ date: friday(3), value: 1 }), 0)
    assert.equal(netFlowOf({ date: friday(3), value: 1, flow: null }), 0)
    assert.equal(adj(ANDRES).points.length, ANDRES.length, 'an all-blank record still adjusts whole')
  })

  test('an UNREADABLE flow is never silently zero', () => {
    // R13.R2E.2's fail-closed rule, at the presentation boundary: an error or
    // malformed flow cell propagates as unavailable, and the step it belongs
    // to is not adjusted rather than being credited as "no money moved".
    assert.equal(netFlowOf({ date: friday(3), value: 1, flowUnavailable: true }), null)
    assert.equal(netFlowOf({ date: friday(3), value: 1, flow: Number.NaN }), null)
    const broken = record(20)
    broken[9] = { ...broken[9], flowUnavailable: true }
    const a = adj(broken)
    assert.ok(a.points.length < broken.length, 'the unadjustable step must not be plotted')
    assert.equal(a.anchorDate, broken[9].date, 'the series re-anchors AFTER the unreadable week')
    assert.equal(a.adjustableFrom, broken[9].date, 'and the page is told where it begins')
  })

  test('the exclusion is disclosed in words, in BOTH languages, without hover', () => {
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      assert.ok(/contributions and withdrawals are excluded|aportes y retiros están excluidos/i
        .test(o.evoValueChangeNote), `${lang}`)
      assert.ok(/analytical value path|trayectoria analítica/i.test(o.evoValueChangeNote), `${lang}`)
      // § 3 — the qualifier NAMES ITSELF, so the term used everywhere else on
      // the page and on paper is the one the reader meets first.
      assert.ok(/flow-adjusted|ajustado por flujos/i.test(o.evoFlowAdjustedChip), `${lang} chip`)
    }
    // Both are rendered as text, neither behind a tooltip.
    assert.match(CODE, /\{o\.evoValueChangeNote\}/)
    assert.match(CODE, /\{o\.evoFlowAdjustedChip\}/)
  })
})

describe('R13.R2F §§ 2-4 · the Evolution surface', () => {
  test('§ 2 — Main DEFAULTS to Incl. Chilean Equities', () => {
    assert.match(CODE, /usePersistentState<SeriesMode>\('cmi\.fpEvoMode', 'incl'\)/)
    // And a persisted Main choice can never leak onto a personal scope, which
    // has no basis split to select.
    assert.match(CODE, /const safeMode: SeriesMode = isMain \? storedMode : 'incl'/)
  })

  test('§ 2 — all three Main series controls stay selectable, and stay OUT of settings', () => {
    for (const key of ['evoModeCompare', 'evoModeIncl', 'evoModeExcl']) {
      assert.match(CODE, new RegExp(`o\\.${key}`), key)
    }
    // The period rail and the series rail are directly visible controls.
    assert.match(CODE, /options=\{EVOLUTION_PERIODS\.map/)
  })

  test('§ 2 (R13.R2F1) — the ACTUAL VALUE leads the surface; the change supports it', () => {
    // R13.R2F1 REVERSES R13.R2F's ordering, and the reversal is safe on the
    // terms that matter here. § 14's prohibition is on a DERIVED level wearing
    // a generic AUM-ish name; promoting the REAL published balance is the
    // opposite arrangement, and it answers the reader's first question at a
    // chart ("what is it worth now?") with a figure that is actually an answer
    // to it. What must survive the swap is § 3's visible SEPARATION of the two
    // quantities, which is what this test now pins.
    const actual = /\{o\.evoActualValueLabel\}[\s\S]{0,700}?value=\{actualLatest\.value\}[\s\S]{0,300}?\/>/.exec(CODE)
    assert.ok(actual !== null, 'the actual-value KPI must exist')
    assert.match(actual![0], /ui-chart-headline/, 'the actual value takes the leading KPI scale')
    // It still ranks below the PAGE hero — the hero is the publication total,
    // this figure follows the selected basis.
    assert.ok(!/ui-kpi-hero/.test(actual![0]), 'it must not match the page hero scale')

    const change = /\{o\.evoAdjustedValueChange\}[\s\S]{0,1500}?formatRatioPct\(headlineChange\.ratio\)/
      .exec(CODE)
    assert.ok(change !== null, 'the Value Change must still be present')
    assert.ok(!/ui-chart-headline|ui-kpi-hero/.test(change![0]),
      'the change is now the supporting figure and must not take the leading scale')
    // Both the amount and its ratio keep the SAME supporting treatment — one
    // set large beside the other set as metadata would be the same defect in
    // half, which is what the R13.R2F assertion originally guarded.
    const roles = change![0].match(/text-sm font-semibold/g) ?? []
    assert.ok(roles.length >= 2, 'the amount and the ratio share one supporting scale')
    assert.ok(!/ui-meta/.test(change![0].replace(/\{o\.evoAdjustedValueChange\}/, '')),
      'neither figure may fall to a metadata role')

    assert.ok(CODE.indexOf('{o.evoActualValueLabel}') < CODE.indexOf('{o.evoAdjustedValueChange}'),
      'the actual value is read first')
    // § 3 — the two remain visibly separated, by a hairline between them.
    assert.match(CODE, /actualLatest \? 'sm:pl-6 sm:border-l' : ''/)
  })

  test('§ 4 — Compare carries BOTH bases\' change, neither presented as "the" figure', () => {
    assert.match(CODE, /const compareChanges = \[/)
    assert.match(CODE, /valueChange\(inclRange\.points\)/)
    assert.match(CODE, /valueChange\(exclRange\.points\)/)
    const cmp = /safeMode === 'compare' && compareChanges\.length > 0[\s\S]{0,2200}?\)\}/.exec(CODE)
    assert.ok(cmp !== null, 'the Compare KPI row must exist')
    assert.ok(!/ui-chart-headline/.test(cmp![0]),
      'neither Compare figure may take the single-series headline scale')
    // Each is tied to the line it came from by its own series token — colour is
    // supplemental, the basis is NAMED beside it.
    assert.match(cmp![0], /--fp-series-incl/)
    assert.match(cmp![0], /--fp-series-excl/)
    assert.match(cmp![0], /\{c\.label\}/)
  })

  test('§ 3 — ACTUAL portfolio value and the FLOW-ADJUSTED path are never one figure', () => {
    // The page hero reads the publication's own total…
    assert.match(CODE, /value=\{data\.hero\?\.totalValue \?\? null\}/)
    // …the evolution reference reads the RAW observations…
    assert.match(CODE, /const headlineRawPoints = safeMode === 'excl' \? exclPoints : inclPoints/)
    // …and the plotted series reads the ADJUSTED ones. Three names, three
    // sources, no substitution.
    assert.match(CODE, /points: inclRange\.points/)
    assert.notEqual(en.evoActualValueLabel, en.evoAdjustedValueLabel)
    assert.notEqual(es.evoActualValueLabel, es.evoAdjustedValueLabel)
  })

  test('§ 4 — nothing on this surface is called a return, in either language', () => {
    // Every NAME of a figure on this surface. A label is what the reader takes
    // the figure to be, so none of them may carry the word at all.
    const labels = [
      en.evoTitle, en.evoActualValueLabel, en.evoAdjustedValueLabel,
      en.evoAdjustedValueChange, en.evoFlowAdjustedChip, en.hwmLabel, en.flow,
      es.evoTitle, es.evoActualValueLabel, es.evoAdjustedValueLabel,
      es.evoAdjustedValueChange, es.evoFlowAdjustedChip, es.hwmLabel, es.flow,
    ].join(' | ')
    assert.ok(!/\breturns?\b|retorno|rentabilidad/i.test(labels),
      `no evolution label may name a return: ${labels}`)
    // R13.R2F § 4 — `flowHelp` is a SENTENCE, not a label, and it is checked
    // for the specific false claim it used to make: that this app performs a
    // "flow-adjusted return calculation". It performs none — the adjustment
    // produces a VALUE PATH. The sentence may legitimately use the word to
    // DENY the reading, which is what it now does in Spanish.
    for (const o of [en, es]) {
      assert.ok(!/return calculation|cálculo del retorno|cálculo de retorno/i.test(o.flowHelp),
        `flowHelp must not claim a return calculation: ${o.flowHelp}`)
    }
  })
})

describe('R13.R2F1 · the owner-review refinements', () => {
  test('§ 1 — the Markets column reserves the title row its sibling occupies', () => {
    // THE DEFECT: Main's row 1 renders Portfolio as h3 → h4 basis title →
    // metrics, and Markets as h3 → metrics, so the two market comparators
    // floated one title-row ABOVE the portfolio figures they exist to be
    // compared against. The reservation is DATA-DRIVEN, computed from the
    // groups actually passed for that row.
    assert.match(STRIP, /reserveTitleRow\?: boolean/)
    assert.match(STRIP, /const portfolioPrimaryTitled = portfolioPrimary\.some\(\(g\) => g\.title\)/)
    assert.match(STRIP, /const marketsPrimaryTitled = marketsPrimary\.some\(\(g\) => g\.title\)/)
    assert.match(STRIP, /reserveTitleRow=\{!marketsPrimaryTitled && portfolioPrimaryTitled\}/)
    assert.match(STRIP, /reserveTitleRow=\{!portfolioPrimaryTitled && marketsPrimaryTitled\}/)
    // The spacer is invisible to the eye AND to assistive tech, and carries the
    // real title's own font metrics so the reserved box is pixel-true.
    assert.match(STRIP, /aria-hidden="true" className="ui-meta font-semibold invisible"/)
  })

  test('§ 1 — a scope whose columns are BOTH untitled never receives a spacer', () => {
    // A personal scope's row 1 has no group title on either side, so it is
    // already aligned; reserving there would misalign it the other way. The
    // formula `!thisSide && sibling` yields false for every such pair — proven
    // here over all four real combinations rather than asserted in prose.
    const reserve = (thisSide: boolean, sibling: boolean) => !thisSide && sibling
    assert.equal(reserve(false, false), false, 'personal row 1 — neither titled')
    assert.equal(reserve(true, true), false, 'Main row 2 — both titled')
    assert.equal(reserve(false, true), true, 'Main row 1 markets — sibling titled')
    assert.equal(reserve(true, false), false, 'Main row 1 portfolio — this side titled')
    // And the grid that keeps Markets adjacent to the weekly figures is intact.
    assert.match(STRIP, /lg:grid-cols-\[minmax\(0,auto\)_minmax\(0,auto\)_minmax\(0,1fr\)\]/)
  })

  test('§ 3 — the Weekly Snapshot fills its column instead of leaving dead space below it', () => {
    // The snapshot is an inherently short four-row ledger beside a tall
    // allocation column, so on a personal scope its column stopped well short
    // of the row's bottom. It now grows to the shared row's height and pins its
    // footnote to the bottom edge — the same `mt-auto` idiom AllocationPanel
    // already uses for its provenance, so the columns close in step.
    assert.match(SNAPCARD, /<section className="flex-1 flex flex-col/)
    // R13.R2F5 § C added the shared `nv-notes` band to this wrapper's class
    // list, so the assertion is on the PROPERTY (bottom-pinned, same top
    // padding) rather than on the order the classes happen to be written in.
    const footWrap = SNAPCARD.match(/className="([^"]*mt-auto[^"]*)">\{footnote\}/)
    assert.ok(footWrap, 'the footnote wrapper must still pin itself to the bottom')
    assert.match(footWrap![1], /\bmt-auto\b/)
    assert.match(footWrap![1], /\bpt-2\.5\b/)
    // Notes stay Main-only — a personal scope gets no filler third column.
    assert.match(CODE, /\{showNotes && \(/)
  })

  test('§ 4 — the printed evolution chart carries real y-axis context', () => {
    // Ticks are the series' OWN high / midpoint / low — never invented round
    // numbers — and a flat series draws one line rather than three identical
    // overlapping ones.
    assert.match(PRINT, /const tickValues = max > min \? \[max, \(max \+ min\) \/ 2, min\] : \[max\]/)
    assert.match(PRINT, /<line/)
    // R13.R2F5.1 — the box is UNIFORMLY scaled now, which is what let the x
    // labels move into it (see portfolioR2f3PrintAxesInteraction). The VALUE
    // labels stay HTML for a different reason that has not changed: they are
    // monetary and must keep the one guarded `MaskedAmount` render path.
    assert.match(PRINT, /preserveAspectRatio="xMidYMid meet"/)
    assert.match(PRINT, /top: `\$\{tick\.pct\}%`/)
    // R13.R5C.2 — see the § 4 masking test below for why the tick opts out of
    // the zero mark. It still renders through the one guarded path.
    assert.match(PRINT, /<MaskedAmount value=\{tick\.value\} masked=\{masked\} compact zeroDash=\{false\} \/>/)
    assert.ok(!/<text[\s\S]{0,400}?MaskedAmount/.test(PRINT), 'a monetary label may never be SVG text')
    // Strokes keep their true printed weight at any scale.
    assert.match(PRINT, /vectorEffect="non-scaling-stroke"/)
  })

  test('§ 4 — the axis labels sit in a reserved gutter, never on top of the series', () => {
    // Without a reserved column the labels overlaid the opening ~10% of the
    // line, with the gridlines running under the text.
    assert.match(PRINT, /const Y_AXIS_GUTTER = '\d+mm'/)
    assert.match(PRINT, /paddingLeft: Y_AXIS_GUTTER/)
    assert.match(PRINT, /width: Y_AXIS_GUTTER/)
    // R13.R2F5.1 — the dates are no longer indented by a matching gutter on a
    // separate row; they are inside the viewBox, so the gutter applies to them
    // automatically. The property this test protects is that the VALUE labels
    // have a reserved column of their own and never overlay the series.
    assert.match(PRINT, /textAlign: 'right'/)
    assert.ok(!/nv-print-evo-axis/.test(PRINT), 'the detached date row must not return')
    // The svg must carry no elastic sizing — the wrapper carries none either
    // (see portfolioR2f3PrintAxesInteraction), which is the whole fix.
    const evoRule = /\.nv-print-sheet \.nv-print-evo \{[\s\S]*?\}/.exec(CSS)
    assert.ok(evoRule !== null)
    assert.ok(!/min-height|max-height|flex:/.test(evoRule![0]),
      'the plot must not acquire elastic sizing')
  })

  test('§ 4 — an axis value is masked like every other amount on the sheet', () => {
    // An axis is not a loophole around the page mask.
    // R13.R2F4 § 2 — `compact` shortens the LABEL (`145,5M`); the guarded
    // render path is unchanged, which is the invariant this test protects.
    // R13.R5C.2 — `zeroDash={false}`: an axis tick is a scale annotation, not a
    // value. The guarded render path is unchanged.
    assert.match(PRINT, /<MaskedAmount value=\{tick\.value\} masked=\{masked\} compact zeroDash=\{false\} \/>/)
    // A LEVEL is never toned green or red — only a result is.
    const tickBlock = /\{yTicks\.map\(\(tick\) => \([\s\S]*?\)\)\}/.exec(PRINT)
    assert.ok(tickBlock !== null)
    assert.ok(!/toneClass/.test(tickBlock![0]), 'an axis level must never be toned')
  })

  test('the weekly drawdown module is DEFERRED, and its direction is recorded', () => {
    // R13.R2F1 explicitly defers the drawdown chart to a later pass. What must
    // exist now is the written direction, so the next pass does not re-derive
    // it — in particular that it is computed from the FLOW-ADJUSTED series,
    // because a raw drawdown would report a withdrawal as a loss.
    const plan = read('docs/portfolio-r13/13-r2f1-drawdown-future-pass.md')
    assert.match(plan, /DEFERRED/)
    assert.match(plan, /drawdown_t = \(level_t \/ peak_t\) - 1/)
    assert.match(plan, /flow-adjusted/i)
    assert.match(plan, /weekly/i)
    assert.match(plan, /companion card/i)
    // And it is genuinely not built: no drawdown module, and no drawdown
    // surface on the Summary.
    assert.ok(!/drawdown/i.test(CODE), 'the Summary must not render a drawdown surface yet')
  })
})

describe('R13.R2F §§ 6-8 · High Water Market', () => {
  test('§ 6 — the visible TERM is the owner\'s, unchanged in both languages', () => {
    assert.equal(en.hwmLabel, 'High Water Market')
    assert.equal(es.hwmLabel, 'High Water Market')
    assert.ok(!/High Water Mark\b/.test(PAGE + PRINT + CHART),
      'never silently corrected to the fee-calculation term')
  })

  test('§ 6 — it is the peak of the ADJUSTED path, at a REAL source date', () => {
    const stable = adj(MAIN_INCL).points
    const peak = highWaterMarket(stable)
    assert.ok(peak !== null)
    const best = stable.reduce((a, b) => (b.value > a.value ? b : a))
    assert.equal(peak!.value, best.value)
    // The date is an observation the series actually contains — no
    // interpolation, no synthesised boundary.
    assert.ok(stable.some((p) => p.date === peak!.date && p.value === peak!.value))
    // And it is NOT the raw path's peak: the raw record ends higher, because
    // the contributions are still in it.
    const rawPeak = MAIN_INCL.reduce((a, b) => (b.value > a.value ? b : a))
    assert.ok(rawPeak.value > peak!.value, 'the raw high must differ from the adjusted high')
    // In code the marker is fed the PLOTTED points.
    assert.match(CODE, /highWaterMarket\(chartSeries\[0\]\?\.points \?\? \[\]\)/)
  })

  test('§ 7 — visible on ALL + a single series; hidden in Compare; not automatic on shorter ranges', () => {
    assert.equal(shouldShowHighWaterMarket({ period: 'ALL', seriesCount: 1, mode: 'auto' }), true)
    assert.equal(shouldShowHighWaterMarket({ period: 'ALL', seriesCount: 2, mode: 'auto' }), false)
    for (const period of ['1M', '3M', 'YTD', '1Y'] as const) {
      assert.equal(shouldShowHighWaterMarket({ period, seriesCount: 1, mode: 'auto' }), false, period)
    }
  })

  test('§ 7 — the summary sits OUTSIDE the plot, so no hover can cover it', () => {
    // The chart's tooltip is absolutely positioned INSIDE the chart container,
    // which is precisely why an in-plot peak label was covered. The summary is
    // a SIBLING declared before that container and can never be reached by it.
    assert.ok(CODE.indexOf('</details>') < CODE.indexOf('<PortfolioEvolutionChart'))
    const band = /<details[\s\S]*?<\/details>/.exec(CODE)
    assert.ok(band !== null)
    assert.match(band![0], /\{o\.hwmLabel\}/)
    assert.match(band![0], /hwmMarker\.value/)
    assert.match(band![0], /\{o\.hwmSetAt\} \{formatIsoDateLabel\(hwmMarker\.date\)\}/)
    // The dashed swatch ties the row to the line drawn, in the same token.
    assert.match(band![0], /--fp-hwm/)
    assert.match(CHART, /stroke="var\(--fp-hwm\)"/)
  })

  test('§ 8 — the explanation is discoverable by pointer, keyboard, touch and screen reader', () => {
    const band = /<details[\s\S]*?<\/details>/.exec(CODE)!
    // A native disclosure serves click, tap and Enter/Space through ONE
    // mechanism and announces its own state — the superseded hover-opacity
    // panel served pointer and keyboard and left touch with nothing at all.
    assert.match(band[0], /<summary/)
    assert.match(band[0], /aria-describedby=\{hwmTipId\}/)
    assert.match(band[0], /aria-label=\{o\.hwmHelpLabel\}/)
    assert.match(band[0], /id=\{hwmTipId\}/)
    // It opens IN FLOW, so it can never cover chart data.
    assert.ok(!/absolute/.test(band[0]))
    for (const o of [en, es]) {
      assert.ok(/flow-adjusted|ajustada por flujos/i.test(o.hwmTooltip))
      assert.ok(/AUM/i.test(o.hwmTooltip))
      assert.ok(/high-water mark/i.test(o.hwmTooltip), 'the confusable reading is ruled out by name')
    }
  })

  test('§ 7 — privacy withholds the marker outright', () => {
    assert.match(CODE, /const hwmPoint = hwmVisible && !masked \? highWaterMarket\(/)
    assert.match(PRINT, /hwmValue=\{masked \? null : hwmValue\}/)
  })
})

describe('R13.R2F §§ 9-11 · Performance composition', () => {
  test('§ 9 — Main is titled Weekly Performance; a personal scope plainly Performance', () => {
    assert.equal(en.weeklyPerformanceTitle, 'Weekly Performance')
    assert.equal(en.performanceTitle, 'Performance')
    assert.match(CODE, /const performanceSectionTitle = isMain \? o\.weeklyPerformanceTitle : o\.performanceTitle/)
  })

  test('§ 9 — row 1 is each basis\' weekly return beside its weekly P&L', () => {
    const row1 = /const portfolioPrimary: StripGroup\[\][\s\S]*?const portfolioSecondary/.exec(CODE)
    assert.ok(row1 !== null)
    assert.match(row1![0], /value: b\.weeklyReturn/)
    assert.match(row1![0], /value: b\.weeklyProfit/)
    // Nothing year-to-date may appear in the weekly row.
    assert.ok(!/ytdReturn|ytdProfit/.test(row1![0]), 'row 1 is weekly only')
  })

  test('§ 9 — the market comparators sit ADJACENT to the weekly figures, not at the far edge', () => {
    // The band is ONE grid: portfolio, then markets, then a spacer track that
    // absorbs the leftover width. A proportional split (e.g. 2fr/3fr) would
    // push the comparators to the opposite edge of the card — furthest from
    // the figures they exist to be compared against.
    assert.match(STRIP, /lg:grid-cols-\[minmax\(0,auto\)_minmax\(0,auto\)_minmax\(0,1fr\)\]/)
    assert.ok(!/lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\]/.test(STRIP))
    // Both comparators are in row 1, beside the weekly figures.
    const primary = /const marketsPrimary: StripGroup\[\][\s\S]*?const marketsSecondary/.exec(CODE)
    assert.ok(primary !== null)
    assert.match(primary![0], /o\.globalEquity/)
    assert.match(primary![0], /o\.globalFixedIncome/)
  })

  test('§ 9 — the horizon is stated once; no metric repeats "(weekly)"', () => {
    assert.equal(en.globalEquity, 'Global Equity')
    assert.equal(en.globalFixedIncome, 'Global Fixed Income')
    assert.ok(!/\(weekly\)/i.test(en.globalEquity + en.globalFixedIncome))
    assert.ok(!/\(semanal\)/i.test(es.globalEquity + es.globalFixedIncome))
  })

  test('§ 10 — row 2 carries YTD and Net Flows per basis, and reads as P&L not "Profit / Loss"', () => {
    const row2 = /const portfolioSecondary: StripGroup\[\][\s\S]*?const metricState/.exec(CODE)
    assert.ok(row2 !== null)
    assert.match(row2![0], /value: b\.ytdReturn/)
    assert.match(row2![0], /value: b\.ytdProfit/)
    assert.match(row2![0], /value: b\.flow/)
    // The abbreviation is the owner's, in both languages.
    assert.equal(en.weeklyProfit, 'Weekly P&L')
    assert.equal(en.ytdProfit, 'YTD P&L')
    assert.ok(!/Profit \/ Loss/i.test(en.weeklyProfit + en.ytdProfit + en.metricProfit))
    // And a YTD figure never renders at the weekly row's lead scale.
    assert.match(STRIP, /lead \? 'ui-capsule-value' : 'text-sm font-semibold'/)
  })

  test('§ 11 — a personal scope shows ONE basis and no Main basis language anywhere', () => {
    // The series rail is gated on Main…
    assert.match(CODE, /\{isMain && \([\s\S]{0,600}?o\.evoModeCompare/)
    // …and a personal band's single basis is never given a basis title.
    assert.match(CODE, /title: isMain \? blockLabel\(b\.basis\) : undefined/)
    // The neutral label used for a personal series is not a basis name.
    assert.match(CODE, /const singleSeriesLabel = isMain \? o\.evoModeIncl : o\.evoAdjustedValueLabel/)
    for (const o of [en, es]) {
      assert.ok(!/chilean|chilena/i.test(o.personalWeekly + o.evoAdjustedValueLabel))
    }
  })

  test('§ 11 — a personal row 1 is weekly + markets; row 2 is YTD + Net Flows, with no "Weekly" heading', () => {
    const personal = /personalBlock === null[\s\S]*?const portfolioSecondary/.exec(CODE)
    assert.ok(personal !== null)
    assert.match(personal![0], /personalBlock\.weeklyReturn/)
    assert.match(personal![0], /personalBlock\.weeklyProfit/)
    assert.ok(!/ytdReturn/.test(personal![0]), 'a personal weekly row holds no YTD figure')
    // Row 2 is shared with Main's builder and carries no heading of its own —
    // the strip renders `portfolioSecondary` with `lead={false}` and no title.
    assert.match(STRIP, /<GroupStack groups=\{portfolioSecondary\} lead=\{false\}/)
    // A personal scope also gets no InRetail supporting group.
    assert.match(CODE, /const marketsSecondary: StripGroup\[\] = isMain/)
  })
})

describe('R13.R2F §§ 12-13 · Weekly Snapshot', () => {
  test('§ 12 — the change row is named, never the vague "Difference"', () => {
    assert.equal(en.snapDifference, 'Portfolio Value Change')
    assert.equal(es.snapDifference, 'Variación del Valor del Portafolio')
    assert.ok(!/^Difference$/i.test(en.snapDifference))
    for (const key of ['snapBeginningOfYear', 'snapPreviousWeek', 'snapThisWeek'] as const) {
      assert.ok(en[key].length > 0, key)
    }
  })

  test('§ 12 — the flow explanation is explicit, and the identity only where supported', () => {
    assert.match(en.snapFlowNote, /includes Net Flows/i)
    assert.match(es.snapFlowNote, /Flujos Netos/i)
    assert.equal(en.snapFlowIdentity, 'Portfolio Value Change = Weekly P&L + Net Flows')
    // Rendered ONLY when both of its terms are published for the basis shown —
    // an unsupported identity is not asserted.
    assert.match(CODE, /const flowIdentitySupported =\s*\n?\s*snapshotBlock !== null && snapshotBlock\.flow !== null && snapshotBlock\.weeklyProfit !== null/)
    assert.match(CODE, /\{flowIdentitySupported && \(/)
  })

  test('§ 12 — Portfolio Value Change is This Week − Previous Week, derived once', () => {
    assert.match(CODE, /value: snap\?\.difference \?\? null/)
    assert.match(CODE, /isDifference: true/)
    // A genuine disagreement with the publication's own figure is surfaced,
    // not smoothed over.
    assert.match(CODE, /snap\?\.differenceStatus === 'mismatch'/)
  })

  test('§ 13 — no InRetail PORTFOLIO-VALUE impact is annotated in the performance area', () => {
    // The InRetail portfolio impact is a line of the Weekly close by line
    // table; annotating it again above the fold showed one figure twice.
    assert.equal((en as Record<string, unknown>).inretailImpact, undefined)
    assert.equal((es as Record<string, unknown>).inretailImpact, undefined)
    assert.equal((en as Record<string, unknown>).inretailIncluded, undefined)
    // The MARKET metrics that remain are a listed price and its variation.
    assert.equal(en.inretailPrice, 'Closing price (USD)')
    assert.equal(en.inretailVariation, 'Price variation')
    assert.ok(!/impact|impacto/i.test(en.inretailPrice + en.inretailVariation +
      es.inretailPrice + es.inretailVariation))
  })
})

describe('R13.R2F § 16 · Weekly Notes', () => {
  test('notes are MAIN ONLY, and a personal scope renders no region at all', () => {
    assert.equal(scopeHasWeeklyNotes('main'), true)
    for (const scope of ['jaime', 'andres', 'pablo']) {
      assert.equal(scopeHasWeeklyNotes(scope), false, scope)
    }
    assert.match(CODE, /const showNotes = activeScope !== null && scopeHasWeeklyNotes\(activeScope\)/)
    assert.match(CODE, /\{showNotes && \(/)
    // § 17 — no empty filler column: the analytical row becomes a two-column
    // split rather than a three-column one with a void in it.
    assert.match(CODE, /showNotes\s*\n?\s*\?\s*'grid grid-cols-1 xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,5fr\)_minmax\(0,4fr\)\]'/)
    // The personal row's own shape is retuned by later visual passes (R13.R2F2
    // changed its ratio, R13.R2F3 moved Performance into it) and is pinned in
    // those suites. What § 17 requires here is only that a personal scope
    // renders no notes region — not a particular number of columns.
    const personalTrack = CODE.match(/:\s*'grid grid-cols-1 xl:grid-cols-\[(minmax\(0,\d+fr\)(?:_minmax\(0,\d+fr\))*)\]'/)
    assert.ok(personalTrack, 'personal analytical row must declare an explicit xl track list')
    assert.equal((CODE.match(/<WeeklyNotesPanel/g) ?? []).length, 1)
  })

  test('the storage-unavailable condition is carried through as ITSELF', () => {
    // The weekly-notes migration is deliberately unapplied during owner review,
    // so the store is unreachable. The page must not flatten that into "the
    // note could not be saved" and must never present an empty list as "no note
    // has been written for this week".
    assert.match(CODE, /if \(code === 'schema_missing' \|\| code === 'not_configured'\) return 'unavailable'/)
    assert.match(NOTES, /schema_missing/)
    assert.match(CODE, /availability=\{data\.weeklyNotesState \?\? 'ok'\}/)
    assert.match(CODE, /schemaMissing: o\.notesSchemaMissing/)
    for (const o of [en, es]) {
      assert.ok(o.notesSchemaMissing.length > 0)
      assert.notEqual(o.notesSchemaMissing, o.notesEmpty)
      assert.notEqual(o.notesSchemaMissing, o.notesSaveError)
    }
  })

  test('add / edit / delete are defined, delete confirms, and a member gets none of them', () => {
    for (const label of ['notesAdd', 'notesEdit', 'notesDelete', 'notesDeleteConfirm',
      'notesDeleteTitle', 'notesDeleteBody'] as const) {
      assert.ok(en[label].length > 0, label)
      assert.ok(es[label].length > 0, `es ${label}`)
    }
    assert.match(CODE, /onCreate=\{handleCreateNote\}/)
    assert.match(CODE, /onUpdate=\{handleUpdateNote\}/)
    assert.match(CODE, /onDelete=\{handleDeleteNote\}/)
    // The write affordance is gated on a server-derived capability, and every
    // route re-derives it regardless.
    assert.match(CODE, /canEdit=\{data\.canEditNotes === true\}/)
  })
})

describe('R13.R2F §§ 22-23 · the A4 print one-pager', () => {
  test('it serves all four scopes from the payload already fetched for this caller', () => {
    // One component, no second fetch, no second entitlement decision — so the
    // sheet can never render what the Summary itself would refuse.
    assert.match(CODE, /\{current\?\.outcome === 'ready' && data && pub && \(\s*\n?\s*<SummaryPrintSheet/)
    assert.ok(!/fetch\(/.test(codeOf(PRINT)), 'the sheet must never fetch')
  })

  test('the market labels are the owner\'s, and reach paper through the SAME groups as the screen', () => {
    assert.match(CODE, /marketMetrics=\{marketsPrimary\.concat\(marketsSecondary\)/)
    assert.match(CODE, /portfolioMetrics=\{portfolioPrimary\.flatMap/)
    assert.match(CODE, /detailGroups=\{portfolioSecondary\.map/)
    assert.equal(en.globalEquity, 'Global Equity')
    assert.equal(en.globalFixedIncome, 'Global Fixed Income')
  })

  test('gains print in the approved green and losses in the approved red', () => {
    assert.match(PRINT, /if \(value > 0\) return 'nv-print-pos'/)
    assert.match(PRINT, /if \(value < 0\) return 'nv-print-neg'/)
    assert.match(CSS, /\.nv-print-pos/)
    assert.match(CSS, /\.nv-print-neg/)
  })

  test('a NET FLOW is never toned — it is capital moving, not a result', () => {
    // Printed green a contribution would read as profit.
    assert.match(CODE, /tone: m\.state === 'ok' && !m\.key\.endsWith\('-flow'\) \? m\.value : null/)
    // A listed PRICE is a level, not a result, and is likewise untoned.
    assert.match(CODE, /tone: m\.state === 'ok' && m\.kind !== 'price' \? m\.value : null/)
  })

  test('a masked figure is never toned, and paper never relaxes the page mask', () => {
    assert.match(PRINT, /if \(masked \|\| value === null/)
    assert.match(CODE, /masked=\{masked\}/)
  })

  test('paper keeps the actual / flow-adjusted distinction the screen makes', () => {
    // The masthead is the ACTUAL published value…
    assert.match(CODE, /totalValue=\{data\.hero\?\.totalValue \?\? null\}/)
    // …the chart is the ADJUSTED path, and carries the disclosure, because a
    // reader holding paper has no tooltip to consult.
    assert.match(CODE, /evolutionPoints=\{headlinePoints\}/)
    assert.match(CODE, /evolutionNote=\{o\.evoValueChangeNote\}/)
    assert.match(PRINT, /\{evolutionNote && /)
    assert.match(CODE, /evolutionChangeLabel=\{o\.evoAdjustedValueChange\}/)
  })

  test('Main prints its notes; a personal sheet renders no notes region at all', () => {
    assert.match(CODE, /notes=\{showNotes \? \(data\.weeklyNotes \?\? \[\]\)\.map/)
    assert.match(PRINT, /\{notes\.length > 0 && \(/)
  })

  test('no application control reaches paper', () => {
    const code = codeOf(PRINT)
    for (const control of ['SegmentedControl', 'SettingsGearButton', 'PrivacyToggle',
      'onClick', 'window.print', 'AllocationSettingsDialog', 'WeeklyNotesPanel']) {
      assert.ok(!code.includes(control), `${control} must not reach the printed sheet`)
    }
    // And the whole interactive composition is excluded from print.
    assert.match(CODE, /className="no-print"/)
  })

  test('the printed chart states real endpoint dates and invents nothing', () => {
    // R13.R2F4 — the labels are built from an index list into `points` and
    // positioned at their true x, rather than emitted inline; the property is
    // unchanged, and stronger: EVERY label reads an observation, and the index
    // list contains both endpoints.
    assert.match(PRINT, /date: points\[i\]\.date/)
    assert.match(PRINT, /\[0, Math\.floor\(\(points\.length - 1\) \/ 2\), points\.length - 1\] : \[0, points\.length - 1\]/)
    assert.match(PRINT, /formatDate\(dt\.date\)/)
    const code = codeOf(PRINT)
    assert.ok(!/interpolat|resample|carryForward|fillGaps/i.test(code))
  })

  test('§ 23 — paper always prints the LIGHT palette, whatever theme the screen was in', () => {
    // The ring's slice fills resolve through the `--fp-*` custom properties, so
    // printing from dark mode used to lay the dark palette — tints validated
    // against a #151E25 card — onto white stock.
    const printBlock = CSS.slice(CSS.indexOf('.nv-print-sheet {'))
    const screen = CSS.slice(0, CSS.indexOf('@media print'))
    const tokens = [
      ...Array.from({ length: 12 }, (_, i) => `--fp-slice-${i + 1}`),
      ...Array.from({ length: 12 }, (_, i) => `--fp-spectrum-${i + 1}`),
      '--fp-series-incl', '--fp-series-excl', '--fp-hwm',
    ]
    for (const token of tokens) {
      // Each token is declared twice on screen — light first, then dark. The
      // FIRST declaration is the light one, which is the set the perceptual
      // audit measures against a light surface, and paper is a light surface.
      const declared = Array.from(
        screen.matchAll(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`, 'g')),
      ).map((m) => m[1].toUpperCase())
      assert.equal(declared.length, 2, `${token} must carry a light AND a dark value`)
      assert.notEqual(declared[0], declared[1], `${token} must genuinely differ by theme`)
      const printed = new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(printBlock)
      assert.ok(printed !== null, `${token} must be pinned for print`)
      // Byte-identical to the audited light value — a print override that
      // introduced a NEW colour would escape the contrast audit entirely.
      assert.equal(printed![1].toUpperCase(), declared[0],
        `${token} must print its audited LIGHT value, not a new colour`)
    }
  })
})

describe('R13.R2F §§ 20-21, 25-27 · the visual contract', () => {
  test('§ 21 — both settings gears exist, and normal view controls stay outside settings', () => {
    const gear = read('src/components/familyPortfolio/SettingsGearButton.tsx')
    assert.match(gear, /aria-label/)
    assert.match(CODE, /onOpenSettings=\{canEditSettings \? \(\) => setSettingsOpen\(true\) : undefined\}/)
    assert.match(CODE, /<SettingsGearButton[\s\S]{0,200}?label=\{o\.settingsEvolution\}/)
    // Ranges, Compare/Incl./Excl. and the allocation basis are all rendered as
    // visible controls, never behind the gear.
    assert.match(CODE, /ariaLabel=\{o\.evoPeriodLabel\}/)
    assert.match(CODE, /ariaLabel=\{o\.evoSeriesLabel\}/)
    assert.match(CODE, /basisControl=\{/)
  })

  test('§ 20 — the two Compare series are strongly separated BEFORE any interaction', () => {
    assert.match(CODE, /colorVar: '--fp-series-incl'/)
    assert.match(CODE, /colorVar: '--fp-series-excl'/)
    // Distinct in both themes — a pair that separates in dark and collapses in
    // light is a failing pair, so both declarations of each are checked.
    const screen = CSS.slice(0, CSS.indexOf('@media print'))
    const both = (token: string) =>
      Array.from(screen.matchAll(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`, 'g')))
        .map((m) => m[1].toUpperCase())
    const incl = both('--fp-series-incl')
    const excl = both('--fp-series-excl')
    assert.equal(incl.length, 2)
    assert.equal(excl.length, 2)
    assert.notEqual(incl[0], excl[0], 'light theme')
    assert.notEqual(incl[1], excl[1], 'dark theme')
    // And the legend names each series — colour is never the only carrier.
    assert.match(CHART, /nameOf\(/)
  })

  test('§ 19 — the axis is the union of REAL observation dates, with both edges clear', () => {
    assert.match(CHART, /Array\.from\(new Set\(drawn\.flatMap\(\(s\) => s\.points\.map\(\(p\) => p\.date\)\)\)\)/)
    const ml = /const ML = (\d+)/.exec(CHART)
    const mr = /const MR = (\d+)/.exec(CHART)
    assert.ok(ml !== null && mr !== null)
    assert.ok(Number(ml![1]) >= 40, 'the left margin must clear the value labels')
    assert.ok(Number(mr![1]) >= 20, 'the right margin must clear the final tick')
    const code = codeOf(CHART)
    assert.ok(!/interpolat|resample|carryForward/i.test(code))
  })

  test('§ 25 — every layout grid carries a responsive prefix; nothing escapes horizontally', () => {
    for (const grid of CODE.match(/grid-cols-\[?[^"'`\s]*/g) ?? []) {
      assert.ok(
        /^grid-cols-1$/.test(grid) || /^(sm|md|lg|xl|2xl):/.test(grid) ||
        CODE.includes(`grid-cols-1 xl:${grid}`) || CODE.includes(`grid-cols-1 lg:${grid}`),
        `${grid} must be responsive`,
      )
    }
    assert.ok(!/overflow-x-visible/.test(PAGE))
    // Long pill rails scroll inside their own wrapper rather than widening the page.
    assert.match(CODE, /overflow-x-auto nv-scrollbar-hidden/)
    assert.ok(!/min-width:\s*\d+px/.test(CSS.slice(0, CSS.indexOf('@media print'))),
      'no root min-width may reintroduce page-level horizontal scroll')
  })

  test('§ 26 — no component introduces a hardcoded colour or a raw Tailwind scale', () => {
    const surfaces = [PAGE, STRIP, SNAPCARD, NOTES, PRINT, CHART,
      read('src/components/familyPortfolio/AllocationPanel.tsx'),
      read('src/components/familyPortfolio/PortfolioValueHero.tsx')]
    for (const src of surfaces) {
      const body = codeOf(src)
      assert.ok(!/bg-(gray|slate|zinc|emerald|red|blue|green)-\d{2,3}/.test(body))
      assert.ok(!/text-(gray|slate|zinc|emerald|red|blue|green)-\d{2,3}/.test(body))
      assert.ok(!/\bbg-white\b|\btext-black\b/.test(body))
      // The print sheet legitimately pins print greys; the screen surfaces may not.
      if (src !== PRINT) {
        assert.ok(!/#[0-9A-Fa-f]{6}/.test(body), 'no raw hex on a screen surface')
      }
    }
  })

  test('§ 27 — motion rides the shared transition, which reduced-motion collapses', () => {
    assert.ok(!/animate-|transition-\[/.test(codeOf(PAGE)),
      'no bespoke animation outside the shared token')
    assert.match(CSS, /prefers-reduced-motion/)
  })

  test('privacy — every portfolio amount renders masked, and the chart is replaced wholesale', () => {
    assert.match(CODE, /<MaskedAmount/)
    // The chart is replaced WHOLESALE when masked — its axis, tooltip and
    // crosshair readout all carry raw amounts, so hiding only the line would
    // mask nothing.
    assert.match(CODE, /: masked \? \(/)
    assert.match(CODE, /<PrivacyValue masked/)
    // An ARIA string must never carry a raw amount past the mask.
    assert.ok(!/aria-label=\{[^}]*(hwmMarker\.value|actualLatest\.value|headlineChange\.absolute)/.test(CODE))
  })

  test('EN and ES stay in step across every label this pass touched', () => {
    const keys = [
      'evoTitle', 'evoFlowAdjustedChip', 'evoAdjustedValueChange', 'evoActualValueLabel',
      'evoValueChangeNote', 'hwmLabel', 'hwmTooltip', 'hwmHelpLabel', 'hwmSetAt',
      'weeklyPerformanceTitle', 'performanceTitle', 'snapDifference', 'snapFlowNote',
      'snapFlowIdentity', 'flow', 'flowHelp', 'notesSchemaMissing', 'globalEquity',
      'globalFixedIncome', 'weeklyProfit', 'ytdProfit',
    ] as const
    for (const key of keys) {
      assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en.${key}`)
      assert.ok(typeof es[key] === 'string' && es[key].length > 0, `es.${key}`)
      // The owner-locked term is deliberately the SAME string in both.
      if (key !== 'hwmLabel') {
        assert.notEqual(en[key], es[key], `${key} must actually be translated`)
      }
    }
  })
})
