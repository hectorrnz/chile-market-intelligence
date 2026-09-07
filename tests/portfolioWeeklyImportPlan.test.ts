// R13.8A § "WORKBOOK HISTORY LEADS" — multi-week catch-up import planning.
//
// NO PRIVATE SOURCE DATA. Every value here is a small invented integer. These
// tests are about WHICH WEEKS move, not about what any portfolio is worth.
//
// WHAT THESE TESTS ARE FOR
// ────────────────────────
// One upload is not one reporting week, and the two ways of getting that wrong
// are opposites:
//
//   * publishing only the newest frozen column and silently discarding the
//     weeks the administrator missed; and
//   * manufacturing a week because the calendar says one should exist, when the
//     source never froze a column for it.
//
// A test suite that only checked the happy single-week path would pass while
// either failure shipped. So the suite is built from one baseline and pushed in
// both directions: A/B prove every present week is imported, C proves an absent
// week is never invented, and D/E prove that "several weeks at once" and "a
// changed old week" are classified by DATE IDENTITY rather than by count.
//
// F and G exist because a catch-up that half-lands is worse than one that does
// not land at all: the chart would show a history no workbook ever stated.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  planWeeklyImport,
  applyImportPlan,
  rollbackImport,
  WEEKLY_IMPORT_PLAN_VERSION,
  type HistoryStore,
  type SeriesObservation,
  type WeeklyImportPlan,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'

// ---------------------------------------------------------------------------
// Fixtures — the four published scopes, every value invented
// ---------------------------------------------------------------------------

const SERIES: ReadonlyArray<{ scope: string; basis: string }> = [
  { scope: 'main', basis: 'ex_chilean_equities' },
  { scope: 'main', basis: 'with_chilean_equities' },
  { scope: 'jaime', basis: 'total' },
  { scope: 'andres', basis: 'total' },
  { scope: 'pablo', basis: 'total' },
]

/** Deterministic synthetic value — distinct per series and per week. */
function valueFor(scope: string, basis: string, date: string): number {
  const seriesIndex = SERIES.findIndex((s) => s.scope === scope && s.basis === basis)
  const dayKey = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10))
  return 1000 + seriesIndex * 100 + dayKey
}

/** One observation per series for each of the given weeks. */
function weeks(dates: readonly string[]): SeriesObservation[] {
  const out: SeriesObservation[] = []
  for (const date of dates) {
    for (const s of SERIES) {
      out.push({
        scope: s.scope,
        basis: s.basis,
        observationDate: date,
        value: valueFor(s.scope, s.basis, date),
      })
    }
  }
  return out
}

/** Production's settled history, ending at 2026-07-31. */
const PUBLISHED_DATES = ['2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31'] as const
const published = () => weeks(PUBLISHED_DATES)

/**
 * A workbook always carries its WHOLE frozen history, so every fixture below
 * restates the published weeks and then adds whatever the scenario is about.
 * That is the realistic shape, and it is what makes "unchanged weeks are not
 * rewritten" a meaningful assertion rather than a vacuous one.
 */
function workbookThrough(extra: readonly string[]): SeriesObservation[] {
  return weeks([...PUBLISHED_DATES, ...extra])
}

function planFor(
  extra: readonly string[],
  opts: { authorized?: boolean; reason?: string } = {},
): WeeklyImportPlan {
  return planWeeklyImport({
    workbookObservations: workbookThrough(extra),
    publishedObservations: published(),
    historicalCorrectionAuthorized: opts.authorized,
    correctionReason: opts.reason ?? null,
  })
}

function storeOf(observations: SeriesObservation[]): HistoryStore {
  return { observations }
}

function datesIn(store: HistoryStore): string[] {
  return [...new Set(store.observations.map((o) => o.observationDate))].sort()
}

// ---------------------------------------------------------------------------
// A · Production is one week behind
// ---------------------------------------------------------------------------

