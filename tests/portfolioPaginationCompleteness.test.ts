// POST-R13.8 FOLLOW-UP F — A SHORT SERVER RESPONSE IS NOT END OF TABLE.
//
// THE DEFECT. Two planner loaders asked PostgREST for 5,000-row pages and ended
// the walk the moment a page came back short. PostgREST caps a response at 1,000
// rows on this project, so the FIRST page was always short and the walk always
// ended after it. The planner therefore compared the workbook against 1,000 of
// 19,757 row-history identities and 1,000 of 2,260 performance-history
// identities. The other 18,757 and 1,260 read as ABSENT, and an identical
// re-upload of the authoritative workbook — which must be a no-op — proposed
// every one of them as a fresh insertion. A third loader did not page at all: it
// was whole only because the evolution table held 527 rows, and would have gone
// silently short the week the book crossed the cap.
//
// WHY NOT JUST ASK FOR 1,000. Because that is a coincidence, not a rule. The cap
// is a server setting; it moves with a `db-max-rows` change, a plan change, or a
// self-hosted instance, and every value the client could hard-code is a guess it
// cannot verify. Nothing here may depend on knowing the cap.
//
// THE INVARIANT. Termination is an EMPTY page, and the offset advances by rows
// RECEIVED. A capped page is then just a smaller page, and the walk resumes
// exactly where the server actually stopped.
//
// NON-VACUITY. §§ 3-5 below run the FIXED walk and a faithful replica of the OLD
// walk against the same fake PostgREST — one that honours `Range` and caps every
// response at 1,000, exactly as Production does. The old walk stops at 1,000. If
// the old rule were ever restored, § 3 and § 9 both fail.
//
// NO PRIVATE DATA. Every figure below is synthetic. The one authoritative
// workbook replay against real Production data is READ-ONLY and lives outside
// the suite, by design — a private workbook is never committed.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  readAllPages,
  DEFAULT_PAGE_SIZE,
  MAX_TOTAL_ROWS,
  type RangeableQuery,
} from '../src/lib/db/pagination.ts'
import {
  planRowHistory,
  type PersistedRowHistoryEntry,
} from '../src/lib/familyPortfolio/rowHistory.ts'
import {
  planPerformanceHistory,
  type PersistedPerformanceHistoryEntry,
} from '../src/lib/familyPortfolio/performanceHistory.ts'
import {
  planWeeklyImport,
  type SeriesObservation,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(HERE, '..', rel), 'utf8')

const PAGINATION = read('src/lib/db/pagination.ts')
const PUB_REPO = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
const READ_REPO = read('src/lib/db/repositories/familyPortfolioReadRepository.ts')

// ═══════════════════════════════════════════════════════════════════════════
// A fake PostgREST that behaves like the real one: it honours `Range` and it
// caps every response at `cap` rows, whatever the client asked for.
// ═══════════════════════════════════════════════════════════════════════════

interface FakeServer<T> {
  query: () => RangeableQuery<T>
  requests: Array<{ from: number; to: number; returned: number }>
}

function fakeServer<T>(rows: readonly T[], cap = 1000, failAt = -1): FakeServer<T> {
  const requests: Array<{ from: number; to: number; returned: number }> = []
  return {
    requests,
    query: () => ({
      range: async (from: number, to: number) => {
        if (requests.length === failAt) {
          requests.push({ from, to, returned: -1 })
          return { data: null, error: { message: 'connection_reset' } }
        }
        const asked = Math.max(0, to - from + 1)
        const slice = rows.slice(from, from + Math.min(asked, cap))
        requests.push({ from, to, returned: slice.length })
        return { data: slice as T[], error: null }
      },
    }),
  }
}

/**
 * A faithful replica of the loader as it stood BEFORE this fix, kept only so the
 * fake above can be proven non-vacuous. It is the exact rule the repository no
 * longer contains: ask for `pageSize`, stop as soon as a page is short.
 */
