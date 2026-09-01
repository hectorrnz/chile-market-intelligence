-- R13.6F — EXECUTABLE PostgreSQL validation of user provisioning and lifecycle.
--
-- Run by `supabase test db` against an isolated, disposable local stack that has
-- had the FULL migration chain applied from a clean database. Everything here
-- executes against real PostgreSQL: real triggers, real SECURITY DEFINER
-- functions, real GRANT/REVOKE, real RLS, through the real `auth.uid()` path.
-- Static text inspection lives in tests/userLifecycle.test.ts and is deliberately
-- NOT repeated here.
--
-- All identities below are throwaway rows created inside this transaction and
-- rolled back at the end. No production identity, credential or financial value
-- appears anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Impersonation helpers — the true runtime path, not a stub
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Fixtures
-- ═══════════════════════════════════════════════════════════════════════════
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('b1111111-1111-1111-1111-111111111111'::uuid, 'lc_admin@test.invalid'),
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'lc_active@test.invalid'),
  ('b3333333-3333-3333-3333-333333333333'::uuid, 'lc_disabled@test.invalid'),
  ('b4444444-4444-4444-4444-444444444444'::uuid, 'lc_invited@test.invalid'),
  ('b5555555-5555-5555-5555-555555555555'::uuid, 'lc_admin2@test.invalid'),
  ('b6666666-6666-6666-6666-666666666666'::uuid, 'lc_target@test.invalid')
) as u(id, email);

insert into public.user_profiles
  (id, username, email, display_name, role, portfolio_principal, invited_at, activated_at, disabled_at) values
  -- An ACTIVE administrator.
  ('b1111111-1111-1111-1111-111111111111', 'lc_admin',    'lc_admin@test.invalid',    'LC Admin',    'administrator', null,     null,  now(), null),
  -- An ACTIVE member holding every module and the jaime principal. The strongest
  -- possible member: if disabling still denies this account, it denies any.
  ('b2222222-2222-2222-2222-222222222222', 'lc_active',   'lc_active@test.invalid',   'LC Active',   'user',          'jaime',  now(), now(), null),
  -- DISABLED, but otherwise identical to the account above — same grants, same
  -- principal, same role. The ONLY difference is disabled_at.
  ('b3333333-3333-3333-3333-333333333333', 'lc_disabled', 'lc_disabled@test.invalid', 'LC Disabled', 'user',          'jaime',  now(), now(), now()),
  -- INVITED and never accepted: approved and granted, but not activated.
  ('b4444444-4444-4444-4444-444444444444', 'lc_invited',  'lc_invited@test.invalid',  'LC Invited',  'user',          'andres', now(), null,  null),
  -- A second administrator, used to make the last-admin scenarios deterministic.
  ('b5555555-5555-5555-5555-555555555555', 'lc_admin2',   'lc_admin2@test.invalid',   'LC Admin2',   'administrator', null,     null,  now(), null),
  -- A plain target for mutation tests.
  ('b6666666-6666-6666-6666-666666666666', 'lc_target',   'lc_target@test.invalid',   'LC Target',   'user',          null,     now(), now(), null);

-- The disabled and active members are given IDENTICAL grants on purpose. Every
-- denial proved below is therefore attributable to the lifecycle alone.
insert into public.user_module_grants (user_id, module_key) values
  ('b2222222-2222-2222-2222-222222222222', 'markets'),
  ('b2222222-2222-2222-2222-222222222222', 'portfolio'),
  ('b2222222-2222-2222-2222-222222222222', 'alternatives'),
  ('b2222222-2222-2222-2222-222222222222', 'structured_notes'),
  ('b3333333-3333-3333-3333-333333333333', 'markets'),
  ('b3333333-3333-3333-3333-333333333333', 'portfolio'),
  ('b3333333-3333-3333-3333-333333333333', 'alternatives'),
  ('b3333333-3333-3333-3333-333333333333', 'structured_notes'),
  ('b4444444-4444-4444-4444-444444444444', 'markets'),
  ('b4444444-4444-4444-4444-444444444444', 'portfolio');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The lifecycle columns exist, with the right shape
-- ═══════════════════════════════════════════════════════════════════════════
select has_column('public', 'user_profiles', 'invited_at',   'user_profiles.invited_at exists');
select has_column('public', 'user_profiles', 'activated_at', 'user_profiles.activated_at exists');
select has_column('public', 'user_profiles', 'disabled_at',  'user_profiles.disabled_at exists');

