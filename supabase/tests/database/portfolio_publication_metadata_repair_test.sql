-- POST-R13.8 FOLLOW-UP F § 6 -- EXECUTABLE validation of the bounded
-- publication-metadata repair mechanism.
--
-- WHY THIS FILE EXISTS. Every claim the repair makes is about real PostgreSQL
-- behaviour and cannot be proved by reading TypeScript:
--
--   * a packet that matches the world applies, all of it, once;
--   * a packet whose expected STORED value has moved refuses ENTIRELY -- zero
--     rows corrected, not "the six that still matched";
--   * a packet whose expected REVISION has moved refuses entirely;
--   * a corrected anchor on or after its own week is refused, because that is
--     the very defect being repaired;
--   * a failure LATE in a multi-entry packet rolls back every earlier
--     correction in the same transaction;
--   * a retry of the same operation id is idempotent and creates no second
--     audit record;
--   * not one financial row changes, on any of these paths;
--   * `authenticated` and `anon` cannot invoke the repair at all;
--   * and the PROSPECTIVE importer fix still holds, so the past being repaired
--     cannot be recreated by the next restatement.
--
-- HOW THE ATOMICITY PROOF IS MADE NON-VACUOUS (§ 6E). The failing packet is
-- ordered so the failure comes LAST: three entries that would each apply
-- cleanly, then a fourth whose stored value does not match. If the transaction
-- were not atomic the first three corrections would still stand afterwards.
-- Every assertion after the `throws_ok` re-reads `portfolio_publications` and
-- proves they do not.
--
-- `throws_ok` runs its query inside a plpgsql exception block, which is a real
-- subtransaction: catching the error rolls back everything the function did,
-- exactly as a failed RPC call would. `lives_ok` is its counterpart -- on
-- success nothing is rolled back, so later assertions can read the effects.
--
-- All identities and values are throwaway rows created inside this transaction
-- and rolled back at the end. No production identity, publication id or
-- portfolio value appears anywhere in this file.

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
  ('d1111111-1111-1111-1111-111111111111'::uuid, 'mr_admin@test.invalid'),
  ('d3333333-3333-3333-3333-333333333333'::uuid, 'mr_jaime@test.invalid'),
  ('d6666666-6666-6666-6666-666666666666'::uuid, 'mr_plain@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('d1111111-1111-1111-1111-111111111111', 'mr_admin', 'mr_admin@test.invalid', 'MR Admin', 'administrator', null),
  ('d3333333-3333-3333-3333-333333333333', 'mr_jaime', 'mr_jaime@test.invalid', 'MR Jaime', 'user',          'jaime'),
  ('d6666666-6666-6666-6666-666666666666', 'mr_plain', 'mr_plain@test.invalid', 'MR Plain', 'user',          null);

update public.user_profiles set activated_at = now()
 where activated_at is null and disabled_at is null;

insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version, status)
values
  ('dddd0001-0000-0000-0000-000000000001', 'portfolio', 'private/mr1.xlsx', 'mr1.xlsx',
   repeat('a', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft'),
  ('dddd0002-0000-0000-0000-000000000002', 'portfolio', 'private/mr2.xlsx', 'mr2.xlsx',
   repeat('b', 64), 1000, 'd1111111-1111-1111-1111-111111111111', 'test.parser.1', 'draft');

-- Role switching, through the same helper shape every other Family Portfolio
-- suite uses, so a session role can never be set two different ways in one
-- repository.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role postgres';
end $$;

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

create or replace function pg_temp.perf_payload(p_value numeric)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'scope', 'main', 'basis', 'ex_chilean_equities', 'metric', 'flow',
    'value', p_value, 'value_class', 'source_provided_flow',
    'source_sheet', 'RESUMEN', 'source_cell', 'DA97'));
$$;

-- FOUR weeks, each carrying the SAME impossible anchor the production defect
-- produced: a "previous week" after the week it claims to precede.
do $$
declare
  d date;
  i int := 0;
begin
  foreach d in array array['2026-06-19'::date, '2026-06-26'::date,
                           '2026-07-03'::date, '2026-07-10'::date]
  loop
    i := i + 1;
    perform public.nmi_publish_portfolio(
      'dddd0001-0000-0000-0000-000000000001'::uuid, d,
      'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1',
      pg_temp.rows_payload(100 + i), pg_temp.perf_payload(10 + i), null,
      jsonb_build_object('previousWeekDate', '2026-08-28',
                         'historicalRestatement', true));
  end loop;
