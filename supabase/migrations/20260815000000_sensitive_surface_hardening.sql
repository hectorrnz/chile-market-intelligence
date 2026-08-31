-- POST-R13.6B.1 — Structured Notes + notification recipient database hardening.
--
-- WHAT THIS CLOSES
-- ────────────────
-- Two PRE-EXISTING exposures, both discovered by POST-R13.6A and both dating
-- from before any module concept existed:
--
--   1. Structured Notes. Phase 9B (20260706120000) replaced the per-user RLS of
--      Phase 9A with a "shared book" model: `using (auth.uid() is not null)` for
--      SELECT, INSERT, UPDATE **and** DELETE on all seven tables. Combined with
--      Supabase's default table grants — which no migration in this repository
--      ever revoked for these tables — that means ANY authenticated account can
--      read, rewrite or delete the entire notes book, internal sociedad
--      allocations included, straight through the public REST API with the anon
--      key. Route-level gating alone would be cosmetic against that path.
--
--   2. notification_recipients. Created by 20260713000000 with the same
--      `auth.uid() is not null` shape for all four verbs. It holds the external
--      email addresses family notifications are delivered to, so it is both a
--      privacy surface and an outbound-data surface: whoever controls it
--      controls where financial notifications are sent.
--
-- THE POLICY THIS ENCODES (owner-locked)
-- ──────────────────────────────────────
--   Structured Notes
--     administrator ................ SELECT + INSERT + UPDATE + DELETE
--     member WITH structured_notes . SELECT ONLY
--     member WITHOUT the grant ..... nothing
--     unapproved / anonymous ....... nothing
--
--   notification_recipients
--     administrator ................ SELECT + INSERT + UPDATE + DELETE
--     any member ................... nothing, whatever modules they hold
--     unapproved / anonymous ....... nothing
--     service_role ................. retained (delivery reads active emails)
--
-- A MODULE GRANT IS NOT A WRITE RIGHT. This is the load-bearing distinction and
-- it is deliberate: ordinary family members may be allowed to VIEW Structured
-- Notes, but a shared family financial record must not become editable merely
-- because the module is visible. `nmi_can_access_module('structured_notes')`
-- therefore governs SELECT only; every mutation is governed by
-- `nmi_is_administrator()`.
--
-- NOTIFICATION RECIPIENTS ARE NOT A MODULE. They are an administration
-- capability, like the publication console. There is deliberately no
-- `app_modules` row for them, so the capability is not expressible as a grant —
-- a postcondition below fails the migration if such a row ever appears. Using
-- `nmi_can_access_module` here would be a category error and is asserted against.
--
-- WHY `authenticated` KEEPS MUTATION PRIVILEGES ON SOME TABLES
-- ───────────────────────────────────────────────────────────
-- Every Structured Notes route, and every notification recipient route, performs
-- its writes through the caller's own session client (`getSupabaseUserClient`) —
-- verified route by route, not assumed. Administrator writes therefore arrive as
-- the `authenticated` role, so revoking INSERT/UPDATE/DELETE from that role would
-- break the administrator experience outright rather than secure it.
--
-- The SQL privilege is consequently not the boundary here; RLS is. A privilege
-- grants nothing on its own: with no policy permitting the verb, a member's write
-- is refused regardless. So the posture is: keep the privilege exactly where the
-- application genuinely writes through a user session, and let an administrator
-- policy decide who may use it.
--
-- Where the application performs NO user-session write at all — the three tables
-- the scheduled monitoring cron owns — the stricter posture is taken instead: no
-- privilege AND no policy, so those tables are writable only by the service role
-- that already bypasses RLS. Two independent barriers rather than one.
--
-- NOT TOUCHED, DELIBERATELY
-- ─────────────────────────
--   · `notification_reads` — genuinely PERSONAL notification state, already
--     correctly scoped `auth.uid() = user_id`. Hardening the shared address book
--     must not take away a member's own read-state. A regression postcondition
--     asserts its policies are unchanged.
--   · `notifications` — the in-app feed content, not a recipient address list.
--   · Every Family Portfolio entitlement function, policy and ceiling.
--   · Module grant semantics from 20260814000000.

