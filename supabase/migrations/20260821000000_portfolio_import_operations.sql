-- R13.8B § 7/§ 8 — one import operation owns every mutation a workbook makes.
--
-- FORWARD-ONLY and ADDITIVE. No existing migration is edited, no existing
-- column is dropped or retyped, and no existing function's behaviour changes.
--
-- WHY THIS EXISTS
--
-- A catch-up workbook can carry several unpublished frozen weeks at once. The
-- locked rule is that all of them import, atomically, alongside ONE current
-- publication dated at the newest valid frozen reporting date — and that a
-- rollback reverses every one of those mutations together.
--
-- The shipped schema cannot express that. `portfolio_evolution_observations`
-- records only `source_upload_id`, keeps no before-image, and is written by a
-- chunked best-effort upsert AFTER the publication has already committed.
-- `nmi_rollback_publication` never touches it. So today a three-week catch-up
-- can half-land, and nothing can put it back.
--
-- THE SMALLEST CHANGE THAT FIXES IT is two tables and one column:
--
--   * `portfolio_import_operations` — the durable identity of one import. It
--     names the upload, the publication it made current, and the publication it
--     displaced, so the history and the publication are reversed as one unit.
--   * `portfolio_import_observation_mutations` — a per-identity BEFORE-IMAGE.
--     An insertion records no prior state (that IS the record that it was an
--     insertion); an overwrite records the exact prior value and status. This is
--     what makes rollback exact.
--   * `portfolio_evolution_observations.import_operation_id` — a forward
--     pointer to the import that last wrote each row. Not strictly required to
--     reverse an import, but it is what lets a rollback REFUSE when a later
--     import has already moved the row on. Without it a stale rollback would
--     silently clobber the newer import's work.
--
-- ROLLBACK NEVER MATCHES ON A DATE OR A FILENAME. Every reversal is driven by
-- the canonical identity (scope, basis, series identity, observation date)
-- recorded against a specific import id.
--
-- DELETION, DELIBERATELY AND NARROWLY. R13's standing rule is that a
-- publication is never deleted — a rollback demotes and re-promotes, and this
-- migration keeps that exactly. But the inverse of INSERTING a history point is
-- REMOVING it, so rolling back a `new` or `gap_fill` observation does delete
-- that row. Nothing is lost from the audit trail: the mutation ledger retains
-- the identity, the value and the import that wrote it, permanently.

-- ── Guard: the R13.5 publication and R13.R1 history migrations must be applied ─
do $$
begin
  if to_regclass('public.portfolio_publications') is null then
    raise exception 'public.portfolio_publications is missing — apply the R13.5 publication migration first';
  end if;
  if to_regclass('public.portfolio_evolution_observations') is null then
    raise exception 'public.portfolio_evolution_observations is missing — apply the R13.R1 history migration first';
  end if;
  if to_regprocedure('public.nmi_publish_portfolio(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)') is null then
    raise exception 'public.nmi_publish_portfolio is missing — apply the R13.5 publication migration first';
  end if;
end $$;

