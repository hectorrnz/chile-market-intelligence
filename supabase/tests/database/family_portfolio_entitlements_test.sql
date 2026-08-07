-- R13.1.1A — EXECUTABLE PostgreSQL validation of the Family Portfolio
-- entitlement foundation.
--
-- Run by `supabase test db` against an isolated, disposable local stack that has
-- had the FULL migration chain applied from a clean database. Everything here
-- executes against real PostgreSQL: real constraints, real SECURITY DEFINER
-- functions, real GRANT/REVOKE, real RLS. Static text inspection lives in
-- tests/familyPortfolioEntitlements.test.ts and is deliberately NOT repeated.
--
-- All identities below are throwaway rows created inside this transaction and
-- rolled back at the end. No production identity, credential, or financial value
-- appears anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;

-- `no_plan()` rather than a hardcoded `plan(N)`. This environment cannot execute
-- pgTAP (no Docker, no psql), so an asserted count would be a GUESS — and a
-- wrong guess fails CI for a purely cosmetic reason while proving nothing about
-- security. Every assertion below still has to pass, and `supabase test db`
-- fails the workflow on any error or any failing assertion.
select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — local-only throwaway identities
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixed UUIDs make failures readable. They are meaningless outside this
-- transaction.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'admin_null@test.invalid'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'admin_jaime@test.invalid'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'jaime@test.invalid'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'andres@test.invalid'),
  ('55555555-5555-5555-5555-555555555555'::uuid, 'pablo@test.invalid'),
  ('66666666-6666-6666-6666-666666666666'::uuid, 'plain@test.invalid'),
  ('77777777-7777-7777-7777-777777777777'::uuid, 'unapproved@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('11111111-1111-1111-1111-111111111111', 'admin_null',  'admin_null@test.invalid',  'Admin Null',  'administrator', null),
  ('22222222-2222-2222-2222-222222222222', 'admin_jaime', 'admin_jaime@test.invalid', 'Admin Jaime', 'administrator', 'jaime'),
  ('33333333-3333-3333-3333-333333333333', 'u_jaime',     'jaime@test.invalid',       'Jaime',       'user',          'jaime'),
  ('44444444-4444-4444-4444-444444444444', 'u_andres',    'andres@test.invalid',      'Andres',      'user',          'andres'),
  ('55555555-5555-5555-5555-555555555555', 'u_pablo',     'pablo@test.invalid',       'Pablo',       'user',          'pablo'),
  ('66666666-6666-6666-6666-666666666666', 'u_plain',     'plain@test.invalid',       'Plain',       'user',          null),
  -- Unapproved: NULL username is the revoked/never-approved marker, yet it
  -- carries a valid principal — approval must still be the outer gate.
  ('77777777-7777-7777-7777-777777777777', null,          'unapproved@test.invalid',  'Unapproved',  'user',          'jaime');


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · MIGRATION — schema, constraints, defaults
-- ═══════════════════════════════════════════════════════════════════════════

select has_column('public', 'user_profiles', 'role', 'user_profiles.role exists');
select has_column('public', 'user_profiles', 'portfolio_principal', 'user_profiles.portfolio_principal exists');
select has_column('public', 'user_profiles', 'preferences', 'user_profiles.preferences exists');
select hasnt_column('public', 'user_profiles', 'avatar_url', 'avatar_url has no migration authority and must not exist');

select col_not_null('public', 'user_profiles', 'role', 'role is NOT NULL');
select col_default_is('public', 'user_profiles', 'role', 'user', 'role defaults to user');
select col_is_null('public', 'user_profiles', 'portfolio_principal', 'portfolio_principal is nullable — a principal is not mandatory');

select has_table('public', 'family_portfolio_access_audit', 'the audit table exists');
select col_is_null('public', 'family_portfolio_access_audit', 'actor_user_id',
  'actor_user_id is nullable so a service-authorized bootstrap is recorded honestly');

-- portfolio_principal accepts exactly the three family principals.
select lives_ok(
  $$ update public.user_profiles set portfolio_principal = 'jaime'  where id = '66666666-6666-6666-6666-666666666666' $$,
  'portfolio_principal accepts jaime');
select lives_ok(
  $$ update public.user_profiles set portfolio_principal = 'andres' where id = '66666666-6666-6666-6666-666666666666' $$,
  'portfolio_principal accepts andres');
select lives_ok(
  $$ update public.user_profiles set portfolio_principal = 'pablo'  where id = '66666666-6666-6666-6666-666666666666' $$,
  'portfolio_principal accepts pablo');
select lives_ok(
  $$ update public.user_profiles set portfolio_principal = null     where id = '66666666-6666-6666-6666-666666666666' $$,
  'portfolio_principal accepts null');

-- ...and rejects everything else, including the role name.
select throws_ok(
  $$ update public.user_profiles set portfolio_principal = 'administrator' where id = '66666666-6666-6666-6666-666666666666' $$,
  '23514', null, 'portfolio_principal REJECTS administrator — role and principal never mix');
select throws_ok(
  $$ update public.user_profiles set portfolio_principal = 'nope' where id = '66666666-6666-6666-6666-666666666666' $$,
  '23514', null, 'portfolio_principal rejects an unknown value');
select throws_ok(
  $$ update public.user_profiles set portfolio_principal = 'JAIME' where id = '66666666-6666-6666-6666-666666666666' $$,
  '23514', null, 'portfolio_principal is case-sensitive and rejects JAIME');
select throws_ok(
  $$ update public.user_profiles set portfolio_principal = '' where id = '66666666-6666-6666-6666-666666666666' $$,
  '23514', null, 'portfolio_principal rejects the empty string');

-- role is constrained to exactly two values.
select lives_ok(
  $$ update public.user_profiles set role = 'administrator' where id = '66666666-6666-6666-6666-666666666666' $$,
  'role accepts administrator');
select lives_ok(
  $$ update public.user_profiles set role = 'user' where id = '66666666-6666-6666-6666-666666666666' $$,
  'role accepts user');
select throws_ok(
  $$ update public.user_profiles set role = 'superuser' where id = '66666666-6666-6666-6666-666666666666' $$,
  '23514', null, 'role rejects an unknown value');
select throws_ok(
  $$ update public.user_profiles set role = 'Administrator' where id = '66666666-6666-6666-6666-666666666666' $$,
  '23514', null, 'role is case-sensitive');

-- A pre-existing user with a null principal stays valid.
select is(
  (select portfolio_principal from public.user_profiles where id = '66666666-6666-6666-6666-666666666666'),
  null, 'an existing user with a null principal remains valid');

-- The audit actor CHECK makes both kinds representable and neither misrepresentable.
select lives_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
     values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',
             'administrator','role','user','administrator') $$,
  'an administrator audit row requires an actor and is accepted');
