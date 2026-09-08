// R13.8B § "WORKBOOK HISTORY LEADS" — catch-up and gap-fill import planning.
//
// NO PRIVATE SOURCE DATA. Every value here is a small invented integer. These
// tests are about WHICH IDENTITIES move, not about what any portfolio is worth.
//
// WHAT THESE TESTS ARE FOR
// ────────────────────────
// One upload is not one reporting week, and there are three opposite ways of
// getting the import wrong:
//
//   * publishing only the newest frozen column and silently discarding the
//     weeks the administrator missed;
//   * manufacturing a week because the calendar says one should exist, when the
//     source never froze a column for it; and
//   * treating an INSERTION as an OVERWRITE — gating a gap fill behind a
//     correction reason nobody can honestly write, because nothing was
//     replaced.
//
// A suite that only checked the happy single-week path would pass while any of
// the three shipped. So the suite is built from one baseline and pushed in
// every direction: A proves catch-up append, B/C prove gap fill is an insertion
// and only an overwrite needs authorization, D proves an explicit `unavailable`
// row is an existing state rather than a hole, E proves absence is never
// invented, and F/G/H prove the whole import — history AND publication —
// commits, fails and reverses as one unit.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  planWeeklyImport,
  applyImportPlan,
  rollbackImport,
  canonicalize,
  WEEKLY_IMPORT_PLAN_VERSION,
  type HistoryStore,
  type PublicationState,
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

function canonicalWeeks(dates: readonly string[]) {
  return weeks(dates).map((o) => {
    const c = canonicalize(o)
    assert.ok(c, 'fixture must canonicalize')
    return c
  })
}

function publicationAt(asOfDate: string, importId: string | null = null): PublicationState {
  return { asOfDate, revision: 1, importId }
}

function storeOf(dates: readonly string[], asOfDate?: string): HistoryStore {
  const sorted = [...dates].sort()
  return {
    observations: canonicalWeeks(dates),
    currentPublication:
      sorted.length > 0 ? publicationAt(asOfDate ?? sorted[sorted.length - 1]) : null,
  }
}

function datesIn(store: HistoryStore): string[] {
  return [...new Set(store.observations.map((o) => o.observationDate))].sort()
}

function stateOf(store: HistoryStore, scope: string, date: string) {
  const row = store.observations.find((o) => o.scope === scope && o.observationDate === date)
  return row === undefined ? null : { value: row.value, status: row.status }
}

/** Normalised full-store comparison, so "exact inverse" is really exact. */
function normalize(store: HistoryStore): string[] {
  return store.observations
    .map((o) => [o.scope, o.basis, o.seriesIdentity, o.observationDate, o.status, o.value].join('|'))
    .sort()
}

// ---------------------------------------------------------------------------
// A · Production endpoint 07-31; workbook 08-07, 08-14, 08-21
// ---------------------------------------------------------------------------

describe('A · three missed weeks, all present in the workbook', () => {
  const PRODUCTION = ['2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31']
  const EXTRA = ['2026-08-07', '2026-08-14', '2026-08-21']

  const plan = (): WeeklyImportPlan =>
    planWeeklyImport({
      workbookObservations: weeks([...PRODUCTION, ...EXTRA]),
      publishedObservations: weeks(PRODUCTION),
    })

  test('all three are NEW — never only the newest', () => {
    const p = plan()
    assert.equal(p.productionEndpoint, '2026-07-31')
    assert.deepEqual(p.newDates, EXTRA)
    assert.deepEqual(p.gapFillDates, [])
    assert.deepEqual(p.changedDates, [])
    assert.equal(p.action, 'multi_week_append')
  })

  test('ONE publication, dated at the newest valid frozen reporting date', () => {
    const p = plan()
    assert.equal(p.publicationDate, '2026-08-21')

    const applied = applyImportPlan(storeOf(PRODUCTION), p, 'import-a')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.equal(applied.store.currentPublication?.asOfDate, '2026-08-21')
    assert.equal(applied.store.currentPublication?.importId, 'import-a')
    // No intermediate revision was minted for 08-07 or 08-14.
    assert.equal(applied.store.currentPublication?.revision, 1)
    assert.deepEqual(applied.record.appendedDates, EXTRA)
    assert.deepEqual(applied.record.gapFilledDates, [])
    assert.deepEqual(applied.record.correctedDates, [])
  })

  test('no correction reason is required, and the old weeks are not rewritten', () => {
    const p = plan()
    assert.equal(p.requiresHistoricalCorrection, false)
    assert.equal(p.correctionReason, null)
    assert.equal(p.blocked, false)
    assert.deepEqual(p.unchangedDates, PRODUCTION)

    const written = [...new Set(p.observationsToWrite.map((o) => o.observationDate))].sort()
    assert.deepEqual(written, EXTRA)
    assert.equal(p.observationsToWrite.length, SERIES.length * 3)
  })
})

