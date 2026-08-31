// R13.R2 OWNER-REVIEW PASS 1 § 31 — behavioural tests for the owner-review changes.
//
// The three subjects that carry real risk in this pass, and how each is tested:
//
//   * PALETTE DISTINGUISHABILITY. The owner's requirement is that two colours
//     shown at the same time are distinguishable BEFORE the reader interacts
//     with the chart. That is not testable by eye, so it is MEASURED: every
//     palette is audited in OKLab in BOTH themes, and the floors are asserted.
//     These tests are what stop a future "tidy-up" from quietly reintroducing
//     two near-identical neighbours.
//   * HIGH WATER MARKET. Both halves matter — the SEMANTIC (a real observed
//     maximum, never interpolated) and the VISIBILITY RULES (§ 18). Both are
//     pure functions here, so the chart, the settings dialog and the page
//     cannot drift apart from them.
//   * INRETAIL. § 6 required the semantics be PROVEN before the presentation
//     moved. The proof was run against the live book; what is enforceable here
//     is the consequence — it is out of the snapshot arithmetic block, and the
//     inclusion is stated in words in both languages.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import {
  auditPalette,
  contrastRatio,
  deltaE,
  hueSeparation,
  slotDistance,
  CARD_SURFACES,
  MIN_ADJACENT,
  MIN_ALL_PAIRS,
  MIN_SERIES_CONTRAST,
  MIN_SERIES_DELTA_E,
  MIN_SERIES_HUE_SEPARATION,
  MIN_SLICE_CONTRAST,
  type ThemedColor,
} from '../src/lib/familyPortfolio/paletteContrast.ts'
import {
  DEFAULT_REFERENCE_LINE_MODE,
  REFERENCE_LINE_MODES,
  highWaterMarket,
  isReferenceLineMode,
  shouldShowHighWaterMarket,
} from '../src/lib/familyPortfolio/highWaterMarket.ts'
import {
  ALLOCATION_PALETTES,
  DEFAULT_ALLOCATION_SETTINGS,
  PALETTE_TOKENS,
  normalizeStoredSettings,
  paletteTokenAt,
  validateAllocationSettings,
} from '../src/lib/familyPortfolio/allocationSettings.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CSS = read('src/app/globals.css')
const PAGE = read('src/app/portfolio/page.tsx')
const MIGRATION = read('supabase/migrations/20260812000000_family_portfolio_presentation_settings.sql')

/**
 * Resolves a `--token` to its light and dark hex from globals.css. Occurrence
 * order in that file is light-then-dark, which is the same assumption the
 * theme system itself makes.
 */
