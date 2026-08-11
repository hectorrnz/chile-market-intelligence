-- R13.R1 § 9/§ 16 — EXECUTABLE PostgreSQL validation of the weekly Portfolio
-- Evolution history table.
--
-- Run by `supabase test db` against an isolated, disposable local stack that has
-- had the FULL migration chain applied from a clean database — so this exercises
-- the real CHECK constraints, the real uniqueness constraint, the real GRANTs
-- and the real RLS predicate, not a static reading of the migration text.
--
-- The parallel STATIC checks (migration is additive, forward-only, never edits a
-- deployed file) live in tests/portfolioEvolutionHistory.test.ts and are
-- deliberately not repeated here.
--
-- Every identity and every amount below is a throwaway row created inside this
-- transaction and rolled back at the end. No production identity, credential, or
-- real portfolio figure appears anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — throwaway identities and one upload to hang observations off
-- ═══════════════════════════════════════════════════════════════════════════

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'evo_admin@test.invalid'),
  ('a3333333-3333-3333-3333-333333333333'::uuid, 'evo_jaime@test.invalid'),
  ('a6666666-6666-6666-6666-666666666666'::uuid, 'evo_plain@test.invalid'),
  ('a7777777-7777-7777-7777-777777777777'::uuid, 'evo_unapproved@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('a1111111-1111-1111-1111-111111111111', 'evo_admin', 'evo_admin@test.invalid', 'Evo Admin', 'administrator', null),
  ('a3333333-3333-3333-3333-333333333333', 'evo_jaime', 'evo_jaime@test.invalid', 'Evo Jaime', 'user',          'jaime'),
  ('a6666666-6666-6666-6666-666666666666', 'evo_plain', 'evo_plain@test.invalid', 'Evo Plain', 'user',          null),
  -- Approval is a NON-EMPTY username; this row has none and must be denied even
  -- though it carries a valid principal.
  ('a7777777-7777-7777-7777-777777777777', null,        'evo_unapp@test.invalid', 'Evo Unapp', 'user',          'jaime');

insert into public.portfolio_source_uploads
  (id, upload_kind, original_filename, file_sha256, file_size_bytes, storage_object_path,
   uploaded_by, parser_version, status)
values
  ('aeee1111-1111-1111-1111-111111111111', 'portfolio', 'evo-fixture.xlsx',
   repeat('a', 64), 1024, 'evo/fixture.xlsx', 'a1111111-1111-1111-1111-111111111111',
   'test.fixture', 'draft');

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · MIGRATION — table, constraints, index
-- ═══════════════════════════════════════════════════════════════════════════

select has_table('public', 'portfolio_evolution_observations',
  'portfolio_evolution_observations exists');

select col_not_null('public', 'portfolio_evolution_observations', 'value',
  'value is NOT NULL — a gap must be an absent row, never a null (or zero) observation');

select has_index('public', 'portfolio_evolution_observations',
  'portfolio_evolution_observations_series_idx',
  'the (scope, basis, observation_date) series index exists');

-- The scope CHECK must reject a scope the entitlement model does not know.
select throws_ok($$
  insert into public.portfolio_evolution_observations
    (scope, basis, observation_date, value, source_upload_id, source_sheet, source_cell,
     source_row_label, parser_version, extractor_version)
  values ('everyone', 'total', date '2025-01-03', 1, 'aeee1111-1111-1111-1111-111111111111',
          'RESUMEN', 'RESUMEN!A1', 'TOTAL', 'p', 'e')
$$, '23514', null, 'an unknown scope is refused by the CHECK constraint');

-- The basis CHECK must reject a basis outside the published performance vocabulary.
select throws_ok($$
  insert into public.portfolio_evolution_observations
    (scope, basis, observation_date, value, source_upload_id, source_sheet, source_cell,
     source_row_label, parser_version, extractor_version)
  values ('main', 'gross_of_fees', date '2025-01-03', 1, 'aeee1111-1111-1111-1111-111111111111',
          'RESUMEN', 'RESUMEN!A1', 'TOTAL', 'p', 'e')
$$, '23514', null, 'an unknown basis is refused by the CHECK constraint');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · IDEMPOTENCE — the uniqueness constraint is what makes re-ingest safe
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.portfolio_evolution_observations
  (scope, basis, observation_date, value, source_upload_id, source_sheet, source_cell,
   source_row_label, parser_version, extractor_version)
values
  ('main', 'ex_chilean_equities',   date '2024-08-23', 100, 'aeee1111-1111-1111-1111-111111111111', 'RESUMEN', 'RESUMEN!C83', 'SUBTOTAL', 'p1', 'e1'),
  ('main', 'with_chilean_equities', date '2024-08-23', 110, 'aeee1111-1111-1111-1111-111111111111', 'RESUMEN', 'RESUMEN!C87', 'TOTAL',    'p1', 'e1'),
  ('main', 'ex_chilean_equities',   date '2024-08-30', 101, 'aeee1111-1111-1111-1111-111111111111', 'RESUMEN', 'RESUMEN!D83', 'SUBTOTAL', 'p1', 'e1');

select throws_ok($$
  insert into public.portfolio_evolution_observations
    (scope, basis, observation_date, value, source_upload_id, source_sheet, source_cell,
     source_row_label, parser_version, extractor_version)
  values ('main', 'ex_chilean_equities', date '2024-08-23', 999, 'aeee1111-1111-1111-1111-111111111111',
          'RESUMEN', 'RESUMEN!C83', 'SUBTOTAL', 'p1', 'e1')
$$, '23505', null, 'a second observation for the same (scope, basis, week) is refused');

-- The upsert path the repository uses: same key, new value — one row, restated.
insert into public.portfolio_evolution_observations
  (scope, basis, observation_date, value, source_upload_id, source_sheet, source_cell,
   source_row_label, parser_version, extractor_version)
values ('main', 'ex_chilean_equities', date '2024-08-23', 105, 'aeee1111-1111-1111-1111-111111111111',
        'RESUMEN', 'RESUMEN!C83', 'SUBTOTAL', 'p2', 'e2')
on conflict (scope, basis, observation_date) do update
  set value = excluded.value, parser_version = excluded.parser_version,
      extractor_version = excluded.extractor_version;

select is(
  (select count(*)::int from public.portfolio_evolution_observations
    where scope = 'main' and basis = 'ex_chilean_equities' and observation_date = date '2024-08-23'),
  1, 'a re-ingest updates the week in place rather than adding a second observation');

select is(
  (select value from public.portfolio_evolution_observations
    where scope = 'main' and basis = 'ex_chilean_equities' and observation_date = date '2024-08-23'),
  105::numeric, 'the restated value replaced the earlier one');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · RLS — an evolution point is protected exactly like a snapshot row
-- ═══════════════════════════════════════════════════════════════════════════

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

-- A jaime-principal member holds `main`, so the Main series is readable.
select pg_temp.as_user('a3333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.portfolio_evolution_observations where scope = 'main'),
  3, 'an entitled member reads the main evolution series');

-- …and a scope they do not hold yields nothing, enforced by the database.
select pg_temp.as_service();
insert into public.portfolio_evolution_observations
  (scope, basis, observation_date, value, source_upload_id, source_sheet, source_cell,
   source_row_label, parser_version, extractor_version)
values ('andres', 'total', date '2024-08-23', 50, 'aeee1111-1111-1111-1111-111111111111',
        'RESUMEN', 'RESUMEN!C205', 'TOTAL ANDRES', 'p1', 'e1');

select pg_temp.as_user('a3333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.portfolio_evolution_observations where scope = 'andres'),
  0, 'JAIME cannot read the ANDRES evolution series');

-- An approved member with NO principal still holds `main` (the shared book).
select pg_temp.as_service();
select pg_temp.as_user('a6666666-6666-6666-6666-666666666666');
select is(
  (select count(*)::int from public.portfolio_evolution_observations where scope = 'andres'),
  0, 'a principal-less member cannot read a personal evolution series');

-- An UNAPPROVED account reads nothing at all, principal notwithstanding.
select pg_temp.as_service();
select pg_temp.as_user('a7777777-7777-7777-7777-777777777777');
select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  0, 'an unapproved account reads no evolution observation of any scope');

-- Anonymous reads nothing.
select pg_temp.as_service();
select pg_temp.as_anon();
select is(
  (select count(*)::int from public.portfolio_evolution_observations),
  0, 'anon reads no evolution observation');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · WRITES ARE SERVICE-ROLE ONLY
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();

select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'portfolio_evolution_observations'
      and cmd <> 'SELECT'),
  0, 'no insert/update/delete policy exists for authenticated');

select ok(
  not has_table_privilege('authenticated', 'public.portfolio_evolution_observations', 'INSERT'),
  'authenticated holds no INSERT privilege');
select ok(
  not has_table_privilege('authenticated', 'public.portfolio_evolution_observations', 'UPDATE'),
  'authenticated holds no UPDATE privilege');
select ok(
  not has_table_privilege('authenticated', 'public.portfolio_evolution_observations', 'DELETE'),
  'authenticated holds no DELETE privilege');
select ok(
  has_table_privilege('authenticated', 'public.portfolio_evolution_observations', 'SELECT'),
  'authenticated holds SELECT');
select ok(
  not has_table_privilege('anon', 'public.portfolio_evolution_observations', 'SELECT'),
  'anon holds no SELECT privilege');

select * from finish();
rollback;
