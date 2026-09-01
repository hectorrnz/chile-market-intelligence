-- R13.R2 §§ 14-15 — EXECUTABLE PostgreSQL validation of the global Family
-- Portfolio presentation-settings table.
--
-- Run by `supabase test db` against an isolated, disposable local stack that has
-- had the FULL migration chain applied from a clean database — so this exercises
-- the real CHECK constraints, the real GRANTs and the real RLS predicates, not a
-- static reading of the migration text.
--
-- THE PROPERTY UNDER TEST is the § 15 authority split: an administrator's choice
-- is what every authorized member SEES, and a member can change nothing. Both
-- halves are asserted against the database itself, because the API route's own
-- `canAdminister` check is presentation-side by comparison — if RLS were wrong,
-- a crafted request could still write.
--
-- Every identity below is a throwaway row created inside this transaction and
-- rolled back at the end. This table holds no financial data, so no portfolio
-- figure appears here at all.

begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — an administrator, a member, a scopeless account, an unapproved
-- ═══════════════════════════════════════════════════════════════════════════

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('b1111111-1111-1111-1111-111111111111'::uuid, 'set_admin@test.invalid'),
  ('b3333333-3333-3333-3333-333333333333'::uuid, 'set_jaime@test.invalid'),
  ('b6666666-6666-6666-6666-666666666666'::uuid, 'set_plain@test.invalid'),
  ('b7777777-7777-7777-7777-777777777777'::uuid, 'set_unapp@test.invalid')
) as u(id, email);

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('b1111111-1111-1111-1111-111111111111', 'set_admin', 'set_admin@test.invalid', 'Set Admin', 'administrator', null),
  ('b3333333-3333-3333-3333-333333333333', 'set_jaime', 'set_jaime@test.invalid', 'Set Jaime', 'user',          'jaime'),
  -- Approved but principal-less: holds NO portfolio scope, so it reads nothing.
  ('b6666666-6666-6666-6666-666666666666', 'set_plain', 'set_plain@test.invalid', 'Set Plain', 'user',          null),
  -- Approval is a NON-EMPTY username; this row has none and is denied despite a
  -- valid principal.
  ('b7777777-7777-7777-7777-777777777777', null,        'set_unapp@test.invalid', 'Set Unapp', 'user',          'jaime');

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · Shape — a singleton of closed enums, carrying no style payload
-- ═══════════════════════════════════════════════════════════════════════════

select has_table('public', 'family_portfolio_presentation_settings',
  'the presentation-settings table exists');

select is(
  (select count(*)::int from public.family_portfolio_presentation_settings),
  1, 'the migration seeded exactly one settings row');

-- The seeded defaults reproduce the pre-R13.R2 presentation, so adopting the
-- feature changes nothing on screen until an administrator chooses.
select is(
  (select label_position || '|' || label_content || '|' || legend_visible::text
       || '|' || palette || '|' || donut_thickness
     from public.family_portfolio_presentation_settings),
  'legend_only|percentage|true|institutional|medium',
  'the seeded defaults are the documented R13.7-equivalent presentation');

-- A second settings row is impossible: the CHECK admits one key and the key is
-- the primary key.
select throws_ok(
  $$insert into public.family_portfolio_presentation_settings (settings_key)
    values ('something_else')$$,
  null,
  'a settings row under any other key is rejected');

-- No free-form style payload anywhere (§ 15).
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name = 'family_portfolio_presentation_settings'
      and (data_type in ('json','jsonb')
           or column_name ~ '(hex|rgb|css|style|color|colour)')),
  0, 'no json/jsonb or colour-ish free-form column exists');

-- Every enum column rejects a value outside its approved set.
select throws_ok(
  $$update public.family_portfolio_presentation_settings
       set label_position = 'floating' where settings_key = 'allocation'$$,
  null, 'an unapproved label_position is rejected by CHECK');
select throws_ok(
  $$update public.family_portfolio_presentation_settings
       set label_content = 'currency' where settings_key = 'allocation'$$,
  null, 'an unapproved label_content is rejected by CHECK');
select throws_ok(
  $$update public.family_portfolio_presentation_settings
       set palette = '#FF00FF' where settings_key = 'allocation'$$,
  null, 'a raw hex palette value is rejected by CHECK');
select throws_ok(
  $$update public.family_portfolio_presentation_settings
       set donut_thickness = '42px' where settings_key = 'allocation'$$,
  null, 'an unapproved donut_thickness is rejected by CHECK');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The administrator writes; the write is audited
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$update public.family_portfolio_presentation_settings
       set palette = 'spectrum', label_position = 'outside',
           label_content = 'percentage_value', legend_visible = false,
           donut_thickness = 'thick',
           updated_by = 'b1111111-1111-1111-1111-111111111111'
     where settings_key = 'allocation'$$,
  'an administrator may update the global settings');

select is(
  (select palette from public.family_portfolio_presentation_settings),
  'spectrum', 'the administrator''s palette choice persisted');

