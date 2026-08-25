// R13.R2F3 §§ 31, 33 — the printed evolution axes, and the widened shared
// interaction contract.
//
// WHY THIS SUITE EXISTS. Two owner-reported defects are pinned here, each with
// the property that would let it come back:
//
//   1. PRINT. The sheet ruled three FULL-PLOT-WIDTH gridlines and, on top of
//      the topmost one, a dashed High Water Market reference — and the print
//      stylesheet forced both to the same grey, so they printed as one
//      thickened, unexplained broken rule. That collision is STRUCTURAL, not a
//      data accident: the marker is the running peak of the plotted series and
//      the top tick is that series' maximum, so `hwm === max` is an identity.
//      Verified against the live book on all five scopes at 0.00mm separation.
//      The fix is an actual axis frame — a vertical y rule with short ticks —
//      and drawing the reference only when it genuinely sits away from a tick.
//   2. INTERACTION. R13.R2F2's hover rule reached no navigation at all, because
//      every rail item is a Next `<Link>`, i.e. an `<a>`. The contract is now
//      widened to `nav a` — the element that already means "navigation" — and
//      must NOT have been widened to every anchor in the app.
//
// The HWM/tick collision is proved by RUNNING the real modules on invented
// fixtures, so it holds as a property rather than as a comment. Composition is
// a source contract, this module's established idiom — a React tree cannot be
// rendered under `node --test`.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatUsdCompactM } from '../src/lib/formatters.ts'
import { highWaterMarket } from '../src/lib/familyPortfolio/highWaterMarket.ts'
import { scopeHasWeeklyNotes } from '../src/lib/familyPortfolio/weeklyNotes.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PRINT = read('src/components/familyPortfolio/SummaryPrintSheet.tsx')
const PRINT_CODE = codeOf(PRINT)
const CSS = read('src/app/globals.css')
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
const CODE = codeOf(read('src/app/family-portfolio/page.tsx'))
const STRIP_CODE = codeOf(read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx'))
const PANEL_CODE = codeOf(read('src/components/familyPortfolio/AllocationPanel.tsx'))
const DONUT_CODE = codeOf(read('src/components/familyPortfolio/AllocationDonut.tsx'))

// ═══════════════════════════════════════════════════════════════════════════
// The identity that caused the bug — proved, not asserted in prose.
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F3 §§ 17-18 · the printed chart\'s horizontal-rule collision', () => {
  /** The print sheet's own y-scale, transcribed so the test computes what it draws. */
  function scale(values: number[]) {
    const PH = 150, PT = 6, PB = 6
    const h = PH - PT - PB
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || Math.abs(max) || 1
    const yMin = min - range * 0.07
    const yMax = max + range * 0.07
    return { min, max, y: (v: number) => PT + h - ((v - yMin) / (yMax - yMin)) * h }
  }

  test('the High Water Mark IS the top tick — always, by construction', () => {
    // Any series at all: the marker is the running peak, the top tick is the
    // maximum. There is no series for which these differ, which is why drawing
    // both could only ever produce a doubled rule.
    const cases: number[][] = [
      [100, 120, 90, 140, 130],            // peak in the middle
      [100, 110, 120, 130, 145],           // ends at its peak (the live shape)
      [200, 180, 160, 150, 140],           // monotonically falling
      [50, 50, 50, 50],                    // flat
      [-40, -10, -25, -5, -30],            // wholly negative
    ]
    for (const values of cases) {
      const points = values.map((v, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, value: v }))
      const hwm = highWaterMarket(points)
      assert.ok(hwm, JSON.stringify(values))
      const { max, y } = scale(values)
      assert.equal(hwm.value, max, `HWM must equal the plotted maximum: ${values}`)
      // …and therefore lands on exactly the same row as the top tick.
      assert.ok(Math.abs(y(hwm.value) - y(max)) < 1e-9)
    }
  })

  test('so the sheet draws the reference ONLY when it is off every tick', () => {
    // The coincidence test is in the component, with an explicit epsilon, and
    // the dashed rule is gated on it. Without the gate the sheet would rule a
    // dashed line over a solid one on every scope of every week.
    assert.match(PRINT_CODE, /const hwmOnTick = hwmY !== null && yTicks\.some\(\(t\) => Math\.abs\(y\(t\.value\) - hwmY\) < TICK_EPSILON\)/)
    assert.match(PRINT_CODE, /const hwmStandalone = hwmY !== null && !hwmOnTick/)
    assert.match(PRINT_CODE, /\{hwmY !== null && hwmStandalone && \([\s\S]{0,400}?strokeDasharray="5 4"/)
    // …and when it IS drawn it gets its own gutter label, so a dashed rule can
    // never appear unexplained (§ 22).
    assert.match(PRINT_CODE, /\{hwmY !== null && hwmStandalone && \([\s\S]{0,600}?<MaskedAmount value=\{hwmValue\} masked=\{masked\} compact \/>/)
  })

  test('no full-plot-width horizontal rule is drawn for a value', () => {
    // The old gridlines ran `x1={PL} … x2={PL + w}`. Two elements may legally
    // span the plot now: the X-AXIS BASELINE (R13.R2F4) and the defensive
    // standalone reference. A value tick never may.
    const fullWidthRules = PRINT_CODE.match(/x2=\{PL \+ w\}/g) ?? []
    assert.equal(fullWidthRules.length, 2, 'only the baseline and the standalone reference may span the plot')
    // The tick map's OWN body, up to the `))}` that closes it: ticks run
    // OUTWARD from the axis (`PL - TICK_LEN` → `PL`), never across the plot.
    const after = PRINT_CODE.slice(PRINT_CODE.indexOf('yTicks.map((tick) => ('))
    const tickMap = after.slice(0, after.indexOf('))}'))
    assert.match(tickMap, /x1=\{PL - TICK_LEN\}/)
    assert.match(tickMap, /x2=\{PL\}/)
    assert.ok(!/x2=\{PL \+ w\}/.test(tickMap), 'a value tick must never span the plot')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 20-21 · BOTH AXES, ON EVERY SCOPE'S SHEET
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F3 §§ 20-21 · the printed axes', () => {
  test('there is a real Y AXIS, not just floating labels', () => {
    // A vertical rule at the plot's left edge, spanning the plot height.
    assert.match(PRINT_CODE, /x1=\{PL\}\s*\n\s*y1=\{PT\}\s*\n\s*x2=\{PL\}\s*\n\s*y2=\{PT \+ h\}/)
    assert.match(PRINT_CODE, /const TICK_LEN = 6/)
  })

  test('the two axes MEET: the baseline is svg geometry, not a CSS border', () => {
    // The R13.R2F3 defect: a `border-top` on the date row is a sibling of the
    // svg, so it renders at the svg's bottom EDGE while the plot's baseline sat
    // `PB` units higher — the vertical rule stopped short of the horizontal one
    // and the origin corner never closed.
    const baseline = /x1=\{PL\}\s*\n\s*y1=\{PT \+ h\}\s*\n\s*x2=\{PL \+ w\}\s*\n\s*y2=\{PT \+ h\}/
    assert.match(PRINT_CODE, baseline, 'the x-axis baseline must be drawn inside the svg')
    // The frame is drawn with <line>, never <path>: the print stylesheet paints
    // `.nv-print-evo path` in the SERIES ink, so a path frame would print blue.
    const framePath = /<path[\s\S]{0,200}?stroke="#5b6770"/.test(PRINT_CODE)
    assert.ok(!framePath, 'the axis frame must not be a <path> — it would take the series colour')
  })

  // ═════════════════════════════════════════════════════════════════════════
  // R13.R2F5.1 — THE BASELINE AND ITS LABELS SHARE ONE COORDINATE SYSTEM
  //
  // Three passes drew the baseline in the svg and set the dates in an HTML row
  // below it, then argued about how the svg would be sized so the two would
  // meet. Each argument was wrong in a different way, and the owner rejected
  // the result three times. These tests pin the ARCHITECTURE that removes the
  // argument, not another sizing claim.
  // ═════════════════════════════════════════════════════════════════════════

  test('the x labels live INSIDE the viewBox, with the baseline', () => {
    // If they are geometry, no CSS box can put them apart — at any page size,
    // in any print engine. This is the invariant that replaces every previous
    // "the svg will fill its wrapper" argument.
    assert.match(PRINT_CODE, /<text[\s\S]{0,500}?\{formatDate\(dt\.date\)\}[\s\S]{0,20}?<\/text>/)
    assert.match(PRINT_CODE, /y=\{xLabelY\}/)
    assert.match(PRINT_CODE, /const xLabelY = baselineY \+ X_TICK \+ X_LABEL_GAP/)
    assert.match(PRINT_CODE, /const baselineY = PT \+ h/)
    // …and the separate HTML row is gone, along with its stylesheet rule.
    assert.ok(!/nv-print-evo-axis/.test(PRINT_CODE), 'the detached HTML date row must not return')
    assert.ok(!/nv-print-evo-axis/.test(CSS_CODE), 'nor its stylesheet rule')
  })

  test('the baseline-to-label gap is a CONSTANT of the module, not a CSS outcome', () => {
    // Expressed in the same units as the plot, so it scales with the chart and
    // cannot be reopened by a flex parent, a page size or a print engine.
    const tick = Number(PRINT_CODE.match(/const X_TICK = (\d+)/)![1])
    const gap = Number(PRINT_CODE.match(/const X_LABEL_GAP = (\d+)/)![1])
    const size = Number(PRINT_CODE.match(/const X_LABEL_SIZE = (\d+)/)![1])
    const PWv = Number(PRINT_CODE.match(/const PW = (\d+)/)![1])
    // The printed plot is ≈174mm across (186mm measure less a 12mm gutter), and
    // the box is UNIFORMLY scaled, so one viewBox unit ≈ 174/720 mm in both
    // axes. The gap must read as a conventional axis gap: present, and small.
    const mmPerUnit = 174 / PWv
    const gapMm = (tick + gap) * mmPerUnit
    assert.ok(gapMm > 0.8, `${gapMm.toFixed(2)}mm is too tight to read as a tick + gap`)
    assert.ok(gapMm < 4, `${gapMm.toFixed(2)}mm is the floating baseline the owner rejected`)
    // The label band is reserved inside the viewBox, so the labels cannot be
    // clipped by it either.
    assert.match(PRINT_CODE, /const PB = X_TICK \+ X_LABEL_GAP \+ X_LABEL_SIZE \+ 2/)
    const PHv = Number(PRINT_CODE.match(/const PH = (\d+)/)![1])
    const PTv = Number(PRINT_CODE.match(/const PT = (\d+)/)![1])
    assert.ok(PTv + (tick + gap + size + 2) < PHv, 'the axis band must fit inside the viewBox')
  })

  test('the box is uniformly scaled and sized by its own aspect ratio', () => {
    // Why the labels CAN be svg text now: a stretched box (`preserveAspectRatio
    // ="none"`) distorts glyphs, which is what forced them into HTML. And why
    // the wrapper cannot float away from the plot: the svg is an ordinary
    // in-flow block whose height follows from the viewBox, so the wrapper's
    // height IS the svg's height.
    const svg = PRINT_CODE.slice(PRINT_CODE.indexOf('<svg\n          className="nv-print-evo"'))
    const tag = svg.slice(0, svg.indexOf('>'))
    assert.match(tag, /preserveAspectRatio="xMidYMid meet"/)
    assert.ok(!/preserveAspectRatio="none"/.test(PRINT_CODE))
    assert.ok(!/position: 'absolute'/.test(tag), 'the plot must be in normal flow')
    assert.ok(!/height: '100%'/.test(tag), 'no percentage height may return')
    // Both dimensions specified in CSS, so the browser never falls back to
    // intrinsic replaced-element sizing — the failure mode of the last pass.
    const cssEvo = /\.nv-print-sheet \.nv-print-evo \{[\s\S]{0,300}?\}/.exec(CSS_CODE)
    assert.ok(cssEvo !== null)
    assert.match(cssEvo![0], /width: 100%/)
    assert.match(cssEvo![0], /height: auto/)
    // The wrapper contributes no height of its own — that was the "unrelated
    // flex expansion" the geometry kept depending on.
    const wrapper = PRINT_CODE.slice(PRINT_CODE.indexOf('position: \'relative\''))
    const wrapperStyle = wrapper.slice(0, wrapper.indexOf('}'))
    assert.ok(!/flex:|minHeight|maxHeight/.test(wrapperStyle), 'the plot wrapper must not size itself')
    // …and NOTHING may add height to the svg either. Caught by measurement:
    // a `margin-bottom` on the plot made the wrapper 1.5mm taller than the box
    // it contains, which put the HTML value labels 0.14mm off their own ticks.
    // The gap below the chart belongs to the wrapper, outside its border box.
    assert.ok(!/margin/.test(cssEvo![0]), 'a margin on the plot decouples it from its wrapper')
    assert.match(wrapperStyle, /marginBottom: '1\.5mm'/)
  })

  test('there is a real X AXIS whose labels sit at their TRUE positions', () => {
    // Endpoints always; the series' own MIDDLE OBSERVATION when long enough.
    assert.match(
      PRINT_CODE,
      /const dateIndices =\s*\n?\s*points\.length >= 5 \? \[0, Math\.floor\(\(points\.length - 1\) \/ 2\), points\.length - 1\] : \[0, points\.length - 1\]/,
    )
    // Each label is drawn at the same x the svg plots that observation at —
    // now literally the same number, not a percentage translation of it.
    assert.match(PRINT_CODE, /x: x\(points\[i\]\.date\)/)
    assert.match(PRINT_CODE, /x=\{dt\.x\}/)
    // Endpoints anchor inward so neither can hang off the measure.
    assert.match(PRINT_CODE, /anchor: n === 0 \? \('start' as const\)/)
    assert.match(PRINT_CODE, /textAnchor=\{dt\.anchor\}/)
    // NEVER an invented date: the label set is built by indexing into `points`,
    // and the labels themselves render nothing but those entries. Scoped to the
    // axis block — `formatDate` is also the sheet's general date renderer.
    assert.match(PRINT_CODE, /date: points\[i\]\.date/)
    const axis = PRINT_CODE.slice(PRINT_CODE.indexOf('const dateIndices'), PRINT_CODE.indexOf('</svg>'))
    assert.ok(!/new Date|toISOString/.test(axis), 'no date arithmetic in the axis block')
    for (const label of axis.match(/formatDate\([^)]*\)/g) ?? []) {
      assert.match(label, /points\[|dt\.date/, `x-axis label must read a real observation: ${label}`)
    }
    // Each label has its own tick descending from the baseline.
    assert.match(PRINT_CODE, /y1=\{baselineY\}\s*\n\s*x2=\{dt\.x\}\s*\n\s*y2=\{baselineY \+ X_TICK\}/)
  })

  test('the printed chart is no taller than the band it replaced', () => {
    // The elastic 42-88mm plot is gone deliberately — it was the flex expansion
    // the baseline depended on. The fixed aspect must not cost the one-pager a
    // page: the chart INCLUDING its labels has to fit the old 42mm floor plus
    // the ~5mm date row it used to sit above.
    const PWv = Number(PRINT_CODE.match(/const PW = (\d+)/)![1])
    const PHv = Number(PRINT_CODE.match(/const PH = (\d+)/)![1])
    const printedMm = (174 / PWv) * PHv
    assert.ok(printedMm <= 50, `${printedMm.toFixed(1)}mm could push a full sheet onto a second page`)
    assert.ok(printedMm >= 40, `${printedMm.toFixed(1)}mm is too short to read a weekly series`)
  })

  test('the y labels are locked to their own tick positions', () => {
    // The value labels stay HTML — they are monetary and must keep the one
    // guarded `MaskedAmount` render path — so their lock is positional: the
    // tick is drawn at `y(value)` in viewBox units and the label sits at the
    // same fraction of the box, `y(value) / PH`. R13.R2F5.1 is what finally
    // makes that exact: the svg is in flow at its own aspect ratio, so the
    // wrapper's height IS the svg's height and the two fractions describe the
    // same physical position.
    assert.match(PRINT_CODE, /pct: \(y\(v\) \/ PH\) \* 100/)
    assert.match(PRINT_CODE, /top: `\$\{tick\.pct\}%`/)
    // The gutter is reserved by PADDING on the wrapper, so the labels'
    // percentage resolves against the same box the svg occupies.
    assert.match(PRINT_CODE, /paddingLeft: Y_AXIS_GUTTER/)
    // § 23 / R13.R2F4 § 2 — the gutter is sized from MEASURED label widths,
    // and the labels are now the COMPACT form: `145,5M` is 6 characters
    // ≈ 8.7mm at 7.5pt, and grows by one character per order of magnitude
    // rather than four. Never a round guess.
    const gutter = PRINT_CODE.match(/const Y_AXIS_GUTTER = '(\d+)mm'/)
    assert.ok(gutter, 'the gutter must be a single named constant')
    const mm = Number(gutter[1])
    assert.ok(mm >= 10, `gutter ${mm}mm would clip a compact label`)
    assert.ok(mm <= 14, `gutter ${mm}mm leaves the plot needlessly compressed`)
  })

  test('R13.R2F4 — y labels print at chart-axis length, through the guarded path', () => {
    // `#,#M` in the project's own locale: the comma IS the decimal separator.
    assert.equal(formatUsdCompactM(145_470_441), '145,5M')
    assert.equal(formatUsdCompactM(130_600_000), '130,6M')
    assert.equal(formatUsdCompactM(-8_250_000), '-8,3M')
    // Below a million the abbreviation would destroy resolution, so it falls
    // back to the plain grouped amount rather than three ticks of `0,3M`.
    assert.equal(formatUsdCompactM(340_000), '340.000')
    // Unavailable stays an em dash — never `0M`.
    assert.equal(formatUsdCompactM(null), '—')
    assert.equal(formatUsdCompactM(Number.NaN), '—')
    // And it is reached ONLY through MaskedAmount, so the mask still applies.
    const masked = read('src/components/familyPortfolio/MaskedAmount.tsx')
    // R13.R3C.2 added a third branch (the contributors chart's whole-unit
    // form); the PRINT axis still reaches `formatUsdCompactM` on `compact`.
    assert.match(masked, /:\s*compact\s*\?\s*formatUsdCompactM\(value\)/)
    assert.match(masked, /<PrivacyValue masked=\{masked\}/)
    assert.ok(
      !/formatUsdCompactM/.test(PRINT_CODE),
      'the print sheet must not format an amount itself — that would bypass the mask',
    )
  })

  test('y values come off the plotted series — never an invented round number', () => {
    assert.match(PRINT_CODE, /const tickValues = max > min \? \[max, \(max \+ min\) \/ 2, min\] : \[max\]/)
    // No rounding-to-a-nice-number helper anywhere near the axis.
    assert.ok(!/niceNumber|roundTo|Math\.ceil\(.*\/ *10/.test(PRINT_CODE))
  })

  test('a flat series draws ONE tick, not three identical ones', () => {
    // `max > min` is false, so the list is a single value — no duplicate label
    // and no stack of coincident ticks.
    const flat = [77, 77, 77, 77]
    const min = Math.min(...flat)
    const max = Math.max(...flat)
    const ticks = max > min ? [max, (max + min) / 2, min] : [max]
    assert.equal(ticks.length, 1)
    assert.equal(new Set(ticks).size, 1)
    // R13.R2F4 — EVERY label centres on its own tick now, including this one.
    // The old inward anchoring at the extremes (top label's top edge on the
    // tick) is what read as misalignment; `PT = 8` buys the headroom that made
    // it necessary, so a single uniform transform replaces the anchor table.
    assert.match(PRINT_CODE, /const yTicks = tickValues\.map\(\(v\) => \(\{ value: v, pct: \(y\(v\) \/ PH\) \* 100 \}\)\)/)
    assert.match(PRINT_CODE, /transform: 'translateY\(-50%\)'/)
    assert.ok(!/anchorTranslateY/.test(PRINT_CODE), 'the anchor table is superseded by a uniform centre')
  })

  test('axis values obey the page mask — an axis is not a privacy loophole', () => {
    assert.match(PRINT_CODE, /<MaskedAmount value=\{tick\.value\} masked=\{masked\} compact \/>/)
    // The reference is withheld outright while masked, upstream of the chart.
    assert.match(PRINT_CODE, /hwmValue=\{masked \? null : hwmValue\}/)
    // A level is never toned as a gain or a loss.
    const tickLabel = PRINT_CODE.slice(PRINT_CODE.indexOf('yTicks.map((tick) => (\n          <span'))
    assert.ok(!/nv-print-pos|nv-print-neg/.test(tickLabel.slice(0, 800)))
  })

  test('the same axis contract serves Main and every personal sheet', () => {
    // One chart component, called once, with no per-scope branch — so Jaime,
    // Andrés and Pablo cannot get a different axis from Main.
    assert.equal((PRINT_CODE.match(/function PrintEvolution/g) ?? []).length, 1)
    assert.equal((PRINT_CODE.match(/<PrintEvolution/g) ?? []).length, 1)
    assert.ok(!/scope === 'main'|isMain/.test(PRINT_CODE))
  })

  test('the rest of the printed sheet is not regressed', () => {
    // Colour still follows meaning, flows stay untoned, notes stay conditional,
    // privacy still replaces the chart wholesale.
    assert.equal((PRINT_CODE.match(/toneClass\(/g) ?? []).length, 4)
    assert.match(PRINT_CODE, /\{notes\.length > 0 && \(/)
    assert.match(PRINT_CODE, /if \(masked \|\| value === null/)
    assert.equal((PRINT_CODE.match(/fetch\(/g) ?? []).length, 0)
    assert.match(CSS_CODE, /\.nv-print-sheet \.nv-print-pos \{\s*color: #1a6630 !important;/)
    assert.match(CSS_CODE, /\.nv-print-sheet \.nv-print-neg \{\s*color: #a34a3d !important;/)
    assert.match(CSS_CODE, /\.nv-print-sheet \.nv-print-evo path \{\s*stroke: #004a64 !important;/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §§ 2-8, 32 · THE COMPACTED PERSONAL UPPER PAGE
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F3 §§ 2-8 · the personal upper composition', () => {
  test('Performance moves INTO the analytical row on a personal scope', () => {
    // Before: a standalone full-width Performance card, then a separate
    // Snapshot | Allocation row — two wide rows for seven figures and a donut.
    // After: one row. The standalone card is Main's alone; personal renders
    // the same component `frameless` as the row's first column.
    assert.match(CODE, /\{showNotes && \(\s*\n\s*<PerformanceMarketsStrip/)
    assert.match(CODE, /\{!showNotes && \([\s\S]{0,400}?<PerformanceMarketsStrip\s*\n\s*frameless/)
    // Exactly two call sites, mutually exclusive on one boolean — a personal
    // scope can never render both, and Main can never render the frameless one.
    assert.equal((CODE.match(/<PerformanceMarketsStrip/g) ?? []).length, 2)
    assert.match(CODE, /const showNotes = activeScope !== null && scopeHasWeeklyNotes\(activeScope\)/)
  })

  test('one boolean drives the whole composition — the scopes cannot disagree', () => {
    // Grid template, Performance column and Notes column are all keyed to
    // `showNotes`, so there is no second source of truth to fall out of step.
    assert.equal(scopeHasWeeklyNotes('main'), true)
    for (const scope of ['jaime', 'andres', 'pablo']) {
      assert.equal(scopeHasWeeklyNotes(scope), false, scope)
    }
    const branchless = CODE.replace(/showNotes/g, '')
    assert.ok(!/activeScope === 'jaime'|activeScope === 'andres'|activeScope === 'pablo'/.test(branchless))
  })

  test('Jaime, Andrés and Pablo get the IDENTICAL structural contract', () => {
    // Nothing in the composition names a personal scope, so the three cannot
    // diverge: they are the three inputs for which `scopeHasWeeklyNotes` is
    // false, and every layout decision reads only that.
    const personalScopes = ['jaime', 'andres', 'pablo']
    const shapes = personalScopes.map((s) => JSON.stringify({
      notes: scopeHasWeeklyNotes(s),
      // the same two composition branches follow from it
      performanceInRow: !scopeHasWeeklyNotes(s),
      notesColumn: scopeHasWeeklyNotes(s),
    }))
    assert.equal(new Set(shapes).size, 1)
    assert.equal(shapes[0], JSON.stringify({ notes: false, performanceInRow: true, notesColumn: false }))
  })

  test('the frameless path is the same data through the same primitives', () => {
    const frameless = STRIP_CODE.slice(STRIP_CODE.indexOf('if (frameless) {'), STRIP_CODE.indexOf('return (\n    <GlassSurface'))
    // Same groups, same masked flag, same lead scale — nothing reformatted,
    // nothing dropped, no metric invented for the narrower column.
    for (const g of ['portfolioPrimary', 'marketsPrimary', 'portfolioSecondary', 'marketsSecondary']) {
      assert.match(frameless, new RegExp(`groups=\\{${g}\\}`), g)
    }
    assert.match(frameless, /<GroupStack groups=\{portfolioPrimary\} lead masked=\{masked\} \/>/)
    assert.match(frameless, /<GroupStack groups=\{portfolioSecondary\} lead=\{false\} masked=\{masked\} \/>/)
    assert.match(frameless, /\{sectionTitle\}/)
    assert.match(frameless, /\{portfolioLabel\}/)
    assert.match(frameless, /\{marketsLabel\}/)
    // No card chrome, and it fills its column the way its siblings do.
    assert.ok(!/GlassSurface/.test(frameless))
    assert.match(frameless, /className="flex-1 flex flex-col min-w-0 px-5 sm:px-6 pt-4"/)
  })

  test('Markets stays adjacent to the weekly portfolio metrics', () => {
    // The owner's earlier complaint was Markets floating away from the figures
    // it exists to be compared against. In the column they are one hairline
    // apart, and each group keeps its own explicit sub-heading.
    const frameless = STRIP_CODE.slice(STRIP_CODE.indexOf('if (frameless) {'), STRIP_CODE.indexOf('return (\n    <GlassSurface'))
    const portfolioAt = frameless.indexOf('{portfolioLabel}')
    const marketsAt = frameless.indexOf('{marketsLabel}')
    assert.ok(portfolioAt > 0 && marketsAt > portfolioAt, 'portfolio group must precede markets')
    assert.ok(frameless.slice(portfolioAt, marketsAt).includes('border-t'))
    // YTD + Net Flows read as supporting: below, behind their own rule, at the
    // non-lead scale.
    assert.match(frameless, /\{hasSecondary && \([\s\S]{0,120}?border-t/)
  })

  test('Main\'s Performance card is byte-for-byte the pre-pass one', () => {
    // The frameless branch returns early, so Main reaches the ORIGINAL render
    // unchanged — including the alignment mechanism added last pass.
    assert.match(STRIP_CODE, /frameless = false/)
    assert.match(STRIP_CODE, /if \(frameless\) \{/)
    const mainPath = STRIP_CODE.slice(STRIP_CODE.indexOf('return (\n    <GlassSurface'))
    assert.match(mainPath, /<GlassSurface variant="card" className="flex flex-col">/)
    assert.match(mainPath, /reserveTitleRow=\{!portfolioPrimaryTitled && marketsPrimaryTitled\}/)
    assert.match(mainPath, /reserveTitleRow=\{!marketsPrimaryTitled && portfolioPrimaryTitled\}/)
    assert.match(mainPath, /lg:grid-cols-\[minmax\(0,auto\)_minmax\(0,auto\)_minmax\(0,1fr\)\]/)
    // …and the frameless path deliberately does NOT invoke it (a stacked
    // column has no sibling to baseline against).
    const frameless = STRIP_CODE.slice(STRIP_CODE.indexOf('if (frameless) {'), STRIP_CODE.indexOf('return (\n    <GlassSurface'))
    assert.ok(!/reserveTitleRow/.test(frameless))
  })

  test('Allocation stays donut-left / legend-right and the donut is not shrunk', () => {
    assert.match(PANEL_CODE, /size=\{208\}/)
    const svgAt = DONUT_CODE.indexOf('<svg')
    const legendAt = DONUT_CODE.indexOf('settings.legendVisible && (')
    assert.ok(svgAt > 0 && legendAt > svgAt, 'the ring must be authored before the legend')
    assert.ok(!/flex-row-reverse|order-\[?-?\d/.test(DONUT_CODE))
    // The stretched dotted leader is gone from what renders: it lives only in
    // `spread`, and nothing opts into `wide` any more.
    assert.match(DONUT_CODE, /const spread = layout === 'wide' && settings\.legendVisible/)
    assert.ok(!/layout=(?:"wide"|\{['"]wide['"]\})/.test(CODE))
    assert.match(DONUT_CODE, /'flex flex-col gap-1\.5 min-w-0 basis-\[11rem\] grow max-w-\[18rem\]'/)
  })

  test('the personal page keeps exactly its five regions, in order', () => {
    // Performance · Snapshot · Allocation · Weekly Close by Line · Evolution.
    // Nothing added as filler, nothing dropped, and the two lower regions now
    // follow ONE upper row instead of two.
    const analyticalAt = CODE.indexOf('xl:grid-cols-[minmax(0,4fr)_minmax(0,3fr)_minmax(0,5fr)]')
    const closeAt = CODE.indexOf('<HierarchicalTable')
    const evolutionAt = CODE.indexOf('<PortfolioEvolutionChart')
    assert.ok(analyticalAt > 0, 'the personal analytical row must exist')
    assert.ok(closeAt > analyticalAt, 'weekly close by line follows the analytical row')
    assert.ok(evolutionAt > closeAt, 'evolution follows weekly close by line')
    // The standalone Performance card is the only region that moved, and it
    // moved INTO the row rather than being deleted.
    assert.ok(CODE.indexOf('{showNotes && (\n              <PerformanceMarketsStrip') < analyticalAt)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §§ 9-16, 33 · THE WIDENED INTERACTION CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F3 §§ 9-14 · hover reaches navigation', () => {
  const RAILS = [
    'src/components/layout/PrimaryNav.tsx',
    'src/components/layout/SecondaryNav.tsx',
    'src/components/familyPortfolio/FamilyPortfolioNav.tsx',
  ]

  test('the rails are anchors inside a <nav> — the reason the old rule missed them', () => {
    for (const file of RAILS) {
      const src = read(file)
      assert.match(src, /<nav/, file)
      assert.match(src, /<Link/, file)
      // No rail is a <button>, which is why a button-only selector reached none.
      assert.ok(!/<button[\s\S]{0,200}?href/.test(src), file)
    }
  })

  test('the shared rule now covers nav anchors, in all three of its clauses', () => {
    // cursor, transition and the lift itself — a rule that covered only one of
    // the three would produce a control that moves without easing, or eases
    // without moving.
    assert.match(CSS_CODE, /nav a:not\(\[aria-disabled='true'\]\) \{\s*cursor: pointer;/)
    assert.match(CSS_CODE, /nav a:not\(\[aria-disabled='true'\]\):not\(\.nv-transition-state\) \{\s*\n?\s*transition-property: transform,/)
    assert.match(CSS_CODE, /nav a:not\(\[aria-disabled='true'\]\):hover \{\s*\n?\s*transform: translateY\(-1px\);/)
  })

  test('it is `nav a` — NOT every anchor in the application', () => {
    // An inline hyperlink in prose, a table cell or a footnote must not lift.
    // The discriminator is the <nav> element, which already means navigation.
    // Every anchor clause in the interaction rule must be qualified by `nav `.
    for (const clause of CSS_CODE.match(/(?:^|[\s,>])(?:nav )?a(?::not\(\[aria-disabled='true'\]\)|:hover|\[aria-current\])/gm) ?? []) {
      assert.match(clause.trim(), /^(nav a|>\s*a\[aria-current\]|a\[aria-current\])/, `unqualified anchor selector: ${clause.trim()}`)
    }
    // No bare `a { … }` or `a:hover { … }` block anywhere.
    assert.ok(!/(^|[\s,])a:hover \{/m.test(CSS_CODE.replace(/nav a:hover/g, 'NAVLINK')))
    // Spot-check a genuinely inline link elsewhere in the app: it is not in a nav.
    const topbar = read('src/components/layout/TopBar.tsx')
    assert.match(topbar, /<a href="\/logout"/)
    const logoutAt = topbar.indexOf('<a href="/logout"')
    assert.ok(!topbar.slice(0, logoutAt).includes('<nav'), 'the logout link must not sit inside a nav')
  })

  test('the CURRENT rail item does not peel off its sliding indicator', () => {
    assert.match(CSS_CODE, /:has\(> \.nv-indicator\) > a\[aria-current\]:hover/)
    for (const file of RAILS) {
      const src = read(file)
      // Same structure in every rail: indicator span and links are siblings
      // under one <nav>, and the active link is marked aria-current.
      assert.match(src, /className="absolute[^"]*nv-indicator"/, file)
      assert.match(src, /aria-current=\{active \? 'page' : undefined\}/, file)
    }
  })

  test('inactive rail items still respond, and route behaviour is untouched', () => {
    // The exception is keyed to `[aria-current]`, which only the active item
    // carries — so every other item in the rail still lifts.
    const exception = CSS_CODE.slice(CSS_CODE.indexOf(":has(> .nv-indicator) > a[aria-current]:hover"))
    assert.match(exception.slice(0, 120), /\{\s*transform: none;\s*\}/)
    for (const file of RAILS) {
      assert.match(read(file), /href=\{(item|group|child)\.href\}/, file)
    }
  })

  test('navigation ENTITLEMENT is unchanged — styling grants nothing', () => {
    // Admin appears only for an administrator, and every rail is still built
    // from the server-filtered entitlement, not from what CSS can reach.
    const fpNav = read('src/components/familyPortfolio/FamilyPortfolioNav.tsx')
    assert.match(fpNav, /if \(isAdministrator\) \{[\s\S]{0,160}?key: 'admin'/)
    assert.match(fpNav, /const \{ status, scopes, isAdministrator \} = useFamilyPortfolio\(\)/)
    assert.match(fpNav, /if \(status !== 'ready' \|\| items\.length === 0\) return null/)
    assert.ok(!/nav a/.test(fpNav), 'the rail must not carry its own interaction styling')
  })

  test('the scope selector keeps its R13.R2F2 behaviour', () => {
    const seg = read('src/components/fable/SegmentedControl.tsx')
    assert.match(CSS_CODE, /button\[role='radio'\]\[aria-checked='true'\]:hover/)
    assert.match(seg, /role="radio"/)
    assert.match(seg, /disabled:opacity-40 disabled:cursor-not-allowed/)
    assert.ok(!/hover:-translate-y|cursor-pointer/.test(seg))
  })

  test('disabled stays excluded across the widened contract', () => {
    for (const clause of [
      /nav a:not\(\[aria-disabled='true'\]\) \{\s*cursor: pointer/,
      /nav a:not\(\[aria-disabled='true'\]\):hover/,
    ]) {
      assert.match(CSS_CODE, clause)
    }
    assert.match(CSS_CODE, /button:not\(:disabled\):not\(\[aria-disabled='true'\]\)/)
    // § 30's named case: Add Note while the notes schema is unapplied. It is
    // rendered VISIBLE and disabled (the capability exists, the store does
    // not), so it is exactly the control that must not gain an affordance.
    const notes = read('src/components/familyPortfolio/WeeklyNotesPanel.tsx')
    assert.match(notes, /disabled=\{blocked\}/)
    assert.match(notes, /disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent/)
  })

  test('reduced motion, touch and print all still neutralise the widened set', () => {
    const rm = CSS_CODE.slice(CSS_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    assert.match(rm.slice(0, rm.indexOf('\n}\n')), /button:hover, \[role='button'\]:hover, nav a:hover \{\s*transform: none !important;/)
    const hoverBlock = CSS_CODE.slice(CSS_CODE.indexOf('@media (hover: hover)'), CSS_CODE.indexOf('.nv-pop'))
    assert.match(hoverBlock, /nav a:not\(\[aria-disabled='true'\]\):hover/)
    assert.ok(!/transform: translateY\(-1px\)/.test(CSS_CODE.replace(hoverBlock, '')))
    const print = CSS_CODE.slice(CSS_CODE.indexOf('@media print {'))
    assert.match(print, /button, \[role='button'\], nav a \{\s*transform: none !important;\s*transition: none !important;\s*\}/)
  })

  test('keyboard focus remains independent of hover', () => {
    assert.match(CSS_CODE, /:focus-visible \{\s*outline: 2px solid var\(--focus\);/)
    const hoverBlock = CSS_CODE.slice(CSS_CODE.indexOf('@media (hover: hover)'), CSS_CODE.indexOf('.nv-pop'))
    assert.ok(!/outline/.test(hoverBlock))
  })
})