select col_type_is('public', 'user_profiles', 'invited_at',   'timestamp with time zone', 'invited_at is timestamptz');
select col_type_is('public', 'user_profiles', 'activated_at', 'timestamp with time zone', 'activated_at is timestamptz');
select col_type_is('public', 'user_profiles', 'disabled_at',  'timestamp with time zone', 'disabled_at is timestamptz');

-- NULLABLE by design: an invited account has no activation date, and defaulting
-- either column would make "never activated" unrepresentable.
select col_is_null('public', 'user_profiles', 'activated_at', 'activated_at is nullable — invited accounts have none');
select col_is_null('public', 'user_profiles', 'disabled_at',  'disabled_at is nullable — a live account has none');

-- No `enabled` boolean was introduced alongside them.
select hasnt_column('public', 'user_profiles', 'enabled',
  'no separate enabled flag — state is derived from the timestamps');


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · The usability rule
-- ═══════════════════════════════════════════════════════════════════════════
select is(public.nmi_profile_usable('u', now(), null),  true,  'approved + activated + not disabled = usable');
select is(public.nmi_profile_usable('u', now(), now()), false, 'disabled is NOT usable');
select is(public.nmi_profile_usable('u', null,  null),  false, 'never activated is NOT usable');
select is(public.nmi_profile_usable(null, now(), null), false, 'unapproved is NOT usable');
select is(public.nmi_profile_usable('',   now(), null), false, 'blank username is NOT usable');
select is(public.nmi_profile_usable('  ', now(), null), false, 'whitespace username is NOT usable');
select is(public.nmi_profile_usable(null, null,  now()), false, 'all-bad is NOT usable');

select is(
  (select p.provolatile from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='nmi_profile_usable'),
  'i'::"char", 'nmi_profile_usable is IMMUTABLE — it is a pure rule');


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · LIFECYCLE AUTHORIZATION — through the real auth.uid() path
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The ACTIVE member is the control. Everything below must work for them. ──
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select is(public.nmi_can_access_module('markets'),          true, 'ACTIVE member reaches a granted module');
select is(public.nmi_can_access_module('structured_notes'), true, 'ACTIVE member reaches granted structured_notes');
select is(public.nmi_current_module_grants(),
  array['alternatives','markets','portfolio','structured_notes'],
  'ACTIVE member holds their four grants');
select is(public.nmi_current_portfolio_scopes(), array['main','jaime','alternatives'],
  'ACTIVE member gets the frozen jaime ceiling');
select is(public.nmi_is_administrator(), false, 'ACTIVE member is not an administrator');

-- ── DISABLED: identical grants, identical principal, everything denied. ──────
select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');
select is(public.nmi_can_access_module('markets'),          false, 'DISABLED member is denied a module they still hold');
select is(public.nmi_can_access_module('structured_notes'), false, 'DISABLED member is denied structured_notes');
select is(public.nmi_current_module_grants(), array[]::text[],
  'DISABLED member resolves to ZERO grants even though the rows still exist');
select is(public.nmi_current_portfolio_scopes(), array[]::text[],
  'DISABLED member gets NO Portfolio scope');

-- The grant ROWS must survive, or reactivation could not restore anything.
select pg_temp.as_service();
select is(
  (select count(*)::int from public.user_module_grants
   where user_id = 'b3333333-3333-3333-3333-333333333333'),
  4, 'the disabled member KEEPS their four grant rows for reactivation');

-- ── INVITED but never activated: also denied. ───────────────────────────────
select pg_temp.as_user('b4444444-4444-4444-4444-444444444444');
select is(public.nmi_can_access_module('markets'), false, 'INVITED (not yet activated) is denied a granted module');
select is(public.nmi_current_module_grants(), array[]::text[], 'INVITED resolves to zero grants');
select is(public.nmi_current_portfolio_scopes(), array[]::text[], 'INVITED gets no Portfolio scope');

