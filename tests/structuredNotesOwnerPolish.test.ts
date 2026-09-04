// R13.7B2.2.1 — FINAL OWNER VISUAL POLISH, Structured Notes detail page.
//
// Covers the § 9 checklist A–H. Everything B2.2 established (one display row
// per valuation date, decimal-fraction percentages, the correct coupon rate,
// the called-state hero, settlement-aware notional, the normalized gauge's
// stated basis, the visible legend, the worst-leg explanation, no enum
// leakage) is asserted by tests/structuredNotesScheduleDisplay.test.ts and
// tests/structuredNotesAlertAccess.test.ts and is NOT duplicated here — this
// file guards only what B2.2.1 changed, and that it changed nothing else.
//
// Pure: no Supabase, no network, no Next.js runtime.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { mergeCoincidingMarks, markLevelKey, isCouponKnockInMark, isInitialCallMark, KIND_SEVERITY } from '../src/lib/structuredNotes/gaugeMarks.ts'
import { buildScheduleRows } from '../src/lib/structuredNotes/observationSchedule.ts'
import { buildReviewFixture, CALLED_PENDING_FIXTURE_ID, CALLED_SETTLED_FIXTURE_ID } from '../src/lib/structuredNotes/fixtures/calledStateFixture.ts'
import { dedupeObservationsByDate } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'
import { dict } from '../src/lib/i18n.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const DETAIL = read('../src/app/structured-notes/[id]/page.tsx')
const GAUGE = read('../src/components/fable/BarrierGauge.tsx')
const CSS = read('../src/app/globals.css')
const DESIGN = read('../docs/design_principles.md')
const WORKFLOW = read('../.github/workflows/structured-notes-event-state.yml')

/** The page's own progress rule, restated here so the test fails if the page and this definition ever diverge. */
const isObservedState = (s: string) => s === 'observed' || s === 'called' || s === 'matured'

