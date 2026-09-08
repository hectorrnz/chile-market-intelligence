// R13.8B — structural guards on the import-operation migration.
//
// WHAT THIS SUITE IS, AND WHAT IT IS NOT
// ──────────────────────────────────────
// It is NOT a proof that the transaction is atomic. That claim is about real
// PostgreSQL behaviour and only a database can settle it — which is what
// `supabase/tests/database/portfolio_import_operations_test.sql` does, on a
// clean stack in CI.
//
// What this suite guards is everything a source scan CAN settle, and that is
// worth guarding because each item below is a silent failure if it regresses:
// a migration that stops being additive, a function that quietly becomes
// SECURITY DEFINER, a rollback that starts matching on a filename instead of
// the canonical identity, a grant that leaks the before-image ledger (which
// carries portfolio values) to `authenticated`, or an import that reimplements
// the publication ordering instead of delegating to the one function that has
// already been debugged into correctness.
//
// It also asserts that the executable suite exists and still covers the two
// cases that make it non-vacuous — a LATE failure and a chained rollback —
// because a pgTAP file that quietly loses those tests would keep passing.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MIGRATION = 'supabase/migrations/20260821000000_portfolio_import_operations.sql'
const PGTAP = 'supabase/tests/database/portfolio_import_operations_test.sql'
const WORKFLOW = '.github/workflows/r13-family-portfolio-db-validation.yml'

function read(rel: string): string {
  return readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
}

const sql = read(MIGRATION)
const pgtap = read(PGTAP)
const workflow = read(WORKFLOW)

