-- POST-R13.6CDE-C § 19 — EXECUTABLE PostgreSQL validation of the module-grant
-- audit trail added by 20260816000000_module_grant_audit.sql.
--
-- WHY THIS FILE EXISTS. That migration already carries strong postconditions,
-- but they interrogate the CATALOG: the column exists, the CHECK text mentions
-- all three kinds, the policy set is unchanged. A catalog assertion cannot show
-- that the constraints actually REJECT a malformed row, that the service role
-- can really write one, or that a member really cannot. Those are behavioural
-- claims, and only real INSERTs against real PostgreSQL settle them.
--
-- DENIAL SHAPES, distinguished carefully — asserting the wrong one would make a
-- test vacuous:
--   · no privilege at all (authenticated holds SELECT only)  -> ERROR 42501
--   · a violated CHECK constraint                            -> ERROR 23514
--   · a violated FOREIGN KEY, or ON DELETE RESTRICT          -> ERROR 23503
--   · SELECT filtered by RLS                                 -> NO error, 0 rows
--
-- Every identity and record below is a throwaway created inside this
-- transaction and rolled back at the end. No production identity, credential,
-- email address or financial value appears anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures
-- ═══════════════════════════════════════════════════════════════════════════

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'aud_admin@test.invalid'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'aud_member@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('c1111111-1111-1111-1111-111111111111', 'aud_admin',  'aud_admin@test.invalid',  'Audit Admin',  'administrator', null),
  ('c2222222-2222-2222-2222-222222222222', 'aud_member', 'aud_member@test.invalid', 'Audit Member', 'user',          'jaime');

-- The member holds real modules, so every denial below is demonstrably about
-- the AUDIT TRAIL specifically and never about an unentitled account. The
-- `markets` grant deliberately survives the deletion in section 3.
insert into public.user_module_grants (user_id, module_key) values
  ('c2222222-2222-2222-2222-222222222222', 'macro'),
  ('c2222222-2222-2222-2222-222222222222', 'markets');

-- Role helpers: set BOTH the JWT claim and the database role, so auth.uid()
-- resolves exactly as it does for a real PostgREST request.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- The role a service-role API key actually assumes — NOT `postgres`. Writing
-- the trail as the table owner would prove nothing about the deployed grants.
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
end $$;

create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role postgres';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · The migration applied — shape
-- ═══════════════════════════════════════════════════════════════════════════

select has_column('public', 'family_portfolio_access_audit', 'module_key',
  'the audit table carries a module_key column');

select col_is_null('public', 'family_portfolio_access_audit', 'module_key',
  'module_key is nullable — it is meaningless for role and principal changes');

-- Extended, NOT duplicated. A parallel module-grant audit table would split
-- "who changed this account's authorization" across two places, so answering
-- that question would mean remembering to read both.
select is(
  (select count(*)::int from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (c.relname like '%module%audit%' or c.relname like '%audit%module%')),
  0,
  'no parallel module-audit table exists — the existing trail was extended');

select is(
  (select count(*)::int
     from pg_catalog.pg_constraint c
     join pg_catalog.pg_class t on t.oid = c.conrelid
     join pg_catalog.pg_class r on r.oid = c.confrelid
    where t.relname = 'family_portfolio_access_audit'
      and c.contype = 'f' and r.relname = 'app_modules'
      and c.confdeltype = 'r'),
  1,
  'module_key is a foreign key into app_modules with ON DELETE RESTRICT');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The SERVICE ROLE may write a valid module-grant audit event
-- ═══════════════════════════════════════════════════════════════════════════

-- Stated explicitly so a failure below is diagnosable. The audit table has RLS
-- enabled and deliberately NO insert policy, so the service role can only write
-- it by bypassing RLS — which is precisely the posture being asserted.
select ok((select rolbypassrls from pg_catalog.pg_roles where rolname = 'service_role'),
  'service_role bypasses RLS — the audit trail is writable by it alone');

select pg_temp.as_service();

select lives_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key,
     previous_value, new_value)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'module_grant', 'macro', null, 'granted')
$$, 'the service role can record a module grant');

select lives_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key,
     previous_value, new_value)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'module_grant', 'markets', 'granted', null)
$$, 'the service role can record a module revocation');

-- The two pre-existing kinds still work, unchanged, with no module named.
select lives_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed,
     previous_value, new_value)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'role', 'user', 'administrator')
$$, 'REGRESSION: a role change is still recordable, with no module_key');

select is(
  (select count(*)::int from public.family_portfolio_access_audit
    where target_user_id = 'c2222222-2222-2222-2222-222222222222'
      and field_changed = 'module_grant'),
  2,
  'both module-grant events are stored');

select is(
  (select module_key from public.family_portfolio_access_audit
    where field_changed = 'module_grant' and new_value = 'granted'),
  'macro',
  'the stored event names the module that actually changed');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · Invalid module/action combinations are REJECTED
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the half the migration's catalog postconditions cannot reach.