// ═════════════════════════════════════════════════════════════════════════════
// A · NO INNER SCROLL
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 1 — the Observation Schedule renders in full, without an inner scroll region', () => {
  it('A · no TableCard on the detail page caps its height', () => {
    assert.ok(!/maxHeight=\{/.test(DETAIL), 'maxHeight would create an inner vertical scroll region')
    assert.ok(!/overflowY/.test(DETAIL), 'no inline vertical scroll container')
  })

  it('A · the schedule card keeps card-level HORIZONTAL containment (never page overflow)', () => {
    // The schedule TableCard still declares its minWidth so a narrow viewport
    // scrolls the table inside the card rather than the page.
    const from = DETAIL.indexOf('title={t.sn.schedule}')
    const block = DETAIL.slice(from, DETAIL.indexOf('<table', from))
    assert.match(block, /minWidth=\{680\}/)
  })

  it('A · every display row is rendered — the fixture produces all eight rows from one generator', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    assert.equal(rows.length, 8)
    assert.equal((DETAIL.match(/scheduleRows\.map\(\(r\) =>/g) ?? []).length, 1, 'exactly one row generator, no slicing')
    assert.ok(!/scheduleRows\.slice\(/.test(DETAIL), 'rows are never truncated')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// B · PROGRESS COUNTER = DISPLAY ROWS
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 4 — the observation-summary header counts display rows, not canonical records', () => {
  it('B · the page derives both numerator and denominator from scheduleRows', () => {
    assert.match(DETAIL, /const observedCount = scheduleRows\.filter\(\(r\) => r\.state === 'observed' \|\| r\.state === 'called' \|\| r\.state === 'matured'\)\.length/)
    assert.match(DETAIL, /value: `\$\{observedCount\} \/ \$\{scheduleRows\.length\}`/)
    assert.ok(!DETAIL.includes('deduped.length}'), 'the canonical record count must not appear in the counter')
    assert.ok(!DETAIL.includes('t.sn.monitoring.observedAt'), 'the old "Observed" anchor is retired on this page')
    assert.ok(DETAIL.includes('t.sn.obsProgress'))
  })

  it('B · for XS3164820824 the counter reads 1 / 8 — one evaluated date of eight, with seven void', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const deduped = dedupeObservationsByDate(note.observations)
    const rows = buildScheduleRows(deduped)
    const observed = rows.filter((r) => isObservedState(r.state)).length
    const voided = rows.filter((r) => r.state === 'void').length
    assert.equal(deduped.length, 15, 'the canonical model still holds 15 records')
    assert.equal(rows.length, 8)
    assert.equal(observed, 1)
    assert.equal(voided, 7)
    // The old counter would have said 8/15 — both numbers wrong for the owner's question.
    assert.notEqual(`${observed} / ${rows.length}`, '8 / 15')
  })

  it('B · void-after-call dates are NOT counted as observed', () => {
    const { note } = buildReviewFixture(CALLED_SETTLED_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    for (const r of rows.filter((x) => x.state === 'void')) assert.ok(!isObservedState(r.state))
  })

  it('B · the label and its help text exist in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].sn.obsProgress.length > 0)
      assert.ok(dict[lang].sn.obsProgressHelp.length > 0)
    }
    assert.equal(dict.en.sn.obsProgress, 'Observed dates')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// C · COINCIDING MARKS COLLAPSE (pure helper)
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 2 — mergeCoincidingMarks', () => {
  it('C · marks at the same normalized level collapse to one mark that remembers every kind', () => {
    const merged = mergeCoincidingMarks([
      { kind: 'knockIn', level: 65 },
      { kind: 'coupon', level: 65 },
      { kind: 'autocall', level: 100 },
      { kind: 'strike', level: 100 },
    ])
    assert.equal(merged.length, 2)
    assert.deepEqual(merged.map((m) => m.level), [65, 100])
    assert.deepEqual(merged[0].kinds, ['knockIn', 'coupon'])
    assert.deepEqual(merged[1].kinds, ['autocall', 'strike'])
  })

  it('C · the surviving kind is the most severe present, regardless of input order', () => {
    const merged = mergeCoincidingMarks([
      { kind: 'strike', level: 100 },
      { kind: 'autocall', level: 100 },
      { kind: 'coupon', level: 65 },
      { kind: 'knockIn', level: 65 },
    ])
    assert.equal(merged[0].kind, 'knockIn', 'the 65 tick must stay a knock-in so proximity colouring keeps working')
    assert.equal(merged[1].kind, 'autocall', 'the 100 tick reads as the call level')
    assert.ok(KIND_SEVERITY.knockIn < KIND_SEVERITY.coupon && KIND_SEVERITY.coupon < KIND_SEVERITY.autocall && KIND_SEVERITY.autocall < KIND_SEVERITY.strike)
  })

  it('C · marks at DIFFERENT levels are never merged', () => {
    const merged = mergeCoincidingMarks([
      { kind: 'knockIn', level: 60 },
      { kind: 'coupon', level: 70 },
      { kind: 'autocall', level: 105 },
      { kind: 'strike', level: 100 },
    ])
    assert.equal(merged.length, 4)
    assert.deepEqual(merged.map((m) => m.level), [60, 70, 100, 105])
    assert.ok(merged.every((m) => m.kinds.length === 1))
  })

  it('C · sub-hundredth differences merge; anything larger does not', () => {
    assert.equal(mergeCoincidingMarks([{ kind: 'coupon', level: 65.004 }, { kind: 'knockIn', level: 64.996 }]).length, 1)
    assert.equal(mergeCoincidingMarks([{ kind: 'coupon', level: 65.01 }, { kind: 'knockIn', level: 65 }]).length, 2)
    assert.equal(markLevelKey(64.996), 65)
  })

  it('C · never drops a kind and never invents a level', () => {
    const input = [
      { kind: 'knockIn' as const, level: 65 },
      { kind: 'coupon' as const, level: 65 },
      { kind: 'autocall' as const, level: 100 },
      { kind: 'strike' as const, level: 100 },
      { kind: 'other' as const, level: 80 },
    ]
    const merged = mergeCoincidingMarks(input)
    const kinds = merged.flatMap((m) => m.kinds).sort()
    assert.deepEqual(kinds, input.map((i) => i.kind).sort())
    for (const m of merged) assert.ok(input.some((i) => markLevelKey(i.level) === m.level))
    // Non-finite levels are ignored rather than producing a NaN tick.
    assert.equal(mergeCoincidingMarks([{ kind: 'strike', level: Number.NaN }]).length, 0)
  })

  it('C · the input array is not mutated', () => {
    const input = [{ kind: 'coupon' as const, level: 65 }, { kind: 'knockIn' as const, level: 65 }]
    const snapshot = JSON.stringify(input)
    mergeCoincidingMarks(input)
    assert.equal(JSON.stringify(input), snapshot)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// D · XS3164820824: initial/call (100) is distinct from coupon/knock-in (65)
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 2 — for XS3164820824 the call level is NOT the coupon barrier', () => {
  /** The page's own mark construction, restated from the persisted fractions. */
  function marksFor(u: { knockInBarrierPct: number | null; couponBarrierPct: number | null; autocallBarrierPct: number | null }) {
    return mergeCoincidingMarks([
      ...(u.knockInBarrierPct != null ? [{ kind: 'knockIn' as const, level: u.knockInBarrierPct * 100 }] : []),
      ...(u.couponBarrierPct != null ? [{ kind: 'coupon' as const, level: u.couponBarrierPct * 100 }] : []),
      ...(u.autocallBarrierPct != null ? [{ kind: 'autocall' as const, level: u.autocallBarrierPct * 100 }] : []),
      { kind: 'strike' as const, level: 100 },
    ])
  }

  it('D · exactly two ticks — 65 (coupon / knock-in) and 100 (initial / call)', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    for (const u of note.underlyings) {
      const merged = marksFor({
        knockInBarrierPct: u.knockInBarrierPct ?? note.knockInBarrierPct,
        couponBarrierPct: u.couponBarrierPct ?? note.couponBarrierPct,
        autocallBarrierPct: u.autocallBarrierPct ?? note.autocallBarrierPct,
      })
      assert.deepEqual(merged.map((m) => m.level), [65, 100], u.underlyingName)
      const [barrier, call] = merged
      assert.ok(isCouponKnockInMark(barrier), 'the 65 tick is the coupon / knock-in barrier')
      assert.ok(!isInitialCallMark(barrier))
      assert.ok(isInitialCallMark(call), 'the 100 tick is the initial / call level')
      assert.ok(!isCouponKnockInMark(call))
      // The two are different marks — the owner's question, answered structurally.
      assert.notEqual(barrier.level, call.level)
      assert.ok(!call.kinds.includes('coupon'))
    }
  })

  it('D · the merged marks are labelled "Coupon / knock-in barrier" and "Initial / call level" — never "Call level · Initial / call level"', () => {
    assert.equal(dict.en.sn.gaugeMarkCouponKnockIn, 'Coupon / knock-in barrier')
    assert.equal(dict.en.sn.gaugeMarkStrike, 'Initial / call level')
    assert.equal(dict.es.sn.gaugeMarkCouponKnockIn, 'Barrera de cupón / knock-in')
    // The composer names the strike+autocall pair ONCE and removes both kinds.
    const from = DETAIL.indexOf('function gaugeMarkLabel(')
    const block = DETAIL.slice(from, DETAIL.indexOf('function GaugeLegend('))
    assert.match(block, /if \(isInitialCallMark\(m\)\) \{ parts\.push\(t\.sn\.gaugeMarkStrike\); rest\.delete\('strike'\); rest\.delete\('autocall'\) \}/)
    assert.match(block, /if \(isCouponKnockInMark\(m\)\) \{ parts\.push\(t\.sn\.gaugeMarkCouponKnockIn\); rest\.delete\('coupon'\); rest\.delete\('knockIn'\) \}/)
  })

  it('D · the legend is data-driven from the same merged marks — no fixed four-entry list', () => {
    assert.ok(!/const ticks: \{ color: string; label: string \}\[\] = \[/.test(DETAIL), 'the hardcoded legend list is gone')
    assert.match(DETAIL, /const legendMarks = mergeCoincidingMarks\(n\.underlyings\.flatMap\(\(u\) => rawMarksFor\(u\.underlyingOrder\)\)\)/)
    assert.match(DETAIL, /<GaugeLegend marks=\{legendMarks\} \/>/)
    // Legend swatches take the gauge's OWN colour map, so they cannot drift.
    assert.match(DETAIL, /backgroundColor: BARRIER_KIND_COLOR\[m\.kind\]/)
    assert.match(GAUGE, /export const BARRIER_KIND_COLOR/)
  })

  it('D · the stated basis is per underlying and honest', () => {
    assert.match(DETAIL, /markLevelKey\(autocallPct \* 100\) === 100 \? t\.sn\.gaugeBasis : t\.sn\.gaugeBasisInitialOnly/)
    assert.equal(dict.en.sn.gaugeBasis, '100 = initial / call level')
    assert.equal(dict.en.sn.gaugeBasisInitialOnly, '100 = initial level')
    // The legend sentence no longer hard-codes "which is also its call level".
    assert.ok(!dict.en.sn.gaugeLegend.includes('also its call level'))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// E · CALLED ROW WORDING IS NOT REDUNDANT
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 3 — the three schedule columns say three different things', () => {
  it('E · the autocall-test result on the calling date reads "Met", not a second "Called"', () => {
    for (const lang of ['en', 'es'] as const) {
      const sn = dict[lang].sn
      assert.notEqual(sn.obsOutcome.called, sn.obsState.called, `${lang}: Status and Autocall must not print the same word`)
    }
    assert.equal(dict.en.sn.obsOutcome.called, 'Met')
    assert.equal(dict.en.sn.obsState.called, 'Called')
    assert.equal(dict.es.sn.obsOutcome.called, 'Cumplido')
  })

  it('E · for XS3164820824 the calling row reads Called · Paid · Met', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    const row = rows[0]
    assert.equal(row.valuationDate, '2026-08-28')
    assert.equal(dict.en.sn.obsState[row.state], 'Called')
    assert.equal(dict.en.sn.obsOutcome[row.coupon], 'Paid')
    assert.equal(dict.en.sn.obsOutcome[row.autocall], 'Met')
    // The canonical tokens are untouched — only the words changed.
    assert.equal(row.state, 'called')
    assert.equal(row.coupon, 'paid')
    assert.equal(row.autocall, 'called')
  })

  it('E · a future test reads "Pending", not a second "Scheduled"', () => {
    for (const lang of ['en', 'es'] as const) {
      const sn = dict[lang].sn
      assert.notEqual(sn.obsOutcome.scheduled, sn.obsState.scheduled)
    }
    assert.equal(dict.en.sn.obsOutcome.scheduled, 'Pending')
  })

  it('E · void and never-run tests render a dash with the reason, never a third "Void"', () => {
    assert.match(DETAIL, /if \(outcome === 'none' \|\| outcome === 'void'\) \{/)
    assert.match(DETAIL, /const help = outcome === 'none' \? t\.sn\.obsOutcomeNoneHelp : t\.sn\.obsOutcomeVoidHelp/)
    // Accessible: the dash is aria-hidden and the meaning is in sr-only text.
    assert.match(DETAIL, /<span aria-hidden="true">—<\/span>\s*<span className="sr-only">\{label\} — \{help\}<\/span>/)
    assert.ok(dict.en.sn.obsOutcomeVoidHelp.length > 0 && dict.es.sn.obsOutcomeVoidHelp.length > 0)
    // The seven post-call rows of the fixture are all void → dash + Void chip.
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    for (const r of rows.slice(1)) {
      assert.equal(r.state, 'void')
      assert.equal(r.coupon, 'void')
      assert.equal(r.autocall, 'void')
    }
  })

  it('E · contractual meaning is kept — the canonical rows still hold both tests on the call date', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const deduped = dedupeObservationsByDate(note.observations)
    const onCall = deduped.filter((o) => o.valuationDate === '2026-08-28')
    assert.deepEqual(onCall.map((o) => o.observationType).sort(), ['autocall', 'coupon'])
    assert.deepEqual(onCall.map((o) => o.status).sort(), ['autocalled', 'coupon_paid'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// F · HERO LABEL
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 5 — the hero capsule is labelled "Status"', () => {
  it('F · the capsule uses the shared Status label, not "Risk status"', () => {
    assert.match(DETAIL, /<StatCapsule\s+label=\{t\.sn\.colStatus\}\s+value=\{riskLabel\(data\.metrics\.riskStatus\)\}/)
    assert.ok(!/label=\{t\.sn\.riskStatus\}/.test(DETAIL))
    assert.equal(dict.en.sn.colStatus, 'Status')
    assert.equal(dict.es.sn.colStatus, 'Estado')
  })

  it('F · called-state semantics are untouched — Called + settlement, never Autocallable', () => {
    assert.match(DETAIL, /sub=\{isCalled \? settlementLabel : undefined\}/)
    assert.match(DETAIL, /called: t\.sn\.riskCalled/)
    const CALC = read('../src/lib/structuredNotes/calculations.ts')
    assert.match(CALC, /if \(note\.status === 'autocalled'\) return 'called'/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// G · CURRENT-LEVEL HALO ANIMATION + REDUCED MOTION
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 6 — the current-level halo pulses, and stops under prefers-reduced-motion', () => {
  it('G · the halo is a separate circle carrying the CSS class; the dot itself is static', () => {
    assert.match(GAUGE, /<circle className="nv-level-pulse" cx=\{toX\(current\)\} cy=\{height \/ 2\} r=\{4\} fill="none" stroke=\{dotColor\} strokeWidth=\{5\} aria-hidden="true" \/>/)
    assert.match(GAUGE, /<circle cx=\{toX\(current\)\} cy=\{height \/ 2\} r=\{4\} fill=\{dotColor\}>/)
    // No JS timers, no inline animation — the class is the whole implementation.
    assert.ok(!/requestAnimationFrame|setInterval|setTimeout|animation\s*:/.test(GAUGE))
  })

  it('G · the utility is slow, subtle and token-driven — a locating cue, not an alert', () => {
    const rule = CSS.match(/\.nv-level-pulse \{[^}]*\}/)![0]
    assert.match(rule, /animation: nvLevelPulse var\(--dur-level-pulse\) var\(--ease-primary\) infinite/)
    assert.match(rule, /transform-box: fill-box/)
    const dur = Number(CSS.match(/--dur-level-pulse:\s*(\d+)ms/)![1])
    assert.ok(dur >= 2000, `a ${dur}ms loop would read as flashing`)
    // The keyframe fades OUT and spends the tail of its period fully faded — no on/off blink.
    assert.match(CSS, /@keyframes nvLevelPulse \{ 0% \{ transform: scale\(1\); opacity: \.32 \} 70%, 100% \{ transform: scale\(1\.9\); opacity: 0 \} \}/)
  })

  it('G · prefers-reduced-motion removes the loop and leaves the resting ring', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
    assert.match(reduced, /\.nv-level-pulse \{\s*animation: none !important;\s*transform: none !important;\s*opacity: \.28 !important;\s*\}/)
    // The global collapse still applies to it too (belt and braces).
    assert.match(reduced, /\*, \*::before, \*::after \{\s*animation-duration: \.01ms !important;/)
  })

  it('G · the raw market level beside the gauge is static text', () => {
    assert.match(DETAIL, /<td className=\{`\$\{cell\} ui-number`\}>\{d\.currentLevel !== null \? fmtNum\(d\.currentLevel\)/)
  })

  it('G · the exception is recorded in the design principles, scoped to this one marker', () => {
    assert.match(DESIGN, /Barrier-gauge current-level halo/)
    assert.match(DESIGN, /owner-approved R13\.7B2\.2\.1/)
    assert.match(DESIGN, /It is not a precedent for other loops\./)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// H · COMBINED GENERAL TERMS / UNDERLYINGS BLOCK
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 § 7 — General Terms and Underlyings are one block', () => {
  const from = DETAIL.indexOf('{t.sn.generalTerms}')
  const to = DETAIL.indexOf('{/* Observation schedule')
  const block = DETAIL.slice(from, to)

  it('H · one card, two sections, a horizontal divider between them', () => {
    assert.ok(!DETAIL.includes('<TableCard title={t.sn.underlyings}'), 'no separate underlyings card')
    // The divider sits between the terms grid and the underlyings heading.
    assert.match(block, /<div className="px-5 pt-3 pb-2 border-t border-border">\s*<h2 className="ui-label text-muted-fg">\{t\.sn\.underlyings\}<\/h2>/)
    // Exactly one card surface wraps both; the table sits on the dense surface.
    assert.equal((block.match(/<GlassSurface variant="card"/g) ?? []).length, 0, 'no second card opened inside the block')
    assert.match(block, /<GlassSurface variant="dense">/)
    // The old side-by-side two-card grid around this section is gone.
    const before = DETAIL.slice(DETAIL.lastIndexOf('<Reveal', from), from)
    assert.ok(!/grid-cols-1 lg:grid-cols-2/.test(before), 'terms + underlyings are no longer a two-column grid')
  })

  it('H · the terms grid opens to six columns at lg to fill the full-width card', () => {
    assert.match(DETAIL, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2\.5 text-sm/)
  })

  it('H · nothing was dropped — every term field and every underlying column remains', () => {
    for (const field of ['colIsin', 'colIssuer', 'guarantor', 'colStructure', 'payoffType', 'currencyLabel', 'totalIssuanceSize', 'denomination', 'issuePrice', 'colCoupon', 'couponFrequency', 'couponBarrier', 'colKnockIn', 'autocallBarrier', 'colTrade', 'colIssued', 'initialValuation', 'finalValuation', 'colMaturity', 'redemption']) {
      assert.ok(block.includes(`t.sn.${field}`), `term ${field} missing`)
    }
    for (const col of ['u.underlyingOrder', 'u.underlyingName', 'u.yahooSymbol', 'u.initialLevel', 'u.strikeLevel', 'u.knockInBarrierLevel', 'u.couponBarrierLevel', 'u.autocallBarrierLevel']) {
      assert.ok(block.includes(col), `underlying column ${col} missing`)
    }
    assert.match(block, /<TermField k=\{t\.sn\.colMaturity\} v=\{n\.maturityDate\} \/>/, 'contractual maturity is never erased')
  })

  it('H · the underlyings table keeps card-level horizontal containment', () => {
    assert.match(block, /<div className="overflow-x-auto">\s*<div style=\{\{ minWidth: 560 \}\}>/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// I · CI runs this suite on the exact SHA
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2.1 — the gate runs this file', () => {
  it('the event-state workflow executes the owner-polish suite', () => {
    assert.match(WORKFLOW, /node --test "tests\/structuredNotesOwnerPolish\.test\.ts"/)
  })
})
