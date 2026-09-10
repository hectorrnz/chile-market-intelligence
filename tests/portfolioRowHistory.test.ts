// POST-R13.8 FOLLOW-UP C — ROW-LEVEL WEEKLY HISTORY FOR ROLLING CONTRIBUTORS.
//
// The defect this closes: `portfolio_snapshot_rows` is keyed by publication, so
// a row-level value exists only for a week the book PUBLISHED. After the first
// real catch-up import the book held 2026-08-07 as a portfolio LEVEL and knew
// nothing about which holding stood at what value on that date — so a rolling
// four-interval Contributors/Detractors chart could not be built at all.
//
// The parser already computed those rows. It computed a full snapshot payload
// for every one of the workbook's 107 clean frozen columns while scanning for
// the newest publishable one, and then discarded 106 of them. This stage
// persists them, and nothing else about the locked R13.8 architecture moves:
//
//   ONE upload -> ONE import operation -> N evolution points
//              -> ONE newest full publication
//              -> N source-backed row-history dates
//
// Sections map to the brief's test matrix:
//   A-H  row history        I-N  atomicity and rollback
//   O-W  the rolling 1M     X-Z  the previousWeekDate write-path defect

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  planRowHistory,
  rowHistoryRequiresCorrection,
  ROW_HISTORY_VERSION,
  type PersistedRowHistoryEntry,
} from '../src/lib/familyPortfolio/rowHistory.ts'
import {
  planWeeklyImport,
  applyImportPlan,
  rollbackImport,
  type HistoryStore,
  type RowHistoryWrite,
  type SeriesObservation,
  type WeeklyImportPlan,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'
import {
  selectValueChangeRange,
  VALUE_CHANGE_PERIODS,
} from '../src/lib/familyPortfolio/valueChangeRange.ts'
import {
  TRAILING_MONTH_INTERVALS,
  openingByIntervals,
} from '../src/lib/familyPortfolio/evolutionRange.ts'
import {
  buildChangeNodes,
  deriveDrivers,
  type WeeklyChangeInputRow,
} from '../src/lib/familyPortfolio/weeklyChanges.ts'
import { dict } from '../src/lib/i18n.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(HERE, '..', rel), 'utf8')

const MIGRATION = read('supabase/migrations/20260822000000_portfolio_analytical_history.sql')
const PRIOR_MIGRATION_PATH = 'supabase/migrations/20260821000000_portfolio_import_operations.sql'
const ROW_HISTORY_LIB = read('src/lib/familyPortfolio/rowHistory.ts')
const PUBLISH_ROUTE = read('src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts')
const WEEKLY_ROUTE = read('src/app/api/family-portfolio/weekly-changes/[scope]/route.ts')
const PREVIEW_SERVER = read('src/lib/familyPortfolio/importPreviewServer.ts')
const PREVIEW_LIB = read('src/lib/familyPortfolio/weeklyImportPreview.ts')
const READ_REPO = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')
// FOLLOW-UP E — the two surfaces that consume the endpoint sets: the weekly
// page reads PUBLICATIONS, Compare reads the eligible set.
const WEEKLY_PAGE = 'src/app/portfolio/weekly-changes/page.tsx'
const COMPARE_PAGE = 'src/app/portfolio/compare/page.tsx'
const PUB_REPO = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
const CARD = read('src/components/familyPortfolio/PeriodValueChangeCard.tsx')
const RANGE_LIB = read('src/lib/familyPortfolio/valueChangeRange.ts')

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════
//
// The real book's shape, reduced to what each property needs: four scopes, a
// small hierarchy per scope, and the reporting spine the 2026-09-04 import
// actually produced — publications jumping 07-31 -> 09-04 with four catch-up
// weeks in between.

const REPORTING = [
  '2026-06-12',
  '2026-06-19',
  '2026-06-26',
  '2026-07-03',
  '2026-07-10',
  '2026-07-17',
  '2026-07-24',
  '2026-07-31',
  '2026-08-07',
  '2026-08-14',
  '2026-08-21',
  '2026-08-28',
  '2026-09-04',
] as const

/** The catch-up weeks: real reporting weeks with no publication of their own. */
const CATCH_UP = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'] as const
const PUBLISHED = REPORTING.filter((d) => !(CATCH_UP as readonly string[]).includes(d))
const SPINE = PUBLISHED.map((asOfDate) => ({ asOfDate }))

type Payload = {
  scope: string
  row_key: string
  parent_row_key: string | null
  depth: number
  display_order: number
  row_type: string
  label_es: string
  label_en: string | null
  currency: string
  value: number | null
  value_class: string
  source_sheet: string
  source_cell: string
  metadata: Record<string, unknown>
}

function row(
  scope: string,
  rowKey: string,
  value: number | null,
  extra: Partial<Payload> = {},
): Payload {
  return {
    scope,
    row_key: rowKey,
    parent_row_key: null,
    depth: 0,
    display_order: 1,
    row_type: 'asset_class',
    label_es: rowKey,
    label_en: null,
    currency: 'USD',
    value,
    value_class: value === null ? 'unavailable' : 'source_value',
    source_sheet: 'RESUMEN',
    source_cell: 'DA10',
    metadata: { sourceRow: 10 },
    ...extra,
  }
}

/** One date's rows across all four scopes, values scaled by a per-date factor. */
function week(factor: number): Payload[] {
  const out: Payload[] = []
  for (const scope of ['main', 'jaime', 'andres', 'pablo']) {
    out.push(row(scope, 'equities', 1_000 * factor, { display_order: 1 }))
    out.push(row(scope, 'credit', 500 * factor, { display_order: 2 }))
    out.push(
      row(scope, 'total', 1_500 * factor, {
        display_order: 3,
        row_type: 'portfolio_total',
      }),
    )
  }
  return out
}

function workbookAll(): Map<string, Payload[]> {
  const m = new Map<string, Payload[]>()
  REPORTING.forEach((d, i) => m.set(d, week(1 + i / 100)))
  return m
}

function persistedFrom(
  workbook: ReadonlyMap<string, Payload[]>,
  dates: readonly string[],
): PersistedRowHistoryEntry[] {
  const out: PersistedRowHistoryEntry[] = []
  for (const d of dates) {
    for (const r of workbook.get(d) ?? []) {
      out.push({
        scope: r.scope,
        observationDate: d,
        rowKey: r.row_key,
        value: r.value,
        valueClass: r.value_class,
      })
    }
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// A · Canonical identity
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · A — canonical row-history identity', () => {
  test('the identity is (scope, observation_date, row_key) — the snapshot row key with the date in place of the publication', () => {
    // `portfolio_snapshot_rows` is unique on (publication_id, scope, row_key).
    // Row history observes the same row at a DATE, most of which have no
    // publication, so the publication is replaced and nothing else moves.
    assert.match(
      MIGRATION,
      /constraint portfolio_row_history_key unique \(scope, observation_date, row_key\)/,
    )
    const prior = read(PRIOR_MIGRATION_PATH)
    assert.ok(prior.length > 0, 'the applied migration must still be present')
  })

  test('BASIS is not invented as an identity dimension', () => {
    // Basis distinguishes performance rows and evolution series, never snapshot
    // rows. Adding it here would give row history an identity the row model
    // does not have, and every row would then need a basis nobody can source.
    const table = MIGRATION.slice(
      MIGRATION.indexOf('create table if not exists public.portfolio_row_history ('),
      MIGRATION.indexOf('create index if not exists portfolio_row_history_scope_date_idx'),
    )
    assert.ok(table.length > 0)
    assert.ok(!/\bbasis\b/.test(table), 'row history must not carry a basis column')
  })

  test('every field the brief requires is reconstructable from one row', () => {
    for (const column of [
      'scope',
      'observation_date',
      'row_key',
      'parent_row_key',
      'depth',
      'display_order',
      'value',
      'value_class',
      'source_upload_id',
      'import_operation_id',
      'parser_version',
    ]) {
      assert.match(MIGRATION, new RegExp(`\\n\\s+${column}\\s`), `missing column ${column}`)
    }
  })

  test('a duplicate identity inside one date is refused, not deduplicated', () => {
    const workbook = new Map<string, Payload[]>([
      ['2026-09-04', [row('main', 'equities', 100), row('main', 'equities', 200)]],
    ])
    const plan = planRowHistory({ workbook, persisted: [], parserVersion: 'p1' })
    assert.equal(plan.rows.length, 0)
    assert.deepEqual(plan.skipped, [{ date: '2026-09-04', reason: 'duplicate_identity' }])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// B · The full frozen workbook normalizes
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · B — every clean frozen column becomes row history', () => {
  test('an empty book takes the whole workbook as insertions', () => {
    const workbook = workbookAll()
    const plan = planRowHistory({ workbook, persisted: [], parserVersion: 'p1' })
    assert.equal(plan.endpoint, null)
    assert.equal(plan.counts.changed, 0)
    assert.equal(plan.counts.unchanged, 0)
    // 13 dates x 4 scopes x 3 rows.
    assert.equal(plan.counts.new + plan.counts.gap_fill, 13 * 4 * 3)
    assert.equal(plan.rows.length, 13 * 4 * 3)
    assert.deepEqual(plan.datesInserted, [...REPORTING])
    assert.equal(plan.skipped.length, 0)
  })

  test('with no endpoint every insertion is `new`, never a fabricated gap fill', () => {
    const plan = planRowHistory({ workbook: workbookAll(), persisted: [], parserVersion: 'p1' })
    assert.equal(plan.counts.gap_fill, 0)
    assert.equal(plan.counts.new, 13 * 4 * 3)
  })

  test('a column that produced no rows is REPORTED, never inferred from a neighbour', () => {
    const workbook = workbookAll()
    workbook.set('2026-08-14', [])
    const plan = planRowHistory({ workbook, persisted: [], parserVersion: 'p1' })
    assert.deepEqual(plan.skipped, [{ date: '2026-08-14', reason: 'no_rows' }])
    assert.ok(!plan.datesInserted.includes('2026-08-14'))
    // And the neighbours are untouched — nothing is interpolated across the hole.
    assert.ok(plan.datesInserted.includes('2026-08-07'))
    assert.ok(plan.datesInserted.includes('2026-08-21'))
  })

  test('the plan carries its own version, so a classification change is visible', () => {
    const plan = planRowHistory({ workbook: workbookAll(), persisted: [], parserVersion: 'p1' })
    assert.equal(plan.version, ROW_HISTORY_VERSION)
    assert.match(ROW_HISTORY_VERSION, /^r13\.8e\./)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C · Inserting a missing date
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · C — a missing reporting date is inserted', () => {
  test('a date ABOVE the endpoint is `new`; a hole BELOW it is `gap_fill`', () => {
    const workbook = workbookAll()
    // The book already holds everything except one hole and the newest week.
    const held = REPORTING.filter((d) => d !== '2026-08-14' && d !== '2026-09-04')
    const plan = planRowHistory({
      workbook,
      persisted: persistedFrom(workbook, held),
      parserVersion: 'p1',
    })
    assert.equal(plan.endpoint, '2026-08-28')
    assert.equal(plan.counts.changed, 0)
    assert.equal(plan.counts.new, 12, 'the newest week, four scopes x three rows')
    assert.equal(plan.counts.gap_fill, 12, 'the hole below the endpoint')
    assert.deepEqual(plan.datesInserted, ['2026-08-14', '2026-09-04'])
    assert.deepEqual(plan.datesChanged, [])
  })

  test('an insertion asserts NO pre-state — there is nothing to be stale about', () => {
    const workbook = workbookAll()
    const held = REPORTING.filter((d) => d !== '2026-09-04')
    const plan = planRowHistory({
      workbook,
      persisted: persistedFrom(workbook, held),
      parserVersion: 'p1',
    })
    for (const r of plan.rows) {
      assert.equal(r.prior_value, null)
      assert.equal(r.prior_value_class, null)
      assert.equal(r.disposition, 'new')
    }
  })

  test('an insertion never requires authorization, however many rows it is', () => {
    const plan = planRowHistory({ workbook: workbookAll(), persisted: [], parserVersion: 'p1' })
    assert.equal(plan.rows.length, 156)
    assert.equal(rowHistoryRequiresCorrection(plan), false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// D · An identical re-upload is a no-op
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · D — re-uploading the same workbook writes nothing', () => {
  test('every identity is unchanged, and NOTHING is staged', () => {
    const workbook = workbookAll()
    const plan = planRowHistory({
      workbook,
      persisted: persistedFrom(workbook, REPORTING),
      parserVersion: 'p1',
    })
    assert.equal(plan.rows.length, 0)
    assert.equal(plan.counts.new, 0)
    assert.equal(plan.counts.gap_fill, 0)
    assert.equal(plan.counts.changed, 0)
    assert.equal(plan.counts.unchanged, 156)
    assert.deepEqual(plan.datesInserted, [])
    assert.deepEqual(plan.datesChanged, [])
  })

  test('a presentation-only difference is NOT a restatement', () => {
    // A row that moved down the sheet, or whose source cell shifted, has not
    // changed financially. Treating that as an overwrite would demand an
    // authorized correction every week for a column insertion.
    const workbook = workbookAll()
    const persisted = persistedFrom(workbook, REPORTING)
    const shifted = new Map(
      [...workbook].map(([d, rows]) => [
        d,
        rows.map((r) => ({ ...r, display_order: r.display_order + 10, source_cell: 'ZZ99' })),
      ]),
    )
    const plan = planRowHistory({ workbook: shifted, persisted, parserVersion: 'p1' })
    assert.equal(plan.rows.length, 0)
    assert.equal(plan.counts.unchanged, 156)
  })

  test('an unavailable row that is STILL unavailable has not changed', () => {
    // Otherwise every unreadable cell would demand an authorized correction on
    // every single upload, forever.
    const workbook = new Map<string, Payload[]>([['2026-09-04', [row('main', 'cash', null)]]])
    const persisted: PersistedRowHistoryEntry[] = [
      { scope: 'main', observationDate: '2026-09-04', rowKey: 'cash', value: null, valueClass: 'unavailable' },
    ]
    const plan = planRowHistory({ workbook, persisted, parserVersion: 'p1' })
    assert.equal(plan.rows.length, 0)
    assert.equal(plan.counts.unchanged, 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// E · A changed historical row is a correction
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · E — overwriting a recorded row is a correction', () => {
  test('a moved value is `changed`, carries its before-image, and demands authorization', () => {
    const workbook = workbookAll()
    const persisted = persistedFrom(workbook, REPORTING)
    const restated = new Map(workbook)
    restated.set('2026-07-03', [
      row('main', 'equities', 9_999, { display_order: 1 }),
      ...(workbook.get('2026-07-03') ?? []).slice(1),
    ])

    const plan = planRowHistory({ workbook: restated, persisted, parserVersion: 'p1' })
    assert.equal(plan.counts.changed, 1)
    assert.deepEqual(plan.datesChanged, ['2026-07-03'])
    assert.equal(rowHistoryRequiresCorrection(plan), true)

    const [staged] = plan.rows
    assert.equal(staged.disposition, 'changed')
    assert.equal(staged.observation_date, '2026-07-03')
    assert.equal(staged.value, 9_999)
    // The before-image the database re-reads under lock and refuses on.
    assert.equal(staged.prior_value, 1_030)
    assert.equal(staged.prior_value_class, 'source_value')

    assert.equal(plan.corrections.length, 1)
    assert.equal(plan.corrections[0].beforeValue, 1_030)
    assert.equal(plan.corrections[0].afterValue, 9_999)
  })

  test('the planner ARMS the same authorization gate the other two forms use', () => {
    const base = basePlan()
    assert.equal(base.requiresHistoricalCorrection, false)

    const gated = planWeeklyImport({
      workbookObservations: OBSERVATIONS,
      publishedObservations: OBSERVATIONS,
      latestPublishedAsOf: '2026-09-04',
      rowHistory: {
        insertedCount: 0,
        changedCount: 3,
        datesInserted: [],
        datesChanged: ['2026-07-03'],
      },
    })
    assert.equal(gated.requiresRowHistoryCorrection, true)
    assert.equal(gated.requiresHistoricalCorrection, true)
    // Unauthorized -> blocked. The cause stays separately reported, so an
    // administrator is never told "correction required" without being told which.
    assert.ok(gated.blockCodes.includes('historical_correction_required'))
    assert.equal(gated.requiresEvolutionCorrection, false)
    assert.equal(gated.requiresPublicationRestatementCorrection, false)
  })

  test('authorized without a reason is still blocked', () => {
    const plan = planWeeklyImport({
      workbookObservations: OBSERVATIONS,
      publishedObservations: OBSERVATIONS,
      latestPublishedAsOf: '2026-09-04',
      historicalCorrectionAuthorized: true,
      correctionReason: '   ',
      rowHistory: { insertedCount: 0, changedCount: 1, datesInserted: [], datesChanged: ['2026-07-03'] },
    })
    assert.ok(plan.blockCodes.includes('correction_reason_required'))
  })

  test('the DATABASE demands it too — the server is not the only gate', () => {
    assert.match(MIGRATION, /v_rh_changed > 0/)
    assert.match(MIGRATION, /import_refused_historical_correction_required/)
  })

  test('a row-history-only APPEND is never a no-op and never needs authorization', () => {
    const plan = planWeeklyImport({
      workbookObservations: OBSERVATIONS,
      publishedObservations: OBSERVATIONS,
      latestPublishedAsOf: '2026-09-04',
      publicationComparison: 'unchanged',
      rowHistory: {
        insertedCount: 19_757,
        changedCount: 0,
        datesInserted: [...REPORTING],
        datesChanged: [],
      },
    })
    assert.equal(plan.action, 'row_history_append')
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blocked, false)
    // And the route refuses to call that "nothing to append".
    assert.match(PUBLISH_ROUTE, /plan\.rowHistory\.insertedCount === 0/)
    assert.match(MIGRATION, /v_rh_new = 0 and v_rh_changed = 0/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F · An unreadable value never becomes zero
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · F — an unreadable value never becomes zero', () => {
  test('null survives the plan intact, with its class', () => {
    const workbook = new Map<string, Payload[]>([
      ['2026-09-04', [row('main', 'cash', null), row('main', 'equities', 10)]],
    ])
    const plan = planRowHistory({ workbook, persisted: [], parserVersion: 'p1' })
    const cash = plan.rows.find((r) => r.row_key === 'cash')
    assert.ok(cash)
    assert.equal(cash.value, null)
    assert.equal(cash.value_class, 'unavailable')
    assert.notEqual(cash.value, 0)
  })

  test('a value that BECOMES unreadable is a real change, not silence', () => {
    const workbook = new Map<string, Payload[]>([['2026-09-04', [row('main', 'cash', null)]]])
    const persisted: PersistedRowHistoryEntry[] = [
      { scope: 'main', observationDate: '2026-09-04', rowKey: 'cash', value: 42, valueClass: 'source_value' },
    ]
    const plan = planRowHistory({ workbook, persisted, parserVersion: 'p1' })
    assert.equal(plan.counts.changed, 1)
    assert.equal(plan.rows[0].value, null)
    assert.equal(plan.rows[0].prior_value, 42)
  })

  test('the DATABASE refuses an unavailable row that carries a number', () => {
    assert.match(
      MIGRATION,
      /constraint portfolio_row_history_unavailable_ck check \(\s*value_class <> 'unavailable' or value is null\s*\)/,
    )
  })

  test('the read path never coalesces a null to zero', () => {
    const fn = READ_REPO.slice(
      READ_REPO.indexOf('export async function getRowHistoryForScope'),
      READ_REPO.indexOf('type RowHistoryDateSelect'),
    )
    assert.ok(fn.length > 0)
    assert.match(fn, /value: r\.value,/)
    assert.ok(!/value: r\.value \?\? 0/.test(fn))
    assert.ok(!/Number\(r\.value\)/.test(fn))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// G · Missing-row semantics
// ═══════════════════════════════════════════════════════════════════════════

/** One hierarchy row, in the shape the pure change functions consume. */
function input(rowKey: string, value: number | null, rowType = 'asset_class'): WeeklyChangeInputRow {
  return {
    rowKey,
    parentRowKey: null,
    depth: 0,
    displayOrder: 1,
    rowType,
    labelEs: rowKey,
    labelEn: null,
    currency: 'USD',
    value,
  }
}

describe('follow-up C · G — a row absent at one endpoint keeps its meaning', () => {
  test('a position present only at the close is a NEW POSITION with a settled zero open', () => {
    // The R13.R1.1 § 14 rule, and row history inherits it for the reason that
    // rule exists: the parser prunes a row with no value AND no surviving
    // descendant, and KEEPS an error cell as `unavailable`. So a row genuinely
    // absent from one endpoint was not held that week, and its value then was
    // economically zero. Row-history rows come from that same parser, so the
    // completeness the rule depends on is the same.
    const opening: WeeklyChangeInputRow[] = [input('equities', 1_000), input('total', 1_000, 'portfolio_total')]
    const closing: WeeklyChangeInputRow[] = [
      input('equities', 1_100),
      input('newco', 250),
      input('total', 1_350, 'portfolio_total'),
    ]
    const nodes = buildChangeNodes(closing, opening, 1_000)
    const newco = nodes.find((n) => n.rowKey === 'newco')
    assert.ok(newco)
    assert.equal(newco.lifecycle, 'new_position')
    assert.equal(newco.status, 'ok')
    assert.equal(newco.previousValue, 0, 'a confirmed absence, not an unknown')
    assert.equal(newco.weeklyValueChange, 250)
  })

  test('a position present only at the OPEN is an exit, and its value is not dropped', () => {
    const opening: WeeklyChangeInputRow[] = [
      input('equities', 1_000),
      input('oldco', 300),
      input('total', 1_300, 'portfolio_total'),
    ]
    const closing: WeeklyChangeInputRow[] = [input('equities', 1_100), input('total', 1_100, 'portfolio_total')]
    const nodes = buildChangeNodes(closing, opening, 1_300)
    const oldco = nodes.find((n) => n.rowKey === 'oldco')
    assert.ok(oldco)
    assert.equal(oldco.lifecycle, 'exited_position')
    assert.equal(oldco.previousValue, 300)
    assert.equal(oldco.currentValue, 0)
    // The exit is a real −300 detraction, not a silently dropped row.
    assert.equal(oldco.weeklyValueChange, -300)
  })

  test('an UNAVAILABLE row is never converted into a confirmed absence', () => {
    // The distinction the § 14 rule turns on: a row that is PRESENT with an
    // unusable value stays unavailable, and is never read as a position that
    // went to zero.
    const opening: WeeklyChangeInputRow[] = [
      input('equities', 1_000),
      input('murky', null),
      input('total', 1_000, 'portfolio_total'),
    ]
    const closing: WeeklyChangeInputRow[] = [
      input('equities', 1_100),
      input('murky', 400),
      input('total', 1_500, 'portfolio_total'),
    ]
    const nodes = buildChangeNodes(closing, opening, 1_000)
    const murky = nodes.find((n) => n.rowKey === 'murky')
    assert.ok(murky)
    assert.equal(murky.status, 'unavailable')
    assert.equal(murky.unavailableReason, 'missing_previous')
    assert.equal(murky.weeklyValueChange, null, 'never a 400 gain against a fabricated zero')
    assert.equal(murky.lifecycle, 'ongoing')
  })

  test('an unavailable endpoint suppresses the change instead of reporting one', () => {
    const opening: WeeklyChangeInputRow[] = [input('equities', null), input('total', 1_000, 'portfolio_total')]
    const closing: WeeklyChangeInputRow[] = [input('equities', 1_100), input('total', 1_100, 'portfolio_total')]
    const nodes = buildChangeNodes(closing, opening, 1_000)
    const eq = nodes.find((n) => n.rowKey === 'equities')
    assert.ok(eq)
    assert.equal(eq.status, 'unavailable')
    assert.equal(eq.weeklyValueChange, null, 'never 1,100 against a fabricated zero')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// H · Family scope isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · H — row history is isolated exactly like a publication', () => {
  test('the table takes the SAME scope-filtered predicate as portfolio_snapshot_rows', () => {
    assert.match(
      MIGRATION,
      /create policy "portfolio_row_history_scope_select"[\s\S]*?using \(public\.nmi_can_access_scope\(scope\)\)/,
    )
    // The same helper the snapshot rows use — one definition of "may read this
    // scope", re-derived by PostgreSQL from the caller's own profile row.
    const snapshots = read('supabase/migrations/20260808000000_family_portfolio_snapshots.sql')
    assert.match(snapshots, /portfolio_snapshot_rows_scope_select[\s\S]*?nmi_can_access_scope\(scope\)/)
  })

  test('`authenticated` may READ within its scope and may never write', () => {
    assert.match(MIGRATION, /grant select on table public\.portfolio_row_history to authenticated/)
    assert.match(
      MIGRATION,
      /revoke all privileges on table public\.portfolio_row_history from public, anon, authenticated/,
    )
    assert.match(MIGRATION, /authenticated gained write privileges on portfolio_row_history/)
  })

  test('the ledger and the staging relay are SERVICE-ROLE ONLY', () => {
    // Both carry values across every scope at once, so exposing either to
    // `authenticated` would bypass the scope filter guarding the table itself.
    for (const t of ['portfolio_import_row_history_mutations', 'portfolio_row_history_staging']) {
      assert.match(MIGRATION, new RegExp(`grant all privileges on table public\\.${t} to service_role`))
      assert.match(
        MIGRATION,
        new RegExp(`revoke all privileges on table public\\.${t}\\s*\\n?\\s*from public, anon, authenticated`),
      )
    }
    assert.match(MIGRATION, /authenticated gained read on a row-history internal table/)
    assert.ok(
      !/grant select on table public\.portfolio_row_history_staging to authenticated/.test(MIGRATION),
    )
  })

  test('the member read goes through the CALLER’S OWN session, not the admin client', () => {
    const fn = READ_REPO.slice(
      READ_REPO.indexOf('export async function getRowHistoryForScope'),
      READ_REPO.indexOf('type RowHistoryDateSelect'),
    )
    assert.match(fn, /getSupabaseUserClient\(\)/)
    assert.ok(!/getSupabaseAdminClient/.test(fn), 'RLS must remain the authority for a member read')
  })

  test('the WHOLE-BOOK planning read is the admin client, and never reaches a member surface', () => {
    const fn = PUB_REPO.slice(
      PUB_REPO.indexOf('export async function listPersistedRowHistory'),
      PUB_REPO.indexOf('export interface RowHistoryStagedRow'),
    )
    assert.match(fn, /getSupabaseAdminClient\(\)/)
    // It is only ever called from the server-side preview planner.
    assert.match(PREVIEW_SERVER, /listPersistedRowHistory/)
    assert.ok(!/listPersistedRowHistory/.test(WEEKLY_ROUTE))
    assert.ok(!/listPersistedRowHistory/.test(CARD))
  })

  test('a paged read never terminates early and calls the rest absent', () => {
    // A short page ends the walk; a full page asks for another. Stopping on a
    // server row cap would make every unread identity look ABSENT and turn an
    // ordinary re-upload into thousands of fabricated insertions.
    const fn = PUB_REPO.slice(
      PUB_REPO.indexOf('export async function listPersistedRowHistory'),
      PUB_REPO.indexOf('export interface RowHistoryStagedRow'),
    )
    assert.match(fn, /if \(batch\.length < ROW_HISTORY_PAGE\) break/)
    assert.match(PREVIEW_SERVER, /row_history_read_failed/)
    assert.ok(
      !/persisted: \[\]/.test(PREVIEW_SERVER),
      'an unreadable table must never be planned as an empty one',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// I–N · Atomicity and rollback
// ═══════════════════════════════════════════════════════════════════════════

const OBSERVATIONS: SeriesObservation[] = REPORTING.map((d) => ({
  scope: 'main',
  basis: 'with_chilean_equities',
  observationDate: d,
  value: 1_000,
  status: 'stated',
}))

function basePlan(overrides: Partial<Parameters<typeof planWeeklyImport>[0]> = {}): WeeklyImportPlan {
  return planWeeklyImport({
    workbookObservations: OBSERVATIONS,
    publishedObservations: OBSERVATIONS.slice(0, -1),
    latestPublishedAsOf: '2026-08-28',
    ...overrides,
  })
}

function writes(
  entries: Array<[string, string, number | null, 'new' | 'gap_fill' | 'changed', number | null]>,
): RowHistoryWrite[] {
  return entries.map(([date, rowKey, value, disposition, priorValue]) => ({
    scope: 'main',
    observationDate: date,
    rowKey,
    disposition,
    value,
    valueClass: value === null ? 'unavailable' : 'source_value',
    priorValue,
    priorValueClass: priorValue === null && disposition !== 'changed' ? null : 'source_value',
  }))
}

const EMPTY_STORE: HistoryStore = {
  observations: OBSERVATIONS.slice(0, -1).map((o) => ({
    scope: o.scope,
    basis: o.basis,
    seriesIdentity: '',
    observationDate: o.observationDate,
    value: o.value,
    status: 'stated' as const,
  })),
  currentPublication: { asOfDate: '2026-08-28', revision: 1, importId: 'import-0' },
  publications: { '2026-08-28': { asOfDate: '2026-08-28', revision: 1, importId: 'import-0' } },
  rowHistory: [],
}

describe('follow-up C · I–K — the import is one transaction or nothing', () => {
  test('I — a stale row-history assertion discovered LAST leaves nothing behind', () => {
    // The failing write is the third of three, after two would have succeeded
    // and after the evolution and publication work was staged. The store the
    // caller passed in comes back BY IDENTITY, so "nothing moved" is checkable.
    const store: HistoryStore = {
      ...EMPTY_STORE,
      rowHistory: [
        {
          scope: 'main',
          observationDate: '2026-07-03',
          rowKey: 'equities',
          value: 111,
          valueClass: 'source_value',
          importId: 'import-0',
        },
      ],
    }
    const result = applyImportPlan(
      store,
      basePlan(),
      'import-1',
      writes([
        ['2026-09-04', 'equities', 10, 'new', null],
        ['2026-09-04', 'credit', 20, 'new', null],
        // Asserts 999; the book holds 111.
        ['2026-07-03', 'equities', 500, 'changed', 999],
      ]),
    )
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'stale_row_history')
    assert.equal(result.store, store, 'the very same store object, unmoved')
    assert.equal(store.rowHistory?.length, 1)
    assert.equal(store.currentPublication?.importId, 'import-0')
  })

  test('J — a publication failure leaves NO row history', () => {
    // A blocked plan never reaches the row-history stage at all.
    const blocked = basePlan({
      rowHistory: { insertedCount: 0, changedCount: 2, datesInserted: [], datesChanged: ['2026-07-03'] },
    })
    assert.equal(blocked.blocked, true)
    const result = applyImportPlan(EMPTY_STORE, blocked, 'import-1', writes([['2026-09-04', 'equities', 10, 'new', null]]))
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.code, 'plan_blocked')
    assert.equal(result.store.rowHistory?.length, 0)
  })

  test('K — a row-history failure leaves no publication and no evolution point', () => {
    const result = applyImportPlan(
      EMPTY_STORE,
      basePlan(),
      'import-1',
      // An insertion whose identity is a duplicate of the previous write.
      writes([
        ['2026-09-04', 'equities', 10, 'new', null],
        ['2026-09-04', 'equities', 11, 'new', null],
      ]),
    )
    assert.equal(result.ok, false)
    assert.equal(result.store.currentPublication?.asOfDate, '2026-08-28')
    assert.equal(result.store.observations.length, 12, 'the new week was not appended')
    assert.equal(result.store.rowHistory?.length, 0)
  })

  test('the RPC writes row history INSIDE the import transaction, not after it', () => {
    // One function, one transaction. There is no post-commit second write path
    // and no sequential fallback anywhere in the application.
    const body = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.nmi_import_portfolio_workbook'),
      MIGRATION.indexOf('create or replace function public.nmi_rollback_portfolio_import'),
    )
    assert.ok(body.includes('insert into public.portfolio_row_history'))
    assert.ok(body.includes('nmi_publish_portfolio'))
    assert.ok(body.includes('portfolio_evolution_observations'))
    // The publish route makes exactly ONE import call.
    assert.equal((PUBLISH_ROUTE.match(/await importPortfolioWorkbook\(/g) ?? []).length, 1)
  })

  test('the relay is transport, and a lost chunk is a REFUSAL rather than a partial write', () => {
    assert.match(MIGRATION, /import_refused_row_history_staging_incomplete/)
    assert.match(MIGRATION, /import_refused_row_history_count_missing/)
    assert.match(MIGRATION, /import_refused_row_history_staging_missing/)
    assert.match(PUBLISH_ROUTE, /rowHistoryRowCount: rowHistoryRows\.length/)
    assert.match(PUBLISH_ROUTE, /rowHistoryStagingId: rowHistoryRows\.length > 0 \? rowHistoryStagingId : null/)
  })

  test('the RPC KEEPS its exact 14-argument signature — no second import path exists', () => {
    const sig = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.nmi_import_portfolio_workbook('),
      MIGRATION.indexOf('returns jsonb'),
    )
    const args = (sig.match(/^\s{2}p_[a-z_]+\s/gm) ?? []).length
    assert.equal(args, 14, 'the deployed signature must be replaced in place, never overloaded')
    assert.ok(!/p_row_history/.test(sig), 'the relay id rides in the metadata packet')
    assert.match(MIGRATION, /expected exactly one nmi_import_portfolio_workbook/)
    assert.match(MIGRATION, /rowHistoryStagingId/)
  })
})

describe('follow-up C · L–N — rollback', () => {
  const applied = applyImportPlan(
    EMPTY_STORE,
    basePlan(),
    'import-1',
    writes([
      ['2026-09-04', 'equities', 10, 'new', null],
      ['2026-09-04', 'credit', 20, 'new', null],
    ]),
  )

  test('L — rollback removes exactly the rows this import inserted', () => {
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.equal(applied.store.rowHistory?.length, 2)
    assert.deepEqual(
      applied.record.rowHistoryEntries.map((e) => e.priorExisted),
      [false, false],
    )
    const back = rollbackImport(applied.store, applied.record)
    assert.equal(back.ok, true)
    if (!back.ok) return
    assert.equal(back.store.rowHistory?.length, 0)
    assert.equal(back.store.currentPublication?.importId, 'import-0')
  })

  test('M — rollback restores an overwritten row to its exact before-image and LINEAGE', () => {
    const store: HistoryStore = {
      ...EMPTY_STORE,
      rowHistory: [
        {
          scope: 'main',
          observationDate: '2026-07-03',
          rowKey: 'equities',
          value: 111,
          valueClass: 'source_value',
          importId: 'import-0',
        },
      ],
    }
    const out = applyImportPlan(
      store,
      basePlan({
        historicalCorrectionAuthorized: true,
        correctionReason: 'workbook restated the July basket',
        rowHistory: { insertedCount: 0, changedCount: 1, datesInserted: [], datesChanged: ['2026-07-03'] },
      }),
      'import-1',
      writes([['2026-07-03', 'equities', 222, 'changed', 111]]),
    )
    assert.equal(out.ok, true)
    if (!out.ok) return
    assert.equal(out.store.rowHistory?.[0].value, 222)
    assert.equal(out.store.rowHistory?.[0].importId, 'import-1')

    const back = rollbackImport(out.store, out.record)
    assert.equal(back.ok, true)
    if (!back.ok) return
    const restored = back.store.rowHistory?.[0]
    assert.equal(restored?.value, 111)
    assert.equal(restored?.valueClass, 'source_value')
    // Restoring the LINEAGE is what makes rollbacks chain: leaving the pointer
    // at import-1 would make a later rollback of import-0 refuse.
    assert.equal(restored?.importId, 'import-0')
  })

  test('N — a later import that owns one of these rows BLOCKS the stale rollback', () => {
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    const moved: HistoryStore = {
      ...applied.store,
      rowHistory: (applied.store.rowHistory ?? []).map((r) =>
        r.rowKey === 'credit' ? { ...r, value: 99, importId: 'import-2' } : r,
      ),
    }
    const back = rollbackImport(moved, applied.record)
    assert.equal(back.ok, false)
    assert.equal(back.ok === false && back.code, 'superseded_by_later_import')
    // Refused WHOLE — the other row is not reversed either.
    assert.equal(back.store.rowHistory?.length, 2)
  })

  test('the RPC refuses the same way, and reverses row history set-based', () => {
    const body = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.nmi_rollback_portfolio_import'))
    assert.ok(body.includes('rollback_refused_row_history_superseded_by_later_import'))
    assert.ok(body.includes('delete from public.portfolio_row_history r'))
    assert.ok(body.includes("rm.prior_row->>'parent_row_key'"))
    assert.ok(body.includes('import_operation_id = rm.prior_import_operation_id'))
  })

  test('the before-image ledger cannot record a nonsense state', () => {
    assert.match(MIGRATION, /portfolio_import_row_history_mutations_before_ck/)
    // An insertion has no before-image; an overwrite must have one.
    assert.match(MIGRATION, /disposition in \('new','gap_fill'\)\s*\n\s*and prior_value is null and prior_value_class is null and prior_row is null/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// O–W · The rolling 1M window
// ═══════════════════════════════════════════════════════════════════════════

const ROW_HISTORY_DATES = [...REPORTING]

describe('follow-up C · O–W — 1M is four source intervals, and now RESOLVES', () => {
  test('O — 2026-09-04 opens at 2026-08-07 and closes at 2026-09-04', () => {
    const r = selectValueChangeRange(SPINE, '1M', null, REPORTING, ROW_HISTORY_DATES)
    assert.equal(r.state, 'ok')
    assert.equal(r.fromDate, '2026-08-07')
    assert.equal(r.toDate, '2026-09-04')
    // The opening week has NO publication. It is opened from row history, and
    // the range says so rather than implying a publication exists.
    assert.equal(r.openingSource, 'row_history')
    assert.ok(!PUBLISHED.includes(r.fromDate as (typeof PUBLISHED)[number]))
  })

  test('P — exactly four source intervals, counted on the reporting spine', () => {
    assert.equal(TRAILING_MONTH_INTERVALS, 4)
    assert.equal(openingByIntervals(REPORTING, '2026-09-04', 4), '2026-08-07')
    const r = selectValueChangeRange(SPINE, '1M', null, REPORTING, ROW_HISTORY_DATES)
    // Five endpoints, four intervals — the owner's own arithmetic.
    assert.equal(r.weekCount, 5)
    const inside = REPORTING.filter((d) => d >= '2026-08-07' && d <= '2026-09-04')
    assert.equal(inside.length - 1, 4)
  })

  test('U — it is not September month-to-date', () => {
    const r = selectValueChangeRange(SPINE, '1M', null, REPORTING, ROW_HISTORY_DATES)
    assert.ok((r.fromDate as string) < '2026-09-01', 'the window reaches into August, as a month should')
  })

  test('V — and it is emphatically not 2026-07-31 to 2026-09-04', () => {
    // Five intervals under a four-interval label. The rejected approximation
    // must not be reachable by any path.
    const r = selectValueChangeRange(SPINE, '1M', null, REPORTING, ROW_HISTORY_DATES)
    assert.notEqual(r.fromDate, '2026-07-31')
    assert.notEqual(r.state, 'opening_not_published')
  })

  test('W — with no row history at 08-07 it still REFUSES rather than widening', () => {
    const withoutOpening = ROW_HISTORY_DATES.filter((d) => d !== '2026-08-07')
    const r = selectValueChangeRange(SPINE, '1M', null, REPORTING, withoutOpening)
    assert.equal(r.state, 'opening_not_published')
    assert.equal(r.requiredOpeningDate, '2026-08-07')
    assert.equal(r.fromDate, null)
    assert.equal(r.openingSource, null)
    // And the surface names the missing week, in both languages.
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.overview.vwfOpeningNotPublished.length > 30)
    }
    assert.match(CARD, /range\.requiredOpeningDate/)
  })

  test('W — a genuinely short record degrades honestly, never a fabricated endpoint', () => {
    const young = ['2026-08-28', '2026-09-04']
    const r = selectValueChangeRange(
      young.map((asOfDate) => ({ asOfDate })),
      '1M',
      null,
      young,
      young,
    )
    assert.equal(r.state, 'single_week')
    assert.equal(r.fromDate, null)
    assert.equal(r.truncatedByHistory, true)
  })

  test('a PUBLICATION is preferred when the opening week has both', () => {
    // Row history covers every reporting week including the published ones. The
    // published week carries performance rows too, so it wins.
    const dense = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04']
    const r = selectValueChangeRange(
      dense.map((asOfDate) => ({ asOfDate })),
      '1M',
      null,
      dense,
      dense,
    )
    assert.equal(r.state, 'ok')
    assert.equal(r.openingSource, 'publication')
    assert.equal(r.fromDate, '2026-08-07')
  })

  test('omitting row history reproduces the pre-R13.8E behaviour exactly', () => {
    const before = selectValueChangeRange(SPINE, '1M', null, REPORTING)
    assert.equal(before.state, 'opening_not_published')
    assert.equal(before.requiredOpeningDate, '2026-08-07')
  })
})

describe('follow-up C · Q–T — contributors resolve for Main and every personal scope', () => {
  // The chart's arithmetic, per the brief: CLOSING row value minus OPENING row
  // value. Four weekly intervals of movement, expressed once — never a sum of
  // four weekly differences, and never with flows added separately.
  const workbook = workbookAll()
  const opening = workbook.get('2026-08-07') ?? []
  const closing = workbook.get('2026-09-04') ?? []

  function rowsFor(scope: string, payload: Payload[]): WeeklyChangeInputRow[] {
    return payload
      .filter((r) => r.scope === scope)
      .map((r) => ({
        rowKey: r.row_key,
        parentRowKey: r.parent_row_key,
        depth: r.depth,
        displayOrder: r.display_order,
        rowType: r.row_type,
        labelEs: r.label_es,
        labelEn: r.label_en,
        currency: r.currency,
        value: r.value,
      }))
  }

  for (const scope of ['main', 'jaime', 'andres', 'pablo'] as const) {
    test(`${scope} — the 1M window resolves and every driver carries a real change`, () => {
      const range = selectValueChangeRange(SPINE, '1M', null, REPORTING, ROW_HISTORY_DATES)
      assert.equal(range.state, 'ok')
      assert.equal(range.fromDate, '2026-08-07')

      const open = rowsFor(scope, opening)
      const close = rowsFor(scope, closing)
      const openingTotal = open.find((r) => r.rowKey === 'total')?.value ?? null
      const nodes = buildChangeNodes(close, open, openingTotal)
      const drivers = deriveDrivers(nodes, 'top_level')

      assert.ok(drivers.length > 0, 'the chart must have components to draw')
      for (const d of drivers) {
        assert.equal(d.status, 'ok')
        assert.equal(d.lifecycle, 'ongoing')
        assert.ok(typeof d.weeklyValueChange === 'number' && Number.isFinite(d.weeklyValueChange))
      }

      // CLOSING minus OPENING, exactly once. The factors are 1.08 and 1.12.
      const equities = drivers.find((d) => d.rowKey === 'equities')
      assert.ok(equities)
      assert.ok(
        Math.abs((equities.weeklyValueChange as number) - (1_000 * 1.12 - 1_000 * 1.08)) < 1e-9,
      )
    })
  }

  test('the same rule serves Main and a personal scope — no special case', () => {
    // The selector is scope-agnostic by construction: it is handed two spines
    // and knows nothing else.
    const main = selectValueChangeRange(SPINE, '1M', null, REPORTING, ROW_HISTORY_DATES)
    const personalReporting = REPORTING.filter((d) => d !== '2026-06-12')
    const personal = selectValueChangeRange(
      SPINE.filter((w) => w.asOfDate !== '2026-06-12'),
      '1M',
      null,
      personalReporting,
      personalReporting,
    )
    assert.equal(main.fromDate, personal.fromDate)
    assert.equal(main.toDate, personal.toDate)
    assert.equal(main.state, personal.state)
  })

  test('the change is a level difference — flows and P&L are NOT added on top', () => {
    // The publication's own flow/profit figures describe ONE week. Over a
    // four-interval window the route suppresses them rather than letting a
    // one-week part be read against a four-week whole.
    assert.match(WEEKLY_ROUTE, /mode === 'custom'\s*\n?\s*\? suppressSingleWeekMetrics/)
  })
})

describe('follow-up C · 3M / YTD / 1Y / ALL are not redefined', () => {
  test('each still opens at the first PUBLICATION on or after its own boundary', () => {
    for (const period of ['3M', 'YTD', '1Y'] as const) {
      const withRowHistory = selectValueChangeRange(SPINE, period, null, REPORTING, ROW_HISTORY_DATES)
      const without = selectValueChangeRange(SPINE, period, null, REPORTING)
      assert.equal(withRowHistory.fromDate, without.fromDate, `${period} must not move`)
      assert.equal(withRowHistory.toDate, without.toDate)
      assert.equal(withRowHistory.openingSource, 'publication')
      assert.ok(PUBLISHED.includes(withRowHistory.fromDate as (typeof PUBLISHED)[number]))
    }
    const all = selectValueChangeRange(SPINE, 'ALL', null, REPORTING, ROW_HISTORY_DATES)
    assert.equal(all.fromDate, '2026-06-12')
    assert.equal(all.boundary, null)
  })

  test('only 1M consults row history at all', () => {
    const oneM = RANGE_LIB.slice(RANGE_LIB.indexOf("if (period === '1M') {"))
    assert.ok(oneM.includes('rowHistoryWeeks'))
    const calendar = RANGE_LIB.slice(RANGE_LIB.indexOf('// Real publications only'))
    assert.ok(!calendar.includes('rowHistoryWeeks'))
  })

  test('the period rail is unchanged — nothing was added or removed', () => {
    assert.deepEqual([...VALUE_CHANGE_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
  })
})

describe('follow-up C · row history is never offered as a publication', () => {
  test('the table carries no publication lifecycle columns, and the migration proves it', () => {
    assert.match(MIGRATION, /portfolio_row_history must not carry publication lifecycle columns/)
    const table = MIGRATION.slice(
      MIGRATION.indexOf('create table if not exists public.portfolio_row_history ('),
      MIGRATION.indexOf('create index if not exists portfolio_row_history_scope_date_idx'),
    )
    for (const forbidden of ['is_current', 'revision', 'superseded_by', 'publication_id']) {
      assert.ok(!new RegExp(`\\n\\s+${forbidden}\\s`).test(table), `row history must not carry ${forbidden}`)
    }
  })

  test('the WEEK selector still offers publications only', () => {
    // `weeks` is what the weekly page's one control renders. It is built from
    // the publication spine and nothing else, so a row-history date can never
    // be picked as though the book had published it.
    assert.match(WEEKLY_ROUTE, /const weeks = spine\.publications\.map/)
    const weeksLine = WEEKLY_ROUTE.slice(
      WEEKLY_ROUTE.indexOf('const weeks = spine.publications.map'),
      WEEKLY_ROUTE.indexOf('// ── WHICH DATE CLOSES THE COMPARISON'),
    )
    assert.ok(!weeksLine.includes('rowHistory'))
    // The weekly page reads exactly that list, and Compare never does.
    assert.match(read(WEEKLY_PAGE), /weeks=\{data\.weeks\}/)
    assert.ok(!read(COMPARE_PAGE).includes('data.weeks'))
  })

  test('FOLLOW-UP E — a row-history date may CLOSE a comparison, and is still not a publication', () => {
    // The asymmetry is gone: the same persisted rows answer a closing endpoint
    // exactly as completely as an opening one, and limiting the closing side to
    // publications hid the four most recent reporting weeks of the real book.
    assert.match(WEEKLY_ROUTE, /getRowHistoryForScope\(scope, closingDate\)/)
    assert.match(WEEKLY_ROUTE, /closingSource: 'publication' \| 'row_history'/)
    // What did NOT change: such a date gains no publication bookkeeping. The
    // response reports a NULL publication rather than inventing a revision, a
    // published-at or a parser version for a week the book never published.
    assert.match(WEEKLY_ROUTE, /closingPublication === null\s*\n?\s*\? null/)
    // And the WEEKLY basis is still resolved from a publication alone — a
    // row-history closing endpoint can only ever be a period endpoint.
    assert.match(WEEKLY_ROUTE, /selectWeekPair\(spine\.publications/)
    assert.match(WEEKLY_ROUTE, /mode === 'weekly' &&\s*\n?\s*hasSourceWeeklyBasis/)
  })

  test('FOLLOW-UP E — the eligible set is stated once, and refuses rather than substitutes', () => {
    // THE RULE: a date is an eligible Compare endpoint when the scope has a
    // complete source-backed row set at it — a current publication, or a frozen
    // reporting date in row history.
    assert.match(
      WEEKLY_ROUTE,
      /const compareDates = \[\s*\n?\s*\.\.\.new Set\(\[\.\.\.publicationByDate\.keys\(\), \.\.\.rowHistoryDates\]\),\s*\n?\s*\]\.sort\(\)/,
    )
    // Both endpoints are checked against it, and a date outside it is refused
    // by name — never snapped to a nearest one.
    for (const code of ['from_not_found', 'week_not_found', 'from_not_before_to']) {
      assert.ok(WEEKLY_ROUTE.includes(`'${code}'`), `the route must refuse with ${code}`)
    }
    // Comments STRIPPED: the route says "never a nearest-date guess" in prose,
    // which is the opposite of the defect and must not trip its own guard.
    const routeCode = WEEKLY_ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    assert.ok(!/nearest|closest/i.test(routeCode), 'no nearest-date substitution anywhere')
  })

  test('the response labels a row-history opening as such', () => {
    assert.match(WEEKLY_ROUTE, /openingSource = 'row_history'/)
    assert.match(WEEKLY_ROUTE, /openingSource = 'publication'/)
    assert.match(WEEKLY_ROUTE, /openingSource = 'source_previous_week'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// X–Z · The previousWeekDate write-path defect
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · X — a restated week carries ITS OWN previous-week date', () => {
  test('the payload carries the restated column’s own anchors', () => {
    assert.match(PREVIEW_SERVER, /previous_week_date: workbookPayload\.previousWeekDate/)
    assert.match(PREVIEW_SERVER, /beginning_of_year_date: workbookPayload\.beginningOfYearDate/)
    // Captured at the only place they exist: the parse of that column.
    assert.match(PREVIEW_LIB, /previousWeekDate: draft\.previousWeekDate/)
    assert.match(PREVIEW_LIB, /beginningOfYearDate: draft\.beginningOfYearDate/)
  })

  test('the RPC STRIPS the import’s anchors before publishing a restated week', () => {
    // This is the defect, precisely: the import's own metadata carried
    // `previousWeekDate = 2026-08-28`, and it was stamped onto every week the
    // import restated — including 2026-06-19.
    const restatement = MIGRATION.slice(
      MIGRATION.indexOf('v_hist_pub := public.nmi_publish_portfolio('),
      MIGRATION.indexOf('insert into public.portfolio_import_publication_corrections'),
    )
    assert.ok(restatement.includes("- 'previousWeekDate') - 'beginningOfYearDate'"))
    assert.ok(restatement.includes("'previousWeekDate', to_jsonb(h.previous_week_date)"))
    assert.ok(restatement.includes("'beginningOfYearDate', to_jsonb(h.beginning_of_year_date)"))
  })

  test('a missing anchor stays NULL — never a neighbour’s date', () => {
    // `to_jsonb(null::date)` is JSON null. Nothing coalesces it to the import's.
    const restatement = MIGRATION.slice(
      MIGRATION.indexOf('v_hist_pub := public.nmi_publish_portfolio('),
      MIGRATION.indexOf('insert into public.portfolio_import_publication_corrections'),
    )
    assert.ok(!/coalesce\(h\.previous_week_date/.test(restatement))
  })
})

describe('follow-up C · Y — an impossible anchor is refused at the write', () => {
  test('a restatement whose anchor is not before its week is refused', () => {
    // 2026-07-03 can never record a previous week of 2026-08-28.
    assert.match(
      MIGRATION,
      /where x\.previous_week_date is not null and x\.previous_week_date >= x\.as_of_date[\s\S]*?raise exception 'import_refused_impossible_previous_week_date'/,
    )
  })

  test('the CURRENT publication is held to the same rule', () => {
    assert.match(
      MIGRATION,
      /if v_anchor is not null and v_anchor >= p_as_of_date then\s*\n\s*raise exception 'import_refused_impossible_previous_week_date'/,
    )
  })
})

describe('follow-up C · Z — the read-layer guard is preserved', () => {
  test('an impossible recorded anchor is still dropped on the way out', () => {
    // The seven Production rows written before this fix still carry
    // `previousWeekDate = 2026-08-28`. The read guard is what keeps that off
    // every surface until the metadata repair is authorized separately.
    assert.match(READ_REPO, /function anchorBefore\(candidate: string \| null, asOfDate: string\)/)
    assert.match(READ_REPO, /return candidate < asOfDate \? candidate : null/)
    assert.match(READ_REPO, /previousWeekDate: anchorBefore\(spineDate\(p\.metadata, 'previousWeekDate'\), p\.as_of_date\)/)
    assert.match(READ_REPO, /beginningOfYearDate: anchorBefore\(/)
  })

  test('the weekly basis still refuses an impossible anchor at the route', () => {
    assert.match(
      WEEKLY_ROUTE,
      /hasSourceWeeklyBasis\(closingRowSet, closingPublication\.previousWeekDate, closingPublication\.asOfDate\)/,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Architecture and hygiene
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up C · the locked R13.8 architecture is preserved', () => {
  test('no catch-up week gains a publication', () => {
    // ONE upload -> ONE import operation -> N evolution points -> ONE newest
    // full publication -> N row-history dates. Row history adds the fourth
    // clause and changes none of the first three.
    assert.ok(!/nmi_publish_portfolio/.test(ROW_HISTORY_LIB))
    // The planner mints nothing publication-shaped: no revision, no
    // `is_current`, no supersession pointer.
    for (const forbidden of ['revision', 'isCurrent', 'is_current', 'supersededBy']) {
      assert.ok(!ROW_HISTORY_LIB.includes(forbidden), `rowHistory.ts must not mention ${forbidden}`)
    }
    const rpc = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.nmi_import_portfolio_workbook'),
      MIGRATION.indexOf('create or replace function public.nmi_rollback_portfolio_import'),
    )
    // Exactly two publish calls: the current week, and each restated week.
    assert.equal((rpc.match(/nmi_publish_portfolio\(/g) ?? []).length, 2)
  })

  test('the row-history planner performs no writes and reads no database', () => {
    for (const forbidden of ['getSupabaseAdminClient', 'getSupabaseUserClient', '.rpc(', '.insert(', '.upsert(']) {
      assert.ok(!ROW_HISTORY_LIB.includes(forbidden), `rowHistory.ts must not contain ${forbidden}`)
    }
  })

  test('the applied migration is NOT edited in place', () => {
    const prior = read(PRIOR_MIGRATION_PATH)
    // The 14-argument function is still declared there, unchanged, and the new
    // migration replaces it in place rather than editing the applied file.
    assert.match(prior, /create or replace function public\.nmi_import_portfolio_workbook\(/)
    assert.ok(!prior.includes('portfolio_row_history'))
  })

  test('the new migration is the next free identifier', () => {
    assert.match(MIGRATION, /R13\.8E/)
    // And it refuses to run against a book that has not had 20260821 applied.
    assert.match(MIGRATION, /portfolio_import_operations is missing -- apply 20260821000000 first/)
  })

  test('the staging relay is purged, and a failed import cleans up after itself', () => {
    assert.match(MIGRATION, /delete from public\.portfolio_row_history_staging\s*\n\s*where created_at < now\(\) - interval '1 day'/)
    assert.match(MIGRATION, /delete from public\.portfolio_row_history_staging where staging_id = v_staging/)
    assert.match(PUBLISH_ROUTE, /discardRowHistoryStaging\(rowHistoryStagingId\)/)
  })

  test('the stale-plan fingerprint covers the row history an administrator authorized', () => {
    assert.match(PREVIEW_LIB, /canonical\.push\(\s*`rowHistory\|/)
  })
})
