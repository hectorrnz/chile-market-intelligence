-- R13.1 — Family Portfolio entitlement and authorization foundation.
--
-- Forward-only. Re-runnable. Establishes the TWO ORTHOGONAL authorization
-- dimensions defined in docs/portfolio-r13/05-authorization-and-data-architecture.md
-- § 2.2, and nothing else. No financial table, no storage bucket, no upload
-- table, no sample data, no user row is created or modified by this migration.
--
-- DEPLOYMENT: applied through the Supabase CLI migration workflow
-- (`supabase migration list` → `supabase db push --dry-run` → review →
-- `supabase db push`), NOT by pasting SQL into the remote SQL Editor.
--
--
-- THE TWO DIMENSIONS
-- ══════════════════
--   1. APPLICATION ROLE      `user_profiles.role`
--      What administrative capabilities does this account have?
--
--   2. PORTFOLIO PRINCIPAL   `user_profiles.portfolio_principal`
--      Which personal family portfolio may this account see?
--
-- `administrator` is NOT a portfolio-principal value. Administrative capability
-- comes from the role dimension only, so "an administrator who is also Pablo"
-- and "a read-only family member" are both representable, and a principal can
-- never silently confer administrative power.
--
--
-- WHY `user_profiles.role` IS THE ROLE AUTHORITY (decision rule 1)
-- ════════════════════════════════════════════════════════════════
-- `role text not null default 'user'` has existed since Phase 6A
-- (20260701000000_auth_watchlist_foundation.sql). It was created to represent
-- application authorization and has never been read by runtime code —
-- src/lib/auth/approval.ts records this explicitly and defers activation to
-- "the future Users & Access phase". This is that phase.
--
-- No competing in-application administrative authority exists. The only
-- "administrator" today is possession of the service-role key plus shell access
-- (scripts/admin/provisionUser.ts). That is an OPERATOR capability — it bypasses
-- RLS entirely — not an application role, and this migration neither replaces
-- nor weakens it. `service_role` keeps full access throughout.
--
-- ACTIVATING `role` IS SAFE AND PRESERVES EVERY CURRENT ADMINISTRATOR because
-- no code reads it today: activation grants nothing to anyone and removes
-- nothing from anyone. Every approved user keeps exactly the access they have.
-- There is no production role data to preserve and therefore nothing to guess.
-- The first administrator is created deliberately, later, through the
-- service-role provisioning path — never by this migration.
--
-- MUTATION IS ALREADY LOCKED. 20260730000000_user_profiles_admin_controlled_approval.sql
-- revoked every privilege on `user_profiles` from public/anon/authenticated,
-- granted back only SELECT to authenticated, stripped column-level grants, and
-- asserted the EFFECTIVE privilege set. New columns added here inherit that
-- posture automatically: `authenticated` can read its own row (own-row RLS) and
-- cannot write any column. A user therefore cannot assign their own role or
-- principal, and no browser code can write either field.
--
--
-- DATA SAFETY
-- ═══════════
-- No row is inserted, updated or deleted. `role` is NOT rewritten. If any row
-- holds a role value outside the constrained set, this migration FAILS LOUDLY
-- with the offending values rather than guessing a normalization — an
-- unverified rewrite of an authorization column is exactly the kind of guess
-- that must never ship.

-- ── Guard: the table this migration extends must already exist ─────────────────
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'user_profiles' and c.relkind = 'r'
  ) then
    raise exception
      'public.user_profiles not found — apply 20260701000000_auth_watchlist_foundation.sql first';
  end if;
end $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1 · DIMENSION 1 — application role
-- ══════════════════════════════════════════════════════════════════════════════

-- Refuse to constrain a column whose live contents we have not verified. This
-- fails closed and names the offending values instead of silently rewriting an
-- authorization field.
do $$
declare
  offending text;