-- ── 1. The import operation ──────────────────────────────────────────────────
create table if not exists public.portfolio_import_operations (
  id                       uuid primary key default gen_random_uuid(),
  upload_id                uuid not null references public.portfolio_source_uploads(id) on delete restrict,
  upload_kind              text not null check (upload_kind in ('portfolio','alternatives')),
  -- The planner version that produced this import's classification. A published
  -- week states which contract read it; an import states which planner sorted it.
  plan_version             text not null,
  -- The newest valid FROZEN reporting date — the one date the current
  -- publication carries. Intermediate weeks contribute history points, never
  -- revisions of their own.
  as_of_date               date not null,
  publication_id           uuid references public.portfolio_publications(id) on delete restrict,
  -- The publication that was current for `as_of_date` before this import.
  -- NULL means there was none, and a rollback therefore promotes nothing —
  -- the week simply stops being current, which the partial index permits.
  previous_publication_id  uuid references public.portfolio_publications(id) on delete restrict,
  counts                   jsonb not null default '{}'::jsonb,
  correction_authorized    boolean not null default false,
  correction_reason        text,
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  rolled_back_at           timestamptz,
  rolled_back_by           uuid references auth.users(id) on delete set null,
  rollback_note            text,
  metadata                 jsonb not null default '{}'::jsonb,
  -- An authorized correction must carry a non-empty reason. The planner enforces
  -- this too; enforcing it here as well means no code path can bypass it.
  constraint portfolio_import_operations_reason_ck check (
    correction_authorized = false
    or (correction_reason is not null and length(btrim(correction_reason)) > 0)
  ),
  -- A rollback stamps both columns or neither.
  constraint portfolio_import_operations_rollback_ck check (
    (rolled_back_at is null and rolled_back_by is null)
    or rolled_back_at is not null
  )
);

create index if not exists portfolio_import_operations_upload_idx
  on public.portfolio_import_operations (upload_id);
create index if not exists portfolio_import_operations_date_idx
  on public.portfolio_import_operations (upload_kind, as_of_date desc);
create index if not exists portfolio_import_operations_publication_idx
  on public.portfolio_import_operations (publication_id);

-- ── 2. The before-image ledger ───────────────────────────────────────────────
create table if not exists public.portfolio_import_observation_mutations (
  id                   uuid primary key default gen_random_uuid(),
  import_operation_id  uuid not null references public.portfolio_import_operations(id) on delete cascade,
  -- The canonical identity. `series_identity` defaults to '' so today's
  -- (scope, basis, date) key is unchanged, while a future second series sharing
  -- a scope and basis remains expressible without another migration.
  scope                text not null,
  basis                text not null,
  series_identity      text not null default '',
  observation_date     date not null,
  disposition          text not null check (disposition in ('new','gap_fill','changed')),
  prior_value          numeric,
  prior_status         text check (prior_status in ('stated','unavailable')),
  -- WHICH import last wrote the row this one is about to overwrite.
  --
  -- Without it, rolling back import B would leave the row's lineage NULL, and a
  -- later rollback of import A — which legitimately wrote it first — would then
  -- refuse, believing something else had moved it on. Restoring the pointer as
  -- well as the value is what makes rollbacks chain correctly. NULL is a real
  -- answer here: rows written before this migration carry no import id.
  prior_import_operation_id uuid references public.portfolio_import_operations(id) on delete restrict,
  new_value            numeric,
  new_status           text not null check (new_status in ('stated','unavailable')),
  created_at           timestamptz not null default now(),
  constraint portfolio_import_observation_mutations_key
    unique (import_operation_id, scope, basis, series_identity, observation_date),
  -- An INSERTION has no before-image; an OVERWRITE must have one. A `changed`
  -- row without a prior status would be a rollback that could only guess.
  constraint portfolio_import_observation_mutations_before_ck check (
    (disposition in ('new','gap_fill') and prior_status is null and prior_value is null)
    or (disposition = 'changed' and prior_status is not null)
  ),
  -- Status and value must agree, in both images. `unavailable` is never a
  -- number, and `stated` is never the absence of one.
  constraint portfolio_import_observation_mutations_new_state_ck check (
    (new_status = 'stated' and new_value is not null)
    or (new_status = 'unavailable' and new_value is null)
  ),
  constraint portfolio_import_observation_mutations_prior_state_ck check (
    prior_status is null
    or (prior_status = 'stated' and prior_value is not null)
    or (prior_status = 'unavailable' and prior_value is null)
  )
);

create index if not exists portfolio_import_observation_mutations_op_idx
  on public.portfolio_import_observation_mutations (import_operation_id);
create index if not exists portfolio_import_observation_mutations_identity_idx
  on public.portfolio_import_observation_mutations
     (scope, basis, series_identity, observation_date);

