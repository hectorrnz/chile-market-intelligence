-- D0C - EXECUTABLE PostgreSQL validation of the serialised last-administrator
-- guard added by 20260824000000_last_administrator_serialization.sql.
--
-- WHY THIS FILE EXISTS, GIVEN THE MIGRATION ALREADY CARRIES POSTCONDITIONS.
-- Those postconditions run exactly once, when THAT migration applies. A later
-- migration that replaced `nmi_guard_last_administrator` without the lock - the
-- single most likely way this protection gets lost - would apply perfectly
-- cleanly, because nothing would re-run the older file's checks. These
-- assertions run on every chain, against whatever the function is BY THEN, so
-- the serialisation cannot be dropped silently.
--
-- WHAT THIS FILE CANNOT DO. It cannot prove the race is closed. pgTAP is one
-- session inside one transaction, and a write skew is a property of two
-- transactions that cannot see each other. The behavioural proof lives in
-- scripts/ci/lastAdminRaceProof.ts, which drives two real backends through the
-- interleaving; this file pins the STRUCTURE that proof depends on.
--
-- Every identity below is a throwaway created inside this transaction and rolled
-- back at the end. No production identity, credential or email address appears.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · THE LOCK HELPER EXISTS, AND IS THE RIGHT KIND OF LOCK
-- ═══════════════════════════════════════════════════════════════════════════

select has_function('public', 'nmi_lock_administrator_population', '{}'::text[],
  'the population lock helper exists');

select is(
  (select p.prosrc like '%pg_advisory_xact_lock%'
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_lock_administrator_population'),
  true,
  'it takes a TRANSACTION-scoped advisory lock');

-- A session-scoped lock would survive a rollback and strand every later
-- administrator mutation until the connection was recycled.
select is(
  (select p.prosrc like '%pg_advisory_lock(%'
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_lock_administrator_population'),
  false,
  'it does NOT take a session-scoped lock');

-- `set search_path = ''` plus a fully-qualified call, exactly as every other
-- security-sensitive function in this schema.
select is(
  (select p.proconfig::text like '%search_path=%'
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_lock_administrator_population'),
  true,
  'it pins its search_path');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · NO CLIENT ROLE MAY TAKE THE KEY
-- ═══════════════════════════════════════════════════════════════════════════
-- A caller that could take this key at will could stall every administrator
-- mutation in the platform for the length of its transaction.

select ok(
  not has_function_privilege('anon', 'public.nmi_lock_administrator_population()', 'EXECUTE'),
  'anon cannot take the population lock');

select ok(
  not has_function_privilege('authenticated', 'public.nmi_lock_administrator_population()', 'EXECUTE'),
  'authenticated cannot take the population lock');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · THE GUARD TAKES IT, AND TAKES IT BEFORE DECIDING
-- ═══════════════════════════════════════════════════════════════════════════
-- Position is the whole correctness argument. A lock acquired after the decisive
-- count would serialise nothing at all while reading as though it did.

select is(
  (select p.prosrc like '%nmi_lock_administrator_population%'
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_guard_last_administrator'),
  true,
  'the guard takes the population lock');

select ok(
  (select position('nmi_lock_administrator_population' in p.prosrc)
        < position('select count(*)' in p.prosrc)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_guard_last_administrator'),
  'the guard takes the lock BEFORE it counts the remaining population');

-- The two early returns must stay AHEAD of the lock, or every ordinary edit to
-- every profile would queue behind administrator removals.
select ok(
  (select position('if not v_was_active_admin then' in p.prosrc)
        < position('nmi_lock_administrator_population' in p.prosrc)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_guard_last_administrator'),
  'a row that was not an active administrator returns before the lock is taken');

select ok(
  (select position('if v_is_active_admin then' in p.prosrc)
        < position('nmi_lock_administrator_population' in p.prosrc)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_guard_last_administrator'),
  'an administrator who stays an administrator returns before the lock is taken');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · THE GUARD IS STILL ATTACHED, AND STILL SECURITY DEFINER
-- ═══════════════════════════════════════════════════════════════════════════

select has_trigger('public', 'user_profiles', 'user_profiles_last_administrator_guard',
  'the last-administrator guard trigger is still attached');

select is(
  (select p.prosecdef
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nmi_guard_last_administrator'),
  true,
  'the guard is still SECURITY DEFINER, so it sees the whole population');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · THE REFUSAL IS UNCHANGED
-- ═══════════════════════════════════════════════════════════════════════════
-- D0C added serialisation, not a new error surface. The loser of a race must
-- receive exactly the refusal a sequential caller already receives, so that no
-- client needs to learn a second code.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'd0c_sole@test.invalid'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'd0c_member@test.invalid')
) as u(id, email);

insert into public.user_profiles
  (id, username, email, display_name, role, portfolio_principal, invited_at, activated_at, disabled_at) values
  ('c1111111-1111-1111-1111-111111111111', 'd0c_sole',   'd0c_sole@test.invalid',   'D0C Sole',   'administrator', null, null, now(), null),
  ('c2222222-2222-2222-2222-222222222222', 'd0c_member', 'd0c_member@test.invalid', 'D0C Member', 'user',          null, null, now(), null);

select throws_ok(
  $$ update public.user_profiles set role = 'user'
      where id = 'c1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'demoting the sole administrator still raises the same bare token');

select throws_ok(
  $$ update public.user_profiles set disabled_at = now()
      where id = 'c1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'disabling the sole administrator still raises the same bare token');

select throws_ok(
  $$ delete from public.user_profiles
      where id = 'c1111111-1111-1111-1111-111111111111' $$,
  'last_administrator',
  'deleting the sole administrator still raises the same bare token');

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · ORDINARY EDITS ARE NEITHER REFUSED NOR SERIALISED
-- ═══════════════════════════════════════════════════════════════════════════
-- The guard protects a population, not a row. Renaming the sole administrator
-- changes nothing about the population and must pass without taking the lock.

select lives_ok(
  $$ update public.user_profiles set display_name = 'D0C Sole renamed'
      where id = 'c1111111-1111-1111-1111-111111111111' $$,
  'the sole administrator can still be edited in ways that do not remove them');

select lives_ok(
  $$ update public.user_profiles set display_name = 'D0C Member renamed'
      where id = 'c2222222-2222-2222-2222-222222222222' $$,
  'an ordinary member edit is unaffected');

-- Promoting a second administrator is not a population reduction, so it is
-- allowed - and it is what makes the first administrator removable again.
select lives_ok(
  $$ update public.user_profiles set role = 'administrator'
      where id = 'c2222222-2222-2222-2222-222222222222' $$,
  'promoting a second administrator is allowed');

select lives_ok(
  $$ update public.user_profiles set role = 'user'
      where id = 'c1111111-1111-1111-1111-111111111111' $$,
  'and with two administrators, the first may now be demoted');

select throws_ok(
  $$ update public.user_profiles set role = 'user'
      where id = 'c2222222-2222-2222-2222-222222222222' $$,
  'last_administrator',
  'but the one that remains may not - the floor is one, always');

select * from finish();
rollback;
