-- POST-R13.8 FOLLOW-UP F -- THE BOUNDED PUBLICATION-METADATA REPAIR MECHANISM.
--
-- WHAT IS WRONG, AND WHAT IS NOT. R13.8D.1's historical restatement path
-- stamped the IMPORT ANCHOR's spine dates onto every week it re-published, so
-- the seven weeks 2026-06-19 through 2026-07-31 each carry
-- `previousWeekDate = 2026-08-28` -- a "previous week" two months AFTER the week
-- it claims to precede. Every financial value on those publications is correct.
-- Only the recorded anchor is not.
--
-- 20260822000000 fixed the WRITE PATH prospectively: a restated week now carries
-- its own frozen column's anchors, and the database refuses an anchor that is
-- not strictly earlier than the week it belongs to. That stops the defect
-- recurring. It does not correct the seven rows already standing, because a
-- migration must not carry a blind UPDATE against production identities it
-- cannot verify at authoring time.
--
-- SO THIS FILE ADDS A MECHANISM, NOT A CORRECTION. It contains no publication
-- id, no date and no financial conclusion. The corrections are runtime data
-- supplied by a reviewed read-only plan; this function verifies that the world
-- still looks exactly as that plan says it does, applies precisely the metadata
-- changes the plan lists, and otherwise raises and rolls everything back. It is
-- deliberately usable by any future anchor repair, not only this one.
--
--
-- WHY THIS IS NOT AN IMPORT
-- -------------------------
-- `portfolio_import_operations` is the workbook-import ledger, and its whole
-- vocabulary -- evolution mutations, publication corrections, rollback of a
-- promoted revision -- describes FINANCIAL mutation. A metadata repair changes
-- no value, mints no revision and supersedes nothing, so recording it there
-- would make the import history claim an economic event that never happened,
-- and would make rollback ambiguous. It gets its own two-table ledger instead.
--
--
-- WHAT IT MAY TOUCH
-- -----------------
-- Exactly one thing: `portfolio_publications.metadata`, and within it only a key
-- on the allowlist in section 3. It cannot write a snapshot row, a performance
-- row, an evolution observation, a revision, `is_current`, `superseded_by`,
-- `published_at`, `published_by`, `parser_version` or `upload_id` -- those
-- columns are captured before the update and re-asserted after it, inside the
-- same transaction, so a trigger that moved one would fail the operation.
--
-- The allowlisted keys are the two SPINE ANCHORS. Both carry the same
-- invariant -- strictly earlier than the week they describe -- which is what
-- makes a corrected value checkable rather than merely asserted.
--
--
-- SECURITY INVOKER, service_role ONLY
-- -----------------------------------
-- `service_role` already holds every privilege this function needs and bypasses
-- RLS, so a DEFINER function would be standing privilege escalation bought for
-- no capability. `search_path` is pinned to '' and every relation is
-- schema-qualified. There is NO dynamic SQL in the apply function: no packet
-- value ever becomes an identifier.
--
-- Idempotent. Apply with `npx supabase db push --linked`.

-- ===========================================================================
-- 0. Preconditions
-- ===========================================================================
do $$
begin
  if to_regclass('public.portfolio_publications') is null then
    raise exception 'portfolio_publications is missing -- apply 20260808000000 first';
  end if;
  if to_regclass('public.portfolio_row_history') is null then
    raise exception 'portfolio_row_history is missing -- apply 20260822000000 first';
  end if;
  if to_regprocedure('public.nmi_lock_publication_series(text,date)') is null then
    raise exception 'nmi_lock_publication_series is missing -- apply 20260810000000 first';
  end if;
end $$;


