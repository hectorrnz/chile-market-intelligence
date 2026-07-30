-- R1.5 — Make `public.user_profiles` the ADMINISTRATOR-CONTROLLED approval boundary.
--
-- Forward-only. Re-runnable. Privileges and policies only — no data is touched.
--
-- DEPLOYMENT: this migration is applied through the Supabase CLI migration
-- workflow (`supabase migration list` → `supabase db push --dry-run` → review →
-- `supabase db push`), NOT by pasting SQL into the remote SQL Editor. The exact
-- sequence is in docs/security_access_control.md § "Applying this migration".
--
-- WHY
-- ───
-- `public.user_profiles.username` is Nevada Market Intelligence's approval
-- marker: the application signs users in by username (`/api/auth/login` resolves
-- username → email through this table), and middleware re-reads this row on
-- every private request to decide access. It is, for now, the entire
-- authorization boundary.
--
-- Phase 6A created it with self-service write policies (quoted here only to
-- record what is being removed):
--
--     users_own_profile_insert   for insert with check (auth.uid() = id)
--     users_own_profile_update   for update using      (auth.uid() = id)   -- no WITH CHECK
--
-- Those made the boundary self-granting. Any holder of a session — including one
-- obtained through the password-recovery link path — could create its own row
-- with a free username using the PUBLIC anon key and thereby approve itself, or
-- rewrite its own row to restore a marker an administrator had just revoked, or
-- repoint `email` at another identity. The application enforced approval; the
-- database handed it out.
--
-- WHAT THIS MIGRATION DOES
-- ────────────────────────
-- 1. Drops EVERY policy currently attached to the table, enumerated from
--    pg_policies rather than from a guessed list of names — a permissive policy
--    added by hand under any other name would otherwise survive.
-- 2. Creates exactly one policy: authenticated SELECT of your own row.
-- 3. Revokes ALL table privileges from PUBLIC, anon and authenticated (this
--    covers REFERENCES and TRIGGER, not just the DML four), then grants back
--    only `select` to authenticated and `all` to service_role.
-- 4. Revokes any COLUMN-level grant as well. `REVOKE ... ON TABLE` does NOT
--    remove column-level privileges in PostgreSQL — they are tracked separately
--    in pg_attribute.attacl — so an old `GRANT UPDATE (username)` would survive
--    a table-level revoke and quietly keep the boundary writable.
-- 5. Asserts the final state and raises a clear exception if anything differs.
--    The assertion is deliberately TWO-LAYERED:
--      · direct ACL (pg_class.relacl / pg_attribute.attacl) — proves no explicit
--        grant was left behind;
--      · EFFECTIVE access (has_table_privilege / has_any_column_privilege) —
--        proves nothing is reachable through role membership or table ownership
--        either. A custom parent role holding UPDATE that `authenticated`
--        inherits would leave the direct ACL reading "SELECT only" while real
--        access was broader; only the effective check catches that.
--    It also asserts that neither application role owns the table, holds
--    BYPASSRLS, or is a superuser — any of which would make the policy
--    decorative — and that `service_role` still CAN bypass RLS, or provisioning
--    would be blocked by the very policy this migration installs.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- ────────────────────────────────
-- No new access table, no role hierarchy, no status enum, no invitation table,
-- no app_metadata or custom claims, no admin UI. Approval stays presence-based
-- on `username` — which is only safe BECAUSE mutation becomes administrator-only.
-- A richer model belongs to the future Users & Access phase.
--
-- Public Supabase signup is a SEPARATE external control (`disable_signup`) that
-- this migration cannot set. See docs/security_access_control.md § 4a.
--
-- DATA SAFETY
-- ───────────
-- No row is inserted, updated or deleted; the table is not recreated; no column,
-- constraint, index or trigger is altered. Every currently-approved user stays
-- approved and can keep signing in.
--
-- ROLLBACK: docs/security_access_control.md § "Rollback". Rolling back restores
-- the self-approval vulnerability described above.

-- ── Guard: fail clearly if the expected table is absent ─────────────────────────
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

-- ── RLS stays enabled (idempotent; never disabled by this migration) ───────────
alter table public.user_profiles enable row level security;

-- ── Complete policy reset ──────────────────────────────────────────────────────
-- Enumerate and drop EVERY existing policy. Identifiers are quoted with %I, so a
-- policy name containing spaces, quotes or mixed case is handled safely.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
  loop
    execute format('drop policy %I on public.user_profiles', pol.policyname);
  end loop;
end $$;

