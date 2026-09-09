-- R13.8E -- EXECUTABLE validation of source-backed row-level history.
--
-- WHY THIS FILE EXISTS. The claims are about real PostgreSQL behaviour and
-- cannot be proved by reading TypeScript:
--
--   * row history is written INSIDE the import transaction, so a failure after
--     it has written leaves not one row behind;
--   * a rollback removes exactly the rows the import inserted and restores an
--     overwritten row to its exact before-image AND lineage;
--   * an unreadable value can never be stored as a number;
--   * Jaime cannot read Andres's rows, and PostgreSQL -- not the server -- is
--     what stops him;
--   * a restated historical week records ITS OWN previous-week date, and a date
--     that cannot possibly precede the week it belongs to is refused outright.
--
-- HOW THE ATOMICITY PROOF IS MADE NON-VACUOUS. The failing packet is ordered so
-- the failure comes LAST: the publication is minted, the evolution point is
-- appended and the row history is written, and only then does the historical
-- restatement raise. If the transaction were not atomic those rows would still
-- be there afterwards. Every assertion after each `throws_ok` re-reads the
-- tables and proves they are not.
--
-- `throws_ok` runs its query inside a plpgsql exception block, which is a real
-- subtransaction: catching the error rolls back everything the function did,
-- exactly as a failed RPC call would. `lives_ok` is its counterpart -- on
-- success nothing is rolled back, so the effects persist and later assertions
-- can read them.
--
-- All identities and values are throwaway rows created inside this transaction
-- and rolled back at the end. No production identity or portfolio value appears
-- anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ===========================================================================
-- 0 - Fixtures
-- ===========================================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'rh_admin@test.invalid'),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'rh_jaime@test.invalid'),
  ('c4444444-4444-4444-4444-444444444444'::uuid, 'rh_andres@test.invalid'),
  ('c6666666-6666-6666-6666-666666666666'::uuid, 'rh_plain@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('c1111111-1111-1111-1111-111111111111', 'rh_admin',  'rh_admin@test.invalid',  'RH Admin',  'administrator', null),
  ('c3333333-3333-3333-3333-333333333333', 'rh_jaime',  'rh_jaime@test.invalid',  'RH Jaime',  'user',          'jaime'),
  ('c4444444-4444-4444-4444-444444444444', 'rh_andres', 'rh_andres@test.invalid', 'RH Andres', 'user',          'andres'),
  ('c6666666-6666-6666-6666-666666666666', 'rh_plain',  'rh_plain@test.invalid',  'RH Plain',  'user',          null);

update public.user_profiles set activated_at = now()
 where activated_at is null and disabled_at is null;

insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('cccc0001-0000-0000-0000-000000000001', 'portfolio', 'private/rh1.xlsx', 'rh1.xlsx',
   repeat('1', 64), 1000, 'c1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('cccc0002-0000-0000-0000-000000000002', 'portfolio', 'private/rh2.xlsx', 'rh2.xlsx',
   repeat('2', 64), 1000, 'c1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('cccc0003-0000-0000-0000-000000000003', 'portfolio', 'private/rh3.xlsx', 'rh3.xlsx',
   repeat('3', 64), 1000, 'c1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('cccc0004-0000-0000-0000-000000000004', 'portfolio', 'private/rh4.xlsx', 'rh4.xlsx',
   repeat('4', 64), 1000, 'c1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('cccc0005-0000-0000-0000-000000000005', 'portfolio', 'private/rh5.xlsx', 'rh5.xlsx',
   repeat('5', 64), 1000, 'c1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

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

-- One staged row-history row, in the shape `jsonb_to_recordset` reads.
create or replace function pg_temp.rh(
  p_scope text, p_date text, p_key text, p_value numeric,
  p_disposition text default 'new',
  p_prior numeric default null,
  p_class text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'scope', p_scope, 'observation_date', p_date, 'row_key', p_key,
    'parent_row_key', null, 'depth', 0, 'display_order', 1,
    'row_type', 'asset_class', 'label_es', upper(p_key), 'label_en', null,
    'currency', 'USD',
    'value', p_value,
    'value_class', coalesce(p_class, case when p_value is null then 'unavailable' else 'source_value' end),
    'source_sheet', 'RESUMEN', 'source_cell', 'DA11', 'source_row', 11,
    'parser_version', 'test.parser.1',
    'disposition', p_disposition,
    'prior_value', p_prior,
    'prior_value_class', case when p_disposition = 'changed' then 'source_value' else null end);
$$;

create or replace function pg_temp.stage(p_id uuid, p_rows jsonb)
returns void
language sql
as $$
  insert into public.portfolio_row_history_staging (staging_id, chunk_index, rows)
  values (p_id, 0, p_rows);
$$;

create or replace function pg_temp.op_id(p_upload text)
returns uuid
language sql
as $$
  select id from public.portfolio_import_operations where upload_id = p_upload::uuid;
$$;

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

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role postgres';
end $$;

-- A baseline book: one publication at 2026-07-31 and one earlier week the
-- workbook will later restate.
do $$
begin
  perform public.nmi_publish_portfolio(
    'cccc0001-0000-0000-0000-000000000001'::uuid, '2026-07-24'::date,
    'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
    pg_temp.rows_payload(90));
  perform public.nmi_publish_portfolio(
    'cccc0001-0000-0000-0000-000000000001'::uuid, '2026-07-31'::date,
    'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
    pg_temp.rows_payload(100));
end $$;

insert into public.portfolio_evolution_observations
  (scope, basis, observation_date, value, currency, source_upload_id,
   source_sheet, source_cell, source_row_label, parser_version, extractor_version)
values
  ('main','ex_chilean_equities','2026-07-24', 90, 'USD', 'cccc0001-0000-0000-0000-000000000001',
   'RESUMEN','CY10','TOTAL','test.parser.1','test.extractor.1'),
  ('main','ex_chilean_equities','2026-07-31', 100, 'USD', 'cccc0001-0000-0000-0000-000000000001',
   'RESUMEN','CZ10','TOTAL','test.parser.1','test.extractor.1');

-- ===========================================================================
-- 1 - Schema and posture
-- ===========================================================================

select has_table('public', 'portfolio_row_history', 'the row-history table exists');
select has_table('public', 'portfolio_import_row_history_mutations',
  'the row-history before-image ledger exists');
select has_table('public', 'portfolio_row_history_staging', 'the staging relay exists');

select col_is_unique('public', 'portfolio_row_history',
  array['scope', 'observation_date', 'row_key'],
  'the canonical identity is (scope, observation_date, row_key)');

-- ROW HISTORY IS NOT A PUBLICATION. These columns must never appear.
select hasnt_column('public', 'portfolio_row_history', 'is_current',
  'row history carries no is_current');
select hasnt_column('public', 'portfolio_row_history', 'revision',
  'row history carries no revision');
select hasnt_column('public', 'portfolio_row_history', 'superseded_by',
  'row history carries no supersession pointer');
select hasnt_column('public', 'portfolio_row_history', 'publication_id',
  'row history is keyed by a reporting DATE, never by a publication');
-- Basis is not part of snapshot-row identity, so it is not invented here.
select hasnt_column('public', 'portfolio_row_history', 'basis',
  'row history does not invent a basis dimension');

select has_column('public', 'portfolio_row_history', 'import_operation_id',
  'row history carries forward lineage to the import that wrote it');
select has_column('public', 'portfolio_import_row_history_mutations', 'prior_import_operation_id',
  'the ledger records which import it displaced, so rollbacks chain');
select has_column('public', 'portfolio_import_row_history_mutations', 'prior_row',
  'the ledger records the WHOLE displaced row, so a reversal is exact');

-- EXACTLY ONE callable import function. An overload would be a second import
-- path, and one of the two would silently omit row history after release.
select is(
  (select count(*)::int from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_import_portfolio_workbook'),
  1, 'exactly one nmi_import_portfolio_workbook exists');

select is(
  (select p.pronargs::int from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_import_portfolio_workbook'),
  14, 'the import RPC keeps its exact 14-argument signature');

-- ===========================================================================
-- 2 - An unreadable value can never become a number
-- ===========================================================================

select throws_ok(
  $$insert into public.portfolio_row_history
      (scope, observation_date, row_key, depth, display_order, row_type, label_es,
       value, value_class, source_upload_id, source_sheet, source_cell, parser_version)
    values ('main', '2026-07-31', 'bogus', 0, 1, 'asset_class', 'BOGUS',
            0, 'unavailable', 'cccc0001-0000-0000-0000-000000000001',
            'RESUMEN', 'DA9', 'test.parser.1')$$,
  'new row for relation "portfolio_row_history" violates check constraint "portfolio_row_history_unavailable_ck"',
  'an unavailable row carrying a number is refused by the database');

select lives_ok(
  $$insert into public.portfolio_row_history
      (scope, observation_date, row_key, depth, display_order, row_type, label_es,
       value, value_class, source_upload_id, source_sheet, source_cell, parser_version)
    values ('main', '2026-07-31', 'unreadable', 0, 1, 'asset_class', 'UNREADABLE',
            null, 'unavailable', 'cccc0001-0000-0000-0000-000000000001',
            'RESUMEN', 'DA9', 'test.parser.1')$$,
  'an unavailable row with NO number is accepted');

delete from public.portfolio_row_history where row_key = 'unreadable';

-- ===========================================================================
-- 3 - The staging relay refuses an incomplete batch
-- ===========================================================================

-- Two rows staged, three declared: a chunk was lost in transport. Writing the
-- two would be a partial history reported as a success.
select pg_temp.stage(
  'cccc9001-0000-0000-0000-000000000001'::uuid,
  jsonb_build_array(
    pg_temp.rh('main', '2026-08-07', 'equities', 60),
    pg_temp.rh('main', '2026-08-07', 'credit', 40)));

select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0002-0000-0000-0000-000000000002'::uuid, '2026-08-07'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(110),
      jsonb_build_array(pg_temp.obs('2026-08-07','new',110)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9001-0000-0000-0000-000000000001',
        'rowHistoryRowCount', 3))$$,
  'import_refused_row_history_staging_incomplete',
  'a staged batch shorter than the declared count refuses the whole import');

select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-07'),
  0, 'and nothing was written');

select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0002-0000-0000-0000-000000000002'::uuid, '2026-08-07'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(110),
      jsonb_build_array(pg_temp.obs('2026-08-07','new',110)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object('rowHistoryStagingId', 'cccc9001-0000-0000-0000-000000000001'))$$,
  'import_refused_row_history_count_missing',
  'a relay with no declared count is refused rather than trusted');

