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

-- R13.8C.2 — the payload of the publication CURRENTLY STANDING for a week,
-- reconstructed exactly as the RPC receives one. A packet built from this is a
-- true no-op by construction, whatever the fixtures above happen to have left
-- current — which is stronger than hard-coding a value that a later edit to an
-- earlier section could silently make wrong.
create or replace function pg_temp.standing_rows(p_date date)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'scope', s.scope, 'row_key', s.row_key, 'parent_row_key', s.parent_row_key,
      'depth', s.depth, 'display_order', s.display_order, 'row_type', s.row_type,
      'label_es', s.label_es, 'label_en', s.label_en, 'currency', s.currency,
      'value', s.value, 'value_class', s.value_class,
      'source_sheet', s.source_sheet, 'source_cell', s.source_cell,
      'metadata', s.metadata) order by s.row_key), '[]'::jsonb)
    from public.portfolio_snapshot_rows s
    join public.portfolio_publications p on p.id = s.publication_id
   where p.upload_kind = 'portfolio' and p.as_of_date = p_date and p.is_current;
$$;

-- The same payload with one JSON key overridden on every row — how a workbook
-- edit that moves a figure, or one that only moves a source coordinate, is
-- expressed without rebuilding the whole array by hand.
create or replace function pg_temp.standing_rows_with(p_date date, p_key text, p_value jsonb)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(r || jsonb_build_object(p_key, p_value)), '[]'::jsonb)
    from jsonb_array_elements(pg_temp.standing_rows(p_date)) as r;
$$;

create or replace function pg_temp.standing_perf(p_date date)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'scope', r.scope, 'basis', r.basis, 'metric', r.metric,
      'value', r.value, 'value_class', r.value_class,
      'source_sheet', r.source_sheet, 'source_cell', r.source_cell,
      'metadata', r.metadata) order by r.metric), '[]'::jsonb)
    from public.portfolio_performance_rows r
    join public.portfolio_publications p on p.id = r.publication_id
   where p.upload_kind = 'portfolio' and p.as_of_date = p_date and p.is_current;
$$;

create or replace function pg_temp.current_total(p_date date)
returns numeric
language sql
as $$
  select s.value
    from public.portfolio_snapshot_rows s
    join public.portfolio_publications p on p.id = s.publication_id
   where p.upload_kind = 'portfolio' and p.as_of_date = p_date and p.is_current
     and s.row_key = 'total';
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · R13.8C.2 — a TRUE no-op import is refused by the DATABASE
--
-- The console already disables Apply for a NO_CHANGES preview. That is a
-- convenience, not the invariant: a caller reaching the RPC directly would
-- otherwise mint an import operation row and a publication revision recording
-- no change at all. These cases prove the refusal is the database's, that it
-- writes nothing, that repeating it still writes nothing, and — the other half
-- of the proof — that each single valid disposition still imports.
--
-- R13.8C.2 CORRECTED WHAT "NO-OP" MEANS, and these packets say so. A no-op is
-- the WHOLE import: no history mutation AND a current publication materially
-- equivalent to the one already standing. So every packet below carries
-- `pg_temp.standing_rows(...)` — the exact payload already published — rather
-- than an arbitrary one. A packet whose snapshot differs is NOT a no-op and must
-- not be refused; § 7 proves that half.
--
-- The book here is back to its original three weeks (07-03, 07-10, 07-31) with
-- 07-31 current, and every earlier import has been rolled back.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('dddd0005-0000-0000-0000-000000000005', 'portfolio', 'private/u5.xlsx', 'u5.xlsx',
   repeat('e', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0006-0000-0000-0000-000000000006', 'portfolio', 'private/u6.xlsx', 'u6.xlsx',
   repeat('f', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0007-0000-0000-0000-000000000007', 'portfolio', 'private/u7.xlsx', 'u7.xlsx',
   repeat('1', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0008-0000-0000-0000-000000000008', 'portfolio', 'private/u8.xlsx', 'u8.xlsx',
   repeat('2', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

-- The exact pre-state every assertion below is measured against.
select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  3, 'pre-state for the no-op cases: three weeks of history');
select is(
  (select count(*)::int from public.portfolio_import_operations),
  3, 'pre-state for the no-op cases: three import operations, all rolled back');
select is(
  (select count(*)::int from public.portfolio_publications),
  4, 'pre-state for the no-op cases: four publication rows, three of them demoted');
select is(
  (select count(*)::int from public.portfolio_import_observation_mutations),
  8, 'pre-state for the no-op cases: eight permanent ledger entries');

-- NON-VACUITY OF § 6. Every packet below is a no-op only because it restates the
-- STANDING publication. If that reconstruction were empty the packets would be
-- refused for a different reason entirely (`publication_refused_nothing_to_publish`)
-- and this section would prove nothing about the no-op guard.
select cmp_ok(
  jsonb_array_length(pg_temp.standing_rows('2026-07-31')), '>', 0,
  'the standing publication for 2026-07-31 has rows to restate');

-- 6a. An EMPTY packet — the NO_CHANGES preview, confirmed anyway.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0005-0000-0000-0000-000000000005'::uuid, '2026-07-31'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.standing_rows('2026-07-31'),
      '[]'::jsonb)$$,
  'import_refused_nothing_to_append',
  'an import with no new week, no gap fill and no correction is refused');

-- 6b. A packet that is not empty but mutates nothing. Length is not the test.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0005-0000-0000-0000-000000000005'::uuid, '2026-07-31'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.standing_rows('2026-07-31'),
      jsonb_build_array(pg_temp.obs('2026-07-31', 'unchanged', 13, 13)))$$,
  'import_refused_nothing_to_append',
  'a packet carrying only unchanged weeks is the same no-op, however long');