-- ── 3. Forward lineage on the history rows ───────────────────────────────────
-- `on delete restrict`: an import operation that wrote history is a permanent
-- audit record and must not be removable while its rows stand.
alter table public.portfolio_evolution_observations
  add column if not exists import_operation_id uuid
    references public.portfolio_import_operations(id) on delete restrict;

create index if not exists portfolio_evolution_observations_import_idx
  on public.portfolio_evolution_observations (import_operation_id);

-- ── 4. RLS — service-role only ───────────────────────────────────────────────
--
-- Neither table is read through a member session. The whole publication admin
-- surface already reads via the service-role client behind a server-side
-- administrator entitlement check, and the mutation ledger carries portfolio
-- VALUES, so exposing it to `authenticated` would bypass the scope filter that
-- guards every other table holding them.
alter table public.portfolio_import_operations enable row level security;
alter table public.portfolio_import_observation_mutations enable row level security;

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array[
    'portfolio_import_operations',
    'portfolio_import_observation_mutations'
  ] loop
    for pol in
      select policyname from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

revoke all privileges on table public.portfolio_import_operations
  from public, anon, authenticated;
revoke all privileges on table public.portfolio_import_observation_mutations
  from public, anon, authenticated;
grant all privileges on table public.portfolio_import_operations to service_role;
grant all privileges on table public.portfolio_import_observation_mutations to service_role;

-- ── 5. Serialising every import ──────────────────────────────────────────────
--
-- The publication lock is keyed on ONE (kind, as_of_date) series, but an import
-- mutates history across MANY dates. A per-date lock would therefore let two
-- imports interleave over the same history. An import is a whole-book operation
-- and they are rare — weekly, administrator-driven — so one transaction-scoped
-- lock for the whole import path is both correct and cheap.
create or replace function public.nmi_lock_portfolio_import(p_kind text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nmi_portfolio_import'),
    pg_catalog.hashtext(p_kind));
end $$;