begin
  select string_agg(distinct coalesce(role, '(null)'), ', ')
    into offending
  from public.user_profiles
  where role is null or role not in ('user', 'administrator');

  if offending is not null then
    raise exception
      'public.user_profiles.role holds unconstrained value(s): %. Reconcile these deliberately before applying R13.1 — this migration will not guess a normalization for an authorization column.',
      offending;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'user_profiles_role_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_role_check check (role in ('user', 'administrator'));
  end if;
end $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2 · DIMENSION 2 — portfolio principal
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Nullable with NO default beyond null: a portfolio principal is NOT mandatory.
-- Non-family Nevada Market Intelligence users legitimately stay null and simply
-- receive no Family Portfolio scope. Administrators normally stay null too —
-- their access comes from the role dimension.
--
-- `administrator` is deliberately absent from the CHECK set.

alter table public.user_profiles
  add column if not exists portfolio_principal text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'user_profiles_portfolio_principal_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_portfolio_principal_check
        check (portfolio_principal is null or portfolio_principal in ('jaime', 'andres', 'pablo'));
  end if;
end $$;

comment on column public.user_profiles.role is
  'Application role — administrative capability. ''user'' | ''administrator''. '
  'Service-role writes only (see 20260730000000). Never derived from client input, '
  'session metadata, username, or email. R13.1.';