-- 6c. Repeating it changes nothing either — a retry or a double-click cannot
--     accumulate into a state the single attempt was refused for.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0005-0000-0000-0000-000000000005'::uuid, '2026-07-31'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.standing_rows('2026-07-31'),
      '[]'::jsonb)$$,
  'import_refused_nothing_to_append',
  'a repeated no-op attempt is refused identically');

-- Authorization and a reason do not buy a no-op through, either: the guard is
-- about whether anything changes, never about who approved it.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0005-0000-0000-0000-000000000005'::uuid, '2026-07-31'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.standing_rows('2026-07-31'),
      '[]'::jsonb, '[]'::jsonb, true, 'Authorized, but there is nothing to apply.')$$,
  'import_refused_nothing_to_append',
  'an authorized no-op is still refused');

-- ZERO WRITES, on every count the refusal is supposed to protect.
select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  3, 'the refused no-ops mutated no history');
select is(
  (select count(*)::int from public.portfolio_import_operations),
  3, 'the refused no-ops minted no import operation row');
select is(
  (select count(*)::int from public.portfolio_import_operations
    where upload_id = 'dddd0005-0000-0000-0000-000000000005'),
  0, 'not even one for the upload that was confirmed four times');
select is(
  (select count(*)::int from public.portfolio_publications),
  4, 'the refused no-ops minted no publication revision');
select is(
  (select count(*)::int from public.portfolio_publications
    where upload_id = 'dddd0005-0000-0000-0000-000000000005'),
  0, 'and no revision under the no-op upload');
select is(
  (select count(*)::int from public.portfolio_import_observation_mutations),
  8, 'the refused no-ops wrote no before-image ledger entry');
select is(
  (select max(as_of_date) from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  '2026-07-31'::date, 'and the current publication is the one that was current before');

-- 6d. NEW only — still imports.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0006-0000-0000-0000-000000000006'::uuid, '2026-08-07'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(700),
      jsonb_build_array(pg_temp.obs('2026-08-07', 'new', 61)))$$,
  'a NEW-only import still applies');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-08-07'),
  61::numeric, 'the new week landed');

-- 6e. GAP_FILL only — an insertion below the endpoint, no authorization needed.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0007-0000-0000-0000-000000000007'::uuid, '2026-08-14'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(800),
      jsonb_build_array(pg_temp.obs('2026-07-17', 'gap_fill', 71)))$$,
  'a GAP_FILL-only import still applies, with no authorization and no reason');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-07-17'),
  71::numeric, 'the gap fill landed');

select is(
  (select count(*)::int from public.portfolio_import_operations
    where upload_id = 'dddd0007-0000-0000-0000-000000000007'
      and correction_authorized = false and correction_reason is null),
  1, 'the gap fill needed no correction authorization — it is an insertion');

-- 6f. CHANGED only, authorized and with a reason — still imports.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0008-0000-0000-0000-000000000008'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8b.weekly_import_plan.2', pg_temp.rows_payload(900),
      jsonb_build_array(pg_temp.obs('2026-07-17', 'changed', 72, 71)),
      '[]'::jsonb, true, 'Custodian restated 07-17.')$$,
  'an authorized CHANGED-only import still applies');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-07-17'),
  72::numeric, 'the correction landed');