-- ── 6. The import transaction ────────────────────────────────────────────────
--
-- ONE operation: the publication (delegated verbatim to `nmi_publish_portfolio`
-- so the two paths can never drift), plus every history mutation, plus the
-- audit record. All of it commits or none of it does.
--
-- THE PACKET ASSERTS ITS OWN PRE-STATE, exactly as the structured-notes
-- reconciliation RPC does. Every mutation states what it believes Production
-- currently holds; the function verifies that under lock and refuses the whole
-- import if any identity has moved. A plan built against state that has since
-- changed is refused, never partially adapted — and the before-image written to
-- the ledger is the one READ HERE, never the one the caller supplied.
create or replace function public.nmi_import_portfolio_workbook(
  p_upload_id             uuid,
  p_as_of_date            date,
  p_published_by          uuid,
  p_parser_version        text,
  p_plan_version          text,
  p_rows                  jsonb,
  p_observations          jsonb   default '[]'::jsonb,
  p_performance           jsonb   default '[]'::jsonb,
  p_correction_authorized boolean default false,
  p_correction_reason     text    default null,
  p_counts                jsonb   default '{}'::jsonb,
  p_admin_note            text    default null,
  p_metadata              jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_op_id     uuid := gen_random_uuid();
  v_pub_id    uuid;
  v_prev_pub  uuid;
  v_reason    text := nullif(btrim(coalesce(p_correction_reason, '')), '');
  m           record;
  v_cur_value numeric;
  v_cur_import uuid;
  v_cur_found boolean;
  v_inserted  int := 0;
  v_updated   int := 0;
begin
  -- Serialise the whole import path before reading anything it will assert on.
  perform public.nmi_lock_portfolio_import('portfolio');

  if p_observations is null or jsonb_typeof(p_observations) <> 'array' then
    raise exception 'import_refused_invalid_observations';
  end if;

  -- An overwrite anywhere in the packet requires authorization AND a reason.
  -- Insertions never do, however many of them there are.
  if exists (
    select 1 from jsonb_to_recordset(p_observations) as o(disposition text)
     where o.disposition = 'changed'
  ) then
    if not coalesce(p_correction_authorized, false) or v_reason is null then
      raise exception 'import_refused_historical_correction_required';
    end if;
  end if;

  -- The evolution series models a gap as an ABSENT ROW, never a stored
  -- `unavailable` (R13.R1). Refuse loudly rather than coerce an unavailable
  -- state into a NOT NULL numeric column.
  if exists (
    select 1 from jsonb_to_recordset(p_observations) as o(new_status text)
     where o.new_status is distinct from 'stated'
  ) then
    raise exception 'import_refused_unavailable_not_representable';
  end if;

  -- Capture the publication this import will displace BEFORE publishing, since
  -- `nmi_publish_portfolio` demotes it on the way through.
  select id into v_prev_pub
    from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = p_as_of_date and is_current;

  insert into public.portfolio_import_operations
    (id, upload_id, upload_kind, plan_version, as_of_date, previous_publication_id,
     counts, correction_authorized, correction_reason, created_by, metadata)
  values
    (v_op_id, p_upload_id, 'portfolio', p_plan_version, p_as_of_date, v_prev_pub,
     coalesce(p_counts, '{}'::jsonb), coalesce(p_correction_authorized, false), v_reason,
     p_published_by, coalesce(p_metadata, '{}'::jsonb));

  -- The publication, unchanged. Every refusal it raises — blocking findings,
  -- nothing to publish, duplicate submission — aborts this whole transaction.
  v_pub_id := public.nmi_publish_portfolio(
    p_upload_id, p_as_of_date, p_published_by, p_parser_version,
    p_rows, p_performance, p_admin_note,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('importOperationId', v_op_id::text));

  update public.portfolio_import_operations
     set publication_id = v_pub_id
   where id = v_op_id;

  -- History mutations, each asserting its own pre-state under the lock.
  for m in
    select * from jsonb_to_recordset(p_observations) as o(
      scope text, basis text, series_identity text, observation_date date,
      disposition text, new_value numeric, new_status text,
      prior_value numeric, prior_status text,
      source_sheet text, source_cell text, source_row_label text,
      currency text, parser_version text, extractor_version text)
  loop
    if m.disposition not in ('new','gap_fill','changed') then
      raise exception 'import_refused_unknown_disposition';
    end if;

    select o.value, o.import_operation_id into v_cur_value, v_cur_import
      from public.portfolio_evolution_observations o
     where o.scope = m.scope
       and o.basis = m.basis
       and o.observation_date = m.observation_date
     for update;

    -- `FOUND` rather than a sentinel: a row whose `import_operation_id` is
    -- legitimately NULL must not read as "no row".
    v_cur_found := found;

    if m.disposition in ('new','gap_fill') then
      if v_cur_found then
        -- The identity exists after all: the plan is stale, or this is an
        -- overwrite mislabelled as an insertion. Either way, refuse whole.
        raise exception 'import_refused_stale_plan_identity_exists';
      end if;

      insert into public.portfolio_evolution_observations
        (scope, basis, observation_date, value, currency, source_upload_id,
         source_sheet, source_cell, source_row_label, parser_version,
         extractor_version, ingested_by, import_operation_id)
      values
        (m.scope, m.basis, m.observation_date, m.new_value, coalesce(m.currency, 'USD'),
         p_upload_id, m.source_sheet, m.source_cell, m.source_row_label,
         m.parser_version, m.extractor_version, p_published_by, v_op_id);
      v_inserted := v_inserted + 1;
    else
      if not v_cur_found then
        raise exception 'import_refused_stale_plan_identity_absent';
      end if;
      -- The caller asserted what it believed Production held. If that has moved,
      -- the diff an administrator approved is not the diff about to be applied.
      if m.prior_value is distinct from v_cur_value then
        raise exception 'import_refused_stale_plan_value_moved';
      end if;

      update public.portfolio_evolution_observations
         set value = m.new_value,
             currency = coalesce(m.currency, currency),
             source_upload_id = p_upload_id,
             source_sheet = m.source_sheet,
             source_cell = m.source_cell,
             source_row_label = m.source_row_label,
             parser_version = m.parser_version,
             extractor_version = m.extractor_version,
             ingested_by = p_published_by,
             ingested_at = now(),
             import_operation_id = v_op_id
       where scope = m.scope
         and basis = m.basis
         and observation_date = m.observation_date;
      v_updated := v_updated + 1;
    end if;

    -- The before-image is the state READ HERE, not the state the caller claimed.
    insert into public.portfolio_import_observation_mutations
      (import_operation_id, scope, basis, series_identity, observation_date,
       disposition, prior_value, prior_status, prior_import_operation_id,
       new_value, new_status)
    values
      (v_op_id, m.scope, m.basis, coalesce(m.series_identity, ''), m.observation_date,
       m.disposition,
       case when m.disposition = 'changed' then v_cur_value else null end,
       case when m.disposition = 'changed' then 'stated' else null end,
       case when m.disposition = 'changed' then v_cur_import else null end,
       m.new_value, 'stated');
  end loop;

  return jsonb_build_object(
    'importOperationId', v_op_id,
    'publicationId', v_pub_id,
    'previousPublicationId', v_prev_pub,
    'inserted', v_inserted,
    'updated', v_updated);
end $$;

-- ── 7. Reversing an import ───────────────────────────────────────────────────
--
-- The exact inverse. Insertions are removed, overwrites are restored to their
-- recorded before-image, and the publication this import made current is
-- demoted while the one it displaced — if any — is promoted back.
--
-- IT REFUSES A STALE ROLLBACK. If a later import has already rewritten one of
-- these rows, reversing to this import's before-image would clobber that later
-- import's work. `import_operation_id` on the row makes that check exact rather
-- than a heuristic on dates.
create or replace function public.nmi_rollback_portfolio_import(
  p_import_id uuid,
  p_actor_id  uuid,
  p_note      text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_op        record;
  m           record;
  v_removed   int := 0;
  v_restored  int := 0;
begin
  perform public.nmi_lock_portfolio_import('portfolio');

  select * into v_op from public.portfolio_import_operations where id = p_import_id;
  if not found then
    raise exception 'rollback_refused_import_not_found';
  end if;
  if v_op.rolled_back_at is not null then
    raise exception 'rollback_refused_already_rolled_back';
  end if;

  -- Every row this import wrote must still belong to it.
  if exists (
    select 1
      from public.portfolio_import_observation_mutations mm
      join public.portfolio_evolution_observations o
        on o.scope = mm.scope
       and o.basis = mm.basis
       and o.observation_date = mm.observation_date
     where mm.import_operation_id = p_import_id
       and o.import_operation_id is distinct from p_import_id
  ) then
    raise exception 'rollback_refused_superseded_by_later_import';
  end if;

  -- And the publication it made current must still be current.
  if v_op.publication_id is not null and not exists (
    select 1 from public.portfolio_publications
     where id = v_op.publication_id and is_current
  ) then
    raise exception 'rollback_refused_publication_not_current';
  end if;

  for m in
    select * from public.portfolio_import_observation_mutations
     where import_operation_id = p_import_id
  loop
    if m.disposition in ('new','gap_fill') then
      delete from public.portfolio_evolution_observations
       where scope = m.scope
         and basis = m.basis
         and observation_date = m.observation_date
         and import_operation_id = p_import_id;
      v_removed := v_removed + 1;
    else
      -- Restore the VALUE and the LINEAGE together. Leaving the pointer NULL
      -- would make a later rollback of whichever import wrote this row first
      -- refuse, believing something else had moved it on.
      update public.portfolio_evolution_observations
         set value = m.prior_value,
             import_operation_id = m.prior_import_operation_id,
             ingested_at = now()
       where scope = m.scope
         and basis = m.basis
         and observation_date = m.observation_date;
      v_restored := v_restored + 1;
    end if;
  end loop;

  -- Demote before promote, for the partial unique index — the same ordering
  -- `nmi_rollback_publication` uses. NOTHING IS DELETED here: the demoted
  -- revision keeps its rows and can be rolled forward again. When there is no
  -- predecessor, the week simply stops being current, which the partial index
  -- permits (it tolerates zero current rows, never two).
  if v_op.publication_id is not null then
    update public.portfolio_publications
       set is_current = false, superseded_by = null
     where id = v_op.publication_id;
  end if;

  if v_op.previous_publication_id is not null then
    update public.portfolio_publications
       set is_current = true,
           superseded_by = null,
           metadata = metadata || jsonb_build_object(
             'rolledBackImport', p_import_id::text,
             'rolledBackBy', p_actor_id::text)
     where id = v_op.previous_publication_id;
  end if;

  update public.portfolio_import_operations
     set rolled_back_at = now(),
         rolled_back_by = p_actor_id,
         rollback_note = p_note
   where id = p_import_id;

  if v_op.upload_id is not null then
    perform public.nmi_sync_upload_status(v_op.upload_id);
  end if;

  return jsonb_build_object(
    'importOperationId', p_import_id,
    'observationsRemoved', v_removed,
    'observationsRestored', v_restored,
    'promotedPublicationId', v_op.previous_publication_id);
end $$;

-- ── 8. Grants ────────────────────────────────────────────────────────────────
-- SECURITY INVOKER, executable only by `service_role`, which already holds
-- every privilege these writes need and bypasses RLS. A DEFINER function would
-- be standing privilege escalation bought for nothing.
revoke all on function public.nmi_lock_portfolio_import(text) from public, anon, authenticated;
revoke all on function public.nmi_import_portfolio_workbook(
  uuid, date, uuid, text, text, jsonb, jsonb, jsonb, boolean, text, jsonb, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.nmi_rollback_portfolio_import(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.nmi_lock_portfolio_import(text) to service_role;
grant execute on function public.nmi_import_portfolio_workbook(
  uuid, date, uuid, text, text, jsonb, jsonb, jsonb, boolean, text, jsonb, text, jsonb)
  to service_role;
grant execute on function public.nmi_rollback_portfolio_import(uuid, uuid, text) to service_role;

-- ── 9. Postconditions ────────────────────────────────────────────────────────

-- 9a. Both tables, the lineage column and every index exist.
do $$
begin
  if to_regclass('public.portfolio_import_operations') is null then
    raise exception 'portfolio_import_operations was not created';
  end if;
  if to_regclass('public.portfolio_import_observation_mutations') is null then
    raise exception 'portfolio_import_observation_mutations was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'portfolio_evolution_observations'
       and column_name = 'import_operation_id'
  ) then
    raise exception 'portfolio_evolution_observations.import_operation_id is missing — rollback could not tell an import''s rows from a later one''s';
  end if;
end $$;

-- 9b. The before-image constraint is the load-bearing one: without it a
--     `changed` row could be recorded with no prior state, and its rollback
--     could only guess.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'portfolio_import_observation_mutations_before_ck'
       and conrelid = 'public.portfolio_import_observation_mutations'::regclass
  ) then
    raise exception 'the before-image CHECK is missing — rollback of a correction could not be exact';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'portfolio_import_observation_mutations_key'
       and conrelid = 'public.portfolio_import_observation_mutations'::regclass
  ) then
    raise exception 'the (import, identity) uniqueness constraint is missing — one import could record two before-images for one identity';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'portfolio_import_operations_reason_ck'
       and conrelid = 'public.portfolio_import_operations'::regclass
  ) then
    raise exception 'the correction-reason CHECK is missing — an authorized correction could be recorded with no reason';
  end if;
