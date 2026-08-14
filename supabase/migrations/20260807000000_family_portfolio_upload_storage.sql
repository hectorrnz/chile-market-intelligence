-- R13.2 — Family Portfolio upload and storage foundation.
--
-- Creates the upload spine (doc 05 § 5.1) and its validation-findings table
-- (doc 05 § 5.5), plus the PRIVATE storage bucket and service-role-only
-- storage policies (doc 05 § 3).
--
-- Forward-only and idempotent, in the style of
-- 20260806000000_family_portfolio_entitlements.sql. Every guarantee is
-- re-asserted at the end by postcondition blocks that `raise exception` rather
-- than trusting that the statements above did what they claim.
--
-- POSTURE, restated because it is the whole point of this migration:
--   * `authenticated` may READ upload metadata only if it is an administrator,
--     resolved through the R13.1 helper `public.nmi_is_administrator()`.
--   * There is deliberately NO insert/update/delete policy for `authenticated`
--     on either table. Every write is service-role, performed by the upload
--     pipeline AFTER a server-side administrator check.
--   * The storage bucket is PRIVATE and carries NO `authenticated` policy at
--     all. Objects are reachable only through a server-minted signed URL.
--
-- NOTHING here stores a financial value. These tables hold provenance: an
-- opaque object key, a digest, a size, a status, and code-derived findings.

-- ── Guard: R13.1 must already be applied ──────────────────────────────────────
-- This migration depends on the administrator helper. Failing loudly here is far
-- better than creating tables whose policies silently reference a missing
-- function.
do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'public.user_profiles is missing — apply the core migrations before R13.2';
  end if;
  if to_regprocedure('public.nmi_is_administrator()') is null then
    raise exception 'public.nmi_is_administrator() is missing — apply the R13.1 entitlement migration before R13.2';
  end if;
end $$;

-- ── 1. Upload spine (doc 05 § 5.1) ────────────────────────────────────────────
--
-- `storage_object_path` is the OPAQUE key (doc 05 § 3.2): <kind>/<yyyy>/<uuid>.xlsx.
-- It deliberately carries no original filename, principal name, portfolio date,
-- or financial hint, because object keys leak through logs, error messages and
-- signed URLs. The human-readable name lives in `original_filename`, sanitized.
--
-- `unique (upload_kind, file_sha256)` is doc 05 § 4 check 13: the same workbook
-- cannot be silently ingested twice for the same kind. The identical bytes MAY
-- legitimately appear under the other kind, so the digest is scoped by kind
-- rather than made globally unique.
create table if not exists public.portfolio_source_uploads (
  id                   uuid primary key default gen_random_uuid(),
  upload_kind          text        not null check (upload_kind in ('portfolio', 'alternatives')),
  storage_object_path  text        not null,
  original_filename    text        not null,
  file_sha256          text        not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes      bigint      not null check (file_size_bytes > 0),
  uploaded_by          uuid        not null references auth.users(id) on delete restrict,
  uploaded_at          timestamptz not null default now(),
  parser_version       text        not null,
  status               text        not null default 'received'
                                   check (status in ('received', 'parsing', 'draft', 'blocked',
                                                     'published', 'superseded', 'rolled_back')),
  detected_as_of_date  date,
  confirmed_as_of_date date,
  date_override_note   text,
  metadata             jsonb       not null default '{}'::jsonb,
  constraint portfolio_source_uploads_kind_sha_key unique (upload_kind, file_sha256),
  -- Doc 05 § 5.1: an administrator overriding the detected date must say why.
  -- Enforced by the database so no code path can bypass it.
  constraint portfolio_source_uploads_override_note_check check (
    confirmed_as_of_date is null
    or detected_as_of_date is null
    or confirmed_as_of_date = detected_as_of_date
    or (date_override_note is not null and length(btrim(date_override_note)) > 0)
  )
);

create index if not exists portfolio_source_uploads_kind_uploaded_idx
  on public.portfolio_source_uploads (upload_kind, uploaded_at desc);

create index if not exists portfolio_source_uploads_status_idx
  on public.portfolio_source_uploads (status);

comment on table public.portfolio_source_uploads is
  'R13.2 — Family Portfolio source workbook uploads. Provenance only: opaque storage key, SHA-256, '
  'size, status and dates. Contains no financial value and no cell content. Service-role writes only; '
  'administrators may read.';

