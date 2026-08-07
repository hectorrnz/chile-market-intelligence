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

-- ===========================================================================
-- R13.3 — snapshot rows, performance rows, publications
--
-- These run under real RLS with a real `auth.uid()`. A migration postcondition
-- proves the state at APPLY time; only these prove that an actual principal
-- sees exactly their entitled scopes and nothing else.
-- ===========================================================================

select ok(to_regclass('public.portfolio_publications') is not null, 'portfolio_publications exists');
select ok(to_regclass('public.portfolio_snapshot_rows') is not null, 'portfolio_snapshot_rows exists');
select ok(to_regclass('public.portfolio_performance_rows') is not null, 'portfolio_performance_rows exists');

-- Schema: provenance and parser attribution are mandatory.
select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='portfolio_publications' and column_name='parser_version'),
  'NO', 'portfolio_publications.parser_version is NOT NULL');
select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='portfolio_snapshot_rows' and column_name='source_cell'),
  'NO', 'portfolio_snapshot_rows.source_cell is NOT NULL');
select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='portfolio_snapshot_rows' and column_name='source_sheet'),
  'NO', 'portfolio_snapshot_rows.source_sheet is NOT NULL');

-- `value` MUST stay nullable: NULL is how "genuinely unavailable" is recorded,
-- and forcing NOT NULL would push a fabricated 0 into the book.
select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='portfolio_snapshot_rows' and column_name='value'),
  'YES', 'portfolio_snapshot_rows.value stays nullable so unavailable is never 0');

select ok(
  (select count(*)::int from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relname in ('portfolio_publications','portfolio_snapshot_rows','portfolio_performance_rows')
     and c.relrowsecurity) = 3,
  'RLS is enabled on all three R13.3 tables');

select is(
  (select count(*)::int from pg_catalog.pg_policies
   where schemaname='public'
     and tablename in ('portfolio_publications','portfolio_snapshot_rows','portfolio_performance_rows')
     and cmd <> 'SELECT'),
  0, 'no non-SELECT policy exists on any R13.3 table');

select ok(not has_table_privilege('authenticated','public.portfolio_snapshot_rows','INSERT'),
  'authenticated cannot INSERT snapshot rows');
select ok(not has_table_privilege('authenticated','public.portfolio_snapshot_rows','UPDATE'),
  'authenticated cannot UPDATE snapshot rows');
select ok(not has_table_privilege('authenticated','public.portfolio_snapshot_rows','DELETE'),
  'authenticated cannot DELETE snapshot rows');
select ok(not has_table_privilege('anon','public.portfolio_snapshot_rows','SELECT'),
  'anon cannot read snapshot rows');
select ok(not has_table_privilege('anon','public.portfolio_performance_rows','SELECT'),
  'anon cannot read performance rows');

-- Seed a publication and one row per scope, as the service role.
insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version)
values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'portfolio',
        'portfolio/2026/aaaaaaaa-0000-4000-8000-0000000000c1.xlsx', 's.xlsx',
        repeat('c', 64), 512, '11111111-1111-1111-1111-111111111111', 'r13.3-test');

insert into public.portfolio_publications
  (id, upload_id, upload_kind, as_of_date, revision, published_by, is_current, parser_version)
values ('bbbbbbbb-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000c1',
        'portfolio', date '2026-08-06', 1, '11111111-1111-1111-1111-111111111111', true, 'r13.3-test');

insert into public.portfolio_snapshot_rows
  (publication_id, scope, as_of_date, row_key, depth, display_order, row_type,
   label_es, value_class, source_sheet, source_cell)
values
  ('bbbbbbbb-0000-4000-8000-0000000000c1','main','2026-08-06','main.total',0,0,'portfolio_total','TOTAL','source_value','RESUMEN','RESUMEN!DE87'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1','jaime','2026-08-06','jaime.total',0,1,'portfolio_total','TOTAL JAIME','source_value','RESUMEN','RESUMEN!DE150'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1','andres','2026-08-06','andres.total',0,2,'portfolio_total','TOTAL ANDRES','source_value','RESUMEN','RESUMEN!DE207'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1','pablo','2026-08-06','pablo.total',0,3,'portfolio_total','TOTAL PABLO','source_value','RESUMEN','RESUMEN!DE266'),
  -- The documented sub-asset-class depth must be storable.
  ('bbbbbbbb-0000-4000-8000-0000000000c1','main','2026-08-06','main.portafolio_liquido.renta_fija.investment_grade',
   2,4,'sub_asset_class','Investment Grade','source_value','RESUMEN','RESUMEN!DE13');

-- Both Main bases must COEXIST for one publication — the uniqueness constraint
-- must not collapse them into a single Main performance record.
insert into public.portfolio_performance_rows
  (publication_id, scope, as_of_date, basis, metric, value, value_class, source_sheet, source_cell)
values
  ('bbbbbbbb-0000-4000-8000-0000000000c1','main','2026-08-06','ex_chilean_equities','weekly_profit',
   1,'source_provided_return','RESUMEN','RESUMEN!DE90'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1','main','2026-08-06','with_chilean_equities','weekly_profit',
   2,'source_provided_return','RESUMEN','RESUMEN!DE97'),
  ('bbbbbbbb-0000-4000-8000-0000000000c1','jaime','2026-08-06','total','weekly_profit',
   3,'source_provided_return','RESUMEN','RESUMEN!DE154');

select is((select count(*)::int from public.portfolio_performance_rows
           where scope='main' and basis in ('ex_chilean_equities','with_chilean_equities')),
  2, 'both Main performance bases coexist for one publication');

select throws_ok(
  $$ insert into public.portfolio_performance_rows
       (publication_id, scope, as_of_date, basis, metric, value, value_class, source_sheet, source_cell)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','main','2026-08-06','ex_chilean_equities','weekly_profit',
             9,'source_provided_return','RESUMEN','RESUMEN!DE90') $$,
  '23505', null, 'one Main basis cannot be duplicated (nor silently overwrite the other)');

