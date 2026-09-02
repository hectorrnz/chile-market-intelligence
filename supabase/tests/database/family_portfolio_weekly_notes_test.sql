-- R13.R2C §§ 8-11, § 33 — EXECUTABLE PostgreSQL validation of the multiple
-- Weekly Notes table.
--
-- Run by `supabase test db` against an isolated, disposable local stack that has
-- had the FULL migration chain applied from a clean database — so this exercises
-- the real CHECK constraints, the real GRANTs and the real RLS predicates, not a
-- static reading of the migration text.
--
-- THE PROPERTIES UNDER TEST:
--   * SEVERAL notes can be live for one (publication, scope) at once — the thing
--     `portfolio_commentary` structurally cannot do.
--   * Each note has its own identity, so editing or deleting one leaves the
--     others exactly as they were.
--   * A deleted note is a TOMBSTONE, and it disappears at the DATABASE, not
--     merely in the application's filter.
--   * The scope predicate is the same one every other portfolio table uses, so
--     a note can never be visible to a caller who could not read the week it
--     annotates.
--   * `authenticated` cannot write at all. Every mutation is service-role,
--     performed behind the API's own administrator check.
--
-- Every identity below is a throwaway row created inside this transaction and
-- rolled back at the end. No portfolio figure appears here.

begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — an administrator, a Main-entitled member, a personal-only
--     member, a scopeless account, and one publication to annotate
-- ═══════════════════════════════════════════════════════════════════════════

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'note_admin@test.invalid'),
  ('c3333333-3333-3333-3333-333333333333'::uuid, 'note_jaime@test.invalid'),
  ('c6666666-6666-6666-6666-666666666666'::uuid, 'note_plain@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('c1111111-1111-1111-1111-111111111111', 'note_admin', 'note_admin@test.invalid', 'Note Admin', 'administrator', null),
  -- A personal principal: reads `main` and its own scope, per the R13.1 matrix.
  ('c3333333-3333-3333-3333-333333333333', 'note_jaime', 'note_jaime@test.invalid', 'Note Jaime', 'user', 'jaime'),
  -- Approved but principal-less: holds NO portfolio scope, so it reads nothing.
  ('c6666666-6666-6666-6666-666666666666', 'note_plain', 'note_plain@test.invalid', 'Note Plain', 'user', null);

-- R13.6F — these fixtures represent ACTIVE accounts.
--
-- The R13.6F lifecycle migration added invited_at/activated_at/disabled_at, and
-- an account is authorized only when it is approved AND activated AND not
-- disabled. Those columns are deliberately NULL by default, because a freshly
-- INVITED account is not yet activated -- so a fixture meant to be live must
-- say so, exactly as real provisioning does. Without it every assertion below
-- would pass for the WRONG reason: denied because the fixture was never
-- activated, rather than because the rule under test denied it.
update public.user_profiles set activated_at = now()
 where activated_at is null and disabled_at is null;

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

-- One upload + one publication for the notes to hang off.
--
-- EVERY NOT NULL COLUMN WITHOUT A DEFAULT IS SUPPLIED, and that is the point of
-- listing them explicitly: `portfolio_source_uploads.file_size_bytes` (which
-- also carries a `> 0` CHECK) and `.parser_version` are both required by the
-- current schema, and omitting them aborts this script during fixture setup —
-- before a single assertion runs. The column list mirrors the one the
-- evolution-history suite already uses for the same table, so the two fixtures
-- cannot drift apart. The fix belongs here, in the test: the schema requires a
-- real size and a real parser build for every upload, and that requirement is
-- correct.
insert into public.portfolio_source_uploads
  (id, upload_kind, original_filename, file_sha256, file_size_bytes, storage_object_path,
   uploaded_by, parser_version)
values
  ('cf000000-0000-0000-0000-0000000000f1', 'portfolio', 'notes_test.xlsx',
   repeat('a', 64), 1024, 'notes/test.xlsx',
   'c1111111-1111-1111-1111-111111111111', 'test.parser.1');

insert into public.portfolio_publications
  (id, upload_kind, upload_id, as_of_date, revision, is_current, published_by, parser_version)
values
  ('cf000000-0000-0000-0000-0000000000f2', 'portfolio', 'cf000000-0000-0000-0000-0000000000f1',
   date '2026-07-31', 1, true, 'c1111111-1111-1111-1111-111111111111', 'test.parser.1');

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Shape
-- ═══════════════════════════════════════════════════════════════════════════

select has_table('public', 'family_portfolio_weekly_notes', 'the weekly-notes table exists');

select ok(
  (select relrowsecurity from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'family_portfolio_weekly_notes'),
  'row level security is enabled');

select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_weekly_notes' and cmd <> 'SELECT'),
  0, 'the table carries no non-SELECT policy — writes are service-role only');