-- =============================================================================
-- 0 - PRECONDITIONS
-- =============================================================================
do $$
begin
  if to_regprocedure('public.nmi_can_access_module(text)') is null then
    raise exception
      'public.nmi_can_access_module(text) is missing - apply 20260814000000_module_entitlements.sql first';
  end if;
  if to_regprocedure('public.nmi_is_administrator()') is null then
    raise exception
      'public.nmi_is_administrator() is missing - apply 20260806000000_family_portfolio_entitlements.sql first';
  end if;
  if to_regclass('public.structured_notes') is null then
    raise exception 'public.structured_notes is missing - apply the Structured Notes migrations first';
  end if;
  if to_regclass('public.notification_recipients') is null then
    raise exception 'public.notification_recipients is missing - apply 20260713000000 first';
  end if;
end $$;


-- =============================================================================
-- 1 - STRUCTURED NOTES
-- =============================================================================
--
-- GROUP A - the application writes these through the caller's session client, so
--           `authenticated` must retain the mutation privileges an administrator
--           flow uses, and an administrator policy decides who may use them:
--             structured_notes             INSERT / UPDATE / DELETE  (import, PATCH, DELETE)
--             structured_note_underlyings  INSERT                    (import)
--             structured_note_observations INSERT                    (import)
--             structured_note_allocations  UPSERT + DELETE           (allocation editor)
--             structured_note_extraction_runs INSERT                 (term-sheet extract)
--           The grant is uniform S/I/U/D across the group rather than pared to
--           the exact verb each table uses today. That is intentional: PostgREST
--           upserts already need INSERT+UPDATE together (the allocation editor
--           does exactly that), the delete of a note reaches its children by FK
--           cascade rather than by privilege, and a verb that no policy permits
--           is unusable to a member anyway. Pruning to today's exact verb list
--           would buy no security and would turn any future administrator flow
--           into a 42501 nobody could diagnose.
--
-- GROUP B - written ONLY by the scheduled monitoring cron through the service
--           role, which bypasses RLS. `authenticated` gets SELECT and nothing
--           else, and no mutation policy is created at all.
--             structured_note_price_snapshots   (cron snapshot writer)
--             structured_note_monitoring_runs    (cron run log)
--             structured_note_extracted_fields   (no writer in the application)

do $$
declare
  grp_a text[] := array[
    'structured_notes',
    'structured_note_underlyings',
    'structured_note_observations',
    'structured_note_allocations',
    'structured_note_extraction_runs'
  ];
  grp_b text[] := array[
    'structured_note_price_snapshots',
    'structured_note_monitoring_runs',
    'structured_note_extracted_fields'
  ];
  all_t  text[] := grp_a || grp_b;
  t      text;
  pol    record;
begin
  foreach t in array all_t loop
    if to_regclass('public.' || t) is null then
      raise exception 'expected Structured Notes table public.% is missing', t;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- Enumerated reset: drop EVERY policy currently on the table rather than the
    -- handful of names this repository happens to know about. A policy left
    -- behind from an older phase would silently keep granting what it always
    -- granted, and `sn_shared_select` is exactly such a policy.
    for pol in
      select policyname from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    -- READ: the module gate. Wrapped in a scalar sub-select so PostgreSQL
    -- evaluates it once per statement instead of once per row (the same shape
    -- `(select auth.uid())` is used for elsewhere in this schema).
    execute format(
      'create policy "sn_module_select" on public.%I for select to authenticated '
      || 'using ((select public.nmi_can_access_module(''structured_notes'')))', t);

    -- Supabase's default grants are wide; strip them, then hand back exactly
    -- what this table's group needs.
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all privileges on table public.%I to service_role', t);
  end loop;

  -- Group A only: administrator-gated mutation, and the privileges to use it.
  foreach t in array grp_a loop
    execute format(
      'create policy "sn_admin_insert" on public.%I for insert to authenticated '
      || 'with check ((select public.nmi_is_administrator()))', t);
    execute format(
      'create policy "sn_admin_update" on public.%I for update to authenticated '
      || 'using ((select public.nmi_is_administrator())) '
      || 'with check ((select public.nmi_is_administrator()))', t);
    execute format(
      'create policy "sn_admin_delete" on public.%I for delete to authenticated '
      || 'using ((select public.nmi_is_administrator()))', t);
    execute format('grant insert, update, delete on table public.%I to authenticated', t);
  end loop;

  -- Column-level ACLs live in pg_attribute.attacl and survive a table-level
  -- REVOKE. Clearing them is what makes the postconditions below meaningful.
  foreach t in array all_t loop
    declare
      col record;
    begin
      for col in
        select att.attname
        from pg_catalog.pg_attribute att
        join pg_catalog.pg_class c on c.oid = att.attrelid
        join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relname = t
          and att.attnum > 0 and not att.attisdropped and att.attacl is not null
      loop
        execute format('revoke all (%I) on table public.%I from public, anon, authenticated',
                       col.attname, t);
      end loop;
    end;
  end loop;