describe('A · one missed week', () => {
  test('appends exactly the one new frozen week', () => {
    const plan = planFor(['2026-08-07'])

    assert.equal(plan.productionEndpoint, '2026-07-31')
    assert.equal(plan.workbookLatest, '2026-08-07')
    assert.deepEqual(plan.newDates, ['2026-08-07'])
    assert.equal(plan.action, 'append_single_week')
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blocked, false)
  })

  test('the four already-published weeks are recognised as unchanged, not rewritten', () => {
    const plan = planFor(['2026-08-07'])

    assert.deepEqual(plan.unchangedDates, [...PUBLISHED_DATES])
    // The G3 fix, asserted directly: an ordinary week writes ONE week's rows,
    // not the whole two-year history.
    const written = new Set(plan.observationsToWrite.map((o) => o.observationDate))
    assert.deepEqual([...written], ['2026-08-07'])
    assert.equal(plan.observationsToWrite.length, SERIES.length)
  })
})

// ---------------------------------------------------------------------------
// B · Production is three weeks behind and the workbook has all three
// ---------------------------------------------------------------------------

describe('B · three missed weeks, all present in the workbook', () => {
  const extra = ['2026-08-07', '2026-08-14', '2026-08-21']

  test('appends ALL THREE, never only the newest', () => {
    const plan = planFor(extra)

    assert.deepEqual(plan.newDates, extra)
    assert.equal(plan.action, 'multi_week_append')
    assert.equal(plan.workbookLatest, '2026-08-21')
  })

  test('every one of the three is written, one row per series', () => {
    const plan = planFor(extra)
    assert.equal(plan.observationsToWrite.length, SERIES.length * 3)
    for (const date of extra) {
      const rows = plan.observationsToWrite.filter((o) => o.observationDate === date)
      assert.equal(rows.length, SERIES.length)
      assert.ok(rows.every((r) => r.disposition === 'new'))
      assert.ok(rows.every((r) => r.priorValue === null))
    }
  })

  test('a weekly cadence throughout reports no gap', () => {
    assert.deepEqual(planFor(extra).cadenceGaps, [])
  })
})

// ---------------------------------------------------------------------------
// C · Three weeks of calendar time, only two frozen columns
// ---------------------------------------------------------------------------

describe('C · a calendar week the workbook does not carry', () => {
  const extra = ['2026-08-07', '2026-08-21']

  test('appends exactly the two present weeks', () => {
    const plan = planFor(extra)
    assert.deepEqual(plan.newDates, extra)
    assert.equal(plan.action, 'multi_week_append')
  })

  test('does NOT invent, forward-fill or interpolate the absent 2026-08-14', () => {
    const plan = planFor(extra)

    assert.equal(plan.newDates.includes('2026-08-14'), false)
    assert.equal(
      plan.weeks.some((w) => w.observationDate === '2026-08-14'),
      false,
    )
    assert.equal(
      plan.observationsToWrite.some((o) => o.observationDate === '2026-08-14'),
      false,
    )

    // The stronger invariant behind all three: NO planned date exists that the
    // workbook did not state. This is what forbids synthesis in general, not
    // just for this one date.
    const workbookDates = new Set(workbookThrough(extra).map((o) => o.observationDate))
    for (const w of plan.weeks) assert.ok(workbookDates.has(w.observationDate))
    for (const o of plan.observationsToWrite) assert.ok(workbookDates.has(o.observationDate))
  })

  test('no value is copied from either neighbour into a synthetic week', () => {
    const plan = planFor(extra)
    const eighth = plan.observationsToWrite.filter((o) => o.observationDate === '2026-08-07')
    const twentyFirst = plan.observationsToWrite.filter((o) => o.observationDate === '2026-08-21')
    assert.equal(eighth.length, SERIES.length)
    assert.equal(twentyFirst.length, SERIES.length)
    assert.equal(plan.observationsToWrite.length, SERIES.length * 2)
  })

  test('the absence surfaces as an informational cadence gap, never as a conflict', () => {
    const plan = planFor(extra)

    assert.deepEqual(plan.cadenceGaps, [{ from: '2026-08-07', to: '2026-08-21', days: 14 }])
    // A missing calendar week is NOT a history conflict.
    assert.equal(plan.blocked, false)
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blockCodes.length, 0)
  })
})

// ---------------------------------------------------------------------------
// D · Several new weeks alongside unchanged old history
// ---------------------------------------------------------------------------