end $$;

-- The source-backed reporting spine those weeks belong to.
insert into public.portfolio_evolution_observations
  (scope, basis, observation_date, value, currency, source_upload_id,
   source_sheet, source_cell, source_row_label, parser_version, extractor_version)
select 'main', 'ex_chilean_equities', d, 100, 'USD',
       'dddd0001-0000-0000-0000-000000000001', 'RESUMEN', 'AA10', 'TOTAL',
       'test.parser.1', 'test.extractor.1'
from unnest(array['2026-06-12'::date, '2026-06-19'::date, '2026-06-26'::date,
                  '2026-07-03'::date, '2026-07-10'::date]) d;

-- A packet builder, so each case below reads as intent rather than as JSON.
-- `p_stored` and `p_revision` are overridable precisely so the refusal cases can
-- state a WRONG expectation without hand-writing a whole packet.
create or replace function pg_temp.entry(
  p_as_of text, p_corrected text,
  p_stored text default '2026-08-28',
  p_revision int default null,
  p_is_current boolean default true,
  p_kind text default 'portfolio')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'publicationId', (select id::text from public.portfolio_publications
                       where upload_kind = 'portfolio' and as_of_date = p_as_of::date and is_current),
    'asOfDate', p_as_of,
    'expectedRevision', coalesce(p_revision,
      (select revision from public.portfolio_publications
        where upload_kind = 'portfolio' and as_of_date = p_as_of::date and is_current)),
    'expectedIsCurrent', p_is_current,
    'expectedUploadKind', p_kind,
    'expectedValue', p_stored,
    'correctedValue', p_corrected);
$$;

create or replace function pg_temp.packet(p_op text, p_entries jsonb, p_field text default 'previousWeekDate')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'operationId', p_op,
    'packetHash', 'sha256-' || p_op,
    'actor', 'MR Admin',
    'reason', 'Correct previousWeekDate metadata written during the R13.8 historical publication restatement.',
    'field', p_field,
    'expectedCount', jsonb_array_length(p_entries),
    'entries', p_entries);
$$;

-- The financial fingerprint of the whole fixture book. Any change to it, on any
-- path below, is a failure -- this is the § 6G invariance proof.
create or replace function pg_temp.financial_fingerprint()
returns text
language sql
as $$
  select coalesce(
    (select md5(string_agg(x, '|' order by x)) from (
       select p.as_of_date::text || ':' || p.revision::text || ':' ||
              coalesce(sum(s.value)::text, 'x') || ':' || count(s.id)::text as x
         from public.portfolio_publications p
         left join public.portfolio_snapshot_rows s on s.publication_id = p.id
        where p.upload_kind = 'portfolio'
        group by p.id, p.as_of_date, p.revision
     ) a), 'empty')
  || '/' ||
  coalesce(
    (select md5(string_agg(y, '|' order by y)) from (
       select p.as_of_date::text || ':' || coalesce(sum(f.value)::text, 'x')
              || ':' || count(f.id)::text as y
         from public.portfolio_publications p
         left join public.portfolio_performance_rows f on f.publication_id = p.id
        where p.upload_kind = 'portfolio'
        group by p.id, p.as_of_date
     ) b), 'empty');
$$;

create temporary table mr_baseline as
  select pg_temp.financial_fingerprint() as fp;


-- ===========================================================================
-- 1 - Schema and posture
-- ===========================================================================

select has_table('public', 'portfolio_publication_metadata_repairs',
  'the repair operation ledger exists');
select has_table('public', 'portfolio_publication_metadata_repair_entries',
  'the per-publication before/after ledger exists');

select has_function('public', 'nmi_repair_portfolio_publication_metadata', array['jsonb'],
  'the atomic repair function exists');
select has_function('public', 'nmi_portfolio_repairable_metadata_fields', array[]::text[],
  'the repairable-key allowlist is addressable');