end $$;


-- =============================================================================
-- 2 - NOTIFICATION RECIPIENTS
-- =============================================================================
-- Administrator-only for every verb, including SELECT: the addresses themselves
-- are the sensitive content, so a member must not be able to enumerate who
-- receives family notifications.
--
-- service_role keeps full access because the scheduled monitoring cron reads the
-- active recipient list to deliver notifications, through the admin client.

do $$
declare
  pol record;
  col record;
begin
  alter table public.notification_recipients enable row level security;

  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'notification_recipients'
  loop
    execute format('drop policy %I on public.notification_recipients', pol.policyname);
  end loop;

  create policy "notification_recipients_admin_select" on public.notification_recipients
    for select to authenticated
    using ((select public.nmi_is_administrator()));

  create policy "notification_recipients_admin_insert" on public.notification_recipients
    for insert to authenticated
    with check ((select public.nmi_is_administrator()));

  create policy "notification_recipients_admin_update" on public.notification_recipients
    for update to authenticated
    using ((select public.nmi_is_administrator()))
    with check ((select public.nmi_is_administrator()));

  create policy "notification_recipients_admin_delete" on public.notification_recipients
    for delete to authenticated
    using ((select public.nmi_is_administrator()));

  revoke all privileges on table public.notification_recipients from public, anon, authenticated;
  -- Administrators manage the list through their own session client, so the
  -- `authenticated` role needs the verbs; the policies above decide who may use
  -- them. Same reasoning as Structured Notes group A.
  grant select, insert, update, delete on table public.notification_recipients to authenticated;
  grant all privileges on table public.notification_recipients to service_role;

  for col in
    select att.attname
    from pg_catalog.pg_attribute att
    join pg_catalog.pg_class c on c.oid = att.attrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'notification_recipients'
      and att.attnum > 0 and not att.attisdropped and att.attacl is not null
  loop
    execute format('revoke all (%I) on table public.notification_recipients from public, anon, authenticated',
                   col.attname);
  end loop;
end $$;


-- =============================================================================
-- 3 - POSTCONDITIONS, executed in-database at apply time
-- =============================================================================
-- These assert EFFECTIVE privileges (has_table_privilege resolves inheritance)
-- and the policy expressions actually stored, not merely that policies exist
-- under the expected names. Role-session behaviour — what a real member, a real
-- administrator and a real anonymous caller can actually do — is proven
-- separately in supabase/tests/database/sensitive_surface_hardening_test.sql,
-- which can switch roles as this context cannot.

do $$
declare
  grp_a text[] := array[
    'structured_notes','structured_note_underlyings','structured_note_observations',
    'structured_note_allocations','structured_note_extraction_runs'
  ];
  grp_b text[] := array[
    'structured_note_price_snapshots','structured_note_monitoring_runs',
    'structured_note_extracted_fields'
  ];
  all_t text[] := grp_a || grp_b;
  t     text;
  priv  text;
  n     int;
  bad   text;
