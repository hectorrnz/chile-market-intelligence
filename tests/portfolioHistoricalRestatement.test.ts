// R13.8D.1 — HISTORICAL PUBLICATION RESTATEMENT.
//
// WHAT THIS SUITE GUARDS.
//
// R13.8C.2 established that history equality is not publication equality FOR THE
// WEEK BEING PUBLISHED. This suite guards the same asymmetry one step back: a
// workbook can leave every evolution level identical — so the planner correctly
// reports zero CHANGED — while restating how an ALREADY-PUBLISHED week attributed
// that level, moving an amount from net flows into weekly profit and carrying the
// difference through YTD.
//
// Before this stage such an import appended its new weeks and left the published
// weeks disagreeing with the authoritative workbook: unreported in the preview,
// unauthorized by the gate, and unreversed by rollback. Every test below fails if
// that behaviour returns.
//
// The real workbook this was built against restates seven consecutive weeks on
// one series. NOTHING HERE HARD-CODES THAT: the fixtures are synthetic and the
// detection is rediscovered from state, exactly as the production path does it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  planWeeklyImport,
  applyImportPlan,
  rollbackImport,
  WEEKLY_IMPORT_PLAN_VERSION,
  type SeriesObservation,
  type HistoricalPublicationRestatement,
  type HistoryStore,
  type PublicationState,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'
import {
  previewFromPlan,
  planFingerprint,
  IMPORT_PREVIEW_VERSION,
  type FrozenColumnSelection,
} from '../src/lib/familyPortfolio/weeklyImportPreview.ts'
import {
  comparePublicationPayload,
  type ComparableSnapshotRow,
  type ComparablePerformanceRow,
} from '../src/lib/familyPortfolio/publicationMaterialDiff.ts'
import {
  isNoOp,
  describeImportPlan,
  restatedFieldCount,
  type ImportPlan,
} from '../src/lib/familyPortfolio/importPlanPresentation.ts'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const migration = read('../supabase/migrations/20260821000000_portfolio_import_operations.sql')
const dbTest = read('../supabase/tests/database/portfolio_import_operations_test.sql')
const route = read('../src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts')
const previewServer = read('../src/lib/familyPortfolio/importPreviewServer.ts')
const planModule = read('../src/lib/familyPortfolio/weeklyImportPlan.ts')
const previewModule = read('../src/lib/familyPortfolio/weeklyImportPreview.ts')
const card = read('../src/components/familyPortfolio/ImportPlanPreview.tsx')
const i18n = read('../src/lib/i18n.ts')

/** The body of one plpgsql function, so an ordering assertion cannot stray. */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  assert.ok(start > 0, `${name} must exist`)
  const end = sql.indexOf('end $$;', start)
  assert.ok(end > start, `${name} must terminate`)
  return sql.slice(start, end)
}

const importFn = fnBody(migration, 'nmi_import_portfolio_workbook')
const rollbackFn = fnBody(migration, 'nmi_rollback_portfolio_import')

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures. Synthetic, round, and never a real holding.
// ─────────────────────────────────────────────────────────────────────────────

const WEEKS = ['2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26'] as const

function obs(date: string, value: number, scope = 'main', basis = 'with_chilean_equities'): SeriesObservation {
  return { scope, basis, observationDate: date, value, status: 'stated' }
}

function snapshotRow(over: Partial<ComparableSnapshotRow> = {}): ComparableSnapshotRow {
  return {
    scope: 'main',
    row_key: 'main.total',
    parent_row_key: null,
    depth: 0,
    display_order: 1,
    row_type: 'portfolio_total',
    label_es: 'TOTAL',
    label_en: null,
    currency: 'USD',
    value: 1_000_000,
    value_class: 'source_value',
    source_sheet: 'RESUMEN',
    source_cell: 'CZ10',
    metadata: { sourceRow: 10, previousValue: 990_000, beginningOfYearValue: 900_000, difference: 10_000, differenceClass: 'nmi_calculated' },
    ...over,
  }
}

function perfRow(over: Partial<ComparablePerformanceRow> = {}): ComparablePerformanceRow {
  return {
    scope: 'main',
    basis: 'with_chilean_equities',
    metric: 'weekly_profit',
    value: 10_000,
    value_class: 'source_provided_return',
    source_sheet: 'RESUMEN',
    source_cell: 'CZ40',
    metadata: { sourceRow: 40, boundRowKey: 'main.total', boundSourceCell: 'CZ10', crossChecks: [] },
    ...over,
  }
}

function restatement(
  asOfDate: string,
  differenceCount = 5,
  publicationId = `pub-${asOfDate}`,
  revision = 2,
): HistoricalPublicationRestatement {
  return { asOfDate, publicationId, revision, differenceCount, differences: [] }
}

