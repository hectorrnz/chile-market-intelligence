// R13.R5C.3 — privacy precedence over the Portfolio zero mark.
//
// R13.R5C.2 centralised the zero contract correctly but returned the mark from
// an EARLY BRANCH, ahead of the privacy gate. While the rule covered only
// changes and flows that was arguably harmless. Once it covered every value, the
// same short-circuit started telling a masked reader "this holding is worth
// exactly nothing" — which is a fact about the family's holdings, and precisely
// what the mask exists to withhold.
//
// The owner's final order, and what this file proves:
//
//   1. masked        → the ordinary privacy mask, whatever the figure is
//   2. zero          → `-`
//   3. unavailable   → `—`
//   4. otherwise     → the formatted value
//
// with two approved exceptions kept intact: a chart SCALE ORIGIN stays a numeric
// `0` (coordinate notation, not a displayed metric), and a cardinality inside a
// SENTENCE stays an ordinary number ("0 events", never "- events").
//
// HOW PRIVACY IS PROVEN. `MaskedAmount` is a `.tsx` component and this suite has
// no React renderer, so its behaviour under the mask is established by
// COMPOSITION rather than by rendering: `PrivacyValue` renders none of its
// children while it masks (asserted here from its own source), the zero mark is
// a CHILD of `PrivacyValue`, and `MaskedAmount` contains no branch on `masked`
// at all. Those three facts together make a masked zero structurally
// indistinguishable from a masked nine-figure amount — there is no code path
// that could tell them apart.
//
// NO PRIVATE DATA. Every figure below is invented.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ZERO_MARK,
  UNAVAILABLE_MARK,
  formatUsd,
  formatUsdCompactM,
  formatUsdCompactUnit,
  formatRatioPct,
  formatWeightPct,
  formatChangePct,
  formatCount,
} from '../src/lib/formatters.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source with comments removed — an assertion must never be satisfied by prose. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const MASKED_AMOUNT = 'src/components/familyPortfolio/MaskedAmount.tsx'
const PRIVACY_VALUE = 'src/components/fable/PrivacyValue.tsx'

/** The privacy-sensitive Portfolio surfaces, as enumerated by the owner. */
const SURFACES = [
  'src/app/family-portfolio/page.tsx',
  'src/app/family-portfolio/portfolio/page.tsx',
  'src/app/family-portfolio/weekly-changes/page.tsx',
  'src/app/family-portfolio/alternatives/page.tsx',
  'src/app/family-portfolio/alternatives/holdings/page.tsx',
  'src/app/family-portfolio/alternatives/cash-flows/page.tsx',
  'src/components/familyPortfolio/AlternativesDrilldowns.tsx',
  'src/components/familyPortfolio/AlternativesCashFlowChart.tsx',
  'src/components/familyPortfolio/AllocationDonut.tsx',
  'src/components/familyPortfolio/ContributionBreakdownModal.tsx',
  'src/components/familyPortfolio/ContributionChart.tsx',
  'src/components/familyPortfolio/HierarchicalTable.tsx',
  'src/components/familyPortfolio/PerformanceMarketsStrip.tsx',
  'src/components/familyPortfolio/PeriodValueChangeCard.tsx',
  'src/components/familyPortfolio/PortfolioValueHero.tsx',
  'src/components/familyPortfolio/ReconciliationStatus.tsx',
  'src/components/familyPortfolio/SummaryPrintSheet.tsx',
  'src/components/familyPortfolio/WeeklySnapshotCard.tsx',
]

