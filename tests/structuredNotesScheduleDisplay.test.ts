// R13.7B2.2 — OWNER VISUAL REVIEW CORRECTIONS.
//
// Covers the § 14 checklist: schedule aggregation (A/B), percentage/unit
// correctness (C–F), human-readable statuses (G–I), the normalized gauge and
// its legend (M–P), distance semantics (Q), and the canonical-engine
// no-regression guarantee (T). Settlement/notional (J–L) and the fixture's
// safety properties (R/S) live in tests/structuredNotesAlertAccess.test.ts
// beside the rest of the fixture contract.
//
// Pure: no Supabase, no network, no Next.js runtime.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildScheduleRows, findCallDate } from '../src/lib/structuredNotes/observationSchedule.ts'
import { buildReviewFixture, CALLED_PENDING_FIXTURE_ID } from '../src/lib/structuredNotes/fixtures/calledStateFixture.ts'
import { dedupeObservationsByDate } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'
import { calculateBarrierLevel, calculateDistanceToBarrier } from '../src/lib/structuredNotes/calculations.ts'
import { relativeToThreshold, moveToThreshold } from '../src/lib/structuredNotes/contractualEvents.ts'
import { formatSourceDateFull } from '../src/lib/formatters.ts'
import type { StructuredNoteObservation } from '../src/lib/structuredNotes/types.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const DETAIL = read('../src/app/structured-notes/[id]/page.tsx')
const DASH = read('../src/app/structured-notes/page.tsx')
const FIXTURE = read('../src/lib/structuredNotes/fixtures/calledStateFixture.ts')