-- ===========================================================================
-- 1. The repair operation ledger
-- ===========================================================================
--
-- DURABLE, DATABASE-ENFORCED IDENTITY. Idempotency needs an identity the
-- database owns, not an application-side "check then write" that two concurrent
-- callers both pass. One row per operation, enforced by a unique constraint; a
-- second attempt cannot create a second row even if it defeats every check in
-- the function.
create table if not exists public.portfolio_publication_metadata_repairs (
  id           uuid        primary key default gen_random_uuid(),
  -- The caller-chosen stable identity of ONE repair. Reusing it with different
  -- content is refused, not treated as a retry.
  operation_id text        not null,
  -- SHA-256 of the canonical packet, so a retry can be distinguished from a
  -- different packet wearing the same id.
  packet_hash  text        not null,
  -- WHO authorized it. Never derived, never defaulted.
  actor        text        not null,
  -- WHY, in the operator's own words. A bare placeholder is refused by the
  -- length check below -- the same discipline the import path applies to a
  -- historical-restatement reason.
  reason       text        not null,
  -- The single metadata key this operation repaired. One key per operation:
  -- two keys are two decisions and deserve two audit records.
  field        text        not null,
  applied_at   timestamptz not null default now(),
  entry_count  int         not null check (entry_count > 0),
  metadata     jsonb       not null default '{}'::jsonb,
  constraint portfolio_publication_metadata_repairs_operation_key
    unique (operation_id),
  constraint portfolio_publication_metadata_repairs_reason_ck
    check (length(btrim(reason)) >= 20),
  constraint portfolio_publication_metadata_repairs_actor_ck
    check (length(btrim(actor)) > 0)
);

create index if not exists portfolio_publication_metadata_repairs_applied_idx
  on public.portfolio_publication_metadata_repairs (applied_at desc);

comment on table public.portfolio_publication_metadata_repairs is
  'POST-R13.8F -- one row per bounded publication-metadata repair operation. '
  'Records actor, reason, packet hash and the single repaired key. Never a financial mutation.';


-- ===========================================================================
-- 2. The per-publication before/after ledger
-- ===========================================================================
--
-- The operation row says a repair happened; this says exactly WHAT each
-- publication carried before and after. Without the before-image the correction
-- is unauditable after the fact -- the wrong value is gone and nothing records
-- what it was.
create table if not exists public.portfolio_publication_metadata_repair_entries (
  id              uuid primary key default gen_random_uuid(),
  repair_id       uuid not null
    references public.portfolio_publication_metadata_repairs(id) on delete cascade,
  -- `on delete restrict`: a repaired publication is a permanent audit subject
  -- and must not become removable because it was repaired.
  publication_id  uuid not null
    references public.portfolio_publications(id) on delete restrict,
  as_of_date      date not null,
  revision        int  not null check (revision >= 1),
  field           text not null,
  -- The value that stood BEFORE. Nullable: a key can legitimately have been
  -- absent, and a null before-image states that honestly rather than inventing
  -- an empty string.
  previous_value  text,
  corrected_value text not null,
  created_at      timestamptz not null default now(),
  -- One entry per publication per operation. A packet naming the same
  -- publication twice is a contradiction, not two corrections.
  constraint portfolio_publication_metadata_repair_entries_key
    unique (repair_id, publication_id),
  -- A correction that corrects nothing is not a correction.
  constraint portfolio_publication_metadata_repair_entries_distinct_ck
    check (previous_value is distinct from corrected_value),
  -- THE INVARIANT, ENFORCED BY THE SCHEMA. A spine anchor that is not strictly
  -- earlier than the week it describes is exactly the defect being repaired, so
  -- the ledger physically cannot record having written one.
  constraint portfolio_publication_metadata_repair_entries_before_ck
    check (corrected_value::date < as_of_date)
);

create index if not exists portfolio_publication_metadata_repair_entries_repair_idx
  on public.portfolio_publication_metadata_repair_entries (repair_id);
create index if not exists portfolio_publication_metadata_repair_entries_pub_idx
  on public.portfolio_publication_metadata_repair_entries (publication_id);

comment on table public.portfolio_publication_metadata_repair_entries is
  'POST-R13.8F -- the before/after image of every publication one repair touched. '
  'A CHECK enforces that a written anchor is strictly earlier than its own week.';