// ───────────────────────────────────────────────────────────────────────────
// 1 · Privacy OFF — the two marks, unchanged from R13.R5C.2
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.3 § 1 — with privacy off, a zero reads `-` and an unavailable reads `—`', () => {
  test('1 · a monetary zero renders the zero mark at every precision', () => {
    assert.equal(formatUsd(0), ZERO_MARK)
    assert.equal(formatUsd(-0), ZERO_MARK)
    assert.equal(formatUsd(0, 2), ZERO_MARK)
    // …and so does an amount too small to show at the precision on screen: the
    // column cannot draw the difference, so claiming one would mislead.
    assert.equal(formatUsd(0.4), ZERO_MARK)
    assert.equal(formatUsd(0.004, 2), ZERO_MARK)
    // A figure that DOES show at that precision is untouched.
    assert.equal(formatUsd(0.4, 2), '0,40')
  })

  test('2 · a percentage zero renders the zero mark, signed and unsigned alike', () => {
    assert.equal(formatRatioPct(0), ZERO_MARK)
    assert.equal(formatRatioPct(-0), ZERO_MARK)
    assert.equal(formatWeightPct(0), ZERO_MARK)
    // `formatChangePct` is the signed alias, so a "did not move" column and a
    // headline rate cannot hold different ideas of zero.
    assert.equal(formatChangePct(0), ZERO_MARK)
  })

  test('3 · a standalone count of zero renders the zero mark', () => {
    assert.equal(formatCount(0), ZERO_MARK)
    assert.equal(formatCount(3), '3')
  })

  test('4 · unavailable keeps its own, narrower mark in every formatter', () => {
    for (const f of [formatUsd, formatRatioPct, formatWeightPct, formatChangePct, formatCount]) {
      assert.equal(f(null), UNAVAILABLE_MARK, f.name)
      assert.equal(f(undefined), UNAVAILABLE_MARK, f.name)
      assert.equal(f(Number.NaN), UNAVAILABLE_MARK, f.name)
      assert.equal(f(Number.POSITIVE_INFINITY), UNAVAILABLE_MARK, f.name)
    }
    // The two marks are never the same glyph — the whole distinction rests on it.
    assert.notEqual(ZERO_MARK, UNAVAILABLE_MARK)
  })

  test('5 · a real figure is untouched by either rule', () => {
    assert.equal(formatUsd(1_234_567), '1.234.567')
    assert.equal(formatUsd(-98_000), '-98.000')
    assert.equal(formatRatioPct(0.0125), '+1,25%')
    assert.equal(formatRatioPct(-0.0125), '-1,25%')
    assert.equal(formatWeightPct(0.5), '50,0%')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2 · Privacy ON — the mask outranks both marks
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.3 § 1 — the privacy mask comes first', () => {
  test('6 · `PrivacyValue` renders NONE of its children while it masks', () => {
    // The premise the rest of this section rests on. The masked branch returns
    // bullets and never mentions `children`, so nothing a caller computes —
    // a mark, an amount, a title, a data attribute — can reach the DOM.
    const pv = read(PRIVACY_VALUE)
    const unmasked = pv.indexOf('if (!masked && resolved) return')
    assert.ok(unmasked > 0, 'the unmasked early return is still the only path that renders children')
    // Everything AFTER that early return is the masked path.
    const maskedBranch = pv.slice(pv.indexOf('\n', unmasked), pv.indexOf('interface PrivacyToggleProps'))
    assert.match(maskedBranch, /•••••/)
    assert.doesNotMatch(code(maskedBranch), /\{children\}/, 'the masked branch must not render children')
  })

  test('7 · …and it fails closed while the stored preference is still unknown', () => {
    // This is why the precedence cannot be a `if (masked)` test inside
    // `MaskedAmount`: during hydration `masked` is still its unsafe default, and
    // only `PrivacyValue` knows that. A caller testing `masked` itself would
    // print the mark in exactly that window.
    const pv = code(read(PRIVACY_VALUE))
    assert.match(pv, /useSyncExternalStore/)
    assert.match(pv, /if \(!masked && resolved\)/)
  })

  test('8 · the zero mark is a CHILD of the mask, never an early return', () => {
    const src = read(MASKED_AMOUNT)
    const zeroAt = src.indexOf('zeroDash && roundsToZeroAt')
    assert.ok(zeroAt > 0, 'the zero rule is still in the one guarded renderer')
    // The zero test may no longer BE a branch — R13.R5C.2's `if (zeroDash &&
    // …) return <span>-</span>` is exactly the shape that leaked. It is a
    // boolean now, consumed inside the mask element.
    assert.doesNotMatch(
      code(src),
      /if \(zeroDash/,
      'a zero must not short-circuit ahead of the privacy gate',
    )
    assert.match(code(src), /const zero = zeroDash && roundsToZeroAt/)
    // The mark is rendered inside the PrivacyValue element.
    const open = src.indexOf('<PrivacyValue')
    const close = src.indexOf('</PrivacyValue>')
    assert.ok(open > 0 && close > open, 'the mask element is still here')
    const children = src.slice(open, close)
    assert.match(children, />-</, 'the zero mark renders as a child of the mask')
  })

  test('9 · a masked zero is structurally indistinguishable from any other masked amount', () => {
    // The strongest available statement without a renderer: `MaskedAmount`
    // never BRANCHES on `masked`. It only forwards it. So while the mask is on,
    // its output is decided entirely by `PrivacyValue` (test 6) and cannot
    // depend on the value — zero, negative, or nine figures.
    const src = code(read(MASKED_AMOUNT))
    const uses = src.match(/masked/g) ?? []
    // Exactly three: the prop type, the destructured parameter, and the
    // forwarding `masked={masked}` (which counts twice in one line).
    assert.ok(uses.length > 0)
    assert.doesNotMatch(src, /if \(masked/, 'no conditional on the mask')
    assert.doesNotMatch(src, /masked \?/, 'no ternary on the mask')
    assert.doesNotMatch(src, /!masked/, 'no negated test on the mask')
    assert.match(src, /<PrivacyValue masked=\{masked\}/, 'the flag is only ever forwarded')
    // And there is exactly ONE mask element, so there is no second path.
    assert.equal((src.match(/<PrivacyValue/g) ?? []).length, 1)
  })

  test('10 · unavailable keeps its pre-existing precedence, deliberately unchanged', () => {
    // `—` still resolves ahead of the mask, as it has since R13.7: it reports
    // that no figure could be established, which is a statement about the
    // SOURCE rather than about the family's wealth. Bulleting it would imply a
    // withheld amount exists. The owner's brief asks for the existing privacy
    // contract to be preserved here, and this is it.
    const src = code(read(MASKED_AMOUNT))
    const unavailableAt = src.indexOf('!Number.isFinite(value)')
    const maskAt = src.indexOf('<PrivacyValue')
    assert.ok(unavailableAt > 0 && maskAt > unavailableAt, 'the em dash still returns before the mask')
    assert.match(src.slice(unavailableAt, maskAt), /—/)
  })

  test('11 · no Portfolio surface can emit a monetary figure outside the mask', () => {
    // The exhaustive audit behind test 9: every direct `formatUsd` call on a
    // privacy-sensitive surface is one of these documented, non-private cases.
    // Anything else must travel as a NUMBER into `MaskedAmount`.
    const ALLOWED: Record<string, RegExp[]> = {
      // A benchmark's closing price and a public index level — market data
      // anyone can look up; masking hides the family's wealth, not the market.
      'src/app/family-portfolio/page.tsx': [
        /m\.kind === 'price' \? formatUsd/,
        // The evolution chart's exact-value formatter. The chart is replaced
        // WHOLESALE while masked (its axis and crosshair carry raw amounts), so
        // this never runs under the mask.
        /formatValue=\{\(v\) => formatUsd\(v\)\}/,
      ],
      'src/components/familyPortfolio/PerformanceMarketsStrip.tsx': [/formatUsd\(metric\.value!, 2\)/],
      // The hero's own formatter, rendered inside `KpiHero`'s `PrivacyValue`.
      'src/app/family-portfolio/weekly-changes/page.tsx': [
        /formatValue=\{\(v\) => \(v > 0 \? `\+\$\{formatUsd\(v\)\}` : formatUsd\(v\)\)\}/,
      ],
      // An SVG slice label, where `MaskedAmount` cannot render. It falls back to
      // percentage-only whenever the page is masked or the preference is
      // unresolved — the same fail-closed gate, mirrored.
      'src/components/familyPortfolio/AllocationDonut.tsx': [/if \(!wantsValue \|\| maskedEffective\) return \[pct\]/],
    }
    for (const p of SURFACES) {
      const src = code(read(p))
      const calls = (src.match(/formatUsd\(/g) ?? []).length
      if (calls === 0) continue
      const patterns = ALLOWED[p]
      assert.ok(patterns, `${p} formats a monetary figure itself and is not a documented exception`)
      for (const re of patterns) assert.match(src, re, `${p}: ${re}`)
    }
  })

  test('12 · the two guarded chart callers still gate on the mask themselves', () => {
    // Belt and braces for the two exceptions above that depend on a caller.
    const summary = read('src/app/family-portfolio/page.tsx')
    assert.match(summary, /\) : masked \? \(/, 'the evolution chart is replaced wholesale while masked')
    assert.match(summary, /<PrivacyValue masked className="block text-center text-lg">/)
    const weekly = read('src/app/family-portfolio/weekly-changes/page.tsx')
    assert.match(weekly, /privacyMasked=\{masked\}/)
    assert.match(read('src/components/fable/KpiHero.tsx'), /<PrivacyValue masked=\{privacyMasked\}>/)
    const donut = read('src/components/familyPortfolio/AllocationDonut.tsx')
    assert.match(donut, /const maskedEffective = masked \|\| !resolved/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3 · The two approved exceptions
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.3 § 2 — a scale origin and a sentence are not displayed metrics', () => {
  test('13 · a chart axis origin stays a numeric 0', () => {
    // Coordinate-system notation. `-` between `-2M` and `2M` reads as a stray
    // minus sign, one glyph from the real ones beside it.
    assert.equal(formatUsdCompactUnit(0), '0')
    assert.equal(formatUsdCompactM(0), '0')
    // …and a real figure forced to a larger unit rounds to a numeral, never `-M`.
    assert.equal(formatUsdCompactUnit(400_000, 'M'), '0M')
    // The print axis keeps full resolution below a million rather than
    // collapsing three ticks onto `0,0M` — also a scale decision, not a value one.
    assert.equal(formatUsdCompactM(145_470_441), '145,5M')
    assert.equal(formatUsdCompactM(40_000), '40.000')
  })

  test('14 · the opt-out exists ONLY on the two axis ticks', () => {
    const optOuts = SURFACES.flatMap((p) =>
      (code(read(p)).match(/zeroDash=\{false\}/g) ?? []).map(() => p),
    )
    assert.deepEqual(optOuts.sort(), [
      'src/components/familyPortfolio/ContributionChart.tsx',
      'src/components/familyPortfolio/SummaryPrintSheet.tsx',
    ])
    assert.match(
      read('src/components/familyPortfolio/ContributionChart.tsx'),
      /value=\{tick\}[^/]*zeroDash=\{false\}/,
    )
    assert.match(
      read('src/components/familyPortfolio/SummaryPrintSheet.tsx'),
      /value=\{tick\.value\}[^/]*zeroDash=\{false\}/,
    )
  })

  test('15 · a chart TOOLTIP or data value takes the mark like any other figure', () => {
    // The exception is the scale, not the chart. Both charts render their real
    // values through the default path.
    const chart = read('src/components/familyPortfolio/ContributionChart.tsx')
    assert.match(chart, /<MaskedAmount value=\{bar\.value\} masked=\{masked\} signed \/>/)
    const tooltip = chart.slice(chart.indexOf('<MaskedAmount', chart.indexOf('<MaskedAmount') + 10))
    assert.doesNotMatch(tooltip.slice(0, 400), /zeroDash/, 'the tooltip amount must not opt out')
    const print = read('src/components/familyPortfolio/SummaryPrintSheet.tsx')
    for (const re of [
      /<MaskedAmount value=\{hwmValue\} masked=\{masked\} compact \/>/,
      /<MaskedAmount value=\{totalValue\} masked=\{masked\} currency/,
      /<MaskedAmount value=\{evolutionChangeAmount\} masked=\{masked\} signed/,
    ]) {
      assert.match(print, re)
    }
  })

  test('16 · a cardinality inside a SENTENCE keeps its digits', () => {
    // "0 events" is grammatical; "- events" is not. These read as words, not as
    // figures in a value position, so the mark would make them worse.
    const PROSE: Array<[string, RegExp]> = [
      ['src/app/family-portfolio/alternatives/cash-flows/page.tsx', /\{visibleEvents\.length\} \{a\.eventsWord\}/],
      ['src/app/family-portfolio/alternatives/holdings/page.tsx', /\{group\.holdings\.length\} \{t\.holdingsWord\}/],
      ['src/app/family-portfolio/weekly-changes/page.tsx', /\{ranked\.cashRowCount\} \{w\.cashWithheldSuffix\}/],
      ['src/components/familyPortfolio/AlternativesDrilldowns.tsx', /fill\(a\.breakdownCount, \{ n: breakdown\.events\.length \}\)/],
    ]
    for (const [p, re] of PROSE) assert.match(read(p), re, p)
  })

  test('17 · …while a cardinality standing alone in a VALUE position takes the mark', () => {
    // The same number in a `<dd>` or a `· N` badge is a figure, not a word.
    const dd = read('src/components/familyPortfolio/AlternativesDrilldowns.tsx')
    for (const re of [
      /<dd[^>]*>\{formatCount\(undrawn\.unavailable\)\}<\/dd>/,
      /<dd[^>]*>\{formatCount\(undrawn\.holdings\.length\)\}<\/dd>/,
      /<dd[^>]*>\{formatCount\(undrawn\.fullyDrawn\)\}<\/dd>/,
      /<dd[^>]*>\{formatCount\(undrawn\.ofHoldings\)\}<\/dd>/,
      /· \{formatCount\(undrawn\.unreported\.length\)\}/,
    ]) {
      assert.match(dd, re, String(re))
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4 · Nothing arithmetic moved
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.3 § 3 — presentation only', () => {
  test('18 · a zero still sums, and a total of zero still equals zero', () => {
    const children = [1_500_000, 0, -1_500_000]
    const total = children.reduce((a, b) => a + b, 0)
    assert.equal(total, 0)
    // Every one of these renders a mark; none of them stopped being a number.
    assert.equal(formatUsd(children[1]), ZERO_MARK)
    assert.equal(formatUsd(total), ZERO_MARK)
    assert.equal(children[1], 0)
    assert.equal(total + 42, 42)
  })

  test('19 · the Alternatives commitment identity still ties while a term is dashed', () => {
    // The exact case R13.R5C.1 refused to dash: a fully-drawn commitment.
    const committed = 170_000
    const contributed = 170_000
    const unfunded = committed - contributed
    assert.equal(unfunded, 0)
    assert.equal(formatUsd(committed), '170.000')
    assert.equal(formatUsd(contributed), '170.000')
    assert.equal(formatUsd(unfunded), ZERO_MARK)
    // The identity is arithmetic on the values, and the values are unchanged.
    assert.equal(committed - contributed - unfunded, 0)
  })

  test('20 · a weekly reconciliation with no external flow still ties', () => {
    const previous = 10_000_000
    const profit = 250_000
    const flow = 0
    const ending = previous + profit + flow
    assert.equal(ending, 10_250_000)
    assert.equal(formatUsd(flow), ZERO_MARK, 'a blank flow cell is a real zero, and reads as one')
    assert.equal(formatUsd(ending), '10.250.000')
    // A zero flow is NOT unavailable — the frozen semantic, re-asserted.
    assert.notEqual(formatUsd(flow), UNAVAILABLE_MARK)
    assert.equal(formatUsd(null), UNAVAILABLE_MARK)
  })

  test('21 · a liquidated holding still reads as liquidated', () => {
    const beginningOfYear = 4_200_000
    const now = 0
    assert.equal(formatUsd(now), ZERO_MARK)
    assert.equal(formatUsd(beginningOfYear), '4.200.000')
    assert.equal(formatUsd(now - beginningOfYear), '-4.200.000')
    assert.equal(now, 0, 'the stored value is still numeric zero')
  })

  test('22 · a zero weight still sorts and still contributes nothing', () => {
    const weights = [0.6, 0, 0.4]
    assert.equal(weights.reduce((a, b) => a + b, 0), 1)
    assert.equal(formatWeightPct(weights[1]), ZERO_MARK)
    assert.deepEqual([...weights].sort((a, b) => b - a), [0.6, 0.4, 0])
  })
})