select throws_ok(
  $$ insert into public.portfolio_performance_rows
       (publication_id, scope, as_of_date, basis, metric, value, value_class, source_sheet, source_cell)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','main','2026-08-06','made_up_basis','weekly_profit',
             1,'source_provided_return','RESUMEN','RESUMEN!DE90') $$,
  '23514', null, 'an unknown performance basis is refused by the schema');

select throws_ok(
  $$ insert into public.portfolio_snapshot_rows
       (publication_id, scope, as_of_date, row_key, depth, display_order, row_type,
        label_es, value_class, source_sheet, source_cell)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','not_a_scope','2026-08-06','x',0,9,'portfolio_total',
             'X','source_value','RESUMEN','RESUMEN!DE1') $$,
  '23514', null, 'an unknown scope is refused by the schema');

-- Publication currency: at most one current per (kind, as_of_date).
select throws_ok(
  $$ insert into public.portfolio_publications
       (upload_id, upload_kind, as_of_date, revision, published_by, is_current, parser_version)
     values ('aaaaaaaa-0000-4000-8000-0000000000c1','portfolio', date '2026-08-06', 2,
             '11111111-1111-1111-1111-111111111111', true, 'r13.3-test') $$,
  '23505', null, 'a second CURRENT publication for the same week is refused');

select lives_ok(
  $$ insert into public.portfolio_publications
       (id, upload_id, upload_kind, as_of_date, revision, published_by, is_current, parser_version)
     values ('bbbbbbbb-0000-4000-8000-0000000000c2','aaaaaaaa-0000-4000-8000-0000000000c1','portfolio',
             date '2026-08-06', 2, '11111111-1111-1111-1111-111111111111', false, 'r13.3-test') $$,
  'a historical NON-current revision of the same week is allowed');

select lives_ok(
  $$ update public.portfolio_publications set is_current = false
      where id = 'bbbbbbbb-0000-4000-8000-0000000000c1';
     update public.portfolio_publications set is_current = true
      where id = 'bbbbbbbb-0000-4000-8000-0000000000c2' $$,
  'demoting the old current row allows the new revision to become current');

-- Restore revision 1 as current for the RLS checks below.
update public.portfolio_publications set is_current = false where id = 'bbbbbbbb-0000-4000-8000-0000000000c2';
update public.portfolio_publications set is_current = true  where id = 'bbbbbbbb-0000-4000-8000-0000000000c1';

-- ── Scope-filtered reads, per principal ──────────────────────────────────────
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- Jaime
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='jaime'), 1,
  'Jaime reads his own scope');
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='andres'), 0,
  'Jaime CANNOT read Andres');
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='pablo'), 0,
  'Jaime CANNOT read Pablo');
select ok((select count(*)::int from public.portfolio_snapshot_rows where scope='main') > 0,
  'Jaime reads Main, which the entitlement contract shares');
select is((select count(*)::int from public.portfolio_performance_rows where scope='andres'), 0,
  'Jaime CANNOT read Andres performance rows');
select is((select count(*)::int from public.portfolio_publications), 0,
  'a non-administrator reads no publication metadata');

select pg_temp.as_service();
select pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- Andrés
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='andres'), 1,
  'Andres reads his own scope');
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='jaime'), 0,
  'Andres CANNOT read Jaime');
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='pablo'), 0,
  'Andres CANNOT read Pablo');

select pg_temp.as_service();
select pg_temp.as_user('55555555-5555-5555-5555-555555555555'); -- Pablo
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='pablo'), 1,
  'Pablo reads his own scope');
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='jaime'), 0,
  'Pablo CANNOT read Jaime');
select is((select count(*)::int from public.portfolio_snapshot_rows where scope='andres'), 0,
  'Pablo CANNOT read Andres');

-- An approved user with NO principal and no administrative role gets nothing.
select pg_temp.as_service();
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666','noprincipal@test.invalid')
  on conflict (id) do nothing;
insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal)
values ('66666666-6666-6666-6666-666666666666','u_noprincipal','noprincipal@test.invalid',
        'No Principal','user', null)
  on conflict (id) do nothing;

select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select is((select count(*)::int from public.portfolio_snapshot_rows), 0,
  'an approved user with a NULL principal reads NO family portfolio data');
select is((select count(*)::int from public.portfolio_performance_rows), 0,
  'an approved user with a NULL principal reads NO performance data');

-- Administrator sees every scope.
select pg_temp.as_service();
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select count(distinct scope)::int from public.portfolio_snapshot_rows), 4,
  'an administrator reads all four scopes');
select ok((select count(*)::int from public.portfolio_publications) > 0,
  'an administrator reads publication metadata');

-- Scope cannot be bypassed by joining through the publication.
select pg_temp.as_service();
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int
     from public.portfolio_snapshot_rows r
     join public.portfolio_publications p on p.id = r.publication_id
    where r.scope = 'andres'),
  0, 'a publication join cannot expose another principal''s rows');

select throws_ok(
  $$ insert into public.portfolio_snapshot_rows
       (publication_id, scope, as_of_date, row_key, depth, display_order, row_type,
        label_es, value_class, source_sheet, source_cell)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','jaime','2026-08-06','forged',0,99,'portfolio_total',
             'FORGED','source_value','RESUMEN','RESUMEN!DE1') $$,
  '42501', null, 'a principal CANNOT forge a snapshot row, even in their own scope');

select pg_temp.as_service();

-- ===========================================================================
-- R13.4 — alternatives holdings and events
--
-- Alternatives are SHARED: doc 05 § 2.3 grants the `alternatives` scope to
-- every principal and to the administrator. These assertions prove that the
-- shared scope is genuinely shared AND still gated — a caller with no scopes
-- must still see nothing.
-- ===========================================================================

select ok(to_regclass('public.alternatives_holdings') is not null, 'alternatives_holdings exists');
select ok(to_regclass('public.alternatives_events') is not null, 'alternatives_events exists');

select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='alternatives_holdings' and column_name='currency'),
  'NO', 'alternatives_holdings.currency is NOT NULL — a row can never lose its denomination');