select is(
  (select count(*)::int from public.portfolio_import_observation_mutations
    where prior_value = 71 and disposition = 'changed'),
  1, 'and recorded its before-image, so it remains reversible');

select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  5, 'exactly the three valid imports moved the book: 3 + 1 new + 1 gap fill');

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · R13.8C.2 — a SNAPSHOT-ONLY change is a real import, not a no-op
--
-- THE BUG THIS SECTION EXISTS FOR. R13.8C.1 decided "nothing to append" from the
-- evolution packet alone. A workbook can leave every evolution point identical
-- and still restate a holding, a flow, a sociedad total or a performance figure
-- inside the CURRENT snapshot. Under that test the import was refused and the
-- stale published figure stayed standing — the console told an administrator
-- there was nothing to do while the book was wrong.
--
-- These cases prove all four halves of the corrected rule, executably:
--   · a packet identical in BOTH halves is still refused, and writes nothing;
--   · a packet differing only in OPERATIONAL fields is still refused;
--   · a packet whose snapshot materially differs is APPLIED, through the
--     ordinary publication/revision lifecycle and nothing invented;
--   · a snapshot-only import fails whole and rolls back exactly.
--
-- § 6 left the book with 2026-08-21 current, carrying the payload upload
-- `dddd0008` published (`rows_payload(900)`). Everything below works there.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('dddd0009-0000-0000-0000-000000000009', 'portfolio', 'private/u9.xlsx', 'u9.xlsx',
   repeat('3', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd000a-0000-0000-0000-00000000000a', 'portfolio', 'private/ua.xlsx', 'ua.xlsx',
   repeat('4', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd000b-0000-0000-0000-00000000000b', 'portfolio', 'private/ub.xlsx', 'ub.xlsx',
   repeat('5', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd000c-0000-0000-0000-00000000000c', 'portfolio', 'private/uc.xlsx', 'uc.xlsx',
   repeat('6', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd000d-0000-0000-0000-00000000000d', 'portfolio', 'private/ud.xlsx', 'ud.xlsx',
   repeat('7', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

-- The pre-state § 7 is measured against.
select is(
  (select max(as_of_date) from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  '2026-08-21'::date, 'pre-state for the snapshot cases: 2026-08-21 is current');
select is(pg_temp.current_total('2026-08-21'), 900::numeric,
  'pre-state for the snapshot cases: the standing total is 900');

-- The standing publication ROW, captured so § 7 can assert against the row that
-- actually stands rather than against an assumed revision number. Earlier
-- sections publish at this date too, so its revision is not 1, and hard-coding
-- one would make these assertions depend on edits made hundreds of lines above.
create temporary table snapshot_prestate as
  select id as pub_before, revision as rev_before
    from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current;

select is((select count(*)::int from snapshot_prestate), 1,
  'pre-state for the snapshot cases: exactly one publication stands for 2026-08-21');
select is(
  (select count(*)::int from public.portfolio_publications), 7,
  'pre-state for the snapshot cases: seven publication rows');
select is(
  (select count(*)::int from public.portfolio_import_operations), 6,
  'pre-state for the snapshot cases: six import operations');
select is(
  (select count(*)::int from public.portfolio_evolution_observations), 5,
  'pre-state for the snapshot cases: five observations');

-- ── The comparison function itself, at its two boundaries ───────────────────

-- No publication standing for a week is NEVER "unchanged": there is plainly
-- something to publish. Getting this backwards would refuse a first publication.
select is(
  public.nmi_portfolio_publication_unchanged(null, pg_temp.standing_rows('2026-08-21'), '[]'::jsonb),
  false, 'no standing publication is never materially unchanged');

select is(
  public.nmi_portfolio_publication_unchanged(
    (select id from public.portfolio_publications
      where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current),
    pg_temp.standing_rows('2026-08-21'), '[]'::jsonb),
  true, 'the standing payload compares equal to itself');

select is(
  public.nmi_portfolio_publication_unchanged(
    (select id from public.portfolio_publications
      where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current),
    pg_temp.standing_rows_with('2026-08-21', 'value', to_jsonb(901::numeric)), '[]'::jsonb),
  false, 'a single moved figure is a material difference');

-- 7a. TRUE no-op — history unchanged AND the snapshot identical. Still refused.
--     (Brief case A, and case H: this is the RPC called directly.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0009-0000-0000-0000-000000000009'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3', pg_temp.standing_rows('2026-08-21'),
      '[]'::jsonb)$$,
  'import_refused_nothing_to_append',
  'an import that changes neither the history nor the standing snapshot is refused');

-- 7b. OPERATIONAL-ONLY difference — every source coordinate moved because a
--     blank row was inserted above the section. No figure changed, so it is
--     still a no-op and still refused. (Brief case C.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0009-0000-0000-0000-000000000009'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows_with('2026-08-21', 'source_cell', '"ZZ99"'::jsonb),
      '[]'::jsonb)$$,
  'import_refused_nothing_to_append',
  'a workbook whose rows only MOVED is still a no-op — a coordinate is not a figure');

-- And the same for the row-level provenance carried inside `metadata`.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0009-0000-0000-0000-000000000009'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows_with('2026-08-21', 'metadata', '{"sourceRow": 4242}'::jsonb),
      '[]'::jsonb)$$,
  'import_refused_nothing_to_append',
  'a moved source ROW is operational too, and does not make an import');

-- ZERO WRITES from all three refusals.
select is(
  (select count(*)::int from public.portfolio_publications), 7,
  'the refused snapshot no-ops minted no publication revision');
select is(
  (select count(*)::int from public.portfolio_import_operations
    where upload_id = 'dddd0009-0000-0000-0000-000000000009'),
  0, 'and no import operation row for the upload that was confirmed three times');
select is(
  (select count(*)::int from public.portfolio_evolution_observations), 5,
  'and no history moved');
select is(pg_temp.current_total('2026-08-21'), 900::numeric,
  'and the standing snapshot is untouched');

-- 7c. A MATERIAL holding change with NO history change. This is the import
--     R13.8C.1 refused. It must be applied — through the ordinary publication
--     lifecycle, which already mints a revision and supersedes its predecessor.
--     (Brief case B.)
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd000a-0000-0000-0000-00000000000a'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows_with('2026-08-21', 'value', to_jsonb(901::numeric)),
      '[]'::jsonb)$$,
  'a snapshot-only correction is applied, not refused as nothing to append');

select is(pg_temp.current_total('2026-08-21'), 901::numeric,
  'the corrected figure is what readers now see');
select is(
  (select count(*)::int from public.portfolio_evolution_observations), 5,
  'and it changed no history — the two halves really are independent');
select is(
  (select revision from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current),
  (select rev_before + 1 from snapshot_prestate),
  'it went through the existing revision lifecycle — no new financial rule');
select is(
  (select count(*)::int from public.portfolio_publications p
     join snapshot_prestate x on x.pub_before = p.id
    where not p.is_current and p.superseded_by is not null),
  1, 'and the revision it replaced is demoted and points at its successor');

-- No correction authorization was required, and none was invented. Same-date
-- replacement has never demanded a written reason (doc 05 § 5.1); only an
-- overwrite of settled HISTORY does, and this import overwrote none.
select is(
  (select count(*)::int from public.portfolio_import_operations
    where upload_id = 'dddd000a-0000-0000-0000-00000000000a'
      and correction_authorized = false and correction_reason is null),
  1, 'a snapshot-only correction needs no historical-correction authorization');
select is(
  (select count(*)::int from public.portfolio_import_observation_mutations
    where import_operation_id = pg_temp.op_id('dddd000a-0000-0000-0000-00000000000a')),
  0, 'and wrote no before-image ledger entry, because it mutated no observation');

-- 7d. ROLLBACK of a snapshot-only correction restores the EXACT previous
--     publication — not a re-derivation of it, the row itself. (Brief case J.)
select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd000a-0000-0000-0000-00000000000a'),
      'd1111111-1111-1111-1111-111111111111'::uuid,
      'Reversing the snapshot-only correction.')$$,
  'a snapshot-only import can be reversed');