select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'module_grant', null)
$$, '23514', null,
  'a module_grant row naming NO module is rejected — an unusable record');

select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'role', 'macro')
$$, '23514', null,
  'a ROLE change may not name a module — the pairing binds both directions');

select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'portfolio_principal', 'portfolio')
$$, '23514', null,
  'a PRINCIPAL change may not name a module either');

select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'module_revoke', 'macro')
$$, '23514', null,
  'an unknown field_changed kind is rejected — the CHECK is exhaustive');

select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          'c1111111-1111-1111-1111-111111111111',
          'administrator', 'module_grant', 'no_such_module')
$$, '23503', null,
  'the trail cannot name a module that is not in the registry');

-- REGRESSION: a module grant is always administrator-authored, so the actor
-- pairing established in 20260806000000 must still refuse an actorless row.
select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          null, 'administrator', 'module_grant', 'macro')
$$, '23514', null,
  'REGRESSION: an administrator-authored module event still requires an actor');

-- ON DELETE RESTRICT: retiring a module must not silently rewrite history.
-- The grant row is removed first so the ONLY remaining reference is the audit
-- row — otherwise the RESTRICT could be coming from user_module_grants and
-- would prove nothing about this migration.
select pg_temp.as_owner();
delete from public.user_module_grants where module_key = 'macro';
select is((select count(*)::int from public.user_module_grants where module_key = 'macro'), 0,
  'no grant row references macro any more — the audit row is its sole reference');
select throws_ok($$ delete from public.app_modules where module_key = 'macro' $$,
  '23503', null,
  'a module named by the audit trail cannot be deleted from the registry');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · A MEMBER cannot write the audit trail
-- ═══════════════════════════════════════════════════════════════════════════
-- `authenticated` holds SELECT and nothing else, so every write is a hard 42501
-- and never even reaches RLS. The member still holds the `markets` grant here,
-- so these denials are about the trail, not about an unentitled account.

select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.user_module_grants), 1,
  'the member still holds a module grant while being refused the trail');

select throws_ok($$
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, module_key)
  values ('c2222222-2222-2222-2222-222222222222',
          'c2222222-2222-2222-2222-222222222222',
          'administrator', 'module_grant', 'markets')
$$, '42501', null,
  'a member cannot insert a module-grant audit row');

select throws_ok($$
  update public.family_portfolio_access_audit set new_value = 'tampered'
$$, '42501', null,
  'a member cannot rewrite an audit row');

select throws_ok($$
  delete from public.family_portfolio_access_audit
$$, '42501', null,
  'a member cannot delete an audit row');

-- SELECT is granted, but RLS admits administrators only: filtered, not refused.
select is(
  (select count(*)::int from public.family_portfolio_access_audit),
  0,
  'a member reads ZERO audit rows, including rows about their own account');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · An ADMINISTRATOR keeps full visibility of the extended trail
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.family_portfolio_access_audit
    where field_changed = 'module_grant'),
  2,
  'an administrator sees the module-grant events');

select is(
  (select count(*)::int from public.family_portfolio_access_audit
    where target_user_id = 'c2222222-2222-2222-2222-222222222222'),
  3,
  'an administrator sees module and role events in ONE trail, not two');

-- Read-only even for an administrator: history is not editable through the API.
select throws_ok($$
  update public.family_portfolio_access_audit set new_value = 'tampered'
$$, '42501', null,
  'an administrator cannot rewrite history through the API either');

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · This migration changed NOTHING else
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_owner();

select is((select count(*)::int from public.app_modules), 7,
  'the module registry still holds exactly seven modules');

select is(
  (select array_agg(module_key order by module_key)::text[] from public.app_modules),
  array['alternatives','analysis','earnings','macro','markets','portfolio','structured_notes']::text[],
  'the seven module keys are exactly the expected ones');

-- The immutable ceiling, re-asserted from the database side. It is deliberately
-- INDEPENDENT of every module grant above: no audit row, and no grant, can
-- widen it.
select is(public.nmi_portfolio_scopes(true, false, 'jaime'),
  array['main','jaime','alternatives'],
  'the jaime ceiling is unchanged — never andres, never pablo');
select is(public.nmi_portfolio_scopes(true, false, 'andres'),
  array['main','andres','alternatives'],
  'the andres ceiling is unchanged — never jaime, never pablo');
select is(public.nmi_portfolio_scopes(true, false, 'pablo'),
  array['main','pablo','alternatives'],
  'the pablo ceiling is unchanged — never jaime, never andres');
select is(public.nmi_portfolio_scopes(true, false, null),
  array[]::text[],
  'no principal still means no personal Portfolio scope');
select is(public.nmi_portfolio_scopes(true, true, null),
  array['main','jaime','andres','pablo','alternatives','admin'],
  'the administrator ceiling is unchanged');

select * from finish();
rollback;