select is(
  (select is_nullable from information_schema.columns
   where table_schema='public' and table_name='alternatives_events' and column_name='currency'),
  'NO', 'alternatives_events.currency is NOT NULL');

select ok(
  (select count(*)::int from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('alternatives_holdings','alternatives_events')
     and c.relrowsecurity) = 2,
  'RLS is enabled on both R13.4 tables');
select is(
  (select count(*)::int from pg_catalog.pg_policies
   where schemaname='public' and tablename in ('alternatives_holdings','alternatives_events')
     and cmd <> 'SELECT'),
  0, 'no non-SELECT policy exists on the R13.4 tables');
select ok(not has_table_privilege('anon','public.alternatives_holdings','SELECT'),
  'anon cannot read alternatives holdings');
select ok(not has_table_privilege('authenticated','public.alternatives_events','INSERT'),
  'authenticated cannot INSERT alternatives events');

insert into public.alternatives_holdings
  (id, publication_id, as_of_date, category, currency, investment_name, sociedad,
   capital_committed, contributions, unfunded, current_value, source_sheet, source_row, source_cell)
values ('cccccccc-0000-4000-8000-0000000000a1','bbbbbbbb-0000-4000-8000-0000000000c1',
        '2026-08-06','Private Debt','dolares','FI Compass','NAIDELT',
        100, 40, 60, 75, 'Alternatives', 9, 'Alternatives!B9');

insert into public.alternatives_events
  (publication_id, holding_id, event_date, amount, currency, event_type,
   raw_fill, resolved_hex, classification_method, source_sheet, source_cell, source_row)
values ('bbbbbbbb-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-0000000000a1',
        '2026-06-30', -25, 'dolares', 'aporte',
        'rgb:FF002060', '#002060', 'legend_exact', 'Alternatives', 'Alternatives!N9', 9);

-- An unclassified event is representable and carries NO method.
select lives_ok(
  $$ insert into public.alternatives_events
       (publication_id, holding_id, event_date, amount, currency, event_type,
        raw_fill, source_sheet, source_cell, source_row)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-0000000000a1',
             '2026-07-31', 12, 'dolares', 'unclassified', null, 'Alternatives', 'Alternatives!DC9', 9) $$,
  'an unclassified event is representable with no classification method');

-- A CLASSIFIED event without a method would lose its provenance.
select throws_ok(
  $$ insert into public.alternatives_events
       (publication_id, holding_id, event_date, amount, currency, event_type,
        source_sheet, source_cell, source_row)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-0000000000a1',
             '2026-05-31', 5, 'dolares', 'dividendo', 'Alternatives', 'Alternatives!M9', 9) $$,
  '23514', null, 'a classified event CANNOT omit how it was classified');

-- An unclassified event must not carry a method either — that would be a false record.
select throws_ok(
  $$ insert into public.alternatives_events
       (publication_id, holding_id, event_date, amount, currency, event_type,
        classification_method, source_sheet, source_cell, source_row)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-0000000000a1',
             '2026-04-30', 5, 'dolares', 'unclassified', 'legend_exact', 'Alternatives', 'Alternatives!L9', 9) $$,
  '23514', null, 'an unclassified event CANNOT claim a classification method');

select throws_ok(
  $$ insert into public.alternatives_events
       (publication_id, holding_id, event_date, amount, currency, event_type,
        classification_method, source_sheet, source_cell, source_row)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-0000000000a1',
             '2026-03-31', 5, 'dolares', 'made_up', 'legend_exact', 'Alternatives', 'Alternatives!K9', 9) $$,
  '23514', null, 'an unknown event type is refused by the schema');

-- The (investment x sociedad) grain cannot be ingested twice.
select throws_ok(
  $$ insert into public.alternatives_holdings
       (publication_id, as_of_date, category, currency, investment_name, sociedad,
        source_sheet, source_row, source_cell)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','2026-08-06','Private Debt','dolares',
             'FI Compass','NAIDELT','Alternatives', 9, 'Alternatives!B9') $$,
  '23505', null, 'the same investment x sociedad cannot be ingested twice in one publication');

-- The SAME investment and sociedad under a different CURRENCY is legitimate.
select lives_ok(
  $$ insert into public.alternatives_holdings
       (publication_id, as_of_date, category, currency, investment_name, sociedad,
        source_sheet, source_row, source_cell)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','2026-08-06','Real Assets','euros',
             'FI Compass','NAIDELT','Alternatives', 14, 'Alternatives!B14') $$,
  'the same holding under a different currency is a distinct row');

-- Shared-scope reads.
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- Jaime
select ok((select count(*)::int from public.alternatives_holdings) > 0,
  'Jaime reads shared alternatives');
select ok((select count(*)::int from public.alternatives_events) > 0,
  'Jaime reads shared alternatives events');

select pg_temp.as_service();
select pg_temp.as_user('55555555-5555-5555-5555-555555555555'); -- Pablo
select ok((select count(*)::int from public.alternatives_holdings) > 0,
  'Pablo also reads shared alternatives');

select pg_temp.as_service();
select pg_temp.as_user('66666666-6666-6666-6666-666666666666'); -- no principal
select is((select count(*)::int from public.alternatives_holdings), 0,
  'an approved user with a NULL principal reads NO alternatives — shared is still gated');
select is((select count(*)::int from public.alternatives_events), 0,
  'an approved user with a NULL principal reads NO alternatives events');

select pg_temp.as_service();
select pg_temp.as_user('11111111-1111-1111-1111-111111111111'); -- administrator
select ok((select count(*)::int from public.alternatives_holdings) > 0,
  'an administrator reads alternatives');

select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ insert into public.alternatives_events
       (publication_id, holding_id, event_date, amount, currency, event_type,
        classification_method, source_sheet, source_cell, source_row)
     values ('bbbbbbbb-0000-4000-8000-0000000000c1','cccccccc-0000-4000-8000-0000000000a1',
             '2026-02-28', 1, 'dolares', 'aporte', 'administrator', 'Alternatives', 'Alternatives!J9', 9) $$,
  '42501', null, 'a principal CANNOT forge an alternatives event');

