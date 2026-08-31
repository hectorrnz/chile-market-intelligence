-- POST-R13.6B — EXECUTABLE PostgreSQL validation of the module entitlement
-- substrate.
--
-- Run by `supabase test db` against an isolated, disposable local stack that has
-- had the FULL migration chain applied from a clean database. Everything here
-- executes against real PostgreSQL: real foreign keys, real SECURITY DEFINER
-- functions, real GRANT/REVOKE, real RLS, through the real `auth.uid()` path.
-- Static text inspection lives in tests/moduleEntitlements.test.ts and is
-- deliberately NOT repeated.
--
-- All identities below are throwaway rows created inside this transaction and
-- rolled back at the end. No production identity, credential, or financial value
-- appears anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;

-- `no_plan()` rather than a hardcoded `plan(N)`, matching the R13.1 suite: an
-- asserted count guessed from an environment that cannot execute pgTAP fails CI
-- for a cosmetic reason while proving nothing about security.
select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — local-only throwaway identities
-- ═══════════════════════════════════════════════════════════════════════════
-- The migration's compatibility backfill has ALREADY run against whatever rows
-- the clean chain produced. These identities are created afterwards, so they
-- start with NO grants — which is exactly the state a newly provisioned account
-- will have, and lets the default-deny assertions below mean something.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'mod_admin@test.invalid'),
  ('a2222222-2222-2222-2222-222222222222'::uuid, 'mod_jaime@test.invalid'),
  ('a3333333-3333-3333-3333-333333333333'::uuid, 'mod_andres@test.invalid'),
  ('a4444444-4444-4444-4444-444444444444'::uuid, 'mod_nogrant@test.invalid'),
  ('a5555555-5555-5555-5555-555555555555'::uuid, 'mod_unapproved@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('a1111111-1111-1111-1111-111111111111', 'mod_admin',      'mod_admin@test.invalid',      'Mod Admin',  'administrator', null),
  ('a2222222-2222-2222-2222-222222222222', 'mod_jaime',      'mod_jaime@test.invalid',      'Mod Jaime',  'user',          'jaime'),
  ('a3333333-3333-3333-3333-333333333333', 'mod_andres',     'mod_andres@test.invalid',     'Mod Andres', 'user',          'andres'),
  ('a4444444-4444-4444-4444-444444444444', 'mod_nogrant',    'mod_nogrant@test.invalid',    'No Grant',   'user',          'pablo'),
  -- Unapproved: NULL username is the revoked/never-approved marker, yet this
  -- account is given every grant below. Approval must still be the outer gate.
  ('a5555555-5555-5555-5555-555555555555', null,             'mod_unapproved@test.invalid', 'Unapproved', 'user',          'jaime');

-- Explicit grants. `mod_nogrant` deliberately receives none.
insert into public.user_module_grants (user_id, module_key) values
  ('a2222222-2222-2222-2222-222222222222', 'markets'),
  ('a2222222-2222-2222-2222-222222222222', 'portfolio'),
  ('a2222222-2222-2222-2222-222222222222', 'alternatives'),
  ('a3333333-3333-3333-3333-333333333333', 'portfolio'),
  ('a5555555-5555-5555-5555-555555555555', 'markets'),
  ('a5555555-5555-5555-5555-555555555555', 'portfolio'),
  ('a5555555-5555-5555-5555-555555555555', 'structured_notes');


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · REGISTRY
-- ═══════════════════════════════════════════════════════════════════════════

select has_table('public', 'app_modules', 'app_modules exists');
select has_table('public', 'user_module_grants', 'user_module_grants exists');

select is(
  (select array_agg(module_key order by module_key) from public.app_modules),
  array['alternatives','analysis','earnings','macro','markets','portfolio','structured_notes'],
  'the registry holds exactly the seven grantable module keys');

-- THE structural guarantee: a Family Portfolio scope is not a module key, so a
-- cross-principal grant has nothing to point at.
select is(
  (select count(*)::int from public.app_modules
    where module_key in ('main','jaime','andres','pablo','admin')),
  0, 'no Family Portfolio personal or admin scope is a module key');

select is(
  (select count(*)::int from public.app_modules
    where module_key in ('portfolio_admin','notification_recipients')),
  0, 'no role capability is a module key');

select is(
  (select default_for_member from public.app_modules where module_key = 'structured_notes'),
  false, 'structured_notes defaults OFF for a new member');

select is(
  (select count(*)::int from public.app_modules where default_for_member),
  6, 'the other six modules default ON');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · CROSS-PRINCIPAL GRANTS ARE UNREPRESENTABLE
-- ═══════════════════════════════════════════════════════════════════════════
-- Not "rejected by a rule" — impossible to store. This is the single most
-- important behaviour in the whole stage.

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'andres')
$$, '23503', null, 'a grant naming another principal violates the foreign key');

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'pablo')
$$, '23503', null, 'a grant naming pablo violates the foreign key');

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'main')
$$, '23503', null, 'a grant naming the main scope violates the foreign key');

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'admin')
$$, '23503', null, 'a grant naming the admin scope violates the foreign key');

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'portfolio_admin')
$$, '23503', null, 'a grant naming the publication console violates the foreign key');

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'a_future_module')
$$, '23503', null, 'an undeclared module cannot be granted');