const FROZEN: FrozenColumnSelection = {
  publicationColumnLetter: 'DE',
  publicationDate: '2026-06-26',
  frozenDates: [...WEEKS],
  historicalColumnCount: WEEKS.length,
  liveColumnLetter: 'DJ',
  liveColumnDate: '2026-06-30',
  liveColumnPublishable: false,
  refusal: null,
}

function identity() {
  return {
    contractVersion: 'family_portfolio_workbook_v1',
    contractVerdict: 'supported' as const,
    sheetNames: ['RESUMEN'],
    frozen: FROZEN,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Detection — the comparison itself (cases A, B, C, K, L)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · detecting a restated published week', () => {
  test('A · evolution identical AND publication identical is NOT a restatement', () => {
    const stored = { rows: [snapshotRow()], performance: [perfRow()] }
    const incoming = { rows: [snapshotRow()], performance: [perfRow()] }
    const diff = comparePublicationPayload(stored, incoming)
    assert.equal(diff.comparison, 'unchanged')
    assert.equal(diff.differenceCount, 0)

    // And the planner, given no restatements, plans an ordinary import.
    const plan = planWeeklyImport({
      workbookObservations: WEEKS.map((d, i) => obs(d, 1000 + i)),
      publishedObservations: WEEKS.map((d, i) => obs(d, 1000 + i)),
      historicalPublicationRestatements: [],
    })
    assert.equal(plan.historicalPublicationRestatements.length, 0)
    assert.equal(plan.requiresPublicationRestatementCorrection, false)
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blocked, false)
  })

  test('B · a performance row that differs IS a restatement, even with identical levels', () => {
    const stored = { rows: [snapshotRow()], performance: [perfRow({ value: 10_000 })] }
    const incoming = { rows: [snapshotRow()], performance: [perfRow({ value: 12_500 })] }
    const diff = comparePublicationPayload(stored, incoming)
    assert.equal(diff.comparison, 'changed')
    assert.equal(diff.differenceCount, 1)
    const d = diff.differences[0]
    assert.equal(d.area, 'performance')
    assert.equal(d.scope, 'main')
    assert.equal(d.basis, 'with_chilean_equities')
    assert.equal(d.metric, 'weekly_profit')
    assert.equal(d.beforeValue, 10_000)
    assert.equal(d.afterValue, 12_500)
    // The SNAPSHOT LEVEL is untouched — which is exactly why the evolution
    // series cannot see this and why a second detector was needed.
    assert.equal(diff.differences.filter((x) => x.area === 'snapshot').length, 0)
  })

  test('C · flow falls by X while P&L rises by X — level unchanged, restatement detected', () => {
    // The real shape this stage was built for: an amount moves from net flows
    // into weekly profit. The portfolio total does not move at all.
    const X = 64_563.95
    const stored = {
      rows: [snapshotRow()],
      performance: [
        perfRow({ metric: 'flow', value: X, value_class: 'source_provided_flow' }),
        perfRow({ metric: 'weekly_profit', value: 168_949.39 }),
      ],
    }
    const incoming = {
      rows: [snapshotRow()],
      performance: [
        perfRow({ metric: 'flow', value: 0, value_class: 'source_provided_flow' }),
        perfRow({ metric: 'weekly_profit', value: 168_949.39 + X }),
      ],
    }
    const diff = comparePublicationPayload(stored, incoming)
    assert.equal(diff.comparison, 'changed')
    assert.equal(diff.differenceCount, 2)
    assert.deepEqual(diff.differences.map((d) => d.metric).sort(), ['flow', 'weekly_profit'])
    // The identity that makes this a REATTRIBUTION rather than a gain: the two
    // deltas cancel exactly.
    const byMetric = new Map(diff.differences.map((d) => [d.metric, d]))
    const flow = byMetric.get('flow')!
    const profit = byMetric.get('weekly_profit')!
    const flowDelta = (flow.afterValue ?? 0) - (flow.beforeValue ?? 0)
    const profitDelta = (profit.afterValue ?? 0) - (profit.beforeValue ?? 0)
    assert.equal(Math.abs(flowDelta + profitDelta) < 1e-9, true, 'the reattribution nets to zero')
    // And the level is genuinely unchanged, so no evolution point is corrected.
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-06-19', 1_000_000)],
      publishedObservations: [obs('2026-06-19', 1_000_000)],
      historicalPublicationRestatements: [restatement('2026-06-19', 2)],
    })
    assert.deepEqual(plan.changedDates, [])
    assert.equal(plan.corrections.length, 0)
    assert.equal(plan.requiresEvolutionCorrection, false)
    assert.equal(plan.requiresPublicationRestatementCorrection, true)
  })

  test('K · an operational-only difference is NOT a restatement', () => {
    // A blank line inserted above a section moves every source coordinate and
    // source row without changing a single published figure. Treating that as a
    // restatement would demand a written reason for a cosmetic workbook edit.
    const stored = { rows: [snapshotRow()], performance: [perfRow()] }
    const incoming = {
      rows: [snapshotRow({ source_cell: 'DA11', metadata: { ...snapshotRow().metadata, sourceRow: 11 } })],
      performance: [
        perfRow({
          source_cell: 'DA41',
          metadata: { ...perfRow().metadata, sourceRow: 41, boundSourceCell: 'DA11' },
        }),
      ],
    }
    const diff = comparePublicationPayload(stored, incoming)
    assert.equal(diff.comparison, 'unchanged')
    assert.equal(diff.differenceCount, 0)
  })

  test('L · a material metadata FIGURE difference IS a restatement', () => {
    // `previousValue`, `beginningOfYearValue`, `difference` and
    // `differenceClass` are published figures that happen to live in the
    // metadata column. Discarding the whole column as provenance would hide a
    // real restatement of the comparison a reader sees on screen.
    for (const key of ['previousValue', 'beginningOfYearValue', 'difference'] as const) {
      const base = snapshotRow()
      const stored = { rows: [base], performance: [perfRow()] }
      const incoming = {
        rows: [snapshotRow({ metadata: { ...base.metadata, [key]: 123_456 } })],
        performance: [perfRow()],
      }
      const diff = comparePublicationPayload(stored, incoming)
      assert.equal(diff.comparison, 'changed', `${key} must be material`)
      assert.equal(diff.differences[0].field, 'metadata')
    }
  })

  test('a restatement carries a structured identity, not a string to re-split', () => {
    const stored = { rows: [snapshotRow()], performance: [perfRow()] }
    const incoming = { rows: [snapshotRow({ value: 2 })], performance: [perfRow({ value: 2 })] }
    const diff = comparePublicationPayload(stored, incoming)
    for (const d of diff.differences) {
      assert.equal(typeof d.scope, 'string')
      assert.ok(d.scope.length > 0)
      if (d.area === 'performance') {
        assert.equal(typeof d.basis, 'string')
        assert.equal(typeof d.metric, 'string')
      } else {
        assert.equal(typeof d.rowKey, 'string')
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · The gate (cases D, E, F)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · the correction gate', () => {
  const SEVEN = [
    '2026-06-19', '2026-06-26', '2026-07-03', '2026-07-10',
    '2026-07-17', '2026-07-24', '2026-07-31',
  ]
  const FIVE_NEW = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04']

  const mixed = (over: Record<string, unknown> = {}) =>
    planWeeklyImport({
      // Everything Production holds is unchanged; the five newest weeks are new.
      workbookObservations: [...SEVEN, ...FIVE_NEW].map((d, i) => obs(d, 1000 + i)),
      publishedObservations: SEVEN.map((d, i) => obs(d, 1000 + i)),
      latestPublishedAsOf: '2026-07-31',
      historicalPublicationRestatements: SEVEN.map((d) => restatement(d, 5)),
      ...over,
    })

  test('D · seven restatements plus five new weeks require authorization', () => {
    const plan = mixed()
    assert.deepEqual(plan.newDates, FIVE_NEW)
    assert.deepEqual(plan.gapFillDates, [])
    // The evolution series is untouched — this is the whole point.
    assert.deepEqual(plan.changedDates, [])
    assert.equal(plan.corrections.length, 0)
    assert.equal(plan.requiresEvolutionCorrection, false)

    assert.equal(plan.historicalPublicationRestatements.length, 7)
    assert.deepEqual(plan.historicalRestatementDates, SEVEN)
    assert.equal(plan.requiresPublicationRestatementCorrection, true)
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.equal(plan.blocked, true)
    assert.ok(plan.blockCodes.includes('historical_correction_required'))
  })

  test('E · an ordinary Publish cannot bypass the gate', () => {
    // No authorization at all: the plan blocks, and a blocked plan writes nothing.
    const plan = mixed()
    assert.equal(plan.blocked, true)
    const store: HistoryStore = { observations: [], currentPublication: null }
    const applied = applyImportPlan(store, plan, 'imp-1')
    assert.equal(applied.ok, false)
    assert.equal(applied.ok === false && applied.code, 'plan_blocked')
    assert.equal(applied.store, store, 'the store object is returned by identity — nothing moved')
  })

  test('F · authorization without a written reason is still refused', () => {
    const plan = mixed({ historicalCorrectionAuthorized: true, correctionReason: '   ' })
    assert.equal(plan.blocked, true)
    assert.ok(plan.blockCodes.includes('correction_reason_required'))
    assert.equal(plan.correctionReason, null)
  })

  test('authorized WITH a reason proceeds, and the reason is recorded', () => {
    const plan = mixed({
      historicalCorrectionAuthorized: true,
      correctionReason: '  Workbook restates the sleeve attribution.  ',
    })
    assert.equal(plan.blocked, false)
    assert.equal(plan.correctionReason, 'Workbook restates the sleeve attribution.')
    assert.equal(plan.action, 'append_with_correction')
  })

  test('a restatement-only import is not a no-op', () => {
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-06-19', 1)],
      publishedObservations: [obs('2026-06-19', 1)],
      latestPublishedAsOf: '2026-06-19',
      historicalPublicationRestatements: [restatement('2026-06-19')],
      historicalCorrectionAuthorized: true,
      correctionReason: 'reattribution',
    })
    assert.deepEqual(plan.newDates, [])
    assert.equal(plan.observationsToWrite.length, 0)
    assert.equal(plan.publicationChanged, false)
    assert.notEqual(plan.action, 'nothing_to_append')
    assert.equal(plan.action, 'historical_correction_only')

    // The reference apply model must NOT refuse it as nothing to write.
    const store: HistoryStore = {
      observations: [],
      currentPublication: { asOfDate: '2026-06-19', revision: 1, importId: null },
      publications: { '2026-06-19': { asOfDate: '2026-06-19', revision: 1, importId: null } },
    }
    const applied = applyImportPlan(store, plan, 'imp-2')
    assert.equal(applied.ok, true)
  })

  test('a restatement reported with zero differences is ignored, never gated', () => {
    // Absence of evidence is not evidence: an entry claiming a week is restated
    // while carrying no difference cannot arm an authorization gate.
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-06-19', 1)],
      publishedObservations: [obs('2026-06-19', 1)],
      historicalPublicationRestatements: [restatement('2026-06-19', 0)],
    })
    assert.equal(plan.historicalPublicationRestatements.length, 0)
    assert.equal(plan.requiresHistoricalCorrection, false)
  })

  test('omitting the set entirely is "none observed", never "none exist"', () => {
    // Every pure caller and every review fixture must keep its pre-R13.8D.1
    // classification exactly.
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-06-19', 1)],
      publishedObservations: [obs('2026-06-19', 1)],
    })
    assert.deepEqual(plan.historicalPublicationRestatements, [])
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.action, 'nothing_to_append')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Atomic apply and rollback (cases G, H, I)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · one import operation, reversed whole', () => {
  const SEVEN = ['2026-06-19', '2026-06-26', '2026-07-03']
  const NEW = ['2026-08-07', '2026-08-14']

  function baseStore(): HistoryStore {
    const publications: Record<string, PublicationState> = {}
    for (const d of SEVEN) publications[d] = { asOfDate: d, revision: 1, importId: 'older' }
    publications['2026-07-31'] = { asOfDate: '2026-07-31', revision: 3, importId: 'older' }
    return {
      observations: [...SEVEN, '2026-07-31'].map((d, i) => ({
        scope: 'main',
        basis: 'with_chilean_equities',
        seriesIdentity: '',
        observationDate: d,
        value: 1000 + i,
        status: 'stated' as const,
      })),
      currentPublication: { asOfDate: '2026-07-31', revision: 3, importId: 'older' },
      publications,
    }
  }

  function mixedPlan() {
    return planWeeklyImport({
      workbookObservations: [...SEVEN, '2026-07-31', ...NEW].map((d, i) => obs(d, 1000 + i)),
      publishedObservations: [...SEVEN, '2026-07-31'].map((d, i) => obs(d, 1000 + i)),
      latestPublishedAsOf: '2026-07-31',
      historicalPublicationRestatements: SEVEN.map((d) => restatement(d, 5)),
      historicalCorrectionAuthorized: true,
      correctionReason: 'reattribution',
    })
  }

  test('I · a mixed import applies both halves and rollback restores the exact pre-state', () => {
    const before = baseStore()
    const plan = mixedPlan()
    assert.deepEqual(plan.newDates, NEW)
    assert.equal(plan.historicalPublicationRestatements.length, 3)

    const applied = applyImportPlan(before, plan, 'imp-mix')
    assert.equal(applied.ok, true)
    if (!applied.ok) return

    // Both halves landed.
    assert.equal(applied.record.appendedDates.length, 2)
    assert.deepEqual(applied.record.restatedDates, SEVEN)
    assert.equal(applied.record.publicationCorrections.length, 3)
    // Each corrected week got the NEXT revision OF ITS OWN DATE …
    for (const c of applied.record.publicationCorrections) {
      assert.equal(c.priorPublication?.revision, 1)
      assert.equal(c.newPublication.revision, 2)
      assert.equal(c.newPublication.asOfDate, c.asOfDate)
      assert.equal(c.newPublication.importId, 'imp-mix')
    }
    // … and NONE of them became the current publication. The newest frozen week
    // is still the one current publication this import produced.
    assert.equal(applied.store.currentPublication?.asOfDate, '2026-08-14')
    for (const d of SEVEN) {
      assert.notEqual(applied.store.currentPublication?.asOfDate, d)
    }

    const rolled = rollbackImport(applied.store, applied.record)
    assert.equal(rolled.ok, true)
    if (!rolled.ok) return

    // The five/two new weeks are gone …
    assert.deepEqual(
      rolled.store.observations.map((o) => o.observationDate).sort(),
      before.observations.map((o) => o.observationDate).sort(),
    )
    // … the current publication is back …
    assert.deepEqual(rolled.store.currentPublication, before.currentPublication)
    // … and EVERY corrected historical week is back on its original revision.
    assert.deepEqual(rolled.store.publications, before.publications)
  })

  test('G · a failure part-way through writes nothing at all', () => {
    // The reference model stages every mutation and commits none of them on
    // failure, returning the caller's own store object. A partially-applied
    // mixed import — new weeks without their corrections, or the reverse — is
    // exactly what a single transaction exists to make impossible.
    const before = baseStore()
    const plan = mixedPlan()
    const broken = {
      ...plan,
      observationsToWrite: [
        ...plan.observationsToWrite,
        // Uninterpretable: a `stated` point with no finite value.
        {
          scope: 'main',
          basis: 'with_chilean_equities',
          seriesIdentity: '',
          observationDate: '2026-08-21',
          value: Number.NaN,
          status: 'stated' as const,
          disposition: 'new' as const,
          priorValue: null,
          priorStatus: null,
        },
      ],
    }
    const applied = applyImportPlan(before, broken, 'imp-broken')
    assert.equal(applied.ok, false)
    assert.equal(applied.ok === false && applied.code, 'uninterpretable_observation')
    assert.equal(applied.store, before, 'the store is returned by identity — nothing moved')
    // And nothing was corrected either: the historical publications are untouched.
    assert.deepEqual(applied.store.publications, baseStore().publications)
  })

  test('H · rollback refuses when a later import re-published a corrected week', () => {
    const before = baseStore()
    const applied = applyImportPlan(before, mixedPlan(), 'imp-mix')
    assert.equal(applied.ok, true)
    if (!applied.ok) return

    // A later import corrects one of the same weeks.
    const moved: HistoryStore = {
      ...applied.store,
      publications: {
        ...applied.store.publications,
        [SEVEN[1]]: { asOfDate: SEVEN[1], revision: 3, importId: 'later-import' },
      },
    }
    const rolled = rollbackImport(moved, applied.record)
    assert.equal(rolled.ok, false)
    assert.equal(rolled.ok === false && rolled.code, 'superseded_by_later_import')
    assert.equal(rolled.store, moved, 'nothing is reversed when the rollback is refused')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The stale-preview fingerprint (case J)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · the plan fingerprint covers every restated week', () => {
  const base = () =>
    planWeeklyImport({
      workbookObservations: [obs('2026-06-19', 1), obs('2026-06-26', 2)],
      publishedObservations: [obs('2026-06-19', 1), obs('2026-06-26', 2)],
      latestPublishedAsOf: '2026-06-26',
      historicalPublicationRestatements: [
        restatement('2026-06-19', 5, 'pub-A', 1),
        restatement('2026-06-26', 3, 'pub-B', 2),
      ],
      historicalCorrectionAuthorized: true,
      correctionReason: 'reattribution',
    })

  test('J · a new revision on a restated week changes the fingerprint', () => {
    const before = planFingerprint(base())
    const after = planFingerprint({
      ...base(),
      historicalPublicationRestatements: [
        // Same week, same difference count — but a DIFFERENT standing revision,
        // which is what a concurrent republication produces.
        restatement('2026-06-19', 5, 'pub-A2', 2),
        restatement('2026-06-26', 3, 'pub-B', 2),
      ],
    })
    assert.notEqual(before, after)
  })

  test('a changed difference count changes the fingerprint', () => {
    const after = planFingerprint({
      ...base(),
      historicalPublicationRestatements: [
        restatement('2026-06-19', 6, 'pub-A', 1),
        restatement('2026-06-26', 3, 'pub-B', 2),
      ],
    })
    assert.notEqual(planFingerprint(base()), after)
  })

  test('a week dropping out of the restatement set changes the fingerprint', () => {
    const after = planFingerprint({
      ...base(),
      historicalPublicationRestatements: [restatement('2026-06-19', 5, 'pub-A', 1)],
    })
    assert.notEqual(planFingerprint(base()), after)
  })

  test('the fingerprint is stable when nothing moved', () => {
    assert.equal(planFingerprint(base()), planFingerprint(base()))
  })

  test('the fingerprint still covers the pre-R13.8D.1 assertions', () => {
    assert.match(previewModule, /canonical\.push\(`endpoint\|/)
    assert.match(previewModule, /canonical\.push\(`publication\|/)
    assert.match(previewModule, /canonical\.push\(`snapshot\|/)
    assert.match(previewModule, /canonical\.push\(\s*`restatement\|/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The preview an administrator actually reads
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · the preview reports restatements as their own category', () => {
  const SEVEN = ['2026-06-19', '2026-06-26', '2026-07-03']
  const NEW = ['2026-08-07', '2026-08-14']

  const plan = planWeeklyImport({
    workbookObservations: [...SEVEN, ...NEW].map((d, i) => obs(d, 1000 + i)),
    publishedObservations: SEVEN.map((d, i) => obs(d, 1000 + i)),
    latestPublishedAsOf: '2026-07-03',
    historicalPublicationRestatements: SEVEN.map((d) => ({
      ...restatement(d, 5),
      differences: [
        {
          area: 'performance' as const,
          identity: 'main|with_chilean_equities|flow',
          kind: 'changed' as const,
          field: 'value',
          scope: 'main',
          basis: 'with_chilean_equities',
          metric: 'flow',
          beforeValue: 64_563.95,
          afterValue: 0,
        },
      ],
    })),
    historicalCorrectionAuthorized: true,
    correctionReason: 'reattribution',
  })
  const preview = previewFromPlan(plan, identity())

  test('the five categories are reported separately, never merged', () => {
    assert.deepEqual(preview.newDates, NEW)
    assert.deepEqual(preview.gapFillDates, [])
    assert.deepEqual(preview.corrections, [], 'evolution overwrites stay their own list')
    assert.equal(preview.publicationChanged, false)
    assert.deepEqual(preview.historicalRestatementDates, SEVEN)
    assert.equal(preview.historicalRestatementCount, 3)
  })

  test('each restated week carries before / after / delta', () => {
    const week = preview.historicalRestatements[0]
    assert.equal(week.asOfDate, SEVEN[0])
    assert.equal(week.differenceCount, 5)
    const f = week.fields[0]
    assert.equal(f.scope, 'main')
    assert.equal(f.basis, 'with_chilean_equities')
    assert.equal(f.metric, 'flow')
    assert.equal(f.productionValue, 64_563.95)
    assert.equal(f.workbookValue, 0)
    assert.equal(f.delta, -64_563.95)
  })

  test('a delta is never invented against an absent side', () => {
    const p = previewFromPlan(
      planWeeklyImport({
        workbookObservations: [obs('2026-06-19', 1)],
        publishedObservations: [obs('2026-06-19', 1)],
        historicalPublicationRestatements: [
          {
            ...restatement('2026-06-19', 1),
            differences: [
              {
                area: 'snapshot',
                identity: 'main|new.row',
                kind: 'added',
                scope: 'main',
                rowKey: 'new.row',
                label: 'NEW',
              },
            ],
          },
        ],
        historicalCorrectionAuthorized: true,
        correctionReason: 'x',
      }),
      identity(),
    )
    assert.equal(p.historicalRestatements[0].fields[0].delta, null)
  })

  test('the sample is bounded and the true total is still reported', () => {
    // A week carries ~220 rows. The preview never dumps them.
    assert.ok(preview.historicalRestatements[0].fields.length < preview.historicalRestatements[0].differenceCount)
    assert.equal(restatedFieldCount(preview as unknown as ImportPlan), 15)
  })

  test('the verdict NAMES the restatement instead of only counting new weeks', () => {
    const strings = {
      verdictNothingTitle: 'nothing', verdictNothingBody: 'nothing',
      verdictAppendOneTitle: 'one', verdictAppendManyTitle: '{n} weeks',
      verdictAppendBody: 'append {date}', verdictAppendManyBody: 'append {n} {date}',
      verdictEndpointUnchanged: 'unchanged {date}',
      verdictGapFillOne: 'gap', verdictGapFillMany: '{g} gaps',
      verdictCorrectionTitle: 'correction', verdictCorrectionOnlyBody: '{c}',
      verdictCorrectionMixedBody: '{n}/{g}/{c}',
      verdictBlockedTitle: 'blocked', verdictBlockedBody: 'blocked',
      verdictPublicationTitle: 'pub', verdictPublicationBody: 'pub {d}',
      verdictPublicationMixedBody: 'pubmix {c} {d}',
      verdictRestatementTitle: 'RESTATED',
      verdictRestatementOnlyBody: 'only r={r} d={d}',
      verdictRestatementAppendBody: 'append n={n} r={r} d={d}',
      verdictRestatementEvolutionBody: 'evo c={c} r={r} d={d}',
    }
    const verdict = describeImportPlan(preview as unknown as ImportPlan, strings)
    assert.equal(verdict.title, 'RESTATED')
    assert.equal(verdict.body, 'append n=2 r=3 d=15')
    assert.equal(verdict.kind, 'correction')
  })

  test('a restatement is never presented as "nothing to apply"', () => {
    assert.equal(
      isNoOp({ action: 'nothing_to_append', publicationChanged: false, historicalRestatementCount: 2 }),
      false,
    )
    assert.equal(
      isNoOp({ action: 'nothing_to_append', publicationChanged: false, historicalRestatementCount: 0 }),
      true,
    )
  })

  test('both versions are bumped — this is a semantics change, not a refactor', () => {
    assert.match(WEEKLY_IMPORT_PLAN_VERSION, /^r13\.8d1\./)
    assert.match(IMPORT_PREVIEW_VERSION, /^r13\.8d1\./)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · The database, which is authoritative
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · the database decides, gates and reverses', () => {
  test('the RPC accepts the historical publications and refuses a stale one', () => {
    assert.match(importFn, /p_historical_publications jsonb\s+default '\[\]'::jsonb/)
    assert.match(importFn, /import_refused_stale_historical_publication/)
    assert.match(importFn, /import_refused_historical_publication_absent/)
    assert.match(importFn, /import_refused_historical_publication_unchanged/)
    assert.match(importFn, /import_refused_historical_publication_is_current_week/)
  })

  test('the database RE-DERIVES the restatement rather than trusting the caller', () => {
    // The same § 5b comparison that guards the current week, against its own
    // rows. A caller cannot mint a revision by asserting a change it does not
    // carry, and cannot suppress one by omitting it.
    const idx = importFn.indexOf('for h in')
    const compareAt = importFn.indexOf('nmi_portfolio_publication_unchanged', idx)
    const publishAt = importFn.indexOf('nmi_publish_portfolio(', idx)
    assert.ok(idx > 0, 'the historical loop must exist')
    assert.ok(compareAt > idx, 'the loop must re-derive the comparison')
    assert.ok(compareAt < publishAt, 'it must do so BEFORE publishing the correction')
  })

  test('the gate covers restatements and runs before any durable write', () => {
    const gateAt = importFn.indexOf('v_restatements > 0')
    const refuseAt = importFn.indexOf('import_refused_historical_correction_required')
    const insertAt = importFn.indexOf('insert into public.portfolio_import_operations')
    assert.ok(gateAt > 0)
    assert.ok(gateAt < refuseAt, 'restatements are counted before the refusal is decided')
    assert.ok(refuseAt < insertAt, 'the gate runs before the operation row is inserted')
  })

  test('a restatement defeats the no-op refusal', () => {
    assert.match(importFn, /v_history_mutations = 0 and v_publication_unchanged and v_restatements = 0/)
  })

  test('the correction ledger records which revision displaced which', () => {
    assert.match(migration, /create table if not exists public\.portfolio_import_publication_corrections/)
    assert.match(migration, /publication_id\s+uuid not null references public\.portfolio_publications/)
    assert.match(migration, /previous_publication_id uuid references public\.portfolio_publications/)
    assert.match(migration, /portfolio_import_publication_corrections_key/)
    assert.match(importFn, /insert into public\.portfolio_import_publication_corrections/)
  })

  test('the corrected weeks never become the current publication', () => {
    // Each correction is a revision OF ITS OWN DATE. `is_current` is unique per
    // (kind, as_of_date), so correcting a past week cannot change which week is
    // newest — and the RPC refuses a packet that names the current week twice.
    assert.match(importFn, /import_refused_historical_publication_is_current_week/)
    assert.match(importFn, /where x\.as_of_date = p_as_of_date/)
  })

  test('rollback reverses the corrections and refuses a superseded one', () => {
    assert.match(rollbackFn, /portfolio_import_publication_corrections/)
    assert.match(rollbackFn, /rollback_refused_historical_publication_superseded/)
    // Demote before promote, the same ordering the partial current-row index
    // requires everywhere else in this module.
    const loopAt = rollbackFn.indexOf('for c in')
    const demoteAt = rollbackFn.indexOf('set is_current = false', loopAt)
    const promoteAt = rollbackFn.indexOf('set is_current = true', loopAt)
    assert.ok(loopAt > 0)
    assert.ok(demoteAt > loopAt && demoteAt < promoteAt)
  })

  test('the migration fails to apply if any of this is removed', () => {
    // These postconditions are what make the defect unrepeatable: a future edit
    // that drops the detection, the gate or the reversal cannot reach a database.
    for (const msg of [
      'the import ignores historical publication restatements',
      'the historical-correction gate does not consider publication restatements',
      'the no-op guard ignores historical restatements',
      'the import does not refuse a stale historical publication',
      'the import does not re-derive whether a historical week actually changed',
      'rollback does not reverse historical publication corrections',
      'rollback does not refuse when a later import re-published a corrected week',
    ]) {
      assert.ok(migration.includes(msg), `missing postcondition: ${msg}`)
    }
  })

  test('the new ledger is service-role only, like the other two', () => {
    assert.match(migration, /alter table public\.portfolio_import_publication_corrections enable row level security/)
    assert.match(migration, /revoke all privileges on table public\.portfolio_import_publication_corrections\s*\n?\s*from public, anon, authenticated/)
    assert.match(migration, /grant all privileges on table public\.portfolio_import_publication_corrections to service_role/)
  })

  test('pgTAP exercises the restatement path in real PostgreSQL', () => {
    for (const marker of [
      'R13.8D.1',
      'import_refused_historical_correction_required',
      'portfolio_import_publication_corrections',
    ]) {
      assert.ok(dbTest.includes(marker), `pgTAP must cover: ${marker}`)
    }
  })

  test('NOTHING still names the pre-R13.8D.1 signature', () => {
    // Adding a parameter changes the function's identity. A `has_function_privilege`
    // or `to_regprocedure` call left on the 13-argument form does not fail
    // softly — it raises `function ... does not exist` and takes the whole pgTAP
    // file down with it, which is exactly how CI caught this once.
    const OLD = /nmi_import_portfolio_workbook\(\s*uuid,\s*date,\s*uuid,\s*text,\s*text,\s*jsonb,\s*jsonb,\s*jsonb,\s*boolean,\s*text,\s*jsonb,\s*text,\s*jsonb\s*\)/
    for (const [name, src] of [
      ['migration', migration],
      ['pgTAP suite', dbTest],
    ] as const) {
      assert.doesNotMatch(src, OLD, `${name} still names the 13-argument signature`)
    }
  })

  test('the new ledger is asserted service-role only in pgTAP too', () => {
    assert.match(dbTest, /has_table_privilege\('authenticated', 'public\.portfolio_import_publication_corrections'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Route, server and console wiring
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8D.1 · the layers agree', () => {
  test('the preview server compares every already-published workbook week', () => {
    assert.match(previewServer, /listStandingPublicationPayloads/)
    // Through the ONE canonical comparison, never a second algorithm.
    assert.match(previewServer, /comparePublicationPayload\(/)
    // The week being published is excluded — that is the current-publication axis.
    assert.match(previewServer, /filter\(\(d\) => d !== publicationDate\)/)
  })

  test('a failed read is a failure, never a silent "no restatements"', () => {
    assert.match(previewServer, /historical_publication_read_failed/)
    assert.match(i18n, /historical_publication_read_failed/)
  })

  test('the rows compared are the rows written', () => {
    // The payload the restatement was measured on is the payload shipped to the
    // RPC — captured once, from the same builders, and never rebuilt.
    assert.match(previewServer, /snapshot_rows: workbookPayload\.rows/)
    assert.match(previewServer, /performance_rows: workbookPayload\.performance/)
    assert.match(route, /historicalPublications: built\.historicalPublications/)
  })

  test('detection reuses the column scan instead of parsing the workbook twice', () => {
    // ~100 columns at ~300 ms each: re-parsing to detect restatements would
    // double the most expensive step in the preview for work already done.
    assert.match(previewModule, /captureHistoricalPayloads/)
    assert.match(planModule, /HISTORICAL PUBLICATION RESTATEMENT/i)
  })

  test('the refusal names which cause armed the gate', () => {
    assert.match(route, /requiresEvolutionCorrection: plan\.requiresEvolutionCorrection/)
    assert.match(route, /requiresPublicationRestatementCorrection/)
    assert.match(route, /historicalRestatementDates: plan\.historicalRestatementDates/)
  })

  test('the console renders restated weeks as their own card', () => {
    assert.match(card, /function RestatementCard/)
    assert.match(card, /data-group="historical-restatement"/)
    assert.match(card, /<RestatementCard plan=\{plan\} \/>/)
    // And the evolution table is suppressed when no evolution point moved, so
    // the card never claims a level was overwritten when none was.
    assert.match(card, /\{plan\.corrections\.length > 0 && \(/)
  })

  test('every new string exists in BOTH languages', () => {
    for (const key of [
      'verdictRestatementTitle',
      'verdictRestatementOnlyBody',
      'verdictRestatementAppendBody',
      'verdictRestatementEvolutionBody',
      'restatementTitle',
      'restatementNote',
      'restatementMore',
      'restatementFieldCount',
      'restatementLevelUnchanged',
    ]) {
      const hits = i18n.split(`${key}:`).length - 1
      assert.equal(hits, 2, `${key} must appear once in EN and once in ES`)
    }
  })

  test('no source file this stage touched carries a raw NUL byte', () => {
    for (const src of [migration, route, previewServer, planModule, previewModule, card]) {
      assert.equal(src.includes(' '), false)
    }
  })
})