-- ===========================================================================
-- 3. The repairable-key allowlist
-- ===========================================================================
--
-- A FUNCTION, NOT A LITERAL BURIED IN THE APPLY BODY. Keeping the allowlist
-- addressable lets the pgTAP suite and the planning script assert the same list
-- the apply path enforces, instead of each restating it and drifting.
--
-- Both entries are spine anchor dates. A key without the strictly-earlier
-- invariant does not belong here: the whole safety of this mechanism is that a
-- corrected value can be CHECKED, not merely accepted.
create or replace function public.nmi_portfolio_repairable_metadata_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['previousWeekDate', 'beginningOfYearDate']::text[] $$;

comment on function public.nmi_portfolio_repairable_metadata_fields() is
  'POST-R13.8F -- the only publication metadata keys the bounded repair mechanism may write. '
  'Both are spine anchors carrying the strictly-earlier-than-own-week invariant.';


-- ===========================================================================
-- 4. RLS -- service-role only
-- ===========================================================================
--
-- Neither table is read through a member session. Like the import ledger, the
-- whole publication admin surface reads via the service-role client behind a
-- server-side administrator entitlement check.
alter table public.portfolio_publication_metadata_repairs enable row level security;
alter table public.portfolio_publication_metadata_repair_entries enable row level security;

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array[
    'portfolio_publication_metadata_repairs',
    'portfolio_publication_metadata_repair_entries'
  ] loop
    for pol in
      select policyname from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy %I on public.%I', pol.policyname, tbl);
    end loop;
  end loop;
end $$;

revoke all privileges on table public.portfolio_publication_metadata_repairs
  from public, anon, authenticated;
revoke all privileges on table public.portfolio_publication_metadata_repair_entries
  from public, anon, authenticated;
grant all privileges on table public.portfolio_publication_metadata_repairs to service_role;
grant all privileges on table public.portfolio_publication_metadata_repair_entries to service_role;