// ---------------------------------------------------------------------------
// B · Production has 07-31, 08-07, 08-21; workbook also has 08-14
// ---------------------------------------------------------------------------

describe('B · a hole below the endpoint is GAP_FILL', () => {
  const PRODUCTION = ['2026-07-31', '2026-08-07', '2026-08-21']
  const WORKBOOK = ['2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21']

  const plan = (): WeeklyImportPlan =>
    planWeeklyImport({
      workbookObservations: weeks(WORKBOOK),
      publishedObservations: weeks(PRODUCTION),
    })

  test('08-14 classifies as GAP_FILL, not NEW and not CHANGED', () => {
    const p = plan()
    assert.equal(p.productionEndpoint, '2026-08-21')
    assert.deepEqual(p.gapFillDates, ['2026-08-14'])
    assert.deepEqual(p.newDates, [])
    assert.deepEqual(p.changedDates, [])
    const week = p.weeks.find((w) => w.observationDate === '2026-08-14')
    assert.equal(week?.disposition, 'gap_fill')
    assert.equal(week?.counts.gap_fill, SERIES.length)
  })

  test('it is inserted with NO correction reason required', () => {
    const p = plan()
    assert.equal(p.requiresHistoricalCorrection, false)
    assert.equal(p.blocked, false)
    assert.deepEqual(p.blockCodes, [])
    assert.deepEqual(p.corrections, [])
    assert.equal(p.action, 'append_single_week')

    const applied = applyImportPlan(storeOf(PRODUCTION), p, 'import-b')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.deepEqual(applied.record.gapFilledDates, ['2026-08-14'])
    assert.deepEqual(applied.record.appendedDates, [])
    assert.deepEqual(datesIn(applied.store), WORKBOOK)
  })

  test('the publication still lands on the newest frozen date, not the gap fill', () => {
    const applied = applyImportPlan(storeOf(PRODUCTION), plan(), 'import-b2')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.equal(applied.store.currentPublication?.asOfDate, '2026-08-21')
  })

  test('filling the hole closes the cadence gap it was reported under', () => {
    // Before the fill, 08-07 → 08-21 is a 14-day gap. The plan measures cadence
    // over the POST-import sequence, so it correctly reports none.
    assert.deepEqual(plan().cadenceGaps, [])
  })
})

// ---------------------------------------------------------------------------
// C · Same as B, but the existing 08-07 value also differs
// ---------------------------------------------------------------------------