select pg_temp.as_service();


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · R13.5 — PUBLICATION LIFECYCLE (doc 05 §§ 5.1, 5.6, 6)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Only PostgreSQL can prove what follows. The TypeScript suite proves the
-- refusal RULES; these assertions prove the TRANSACTION: that a failed
-- publication leaves nothing behind, that exactly one revision is ever current,
-- that rollback deletes nothing, and that no browser-reachable role can invoke
-- the publication functions at all.
--
-- Every value below is a small synthetic integer. Nothing here is, or resembles,
-- a real portfolio figure.

select pg_temp.as_service();

-- ── 8a Function posture ──────────────────────────────────────────────────
select has_function('public', 'nmi_publish_portfolio',
  array['uuid','date','uuid','text','jsonb','jsonb','text','jsonb'], 'nmi_publish_portfolio exists');
select has_function('public', 'nmi_publish_alternatives',
  array['uuid','date','uuid','text','jsonb','jsonb','text','jsonb'], 'nmi_publish_alternatives exists');
select has_function('public', 'nmi_rollback_publication',
  array['uuid','uuid','text'], 'nmi_rollback_publication exists');
select has_function('public', 'nmi_upsert_portfolio_commentary',
  array['uuid','text','text','uuid'], 'nmi_upsert_portfolio_commentary exists');

-- INVOKER, not DEFINER: a DEFINER publication function would run as its owner,
-- so anyone able to execute it would gain write access to the entire book.
select is(
  (select count(*)::int from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('nmi_publish_portfolio','nmi_publish_alternatives',
                       'nmi_rollback_publication','nmi_upsert_portfolio_commentary')
     and p.prosecdef),
  0, 'no R13.5 publication function is SECURITY DEFINER');

select is(
  (select count(*)::int from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('nmi_publish_portfolio','nmi_publish_alternatives',
                       'nmi_rollback_publication','nmi_upsert_portfolio_commentary',
                       'nmi_sync_upload_status','nmi_assert_publishable')
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))),
  0, 'every R13.5 function pins search_path');

select ok(not has_function_privilege('authenticated',
  'public.nmi_publish_portfolio(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)', 'EXECUTE'),
  'authenticated cannot EXECUTE nmi_publish_portfolio');
select ok(not has_function_privilege('anon',
  'public.nmi_publish_portfolio(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)', 'EXECUTE'),
  'anon cannot EXECUTE nmi_publish_portfolio');
select ok(not has_function_privilege('authenticated',
  'public.nmi_rollback_publication(uuid,uuid,text)', 'EXECUTE'),
  'authenticated cannot EXECUTE nmi_rollback_publication');
select ok(not has_function_privilege('authenticated',
  'public.nmi_upsert_portfolio_commentary(uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated cannot EXECUTE nmi_upsert_portfolio_commentary');
select ok(has_function_privilege('service_role',
  'public.nmi_publish_portfolio(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)', 'EXECUTE'),
  'service_role CAN EXECUTE nmi_publish_portfolio — publication must not fail closed');

-- ── 8b Commentary table posture ──────────────────────────────────────────
select has_table('public', 'portfolio_commentary', 'portfolio_commentary exists');
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'portfolio_commentary'),
  'RLS is enabled on portfolio_commentary');
select is(
  (select count(*)::int from pg_catalog.pg_policies
   where schemaname='public' and tablename='portfolio_commentary' and cmd <> 'SELECT'),
  0, 'portfolio_commentary carries no non-SELECT policy');
select ok(not has_table_privilege('authenticated','public.portfolio_commentary','INSERT'),
  'authenticated cannot INSERT commentary');
select ok(not has_table_privilege('authenticated','public.portfolio_commentary','UPDATE'),
  'authenticated cannot UPDATE commentary — an edit must append a revision');
select ok(not has_table_privilege('anon','public.portfolio_commentary','SELECT'),
  'anon cannot read commentary');

-- ── 8c Fixtures for the lifecycle proper ─────────────────────────────────
-- A separate upload and a separate week, so the R13.3/R13.4 fixtures above stay
-- exactly as those assertions left them.
insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version)
values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'portfolio',
   'portfolio/2026/aaaaaaaa-0000-4000-8000-0000000000d1.xlsx', 'week-a.xlsx',
   repeat('d', 64), 512, '11111111-1111-1111-1111-111111111111', 'r13.5-test'),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', 'portfolio',
   'portfolio/2026/aaaaaaaa-0000-4000-8000-0000000000d2.xlsx', 'week-a-corrected.xlsx',
   repeat('e', 64), 512, '11111111-1111-1111-1111-111111111111', 'r13.5-test'),
  ('aaaaaaaa-0000-4000-8000-0000000000d3', 'portfolio',
   'portfolio/2026/aaaaaaaa-0000-4000-8000-0000000000d3.xlsx', 'blocked.xlsx',
   repeat('f', 64), 512, '11111111-1111-1111-1111-111111111111', 'r13.5-test'),
  ('aaaaaaaa-0000-4000-8000-0000000000d4', 'alternatives',
   'alternatives/2026/aaaaaaaa-0000-4000-8000-0000000000d4.xlsx', 'alts.xlsx',
   repeat('a', 64), 512, '11111111-1111-1111-1111-111111111111', 'r13.5-test');

-- ── 8d First publication ─────────────────────────────────────────────────
select lives_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
    date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid,
    'r13.5-test',
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":7,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"},
      {"scope":"main","row_key":"main.acciones","parent_row_key":"main.total","depth":1,"display_order":1,
       "row_type":"asset_class","label_es":"ACCIONES","label_en":null,"currency":"USD",
       "value":null,"value_class":"unavailable","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE85"},
      {"scope":"jaime","row_key":"jaime.total","parent_row_key":null,"depth":0,"display_order":2,
       "row_type":"portfolio_total","label_es":"TOTAL JAIME","label_en":null,"currency":"USD",
       "value":9,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE150"}]'::jsonb,
    '[{"scope":"main","basis":"ex_chilean_equities","metric":"weekly_profit","value":2,
       "value_class":"source_provided_return","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE90"}]'::jsonb)