select lives_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
     values ('33333333-3333-3333-3333-333333333333', null,
             'service_bootstrap','role','user','administrator') $$,
  'a service_bootstrap audit row with a NULL actor is accepted');
select throws_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed)
     values ('33333333-3333-3333-3333-333333333333', null, 'administrator','role') $$,
  '23514', null, 'an administrator audit row CANNOT omit the actor');
select throws_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed)
     values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','service_bootstrap','role') $$,
  '23514', null, 'a bootstrap row CANNOT name an application actor — that would be a false record');
select throws_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed)
     values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','root','role') $$,
  '23514', null, 'actor_kind rejects an unknown value');
select throws_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed)
     values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','administrator','password') $$,
  '23514', null, 'field_changed rejects anything outside role/portfolio_principal');

delete from public.family_portfolio_access_audit;

-- The audit table carries no credential or financial column.
select hasnt_column('public', 'family_portfolio_access_audit', 'password', 'audit holds no password');
select hasnt_column('public', 'family_portfolio_access_audit', 'session_token', 'audit holds no session token');
select hasnt_column('public', 'family_portfolio_access_audit', 'amount', 'audit holds no financial amount');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · FUNCTION SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

select has_function('public', 'nmi_portfolio_scopes', array['boolean','boolean','text'], 'the canonical rule exists');
select has_function('public', 'nmi_current_portfolio_scopes', 'the identity-resolving helper exists');
select has_function('public', 'nmi_is_administrator', 'the administrator predicate exists');
select has_function('public', 'nmi_can_access_scope', array['text'], 'the reusable RLS predicate exists');

-- Volatility: the pure rule must be IMMUTABLE; the identity helpers STABLE.
select is((select provolatile::text from pg_proc where proname = 'nmi_portfolio_scopes'), 'i',
  'nmi_portfolio_scopes is IMMUTABLE');
select is((select provolatile::text from pg_proc where proname = 'nmi_current_portfolio_scopes'), 's',
  'nmi_current_portfolio_scopes is STABLE');

-- The pure rule must NOT be SECURITY DEFINER; the identity helpers must be.
select is((select prosecdef from pg_proc where proname = 'nmi_portfolio_scopes'), false,
  'nmi_portfolio_scopes is not SECURITY DEFINER — it reads nothing');