select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0002-0000-0000-0000-000000000002'::uuid, '2026-08-07'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(110),
      jsonb_build_array(pg_temp.obs('2026-08-07','new',110)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object('rowHistoryRowCount', 2))$$,
  'import_refused_row_history_staging_missing',
  'a declared count with no relay at all is refused');

-- ===========================================================================
-- 4 - The happy path: row history is written inside the import
-- ===========================================================================

select pg_temp.stage(
  'cccc9002-0000-0000-0000-000000000002'::uuid,
  jsonb_build_array(
    pg_temp.rh('main',   '2026-08-07', 'equities', 60),
    pg_temp.rh('main',   '2026-08-07', 'credit',   50),
    pg_temp.rh('jaime',  '2026-08-07', 'equities', 30),
    pg_temp.rh('andres', '2026-08-07', 'equities', 20),
    pg_temp.rh('main',   '2026-08-07', 'murky',    null)));

select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0002-0000-0000-0000-000000000002'::uuid, '2026-08-07'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(110),
      jsonb_build_array(pg_temp.obs('2026-08-07','new',110)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9002-0000-0000-0000-000000000002',
        'rowHistoryRowCount', 5,
        'previousWeekDate', '2026-07-31'))$$,
  'an import carrying row history applies');

select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-07'),
  5, 'every staged row was written');

