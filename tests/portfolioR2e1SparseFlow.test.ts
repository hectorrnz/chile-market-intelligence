// R13.R2E.1 § 13 — behavioural tests for the OWNER-AUTHORITATIVE SPARSE-EVENT
// flow rule and the full-history flow-adjusted series it restores.
//
// THE CORRECTION UNDER TEST. Contributions and withdrawals are unusual events,
// so the source's flow field is a SPARSE EVENT field whose normal state is
// empty. R13.R2E read a blank cell as "unknown" and therefore cut Main's
// Including-Chilean-Equities flow-adjusted history to its final 32 weeks, purely
// because that basis' PERFORMANCE block was unmaintained before 2026. An
// unmaintained performance block means nobody computed that week's RETURN; it
// says nothing at all about whether capital moved. The corrected reading —
//
//     blank flow cell  → 0   (no contribution or withdrawal occurred)
//     numeric cell     → that flow
//     unreadable cell  → UNKNOWN, never 0
//
// — restores the full 102 weeks with no interpolation, no estimation and no
// inference from holdings.
//
// WHAT CARRIES THE RISK, and what each group proves:
//
//   * A BLANK AND AN UNKNOWN MUST NOT COLLAPSE ONTO EACH OTHER. Group 1 proves
//     they take opposite paths, in the pure module and in the route.
//   * WEEKLY P&L IS A CHECK, NOT AN INPUT (§ 3). Group 2 proves a week with no
//     stated P&L is still adjusted, and that where a P&L IS stated the step
//     reproduces it exactly.
//   * NO FLOW MAY BE SUBTRACTED TWICE, AND NONE MAY BE INFERRED (§§ 6-7).
//     Group 3 pins the event count, the internal-trading boundary, and the
//     absence of any share-count inference anywhere in the code.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildFlowAdjustedSeries,
  attachFlows,
  netFlowOf,
  type FlowObservation,
} from '../src/lib/familyPortfolio/flowAdjustedEvolution.ts'
import {
  EVOLUTION_PERIODS,
  selectEvolutionRange,
  sharedEndpoint,
  valueChange,
} from '../src/lib/familyPortfolio/evolutionRange.ts'
import { highWaterMarket } from '../src/lib/familyPortfolio/highWaterMarket.ts'
import { dict } from '../src/lib/i18n.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/family-portfolio/page.tsx')
const ROUTE = read('src/app/api/family-portfolio/overview/[scope]/route.ts')
const PURE = read('src/lib/familyPortfolio/flowAdjustedEvolution.ts')
const READ_REPO = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
const DOC = read('docs/portfolio-r13/02-resumen-source-contract.md')

/**
 * A 102-week record in the exact shape of Main's Including-Chilean-Equities
 * basis: weekly levels for the whole span, but a flow figure stated only in the
 * final 32 weeks — and, within those, only a handful of real events. Everything
 * earlier is a blank sparse-event cell.
 *
 * Built so `Δvalue = weekly_profit + flow` holds by construction, exactly as the
 * publication contract guarantees for the live book.
 */
const WEEKS = 102
const LATE_BLOCK_FROM = WEEKS - 32 // index of the first week whose block is maintained
const WEEKLY_PROFIT = 10
/** The only real capital events, all inside the maintained block. */
const EVENTS = new Map<number, number>([
  [WEEKS - 20, 500],
  [WEEKS - 8, -300],
])

const RECORD: FlowObservation[] = (() => {
  const out: FlowObservation[] = []
  const start = Date.UTC(2024, 7, 23) // 2024-08-23, the real record's own first Friday
  let value = 1000
  for (let i = 0; i < WEEKS; i++) {
    const date = new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10)
    if (i === 0) {
      out.push({ date, value })
      continue
    }
    const flow = EVENTS.get(i) ?? 0
    value = value + WEEKLY_PROFIT + flow
    // BEFORE the block was maintained the cell is BLANK — no flow row at all
    // reaches the client. From it on, the source states a figure every week,
    // which is 0 in a week where no money moved.
    out.push(i < LATE_BLOCK_FROM ? { date, value } : { date, value, flow })
  }
  return out
})()

const ADJUSTED = buildFlowAdjustedSeries(RECORD)