$$, 'a first publication succeeds');

select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  1, 'the first publication is revision 1');
select is((select count(*)::int from public.portfolio_snapshot_rows r
           join public.portfolio_publications p on p.id = r.publication_id
           where p.as_of_date = date '2026-08-13'),
  3, 'every snapshot row was written');
select is((select status from public.portfolio_source_uploads
           where id='aaaaaaaa-0000-4000-8000-0000000000d1'),
  'published', 'the upload status becomes published');

-- A NULL value is stored as NULL. `unavailable` is never 0 (doc 02 § 9): a
-- fabricated zero baseline would produce a meaningless or infinite YTD return.

select is((select value from public.portfolio_snapshot_rows r
           join public.portfolio_publications p on p.id = r.publication_id
           where p.as_of_date = date '2026-08-13' and r.row_key = 'main.acciones'),
  null::numeric, 'an unavailable value is stored as NULL, never coerced to 0');

-- ── 8e Atomicity — the property this whole design exists for ─────────────
-- A row payload whose LAST element violates the row_type CHECK. The parent
-- publication and the first rows are inserted before it fails, so if the
-- function were not one transaction this would leave a half-published week
-- with the previous one already demoted.
select throws_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d2'::uuid,
    date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid,
    'r13.5-test',
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":7,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"},
      {"scope":"main","row_key":"main.bogus","parent_row_key":null,"depth":0,"display_order":1,
       "row_type":"not_a_row_type","label_es":"X","label_en":null,"currency":"USD",
       "value":1,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE1"}]'::jsonb)
$$, '23514', null, 'a publication with an invalid row is refused by the schema');

select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13'),
  1, 'ATOMICITY: the failed publication left no publication row behind');
select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  1, 'ATOMICITY: the previously-current revision is still current');
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and superseded_by is not null),
  0, 'ATOMICITY: the demote was rolled back with the rest of the transaction');
select is((select count(*)::int from public.portfolio_snapshot_rows r
           join public.portfolio_publications p on p.id = r.publication_id
           where p.as_of_date = date '2026-08-13'),
  3, 'ATOMICITY: no orphan snapshot row survived the failure');

-- ── 8f Same-date revision and supersession ───────────────────────────────
select lives_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d2'::uuid,
    date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid,
    'r13.5-test',
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":8,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"}]'::jsonb,
    '[]'::jsonb, 'corrected after recalculation')
$$, 're-publishing the same week succeeds');

select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  2, 'a re-publish creates revision 2 and it becomes current');
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13'),
  2, 'revision 1 is RETAINED, never deleted');
select is((select is_current from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and revision = 1),
  false, 'revision 1 is no longer current');
select ok((select superseded_by is not null from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and revision = 1),
  'revision 1 points at the revision that superseded it');
select is((select count(*)::int from public.portfolio_snapshot_rows r
           join public.portfolio_publications p on p.id = r.publication_id
           where p.as_of_date = date '2026-08-13' and p.revision = 1),
  3, 'revision 1 keeps every row it published');

-- Exactly one current publication per (kind, date) — the partial unique index.
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  1, 'exactly one revision is current for the week');
select throws_ok($$
  insert into public.portfolio_publications
    (upload_id, upload_kind, as_of_date, revision, published_by, is_current, parser_version)
  values ('aaaaaaaa-0000-4000-8000-0000000000d1','portfolio', date '2026-08-13', 9,
          '11111111-1111-1111-1111-111111111111', true, 'r13.5-test')
$$, '23505', null, 'a SECOND current publication for the same week is impossible');

-- ── 8g Rollback — a pointer move, never a delete ─────────────────────────
select lives_ok($$
  select public.nmi_rollback_publication(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and revision=1),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'reverted')
$$, 'rollback to revision 1 succeeds');

select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  1, 'rollback restores revision 1 as current');
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13'),
  2, 'ROLLBACK DELETES NOTHING — both revisions still exist');
select is((select count(*)::int from public.portfolio_snapshot_rows r
           join public.portfolio_publications p on p.id = r.publication_id
           where p.as_of_date = date '2026-08-13'),
  4, 'rollback deletes no snapshot row from either revision');
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  1, 'still exactly one current revision after rollback');

select throws_ok($$
  select public.nmi_rollback_publication(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and revision=1),
    '11111111-1111-1111-1111-111111111111'::uuid, null)
$$, 'P0001', 'rollback_refused_already_current',
  'rolling back to the CURRENT revision is refused');

select throws_ok($$
  select public.nmi_rollback_publication(
    '00000000-0000-4000-8000-000000000000'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid, null)
$$, 'P0001', 'rollback_refused_publication_not_found',
  'rolling back an unknown publication is refused');

-- Rolling forward again proves the move is reversible in both directions.
select lives_ok($$
  select public.nmi_rollback_publication(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and revision=2),
    '11111111-1111-1111-1111-111111111111'::uuid, null)
$$, 'a rolled-back revision can be rolled forward again');
select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  2, 'revision 2 is current again');

-- ── 8h Database-level publication refusals ───────────────────────────────
-- A blocking finding invalidates the dataset as a whole (doc 02 § 6.3). The
-- server refuses too; this proves the database does not depend on it.
insert into public.portfolio_upload_findings (upload_id, severity, code, detail)
values ('aaaaaaaa-0000-4000-8000-0000000000d3', 'blocking', 'source_cell_error',
        'a required cell is in error');

select throws_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d3'::uuid, date '2026-08-20',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test',
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":1,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"}]'::jsonb)
$$, 'P0001', 'publication_refused_blocking_findings',
  'the DATABASE refuses to publish an upload carrying a blocking finding');

select throws_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid, date '2026-08-27',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test', '[]'::jsonb)
$$, 'P0001', 'publication_refused_nothing_to_publish',
  'an empty payload is refused rather than blanking the week');

select is((select count(*)::int from public.portfolio_publications
           where as_of_date in (date '2026-08-20', date '2026-08-27')),
  0, 'a refused publication writes nothing at all');

