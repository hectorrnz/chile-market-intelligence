-- POST-R13.6B.1 — EXECUTABLE PostgreSQL validation of the Structured Notes and
-- notification-recipient hardening.
--
-- WHY THIS FILE EXISTS. The exposure being closed was reachable through the
-- PUBLIC Supabase REST endpoint with the anon key — no Next.js route involved.
-- Proving the fix therefore requires exercising the database directly, as the
-- roles PostgREST actually assumes (`anon`, `authenticated`, `service_role`),
-- through the real `auth.uid()` path. These tests deliberately BYPASS every
-- application route: an API guard that passes tells you nothing about what a
-- member can do with a REST client and a session token.
--
-- READ THE DENIAL SHAPES CAREFULLY — they differ by verb, and asserting the
-- wrong one would make a test vacuous:
--   · no privilege at all (anon, or a cron-owned table)  -> ERROR 42501
--   · INSERT refused by RLS                              -> ERROR 42501
--   · UPDATE/DELETE refused by RLS                       -> NO error, 0 rows
--     touched, because RLS filters the target rows away. Those cases are proven
--     by re-reading the row afterwards as a privileged role and showing it is
--     unchanged / still present. A `throws_ok` there would fail, and asserting
--     "no error" alone would prove nothing at all.
--   · SELECT refused by RLS                              -> NO error, 0 rows
--
-- All identities and records below are throwaway rows created inside this
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
  ('b1111111-1111-1111-1111-111111111111'::uuid, 'sn_admin@test.invalid'),
  ('b2222222-2222-2222-2222-222222222222'::uuid, 'sn_granted@test.invalid'),
  ('b3333333-3333-3333-3333-333333333333'::uuid, 'sn_ungranted@test.invalid'),
  ('b4444444-4444-4444-4444-444444444444'::uuid, 'sn_unapproved@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('b1111111-1111-1111-1111-111111111111', 'sn_admin',     'sn_admin@test.invalid',     'SN Admin',     'administrator', null),
  ('b2222222-2222-2222-2222-222222222222', 'sn_granted',   'sn_granted@test.invalid',   'SN Granted',   'user',          'jaime'),
  ('b3333333-3333-3333-3333-333333333333', 'sn_ungranted', 'sn_ungranted@test.invalid', 'SN Ungranted', 'user',          'andres'),
  -- Unapproved (NULL username) yet deliberately granted everything below:
  -- approval must remain the outer gate no matter what grants exist.
  ('b4444444-4444-4444-4444-444444444444', null,           'sn_unapproved@test.invalid','SN Unapproved','user',          'pablo');

insert into public.user_module_grants (user_id, module_key) values
  -- The granted member holds structured_notes: read yes, write no.
  ('b2222222-2222-2222-2222-222222222222', 'structured_notes'),
  ('b2222222-2222-2222-2222-222222222222', 'markets'),
  -- The ungranted member holds OTHER modules, proving denial is specific to the
  -- missing grant rather than to holding no grants at all.
  ('b3333333-3333-3333-3333-333333333333', 'markets'),
  ('b3333333-3333-3333-3333-333333333333', 'portfolio'),
  ('b4444444-4444-4444-4444-444444444444', 'structured_notes');

-- One note with a child underlying and a sociedad allocation — the allocation is
-- the internal, most sensitive record on this surface.
insert into public.structured_notes (id, user_id, isin, product_name, structure_type, currency, status)
values ('bbbb0001-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111111',
        'XS0000000TEST', 'Fixture Note', 'autocall', 'USD', 'active');

insert into public.structured_note_underlyings
  (id, note_id, user_id, underlying_order, underlying_name, bloomberg_ticker)
values ('bbbb0002-0000-0000-0000-000000000002', 'bbbb0001-0000-0000-0000-000000000001',
        'b1111111-1111-1111-1111-111111111111', 1, 'Fixture Underlying', 'TEST Index');

insert into public.structured_note_allocations
  (id, note_id, user_id, entity_name, notional_amount)
values ('bbbb0003-0000-0000-0000-000000000003', 'bbbb0001-0000-0000-0000-000000000001',
        'b1111111-1111-1111-1111-111111111111', 'Fixture Entity', 1000);

insert into public.notification_recipients (id, email, label, active)
values ('bbbb0004-0000-0000-0000-000000000004', 'fixture-recipient@test.invalid', 'Fixture', true);

-- Role helpers: set BOTH the JWT claim and the database role, so auth.uid()
-- resolves exactly as it does for a real PostgREST request.
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
-- 1 · ANONYMOUS — no privilege at all on either surface
-- ═══════════════════════════════════════════════════════════════════════════
-- anon was revoked at the privilege level, so it never even reaches RLS. Every
-- verb is a hard 42501, including SELECT.

select pg_temp.as_anon();

select throws_ok($$ select count(*) from public.structured_notes $$,
  '42501', null, 'anon cannot read structured_notes');
select throws_ok($$ select count(*) from public.structured_note_allocations $$,
  '42501', null, 'anon cannot read sociedad allocations');
select throws_ok($$ insert into public.structured_notes (user_id, product_name, structure_type)
                    values ('b1111111-1111-1111-1111-111111111111', 'x', 'autocall') $$,
  '42501', null, 'anon cannot insert a structured note');
select throws_ok($$ update public.structured_notes set product_name = 'x' $$,
  '42501', null, 'anon cannot update structured notes');
select throws_ok($$ delete from public.structured_notes $$,
  '42501', null, 'anon cannot delete structured notes');
select throws_ok($$ select count(*) from public.notification_recipients $$,
  '42501', null, 'anon cannot read recipient addresses');
select throws_ok($$ insert into public.notification_recipients (email) values ('x@test.invalid') $$,
  '42501', null, 'anon cannot add a recipient');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · MEMBER **WITHOUT** THE structured_notes GRANT
-- ═══════════════════════════════════════════════════════════════════════════
-- Approved, holding other modules, and denied everything here. This is the case
-- the pre-existing `auth.uid() is not null` policy got wrong.

select pg_temp.as_service();
select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');

select is((select count(*)::int from public.structured_notes), 0,
  'an ungranted member sees NO structured notes');
select is((select count(*)::int from public.structured_note_allocations), 0,
  'an ungranted member sees NO sociedad allocations');
select is((select count(*)::int from public.structured_note_underlyings), 0,
  'an ungranted member sees NO underlyings');

select throws_ok($$ insert into public.structured_notes (user_id, product_name, structure_type)
                    values ('b1111111-1111-1111-1111-111111111111', 'x', 'autocall') $$,
  '42501', null, 'an ungranted member cannot insert a structured note');

-- UPDATE/DELETE refused by RLS touch zero rows rather than raising; the proof is
-- that the record is untouched afterwards (asserted in section 3, which runs the
-- same attempts for the GRANTED member — the stronger case).
update public.structured_notes set product_name = 'UNGRANTED-WRITE';
delete from public.structured_note_allocations;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · MEMBER **WITH** THE structured_notes GRANT — READ ONLY
-- ═══════════════════════════════════════════════════════════════════════════
-- THE central assertion of this stage: the grant opens reading and nothing else.

select pg_temp.as_service();
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.structured_notes), 1,
  'a granted member CAN read the notes book');