select ok(not has_table_privilege('authenticated', 'public.family_portfolio_weekly_notes', 'INSERT'),
  'authenticated cannot INSERT a note');
select ok(not has_table_privilege('authenticated', 'public.family_portfolio_weekly_notes', 'UPDATE'),
  'authenticated cannot UPDATE a note');
select ok(not has_table_privilege('authenticated', 'public.family_portfolio_weekly_notes', 'DELETE'),
  'authenticated cannot DELETE a note');
select ok(not has_table_privilege('anon', 'public.family_portfolio_weekly_notes', 'SELECT'),
  'anon cannot read a note');

-- `portfolio_commentary` is untouched — the reason this table exists.
select ok(
  (select count(*)::int from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'portfolio_commentary_current_idx') = 1,
  'the one-live-revision index on portfolio_commentary still stands');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · Validation — an empty body and an over-long body are refused
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();

select throws_ok($$
  insert into public.family_portfolio_weekly_notes (publication_id, scope, body, created_by)
  values ('cf000000-0000-0000-0000-0000000000f2', 'main', '   ',
          'c1111111-1111-1111-1111-111111111111')
$$, '23514', null, 'a whitespace-only body is refused by the CHECK');

select throws_ok($$
  insert into public.family_portfolio_weekly_notes (publication_id, scope, body, created_by)
  values ('cf000000-0000-0000-0000-0000000000f2', 'main', repeat('x', 4001),
          'c1111111-1111-1111-1111-111111111111')
$$, '23514', null, 'a body over the 4000-character limit is refused by the CHECK');

select throws_ok($$
  insert into public.family_portfolio_weekly_notes (publication_id, scope, body, created_by)
  values ('cf000000-0000-0000-0000-0000000000f2', 'not_a_scope', 'x',
          'c1111111-1111-1111-1111-111111111111')
$$, '23514', null, 'an unknown scope is refused by the CHECK');

select throws_ok($$
  insert into public.family_portfolio_weekly_notes (publication_id, scope, body, created_by, deleted_at)
  values ('cf000000-0000-0000-0000-0000000000f2', 'main', 'half a tombstone',
          'c1111111-1111-1111-1111-111111111111', now())
$$, '23514', null, 'a tombstone without an author is refused — both columns or neither');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · SEVERAL live notes for one week — the property commentary cannot provide
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.family_portfolio_weekly_notes
  (id, publication_id, scope, body, display_order, created_by)
values
  ('cf000000-0000-0000-0000-00000000000a', 'cf000000-0000-0000-0000-0000000000f2', 'main',
   'first note', 0, 'c1111111-1111-1111-1111-111111111111'),
  ('cf000000-0000-0000-0000-00000000000b', 'cf000000-0000-0000-0000-0000000000f2', 'main',
   'second note', 1, 'c1111111-1111-1111-1111-111111111111'),
  ('cf000000-0000-0000-0000-00000000000c', 'cf000000-0000-0000-0000-0000000000f2', 'main',
   'third note', 2, 'c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.family_portfolio_weekly_notes
    where publication_id = 'cf000000-0000-0000-0000-0000000000f2' and scope = 'main' and deleted_at is null),
  3, 'three notes are live for the same week and scope at once');

select is(
  (select string_agg(body, '|' order by display_order, created_at, id)
     from public.family_portfolio_weekly_notes
    where publication_id = 'cf000000-0000-0000-0000-0000000000f2' and scope = 'main' and deleted_at is null),
  'first note|second note|third note',
  'ordering is deterministic: display_order, then created_at, then id');

-- ── Independent edit ──────────────────────────────────────────────────────────
--
-- The edit DELIBERATELY supplies a stale sentinel for `updated_at`. A caller can
-- set that column, so the guarantee worth testing is that the BEFORE UPDATE
-- trigger overrides whatever was supplied — which is exactly what stops a
-- client-chosen timestamp from landing in the audit trail. The sentinel makes
-- that provable inside a single transaction; see the assertion below.
update public.family_portfolio_weekly_notes
   set body = 'second note, corrected', updated_by = 'c1111111-1111-1111-1111-111111111111',
       updated_at = timestamptz '1999-01-01 00:00:00+00'
 where id = 'cf000000-0000-0000-0000-00000000000b';