select is(
  (select value from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'equities'),
  60::numeric, 'the value is the source-backed one');

select ok(
  (select value is null and value_class = 'unavailable' from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'murky'),
  'an unreadable source cell stayed NULL, never zero');

select is(
  (select count(*)::int from public.portfolio_row_history
    where observation_date = date '2026-08-07'
      and import_operation_id = pg_temp.op_id('cccc0002-0000-0000-0000-000000000002')),
  5, 'every row carries the lineage of the import that wrote it');

select is(
  (select count(*)::int from public.portfolio_import_row_history_mutations
    where import_operation_id = pg_temp.op_id('cccc0002-0000-0000-0000-000000000002')
      and disposition = 'new' and prior_row is null),
  5, 'the ledger recorded five insertions with no before-image');

-- The relay is consumed and gone.
select is(
  (select count(*)::int from public.portfolio_row_history_staging
    where staging_id = 'cccc9002-0000-0000-0000-000000000002'),
  0, 'the staged chunks were consumed and deleted inside the transaction');

-- The locked architecture is intact: 08-07 has row history and NO publication.
select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = date '2026-08-07'),
  1, 'the imported week is the ONE new current publication');
select is(
  (select as_of_date from public.portfolio_import_operations
    where upload_id = 'cccc0002-0000-0000-0000-000000000002'),
  date '2026-08-07', 'one upload produced one import operation at the newest frozen date');