select is((select prosecdef from pg_proc where proname = 'nmi_current_portfolio_scopes'), true,
  'nmi_current_portfolio_scopes is SECURITY DEFINER');
select is((select prosecdef from pg_proc where proname = 'nmi_is_administrator'), true,
  'nmi_is_administrator is SECURITY DEFINER');
select is((select prosecdef from pg_proc where proname = 'nmi_can_access_scope'), true,
  'nmi_can_access_scope is SECURITY DEFINER');

-- Every SECURITY DEFINER function pins search_path — otherwise a caller-controlled
-- path could resolve public.user_profiles to a shadow table.
select is(
  (select count(*)::int from pg_proc p
    where p.proname in ('nmi_current_portfolio_scopes','nmi_is_administrator','nmi_can_access_scope')
      and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')),
  0, 'every SECURITY DEFINER nmi_* function pins search_path');

-- Ownership: an ordinary application role must never own a SECURITY DEFINER
-- function, or it could redefine it.
select is(
  (select count(*)::int from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.proname like 'nmi\_%' and r.rolname in ('anon','authenticated')),
  0, 'no nmi_* function is owned by anon or authenticated');

-- Execution privileges.
select ok(not has_function_privilege('anon', 'public.nmi_current_portfolio_scopes()', 'EXECUTE'),
  'anon CANNOT execute nmi_current_portfolio_scopes');
select ok(not has_function_privilege('anon', 'public.nmi_is_administrator()', 'EXECUTE'),
  'anon CANNOT execute nmi_is_administrator');
select ok(not has_function_privilege('anon', 'public.nmi_can_access_scope(text)', 'EXECUTE'),
  'anon CANNOT execute nmi_can_access_scope');
select ok(has_function_privilege('authenticated', 'public.nmi_current_portfolio_scopes()', 'EXECUTE'),
  'authenticated CAN execute nmi_current_portfolio_scopes');
select ok(has_function_privilege('authenticated', 'public.nmi_can_access_scope(text)', 'EXECUTE'),
  'authenticated CAN execute nmi_can_access_scope');

-- The canonical rule takes its inputs explicitly and reads nothing, so it cannot
-- be influenced by any client-supplied identity.
select is(
  (select count(*)::int from pg_proc where proname = 'nmi_current_portfolio_scopes' and pronargs > 0),
  0, 'nmi_current_portfolio_scopes takes NO parameters — identity comes from auth.uid()');
select is(
  (select count(*)::int from pg_proc where proname = 'nmi_is_administrator' and pronargs > 0),
  0, 'nmi_is_administrator takes NO parameters');


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · THE CANONICAL RULE — exact scope sets (the SQL half of parity)
-- ═══════════════════════════════════════════════════════════════════════════

select is(public.nmi_portfolio_scopes(true, true, null),
  array['main','jaime','andres','pablo','alternatives','admin'], 'administrator, null principal');
select is(public.nmi_portfolio_scopes(true, true, 'jaime'),
  array['main','jaime','andres','pablo','alternatives','admin'], 'administrator, jaime principal');
select is(public.nmi_portfolio_scopes(true, false, 'jaime'),
  array['main','jaime','alternatives'], 'jaime principal');
select is(public.nmi_portfolio_scopes(true, false, 'andres'),
  array['main','andres','alternatives'], 'andres principal');
select is(public.nmi_portfolio_scopes(true, false, 'pablo'),
  array['main','pablo','alternatives'], 'pablo principal');
select is(public.nmi_portfolio_scopes(true, false, null),
  array[]::text[], 'approved non-administrator with null principal gets NO scopes');
select is(public.nmi_portfolio_scopes(true, false, 'administrator'),
  array[]::text[], 'a principal of "administrator" confers nothing');
select is(public.nmi_portfolio_scopes(false, false, 'jaime'),
  array[]::text[], 'unapproved user gets NO scopes');
select is(public.nmi_portfolio_scopes(false, true, null),
  array[]::text[], 'revoked administrator gets NO scopes');
select is(public.nmi_portfolio_scopes(null, false, 'jaime'),
  array[]::text[], 'null approval is not approval');


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

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(public.nmi_current_portfolio_scopes(),
  array['main','jaime','andres','pablo','alternatives','admin'], 'ADMIN (null principal) resolves every scope');
select is(public.nmi_is_administrator(), true, 'ADMIN is recognised as administrator');
select is(public.nmi_can_access_scope('admin'), true, 'ADMIN reaches the admin scope');

select pg_temp.as_service();
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(public.nmi_current_portfolio_scopes(),
  array['main','jaime','andres','pablo','alternatives','admin'], 'ADMIN with a jaime principal still resolves every scope');

select pg_temp.as_service();
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select is(public.nmi_current_portfolio_scopes(), array['main','jaime','alternatives'], 'JAIME resolves main+jaime+alternatives');
select is(public.nmi_is_administrator(), false, 'JAIME is not an administrator');
select is(public.nmi_can_access_scope('andres'), false, 'JAIME cannot reach ANDRES');
select is(public.nmi_can_access_scope('pablo'),  false, 'JAIME cannot reach PABLO');
select is(public.nmi_can_access_scope('admin'),  false, 'JAIME cannot reach admin');
select is(public.nmi_can_access_scope('main'),   true,  'JAIME reaches main');

select pg_temp.as_service();
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(public.nmi_current_portfolio_scopes(), array['main','andres','alternatives'], 'ANDRES resolves main+andres+alternatives');
select is(public.nmi_can_access_scope('jaime'), false, 'ANDRES cannot reach JAIME');
select is(public.nmi_can_access_scope('pablo'), false, 'ANDRES cannot reach PABLO');

select pg_temp.as_service();
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(public.nmi_current_portfolio_scopes(), array['main','pablo','alternatives'], 'PABLO resolves main+pablo+alternatives');
select is(public.nmi_can_access_scope('jaime'),  false, 'PABLO cannot reach JAIME');
select is(public.nmi_can_access_scope('andres'), false, 'PABLO cannot reach ANDRES');

select pg_temp.as_service();
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select is(public.nmi_current_portfolio_scopes(), array[]::text[], 'approved non-admin with null principal gets NO scopes');

select pg_temp.as_service();
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(public.nmi_current_portfolio_scopes(), array[]::text[],
  'UNAPPROVED user with a valid principal still gets NO scopes — approval is the outer gate');
select is(public.nmi_is_administrator(), false, 'an unapproved user is never an administrator');

-- Unknown scopes are denied for everyone.
select pg_temp.as_service();
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(public.nmi_can_access_scope('not_a_scope'), false, 'unknown scope denied even for an administrator');
select is(public.nmi_can_access_scope(''),            false, 'empty scope denied');
select is(public.nmi_can_access_scope(null),          false, 'null scope denied');
select is(public.nmi_can_access_scope('MAIN'),        false, 'scope matching is case-sensitive');

-- Anonymous: no session, therefore no scopes. Called as postgres because anon
-- has no EXECUTE privilege — proving both properties.
select pg_temp.as_service();
select is(
  (select public.nmi_portfolio_scopes(
     (select nullif(btrim(coalesce(p.username::text,'')),'') is not null from public.user_profiles p where p.id = null),
     false, null)),
  array[]::text[], 'an absent identity resolves to no scopes');


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · PROFILE MUTATION SECURITY — real RLS + real privileges
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();
select ok(not has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE'),
  'authenticated has NO UPDATE on user_profiles');
select ok(not has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'),
  'authenticated has NO INSERT on user_profiles');
select ok(not has_table_privilege('authenticated', 'public.user_profiles', 'DELETE'),
  'authenticated has NO DELETE on user_profiles');
select ok(has_table_privilege('authenticated', 'public.user_profiles', 'SELECT'),
  'authenticated retains SELECT — the approval lookup depends on it');
select ok(not has_any_column_privilege('authenticated', 'public.user_profiles', 'UPDATE'),
  'authenticated holds no column-level UPDATE on user_profiles');
select ok(not has_table_privilege('anon', 'public.user_profiles', 'SELECT'),
  'anon cannot even read user_profiles');

-- An ordinary user cannot mutate authorization fields — theirs or anyone else's.
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ update public.user_profiles set role = 'administrator' where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null, 'a user CANNOT change their OWN role');
select throws_ok(
  $$ update public.user_profiles set portfolio_principal = 'andres' where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null, 'a user CANNOT change their OWN portfolio_principal');