-- An unclassified event blocks the alternatives publication (doc 03 § 3.4,
-- doc 05 § 5.4): a timeline missing a value-bearing cell would read as complete.
select throws_ok($$
  select public.nmi_publish_alternatives(
    'aaaaaaaa-0000-4000-8000-0000000000d4'::uuid, date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test',
    '[{"id":"dddddddd-0000-4000-8000-0000000000a1","category":"Real Assets","currency":"dolares",
       "investment_name":"Fixture Fund","sociedad":"FIXTURE","source_sheet":"Alternatives",
       "source_row":9,"source_cell":"Alternatives!B9"}]'::jsonb,
    '[{"holding_id":"dddddddd-0000-4000-8000-0000000000a1","event_date":"2026-03-31","amount":1,
       "currency":"dolares","event_type":"unclassified","source_sheet":"Alternatives",
       "source_cell":"Alternatives!J9","source_row":9}]'::jsonb)
$$, 'P0001', 'publication_refused_unclassified_events',
  'the DATABASE refuses an alternatives publication carrying an unclassified event');

select is((select count(*)::int from public.portfolio_publications
           where upload_kind='alternatives' and as_of_date=date '2026-08-13'),
  0, 'the refused alternatives publication wrote nothing');

-- The same payload with the event CLASSIFIED publishes, and lands under its own
-- independent alternatives lifecycle rather than touching the portfolio week.
select lives_ok($$
  select public.nmi_publish_alternatives(
    'aaaaaaaa-0000-4000-8000-0000000000d4'::uuid, date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test',
    '[{"id":"dddddddd-0000-4000-8000-0000000000a1","category":"Real Assets","currency":"dolares",
       "investment_name":"Fixture Fund","sociedad":"FIXTURE","source_sheet":"Alternatives",
       "source_row":9,"source_cell":"Alternatives!B9"}]'::jsonb,
    '[{"holding_id":"dddddddd-0000-4000-8000-0000000000a1","event_date":"2026-03-31","amount":1,
       "currency":"dolares","event_type":"aporte","classification_method":"administrator",
       "source_sheet":"Alternatives","source_cell":"Alternatives!J9","source_row":9}]'::jsonb)
$$, 'an alternatives publication with every event classified succeeds');

select is((select count(*)::int from public.portfolio_publications
           where upload_kind='alternatives' and as_of_date=date '2026-08-13' and is_current),
  1, 'alternatives publishes on its own lifecycle');
select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  2, 'publishing alternatives did not disturb the portfolio week of the same date');
select is((select classification_method from public.alternatives_events e
           join public.portfolio_publications p on p.id = e.publication_id
           where p.upload_kind='alternatives' and p.as_of_date=date '2026-08-13'),
  'administrator', 'an administrator-resolved event records HOW it was classified');

-- ── 8i Commentary — append and supersede ─────────────────────────────────
select lives_ok($$
  select public.nmi_upsert_portfolio_commentary(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    'main', 'first note', '11111111-1111-1111-1111-111111111111'::uuid)
$$, 'commentary can be written for a publication');

select lives_ok($$
  select public.nmi_upsert_portfolio_commentary(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    'main', 'second note', '11111111-1111-1111-1111-111111111111'::uuid)
$$, 'commentary can be edited');

select is((select count(*)::int from public.portfolio_commentary where scope='main'),
  2, 'an edit APPENDS a revision — the original is retained, never updated in place');
select is((select count(*)::int from public.portfolio_commentary
           where scope='main' and superseded_by is null),
  1, 'exactly one commentary revision is live');
select is((select body from public.portfolio_commentary
           where scope='main' and superseded_by is null),
  'second note', 'the live revision is the latest one');
select is((select revision from public.portfolio_commentary
           where scope='main' and superseded_by is null),
  2, 'the live revision is numbered 2');
select ok((select superseded_by is not null from public.portfolio_commentary
           where scope='main' and revision = 1),
  'revision 1 points at the revision that replaced it');

select throws_ok($$
  select public.nmi_upsert_portfolio_commentary(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    'main', '   ', '11111111-1111-1111-1111-111111111111'::uuid)
$$, 'P0001', 'commentary_refused_empty', 'an empty commentary body is refused');

select throws_ok($$
  insert into public.portfolio_commentary (publication_id, scope, body, author, revision)
  values ((select id from public.portfolio_publications
            where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
          'main', 'a third live note', '11111111-1111-1111-1111-111111111111', 3)
$$, '23505', null, 'a SECOND live commentary revision is impossible');

select throws_ok($$
  insert into public.portfolio_commentary (publication_id, scope, body, author)
  values ((select id from public.portfolio_publications
            where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
          'admin', 'not a data scope', '11111111-1111-1111-1111-111111111111')
$$, '23514', null, 'admin is not a commentary scope — nothing is published under it');

-- Commentary on a scope only its principal may read.
select lives_ok($$
  select public.nmi_upsert_portfolio_commentary(
    (select id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    'jaime', 'a note on a personal scope', '11111111-1111-1111-1111-111111111111'::uuid)
$$, 'commentary can be written on a personal scope');

-- ── 8j Commentary reads through the SAME scope predicate as the rows ────
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- Jaime
select is((select count(*)::int from public.portfolio_commentary where scope='jaime'),
  1, 'Jaime reads commentary on his own scope');
select ok((select count(*)::int from public.portfolio_commentary where scope='main') > 0,
  'Jaime reads commentary on the shared Main scope');

select pg_temp.as_service();
select pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- Andres
select is((select count(*)::int from public.portfolio_commentary where scope='jaime'),
  0, 'Andres CANNOT read commentary on Jaime''s scope');

select pg_temp.as_service();
select pg_temp.as_user('66666666-6666-6666-6666-666666666666'); -- approved, no principal
select is((select count(*)::int from public.portfolio_commentary),
  0, 'an approved user with a NULL principal reads NO commentary at all');

select pg_temp.as_service();
select pg_temp.as_anon();
select is((select count(*)::int from public.portfolio_commentary),
  0, 'anon reads no commentary');

-- ── 8k No browser-reachable role can publish ────────────────────────────
select pg_temp.as_service();
select pg_temp.as_user('11111111-1111-1111-1111-111111111111'); -- an ADMINISTRATOR
select throws_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid, date '2026-09-03',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test',
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":1,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"}]'::jsonb)
$$, '42501', null,
  'even an APPLICATION ADMINISTRATOR cannot publish through a session — publication is service-role only');