-- ===========================================================================
-- 5 - Re-uploading the same rows is a no-op, and an overwrite needs authority
-- ===========================================================================

-- Nothing to append, nothing restated, and no NEW row history: refused.
select pg_temp.stage('cccc9003-0000-0000-0000-000000000003'::uuid, '[]'::jsonb);
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0003-0000-0000-0000-000000000003'::uuid, '2026-08-07'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.standing_rows('2026-08-07'),
      '[]'::jsonb, '[]'::jsonb, false, null, '{}'::jsonb, null, '{}'::jsonb)$$,
  'import_refused_nothing_to_append',
  'an import with no week, no restatement and no row history is refused');

-- An insertion whose identity already exists is a stale plan, never a silent
-- overwrite.
select pg_temp.stage(
  'cccc9004-0000-0000-0000-000000000004'::uuid,
  jsonb_build_array(pg_temp.rh('main', '2026-08-07', 'equities', 999)));
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0003-0000-0000-0000-000000000003'::uuid, '2026-08-14'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(120),
      jsonb_build_array(pg_temp.obs('2026-08-14','new',120)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9004-0000-0000-0000-000000000004',
        'rowHistoryRowCount', 1))$$,
  'import_refused_stale_row_history_identity_exists',
  'an insertion onto an existing identity refuses the whole import');

-- An OVERWRITE without authorization is refused, exactly like an evolution
-- overwrite and a publication restatement.
select pg_temp.stage(
  'cccc9005-0000-0000-0000-000000000005'::uuid,
  jsonb_build_array(pg_temp.rh('main', '2026-08-07', 'equities', 61, 'changed', 60)));
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0003-0000-0000-0000-000000000003'::uuid, '2026-08-14'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(120),
      jsonb_build_array(pg_temp.obs('2026-08-14','new',120)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9005-0000-0000-0000-000000000005',
        'rowHistoryRowCount', 1))$$,
  'import_refused_historical_correction_required',
  'overwriting a recorded row-level value requires authorization and a reason');

select is(
  (select value from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'equities'),
  60::numeric, 'and the recorded value did not move');

-- A stale before-image is refused even WITH authorization.
select pg_temp.stage(
  'cccc9006-0000-0000-0000-000000000006'::uuid,
  jsonb_build_array(pg_temp.rh('main', '2026-08-07', 'equities', 61, 'changed', 999)));