select is(
  (select id from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current),
  (select pub_before from snapshot_prestate),
  'the exact previous publication is standing again, figure for figure — the same row, not a re-derivation');
select is(pg_temp.current_total('2026-08-21'), 900::numeric,
  'and it carries the figures it carried before');
select is(
  (select revision from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current),
  (select rev_before from snapshot_prestate),
  'at its original revision, not a third one minted to undo the second');
select is(
  (select count(*)::int from public.portfolio_publications), 8,
  'the reversed revision is retained, never deleted — it can be rolled forward');
select is(
  (select count(*)::int from public.portfolio_evolution_observations), 5,
  'and the rollback touched no history, because the import had touched none');

-- 7e. A LATE FAILURE inside a snapshot-only import leaves nothing behind.
--     The operation row and the publication PARENT row are both written before
--     the snapshot rows are, so an invalid `value_class` raises only after two
--     durable writes have already happened in this transaction. If the import
--     were not atomic, both would survive. (Brief case I.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd000b-0000-0000-0000-00000000000b'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows_with('2026-08-21', 'value_class', '"not_a_value_class"'::jsonb),
      '[]'::jsonb)$$,
  -- The FOUR-argument form. `throws_ok(sql, errcode, description)` reads its
  -- third argument as the expected MESSAGE, not as a description, so a SQLSTATE
  -- match still fails on the message text.
  '23514', NULL,
  'a snapshot-only import that fails late raises');