select is(
  (select prosecdef from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nmi_repair_portfolio_publication_metadata'),
  false,
  'the repair function is SECURITY INVOKER, never DEFINER');

select ok(
  (select array_to_string(coalesce(proconfig, array[]::text[]), ',')
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_repair_portfolio_publication_metadata')
  like '%search_path=%',
  'the repair function pins search_path');

select is(
  (select public.nmi_portfolio_repairable_metadata_fields()),
  array['previousWeekDate', 'beginningOfYearDate']::text[],
  'the allowlist is exactly the two spine anchors');

select ok(
  (select relrowsecurity from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'portfolio_publication_metadata_repairs'),
  'the repair operation ledger has RLS enabled');
select ok(
  (select relrowsecurity from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'portfolio_publication_metadata_repair_entries'),
  'the repair entry ledger has RLS enabled');


-- ===========================================================================
-- 2 (§ 6H) - Authorization: only service_role may invoke the repair
-- ===========================================================================

select ok(
  not has_function_privilege('authenticated',
    'public.nmi_repair_portfolio_publication_metadata(jsonb)', 'execute'),
  'an authenticated member cannot execute the repair function');

select ok(
  not has_function_privilege('anon',
    'public.nmi_repair_portfolio_publication_metadata(jsonb)', 'execute'),
  'anon cannot execute the repair function');

select ok(
  has_function_privilege('service_role',
    'public.nmi_repair_portfolio_publication_metadata(jsonb)', 'execute'),
  'service_role can execute the repair function (§ 6I)');

select ok(
  not has_table_privilege('authenticated',
    'public.portfolio_publication_metadata_repairs', 'select'),
  'an authenticated member cannot read the repair ledger');
select ok(
  not has_table_privilege('anon',
    'public.portfolio_publication_metadata_repair_entries', 'select'),
  'anon cannot read the repair entry ledger');

-- A member session reaching the table directly is stopped by RLS as well as by
-- the privilege, so removing one grant does not silently open the other door.
select pg_temp.as_user('d3333333-3333-3333-3333-333333333333');

-- `authenticated` holds no SELECT privilege on this table at all, so counting
-- rows does not return 0 -- it raises 42501. Denial is asserted by proving the
-- refusal, never by requiring the member to be able to run the query.
select throws_ok(
  $$ select count(*) from public.portfolio_publication_metadata_repairs $$,
  '42501', null,
  'Jaime is refused at the privilege layer when reading the repair ledger');

select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata('{}'::jsonb) $$,
  '42501', null,
  'a member session cannot invoke the repair function at all -- not even to be refused by it');

select pg_temp.as_service();


-- ===========================================================================
-- 3 (§ 6B, 6C, 6D) - Every precondition refuses the WHOLE packet
-- ===========================================================================

-- § 6B - the stored value has moved since the plan was reviewed.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-bad-stored',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12', '2026-01-01')))) $$,
  'repair_refused_stored_value_mismatch',
  'a packet whose expected stored value no longer stands is refused');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repairs),
  0,
  'the refused stored-value packet corrected nothing and recorded nothing');

-- § 6C - the revision has moved.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-bad-rev',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12', '2026-08-28', 99)))) $$,
  'repair_refused_revision_mismatch',
  'a packet whose expected revision no longer stands is refused');

-- § 6D - a corrected date that is not strictly before its own week.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-not-before',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-19')))) $$,
  'repair_refused_corrected_value_not_before_publication',
  'a corrected anchor equal to its own week is refused');

select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-after',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-08-28')))) $$,
  'repair_refused_corrected_value_not_before_publication',
  'a corrected anchor after its own week is refused -- the defect cannot be rewritten');

-- The is_current expectation is part of identity, not decoration.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-not-current',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12', '2026-08-28', null, false)))) $$,
  'repair_refused_is_current_mismatch',
  'a packet expecting a superseded revision is refused');

-- A key outside the allowlist can never be written, whatever the packet says.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-bad-field',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12')),
         'parserVersion')) $$,
  'repair_refused_field_not_repairable',
  'a metadata key outside the allowlist is refused');

-- A declared count that disagrees with the entries is a malformed packet.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-bad-count',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12')))
       || jsonb_build_object('expectedCount', 4)) $$,
  'repair_refused_expected_count_mismatch',
  'a packet whose expectedCount disagrees with its entries is refused');