-- ===========================================================================
-- 5. The atomic repair function
-- ===========================================================================
--
-- PACKET SHAPE
--   {
--     "operationId":   "...",            stable idempotency identity
--     "packetHash":    "...",            sha256 of the canonical packet
--     "actor":         "...",            who authorized it
--     "reason":        "...",            why, >= 20 characters
--     "field":         "previousWeekDate",
--     "expectedCount": 7,
--     "entries": [{
--        "publicationId":      "<uuid>",
--        "asOfDate":           "2026-06-19",
--        "expectedRevision":   2,
--        "expectedIsCurrent":  true,
--        "expectedUploadKind": "portfolio",
--        "expectedValue":      "2026-08-28",   the WRONG value that must still stand
--        "correctedValue":     "2026-06-12"
--     }, ...]
--   }
create or replace function public.nmi_repair_portfolio_publication_metadata(p_packet jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_operation_id text;
  v_packet_hash  text;
  v_actor        text;
  v_reason       text;
  v_field        text;
  v_expected     int;
  v_entries      jsonb;

  v_entry     jsonb;
  v_pub       public.portfolio_publications%rowtype;
  v_pub_id    uuid;
  v_corrected date;
  v_stored    text;

  v_existing_id   uuid;
  v_existing_hash text;

  v_repair_id uuid;
  v_applied   int := 0;
  v_n         int;
  v_rows      int;

  -- The fingerprint of everything this function must NOT change.
  v_before jsonb;
  v_after  jsonb;
begin
  -- -- A - Packet shape -------------------------------------------------------
  if p_packet is null or jsonb_typeof(p_packet) <> 'object' then
    raise exception 'repair_refused_packet_not_object';
  end if;

  v_operation_id := p_packet ->> 'operationId';
  v_packet_hash  := p_packet ->> 'packetHash';
  v_actor        := p_packet ->> 'actor';
  v_reason       := p_packet ->> 'reason';
  v_field        := p_packet ->> 'field';
  v_entries      := p_packet -> 'entries';

  if v_operation_id is null or length(btrim(v_operation_id)) = 0 then
    raise exception 'repair_refused_operation_id_missing';
  end if;
  if v_packet_hash is null or length(btrim(v_packet_hash)) = 0 then
    raise exception 'repair_refused_packet_hash_missing';
  end if;
  if v_actor is null or length(btrim(v_actor)) = 0 then
    raise exception 'repair_refused_actor_missing';
  end if;
  if v_reason is null or length(btrim(v_reason)) < 20 then
    raise exception 'repair_refused_reason_missing';
  end if;

  -- THE ALLOWLIST GATE. Everything after this point writes one key, and this is
  -- the only place that decides which key that may be.
  if v_field is null
     or not (v_field = any (public.nmi_portfolio_repairable_metadata_fields())) then
    raise exception 'repair_refused_field_not_repairable';
  end if;

  if v_entries is null or jsonb_typeof(v_entries) <> 'array' then
    raise exception 'repair_refused_entries_not_array';
  end if;
  if jsonb_array_length(v_entries) = 0 then
    raise exception 'repair_refused_no_entries';
  end if;

  if jsonb_typeof(p_packet -> 'expectedCount') <> 'number' then
    raise exception 'repair_refused_expected_count_missing';
  end if;
  v_expected := (p_packet ->> 'expectedCount')::int;
  if v_expected <> jsonb_array_length(v_entries) then
    raise exception 'repair_refused_expected_count_mismatch';
  end if;

  -- No publication may appear twice in one packet.
  select count(*) into v_n
  from (
    select e.value ->> 'publicationId' pid
    from pg_catalog.jsonb_array_elements(v_entries) e
    group by 1 having count(*) > 1
  ) d;
  if v_n > 0 then
    raise exception 'repair_refused_duplicate_publication_in_packet';
  end if;

  -- -- B - Serialize, then idempotency ---------------------------------------
  -- Transaction-scoped: released by COMMIT or ROLLBACK, never leaked. A
  -- concurrent duplicate blocks here and, once the winner commits, finds the
  -- operation already recorded below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nmi_portfolio_metadata_repair:' || v_operation_id, 0::bigint));

  select r.id, r.packet_hash into v_existing_id, v_existing_hash
    from public.portfolio_publication_metadata_repairs r
   where r.operation_id = v_operation_id
   limit 1;

  if v_existing_id is not null then
    -- Same id, different content is a mistake, not a retry: refuse rather than
    -- report a success that never happened for THIS packet.
    if v_existing_hash is distinct from v_packet_hash then
      raise exception 'repair_refused_operation_id_reused_with_different_packet';
    end if;
    return jsonb_build_object(
      'status', 'already_applied',
      'operationId', v_operation_id,
      'packetHash', v_packet_hash,
      'repairId', v_existing_id,
      'corrected', 0);
  end if;

  -- -- C - Validate EVERY precondition before mutating anything ---------------
  for v_entry in select value from pg_catalog.jsonb_array_elements(v_entries)
  loop
    if v_entry ->> 'publicationId' is null then
      raise exception 'repair_refused_publication_id_missing';
    end if;
    if v_entry ->> 'asOfDate' is null then
      raise exception 'repair_refused_as_of_date_missing';
    end if;
    v_pub_id := (v_entry ->> 'publicationId')::uuid;

    -- Serialize against any concurrent publication of the same week, using the
    -- SAME advisory key the publish and import paths take. A hand-rolled key
    -- would silently fail to serialise against them while looking correct.
    perform public.nmi_lock_publication_series(
      coalesce(v_entry ->> 'expectedUploadKind', 'portfolio'),
      (v_entry ->> 'asOfDate')::date);

    -- Row lock held to COMMIT: nothing can move this publication underneath us
    -- between validation and mutation.
    select * into v_pub
      from public.portfolio_publications
     where id = v_pub_id
     for update;

    if not found then
      raise exception 'repair_refused_publication_not_found';
    end if;

    if v_pub.as_of_date is distinct from (v_entry ->> 'asOfDate')::date then
      raise exception 'repair_refused_as_of_date_mismatch';
    end if;
    if v_pub.revision is distinct from (v_entry ->> 'expectedRevision')::int then
      raise exception 'repair_refused_revision_mismatch';
    end if;
    if v_pub.is_current is distinct from (v_entry ->> 'expectedIsCurrent')::boolean then
      raise exception 'repair_refused_is_current_mismatch';
    end if;
    if v_pub.upload_kind is distinct from coalesce(v_entry ->> 'expectedUploadKind', 'portfolio') then
      raise exception 'repair_refused_upload_kind_mismatch';
    end if;

    -- THE PRE-STATE ASSERTION. The wrong value the plan reviewed must still be
    -- exactly what stands. `is distinct from` so an absent key and a null
    -- expectation compare equal rather than both being unknown.
    v_stored := v_pub.metadata ->> v_field;
    if v_stored is distinct from (v_entry ->> 'expectedValue') then
      raise exception 'repair_refused_stored_value_mismatch';
    end if;

    if v_entry ->> 'correctedValue' is null then
      raise exception 'repair_refused_corrected_value_missing';
    end if;
    v_corrected := (v_entry ->> 'correctedValue')::date;

    -- THE INVARIANT. A repair that wrote an anchor on or after its own week
    -- would be writing the very defect it exists to remove.
    if v_corrected >= v_pub.as_of_date then
      raise exception 'repair_refused_corrected_value_not_before_publication';
    end if;

    if v_stored is not distinct from (v_entry ->> 'correctedValue') then
      raise exception 'repair_refused_nothing_to_correct';
    end if;
  end loop;

  -- -- D - Capture the fingerprint of everything that must NOT move -----------
  -- Financial invariance is asserted, not assumed. The snapshot and performance
  -- rows of every touched publication are fingerprinted before the update and
  -- re-fingerprinted after it, in the same transaction, so a trigger or a
  -- mistaken cascade turns into a refusal instead of a silent restatement.
  select jsonb_agg(x order by x ->> 'publicationId') into v_before
  from (
    select jsonb_build_object(
      'publicationId', p.id::text,
      'uploadId',      p.upload_id::text,
      'uploadKind',    p.upload_kind,
      'asOfDate',      p.as_of_date::text,
      'revision',      p.revision,
      'publishedBy',   p.published_by::text,
      'publishedAt',   p.published_at::text,
      'isCurrent',     p.is_current,
      'supersededBy',  coalesce(p.superseded_by::text, ''),
      'parserVersion', p.parser_version,
      'adminNote',     coalesce(p.admin_note, ''),
      -- Every metadata key EXCEPT the one being repaired.
      'otherMetadata', (p.metadata - v_field),
      'snapshotRows',  (select count(*) from public.portfolio_snapshot_rows s
                         where s.publication_id = p.id),
      'snapshotSum',   (select coalesce(sum(s.value), 0) from public.portfolio_snapshot_rows s
                         where s.publication_id = p.id),
      'perfRows',      (select count(*) from public.portfolio_performance_rows f
                         where f.publication_id = p.id),
      'perfSum',       (select coalesce(sum(f.value), 0) from public.portfolio_performance_rows f
                         where f.publication_id = p.id)
    ) x
    from public.portfolio_publications p
    where p.id in (
      select (e.value ->> 'publicationId')::uuid
      from pg_catalog.jsonb_array_elements(v_entries) e)
  ) q;

  -- -- E - The operation record, before the mutations it accounts for ---------
  insert into public.portfolio_publication_metadata_repairs
    (operation_id, packet_hash, actor, reason, field, entry_count, metadata)
  values
    (v_operation_id, v_packet_hash, btrim(v_actor), btrim(v_reason), v_field, v_expected,
     pg_catalog.jsonb_build_object(
       'appliedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'entries', v_entries))
  returning id into v_repair_id;

  -- -- F - Mutate: ONE key, on ONE column, per entry --------------------------
  for v_entry in select value from pg_catalog.jsonb_array_elements(v_entries)
  loop
    v_pub_id := (v_entry ->> 'publicationId')::uuid;

    select * into v_pub from public.portfolio_publications where id = v_pub_id;
    v_stored := v_pub.metadata ->> v_field;

    update public.portfolio_publications p
       set metadata = p.metadata
                      || pg_catalog.jsonb_build_object(v_field, v_entry ->> 'correctedValue')
                      || pg_catalog.jsonb_build_object(
                           'metadataRepairOperationId', v_operation_id)
     where p.id = v_pub_id;

    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'repair_refused_update_touched_unexpected_row_count';
    end if;

    insert into public.portfolio_publication_metadata_repair_entries
      (repair_id, publication_id, as_of_date, revision, field, previous_value, corrected_value)
    values
      (v_repair_id, v_pub_id, v_pub.as_of_date, v_pub.revision, v_field,
       v_stored, v_entry ->> 'correctedValue');

    v_applied := v_applied + 1;
  end loop;

  -- -- G - Postconditions, still inside the transaction -----------------------
  if v_applied <> v_expected then
    raise exception 'repair_refused_applied_count_mismatch';
  end if;

  -- Every entry now carries exactly the corrected value, and it is a possible
  -- anchor. Read back from the table rather than trusting the update.
  for v_entry in select value from pg_catalog.jsonb_array_elements(v_entries)
  loop
    select * into v_pub
      from public.portfolio_publications
     where id = (v_entry ->> 'publicationId')::uuid;

    if (v_pub.metadata ->> v_field) is distinct from (v_entry ->> 'correctedValue') then
      raise exception 'repair_refused_postcondition_value_not_written';
    end if;
    if (v_pub.metadata ->> v_field)::date >= v_pub.as_of_date then
      raise exception 'repair_refused_postcondition_impossible_anchor';
    end if;
  end loop;

  -- FINANCIAL INVARIANCE. Same fingerprint, recomputed.
  select jsonb_agg(x order by x ->> 'publicationId') into v_after
  from (
    select jsonb_build_object(
      'publicationId', p.id::text,
      'uploadId',      p.upload_id::text,
      'uploadKind',    p.upload_kind,
      'asOfDate',      p.as_of_date::text,
      'revision',      p.revision,
      'publishedBy',   p.published_by::text,
      'publishedAt',   p.published_at::text,
      'isCurrent',     p.is_current,
      'supersededBy',  coalesce(p.superseded_by::text, ''),
      'parserVersion', p.parser_version,
      'adminNote',     coalesce(p.admin_note, ''),
      -- `metadataRepairOperationId` is this mechanism's own provenance stamp,
      -- not workbook content, so it is excluded alongside the repaired key.
      'otherMetadata', ((p.metadata - v_field) - 'metadataRepairOperationId'),
      'snapshotRows',  (select count(*) from public.portfolio_snapshot_rows s
                         where s.publication_id = p.id),
      'snapshotSum',   (select coalesce(sum(s.value), 0) from public.portfolio_snapshot_rows s
                         where s.publication_id = p.id),
      'perfRows',      (select count(*) from public.portfolio_performance_rows f
                         where f.publication_id = p.id),
      'perfSum',       (select coalesce(sum(f.value), 0) from public.portfolio_performance_rows f
                         where f.publication_id = p.id)
    ) x
    from public.portfolio_publications p
    where p.id in (
      select (e.value ->> 'publicationId')::uuid
      from pg_catalog.jsonb_array_elements(v_entries) e)
  ) q;

  if v_before is distinct from v_after then
    raise exception 'repair_refused_publication_state_changed_beyond_metadata_key';
  end if;

  -- Exactly one audit record, with exactly the entries it claims.
  select count(*) into v_rows
    from public.portfolio_publication_metadata_repairs
   where operation_id = v_operation_id;
  if v_rows <> 1 then
    raise exception 'repair_refused_duplicate_audit_record';
  end if;

  select count(*) into v_rows
    from public.portfolio_publication_metadata_repair_entries
   where repair_id = v_repair_id;
  if v_rows <> v_expected then
    raise exception 'repair_refused_audit_entry_count_mismatch';
  end if;

  -- -- H - Commit is the caller's; returning is the success signal ------------
  return jsonb_build_object(
    'status', 'applied',
    'operationId', v_operation_id,
    'packetHash', v_packet_hash,
    'repairId', v_repair_id,
    'field', v_field,
    'corrected', v_applied,
    'appliedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end;
$fn$;

comment on function public.nmi_repair_portfolio_publication_metadata(jsonb) is
  'POST-R13.8F -- applies a reviewed publication-metadata repair packet as ONE atomic transaction, '
  'or raises and rolls back entirely. Writes ONE allowlisted key on portfolio_publications.metadata '
  'and nothing else; re-asserts financial invariance before returning. SECURITY INVOKER; '
  'EXECUTE granted only to service_role; idempotent per operationId.';


-- ===========================================================================
-- 6. EXECUTE privilege -- service_role ONLY
-- ===========================================================================
revoke all on function public.nmi_repair_portfolio_publication_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.nmi_portfolio_repairable_metadata_fields()
  from public, anon, authenticated;
grant execute on function public.nmi_repair_portfolio_publication_metadata(jsonb) to service_role;
grant execute on function public.nmi_portfolio_repairable_metadata_fields() to service_role;


-- ===========================================================================
-- 7. Postconditions, executed in-database at apply time
-- ===========================================================================
do $$
declare
  v_n int;
  v_src text;
begin
  if to_regclass('public.portfolio_publication_metadata_repairs') is null then
    raise exception 'portfolio_publication_metadata_repairs was not created';
  end if;
  if to_regclass('public.portfolio_publication_metadata_repair_entries') is null then
    raise exception 'portfolio_publication_metadata_repair_entries was not created';
  end if;

  -- SECURITY INVOKER, search_path pinned.
  select count(*) into v_n
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname = 'nmi_repair_portfolio_publication_metadata'
    and p.prosecdef is false
    and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=%';
  if v_n <> 1 then
    raise exception 'nmi_repair_portfolio_publication_metadata must be SECURITY INVOKER with a pinned search_path';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid) into v_src
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'nmi_repair_portfolio_publication_metadata';

  -- No dynamic SQL anywhere in the apply body.
  if v_src ~* '\mexecute\M' then
    raise exception 'nmi_repair_portfolio_publication_metadata must contain no dynamic SQL';
  end if;

  -- It may never write a financial table. The function only ever SELECTs from
  -- them, for the invariance fingerprint.
  if v_src ~* 'update\s+public\.portfolio_snapshot_rows'
     or v_src ~* 'update\s+public\.portfolio_performance_rows'
     or v_src ~* 'update\s+public\.portfolio_evolution_observations'
     or v_src ~* 'delete\s+from\s+public\.portfolio_snapshot_rows'
     or v_src ~* 'delete\s+from\s+public\.portfolio_performance_rows'
     or v_src ~* 'delete\s+from\s+public\.portfolio_evolution_observations'
     or v_src ~* 'insert\s+into\s+public\.portfolio_snapshot_rows'
     or v_src ~* 'insert\s+into\s+public\.portfolio_performance_rows'
     or v_src ~* 'insert\s+into\s+public\.portfolio_evolution_observations' then
    raise exception 'nmi_repair_portfolio_publication_metadata must never write a financial table';
  end if;

  -- EXECUTE is service_role only.
  if pg_catalog.has_function_privilege('authenticated',
       'public.nmi_repair_portfolio_publication_metadata(jsonb)', 'execute') then
    raise exception 'authenticated must not be able to execute the repair function';
  end if;
  if pg_catalog.has_function_privilege('anon',
       'public.nmi_repair_portfolio_publication_metadata(jsonb)', 'execute') then
    raise exception 'anon must not be able to execute the repair function';
  end if;

  -- Both ledgers are RLS-enabled and unreadable to a member session.
  select count(*) into v_n
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname in ('portfolio_publication_metadata_repairs',
                      'portfolio_publication_metadata_repair_entries')
    and c.relrowsecurity is true;
  if v_n <> 2 then
    raise exception 'both repair ledgers must have row level security enabled';
  end if;

  if pg_catalog.has_table_privilege('authenticated',
       'public.portfolio_publication_metadata_repairs', 'select')
     or pg_catalog.has_table_privilege('anon',
       'public.portfolio_publication_metadata_repair_entries', 'select') then
    raise exception 'the repair ledgers must not be readable by anon or authenticated';
  end if;
end $$;