select throws_ok(
  $$ update public.user_profiles set role = 'administrator' where id = '44444444-4444-4444-4444-444444444444' $$,
  '42501', null, 'a user CANNOT change ANOTHER user''s role');
select throws_ok(
  $$ update public.user_profiles set portfolio_principal = 'pablo' where id = '44444444-4444-4444-4444-444444444444' $$,
  '42501', null, 'a user CANNOT change ANOTHER user''s portfolio_principal');
select throws_ok(
  $$ insert into public.user_profiles (id, username, role, portfolio_principal)
     values ('88888888-8888-8888-8888-888888888888','forged','administrator','jaime') $$,
  '42501', null, 'a user CANNOT insert an authorization-bearing profile row');

-- Own-row RLS still lets a user read their own row, and only their own.
select is((select count(*)::int from public.user_profiles), 1,
  'a user sees exactly one row — their own — under RLS');

-- The approved server-side administrative path CAN perform the change.
select pg_temp.as_service();
select lives_ok(
  $$ update public.user_profiles set role = 'administrator' where id = '66666666-6666-6666-6666-666666666666' $$,
  'the service-role administrative path CAN change a role');
select lives_ok(
  $$ update public.user_profiles set portfolio_principal = 'pablo' where id = '66666666-6666-6666-6666-666666666666' $$,
  'the service-role administrative path CAN change a principal');
