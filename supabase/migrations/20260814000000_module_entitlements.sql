-- POST-R13.6B — MODULE ENTITLEMENT SUBSTRATE.
--
-- Forward-only. Re-runnable. Additive: no existing table, column, constraint,
-- function, policy or grant is altered, and no existing access is removed.
--
-- DEPLOYMENT: applied through the Supabase CLI migration workflow
-- (`supabase migration list` -> `supabase db push --dry-run` -> review ->
-- `supabase db push`), NOT by pasting SQL into the remote SQL Editor. As of this
-- migration nothing has been applied to any hosted database — POST-R13.6B is
-- implementation and isolated validation only.
--
-- WHY
-- ---
-- Today every APPROVED account reaches every module except Family Portfolio.
-- The owner requires per-user control over which parts of the application each
-- account can use, without that control ever being able to cross the Family
-- Portfolio principal ceiling.
--
-- WHAT THIS MIGRATION ESTABLISHES
-- ------------------------------
--   1. `public.app_modules`        — the registry of GRANTABLE module keys.
--   2. `public.user_module_grants` — explicit per-user grants. Row present =
--                                    allowed; row absent = denied.
--   3. Three functions mirroring `src/lib/auth/moduleAccess.ts`, including the
--      reusable RLS predicate `public.nmi_can_access_module(text)` that
--      POST-R13.6B.1 will attach to Structured Notes and notification
--      recipients.
--   4. A one-time compatibility backfill so no currently-approved member loses
--      anything they can reach today.
--
-- THE SECURITY PROPERTY THAT MATTERS MOST
-- ---------------------------------------
-- `main`, `jaime`, `andres` and `pablo` are Family Portfolio SCOPES. They are
-- NOT module keys and are deliberately absent from `app_modules`. Because
-- `user_module_grants.module_key` is a FOREIGN KEY into that registry, a grant
-- naming another family member's personal portfolio is not merely rejected at
-- runtime — it is UNREPRESENTABLE. There is no row to point at. Making the
-- dangerous state impossible to store is stronger than validating against it.
--
-- Inside the Portfolio module, WHOSE data a caller sees remains governed by the
-- frozen ceiling in `public.nmi_portfolio_scopes(...)`. This migration does not
-- redefine, replace, weaken or wrap it, and `nmi_can_access_scope` is untouched.
-- Composition happens in the application layer
-- (`src/lib/portfolioAccess/portfolioModuleComposition.ts`) as an INTERSECTION,
-- so a grant can only subtract within the ceiling and never add across it.
--
-- DEFAULTS ARE NOT AUTHORIZATION
-- ------------------------------
-- `app_modules.default_for_member` is PROVISIONING metadata: the checkbox state
-- a NEW member's invitation starts from (POST-R13.6C). It is deliberately
-- absent from every authorization function below. At runtime a member is
-- allowed a module if and only if an explicit `user_module_grants` row exists.
-- `tests/moduleEntitlements.test.ts` asserts this in both directions so a future
-- change cannot quietly convert one into the other.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- --------------------------------------------
-- No user is provisioned or invited. No `auth.users` or `user_profiles` row is
-- created or modified. No Structured Notes or notification-recipient policy is
-- touched (that is POST-R13.6B.1, kept separate so the one genuinely
-- behaviour-changing migration stays independently reviewable and revertible).
-- No lifecycle column is added to `user_profiles` (POST-R13.6C). No audit
-- schema is widened (see the note in section 6). Nothing is wired into
-- middleware or navigation (POST-R13.6E).
--
-- DATA SAFETY
-- -----------
-- Two new tables. The only rows written are compatibility grants for accounts
-- that are ALREADY approved, and only when the grant table is completely empty
-- — see section 5. No existing row anywhere is inserted, updated or deleted.
--
-- ROLLBACK: drop the two tables and the three functions. The application treats
-- an absent grant table as "module entitlement not configured" and falls back to
-- role/principal semantics only, i.e. exactly today's behaviour.


-- =============================================================================
-- 0 - GUARDS
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'user_profiles' and c.relkind = 'r'
  ) then
    raise exception
      'public.user_profiles not found - apply 20260701000000_auth_watchlist_foundation.sql first';
  end if;

  -- The Portfolio ceiling must already exist. This migration composes with it;
  -- it must never be applied to a database where the ceiling is absent, because
  -- the composition would then have nothing to intersect against.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'nmi_portfolio_scopes'
  ) then
    raise exception
      'public.nmi_portfolio_scopes not found - apply 20260806000000_family_portfolio_entitlements.sql first';
  end if;