select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0003-0000-0000-0000-000000000003'::uuid, '2026-08-14'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(120),
      jsonb_build_array(pg_temp.obs('2026-08-14','new',120)),
      '[]'::jsonb, true, 'authorized but stale', '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9006-0000-0000-0000-000000000006',
        'rowHistoryRowCount', 1))$$,
  'import_refused_stale_row_history_value_moved',
  'a before-image that does not match the book refuses the whole import');

-- ===========================================================================
-- 6 - Atomicity: a LATE failure leaves no row history behind
-- ===========================================================================
--
-- The packet publishes a week, appends an evolution point and writes row
-- history, and only THEN names a historical publication that is not standing.
-- Everything before the raise would persist if this were not one transaction.

select pg_temp.stage(
  'cccc9007-0000-0000-0000-000000000007'::uuid,
  jsonb_build_array(
    pg_temp.rh('main', '2026-08-14', 'equities', 65),
    pg_temp.rh('main', '2026-08-14', 'credit',   55)));

select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0003-0000-0000-0000-000000000003'::uuid, '2026-08-14'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(120),
      jsonb_build_array(pg_temp.obs('2026-08-14','new',120)),
      '[]'::jsonb, true, 'restating a week that is not standing', '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9007-0000-0000-0000-000000000007',
        'rowHistoryRowCount', 2),
      jsonb_build_array(jsonb_build_object(
        'as_of_date', '2026-06-05',
        'prior_publication_id', null,
        'snapshot_rows', pg_temp.rows_payload(1),
        'performance_rows', '[]'::jsonb,
        'difference_count', 1,
        'previous_week_date', '2026-05-29')))$$,
  'import_refused_historical_publication_absent',
  'a restatement of a week with no standing revision refuses the import');

select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-14'),
  0, 'ATOMIC: the two row-history rows written before the failure are gone');
select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = date '2026-08-14'),
  0, 'ATOMIC: the publication minted before the failure is gone');
select is(
  (select count(*)::int from public.portfolio_evolution_observations
    where observation_date = date '2026-08-14'),
  0, 'ATOMIC: the evolution point appended before the failure is gone');
select is(
  (select count(*)::int from public.portfolio_import_operations
    where upload_id = 'cccc0003-0000-0000-0000-000000000003'),
  0, 'ATOMIC: no import operation was recorded');

-- ===========================================================================
-- 7 - A restated week records ITS OWN previous-week date
-- ===========================================================================
--
-- THE DEFECT. Before R13.8E the import's own anchor was stamped onto every week
-- it restated, so 2026-07-24 recorded a previous week of 2026-08-07 -- a date
-- two weeks AFTER the week it claims to precede.

select pg_temp.stage(
  'cccc9008-0000-0000-0000-000000000008'::uuid,
  jsonb_build_array(pg_temp.rh('main', '2026-08-14', 'equities', 65)));

select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0004-0000-0000-0000-000000000004'::uuid, '2026-08-14'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(120),
      jsonb_build_array(pg_temp.obs('2026-08-14','new',120)),
      '[]'::jsonb, true, 'the workbook restated the July basket', '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9008-0000-0000-0000-000000000008',
        'rowHistoryRowCount', 1,
        'previousWeekDate', '2026-08-07',
        'beginningOfYearDate', '2026-01-02'),
      jsonb_build_array(jsonb_build_object(
        'as_of_date', '2026-07-24',
        'prior_publication_id', (select id from public.portfolio_publications
                                  where upload_kind = 'portfolio'
                                    and as_of_date = date '2026-07-24' and is_current),
        'snapshot_rows', pg_temp.rows_payload(91),
        'performance_rows', '[]'::jsonb,
        'difference_count', 1,
        'previous_week_date', '2026-07-17',
        'beginning_of_year_date', '2026-01-02')))$$,
  'an authorized restatement applies');

select is(
  (select metadata->>'previousWeekDate' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = date '2026-07-24' and is_current),
  '2026-07-17',
  'the restated week records ITS OWN previous-week date, not the import anchor');