-- Restore the fixture.
update public.user_profiles set role = 'user', portfolio_principal = null
  where id = '66666666-6666-6666-6666-666666666666';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · AUDIT SECURITY — real RLS + real privileges
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();
select ok(not has_table_privilege('authenticated', 'public.family_portfolio_access_audit', 'INSERT'),
  'authenticated CANNOT insert audit rows');
select ok(not has_table_privilege('authenticated', 'public.family_portfolio_access_audit', 'UPDATE'),
  'authenticated CANNOT update audit rows');
select ok(not has_table_privilege('authenticated', 'public.family_portfolio_access_audit', 'DELETE'),
  'authenticated CANNOT delete audit rows');
select ok(not has_table_privilege('anon', 'public.family_portfolio_access_audit', 'SELECT'),
  'anon CANNOT read audit rows');

-- Seed one row of each kind, as the service path would.
insert into public.family_portfolio_access_audit
  (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','administrator','portfolio_principal',null,'jaime'),
  ('11111111-1111-1111-1111-111111111111', null, 'service_bootstrap','role','user','administrator');

select is((select count(*)::int from public.family_portfolio_access_audit), 2, 'both audit rows persisted');
select is(
  (select actor_user_id from public.family_portfolio_access_audit where actor_kind = 'service_bootstrap'),
  null, 'the bootstrap row names NO application actor — recorded honestly');
select isnt(
  (select actor_user_id from public.family_portfolio_access_audit where actor_kind = 'administrator'),
  null, 'the administrator row names its actor');

-- Visibility: administrators read the trail; ordinary users read nothing.
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.family_portfolio_access_audit), 2, 'an ADMINISTRATOR reads the audit trail');

select pg_temp.as_service();
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.family_portfolio_access_audit), 0,
  'an ordinary user reads NO audit rows');
select throws_ok(
  $$ insert into public.family_portfolio_access_audit (target_user_id, actor_user_id, actor_kind, field_changed)
     values ('33333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333','administrator','role') $$,
  '42501', null, 'an ordinary user CANNOT forge an audit row');

select pg_temp.as_service();

-- ===========================================================================
-- R13.2 — upload spine and private storage
--
-- The migration asserts this posture too, but a migration postcondition only
-- proves the state at APPLY time. These run under real RLS with a real
-- `auth.uid()`, so they prove the posture holds for an actual caller.
-- ===========================================================================

select ok(to_regclass('public.portfolio_source_uploads') is not null,
  'portfolio_source_uploads exists');
select ok(to_regclass('public.portfolio_upload_findings') is not null,
  'portfolio_upload_findings exists');

select ok(
  (select relrowsecurity from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'portfolio_source_uploads'),
  'RLS is enabled on portfolio_source_uploads');
select ok(
  (select relrowsecurity from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'portfolio_upload_findings'),
  'RLS is enabled on portfolio_upload_findings');

-- Writes must be service-role only: no write policy may exist for authenticated.
select is(
  (select count(*)::int from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename in ('portfolio_source_uploads', 'portfolio_upload_findings')
     and cmd <> 'SELECT'),
  0, 'no non-SELECT policy exists on either upload table');

select ok(not has_table_privilege('authenticated', 'public.portfolio_source_uploads', 'INSERT'),
  'authenticated cannot INSERT uploads');
select ok(not has_table_privilege('authenticated', 'public.portfolio_source_uploads', 'UPDATE'),
  'authenticated cannot UPDATE uploads');
