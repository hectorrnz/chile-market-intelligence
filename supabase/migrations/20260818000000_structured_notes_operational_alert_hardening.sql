-- R13.7B2.1 — Structured Notes operational-alert hardening.
--
-- Closes two read exposures on OPERATIONAL surfaces. Neither is a Structured
-- Notes *product* surface: this migration does not touch a single note,
-- underlying, observation or allocation, and the module gate that
-- 20260815000000 put on those tables is asserted intact at the bottom.
--
--
-- 1 · `notifications` — authenticated-wide, and it should never have been.
--
-- 20260713000000 created the feed with
--     for select using (auth.uid() is not null)
-- and the header comment "Any authenticated user can read the whole feed."
-- 20260815000000 then hardened `notification_recipients` (the addresses) but
-- deliberately left `notifications` alone, reasoning that it was a personal
-- feed of the same class as `watchlists`.
--
-- That reasoning does not survive contact with the content. The feed is
-- SHARED, not personal — 20260713000000 says so in its own first paragraph —
-- and every notification this application has ever produced is a Structured
-- Notes operational alert:
--     structured_note_called                     (T0 confirmed autocall)
--     structured_note_potential_autocall         (T-1 warning)
-- to which R13.7 adds
--     structured_note_historical_correction      (reconciliation)
-- Their titles and bodies carry the ISIN, the contractual valuation date, each
-- underlying's official close against its own call threshold, and the binding
-- leg. A member holding no module grant at all could read every one of them.
--
-- Today that exposure is latent: production has one administrator and zero
-- members. R13.6F made provisioning a member routine, so it would not stay
-- latent. Fixed here rather than left for the release that first creates one.
--
-- ADMINISTRATOR-ONLY, with no audience column. A column would be the right
-- shape for a feed that mixed member-visible and operator-only events; this
-- one does not mix. Every row is an operator alert, so the predicate is the
-- role, and a future member-visible notification class is a deliberate
-- redesign that introduces its own audience mechanism at that time.
--
-- The privilege is deliberately KEPT while the policy denies. Revoking SELECT
-- outright would turn the bell's count query into a 42501 the UI would surface
-- as an error; leaving the privilege and denying by RLS returns zero rows, and
-- NotificationBell already renders that as a clean empty state. Same shape as
-- the Structured Notes group-B tables in 20260815000000.
--
-- The grant is also made EXPLICIT. `notifications` never carried one, relying
-- on Supabase's default privileges, which differ between a hosted project and
-- an isolated CLI stack — which is why the existing pgTAP file could only
-- compare it against a control table instead of reading it as a member. After
-- this migration the posture is stated, so it can be asserted directly.
--
--
-- 2 · `structured_note_monitoring_runs` — module-gated, needs to be narrower.
--
-- 20260709000000 created it authenticated-wide; 20260815000000 already
-- replaced that with the `structured_notes` module gate, so an ungranted
-- member is ALREADY denied. The remaining question is the granted member.
--
-- The table is a cron run log — prices_requested/succeeded/failed, errors[],
-- warnings[], provider diagnostics — operator telemetry rather than note
-- content. R13.7 additionally makes it the durable sink for reconciliation
-- audit records (run_type = 'backfill'), whose metadata carries previous and
-- corrected note state, the original contractual event date, per-leg
-- historical evidence with its source tier, and the acting administrator.
-- That is audit evidence about an operator action, and it raises the whole
-- table's sensitivity ceiling above ordinary product data.
--
-- So: administrator-only SELECT. Discriminating by run_type inside the policy
-- was considered and rejected — it would keep one dashboard line working for a
-- member at the cost of a predicate that silently starts leaking the moment a
-- future run_type carries sensitive metadata.
--
-- WHAT A GRANTED MEMBER LOSES: the "last monitoring run" line, and the two
-- provider-quality flags derived from that run's metadata. What they KEEP:
-- every freshness signal that matters — stale, due-soon and review-required
-- counts are computed from `structured_notes` and
-- `structured_note_price_snapshots`, both still module-gated and readable, and
-- the monitoring banner is already conditional, so it simply renders less.
--
-- Idempotent. Apply via Supabase Dashboard → SQL Editor.

-- =============================================================================
-- 1 · NOTIFICATIONS — administrator-only read
-- =============================================================================

do $$
declare
  pol record;
  col record;
begin
  if to_regclass('public.notifications') is null then
    raise exception 'expected table public.notifications is missing';
  end if;

  alter table public.notifications enable row level security;

  -- Enumerated reset rather than a known-name drop: a policy left behind from
  -- an earlier phase would keep granting exactly what it always granted, and
  -- `notifications_select` is precisely such a policy.
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'notifications'
  loop
    execute format('drop policy %I on public.notifications', pol.policyname);
  end loop;

  create policy "notifications_admin_select" on public.notifications
    for select to authenticated
    using ((select public.nmi_is_administrator()));

  -- No insert/update/delete policy at all: the feed is written only by the
  -- scheduled crons through the service role, which bypasses RLS.

  revoke all privileges on table public.notifications from public, anon, authenticated;
  grant select on table public.notifications to authenticated;
  grant all privileges on table public.notifications to service_role;

  -- Column ACLs live in pg_attribute.attacl and survive a table-level REVOKE.
  for col in
    select att.attname
    from pg_catalog.pg_attribute att
    join pg_catalog.pg_class c on c.oid = att.attrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'notifications'
      and att.attnum > 0 and not att.attisdropped and att.attacl is not null
  loop
    execute format('revoke all (%I) on table public.notifications from public, anon, authenticated',
                   col.attname);
  end loop;