describe('C · gap fill alongside a genuine overwrite', () => {
  const PRODUCTION = ['2026-07-31', '2026-08-07', '2026-08-21']
  const WORKBOOK = ['2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21']

  function restated(): SeriesObservation[] {
    return weeks(WORKBOOK).map((o) =>
      o.observationDate === '2026-08-07' && o.scope === 'jaime' ? { ...o, value: 4242 } : o,
    )
  }

  const plan = (opts: { authorized?: boolean; reason?: string } = {}): WeeklyImportPlan =>
    planWeeklyImport({
      workbookObservations: restated(),
      publishedObservations: weeks(PRODUCTION),
      historicalCorrectionAuthorized: opts.authorized,
      correctionReason: opts.reason ?? null,
    })

  test('08-14 is GAP_FILL and 08-07 is CHANGED — classified independently', () => {
    const p = plan()
    assert.deepEqual(p.gapFillDates, ['2026-08-14'])
    assert.deepEqual(p.changedDates, ['2026-08-07'])
    assert.equal(p.gapFillDates.includes('2026-08-07'), false)
    assert.equal(p.changedDates.includes('2026-08-14'), false)
    assert.equal(p.action, 'append_with_correction')
  })

  test('authorization is required ONLY because of 08-07', () => {
    const p = plan()
    assert.equal(p.requiresHistoricalCorrection, true)
    assert.deepEqual(p.blockCodes, ['historical_correction_required'])

    // Remove the overwrite and the same gap fill sails through untouched.
    const gapOnly = planWeeklyImport({
      workbookObservations: weeks(WORKBOOK),
      publishedObservations: weeks(PRODUCTION),
    })
    assert.equal(gapOnly.requiresHistoricalCorrection, false)
    assert.deepEqual(gapOnly.gapFillDates, ['2026-08-14'])
  })

  test('only the ONE restated series row is a correction, not the whole week', () => {
    const week = plan().weeks.find((w) => w.observationDate === '2026-08-07')
    assert.ok(week)
    assert.equal(week.counts.changed, 1)
    assert.equal(week.counts.unchanged, SERIES.length - 1)
    assert.equal(week.disposition, 'changed')
  })

  test('Preview gets a before → after for the overwrite, and none for the gap fill', () => {
    const p = plan()
    assert.equal(p.corrections.length, 1)
    const c = p.corrections[0]
    assert.equal(c.observationDate, '2026-08-07')
    assert.equal(c.scope, 'jaime')
    assert.equal(c.beforeValue, valueFor('jaime', 'total', '2026-08-07'))
    assert.equal(c.beforeStatus, 'stated')
    assert.equal(c.afterValue, 4242)
    assert.equal(c.afterStatus, 'stated')
  })

  test('authorization without a reason is still refused', () => {
    const p = plan({ authorized: true, reason: '   ' })
    assert.equal(p.blocked, true)
    assert.deepEqual(p.blockCodes, ['correction_reason_required'])
  })

  test('authorized with a reason, gap fill and correction land together', () => {
    const p = plan({ authorized: true, reason: 'Custodian restated 08-07.' })
    assert.equal(p.blocked, false)
    assert.equal(p.correctionReason, 'Custodian restated 08-07.')

    const applied = applyImportPlan(storeOf(PRODUCTION), p, 'import-c')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.deepEqual(applied.record.gapFilledDates, ['2026-08-14'])
    assert.deepEqual(applied.record.correctedDates, ['2026-08-07'])
    assert.equal(applied.record.correctionReason, 'Custodian restated 08-07.')
  })

  test('a blocked plan writes nothing — the innocent gap fill included', () => {
    const before = storeOf(PRODUCTION)
    const result = applyImportPlan(before, plan(), 'import-c2')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'plan_blocked')
    assert.equal(result.store, before)
    assert.deepEqual(datesIn(result.store), PRODUCTION)
  })
})

// ---------------------------------------------------------------------------
// D · Production holds an explicit `unavailable` 08-14
// ---------------------------------------------------------------------------

