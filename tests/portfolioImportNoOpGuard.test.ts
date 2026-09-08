// R13.8C.1 — a no-op import is refused by the SERVER and by the DATABASE.
//
// WHAT THIS FILE PROVES. R13.8C made the console disable Apply for a NO_CHANGES
// preview. A disabled button is a courtesy, not an invariant: the publish route
// can be called directly, and the RPC can be called directly by anything holding
// service_role. Before this change an import carrying no NEW week, no GAP FILL
// and no CHANGED value would have been accepted — minting a publication revision
// and an import operation row that recorded no change to the book, and handing a
// rollback handle to an import that had moved nothing.
//
// The invariant is now stated three times, at three layers, on the SAME
// condition — the packet mutates nothing:
//   · the console never offers an enabled Apply (R13.8C, re-asserted here);
//   · the publish route refuses before it enters any write path;
//   · `nmi_import_portfolio_workbook` refuses before it inserts its operation
//     row or calls `nmi_publish_portfolio`, so a refusal writes nothing at all.
//
// The database half is proven EXECUTABLY in
// `supabase/tests/database/portfolio_import_operations_test.sql` § 6, against
// real PostgreSQL — a source scan cannot show that a refusal left five tables
// untouched. This file proves the planner's own no-op condition, the placement
// of each guard, and that the three layers agree about what a no-op is.
//
// NOTHING VALID IS NARROWED. NEW-only, GAP_FILL-only, authorized CHANGED-only
// and every combination of them still import; that half is asserted here on the
// planner and executably in § 6d-6f of the SQL suite.
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
import { isNoOp } from '../src/lib/familyPortfolio/importPlanPresentation.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strips comments so a prose mention never satisfies a code assertion. */
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MIGRATION = 'supabase/migrations/20260821000000_portfolio_import_operations.sql'
const DB_TEST = 'supabase/tests/database/portfolio_import_operations_test.sql'
const PUBLISH_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts'
const PAGE = 'src/app/portfolio/admin/page.tsx'

const migration = read(MIGRATION)
const dbTest = read(DB_TEST)
const route = read(PUBLISH_ROUTE)
const page = read(PAGE)

/** The body of the import RPC, so a match cannot come from the rollback function. */
const importFn = (() => {
  const start = migration.indexOf('create or replace function public.nmi_import_portfolio_workbook')
  assert.ok(start >= 0, 'the import RPC must exist')
  const end = migration.indexOf('create or replace function public.nmi_rollback_portfolio_import', start)
  assert.ok(end > start, 'the rollback RPC must follow it')
  return migration.slice(start, end)
})()

const obs = (date: string, value: number): SeriesObservation => ({
  scope: 'main',
  basis: 'ex_chilean_equities',
  observationDate: date,
  value,
})