/** Minimal observation builder — only the fields the aggregator reads. */
function obs(p: Partial<StructuredNoteObservation> & Pick<StructuredNoteObservation, 'valuationDate' | 'observationType' | 'status'>): StructuredNoteObservation {
  return {
    observationNumber: 1,
    paymentDate: null,
    redemptionDate: null,
    couponDuePct: null,
    autocallBarrierPct: null,
    couponBarrierPct: null,
    ...p,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// A · ONE DISPLAY ROW PER VALUATION DATE
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 2 — one display row per contractual valuation date', () => {
  it('collapses a same-date coupon + autocall pair into ONE row', () => {
    const rows = buildScheduleRows([
      obs({ valuationDate: '2026-08-28', observationType: 'coupon', status: 'coupon_paid' }),
      obs({ valuationDate: '2026-08-28', observationType: 'autocall', status: 'autocalled' }),
    ])
    assert.equal(rows.length, 1, 'a single Observation Date must produce a single row')
    assert.equal(rows[0].valuationDate, '2026-08-28')
    assert.equal(rows[0].coupon, 'paid')
    assert.equal(rows[0].autocall, 'called')
  })

  it('never emits a duplicate row for the same date across the whole golden schedule', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    const dates = rows.map((r) => r.valuationDate)
    assert.deepEqual(dates, [...new Set(dates)], 'no valuation date may appear twice')
    // 7 coupon/autocall dates + 1 final date = 8 rows, from 15 canonical records.
    assert.equal(note.observations.length, 15)
    assert.equal(rows.length, 8)
  })

  it('numbers rows sequentially in date order, not per observation type', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    assert.deepEqual(rows.map((r) => r.displayNumber), [1, 2, 3, 4, 5, 6, 7, 8])
    const sorted = [...rows].sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
    assert.deepEqual(rows.map((r) => r.valuationDate), sorted.map((r) => r.valuationDate))
  })

  it('marks every date after the call as void, and the calling date itself as called', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    for (const r of rows) {
      if (r.valuationDate === '2026-08-28') assert.equal(r.state, 'called')
      else if (r.valuationDate > '2026-08-28') assert.equal(r.state, 'void', `${r.valuationDate} must be void`)
      else assert.notEqual(r.state, 'void')
    }
    // Exactly one void row per post-call DATE — never a void coupon row and a
    // void autocall row for the same date (§ 2).
    assert.equal(rows.filter((r) => r.state === 'void').length, 7)
  })

  it('reports the earliest call date, so a later observation cannot re-date the call', () => {
    const rows = [
      obs({ valuationDate: '2027-03-01', observationType: 'autocall', status: 'autocalled' }),
      obs({ valuationDate: '2026-08-28', observationType: 'autocall', status: 'autocalled' }),
    ]
    assert.equal(findCallDate(rows), '2026-08-28')
  })

  it('a final observation is flagged on its own row rather than given a type column', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    const finals = rows.filter((r) => r.hasFinal)
    assert.equal(finals.length, 1)
    assert.equal(finals[0].valuationDate, '2028-05-30')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// B · THE CANONICAL EVENT MODEL IS UNCHANGED  (also § 14 T)
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 2/T — the R13.7 repair is not regressed by the display view', () => {
  it('de-duplication still keys on (date, type), keeping both tests alive', () => {
    const input = [
      obs({ valuationDate: '2026-08-28', observationType: 'coupon', status: 'coupon_paid' }),
      obs({ valuationDate: '2026-08-28', observationType: 'autocall', status: 'autocalled' }),
    ]
    const deduped = dedupeObservationsByDate(input)
    assert.equal(deduped.length, 2, 'the canonical model must keep both contractual tests')
    assert.deepEqual(deduped.map((o) => o.observationType).sort(), ['autocall', 'coupon'])
  })

  it('the aggregator is a READ-ONLY view — it mutates nothing it is given', () => {
    const input = [
      obs({ valuationDate: '2026-08-28', observationType: 'coupon', status: 'coupon_paid' }),
      obs({ valuationDate: '2026-08-28', observationType: 'autocall', status: 'autocalled' }),
    ]
    const before = JSON.stringify(input)
    buildScheduleRows(input)
    assert.equal(JSON.stringify(input), before, 'canonical observations must be untouched')
  })

  it('a coupon paid ON the call date stays expressible and is not swallowed by the call', () => {
    const rows = buildScheduleRows([
      obs({ valuationDate: '2026-08-28', observationType: 'coupon', status: 'coupon_paid' }),
      obs({ valuationDate: '2026-08-28', observationType: 'autocall', status: 'autocalled' }),
    ])
    assert.equal(rows[0].coupon, 'paid', 'the coupon is not forfeited because the note also called')
    assert.equal(rows[0].autocall, 'called')
  })

  it('an absent autocall test reports "not tested", never a negative result', () => {
    // This is production today: seven coupon rows, no autocall rows at all.
    const rows = buildScheduleRows([
      obs({ valuationDate: '2026-08-28', observationType: 'coupon', status: 'coupon_paid' }),
    ])
    assert.equal(rows[0].autocall, 'none')
    assert.notEqual(rows[0].autocall, 'not_eligible')
  })

  it('the contractual event engine itself is untouched by this stage', () => {
    const ENGINE = read('../src/lib/structuredNotes/contractualEvents.ts')
    // The aggregator must not re-implement any contractual test.
    const AGG = read('../src/lib/structuredNotes/observationSchedule.ts')
    for (const f of ['evaluateLeg', 'evaluateAllUnderlyingCondition', 'couponBarrierLevel', 'autocallBarrierLevel']) {
      assert.ok(!AGG.includes(f), `presentation must not re-derive contract logic: ${f}`)
    }
    // ALL-underlyings aggregation and the inclusive comparison still stand.
    assert.match(ENGINE, /return \{ \.\.\.base, met: c >= t, unavailableReason: null \}/)
    assert.match(ENGINE, /else if \(legs\.some\(\(l\) => l\.met === false\)\) outcome = 'not_met'/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// C–F · PERCENTAGE / UNIT CORRECTNESS
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 4 — canonical percentage unit is a DECIMAL FRACTION', () => {
  // The single formatter every structured-note percentage passes through.
  // Asserted against the shipped source so this mirror cannot silently drift.
  const fmtPct = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`)

  it('the shipped formatter multiplies by 100 exactly once', () => {
    assert.match(DASH, /function fmtPct\(v: number \| null \| undefined\): string \{/)
    assert.match(DASH, /return `\$\{\(v \* 100\)\.toFixed\(2\)\}%`/)
    // Exactly one definition, and it is the one the detail page imports.
    assert.equal((DASH.match(/function fmtPct\(/g) ?? []).length, 1)
    assert.match(DETAIL, /import \{ fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE \} from '\.\.\/page'/)
  })

  it('no caller pre-multiplies a percentage before formatting it', () => {
    // `fmtPct(x * 100)` would be the double-multiplication bug.
    for (const [name, src] of [['detail', DETAIL], ['dashboard', DASH]] as const) {
      assert.ok(!/fmtPct\([^)]*\*\s*100/.test(src), `double multiplication in ${name}`)
      assert.ok(!/fmtPct\([^)]*\/\s*100/.test(src), `compensating division in ${name}`)
    }
  })

  it('C · 65% renders as 65.00%, never 6500.00%', () => {
    assert.equal(fmtPct(0.65), '65.00%')
    assert.notEqual(fmtPct(0.65), '6500.00%')
  })

  it('D · 100% renders as 100.00%, never 10000.00%', () => {
    assert.equal(fmtPct(1), '100.00%')
  })

  it('E · a 100% issue price renders as 100.00%', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    assert.equal(fmtPct(note.issuePricePct), '100.00%')
  })

  it('F · XS3164820824 renders its OWN coupon: 2.50% per quarter, 10.00% p.a.', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    assert.equal(fmtPct(note.couponRatePeriodic), '2.50%')
    assert.equal(fmtPct(note.couponRateAnnualized), '10.00%')
    // Guard the specific wrong value the broken UI suggested (that rate belongs
    // to XS3180975347) — it must never be hardcoded back in as DATA. Comment
    // lines are excluded on purpose: the file documents the mistake by name so
    // it is not repeated, and that documentation must not trip this check.
    const code = FIXTURE.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l.replace(/\s\/\/.*$/, '')) // trailing comments too
      .join('\n')
    assert.ok(!code.includes('2.5375'), 'XS3180975347 coupon must not appear as fixture data')
    assert.ok(!code.includes('10.15'), 'XS3180975347 coupon must not appear as fixture data')
  })

  it('every barrier renders correctly through the whole schedule', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const rows = buildScheduleRows(dedupeObservationsByDate(note.observations))
    for (const r of rows) {
      assert.equal(fmtPct(r.couponBarrierPct), '65.00%')
      if (r.autocallBarrierPct !== null) assert.equal(fmtPct(r.autocallBarrierPct), '100.00%')
    }
  })

  it('the fraction convention is what the engine itself requires', () => {
    // `calculateBarrierLevel` multiplies without dividing, so 65 (whole points)
    // would produce a barrier 100× the strike — the unit contract is load-bearing.
    assert.equal(calculateBarrierLevel(7565.3, 0.65), 7565.3 * 0.65)
    assert.equal(calculateBarrierLevel(100, 1), 100)
  })

  it('every issuer parser emits fractions, so no source can introduce whole points', () => {
    const parsers = ['barclaysParser', 'bbvaParser', 'bnpParibasParser', 'citiHsbcParser', 'creditAgricoleParser', 'santanderParser']
    for (const p of parsers) {
      const src = read(`../src/lib/structuredNotes/pdf/parsers/${p}.ts`)
      // Each parser reads a printed percentage and divides by 100 at least once.
      assert.match(src, /\/ 100/, `${p} must normalize printed percentages to fractions`)
      // And must never multiply an extracted barrier back up.
      assert.ok(!/BarrierPct\s*=\s*[^;\n]*\*\s*100/.test(src), `${p} must not store whole percentage points`)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// G–I · HUMAN-READABLE STATUS VALUES
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 3 — human-readable statuses, never storage enums', () => {
  it('I · no storage enum reaches the screen', () => {
    // The schedule cells render label lookups, not the raw status.
    assert.match(DETAIL, /t\.sn\.obsState\[state\]/)
    assert.match(DETAIL, /t\.sn\.obsOutcome\[outcome\]/)
    for (const raw of ['{o.status}', '{r.state}<', '>{o.status}<']) {
      assert.ok(!DETAIL.includes(raw), `raw enum rendered: ${raw}`)
    }
  })

  it('G · Called is rendered red and named in text', () => {
    assert.match(DETAIL, /const ROW_STATE_TONE: Record<ScheduleRow\['state'\], string> = \{\s*\n\s*called: 'var\(--negative\)'/)
    assert.match(DETAIL, /outcome === 'called' \? 'text-negative font-medium'/)
    // Never color-alone: the chip always prints its label.
    assert.match(DETAIL, /const label = t\.sn\.obsState\[state\]/)
  })

  it('H · Coupon Paid is rendered green', () => {
    assert.match(DETAIL, /outcome === 'paid' \|\| outcome === 'eligible' \? 'text-positive'/)
  })

  it('void rows are muted and struck through', () => {
    assert.match(DETAIL, /rowVoid \? 'opacity-40 line-through' : ''/)
  })

  it('every outcome token has both an EN and an ES label', () => {
    const I18N = read('../src/lib/i18n.ts')
    const outcomes = ['paid', 'missed', 'called', 'eligible', 'not_eligible', 'observed', 'scheduled', 'void', 'none']
    const states = ['called', 'void', 'matured', 'observed', 'scheduled']
    // Two `obsOutcome:` blocks (EN + ES) and two `obsState:` blocks.
    assert.equal((I18N.match(/obsOutcome: \{/g) ?? []).length, 2)
    assert.equal((I18N.match(/obsState: \{/g) ?? []).length, 2)
    for (const k of outcomes) assert.ok((I18N.match(new RegExp(`\\n\\s+${k}: '`, 'g')) ?? []).length >= 2, `outcome ${k} needs EN+ES`)
    for (const k of states) assert.ok(I18N.includes(`${k}: '`), `state ${k} missing`)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// M–P · GAUGE + WORST LEG EXPLAINABILITY
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 8/§ 9 — the gauge and the binding leg explain themselves', () => {
  it('M · the normalized reading is named and its basis stated', () => {
    assert.match(DETAIL, /\$\{t\.sn\.gaugeNormalized\} \$\{gaugeLevel\.toFixed\(2\)\} — \$\{t\.sn\.gaugeBasis\}/)
  })

  it('the normalized value reproduces the golden cushions', () => {
    const { note, prices } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    for (const u of note.underlyings) {
      const p = prices.find((x) => x.underlyingOrder === u.underlyingOrder)!.price!
      const normalized = (p / (u.strikeLevel ?? u.initialLevel)!) * 100
      // 100 = the underlying's own initial level, which is also its call level.
      assert.equal(u.autocallBarrierLevel, u.initialLevel)
      if (u.underlyingName === 'SPX Index') assert.ok(Math.abs(normalized - 101.9359) < 1e-3, `SPX ${normalized}`)
      if (u.underlyingName === 'RTY Index') assert.ok(Math.abs(normalized - 101.0825) < 1e-3, `RTY ${normalized}`)
    }
  })

  it('N · the raw market level stays on screen beside the normalized gauge', () => {
    assert.match(DETAIL, /fmtNum\(d\.currentLevel\)/)
    assert.ok(DETAIL.includes('t.sn.currentLevel'))
  })

  it('O · a visible legend names every marker', () => {
    assert.match(DETAIL, /function GaugeLegend\(\)/)
    assert.match(DETAIL, /<GaugeLegend \/>/)
    for (const k of ['gaugeMarkCurrent', 'gaugeMarkStrike', 'gaugeMarkAutocall', 'gaugeMarkCoupon', 'gaugeMarkKnockIn']) {
      assert.ok(DETAIL.includes(`t.sn.${k}`), `legend entry ${k} missing`)
    }
    // Coinciding marks are explained rather than silently overdrawn.
    assert.ok(DETAIL.includes('t.sn.gaugeMarksCoincide'))
  })

  it('the gauge component renders each mark title so a marker is never anonymous', () => {
    const GAUGE = read('../src/components/fable/BarrierGauge.tsx')
    assert.match(GAUGE, /\{m\.label \? <title>\{m\.label\}<\/title> : null\}/)
  })

  it('P · the worst/binding leg is explained, and not as a raw-level comparison', () => {
    assert.ok(DETAIL.includes('t.sn.worstExplain'))
    const I18N = read('../src/lib/i18n.ts')
    assert.match(I18N, /worstExplain: 'Binding \(worst-of\) leg: the underlying with the smallest normalized cushion/)
    assert.match(I18N, /never decided by comparing raw index levels/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Q · DISTANCE METRICS
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 10 — distance metrics keep their locked formulas and gain plain language', () => {
  it('the two metrics remain distinct — one is not the negation of the other', () => {
    const close = 7711.76
    const threshold = 7565.3
    const cushion = relativeToThreshold(close, threshold)!
    const move = moveToThreshold(close, threshold)!
    assert.ok(Math.abs(cushion - 0.0193593) < 1e-6, String(cushion))
    assert.ok(Math.abs(move - -0.0189916) < 1e-6, String(move))
    assert.notEqual(Math.abs(cushion), Math.abs(move))
  })

  it('the displayed column is the MOVE metric, unchanged', () => {
    // The API feeds these cells from calculateDistanceToBarrier = barrier/current − 1.
    assert.equal(calculateDistanceToBarrier(100, 65), 65 / 100 - 1)
    assert.match(DETAIL, /fmtPct\(d\.distanceToKnockInBarrier\)/)
    assert.match(DETAIL, /fmtPct\(d\.distanceToCouponBarrier\)/)
    assert.match(DETAIL, /fmtPct\(d\.distanceToAutocallBarrier\)/)
  })

  it('every distance cell carries a direction-aware plain-language reading', () => {
    assert.match(DETAIL, /function moveText\(/)
    for (const cell of ['d.distanceToCouponBarrier', 'd.distanceToKnockInBarrier', 'd.distanceToAutocallBarrier']) {
      assert.ok(DETAIL.includes(`title={moveText(t, ${cell},`), `${cell} needs a plain-language title`)
    }
    // Direction words exist in both languages.
    const I18N = read('../src/lib/i18n.ts')
    for (const k of ['declineTo', 'riseTo', 'atLevel']) {
      assert.ok((I18N.match(new RegExp(`${k}: '`, 'g')) ?? []).length === 2, `${k} needs EN+ES`)
    }
  })

  it('the sign convention is still declared, and still visible', () => {
    assert.ok(DETAIL.includes('t.sn.distanceConvention'))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// § 11 · SOURCE DATE
// ═════════════════════════════════════════════════════════════════════════════

describe('R13.7B2.2 § 11 — an unambiguous as-of date for contractual levels', () => {
  it('renders a full ISO calendar date, not the dense DD-MM convention', () => {
    assert.equal(formatSourceDateFull('2026-08-28T20:00:00.000Z'), '2026-08-28')
    assert.equal(formatSourceDateFull('2026-08-28'), '2026-08-28')
  })

  it('never fabricates a date from an unparseable value', () => {
    assert.equal(formatSourceDateFull('not-a-date'), 'not-a-date')
    assert.equal(formatSourceDateFull('2026-13-45T00:00:00.000Z'), '2026-13-45T00:00:00.000Z')
  })

  it('the opt-in does not change the platform-wide convention for other tables', () => {
    const FOOTER = read('../src/components/ui/TableSourceFooter.tsx')
    assert.match(FOOTER, /asOfFormat = 'short'/, 'short must remain the default')
    assert.match(FOOTER, /asOfFormat === 'full' \? formatSourceDateFull : formatSourceDate/)
    // Only the structured-note levels table opts in.
    assert.equal((DETAIL.match(/asOfFormat="full"/g) ?? []).length, 1)
  })

  it('source attribution is kept', () => {
    assert.match(DETAIL, /source=\{t\.sn\.sourceMarket\}/)
  })
})
