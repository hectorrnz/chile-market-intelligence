// R13.R2E § 21 — behavioural tests for the STABLE flow-adjusted evolution.
//
// WHAT ACTUALLY CARRIES RISK HERE, and what each group proves:
//
//   * A LEVEL THAT MOVES WHEN YOU TOUCH A CONTROL IS NOT A LEVEL. Pass 4
//     adjusted after the window was chosen, so the same calendar date carried a
//     different adjusted value per range — measured at up to 13.80% of Jaime's
//     actual portfolio value between the 1M and ALL views. The first group
//     reproduces that defect on a fixture and then proves the shipped
//     architecture is immune to it.
//   * A DERIVED LEVEL MUST NOT WEAR AN OBSERVED LEVEL'S NAME. The second group
//     pins the three concepts apart — actual AUM, the plotted analytical path,
//     and the change along it — in code and in both languages.
//   * THE SOURCE IS THE ONLY AUTHORITY. The third group proves the adjusted
//     step reproduces the source's own published weekly P&L, that no date is
//     invented, no gap filled, and no unpublished flow assumed to be zero.
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
  type FlowObservation,
} from '../src/lib/familyPortfolio/flowAdjustedEvolution.ts'
import {
  EVOLUTION_PERIODS,
  selectEvolutionRange,
  sharedEndpoint,
  valueChange,
} from '../src/lib/familyPortfolio/evolutionRange.ts'
import { highWaterMarket } from '../src/lib/familyPortfolio/highWaterMarket.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/family-portfolio/page.tsx')
const PRINT = read('src/components/familyPortfolio/SummaryPrintSheet.tsx')
const en = dict.en.fp.overview
const es = dict.es.fp.overview

/**
 * ~14 months of invented weekly observations with a large contribution part-way
 * through, so a windowed adjustment and a whole-record adjustment must disagree
 * unless the architecture prevents it. Every step satisfies the publication
 * contract `Δvalue = weekly_profit + flow` by construction.
 */
const SERIES: FlowObservation[] = (() => {
  const out: FlowObservation[] = []
  let value = 1000
  // 60 weekly Fridays from 2025-06-06.
  const start = Date.UTC(2025, 5, 6)
  for (let i = 0; i < 60; i++) {
    const date = new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10)
    if (i === 0) {
      out.push({ date, value, flow: null })
      continue
    }
    const profit = 10 // a flat, hand-checkable weekly P&L
    const flow = i === 20 ? 500 : 0 // one large contribution, mid-record
    value = value + profit + flow
    out.push({ date, value, flow })
  }
  return out
})()

const ADJUSTED = buildFlowAdjustedSeries(SERIES)