select is(
  (select count(*)::int from public.portfolio_import_operations
    where upload_id = 'dddd000b-0000-0000-0000-00000000000b'),
  0, 'the late failure left no import operation row');
select is(
  (select count(*)::int from public.portfolio_publications
    where upload_id = 'dddd000b-0000-0000-0000-00000000000b'),
  0, 'nor a publication row, though one had already been inserted when it raised');
select is(
  (select count(*)::int from public.portfolio_publications), 8,
  'the publication count is exactly what it was before the attempt');
select is(pg_temp.current_total('2026-08-21'), 900::numeric,
  'and the standing snapshot never moved');

-- 7f. A figure that lives inside `metadata` is still a figure. `previousValue`
--     and `difference` are PUBLISHED numbers that happen to be stored there;
--     excluding the whole metadata column as provenance would have made a real
--     restatement invisible to the comparison.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd000c-0000-0000-0000-00000000000c'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows_with('2026-08-21', 'metadata',
        '{"previousValue": 880, "difference": 20}'::jsonb),
      '[]'::jsonb)$$,
  'a restated previous-week figure inside metadata is a material change');

select is(
  (select s.metadata ->> 'previousValue'
     from public.portfolio_snapshot_rows s
     join public.portfolio_publications p on p.id = s.publication_id
    where p.as_of_date = '2026-08-21' and p.is_current and s.row_key = 'total'),
  '880', 'and the restated figure is what is published');

-- 7g. A PERFORMANCE-row-only change is a publication mutation too. The snapshot
--     rows are byte-identical here; only the weekly return moved.
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd000d-0000-0000-0000-00000000000d'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows('2026-08-21'),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'scope', 'main', 'basis', 'ex_chilean_equities', 'metric', 'weekly_return',
        'value', 1.25, 'value_class', 'source_provided_return',
        'source_sheet', 'RESUMEN', 'source_cell', 'DA94')))$$,
  'a performance figure moving is a publication mutation, with the rows unchanged');

select is(
  (select count(*)::int from public.portfolio_performance_rows pr
     join public.portfolio_publications p on p.id = pr.publication_id
    where p.as_of_date = '2026-08-21' and p.is_current),
  1, 'and the new performance row is published');

select is(
  (select count(*)::int from public.portfolio_evolution_observations), 5,
  'the whole of § 7 moved no history — every case here is publication-only');

-- ── The publication half can never WEAKEN the history half ──────────────────
--
-- R13.8C.2 added a second axis. The one way that could have gone wrong is if it
-- became a second gate — letting a settled publication excuse a history
-- mutation, or letting an unchanged publication suppress one. It does neither:
-- a history mutation is an import on its own terms, and a correction still needs
-- its authorization and its reason no matter how settled this week's snapshot is.

insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('dddd000e-0000-0000-0000-00000000000e', 'portfolio', 'private/ue.xlsx', 'ue.xlsx',
   repeat('8', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd000f-0000-0000-0000-00000000000f', 'portfolio', 'private/uf.xlsx', 'uf.xlsx',
   repeat('9', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0010-0000-0000-0000-000000000010', 'portfolio', 'private/u10.xlsx', 'u10.xlsx',
   repeat('0', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

-- 7h. ONE GAP FILL, publication otherwise IDENTICAL. A gap fill does not move
--     the endpoint, so this week's snapshot legitimately restates itself — and
--     the import must still apply, because the history half is not empty.
--     (Brief case E.)
select is(
  public.nmi_portfolio_publication_unchanged(
    (select id from public.portfolio_publications
      where upload_kind = 'portfolio' and as_of_date = '2026-08-21' and is_current),
    pg_temp.standing_rows('2026-08-21'), pg_temp.standing_perf('2026-08-21')),
  true, 'the packet 7h sends is publication-identical — the gap fill is the only change');

select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd000e-0000-0000-0000-00000000000e'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-07-24', 'gap_fill', 74)),
      pg_temp.standing_perf('2026-08-21'))$$,
  'a gap fill applies even when this week''s snapshot is unchanged');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-07-24'),
  74::numeric, 'the gap fill landed');