describe('D · multi-week append over unchanged history', () => {
  const extra = ['2026-08-07', '2026-08-14', '2026-08-21']

  test('is ordinary recurring behaviour — no correction authorization required', () => {
    const plan = planFor(extra)

    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.correctionReason, null)
    assert.equal(plan.blocked, false)
    assert.deepEqual(plan.changedDates, [])
    assert.deepEqual(plan.backfillDates, [])
  })

  test('appending three weeks at once is NOT reclassified as a correction by count', () => {
    const one = planFor(['2026-08-07'])
    const three = planFor(extra)
    assert.equal(one.requiresHistoricalCorrection, three.requiresHistoricalCorrection)
    assert.equal(one.blocked, three.blocked)
  })

  test('it applies without any authorization flag', () => {
    const result = applyImportPlan(storeOf(published()), planFor(extra), 'import-d')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.record.appendedDates, extra)
    assert.deepEqual(result.record.correctedDates, [])
  })
})

// ---------------------------------------------------------------------------
// E · Several new weeks AND one restated already-published week
// ---------------------------------------------------------------------------

describe('E · new weeks plus a changed historical point', () => {
  const extra = ['2026-08-07', '2026-08-14', '2026-08-21']

  /** The workbook now states a different value for an already-published week. */
  function restated(): SeriesObservation[] {
    return workbookThrough(extra).map((o) =>
      o.observationDate === '2026-07-17' && o.scope === 'jaime'
        ? { ...o, value: o.value + 7 }
        : o,
    )
  }

  test('the CHANGED old point requires authorization — the new weeks do not', () => {
    const plan = planWeeklyImport({
      workbookObservations: restated(),
      publishedObservations: published(),
    })

    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.deepEqual(plan.changedDates, ['2026-07-17'])
    assert.equal(plan.blocked, true)
    assert.deepEqual(plan.blockCodes, ['historical_correction_required'])
  })

  test('the three new weeks are still identified SEPARATELY from the correction', () => {
    const plan = planWeeklyImport({
      workbookObservations: restated(),
      publishedObservations: published(),
    })

    assert.deepEqual(plan.newDates, extra)
    assert.equal(plan.newDates.includes('2026-07-17'), false)
    assert.equal(plan.changedDates.includes('2026-08-21'), false)
    assert.equal(plan.action, 'multi_week_append')
  })

  test('only the ONE restated series row is a correction, not the whole week', () => {
    const plan = planWeeklyImport({
      workbookObservations: restated(),
      publishedObservations: published(),
    })
    const week = plan.weeks.find((w) => w.observationDate === '2026-07-17')
    assert.ok(week)
    assert.equal(week.counts.changed, 1)
    assert.equal(week.counts.unchanged, SERIES.length - 1)
    assert.equal(week.disposition, 'changed')
  })

  test('a blocked plan writes nothing at all — including the innocent new weeks', () => {
    const plan = planWeeklyImport({
      workbookObservations: restated(),
      publishedObservations: published(),
    })
    const before = storeOf(published())
    const result = applyImportPlan(before, plan, 'import-e')

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'plan_blocked')
    assert.equal(result.store, before)
    assert.deepEqual(datesIn(result.store), [...PUBLISHED_DATES])
  })

  test('once authorized, the correction and the three new weeks land together', () => {
    const plan = planWeeklyImport({
      workbookObservations: restated(),
      publishedObservations: published(),
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian restated the 07-17 valuation.',
    })
    assert.equal(plan.blocked, false)
    assert.equal(plan.correctionReason, 'Custodian restated the 07-17 valuation.')

    const result = applyImportPlan(storeOf(published()), plan, 'import-e2')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.record.appendedDates, extra)
    assert.deepEqual(result.record.correctedDates, ['2026-07-17'])
  })

  test('a hole BELOW the endpoint is a backfill, authorized like a correction', () => {
    // Production never held a 07-03 row; the workbook now carries one.
    const plan = planWeeklyImport({
      workbookObservations: weeks(['2026-07-03', ...PUBLISHED_DATES, '2026-08-07']),
      publishedObservations: published(),
    })

    assert.deepEqual(plan.backfillDates, ['2026-07-03'])
    assert.deepEqual(plan.newDates, ['2026-08-07'])
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.equal(plan.blocked, true)
  })
})

// ---------------------------------------------------------------------------
// F · A catch-up that fails on its final week
// ---------------------------------------------------------------------------