end $$;

-- 9c. RLS is on and no non-service role holds any privilege on either table.
do $$
declare
  tbl  text;
  priv text;
  v_rls boolean;
  v_pol int;
begin
  foreach tbl in array array[
    'portfolio_import_operations',
    'portfolio_import_observation_mutations'
  ] loop
    select c.relrowsecurity into v_rls
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = tbl;
    if not coalesce(v_rls, false) then
      raise exception 'row level security is not enabled on %', tbl;
    end if;

    select count(*) into v_pol from pg_catalog.pg_policies
     where schemaname = 'public' and tablename = tbl;
    if v_pol > 0 then
      raise exception '% must have no policy — it is service-role only', tbl;
    end if;

    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('authenticated', 'public.' || tbl, priv) then
        raise exception 'authenticated must not hold % on %', priv, tbl;
      end if;
      if has_table_privilege('anon', 'public.' || tbl, priv) then
        raise exception 'anon must not hold % on %', priv, tbl;
      end if;
    end loop;
  end loop;
end $$;

-- 9d. Both functions exist, are SECURITY INVOKER, pin `search_path`, and take
--     the import lock. A function that skipped the lock would look correct and
--     silently fail to serialise against the others.
do $$
declare
  fn  text;
  sig text;
  src text;
  sec boolean;
  cfg text[];