async function legacyWalk<T>(server: FakeServer<T>, pageSize: number): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; ; page += 1) {
    const from = page * pageSize
    const { data } = await server.query().range(from, from + pageSize - 1)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < pageSize) break
  }
  return out
}

const seq = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · The helper's own contract
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 1 — the paginator states the invariant', () => {
  test('the module says a short response is not end of table', () => {
    assert.match(PAGINATION, /A SHORT SERVER RESPONSE IS NOT END OF TABLE/)
  })

  test('it terminates on an EMPTY page, never on a short one', () => {
    assert.match(PAGINATION, /if \(batch\.length === 0\) return \{ ok: true, rows, pages \}/)
    assert.ok(
      !/batch\.length < pageSize/.test(PAGINATION),
      'the discredited rule must not reappear, not even as a second condition',
    )
  })

  test('the offset advances by rows RECEIVED, not by the page size requested', () => {
    assert.match(PAGINATION, /from \+= batch\.length/)
    assert.ok(!/from \+= pageSize/.test(PAGINATION))
  })

  test('a read error is a failure, never a short list', async () => {
    const server = fakeServer(seq(2_500), 1000, 1)
    const result = await readAllPages(server.query)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'connection_reset')
  })

  test('an unresponsive range is a LOUD refusal, never an unbounded loop', async () => {
    // A server that ignored `range` would never send an empty page. The ceiling
    // makes that a failure — and a failure can never be mistaken for data.
    const stuck: RangeableQuery<{ i: number }> = {
      range: async () => ({ data: seq(10), error: null }),
    }
    const result = await readAllPages(() => stuck, { maxRows: 100 })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'paged_read_exceeded_max_rows')
  })

  test('the defaults are the observed cap and a ceiling far above the book', () => {
    assert.equal(DEFAULT_PAGE_SIZE, 1000)
    assert.ok(MAX_TOTAL_ROWS > 19_757 * 10)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 2 · The fake is faithful: it caps exactly as Production does
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 2 — the fake server caps like PostgREST', () => {
  test('a 5,000-row request comes back with 1,000 rows', async () => {
    const server = fakeServer(seq(19_757))
    const { data } = await server.query().range(0, 4999)
    assert.equal((data ?? []).length, 1000)
  })

  test('a request past the end comes back empty', async () => {
    const server = fakeServer(seq(500))
    const { data } = await server.query().range(500, 1499)
    assert.equal((data ?? []).length, 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 3 · THE REGRESSION TEST — old walk vs fixed walk, same server
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 3 — a server cap is not an ending', () => {
  test('the OLD walk stops after exactly 1,000 of 19,757 rows', async () => {
    const server = fakeServer(seq(19_757))
    const rows = await legacyWalk(server, 5000)
    assert.equal(rows.length, 1000, 'this is the defect, reproduced')
    assert.equal(server.requests.length, 1, 'and it stopped after ONE request')
  })

  test('the FIXED walk reads all 19,757, asking for the same 5,000-row pages', async () => {
    const server = fakeServer(seq(19_757))
    const result = await readAllPages(server.query, { pageSize: 5000 })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.rows.length, 19_757)
    // Every request asked for 5,000 and the server never gave more than 1,000 —
    // so completeness cannot have come from the page size matching the cap.
    assert.ok(server.requests.every((r) => r.to - r.from + 1 === 5000))
    assert.ok(server.requests.every((r) => r.returned <= 1000))
  })

  test('the fixed walk resumes where the server actually stopped', async () => {
    const server = fakeServer(seq(2_500))
    await readAllPages(server.query, { pageSize: 5000 })
    assert.deepEqual(
      server.requests.map((r) => r.from),
      [0, 1000, 2000, 2500],
    )
  })

  test('completeness holds for any cap, including one nobody guessed', async () => {
    for (const cap of [1, 7, 250, 999, 1000, 1001, 5000]) {
      const server = fakeServer(seq(3_333), cap)
      const result = await readAllPages(server.query, { pageSize: 5000 })
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.rows.length, 3_333, `cap ${cap}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · Boundary cardinalities
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 4 — every boundary reads whole, once', () => {
  const SIZES = [0, 1, 999, 1000, 1001, 1999, 2000, 2001, 19_757]

  for (const size of SIZES) {
    test(`${size} rows: all present, none duplicated, none skipped`, async () => {
      const server = fakeServer(seq(size))
      const result = await readAllPages(server.query)
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.rows.length, size)
      const ids = new Set(result.rows.map((r) => r.i))
      assert.equal(ids.size, size, 'no duplicates')
      for (let i = 0; i < size; i += 1) assert.ok(ids.has(i), `row ${i} was skipped`)
    })
  }

  test('an exact multiple of the cap terminates on the empty page it costs', async () => {
    const server = fakeServer(seq(2000))
    const result = await readAllPages(server.query)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.pages, 3)
    assert.deepEqual(server.requests.map((r) => r.returned), [1000, 1000, 0])
  })

  test('a short final page is still not an ending — the empty one is', async () => {
    // 2,001 rows arrive as 1,000 + 1,000 + 1. The walk does NOT stop on that
    // final single row: a page of 1 is indistinguishable from a cap of 1, and
    // guessing costs whole tables. It asks once more and gets the empty page.
    const server = fakeServer(seq(2001))
    const result = await readAllPages(server.query)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.rows.length, 2001)
      assert.equal(result.pages, 4)
    }
    assert.deepEqual(server.requests.map((r) => r.returned), [1000, 1000, 1, 0])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 5 · Production-sized complete-read proofs
// ═══════════════════════════════════════════════════════════════════════════

const SCOPES = ['main', 'jaime', 'andres', 'pablo'] as const
const DATES = Array.from({ length: 107 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 7, 23) + i * 7 * 86_400_000)
  return d.toISOString().slice(0, 10)
})

/** 19,757 row-history identities, shaped like Production's. */
function productionRowHistory(): PersistedRowHistoryEntry[] {
  const out: PersistedRowHistoryEntry[] = []
  let n = 0
  for (const date of DATES) {
    for (const scope of SCOPES) {
      const width = scope === 'main' ? 66 : 40
      for (let k = 0; k < width && n < 19_757; k += 1) {
        out.push({
          scope,
          observationDate: date,
          rowKey: `row-${k}`,
          value: 1_000 + k,
          valueClass: 'source_value',
        })
        n += 1
      }
    }
  }
  return out
}

/**
 * 2,260 performance-history identities, shaped like Production's: 106 reporting
 * dates carrying five metrics for every scope, plus Main's second basis, which
 * only begins part-way through the book — 106 x 4 x 5 + 28 x 5.
 */
function productionPerformanceHistory(): PersistedPerformanceHistoryEntry[] {
  const out: PersistedPerformanceHistoryEntry[] = []
  const metrics = ['flow', 'weekly_profit', 'weekly_return', 'ytd_profit', 'ytd_return']
  const dates = DATES.slice(1)
  const secondBasisFrom = dates.length - 28
  dates.forEach((date, i) => {
    for (const scope of SCOPES) {
      const bases =
        scope !== 'main'
          ? ['total']
          : i >= secondBasisFrom
            ? ['ex_chilean_equities', 'with_chilean_equities']
            : ['with_chilean_equities']
      for (const basis of bases) {
        for (const metric of metrics) {
          out.push({ scope, basis, metric, observationDate: date, value: 5, valueClass: 'source_value' })
        }
      }
    }
  })
  return out
}

/** 527 evolution observations, and a variant past the cap. */
function evolutionRows(total: number) {
  const out: Array<{ scope: string; basis: string; observation_date: string; value: number }> = []
  let n = 0
  for (let week = 0; n < total; week += 1) {
    const date = new Date(Date.UTC(2024, 7, 23) + week * 7 * 86_400_000).toISOString().slice(0, 10)
    for (const scope of SCOPES) {
      for (const basis of scope === 'main' ? ['ex_chilean_equities', 'with_chilean_equities'] : ['total']) {
        if (n >= total) break
        out.push({ scope, basis, observation_date: date, value: 1_000 + n })
        n += 1
      }
    }
  }
  return out
}

describe('follow-up F · § 5 — the three planner loaders read whole', () => {
  test('row history: 19,757 expected, 19,757 read, 0 duplicated, 0 missing', async () => {
    const rows = productionRowHistory()
    assert.equal(rows.length, 19_757)
    const server = fakeServer(rows)
    const result = await readAllPages(server.query, { pageSize: 5000 })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.rows.length, 19_757)
    const ids = new Set(result.rows.map((r) => `${r.observationDate}|${r.scope}|${r.rowKey}`))
    assert.equal(ids.size, new Set(rows.map((r) => `${r.observationDate}|${r.scope}|${r.rowKey}`)).size)
    for (const r of rows) assert.ok(ids.has(`${r.observationDate}|${r.scope}|${r.rowKey}`))
  })

  test('performance history: 2,260 expected, 2,260 read, 0 duplicated, 0 missing', async () => {
    const rows = productionPerformanceHistory()
    assert.equal(rows.length, 2_260)
    const result = await readAllPages(fakeServer(rows).query, { pageSize: 5000 })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.rows.length, 2_260)
    const key = (r: PersistedPerformanceHistoryEntry) =>
      `${r.observationDate}|${r.scope}|${r.basis}|${r.metric}`
    const ids = new Set(result.rows.map(key))
    assert.equal(ids.size, 2_260, 'no duplicates')
    for (const r of rows) assert.ok(ids.has(key(r)))
  })

  test('evolution: 527 today reads whole — and so does a book past the cap', async () => {
    for (const total of [527, 1_000, 1_001, 4_212]) {
      const rows = evolutionRows(total)
      assert.equal(rows.length, total)
      const result = await readAllPages(fakeServer(rows).query)
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.rows.length, total, `evolution at ${total}`)
      const ids = new Set(result.rows.map((r) => `${r.observation_date}|${r.scope}|${r.basis}`))
      assert.equal(ids.size, total, `no duplicates at ${total}`)
    }
  })

  test('the OLD walk would have read 1,000 of each of the three', async () => {
    assert.equal((await legacyWalk(fakeServer(productionRowHistory()), 5000)).length, 1000)
    assert.equal((await legacyWalk(fakeServer(productionPerformanceHistory()), 5000)).length, 1000)
    // The unpaged evolution read simply took one capped response.
    const { data } = await fakeServer(evolutionRows(4_212)).query().range(0, 999)
    assert.equal((data ?? []).length, 1000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 6 · The replay: a complete read makes an identical upload a no-op
// ═══════════════════════════════════════════════════════════════════════════
//
// The economic half and the analytical half, at Production scale, planned once
// against a TRUNCATED read and once against a COMPLETE one. Only the complete
// read produces the no-op the locked rules require of an identical re-upload.
// The authoritative workbook itself is replayed READ-ONLY against Production
// after deployment; it is private and is never committed here.

function workbookRows(): ReadonlyMap<string, ReturnType<typeof rowPayload>[]> {
  const byDate = new Map<string, ReturnType<typeof rowPayload>[]>()
  for (const r of productionRowHistory()) {
    const list = byDate.get(r.observationDate) ?? []
    list.push(rowPayload(r.scope, r.rowKey, r.value))
    byDate.set(r.observationDate, list)
  }
  return byDate
}

function rowPayload(scope: string, rowKey: string, value: number | null) {
  return {
    scope,
    row_key: rowKey,
    parent_row_key: null,
    depth: 0,
    display_order: 0,
    row_type: 'holding',
    label_es: rowKey,
    label_en: null,
    currency: 'USD',
    value,
    value_class: value === null ? 'unavailable' : 'source_value',
    source_sheet: 'RESUMEN',
    source_cell: 'A1',
    metadata: {},
  }
}

function workbookPerformance(): ReadonlyMap<string, ReturnType<typeof perfPayload>[]> {
  const byDate = new Map<string, ReturnType<typeof perfPayload>[]>()
  for (const r of productionPerformanceHistory()) {
    const list = byDate.get(r.observationDate) ?? []
    list.push(perfPayload(r.scope, r.basis, r.metric, r.value))
    byDate.set(r.observationDate, list)
  }
  return byDate
}

function perfPayload(scope: string, basis: string, metric: string, value: number | null) {
  return {
    scope,
    basis,
    metric,
    value,
    value_class: value === null ? 'unavailable' : 'source_value',
    source_sheet: 'RESUMEN',
    source_cell: 'A1',
    metadata: {},
  }
}

describe('follow-up F · § 6 — identical replay is a no-op, and only with a complete read', () => {
  test('the economic half proposes nothing', () => {
    const observations: SeriesObservation[] = DATES.map((d) => ({
      scope: 'main',
      basis: 'with_chilean_equities',
      observationDate: d,
      value: 1_000,
      status: 'stated',
    }))
    const plan = planWeeklyImport({
      workbookObservations: observations,
      publishedObservations: observations,
      latestPublishedAsOf: DATES[DATES.length - 1],
    })
    assert.equal(plan.newDates.length, 0)
    assert.equal(plan.gapFillDates.length, 0)
    assert.equal(plan.changedDates.length, 0)
    assert.equal(plan.unchangedDates.length, DATES.length)
    assert.equal(plan.corrections.length, 0)
    assert.equal(plan.observationsToWrite.length, 0)
    assert.equal(plan.requiresHistoricalCorrection, false)
  })

  test('row history: complete read → nothing new, nothing staged', async () => {
    const persisted = await readAllPages(fakeServer(productionRowHistory()).query, { pageSize: 5000 })
    assert.equal(persisted.ok, true)
    if (!persisted.ok) return
    const plan = planRowHistory({
      workbook: workbookRows(),
      persisted: persisted.rows,
      parserVersion: 'test',
    })
    assert.deepEqual(plan.counts, { new: 0, gap_fill: 0, changed: 0, unchanged: 19_757 })
    assert.equal(plan.rows.length, 0)
  })

  test('performance history: complete read → nothing new, nothing staged', async () => {
    const persisted = await readAllPages(fakeServer(productionPerformanceHistory()).query, {
      pageSize: 5000,
    })
    assert.equal(persisted.ok, true)
    if (!persisted.ok) return
    const plan = planPerformanceHistory({
      workbook: workbookPerformance(),
      persisted: persisted.rows,
      parserVersion: 'test',
    })
    assert.deepEqual(plan.counts, { new: 0, gap_fill: 0, changed: 0, unchanged: 2_260 })
    assert.equal(plan.rows.length, 0)
  })

  test('the TRUNCATED read is what proposed 18,757 and 1,260 appends', async () => {
    const rowPlan = planRowHistory({
      workbook: workbookRows(),
      persisted: await legacyWalk(fakeServer(productionRowHistory()), 5000),
      parserVersion: 'test',
    })
    assert.equal(rowPlan.counts.new + rowPlan.counts.gap_fill, 18_757, 'the reported defect, exactly')

    const perfPlan = planPerformanceHistory({
      workbook: workbookPerformance(),
      persisted: await legacyWalk(fakeServer(productionPerformanceHistory()), 5000),
      parserVersion: 'test',
    })
    assert.equal(perfPlan.counts.new + perfPlan.counts.gap_fill, 1_260, 'the reported defect, exactly')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 7 · Nothing valid is narrowed
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 7 — absence still classifies as work to do', () => {
  test('EMPTY analytical history still plans the whole backfill', () => {
    // The behaviour that let the R13.8 backfill run at all. Completing the read
    // must never turn "the table is empty" into "there is nothing to do".
    const rowPlan = planRowHistory({ workbook: workbookRows(), persisted: [], parserVersion: 'test' })
    assert.equal(rowPlan.counts.new + rowPlan.counts.gap_fill, 19_757)
    assert.equal(rowPlan.counts.unchanged, 0)
    assert.equal(rowPlan.rows.length, 19_757)

    const perfPlan = planPerformanceHistory({
      workbook: workbookPerformance(),
      persisted: [],
      parserVersion: 'test',
    })
    assert.equal(perfPlan.counts.new + perfPlan.counts.gap_fill, 2_260)
    assert.equal(perfPlan.rows.length, 2_260)
  })

  test('a GENUINELY partial history classifies exactly what is missing', () => {
    // The first 1,000 identities exist and the rest do not — the shape the bug
    // faked. With a complete read the planner now sees the truth: 1,000
    // unchanged and 18,757 to write, decided by the data, not by the paging.
    const all = productionRowHistory()
    const plan = planRowHistory({
      workbook: workbookRows(),
      persisted: all.slice(0, 1000),
      parserVersion: 'test',
    })
    assert.equal(plan.counts.unchanged, 1000)
    assert.equal(plan.counts.new + plan.counts.gap_fill, 18_757)
    assert.equal(plan.counts.changed, 0)
  })

  test('a real CHANGE is still a change, not an append', () => {
    const all = productionRowHistory()
    const moved = all.map((r, i) => (i === 5 ? { ...r, value: (r.value ?? 0) + 1 } : r))
    const plan = planRowHistory({ workbook: workbookRows(), persisted: moved, parserVersion: 'test' })
    assert.equal(plan.counts.changed, 1)
    assert.equal(plan.counts.new, 0)
    assert.equal(plan.counts.gap_fill, 0)
    assert.equal(plan.counts.unchanged, 19_756)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 8 · Deterministic ordering — the caller's half of the contract
// ═══════════════════════════════════════════════════════════════════════════
//
// Offset paging over a non-total order lets tied rows reorder between requests,
// so a row can land on two pages or on none — and a row on none reads as ABSENT,
// the same fabrication by another route. Every paged read declares a tuple that
// uniquely identifies a row.

describe('follow-up F · § 8 — every paged read orders by a total key', () => {
  const ordersIn = (src: string, marker: string, end: string) => {
    const fn = src.slice(src.indexOf(marker), src.indexOf(end, src.indexOf(marker)))
    return [...fn.matchAll(/\.order\('([a-z_]+)'/g)].map((m) => m[1])
  }

  test('row history orders by its whole unique key', () => {
    assert.deepEqual(
      ordersIn(PUB_REPO, 'export async function listPersistedRowHistory', 'export interface RowHistoryStagedRow'),
      ['observation_date', 'scope', 'row_key'],
    )
  })

  test('performance history orders by its whole unique key', () => {
    assert.deepEqual(
      ordersIn(
        PUB_REPO,
        'export async function listPersistedPerformanceHistory',
        'export interface PerformanceHistoryStagedRow',
      ),
      ['observation_date', 'scope', 'basis', 'metric'],
    )
  })

  test('evolution orders by its whole unique key', () => {
    assert.deepEqual(
      ordersIn(
        PUB_REPO,
        'export async function listPersistedEvolutionObservations',
        'The MATERIAL payload of the publication',
      ),
      ['observation_date', 'scope', 'basis'],
    )
  })

  test('a publication listing breaks the published_at tie it really has', () => {
    // One import published eight weeks in ONE transaction during the R13.8
    // restoration, so `published_at` alone is emphatically not a total order.
    const fn = PUB_REPO.slice(
      PUB_REPO.indexOf('export async function listPublications'),
      PUB_REPO.indexOf('Records the administrator’s confirmed date'),
    )
    assert.match(fn, /\.order\('published_at'/)
    assert.match(fn, /\.order\('id'/)
  })

  test('the member reads that page declare a tiebreaker too', () => {
    for (const [marker, tie] of [
      ['export async function getPerformanceBindings', "\\.order\\('metric'"],
      ['export async function getPerformanceMetricSeries', "\\.order\\('basis'"],
      ['export async function getSnapshotValuesByKeys', "\\.order\\('row_key'"],
      ['export async function getEvolutionObservations', "\\.order\\('basis'"],
      ['export async function getPerformanceHistoryRange', "\\.order\\('metric'"],
      ['export async function getAlternativesEvents', "\\.order\\('id'"],
    ] as const) {
      const start = READ_REPO.indexOf(marker)
      assert.ok(start > -1, marker)
      const fn = READ_REPO.slice(start, start + 2200)
      assert.match(fn, /readAllPages\(/, marker)
      assert.match(fn, new RegExp(tie), marker)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 9 · The discredited rule is gone, everywhere
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 9 — no reader terminates on a short page', () => {
  test('neither repository contains a short-page EOF rule', () => {
    for (const [name, src] of [
      ['portfolioPublicationRepository', PUB_REPO],
      ['familyPortfolioReadRepository', READ_REPO],
    ] as const) {
      assert.ok(!/\.length < [A-Za-z_]*PAGE/.test(src), name)
      assert.ok(!/batch\.length < /.test(src), name)
    }
  })

  test('no 5,000-row page size survives in either repository', () => {
    assert.ok(!/_PAGE = 5000/.test(PUB_REPO))
    assert.ok(!/_PAGE = 5000/.test(READ_REPO))
  })

  test('the three planner loaders all go through the one helper', () => {
    for (const fn of [
      'listPersistedRowHistory',
      'listPersistedPerformanceHistory',
      'listPersistedEvolutionObservations',
    ]) {
      const start = PUB_REPO.indexOf(`export async function ${fn}`)
      assert.ok(start > -1, fn)
      assert.match(PUB_REPO.slice(start, start + 1600), /readAllPages\(/, fn)
    }
  })

  test('a capped single-publication payload is refused, not silently shortened', () => {
    // That read is bounded by the book's STRUCTURE (~197 rows) rather than its
    // history, so it does not page — but a capped answer there would read as a
    // page full of removed rows and manufacture a restatement. It refuses.
    const fn = PUB_REPO.slice(
      PUB_REPO.indexOf('export async function getStandingPublicationPayload'),
      PUB_REPO.indexOf('The ONE mapping from a stored snapshot row'),
    )
    assert.match(fn, /publication_payload_truncated/)
    assert.match(PUB_REPO, /const TRUNCATION_GUARD = 1000/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 10 · Nothing about the locked import rules moved
// ═══════════════════════════════════════════════════════════════════════════

describe('follow-up F · § 10 — retrieval completeness only', () => {
  test('the classification vocabulary is untouched', () => {
    const src = read('src/lib/familyPortfolio/rowHistory.ts')
    assert.match(src, /'new'/)
    assert.match(src, /'gap_fill'/)
    assert.match(src, /'changed'/)
  })

  test('the paginator is a transport concern with no dependencies', () => {
    // It may EXPLAIN the portfolio guards it relies on — that reasoning is the
    // point — but it must not import or query anything: a table name or a domain
    // import here would make one book's shape a property of every read.
    assert.ok(!/^import /m.test(PAGINATION), 'it depends on nothing')
    assert.ok(!/\.from\(/.test(PAGINATION), 'it names no table')
  })

  test('no read was converted into a write', () => {
    for (const src of [PAGINATION]) {
      assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(src))
    }
  })
})