-- ── An ACTIVE administrator keeps everything, holding no grant rows. ────────
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select is(public.nmi_is_administrator(), true, 'ACTIVE administrator is an administrator');
select is(public.nmi_can_access_module('structured_notes'), true, 'ACTIVE administrator reaches every module by role');
select is(public.nmi_current_module_grants(), array[]::text[], 'the administrator holds no grant rows');
select is(public.nmi_current_portfolio_scopes(),
  array['main','jaime','andres','pablo','alternatives','admin'],
  'ACTIVE administrator keeps the full admin ceiling');


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · A DISABLED ADMINISTRATOR IS NOT AN ADMINISTRATOR
-- ═══════════════════════════════════════════════════════════════════════════
-- Disabling the second administrator is legal precisely because the first is
-- still active — which is also a positive test that the invariant does not fire
-- when it should not.
select pg_temp.as_service();
update public.user_profiles set disabled_at = now()
 where id = 'b5555555-5555-5555-5555-555555555555';

select pg_temp.as_user('b5555555-5555-5555-5555-555555555555');
select is(public.nmi_is_administrator(), false, 'a DISABLED administrator is not an administrator');
select is(public.nmi_can_access_module('markets'), false, 'a DISABLED administrator reaches no module');
select is(public.nmi_current_portfolio_scopes(), array[]::text[], 'a DISABLED administrator gets no Portfolio scope');

select pg_temp.as_service();
update public.user_profiles set disabled_at = null
 where id = 'b5555555-5555-5555-5555-555555555555';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · STRUCTURED NOTES — direct RLS denial for a disabled member
-- ═══════════════════════════════════════════════════════════════════════════
-- The point of this section: bypassing the application entirely and talking to
-- PostgREST/PostgreSQL directly must not help. The policy is unchanged by R13.6F;
-- it calls nmi_can_access_module('structured_notes'), which now denies.
select pg_temp.as_service();
insert into public.structured_notes
  (id, user_id, isin, product_name, issuer_name, structure_type, currency, status)
values ('bbbbbbbb-0000-0000-0000-00000000000f',
        'b1111111-1111-1111-1111-111111111111',
        'XS0000000LC1', 'LC Test Note', 'LC Test Issuer', 'autocallable', 'USD', 'active')
on conflict (id) do nothing;

select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.structured_notes
           where id = 'bbbbbbbb-0000-0000-0000-00000000000f'),
  1, 'ACTIVE member WITH the grant reads the note through RLS');

select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.structured_notes
           where id = 'bbbbbbbb-0000-0000-0000-00000000000f'),
  0, 'DISABLED member is denied the SAME note by RLS, with the grant row intact');

select pg_temp.as_user('b4444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.structured_notes
           where id = 'bbbbbbbb-0000-0000-0000-00000000000f'),
  0, 'INVITED (never activated) member is denied by RLS');

-- anon is denied HARDER than by RLS: the R13.6B.1 hardening revoked the table
-- privilege outright, so the read raises an insufficient-privilege error rather
-- than returning zero rows.
-- Asserting an empty result would understate the guarantee AND abort the script,
-- because a privilege error is an error, not an empty set. This matches the
-- canonical form already used by sensitive_surface_hardening_test.sql.
select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.structured_notes $$,
  '42501', null, 'anon cannot read structured_notes at all — R13.6B.1 intact');


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · LAST ACTIVE ADMINISTRATOR INVARIANT
-- ═══════════════════════════════════════════════════════════════════════════
-- Made deterministic regardless of what the migration chain or seed created:
-- demote every OTHER active administrator, which is safe because lc_admin is
-- active, leaving lc_admin as provably the last one.
select pg_temp.as_service();
update public.user_profiles set role = 'user'
 where role = 'administrator'
   and id <> 'b1111111-1111-1111-1111-111111111111'
   and public.nmi_profile_usable(username::text, activated_at, disabled_at);

select is(
  (select count(*)::int from public.user_profiles
   where role = 'administrator'
     and public.nmi_profile_usable(username::text, activated_at, disabled_at)),
  1, 'exactly one active administrator remains — the scenario is deterministic');

select throws_ok(
  $$ update public.user_profiles set disabled_at = now()
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'the final active administrator cannot be DISABLED');

select throws_ok(
  $$ update public.user_profiles set role = 'user'
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'the final active administrator cannot be DEMOTED');

select throws_ok(
  $$ update public.user_profiles set username = null
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'the final active administrator cannot have approval REMOVED');

select throws_ok(
  $$ update public.user_profiles set activated_at = null
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'the final active administrator cannot be DE-ACTIVATED');

select throws_ok(
  $$ delete from public.user_profiles
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'the final active administrator cannot be DELETED');