begin
  foreach sig in array array[
    'public.nmi_import_portfolio_workbook(uuid,date,uuid,text,text,jsonb,jsonb,jsonb,boolean,text,jsonb,text,jsonb)',
    'public.nmi_rollback_portfolio_import(uuid,uuid,text)'
  ] loop
    if to_regprocedure(sig) is null then
      raise exception '% was not created', sig;
    end if;
    select p.prosrc, p.prosecdef, p.proconfig into src, sec, cfg
      from pg_catalog.pg_proc p
     where p.oid = to_regprocedure(sig);
    if sec then
      raise exception '% must be SECURITY INVOKER', sig;
    end if;
    if cfg is null or not exists (
      select 1 from unnest(cfg) c where c like 'search\_path=%'
    ) then
      raise exception '% must pin search_path', sig;
    end if;
    if src not like '%nmi_lock_portfolio_import%' then
      raise exception '% does not take the import lock', sig;
    end if;
  end loop;

  -- And rollback must be driven by the mutation ledger, never by a filename.
  select p.prosrc into src
    from pg_catalog.pg_proc p
   where p.oid = to_regprocedure('public.nmi_rollback_portfolio_import(uuid,uuid,text)');
  if src not like '%portfolio_import_observation_mutations%' then
    raise exception 'rollback does not read the before-image ledger';
  end if;
  if src not like '%rollback_refused_superseded_by_later_import%' then
    raise exception 'rollback does not refuse when a later import has moved a row on';
  end if;

  foreach fn in array array[
    'public.nmi_import_portfolio_workbook(uuid,date,uuid,text,text,jsonb,jsonb,jsonb,boolean,text,jsonb,text,jsonb)',
    'public.nmi_rollback_portfolio_import(uuid,uuid,text)',
    'public.nmi_lock_portfolio_import(text)'
  ] loop
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'authenticated must not hold EXECUTE on %', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'anon must not hold EXECUTE on %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role must hold EXECUTE on %', fn;
    end if;
  end loop;
end $$;

-- 9e. The R13.R1 invariant is untouched: `value` stays NOT NULL, so a gap is
--     still an absent row and can never be stored as a null.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'portfolio_evolution_observations'
       and column_name = 'value' and is_nullable = 'YES'
  ) then
    raise exception 'portfolio_evolution_observations.value must stay NOT NULL';
  end if;
end $$;