select is(
  (select metadata->>'previousWeekDate' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = date '2026-08-14' and is_current),
  '2026-08-07',
  'and the current week keeps its own');

select ok(
  (select (metadata->>'previousWeekDate')::date < as_of_date
     from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = date '2026-07-24' and is_current),
  'a recorded previous-week date is strictly earlier than the week it belongs to');

-- ===========================================================================
-- 8 - An impossible anchor is refused at the write
-- ===========================================================================

select pg_temp.stage('cccc9009-0000-0000-0000-000000000009'::uuid, '[]'::jsonb);

select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0005-0000-0000-0000-000000000005'::uuid, '2026-08-21'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(130),
      jsonb_build_array(pg_temp.obs('2026-08-21','new',130)),
      '[]'::jsonb, false, null, '{}'::jsonb, null,
      jsonb_build_object('previousWeekDate', '2026-08-28'))$$,
  'import_refused_impossible_previous_week_date',
  'a current publication cannot record a previous week AFTER itself');

select throws_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0005-0000-0000-0000-000000000005'::uuid, '2026-08-21'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(130),
      jsonb_build_array(pg_temp.obs('2026-08-21','new',130)),
      '[]'::jsonb, true, 'reason', '{}'::jsonb, null,
      jsonb_build_object('previousWeekDate', '2026-08-14'),
      jsonb_build_array(jsonb_build_object(
        'as_of_date', '2026-07-24',
        'prior_publication_id', (select id from public.portfolio_publications
                                  where upload_kind = 'portfolio'
                                    and as_of_date = date '2026-07-24' and is_current),
        'snapshot_rows', pg_temp.rows_payload(92),
        'performance_rows', '[]'::jsonb,
        'difference_count', 1,
        'previous_week_date', '2026-08-14')))$$,
  'import_refused_impossible_previous_week_date',
  'a RESTATED week cannot record a previous week after itself either');

-- ===========================================================================
-- 9 - Rollback
-- ===========================================================================

-- The 08-14 import inserted one row-history row and restated 2026-07-24.
select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('cccc0004-0000-0000-0000-000000000004'),
      'c1111111-1111-1111-1111-111111111111'::uuid,
      'reversing the test import')$$,
  'the import reverses');

select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-14'),
  0, 'rollback removed exactly the rows this import inserted');

select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-07'),
  5, 'and left the earlier import''s rows alone');

select is(
  (select revision from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = date '2026-07-24' and is_current),
  1, 'the restated historical week was demoted back to its previous revision');

-- Now prove the OVERWRITE path reverses exactly, including its lineage.
select pg_temp.stage(
  'cccc9010-0000-0000-0000-000000000010'::uuid,
  jsonb_build_array(pg_temp.rh('main', '2026-08-07', 'equities', 61, 'changed', 60)));

select lives_ok(
  $$select public.nmi_import_portfolio_workbook(
      'cccc0005-0000-0000-0000-000000000005'::uuid, '2026-08-21'::date,
      'c1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
      pg_temp.rows_payload(130),
      jsonb_build_array(pg_temp.obs('2026-08-21','new',130)),
      '[]'::jsonb, true, 'the workbook restated an August row', '{}'::jsonb, null,
      jsonb_build_object(
        'rowHistoryStagingId', 'cccc9010-0000-0000-0000-000000000010',
        'rowHistoryRowCount', 1,
        'previousWeekDate', '2026-08-14'))$$,
  'an authorized row-level overwrite applies');

select is(
  (select value from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'equities'),
  61::numeric, 'the recorded value moved');
select is(
  (select import_operation_id from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'equities'),
  pg_temp.op_id('cccc0005-0000-0000-0000-000000000005'),
  'and the row now belongs to the import that overwrote it');

select lives_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('cccc0005-0000-0000-0000-000000000005'),
      'c1111111-1111-1111-1111-111111111111'::uuid, null)$$,
  'the overwrite reverses');

select is(
  (select value from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'equities'),
  60::numeric, 'rollback restored the exact before-image');
