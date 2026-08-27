// R13.R3C — Contributors and Detractors of Portfolio Value Change.
//
// Two halves, deliberately:
//   · BEHAVIOURAL — the pure modules are exercised against a small synthetic
//     book whose every figure is hand-checkable, so a failure names an
//     arithmetic fact rather than a rendering detail.
//   · STRUCTURAL — source-text assertions that pin the properties which have
//     no runtime surface here: which component owns the chart, which tokens
//     the bars are painted with, and that nothing hardcodes a sociedad name.
//
// THE FIXTURE MIRRORS THE REAL BOOK'S TWO SHAPES. Main nests
// `group_header → asset_class → sub_asset_class` in its liquid block and
// `asset_class → sociedad_header → individual_asset` in its alternatives
// block — the second is why the frontier rule exists at all, because those
// `sociedad_header` rows carry NO value of their own. A personal book nests
// `sociedad_header → asset_class → sub_asset_class` with the sociedad's money
// on a sibling `sociedad_total`. Both are reproduced below.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import {
  buildChangeNodes,
  buildTotalMetrics,
  buildWaterfall,
  contributionChildren,
  deriveDrivers,
  isContributionDrillable,
  reconcileContribution,
  type WeeklyChangeInputRow,
  type WeeklyChangePerformanceRow,
} from '../src/lib/familyPortfolio/weeklyChanges.ts'
import {
  AXIS_MAX_INTERVALS,
  AXIS_MIN_FILL,
  buildContributionSet,
  contributionAxis,
  rankContributions,
} from '../src/lib/familyPortfolio/contributionChart.ts'
import {
  contributionLabel,
  omittedZeroSentence,
} from '../src/lib/familyPortfolio/contributionLabels.ts'
import {
  COMBINED_SUBJECT,
  derivePortfolioSubjects,
  resolveSubject,
  subjectDisplayLabel,
  subjectLabelOverrides,
} from '../src/lib/familyPortfolio/portfolioSubject.ts'
import {
  VALUE_CHANGE_PERIODS,
  selectValueChangeRange,
} from '../src/lib/familyPortfolio/valueChangeRange.ts'
import { selectEvolutionRange } from '../src/lib/familyPortfolio/evolutionRange.ts'
import { compactUnitForStep, formatUsdCompactUnit } from '../src/lib/formatters.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const CHART = 'src/components/familyPortfolio/ContributionChart.tsx'
const MODAL = 'src/components/familyPortfolio/ContributionBreakdownModal.tsx'
const CARD = 'src/components/familyPortfolio/PeriodValueChangeCard.tsx'
const SUMMARY = 'src/app/family-portfolio/page.tsx'
const WEEKLY = 'src/app/family-portfolio/weekly-changes/page.tsx'
const PURE_CHART = 'src/lib/familyPortfolio/contributionChart.ts'
const PURE_SUBJECT = 'src/lib/familyPortfolio/portfolioSubject.ts'