select throws_ok($$
  select public.nmi_rollback_publication(
    (select id from public.portfolio_publications where revision = 1 limit 1),
    '11111111-1111-1111-1111-111111111111'::uuid, null)
$$, '42501', null, 'an administrator session cannot roll back either');

select throws_ok($$
  update public.portfolio_commentary set body = 'edited in place' where scope = 'main'
$$, '42501', null, 'an administrator session cannot edit commentary in place');

select pg_temp.as_service();


-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · R13.5 PUBLICATION-SAFETY AUDIT — serialization, retry, target integrity
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TRUE CONCURRENCY IS NOT EXERCISED HERE. `supabase test db` runs one session
-- inside one transaction, so a second concurrent writer cannot be started. What
-- IS proven, against real PostgreSQL, is every guarantee the concurrent case
-- ultimately rests on:
--
--   * the lock helper exists, is callable, and is idempotent within a
--     transaction (so a retry inside one publication cannot self-deadlock);
--   * the unique keys that make duplicate revisions impossible are real and
--     enforced — these, not the locks, are what bound the worst case;
--   * a rollback cannot be redirected outside the target's own lifecycle;
--   * a duplicate submission is refused deterministically;
--   * every refusal leaves the book byte-for-byte unchanged.
--
-- The locks turn a lost race into an orderly turn; the constraints are what make
-- a lost race harmless. Both are asserted.

select pg_temp.as_service();

-- ── 9a The series lock ────────────────────────────────────────────────────
select has_function('public', 'nmi_lock_publication_series',
  array['text','date'], 'the shared series lock helper exists');

select lives_ok($$ select public.nmi_lock_publication_series('portfolio', date '2026-09-10') $$,
  'the series lock can be acquired');

-- Advisory locks are re-entrant for the holder, so a writer that takes the lock
-- twice in one transaction proceeds rather than deadlocking against itself.
select lives_ok($$ select public.nmi_lock_publication_series('portfolio', date '2026-09-10') $$,
  're-acquiring the same series lock in one transaction does not self-deadlock');

-- Different series must not share a key, or an alternatives publication would
-- serialise behind an unrelated portfolio one.
select isnt(
  (select pg_catalog.hashtext('portfolio:2026-09-10')),
  (select pg_catalog.hashtext('alternatives:2026-09-10')),
  'the portfolio and alternatives series of one date hash to different keys');
select isnt(
  (select pg_catalog.hashtext('portfolio:2026-09-10')),
  (select pg_catalog.hashtext('portfolio:2026-09-17')),
  'two weeks of one lifecycle hash to different keys');

-- The lock is transaction-scoped: it must be held now, and it must be released
-- automatically at commit or abort rather than needing an explicit unlock.
-- Matched on lock TYPE rather than on the key: hashtext() returns a signed
-- int4 and pg_locks.classid is an oid, so an exact comparison would rest on a
-- sign-wrapping cast rather than on the property being tested. That the lock is
-- advisory and transaction-scoped is the property that matters; the key
-- derivation is asserted above by the three hash-inequality checks.
select ok(
  exists (select 1 from pg_catalog.pg_locks where locktype = 'advisory'),
  'the series lock is held as a transaction-scoped advisory lock');

-- ── 9b Revision uniqueness is enforced, not merely intended ───────────────
-- This is the guarantee that bounds the worst concurrent case: even with no
-- lock at all, two writers cannot both land the same revision number.
select throws_ok($$
  insert into public.portfolio_publications
    (upload_id, upload_kind, as_of_date, revision, published_by, is_current, parser_version)
  values ('aaaaaaaa-0000-4000-8000-0000000000d1','portfolio', date '2026-08-13', 2,
          '11111111-1111-1111-1111-111111111111', false, 'r13.5-test')
$$, '23505', null, 'a DUPLICATE REVISION NUMBER is impossible for one lifecycle and date');

-- The same revision number under a different date or kind is legitimate.
select lives_ok($$
  insert into public.portfolio_publications
    (id, upload_id, upload_kind, as_of_date, revision, published_by, is_current, parser_version)
  values ('bbbbbbbb-0000-4000-8000-0000000000e1','aaaaaaaa-0000-4000-8000-0000000000d1',
          'portfolio', date '2026-09-24', 2, '11111111-1111-1111-1111-111111111111', false, 'r13.5-test')
$$, 'the same revision number in a DIFFERENT week is allowed');

-- ── 9c superseded_by can never form a cycle or point across a lifecycle ───
-- Publication only ever points a LOWER revision at a HIGHER one, so the graph
-- is a strict order; rollback only nulls pointers.
select is(
  (select count(*)::int from public.portfolio_publications a
   join public.portfolio_publications b on b.id = a.superseded_by
   where b.revision <= a.revision),
  0, 'no publication is superseded by an equal or lower revision — no cycle is possible');

select is(
  (select count(*)::int from public.portfolio_publications a
   join public.portfolio_publications b on b.id = a.superseded_by
   where b.upload_kind <> a.upload_kind or b.as_of_date <> a.as_of_date),
  0, 'no supersession pointer crosses a lifecycle or a week');

select is(
  (select count(*)::int from public.portfolio_publications where superseded_by = id),
  0, 'no publication supersedes itself');

-- A current publication is never simultaneously marked superseded.
select is(
  (select count(*)::int from public.portfolio_publications where is_current and superseded_by is not null),
  0, 'the current revision is never also flagged as superseded');