-- The single retained policy: read your own approval record, authenticated only.
-- `auth.uid() = id` keeps one user from reading another user's row.
create policy "users_own_profile_select" on public.user_profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- ── Table privileges, established fail-closed ──────────────────────────────────
-- Supabase grants ALL on public tables to `anon` and `authenticated` by default,
-- so RLS was the only thing standing between an anonymous caller and this table.
-- Verified against the live project before this migration: an anonymous
-- `GET /rest/v1/user_profiles` returned HTTP 200 with an empty array — the rows
-- were filtered, but the request was accepted.
--
-- Revoke EVERYTHING first (covers INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER, SELECT and any future privilege type), then grant back the minimum.
revoke all privileges on table public.user_profiles from public, anon, authenticated;

grant select on table public.user_profiles to authenticated;

-- The trusted administrative client keeps full access; it bypasses RLS and is
-- what scripts/admin/provisionUser.ts uses to provision and revoke.
grant all privileges on table public.user_profiles to service_role;

-- ── Column-level privileges ────────────────────────────────────────────────────
-- Column grants live in pg_attribute.attacl and are NOT removed by the table
-- REVOKE above. Strip any that exist for PUBLIC / anon / authenticated.
do $$
declare
  col text;
begin
  for col in
    select att.attname
    from pg_catalog.pg_attribute att
    join pg_catalog.pg_class c on c.oid = att.attrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'user_profiles'
      and att.attnum > 0
      and not att.attisdropped
  loop
    execute format(
      'revoke all privileges (%I) on table public.user_profiles from public, anon, authenticated',
      col
    );
  end loop;
end $$;

-- ── Postconditions — fail loudly if the final state is not exactly as intended ──
do $$
declare
  policy_count int;
  pol          record;
  bad          text;
  priv         text;
  role_name    text;