-- The guard protects the POPULATION, not one row: it must not block an ordinary
-- edit to the same administrator.
select lives_ok(
  $$ update public.user_profiles set display_name = 'LC Admin Renamed'
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'an unrelated edit to the last administrator is still allowed');

-- Restore a second administrator, then prove the guard stands down.
update public.user_profiles set role = 'administrator'
 where id = 'b5555555-5555-5555-5555-555555555555';
select lives_ok(
  $$ update public.user_profiles set role = 'user'
      where id = 'b1111111-1111-1111-1111-111111111111' $$,
  'with a second active administrator present, demotion is allowed');
update public.user_profiles set role = 'administrator'
 where id = 'b1111111-1111-1111-1111-111111111111';

-- The guard is attached for both statement kinds.
select has_trigger('public', 'user_profiles', 'user_profiles_last_administrator_guard',
  'the last-administrator guard trigger is attached');


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · ADMINISTRATIVE RPCs — authorization
-- ═══════════════════════════════════════════════════════════════════════════
-- A member must not be able to mutate anyone, including themselves.
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', 'pablo', array['markets']) $$,
  'not_administrator',
  'a MEMBER cannot change another account''s access');

select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b2222222-2222-2222-2222-222222222222'::uuid, 'administrator', null, array[]::text[]) $$,
  'not_administrator',
  'a MEMBER cannot promote THEMSELVES to administrator');

select throws_ok(
  $$ select public.nmi_admin_set_lifecycle(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'disable') $$,
  'not_administrator',
  'a MEMBER cannot disable another account');

-- A DISABLED administrator has lost the capability too.
select pg_temp.as_service();
update public.user_profiles set disabled_at = now()
 where id = 'b5555555-5555-5555-5555-555555555555';
select pg_temp.as_user('b5555555-5555-5555-5555-555555555555');
select throws_ok(
  $$ select public.nmi_admin_set_lifecycle(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'disable') $$,
  'not_administrator',
  'a DISABLED administrator cannot use the administrative RPCs');
select pg_temp.as_service();
update public.user_profiles set disabled_at = null
 where id = 'b5555555-5555-5555-5555-555555555555';

select pg_temp.as_anon();
select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', null, array['markets']) $$,
  -- anon is stopped one layer EARLIER than the in-body guard: EXECUTE on the
  -- administrative RPCs is not granted to it at all, so the call is refused on
  -- privilege before nmi_assert_admin_actor() can raise not_authenticated. The
  -- in-body guard is still proven above for an authenticated non-administrator.
  '42501', null,
  'anon cannot even EXECUTE the administrative RPCs');


-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · ROLE / PRINCIPAL / MODULE MUTATION, AND AUDIT ATOMICITY
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');

-- Baseline: the target has no grants and no principal.
select is(
  (select count(*)::int from public.user_module_grants
   where user_id = 'b6666666-6666-6666-6666-666666666666'),
  0, 'the mutation target starts with no grants');

select lives_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', 'pablo',
       array['markets','portfolio']) $$,
  'an administrator can set role, principal and modules in one call');

select pg_temp.as_service();
select is(
  (select array_agg(module_key order by module_key)::text[] from public.user_module_grants
   where user_id = 'b6666666-6666-6666-6666-666666666666'),
  array['markets','portfolio'], 'the requested modules were granted');
select is(
  (select portfolio_principal from public.user_profiles
   where id = 'b6666666-6666-6666-6666-666666666666'),
  'pablo', 'the principal was set');

-- AUDIT ATOMICITY: the access change and its audit rows are in one transaction,
-- so the trail must already be complete without any second call.
select is(
  (select count(*)::int from public.family_portfolio_access_audit
   where target_user_id = 'b6666666-6666-6666-6666-666666666666'
     and field_changed = 'module_grant' and new_value = 'granted'),
  2, 'both module grants were audited in the same transaction');
select is(
  (select count(*)::int from public.family_portfolio_access_audit
   where target_user_id = 'b6666666-6666-6666-6666-666666666666'
     and field_changed = 'portfolio_principal'),
  1, 'the principal change was audited');
select is(
  (select actor_user_id from public.family_portfolio_access_audit
   where target_user_id = 'b6666666-6666-6666-6666-666666666666'
     and field_changed = 'portfolio_principal' limit 1),
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'the audit records the real administrator as actor, not "the server"');