-- 7i. ONE CHANGED point, publication otherwise IDENTICAL. An unchanged snapshot
--     buys nothing: the correction path is still required, and still refused
--     without authorization and a reason. (Brief case F.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd000f-0000-0000-0000-00000000000f'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-07-03', 'changed', 14, 11)),
      pg_temp.standing_perf('2026-08-21'))$$,
  'import_refused_historical_correction_required',
  'an unchanged snapshot does not excuse an unauthorized history overwrite');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-07-03'),
  11::numeric, 'and the refused correction changed nothing');

select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0010-0000-0000-0000-000000000010'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8c2.weekly_import_plan.3',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-07-03', 'changed', 14, 11)),
      pg_temp.standing_perf('2026-08-21'), true, 'Custodian restated 07-03.')$$,
  'and applies once authorized with a written reason, snapshot unchanged or not');

select is(
  (select value from public.portfolio_evolution_observations
    where observation_date = '2026-07-03'),
  14::numeric, 'the authorized correction landed');

select is(
  (select count(*)::int from public.portfolio_evolution_observations), 6,
  'the book ends § 7 with one more week than it began: the gap fill, and nothing else');

-- ═══════════════════════════════════════════════════════════════════════════
-- § 8 · R13.8D.1 — HISTORICAL PUBLICATION RESTATEMENT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The gap this section closes: an import could append new weeks while leaving
-- ALREADY-PUBLISHED weeks disagreeing with the authoritative workbook. The
-- evolution series cannot see it — a workbook can move an amount from net flows
-- into weekly profit and leave every portfolio LEVEL identical while the
-- published figures change — so before R13.8D.1 the correction gate, which read
-- only the observation packet, let it through unauthorized and unrecorded.
--
-- Every test below runs against real PostgreSQL, in real transactions, so the
-- atomicity and rollback claims are executed rather than asserted.

insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('dddd0011-0000-0000-0000-000000000011', 'portfolio', 'private/u11.xlsx', 'u11.xlsx',
   repeat('1', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0012-0000-0000-0000-000000000012', 'portfolio', 'private/u12.xlsx', 'u12.xlsx',
   repeat('2', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0013-0000-0000-0000-000000000013', 'portfolio', 'private/u13.xlsx', 'u13.xlsx',
   repeat('3', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0014-0000-0000-0000-000000000014', 'portfolio', 'private/u14.xlsx', 'u14.xlsx',
   repeat('4', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

create or replace function pg_temp.current_pub(p_date date)
returns uuid
language sql
as $$
  select id from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = p_date and is_current;
$$;

create or replace function pg_temp.current_rev(p_date date)
returns int
language sql
as $$
  select revision from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = p_date and is_current;
$$;

-- One historical-correction entry, in the exact shape the RPC reads.
create or replace function pg_temp.hist_pub(
  p_date date, p_prior uuid, p_rows jsonb, p_perf jsonb, p_count int default 1)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'as_of_date', p_date,
    'prior_publication_id', p_prior,
    'snapshot_rows', p_rows,
    'performance_rows', p_perf,
    'difference_count', p_count));
$$;

-- 8a. PRE-STATE, captured rather than assumed. Earlier sections publish at
--     several dates, so hard-coding a revision here would make this section
--     fail for a reason that has nothing to do with restatement.
create temporary table restatement_prestate as
  select pg_temp.current_pub('2026-07-31') as pub_before,
         pg_temp.current_rev('2026-07-31') as rev_before,
         (select count(*)::int from public.portfolio_evolution_observations) as obs_before;

select isnt((select pub_before from restatement_prestate), null::uuid,
  '2026-07-31 still has its own current publication — each week stays current for itself');

-- 8b. THE GATE. A restatement is an overwrite of settled history, so it needs
--     authorization and a reason exactly as an evolution overwrite does. This is
--     the defect: before R13.8D.1 this packet applied silently. (Brief cases D/E.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0011-0000-0000-0000-000000000011'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-09-11', 'new', 91)),
      pg_temp.standing_perf('2026-08-21'),
      false, null, '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-07-31', pg_temp.current_pub('2026-07-31'),
        pg_temp.standing_rows_with('2026-07-31', 'value', to_jsonb(54321::numeric)),
        pg_temp.standing_perf('2026-07-31'), 3))$$,
  'import_refused_historical_correction_required',
  'a restatement of an already-published week cannot apply without authorization');