/** The body of one `create or replace function`, up to the next one. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(start, -1, `${name} must exist in the migration`)
  const after = sql.indexOf('create or replace function public.', start + 10)
  return sql.slice(start, after === -1 ? undefined : after)
}

describe('the migration is additive and idempotent', () => {
  test('it drops no table, no column and no existing constraint', () => {
    const lowered = sql.toLowerCase()
    for (const forbidden of ['drop table', 'drop column', 'truncate ', 'alter column']) {
      assert.equal(lowered.includes(forbidden), false, `migration must not contain "${forbidden}"`)
    }
  })

  test('it never relaxes the R13.R1 not-null invariant on the history value', () => {
    // A nullable `value` would let a gap be stored as a row, which is exactly
    // the "unavailable is not zero" failure that table is shaped to prevent.
    assert.equal(sql.toLowerCase().includes('drop not null'), false)
    assert.match(sql, /portfolio_evolution_observations\.value must stay NOT NULL/)
  })

  test('it can be applied twice', () => {
    // R13.8B created two tables; R13.8D.1 added the publication-correction
    // ledger, which rollback needs in order to reverse a corrected historical
    // week. All three must be conditional so the migration stays re-runnable.
    assert.equal(
      (sql.match(/create table if not exists/g) ?? []).length,
      3,
      'all three tables are created conditionally',
    )
    assert.match(sql, /create table if not exists public\.portfolio_import_publication_corrections/)
    assert.match(sql, /add column if not exists import_operation_id/)
    for (const fn of [
      'nmi_lock_portfolio_import',
      'nmi_import_portfolio_workbook',
      'nmi_rollback_portfolio_import',
    ]) {
      assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`))
    }
  })

  test('it guards on the migrations it depends on', () => {
    assert.match(sql, /portfolio_publications is missing/)
    assert.match(sql, /portfolio_evolution_observations is missing/)
    assert.match(sql, /nmi_publish_portfolio is missing/)
  })

  test('it sorts after every migration already applied', () => {
    // A migration timestamped before an applied one is an out-of-order push.
    assert.ok('20260821000000' > '20260820000000')
  })
})

describe('the before-image model is what makes rollback exact', () => {
  test('an insertion records no prior state and an overwrite must record one', () => {
    assert.match(sql, /portfolio_import_observation_mutations_before_ck/)
    assert.match(
      sql,
      /disposition in \('new','gap_fill'\) and prior_status is null and prior_value is null/,
    )
    assert.match(sql, /disposition = 'changed' and prior_status is not null/)
  })

  test('the ledger records which import previously owned an overwritten row', () => {
    // Without this, rolling back import B would leave the row's lineage NULL and
    // a later rollback of import A would refuse, believing it had been moved on.
    assert.match(sql, /prior_import_operation_id uuid references public\.portfolio_import_operations/)
    assert.match(functionBody('nmi_rollback_portfolio_import'), /import_operation_id = m\.prior_import_operation_id/)
  })

  test('one import records at most one before-image per identity', () => {
    assert.match(
      sql,
      /unique \(import_operation_id, scope, basis, series_identity, observation_date\)/,
    )
  })

  test('status and value must agree in both images', () => {
    assert.match(sql, /new_status = 'stated' and new_value is not null/)
    assert.match(sql, /new_status = 'unavailable' and new_value is null/)
    assert.match(sql, /prior_status = 'stated' and prior_value is not null/)
  })

  test('an authorized correction cannot be recorded without a reason', () => {
    assert.match(sql, /portfolio_import_operations_reason_ck/)
    assert.match(sql, /length\(btrim\(correction_reason\)\) > 0/)
  })
})

describe('the import RPC', () => {
  const body = functionBody('nmi_import_portfolio_workbook')

  test('delegates the publication instead of reimplementing its ordering', () => {
    // The insert-non-current → fill → demote → promote sequence took a
    // production failure to get right. Duplicating it here would let the two
    // paths drift.
    assert.match(body, /v_pub_id := public\.nmi_publish_portfolio\(/)
    assert.equal(
      body.includes('insert into public.portfolio_publications'),
      false,
      'the import must not write publications directly',
    )
  })

  test('serialises the whole import, not one date at a time', () => {
    // The publication lock is keyed on ONE (kind, as_of_date); an import mutates
    // many dates, so a per-date lock would let two imports interleave.
    assert.match(body, /perform public\.nmi_lock_portfolio_import\('portfolio'\)/)
  })

  test('gates ONLY on an overwrite, never on how many weeks arrive', () => {
    assert.match(body, /where o\.disposition = 'changed'/)
    assert.match(body, /import_refused_historical_correction_required/)
    // Nothing in the gate counts weeks or compares a date to the endpoint.
    assert.equal(/jsonb_array_length\(p_observations\)\s*>\s*1/.test(body), false)
  })

  test('asserts its own pre-state and refuses a stale plan whole', () => {
    assert.match(body, /for update/)
    assert.match(body, /import_refused_stale_plan_identity_exists/)
    assert.match(body, /import_refused_stale_plan_identity_absent/)
    assert.match(body, /import_refused_stale_plan_value_moved/)
  })

  test('writes the before-image it READ, never the one the caller supplied', () => {
    assert.match(body, /The before-image is the state READ HERE/)
    assert.match(body, /then v_cur_value else null end/)
    // `m.prior_value` is used only to VERIFY, never to persist.
    const ledgerInsert = body.slice(body.indexOf('insert into public.portfolio_import_observation_mutations'))
    assert.equal(ledgerInsert.includes('m.prior_value'), false)
  })

  test('refuses an unavailable state rather than coercing it', () => {
    assert.match(body, /import_refused_unavailable_not_representable/)
  })

  test('captures the displaced publication BEFORE publishing demotes it', () => {
    const capture = body.indexOf('select id into v_prev_pub')
    const publish = body.indexOf('nmi_publish_portfolio(')
    assert.ok(capture !== -1 && publish !== -1)
    assert.ok(capture < publish, 'the predecessor must be read before it is demoted')
  })
})

describe('the rollback RPC', () => {
  const body = functionBody('nmi_rollback_portfolio_import')

  test('is driven by the ledger, never by a date or a filename', () => {
    assert.match(body, /from public\.portfolio_import_observation_mutations/)
    for (const forbidden of ['file_sha256', 'original_filename', 'storage_object_path']) {
      assert.equal(body.includes(forbidden), false, `rollback must not match on ${forbidden}`)
    }
  })

  test('refuses when a later import has already moved a row on', () => {
    assert.match(body, /rollback_refused_superseded_by_later_import/)
    assert.match(body, /o\.import_operation_id is distinct from p_import_id/)
  })

  test('refuses a second rollback of the same import', () => {
    assert.match(body, /rollback_refused_already_rolled_back/)
  })

  test('removes insertions and restores overwrites', () => {
    assert.match(body, /delete from public\.portfolio_evolution_observations/)
    assert.match(body, /set value = m\.prior_value/)
  })

  test('demotes before it promotes, and promotes nothing when there is no predecessor', () => {
    const demote = body.indexOf('set is_current = false')
    const promote = body.indexOf('set is_current = true')
    assert.ok(demote !== -1 && promote !== -1)
    assert.ok(demote < promote, 'the partial unique index tolerates zero current rows, never two')
    assert.match(body, /if v_op\.previous_publication_id is not null then/)
  })

  test('never deletes a publication', () => {
    assert.equal(body.includes('delete from public.portfolio_publications'), false)
  })
})

describe('posture', () => {
  test('neither function is SECURITY DEFINER, and both pin search_path', () => {
    for (const fn of ['nmi_import_portfolio_workbook', 'nmi_rollback_portfolio_import']) {
      const body = functionBody(fn)
      assert.equal(body.toLowerCase().includes('security definer'), false, `${fn} must be invoker`)
      assert.match(body, /set search_path = ''/)
    }
  })

  test('the new tables are service-role only', () => {
    assert.match(sql, /alter table public\.portfolio_import_operations enable row level security/)
    assert.match(
      sql,
      /alter table public\.portfolio_import_observation_mutations enable row level security/,
    )
    assert.match(sql, /revoke all privileges on table public\.portfolio_import_operations\s*\n\s*from public, anon, authenticated/)
    assert.equal(
      /grant (select|insert|update|delete)[\s\S]{0,120}to authenticated/.test(sql),
      false,
      'no privilege on the new tables may be granted to authenticated',
    )
  })

  test('EXECUTE is granted to service_role and revoked from everyone else', () => {
    assert.match(sql, /grant execute on function public\.nmi_import_portfolio_workbook/)
    assert.match(sql, /grant execute on function public\.nmi_rollback_portfolio_import/)
    assert.match(sql, /revoke all on function public\.nmi_import_portfolio_workbook/)
    assert.match(sql, /revoke all on function public\.nmi_rollback_portfolio_import/)
    assert.equal(/grant execute on function public\.nmi_(import|rollback)[\s\S]{0,200}to authenticated/.test(sql), false)
  })

  test('the migration carries postconditions that fail loudly', () => {
    assert.ok((sql.match(/raise exception/g) ?? []).length >= 12)
    assert.match(sql, /must be SECURITY INVOKER/)
    assert.match(sql, /does not take the import lock/)
    assert.match(sql, /rollback does not read the before-image ledger/)
  })
})

describe('the executable suite exists and stays non-vacuous', () => {
  test('the pgTAP file is present and self-rolling-back', () => {
    assert.match(pgtap, /^begin;/m)
    assert.match(pgtap, /^rollback;/m)
    assert.match(pgtap, /select no_plan\(\)/)
    assert.match(pgtap, /select \* from finish\(\)/)
  })

  test('it uses no psql meta-command', () => {
    // No suite under supabase/tests/database uses one, and a stray `\gset`
    // would emit non-TAP output into the stream the harness parses.
    const metaCommands = pgtap.match(/^\s*\\[a-z]/gim) ?? []
    assert.deepEqual(metaCommands, [])
    // Setup that calls a function goes through a DO block so it emits no rows.
    assert.match(pgtap, /do \$\$\s*\nbegin\s*\n\s*perform public\.nmi_publish_portfolio/)
  })

  test('it still covers the LATE failure — the atomicity proof', () => {
    assert.match(pgtap, /THE LATE FAILURE/)
    assert.match(pgtap, /the three observations written BEFORE the failure did not persist/)
    assert.match(pgtap, /no import operation row survived the failed packet/)
    assert.match(pgtap, /no publication survived the failed packet/)
  })

  test('it still covers the chained rollback', () => {
    assert.match(pgtap, /rollback_refused_superseded_by_later_import/)
    assert.match(pgtap, /rollbacks chain/)
    assert.match(pgtap, /prior_import_operation_id is not null/)
  })

  test('it proves one import mints no intermediate publication', () => {
    assert.match(pgtap, /no synthetic publication revision was minted for an intermediate week/)
    assert.match(pgtap, /ONE import operation, not one per reporting week/)
  })

  test('it uses no production identity or value', () => {
    assert.equal(/XS\d{10}/.test(pgtap), false, 'no real ISIN')
    assert.equal(pgtap.includes('@inevada.cl'), false, 'no real address')
    // Throwaway UUIDs are full of long digit runs and are not values, so they
    // are stripped before the amount check rather than exempted case by case.
    const withoutUuids = pgtap.replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, 'UUID')
    assert.deepEqual(
      withoutUuids.match(/\b\d{6,}\b/g) ?? [],
      [],
      'no six-digit-plus literal that could be a real amount',
    )
  })

  test('CI actually runs it on this branch family', () => {
    // The workflow discovers every file under supabase/tests/database, so the
    // only way this suite could silently never run is the branch trigger.
    assert.match(workflow, /- 'feat\/r13-8-\*\*'/)
    assert.match(workflow, /supabase\/tests\/database\/\*\.sql/)
  })
})