begin
  -- 1 - RLS is on, everywhere this migration touched.
  foreach t in array all_t || array['notification_recipients'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'row level security is not enabled on public.%', t;
    end if;
  end loop;

  -- 2 - The permissive shared-book shape is gone from every Structured Notes
  --     table. This is the specific exposure being closed, so it is asserted
  --     directly rather than inferred from the new policies existing.
  select string_agg(format('%s.%s', tablename, policyname), ', ') into bad
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = any(all_t || array['notification_recipients'])
    and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%uid() IS NOT NULL%';
  if bad is not null then
    raise exception 'permissive auth.uid()-is-not-null policy still present: %', bad;
  end if;

  -- 3 - Exactly one SELECT policy per Structured Notes table, gated by the
  --     module predicate.
  foreach t in array all_t loop
    select count(*) into n from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t and cmd = 'SELECT';
    if n <> 1 then
      raise exception 'expected exactly 1 SELECT policy on public.%, found %', t, n;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
        and qual like '%nmi_can_access_module%'
    ) then
      raise exception 'the SELECT policy on public.% does not use the module predicate', t;
    end if;
  end loop;

  -- 4 - Group A carries administrator-gated INSERT/UPDATE/DELETE, and NOTHING
  --     in those policies consults a module grant: a grant must never confer a
  --     write right.
  foreach t in array grp_a loop
    foreach priv in array array['INSERT','UPDATE','DELETE'] loop
      if not exists (
        select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = t and cmd = priv
          and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%nmi_is_administrator%'
      ) then
        raise exception 'public.% has no administrator-gated % policy', t, priv;
      end if;
      if exists (
        select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = t and cmd = priv
          and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%nmi_can_access_module%'
      ) then
        raise exception
          'the % policy on public.% consults a module grant - a grant is not a write right', priv, t;
      end if;
    end loop;
  end loop;

  -- 5 - Group B has NO mutation policy at all: cron-owned tables are writable
  --     only by the service role, which bypasses RLS.
  foreach t in array grp_b loop
    select count(*) into n from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    if n <> 0 then
      raise exception 'public.% must have no mutation policy, found %', t, n;
    end if;
  end loop;

  -- 6 - anon has NO effective privilege anywhere this migration touched.
  foreach t in array all_t || array['notification_recipients'] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('anon', 'public.' || t, priv) then
        raise exception 'anon has EFFECTIVE % on public.%', priv, t;
      end if;
      if has_any_column_privilege('anon', 'public.' || t, priv) then
        raise exception 'anon has EFFECTIVE column-level % on public.%', priv, t;
      end if;
    end loop;
  end loop;

  -- 7 - `authenticated` keeps SELECT everywhere (RLS decides who actually sees
  --     rows) and the mutation verbs ONLY where the application genuinely writes
  --     through a user session.
  foreach t in array all_t loop
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'authenticated lost SELECT on public.% - the read path would break', t;
    end if;
  end loop;

  foreach t in array grp_b loop
    foreach priv in array array['INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('authenticated', 'public.' || t, priv)
         or has_any_column_privilege('authenticated', 'public.' || t, priv) then
        raise exception 'authenticated has % on cron-owned public.%', priv, t;
      end if;
    end loop;
  end loop;

  foreach t in array grp_a loop
    foreach priv in array array['INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('authenticated', 'public.' || t, priv) then
        raise exception
          'authenticated lost % on public.% - administrator writes go through the session client', priv, t;
      end if;
    end loop;
  end loop;

  -- 8 - The recipient list: authenticated keeps all four verbs (administrators
  --     manage it through their session client) and RLS restricts them.
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if not has_table_privilege('authenticated', 'public.notification_recipients', priv) then
      raise exception 'authenticated lost % on notification_recipients - admin management would break', priv;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'notification_recipients' and cmd = priv
        and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%nmi_is_administrator%'
    ) then
      raise exception 'notification_recipients has no administrator-gated % policy', priv;
    end if;
  end loop;

  select count(*) into n from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'notification_recipients';
  if n <> 4 then
    raise exception 'expected exactly 4 policies on notification_recipients, found %', n;
  end if;

  -- 9 - The recipient list is a CAPABILITY, never a module. No policy may
  --     consult a module grant, and no registry row may exist for it.
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'notification_recipients'
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%nmi_can_access_module%'
  ) then
    raise exception 'notification_recipients must not be governed by a module grant';
  end if;
  if exists (select 1 from public.app_modules where module_key = 'notification_recipients') then
    raise exception 'notification_recipients must never be a grantable module';
  end if;

  -- 10 - service_role keeps what the scheduled cron needs: full access to the
  --      Structured Notes tables it writes, and the recipient list it reads.
  foreach t in array all_t || array['notification_recipients'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT')
       or not has_table_privilege('service_role', 'public.' || t, 'INSERT')
       or not has_table_privilege('service_role', 'public.' || t, 'UPDATE') then
      raise exception 'service_role lost required access on public.% - notification delivery would break', t;
    end if;
  end loop;

  -- 11 - REGRESSION: personal notification state is untouched. Hardening the
  --      shared address book must not take away a member's own read markers.
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'notification_reads'
      and qual like '%uid()%' and qual like '%user_id%'
  ) then
    raise exception 'notification_reads lost its per-user policy - personal state must be preserved';
  end if;
  select count(*) into n from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'notification_reads';
  if n <> 3 then
    raise exception 'expected notification_reads to keep its 3 policies, found %', n;
  end if;

  -- 12 - REGRESSION: the Family Portfolio ceiling and the module foundation are
  --      untouched by this migration.
  if not exists (
    select 1 where public.nmi_portfolio_scopes(true, false, 'jaime')
                   = array['main','jaime','alternatives']
  ) then
    raise exception 'the Family Portfolio ceiling changed - POST-R13.6B.1 must not alter it';
  end if;
  select count(*) into n from public.app_modules;
  if n <> 7 then
    raise exception 'the module registry changed - expected 7 modules, found %', n;
  end if;
end $$;