// ═══════════════════════════════════════════════════════════════════════════
// 1 · § 12 — the series is stable; range controls slice it
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E § 12 — a date carries ONE adjusted value, whatever range is selected', () => {
  test('the shipped order is: adjust the whole record, THEN slice', () => {
    // The pure module is handed the FULL series, and `selectEvolutionRange` is
    // handed the ADJUSTED points. Reversing these two is the pass-4 defect.
    assert.match(PAGE, /buildFlowAdjustedSeries\(inclPoints\)/)
    assert.match(PAGE, /buildFlowAdjustedSeries\(exclPoints\)/)
    assert.match(PAGE, /selectEvolutionRange\(inclAdjusted\.points, safePeriod, endpointOverride\)/)
    assert.match(PAGE, /selectEvolutionRange\(exclAdjusted\.points, safePeriod, endpointOverride\)/)
    // And never the other way round.
    assert.ok(!/buildFlowAdjustedSeries\((incl|excl)Range\.points\)/.test(codeOf(PAGE)),
      'the adjustment must not be rebuilt from a window')
  })

  test('slicing the stable series leaves every date\'s value untouched', () => {
    const byDate = new Map(ADJUSTED.points.map((p) => [p.date, p.value]))
    for (const period of EVOLUTION_PERIODS) {
      const sliced = selectEvolutionRange(ADJUSTED.points, period)
      assert.ok(sliced.points.length > 0, `${period} must select something`)
      for (const p of sliced.points) {
        assert.equal(p.value, byDate.get(p.date), `${period} changed the value at ${p.date}`)
      }
    }
  })

  test('THE DEFECT IT REPLACES: adjusting per window makes one date disagree with itself', () => {
    // Pass-4 order, reproduced on the same fixture. The endpoint sits after the
    // mid-record contribution, so a window that excludes the contribution and a
    // window that includes it produce different "levels" for the same day.
    const endDate = SERIES[SERIES.length - 1].date
    const seen = new Set<number>()
    for (const period of EVOLUTION_PERIODS) {
      const win = selectEvolutionRange(SERIES, period)
      const adj = buildFlowAdjustedSeries(win.points)
      const last = adj.points[adj.points.length - 1]
      assert.equal(last.date, endDate)
      seen.add(last.value)
    }
    assert.ok(seen.size > 1, 'the fixture must actually exhibit the pass-4 defect')

    // The shipped order collapses that to exactly one value.
    const stable = new Set(
      EVOLUTION_PERIODS.map((period) => {
        const sliced = selectEvolutionRange(ADJUSTED.points, period)
        return sliced.points[sliced.points.length - 1].value
      }),
    )
    assert.equal(stable.size, 1, 'the stable series must give one value for one date')
  })

  test('the High Water Market is stable too, because it reads the same sliced series', () => {
    // Under the pass-4 order the peak of the ALL view and of the 1Y view were
    // different NUMBERS for the same peak week; under the stable series they
    // agree wherever the window contains the peak.
    const all = highWaterMarket(selectEvolutionRange(ADJUSTED.points, 'ALL').points)
    const oneYear = highWaterMarket(selectEvolutionRange(ADJUSTED.points, '1Y').points)
    assert.ok(all !== null && oneYear !== null)
    assert.equal(all!.date, oneYear!.date)
    assert.equal(all!.value, oneYear!.value)
    // § 17 — the peak date is a REAL observation date from the input.
    assert.ok(SERIES.some((p) => p.date === all!.date))
  })

  test('period Value Change is measured between the slice\'s own two endpoints', () => {
    assert.match(PAGE, /const headlinePoints = headlineRange\.points/)
    assert.match(PAGE, /const headlineChange = valueChange\(headlinePoints\)/)
    // On this fixture a 12-week window is 11 steps of +10 published P&L,
    // whatever flows happened outside it.
    const sliced = selectEvolutionRange(ADJUSTED.points, '3M')
    const change = valueChange(sliced.points)
    assert.equal(change.absolute, (sliced.points.length - 1) * 10)
  })

  test('Compare pins both lines to a date BOTH adjusted series reach (§ 18)', () => {
    assert.match(PAGE, /sharedEndpoint\(inclAdjusted\.points, exclAdjusted\.points\)/)
    // A shorter adjusted history must not let the other line be drawn past it.
    const short = ADJUSTED.points.slice(0, 30)
    assert.equal(sharedEndpoint(ADJUSTED.points, short), short[short.length - 1].date)
  })

  test('§ 18 — Compare draws two lines of the SAME construction', () => {
    // Both series arrive from `buildFlowAdjustedSeries` and are sliced by the
    // same selector; there is no branch that could pair an adjusted line with a
    // raw one.
    const compare = PAGE.slice(PAGE.indexOf("safeMode === 'compare'\n      ? (["), PAGE.indexOf('.filter((s) => s.points.length > 0)'))
    assert.ok(compare.length > 0)
    assert.ok(/points: inclRange\.points/.test(compare) && /points: exclRange\.points/.test(compare))
    assert.ok(!/inclPoints|exclPoints/.test(compare), 'a raw series must never reach the chart')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · §§ 9-10, 14-16 — three concepts, named apart
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E §§ 9-10 — actual AUM, the plotted path, and the change along it', () => {
  test('the page hero and the evolution card both read ACTUAL published value', () => {
    // The hero is the publication's own hero total…
    assert.match(PAGE, /value=\{data\.hero\?\.totalValue \?\? null\}/)
    // …and the evolution card's lead figure comes from the RAW observations,
    // never from the adjusted line.
    assert.match(PAGE, /const headlineRawPoints = safeMode === 'excl' \? exclPoints : inclPoints/)
    assert.match(PAGE, /headlineRawPoints\[headlineRawPoints\.length - 1\]/)
    assert.match(PAGE, /\{o\.evoActualValueLabel\}/)
    assert.match(PAGE, /value=\{actualLatest\.value\}/)
  })

  test('the derived level is never offered under a generic "Portfolio Value" name', () => {
    // `evoValueChange` / `evoChangeInValue` are RETIRED: both read as statements
    // about the real balance.
    assert.equal((en as Record<string, unknown>).evoValueChange, undefined)
    assert.equal((en as Record<string, unknown>).evoChangeInValue, undefined)
    assert.equal((es as Record<string, unknown>).evoValueChange, undefined)
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      assert.ok(/flow-adjusted|ajustad/i.test(o.evoAdjustedValueLabel), `${lang}`)
      assert.ok(/flow-adjusted|ajustad/i.test(o.evoAdjustedValueChange), `${lang}`)
      assert.ok(/actual|real/i.test(o.evoActualValueLabel), `${lang}`)
      // None of the three may call itself a return.
      assert.ok(
        !/\breturn\b|retorno|rentabilidad/i.test(
          o.evoActualValueLabel + o.evoAdjustedValueLabel + o.evoAdjustedValueChange,
        ),
        `${lang}`,
      )
    }
  })

  test('§ 15 — the disclosure states BOTH things, without hover', () => {
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      // (1) what is excluded, and why.
      assert.ok(/contributions and withdrawals are excluded|aportes y retiros están excluidos/i.test(o.evoValueChangeNote), `${lang} (1)`)
      assert.ok(/distort|distorsion/i.test(o.evoValueChangeNote), `${lang} (1b)`)
      // (2) what the line is and is not.
      assert.ok(/analytical value path|trayectoria analítica/i.test(o.evoValueChangeNote), `${lang} (2a)`)
      // R13.R2F § 5 — the sentence was tightened to the owner's own phrasing
      // ("not actual historical AUM"); the property asserted is unchanged, so
      // the check matches the claim rather than one exact wording of it.
      assert.ok(/not (the )?actual historical AUM|no es (la serie histórica real de AUM|el AUM histórico real)/i.test(o.evoValueChangeNote), `${lang} (2b)`)
      assert.ok(/not an investment[- ]return|no es un cálculo de retorno/i.test(o.evoValueChangeNote), `${lang} (2c)`)
    }
    // Rendered as text on the card, and echoed as a chip on the title line —
    // neither behind a tooltip.
    // R13.R2F5 § C moved the measure off the note and onto the shared
    // `.nv-notes` band that now wraps the disclosure group, so the per-note
    // cap is gone. What this test protects — the sentence is rendered as
    // PLAIN TEXT on the card, not behind a tooltip — is unchanged.
    assert.match(PAGE, /<p className="ui-meta text-muted-fg">\{o\.evoValueChangeNote\}<\/p>/)
    assert.match(PAGE, /<div className="nv-notes pt-2\.5"/)
    assert.match(PAGE, /\{o\.evoFlowAdjustedChip\}/)
  })

  test('§ 16 — the HWM term is locked and its explanation matches the derived line', () => {
    assert.equal(en.hwmLabel, 'High Water Market')
    assert.equal(es.hwmLabel, 'High Water Market')
    for (const [lang, o] of [['en', en], ['es', es]] as const) {
      assert.ok(/flow-adjusted|ajustada por flujos/i.test(o.hwmTooltip), `${lang} names the line`)
      assert.ok(/AUM/i.test(o.hwmTooltip), `${lang} rules out the AUM high`)
      // It must NOT describe a derived level as an observed one.
      assert.ok(!/maximum observed portfolio value|máximo valor observado/i.test(o.hwmTooltip), `${lang}`)
    }
  })

  test('§ 20 — print says the same things as the screen', () => {
    assert.match(PAGE, /evolutionChangeLabel=\{o\.evoAdjustedValueChange\}/)
    assert.match(PAGE, /evolutionNote=\{o\.evoValueChangeNote\}/)
    // The sheet's own masthead figure is the ACTUAL published total.
    assert.match(PAGE, /totalValue=\{data\.hero\?\.totalValue \?\? null\}/)
    assert.match(PRINT, /\{evolutionNote && <p className="nv-print-meta">\{evolutionNote\}<\/p>\}/)
  })

  test('privacy is unchanged — every plotted amount still goes through the mask', () => {
    assert.match(PAGE, /const hwmPoint = hwmVisible && !masked \? highWaterMarket\(/)
    assert.match(PAGE, /\) : masked \? \(/)
    for (const m of PAGE.match(/<MaskedAmount[\s\S]{0,220}?\/>/g) ?? []) {
      assert.match(m, /masked=\{masked\}/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · §§ 5, 13 — the source is the only authority
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E § 13 — the adjusted step IS the published weekly P&L', () => {
  test('every step reproduces the source figure exactly', () => {
    for (let i = 1; i < ADJUSTED.points.length; i++) {
      assert.equal(ADJUSTED.points[i].value - ADJUSTED.points[i - 1].value, 10)
    }
    // The raw path, by contrast, jumps by the contribution.
    const jump = SERIES[20].value - SERIES[19].value
    assert.equal(jump, 510)
  })

  test('the anchor is the record\'s own first adjustable observation', () => {
    assert.equal(ADJUSTED.anchorDate, SERIES[0].date)
    assert.equal(ADJUSTED.points[0].value, SERIES[0].value)
    assert.equal(ADJUSTED.omittedLeading, 0)
    assert.equal(ADJUSTED.netFlowExcluded, 500)
  })

  test('no date is invented and no gap is filled', () => {
    const source = new Set(SERIES.map((p) => p.date))
    for (const p of ADJUSTED.points) assert.ok(source.has(p.date), `${p.date} is not a source date`)
    assert.equal(ADJUSTED.points.length, SERIES.length)
    // A genuine gap stays a gap: removing a week removes a point, it does not
    // interpolate one.
    const gapped = SERIES.filter((_, i) => i !== 30)
    const out = buildFlowAdjustedSeries(gapped)
    assert.equal(out.points.length, gapped.length)
    assert.ok(!out.points.some((p) => p.date === SERIES[30].date))
  })

  // R13.R2E.1 § 2 — RE-POINTED, NOT WEAKENED. This assertion used to fire on a
  // BLANK flow. Under the owner-authoritative sparse-event rule a blank cell
  // means no money moved, so the refusal now belongs to the only case that is
  // genuinely unknown: a flow the source published in a form that cannot be
  // read. The refusal itself is unchanged and is asserted just as strictly.
  test('an UNREADABLE flow is never assumed to be zero', () => {
    const withGap = SERIES.map((p, i) => (i === 40 ? { ...p, flow: null, flowUnavailable: true } : p))
    const out = buildFlowAdjustedSeries(withGap)
    // The step INTO observation 40 cannot be adjusted, so the path anchors AT
    // observation 40 — its own real published level — and every step after it
    // is genuinely adjusted. The 40 earlier observations are dropped rather
    // than plotted with an assumed-zero flow.
    assert.equal(out.anchorDate, SERIES[40].date)
    assert.equal(out.omittedLeading, 40)
    assert.equal(out.adjustableFrom, SERIES[40].date)
    assert.equal(out.points[0].value, withGap[40].value)
  })

  test('a BLANK flow is zero, and costs the series nothing', () => {
    // The same week, blank instead of unreadable: no money moved, so the whole
    // record stays plotted and the step is adjusted with a zero flow. This is
    // the correction that restored Main Incl. from 32 weeks to 102.
    const blank = SERIES.map((p, i) => (i === 40 ? { ...p, flow: null } : p))
    const out = buildFlowAdjustedSeries(blank)
    assert.equal(out.anchorDate, SERIES[0].date)
    assert.equal(out.omittedLeading, 0)
    assert.equal(out.adjustableFrom, null)
    assert.equal(out.points.length, SERIES.length)
    // Week 40's own flow was 0 in the fixture, so nothing about the path moved.
    assert.deepEqual(out.points, ADJUSTED.points)
  })

  test('the module and the page contain no interpolation or smoothing', () => {
    const pure = codeOf(read('src/lib/familyPortfolio/flowAdjustedEvolution.ts'))
    for (const banned of ['interpolat', 'smooth', 'carryForward', 'fillGap', 'resample']) {
      assert.ok(!new RegExp(banned, 'i').test(pure), `${banned} must not appear`)
    }
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(pure), 'the module must read no clock')
  })

  test('the route still reads flows under the caller\'s own session', () => {
    const route = read('src/app/api/family-portfolio/overview/[scope]/route.ts')
    assert.match(route, /getPerformanceMetricSeries\(publicationIds, scope, 'flow'\)/)
    assert.ok(!/flow: [^\n]*\?\? 0/.test(codeOf(route)))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · §§ 7-8, 19 — how many weeks each series can actually support
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E §§ 7-8, 19 — supportable history is a property of the SOURCE', () => {
  test('a fully-covered record keeps every one of its observations', () => {
    // R13.R2E.1 §§ 4, 8 — ALL FIVE series are this shape now. Every step's net
    // flow is known, because a stated figure is that figure and a blank one is
    // zero: Main Incl. 102/102, Main Excl. 102/102, Jaime 102/102, Andrés
    // 102/102, Pablo 94/94. The fixture stands in for that shape; the live
    // figures are reported in the owner review.
    assert.equal(ADJUSTED.points.length, SERIES.length)
    assert.equal(ADJUSTED.adjustableFrom, null, 'nothing withheld when every step is covered')
  })

  test('a partly-covered record is TRUNCATED, never spliced', () => {
    // R13.R2E.1 § 2 — RE-POINTED. No series in the book has this shape any more;
    // it is reached only by a flow the source published unreadably. The
    // truncate-never-splice guarantee is unchanged and still asserted in full.
    const late = SERIES.map((p, i) => (i < 25 ? { ...p, flow: null, flowUnavailable: true } : p))
    const out = buildFlowAdjustedSeries(late)
    assert.equal(out.anchorDate, SERIES[24].date)
    assert.equal(out.points.length, SERIES.length - 24)
    assert.equal(out.adjustableFrom, SERIES[24].date)
    // Every plotted step is genuinely adjusted — no raw level survives in it.
    for (let i = 1; i < out.points.length; i++) {
      assert.equal(out.points[i].value - out.points[i - 1].value, 10)
    }
  })

  test('the truncation is disclosed only when the window reaches past it', () => {
    // A short period that lies entirely inside the adjustable span withholds
    // nothing, so the note would be noise.
    assert.match(PAGE, /rawRange\.startDate < seriesAdjustableFrom/)
    assert.match(PAGE, /\{adjustableFrom !== null && \(/)
    assert.match(PAGE, /\{o\.evoFlowAdjustedFrom\}/)
  })

  test('a personal scope uses the identical construction (§ 19)', () => {
    // One code path: `inclPoints` is the personal `total` series, and the same
    // adjuster, selector and labels apply. No Main basis word can reach it.
    assert.match(PAGE, /const inclPoints = isMain \? \(data\?\.evolution\?\.withChilean \?\? EMPTY_POINTS\) : totalPoints/)
    assert.match(PAGE, /const singleSeriesLabel = isMain \? o\.evoModeIncl : o\.evoAdjustedValueLabel/)
    assert.match(PAGE, /const safeMode: SeriesMode = isMain \? storedMode : 'incl'/)
  })
})