comment on column public.portfolio_source_uploads.storage_object_path is
  'Opaque storage key <upload_kind>/<yyyy>/<uuid>.xlsx (doc 05 section 3.2). Never contains the '
  'original filename, a principal name, a portfolio date, or any financial hint.';

-- ── 2. Validation findings (doc 05 § 5.5) ─────────────────────────────────────
--
-- `detail` is a CODE-DERIVED message. It must never hold a raw cell value or an
-- amount — that rule is enforced in the application layer and restated here so
-- the constraint is visible to anyone reading the schema.
create table if not exists public.portfolio_upload_findings (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid        not null references public.portfolio_source_uploads(id) on delete cascade,
  severity      text        not null check (severity in ('blocking', 'warning', 'info')),
  code          text        not null,
  scope         text        check (scope in ('main', 'jaime', 'andres', 'pablo', 'alternatives')),
  source_sheet  text,
  source_cell   text,
  row_label     text,
  detail        text        not null,
  created_at    timestamptz not null default now()
);

create index if not exists portfolio_upload_findings_upload_idx
  on public.portfolio_upload_findings (upload_id, severity);

comment on table public.portfolio_upload_findings is
  'R13.2 — structured validation findings for a source upload. `detail` is a code-derived message, '
  'never a raw cell value or amount. Service-role writes only; administrators may read.';

-- ── 3. RLS — administrator read, service-role write ───────────────────────────
alter table public.portfolio_source_uploads  enable row level security;
alter table public.portfolio_upload_findings enable row level security;

-- Complete policy reset, enumerated from pg_policies so a hand-added permissive
-- policy under any other name cannot survive a re-run.
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('portfolio_source_uploads', 'portfolio_upload_findings')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- SELECT only, administrators only. No insert/update/delete policy exists for
-- `authenticated` on either table — writes are service-role, so an
-- administrator cannot rewrite an upload record through the API either.
create policy "portfolio_source_uploads_admin_select"
  on public.portfolio_source_uploads
  for select
  to authenticated
  using (public.nmi_is_administrator());

create policy "portfolio_upload_findings_admin_select"
  on public.portfolio_upload_findings
  for select
  to authenticated
  using (public.nmi_is_administrator());

revoke all privileges on table public.portfolio_source_uploads  from public, anon, authenticated;
revoke all privileges on table public.portfolio_upload_findings from public, anon, authenticated;
grant select on table public.portfolio_source_uploads  to authenticated;
grant select on table public.portfolio_upload_findings to authenticated;
grant all privileges on table public.portfolio_source_uploads  to service_role;
grant all privileges on table public.portfolio_upload_findings to service_role;

-- ── 4. Private storage bucket (doc 05 § 3) ────────────────────────────────────
--
-- Guarded on the storage schema existing so the migration still applies in an
-- environment where the storage service is not provisioned. Where storage IS
-- present (local, CI and production), the bucket is created private and every
-- pre-existing policy on it is removed — leaving NO policy for `authenticated`,
-- which is what makes the bucket unreachable except through a server-minted
-- signed URL.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present — skipping bucket creation (policies are asserted only where storage exists)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('portfolio-source-uploads', 'portfolio-source-uploads', false)
  on conflict (id) do update set public = false;
end $$;

do $$
declare
  pol record;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  -- Remove any policy that mentions this bucket, under any name. We never
  -- assume the only policies present are ones we created.
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') like '%portfolio-source-uploads%'
           or coalesce(with_check, '') like '%portfolio-source-uploads%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- ── 5. Postconditions — assert the end state, never assume it ─────────────────

-- 5a. Tables, constraints and defaults.
do $$
declare
  def text;