select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'markets')
$$, '23505', null, 'a duplicate grant is impossible');

select throws_ok($$
  insert into public.app_modules (module_key, label, display_order)
  values ('Not A Key', 'Bad', 99)
$$, '23514', null, 'a malformed module key is rejected by the shape constraint');


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · THE PURE RULE
-- ═══════════════════════════════════════════════════════════════════════════
-- The migration's own postcondition already executed the full truth table at
-- apply time. These re-assert the load-bearing rows in pgTAP so a failure is
-- reported per-case rather than as one migration exception.

select is(public.nmi_module_allowed(true,  false, true,  true),  true,  'member with a grant is allowed');
select is(public.nmi_module_allowed(true,  false, false, true),  false, 'member without a grant is denied');
select is(public.nmi_module_allowed(true,  true,  false, true),  true,  'administrator needs no grant');
select is(public.nmi_module_allowed(true,  true,  true,  false), false, 'even an administrator is denied an undeclared module');
select is(public.nmi_module_allowed(false, true,  true,  true),  false, 'a revoked administrator is denied');
select is(public.nmi_module_allowed(null,  false, true,  true),  false, 'null approval is not approval');
select is(public.nmi_module_allowed(true,  false, null,  true),  false, 'a null grant flag is not a grant');
select is(public.nmi_module_allowed(true,  false, true,  null),  false, 'a null module-known flag is not a declared module');


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · ACCESS MATRIX — through the real auth.uid() path
-- ═══════════════════════════════════════════════════════════════════════════
-- `set local role authenticated` + a request.jwt.claims sub is how Supabase
-- resolves auth.uid(); this exercises the true runtime path, not a stub.

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

-- ── Administrator: every module, holding NO grant rows ─────────────────────
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
select is(public.nmi_current_module_grants(), array[]::text[],
  'the administrator has no grant rows at all');
select is(public.nmi_can_access_module('markets'), true, 'ADMIN reaches markets by role');
select is(public.nmi_can_access_module('structured_notes'), true, 'ADMIN reaches structured_notes by role');
select is(public.nmi_can_access_module('portfolio'), true, 'ADMIN reaches portfolio by role');
select is(public.nmi_can_access_module('a_future_module'), false, 'ADMIN is still denied an undeclared module');
select is(public.nmi_can_access_module(null), false, 'a null module is denied');
select is(public.nmi_can_access_module(''), false, 'an empty module name is denied');

-- ── Granted member ─────────────────────────────────────────────────────────
select pg_temp.as_service();
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select is(public.nmi_current_module_grants(), array['alternatives','markets','portfolio'],
  'JAIME sees exactly his own three grants');
select is(public.nmi_can_access_module('markets'), true, 'JAIME reaches a granted module');
select is(public.nmi_can_access_module('structured_notes'), false,
  'JAIME is DENIED an ungranted module even though it is declared');
select is(public.nmi_can_access_module('macro'), false, 'JAIME is denied macro — no grant row');