-- Revocation is audited too, and the module set converges rather than accumulates.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', 'pablo', array['markets']) $$,
  'modules can be reduced');
select pg_temp.as_service();
select is(
  (select array_agg(module_key)::text[] from public.user_module_grants
   where user_id = 'b6666666-6666-6666-6666-666666666666'),
  array['markets'], 'the revoked module is gone');
select is(
  (select count(*)::int from public.family_portfolio_access_audit
   where target_user_id = 'b6666666-6666-6666-6666-666666666666'
     and field_changed = 'module_grant' and new_value = 'revoked'),
  1, 'the revocation was audited');

-- A module the registry does not declare is refused, and nothing is written.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', 'pablo', array['jaime']) $$,
  'unknown_module',
  'a Portfolio principal name is NOT a grantable module');
select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', 'pablo', array['not_a_module']) $$,
  'unknown_module',
  'an undeclared module key is refused');
select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'user', 'mallorca', array['markets']) $$,
  'invalid_principal',
  'an invented principal is refused');
select throws_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'superuser', null, array['markets']) $$,
  'invalid_role',
  'an invented role is refused');

select pg_temp.as_service();
select is(
  (select array_agg(module_key)::text[] from public.user_module_grants
   where user_id = 'b6666666-6666-6666-6666-666666666666'),
  array['markets'], 'a refused call changed nothing — the whole function rolled back');

-- Promotion canonicalizes: an administrator holds no grant rows and no principal.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.nmi_admin_update_access(
       'b6666666-6666-6666-6666-666666666666'::uuid, 'administrator', 'pablo',
       array['markets','portfolio']) $$,
  'a member can be promoted to administrator');
select pg_temp.as_service();
select is(
  (select count(*)::int from public.user_module_grants
   where user_id = 'b6666666-6666-6666-6666-666666666666'),
  0, 'promotion CLEARS grant rows — no fossil to spring back on demotion');
select is(
  (select portfolio_principal from public.user_profiles
   where id = 'b6666666-6666-6666-6666-666666666666'),
  null, 'promotion canonicalizes the principal to null');


-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · DISABLE / REACTIVATE through the RPC
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.nmi_admin_set_lifecycle(
       'b2222222-2222-2222-2222-222222222222'::uuid, 'disable') $$,
  'an administrator can disable an active member');

select pg_temp.as_service();
select isnt(
  (select disabled_at from public.user_profiles where id = 'b2222222-2222-2222-2222-222222222222'),
  null, 'disabled_at is set');
select isnt(
  (select activated_at from public.user_profiles where id = 'b2222222-2222-2222-2222-222222222222'),
  null, 'activated_at is PRESERVED — disabling is not lossy');
select is(
  (select count(*)::int from public.user_module_grants
   where user_id = 'b2222222-2222-2222-2222-222222222222'),
  4, 'the grants are PRESERVED across a disable');
select is(
  (select portfolio_principal from public.user_profiles where id = 'b2222222-2222-2222-2222-222222222222'),
  'jaime', 'the principal is PRESERVED across a disable');
select is(
  (select count(*)::int from public.family_portfolio_access_audit
   where target_user_id = 'b2222222-2222-2222-2222-222222222222' and field_changed = 'user_disable'),
  1, 'the disable was audited');

-- Denied immediately, in the same transaction, with no re-login.
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select is(public.nmi_can_access_module('markets'), false,
  'the just-disabled member is denied on the very next statement');

-- Reactivation restores exactly what was there.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.nmi_admin_set_lifecycle(
       'b2222222-2222-2222-2222-222222222222'::uuid, 'reactivate') $$,
  'an administrator can reactivate a disabled member');

select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select is(public.nmi_can_access_module('markets'), true, 'reactivation restores module access');
select is(public.nmi_current_portfolio_scopes(), array['main','jaime','alternatives'],
  'reactivation restores the exact Portfolio ceiling');

select pg_temp.as_service();
select is(
  (select count(*)::int from public.family_portfolio_access_audit
   where target_user_id = 'b2222222-2222-2222-2222-222222222222' and field_changed = 'user_reactivate'),
  1, 'the reactivation was audited');

-- Idempotent.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select is(
  (public.nmi_admin_set_lifecycle('b2222222-2222-2222-2222-222222222222'::uuid, 'reactivate') ->> 'changed'),
  'false', 'reactivating an already-active account is a no-op');
