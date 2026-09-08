// R13.8C.2 — a no-op import is the WHOLE import, and it is refused by the
// SERVER and by the DATABASE.
//
// WHAT THIS FILE PROVES, AND WHY IT WAS REWRITTEN.
//
// R13.8C made the console disable Apply for a NO_CHANGES preview. R13.8C.1 made
// the refusal an invariant: the publish route and `nmi_import_portfolio_workbook`
// both refuse a packet that mutates nothing, so a caller reaching either
// directly cannot mint a publication revision and an import operation row that
// record no change to the book.
//
// R13.8C.1 DEFINED "MUTATES NOTHING" TOO NARROWLY. It tested the evolution
// packet alone — no NEW week, no GAP FILL, no CHANGED value. A workbook can
// satisfy all three and still restate a holding, a flow, a sociedad total or a
// performance figure inside the CURRENT publication snapshot. Under that test
// the import was refused as "nothing to append", the console said there was
// nothing to do, and the stale published figure stayed standing. A refusal that
// silently preserves a figure the owner corrected is worse than the write it was
// protecting against.
//
// The corrected invariant, stated at three layers on ONE condition — the full
// import mutates nothing, which means NO history mutation AND a current
// publication materially equivalent to the one already standing:
//   · the console never offers an enabled Apply for that state, and now SAYS SO
//     when only the snapshot moved instead of claiming there is nothing to do;
//   · the publish route refuses before it enters any write path;
//   · `nmi_import_portfolio_workbook` refuses before it inserts its operation
//     row or calls `nmi_publish_portfolio`, so a refusal writes nothing at all.
//
// The database half is proven EXECUTABLY in
// `supabase/tests/database/portfolio_import_operations_test.sql` §§ 6-7, against
// real PostgreSQL — a source scan cannot show that a refusal left five tables
// untouched, that a snapshot-only correction went through the ordinary revision
// lifecycle, or that rolling it back restored the exact previous publication.
// This file proves the pure definitions, the placement of each guard, and that
// every layer agrees about what a no-op is.
//
// NOTHING VALID IS NARROWED. NEW-only, GAP_FILL-only, authorized CHANGED-only,
// every combination of them, AND a snapshot-only publication correction all
// still import.
//
// NO PRIVATE DATA. Every figure below is a small synthetic integer.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  planWeeklyImport,
  type SeriesObservation,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'
import {
  isNoOp,
  describeImportPlan,
  type ImportPlan,
} from '../src/lib/familyPortfolio/importPlanPresentation.ts'
import {
  comparePublicationPayload,
  MAX_REPORTED_DIFFERENCES,
  OPERATIONAL_ROW_COLUMNS,
  OPERATIONAL_SNAPSHOT_METADATA_KEYS,
  OPERATIONAL_PERFORMANCE_METADATA_KEYS,
  type ComparableSnapshotRow,
  type ComparablePerformanceRow,
} from '../src/lib/familyPortfolio/publicationMaterialDiff.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strips comments so a prose mention never satisfies a code assertion. */
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MIGRATION = 'supabase/migrations/20260821000000_portfolio_import_operations.sql'
const PUBLICATION_MIGRATION = 'supabase/migrations/20260810000000_family_portfolio_publication.sql'
const DB_TEST = 'supabase/tests/database/portfolio_import_operations_test.sql'
const PUBLISH_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts'
const PAGE = 'src/app/portfolio/admin/page.tsx'
const PREVIEW_SERVER = 'src/lib/familyPortfolio/importPreviewServer.ts'
const PREVIEW_MODULE = 'src/lib/familyPortfolio/weeklyImportPreview.ts'
const PAYLOAD_MODULE = 'src/lib/familyPortfolio/publicationPayload.ts'
const DIFF_MODULE = 'src/lib/familyPortfolio/publicationMaterialDiff.ts'
const PREVIEW_COMPONENT = 'src/components/familyPortfolio/ImportPlanPreview.tsx'
const FIXTURES = 'src/lib/familyPortfolio/fixtures/importPreviewFixtures.ts'

const migration = read(MIGRATION)
const dbTest = read(DB_TEST)
const route = read(PUBLISH_ROUTE)
const page = read(PAGE)

/** The body of the import RPC, so a match cannot come from another function. */
const importFn = (() => {
  const start = migration.indexOf('create or replace function public.nmi_import_portfolio_workbook')
  assert.ok(start >= 0, 'the import RPC must exist')
  const end = migration.indexOf('create or replace function public.nmi_rollback_portfolio_import', start)
  assert.ok(end > start, 'the rollback RPC must follow it')
  return migration.slice(start, end)
})()

/** The body of the material comparison, alone. */
const compareFn = (() => {
  const start = migration.indexOf(
    'create or replace function public.nmi_portfolio_publication_unchanged',
  )
  assert.ok(start >= 0, 'the material publication comparison must exist')
  const end = migration.indexOf('create or replace function public.nmi_import_portfolio_workbook', start)
  assert.ok(end > start, 'the import RPC must follow the comparison')
  return migration.slice(start, end)
})()

const obs = (date: string, value: number): SeriesObservation => ({
  scope: 'main',
  basis: 'ex_chilean_equities',
  observationDate: date,
  value,
})

const PUBLISHED: SeriesObservation[] = [obs('2026-07-17', 11), obs('2026-07-24', 12), obs('2026-07-31', 13)]