-- The same publication twice is a contradiction, not two corrections.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-dupe',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12'),
                           pg_temp.entry('2026-06-19', '2026-06-12')))) $$,
  'repair_refused_duplicate_publication_in_packet',
  'a packet naming one publication twice is refused');

-- A generic placeholder is not a reason.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-no-reason',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12')))
       || jsonb_build_object('reason', 'fix')) $$,
  'repair_refused_reason_missing',
  'a packet without a real written reason is refused');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repairs),
  0,
  'not one refusal above created an audit record');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and (metadata ->> 'previousWeekDate') <> '2026-08-28'),
  0,
  'not one refusal above changed a stored anchor');


-- ===========================================================================
-- 4 (§ 6E) - A LATE failure rolls back every earlier correction
-- ===========================================================================
--
-- Three entries that would each apply cleanly, then a fourth that cannot. If
-- the function were not atomic, 06-19, 06-26 and 07-03 would be corrected
-- afterwards. The assertions below prove they are not.

select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-late-failure', jsonb_build_array(
         pg_temp.entry('2026-06-19', '2026-06-12'),
         pg_temp.entry('2026-06-26', '2026-06-19'),
         pg_temp.entry('2026-07-03', '2026-06-26'),
         pg_temp.entry('2026-07-10', '2026-07-03', '2026-01-01')))) $$,
  'repair_refused_stored_value_mismatch',
  'a packet failing on its LAST entry is refused as a whole');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current
      and (metadata ->> 'previousWeekDate') <> '2026-08-28'),
  0,
  'the three corrections BEFORE the late failure rolled back -- all four anchors still read 2026-08-28');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repairs
    where operation_id = 'mr-late-failure'),
  0,
  'the rolled-back operation left no audit record');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repair_entries),
  0,
  'the rolled-back operation left no audit entries');


-- ===========================================================================
-- 5 (§ 6A) - The exact packet applies, once, completely
-- ===========================================================================

select lives_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-apply-1', jsonb_build_array(
         pg_temp.entry('2026-06-19', '2026-06-12'),
         pg_temp.entry('2026-06-26', '2026-06-19'),
         pg_temp.entry('2026-07-03', '2026-06-26'),
         pg_temp.entry('2026-07-10', '2026-07-03')))) $$,
  'the reviewed four-entry packet applies');

select is(
  (select metadata ->> 'previousWeekDate' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-06-19' and is_current),
  '2026-06-12',
  '2026-06-19 now records its real source predecessor');
select is(
  (select metadata ->> 'previousWeekDate' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-06-26' and is_current),
  '2026-06-19',
  '2026-06-26 now records its real source predecessor');
select is(
  (select metadata ->> 'previousWeekDate' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-07-03' and is_current),
  '2026-06-26',
  '2026-07-03 now records its real source predecessor');
select is(
  (select metadata ->> 'previousWeekDate' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-07-10' and is_current),
  '2026-07-03',
  '2026-07-10 now records its real source predecessor');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and is_current
      and (metadata ->> 'previousWeekDate')::date >= as_of_date),
  0,
  'no current portfolio publication carries an impossible anchor any more');

-- Every other metadata key the publication carried survives the repair.
select is(
  (select metadata ->> 'historicalRestatement' from public.portfolio_publications
    where upload_kind = 'portfolio' and as_of_date = '2026-06-19' and is_current),
  'true',
  'the repair merged one key and preserved the rest of the metadata');

select is(
  (select entry_count from public.portfolio_publication_metadata_repairs
    where operation_id = 'mr-apply-1'),
  4,
  'the audit record accounts for exactly four corrections');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repair_entries e
     join public.portfolio_publication_metadata_repairs r on r.id = e.repair_id
    where r.operation_id = 'mr-apply-1'),
  4,
  'four before/after entries were recorded');

select is(
  (select count(distinct previous_value)::int
     from public.portfolio_publication_metadata_repair_entries e
     join public.portfolio_publication_metadata_repairs r on r.id = e.repair_id
    where r.operation_id = 'mr-apply-1'),
  1,
  'every entry recorded the same wrong before-image');