select throws_ok(
  $$ select public.nmi_admin_set_lifecycle(
       'b2222222-2222-2222-2222-222222222222'::uuid, 'obliterate') $$,
  'invalid_action', 'an unknown lifecycle action is refused');


-- ═══════════════════════════════════════════════════════════════════════════
-- 11 · ACTIVATION takes no target
-- ═══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nmi_activate_current_user'
     and p.pronargs = 0),
  1, 'nmi_activate_current_user takes ZERO arguments — it cannot target another account');

select pg_temp.as_user('b4444444-4444-4444-4444-444444444444');
select is((public.nmi_activate_current_user() ->> 'changed'), 'true',
  'the invited user activates themselves');
select is(public.nmi_can_access_module('markets'), true,
  'after activation the member reaches their granted module');
select is((public.nmi_activate_current_user() ->> 'changed'), 'false',
  'activation is idempotent — a second call changes nothing');

select pg_temp.as_service();
select is(
  (select count(*)::int from public.family_portfolio_access_audit
   where target_user_id = 'b4444444-4444-4444-4444-444444444444' and field_changed = 'user_activate'),
  1, 'activation was audited exactly ONCE despite two calls');

-- A disabled account cannot activate its way back in.
select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select public.nmi_activate_current_user() $$,
  'account_disabled',
  'a DISABLED account cannot activate itself back into the platform');

select pg_temp.as_anon();
select throws_ok(
  $$ select public.nmi_activate_current_user() $$,
  -- Same layering as above: the EXECUTE privilege is withheld from anon, so
  -- activation is unreachable without an authenticated session at all.
  '42501', null, 'anon cannot even EXECUTE activation');


-- ═══════════════════════════════════════════════════════════════════════════
-- 12 · AUDIT KINDS
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.as_service();
select lives_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
     values ('b6666666-6666-6666-6666-666666666666','b1111111-1111-1111-1111-111111111111',
             'administrator','user_invite',null,'user') $$,
  'user_invite is an accepted audit kind');

select throws_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
     values ('b6666666-6666-6666-6666-666666666666','b1111111-1111-1111-1111-111111111111',
             'administrator','something_else',null,'x') $$,
  '23514', null, 'an undeclared audit kind is still refused');

-- A lifecycle row must not name a module; a module row must.
select throws_ok(
  $$ insert into public.family_portfolio_access_audit
       (target_user_id, actor_user_id, actor_kind, field_changed, module_key, previous_value, new_value)
     values ('b6666666-6666-6666-6666-666666666666','b1111111-1111-1111-1111-111111111111',
             'administrator','user_disable','markets','active','disabled') $$,
  '23514', null, 'a lifecycle audit row must not name a module');


-- ═══════════════════════════════════════════════════════════════════════════
-- 13 · REGRESSION — the frozen contracts are untouched
-- ═══════════════════════════════════════════════════════════════════════════
select is((select count(*)::int from public.app_modules), 7, 'the module registry is still exactly 7');
select is(
  (select array_agg(module_key order by display_order)::text[] from public.app_modules),
  array['markets','analysis','macro','earnings','portfolio','alternatives','structured_notes'],
  'the module registry is unchanged, in order');

select is(public.nmi_portfolio_scopes(true, false, 'jaime'),  array['main','jaime','alternatives'],  'jaime ceiling frozen');
select is(public.nmi_portfolio_scopes(true, false, 'andres'), array['main','andres','alternatives'], 'andres ceiling frozen');
select is(public.nmi_portfolio_scopes(true, false, 'pablo'),  array['main','pablo','alternatives'],  'pablo ceiling frozen');
select is(public.nmi_portfolio_scopes(true, false, null),     array[]::text[],                       'no principal = no scopes');
select is(public.nmi_portfolio_scopes(true, true,  null),
  array['main','jaime','andres','pablo','alternatives','admin'], 'admin ceiling frozen');

-- No sibling leakage, re-proved with lifecycle in play.
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select is(public.nmi_can_access_scope('andres'), false, 'jaime cannot reach andres');
select is(public.nmi_can_access_scope('pablo'),  false, 'jaime cannot reach pablo');
select is(public.nmi_can_access_scope('admin'),  false, 'a member cannot reach the admin scope');