-- 8c. …and the refusal wrote NOTHING: not the new week, not the correction.
select is((select count(*)::int from public.portfolio_evolution_observations),
  (select obs_before from restatement_prestate),
  'the refused mixed import appended no history');
select is(pg_temp.current_pub('2026-07-31'), (select pub_before from restatement_prestate),
  'and left the historical week on its original revision');
select is((select count(*)::int from public.portfolio_import_publication_corrections), 0,
  'and recorded no correction');

-- 8d. AUTHORIZATION IS NOT A LICENCE TO MINT AN EMPTY REVISION. The database
--     re-derives whether the week actually differs, from its own rows.
--     An OPERATIONAL-only edit — a moved source coordinate — is not a
--     restatement, and must be refused even when fully authorized. This is the
--     non-vacuity pair for 8h: same call, same authorization, one key different.
--     (Brief case K.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0011-0000-0000-0000-000000000011'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-09-11', 'new', 91)),
      pg_temp.standing_perf('2026-08-21'),
      true, 'Coordinates moved.', '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-07-31', pg_temp.current_pub('2026-07-31'),
        pg_temp.standing_rows_with('2026-07-31', 'source_cell', to_jsonb('ZZ99'::text)),
        pg_temp.standing_perf('2026-07-31'), 1))$$,
  'import_refused_historical_publication_unchanged',
  'a source-coordinate move is not a restatement, however it is labelled');

-- 8e. STALE PLAN, at publication granularity. The revision the administrator's
--     before/after was computed against must still be the one standing.
--     (Brief case J.)
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0011-0000-0000-0000-000000000011'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-09-11', 'new', 91)),
      pg_temp.standing_perf('2026-08-21'),
      true, 'Restating 07-31.', '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-07-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
        pg_temp.standing_rows_with('2026-07-31', 'value', to_jsonb(54321::numeric)),
        pg_temp.standing_perf('2026-07-31'), 3))$$,
  'import_refused_stale_historical_publication',
  'a correction computed against a revision that is no longer standing is refused whole');

-- 8f. The week being published cannot also arrive as a historical correction:
--     that would publish one date twice in one transaction.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0011-0000-0000-0000-000000000011'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-09-11', 'new', 91)),
      pg_temp.standing_perf('2026-08-21'),
      true, 'Restating.', '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-08-21', pg_temp.current_pub('2026-08-21'),
        pg_temp.standing_rows_with('2026-08-21', 'value', to_jsonb(54321::numeric)),
        pg_temp.standing_perf('2026-08-21'), 1))$$,
  'import_refused_historical_publication_is_current_week',
  'the current week is not a historical restatement');

-- 8g. A week with no standing revision is a FIRST publication, not a correction.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0011-0000-0000-0000-000000000011'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-09-11', 'new', 91)),
      pg_temp.standing_perf('2026-08-21'),
      true, 'Restating.', '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2021-01-01', pg_temp.current_pub('2026-07-31'),
        pg_temp.standing_rows('2026-08-21'), pg_temp.standing_perf('2026-08-21'), 1))$$,
  'import_refused_historical_publication_absent',
  'a week with nothing published cannot be corrected through this path');

-- 8h. ATOMICITY, PROVED BY A DELIBERATE LATE FAILURE. (Brief cases G/H.)
--     The packet carries a VALID historical correction and a history mutation
--     that is stale. The history loop runs AFTER the corrections, so the
--     correction has already been written when the failure fires — and it must
--     still be gone when the dust settles.
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0012-0000-0000-0000-000000000012'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-07-03', 'new', 99)),
      pg_temp.standing_perf('2026-08-21'),
      true, 'Restating 07-31.', '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-07-31', pg_temp.current_pub('2026-07-31'),
        pg_temp.standing_rows_with('2026-07-31', 'value', to_jsonb(54321::numeric)),
        pg_temp.standing_perf('2026-07-31'), 3))$$,
  'import_refused_stale_plan_identity_exists',
  'a mixed import whose history half is stale is refused whole');

select is(pg_temp.current_pub('2026-07-31'), (select pub_before from restatement_prestate),
  'the historical correction rolled back with the failed history write — SAME revision still current');
select is((select count(*)::int from public.portfolio_import_publication_corrections), 0,
  'and no correction survived the rollback');
select is((select count(*)::int from public.portfolio_import_operations
            where upload_id = 'dddd0012-0000-0000-0000-000000000012'::uuid), 0,
  'and no operation row survived it either');