select is(
  (select updated_by from public.family_portfolio_presentation_settings),
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'the acting administrator is recorded as audit metadata');

select ok(
  (select updated_at from public.family_portfolio_presentation_settings) is not null,
  'updated_at is stamped by the trigger');

-- The owner-required High Water Market default (§ 18) is the SEEDED value, not
-- merely what the client happens to send.
select is(
  (select reference_line from public.family_portfolio_presentation_settings),
  'auto', 'the High Water Market reference defaults to auto');

-- The withdrawn palette is unstorable, not merely absent from the dialog: a
-- preset a reader cannot distinguish must be impossible to set at all.
select throws_ok(
  $$update public.family_portfolio_presentation_settings
       set palette = 'oceanic' where settings_key = 'allocation'$$,
  null, 'the withdrawn oceanic palette is rejected by the CHECK constraint');

-- And there is no third reference-line mode that could contradict § 18.
select throws_ok(
  $$update public.family_portfolio_presentation_settings
       set reference_line = 'always' where settings_key = 'allocation'$$,
  null, 'reference_line admits no ''always'' mode');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · § 15 — a MEMBER SEES the administrator's choice and CANNOT change it
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');

-- THE decisive read: this is what makes the setting global rather than one
-- administrator's private preference.
select is(
  (select palette from public.family_portfolio_presentation_settings),
  'spectrum', 'a member reads the administrator''s approved palette');

select is(
  (select count(*)::int from public.family_portfolio_presentation_settings),
  1, 'a member reads the singleton row');

-- THE decisive write refusal. RLS makes the UPDATE affect zero rows rather than
-- raise, so the assertion is on the row's value being UNCHANGED — a test that
-- merely expected an error would pass even if the write had silently landed.
-- The member attempts a DIFFERENT value from the one the administrator set —
-- otherwise "unchanged" would hold even if the write had landed.
update public.family_portfolio_presentation_settings
   set palette = 'institutional' where settings_key = 'allocation';

select is(
  (select palette from public.family_portfolio_presentation_settings),
  'spectrum', 'a member''s update changed nothing — the administrator''s value stands');

select throws_ok(
  $$insert into public.family_portfolio_presentation_settings (settings_key, palette)
    values ('allocation', 'spectrum')$$,
  null, 'a member cannot insert a settings row');

select ok(
  not has_table_privilege('authenticated', 'public.family_portfolio_presentation_settings', 'DELETE'),
  'no authenticated caller holds DELETE — the singleton is never removed');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · Callers with no Family Portfolio scope read nothing
-- ═══════════════════════════════════════════════════════════════════════════

-- Approved, but principal-less and not an administrator: holds no scope, so it
-- sees no allocation chart and correctly reads no settings for one.
select pg_temp.as_user('b6666666-6666-6666-6666-666666666666');
select is(
  (select count(*)::int from public.family_portfolio_presentation_settings),
  0, 'a scopeless approved account reads no settings row');

-- Unapproved, despite carrying a valid principal.
select pg_temp.as_user('b7777777-7777-7777-7777-777777777777');
select is(
  (select count(*)::int from public.family_portfolio_presentation_settings),
  0, 'an unapproved account reads no settings row');

-- Anonymous is REFUSED OUTRIGHT — a stronger guarantee than "RLS returns zero
-- rows", and it has to be asserted as a refusal rather than as a count. The
-- migration revokes every privilege on this table from `anon`, so counting rows
-- as anon does not return 0: it raises '42501' and aborts the whole script
-- before finish() emits a plan ("Non-zero exit status: 3 / Parse errors: No plan
-- found in TAP output"). That is the same trap the R13.R1 evolution-history
-- suite hit and fixed in a1c673a, and the weekly-notes suite already avoids;
-- denial is proved here the same way, without requiring anon to be able to run
-- the query at all.
select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.family_portfolio_presentation_settings $$,
  '42501', null, 'anon is REFUSED outright — it holds no SELECT privilege');
select ok(
  not has_table_privilege('anon', 'public.family_portfolio_presentation_settings', 'SELECT'),
  'anon holds no SELECT privilege at all');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · The settings table is not a side channel into portfolio data
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_service();

select is(
  (select count(*)::int from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'family_portfolio_presentation_settings'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,''))
          ~ '(portfolio_snapshot_rows|portfolio_performance_rows|portfolio_publications|portfolio_evolution_observations)'),
  0, 'no settings policy references a financial table');

-- Read is scope-gated; write is administrator-gated. Asserted on the policy
-- definitions so a future edit that swapped them fails here.
select ok(
  (select qual from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_presentation_settings'
      and policyname = 'family_portfolio_presentation_settings_member_select')
    like '%nmi_current_portfolio_scopes%',
  'the read policy resolves through nmi_current_portfolio_scopes');

select ok(
  (select with_check from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_presentation_settings'
      and policyname = 'family_portfolio_presentation_settings_admin_update')
    like '%nmi_is_administrator%',
  'the update policy''s WITH CHECK resolves through nmi_is_administrator');

select * from finish();
rollback;