select is(
  (select body from public.family_portfolio_weekly_notes
    where id = 'cf000000-0000-0000-0000-00000000000b'),
  'second note, corrected', 'editing one note changes that note');

select is(
  (select string_agg(body, '|' order by display_order)
     from public.family_portfolio_weekly_notes
    where id in ('cf000000-0000-0000-0000-00000000000a', 'cf000000-0000-0000-0000-00000000000c')),
  'first note|third note', 'and leaves its siblings untouched');

-- THE TRIGGER IS PROVED BY OVERWRITE, NOT BY WALL-CLOCK ADVANCEMENT. A pgTAP
-- suite runs entirely inside ONE transaction, and `now()` is
-- transaction_timestamp() — it does not advance within it. So `created_at`
-- (DEFAULT now()) and the trigger's `new.updated_at := now()` hold the IDENTICAL
-- value here, and the old `updated_at > created_at` assertion failed even though
-- the trigger fired correctly. Asserting against the stale sentinel the edit
-- supplied is transaction-safe AND a stronger statement: if the trigger were
-- dropped, `updated_at` would still be 1999 and this fails immediately.
select ok(
  (select updated_at <> timestamptz '1999-01-01 00:00:00+00'
      and updated_at  > timestamptz '1999-01-01 00:00:00+00'
     from public.family_portfolio_weekly_notes
    where id = 'cf000000-0000-0000-0000-00000000000b'),
  'the updated_at trigger overwrote the stale value the edit supplied');

-- ── Independent delete, as a tombstone ────────────────────────────────────────
update public.family_portfolio_weekly_notes
   set deleted_at = now(), deleted_by = 'c1111111-1111-1111-1111-111111111111'
 where id = 'cf000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.family_portfolio_weekly_notes
    where publication_id = 'cf000000-0000-0000-0000-0000000000f2' and deleted_at is null),
  2, 'deleting one note leaves exactly the other two live');

select ok(
  (select deleted_at is not null from public.family_portfolio_weekly_notes
    where id = 'cf000000-0000-0000-0000-00000000000a'),
  'the deleted note is RETAINED as a tombstone, not erased');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Reads, as real principals under real RLS
-- ═══════════════════════════════════════════════════════════════════════════

-- A Main-entitled member reads the LIVE notes and cannot see the tombstone.
select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.family_portfolio_weekly_notes),
  2, 'an entitled member reads exactly the live notes');

select is(
  (select count(*)::int from public.family_portfolio_weekly_notes
    where id = 'cf000000-0000-0000-0000-00000000000a'),
  0, 'a deleted note is invisible AT THE DATABASE, not merely filtered by the app');

-- A member cannot write, however the request is crafted.
select throws_ok($$
  insert into public.family_portfolio_weekly_notes (publication_id, scope, body, created_by)
  values ('cf000000-0000-0000-0000-0000000000f2', 'main', 'member note',
          'c3333333-3333-3333-3333-333333333333')
$$, '42501', null, 'a member cannot INSERT a note');

select throws_ok($$
  update public.family_portfolio_weekly_notes set body = 'member edit'
   where id = 'cf000000-0000-0000-0000-00000000000b'
$$, '42501', null, 'a member cannot UPDATE a note');

select throws_ok($$
  delete from public.family_portfolio_weekly_notes
   where id = 'cf000000-0000-0000-0000-00000000000b'
$$, '42501', null, 'a member cannot DELETE a note');

-- An approved account with no portfolio principal reads nothing.
select pg_temp.as_user('c6666666-6666-6666-6666-666666666666');
select is(
  (select count(*)::int from public.family_portfolio_weekly_notes),
  0, 'an account with no portfolio scope reads no note');

-- Anonymous reads nothing.
select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.family_portfolio_weekly_notes $$,
  '42501', null, 'anon cannot read the notes table at all');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · Scope isolation — a note on a scope the reader does not hold
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();
insert into public.family_portfolio_weekly_notes (id, publication_id, scope, body, created_by)
values ('cf000000-0000-0000-0000-00000000000d', 'cf000000-0000-0000-0000-0000000000f2', 'pablo',
        'a note on another member''s scope', 'c1111111-1111-1111-1111-111111111111');

select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.family_portfolio_weekly_notes where scope = 'pablo'),
  0, 'Jaime cannot read a note written on Pablo''s scope');

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select ok(
  (select count(*)::int from public.family_portfolio_weekly_notes where scope = 'pablo') = 1,
  'an administrator retains authorized all-scope visibility');

select * from finish();
rollback;