function themed(token: string): ThemedColor {
  const found = [...CSS.matchAll(new RegExp(`${token}:[ \\t]*(#[0-9A-Fa-f]{6})`, 'g'))].map((m) => m[1])
  assert.ok(found.length >= 2, `${token} must be declared in BOTH themes (found ${found.length})`)
  return { light: found[0], dark: found[1] }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Palette distinguishability (§§ 11-14) — measured, not asserted by eye
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 owner review § 11-14 — chart palettes are measurably distinguishable', () => {
  test('the perceptual metric behaves as a perceptual metric', () => {
    // The whole point of using OKLab rather than hex distance: these two are
    // far apart in RGB and nearly the same colour to the eye. If this ever
    // stops being true the metric has been broken, and every floor below
    // becomes meaningless.
    // Two dark teals must land BELOW the adjacency floor (they measure ~0.116)
    // and teal-vs-bronze far above it (~0.307). Stated against the enforced
    // threshold rather than an arbitrary number, so the illustration and the
    // rule cannot drift apart.
    assert.ok(deltaE('#004A64', '#0F6E6E') < MIN_ADJACENT, 'two dark teals must fail the adjacency floor')
    assert.ok(deltaE('#004A64', '#B07A12') > 2 * MIN_ADJACENT, 'teal vs bronze must measure as far apart')
    // Identical colours are distance zero — the degenerate case a wrapping
    // palette used to produce.
    assert.equal(deltaE('#004A64', '#004A64'), 0)
  })

  for (const palette of ALLOCATION_PALETTES) {
    test(`${palette}: every slot is declared in both themes, and there are twelve`, () => {
      const tokens = PALETTE_TOKENS[palette]
      assert.equal(tokens.length, 12, 'twelve slots — the largest real scope carries 12 constituents')
      assert.equal(new Set(tokens).size, 12, 'no token is reused within a palette')
      for (const token of tokens) themed(token) // asserts both themes exist
    })

    test(`${palette}: no two colours in the palette are near-identical, in EITHER theme`, () => {
      const slots = PALETTE_TOKENS[palette].map(themed)
      const audit = auditPalette(slots, CARD_SURFACES)
      assert.ok(
        audit.minAllPairs >= MIN_ALL_PAIRS,
        `worst pair is slots ${audit.worstPair[0] + 1}/${audit.worstPair[1] + 1} at ΔE ${audit.minAllPairs.toFixed(3)}, floor ${MIN_ALL_PAIRS}`,
      )
    })

    test(`${palette}: colours that TOUCH round the ring are strongly separated`, () => {
      // Adjacency is the owner's § 14 requirement — slices that sit next to
      // each other must be tellable apart immediately. The ring closes, so
      // slot 12 touching slot 1 counts.
      const slots = PALETTE_TOKENS[palette].map(themed)
      const audit = auditPalette(slots, CARD_SURFACES)
      assert.ok(
        audit.minAdjacent >= MIN_ADJACENT,
        `worst neighbours are slots ${audit.worstAdjacentPair[0] + 1}/${audit.worstAdjacentPair[1] + 1} at ΔE ${audit.minAdjacent.toFixed(3)}, floor ${MIN_ADJACENT}`,
      )
    })

    test(`${palette}: every slice is visible on its own card, in both themes`, () => {
      // A colour can be perfectly distinct from its neighbours and still be
      // invisible against the surface — three R13.7 tokens were, at ~1.45:1 on
      // the light card.
      const slots = PALETTE_TOKENS[palette].map(themed)
      const audit = auditPalette(slots, CARD_SURFACES)
      assert.ok(audit.minContrastLight >= MIN_SLICE_CONTRAST, `light ${audit.minContrastLight.toFixed(2)}:1`)
      assert.ok(audit.minContrastDark >= MIN_SLICE_CONTRAST, `dark ${audit.minContrastDark.toFixed(2)}:1`)
    })
  }

  test('a 12-constituent scope never repeats a colour — the wrap defect is gone', () => {
    // Measured on the live book: personal scopes carry up to 12 allocation
    // constituents. At eight tokens slices 1/9, 2/10, 3/11 and 4/12 rendered
    // in the IDENTICAL colour.
    for (const palette of ALLOCATION_PALETTES) {
      const assigned = Array.from({ length: 12 }, (_, i) => paletteTokenAt(palette, i))
      assert.equal(new Set(assigned).size, 12, `${palette} repeats a colour within 12 slices`)
    }
  })

  test('the two presets are not themselves practically indistinguishable (§ 12)', () => {
    // They draw on the same validated colours — the approved palette does not
    // contain two disjoint families — so what must differ is the SEQUENCE, and
    // therefore what a real 6-to-8-slice donut actually shows.
    const a = PALETTE_TOKENS.institutional.map(themed)
    const b = PALETTE_TOKENS.spectrum.map(themed)
    a.forEach((slot, i) => {
      const d = slotDistance(slot, b[i])
      assert.ok(
        d >= MIN_ADJACENT,
        `slot ${i + 1} is nearly the same colour in both presets (ΔE ${d.toFixed(3)}) — switching palette would barely change the chart`,
      )
    })
  })

  test('the withdrawn oceanic palette is gone from every layer', () => {
    assert.ok(!(ALLOCATION_PALETTES as readonly string[]).includes('oceanic'))
    assert.ok(!('oceanic' in PALETTE_TOKENS))
    assert.ok(!/--fp-oceanic-\d+:/.test(CSS), 'its tokens must not linger in globals.css')
    // And it is unstorable, not merely unlisted.
    assert.ok(/check \(palette in \('institutional','spectrum'\)\)/.test(MIGRATION))
    assert.equal(validateAllocationSettings({ ...DEFAULT_ALLOCATION_SETTINGS, palette: 'oceanic' }).ok, false)
  })

  test('the two Compare series are separated far beyond adjacency (§ 13)', () => {
    // The owner's sharpest colour requirement: Incl. vs Excl. must be tellable
    // apart at first glance, without hover, tooltip, legend or line weight.
    const incl = themed('--fp-series-incl')
    const excl = themed('--fp-series-excl')
    for (const theme of ['light', 'dark'] as const) {
      const d = deltaE(incl[theme], excl[theme])
      const hue = hueSeparation(incl[theme], excl[theme])
      assert.ok(d >= MIN_SERIES_DELTA_E, `${theme}: series ΔE ${d.toFixed(3)} below ${MIN_SERIES_DELTA_E}`)
      assert.ok(
        hue >= MIN_SERIES_HUE_SEPARATION,
        `${theme}: series hues only ${hue.toFixed(0)}° apart — they must be different colour FAMILIES`,
      )
      // And each must be a legible line on its own card.
      assert.ok(contrastRatio(incl[theme], CARD_SURFACES[theme]) >= MIN_SERIES_CONTRAST, `${theme} incl contrast`)
      assert.ok(contrastRatio(excl[theme], CARD_SURFACES[theme]) >= MIN_SERIES_CONTRAST, `${theme} excl contrast`)
    }
  })

  test('no identity colour is a signal token, and purple stays reserved', () => {
    const signals = ['#8B0E04', '#3EA464', '#7A68AE', '#B9ABE4', '#5E4B8B', '#56004E']
    const identity = [
      ...ALLOCATION_PALETTES.flatMap((p) => PALETTE_TOKENS[p]),
      '--fp-series-incl',
      '--fp-series-excl',
      '--fp-hwm',
    ].map(themed)
    for (const slot of identity) {
      for (const signal of signals) {
        assert.notEqual(slot.light.toUpperCase(), signal, 'a signal colour must not carry identity')
        assert.notEqual(slot.dark.toUpperCase(), signal)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · High Water Market (§§ 15-20)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 owner review § 16 — High Water Market is a real observed maximum', () => {
  const series = [
    { date: '2026-01-02', value: 100 },
    { date: '2026-01-09', value: 140 },
    { date: '2026-01-16', value: 120 },
    { date: '2026-01-23', value: 130 },
  ]

  test('returns the maximum, and a date that EXISTS in the series', () => {
    const hwm = highWaterMarket(series)
    assert.equal(hwm?.value, 140)
    assert.equal(hwm?.date, '2026-01-09')
    assert.ok(
      series.some((p) => p.date === hwm?.date && p.value === hwm?.value),
      'the reference must be one of the real observations — never an interpolated crest',
    )
  })

  test('never interpolates a higher value between two observations', () => {
    // A smoothed or fitted maximum could exceed every real reading. The
    // reference must never be a number the source never printed.
    const hwm = highWaterMarket(series)
    assert.ok(hwm !== null && hwm.value <= Math.max(...series.map((p) => p.value)))
  })

  test('a tie reports the EARLIEST attainment', () => {
    const tied = [
      { date: '2026-02-06', value: 200 },
      { date: '2026-02-13', value: 180 },
      { date: '2026-02-20', value: 200 },
    ]
    assert.equal(highWaterMarket(tied)?.date, '2026-02-06')
  })

  test('a non-finite observation is skipped, never treated as zero', () => {
    const gappy = [
      { date: '2026-03-06', value: Number.NaN },
      { date: '2026-03-13', value: 90 },
    ]
    const hwm = highWaterMarket(gappy)
    assert.equal(hwm?.value, 90)
    assert.equal(hwm?.date, '2026-03-13')
  })

  test('an empty or entirely unavailable series yields no reference at all', () => {
    assert.equal(highWaterMarket([]), null)
    assert.equal(highWaterMarket([{ date: '2026-04-03', value: Number.POSITIVE_INFINITY }]), null)
  })

  test('reports whether the high is the current observation', () => {
    assert.equal(highWaterMarket(series)?.isCurrent, false)
    assert.equal(highWaterMarket([...series, { date: '2026-01-30', value: 999 }])?.isCurrent, true)
  })

  test('the module consults no clock', () => {
    const src = read('src/lib/familyPortfolio/highWaterMarket.ts')
    assert.ok(!/Date\.now\(|new Date\(/.test(src), 'the reference must not depend on when it is viewed')
  })
})

describe('R13.R2 owner review § 18 — the owner-required visibility rules', () => {
  test('ALL + a single series shows it automatically', () => {
    assert.equal(shouldShowHighWaterMarket({ period: 'ALL', seriesCount: 1 }), true)
  })

  test('Compare hides it — two reference lines are clutter', () => {
    assert.equal(shouldShowHighWaterMarket({ period: 'ALL', seriesCount: 2 }), false)
  })

  test('windowed periods do NOT show it automatically', () => {
    for (const period of ['1M', '3M', 'YTD', '1Y']) {
      assert.equal(
        shouldShowHighWaterMarket({ period, seriesCount: 1 }),
        false,
        `${period} must not auto-show the reference`,
      )
    }
  })

  test('the administrator setting can hide it, but cannot contradict the rules above', () => {
    assert.equal(shouldShowHighWaterMarket({ period: 'ALL', seriesCount: 1, mode: 'hidden' }), false)
    // There is no mode that could force it into Compare.
    assert.deepEqual([...REFERENCE_LINE_MODES], ['auto', 'hidden'])
    assert.equal(isReferenceLineMode('always'), false)
    assert.equal(DEFAULT_REFERENCE_LINE_MODE, 'auto')
  })

  test('the page derives the reference from the observations ON SCREEN, and withholds it under the mask', () => {
    assert.ok(
      /shouldShowHighWaterMarket\(\{[\s\S]*?period: safePeriod,[\s\S]*?seriesCount: chartSeries\.length,[\s\S]*?mode: settings\.referenceLine,/.test(PAGE),
      'visibility must come from the shared helper, not a local re-implementation',
    )
    assert.ok(
      /hwmVisible && !masked \? highWaterMarket\(chartSeries\[0\]\?\.points/.test(PAGE),
      '§ 20 — the marker carries a raw amount and is withheld outright while masked',
    )
  })
})

describe('R13.R2 owner review §§ 15, 17 — the term and its explanation', () => {
  test('the visible English term is exactly the owner’s, and is not silently corrected', () => {
    assert.equal(dict.en.fp.overview.hwmLabel, 'High Water Market')
    for (const banned of ['High Water Mark', 'Peak Portfolio Value', 'Historical Peak Value']) {
      assert.notEqual(dict.en.fp.overview.hwmLabel, banned)
    }
    // "High Water Mark" must not appear as the label anywhere — the trailing
    // word is the whole point of the owner's instruction.
    assert.ok(!/High Water Mark\b(?!et)/.test(dict.en.fp.overview.hwmLabel))
  })

  test('the Spanish rendering is a deliberate choice, and the EXPLANATION is translated', () => {
    // The term of art stays in English on purpose (documented in i18n.ts); the
    // part a reader must understand is fully Spanish.
    assert.equal(dict.es.fp.overview.hwmLabel, 'High Water Market')
    assert.notEqual(dict.es.fp.overview.hwmTooltip, dict.en.fp.overview.hwmTooltip)
    // R13.R2E § 16 — the chart plots a DERIVED flow-adjusted path, so the
    // reference is the peak of THAT line. The explanation is realigned, never
    // dropped: it still says what the figure is, and it now rules out BOTH
    // misreadings — the actual AUM high and a return high-water mark.
    assert.ok(/nivel más alto/i.test(dict.es.fp.overview.hwmTooltip))
    assert.ok(/ajustada por flujos/i.test(dict.es.fp.overview.hwmTooltip))
    assert.ok(/aportes y retiros están excluidos/i.test(dict.es.fp.overview.hwmTooltip))
    assert.ok(/no es el máximo real de aum/i.test(dict.es.fp.overview.hwmTooltip))
    assert.ok(/no es un high-water mark de retorno/i.test(dict.es.fp.overview.hwmTooltip))
    const src = read('src/lib/i18n.ts')
    assert.ok(/LEFT IN ENGLISH ON PURPOSE/.test(src), 'the choice must be documented, not incidental')
  })

  test('the tooltip states BOTH what it is and what it is not', () => {
    const en = dict.en.fp.overview.hwmTooltip
    assert.ok(/highest level reached/i.test(en), 'must say what the figure IS')
    assert.ok(/displayed flow-adjusted portfolio path/i.test(en), 'must scope it to the line drawn')
    assert.ok(/contributions and withdrawals are excluded/i.test(en), 'must say what was removed')
    // R13.R2E § 16 — the two readings a reader could otherwise take are BOTH
    // ruled out by name, because the plotted levels are derived.
    assert.ok(/not the portfolio's actual AUM high/i.test(en), 'must separate it from the real balance')
    // R13.R2F § 8 — the clause was TIGHTENED, not weakened. "a flow-adjusted
    // investment-return high-water mark" ruled out a narrower thing than it
    // meant to: it left room to read the sentence as denying only the
    // FLOW-ADJUSTED variety. The guarantee is that NO investment-return
    // high-water-mark reading is available, so the qualifier is gone.
    assert.ok(/not an investment-return high-water mark/i.test(en),
      'must rule out the fee/performance high-water-mark reading')
    // And it must NOT describe a derived level as an observed one.
    assert.ok(!/maximum observed portfolio value/i.test(en))
  })

  test('the reference is drawn subordinate, dashed, and never in the alert red', () => {
    const chart = read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx')
    assert.ok(/var\(--fp-hwm\)/.test(chart), 'uses its own approved token')
    assert.ok(/strokeDasharray/.test(chart), 'dashed, so it reads as a reference not a series')
    assert.ok(!/--negative|#8B0E04/.test(chart), 'a portfolio below its high is not an error')
    // Declared in both themes.
    const hwm = themed('--fp-hwm')
    assert.notEqual(hwm.light, hwm.dark)
  })

  test('the explanation is reachable by screen reader as well as pointer', () => {
    const chart = read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx')
    assert.ok(/<title>\{`\$\{highWaterMarket!\.label\}/.test(chart), 'pointer hover')
    assert.ok(
      /sr-only[\s\S]*?highWaterMarket !== null[\s\S]*?highWaterMarket\.tooltip/.test(chart),
      'screen-reader route must not depend on hovering an SVG',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Settings model + migration (§§ 24-25)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 owner review §§ 24-25 — the reference-line setting', () => {
  test('it is a closed enum, validated like every other field', () => {
    const base = { ...DEFAULT_ALLOCATION_SETTINGS }
    assert.equal(validateAllocationSettings(base).ok, true)
    const bad = validateAllocationSettings({ ...base, referenceLine: 'always' })
    assert.equal(bad.ok, false)
    assert.ok(!bad.ok && bad.invalidFields.includes('referenceLine'), 'the offending field is NAMED')
  })

  test('a missing stored value falls back to the documented default on READ only', () => {
    assert.equal(normalizeStoredSettings({}).referenceLine, 'auto')
    // …but a caller WRITE is rejected rather than silently coerced.
    assert.equal(validateAllocationSettings({ ...DEFAULT_ALLOCATION_SETTINGS, referenceLine: undefined }).ok, false)
  })

  test('the settings payload still admits no free-form style', () => {
    const result = validateAllocationSettings({
      ...DEFAULT_ALLOCATION_SETTINGS,
      customHex: '#ff0000',
      css: 'fill: red',
    })
    assert.equal(result.ok, true)
    assert.ok(result.ok && !('customHex' in result.settings), 'unknown properties are dropped, never stored')
    assert.ok(result.ok && !('css' in result.settings))
  })

  test('the migration carries the column, its CHECK, and no third mode', () => {
    assert.ok(/reference_line\s+text not null default 'auto'/.test(MIGRATION))
    // The CHECK admits exactly two modes. Asserted against the constraint
    // itself rather than the whole file, whose prose explains WHY there is no
    // third mode and would therefore match a naive search for the word.
    const check = /check \(reference_line in \(([^)]*)\)\)/.exec(MIGRATION)
    assert.ok(check, 'reference_line must be CHECK-constrained')
    assert.equal(check![1], "'auto','hidden'", "no mode that could contradict the owner's Compare rule")
    // The migration remains forward-only and after the last deployed one.
    assert.ok(MIGRATION.includes('FORWARD-ONLY'))
  })

  test('the settings table still holds no financial data and no style payload', () => {
    assert.ok(/data_type in \('json','jsonb'\)/.test(MIGRATION), 'the postcondition guard is still present')
    assert.ok(/hex\|rgb\|css\|style\|color\|colour/.test(MIGRATION))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · InRetail (§ 6)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 owner review § 6 — InRetail is context, not a further subtraction', () => {
  test('it is no longer rendered inside the Weekly Snapshot card', () => {
    // The confusing arrangement was the InRetail line sitting directly beneath
    // Difference, where it read as another term in the arithmetic.
    const snapshotCall = /<WeeklySnapshotCard[\s\S]*?\/>/.exec(PAGE)
    assert.ok(snapshotCall, 'the snapshot card must still be rendered')
    assert.ok(!/inretail/i.test(snapshotCall![0]), 'no InRetail content may travel with the snapshot card')
  })

  test('the four snapshot rows are the only arithmetic in that block', () => {
    const rows = /const snapshotRows: SnapshotRow\[\] = \[[\s\S]*?\n  \]/.exec(PAGE)
    assert.ok(rows, 'snapshotRows must still be built explicitly')
    assert.ok(!/inretail/i.test(rows![0]), 'InRetail must not be one of the snapshot rows')
    for (const key of ['boy', 'prev', 'this', 'diff']) {
      assert.ok(rows![0].includes(`key: '${key}'`), `the ${key} row must remain`)
    }
  })

  // SUPERSEDED BY OWNER REVIEW PASS 2 § 2. Pass 1 relocated the InRetail
  // portfolio-impact annotation beside the strip and required it to state that
  // the figure was already counted. Having seen it there, the owner judged it
  // REDUNDANT — the same line is already visible in full in the Weekly close by
  // line table — and asked for it to be removed from the upper Summary
  // entirely. So the three assertions that pinned that annotation's presence,
  // its "already included" wording and its masked rendering are not still-valid
  // history to restore: they described a presentation the owner has since
  // withdrawn.
  //
  // WHAT PASS 1 ESTABLISHED IS NOT WITHDRAWN. The inclusion semantics it proved
  // (TOTAL = SUBTOTAL + ACCIONES CHILENAS; SUBTOTAL = INRETAIL + SPINE) are the
  // reason removing the annotation is safe rather than lossy, and they are
  // re-asserted — against the data, not against page copy — in
  // `portfolioR2bOwnerReview.test.ts`, together with the absence of the
  // annotation and the survival of the underlying figure.
  test('the annotation is GONE from the upper Summary (pass 2 § 2)', () => {
    assert.ok(!/o\.inretailImpact/.test(PAGE))
    assert.ok(!/o\.inretailIncluded/.test(PAGE))
    assert.ok(!/data\.inretailImpact/.test(PAGE))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The primary hierarchy (§ 2)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 owner review § 2 — the headline is the total INCLUDING Chilean equities', () => {
  test('the dictionary names the basis so the headline is unambiguous', () => {
    assert.equal(dict.en.fp.overview.aumLabel, 'Portfolio Value')
    assert.equal(dict.en.fp.overview.aumBasis, 'Including Chilean equities')
    assert.equal(dict.es.fp.overview.aumLabel, 'Valor del Portafolio')
    assert.equal(dict.es.fp.overview.aumBasis, 'Con acciones chilenas')
  })

  test('the headline renders through the guarded path and names its as-of date', () => {
    const hero = read('src/components/familyPortfolio/PortfolioValueHero.tsx')
    assert.ok(/<MaskedAmount/.test(hero), 'the AUM figure is a portfolio amount — it obeys the mask')
    assert.ok(!/formatUsd|toLocaleString|Intl\./.test(hero), 'the hero must not format an amount itself')
    assert.ok(/ui-kpi-hero/.test(hero), 'the headline must take the largest type role on the page')
    // Rendered on the page with the publication's own column date.
    assert.ok(/<PortfolioValueHero[\s\S]*?dateLabel=\{[\s\S]*?dates\.thisWeek/.test(PAGE))
  })

  test('a personal scope is not given Main’s basis label', () => {
    // "Including Chilean equities" is only a true statement for the scope that
    // has the split. Printing it under a personal total would be a false
    // financial claim, so the basis line is conditional.
    assert.ok(/basis=\{isMain \? o\.aumBasis : null\}/.test(PAGE))
  })

  test('the Excluding basis is not promoted into a competing headline', () => {
    // It stays a performance detail. Only ONE hero renders on the page.
    assert.equal((PAGE.match(/<PortfolioValueHero/g) ?? []).length, 1)
  })

  test('the hero value is the bound TOTAL row, not a recomputed figure', () => {
    // `hero.totalValue` is the row the parser numerically bound to the
    // `with_chilean_equities` performance basis — the same row the Weekly
    // Snapshot reads, so the headline and "This Week" can never disagree.
    assert.ok(/data\.hero\?\.totalValue|hero\?\.totalValue/.test(PAGE))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Settings affordance and layout (§§ 9-10, 21)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 owner review §§ 9-10 — one recognizable gear, on both modules', () => {
  const GEAR = read('src/components/familyPortfolio/SettingsGearButton.tsx')

  test('it is a real gear, not an abstract glyph', () => {
    // A cog reads as a cog because its teeth are attached to a ring. The
    // superseded icon drew detached radial ticks around a bare circle, which
    // is why it was not recognised as settings.
    assert.ok(/<circle[^>]*r="5\.1"/.test(GEAR), 'a ring')
    assert.ok(/<circle[^>]*r="1\.9"/.test(GEAR), 'a hub')
    const teeth = (GEAR.match(/M[\d.]+ [\d.]+[vhlM]/g) ?? []).length
    assert.ok(teeth >= 4, 'teeth must be drawn')
  })

  test('it is keyboard operable and accessibly named', () => {
    assert.ok(/<button/.test(GEAR), 'a native button — focusable and Enter/Space operable for free')
    assert.ok(/aria-label=\{label\}/.test(GEAR))
    assert.ok(/title=\{label\}/.test(GEAR))
    assert.ok(!/aria-label="/.test(GEAR), 'the name comes from the dictionary, never hardcoded here')
  })

  test('BOTH the allocation and the evolution module use the same component', () => {
    const panel = read('src/components/familyPortfolio/AllocationPanel.tsx')
    assert.ok(/SettingsGearButton/.test(panel), 'Asset Allocation')
    assert.ok(/<SettingsGearButton[\s\S]*?o\.settingsEvolution/.test(PAGE), 'Portfolio Evolution')
    // Each names its own module so a screen-reader user can tell them apart.
    assert.ok(/o\.settingsOpen/.test(panel))
  })

  test('a non-administrator gets no gear at all — never a disabled ghost', () => {
    assert.ok(/onOpenSettings=\{canEditSettings \? \(\) => setSettingsOpen\(true\) : undefined\}/.test(PAGE))
    assert.ok(/canEditSettings && \(?\s*<SettingsGearButton/.test(PAGE), 'the evolution gear is gated too')
    // Scoped to the rendered element — the component's own prose explains WHY
    // there is no disabled ghost, and a whole-file scan would match that.
    const button = /<button[\s\S]*?<\/button>/.exec(GEAR)
    assert.ok(button, 'the gear renders a native button')
    assert.ok(!/disabled/.test(button![0]), 'the control itself has no disabled state to render')
  })

  test('the direct view interactions stay on the chart, not in settings', () => {
    // Period and series are how a MEMBER reads the data. Moving them behind an
    // administrator-only dialog would take them away from everyone else.
    const dialog = read('src/components/familyPortfolio/AllocationSettingsDialog.tsx')
    for (const key of ['evoPeriod1M', 'evoPeriodALL', 'evoModeCompare', 'evoModeIncl', 'evoModeExcl']) {
      assert.ok(!dialog.includes(key), `${key} must remain a direct chart control`)
    }
    assert.ok(/EVOLUTION_PERIODS\.map/.test(PAGE), 'the period rail is still rendered on the page')
  })

  test('the High Water Market explanation is reachable by keyboard', () => {
    // Before this pass it existed only as an SVG <title> (pointer) and sr-only
    // text (screen reader) — a sighted keyboard user had no route to it.
    assert.ok(/o\.hwmTooltip/.test(PAGE), 'the explanation is surfaced on the page')
    assert.ok(/role="tooltip"/.test(PAGE) || /aria-describedby/.test(PAGE))
    assert.ok(/onFocus|focus-within|focus:/.test(PAGE), 'focus must reveal it, not hover alone')
  })
})

describe('R13.R2 owner review § 21 — Weekly Notes precede Portfolio Evolution', () => {
  test('the notes are encountered before the long-term chart', () => {
    const notes = PAGE.indexOf('o.notesTitle')
    const evo = PAGE.indexOf('o.evoTitle')
    assert.ok(notes > 0 && evo > 0)
    assert.ok(notes < evo, 'the week’s activity should be read before the value history')
  })

  test('the empty state stays compact — no void where a note would be', () => {
    assert.ok(/o\.notesEmpty/.test(PAGE))
    assert.ok(!/AsyncState kind="empty" message=\{o\.notesEmpty\}/.test(PAGE), 'a full empty-state block would be too heavy here')
  })

  test('no layout grid lost its responsive prefixes', () => {
    // Page-level horizontal overflow is never acceptable; multi-column grids
    // must collapse below their breakpoint.
    for (const m of PAGE.match(/grid-cols-\d+/g) ?? []) {
      const idx = PAGE.indexOf(m)
      const around = PAGE.slice(Math.max(0, idx - 60), idx)
      assert.ok(
        /(sm|md|lg|xl):$/.test(around.slice(-4)) || /grid-cols-1/.test(m) || /(sm|md|lg|xl):grid-cols/.test(PAGE.slice(idx - 4, idx + m.length)),
        `a bare ${m} must be paired with a responsive prefix`,
      )
    }
  })
})