describe('D · an explicit unavailable row is a state, not a hole', () => {
  const PRODUCTION = ['2026-07-31', '2026-08-07', '2026-08-21']

  /** Production additionally holds 08-14 for `jaime`, explicitly unavailable. */
  function productionWithUnavailable(): SeriesObservation[] {
    return [
      ...weeks(PRODUCTION),
      {
        scope: 'jaime',
        basis: 'total',
        observationDate: '2026-08-14',
        value: null,
        status: 'unavailable' as const,
      },
    ]
  }

  const WORKBOOK = ['2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21']

  const plan = (opts: { authorized?: boolean; reason?: string } = {}): WeeklyImportPlan =>
    planWeeklyImport({
      workbookObservations: weeks(WORKBOOK),
      publishedObservations: productionWithUnavailable(),
      historicalCorrectionAuthorized: opts.authorized,
      correctionReason: opts.reason ?? null,
    })

  test('supplying a number for it is CHANGED, never GAP_FILL', () => {
    const p = plan()
    const jaime = p.observationsToWrite.find(
      (o) => o.scope === 'jaime' && o.observationDate === '2026-08-14',
    )
    assert.ok(jaime)
    assert.equal(jaime.disposition, 'changed')
    assert.equal(jaime.priorStatus, 'unavailable')
    assert.equal(jaime.priorValue, null)
    assert.deepEqual(p.changedDates, ['2026-08-14'])
  })

  test('the other four scopes on that same date ARE genuinely absent — gap fill', () => {
    const p = plan()
    const others = p.observationsToWrite.filter(
      (o) => o.observationDate === '2026-08-14' && o.scope !== 'jaime',
    )
    assert.equal(others.length, SERIES.length - 1)
    assert.ok(others.every((o) => o.disposition === 'gap_fill'))
    assert.ok(others.every((o) => o.priorStatus === null))
    // The date therefore appears in BOTH Preview groups, which is the truth.
    assert.deepEqual(p.gapFillDates, ['2026-08-14'])
  })

  test('it requires correction authorization because a state is being replaced', () => {
    const p = plan()
    assert.equal(p.requiresHistoricalCorrection, true)
    assert.equal(p.blocked, true)
    assert.equal(p.corrections.length, 1)
    assert.equal(p.corrections[0].beforeStatus, 'unavailable')
    assert.equal(p.corrections[0].afterStatus, 'stated')
  })

  test('an unavailable row that stays unavailable is UNCHANGED', () => {
    const p = planWeeklyImport({
      workbookObservations: [
        ...weeks(PRODUCTION),
        {
          scope: 'jaime',
          basis: 'total',
          observationDate: '2026-08-14',
          value: null,
          status: 'unavailable' as const,
        },
      ],
      publishedObservations: productionWithUnavailable(),
    })
    assert.deepEqual(p.changedDates, [])
    assert.deepEqual(p.gapFillDates, [])
    assert.equal(p.action, 'nothing_to_append')
  })

  test('a contradictory observation is INVALID rather than reconciled', () => {
    assert.equal(
      canonicalize({
        scope: 'main',
        basis: 'total',
        observationDate: '2026-08-14',
        value: 5,
        status: 'unavailable',
      }),
      null,
    )
    assert.equal(
      canonicalize({
        scope: 'main',
        basis: 'total',
        observationDate: '2026-08-14',
        value: null,
        status: 'stated',
      }),
      null,
    )

    const p = planWeeklyImport({
      workbookObservations: [
        ...weeks(WORKBOOK),
        {
          scope: 'main',
          basis: 'total',
          observationDate: '2026-08-28',
          value: Number.NaN,
        },
      ],
      publishedObservations: weeks(PRODUCTION),
    })
    assert.equal(p.blocked, true)
    assert.ok(p.blockCodes.includes('invalid_observation'))
    assert.deepEqual(p.invalidDates, ['2026-08-28'])
  })
})

// ---------------------------------------------------------------------------
// E · The calendar has 08-14 but the workbook does not
// ---------------------------------------------------------------------------