describe('F · atomicity of a catch-up', () => {
  const extra = ['2026-08-07', '2026-08-14', '2026-08-21']

  test('a failure on the LAST week persists zero of the three', () => {
    const plan = planFor(extra)
    // The boundary check catching a corrupted final row — the defence-in-depth
    // path. The first two weeks have already been staged when it fires.
    const corrupted: WeeklyImportPlan = {
      ...plan,
      observationsToWrite: plan.observationsToWrite.map((o, i) =>
        i === plan.observationsToWrite.length - 1 ? { ...o, value: Number.NaN } : o,
      ),
    }

    const before = storeOf(published())
    const result = applyImportPlan(before, corrupted, 'import-f')

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'non_finite_value')
    // Identity, not equality: the store object itself never moved.
    assert.equal(result.store, before)
    assert.deepEqual(datesIn(result.store), [...PUBLISHED_DATES])
    assert.equal(result.store.observations.length, SERIES.length * PUBLISHED_DATES.length)
  })

  test('no partial state exists for 08-07 or 08-14 either', () => {
    const plan = planFor(extra)
    const corrupted: WeeklyImportPlan = {
      ...plan,
      observationsToWrite: plan.observationsToWrite.map((o) =>
        o.observationDate === '2026-08-21' ? { ...o, value: Number.NaN } : o,
      ),
    }
    const result = applyImportPlan(storeOf(published()), corrupted, 'import-f2')
    assert.equal(result.ok, false)
    if (result.ok) return
    for (const date of extra) {
      assert.equal(
        result.store.observations.some((o) => o.observationDate === date),
        false,
      )
    }
  })

  test('the input store is never mutated in place', () => {
    const observations = published()
    const before = storeOf(observations)
    const snapshot = JSON.stringify(observations)
    applyImportPlan(before, planFor(extra), 'import-f3')
    assert.equal(JSON.stringify(observations), snapshot)
  })
})

// ---------------------------------------------------------------------------
// G · Rolling back a successful three-week catch-up
// ---------------------------------------------------------------------------

describe('G · rollback removes every point the import introduced', () => {
  const extra = ['2026-08-07', '2026-08-14', '2026-08-21']

  test('all three weeks are removed together, not just the newest', () => {
    const before = storeOf(published())
    const applied = applyImportPlan(before, planFor(extra), 'import-g')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.deepEqual(datesIn(applied.store), [...PUBLISHED_DATES, ...extra])

    const rolled = rollbackImport(applied.store, applied.record)
    assert.deepEqual(datesIn(rolled), [...PUBLISHED_DATES])
    for (const date of extra) {
      assert.equal(
        rolled.observations.some((o) => o.observationDate === date),
        false,
      )
    }
  })

  test('rollback is the exact inverse — the store returns to its prior state', () => {
    const before = storeOf(published())
    const applied = applyImportPlan(before, planFor(extra), 'import-g2')
    assert.equal(applied.ok, true)
    if (!applied.ok) return

    const rolled = rollbackImport(applied.store, applied.record)
    const norm = (s: HistoryStore) =>
      s.observations
        .map((o) => `${o.scope}|${o.basis}|${o.observationDate}|${o.value}`)
        .sort()
    assert.deepEqual(norm(rolled), norm(before))
  })

  test('a rolled-back correction restores the ORIGINAL value, it does not delete the week', () => {
    const restated = workbookThrough(extra).map((o) =>
      o.observationDate === '2026-07-17' && o.scope === 'jaime' ? { ...o, value: o.value + 7 } : o,
    )
    const plan = planWeeklyImport({
      workbookObservations: restated,
      publishedObservations: published(),
      historicalCorrectionAuthorized: true,
      correctionReason: 'restated',
    })
    const before = storeOf(published())
    const applied = applyImportPlan(before, plan, 'import-g3')
    assert.equal(applied.ok, true)
    if (!applied.ok) return

    const original = valueFor('jaime', 'total', '2026-07-17')
    const corrected = applied.store.observations.find(
      (o) => o.scope === 'jaime' && o.observationDate === '2026-07-17',
    )
    assert.equal(corrected?.value, original + 7)

    const rolled = rollbackImport(applied.store, applied.record)
    const restoredRow = rolled.observations.find(
      (o) => o.scope === 'jaime' && o.observationDate === '2026-07-17',
    )
    assert.equal(restoredRow?.value, original)
    // The week itself survives — it was published before this import existed.
    assert.ok(datesIn(rolled).includes('2026-07-17'))
    assert.deepEqual(datesIn(rolled), [...PUBLISHED_DATES])
  })
})