begin
  if to_regclass('public.portfolio_source_uploads') is null then
    raise exception 'portfolio_source_uploads was not created';
  end if;
  if to_regclass('public.portfolio_upload_findings') is null then
    raise exception 'portfolio_upload_findings was not created';
  end if;

  -- The SHA-256 uniqueness is check 13; without it a duplicate workbook could
  -- be ingested twice and silently republished.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'portfolio_source_uploads_kind_sha_key' and contype = 'u'
  ) then
    raise exception 'the (upload_kind, file_sha256) uniqueness constraint is missing — duplicate detection would not hold';
  end if;

  select pg_get_constraintdef(oid) into def
  from pg_catalog.pg_constraint
  where conname = 'portfolio_source_uploads_override_note_check';
  if def is null then
    raise exception 'the date-override note constraint is missing — an override could be recorded without a reason';
  end if;

  -- The status vocabulary drives the whole publication lifecycle (doc 05 § 6).
  select pg_get_constraintdef(oid) into def
  from pg_catalog.pg_constraint
  where conrelid = 'public.portfolio_source_uploads'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';
  if def is null or def not like '%blocked%' or def not like '%published%' then
    raise exception 'the upload status CHECK does not cover the documented lifecycle: %', coalesce(def, '(null)');
  end if;
end $$;

-- 5b. RLS is on, the policy set is exactly what we created, and it is read-only.
do $$
declare
  t    text;
  bad  text;
  n    int;
begin
  foreach t in array array['portfolio_source_uploads', 'portfolio_upload_findings'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'row level security is not enabled on %', t;
    end if;

    -- Exactly one policy, and it must be SELECT. Any write policy for
    -- `authenticated` would break the service-role-write posture.
    select string_agg(policyname || ':' || cmd, ', ' order by policyname)
      into bad
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t;

    select count(*) into n
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = t;

    if n <> 1 then
      raise exception 'unexpected policy set on %: %', t, coalesce(bad, '(none)');
    end if;

    if exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = t and cmd <> 'SELECT'
    ) then
      raise exception 'a non-SELECT policy exists on % — writes must remain service-role only: %', t, bad;
    end if;
  end loop;
end $$;

-- 5c. Effective privileges. `has_table_privilege` is used rather than reading
-- the grant catalogue, so an inherited or column-level grant cannot hide.
do $$
declare
  t    text;
  priv text;
begin
  foreach t in array array['portfolio_source_uploads', 'portfolio_upload_findings'] loop
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('authenticated', format('public.%I', t), priv) then
        raise exception 'authenticated holds EFFECTIVE % on % — writes must be service-role only', priv, t;
      end if;
    end loop;

    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', format('public.%I', t), priv) then
        raise exception 'anon holds EFFECTIVE % on %', priv, t;
      end if;
    end loop;

    -- The administrator read path depends on this remaining granted; the POLICY
    -- (not the grant) is what restricts it to administrators.
    if not has_table_privilege('authenticated', format('public.%I', t), 'SELECT') then
      raise exception 'authenticated lost SELECT on % — the administrator read path depends on it', t;
    end if;

    if not has_table_privilege('service_role', format('public.%I', t), 'INSERT') then
      raise exception 'service_role cannot INSERT into % — the upload pipeline would fail closed', t;
    end if;
  end loop;
end $$;

-- 5d. Storage: the bucket exists, is PRIVATE, and carries no policy at all.
do $$
declare
  is_public boolean;
  leftover  text;
begin
  if to_regclass('storage.buckets') is null then
    return; -- storage not provisioned in this environment; nothing to assert
  end if;

  select public into is_public from storage.buckets where id = 'portfolio-source-uploads';
  if is_public is null then
    raise exception 'the portfolio-source-uploads bucket was not created';
  end if;
  if is_public then
    raise exception 'the portfolio-source-uploads bucket is PUBLIC — it must never be publicly readable';
  end if;

  if to_regclass('storage.objects') is not null then
    select string_agg(policyname, ', ') into leftover
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (coalesce(qual, '') like '%portfolio-source-uploads%'
           or coalesce(with_check, '') like '%portfolio-source-uploads%');
    if leftover is not null then
      raise exception 'a storage.objects policy references portfolio-source-uploads: % — access must be service-role only', leftover;
    end if;
  end if;
end $$;

-- 5e. R13.1 is untouched. R13.2 adds tables; it must not have altered the
-- entitlement posture it depends on.
do $$
begin
  if not has_table_privilege('authenticated', 'public.user_profiles', 'SELECT') then
    raise exception 'authenticated lost SELECT on user_profiles — R13.2 must not alter the R13.1 posture';
  end if;
  if has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') then
    raise exception 'authenticated gained UPDATE on user_profiles — self-elevation must remain impossible';
  end if;
end $$;