begin
  -- 1 · Exactly one policy, with the expected name, command, role and predicate.
  select count(*) into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'user_profiles';

  if policy_count <> 1 then
    raise exception 'expected exactly 1 policy on public.user_profiles, found %', policy_count;
  end if;

  select * into pol
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'user_profiles';

  if pol.policyname <> 'users_own_profile_select' then
    raise exception 'unexpected policy name: %', pol.policyname;
  end if;
  if pol.cmd <> 'SELECT' then
    raise exception 'policy must be SELECT-only, found %', pol.cmd;
  end if;
  if pol.roles is distinct from array['authenticated']::name[] then
    raise exception 'policy must apply to {authenticated}, found %', pol.roles;
  end if;
  -- The policy is created without RESTRICTIVE, i.e. permissive by default.
  if pol.permissive <> 'PERMISSIVE' then
    raise exception 'policy must be PERMISSIVE, found %', pol.permissive;
  end if;
  -- Fail closed on a null predicate: `null !~ pattern` is NULL, not true, so a
  -- bare regex test would silently pass a policy with no USING clause at all.
  if pol.qual is null or pol.qual !~ 'auth\.uid\(\)\s*=\s*id' then
    raise exception 'unexpected policy predicate: %', coalesce(pol.qual, '(null)');
  end if;
  if pol.with_check is not null then
    raise exception 'a SELECT policy must carry no WITH CHECK, found %', pol.with_check;
  end if;

  -- 2 · RLS is enabled.
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'user_profiles' and c.relrowsecurity
  ) then
    raise exception 'row level security is not enabled on public.user_profiles';
  end if;

  -- 3 · No table privilege survives for PUBLIC or anon.
  --     aclexplode is used instead of information_schema so the check does not
  --     depend on who the migration runs as. grantee = 0 means PUBLIC.
  select string_agg(distinct a.privilege_type, ', ' order by a.privilege_type) into bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relname = 'user_profiles'
    and (a.grantee = 0 or r.rolname in ('anon'));

  if bad is not null then
    raise exception 'PUBLIC/anon still hold table privileges: %', bad;
  end if;

  -- 4 · authenticated holds exactly SELECT — no REFERENCES, no TRIGGER, no DML.
  select string_agg(distinct a.privilege_type, ', ' order by a.privilege_type) into bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_catalog.pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relname = 'user_profiles' and r.rolname = 'authenticated';

  if bad is distinct from 'SELECT' then
    raise exception 'authenticated privileges = %, expected exactly SELECT', coalesce(bad, '(none)');
  end if;

  -- 5 · No column-level INSERT / UPDATE / REFERENCES for PUBLIC, anon or authenticated.
  select string_agg(distinct att.attname || ':' || a.privilege_type, ', ') into bad
  from pg_catalog.pg_attribute att
  join pg_catalog.pg_class c on c.oid = att.attrelid
  join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(att.attacl) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relname = 'user_profiles'
    and att.attnum > 0 and not att.attisdropped
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
    and a.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES');

  if bad is not null then
    raise exception 'column-level grants survive: %', bad;
  end if;

  -- 6 · service_role retains what provisioning and revocation need.
  select string_agg(distinct a.privilege_type, ', ' order by a.privilege_type) into bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_catalog.pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relname = 'user_profiles' and r.rolname = 'service_role';

  if bad is null or bad !~ 'SELECT' or bad !~ 'INSERT' or bad !~ 'UPDATE' then
    raise exception
      'service_role must retain at least SELECT, INSERT and UPDATE for provisioning; found %',
      coalesce(bad, '(none)');
  end if;

  -- 7 · EFFECTIVE table privileges.
  --     The relacl checks above prove no DIRECT grant exists. They do NOT prove
  --     effective access: a custom parent role could hold UPDATE while
  --     `authenticated` inherits it, and relacl would still read "SELECT only".
  --     has_table_privilege() resolves role membership AND table ownership, so
  --     it is the authoritative answer.
  foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('anon', 'public.user_profiles', priv) then
      raise exception 'anon has EFFECTIVE % on public.user_profiles (inherited or owned)', priv;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.user_profiles', 'SELECT') then
    raise exception 'authenticated must retain effective SELECT — the approval lookup depends on it';
  end if;

  foreach priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.user_profiles', priv) then
      raise exception 'authenticated has EFFECTIVE % on public.user_profiles (inherited or owned)', priv;
    end if;
  end loop;

  -- 8 · EFFECTIVE column privileges, including anything inherited.
  --     has_any_column_privilege() is true if the role holds the privilege on
  --     ANY column, whether granted at table or column level. SELECT is
  --     deliberately excluded for `authenticated` — that one is intentional.
  foreach role_name in array array['anon','authenticated'] loop
    foreach priv in array array['INSERT','UPDATE','REFERENCES'] loop
      -- `role_name` is cast explicitly: the has_*_privilege overloads take the
      -- role as `name`, and passing a declared `text` variable would rely on an
      -- implicit cast during function resolution.
      if has_any_column_privilege(role_name::name, 'public.user_profiles', priv) then
        raise exception '% has EFFECTIVE column-level % on public.user_profiles', role_name, priv;
      end if;
    end loop;
  end loop;

  -- 9 · Ownership. An owner bypasses ordinary object-privilege restrictions, so
  --     an ordinary application role must never own this table. (The checks in
  --     step 7 would also catch this, since has_table_privilege() reports true
  --     for an owner — this assertion just names the problem clearly.)
  select r.rolname into bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
  join pg_catalog.pg_roles r on r.oid = c.relowner
  where ns.nspname = 'public' and c.relname = 'user_profiles';

  if bad in ('anon', 'authenticated') then
    raise exception
      'public.user_profiles is owned by the ordinary application role %; ownership bypasses object privileges', bad;
  end if;

  -- 10 · Role attributes. BYPASSRLS or SUPERUSER on an application role would
  --      make every policy above decorative.
  foreach role_name in array array['anon','authenticated'] loop
    if exists (
      select 1 from pg_catalog.pg_roles
      where rolname = role_name and (rolbypassrls or rolsuper)
    ) then
      raise exception '% must not hold BYPASSRLS or SUPERUSER', role_name;
    end if;
  end loop;

  -- 11 · The administrative path must still be able to bypass RLS, or
  --      provisioning and revocation would be blocked by the very policy above.
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'service_role' and (rolbypassrls or rolsuper)
  ) then
    raise exception
      'service_role must retain BYPASSRLS (or SUPERUSER) — scripts/admin/provisionUser.ts depends on it';
  end if;
end $$;

-- ── Documentation of intent, stored with the table ─────────────────────────────
comment on table public.user_profiles is
  'TEMPORARY administrator-controlled access boundary for Nevada Market Intelligence. '
  'Row presence + a non-null `username` is the approval marker read on every private '
  'request (src/lib/auth/approval.ts). Writes are service-role only — provision and '
  'revoke via scripts/admin/provisionUser.ts. Do not add a self-service INSERT or '
  'UPDATE policy, and do not grant anon or authenticated any privilege beyond SELECT. '
  'See docs/security_access_control.md.';

comment on column public.user_profiles.username is
  'Approval marker. Non-null = approved for the platform; null or absent = denied on '
  'the next request. Administrator-controlled (service-role writes only).';