-- default_for_member remains provisioning metadata only: it appears in no
-- authorization function's body.
select pg_temp.as_service();
select is(
  (select count(*)::int from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('nmi_module_allowed','nmi_can_access_module','nmi_current_module_grants',
                       'nmi_is_administrator','nmi_profile_usable','nmi_current_portfolio_scopes')
     and pg_get_functiondef(p.oid) like '%default_for_member%'),
  0, 'NO authorization function consults default_for_member');

-- user_profiles is still administrator-controlled at the privilege level.
select is(has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE'), false,
  'authenticated still cannot UPDATE user_profiles directly');
select is(has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'), false,
  'authenticated still cannot INSERT user_profiles directly');
select is(has_table_privilege('anon', 'public.user_profiles', 'SELECT'), false,
  'anon still cannot read user_profiles');

-- ═══════════════════════════════════════════════════════════════════════════
-- 14 · nmi_admin_provision_invite IS EXECUTED, NOT MERELY DECLARED
-- ═══════════════════════════════════════════════════════════════════════════
-- Added after `supabase db lint` found a REAL defect no assertion could have
-- caught: this function is the single most important new write path, and it was
-- the ONE administrative RPC that no test ever called. Its `v_username::citext`
-- cast is unresolvable under `set search_path = ''`, so every real invitation
-- would have failed at runtime with `type "citext" does not exist`.
--
-- The lesson generalises: a function that is only ever asserted to EXIST is not
-- covered. These assertions run the body end to end.

select pg_temp.as_service();
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('b8888888-8888-8888-8888-888888888888'::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated', 'lc_invitee@test.invalid', 'x', now(), now(), now())
on conflict (id) do nothing;

select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');

-- The happy path actually runs.
select lives_ok(
  $$ select public.nmi_admin_provision_invite(
       'b8888888-8888-8888-8888-888888888888'::uuid,
       'lc_invitee', 'lc_invitee@test.invalid', 'LC Invitee',
       'user', 'andres', array['markets','macro']) $$,
  'nmi_admin_provision_invite EXECUTES — the citext cast no longer breaks it');

select pg_temp.as_service();
select is((select count(*)::int from public.user_profiles
           where id = 'b8888888-8888-8888-8888-888888888888'),
  1, 'the invited profile row exists');
select isnt((select invited_at from public.user_profiles
             where id = 'b8888888-8888-8888-8888-888888888888'),
  null, 'invited_at is stamped');
select is((select activated_at from public.user_profiles
           where id = 'b8888888-8888-8888-8888-888888888888'),
  null, 'activated_at stays NULL — an invitation is not an activation');
select is((select count(*)::int from public.user_module_grants
           where user_id = 'b8888888-8888-8888-8888-888888888888'),
  2, 'the chosen module grants were written');
-- The audit is asserted by PROPERTY, not by a guessed row count: exactly one
-- user_invite row, and the trail committed in the same transaction as the
-- access it describes. Pinning a total would break whenever a kind is added,
-- without telling anyone anything about atomicity.
select is((select count(*)::int from public.family_portfolio_access_audit
           where target_user_id = 'b8888888-8888-8888-8888-888888888888'
             and field_changed = 'user_invite'),
  1, 'exactly one user_invite audit row');
select cmp_ok((select count(*)::int from public.family_portfolio_access_audit
               where target_user_id = 'b8888888-8888-8888-8888-888888888888'),
  '>=', 1, 'the invitation is audited in the SAME transaction that provisioned it');

-- The invited account is still denied everything until it activates.
select pg_temp.as_user('b8888888-8888-8888-8888-888888888888');
select is((select count(*)::int from unnest(public.nmi_current_module_grants()) g), 0,
  'an INVITED account holds no effective grants despite its grant rows');

-- A username already taken by someone else is a clean refusal, which is the
-- branch that dereferenced citext.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ select public.nmi_admin_provision_invite(
       'b8888888-8888-8888-8888-888888888888'::uuid,
       'lc_admin', 'other@test.invalid', 'Clash',
       'user', null, array['markets']) $$,
  'username_taken', 'a username belonging to another account is refused cleanly');

-- Re-inviting an ACTIVATED account must never silently re-open it.
select throws_ok(
  $$ select public.nmi_admin_provision_invite(
       'b2222222-2222-2222-2222-222222222222'::uuid,
       'lc_active', 'lc_active@test.invalid', 'LC Active',
       'user', null, array['markets']) $$,
  'already_activated', 'an activated account cannot be re-provisioned by invite');


select * from finish();
rollback;