describe('E · absence in the workbook is never invented', () => {
  const PRODUCTION = ['2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31']
  const EXTRA = ['2026-08-07', '2026-08-21']

  const plan = (): WeeklyImportPlan =>
    planWeeklyImport({
      workbookObservations: weeks([...PRODUCTION, ...EXTRA]),
      publishedObservations: weeks(PRODUCTION),
    })

  test('no 08-14 observation is created, forward-filled or interpolated', () => {
    const p = plan()
    assert.deepEqual(p.newDates, EXTRA)
    assert.equal(p.newDates.includes('2026-08-14'), false)
    assert.equal(
      p.weeks.some((w) => w.observationDate === '2026-08-14'),
      false,
    )
    assert.equal(
      p.observationsToWrite.some((o) => o.observationDate === '2026-08-14'),
      false,
    )
    assert.equal(p.observationsToWrite.length, SERIES.length * 2)
  })

  test('no synthetic zero or unavailable point is created to make the cadence weekly', () => {
    const p = plan()
    const applied = applyImportPlan(storeOf(PRODUCTION), p, 'import-e')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.equal(
      applied.store.observations.some((o) => o.observationDate === '2026-08-14'),
      false,
    )
    assert.equal(
      applied.store.observations.some((o) => o.status === 'unavailable'),
      false,
    )
  })

  test('the absence surfaces as an informational cadence gap, never a conflict', () => {
    const p = plan()
    assert.deepEqual(p.cadenceGaps, [{ from: '2026-08-07', to: '2026-08-21', days: 14 }])
    assert.equal(p.blocked, false)
    assert.equal(p.requiresHistoricalCorrection, false)
  })

  test('the general invariant: no planned date the workbook did not state', () => {
    const p = plan()
    const stated = new Set(weeks([...PRODUCTION, ...EXTRA]).map((o) => o.observationDate))
    for (const w of p.weeks) assert.ok(stated.has(w.observationDate))
    for (const o of p.observationsToWrite) assert.ok(stated.has(o.observationDate))
    assert.ok(p.publicationDate === null || stated.has(p.publicationDate))
  })
})

// ---------------------------------------------------------------------------
// F · Three NEW + two GAP_FILL in one workbook
// ---------------------------------------------------------------------------

const MIXED_PRODUCTION = ['2026-07-03', '2026-07-10', '2026-07-31']
const MIXED_WORKBOOK = [
  '2026-07-03',
  '2026-07-10',
  '2026-07-17',
  '2026-07-24',
  '2026-07-31',
  '2026-08-07',
  '2026-08-14',
  '2026-08-21',
]
const MIXED_GAPS = ['2026-07-17', '2026-07-24']
const MIXED_NEW = ['2026-08-07', '2026-08-14', '2026-08-21']

function mixedPlan(): WeeklyImportPlan {
  return planWeeklyImport({
    workbookObservations: weeks(MIXED_WORKBOOK),
    publishedObservations: weeks(MIXED_PRODUCTION),
  })
}

describe('F · five insertions and one publication commit atomically', () => {
  test('three NEW and two GAP_FILL are classified correctly', () => {
    const p = mixedPlan()
    assert.equal(p.productionEndpoint, '2026-07-31')
    assert.deepEqual(p.newDates, MIXED_NEW)
    assert.deepEqual(p.gapFillDates, MIXED_GAPS)
    assert.deepEqual(p.changedDates, [])
    assert.equal(p.requiresHistoricalCorrection, false)
    assert.equal(p.action, 'multi_week_append')
  })

  test('all five history inserts plus the newest publication land together', () => {
    const before = storeOf(MIXED_PRODUCTION)
    const applied = applyImportPlan(before, mixedPlan(), 'import-f')
    assert.equal(applied.ok, true)
    if (!applied.ok) return

    assert.deepEqual(datesIn(applied.store), MIXED_WORKBOOK)
    assert.deepEqual(applied.record.appendedDates, MIXED_NEW)
    assert.deepEqual(applied.record.gapFilledDates, MIXED_GAPS)
    assert.equal(applied.store.currentPublication?.asOfDate, '2026-08-21')
    assert.equal(applied.written, SERIES.length * 5)
  })

  test('the input store is never mutated in place', () => {
    const before = storeOf(MIXED_PRODUCTION)
    const snapshot = normalize(before)
    applyImportPlan(before, mixedPlan(), 'import-f2')
    assert.deepEqual(normalize(before), snapshot)
    assert.equal(before.currentPublication?.asOfDate, '2026-07-31')
  })
})

// ---------------------------------------------------------------------------
// G · Failure on any one of the five
// ---------------------------------------------------------------------------