-- DEFAULTS ARE NOT AUTHORIZATION: `macro` is default_for_member = true, and
-- JAIME still cannot reach it without an explicit row. This is the executable
-- half of the guarantee.
select is(
  (select default_for_member from public.app_modules where module_key = 'macro'),
  true, 'macro defaults ON for provisioning');
select is(public.nmi_can_access_module('macro'), false,
  'a default_for_member module is STILL denied without an explicit grant row');

-- ── Member with no grants at all ───────────────────────────────────────────
select pg_temp.as_service();
select pg_temp.as_user('a4444444-4444-4444-4444-444444444444');
select is(public.nmi_current_module_grants(), array[]::text[], 'NOGRANT has no grants');
select is(public.nmi_can_access_module('markets'), false, 'NOGRANT reaches nothing');
select is(public.nmi_can_access_module('portfolio'), false, 'NOGRANT cannot reach portfolio');

-- ── Unapproved account, fully granted: approval is the outer gate ──────────
select pg_temp.as_service();
select pg_temp.as_user('a5555555-5555-5555-5555-555555555555');
select is(public.nmi_can_access_module('markets'), false,
  'an UNAPPROVED account is denied despite holding an explicit grant');
select is(public.nmi_can_access_module('structured_notes'), false,
  'an UNAPPROVED account is denied structured_notes despite the grant row');

-- ── Anonymous ──────────────────────────────────────────────────────────────
select pg_temp.as_service();
select pg_temp.as_anon();
-- An anonymous caller never even reaches the rule. EXECUTE on both definer
-- functions is revoked from `anon`, so the attempt is refused at the privilege
-- boundary (42501) instead of returning an empty answer -- a stronger property
-- than "resolves no grants", and the one the migration actually establishes.
--
-- It MUST be asserted with throws_ok: a bare call raises an uncatchable ERROR
-- that aborts the entire psql script, so every later section would be skipped
-- and finish() would never emit a plan. The same property is re-asserted from
-- the privilege side in section 5; both angles are kept deliberately.
select throws_ok($$ select public.nmi_current_module_grants() $$,
  '42501', null, 'an anonymous caller cannot even reach the grant lookup');


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · RLS AND PRIVILEGES — under a real session
-- ═══════════════════════════════════════════════════════════════════════════

-- A member reads their OWN grants and nobody else's.
select pg_temp.as_service();
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.user_module_grants
    where user_id = 'a2222222-2222-2222-2222-222222222222'),
  3, 'JAIME can read his own three grant rows');
select is(
  (select count(*)::int from public.user_module_grants
    where user_id = 'a3333333-3333-3333-3333-333333333333'),
  0, 'JAIME cannot read ANDRES''s grant rows');

-- The registry itself is readable — it is only a list of module names.
select cmp_ok((select count(*) from public.app_modules), '=', 7::bigint,
  'an authenticated member can read the module registry');

-- No member can grant themselves a module, through any verb.
select throws_ok($$
  insert into public.user_module_grants (user_id, module_key)
  values ('a2222222-2222-2222-2222-222222222222', 'structured_notes')
$$, '42501', null, 'a member cannot INSERT a grant for themselves');

select throws_ok($$
  update public.user_module_grants set module_key = 'structured_notes'
  where user_id = 'a2222222-2222-2222-2222-222222222222'
$$, '42501', null, 'a member cannot UPDATE their grants');

select throws_ok($$
  delete from public.user_module_grants
  where user_id = 'a2222222-2222-2222-2222-222222222222'
$$, '42501', null, 'a member cannot DELETE their grants');

select throws_ok($$
  insert into public.app_modules (module_key, label, display_order, default_for_member)
  values ('rogue', 'Rogue', 999, true)
$$, '42501', null, 'a member cannot add a module to the registry');

select throws_ok($$
  update public.app_modules set default_for_member = true where module_key = 'structured_notes'
$$, '42501', null, 'a member cannot change a registry default');

-- Anonymous callers reach neither table.
select pg_temp.as_service();
select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.user_module_grants $$,
  '42501', null, 'anon cannot read grants at all');
select throws_ok($$ select count(*) from public.app_modules $$,
  '42501', null, 'anon cannot read the module registry');