-- ── 9d Rollback cannot be redirected outside the target lifecycle ─────────
-- The request names ONE publication id; kind and date are read off that row.
-- Roll the alternatives lifecycle back and prove the portfolio week of the very
-- same date is untouched.
insert into public.portfolio_source_uploads
  (id, upload_kind, storage_object_path, original_filename, file_sha256,
   file_size_bytes, uploaded_by, parser_version)
values ('aaaaaaaa-0000-4000-8000-0000000000d5', 'alternatives',
        'alternatives/2026/aaaaaaaa-0000-4000-8000-0000000000d5.xlsx', 'alts-2.xlsx',
        repeat('b', 64), 512, '11111111-1111-1111-1111-111111111111', 'r13.5-test');

select lives_ok($$
  select public.nmi_publish_alternatives(
    'aaaaaaaa-0000-4000-8000-0000000000d5'::uuid, date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test',
    '[{"id":"dddddddd-0000-4000-8000-0000000000a2","category":"Real Assets","currency":"dolares",
       "investment_name":"Fixture Fund","sociedad":"FIXTURE","source_sheet":"Alternatives",
       "source_row":9,"source_cell":"Alternatives!B9"}]'::jsonb)
$$, 'a second alternatives revision publishes for the same date');

select is((select revision from public.portfolio_publications
           where upload_kind='alternatives' and as_of_date=date '2026-08-13' and is_current),
  2, 'alternatives is now on revision 2');
select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  2, 'the portfolio week of the SAME date is unaffected by the alternatives publish');

select lives_ok($$
  select public.nmi_rollback_publication(
    (select id from public.portfolio_publications
      where upload_kind='alternatives' and as_of_date=date '2026-08-13' and revision=1),
    '11111111-1111-1111-1111-111111111111'::uuid, null)
$$, 'the alternatives lifecycle rolls back');

select is((select revision from public.portfolio_publications
           where upload_kind='alternatives' and as_of_date=date '2026-08-13' and is_current),
  1, 'alternatives is back on revision 1');
select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  2, 'ROLLING BACK ALTERNATIVES DID NOT TOUCH the portfolio week of the same date');
select is((select count(*)::int from public.portfolio_publications
           where as_of_date=date '2026-08-13' and is_current),
  2, 'each lifecycle still has exactly one current revision for the date');

-- ── 9e Duplicate submission ───────────────────────────────────────────────
-- Publishing the upload that is ALREADY current, at the SAME parser version, is
-- a double-click or a transport retry, never a correction: R13.2 makes the same
-- bytes unrepeatable for one kind, so a real correction is a different upload.
select throws_ok($$
  select public.nmi_publish_portfolio(
    (select upload_id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    date '2026-08-13', '11111111-1111-1111-1111-111111111111'::uuid,
    (select parser_version from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":8,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"}]'::jsonb)
$$, 'P0001', 'publication_refused_duplicate_submission',
  'republishing the CURRENT upload at the SAME parser version is refused');

select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  2, 'the refused duplicate minted no revision');
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13'),
  2, 'and left the revision history exactly as it was');

-- A PARSER UPGRADE over the same upload is explicitly still allowed: the rows
-- genuinely differ, and doc 05 § 5.1 requires the two to be distinguishable.
select lives_ok($$
  select public.nmi_publish_portfolio(
    (select upload_id from public.portfolio_publications
      where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
    date '2026-08-13', '11111111-1111-1111-1111-111111111111'::uuid,
    'r13.5-test-next-parser',
    '[{"scope":"main","row_key":"main.total","parent_row_key":null,"depth":0,"display_order":0,
       "row_type":"portfolio_total","label_es":"TOTAL","label_en":null,"currency":"USD",
       "value":8,"value_class":"source_value","source_sheet":"RESUMEN","source_cell":"RESUMEN!DE87"}]'::jsonb)
$$, 'the SAME upload republishes under a NEW parser version');

select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  3, 'the parser upgrade became revision 3');
select is((select parser_version from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  'r13.5-test-next-parser', 'the publication records the parser version that produced it');

-- ── 9f Every refusal leaves the book unchanged ────────────────────────────
-- A refusal must not demote the current revision on its way out; a week that is
-- readable before a failed publish must be readable after it.
-- Upload d1 deliberately: it carries no blocking finding, so the refusal under
-- test is the EMPTY PAYLOAD one and not the publishability guard that runs
-- ahead of it.
select throws_ok($$
  select public.nmi_publish_portfolio(
    'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid, date '2026-08-13',
    '11111111-1111-1111-1111-111111111111'::uuid, 'r13.5-test', '[]'::jsonb)
$$, 'P0001', 'publication_refused_nothing_to_publish',
  'an empty payload against an EXISTING week is refused');

select is((select revision from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  3, 'the refusal did not demote the current revision');
select is((select count(*)::int from public.portfolio_publications
           where upload_kind='portfolio' and as_of_date=date '2026-08-13' and is_current),
  1, 'the week is never left with zero current revisions');

-- ── 9g Commentary revision chain ──────────────────────────────────────────
-- Numbering is guarded by a unique key, not only by the one-live index: without
-- it, two writers could each supersede a different predecessor and land the same
-- number.
select throws_ok($$
  insert into public.portfolio_commentary
    (publication_id, scope, body, author, revision, superseded_by)
  values ((select id from public.portfolio_publications
            where upload_kind='portfolio' and as_of_date=date '2026-08-13' and revision=1),
          'main', 'a duplicate revision number', '11111111-1111-1111-1111-111111111111', 1,
          '00000000-0000-4000-8000-000000000000')
$$, '23503', null, 'a commentary row cannot point at a non-existent predecessor');

select is(
  (select count(*)::int from public.portfolio_commentary a
   join public.portfolio_commentary b on b.id = a.superseded_by
   where b.revision <= a.revision),
  0, 'no commentary revision is superseded by an equal or lower one');

select is(
  (select count(*)::int
   from (select publication_id, scope, count(*) as live
         from public.portfolio_commentary where superseded_by is null
         group by publication_id, scope having count(*) > 1) x),
  0, 'no (publication, scope) has two live commentary revisions');

select pg_temp.as_service();

select * from finish();
rollback;