select is((select count(*)::int from public.structured_note_allocations), 1,
  'a granted member CAN read sociedad allocations');
select is((select count(*)::int from public.structured_note_underlyings), 1,
  'a granted member CAN read underlyings');
select is((select product_name from public.structured_notes limit 1), 'Fixture Note',
  'a granted member reads the real row, not an empty shell');

select throws_ok($$ insert into public.structured_notes (user_id, product_name, structure_type)
                    values ('b1111111-1111-1111-1111-111111111111', 'MEMBER-INSERT', 'autocall') $$,
  '42501', null, 'a granted member CANNOT insert a structured note');
select throws_ok($$ insert into public.structured_note_allocations (note_id, entity_name, notional_amount)
                    values ('bbbb0001-0000-0000-0000-000000000001', 'MEMBER-ENTITY', 1) $$,
  '42501', null, 'a granted member CANNOT add a sociedad allocation');

-- Cron-owned tables: no privilege AND no policy, so even a read-granted member
-- is stopped at the privilege layer for writes.
select throws_ok($$ insert into public.structured_note_price_snapshots
                    (note_id, underlying_id, price_date, price, source)
                    values ('bbbb0001-0000-0000-0000-000000000001',
                            'bbbb0002-0000-0000-0000-000000000002', current_date, 1, 'x') $$,
  '42501', null, 'a granted member CANNOT write a cron-owned price snapshot');

-- RLS-refused UPDATE/DELETE are silent no-ops; both are attempted here and
-- disproved by re-reading as a privileged role immediately below.
update public.structured_notes set product_name = 'MEMBER-WRITE';
update public.structured_note_allocations set notional_amount = 999999;
delete from public.structured_note_allocations;
delete from public.structured_notes;