const row = (over: Partial<ComparableSnapshotRow> = {}): ComparableSnapshotRow => ({
  scope: 'main',
  row_key: 'total',
  parent_row_key: null,
  depth: 0,
  display_order: 1,
  row_type: 'portfolio_total',
  label_es: 'TOTAL',
  label_en: 'TOTAL',
  currency: 'USD',
  value: 100,
  value_class: 'source_value',
  source_sheet: 'RESUMEN',
  source_cell: 'DA10',
  metadata: { sourceRow: 10, previousValue: 90, difference: 10, differenceClass: 'nmi_calculated' },
  ...over,
})

const perf = (over: Partial<ComparablePerformanceRow> = {}): ComparablePerformanceRow => ({
  scope: 'main',
  basis: 'ex_chilean_equities',
  metric: 'weekly_return',
  value: 1.5,
  value_class: 'source_provided_return',
  source_sheet: 'RESUMEN',
  source_cell: 'DA94',
  metadata: { sourceRow: 94, boundRowKey: 'total', boundSourceCell: 'DA10', crossChecks: [] },
  ...over,
})

const book = (rows: ComparableSnapshotRow[], performance: ComparablePerformanceRow[] = []) => ({
  rows,
  performance,
})

// ═══════════════════════════════════════════════════════════════════════════
// 1 · What a no-op is now — BOTH halves, and the way they compose
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · what a no-op is', () => {
  test('history settled AND the snapshot unchanged is the only no-op', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED,
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'unchanged',
    })
    assert.equal(plan.action, 'nothing_to_append')
    assert.equal(plan.observationsToWrite.length, 0)
    assert.equal(plan.publicationChanged, false)
    assert.deepEqual([plan.newDates, plan.gapFillDates, plan.changedDates], [[], [], []])
    assert.equal(plan.unchangedDates.length, 3)
    // Not blocked: nothing is WRONG with it. It simply has nothing to apply, and
    // the three layers refuse it on that ground rather than as a validation
    // failure — a distinction the administrator's message depends on.
    assert.equal(plan.blocked, false)
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(isNoOp(plan), true)
  })

  test('THE CORRECTION: history settled but the snapshot restated is NOT a no-op', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED,
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'changed',
    })
    // R13.8C.1 called this `nothing_to_append` and disabled Apply, leaving the
    // stale published figure standing. It is a real publication mutation.
    assert.equal(plan.action, 'publication_correction')
    assert.equal(plan.publicationChanged, true)
    assert.equal(plan.observationsToWrite.length, 0)
    assert.equal(isNoOp(plan), false)
    assert.equal(plan.blocked, false)
    // And it is NOT a historical correction: no published observation is being
    // overwritten, so no authorization and no written reason are demanded. The
    // stage did not invent an owner rule the publication lifecycle never had.
    assert.equal(plan.requiresHistoricalCorrection, false)
  })

  test('an omitted comparison is `not_compared`, never assumed to be a change', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED,
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
    })
    assert.equal(plan.publicationComparison, 'not_compared')
    assert.equal(plan.publicationChanged, false)
    // Exactly the pre-R13.8C.2 behaviour for every caller that does not read the
    // standing publication — a pure planner call, a review fixture.
    assert.equal(plan.action, 'nothing_to_append')
    assert.equal(isNoOp(plan), true)
  })

  test('a workbook with nothing in it at all is a no-op, not a silent success', () => {
    const plan = planWeeklyImport({
      workbookObservations: [],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'unchanged',
    })
    assert.equal(plan.observationsToWrite.length, 0)
    assert.equal(isNoOp(plan), true)
  })

  test('the console and the route decide on the same condition', () => {
    for (const comparison of ['unchanged', 'changed', 'not_compared'] as const) {
      const plan = planWeeklyImport({
        workbookObservations: PUBLISHED,
        publishedObservations: PUBLISHED,
        latestPublishedAsOf: '2026-07-31',
        publicationComparison: comparison,
      })
      // The route refuses on `observationsToWrite.length === 0 && !publicationChanged`;
      // the console disables on `isNoOp`. If those could ever disagree, one layer
      // would offer what another refuses.
      assert.equal(
        isNoOp(plan),
        plan.observationsToWrite.length === 0 && !plan.publicationChanged,
        `the two layers must agree for publicationComparison=${comparison}`,
      )
    }
  })

  test('a history mutation is an import whatever the snapshot did', () => {
    // The publication axis can only ever DOWNGRADE a would-be no-op into a real
    // import. It must never suppress one.
    for (const comparison of ['unchanged', 'changed', 'not_compared'] as const) {
      const plan = planWeeklyImport({
        workbookObservations: [...PUBLISHED, obs('2026-08-07', 14)],
        publishedObservations: PUBLISHED,
        latestPublishedAsOf: '2026-07-31',
        publicationComparison: comparison,
      })
      assert.equal(isNoOp(plan), false)
      assert.equal(plan.observationsToWrite.length, 1)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Every valid import still applies — the guard narrows nothing
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · valid imports are untouched', () => {
  test('NEW only', () => {
    const plan = planWeeklyImport({
      workbookObservations: [...PUBLISHED, obs('2026-08-07', 14)],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'changed',
    })
    assert.equal(plan.observationsToWrite.length, 1)
    assert.equal(plan.observationsToWrite[0].disposition, 'new')
    assert.equal(plan.action, 'append_single_week')
    assert.equal(isNoOp(plan), false)
    assert.equal(plan.blocked, false)
  })

  test('GAP_FILL only — an insertion, needing no authorization, snapshot unchanged', () => {
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-07-10', 10), ...PUBLISHED],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'unchanged',
    })
    assert.deepEqual(plan.gapFillDates, ['2026-07-10'])
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(isNoOp(plan), false)
    assert.equal(plan.blocked, false)
  })

  test('authorized CHANGED only, with the snapshot unchanged, still needs its reason', () => {
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-07-17', 11), obs('2026-07-24', 99), obs('2026-07-31', 13)],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'unchanged',
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian restated the week.',
    })
    assert.deepEqual(plan.changedDates, ['2026-07-24'])
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.equal(plan.action, 'historical_correction_only')
    assert.equal(isNoOp(plan), false)
    assert.equal(plan.blocked, false)
  })

  test('an UNAUTHORIZED overwrite is still blocked, settled snapshot or not', () => {
    for (const comparison of ['unchanged', 'changed'] as const) {
      const plan = planWeeklyImport({
        workbookObservations: [obs('2026-07-17', 11), obs('2026-07-24', 99), obs('2026-07-31', 13)],
        publishedObservations: PUBLISHED,
        latestPublishedAsOf: '2026-07-31',
        publicationComparison: comparison,
      })
      assert.equal(plan.blocked, true)
      assert.ok(plan.blockCodes.includes('historical_correction_required'))
    }
  })

  test('a history overwrite that ALSO restates the snapshot is named as both', () => {
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-07-17', 11), obs('2026-07-24', 99), obs('2026-07-31', 13)],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'changed',
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian restated the week and this week is re-derived.',
    })
    assert.equal(plan.action, 'mixed_correction')
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.equal(isNoOp(plan), false)
  })

  test('an append is unchanged in name by the publication axis', () => {
    // An append necessarily republishes, so naming that separately would add a
    // category without adding a fact.
    const plan = planWeeklyImport({
      workbookObservations: [...PUBLISHED, obs('2026-08-07', 14), obs('2026-08-14', 15)],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      publicationComparison: 'changed',
    })
    assert.equal(plan.action, 'multi_week_append')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · The MATERIAL comparison — what "the publication changed" means
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · the material publication comparison', () => {
  test('identical payloads are unchanged', () => {
    const d = comparePublicationPayload(book([row()], [perf()]), book([row()], [perf()]))
    assert.equal(d.comparison, 'unchanged')
    assert.equal(d.reason, 'equivalent')
    assert.equal(d.differenceCount, 0)
  })

  test('NO STANDING PUBLICATION is never "unchanged"', () => {
    // There is plainly something to publish. Getting this backwards would refuse
    // the first publication of a week as a no-op.
    const d = comparePublicationPayload(null, book([row()]))
    assert.equal(d.comparison, 'changed')
    assert.equal(d.reason, 'no_current_publication')
  })

  test('a moved figure is material', () => {
    const d = comparePublicationPayload(book([row()]), book([row({ value: 101 })]))
    assert.equal(d.comparison, 'changed')
    assert.equal(d.differenceCount, 1)
    assert.equal(d.differences[0].field, 'value')
    assert.equal(d.differences[0].beforeValue, 100)
    assert.equal(d.differences[0].afterValue, 101)
  })

  test('a figure becoming UNAVAILABLE is material, and never reads as zero', () => {
    const d = comparePublicationPayload(book([row()]), book([row({ value: null })]))
    assert.equal(d.comparison, 'changed')
    assert.equal(d.differences[0].afterValue, null)
    // And the reverse direction is a change too — an unavailable leaf gaining a
    // real figure is exactly the correction this stage exists to let through.
    const back = comparePublicationPayload(book([row({ value: null })]), book([row()]))
    assert.equal(back.comparison, 'changed')
  })

  test('a null value and a zero are NOT the same publication', () => {
    const d = comparePublicationPayload(book([row({ value: null })]), book([row({ value: 0 })]))
    assert.equal(d.comparison, 'changed')
  })

  test('SOURCE COORDINATES ARE OPERATIONAL — a moved row is not a changed book', () => {
    // A blank line inserted above a section moves every source cell and source
    // row beneath it without changing a single published number.
    const moved = row({
      source_sheet: 'RESUMEN 2',
      source_cell: 'DB11',
      metadata: { ...row().metadata, sourceRow: 11 },
    })
    const d = comparePublicationPayload(book([row()]), book([moved]))
    assert.equal(d.comparison, 'unchanged')
    assert.deepEqual([...OPERATIONAL_ROW_COLUMNS], ['source_sheet', 'source_cell'])
    assert.deepEqual([...OPERATIONAL_SNAPSHOT_METADATA_KEYS], ['sourceRow'])
  })

  test('but a FIGURE inside metadata is still a figure', () => {
    // `previousValue`, `beginningOfYearValue`, `difference` and `differenceClass`
    // are published numbers that happen to live in the metadata column. Excluding
    // the whole column as provenance would have made a real restatement invisible.
    for (const key of ['previousValue', 'beginningOfYearValue', 'difference', 'differenceClass']) {
      const d = comparePublicationPayload(
        book([row()]),
        book([row({ metadata: { ...row().metadata, [key]: 'moved' } })]),
      )
      assert.equal(d.comparison, 'changed', `${key} must be material`)
      assert.equal(d.differences[0].field, 'metadata')
    }
  })

  test('every structural field of a row is material', () => {
    const cases: Array<Partial<ComparableSnapshotRow>> = [
      { parent_row_key: 'group' },
      { depth: 1 },
      { display_order: 2 },
      { row_type: 'named_holding' },
      { label_es: 'TOTAL GENERAL' },
      { label_en: 'GRAND TOTAL' },
      { currency: 'CLP' },
      { value_class: 'nmi_calculated' },
    ]
    for (const over of cases) {
      const d = comparePublicationPayload(book([row()]), book([row(over)]))
      assert.equal(d.comparison, 'changed', `${Object.keys(over)[0]} must be material`)
    }
  })

  test('an added row and a removed row are both differences', () => {
    const second = row({ row_key: 'cash', label_es: 'CAJA', value: 5 })
    const added = comparePublicationPayload(book([row()]), book([row(), second]))
    assert.equal(added.comparison, 'changed')
    assert.equal(added.differences[0].kind, 'added')

    const removed = comparePublicationPayload(book([row(), second]), book([row()]))
    assert.equal(removed.comparison, 'changed')
    assert.equal(removed.differences[0].kind, 'removed')
    assert.equal(removed.differences[0].identity, 'main|cash')
  })

  test('the same row under a different scope is a different row', () => {
    const d = comparePublicationPayload(book([row()]), book([row({ scope: 'jaime' })]))
    assert.equal(d.comparison, 'changed')
    assert.equal(d.differenceCount, 2, 'one added under jaime, one removed under main')
  })

  test('ORDER is never itself compared — `display_order` is compared as a value', () => {
    const a = row()
    const b = row({ row_key: 'cash', label_es: 'CAJA', display_order: 2, value: 5 })
    const d = comparePublicationPayload(book([a, b]), book([b, a]))
    assert.equal(d.comparison, 'unchanged')
  })

  test('metadata key order never matters, matching PostgreSQL jsonb equality', () => {
    const d = comparePublicationPayload(
      book([row({ metadata: { sourceRow: 10, previousValue: 90, difference: 10, differenceClass: 'nmi_calculated' } })]),
      book([row({ metadata: { differenceClass: 'nmi_calculated', difference: 10, previousValue: 90, sourceRow: 10 } })]),
    )
    assert.equal(d.comparison, 'unchanged')
  })

  test('a performance figure moving is a publication mutation', () => {
    const d = comparePublicationPayload(
      book([row()], [perf()]),
      book([row()], [perf({ value: 1.6 })]),
    )
    assert.equal(d.comparison, 'changed')
    assert.equal(d.differences[0].area, 'performance')
    assert.equal(d.differences[0].identity, 'main|ex_chilean_equities|weekly_return')
  })

  test('a performance row whose source coordinates moved is operational', () => {
    const d = comparePublicationPayload(
      book([row()], [perf()]),
      book([
        row(),
      ], [perf({ source_cell: 'ZZ99', metadata: { ...perf().metadata, sourceRow: 99, boundSourceCell: 'ZZ01' } })]),
    )
    assert.equal(d.comparison, 'unchanged')
    assert.deepEqual([...OPERATIONAL_PERFORMANCE_METADATA_KEYS], ['sourceRow', 'boundSourceCell'])
  })

  test('but the row a performance figure is BOUND to is material', () => {
    // A metric that now describes a different row is a different statement, even
    // when the number is identical.
    const d = comparePublicationPayload(
      book([row()], [perf()]),
      book([row()], [perf({ metadata: { ...perf().metadata, boundRowKey: 'cash' } })]),
    )
    assert.equal(d.comparison, 'changed')
  })

  test('the reported sample is BOUNDED, and the count is still the truth', () => {
    // A publication carries ~500 rows. Listing every one of them in a preview
    // would bury the handful that moved and make the response enormous.
    const many = (n: number, v: number) =>
      Array.from({ length: n }, (_, i) => row({ row_key: `r${i}`, value: v + i }))
    const d = comparePublicationPayload(book(many(80, 0)), book(many(80, 1000)))
    assert.equal(d.differenceCount, 80)
    assert.equal(d.differences.length, MAX_REPORTED_DIFFERENCES)
    assert.ok(MAX_REPORTED_DIFFERENCES < 80)
  })

  test('a difference never carries an object, only a number or a name', () => {
    const d = comparePublicationPayload(
      book([row()]),
      book([row({ metadata: { ...row().metadata, difference: 11 } })]),
    )
    for (const diff of d.differences) {
      for (const v of [diff.beforeValue, diff.afterValue]) {
        assert.ok(v === undefined || v === null || typeof v === 'number')
      }
    }
  })

  test('the module is pure — no database, server or environment import', () => {
    const src = read(DIFF_MODULE)
    for (const forbidden of ['next/', 'process.env', '@/lib/db', 'supabase']) {
      assert.ok(!src.includes(forbidden), `${DIFF_MODULE} must not import ${forbidden}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The database guard
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · the import RPC refuses only a TRUE no-op', () => {
  test('it raises a stable, explicit code', () => {
    assert.match(importFn, /raise exception 'import_refused_nothing_to_append'/)
  })

  test('THE CORRECTION: the refusal weighs the publication, not only the history', () => {
    // The single assertion that distinguishes R13.8C.2 from R13.8C.1. Without
    // it, the guard reverts to refusing a legitimate snapshot-only correction.
    assert.match(importFn, /v_history_mutations = 0 and v_publication_unchanged/)
    assert.match(importFn, /nmi_portfolio_publication_unchanged\(v_prev_pub, p_rows, p_performance\)/)
  })

  test('the history half counts MUTATING dispositions, never the packet length', () => {
    const guard = importFn.slice(
      importFn.indexOf('select count(*) into v_history_mutations'),
      importFn.indexOf("raise exception 'import_refused_nothing_to_append'"),
    )
    assert.match(guard, /disposition in \('new','gap_fill','changed'\)/)
    // A length test would accept a packet of a hundred unchanged weeks as a real
    // import, which is precisely the no-op this guard exists to refuse.
    assert.doesNotMatch(guard, /jsonb_array_length/)
  })

  test('the publication comparison is READ FROM PRODUCTION, not taken from the packet', () => {
    // A caller-asserted "the publication is unchanged" would be a value the
    // caller could simply lie about. The comparison reads the standing rows.
    assert.match(compareFn, /from public\.portfolio_snapshot_rows/)
    assert.match(compareFn, /from public\.portfolio_performance_rows/)
    // R13.8C.2 left the RPC signature untouched. R13.8D.1 extends it by exactly
    // ONE argument — the historical publications this import corrects — because
    // that payload genuinely cannot be derived from anything already passed: it
    // is a different week's rows. Every grant, revoke and `to_regprocedure`
    // assertion in the migration must name the new signature, or the function
    // the grants describe is not the function that exists.
    assert.match(
      migration,
      /nmi_import_portfolio_workbook\(\s*uuid, date, uuid, text, text, jsonb, jsonb, jsonb, boolean, text, jsonb, text, jsonb, jsonb\)/,
    )
    assert.doesNotMatch(
      migration,
      /nmi_import_portfolio_workbook\(uuid,date,uuid,text,text,jsonb,jsonb,jsonb,boolean,text,jsonb,text,jsonb\)/,
      'no assertion may still name the pre-R13.8D.1 signature',
    )
  })

  test('the pre-state is read under the PUBLICATION lock, so it cannot move', () => {
    const lockAt = importFn.indexOf("nmi_lock_publication_series('portfolio', p_as_of_date)")
    const readAt = importFn.indexOf('select id into v_prev_pub')
    const guardAt = importFn.indexOf("raise exception 'import_refused_nothing_to_append'")
    assert.ok(lockAt > 0, 'the import must take the publication-series lock')
    assert.ok(lockAt < readAt, 'the standing publication must be read under that lock')
    assert.ok(readAt < guardAt)
    // The import lock is still taken first — one order everywhere, so the two
    // locks cannot form a cycle.
    const importLockAt = importFn.indexOf('nmi_lock_portfolio_import')
    assert.ok(importLockAt > 0 && importLockAt < lockAt)
  })

  test('it runs before the operation row, the publication and any history write', () => {
    const guardAt = importFn.indexOf("raise exception 'import_refused_nothing_to_append'")
    assert.ok(guardAt > 0)
    for (const write of [
      'insert into public.portfolio_import_operations',
      'public.nmi_publish_portfolio(',
      'insert into public.portfolio_evolution_observations',
      'update public.portfolio_evolution_observations',
      'insert into public.portfolio_import_observation_mutations',
    ]) {
      const at = importFn.indexOf(write)
      assert.ok(at > 0, `${write} must appear in the import RPC`)
      assert.ok(guardAt < at, `the no-op guard must precede: ${write}`)
    }
  })

  test('the comparison function is service-role only, INVOKER, and pins search_path', () => {
    assert.match(compareFn, /set search_path = ''/)
    assert.ok(!/security definer/i.test(compareFn), 'it must stay SECURITY INVOKER')
    assert.match(
      migration,
      /revoke all on function public\.nmi_portfolio_publication_unchanged\(uuid, jsonb, jsonb\)\s*\n\s*from public, anon, authenticated;/,
    )
    assert.match(
      migration,
      /grant execute on function public\.nmi_portfolio_publication_unchanged\(uuid, jsonb, jsonb\)\s*\n\s*to service_role;/,
    )
    assert.match(migration, /'public\.nmi_portfolio_publication_unchanged\(uuid,jsonb,jsonb\)'/)
  })

  test('a NULL standing publication is never treated as unchanged', () => {
    assert.match(compareFn, /p_publication_id is not null/)
  })

  test('the comparison ignores source coordinates and nothing else', () => {
    // The SQL and the TypeScript must exclude the SAME keys, or the console and
    // the database would disagree about whether an import does anything.
    for (const key of OPERATIONAL_SNAPSHOT_METADATA_KEYS) {
      assert.ok(compareFn.includes(`- '${key}'::text`), `SQL must strip metadata.${key}`)
    }
    for (const key of OPERATIONAL_PERFORMANCE_METADATA_KEYS) {
      assert.ok(compareFn.includes(`- '${key}'::text`), `SQL must strip metadata.${key}`)
    }
    // Each material column is compared explicitly, so adding one to the table
    // without adding it here shows up as an unasserted column, not as silence.
    for (const col of [
      'parent_row_key', 'depth', 'display_order', 'row_type',
      'label_es', 'label_en', 'currency', 'value', 'value_class',
    ]) {
      assert.match(
        compareFn,
        new RegExp(`stored\\.${col}\\s+is distinct from incoming\\.${col}`),
        `${col} must be compared`,
      )
    }
    // And the operational columns are never compared at all.
    for (const col of OPERATIONAL_ROW_COLUMNS) {
      assert.doesNotMatch(
        compareFn,
        new RegExp(`stored\\.${col}\\s+is distinct from`),
        `${col} is operational and must not be compared`,
      )
    }
  })

  test('the migration asserts its own guard, its ORDER, and the publication half', () => {
    // Without these the guard could be narrowed back to R13.8C.1 in a later edit
    // and every structural check in the migration would still pass.
    assert.match(migration, /the import does not refuse a no-op packet/)
    assert.match(migration, /the no-op guard runs after the operation row is inserted/)
    assert.match(migration, /the no-op guard does not consider the current publication/)
    assert.match(migration, /the no-op refusal is decided before the publication is compared/)
    assert.match(migration, /the publication comparison does not read the full published payload/)
  })

  test('the guard is not bought off by authorization', () => {
    // The correction check comes AFTER, so an authorized packet that mutates
    // nothing is refused on the no-op ground rather than being waved through.
    const guardAt = importFn.indexOf("raise exception 'import_refused_nothing_to_append'")
    const correctionAt = importFn.indexOf("raise exception 'import_refused_historical_correction_required'")
    assert.ok(guardAt > 0 && correctionAt > guardAt)
  })

  test('no other refusal or behaviour of the RPC was altered', () => {
    for (const code of [
      'import_refused_invalid_observations',
      'import_refused_historical_correction_required',
      'import_refused_unavailable_not_representable',
      'import_refused_unknown_disposition',
      'import_refused_stale_plan_identity_exists',
      'import_refused_stale_plan_identity_absent',
      'import_refused_stale_plan_value_moved',
    ]) {
      assert.ok(importFn.includes(code), `${code} must still be raised`)
    }
    // Atomicity, lineage, the before-image ledger and the displaced-publication
    // handle rollback depends on are all untouched.
    assert.match(importFn, /import_operation_id/)
    assert.match(importFn, /portfolio_import_observation_mutations/)
    assert.match(importFn, /previous_publication_id/)
    assert.match(migration, /set search_path = ''/)
    // The publication itself is still delegated verbatim, so the two paths
    // cannot drift.
    assert.match(importFn, /v_pub_id := public\.nmi_publish_portfolio\(/)
  })

  test('the existing same-date publication rules are unchanged', () => {
    // R13.8C.2 did not invent a new financial rule for a same-date correction:
    // it routes through the publication lifecycle that already existed, which
    // mints a revision and supersedes its predecessor and has never required a
    // written reason for a same-date replacement.
    const publication = read(PUBLICATION_MIGRATION)
    assert.match(publication, /publication_refused_duplicate_submission/)
    assert.match(publication, /publication_refused_nothing_to_publish/)
    assert.match(publication, /publication_refused_blocking_findings/)
    assert.match(publication, /coalesce\(max\(revision\), 0\) \+ 1/)
    assert.match(publication, /set is_current = false, superseded_by = v_pub_id/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The executable database proof covers each required case
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · the pgTAP suite proves it against real PostgreSQL', () => {
  test('the no-op packets are built from the STANDING publication, not an arbitrary one', () => {
    // Otherwise § 6 would still be asserting the R13.8C.1 rule: with a payload
    // that differs from what is published, a refusal is the WRONG answer.
    assert.match(dbTest, /create or replace function pg_temp\.standing_rows/)
    assert.ok(!dbTest.includes('pg_temp.rows_payload(600)'))
    assert.match(dbTest, /the standing publication for 2026-07-31 has rows to restate/)
  })

  test('an empty packet, a non-empty no-op packet, and a repeat are all refused', () => {
    const refusals = dbTest.split('import_refused_nothing_to_append').length - 1
    assert.ok(refusals >= 7, 'every no-op shape is exercised, including a repeat attempt')
    assert.match(dbTest, /an import with no new week, no gap fill and no correction is refused/)
    assert.match(dbTest, /a repeated no-op attempt is refused identically/)
    assert.match(dbTest, /an authorized no-op is still refused/)
    assert.match(dbTest, /an import that changes neither the history nor the standing snapshot is refused/)
  })

  test('and that the refusals wrote nothing — on every table the guard protects', () => {
    for (const claim of [
      'the refused no-ops mutated no history',
      'the refused no-ops minted no import operation row',
      'the refused no-ops minted no publication revision',
      'the refused no-ops wrote no before-image ledger entry',
      'the refused snapshot no-ops minted no publication revision',
      'and the standing snapshot is untouched',
    ]) {
      assert.ok(dbTest.includes(claim), `the SQL suite must assert: ${claim}`)
    }
  })

  test('a SNAPSHOT-ONLY correction is proven to APPLY, through the existing lifecycle', () => {
    assert.match(dbTest, /a snapshot-only correction is applied, not refused as nothing to append/)
    assert.match(dbTest, /the corrected figure is what readers now see/)
    assert.ok(dbTest.includes('it went through the existing revision lifecycle'))
    assert.ok(dbTest.includes('a snapshot-only correction needs no historical-correction authorization'))
  })

  test('an OPERATIONAL-only difference is proven to still be a no-op', () => {
    assert.ok(dbTest.includes('a workbook whose rows only MOVED is still a no-op'))
    assert.match(dbTest, /a moved source ROW is operational too/)
  })

  test('a LATE failure in a snapshot-only import is proven to leave nothing behind', () => {
    assert.match(dbTest, /a snapshot-only import that fails late raises/)
    assert.match(dbTest, /the late failure left no import operation row/)
    assert.match(dbTest, /nor a publication row, though one had already been inserted/)
  })

  test('ROLLBACK of a snapshot-only correction is proven to restore the exact publication', () => {
    assert.match(dbTest, /a snapshot-only import can be reversed/)
    assert.ok(dbTest.includes('the exact previous publication is standing again, figure for figure'))
    assert.match(dbTest, /not a third one minted to undo the second/)
  })

  test('each single valid disposition is proven to still import', () => {
    assert.match(dbTest, /a NEW-only import still applies/)
    assert.match(dbTest, /a GAP_FILL-only import still applies/)
    assert.match(dbTest, /an authorized CHANGED-only import still applies/)
    // And with the snapshot deliberately held identical, so the publication axis
    // is proven unable to suppress a history mutation.
    assert.ok(dbTest.includes("a gap fill applies even when this week''s snapshot is unchanged"))
    assert.match(dbTest, /an unchanged snapshot does not excuse an unauthorized history overwrite/)
  })

  test('a performance-only change is proven to be a publication mutation', () => {
    assert.match(dbTest, /a performance figure moving is a publication mutation, with the rows unchanged/)
  })

  test('every no-op section measures against an explicitly stated pre-state', () => {
    assert.ok(dbTest.includes('pre-state for the no-op cases'))
    assert.ok(dbTest.includes('pre-state for the snapshot cases'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · The route guard, and the payload it was decided on
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · the publish route refuses only a TRUE no-op', () => {
  const code = codeOf(route)

  test('it refuses on all three halves, with a stable code', () => {
    // R13.8D.1 — the no-op test now has a third term. An import that appends no
    // week and leaves this week's snapshot equivalent can still be correcting
    // already-published weeks; refusing that as "nothing to append" would be the
    // same class of false refusal R13.8C.2 removed, one step further back.
    assert.match(code, /plan\.observationsToWrite\.length === 0/)
    assert.match(code, /!plan\.publicationChanged/)
    assert.match(code, /plan\.historicalPublicationRestatements\.length === 0/)
    assert.match(code, /fail\('nothing_to_append', 409/)
  })

  test('it refuses BEFORE the import RPC is called', () => {
    const guardAt = code.indexOf("fail('nothing_to_append'")
    const rpcAt = code.indexOf('await importPortfolioWorkbook(')
    assert.ok(guardAt > 0 && rpcAt > guardAt, 'no write path may be entered for a no-op')
  })

  test('THE ROWS COMPARED ARE THE ROWS PUBLISHED', () => {
    // If the route rebuilt the payload after the plan had been diffed against a
    // separately-built one, the verdict would describe rows nobody publishes and
    // the divergence would be silent.
    assert.match(code, /const rows = built\.rows/)
    assert.match(code, /const performance = built\.performance/)
    assert.ok(
      !/const rows: SnapshotRowPayload\[\] =/.test(code),
      'the route must not build a second copy of the publication payload',
    )
    const server = codeOf(read(PREVIEW_SERVER))
    assert.match(server, /buildSnapshotRowPayload\(loaded\.resumen\)/)
    assert.match(server, /buildPerformanceRowPayload\(loaded\.resumen\)/)
    assert.match(server, /comparePublicationPayload\(standing\.payload, \{ rows, performance \}\)/)
    // One builder, imported by the shared server module — the same discipline
    // that makes preview and confirm agree about Production's history.
    const payload = read(PAYLOAD_MODULE)
    assert.match(payload, /export function buildSnapshotRowPayload/)
    assert.match(payload, /export function buildPerformanceRowPayload/)
  })

  test('a failed read of the standing publication is a failure, never a guess', () => {
    // Guessing "unchanged" would refuse a legitimate correction; guessing
    // "changed" would offer an Apply the database refuses.
    const server = codeOf(read(PREVIEW_SERVER))
    assert.match(server, /publication_read_failed/)
    assert.ok(!/catch\s*\{\s*\}/.test(server), 'a read failure must never be swallowed')
  })

  test('it does not weaken any guard that already stood', () => {
    for (const existing of [
      "fail('read_only_fixture', 403)",
      "fail('plan_stale', 409",
      "fail('import_refused', 422",
      "fail('publication_date_not_newest_frozen', 422",
    ]) {
      assert.ok(code.includes(existing), `${existing} must still guard the route`)
    }
    // The database is still the authority: the route's own refusal is an early
    // answer, never a replacement for the RPC's.
    assert.match(code, /reason\.startsWith\('import_refused'\)/)
  })

  test('the stale-preview fingerprint now covers the publication verdict too', () => {
    // If another publication landed between preview and confirm, an administrator
    // who approved a PUBLICATION CORRECTION may now be confirming a no-op, or the
    // reverse. That must be a refusal, not a surprise.
    const preview = read(PREVIEW_MODULE)
    assert.ok(preview.includes('snapshot|${plan.publicationComparison}'))
  })

  test('the administrator gets a 409, not a server fault', () => {
    // A no-op is a conflict with the state of the book, the same class of answer
    // as a stale plan — not an error the administrator should report as a bug.
    const guard = code.slice(code.indexOf("fail('nothing_to_append'"))
    assert.match(guard.slice(0, 240), /409/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · The console — it still disables Apply, and it stops saying the wrong thing
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.2 · the console tells the truth about what would happen', () => {
  const basePlan: ImportPlan = {
    contractVersion: 'v',
    contractVerdict: 'supported',
    sheetNames: [],
    frozen: {
      publicationColumnLetter: 'DA',
      publicationDate: '2026-07-31',
      historicalColumnCount: 3,
      liveColumnLetter: null,
      liveColumnDate: null,
      refusal: null,
    },
    productionEndpoint: '2026-07-31',
    workbookLatest: '2026-07-31',
    publicationDate: '2026-07-31',
    newDates: [],
    gapFillDates: [],
    corrections: [],
    unchangedCount: 3,
    invalidDates: [],
    cadenceGaps: [],
    action: 'publication_correction',
    requiresHistoricalCorrection: false,
    publicationComparison: 'changed',
    publicationChanged: true,
    publicationDifferences: [],
    publicationDifferenceCount: 3,
    blocked: false,
    blockCodes: [],
    counts: { new: 0, gapFill: 0, changed: 0, unchanged: 3, invalid: 0 },
    planFingerprint: 'x',
  }

  test('the NO_CHANGES state still disables the confirm control', () => {
    const src = codeOf(page)
    assert.match(src, /const nothingToApply = plan !== null && isNoOp\(plan\)/)
    assert.match(src, /disabled=\{[^}]*nothingToApply/)
    assert.match(src, /nothingToApply \? a\.nothingToApply : a\.publish/)
  })

  test('a snapshot-only change is NOT presented as "nothing to apply"', () => {
    const verdict = describeImportPlan(basePlan, dict.en.fpAdmin)
    assert.equal(verdict.kind, 'publication')
    assert.notEqual(verdict.title, dict.en.fpAdmin.verdictNothingTitle)
    assert.match(verdict.body, /3/, 'the number of differing figures is stated')
    assert.equal(isNoOp(basePlan), false, 'and Apply stays available')

    // The same plan with an unchanged snapshot is still "nothing".
    const settled: ImportPlan = {
      ...basePlan,
      action: 'nothing_to_append',
      publicationComparison: 'unchanged',
      publicationChanged: false,
      publicationDifferenceCount: 0,
    }
    assert.equal(describeImportPlan(settled, dict.en.fpAdmin).kind, 'nothing')
    assert.equal(isNoOp(settled), true)
  })

  test('a correction that also restates the snapshot says both, in both languages', () => {
    const mixed: ImportPlan = {
      ...basePlan,
      action: 'mixed_correction',
      requiresHistoricalCorrection: true,
      corrections: [
        {
          scope: 'main',
          basis: 'ex_chilean_equities',
          observationDate: '2026-07-24',
          beforeValue: 12,
          afterValue: 99,
        },
      ],
    }
    for (const lang of ['en', 'es'] as const) {
      const verdict = describeImportPlan(mixed, dict[lang].fpAdmin)
      assert.equal(verdict.kind, 'correction')
      assert.match(verdict.body, /3/, 'the snapshot differences are named too')
    }
  })

  test('the preview lists only what differs, never the unchanged holdings', () => {
    const component = read(PREVIEW_COMPONENT)
    assert.match(component, /function PublicationChangesCard/)
    assert.match(component, /plan\.publicationChanged !== true\) return null/)
    assert.match(component, /publicationDiffMore/)
    for (const lang of ['en', 'es'] as const) {
      const a = dict[lang].fpAdmin as unknown as Record<string, string>
      assert.match(a.publicationDiffNote, /(Unchanged|sin cambios)/i)
    }
  })

  test('an owner-review fixture exists for the state real data cannot produce', () => {
    const fixtures = read(FIXTURES)
    assert.ok(fixtures.includes('publicationCorrection: `${PREFIX}11`'))
    assert.match(fixtures, /publicationComparison: publicationDiffs\.length > 0 \? 'changed' : 'not_compared'/)
  })

  test('every refusal and verdict reads as a sentence, in English and Spanish', () => {
    for (const lang of ['en', 'es'] as const) {
      const a = dict[lang].fpAdmin as unknown as Record<string, string>
      const refusals = dict[lang].fpAdmin.refusalImport as Record<string, string>
      for (const key of ['nothing_to_append', 'import_refused_nothing_to_append', 'publication_read_failed']) {
        assert.equal(typeof refusals[key], 'string', `${lang}.${key} must exist`)
        assert.ok(refusals[key].length > 20, `${lang}.${key} must explain, not echo the code`)
        assert.doesNotMatch(refusals[key], /_/, `${lang}.${key} must not surface a raw code`)
      }
      for (const key of [
        'verdictPublicationTitle', 'verdictPublicationBody', 'verdictPublicationMixedBody',
        'publicationDiffTitle', 'publicationDiffNote', 'publicationDiffMore',
      ]) {
        assert.equal(typeof a[key], 'string', `${lang}.${key} must exist`)
        assert.doesNotMatch(a[key], /_/, `${lang}.${key} must not surface a raw code`)
      }
      // The corrected refusal must no longer claim history equality is the whole
      // test — that sentence was the false one.
      assert.ok(
        refusals.nothing_to_append.length > 60,
        `${lang} must say what "nothing" now covers, not just "already reflected"`,
      )
    }
  })
})