describe('G · a failed import persists nothing at all', () => {
  for (const failAt of MIXED_WORKBOOK.filter((d) => !MIXED_PRODUCTION.includes(d))) {
    test(`a corrupted row on ${failAt} leaves zero history and zero publication change`, () => {
      const p = mixedPlan()
      // The boundary check catching a corrupted row — the defence-in-depth
      // path. Earlier rows have already been staged when it fires.
      const corrupted: WeeklyImportPlan = {
        ...p,
        observationsToWrite: p.observationsToWrite.map((o) =>
          o.observationDate === failAt ? { ...o, value: Number.NaN } : o,
        ),
      }

      const before = storeOf(MIXED_PRODUCTION)
      const result = applyImportPlan(before, corrupted, 'import-g')

      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.code, 'uninterpretable_observation')
      // Identity, not equality: the store object itself never moved.
      assert.equal(result.store, before)
      assert.deepEqual(datesIn(result.store), MIXED_PRODUCTION)
      assert.equal(result.store.currentPublication?.asOfDate, '2026-07-31')
      for (const date of [...MIXED_NEW, ...MIXED_GAPS]) {
        assert.equal(
          result.store.observations.some((o) => o.observationDate === date),
          false,
        )
      }
    })
  }
})

// ---------------------------------------------------------------------------
// H · Rolling back a successful catch-up
// ---------------------------------------------------------------------------

describe('H · rollback reverses every mutation the import made', () => {
  const PRODUCTION = ['2026-07-03', '2026-07-10', '2026-07-31']

  function mixedWithCorrection(): SeriesObservation[] {
    return weeks(MIXED_WORKBOOK).map((o) =>
      o.observationDate === '2026-07-10' && o.scope === 'andres' ? { ...o, value: 777 } : o,
    )
  }

  function fullPlan(): WeeklyImportPlan {
    return planWeeklyImport({
      workbookObservations: mixedWithCorrection(),
      publishedObservations: weeks(PRODUCTION),
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian restated 07-10.',
    })
  }

  test('NEW and GAP_FILL rows are removed, CHANGED rows restored, publication restored', () => {
    const before = storeOf(PRODUCTION)
    const applied = applyImportPlan(before, fullPlan(), 'import-h')
    assert.equal(applied.ok, true)
    if (!applied.ok) return

    assert.deepEqual(applied.record.appendedDates, MIXED_NEW)
    assert.deepEqual(applied.record.gapFilledDates, MIXED_GAPS)
    assert.deepEqual(applied.record.correctedDates, ['2026-07-10'])
    assert.deepEqual(stateOf(applied.store, 'andres', '2026-07-10'), {
      value: 777,
      status: 'stated',
    })

    const rolled = rollbackImport(applied.store, applied.record)
    assert.equal(rolled.ok, true)
    if (!rolled.ok) return

    for (const date of [...MIXED_NEW, ...MIXED_GAPS]) {
      assert.equal(
        rolled.store.observations.some((o) => o.observationDate === date),
        false,
      )
    }
    assert.deepEqual(stateOf(rolled.store, 'andres', '2026-07-10'), {
      value: valueFor('andres', 'total', '2026-07-10'),
      status: 'stated',
    })
    assert.equal(rolled.store.currentPublication?.asOfDate, '2026-07-31')
    assert.deepEqual(rolled.store.currentPublication, before.currentPublication)
  })

  test('rollback is the exact inverse of apply', () => {
    const before = storeOf(PRODUCTION)
    const applied = applyImportPlan(before, fullPlan(), 'import-h2')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    const rolled = rollbackImport(applied.store, applied.record)
    assert.equal(rolled.ok, true)
    if (!rolled.ok) return
    assert.deepEqual(normalize(rolled.store), normalize(before))
  })

  test('a rolled-back overwrite of an unavailable row restores UNAVAILABLE, not a number', () => {
    const production: SeriesObservation[] = [
      ...weeks(PRODUCTION),
      {
        scope: 'pablo',
        basis: 'total',
        observationDate: '2026-07-31',
        value: null,
        status: 'unavailable',
      },
    ]
    // `pablo` already has a stated 07-31 row from `weeks`, so replace it.
    const withUnavailable = production.filter(
      (o, i) =>
        !(o.scope === 'pablo' && o.observationDate === '2026-07-31' && i < production.length - 1),
    )

    const plan = planWeeklyImport({
      workbookObservations: weeks(MIXED_WORKBOOK),
      publishedObservations: withUnavailable,
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian supplied the missing 07-31 figure.',
    })
    assert.deepEqual(plan.changedDates, ['2026-07-31'])

    const before: HistoryStore = {
      observations: withUnavailable.map((o) => {
        const c = canonicalize(o)
        assert.ok(c)
        return c
      }),
      currentPublication: publicationAt('2026-07-31'),
    }
    const applied = applyImportPlan(before, plan, 'import-h3')
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.equal(stateOf(applied.store, 'pablo', '2026-07-31')?.status, 'stated')

    const rolled = rollbackImport(applied.store, applied.record)
    assert.equal(rolled.ok, true)
    if (!rolled.ok) return
    assert.deepEqual(stateOf(rolled.store, 'pablo', '2026-07-31'), {
      value: null,
      status: 'unavailable',
    })
  })

  test('rolling back a SUPERSEDED import is refused, not attempted', () => {
    const before = storeOf(PRODUCTION)
    const first = applyImportPlan(before, mixedPlan(), 'import-h4')
    assert.equal(first.ok, true)
    if (!first.ok) return

    // A later import moves the current publication on.
    const laterPlan = planWeeklyImport({
      workbookObservations: weeks([...MIXED_WORKBOOK, '2026-08-28']),
      publishedObservations: first.store.observations,
    })
    const second = applyImportPlan(first.store, laterPlan, 'import-h5')
    assert.equal(second.ok, true)
    if (!second.ok) return

    const stale = rollbackImport(second.store, first.record)
    assert.equal(stale.ok, false)
    if (stale.ok) return
    assert.equal(stale.code, 'superseded_by_later_import')
    assert.equal(stale.store, second.store)
  })
})

