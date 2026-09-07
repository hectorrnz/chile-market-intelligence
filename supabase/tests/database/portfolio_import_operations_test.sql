-- R13.8B — EXECUTABLE validation of the atomic catch-up import and its rollback.
--
-- WHY THIS FILE EXISTS. The claim is "one workbook upload produces one import
-- operation, and either every history mutation AND the publication persist or
-- none of them do". That is a statement about real PostgreSQL transaction
-- behaviour. A TypeScript test can prove the PLANNER classifies correctly — and
-- `tests/portfolioWeeklyImportPlan.test.ts` does — but only a database can show
-- that a failure on the fourth of four inserts leaves the book byte-identical.
--
-- HOW THE ATOMICITY PROOF IS MADE NON-VACUOUS. The failing packet is ordered so
-- the failure comes LAST: three observations insert cleanly, an operation row
-- and a publication already exist, and only THEN does the fourth entry raise.
-- If the transaction were not atomic those three rows, the operation and the
-- publication would still be there afterwards. Every assertion after each
-- `throws_ok` re-reads the tables and proves they are not.
--
-- `throws_ok` runs its query inside a plpgsql exception block, which is a real
-- subtransaction: catching the error rolls back everything the function did,
-- exactly as a failed RPC call would. `lives_ok` is its counterpart — on success
-- nothing is rolled back, so the effects persist and later assertions can read
-- them.
--
-- NO psql META-COMMANDS. Setup that calls a function goes through a DO block so
-- it emits no rows into the TAP stream; every id is looked up by the upload that
-- produced it rather than captured into a variable.
--
-- All identities and values are throwaway rows created inside this transaction
-- and rolled back at the end. No production identity or portfolio value appears
-- anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — a Production book ending at 2026-07-31 with two holes
-- ═══════════════════════════════════════════════════════════════════════════

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'import_admin@test.invalid', 'x', now(), now(), now());

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal)
values ('d1111111-1111-1111-1111-111111111111', 'import_admin', 'import_admin@test.invalid',
        'Import Admin', 'administrator', null);

update public.user_profiles set activated_at = now()
 where id = 'd1111111-1111-1111-1111-111111111111' and activated_at is null;