end $$;


-- =============================================================================
-- 1 - MODULE REGISTRY
-- =============================================================================
--
-- Boring and explicit on purpose. A normalized registry with a foreign key beats
-- a JSONB permission bag (where a typo is silently a different permission, with
-- no error) and beats a boolean column per module (which needs a migration every
-- time the product grows).
--
-- `default_for_member` is PROVISIONING metadata only. See the header.

create table if not exists public.app_modules (
  module_key         text        primary key,
  label              text        not null,
  display_order      smallint    not null,
  default_for_member boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Keys are lowercase snake_case identifiers. This is a shape constraint, not
  -- an authorization control: authorization comes from a row's EXISTENCE.
  constraint app_modules_key_shape check (module_key ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.app_modules is
  'Registry of GRANTABLE application modules. Family Portfolio scopes (main, jaime, andres, '
  'pablo), the Portfolio publication console and notification-recipient administration are '
  'deliberately ABSENT: those are security ceilings and role capabilities, never module grants. '
  'Because user_module_grants.module_key references this table, a cross-principal grant is '
  'unrepresentable. POST-R13.6B.';

comment on column public.app_modules.default_for_member is
  'PROVISIONING metadata only - the checkbox state a NEW member invitation starts from. '
  'NEVER consulted at authorization time: a member is allowed a module if and only if an '
  'explicit user_module_grants row exists. See src/lib/auth/moduleAccess.ts.';

-- Deterministic seed. `on conflict` updates the presentation/provisioning
-- columns so the registry stays correct on re-application, without ever
-- touching a user's grants.
insert into public.app_modules (module_key, label, display_order, default_for_member) values
  ('markets',          'Markets',          10, true),
  ('analysis',         'Analysis',         20, true),
  ('macro',            'Macro',            30, true),
  ('earnings',         'Earnings',         40, true),
  ('portfolio',        'Portfolio',        50, true),
  ('alternatives',     'Alternatives',     60, true),
  ('structured_notes', 'Structured Notes', 70, false)
on conflict (module_key) do update
  set label              = excluded.label,
      display_order      = excluded.display_order,
      default_for_member = excluded.default_for_member,
      updated_at         = now();


-- =============================================================================
-- 2 - USER MODULE GRANTS
-- =============================================================================
--
-- EXPLICIT ROW PRESENT = module allowed for a member.
-- ROW ABSENT           = module denied.
--
-- The composite primary key is the whole uniqueness story: a duplicate grant is
-- structurally impossible, with no separate UNIQUE constraint to forget.
--
-- `granted_by` is NULLABLE for the same reason `family_portfolio_access_audit.
-- actor_user_id` is: the one-time compatibility backfill in section 5 has no
-- application administrator to name, and recording the target as their own
-- grantor would be a false record.

create table if not exists public.user_module_grants (
  user_id    uuid        not null references public.user_profiles(id) on delete cascade,
  module_key text        not null references public.app_modules(module_key) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid        references auth.users(id) on delete set null,
  primary key (user_id, module_key)
);

create index if not exists user_module_grants_module_idx
  on public.user_module_grants (module_key);

comment on table public.user_module_grants is
  'Explicit per-user application module grants. Row present = allowed; row ABSENT = denied. '
  'There is no runtime fallback to app_modules.default_for_member. Administrators are NOT '
  'given rows here - they hold every module by role, so administrative access can never be '
  'revoked by deleting a grant and an empty table cannot lock the platform out. '
  'Service-role writes only: no insert/update/delete policy exists. POST-R13.6B.';

comment on column public.user_module_grants.granted_by is
  'The administrator who granted this module, or NULL when the row was written by the '
  'one-time POST-R13.6B compatibility backfill, which had no application actor.';


-- =============================================================================
-- 3 - PRIVILEGES AND RLS
-- =============================================================================
--
-- Mirrors the hardened posture established for public.user_profiles in
-- 20260730000000. Supabase grants ALL on public tables to `anon` and
-- `authenticated` by default, so RLS alone would be the only thing standing
-- between an anonymous caller and this table. Revoke everything first, then
-- grant back the minimum.

alter table public.app_modules        enable row level security;
alter table public.user_module_grants enable row level security;

-- Complete policy reset on both tables, enumerated from pg_policies rather than
-- from a guessed list of names, so a permissive policy added by hand under any
-- other name cannot survive.
do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in ('app_modules', 'user_module_grants')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- The registry is not secret: it is the list of module names the application
-- itself renders. Authenticated read only.
create policy "app_modules_read" on public.app_modules
  for select
  to authenticated
  using (true);

-- A member may read their OWN grants (the client needs them to render an honest
-- interface) and NOTHING ELSE. Reading another user's grants would disclose the
-- shape of that person's access.
create policy "user_module_grants_own_select" on public.user_module_grants
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- There is deliberately NO insert, update or delete policy on either table for
-- `authenticated`. Writes are service-role only, so a member cannot grant
-- themselves a module and an administrator cannot do it through the public API
-- either - the POST-R13.6C management routes will use the server-side admin
-- client AFTER an explicit administrator authorization check.
revoke all privileges on table public.app_modules        from public, anon, authenticated;
revoke all privileges on table public.user_module_grants from public, anon, authenticated;

grant select on table public.app_modules        to authenticated;
grant select on table public.user_module_grants to authenticated;

grant all privileges on table public.app_modules        to service_role;
grant all privileges on table public.user_module_grants to service_role;

-- Column-level privileges live in pg_attribute.attacl and are NOT removed by a
-- table-level REVOKE. Strip any that exist.
do $$
declare
  rec record;
begin
  for rec in
    select c.relname as tbl, att.attname as col
    from pg_catalog.pg_attribute att
    join pg_catalog.pg_class c on c.oid = att.attrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname in ('app_modules', 'user_module_grants')
      and att.attnum > 0
      and not att.attisdropped
  loop
    execute format(
      'revoke all privileges (%I) on table public.%I from public, anon, authenticated',
      rec.col, rec.tbl
    );
  end loop;
end $$;


-- =============================================================================
-- 4 - AUTHORIZATION FUNCTIONS
-- =============================================================================
--
-- `public.nmi_module_allowed` is the PURE rule, mirrored byte-for-meaning in
-- src/lib/auth/moduleAccess.ts and asserted identical by the truth table in
-- section 6 and by tests/moduleEntitlements.test.ts.
--
-- Its inputs are the DECIDED facts rather than raw strings, so both sides pin
-- exactly the same rule: whether the caller is approved, whether they are an
-- administrator, whether an explicit grant row exists, and whether the module is
-- declared. Resolving those facts is the job of the callers below.
--
-- Fail-closed properties encoded here:
--   - not approved                    -> false, even when is_admin is true
--   - module not declared             -> false, even for an administrator
--   - approved administrator + known  -> true, with no grant row
--   - approved member without a grant -> false, whatever the registry default is
--   - any NULL input                  -> false, except a NULL admin flag falling
--                                        through to the grant check

create or replace function public.nmi_module_allowed(
  is_approved  boolean,
  is_admin     boolean,
  has_grant    boolean,
  module_known boolean
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when is_approved is not true  then false
    when module_known is not true then false
    when is_admin is true         then true
    else has_grant is true
  end
$$;

comment on function public.nmi_module_allowed(boolean, boolean, boolean, boolean) is
  'Canonical application module rule. Pure/immutable. Mirrored byte-for-meaning in '
  'src/lib/auth/moduleAccess.ts and asserted identical by tests/moduleEntitlements.test.ts. '
  'Never consults app_modules.default_for_member. POST-R13.6B.';


-- Every module key the CALLING user has an explicit grant row for.
--
-- SECURITY DEFINER with `set search_path = ''`: the lookup must read
-- `user_module_grants` without being filtered by that table's own-row RLS policy
-- when this function is invoked from a policy on ANOTHER table, and it must
-- never recurse into that policy. Takes NO parameters - the identity comes from
-- `auth.uid()`, so a client-supplied user id can never reach it.
create or replace function public.nmi_current_module_grants()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(g.module_key order by g.module_key)
      from public.user_module_grants g
      where g.user_id = (select auth.uid())
    ),
    array[]::text[]   -- no session, or no grants -> nothing
  )
$$;

comment on function public.nmi_current_module_grants() is
  'Explicit module grants for the calling user, resolved server-side from auth.uid(). '
  'SECURITY DEFINER so a policy on another table can call it without recursing into '
  'user_module_grants RLS. Returns {} for an anonymous or ungranted caller. POST-R13.6B.';


-- THE reusable RLS predicate. POST-R13.6B.1 will attach it to the Structured
-- Notes tables and to notification recipients:
--
--   create policy "sn_module_read" on public.structured_notes
--     for select to authenticated
--     using (public.nmi_can_access_module('structured_notes'));
--
-- An unknown or malformed module name is denied because it is absent from
-- `app_modules`, so a client-supplied module can never widen access.
create or replace function public.nmi_can_access_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.nmi_module_allowed(
    -- approved: a non-empty username on the caller's own profile row
    coalesce((
      select nullif(btrim(p.username::text), '') is not null
      from public.user_profiles p where p.id = (select auth.uid())
    ), false),
    -- administrator: the role dimension only
    coalesce((
      select p.role = 'administrator'
      from public.user_profiles p where p.id = (select auth.uid())
    ), false),
    -- explicit grant row present
    requested_module is not null
      and requested_module = any (public.nmi_current_module_grants()),
    -- module declared in the registry
    requested_module is not null
      and exists (select 1 from public.app_modules m where m.module_key = requested_module)
  )
$$;

comment on function public.nmi_can_access_module(text) is
  'THE reusable module RLS predicate for POST-R13.6B.1 (Structured Notes, notification '
  'recipients). Denies null, unknown and malformed module names by construction, and denies '
  'an unapproved caller regardless of role. POST-R13.6B.';

-- These execute with the definer's rights, so they must not be callable by
-- anonymous traffic. `authenticated` needs them; `anon` and PUBLIC must not.
revoke all on function public.nmi_module_allowed(boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.nmi_current_module_grants()                            from public, anon;
revoke all on function public.nmi_can_access_module(text)                            from public, anon;

grant execute on function public.nmi_module_allowed(boolean, boolean, boolean, boolean) to authenticated, service_role;
grant execute on function public.nmi_current_module_grants()                            to authenticated, service_role;
grant execute on function public.nmi_can_access_module(text)                            to authenticated, service_role;


-- =============================================================================
-- 5 - ONE-TIME COMPATIBILITY BACKFILL
-- =============================================================================
--
-- This migration must not remove access anyone has today. Every currently
-- APPROVED member therefore receives an explicit grant for every registered
-- module - INCLUDING `structured_notes`, which they can currently reach.
--
-- Note the deliberate asymmetry, which is the owner's decision recorded as SQL:
--   · an EXISTING approved member keeps Structured Notes, via an explicit row;
--   · a NEW member provisioned later starts without it, because
--     `default_for_member` is false for that module.
-- Backwards compatibility and the new default are different questions, and this
-- is the line between them.
--
-- Administrators are deliberately given NO rows: they hold every module by role.
--
-- WHY THE GLOBAL EMPTINESS GUARD. A naive `on conflict do nothing` backfill is
-- idempotent only in the trivial sense. Re-applied after POST-R13.6C, it would
-- silently RESTORE a module an administrator had deliberately revoked - a
-- migration quietly re-granting access is exactly the failure mode this whole
-- stage exists to prevent. Running only when the grant table is COMPLETELY empty
-- makes "has this backfill already happened?" a single unambiguous question, and
-- once any grant exists anywhere the block can never fire again.
do $$
declare
  inserted int;
begin
  if exists (select 1 from public.user_module_grants) then
    raise notice 'POST-R13.6B backfill skipped: user_module_grants already contains rows.';
    return;
  end if;

  insert into public.user_module_grants (user_id, module_key, granted_by)
  select p.id, m.module_key, null
  from public.user_profiles p
  cross join public.app_modules m
  where nullif(btrim(p.username::text), '') is not null   -- approved only
    and p.role is distinct from 'administrator';          -- admins need no rows

  get diagnostics inserted = row_count;
  raise notice 'POST-R13.6B backfill: % compatibility grant row(s) written.', inserted;
end $$;


-- =============================================================================
-- 6 - POSTCONDITIONS, executed in-database at apply time
-- =============================================================================
--
-- AUDIT SCHEMA: deliberately NOT widened here. `family_portfolio_access_audit`
-- constrains `field_changed` to ('portfolio_principal', 'role'), so recording a
-- module grant needs that CHECK relaxed and a `module_key` column added. Doing
-- it in this migration would mean shipping provisioning-shaped schema in a stage
-- that writes no provisioning event, and the compatibility backfill above has no
-- administrator actor to record. It belongs with the management APIs that
-- actually produce those events - POST-R13.6C. No audit row is written here.

-- 6a - THE PARITY TRUTH TABLE, executed by PostgreSQL itself.
--
-- Every row below is also asserted, case for case, in
-- tests/moduleEntitlements.test.ts against the TypeScript implementation, and
-- that test additionally parses THIS block to prove the two truth tables are the
-- same table. A divergence fails the migration here and fails the suite there.
do $$
declare
  c   record;
  got boolean;
begin
  for c in
    select * from (values
      -- is_approved, is_admin, has_grant, module_known, expected
      (true,  true,  false, true,  true),
      (true,  true,  true,  true,  true),
      (true,  true,  false, false, false),
      (true,  true,  true,  false, false),
      (true,  false, true,  true,  true),
      (true,  false, false, true,  false),
      (true,  false, false, false, false),
      (true,  false, true,  false, false),
      (false, false, true,  true,  false),
      (false, false, false, true,  false),
      (false, true,  true,  true,  false),
      (false, true,  false, true,  false),
      (null,  false, true,  true,  false),
      (null,  true,  true,  true,  false),
      (true,  null,  true,  true,  true),
      (true,  null,  false, true,  false),
      (true,  false, null,  true,  false),
      (true,  false, true,  null,  false)
    ) as t(is_approved, is_admin, has_grant, module_known, expected)
  loop
    got := public.nmi_module_allowed(c.is_approved, c.is_admin, c.has_grant, c.module_known);
    if got is distinct from c.expected then
      raise exception
        'nmi_module_allowed(%, %, %, %) = %, expected %',
        c.is_approved, c.is_admin, c.has_grant, c.module_known, got, c.expected;
    end if;
  end loop;
end $$;

-- 6b - Registry, schema, privileges and RLS.
do $$
declare
  bad       text;
  priv      text;
  role_name text;
  tbl       text;
  n         int;
begin
  -- 1 - The registry holds exactly the seven grantable keys.
  select string_agg(module_key, ',' order by module_key) into bad from public.app_modules;
  if bad is distinct from
     'alternatives,analysis,earnings,macro,markets,portfolio,structured_notes' then
    raise exception 'unexpected app_modules registry contents: %', coalesce(bad, '(empty)');
  end if;

  -- 2 - A Family Portfolio scope must NEVER become a module key. This is the
  --     single most important assertion in the migration: it is what makes a
  --     cross-principal grant unrepresentable rather than merely rejected.
  select string_agg(module_key, ', ') into bad
  from public.app_modules
  where module_key in ('main', 'jaime', 'andres', 'pablo', 'admin');
  if bad is not null then
    raise exception
      'app_modules contains Family Portfolio scope(s) as module keys: % - a grant could then cross the principal ceiling', bad;
  end if;

  -- 3 - Role capabilities must never be modelled as grantable modules.
  select string_agg(module_key, ', ') into bad
  from public.app_modules
  where module_key in ('portfolio_admin', 'notification_recipients');
  if bad is not null then
    raise exception 'app_modules contains a ROLE capability as a module key: %', bad;
  end if;

  -- 4 - The grant table's foreign key into the registry must exist; it is what
  --     makes an unknown module key impossible to store.
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    join pg_catalog.pg_class ref on ref.oid = con.confrelid
    where ns.nspname = 'public' and c.relname = 'user_module_grants'
      and con.contype = 'f' and ref.relname = 'app_modules'
  ) then
    raise exception
      'user_module_grants.module_key has no foreign key into app_modules - unknown modules would be storable';
  end if;

  -- 5 - Duplicate grants must be structurally impossible.
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'user_module_grants'
      and con.contype = 'p'
      and con.conkey @> array[
        (select attnum from pg_catalog.pg_attribute
          where attrelid = c.oid and attname = 'user_id'),
        (select attnum from pg_catalog.pg_attribute
          where attrelid = c.oid and attname = 'module_key')
      ]::smallint[]
  ) then
    raise exception 'user_module_grants must have a (user_id, module_key) primary key';
  end if;

  -- 6 - RLS enabled on both tables.
  foreach tbl in array array['app_modules','user_module_grants'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = tbl and c.relrowsecurity
    ) then
      raise exception 'row level security is not enabled on public.%', tbl;
    end if;
  end loop;

  -- 7 - Exactly one policy per table, and both SELECT-only.
  foreach tbl in array array['app_modules','user_module_grants'] loop
    select count(*) into n
    from pg_catalog.pg_policies where schemaname = 'public' and tablename = tbl;
    if n <> 1 then
      raise exception 'expected exactly 1 policy on public.%, found %', tbl, n;
    end if;

    select string_agg(cmd, ',') into bad
    from pg_catalog.pg_policies where schemaname = 'public' and tablename = tbl;
    if bad is distinct from 'SELECT' then
      raise exception 'public.% must carry a SELECT-only policy, found %', tbl, coalesce(bad, '(none)');
    end if;
  end loop;

  -- 8 - The own-row predicate on grants must really be own-row. Fail closed on a
  --     null predicate: `null !~ pattern` is NULL, not true, so a bare regex
  --     test would silently pass a policy with no USING clause at all.
  select qual into bad
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'user_module_grants';
  if bad is null or bad !~ 'auth\.uid\(\)' or bad !~ 'user_id' then
    raise exception
      'user_module_grants policy must restrict to the caller''s own rows, found: %',
      coalesce(bad, '(null)');
  end if;

  -- 9 - EFFECTIVE privileges. The ACL checks that a direct grant is absent do
  --     NOT prove effective access: a custom parent role could hold UPDATE while
  --     `authenticated` inherits it. has_table_privilege() resolves role
  --     membership AND table ownership, so it is the authoritative answer.
  foreach tbl in array array['app_modules','user_module_grants'] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', 'public.' || tbl, priv) then
        raise exception 'anon has EFFECTIVE % on public.%', priv, tbl;
      end if;
    end loop;

    if not has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') then
      raise exception 'authenticated must retain effective SELECT on public.%', tbl;
    end if;

    foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('authenticated', 'public.' || tbl, priv) then
        raise exception
          'authenticated has EFFECTIVE % on public.% - a member could grant themselves a module', priv, tbl;
      end if;
    end loop;

    -- Column-level privileges, including anything inherited.
    foreach role_name in array array['anon','authenticated'] loop
      foreach priv in array array['INSERT','UPDATE','REFERENCES'] loop
        if has_any_column_privilege(role_name::name, 'public.' || tbl, priv) then
          raise exception '% has EFFECTIVE column-level % on public.%', role_name, priv, tbl;
        end if;
      end loop;
    end loop;

    -- Ownership. An owner bypasses ordinary object-privilege restrictions.
    select r.rolname into bad
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where ns.nspname = 'public' and c.relname = tbl;
    if bad in ('anon', 'authenticated') then
      raise exception 'public.% is owned by the ordinary application role %', tbl, bad;
    end if;

    -- service_role keeps what POST-R13.6C provisioning will need.
    if not has_table_privilege('service_role', 'public.' || tbl, 'INSERT')
       or not has_table_privilege('service_role', 'public.' || tbl, 'DELETE') then
      raise exception
        'service_role must retain INSERT and DELETE on public.% for administrative grant management', tbl;
    end if;
  end loop;

  -- 10 - The SECURITY DEFINER functions must not be reachable anonymously.
  if has_function_privilege('anon', 'public.nmi_current_module_grants()', 'execute') then
    raise exception 'anon can execute nmi_current_module_grants()';
  end if;
  if has_function_privilege('anon', 'public.nmi_can_access_module(text)', 'execute') then
    raise exception 'anon can execute nmi_can_access_module(text)';
  end if;

  -- 11 - Every SECURITY DEFINER function added here pins search_path. Without it
  --      a caller-controlled search_path could resolve `public.user_profiles` to
  --      a different table inside a definer-rights function.
  select string_agg(p.proname, ', ') into bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('nmi_current_module_grants', 'nmi_can_access_module')
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
      where cfg like 'search_path=%'
    );
  if bad is not null then
    raise exception 'SECURITY DEFINER function(s) without a pinned search_path: %', bad;
  end if;

  -- 12 - The frozen Portfolio ceiling is untouched. If a future edit to this
  --      migration ever redefined it, this assertion is where that surfaces.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'nmi_can_access_scope'
  ) then
    raise exception 'nmi_can_access_scope is missing - the Portfolio ceiling must remain intact';
  end if;

  if public.nmi_portfolio_scopes(true, false, 'jaime')
     is distinct from array['main','jaime','alternatives'] then
    raise exception 'the Family Portfolio ceiling changed - POST-R13.6B must not alter it';
  end if;

  -- 13 - No approved member was left without compatibility grants. Guards the
  --      backfill itself: a silently empty insert would remove access for every
  --      member the moment POST-R13.6E starts enforcing.
  select count(*) into n
  from public.user_profiles p
  where nullif(btrim(p.username::text), '') is not null
    and p.role is distinct from 'administrator'
    and not exists (select 1 from public.user_module_grants g where g.user_id = p.id);
  if n > 0 then
    raise exception
      '% approved member(s) have no module grants - the compatibility backfill did not cover them', n;
  end if;
end $$;