// ---------------------------------------------------------------------------
// Standing invariants
// ---------------------------------------------------------------------------

describe('standing invariants', () => {
  test('no scenario assumes one upload equals one reporting week', () => {
    for (const extra of [
      [] as string[],
      ['2026-08-07'],
      ['2026-08-07', '2026-08-14'],
      ['2026-08-07', '2026-08-14', '2026-08-21'],
      ['2026-08-07', '2026-08-21'],
    ]) {
      const plan = planFor(extra)
      assert.equal(plan.newDates.length, extra.length)
      assert.equal(plan.atomic, true)
    }
  })

  test('an unchanged re-upload of the same workbook writes nothing', () => {
    const plan = planFor([])
    assert.deepEqual(plan.newDates, [])
    assert.equal(plan.action, 'nothing_to_append')
    assert.deepEqual(plan.observationsToWrite, [])

    const before = storeOf(published())
    const result = applyImportPlan(before, plan, 'import-noop')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'nothing_to_write')
    assert.equal(result.store, before)
  })

  test('an empty Production accepts the workbook whole, with no correction gate', () => {
    const plan = planWeeklyImport({
      workbookObservations: weeks([...PUBLISHED_DATES]),
      publishedObservations: [],
    })
    assert.equal(plan.productionEndpoint, null)
    assert.deepEqual(plan.newDates, [...PUBLISHED_DATES])
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blocked, false)
  })

  test('a week published without an evolution point still bounds the endpoint', () => {
    // Production's observation series stops at 07-31, but 08-07 was published.
    // A workbook row for 08-07 is then a backfill, never a "new" week.
    const plan = planWeeklyImport({
      workbookObservations: workbookThrough(['2026-08-07']),
      publishedObservations: published(),
      latestPublishedAsOf: '2026-08-07',
    })
    assert.equal(plan.productionEndpoint, '2026-08-07')
    assert.deepEqual(plan.newDates, [])
    assert.deepEqual(plan.backfillDates, ['2026-08-07'])
    assert.equal(plan.requiresHistoricalCorrection, true)
  })

  test('a malformed observation is refused, never silently dropped', () => {
    const bad = planWeeklyImport({
      workbookObservations: [
        ...workbookThrough(['2026-08-07']),
        { scope: 'main', basis: 'total', observationDate: '2026-02-30', value: 1 },
      ],
      publishedObservations: published(),
    })
    assert.equal(bad.blocked, true)
    assert.ok(bad.blockCodes.includes('invalid_observation_date'))

    const dup = planWeeklyImport({
      workbookObservations: [
        ...workbookThrough(['2026-08-07']),
        { scope: 'main', basis: 'ex_chilean_equities', observationDate: '2026-08-07', value: 1 },
      ],
      publishedObservations: published(),
    })
    assert.equal(dup.blocked, true)
    assert.ok(dup.blockCodes.includes('duplicate_workbook_observation'))
  })

  test('the plan is versioned', () => {
    assert.equal(planFor(['2026-08-07']).planVersion, WEEKLY_IMPORT_PLAN_VERSION)
    assert.match(WEEKLY_IMPORT_PLAN_VERSION, /^r13\.8a\./)
  })

  test('the module is pure — no server, database or environment import', () => {
    const src = readFileSync(
      new URL('../src/lib/familyPortfolio/weeklyImportPlan.ts', import.meta.url),
      'utf8',
    )
    for (const forbidden of ['next/', '@supabase', 'process.env', 'getSupabase', 'node:fs']) {
      assert.equal(src.includes(forbidden), false, `weeklyImportPlan must not reference ${forbidden}`)
    }
  })

  test('no private monetary value is embedded in this suite', () => {
    const src = readFileSync(new URL(import.meta.url), 'utf8')
    // Every fixture value is derived from `valueFor`; nothing six digits or
    // longer should appear as a literal.
    const literals = src.match(/\b\d{6,}\b/g) ?? []
    assert.deepEqual(literals, [])
  })
})