end $$;


-- =============================================================================
-- 2 · STRUCTURED NOTE MONITORING RUNS — administrator-only read
-- =============================================================================
-- Only this ONE table moves from the module gate to the administrator gate.
-- The other seven Structured Notes tables keep `sn_module_select` exactly as
-- 20260815000000 left it, and section 3 asserts that.

do $$
declare
  pol record;
begin
  if to_regclass('public.structured_note_monitoring_runs') is null then
    raise exception 'expected table public.structured_note_monitoring_runs is missing';
  end if;

  alter table public.structured_note_monitoring_runs enable row level security;

  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'structured_note_monitoring_runs'
  loop
    execute format('drop policy %I on public.structured_note_monitoring_runs', pol.policyname);
  end loop;

  create policy "sn_monitoring_runs_admin_select" on public.structured_note_monitoring_runs
    for select to authenticated
    using ((select public.nmi_is_administrator()));

  -- Writes stay service-role-only: no mutation policy is created, exactly as
  -- 20260709000000 and 20260815000000 both intended.

  revoke all privileges on table public.structured_note_monitoring_runs from public, anon, authenticated;
  grant select on table public.structured_note_monitoring_runs to authenticated;
  grant all privileges on table public.structured_note_monitoring_runs to service_role;
end $$;


-- =============================================================================
-- 3 · POSTCONDITIONS, executed in-database at apply time
-- =============================================================================
-- These assert the policy expressions actually stored and the EFFECTIVE
-- privileges (has_table_privilege resolves role inheritance), not merely that
-- a policy exists under an expected name. Role-session behaviour — what a real
-- member, administrator and anonymous caller can actually read — is proven
-- separately in supabase/tests/database/sensitive_surface_hardening_test.sql,
-- which can switch roles as this context cannot.

do $$
declare
  n   int;
  bad text;
begin
  -- 1 · Both hardened tables have RLS on, exactly one policy, and it is an
  --     administrator-gated SELECT.
  foreach bad in array array['notifications', 'structured_note_monitoring_runs'] loop
    if not exists (select 1 from pg_catalog.pg_class c
                   join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
                   where ns.nspname = 'public' and c.relname = bad and c.relrowsecurity) then
      raise exception 'RLS is not enabled on public.%', bad;
    end if;

    select count(*) into n from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = bad;
    if n <> 1 then
      raise exception 'public.% must carry exactly one policy, found %', bad, n;
    end if;

    select count(*) into n from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = bad
       and cmd = 'SELECT' and qual like '%nmi_is_administrator%';
    if n <> 1 then
      raise exception 'public.% lacks an administrator-gated SELECT policy', bad;
    end if;

    -- The module gate must be GONE from these two: a leftover OR-branch would
    -- keep a granted member reading them.
    if exists (select 1 from pg_catalog.pg_policies
               where schemaname = 'public' and tablename = bad
                 and coalesce(qual, '') like '%nmi_can_access_module%') then
      raise exception 'public.% still references the module gate', bad;
    end if;

    -- 2 · anon holds nothing; authenticated may read and only read.
    if has_table_privilege('anon', 'public.' || bad, 'SELECT') then
      raise exception 'anon can still SELECT public.%', bad;
    end if;
    if not has_table_privilege('authenticated', 'public.' || bad, 'SELECT') then
      raise exception 'authenticated lost SELECT on public.% (the bell/monitoring read would 42501)', bad;
    end if;
    if has_table_privilege('authenticated', 'public.' || bad, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || bad, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || bad, 'DELETE') then
      raise exception 'authenticated holds a write privilege on public.%', bad;
    end if;
    if not has_table_privilege('service_role', 'public.' || bad, 'INSERT') then
      raise exception 'service_role cannot write public.% — the cron would fail', bad;
    end if;
  end loop;

  -- 3 · REGRESSION: the seven other Structured Notes tables keep the module
  --     gate. This migration narrowed one table, not the module.
  for bad in
    select unnest(array[
      'structured_notes', 'structured_note_underlyings', 'structured_note_observations',
      'structured_note_allocations', 'structured_note_extraction_runs',
      'structured_note_price_snapshots', 'structured_note_extracted_fields'])
  loop
    if not exists (select 1 from pg_catalog.pg_policies
                   where schemaname = 'public' and tablename = bad
                     and cmd = 'SELECT' and qual like '%nmi_can_access_module%') then
      raise exception 'public.% lost its module-gated SELECT policy', bad;
    end if;
  end loop;

  -- 4 · REGRESSION: the personal read-state table is untouched — a member must
  --     still be able to mark their own notifications read.
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'notification_reads';
  if n <> 3 then
    raise exception 'notification_reads must keep its three per-user policies, found %', n;
  end if;

  -- 5 · REGRESSION: recipients stay administrator-only for every verb.
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'notification_recipients'
     and (coalesce(qual, '') like '%nmi_is_administrator%'
          or coalesce(with_check, '') like '%nmi_is_administrator%');
  if n < 4 then
    raise exception 'notification_recipients lost administrator-only coverage (% policies)', n;
  end if;
end $$;