// ═══════════════════════════════════════════════════════════════════════════
// 1 · § 2 — a blank flow is ZERO; only an unreadable one is unknown
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.1 § 2 — the sparse-event flow rule', () => {
  test('a genuinely blank flow reads as zero', () => {
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1 }), 0, 'absent property')
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: null }), 0, 'explicit null')
  })

  test('a stated numeric flow reads as exactly that flow, zero included', () => {
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: 500 }), 500)
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: -300 }), -300)
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: 0 }), 0)
  })

  test('a malformed, errored or explicitly unavailable flow is UNKNOWN, never zero', () => {
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: null, flowUnavailable: true }), null)
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: 7, flowUnavailable: true }), null)
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: Number.NaN }), null)
    assert.equal(netFlowOf({ date: '2026-01-02', value: 1, flow: Number.POSITIVE_INFINITY }), null)
  })

  test('unknown and blank take OPPOSITE paths through the series builder', () => {
    const at = 50
    const blank = buildFlowAdjustedSeries(RECORD.map((p, i) => (i === at ? { ...p, flow: null } : p)))
    const unknown = buildFlowAdjustedSeries(
      RECORD.map((p, i) => (i === at ? { ...p, flow: null, flowUnavailable: true } : p)),
    )
    assert.equal(blank.points.length, WEEKS, 'a blank costs the series nothing')
    assert.equal(blank.adjustableFrom, null)
    assert.equal(unknown.points.length, WEEKS - at, 'an unknown truncates to the covered suffix')
    assert.equal(unknown.adjustableFrom, RECORD[at].date)
  })

  test('the route routes an unreadable flow to the unknown set and NOTHING to zero', () => {
    const code = codeOf(ROUTE)
    assert.match(
      code,
      /point\.value === null \|\| !Number\.isFinite\(point\.value\) \|\| point\.valueClass === 'unavailable'/,
    )
    assert.match(code, /unavailable\.add\(key\)/)
    assert.match(code, /flowUnavailable: true/)
    assert.ok(!/flow[^\n]*\?\? 0/.test(code), 'no flow may be coerced with ?? 0')
    // The zero reading is the pure module's, where it is documented and tested —
    // never an undocumented coalesce at the transport boundary.
    assert.ok(!/flow: 0/.test(code), 'the route must not hard-code a zero flow')
  })

  test('the read layer carries the value CLASS, so unreadable cannot look blank', () => {
    assert.match(READ_REPO, /value_class: string \| null/)
    assert.match(READ_REPO, /\.select\('publication_id, basis, value, value_class'\)/)
    assert.match(READ_REPO, /valueClass: r\.value_class \?\? null/)
  })

  test('the rule is documented in the source contract, with its census and its exclusions', () => {
    assert.match(DOC, /sparse-event rule/i)
    assert.match(DOC, /independently of whether the neighbouring performance metrics were maintained/i)
    for (const excluded of ['error', 'malformed', 'ambiguous', 'unavailable']) {
      assert.ok(new RegExp(excluded, 'i').test(DOC), `${excluded} must be named as NOT zero`)
    }
    // The workbook census that makes the rule a finding rather than an assertion.
    assert.match(DOC, /477/)
    assert.match(DOC, /literal `0` \| \*\*0\*\*/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · §§ 3-4 — full history, built from levels and flows alone
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.1 §§ 3-4 — weekly P&L is a check, not an input', () => {
  test('the whole record is adjusted, not merely the weeks with a maintained block', () => {
    assert.equal(RECORD.length, WEEKS)
    assert.equal(ADJUSTED.points.length, WEEKS, 'all 102, not the 32 of the maintained block')
    assert.equal(ADJUSTED.anchorDate, RECORD[0].date)
    assert.equal(ADJUSTED.omittedLeading, 0)
    assert.equal(ADJUSTED.adjustableFrom, null)
  })

  test('every plotted date is a real source date and none is invented', () => {
    const source = new Set(RECORD.map((p) => p.date))
    for (const p of ADJUSTED.points) assert.ok(source.has(p.date), `${p.date} is not a source date`)
    assert.equal(new Set(ADJUSTED.points.map((p) => p.date)).size, WEEKS)
  })

  test('a week with NO stated weekly P&L is still adjusted, from levels and flow alone', () => {
    // The first 70 weeks are exactly that case: no performance block, so no
    // stated P&L anywhere in them. Each step must still move by the week's own
    // profit, which the step-wise identity of § 3 recovers without it.
    for (let i = 1; i < LATE_BLOCK_FROM; i++) {
      const step = ADJUSTED.points[i].value - ADJUSTED.points[i - 1].value
      assert.ok(Math.abs(step - WEEKLY_PROFIT) < 1e-9, `week ${i} step ${step}`)
    }
  })

  test('the step-wise and cumulative constructions agree exactly (§ 3)', () => {
    // AdjustedValue[t] = AdjustedValue[t-1] + (Actual[t] − Actual[t-1] − NetFlow[t])
    const stepwise: number[] = [RECORD[0].value]
    for (let i = 1; i < RECORD.length; i++) {
      stepwise.push(
        stepwise[i - 1] + RECORD[i].value - RECORD[i - 1].value - (netFlowOf(RECORD[i]) as number),
      )
    }
    for (let i = 0; i < WEEKS; i++) {
      assert.ok(Math.abs(ADJUSTED.points[i].value - stepwise[i]) < 1e-9, `week ${i}`)
    }
  })

  test('where a weekly P&L IS stated, the step reproduces it exactly', () => {
    for (let i = LATE_BLOCK_FROM; i < WEEKS; i++) {
      const step = ADJUSTED.points[i].value - ADJUSTED.points[i - 1].value
      assert.ok(Math.abs(step - WEEKLY_PROFIT) < 1e-9, `week ${i}`)
    }
  })

  test('the raw line jumps on the events; the adjusted line does not', () => {
    for (const [i, amount] of EVENTS) {
      const raw = RECORD[i].value - RECORD[i - 1].value
      assert.ok(Math.abs(raw - (WEEKLY_PROFIT + amount)) < 1e-9, 'the raw step carries the capital')
      const adj = ADJUSTED.points[i].value - ADJUSTED.points[i - 1].value
      assert.ok(Math.abs(adj - WEEKLY_PROFIT) < 1e-9, 'the adjusted step does not')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · §§ 4, 6, 7, 9, 11 — stability, event integrity, no inference
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.1 §§ 4, 6, 7 — stable slices, exact events, no inference', () => {
  test('one date holds one value under EVERY range selection', () => {
    const endpoint = ADJUSTED.points[ADJUSTED.points.length - 1].date
    const seen = new Set<number>()
    for (const period of EVOLUTION_PERIODS) {
      const slice = selectEvolutionRange(ADJUSTED.points, period)
      const last = slice.points[slice.points.length - 1]
      assert.equal(last.date, endpoint, `${period} must end at the record's endpoint`)
      seen.add(last.value)
    }
    assert.equal(seen.size, 1, 'the same date must not change value across ranges')
  })

  test('no flow is subtracted twice — the total removed is exactly the events', () => {
    const expected = [...EVENTS.values()].reduce((a, b) => a + b, 0)
    assert.equal(ADJUSTED.netFlowExcluded, expected)
    // And the endpoint gap between the actual and adjusted paths is that same
    // figure, once. A double subtraction would show up here as 2×.
    const actualEnd = RECORD[WEEKS - 1].value
    const adjustedEnd = ADJUSTED.points[WEEKS - 1].value
    assert.equal(actualEnd - adjustedEnd, expected)
  })

  test('every stated event survives exactly once, and no unstated one appears', () => {
    // Reconstruct the flows the path actually removed, week by week.
    const removed: Array<[number, number]> = []
    for (let i = 1; i < WEEKS; i++) {
      const rawStep = RECORD[i].value - RECORD[i - 1].value
      const adjStep = ADJUSTED.points[i].value - ADJUSTED.points[i - 1].value
      const flow = rawStep - adjStep
      if (Math.abs(flow) > 1e-9) removed.push([i, flow])
    }
    assert.equal(removed.length, EVENTS.size, 'no extra event was invented')
    for (const [i, flow] of removed) {
      assert.ok(EVENTS.has(i), `week ${i} was not a stated event`)
      assert.ok(Math.abs(flow - (EVENTS.get(i) as number)) < 1e-9, `week ${i} amount`)
    }
  })

  test('internal trading is never inferred as an external flow (§ 7)', () => {
    // No holdings, share count, quantity or price signal may reach the adjuster
    // — it reads published levels and published flows and nothing else.
    for (const banned of ['share', 'holding', 'quantity', 'shares_outstanding', 'price']) {
      assert.ok(!new RegExp(banned, 'i').test(codeOf(PURE)), `${banned} must not drive the adjustment`)
    }
    // And the correction that was proposed and then rejected must not exist.
    for (const src of [codeOf(PURE), codeOf(PAGE), codeOf(ROUTE)]) {
      assert.ok(!/shareCount|acciones_shares|inferFlow/i.test(src))
    }
  })

  test('no interpolation, smoothing or clock anywhere in the adjuster', () => {
    const pure = codeOf(PURE)
    for (const banned of ['interpolat', 'smooth', 'carryForward', 'fillGap', 'resample', 'estimate']) {
      assert.ok(!new RegExp(banned, 'i').test(pure), `${banned} must not appear`)
    }
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(pure), 'the module must read no clock')
  })

  test('attachFlows leaves a blank week blank and marks only the unreadable ones', () => {
    const attached = attachFlows(
      [
        { date: '2026-01-02', value: 1000 },
        { date: '2026-01-09', value: 1100 },
        { date: '2026-01-16', value: 1200 },
      ],
      new Map([['2026-01-09', 50]]),
      new Set(['2026-01-16']),
    )
    assert.equal(attached[0].flow, null)
    assert.equal(attached[0].flowUnavailable, undefined)
    assert.equal(attached[1].flow, 50)
    assert.equal(attached[2].flowUnavailable, true)
    // Blank still means zero once it reaches the adjuster.
    assert.equal(netFlowOf(attached[0]), 0)
    assert.equal(netFlowOf(attached[2]), null)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · §§ 9-11 — Compare over the full history, HWM on the adjusted path
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2E.1 §§ 9-11 — Compare and the High Water Market', () => {
  /** A second basis over the identical span — the Main Excl. shape. */
  const OTHER = buildFlowAdjustedSeries(
    RECORD.map((p, i) => ({ date: p.date, value: p.value * 0.8, flow: i === 0 ? undefined : 0 })),
  )

  test('both Main bases reach the same endpoint, so Compare spans the full record', () => {
    assert.equal(ADJUSTED.points.length, WEEKS)
    assert.equal(OTHER.points.length, WEEKS)
    const end = sharedEndpoint(ADJUSTED.points, OTHER.points)
    assert.equal(end, RECORD[WEEKS - 1].date)
    const all = selectEvolutionRange(ADJUSTED.points, 'ALL', end)
    assert.equal(all.points.length, WEEKS)
    assert.equal(all.points[0].date, RECORD[0].date)
  })

  test('Compare pairs two ADJUSTED lines — an adjusted line is never paired with a raw one', () => {
    // Both range selections read the adjusted series; neither reads the raw one.
    assert.match(PAGE, /selectEvolutionRange\(inclAdjusted\.points, safePeriod, endpointOverride\)/)
    assert.match(PAGE, /selectEvolutionRange\(exclAdjusted\.points, safePeriod, endpointOverride\)/)
    assert.match(PAGE, /sharedEndpoint\(inclAdjusted\.points, exclAdjusted\.points\)/)
  })

  test('the High Water Market sits on the ADJUSTED path and on a real source date', () => {
    const peak = highWaterMarket(ADJUSTED.points)
    assert.ok(peak !== null)
    const rawPeak = highWaterMarket(RECORD.map((p) => ({ date: p.date, value: p.value })))
    assert.ok(rawPeak !== null)
    assert.notEqual(peak.value, rawPeak.value, 'the raw peak includes the contribution')
    assert.ok(
      RECORD.some((p) => p.date === peak.date),
      'the High Water Market date must be a real observation',
    )
  })

  test('the visible term stays `High Water Market` and claims no AUM maximum', () => {
    for (const o of [dict.en.fp.overview, dict.es.fp.overview]) {
      assert.equal(o.hwmLabel, 'High Water Market')
      assert.ok(!/maximum observed portfolio value|valor máximo observado del portafolio/i.test(o.hwmTooltip))
    }
  })

  test('period Value Change is measured between the slice\'s own endpoints', () => {
    const slice = selectEvolutionRange(ADJUSTED.points, '3M')
    const change = valueChange(slice.points)
    const first = slice.points[0].value
    const last = slice.points[slice.points.length - 1].value
    assert.ok(Math.abs(change.absolute - (last - first)) < 1e-9)
  })
})