// ---------------------------------------------------------------------------
// Preview shape (§ 6) and standing invariants
// ---------------------------------------------------------------------------

describe('Preview separates the three groups', () => {
  test('gap fills, new dates and corrections are reported independently', () => {
    const PRODUCTION = ['2026-07-31', '2026-08-07', '2026-08-21']
    const p = planWeeklyImport({
      workbookObservations: weeks([...PRODUCTION, '2026-08-14', '2026-08-28']),
      publishedObservations: weeks(PRODUCTION),
    })

    assert.equal(p.productionEndpoint, '2026-08-21')
    assert.deepEqual(p.gapFillDates, ['2026-08-14'])
    assert.deepEqual(p.newDates, ['2026-08-28'])
    assert.deepEqual(p.changedDates, [])
    assert.deepEqual(p.corrections, [])
    // Normal confirm is allowed: nothing is blocked.
    assert.equal(p.blocked, false)
    assert.equal(p.action, 'multi_week_append')
    assert.equal(p.publicationDate, '2026-08-28')
  })
})

describe('standing invariants', () => {
  test('no scenario assumes one upload equals one reporting week', () => {
    const PRODUCTION = ['2026-07-24', '2026-07-31']
    for (const extra of [
      [] as string[],
      ['2026-08-07'],
      ['2026-08-07', '2026-08-14'],
      ['2026-08-07', '2026-08-14', '2026-08-21'],
      ['2026-08-07', '2026-08-21'],
    ]) {
      const p = planWeeklyImport({
        workbookObservations: weeks([...PRODUCTION, ...extra]),
        publishedObservations: weeks(PRODUCTION),
      })
      assert.equal(p.newDates.length, extra.length)
      assert.equal(p.atomic, true)
    }
  })

  test('an unchanged re-upload of the same workbook writes nothing', () => {
    const PRODUCTION = ['2026-07-24', '2026-07-31']
    const p = planWeeklyImport({
      workbookObservations: weeks(PRODUCTION),
      publishedObservations: weeks(PRODUCTION),
    })
    assert.equal(p.action, 'nothing_to_append')
    assert.deepEqual(p.observationsToWrite, [])

    const before = storeOf(PRODUCTION)
    const result = applyImportPlan(before, p, 'import-noop')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'nothing_to_write')
    assert.equal(result.store, before)
  })

  test('an empty Production accepts the workbook whole, with no correction gate', () => {
    const dates = ['2026-07-24', '2026-07-31']
    const p = planWeeklyImport({
      workbookObservations: weeks(dates),
      publishedObservations: [],
    })
    assert.equal(p.productionEndpoint, null)
    assert.deepEqual(p.newDates, dates)
    assert.deepEqual(p.gapFillDates, [])
    assert.equal(p.requiresHistoricalCorrection, false)
    assert.equal(p.blocked, false)
  })

  test('a week published without an evolution point still bounds the endpoint', () => {
    const PRODUCTION = ['2026-07-24', '2026-07-31']
    const p = planWeeklyImport({
      workbookObservations: weeks([...PRODUCTION, '2026-08-07']),
      publishedObservations: weeks(PRODUCTION),
      latestPublishedAsOf: '2026-08-07',
    })
    assert.equal(p.productionEndpoint, '2026-08-07')
    // Below the endpoint and absent → a gap fill, and still an insertion that
    // needs no correction reason.
    assert.deepEqual(p.newDates, [])
    assert.deepEqual(p.gapFillDates, ['2026-08-07'])
    assert.equal(p.requiresHistoricalCorrection, false)
    assert.equal(p.blocked, false)
  })

  test('a duplicate workbook identity is refused, never silently deduplicated', () => {
    const PRODUCTION = ['2026-07-31']
    const dup = planWeeklyImport({
      workbookObservations: [
        ...weeks([...PRODUCTION, '2026-08-07']),
        { scope: 'main', basis: 'ex_chilean_equities', observationDate: '2026-08-07', value: 1 },
      ],
      publishedObservations: weeks(PRODUCTION),
    })
    assert.equal(dup.blocked, true)
    assert.ok(dup.blockCodes.includes('duplicate_workbook_observation'))
  })

  test('the plan is versioned', () => {
    // R13.8C.2 bumped it: the plan gained a second classification axis (the
    // publication half of the no-op question), which is a semantics change and
    // not a refactor. A recorded plan version must say which semantics ran.
    assert.match(WEEKLY_IMPORT_PLAN_VERSION, /^r13\.8c2\./)
    const p = planWeeklyImport({ workbookObservations: [], publishedObservations: [] })
    assert.equal(p.planVersion, WEEKLY_IMPORT_PLAN_VERSION)
    assert.equal(p.publicationDate, null)
  })

  test('the module is pure — no server, database or environment import', () => {
    const src = readFileSync(
      new URL('../src/lib/familyPortfolio/weeklyImportPlan.ts', import.meta.url),
      'utf8',
    )
    for (const forbidden of ['next/', '@supabase', 'process.env', 'getSupabase', 'node:fs']) {
      assert.equal(
        src.includes(forbidden),
        false,
        `weeklyImportPlan must not reference ${forbidden}`,
      )
    }
  })

  test('rollback never matches on a filename or an upload id', () => {
    // Scanned with COMMENTS STRIPPED. The module's own prose says "never derive
    // an identity from a filename or an upload id", and a naive text scan would
    // match that prohibition and call it a violation.
    const src = readFileSync(
      new URL('../src/lib/familyPortfolio/weeklyImportPlan.ts', import.meta.url),
      'utf8',
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    assert.ok(code.includes('identityKey'), 'comment stripping must not empty the file')
    for (const forbidden of ['fileName', 'filename', 'sha256', 'uploadId', 'upload_id']) {
      assert.equal(code.includes(forbidden), false, `rollback must not key on ${forbidden}`)
    }
    // And the identity really is the canonical tuple, nothing else.
    assert.match(code, /\[o\.scope, o\.basis, o\.seriesIdentity \?\? '', o\.observationDate\]/)
  })

  test('no private monetary value is embedded in this suite', () => {
    const src = readFileSync(new URL(import.meta.url), 'utf8')
    const literals = src.match(/\b\d{6,}\b/g) ?? []
    assert.deepEqual(literals, [])
  })
})