comment on column public.user_profiles.portfolio_principal is
  'Family Portfolio entitlement — which personal portfolio this account may see. '
  '''jaime'' | ''andres'' | ''pablo'' | null. NOT a role: it never confers administrative '
  'capability, and ''administrator'' is deliberately not a valid value. Null is normal for '
  'administrators and for non-family users. Service-role writes only. R13.1.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3 · AUTHORIZATION HELPERS
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `nmi_portfolio_scopes` is the ONE canonical rule. It is PURE and IMMUTABLE:
-- it takes the three authorization inputs explicitly and reads nothing, so it
-- can be exercised directly by the postcondition truth table below with no
-- session, and mirrored exactly in TypeScript
-- (src/lib/portfolioAccess/entitlements.ts).
--
-- Canonical scope order is fixed — main, jaime, andres, pablo, alternatives,
-- admin — so array equality is a stable comparison on both sides.
--
-- Fail-closed properties encoded here:
--   · not approved                       → {}   (even when is_admin is true)
--   · null / unknown / malformed principal → {} (for a non-administrator)
--   · `admin` scope is reachable ONLY through the role dimension

create or replace function public.nmi_portfolio_scopes(
  is_approved boolean,
  is_admin    boolean,
  principal   text
)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    -- Approval is the outer gate. An unapproved (or revoked) identity receives
    -- nothing, regardless of role or principal.
    when is_approved is not true then array[]::text[]
    when is_admin is true         then array['main','jaime','andres','pablo','alternatives','admin']
    when principal = 'jaime'      then array['main','jaime','alternatives']
    when principal = 'andres'     then array['main','andres','alternatives']
    when principal = 'pablo'      then array['main','pablo','alternatives']
    else array[]::text[]
  end
$$;

comment on function public.nmi_portfolio_scopes(boolean, boolean, text) is
  'Canonical Family Portfolio scope rule. Pure/immutable. Mirrored byte-for-meaning in '
  'src/lib/portfolioAccess/entitlements.ts and asserted identical by tests/familyPortfolioEntitlements.test.ts. '
  'R13.1.';


-- Resolves the CALLING user''s three authorization inputs from their own profile
-- row and returns their scopes.
--
-- SECURITY DEFINER with `set search_path = ''`: the lookup must read
-- `user_profiles` without being filtered by that table''s own-row RLS policy
-- when this function is invoked from a policy on ANOTHER table. Defining it this
-- way also means a future R13 policy calling it can never recurse into
-- `user_profiles`'s policy.
--
-- It takes NO parameters. Authorization inputs are read from the database using
-- `auth.uid()`; a client-supplied role, principal or scope can never reach them.
create or replace function public.nmi_current_portfolio_scopes()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select public.nmi_portfolio_scopes(
               nullif(btrim(p.username::text), '') is not null,
               p.role = 'administrator',
               p.portfolio_principal
             )
      from public.user_profiles p
      where p.id = (select auth.uid())
    ),
    array[]::text[]   -- no session, or no profile row → no scopes
  )
$$;

comment on function public.nmi_current_portfolio_scopes() is
  'Family Portfolio scopes for the calling user, resolved server-side from auth.uid(). '
  'SECURITY DEFINER so a policy on another table can call it without recursing into '
  'user_profiles RLS. Returns {} for an anonymous, profile-less, or unapproved caller. R13.1.';


-- True when the calling user is an administrator. Derived ONLY from the role
-- dimension — never from a principal value, username, email, or client claim.
create or replace function public.nmi_is_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role = 'administrator'
             and nullif(btrim(p.username::text), '') is not null
      from public.user_profiles p
      where p.id = (select auth.uid())
    ),
    false
  )
$$;

comment on function public.nmi_is_administrator() is
  'True only for an APPROVED account whose application role is administrator. '
  'A revoked administrator (username cleared) is denied immediately. R13.1.';


-- THE reusable RLS predicate. Later R13 tables attach:
--
--   create policy "r13_scope_read" on public.<table>
--     for select to authenticated
--     using (public.nmi_can_access_scope(scope));
--
-- An unknown or malformed scope name is denied because it is simply absent from
-- the caller''s scope array — a client-supplied scope can never widen access.
create or replace function public.nmi_can_access_scope(requested_scope text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_scope is not null
     and requested_scope = any (public.nmi_current_portfolio_scopes())
$$;

comment on function public.nmi_can_access_scope(text) is
  'THE reusable Family Portfolio RLS predicate for later R13 tables. Denies null, unknown and '
  'malformed scope names by construction. R13.1.';

-- These execute with the definer''s rights, so they must not be callable by
-- anonymous traffic. `authenticated` needs them; `anon` and PUBLIC must not.
revoke all on function public.nmi_portfolio_scopes(boolean, boolean, text) from public, anon;
revoke all on function public.nmi_current_portfolio_scopes()               from public, anon;
revoke all on function public.nmi_is_administrator()                       from public, anon;
revoke all on function public.nmi_can_access_scope(text)                   from public, anon;

grant execute on function public.nmi_portfolio_scopes(boolean, boolean, text) to authenticated, service_role;
grant execute on function public.nmi_current_portfolio_scopes()               to authenticated, service_role;
grant execute on function public.nmi_is_administrator()                       to authenticated, service_role;
grant execute on function public.nmi_can_access_scope(text)                   to authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4 · ACCESS-CHANGE AUDIT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Narrowest immutable record of an administrative access change. No existing
-- table fits: `ingestion_runs` is data-pipeline telemetry, and the structured-note
-- run tables are monitoring logs. This mirrors the
-- `structured_note_monitoring_runs` precedent — system-level, service-role
-- writes only, no insert/update/delete policy at all.
--
-- Deliberately holds NO password, session token, secret key, workbook content,
-- or personal information beyond the two user identifiers already present in
-- `auth.users`.

create table if not exists public.family_portfolio_access_audit (
  id              uuid primary key default gen_random_uuid(),
  target_user_id  uuid        not null references auth.users(id) on delete cascade,
  actor_user_id   uuid        not null references auth.users(id) on delete restrict,
  field_changed   text        not null check (field_changed in ('portfolio_principal', 'role')),
  previous_value  text,
  new_value       text,
  changed_at      timestamptz not null default now()
);

create index if not exists family_portfolio_access_audit_target_idx
  on public.family_portfolio_access_audit (target_user_id, changed_at desc);

alter table public.family_portfolio_access_audit enable row level security;

-- Complete policy reset, enumerated from pg_policies so a hand-added permissive
-- policy under any other name cannot survive.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_access_audit'
  loop
    execute format('drop policy %I on public.family_portfolio_access_audit', pol.policyname);
  end loop;
end $$;

-- Administrators may READ the trail. There is deliberately NO insert, update or
-- delete policy for `authenticated` — writes are service-role only, so a
-- non-administrator cannot alter audit records and an administrator cannot
-- rewrite history through the API either.
create policy "family_portfolio_access_audit_admin_select"
  on public.family_portfolio_access_audit
  for select
  to authenticated
  using (public.nmi_is_administrator());

revoke all privileges on table public.family_portfolio_access_audit from public, anon, authenticated;
grant select on table public.family_portfolio_access_audit to authenticated;
grant all privileges on table public.family_portfolio_access_audit to service_role;

comment on table public.family_portfolio_access_audit is
  'Immutable audit of administrative Family Portfolio access changes (role, portfolio_principal). '
  'Service-role writes only — no insert/update/delete policy exists. Administrators may read. '
  'Contains no secret, credential, or financial data. R13.1.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 5 · POSTCONDITIONS — executed in-database at apply time
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a · THE PARITY TRUTH TABLE, executed by PostgreSQL itself.
--
-- Every row below is also asserted, case for case, in
-- tests/familyPortfolioEntitlements.test.ts against the TypeScript
-- implementation, and that test additionally parses THIS block to prove the two
-- truth tables are the same table. A divergence fails the migration here and
-- fails the suite there.
do $$
declare
  c record;
  got text[];
begin
  for c in
    select * from (values
      -- is_approved, is_admin, principal,   expected
      (true,  true,  null,        array['main','jaime','andres','pablo','alternatives','admin']),
      (true,  true,  'jaime',     array['main','jaime','andres','pablo','alternatives','admin']),
      (true,  true,  'andres',    array['main','jaime','andres','pablo','alternatives','admin']),
      (true,  true,  'pablo',     array['main','jaime','andres','pablo','alternatives','admin']),
      (true,  false, 'jaime',     array['main','jaime','alternatives']),
      (true,  false, 'andres',    array['main','andres','alternatives']),
      (true,  false, 'pablo',     array['main','pablo','alternatives']),
      (true,  false, null,        array[]::text[]),
      (true,  false, 'nope',      array[]::text[]),
      (true,  false, 'ADMINISTRATOR', array[]::text[]),
      (true,  false, 'administrator', array[]::text[]),
      (false, false, null,        array[]::text[]),
      (false, false, 'jaime',     array[]::text[]),
      (false, true,  'jaime',     array[]::text[]),
      (false, true,  null,        array[]::text[]),
      (null,  false, 'jaime',     array[]::text[]),
      (true,  null,  'jaime',     array['main','jaime','alternatives'])
    ) as t(is_approved, is_admin, principal, expected)
  loop
    got := public.nmi_portfolio_scopes(c.is_approved, c.is_admin, c.principal);
    if got is distinct from c.expected then
      raise exception
        'nmi_portfolio_scopes(%, %, %) returned % — expected %',
        c.is_approved, c.is_admin, coalesce(c.principal, '(null)'), got, c.expected;
    end if;
  end loop;
end $$;

-- 5b · Structural and privilege postconditions.
do $$
declare
  bad  text;
  priv text;
begin
  -- Columns exist with the intended nullability/default.
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_profiles'
      and a.attname = 'portfolio_principal' and not a.attisdropped
  ) then
    raise exception 'user_profiles.portfolio_principal was not created';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_profiles'
      and a.attname = 'portfolio_principal' and a.attnotnull
  ) then
    raise exception 'user_profiles.portfolio_principal must remain nullable — a principal is not mandatory';
  end if;

  -- Both CHECK constraints are present.
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'user_profiles_portfolio_principal_check') then
    raise exception 'user_profiles_portfolio_principal_check is missing';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'user_profiles_role_check') then
    raise exception 'user_profiles_role_check is missing';
  end if;

  -- The principal CHECK must admit exactly the three family principals and must
  -- NOT admit 'administrator'. Asserted by reading the constraint definition —
  -- deliberately NOT by attempting a test INSERT, which would contradict this
  -- migration's own "no row is inserted" guarantee.
  select pg_catalog.pg_get_constraintdef(oid) into bad
  from pg_catalog.pg_constraint where conname = 'user_profiles_portfolio_principal_check';

  if bad is null then
    raise exception 'user_profiles_portfolio_principal_check has no definition';
  end if;
  if bad like '%administrator%' then
    raise exception 'portfolio_principal CHECK admits ''administrator'' — role and principal must stay separate: %', bad;
  end if;
  if bad not like '%jaime%' or bad not like '%andres%' or bad not like '%pablo%' then
    raise exception 'portfolio_principal CHECK does not admit all three family principals: %', bad;
  end if;

  -- The role CHECK must admit exactly 'user' and 'administrator'.
  select pg_catalog.pg_get_constraintdef(oid) into bad
  from pg_catalog.pg_constraint where conname = 'user_profiles_role_check';

  if bad is null or bad not like '%administrator%' or bad not like '%user%' then
    raise exception 'user_profiles_role_check is not the expected two-value constraint: %', coalesce(bad, '(null)');
  end if;

  -- RLS is on for the audit table and it carries exactly one (SELECT) policy.
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'family_portfolio_access_audit' and c.relrowsecurity
  ) then
    raise exception 'row level security is not enabled on family_portfolio_access_audit';
  end if;

  select string_agg(policyname || ':' || cmd, ', ') into bad
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'family_portfolio_access_audit';

  if bad is distinct from 'family_portfolio_access_audit_admin_select:SELECT' then
    raise exception 'unexpected audit policy set: %', coalesce(bad, '(none)');
  end if;

  -- No write privilege survives for anon or authenticated on the audit table.
  foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('authenticated', 'public.family_portfolio_access_audit', priv) then
      raise exception 'authenticated has EFFECTIVE % on family_portfolio_access_audit', priv;
    end if;
  end loop;
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if has_table_privilege('anon', 'public.family_portfolio_access_audit', priv) then
      raise exception 'anon has EFFECTIVE % on family_portfolio_access_audit', priv;
    end if;
  end loop;

  -- The R1.5 posture on user_profiles is intact: authenticated still reads only.
  foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.user_profiles', priv) then
      raise exception
        'authenticated regained EFFECTIVE % on user_profiles — a user could assign their own role or principal', priv;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.user_profiles', 'SELECT') then
    raise exception 'authenticated lost SELECT on user_profiles — the approval lookup depends on it';
  end if;

  -- No column-level write grant on the two authorization columns.
  foreach priv in array array['INSERT','UPDATE','REFERENCES'] loop
    if has_column_privilege('authenticated', 'public.user_profiles', 'role', priv) then
      raise exception 'authenticated holds column-level % on user_profiles.role', priv;
    end if;
    if has_column_privilege('authenticated', 'public.user_profiles', 'portfolio_principal', priv) then
      raise exception 'authenticated holds column-level % on user_profiles.portfolio_principal', priv;
    end if;
  end loop;

  -- anon must not reach the helpers.
  if has_function_privilege('anon', 'public.nmi_current_portfolio_scopes()', 'EXECUTE') then
    raise exception 'anon can execute nmi_current_portfolio_scopes()';
  end if;
  if has_function_privilege('anon', 'public.nmi_is_administrator()', 'EXECUTE') then
    raise exception 'anon can execute nmi_is_administrator()';
  end if;

  -- SECURITY DEFINER functions must pin search_path, or a caller-controlled
  -- path could resolve `public.user_profiles` to a shadow table.
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('nmi_current_portfolio_scopes','nmi_is_administrator','nmi_can_access_scope')
      and p.prosecdef
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) cfg where cfg like 'search\_path=%'
      ))
  ) then
    raise exception 'a SECURITY DEFINER nmi_* function does not pin search_path';
  end if;
end $$;