const PUBLISHED: SeriesObservation[] = [obs('2026-07-17', 11), obs('2026-07-24', 12), obs('2026-07-31', 13)]

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The planner's own definition of a no-op
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.1 · what a no-op is', () => {
  test('a workbook already reflected in history writes nothing and is not blocked', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED,
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
    })
    assert.equal(plan.action, 'nothing_to_append')
    assert.equal(plan.observationsToWrite.length, 0)
    assert.deepEqual([plan.newDates, plan.gapFillDates, plan.changedDates], [[], [], []])
    assert.equal(plan.unchangedDates.length, 3)
    // Not blocked: nothing is WRONG with it. It simply has nothing to apply, and
    // the three layers refuse it on that ground rather than as a validation
    // failure — a distinction the administrator's message depends on.
    assert.equal(plan.blocked, false)
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(isNoOp(plan), true)
  })

  test('an empty packet is exactly the condition the console calls NO_CHANGES', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED,
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
    })
    // The route refuses on `observationsToWrite.length === 0` and the console
    // disables on `isNoOp`. If those could ever disagree, one layer would offer
    // what another refuses.
    assert.equal(isNoOp(plan), plan.observationsToWrite.length === 0)
  })

  test('a workbook with nothing in it at all is a no-op, not a silent success', () => {
    const plan = planWeeklyImport({
      workbookObservations: [],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
    })
    assert.equal(plan.observationsToWrite.length, 0)
    assert.equal(isNoOp(plan), true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Every valid import still applies — the guard narrows nothing
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.1 · valid imports are untouched', () => {
  test('NEW only', () => {
    const plan = planWeeklyImport({
      workbookObservations: [...PUBLISHED, obs('2026-08-07', 14)],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
    })
    assert.equal(plan.observationsToWrite.length, 1)
    assert.equal(plan.observationsToWrite[0].disposition, 'new')
    assert.equal(isNoOp(plan), false)
    assert.equal(plan.blocked, false)
  })

  test('GAP_FILL only — an insertion, needing no authorization', () => {
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-07-10', 10), ...PUBLISHED],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
    })
    assert.equal(plan.observationsToWrite.length, 1)
    assert.equal(plan.observationsToWrite[0].disposition, 'gap_fill')
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.equal(plan.blocked, false)
    assert.equal(isNoOp(plan), false)
  })

  test('authorized CHANGED only', () => {
    const plan = planWeeklyImport({
      workbookObservations: [obs('2026-07-17', 11), obs('2026-07-24', 99), obs('2026-07-31', 13)],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian restated the week.',
    })
    assert.equal(plan.observationsToWrite.length, 1)
    assert.equal(plan.observationsToWrite[0].disposition, 'changed')
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.equal(plan.blocked, false)
    assert.equal(isNoOp(plan), false)
  })

  test('a catch-up mixing all three still writes all three', () => {
    const plan = planWeeklyImport({
      workbookObservations: [
        obs('2026-07-10', 10), obs('2026-07-17', 11), obs('2026-07-24', 99),
        obs('2026-07-31', 13), obs('2026-08-07', 14),
      ],
      publishedObservations: PUBLISHED,
      latestPublishedAsOf: '2026-07-31',
      historicalCorrectionAuthorized: true,
      correctionReason: 'Custodian restated the week.',
    })
    assert.deepEqual(
      plan.observationsToWrite.map((o) => o.disposition).sort(),
      ['changed', 'gap_fill', 'new'],
    )
    assert.equal(isNoOp(plan), false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · The database guard
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.1 · the import RPC refuses a no-op', () => {
  test('it raises a stable, explicit code', () => {
    assert.match(importFn, /raise exception 'import_refused_nothing_to_append'/)
  })

  test('it counts the three MUTATING dispositions, not the packet length', () => {
    const guard = importFn.slice(
      importFn.indexOf('if not exists ('),
      importFn.indexOf("raise exception 'import_refused_nothing_to_append'"),
    )
    assert.match(guard, /disposition in \('new','gap_fill','changed'\)/)
    // A length test would accept a packet of a hundred unchanged weeks as a real
    // import, which is precisely the no-op this guard exists to refuse.
    assert.doesNotMatch(guard, /jsonb_array_length/)
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

  test('it runs under the import lock, like every other assertion in the packet', () => {
    const lockAt = importFn.indexOf('nmi_lock_portfolio_import')
    const guardAt = importFn.indexOf("raise exception 'import_refused_nothing_to_append'")
    assert.ok(lockAt > 0 && lockAt < guardAt)
  })

  test('the migration asserts its own guard, and asserts the ORDER', () => {
    // Without this the guard could be dropped in a later edit and every
    // structural check in the migration would still pass.
    assert.match(migration, /the import does not refuse a no-op packet/)
    assert.match(migration, /the no-op guard runs after the operation row is inserted/)
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
    // Atomicity, lineage and the before-image ledger are untouched.
    assert.match(importFn, /import_operation_id/)
    assert.match(importFn, /portfolio_import_observation_mutations/)
    assert.match(migration, /set search_path = ''/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The executable database proof exists and covers each required case
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.1 · the pgTAP suite proves it against real PostgreSQL', () => {
  test('an empty packet, a non-empty no-op packet, and a repeat are all refused', () => {
    const refusals = dbTest.split('import_refused_nothing_to_append').length - 1
    assert.ok(refusals >= 4, 'every no-op shape is exercised, including a repeat attempt')
    assert.match(dbTest, /an import with no new week, no gap fill and no correction is refused/)
    assert.match(dbTest, /a repeated no-op attempt is refused identically/)
    assert.match(dbTest, /an authorized no-op is still refused/)
  })

  test('and that the refusals wrote nothing — on every table the guard protects', () => {
    for (const claim of [
      'the refused no-ops mutated no history',
      'the refused no-ops minted no import operation row',
      'the refused no-ops minted no publication revision',
      'the refused no-ops wrote no before-image ledger entry',
    ]) {
      assert.ok(dbTest.includes(claim), `the SQL suite must assert: ${claim}`)
    }
  })

  test('each single valid disposition is proven to still import', () => {
    assert.match(dbTest, /a NEW-only import still applies/)
    assert.match(dbTest, /a GAP_FILL-only import still applies/)
    assert.match(dbTest, /an authorized CHANGED-only import still applies/)
  })

  test('the no-op section measures against an explicitly stated pre-state', () => {
    // A "nothing changed" assertion is worthless unless the starting counts were
    // pinned first; otherwise it can pass over a book that was already wrong.
    assert.ok(dbTest.includes('pre-state for the no-op cases'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The route guard
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.1 · the publish route refuses a no-op', () => {
  const code = codeOf(route)

  test('it refuses on the packet it would send, with a stable code', () => {
    assert.match(code, /plan\.observationsToWrite\.length === 0/)
    assert.match(code, /fail\('nothing_to_append', 409/)
  })

  test('it refuses BEFORE the import RPC is called', () => {
    const guardAt = code.indexOf("fail('nothing_to_append'")
    const rpcAt = code.indexOf('await importPortfolioWorkbook(')
    assert.ok(guardAt > 0 && rpcAt > guardAt, 'no write path may be entered for a no-op')
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

  test('the administrator gets a 409, not a server fault', () => {
    // A no-op is a conflict with the state of the book, the same class of answer
    // as a stale plan — not an error the administrator should report as a bug.
    const guard = code.slice(code.indexOf("fail('nothing_to_append'"))
    assert.match(guard.slice(0, 200), /409/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · The console, unchanged — and both codes are legible in both languages
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8C.1 · the console still never offers an enabled Apply', () => {
  test('the NO_CHANGES state disables the confirm control', () => {
    const code = codeOf(page)
    assert.match(code, /const nothingToApply = plan !== null && isNoOp\(plan\)/)
    assert.match(code, /disabled=\{[^}]*nothingToApply/)
    assert.match(code, /nothingToApply \? a\.nothingToApply : a\.publish/)
  })

  test('both refusal codes read as sentences, in English and Spanish', () => {
    for (const lang of ['en', 'es'] as const) {
      const refusals = dict[lang].fpAdmin.refusalImport as Record<string, string>
      for (const key of ['nothing_to_append', 'import_refused_nothing_to_append']) {
        assert.equal(typeof refusals[key], 'string', `${lang}.${key} must exist`)
        assert.ok(refusals[key].length > 20, `${lang}.${key} must explain, not echo the code`)
        assert.doesNotMatch(refusals[key], /_/, `${lang}.${key} must not surface a raw code`)
      }
    }
  })
})