-- Four uploads: the baseline, the catch-up, a refusal probe, and a later import
-- used to prove a stale rollback is refused.
insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('dddd0001-0000-0000-0000-000000000001', 'portfolio', 'private/u1.xlsx', 'u1.xlsx',
   repeat('a', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0002-0000-0000-0000-000000000002', 'portfolio', 'private/u2.xlsx', 'u2.xlsx',
   repeat('b', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0003-0000-0000-0000-000000000003', 'portfolio', 'private/u3.xlsx', 'u3.xlsx',
   repeat('c', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0004-0000-0000-0000-000000000004', 'portfolio', 'private/u4.xlsx', 'u4.xlsx',
   repeat('d', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

-- Builders, so each packet below reads as intent rather than as JSON.
create or replace function pg_temp.obs(
  p_date text, p_disposition text, p_new numeric, p_prior numeric default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'scope', 'main', 'basis', 'ex_chilean_equities', 'series_identity', '',
    'observation_date', p_date, 'disposition', p_disposition,
    'new_value', p_new, 'new_status', 'stated',
    'prior_value', p_prior, 'prior_status', case when p_prior is null then null else 'stated' end,
    'source_sheet', 'RESUMEN', 'source_cell', 'XX10', 'source_row_label', 'TOTAL',
    'currency', 'USD', 'parser_version', 'test.parser.1', 'extractor_version', 'test.extractor.1');
$$;

create or replace function pg_temp.rows_payload(p_value numeric)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'scope', 'main', 'row_key', 'total', 'parent_row_key', null, 'depth', 0,
    'display_order', 1, 'row_type', 'portfolio_total', 'label_es', 'TOTAL',
    'label_en', 'TOTAL', 'currency', 'USD', 'value', p_value, 'value_class', 'source_value',
    'source_sheet', 'RESUMEN', 'source_cell', 'DA10'));
$$;

create or replace function pg_temp.op_id(p_upload text)
returns uuid
language sql
as $$
  select id from public.portfolio_import_operations where upload_id = p_upload::uuid;
$$;

-- The baseline publication, made the ordinary way.
do $$
begin
  perform public.nmi_publish_portfolio(
    'dddd0001-0000-0000-0000-000000000001'::uuid,
    '2026-07-31'::date,
    'd1111111-1111-1111-1111-111111111111'::uuid,
    'test.parser.1',
    pg_temp.rows_payload(100));
end $$;

-- Production history: 07-03, 07-10 and 07-31 exist; 07-17 and 07-24 are HOLES.
-- These rows carry NO `import_operation_id`, exactly like every row written by
-- the pre-R13.8B best-effort upsert.
insert into public.portfolio_evolution_observations
  (scope, basis, observation_date, value, currency, source_upload_id,
   source_sheet, source_cell, source_row_label, parser_version, extractor_version)
values
  ('main','ex_chilean_equities','2026-07-03', 11, 'USD', 'dddd0001-0000-0000-0000-000000000001',
   'RESUMEN','CT10','TOTAL','test.parser.1','test.extractor.1'),
  ('main','ex_chilean_equities','2026-07-10', 12, 'USD', 'dddd0001-0000-0000-0000-000000000001',
   'RESUMEN','CU10','TOTAL','test.parser.1','test.extractor.1'),
  ('main','ex_chilean_equities','2026-07-31', 13, 'USD', 'dddd0001-0000-0000-0000-000000000001',
   'RESUMEN','CZ10','TOTAL','test.parser.1','test.extractor.1');

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Schema and posture
-- ═══════════════════════════════════════════════════════════════════════════

select has_table('public', 'portfolio_import_operations', 'the import operation table exists');
select has_table('public', 'portfolio_import_observation_mutations', 'the before-image ledger exists');
select has_column('public', 'portfolio_evolution_observations', 'import_operation_id',
  'history rows carry forward lineage to the import that wrote them');
select has_column('public', 'portfolio_import_observation_mutations', 'prior_import_operation_id',
  'the ledger records which import previously owned an overwritten row');

select col_not_null('public', 'portfolio_evolution_observations', 'value',
  'the R13.R1 invariant is untouched: a gap is an absent row, never a null value');

select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('portfolio_import_operations','portfolio_import_observation_mutations')),
  0, 'neither new table has any RLS policy — both are service-role only');

select ok(
  not has_table_privilege('authenticated', 'public.portfolio_import_observation_mutations', 'SELECT'),
  'authenticated cannot read the before-image ledger, which carries portfolio values');
select ok(
  not has_function_privilege('authenticated',
    'public.nmi_import_portfolio_workbook(uuid,date,uuid,text,text,jsonb,jsonb,jsonb,boolean,text,jsonb,text,jsonb)',
    'EXECUTE'),
  'authenticated cannot execute the import RPC');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The catch-up: three NEW and two GAP_FILL, one publication
-- ═══════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0002-0000-0000-0000-000000000002'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(200),
      jsonb_build_array(
        pg_temp.obs('2026-07-17', 'gap_fill', 21),
        pg_temp.obs('2026-07-24', 'gap_fill', 22),
        pg_temp.obs('2026-08-07', 'new', 31),
        pg_temp.obs('2026-08-14', 'new', 32),
        pg_temp.obs('2026-08-21', 'new', 33)))$$,
  'a five-point catch-up imports in one call');

select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  8, 'all five insertions landed alongside the three pre-existing weeks');

select is(
  (select count(*)::int from public.portfolio_import_operations),
  1, 'ONE import operation, not one per reporting week');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  2, 'exactly two current publications: the untouched 07-31 week and the new 08-21 one');

select is(
  (select max(as_of_date) from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  '2026-08-21'::date,
  'the newest current publication is the newest valid frozen reporting date');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date in ('2026-08-07','2026-08-14')),
  0, 'no synthetic publication revision was minted for an intermediate week');

