-- POST-R13.6CDE — record module-grant changes in the EXISTING access audit.
--
-- WHAT THIS DOES
-- ──────────────
-- `family_portfolio_access_audit` already records who changed whose `role` and
-- `portfolio_principal`, with actor, timestamp, previous and new value. The
-- Users & Access console adds a third kind of authorization change — granting
-- and revoking application modules — and it belongs in the same trail.
--
-- Two changes, both additive:
--   1. `field_changed` accepts 'module_grant' alongside the existing two.
--   2. A nullable `module_key` column names WHICH module, as a foreign key into
--      `app_modules` so the trail cannot name a module that does not exist.
--
-- WHY NOT A SECOND TABLE
-- ──────────────────────
-- A parallel `module_grant_audit` would split "who changed this account's
-- authorization" across two places, so answering that question would mean
-- remembering to read both. Every column this needs already exists here, the
-- actor semantics are identical, and the admin-only read policy is the one that
-- should govern it. Extending is strictly better than duplicating.
--
-- WHY `module_key` IS NULLABLE
-- ────────────────────────────
-- Because it is meaningless for the two existing kinds — a role change is not
-- about a module. The paired CHECK makes the nullability exact rather than
-- loose: 'module_grant' rows MUST name a module, and the other kinds must NOT.
-- A row that cannot say which module it changed would be an unusable record.
--
-- ON DELETE RESTRICT matches `user_module_grants.module_key`: retiring a module
-- from the registry must not silently rewrite history that mentions it.
--
-- Idempotent, and safe to re-run.

-- ── 1 · The module column ────────────────────────────────────────────────────
alter table public.family_portfolio_access_audit
  add column if not exists module_key text references public.app_modules(module_key) on delete restrict;

-- ── 2 · Widen field_changed, and bind module_key to it ───────────────────────
do $$
begin
  -- Recreate rather than ALTER: PostgreSQL has no "widen a CHECK" operation, and
  -- dropping by the exact system-generated name is what makes this repeatable.
  alter table public.family_portfolio_access_audit
    drop constraint if exists family_portfolio_access_audit_field_changed_check;

  alter table public.family_portfolio_access_audit
    add constraint family_portfolio_access_audit_field_changed_check
    check (field_changed in ('portfolio_principal', 'role', 'module_grant'));

  alter table public.family_portfolio_access_audit
    drop constraint if exists family_portfolio_access_audit_module_key_check;

  alter table public.family_portfolio_access_audit
    add constraint family_portfolio_access_audit_module_key_check
    check (
      (field_changed = 'module_grant' and module_key is not null) or
      (field_changed <> 'module_grant' and module_key is null)
    );
end $$;

-- ── 3 · Postconditions ───────────────────────────────────────────────────────
-- Asserted against the CATALOG, not against the text above, so a partially
-- applied migration cannot report success.
do $$
declare
  def text;
begin
  -- 3a · The column exists, and is a real foreign key into the registry.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'family_portfolio_access_audit'
      and column_name = 'module_key'
  ) then
    raise exception 'family_portfolio_access_audit.module_key was not added';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_class r on r.oid = c.confrelid
    where t.relname = 'family_portfolio_access_audit'
      and c.contype = 'f'
      and r.relname = 'app_modules'
  ) then
    raise exception 'module_key must reference app_modules - the trail must not name an unknown module';
  end if;

  -- 3b · All three kinds are accepted, and nothing else is.
  select pg_get_constraintdef(c.oid) into def
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t on t.oid = c.conrelid
  where t.relname = 'family_portfolio_access_audit'
    and c.conname = 'family_portfolio_access_audit_field_changed_check';
  if def is null then
    raise exception 'the field_changed CHECK is missing';
  end if;
  if def not like '%module_grant%' or def not like '%portfolio_principal%' or def not like '%role%' then
    raise exception 'the field_changed CHECK does not cover all three kinds: %', def;
  end if;

  -- 3c · module_key is bound to the kind, in BOTH directions.
  select pg_get_constraintdef(c.oid) into def
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class t on t.oid = c.conrelid
  where t.relname = 'family_portfolio_access_audit'
    and c.conname = 'family_portfolio_access_audit_module_key_check';
  if def is null then
    raise exception 'the module_key/field_changed pairing CHECK is missing';
  end if;

  -- 3d · REGRESSION: the actor pairing established in 20260806000000 is intact.
  --      A module-grant row is always administrator-authored, so it must still
  --      be impossible to record one with no actor.
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    where t.relname = 'family_portfolio_access_audit'
      and c.conname = 'family_portfolio_access_audit_actor_check'
  ) then
    raise exception 'the actor_kind/actor_user_id pairing CHECK was lost';
  end if;

  -- 3e · REGRESSION: still administrator-read-only, still no writer for the
  --      anon-key client. Audit rows are written by the service role alone.
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_access_audit' and cmd = 'SELECT'
  ) then
    raise exception 'the administrator SELECT policy on the audit table was lost';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_access_audit'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'the audit table must have NO mutation policy - it is service-role only';
  end if;
  if has_table_privilege('authenticated', 'public.family_portfolio_access_audit', 'INSERT') then
    raise exception 'authenticated must not be able to write the audit trail';
  end if;

  -- 3f · REGRESSION: this migration touches the audit table only.
  if (select count(*) from public.app_modules) <> 7 then
    raise exception 'the module registry changed - this migration must not alter it';
  end if;
  if not exists (
    select 1 where public.nmi_portfolio_scopes(true, false, 'jaime')
                   = array['main','jaime','alternatives']
  ) then
    raise exception 'the Family Portfolio ceiling changed - this migration must not alter it';
  end if;
end $$;