-- 8i. THE SUCCESSFUL MIXED IMPORT: one new week AND one restated published week,
--     in one operation. (Brief case D applied.)
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0013-0000-0000-0000-000000000013'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      jsonb_build_array(pg_temp.obs('2026-09-11', 'new', 91)),
      pg_temp.standing_perf('2026-08-21'),
      true, 'Workbook restates the sleeve attribution for 2026-07-31.',
      '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-07-31', pg_temp.current_pub('2026-07-31'),
        pg_temp.standing_rows_with('2026-07-31', 'value', to_jsonb(54321::numeric)),
        pg_temp.standing_perf('2026-07-31'), 3))$$,
  'an authorized mixed import applies its new week and its restatement together');

select is((select value from public.portfolio_evolution_observations
            where observation_date = '2026-09-11'),
  91::numeric, 'the new week landed');

select is(pg_temp.current_rev('2026-07-31'),
  (select rev_before + 1 from restatement_prestate),
  'the restated week advanced by exactly one revision');

select isnt(pg_temp.current_pub('2026-07-31'), (select pub_before from restatement_prestate),
  'and a different publication row is current for it now');

select is(pg_temp.current_total('2026-07-31'), 54321::numeric,
  'the corrected week now carries the workbook''s figure');

select is(
  (select superseded_by from public.portfolio_publications
    where id = (select pub_before from restatement_prestate)),
  pg_temp.current_pub('2026-07-31'),
  'the displaced revision points at the one that replaced it');

-- 8j. The ledger records which revision displaced which — this is what makes
--     rollback exact rather than a guess from dates.
select is((select count(*)::int from public.portfolio_import_publication_corrections
            where import_operation_id = pg_temp.op_id('dddd0013-0000-0000-0000-000000000013')), 1,
  'the correction ledger recorded exactly one corrected week');

select is(
  (select previous_publication_id from public.portfolio_import_publication_corrections
    where import_operation_id = pg_temp.op_id('dddd0013-0000-0000-0000-000000000013')),
  (select pub_before from restatement_prestate),
  'and it names the exact revision that was displaced');

-- 8k. THE ONE-CURRENT-PUBLICATION RULE IS UNTOUCHED. Correcting a past week is a
--     revision OF THAT WEEK; the newest frozen date is still the book's endpoint.
select is(
  (select max(as_of_date) from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current),
  '2026-08-21'::date,
  'correcting 2026-07-31 did not make it the newest current publication');

-- 8l. ROLLBACK REVERSES BOTH HALVES. (Brief case I.)
select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('dddd0013-0000-0000-0000-000000000013'),
      'd1111111-1111-1111-1111-111111111111'::uuid, 'reverting the mixed import')$$,
  'a mixed import reverses whole');

select is((select count(*)::int from public.portfolio_evolution_observations
            where observation_date = '2026-09-11'), 0,
  'the appended week is gone');

select is(pg_temp.current_pub('2026-07-31'), (select pub_before from restatement_prestate),
  'and the corrected week is back on the EXACT revision row it started from');

select is(pg_temp.current_rev('2026-07-31'), (select rev_before from restatement_prestate),
  'at its original revision number');

select is(
  (select count(*)::int from public.portfolio_publications p
    join public.portfolio_import_publication_corrections c on c.publication_id = p.id
   where c.import_operation_id = pg_temp.op_id('dddd0013-0000-0000-0000-000000000013')
     and p.is_current),
  0,
  'no corrected revision from the reversed import is left standing');

-- 8m. A RESTATEMENT-ONLY IMPORT IS NOT A NO-OP. No week is appended and this
--     week's snapshot is byte-identical, but seven — here one — already-published
--     weeks are being corrected, and that is a durable financial mutation.
--     (Brief case C at the database.)
select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'dddd0014-0000-0000-0000-000000000014'::uuid, '2026-08-21'::date,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      'r13.8d1.weekly_import_plan.1',
      pg_temp.standing_rows('2026-08-21'),
      '[]'::jsonb,
      pg_temp.standing_perf('2026-08-21'),
      true, 'Restatement only.', '{}'::jsonb, null, '{}'::jsonb,
      pg_temp.hist_pub('2026-07-31', pg_temp.current_pub('2026-07-31'),
        pg_temp.standing_rows_with('2026-07-31', 'value', to_jsonb(12345::numeric)),
        pg_temp.standing_perf('2026-07-31'), 3))$$,
  'an import that only restates published weeks is applied, not refused as a no-op');

select is(pg_temp.current_total('2026-07-31'), 12345::numeric,
  'the restatement-only import corrected the published week');

select * from finish();

rollback;