select is(
  (select distinct previous_value
     from public.portfolio_publication_metadata_repair_entries e
     join public.portfolio_publication_metadata_repairs r on r.id = e.repair_id
    where r.operation_id = 'mr-apply-1'),
  '2026-08-28',
  'the before-image is the impossible anchor, preserved for audit');


-- ===========================================================================
-- 6 (§ 6G) - Not one financial row moved
-- ===========================================================================

select is(
  pg_temp.financial_fingerprint(),
  (select fp from mr_baseline),
  'every snapshot row, performance row, revision and publication count is byte-identical after the repair');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and revision <> 1),
  0,
  'the repair minted no revision -- a metadata correction is not a restatement');

select is(
  (select count(*)::int from public.portfolio_publications
    where upload_kind = 'portfolio' and superseded_by is not null),
  0,
  'the repair superseded no publication');


-- ===========================================================================
-- 7 (§ 6F) - Retry is idempotent
-- ===========================================================================

select is(
  (select public.nmi_repair_portfolio_publication_metadata(
     pg_temp.packet('mr-apply-1', jsonb_build_array(
       pg_temp.entry('2026-06-19', '2026-06-12'),
       pg_temp.entry('2026-06-26', '2026-06-19'),
       pg_temp.entry('2026-07-03', '2026-06-26'),
       pg_temp.entry('2026-07-10', '2026-07-03')))) ->> 'status'),
  'already_applied',
  'replaying the same operation id reports already_applied rather than re-applying');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repairs
    where operation_id = 'mr-apply-1'),
  1,
  'the retry created no second audit record');

select is(
  (select count(*)::int from public.portfolio_publication_metadata_repair_entries),
  4,
  'the retry created no duplicate audit entries');

select is(
  pg_temp.financial_fingerprint(),
  (select fp from mr_baseline),
  'the retry changed no financial row either');

-- Reusing an operation id with DIFFERENT content is a mistake, not a retry.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-apply-1',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-05', '2026-06-12')))
       || jsonb_build_object('packetHash', 'sha256-different')) $$,
  'repair_refused_operation_id_reused_with_different_packet',
  'the same operation id carrying different content is refused, never reported as applied');

-- Once corrected, a fresh operation over the same weeks has nothing to do and
-- says so rather than writing the value again.
select throws_ok(
  $$ select public.nmi_repair_portfolio_publication_metadata(
       pg_temp.packet('mr-apply-2',
         jsonb_build_array(pg_temp.entry('2026-06-19', '2026-06-12', '2026-06-12')))) $$,
  'repair_refused_nothing_to_correct',
  'a correction that would write the value already standing is refused');


-- ===========================================================================
-- 8 (§ 6J) - The PROSPECTIVE importer fix still holds
-- ===========================================================================
--
-- Repairing the past is worth nothing if the next restatement recreates it.
-- These two assertions are about the IMPORT path, not the repair path.

select throws_ok(
  $$ select public.nmi_import_portfolio_workbook(
       'dddd0002-0000-0000-0000-000000000002'::uuid, '2026-07-17'::date,
       'd1111111-1111-1111-1111-111111111111'::uuid, 'test.parser.1', 'test.plan.1',
       pg_temp.rows_payload(200),
       '[]'::jsonb, '[]'::jsonb, false, null, '{}'::jsonb, null,
       jsonb_build_object('previousWeekDate', '2026-07-24')) $$,
  'import_refused_impossible_previous_week_date',
  'the importer still refuses an import anchor on or after the week it publishes');

select ok(
  (select pg_catalog.pg_get_functiondef(p.oid)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_import_portfolio_workbook')
  like '%h.previous_week_date%',
  'a restated historical week still carries ITS OWN anchor, not the import''s');


-- ===========================================================================
-- 9 - The repair function can never write a financial table
-- ===========================================================================

select ok(
  (select pg_catalog.pg_get_functiondef(p.oid)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_repair_portfolio_publication_metadata')
  !~* '(update|delete\s+from|insert\s+into)\s+public\.portfolio_(snapshot_rows|performance_rows|evolution_observations)',
  'the repair function contains no write against any financial table');

select ok(
  (select pg_catalog.pg_get_functiondef(p.oid)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_repair_portfolio_publication_metadata')
  !~* '\mexecute\M',
  'the repair function contains no dynamic SQL');


select * from finish();
rollback;