select pg_temp.as_service();

select is((select product_name from public.structured_notes
            where id = 'bbbb0001-0000-0000-0000-000000000001'), 'Fixture Note',
  'no member UPDATE reached the note - the value is untouched');
select is((select notional_amount::int from public.structured_note_allocations
            where id = 'bbbb0003-0000-0000-0000-000000000003'), 1000,
  'no member UPDATE reached the sociedad allocation');
select is((select count(*)::int from public.structured_notes), 1,
  'no member DELETE reached the notes book');
select is((select count(*)::int from public.structured_note_allocations), 1,
  'no member DELETE reached the allocations');


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · UNAPPROVED ACCOUNT — approval is the outer gate
-- ═══════════════════════════════════════════════════════════════════════════
-- Holds an explicit structured_notes grant and still gets nothing.

select pg_temp.as_user('b4444444-4444-4444-4444-444444444444');

select is((select count(*)::int from public.structured_notes), 0,
  'an UNAPPROVED account sees nothing despite holding the grant');
select throws_ok($$ insert into public.structured_notes (user_id, product_name, structure_type)
                    values ('b1111111-1111-1111-1111-111111111111', 'x', 'autocall') $$,
  '42501', null, 'an UNAPPROVED account cannot insert despite holding the grant');


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · ADMINISTRATOR — full read/write must still work
-- ═══════════════════════════════════════════════════════════════════════════
-- The regression half. Hardening that breaks the administrator is not a fix.

select pg_temp.as_service();
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');

select is((select count(*)::int from public.structured_notes), 1,
  'an administrator reads the notes book without holding any grant row');

select lives_ok($$ insert into public.structured_notes (id, user_id, product_name, structure_type)
                   values ('bbbb0005-0000-0000-0000-000000000005',
                           'b1111111-1111-1111-1111-111111111111', 'Admin Note', 'autocall') $$,
  'an administrator CAN insert a structured note');
select lives_ok($$ insert into public.structured_note_allocations (note_id, entity_name, notional_amount)
                   values ('bbbb0001-0000-0000-0000-000000000001', 'Admin Entity', 5) $$,
  'an administrator CAN add a sociedad allocation');
select lives_ok($$ update public.structured_notes set product_name = 'Admin Renamed'
                   where id = 'bbbb0005-0000-0000-0000-000000000005' $$,
  'an administrator CAN update a structured note');

select is((select product_name from public.structured_notes
            where id = 'bbbb0005-0000-0000-0000-000000000005'), 'Admin Renamed',
  'the administrator UPDATE actually took effect');

select lives_ok($$ delete from public.structured_notes
                   where id = 'bbbb0005-0000-0000-0000-000000000005' $$,
  'an administrator CAN delete a structured note');
select is((select count(*)::int from public.structured_notes
            where id = 'bbbb0005-0000-0000-0000-000000000005'), 0,
  'the administrator DELETE actually took effect');


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · NOTIFICATION RECIPIENTS — administrator only, never a module
-- ═══════════════════════════════════════════════════════════════════════════

-- 6a · Even a member holding EVERY module reaches nothing. This is what makes
--      "not a module" an executable statement rather than a design note.
select pg_temp.as_service();
insert into public.user_module_grants (user_id, module_key)
select 'b2222222-2222-2222-2222-222222222222', m.module_key
from public.app_modules m
on conflict do nothing;

select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.notification_recipients), 0,
  'a member holding EVERY module still cannot read recipient addresses');
select throws_ok($$ insert into public.notification_recipients (email) values ('member@test.invalid') $$,
  '42501', null, 'a member holding every module cannot add a recipient');

update public.notification_recipients set email = 'hijacked@test.invalid';
delete from public.notification_recipients;

select pg_temp.as_service();
select is((select email::text from public.notification_recipients
            where id = 'bbbb0004-0000-0000-0000-000000000004'), 'fixture-recipient@test.invalid',
  'no member UPDATE reached the recipient address');
select is((select count(*)::int from public.notification_recipients), 1,
  'no member DELETE reached the recipient list');

-- 6b · The structured_notes grant specifically confers nothing here.
select is(
  (select count(*)::int from public.app_modules where module_key = 'notification_recipients'),
  0, 'notification_recipients is not a grantable module');

-- 6c · Administrator retains the whole management flow.
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.notification_recipients), 1,
  'an administrator CAN read the recipient list');