select is(
  (select import_operation_id from public.portfolio_row_history
    where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'equities'),
  pg_temp.op_id('cccc0002-0000-0000-0000-000000000002'),
  'and restored the LINEAGE, so a later rollback of the first import still chains');

-- A stale rollback is refused: a row this import wrote now belongs to another.
update public.portfolio_row_history
   set import_operation_id = pg_temp.op_id('cccc0005-0000-0000-0000-000000000005')
 where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'credit';

select throws_ok(
  $$select public.nmi_rollback_portfolio_import(
      pg_temp.op_id('cccc0002-0000-0000-0000-000000000002'),
      'c1111111-1111-1111-1111-111111111111'::uuid, null)$$,
  'rollback_refused_row_history_superseded_by_later_import',
  'a rollback whose rows a later import owns is refused WHOLE');

select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-07'),
  5, 'and not one row was reversed');

-- Put the lineage back so the RLS section reads a coherent book.
update public.portfolio_row_history
   set import_operation_id = pg_temp.op_id('cccc0002-0000-0000-0000-000000000002')
 where scope = 'main' and observation_date = date '2026-08-07' and row_key = 'credit';

-- ===========================================================================
-- 10 - RLS: the same isolation a publication row gets
-- ===========================================================================

select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'portfolio_row_history'),
  1, 'exactly one policy: a scope-filtered read');

select ok(has_table_privilege('authenticated', 'public.portfolio_row_history', 'SELECT'),
  'authenticated holds SELECT');
select ok(not has_table_privilege('authenticated', 'public.portfolio_row_history', 'INSERT'),
  'authenticated holds no INSERT');
select ok(not has_table_privilege('authenticated', 'public.portfolio_row_history', 'UPDATE'),
  'authenticated holds no UPDATE');
select ok(not has_table_privilege('authenticated', 'public.portfolio_row_history', 'DELETE'),
  'authenticated holds no DELETE');

-- The ledger and the relay carry every scope at once and stay service-role only.
select ok(not has_table_privilege('authenticated', 'public.portfolio_import_row_history_mutations', 'SELECT'),
  'authenticated cannot read the row-history ledger');
select ok(not has_table_privilege('authenticated', 'public.portfolio_row_history_staging', 'SELECT'),
  'authenticated cannot read the staging relay');
select ok(not has_table_privilege('anon', 'public.portfolio_row_history', 'SELECT'),
  'anon cannot read row history at all');

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.portfolio_row_history where observation_date = date '2026-08-07'),
  5, 'an administrator reads every scope');

select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.portfolio_row_history where scope = 'jaime'),
  1, 'JAIME reads his own scope');
select is(
  (select count(*)::int from public.portfolio_row_history where scope = 'andres'),
  0, 'JAIME cannot read ANDRES''s row history');
select ok(
  (select count(*)::int from public.portfolio_row_history where scope = 'main') > 0,
  'a principal holder still reads the family scope');

select pg_temp.as_user('c4444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from public.portfolio_row_history where scope = 'jaime'),
  0, 'ANDRES cannot read JAIME''s row history');
select is(
  (select count(*)::int from public.portfolio_row_history where scope = 'andres'),
  1, 'ANDRES reads his own scope');

select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select is(
  (select count(*)::int from public.portfolio_row_history
    where scope in ('jaime','andres','pablo')),
  0, 'an account with NO portfolio principal has no personal scope at all');

select pg_temp.as_anon();
select is(
  (select count(*)::int from public.portfolio_row_history),
  0, 'anon reads nothing');

select pg_temp.as_service();

-- The coverage view answers through the same predicate, not around it.
select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.portfolio_row_history_coverage where scope = 'andres'),
  0, 'the coverage view is scope-filtered too -- it is security_invoker');
select ok(
  (select count(*)::int from public.portfolio_row_history_coverage where scope = 'jaime') = 1,
  'and reports the reader''s own dates');

select pg_temp.as_service();

select * from finish();

rollback;