select is(
  (select count(*)::int from public.portfolio_import_observation_mutations),
  5, 'every mutation recorded a ledger entry');

select is(
  (select count(*)::int from public.portfolio_import_observation_mutations
    where disposition in ('new','gap_fill') and prior_status is null),
  5, 'every insertion recorded NO before-image, which is what marks it an insertion');

select is(
  (select count(*)::int from public.portfolio_evolution_observations
    where import_operation_id is not null),
  5, 'exactly the five inserted rows carry this import''s lineage');

select is(
  (select count(*)::int from public.portfolio_import_operations
    where correction_authorized = false and correction_reason is null),
  1, 'a five-week catch-up needed no correction authorization and no reason');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · Refusals — each proven to leave the book untouched
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a. An overwrite without authorization.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-08-28'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(300),
      jsonb_build_array(pg_temp.obs('2026-07-10', 'changed', 99, 12)))$$,
  'import_refused_historical_correction_required',
  'an overwrite without authorization is refused');

-- 3b. Authorized but with no reason — the CHECK and the RPC agree.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-08-28'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(300),
      jsonb_build_array(pg_temp.obs('2026-07-10', 'changed', 99, 12)),
      '[]'::jsonb, true, '   ')$$,
  'import_refused_historical_correction_required',
  'authorization without a non-empty reason is still refused');

-- 3c. A stale plan: an insertion for an identity that already exists.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-08-28'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(300),
      jsonb_build_array(pg_temp.obs('2026-07-10', 'new', 99)))$$,
  'import_refused_stale_plan_identity_exists',
  'an insertion over an existing identity is refused, never silently upserted');

-- 3d. A stale plan: the value moved since the administrator approved the diff.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-08-28'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(300),
      jsonb_build_array(pg_temp.obs('2026-07-10', 'changed', 99, 55)),
      '[]'::jsonb, true, 'restated')$$,
  'import_refused_stale_plan_value_moved',
  'an overwrite whose asserted before-image has moved is refused whole');

-- 3e. An `unavailable` state cannot be stored in a NOT NULL numeric column, so
--     it is refused loudly rather than coerced.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-08-28'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(300),
      jsonb_build_array(jsonb_build_object(
        'scope','main','basis','ex_chilean_equities','series_identity','',
        'observation_date','2026-08-28','disposition','new',
        'new_value', null, 'new_status','unavailable',
        'source_sheet','RESUMEN','source_cell','DB10','source_row_label','TOTAL',
        'currency','USD','parser_version','test.parser.1','extractor_version','test.extractor.1')))$$,
  'import_refused_unavailable_not_representable',
  'an unavailable state is refused rather than coerced into a numeric column');

-- 3f. THE LATE FAILURE — the non-vacuous atomicity proof. Three observations
--     insert, the operation row and the publication are already written, and
--     only then does the fourth entry raise.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-09-04'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(300),
      jsonb_build_array(
        pg_temp.obs('2026-08-28', 'new', 41),
        pg_temp.obs('2026-09-04', 'new', 42),
        pg_temp.obs('2026-09-11', 'new', 43),
        pg_temp.obs('2026-07-31', 'new', 44)))$$,
  'import_refused_stale_plan_identity_exists',
  'a packet whose LAST entry fails still raises');

select is(
  (select count(*)::int from public.portfolio_evolution_observations
    where observation_date in ('2026-08-28','2026-09-04','2026-09-11')),
  0, 'the three observations written BEFORE the failure did not persist');

select is(
  (select count(*)::int from public.portfolio_import_operations),
  1, 'no import operation row survived the failed packet');

select is(
  (select count(*)::int from public.portfolio_publications
    where as_of_date in ('2026-08-28','2026-09-04')),
  0, 'no publication survived the failed packet');

select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  8, 'the book is exactly as it was before every refusal above');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-07-10' and scope = 'main'),
  12::numeric, 'the value a refused correction targeted is unchanged');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Rollback of the catch-up