select lives_ok($$ insert into public.notification_recipients (id, email, label)
                   values ('bbbb0006-0000-0000-0000-000000000006', 'admin-added@test.invalid', 'Added') $$,
  'an administrator CAN add a recipient');
select lives_ok($$ update public.notification_recipients set active = false
                   where id = 'bbbb0006-0000-0000-0000-000000000006' $$,
  'an administrator CAN deactivate a recipient');
select is((select active from public.notification_recipients
            where id = 'bbbb0006-0000-0000-0000-000000000006'), false,
  'the administrator UPDATE actually took effect');
select lives_ok($$ delete from public.notification_recipients
                   where id = 'bbbb0006-0000-0000-0000-000000000006' $$,
  'an administrator CAN remove a recipient');


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · SERVICE ROLE — scheduled delivery must keep working
-- ═══════════════════════════════════════════════════════════════════════════
-- The monitoring cron reads the active recipient list and writes snapshots,
-- observations and run rows through the admin client. It bypasses RLS, but it
-- still needs the table privileges this migration re-granted.

select pg_temp.as_service();

select ok(has_table_privilege('service_role', 'public.notification_recipients', 'SELECT'),
  'service_role can still read recipients for delivery');
select ok(has_table_privilege('service_role', 'public.structured_note_price_snapshots', 'INSERT'),
  'service_role can still write price snapshots');
select ok(has_table_privilege('service_role', 'public.structured_note_monitoring_runs', 'INSERT'),
  'service_role can still open a monitoring run');
select ok(has_table_privilege('service_role', 'public.structured_note_observations', 'UPDATE'),
  'service_role can still record an observation result');
select ok(has_table_privilege('service_role', 'public.notifications', 'INSERT'),
  'service_role can still create a notification');


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · PERSONAL NOTIFICATION STATE IS UNTOUCHED
-- ═══════════════════════════════════════════════════════════════════════════
-- Hardening the SHARED address book must not take away a member's OWN read
-- markers. This is the "do not break category A while fixing category B" proof.

-- These are PARITY assertions rather than member-role reads, deliberately.
-- `notifications` and `notification_reads` carry NO explicit grant in any
-- migration: exactly like `watchlists`, they rely entirely on whatever
-- Supabase's default privileges give `authenticated`, and that default is not
-- identical between this isolated CLI stack and a hosted project. Asserting
-- "a member can read the feed" would therefore test the ENVIRONMENT, not this
-- migration -- and it fails in this stack for a reason that predates this
-- stage entirely (20260815000000 contains no DDL of any kind for either
-- table).
--
-- What actually must be proven is that this migration did not sweep the
-- personal tables into the hardening. Comparing them against the untouched
-- control `watchlists` -- same class, same reliance on defaults -- proves that
-- in EITHER environment: had 20260815000000 revoked from them, they would no
-- longer match the control.

select pg_temp.as_service();
insert into public.notifications (id, notification_type, title, body)
values ('bbbb0007-0000-0000-0000-000000000007', 'system', 'Fixture', 'Fixture body');
insert into public.notification_reads (notification_id, user_id)
values ('bbbb0007-0000-0000-0000-000000000007', 'b3333333-3333-3333-3333-333333333333');

select is(
  has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  has_table_privilege('authenticated', 'public.watchlists', 'SELECT'),
  'notifications keeps the same authenticated SELECT posture as an untouched control table');
select is(
  has_table_privilege('authenticated', 'public.notification_reads', 'INSERT'),
  has_table_privilege('authenticated', 'public.watchlists', 'INSERT'),
  'notification_reads keeps the same authenticated INSERT posture as an untouched control');

select ok(exists(
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and cmd = 'SELECT' and qual like '%uid()%'
      and coalesce(qual, '') not like '%nmi_can_access_module%'),
  'the personal feed is NOT re-gated behind a module grant');

select is((select count(*)::int from pg_catalog.pg_policies
            where schemaname = 'public' and tablename = 'notification_reads'), 3,
  'notification_reads keeps all three of its per-user policies');

select is((select count(*)::int from public.notification_reads
            where user_id = 'b3333333-3333-3333-3333-333333333333'), 1,
  'the member OWN read marker survives the hardening');


-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · THE PORTFOLIO CEILING IS UNTOUCHED BY THIS STAGE
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();
select is(public.nmi_portfolio_scopes(true, false, 'jaime'),
  array['main','jaime','alternatives'], 'the jaime ceiling is unchanged');
select is((select count(*)::int from public.app_modules), 7,
  'the module registry still holds exactly seven modules');

select * from finish();
rollback;