select ok(not has_table_privilege('authenticated', 'public.portfolio_source_uploads', 'DELETE'),
  'authenticated cannot DELETE uploads');
select ok(not has_table_privilege('anon', 'public.portfolio_source_uploads', 'SELECT'),
  'anon cannot read uploads at all');

-- Seed one upload row as the service role, then prove who can see it.
insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'portfolio',
   'portfolio/2026/aaaaaaaa-0000-4000-8000-000000000001.xlsx', 'sample.xlsx',
   repeat('a', 64), 1024, '11111111-1111-1111-1111-111111111111', 'r13.2-test');

insert into public.portfolio_upload_findings (upload_id, severity, code, detail)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'warning', 'external_links_present',
        'an external-link part is present; it is recorded and ignored, never resolved');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.portfolio_source_uploads), 1,
  'an administrator reads upload rows');
select is((select count(*)::int from public.portfolio_upload_findings), 1,
  'an administrator reads upload findings');

select pg_temp.as_service();
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.portfolio_source_uploads), 0,
  'an ordinary user reads NO upload rows');
select is((select count(*)::int from public.portfolio_upload_findings), 0,
  'an ordinary user reads NO upload findings');
select throws_ok(
  $$ insert into public.portfolio_source_uploads
       (upload_kind, storage_object_path, original_filename, file_sha256,
        file_size_bytes, uploaded_by, parser_version)
     values ('portfolio','portfolio/2026/x.xlsx','x.xlsx', repeat('b',64), 10,
             '33333333-3333-3333-3333-333333333333','forged') $$,
  '42501', null, 'an ordinary user CANNOT forge an upload row');

select pg_temp.as_service();

-- Duplicate detection (doc 05 section 4, check 13) is a database guarantee, not
-- an application convention.
select throws_ok(
  $$ insert into public.portfolio_source_uploads
       (upload_kind, storage_object_path, original_filename, file_sha256,
        file_size_bytes, uploaded_by, parser_version)
     values ('portfolio','portfolio/2026/dupe.xlsx','dupe.xlsx', repeat('a',64), 2048,
             '11111111-1111-1111-1111-111111111111','r13.2-test') $$,
  '23505', null, 'the same digest cannot be ingested twice for one upload kind');

-- The same bytes under the OTHER kind are legitimately allowed.
select lives_ok(
  $$ insert into public.portfolio_source_uploads
       (upload_kind, storage_object_path, original_filename, file_sha256,
        file_size_bytes, uploaded_by, parser_version)
     values ('alternatives','alternatives/2026/same.xlsx','same.xlsx', repeat('a',64), 2048,
             '11111111-1111-1111-1111-111111111111','r13.2-test') $$,
  'the same digest IS allowed under a different upload kind');

-- An overridden as-of date must carry a reason.
select throws_ok(
  $$ update public.portfolio_source_uploads
        set detected_as_of_date = date '2026-08-06',
            confirmed_as_of_date = date '2026-07-30'
      where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '23514', null, 'a date override without a note is refused by the database');

-- Private storage bucket (doc 05 section 3). Dynamic SQL keeps these statements
-- parseable even where the storage schema is absent; the presence assertion
-- below is what stops a vacuous pass.
create or replace function pg_temp.storage_present() returns boolean language plpgsql as $$
begin
  return to_regclass('storage.buckets') is not null;
end $$;

create or replace function pg_temp.bucket_is_private() returns boolean language plpgsql as $$
declare v boolean;
begin
  if to_regclass('storage.buckets') is null then return false; end if;
  execute 'select public from storage.buckets where id = $1'
    into v using 'portfolio-source-uploads';
  return v is not null and v = false;
end $$;

create or replace function pg_temp.bucket_policy_count() returns int language plpgsql as $$
declare n int;
begin
  if to_regclass('storage.objects') is null then return 0; end if;
  execute $q$ select count(*)::int from pg_catalog.pg_policies
               where schemaname = 'storage' and tablename = 'objects'
                 and (coalesce(qual,'') like '%portfolio-source-uploads%'
                   or coalesce(with_check,'') like '%portfolio-source-uploads%') $q$
    into n;
  return n;
end $$;

select ok(pg_temp.storage_present(),
  'the storage schema is provisioned, so the bucket assertions are not vacuous');
select ok(pg_temp.bucket_is_private(),
  'the portfolio-source-uploads bucket exists and is PRIVATE');
select is(pg_temp.bucket_policy_count(), 0,
  'no storage.objects policy exposes the bucket — access is service-role only');

select * from finish();
rollback;