select throws_ok($$ select public.nmi_current_module_grants() $$,
  '42501', null, 'anon cannot execute nmi_current_module_grants()');
select throws_ok($$ select public.nmi_can_access_module('markets') $$,
  '42501', null, 'anon cannot execute nmi_can_access_module()');


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · THE PORTFOLIO CEILING IS UNTOUCHED
-- ═══════════════════════════════════════════════════════════════════════════
-- POST-R13.6B composes with the ceiling in the application layer. PostgreSQL
-- must keep enforcing the ceiling exactly as R13.1 defined it, independently of
-- anything module-related — so a bug in composition can never widen the
-- database's own answer.

select pg_temp.as_service();

select is(public.nmi_portfolio_scopes(true, false, 'jaime'),
  array['main','jaime','alternatives'], 'the ceiling for jaime is unchanged');
select is(public.nmi_portfolio_scopes(true, false, 'andres'),
  array['main','andres','alternatives'], 'the ceiling for andres is unchanged');
select is(public.nmi_portfolio_scopes(true, true, null),
  array['main','jaime','andres','pablo','alternatives','admin'], 'the administrator ceiling is unchanged');

-- A member holding EVERY module grant still cannot reach a sibling's scope.
insert into public.user_module_grants (user_id, module_key)
select 'a2222222-2222-2222-2222-222222222222', m.module_key
from public.app_modules m
on conflict do nothing;

select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select is(public.nmi_current_portfolio_scopes(), array['main','jaime','alternatives'],
  'a fully-granted JAIME still resolves only main+jaime+alternatives');
select is(public.nmi_can_access_scope('andres'), false,
  'a fully-granted JAIME still cannot reach the andres scope');
select is(public.nmi_can_access_scope('pablo'), false,
  'a fully-granted JAIME still cannot reach the pablo scope');
select is(public.nmi_can_access_scope('admin'), false,
  'a fully-granted JAIME still cannot reach the admin scope');

select pg_temp.as_service();


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · CASCADE AND REFERENTIAL BEHAVIOUR
-- ═══════════════════════════════════════════════════════════════════════════

-- A registered module cannot be deleted while grants reference it: an
-- accidental registry cleanup must not silently drop everyone's access record.
select throws_ok($$ delete from public.app_modules where module_key = 'portfolio' $$,
  '23503', null, 'a module in use cannot be removed from the registry');

-- Deleting a profile removes its grants — no orphaned access rows survive.
-- The profile, not auth.users, is deleted here: `user_module_grants.user_id`
-- references `user_profiles(id)`, so this tests exactly the foreign key THIS
-- migration declares, without depending on any unrelated auth.users constraint.
select lives_ok($$
  delete from public.user_profiles where id = 'a3333333-3333-3333-3333-333333333333'
$$, 'deleting an application profile succeeds');
select is(
  (select count(*)::int from public.user_module_grants
    where user_id = 'a3333333-3333-3333-3333-333333333333'),
  0, 'grants cascade away with the deleted user');


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · FUNCTION POSTURE
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('nmi_current_module_grants','nmi_can_access_module')
     and p.prosecdef
     and exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
               -- PostgreSQL serializes `set search_path = ''` into proconfig as
               -- search_path="" -- the empty value is QUOTED. Comparing against the
               -- unquoted literal matches nothing, which is what made this assertion
               -- report 0 instead of 2 on its first isolated-PostgreSQL run.
               --
               -- Stripping the quotes and requiring the remainder to be empty is both
               -- robust to the serialization form and STRICTER than the migration's own
               -- postcondition, which only requires `like 'search_path=%'`: a function
               -- pinned to a NON-empty path (search_path=public) passes there and fails
               -- here.
               where cfg like 'search_path=%'
                 and btrim(split_part(cfg, '=', 2), '"''') = '')),
  2, 'both SECURITY DEFINER module functions pin an EMPTY search_path');

select is(
  (select p.provolatile from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'nmi_module_allowed'),
  'i'::"char", 'nmi_module_allowed is IMMUTABLE — it is a pure rule');

select is(
  (select p.prosecdef from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'nmi_module_allowed'),
  false, 'the pure rule needs no definer rights');

select * from finish();
rollback;