-- ═══════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd0002-0000-0000-0000-000000000002'),
      'd1111111-1111-1111-1111-111111111111'::uuid,
      'reverting the catch-up')$$,
  'the catch-up rolls back in one call');

select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  3, 'rollback removed all five insertions — the gap fills as well as the new weeks');

select is(
  (select count(*)::int from public.portfolio_publications
    where as_of_date = '2026-08-21' and is_current),
  0, 'the publication this import made current is no longer current');

select is(
  (select max(as_of_date) from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  '2026-07-31'::date,
  'the newest current publication is the one that preceded the import');

select is(
  (select count(*)::int from public.portfolio_publications where as_of_date = '2026-08-21'),
  1, 'NOTHING IS DELETED: the demoted publication row is retained');

select is(
  (select count(*)::int from public.portfolio_import_observation_mutations),
  5, 'the ledger is retained after rollback — the audit trail is permanent');

select isnt(
  (select rolled_back_at from public.portfolio_import_operations
    where upload_id = 'dddd0002-0000-0000-0000-000000000002'),
  null, 'the operation is stamped as rolled back');

select throws_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd0002-0000-0000-0000-000000000002'),
      'd1111111-1111-1111-1111-111111111111'::uuid, null)$$,
  'rollback_refused_already_rolled_back',
  'a second rollback of the same import is refused');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · Chained imports — a correction, its rollback, and lineage restoration
-- ═══════════════════════════════════════════════════════════════════════════

-- Import A inserts a week.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0003-0000-0000-0000-000000000003'::uuid, '2026-08-07'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(400),
      jsonb_build_array(pg_temp.obs('2026-08-07', 'new', 51)))$$,
  'import A inserts a week');

select is(
  (select value from public.portfolio_evolution_observations where observation_date = '2026-08-07'),
  51::numeric, 'import A inserted the week');

-- Import B overwrites it, with authorization and a reason.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0004-0000-0000-0000-000000000004'::uuid, '2026-08-14'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(500),
      jsonb_build_array(
        pg_temp.obs('2026-08-07', 'changed', 52, 51),
        pg_temp.obs('2026-08-14', 'new', 53)),
      '[]'::jsonb, true, 'Custodian restated 08-07.')$$,
  'import B overwrites A''s week and adds one of its own');

select is(
  (select value from public.portfolio_evolution_observations where observation_date = '2026-08-07'),
  52::numeric, 'import B overwrote the week');

select is(
  (select count(*)::int from public.portfolio_import_observation_mutations
    where disposition = 'changed' and prior_value = 51 and prior_import_operation_id is not null),
  1, 'the ledger recorded both the prior VALUE and the prior OWNING IMPORT');

-- Rolling back A while B stands is refused: reversing to A's before-image would
-- clobber B's work.
select throws_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd0003-0000-0000-0000-000000000003'),
      'd1111111-1111-1111-1111-111111111111'::uuid, null)$$,
  'rollback_refused_superseded_by_later_import',
  'a stale rollback is refused, not attempted');

-- Rolling back B restores A's value AND A's ownership...
select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd0004-0000-0000-0000-000000000004'),
      'd1111111-1111-1111-1111-111111111111'::uuid, null)$$,
  'import B rolls back');

select is(
  (select value from public.portfolio_evolution_observations where observation_date = '2026-08-07'),
  51::numeric, 'rolling back the overwrite restored the exact prior value');

select is(
  (select count(*)::int from public.portfolio_evolution_observations where observation_date = '2026-08-14'),
  0, 'rolling back the overwrite also removed the week that import inserted');

-- ...so rolling back A now succeeds, which it could not do if the lineage had
-- been left NULL. This is the whole reason `prior_import_operation_id` exists.
select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd0003-0000-0000-0000-000000000003'),
      'd1111111-1111-1111-1111-111111111111'::uuid, null)$$,
  'rollbacks chain: reversing B restored A''s ownership, so A can now be reversed');

select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  3, 'the book is back to its original three weeks');

select is(
  (select max(as_of_date) from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  '2026-07-31'::date, 'and back to its original current publication');

select * from finish();

rollback;