const RESIDUAL = { es: dict.es.fp.contrib.residual, en: dict.en.fp.contrib.residual }
const STEP_LABELS = {
  opening: { es: 'o', en: 'o' },
  closing: { es: 'c', en: 'c' },
  residual: RESIDUAL,
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixture
// ═══════════════════════════════════════════════════════════════════════════

interface Spec {
  key: string
  parent: string | null
  type: string
  label: string
  /** Previous-week value. `undefined` = the row was not published that week. */
  prev?: number | null
  /** Current-week value. `undefined` = the row was not published that week. */
  cur?: number | null
}

/**
 * Main's shape. Every figure is round and every level ties by construction:
 *
 *   Renta Variable  1000 → 1150   +150   (Global +100, Emergente +50)
 *   Renta Fija       500 →  460    −40   (Investment Grade −40)
 *   Caja             200 →  200      0   ← exact zero: omitted from the plot
 *   Inmobiliario     300 →  390    +90   (Fund A +80, Fund B +10, NEW)
 *   ─────────────────────────────────────
 *   TOTAL           2000 → 2200   +200
 */
const MAIN: Spec[] = [
  { key: 'liq', parent: null, type: 'group_header', label: 'PORTAFOLIO LÍQUIDO' },
  { key: 'liq.rv', parent: 'liq', type: 'asset_class', label: 'Renta Variable', prev: 1000, cur: 1150 },
  { key: 'liq.rv.g', parent: 'liq.rv', type: 'sub_asset_class', label: 'Global', prev: 600, cur: 700 },
  { key: 'liq.rv.e', parent: 'liq.rv', type: 'sub_asset_class', label: 'Emergente', prev: 400, cur: 450 },
  { key: 'liq.rf', parent: 'liq', type: 'asset_class', label: 'Renta Fija', prev: 500, cur: 460 },
  { key: 'liq.rf.ig', parent: 'liq.rf', type: 'sub_asset_class', label: 'Investment Grade', prev: 500, cur: 460 },
  { key: 'liq.caja', parent: 'liq', type: 'asset_class', label: 'Caja y Equivalentes', prev: 200, cur: 200 },
  { key: 'alt', parent: null, type: 'group_header', label: 'ALTERNATIVOS' },
  { key: 'alt.inm', parent: 'alt', type: 'asset_class', label: 'Inmobiliario', prev: 300, cur: 390 },
  // A VALUELESS sociedad label between the asset class and its real holdings —
  // the exact shape that makes a direct-child breakdown impossible.
  { key: 'alt.inm.wm', parent: 'alt.inm', type: 'sociedad_header', label: 'Watermill' },
  { key: 'alt.inm.wm.a', parent: 'alt.inm.wm', type: 'individual_asset', label: 'Fund A', prev: 300, cur: 380 },
  { key: 'alt.inm.wm.b', parent: 'alt.inm.wm', type: 'individual_asset', label: 'Fund B', cur: 10 },
  { key: 'total', parent: null, type: 'portfolio_total', label: 'TOTAL', prev: 2000, cur: 2200 },
]

/**
 * A personal book. The net change is EXACTLY ZERO, which is deliberate: it
 * exercises the "a share of nothing is unanswerable" rule and the exact-zero
 * omission at the same time.
 *
 *   TOTAL LA ESPERANZA   500 → 500     0   ← omitted (Caja +20, RV −20)
 *   TOTAL NAIDELT        300 → 350   +50   (Renta Fija +50)
 *   Proporcional         200 → 150   −50   ← a leaf: no decomposition at all
 *   ─────────────────────────────────────
 *   TOTAL               1000 → 1000     0
 */
const PERSONAL: Spec[] = [
  { key: 'esp', parent: null, type: 'sociedad_header', label: 'La Esperanza' },
  { key: 'esp.caja', parent: 'esp', type: 'asset_class', label: 'Caja y Equivalentes', prev: 100, cur: 120 },
  { key: 'esp.rv', parent: 'esp', type: 'asset_class', label: 'Renta Variable', prev: 400, cur: 380 },
  { key: 'esp.total', parent: 'esp', type: 'sociedad_total', label: 'TOTAL LA ESPERANZA', prev: 500, cur: 500 },
  { key: 'nai', parent: null, type: 'sociedad_header', label: 'Naidelt' },
  { key: 'nai.rf', parent: 'nai', type: 'asset_class', label: 'Renta Fija', prev: 300, cur: 350 },
  { key: 'nai.total', parent: 'nai', type: 'sociedad_total', label: 'TOTAL NAIDELT', prev: 300, cur: 350 },
  { key: 'prop', parent: null, type: 'named_holding', label: 'Proporcional Otras Sociedades', prev: 200, cur: 150 },
  { key: 'total', parent: null, type: 'portfolio_total', label: 'TOTAL', prev: 1000, cur: 1000 },
]

/**
 * R13.R3C.1 — the three personal books with the RESUMEN's OWN identifiers
 * (doc 02 § 2.1), so the rosters below are produced from source strings rather
 * than from the names the owner approved. A sociedad is a header, its holdings
 * and its terminal total; root named holdings sit beside them.
 */
function sociedad(key: string, header: string, total: string, prev: number, cur: number): Spec[] {
  return [
    { key, parent: null, type: 'sociedad_header', label: header },
    { key: `${key}.rf`, parent: key, type: 'asset_class', label: 'Renta Fija', prev, cur },
    { key: `${key}.total`, parent: key, type: 'sociedad_total', label: total, prev, cur },
  ]
}

const JAIME: Spec[] = [
  ...sociedad('esp', 'LA ESPERANZA', 'TOTAL LA ESPERANZA', 500, 520),
  ...sociedad('nai', 'NAIDELT', 'TOTAL NAIDELT', 300, 350),
  { key: 'total', parent: null, type: 'portfolio_total', label: 'TOTAL JAIME', prev: 800, cur: 870 },
]

const ANDRES: Spec[] = [
  ...sociedad('sau', 'LOS SAUZALES', 'TOTAL LOS SAUZALES', 400, 420),
  ...sociedad('ret', 'RETBOY', 'TOTAL RETBOY', 300, 310),
  { key: 'prop', parent: null, type: 'named_holding', label: 'Proporcional Otras Sociedades', prev: 100, cur: 120 },
  {
    key: 'total', parent: null, type: 'portfolio_total',
    label: 'TOTAL Soc Personales + Proporcional', prev: 800, cur: 850,
  },
]

const PABLO: Spec[] = [
  ...sociedad('lau', 'LOS LAURELES', 'TOTAL LOS LAURELES', 500, 480),
  ...sociedad('van', 'VANGLOR', 'TOTAL VANGLOR', 200, 260),
  { key: 'prop', parent: null, type: 'named_holding', label: 'Proporcional Otras Sociedades', prev: 100, cur: 110 },
  { key: 'staten', parent: null, type: 'named_holding', label: 'Staten Capital (1/3)', prev: 150, cur: 150 },
  {
    key: 'total', parent: null, type: 'portfolio_total',
    label: 'TOTAL más Staten Capital Ltd', prev: 950, cur: 1000,
  },
]

function rows(spec: readonly Spec[], side: 'prev' | 'cur'): WeeklyChangeInputRow[] {
  const out: WeeklyChangeInputRow[] = []
  spec.forEach((s, i) => {
    const v = side === 'prev' ? s.prev : s.cur
    // A row absent from a publication is genuinely absent — not present with a
    // null. The two mean different things (§ 14 vs § 5) and the fixture keeps
    // them apart.
    if (v === undefined && !isContainer(s.type)) return
    out.push({
      rowKey: s.key,
      parentRowKey: s.parent,
      depth: s.key.split('.').length - 1,
      displayOrder: i,
      rowType: s.type,
      labelEs: s.label,
      labelEn: null,
      currency: 'USD',
      value: v ?? null,
    })
  })
  return out
}

const isContainer = (t: string) => t === 'group_header' || t === 'sociedad_header'

const PERF: WeeklyChangePerformanceRow[] = [
  { basis: 'total', metric: 'weekly_return', value: null, boundRowKey: 'total' },
]

function book(spec: readonly Spec[], grouping: 'top_level' | 'sociedad') {
  const cur = rows(spec, 'cur')
  const prev = rows(spec, 'prev')
  const nodes = buildChangeNodes(cur, prev, 2000)
  const total = buildTotalMetrics(nodes, PERF, 'total')
  const drivers = deriveDrivers(nodes, grouping)
  return { nodes, total, drivers }
}

function setOf(spec: readonly Spec[], grouping: 'top_level' | 'sociedad', subject = COMBINED_SUBJECT) {
  const { nodes, total, drivers } = book(spec, grouping)
  const resolved = resolveSubject(nodes, drivers, total, subject)
  return {
    nodes,
    total,
    drivers,
    resolved,
    set: buildContributionSet({
      openingValue: resolved.state === 'lifecycle_gap' ? null : resolved.openingValue,
      closingValue: resolved.state === 'lifecycle_gap' ? null : resolved.closingValue,
      components: resolved.components,
      isDrillable: (key) => isContributionDrillable(nodes, key),
      residualLabel: RESIDUAL,
    }),
  }
}

const labels = (items: ReadonlyArray<{ labelEs: string }>) => items.map((i) => i.labelEs)
const values = (items: ReadonlyArray<{ value: number }>) => items.map((i) => i.value)

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The contribution contract
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · contribution contract', () => {
  test('a component is closing − opening, and the set reconciles to the portfolio change', () => {
    const { set } = setOf(MAIN, 'top_level')
    assert.equal(set.openingValue, 2000)
    assert.equal(set.closingValue, 2200)
    assert.equal(set.netChange, 200)
    assert.equal(set.netChangeRatio, 0.1)
    assert.equal(set.status, 'complete')
    assert.equal(set.residual, 0)
    assert.equal(set.unavailable.length, 0)
    // Σ plotted components = the portfolio's own change, exactly.
    assert.equal(
      set.items.reduce((a, i) => a + i.value, 0),
      200,
    )
  })

  test('it agrees with `buildWaterfall` — one reconciliation engine, two presentations', () => {
    const { nodes, total, drivers } = book(MAIN, 'top_level')
    const wf = buildWaterfall(total, drivers, STEP_LABELS)
    const { set } = setOf(MAIN, 'top_level')
    assert.equal(wf.status === 'complete', set.status === 'complete')
    assert.equal(wf.residual, set.residual)
    assert.equal(wf.tolerance, set.tolerance)
    assert.equal(wf.unavailableDriverCount, set.unavailable.length)
    assert.ok(nodes.length > 0)
  })

  test('an exact-zero component is OMITTED from the plot and REPORTED, never hidden', () => {
    const { set } = setOf(MAIN, 'top_level')
    assert.ok(!labels(set.items).includes('Caja y Equivalentes'), 'a zero draws no bar')
    assert.deepEqual(labels(set.omittedZero), ['Caja y Equivalentes'])
    // Omitting it from the plot does not omit it from the sum: the set still
    // ties, because a zero adds nothing by definition.
    assert.equal(set.status, 'complete')
    // R13.R3C.2 — and the surface NAMES what it left out rather than counting
    // it. The generic count string is retired from both dictionaries.
    assert.match(dict.en.fp.contrib.zeroOmittedNames, /\{names\}/)
    assert.match(dict.es.fp.contrib.zeroOmittedNames, /\{names\}/)
    assert.match(dict.en.fp.contrib.zeroOmittedMore, /\{n\}/)
    assert.match(dict.es.fp.contrib.zeroOmittedMore, /\{n\}/)
    for (const lang of [dict.en, dict.es]) {
      assert.ok(!('zeroOmitted' in lang.fp.contrib), 'the count-only string is retired')
    }
  })

  test('an UNAVAILABLE component is never read as a zero — the set declares itself partial', () => {
    const broken = MAIN.map((s) => (s.key === 'liq.rf' ? { ...s, cur: null } : s))
    const { set } = setOf(broken, 'top_level')
    assert.equal(set.unavailable.length, 1)
    assert.equal(set.unavailable[0].labelEs, 'Renta Fija')
    assert.equal(set.unavailable[0].reason, 'missing_current')
    assert.equal(set.status, 'partial')
    // No residual is asserted when a component is unknown: the sum is
    // indeterminate, not short.
    assert.equal(set.residual, null)
    assert.ok(!labels(set.items).includes('Renta Fija'))
    // …and nothing was silently substituted for it.
    assert.ok(!set.items.some((i) => i.value === 0))
  })

  test('a shortfall becomes an EXPLICIT residual item, never folded into a component', () => {
    // Break the tiling: shrink one asset class without touching the total.
    const short = MAIN.map((s) => (s.key === 'liq.rv' ? { ...s, cur: 1100 } : s))
    const { set } = setOf(short, 'top_level')
    assert.equal(set.status, 'partial')
    assert.equal(set.residual, 50)
    const residual = set.items.find((i) => i.kind === 'residual')
    assert.ok(residual, 'a residual bar must exist')
    assert.equal(residual.value, 50)
    assert.equal(residual.rowKey, null)
    assert.equal(residual.drillable, false)
    // With it, the plotted bars sum to the portfolio's change again.
    assert.equal(
      set.items.reduce((a, i) => a + i.value, 0),
      200,
    )
    // And no component absorbed it.
    assert.equal(set.items.find((i) => i.labelEs === 'Renta Variable')?.value, 100)
  })

  test('both endpoints are required — a missing one yields no chart, not a zero change', () => {
    const set = buildContributionSet({
      openingValue: null,
      closingValue: 2200,
      components: [],
      isDrillable: () => false,
      residualLabel: RESIDUAL,
    })
    assert.equal(set.status, 'unavailable')
    assert.equal(set.netChange, null)
    assert.equal(set.netChangeRatio, null)
    assert.equal(set.items.length, 0)
  })

  test('components absent at the opening date are counted and disclosed', () => {
    const { set } = setOf(MAIN, 'top_level')
    // Fund B is new at the asset level; at the driver level nothing is new.
    assert.equal(set.newPositionCount, 0)
    const inm = buildContributionSet({
      openingValue: 300,
      closingValue: 390,
      components: contributionChildren(book(MAIN, 'top_level').nodes, 'alt.inm'),
      isDrillable: () => false,
      residualLabel: RESIDUAL,
    })
    assert.equal(inm.newPositionCount, 1, 'Fund B was not published at the opening date')
    assert.match(dict.en.fp.contrib.newPositionsNote, /\{n\}/)
    assert.match(dict.es.fp.contrib.newPositionsNote, /\{n\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Ranking and direction
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · ranking', () => {
  test('R13.R3C.2 — contributors largest→smallest, THEN detractors smallest→largest', () => {
    const { set } = setOf(MAIN, 'top_level')
    assert.deepEqual(labels(set.items), ['Renta Variable', 'Inmobiliario', 'Renta Fija'])
    assert.deepEqual(values(set.items), [150, 90, -40])
    const firstDetractor = set.items.findIndex((i) => i.direction === 'detractor')
    assert.ok(set.items.slice(0, firstDetractor).every((i) => i.direction === 'contributor'))
    assert.ok(set.items.slice(firstDetractor).every((i) => i.direction === 'detractor'))
  })

  test('R13.R3C.2 — detractors run SMALLEST to LARGEST, per the owner example', () => {
    // +10, +7, +2, -1, -4, -9 — one descending profile, biggest gain on the
    // left and biggest loss on the right, with the zero crossing in between.
    const ranked = rankContributions([
      { ...stub('d-large'), value: -9, direction: 'detractor' },
      { ...stub('c-small'), value: 2, direction: 'contributor' },
      { ...stub('d-small'), value: -1, direction: 'detractor' },
      { ...stub('c-large'), value: 10, direction: 'contributor' },
      { ...stub('d-mid'), value: -4, direction: 'detractor' },
      { ...stub('c-mid'), value: 7, direction: 'contributor' },
    ])
    assert.deepEqual(values(ranked), [10, 7, 2, -1, -4, -9])
    assert.deepEqual(
      labels(ranked),
      ['c-large', 'c-mid', 'c-small', 'd-small', 'd-mid', 'd-large'],
    )
    // Every contributor still precedes every detractor — that grouping falls
    // out of the magnitude order rather than being imposed on top of it,
    // because an exact zero is never plotted.
    const firstDetractor = ranked.findIndex((i) => i.direction === 'detractor')
    assert.ok(ranked.slice(0, firstDetractor).every((i) => i.direction === 'contributor'))
    assert.ok(ranked.slice(firstDetractor).every((i) => i.direction === 'detractor'))
  })

  test('direction follows the sign, and a residual keeps its own kind', () => {
    const short = MAIN.map((s) => (s.key === 'liq.rv' ? { ...s, cur: 1100 } : s))
    const { set } = setOf(short, 'top_level')
    for (const i of set.items) {
      assert.equal(i.direction, i.value > 0 ? 'contributor' : 'detractor')
    }
    assert.equal(set.items.filter((i) => i.kind === 'residual').length, 1)
    assert.ok(set.items.filter((i) => i.kind === 'component').length >= 2)
  })

  test('the order is deterministic when two components moved by the same amount', () => {
    const tie = [
      { ...stub('beta'), value: 100, direction: 'contributor' as const },
      { ...stub('alpha'), value: 100, direction: 'contributor' as const },
    ]
    assert.deepEqual(labels(rankContributions(tie)), ['alpha', 'beta'])
    assert.deepEqual(labels(rankContributions([...tie].reverse())), ['alpha', 'beta'])
  })

  test('the share is of the NET change, and is unanswerable rather than zero when the net is zero', () => {
    const { set } = setOf(MAIN, 'top_level')
    assert.equal(set.items.find((i) => i.labelEs === 'Renta Variable')?.shareOfNet, 0.75)
    assert.equal(set.items.find((i) => i.labelEs === 'Inmobiliario')?.shareOfNet, 0.45)
    assert.equal(set.items.find((i) => i.labelEs === 'Renta Fija')?.shareOfNet, -0.2)

    // The personal book's net change is exactly zero.
    const flat = setOf(PERSONAL, 'sociedad')
    assert.equal(flat.set.netChange, 0)
    assert.ok(flat.set.items.length > 0)
    for (const i of flat.set.items) {
      assert.equal(i.shareOfNet, null, 'a share of nothing is not 0 %')
    }
  })
})

function stub(label: string) {
  return {
    rowKey: label,
    labelEs: label,
    labelEn: null,
    kind: 'component' as const,
    shareOfNet: null,
    drillable: false,
    lifecycle: null,
    groupPath: [] as string[],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · The value axis
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · axis', () => {
  test('a nice 1 / 2 / 5 × 10ⁿ step, always containing an exact zero', () => {
    const axis = contributionAxis([150, 90, -40])
    assert.equal(axis.step, 50)
    assert.equal(axis.min, -50)
    assert.equal(axis.max, 150)
    assert.deepEqual(axis.ticks, [-50, 0, 50, 100, 150])
    assert.ok(axis.ticks.includes(0))
    assert.ok(Object.is(axis.ticks[axis.ticks.indexOf(0)], 0), 'the zero tick is exactly zero')
  })

  test('the step ADAPTS to the magnitude on screen — no interval fixed across periods', () => {
    const small = contributionAxis([150, 90, -40])
    const large = contributionAxis([150_000, 90_000, -40_000])
    const tiny = contributionAxis([1.5, 0.9, -0.4])
    assert.equal(large.step, small.step * 1000)
    assert.equal(tiny.step, small.step / 100)
    // Each of the three uses only 1, 2 or 5 × a power of ten.
    for (const a of [small, large, tiny]) {
      const mantissa = a.step / Math.pow(10, Math.floor(Math.log10(a.step)))
      assert.ok([1, 2, 5].includes(Math.round(mantissa)), `step ${a.step} is not a nice number`)
    }
  })

  test('the bounds only ever widen OUTWARD — a rounded axis can never crop a bar', () => {
    const cases = [
      [150, 90, -40],
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [-0.001, 0.002],
      [999_999, -1],
      [7],
      [-7],
    ]
    for (const values of cases) {
      const axis = contributionAxis(values)
      for (const v of values) {
        assert.ok(v >= axis.min, `${v} fell below the axis minimum ${axis.min}`)
        assert.ok(v <= axis.max, `${v} rose above the axis maximum ${axis.max}`)
      }
      assert.ok(axis.min <= 0 && axis.max >= 0, 'zero is always inside the domain')
    }
  })

  test('an all-positive set still anchors at zero, and an empty set invents no scale', () => {
    const up = contributionAxis([10, 20, 30])
    assert.equal(up.min, 0)
    assert.ok(up.max >= 30)
    const none = contributionAxis([])
    assert.deepEqual(none, { min: 0, max: 0, step: 0, ticks: [0] })
  })

  test('tick values carry no floating-point drift', () => {
    for (const axis of [contributionAxis([0.3, -0.1]), contributionAxis([0.07, -0.02])]) {
      for (const t of axis.ticks) {
        assert.equal(String(t).replace('-', '').length <= 8, true, `tick ${t} shows binary drift`)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3b · R13.R3C.3 — the asymmetric fit
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C.3 · asymmetric axis fit', () => {
  const M = 1_000_000

  /** The two extremes the axis has to contain, zero always inside. */
  const bounds = (v: readonly number[]) => ({
    hi: Math.max(0, ...v),
    lo: Math.min(0, ...v),
  })

  /** How much of the drawn domain the plotted range actually occupies. */
  const fillOf = (v: readonly number[]) => {
    const a = contributionAxis(v)
    const { hi, lo } = bounds(v)
    const domain = a.max - a.min
    return domain > 0 ? (hi - lo) / domain : 1
  }

  /** Every clean step near the data, costed the way the axis costs them. */
  function cleanScales(v: readonly number[]) {
    const { hi, lo } = bounds(v)
    const span = hi - lo
    const decade = Math.floor(Math.log10(span))
    const out: Array<{ step: number; intervals: number; fill: number }> = []
    for (let n = decade - 3; n <= decade + 2; n++) {
      for (const m of [1, 2, 5]) {
        const step = m * Math.pow(10, n)
        const up = hi > 0 ? Math.max(1, Math.ceil(hi / step - 1e-9)) : 0
        const down = -lo > 0 ? Math.max(1, Math.ceil(-lo / step - 1e-9)) : 0
        const intervals = up + down
        if (intervals < 2 || intervals > AXIS_MAX_INTERVALS) continue
        out.push({ step, intervals, fill: span / (intervals * step) })
      }
    }
    return out
  }

  // The shapes the owner asked for, plus the two real ones that prompted this.
  const SHAPES: Array<[string, number[]]> = [
    ['owner example — large positive, small negative', [15 * M, 6 * M, 2 * M, -2 * M]],
    ['the real Main / ALL week', [22 * M, 9 * M, 3 * M, -0.4 * M, -2 * M]],
    ['large positive, tiny negative', [20 * M, -100_000]],
    ['small positive, large negative', [1 * M, -18 * M]],
    ['only contributors', [12 * M, 5 * M, 1 * M]],
    ['only detractors', [-12 * M, -5 * M, -1 * M]],
    ['mixed near zero', [1_200, -800]],
    ['symmetric', [3 * M, -3 * M]],
    ['three orders of magnitude apart', [999_999, -1]],
    ['a single contributor', [7 * M]],
    ['a single detractor', [-7 * M]],
  ]

  test('each bound is the tightest clean gridline containing its OWN side', () => {
    // This IS the independence contract: `max` is a function of the largest
    // contributor and the step, `min` of the deepest detractor and the step.
    // Neither reads the other's magnitude, and neither is mirrored.
    for (const [name, values] of SHAPES) {
      const a = contributionAxis(values)
      const { hi, lo } = bounds(values)
      const up = hi > 0 ? Math.max(1, Math.ceil(hi / a.step - 1e-9)) : 0
      const down = -lo > 0 ? Math.max(1, Math.ceil(-lo / a.step - 1e-9)) : 0
      assert.equal(a.max, up * a.step, `${name}: upper bound is not its own side's gridline`)
      // `down === 0` is written out so the expectation is +0, not -0: an
      // all-contributors axis must anchor on a POSITIVE zero, and the suite
      // would otherwise be comparing against a value the module rejects.
      const expectedMin = down === 0 ? 0 : -down * a.step
      assert.equal(a.min, expectedMin, `${name}: lower bound is not its own side's gridline`)
      // Which means neither side can overshoot by a whole gridline — the
      // tightest a uniform grid can be without cropping.
      assert.ok(a.max - hi < a.step, `${name}: ${a.max - hi} of dead space above`)
      assert.ok(-a.min + lo < a.step, `${name}: ${-a.min + lo} of dead space below`)
    }
  })

  test('an asymmetric set gets an ASYMMETRIC domain — no forced mirror', () => {
    const a = contributionAxis([15 * M, 6 * M, 2 * M, -2 * M])
    assert.notEqual(Math.abs(a.min), a.max)
    assert.equal(a.max, 15 * M)
    assert.equal(a.min, -5 * M)
  })

  test('a small detractor no longer sinks the negative domain', () => {
    // The regression this pass exists for. Both bounds used to come off the
    // span ACROSS zero with the interval rounded up, so a large upside pushed
    // the downside out with it. On the real book that drew a −10M gridline
    // under a −2M bar: three quarters of the negative region was empty.
    const real = [22 * M, 9 * M, 3 * M, -0.4 * M, -2 * M]
    const a = contributionAxis(real)
    assert.equal(a.min, -5 * M, 'the negative bound still overshoots its own side')
    assert.equal(a.max, 25 * M)
    assert.ok(a.min > -10 * M, 'the pre-R13.R3C.3 bound came back')
    // And the deepest detractor now reaches well down its own half instead of
    // being a stub against a domain sized by the upside.
    assert.ok(Math.abs(-2 * M / a.min) >= 0.4)

    // The owner's own illustration: +15M against −2M must not reach −10M.
    assert.ok(contributionAxis([15 * M, -2 * M]).min > -10 * M)
  })

  test('the plot fills its domain — or nothing on a clean scale could', () => {
    for (const [name, values] of SHAPES) {
      const fill = fillOf(values)
      if (fill >= AXIS_MIN_FILL) continue
      // A shortfall is only acceptable when no clean step inside the gridline
      // budget does better. Checked by brute force, not asserted by fiat.
      const best = Math.max(...cleanScales(values).map((c) => c.fill))
      assert.ok(
        fill >= best - 1e-9,
        `${name}: filled ${(fill * 100).toFixed(0)}% when ${(best * 100).toFixed(0)}% was available`,
      )
    }
  })

  test('the fit is never LOOSER than the pre-R13.R3C.3 axis, and is usually tighter', () => {
    // The superseded rule, reproduced exactly, as the floor to beat.
    const previous = (values: readonly number[]) => {
      const { hi, lo } = bounds(values)
      const span = hi - lo
      if (!(span > 0)) return 1
      const raw = span / 4
      const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
      const multiple = [1, 2, 5, 10].find((m) => raw / magnitude <= m) ?? 10
      const step = magnitude * multiple
      return span / (Math.ceil(hi / step) * step - Math.floor(lo / step) * step)
    }
    let tighter = 0
    for (const [name, values] of SHAPES) {
      const now = fillOf(values)
      const before = previous(values)
      assert.ok(now >= before - 1e-9, `${name}: fit regressed from ${before} to ${now}`)
      if (now > before + 1e-9) tighter += 1
    }
    assert.ok(tighter >= 4, `only ${tighter} shapes improved`)
  })

  test('no bar is ever cropped, on either side, at any ratio', () => {
    // Deterministic sweep across four orders of magnitude and every ratio of
    // upside to downside, including the degenerate one-sided ones.
    let seed = 20260824
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 4000; i++) {
      const scale = Math.pow(10, Math.floor(rand() * 8) - 2)
      const up = rand() < 0.1 ? 0 : rand() * scale
      const down = rand() < 0.1 ? 0 : -rand() * scale
      const values = [up, down, up * rand(), down * rand()].filter((v) => v !== 0)
      if (values.length === 0) continue
      const a = contributionAxis(values)
      for (const v of values) {
        assert.ok(v >= a.min, `${v} fell below ${a.min}`)
        assert.ok(v <= a.max, `${v} rose above ${a.max}`)
      }
      assert.ok(a.min <= 0 && a.max >= 0)
      assert.ok(a.ticks.includes(0), 'zero left the axis')
      assert.ok(a.ticks.length >= 2 && a.ticks.length <= AXIS_MAX_INTERVALS + 1)
    }
  })

  test('zero stays visible, and a one-sided set invents no region on the other side', () => {
    const up = contributionAxis([12 * M, 5 * M, 1 * M])
    assert.equal(up.min, 0, 'an all-contributors period drew an empty negative region')
    assert.ok(up.max >= 12 * M)
    assert.ok(up.ticks.includes(0))

    const down = contributionAxis([-12 * M, -5 * M, -1 * M])
    assert.equal(down.max, 0, 'an all-detractors period drew an empty positive region')
    assert.ok(down.min <= -12 * M)
    assert.ok(down.ticks.includes(0))

    // Mirrored inputs give mirrored axes — no directional bias in the fit.
    assert.equal(down.min, -up.max)
    assert.equal(down.step, up.step)
  })

  test('the gridline budget holds, and every step is still 1 / 2 / 5 × 10ⁿ', () => {
    for (const [name, values] of SHAPES) {
      const a = contributionAxis(values)
      const intervals = Math.round((a.max - a.min) / a.step)
      assert.ok(intervals >= 2, `${name}: ${intervals} interval is a pair of bounds, not a scale`)
      assert.ok(intervals <= AXIS_MAX_INTERVALS, `${name}: ${intervals} gridline intervals`)
      const mantissa = Math.round(a.step / Math.pow(10, Math.floor(Math.log10(a.step))))
      assert.ok([1, 2, 5].includes(mantissa), `${name}: step ${a.step} is not a clean number`)
    }
  })

  test('K / M axis formatting is untouched — one unit, whole numbers, no decimals', () => {
    for (const [name, values] of SHAPES) {
      const a = contributionAxis(values)
      const unit = compactUnitForStep(a.step)
      const printed = a.ticks.map((t) => formatUsdCompactUnit(t, unit))
      for (const label of printed) {
        assert.ok(!label.includes(','), `${name}: "${label}" carries a decimal`)
        assert.ok(/^-?[\d.]+(M|K)?$/.test(label), `${name}: "${label}" is not a compact figure`)
      }
      // Zero is always bare, never `0M`, and the unit never changes mid-axis.
      assert.ok(printed.includes('0'))
      const suffixes = new Set(printed.filter((l) => l !== '0').map((l) => l.replace(/[-\d.]/g, '')))
      assert.ok(suffixes.size <= 1, `${name}: mixed units ${[...suffixes].join('/')}`)
    }
  })

  test('Summary and Weekly Changes share ONE axis, computed nowhere else', () => {
    for (const surface of [CARD, WEEKLY]) {
      const code = codeOf(read(surface))
      assert.match(code, /contributionAxis\(/, `${surface} does not use the shared axis`)
      // Neither surface may round a bound of its own — that is how two charts
      // of the same shape start disagreeing about their own scale.
      assert.ok(!/Math\.(ceil|floor)\([^)]*\/\s*step/.test(code), `${surface} rounds its own bound`)
      assert.ok(!/AXIS_MIN_FILL|NICE_MULTIPLES/.test(code), `${surface} re-implements the fit`)
    }
    // And the chart draws whatever it is handed — it never derives a domain.
    const chart = codeOf(read(CHART))
    assert.ok(!/contributionAxis\(/.test(chart), 'the chart computed its own axis')
    assert.match(chart, /axis\.min/)
    assert.match(chart, /axis\.max/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The frontier and the breakdown popup
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · breakdown', () => {
  test('a valueless label container is DESCENDED THROUGH, never shown as an empty child', () => {
    const { nodes } = book(MAIN, 'top_level')
    const kids = contributionChildren(nodes, 'alt.inm')
    assert.deepEqual(labels(kids.map((k) => k.node)), ['Fund A', 'Fund B'])
    // The sociedad it sits under is carried as context, not lost…
    assert.deepEqual(kids[0].groupPath, ['Watermill'])
    // …and never given a synthesised value of its own.
    assert.equal(nodes.find((n) => n.rowKey === 'alt.inm.wm')?.status, 'unavailable')
    assert.equal(nodes.find((n) => n.rowKey === 'alt.inm.wm')?.weeklyValueChange, null)
  })

  test('children reconcile EXACTLY to the clicked parent, at every level', () => {
    const { nodes } = book(MAIN, 'top_level')
    for (const [parent, expected] of [
      ['liq.rv', 150],
      ['liq.rf', -40],
      ['alt.inm', 90],
    ] as const) {
      const recon = reconcileContribution(nodes, parent)
      assert.equal(recon.status, 'ok', `${parent} must reconcile`)
      assert.equal(recon.parentChange, expected)
      assert.equal(recon.childSum, expected)
      assert.equal(recon.residual, 0)
    }
  })

  test('a leaf gets no drill affordance — the popup can only open on a real decomposition', () => {
    const { nodes } = book(MAIN, 'top_level')
    assert.equal(isContributionDrillable(nodes, 'liq.rv'), true)
    assert.equal(isContributionDrillable(nodes, 'alt.inm'), true)
    assert.equal(isContributionDrillable(nodes, 'liq.rv.g'), false, 'a sub-asset class is a leaf')
    const personal = book(PERSONAL, 'sociedad')
    assert.equal(isContributionDrillable(personal.nodes, 'prop'), false, 'Proporcional is a leaf')
    assert.equal(isContributionDrillable(personal.nodes, 'esp.total'), true, 'a sociedad total drills')
  })

  test('a sociedad TOTAL drills into its sociedad, not into its own empty child list', () => {
    const { nodes } = book(PERSONAL, 'sociedad')
    const kids = contributionChildren(nodes, 'esp.total')
    assert.deepEqual(labels(kids.map((k) => k.node)), ['Caja y Equivalentes', 'Renta Variable'])
    // The sociedad's own aggregate never appears beside its constituents.
    assert.ok(!labels(kids.map((k) => k.node)).includes('TOTAL LA ESPERANZA'))
    const recon = reconcileContribution(nodes, 'esp.total')
    assert.equal(recon.status, 'ok')
    assert.equal(recon.childSum, 0)
  })

  test('the recursion fabricates nothing — an unavailable child makes the sum indeterminate', () => {
    const broken = MAIN.map((s) => (s.key === 'alt.inm.wm.a' ? { ...s, cur: null } : s))
    const { nodes } = book(broken, 'top_level')
    const recon = reconcileContribution(nodes, 'alt.inm')
    assert.equal(recon.status, 'unavailable')
    assert.equal(recon.childSum, null, 'never a partial sum presented as the whole')
    assert.equal(recon.residual, null)
    assert.equal(recon.unavailableChildCount, 1)
  })

  test('a node with no published components reconciles to nothing, and says so', () => {
    const { nodes } = book(PERSONAL, 'sociedad')
    assert.deepEqual(contributionChildren(nodes, 'prop'), [])
    assert.equal(reconcileContribution(nodes, 'prop').status, 'unavailable')
    assert.ok(dict.en.fp.contrib.noDecomposition.length > 0)
    assert.ok(dict.es.fp.contrib.noDecomposition.length > 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Personal-portfolio subjects
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · subjects', () => {
  test('the subject list is the combined portfolio plus every sociedad-grain driver', () => {
    const { nodes, drivers } = book(PERSONAL, 'sociedad')
    const subjects = derivePortfolioSubjects(nodes, drivers)
    assert.equal(subjects[0].key, COMBINED_SUBJECT)
    assert.equal(subjects[0].labelEs, null, 'the combined subject is named by the UI, not the book')
    assert.deepEqual(subjects.slice(1).map((s) => s.labelEs), [
      'TOTAL LA ESPERANZA',
      'TOTAL NAIDELT',
      'Proporcional Otras Sociedades',
    ])
    // A leaf is still offered as a subject — it is a real component of the
    // book — but it reports honestly that it cannot be broken down.
    assert.deepEqual(subjects.map((s) => s.decomposable), [true, true, true, false])
  })

  test('Combined Portfolio reconciles across the sociedades', () => {
    const { set } = setOf(PERSONAL, 'sociedad')
    assert.equal(set.openingValue, 1000)
    assert.equal(set.closingValue, 1000)
    assert.equal(set.status, 'complete')
    assert.equal(set.residual, 0)
    // The zero-moving sociedad is omitted from the plot but not from the sum.
    assert.deepEqual(labels(set.items), ['TOTAL NAIDELT', 'Proporcional Otras Sociedades'])
    assert.deepEqual(values(set.items), [50, -50])
    assert.deepEqual(labels(set.omittedZero), ['TOTAL LA ESPERANZA'])
  })

  test('selecting a sociedad changes the SUBJECT — endpoints, change and bars all follow', () => {
    const combined = setOf(PERSONAL, 'sociedad')
    const esp = setOf(PERSONAL, 'sociedad', 'esp.total')
    const nai = setOf(PERSONAL, 'sociedad', 'nai.total')

    assert.equal(esp.set.openingValue, 500)
    assert.equal(esp.set.closingValue, 500)
    assert.deepEqual(labels(esp.set.items), ['Caja y Equivalentes', 'Renta Variable'])
    assert.deepEqual(values(esp.set.items), [20, -20])
    assert.equal(esp.set.status, 'complete')

    assert.equal(nai.set.openingValue, 300)
    assert.equal(nai.set.closingValue, 350)
    assert.equal(nai.set.netChange, 50)
    assert.deepEqual(labels(nai.set.items), ['Renta Fija'])

    // No two subjects share a headline — which is the point of the control.
    assert.notEqual(combined.set.openingValue, esp.set.openingValue)
    assert.notEqual(esp.set.openingValue, nai.set.openingValue)
  })

  test('a leaf subject keeps real endpoints and reports that it has no decomposition', () => {
    const prop = setOf(PERSONAL, 'sociedad', 'prop')
    assert.equal(prop.resolved.state, 'no_decomposition')
    assert.equal(prop.resolved.openingValue, 200)
    assert.equal(prop.resolved.closingValue, 150)
    assert.deepEqual(prop.resolved.components, [])
    // FOUND AGAINST THE HOSTED BOOK: with no components, a residual equal to
    // the subject's ENTIRE change would otherwise be synthesised — one bar
    // that decomposes nothing. There is no tiling for it to be the remainder
    // of, so no bar is emitted at all; the endpoints stay real for the KPIs.
    assert.deepEqual(prop.set.items, [])
    assert.equal(prop.set.netChange, -50)
    assert.equal(prop.set.status, 'partial', 'an empty set does not account for the change')
  })

  test('a subject absent from one endpoint is WITHHELD, never opened on a structural zero', () => {
    // Naidelt did not exist at the opening date.
    const late = PERSONAL.filter((s) => !s.key.startsWith('nai'))
      .concat(
        { key: 'nai', parent: null, type: 'sociedad_header', label: 'Naidelt' },
        { key: 'nai.rf', parent: 'nai', type: 'asset_class', label: 'Renta Fija', cur: 350 },
        { key: 'nai.total', parent: 'nai', type: 'sociedad_total', label: 'TOTAL NAIDELT', cur: 350 },
      )
    const { nodes, drivers, total } = book(late, 'sociedad')
    const resolved = resolveSubject(nodes, drivers, total, 'nai.total')
    assert.equal(resolved.lifecycle, 'new_position')
    assert.equal(resolved.state, 'lifecycle_gap')
    // …and the surface has wording for exactly that, in both languages.
    assert.match(dict.en.fp.overview.vwfSubjectLifecycle, /structural zero/)
    assert.match(dict.es.fp.overview.vwfSubjectLifecycle, /cero estructural/)
  })

  test('the combined subject withholds on the SAME rule, via the bound total row', () => {
    const late = MAIN.filter((s) => s.key !== 'total').concat({
      key: 'total',
      parent: null,
      type: 'portfolio_total',
      label: 'TOTAL',
      cur: 2200,
    })
    const { nodes, drivers, total } = book(late, 'top_level')
    const resolved = resolveSubject(nodes, drivers, total, COMBINED_SUBJECT)
    assert.equal(resolved.state, 'lifecycle_gap')
    assert.match(dict.en.fp.overview.vwfTotalRowLifecycle, /structural zero/)
  })

  // ── R13.R3C.1 · the owner-approved DISPLAY labels ────────────────────────

  test('a subject is offered under the owner-approved display name', () => {
    // The row's ROLE word is not part of the entity's name.
    assert.equal(subjectDisplayLabel('TOTAL LA ESPERANZA'), 'La Esperanza')
    assert.equal(subjectDisplayLabel('TOTAL NAIDELT'), 'Naidelt')
    assert.equal(subjectDisplayLabel('TOTAL LOS SAUZALES'), 'Los Sauzales')
    assert.equal(subjectDisplayLabel('TOTAL RETBOY'), 'Retboy')
    assert.equal(subjectDisplayLabel('TOTAL LOS LAURELES'), 'Los Laureles')
    assert.equal(subjectDisplayLabel('TOTAL VANGLOR'), 'Vanglor')
    // A name the source already cased is passed through, never re-cased.
    assert.equal(subjectDisplayLabel('Proporcional Otras Sociedades'), 'Proporcional Otras Sociedades')
    assert.equal(subjectDisplayLabel('Total Los Sauzales'), 'Los Sauzales')
    // A trailing qualifier describes the share carried, not the entity, and is
    // dropped from the NAME only — the figures under it stay the source's own.
    assert.equal(subjectDisplayLabel('Staten Capital (1/3)'), 'Staten Capital')
    // No rule may strip a subject to something the reader cannot read.
    assert.equal(subjectDisplayLabel('TOTAL'), 'Total')
    assert.equal(subjectDisplayLabel('(1/3)'), '(1/3)')
  })

  test('each member’s rail reads EXACTLY the owner-approved roster, in book order', () => {
    const roster = (spec: readonly Spec[], lang: 'en' | 'es') => {
      const { nodes, drivers } = book(spec, 'sociedad')
      return derivePortfolioSubjects(nodes, drivers).map((s) =>
        s.key === COMBINED_SUBJECT
          ? dict[lang].fp.overview.vwfSubjectCombined
          : subjectDisplayLabel((lang === 'en' && s.labelEn ? s.labelEn : s.labelEs) ?? s.key),
      )
    }

    assert.deepEqual(roster(JAIME, 'en'), ['Combined Portfolio', 'La Esperanza', 'Naidelt'])
    assert.deepEqual(roster(ANDRES, 'en'), [
      'Combined Portfolio', 'Los Sauzales', 'Retboy', 'Proporcional Otras Sociedades',
    ])
    assert.deepEqual(roster(PABLO, 'en'), [
      'Combined Portfolio', 'Los Laureles', 'Vanglor', 'Proporcional Otras Sociedades', 'Staten Capital',
    ])

    // The whole portfolio is named in full — never the bare adjective.
    assert.equal(dict.en.fp.overview.vwfSubjectCombined, 'Combined Portfolio')
    assert.equal(dict.es.fp.overview.vwfSubjectCombined, 'Portafolio Combinado')
    // Spanish differs only in that one translated pill; the sociedades are
    // proper nouns and read the same in both languages.
    assert.deepEqual(roster(PABLO, 'es').slice(1), roster(PABLO, 'en').slice(1))
  })

  test('the display name is not an identity — the rail selects on the source rowKey', () => {
    const { nodes, drivers, total } = book(PABLO, 'sociedad')
    const subjects = derivePortfolioSubjects(nodes, drivers)

    // What the app carries internally is the source's own row and label.
    assert.deepEqual(
      subjects.slice(1).map((s) => [s.key, s.labelEs]),
      [
        ['lau.total', 'TOTAL LOS LAURELES'],
        ['van.total', 'TOTAL VANGLOR'],
        ['prop', 'Proporcional Otras Sociedades'],
        ['staten', 'Staten Capital (1/3)'],
      ],
    )

    // A display name resolves NOTHING — it never was a key.
    for (const shown of ['Staten Capital', 'Los Laureles', 'La Esperanza']) {
      assert.equal(resolveSubject(nodes, drivers, total, shown).state, 'not_found', shown)
    }

    // The identifier behind that same pill resolves the subject, with the
    // fraction the source published still attached to the row it names.
    const staten = resolveSubject(nodes, drivers, total, 'staten')
    assert.equal(staten.labelEs, 'Staten Capital (1/3)')
    assert.equal(staten.openingValue, 150)
    assert.equal(staten.closingValue, 150)
  })

  test('relabelling every row moves no figure — labels are cosmetic all the way down', () => {
    // Same book, same keys, deliberately absurd labels.
    const relabelled = PABLO.map((s) => ({ ...s, label: `zzz ${s.key}` }))

    for (const subject of [COMBINED_SUBJECT, 'lau.total', 'staten']) {
      const real = setOf(PABLO, 'sociedad', subject)
      const fake = setOf(relabelled, 'sociedad', subject)
      assert.equal(real.resolved.state, fake.resolved.state, subject)
      assert.equal(real.resolved.openingValue, fake.resolved.openingValue, subject)
      assert.equal(real.resolved.closingValue, fake.resolved.closingValue, subject)
      assert.equal(real.set.netChange, fake.set.netChange, subject)
      assert.equal(real.set.status, fake.set.status, subject)
      assert.deepEqual(
        real.set.items.map((i) => [i.rowKey, i.value]),
        fake.set.items.map((i) => [i.rowKey, i.value]),
        subject,
      )
    }
  })

  test('both surfaces label the rail with the display name and select with the key', () => {
    // R13.R3C.2 — the pill now reads the SAME map the bars, the tooltip, the
    // footnote and the popup heading read (`subjectLabelOverrides`), so a pill
    // and the bar under it cannot say different things about one entity.
    for (const rel of [CARD, WEEKLY]) {
      const code = codeOf(read(rel))
      assert.match(code, /subjectLabelOverrides\(subjects, lang\)/, `${rel} must derive display names`)
      assert.match(code, /labelOverrides\.get\(s\.key\)/, `${rel} pill must read the display map`)
      assert.match(code, /value:\s*s\.key/, `${rel} must carry the SOURCE key as the pill's value`)
      assert.match(code, /vwfSubjectCombined/, `${rel} must name the whole portfolio from the dictionary`)
      // MAIN IS EXEMPT: its labels are the source's own, and title-casing a
      // shouted brand there would rewrite a real published name.
      assert.match(code, /NO_OVERRIDES/, `${rel} must give Main no display map`)
    }
    // Nothing in the data path knows the display rule exists.
    for (const rel of [PURE_CHART, 'src/lib/familyPortfolio/weeklyChanges.ts']) {
      assert.ok(
        !codeOf(read(rel)).includes('subjectDisplayLabel'),
        `${rel} must not consult a display label`,
      )
    }
  })

  test('NO sociedad name is hardcoded anywhere in source — the list is read from the book', () => {
    // The owner named La Esperanza, Naidelt, Los Sauzales, Retboy, Los
    // Laureles, Vanglor, Staten Capital and Proporcional Otras Sociedades.
    // Every one of them is verified against the published hierarchy at render
    // time; a literal here would be a label that could silently go stale.
    const names = /esperanza|naidelt|sauzales|retboy|laureles|vanglor|staten|proporcional/i
    for (const rel of [CHART, MODAL, CARD, WEEKLY, PURE_CHART, PURE_SUBJECT]) {
      assert.ok(!names.test(codeOf(read(rel))), `${rel} must not name a sociedad`)
    }
    // Comments are stripped: the dictionary's own prose legitimately RECORDS
    // which entity produced a real fail-closed case in the hosted book. What
    // must not exist is a sociedad name in a visible STRING.
    assert.ok(
      !names.test(codeOf(read('src/lib/i18n.ts'))),
      'no dictionary VALUE may name a sociedad — the rail reads them from the book',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Periods — real published endpoints only
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · periods', () => {
  const spine = [
    '2024-08-23', '2025-01-03', '2025-08-01', '2026-01-02',
    '2026-04-30', '2026-07-03', '2026-07-10', '2026-07-17',
    '2026-07-24', '2026-07-31',
  ].map((asOfDate) => ({ asOfDate }))

  test('the rail offers 1M / 3M / YTD / 1Y / ALL', () => {
    assert.deepEqual([...VALUE_CHANGE_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
  })

  test('every endpoint is a REAL published week — never a boundary date, never interpolated', () => {
    const published = new Set(spine.map((w) => w.asOfDate))
    for (const period of VALUE_CHANGE_PERIODS) {
      const r = selectValueChangeRange(spine, period)
      assert.equal(r.state, 'ok', `${period} must resolve`)
      assert.ok(published.has(r.fromDate as string), `${period} opened on an unpublished date`)
      assert.ok(published.has(r.toDate as string), `${period} closed on an unpublished date`)
      assert.ok((r.fromDate as string) < (r.toDate as string))
      // The boundary is a LOGICAL date and is never used as an endpoint unless
      // a week happens to fall exactly on it.
      if (r.boundary !== null && !published.has(r.boundary)) {
        assert.notEqual(r.fromDate, r.boundary)
      }
    }
  })

  test('the windows are the exact ones the record supports', () => {
    const at = (p: (typeof VALUE_CHANGE_PERIODS)[number]) => {
      const r = selectValueChangeRange(spine, p)
      return [r.fromDate, r.toDate, r.weekCount]
    }
    assert.deepEqual(at('1M'), ['2026-07-03', '2026-07-31', 5])
    assert.deepEqual(at('3M'), ['2026-04-30', '2026-07-31', 6])
    assert.deepEqual(at('YTD'), ['2026-01-02', '2026-07-31', 7])
    assert.deepEqual(at('1Y'), ['2025-08-01', '2026-07-31', 8])
    assert.deepEqual(at('ALL'), ['2024-08-23', '2026-07-31', 10])
  })

  test('the two Summary cards select the SAME window for the same period', () => {
    const points = spine.map((w) => ({ date: w.asOfDate, value: 1 }))
    for (const period of VALUE_CHANGE_PERIODS) {
      const change = selectValueChangeRange(spine, period)
      const evolution = selectEvolutionRange(points, period)
      assert.equal(change.fromDate, evolution.startDate, `${period} opening disagrees`)
      assert.equal(change.toDate, evolution.endDate, `${period} closing disagrees`)
    }
  })

  test('a period holding one week fails closed rather than reporting a flat zero', () => {
    const one = selectValueChangeRange([{ asOfDate: '2026-07-31' }], '1M')
    assert.equal(one.state, 'single_week')
    assert.equal(one.fromDate, null)
    assert.equal(selectValueChangeRange([], 'ALL').state, 'no_publications')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · One chart, two surfaces
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · one visualization, shared', () => {
  test('Summary and Weekly Changes render the SAME chart and the SAME popup', () => {
    for (const rel of [CARD, WEEKLY]) {
      const code = codeOf(read(rel))
      assert.match(code, /<ContributionChart/, `${rel} must render the shared chart`)
      assert.match(code, /<ContributionBreakdownModal/, `${rel} must render the shared popup`)
      assert.match(code, /buildContributionSet\(/)
      assert.match(code, /contributionAxis\(/)
    }
    // Summary mounts the card; the card owns the chart.
    assert.match(read(SUMMARY), /<PeriodValueChangeCard/)
  })

  test('no waterfall returns — not the component, not the bridge, not a rebuild', () => {
    for (const gone of [
      'src/components/familyPortfolio/ValueChangeWaterfall.tsx',
      'src/lib/familyPortfolio/valueChangeBridge.ts',
      'src/components/familyPortfolio/DivergingBarChart.tsx',
    ]) {
      assert.ok(!existsSync(join(ROOT, gone)), `${gone} must be deleted`)
    }
    for (const rel of [CHART, MODAL, CARD, WEEKLY, SUMMARY, PURE_CHART, PURE_SUBJECT]) {
      const code = codeOf(read(rel))
      assert.ok(!/ValueChangeWaterfall|valueChangeBridge|buildBridge|DivergingBarChart/.test(code),
        `${rel} must not reference a retired chart`)
    }
  })

  test('the card computes nothing itself — ranking and summing live in the pure module', () => {
    const code = codeOf(read(CARD))
    assert.ok(!/\.sort\(/.test(code), 'the card must not order the set')
    assert.ok(!/\.reduce\(/.test(code), 'the card must not sum anything')
    for (const fn of ['buildContributionSet(', 'contributionAxis(', 'resolveSubject(', 'derivePortfolioSubjects(']) {
      assert.ok(code.includes(fn), `the card must delegate to ${fn}`)
    }
  })

  test('the pure modules stay pure — no React, no fetch, no clock', () => {
    for (const rel of [PURE_CHART, PURE_SUBJECT]) {
      const src = read(rel)
      assert.ok(!/from 'react'|next\/|@supabase|process\.env/.test(src), `${rel} must import no runtime`)
      assert.ok(!/Date\.now\(\)|new Date\(/.test(codeOf(src)), `${rel} must hold no clock`)
      assert.ok(!/fetch\(/.test(codeOf(src)), `${rel} must not fetch`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Design-system compliance
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · design system', () => {
  test('every colour is a token — no hex, no Tailwind colour scale, no purple', () => {
    for (const rel of [CHART, MODAL, CARD]) {
      const src = read(rel)
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(codeOf(src)), `${rel} must not hardcode a hex colour`)
      assert.ok(!/\b(bg|text|border)-(gray|slate|zinc|emerald|red|blue|purple|violet)-\d{2,3}\b/.test(src),
        `${rel} must not use a raw Tailwind colour scale`)
      assert.ok(!/purple|violet/i.test(codeOf(src)), `${rel} must not introduce purple`)
    }
  })

  test('the approved signal tokens carry direction; the residual is deliberately neutral', () => {
    const src = read(CHART)
    assert.match(src, /return item\.direction === 'contributor' \? 'var\(--positive\)' : 'var\(--negative\)'/)
    assert.match(src, /if \(item\.kind === 'residual'\) return 'var\(--chart-neutral\)'/)
    // Gridlines and the axis use the chart tokens, not ad-hoc greys.
    assert.match(src, /var\(--chart-grid\)/)
    assert.match(src, /var\(--border-strong\)/)
  })

  test('the residual is tellable at a glance WITHOUT a new colour — hollow, everywhere', () => {
    const src = read(CHART)
    // The bar: dashed neutral outline over a translucent neutral fill.
    assert.match(src, /border: '1px dashed var\(--chart-neutral\)'/)
    assert.match(src, /color-mix\(in oklab, var\(--chart-neutral\) \d+%, transparent\)/)
    // And ONE helper gives every dot the same treatment, so the chart's tooltip
    // and the popup's rows can never disagree about what a residual looks like.
    assert.match(src, /export function contributionSwatchStyle/)
    assert.match(read(MODAL), /contributionSwatchStyle\(item\)/)
    assert.match(read(MODAL), /from '\.\/ContributionChart'/)
  })

  test('the drawing adapts on MEASURED column width, not on the bar count', () => {
    const src = read(CHART)
    // A three-bar chart must not draw slabs; a sixteen-bar one must keep a gap.
    assert.match(src, /const MAX_BAR_PX = \d+/)
    assert.match(src, /const barPx = Math\.min\(colPx \* BAR_FRACTION, MAX_BAR_PX\)/)
    // Long fund names stop being readable long before columns stop being
    // drawable, so the label band switches mode on the same measurement.
    assert.match(src, /const ROTATE_LABELS_BELOW_PX = \d+/)
    assert.match(src, /const rotateLabels = !verticalLabels && colPx < ROTATE_LABELS_BELOW_PX/)
    // A one-pixel bar still reads as a hovered COLUMN.
    assert.match(src, /var\(--chart-hover-column\)/)
  })

  test('R13.R3C.4 — a NARROW card stands its x labels fully upright, and a merely crowded one does not', () => {
    const src = read(CHART)
    // Three modes, narrowest first: upright below a narrow card, 45° below a
    // narrow COLUMN, two-line horizontal otherwise.
    assert.match(src, /const VERTICAL_LABELS_BELOW_PX = \d+/)
    assert.match(src, /const verticalLabels = viewW < VERTICAL_LABELS_BELOW_PX/)
    assert.match(src, /const rotateLabels = !verticalLabels && colPx/)
    assert.match(src, /transform: `translateX\(-\$\{VERTICAL_LABEL_LINE_PX \/ 2\}px\) rotate\(-90deg\)`/)

    // THE SIGNAL IS THE SCROLL CONTAINER, NOT THE PLOT — the distinction the
    // whole refinement rests on. The plot grows to whatever its bars need and
    // scrolls, so its width says nothing about the room the reader has; only
    // the container knows. It is measured by its own observer, on the element
    // that actually scrolls.
    assert.match(src, /const \[viewEl, setViewEl\] = useState<HTMLDivElement \| null>\(null\)/)
    assert.match(src, /new ResizeObserver\(\(\) => setViewW\(viewEl\.clientWidth\)\)/)
    assert.match(src, /ref=\{setViewEl\}\s*\n\s*className=\{`w-full overflow-x-auto/)
    // A desktop chart with sixteen bars is crowded, not narrow, so it keeps
    // its 45° labels: the upright mode can never be reached from `colPx`.
    assert.ok(!/verticalLabels = colPx/.test(src), 'upright mode must not key off column width')

    // Upright labels are confined to their own column, so they cannot cascade
    // into a neighbour — the band is a fixed height and the label is clipped
    // to a cap, with the full text on `title` exactly as the other two modes.
    assert.match(src, /const VERTICAL_BAND_PX = \d+/)
    assert.match(src, /const X_LABEL_VERTICAL_MAX_PX = \d+/)
    assert.equal((src.match(/title=\{label\}/g) ?? []).length, 3, 'every label mode keeps the full text')

    // Semantics untouched: the upright branch changes only how the label is
    // drawn — no reordering, no re-formatting, no second label source.
    assert.ok(!/verticalLabels \?[\s\S]{0,400}?\.sort\(/.test(src), 'the label mode must not reorder bars')
    assert.ok(!/verticalLabels[^\n]*formatUsd/.test(src), 'the label mode must not touch axis formatting')
  })

  test('the sr-only table is WRAPPED — an unwrapped one silently widens the page', () => {
    // REGRESSION GUARD, found in the browser. `sr-only` is
    // `position:absolute; width:1px; overflow:hidden; clip:rect(0,0,0,0)`, and
    // a TABLE refuses to lay out narrower than its own min-content width — so
    // `sr-only` on the <table> itself left a ~600px absolutely positioned box
    // whose containing block is the nearest POSITIONED ancestor, outside the
    // chart's own `overflow-x-auto`. The scroller's clip therefore did not
    // apply to it and it widened the whole page: measured 271px of horizontal
    // scroll at 390 and 14px at 1280, with nothing painted out there (the
    // `clip` still hid it), which is exactly how it would have shipped.
    //
    // This app has been bitten by an escaping `sr-only` descendant before —
    // see the notes in `AllocationDonut.tsx` and `PortfolioEvolutionChart.tsx`
    // — and both fixed it the same way: a block-level wrapper, which DOES
    // honour `width:1px` and contains the table with its own `overflow:hidden`.
    const src = read(CHART)
    assert.ok(!/<table className="sr-only"/.test(src), 'sr-only must not sit on the table itself')
    assert.match(src, /<div className="sr-only">\s*<table>/)
  })

  test('the plot is measured by a CALLBACK REF, so it attaches when the plot appears', () => {
    // REGRESSION GUARD. The chart returns early with no plot when every
    // component moved by exactly nothing — a real state on a quiet week. A
    // `useRef` + `[]`-dependency observer would run once against a null node
    // and never attach, leaving the chart on its seed width when a period
    // switch brought bars back; bar width AND the label mode are both decided
    // from that measurement, so it would then pick the wrong ones.
    const src = read(CHART)
    assert.match(src, /const \[plotEl, setPlotEl\] = useState<HTMLDivElement \| null>\(null\)/)
    assert.match(src, /ref=\{setPlotEl\}/)
    assert.match(src, /\}, \[plotEl\]\)/)
    assert.ok(!/useRef/.test(codeOf(src)), 'a plain ref cannot signal the effect')
    // The measurement is taken only from the observer callback — the project's
    // React-Compiler rule forbids a synchronous setState in an effect body.
    assert.ok(
      !/ro\.observe\(plotEl\)\s*\n\s*setPlotW\(/.test(src),
      'no synchronous setState in the effect body',
    )
  })

  test('the shared Fable primitives are reused rather than re-implemented', () => {
    const chart = read(CHART)
    const modal = read(MODAL)
    const card = read(CARD)
    assert.match(chart, /from '@\/components\/fable\/chart\/ChartTooltip'/)
    assert.match(modal, /from '@\/components\/fable\/ModalShell'/)
    assert.match(card, /from '@\/components\/fable\/SegmentedControl'/)
    assert.match(card, /from '@\/components\/fable\/GlassSurface'/)
    // The popup does not re-implement escape/focus/scroll-lock behaviour.
    assert.ok(!/useEscape|addEventListener\('keydown'/.test(codeOf(modal)))
    // The subject rail is the shared control, wrapped in the standard guard.
    assert.match(card, /max-w-full overflow-x-auto nv-scrollbar-hidden/)
    assert.match(read(WEEKLY), /max-w-full overflow-x-auto nv-scrollbar-hidden/)
  })

  test('type and radius come from the scale, and motion is the shared transition', () => {
    const chart = read(CHART)
    assert.match(chart, /ui-meta/)
    assert.match(chart, /ui-number/)
    assert.match(chart, /rounded-\[var\(--radius-cell\)\]|rounded-\[2px\]/)
    assert.match(chart, /nv-transition/)
    assert.ok(!/transition-\[|duration-\d+/.test(chart), 'motion must use the shared class, not ad-hoc utilities')
  })

  test('every visible string is a dictionary key, in both languages', () => {
    assert.deepEqual(Object.keys(dict.en.fp.contrib).sort(), Object.keys(dict.es.fp.contrib).sort())
    for (const [key, en] of Object.entries(dict.en.fp.contrib)) {
      const es = (dict.es.fp.contrib as Record<string, string>)[key]
      assert.ok(typeof en === 'string' && en.length > 0, `${key} must have EN copy`)
      assert.ok(typeof es === 'string' && es.length > 0, `${key} must have ES copy`)
      assert.notEqual(en, es, `${key} must actually be translated`)
    }
    for (const rel of [CHART, MODAL]) {
      const jsx = codeOf(read(rel)).replace(/className="[^"]*"/g, '')
      assert.ok(!/>\s*[A-Z][a-z]+ [a-z]+/.test(jsx), `${rel} must not embed an English sentence`)
    }
  })

  test('the card names the measure, and never calls it a return', () => {
    assert.equal(dict.en.fp.overview.vwfTitle, 'Contributors and Detractors of Portfolio Value Change')
    assert.match(dict.es.fp.overview.vwfTitle, /Contribuidores y Detractores/)
    // The actual-value-change disclosure is still on the card.
    assert.match(dict.en.fp.overview.vwfActualChip, /Contributions & withdrawals included/)
    assert.match(dict.en.fp.overview.vwfNote, /not an investment-return attribution/)
    assert.match(dict.es.fp.overview.vwfNote, /no una atribución de retorno/)
    // …and it is not silently relabelled as weekly performance.
    assert.ok(!/weekly/i.test(dict.en.fp.overview.vwfTitle))
    assert.ok(!/semanal/i.test(dict.es.fp.overview.vwfTitle))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · R13.R3C.2 — the owner-review presentation pass
//
// Ordering lives in section 2 and the display-name roster in section 5; this
// section covers the rest: the KPI strip's alignment contract, the compact
// number form, the tooltip's contents, the NAMED omission footnote, and the
// two Weekly Changes regions.
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C.2 · presentation', () => {
  // ── A · the Summary KPI strip ────────────────────────────────────────────

  test('all three KPI figures render through ONE block at ONE value size', () => {
    const code = read(CARD)
    // One `Figure` component, used three times: alignment by construction
    // rather than by keeping two markup shapes in step.
    assert.equal((code.match(/<Figure\b/g) ?? []).length, 3, 'opening, closing and change')
    assert.equal((code.match(/^function Figure\(/gm) ?? []).length, 1, 'exactly one block component')
    // Parity: the endpoints used to draw at `ui-card-value` (15px) while the
    // change drew at `ui-chart-headline` (23px). Now there is one size, and it
    // is the change's — the owner asked for the endpoints to come UP.
    assert.match(code, /ui-number ui-chart-headline \$\{tone\}/)
    assert.ok(!/ui-card-value/.test(codeOf(code)), 'no figure is left at the smaller value size')
    // Every block is label → value → meta, aligned from the top, so the three
    // headings sit on one line and the three values share a baseline.
    assert.match(code, /flex flex-wrap items-start gap-x-4/)
    assert.match(code, /ui-micro-label text-muted-fg whitespace-nowrap/)
    // The meta row is never dropped when empty — one missing date must not
    // shorten one column and break the row.
    assert.match(code, /\{meta \?\? '\\u00A0'\}/)
  })

  test('the change keeps its own tone, and its percentage travels with it', () => {
    const code = read(CARD)
    // `tone` applies to the value AND its meta line, so a figure reads in one
    // colour rather than a coloured amount over a grey percentage.
    assert.match(code, /tone === 'text-foreground' \? 'text-muted-fg' : `\$\{tone\} font-semibold`/)
    assert.match(code, /meta=\{formatRatioPct\(set\.netChangeRatio\)\}/)
    // The endpoints' meta is the REAL published date each was read from.
    assert.match(code, /meta=\{range\?\.fromDate != null \? formatIsoDateLabel\(range\.fromDate\) : null\}/)
    assert.match(code, /meta=\{range\?\.toDate != null \? formatIsoDateLabel\(range\.toDate\) : null\}/)
  })

  // ── B · compact whole-unit amounts ───────────────────────────────────────

  test('compact chart amounts are whole numbers with a unit that follows the value', () => {
    assert.equal(formatUsdCompactUnit(5_000_000), '5M')
    assert.equal(formatUsdCompactUnit(2_000_000), '2M')
    assert.equal(formatUsdCompactUnit(10_000), '10K')
    assert.equal(formatUsdCompactUnit(-100_000), '-100K')
    assert.equal(formatUsdCompactUnit(0), '0')
    // NO DECIMALS at either unit.
    for (const v of [1_234_567, -8_250_000, 987_654, -12_345, 1_500_000]) {
      assert.ok(!formatUsdCompactUnit(v).includes(','), `${v} must render without a decimal`)
    }
    // The unit is picked AFTER rounding, so the boundary never prints 1.000K.
    assert.equal(formatUsdCompactUnit(999_600), '1M')
    assert.equal(formatUsdCompactUnit(999_400), '999K')
    // Symmetric rounding: -1,5M and +1,5M must state the same magnitude.
    assert.equal(formatUsdCompactUnit(1_500_000), '2M')
    assert.equal(formatUsdCompactUnit(-1_500_000), '-2M')
    // Chilean grouping survives at four digits of unit.
    assert.equal(formatUsdCompactUnit(1_234_000_000), '1.234M')
    // Unavailable is never a zero.
    assert.equal(formatUsdCompactUnit(null), '—')
    assert.equal(formatUsdCompactUnit(Number.NaN), '—')
  })

  test('an AXIS reads in one unit; a lone figure picks its own', () => {
    // A per-value unit printed two ticks 500.000 apart as `1M` and `2M` on the
    // real book — the interval appeared to double when it had not changed.
    assert.equal(compactUnitForStep(10_000_000), 'M')
    assert.equal(compactUnitForStep(1_000_000), 'M')
    assert.equal(compactUnitForStep(500_000), 'K')
    assert.equal(compactUnitForStep(100_000), 'K')
    assert.equal(compactUnitForStep(50), 'ones')
    // A degenerate axis (nothing moved) never invents a unit.
    assert.equal(compactUnitForStep(0), 'ones')
    // Forced, the unit holds for every tick of that axis…
    const ticks = [-500_000, 0, 500_000, 1_000_000, 1_500_000]
    assert.deepEqual(
      ticks.map((v) => formatUsdCompactUnit(v, 'K')),
      ['-500K', '0', '500K', '1.000K', '1.500K'],
    )
    // …and zero is zero at every magnitude, never `0M`.
    assert.equal(formatUsdCompactUnit(0, 'M'), '0')
  })

  test('the axis and the tooltip both take the compact form, through the masked path', () => {
    const code = read(CHART)
    assert.match(code, /const axisUnit = compactUnitForStep\(axis\.step\)/)
    // R13.R5C.2 — `zeroDash={false}` added: THE ONE opt-out from the Portfolio
    // zero contract. This chart's every bar is anchored to the zero gridline,
    // and a baseline labelled `-` between `-2M` and `2M` would be read as a
    // stray minus sign. The masked path is unchanged, which is what this test
    // protects.
    assert.match(
      code,
      /<MaskedAmount value=\{tick\} masked=\{false\} compact="unit" compactUnit=\{axisUnit\} zeroDash=\{false\} \/>/,
    )
    // The opt-out is the AXIS's alone — the bar amounts take the mark.
    assert.equal((codeOf(code).match(/zeroDash=\{false\}/g) ?? []).length, 1)
    // The TOOLTIP is one figure, so it picks its own unit — no forced unit.
    const tipStart = code.indexOf('<ChartTooltip')
    assert.ok(!code.slice(tipStart, code.indexOf('</ChartTooltip>')).includes('compactUnit'))
    assert.equal(
      (codeOf(code).match(/compact="unit"/g) ?? []).length,
      2,
      'axis tick and tooltip amount',
    )
    // Still never formatted in the component itself — that would bypass the mask.
    assert.ok(!/formatUsd\w*\(/.test(codeOf(code)))
  })

  // ── C · the tooltip ──────────────────────────────────────────────────────

  test('the tooltip shows the amount and the share, and NOT the x-axis label', () => {
    const code = read(CHART)
    const open = code.indexOf('<ChartTooltip')
    const close = code.indexOf('</ChartTooltip>')
    assert.ok(open > 0 && close > open)
    const tip = code.slice(open, close)
    // The name is directly under the hovered column already.
    assert.ok(!tip.includes('contributionLabel('), 'the tooltip must not restate the label')
    assert.match(tip, /value=\{active\.value\}/)
    assert.match(tip, /c\.shareOfChange/)
    assert.match(tip, /active\.shareOfNet !== null \? formatRatioPct\(active\.shareOfNet\) : c\.shareUnavailable/)
    // …and the x-axis label it defers to is still rendered, in all THREE modes
    // (R13.R3C.4 added the upright one) plus the accessibility table.
    assert.equal((code.match(/contributionLabel\(bar, lang, labelOverrides\)/g) ?? []).length, 5)
  })

  // ── D · the NAMED omission footnote ──────────────────────────────────────

  test('the omission footnote names the components, and never invents one', () => {
    const copy = { template: dict.en.fp.contrib.zeroOmittedNames, more: dict.en.fp.contrib.zeroOmittedMore }
    const row = (k: string, es: string) => ({ rowKey: k, labelEs: es, labelEn: null })

    // Nothing omitted → no line at all, rather than an empty sentence.
    assert.equal(omittedZeroSentence([], 'en', copy), null)

    const one = omittedZeroSentence([row('a', 'Opciones')], 'en', copy) as string
    assert.match(one, /Opciones/)
    assert.ok(!/\{names\}/.test(one), 'the placeholder is filled')
    assert.ok(!/\d/.test(one), 'a single omission is named, not counted')

    // Several read as a clean list.
    const many = omittedZeroSentence(
      [row('a', 'Opciones'), row('b', 'Caja y Equivalentes')],
      'en',
      copy,
    ) as string
    assert.match(many, /Opciones, Caja y Equivalentes/)

    // A long list is capped for readability — and the overflow is COUNTED, so
    // capping never quietly shortens the disclosure.
    const lots = Array.from({ length: 9 }, (_, i) => row(`k${i}`, `Componente ${i}`))
    const capped = omittedZeroSentence(lots, 'en', copy) as string
    assert.match(capped, /Componente 0/)
    assert.match(capped, /Componente 5/)
    assert.ok(!capped.includes('Componente 6'), 'past the cap')
    assert.match(capped, /and 3 more/)
  })

  test('the footnote names entities the way the BARS name them', () => {
    const copy = { template: dict.en.fp.contrib.zeroOmittedNames, more: dict.en.fp.contrib.zeroOmittedMore }
    const { nodes, drivers } = book(PABLO, 'sociedad')
    const overrides = subjectLabelOverrides(derivePortfolioSubjects(nodes, drivers), 'en')
    const omitted = [{ rowKey: 'staten', labelEs: 'Staten Capital (1/3)', labelEn: null }]
    // Display name in the footnote, exactly as the bar and the pill carry it…
    assert.match(omittedZeroSentence(omitted, 'en', copy, overrides) as string, /Staten Capital\./)
    // …and the SOURCE label when this surface has no display map (Main).
    assert.match(omittedZeroSentence(omitted, 'en', copy) as string, /Staten Capital \(1\/3\)/)
  })

  test('both surfaces render the NAMED footnote, and the count-only one is gone', () => {
    for (const rel of [CARD, WEEKLY, MODAL]) {
      const code = read(rel)
      assert.match(code, /omittedZeroSentence\(/, `${rel} must compose the named footnote`)
      assert.ok(!code.includes('zeroOmitted.replace'), `${rel} must not count instead of naming`)
    }
    // The card and the page pass their display map; the modal's children are
    // asset classes, so it threads the map without needing one of its own.
    assert.match(read(CARD), /omittedZeroSentence\([\s\S]{0,200}labelOverrides,/)
    assert.match(read(WEEKLY), /omittedZeroSentence\([\s\S]{0,200}labelOverrides,/)
  })

  // ── E · display names on every VISIBLE surface ───────────────────────────

  test('a personal book shows display names on the bars, the axis and the popup heading', () => {
    const { nodes, drivers } = book(PABLO, 'sociedad')
    const overrides = subjectLabelOverrides(derivePortfolioSubjects(nodes, drivers), 'en')
    // What the reader sees for each sociedad-grain bar…
    for (const [key, shown] of [
      ['lau.total', 'Los Laureles'],
      ['van.total', 'Vanglor'],
      ['staten', 'Staten Capital'],
      ['prop', 'Proporcional Otras Sociedades'],
    ] as const) {
      const node = nodes.find((n) => n.rowKey === key)
      assert.ok(node !== undefined, key)
      assert.equal(contributionLabel(node, 'en', overrides), shown)
      // …never the raw source form.
      assert.ok(!contributionLabel(node, 'en', overrides).startsWith('TOTAL'))
    }
    // Without a map — Main — the source label stands, untouched.
    const laureles = nodes.find((n) => n.rowKey === 'lau.total')
    assert.equal(contributionLabel(laureles!, 'en'), 'TOTAL LOS LAURELES')
  })

  test('a row outside the sociedad roster is never re-cased by the display rule', () => {
    // The rule title-cases a shouted label, which is right for a sociedad
    // total and wrong for a shouted brand. Confining it to the map's KEYS is
    // what keeps `INRETAIL PERU CORP` intact wherever it appears.
    const overrides: ReadonlyMap<string, string> = new Map([['lau.total', 'Los Laureles']])
    const brand = { rowKey: 'inretail', labelEs: 'INRETAIL PERU CORP', labelEn: null }
    assert.equal(contributionLabel(brand, 'en', overrides), 'INRETAIL PERU CORP')
    // The residual has no row key at all and can never collide with the map.
    assert.equal(
      contributionLabel({ rowKey: null, labelEs: RESIDUAL.es, labelEn: RESIDUAL.en }, 'en', overrides),
      RESIDUAL.en,
    )
  })

  test('the chart, the popup and the a11y table all read the SAME display map', () => {
    const chart = codeOf(read(CHART))
    // Bars, all THREE x-axis modes (R13.R3C.4 added the upright one), and the
    // screen-reader table.
    assert.equal((chart.match(/contributionLabel\([^)]*labelOverrides\)/g) ?? []).length, 5)
    assert.match(codeOf(read(MODAL)), /contributionLabel\(parent, lang, labelOverrides\)/)
    for (const rel of [CARD, WEEKLY]) {
      assert.match(codeOf(read(rel)), /labelOverrides=\{labelOverrides\}/)
    }
  })

  // ── F · the Weekly Changes regions ───────────────────────────────────────

  test('the top block is ONE card, split by a rule, carrying the ledger and the headline', () => {
    // R13.R3C.4 — two cards became one. The *Total-level weekly metrics* card
    // between them was deleted outright: its YTD figures belong to Summary,
    // and its weekly P&L and flow are terms of the ledger.
    const page = read(WEEKLY)
    const row = page.slice(page.indexOf('items 2–3'), page.indexOf('§ 6h items 5–6'))
    assert.ok(row.length > 0, 'the combined block exists')
    for (const marker of ['<KpiHero', 'w.flowReconTitle']) {
      assert.ok(row.includes(marker), `${marker} belongs to the combined block`)
    }
    assert.ok(!row.includes('w.totalsTitle'), 'the metrics card is deleted, not moved')
    // ONE surface. The hero renders `bare` inside it rather than nesting a
    // second GlassSurface, which the material rules forbid outright.
    assert.equal((row.match(/<GlassSurface/g) ?? []).length, 1, 'one card, not two')
    assert.match(row, /<KpiHero\s*\n\s*bare/)
    // Weekly return stays the hero's own change chip, stated once.
    assert.match(row, /changeLabel=\{`\$\{formatRatioPct\(total\.weeklyReturn\)\}/)
    assert.equal((row.match(/o\.weeklyReturn/g) ?? []).length, 1, 'weekly return is stated once')
  })

  test('R13.R3C.4 — the ledger emphasises the week\'s ENDPOINTS, not its movements', () => {
    const page = read(WEEKLY)
    const row = page.slice(page.indexOf('items 2–3'), page.indexOf('§ 6h items 5–6'))
    // Exactly the two endpoint rows are `strong`; the two movements between
    // them are not — that is the whole emphasis rule, in one flag.
    assert.match(row, /\{ label: w\.previousValueLabel,[^}]*strong: true/)
    assert.match(row, /\{ label: w\.endingValueLabel,[^}]*strong: true/)
    assert.ok(!/\{ label: o\.weeklyProfit,[^}]*strong/.test(row), 'weekly P&L is not an endpoint')
    assert.ok(!/\{ label: w\.flowLabel,[^}]*strong/.test(row), 'net flows are not an endpoint')
    assert.equal((row.match(/strong: true/g) ?? []).length, 2)
    // And `strong` is what actually enlarges the figure, not just its label.
    assert.match(row, /r\.strong \? 'text-base font-semibold' : ''/)
    assert.match(row, /r\.strong \? 'text-sm' : 'text-xs'/)
  })

  test('R13.R3C.4 — no figure is stated twice in the combined block', () => {
    // The block's own reason for existing. Each of the five figures it shows
    // appears exactly once, and the two that are derivable from the others
    // (the change, and the return) live on the headline side only.
    const page = read(WEEKLY)
    const row = page.slice(page.indexOf('items 2–3'), page.indexOf('§ 6h items 5–6'))
    const code = row.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    for (const figure of [
      'flowRecon.previousValue',
      'flowRecon.profit',
      'flowRecon.flow',
      'flowRecon.actualCurrent',
      'total.weeklyValueChange',
    ]) {
      assert.equal(
        (code.match(new RegExp(figure.replace(/\./g, '\\.'), 'g')) ?? []).length,
        1,
        `${figure} must be stated exactly once`,
      )
    }
    // The retired year-to-date figures are not smuggled back in.
    for (const dead of ['ytdProfit', 'ytdReturn', 'expectedCurrent', 'impliedCurrent', 'publishedCurrent']) {
      assert.ok(!code.includes(dead), `${dead} must not appear in the weekly block`)
    }
  })

  test('increases sit ABOVE decreases, with the hierarchy chart beside them — and level with them', () => {
    const page = read(WEEKLY)
    const region = page.slice(page.indexOf('§ 6h items 5–6'))
    const inc = region.indexOf('w.increasesTitle')
    const dec = region.indexOf('w.decreasesTitle')
    const chart = region.indexOf('w.hierarchyTitle')
    assert.ok(inc >= 0 && dec > inc, 'decreases render directly after increases')
    assert.ok(chart > dec, 'the hierarchy card follows both, as the second column')
    // The two panels share ONE column; the chart is the other.
    const column = region.slice(0, chart)
    assert.match(column, /<div className="flex flex-col gap-4 min-w-0">/)
    // R13.R3C.4 — the row stretches, the hierarchy card fills its track, and
    // the slack lands in the PLOT rather than in padding beneath it, so the
    // chart ends level with the two ranked tables read as one block.
    assert.match(region, /grid-cols-1 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.15fr\)\] gap-4 items-stretch/)
    assert.match(region, /variant="card" className="p-4 flex flex-col gap-3 min-w-0 h-full"/)
    assert.match(region, /<div className="flex-1 min-h-0 flex flex-col">/)
    assert.match(region, /labelOverrides=\{labelOverrides\}\s*\n\s*fill\s*\n\s*\/>/)
  })

  test('R13.R3C.4 — `fill` grows the PLOT, keeps `height` as its floor, and changes nothing else', () => {
    const chart = read(CHART)
    // Off by default, so Summary's card draws exactly as it did.
    assert.match(chart, /fill = false,/)
    assert.match(chart, /height = 240,/)
    // In fill mode the plot is a flex child with the fixed height as a MINIMUM,
    // so a stacked one-column layout — which hands down no definite height —
    // still draws at the size it always did.
    assert.match(chart, /style=\{fill \? \{ minHeight: height \} : \{ height \}\}/)
    assert.equal((chart.match(/flex-1 min-h-0/g) ?? []).length, 4)
    // Geometry is untouched: every gridline and bar is still positioned as a
    // percentage of the plot's own height, so a taller plot is the same chart
    // at a larger scale rather than a different one.
    assert.match(chart, /const topPct = \(v: number\) =>/)
    assert.ok(!/fill \?[^\n]*topPct|fill \?[^\n]*bottom/.test(chart), 'fill must not touch bar geometry')
    // Summary's card never asks for it.
    assert.ok(!/\bfill\b/.test(codeOf(read(CARD))), 'the Summary card keeps the fixed-height plot')
  })

  test('the same ordering, formatting and label rules govern BOTH surfaces', () => {
    // One component, one pure ranker, one formatter — so a refinement made for
    // Summary cannot leave Weekly Changes behind.
    for (const rel of [CARD, WEEKLY]) {
      const code = codeOf(read(rel))
      assert.match(code, /<ContributionChart/)
      assert.match(code, /buildContributionSet\(/)
      assert.match(code, /contributionAxis\(/)
      assert.match(code, /labelOverrides=\{labelOverrides\}/)
    }
    // And neither surface ranks or formats anything itself.
    for (const rel of [CARD, WEEKLY, CHART]) {
      assert.ok(!codeOf(read(rel)).includes('rankContributions'), `${rel} must not re-rank`)
    }
  })
})
