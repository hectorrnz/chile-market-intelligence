-- R13.7B3.1 — ATOMIC STRUCTURED-NOTES RECONCILIATION APPLY MECHANISM.
--
-- R13.7B3 stopped before every production write because this repository had no
-- way to apply a reviewed reconciliation packet atomically: the reconciliation
-- tooling is read-only by construction, and Supabase's JS client has no
-- multi-statement transaction API, so a nine-note correction would have been a
-- sequence of independent writes that could stop half-way and leave the book in
-- a state that is neither the old one nor the new one.
--
-- This migration adds GENERIC infrastructure only. It contains no ISIN, no note
-- id, no valuation date and no financial conclusion: the mutation packet is
-- runtime data supplied by a reviewed dry run, and this function is the
-- mechanism that applies it or refuses. It is deliberately usable by any future
-- reconciliation, not only R13.7's.
--
--
-- WHY SECURITY INVOKER (§ 2)
-- ─────────────────────────
-- `service_role` already holds `all privileges` on every table this function
-- touches (20260815000000 and 20260818000000 grant them explicitly) and bypasses
-- RLS, so nothing here needs elevation. SECURITY INVOKER is therefore strictly
-- SAFER than DEFINER: EXECUTE is granted only to `service_role`, and even if that
-- grant were ever widened by mistake, an `authenticated` caller would still be
-- stopped by the ordinary RLS and privilege checks instead of silently running
-- with the owner's rights. A DEFINER function here would be a standing
-- privilege-escalation surface bought for no capability at all.
--
-- `search_path` is pinned to '' and every relation is schema-qualified anyway,
-- so a caller-controlled search_path cannot redirect a single reference.
--
-- THERE IS NO DYNAMIC SQL IN THIS FUNCTION. Nothing from the packet is ever
-- concatenated into a statement or used as an identifier: every packet value
-- reaches the database as a parameter or a cast, and every table, column and
-- enum-like literal is written out in full. `execute` does not appear.
--
--
-- WHAT IT IS NOT
-- ──────────────
-- It is an APPLY mechanism, never a second financial decision engine. It does
-- not read prices, evaluate a barrier, or decide whether a note called. It
-- verifies that the world still looks exactly as the reviewed packet says it
-- did, then performs precisely the mutations the packet lists — or raises and
-- rolls the whole thing back.
--
-- It also does not persist settlement (§ 11). Settlement stays derived from call
-- status + contractual redemption date + as-of date; the packet carries it only
-- so the audit record can be reconciled against the accounting later. No
-- notional is written here.
--
-- Idempotent. Apply via Supabase Dashboard → SQL Editor.

-- =============================================================================
-- 1 · CONTRACTUAL OBSERVATION IDENTITY
-- =============================================================================
-- The table's only uniqueness is (note_id, observation_type, observation_number),
-- which does not stop the same contractual test being written twice for one
-- valuation date under two different numbers — exactly the duplicate a retried
-- backfill would create.
--
-- The real logical identity is (note, valuation date, observation type): a
-- contract tests a given condition once per valuation date. The application
-- already assumes this (`dedupeObservationsByDate` collapses legacy rows), so
-- this index enforces an invariant the code already relies on.
--
-- Verified before creating: the production book holds 68 observations across
-- nine notes with ZERO violations of this triple. The guard below re-checks in
-- whatever database this runs against, so a dirty database fails loudly with a
-- readable message instead of an opaque index build error.

do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes
  from (
    select 1
    from public.structured_note_observations
    group by note_id, observation_type, valuation_date
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'cannot enforce contractual observation identity: % (note_id, observation_type, valuation_date) group(s) already duplicated — resolve the data first',
      v_dupes;
  end if;
end $$;

create unique index if not exists sn_observations_contract_identity_uidx
  on public.structured_note_observations (note_id, observation_type, valuation_date);


-- =============================================================================
-- 2 · DURABLE RECONCILIATION OPERATION IDENTITY
-- =============================================================================
-- Idempotency needs a durable, database-enforced identity for one reconciliation
-- — not an application-side "check then write", which two concurrent callers
-- both pass.
--
-- No new table: `structured_note_monitoring_runs` is already the approved audit
-- sink (its run_type CHECK has always allowed 'backfill', and 20260818000000
-- made the table administrator-only to read), so the operation identity lives in
-- the audit row itself. One row per operation, enforced by the index; a second
-- attempt cannot create a second row even if it defeats every application check.

-- `jsonb_exists(...)` rather than the `?` operator: identical semantics, but `?`
-- is a parameter placeholder to several drivers, and this predicate has to
-- survive being replayed by whatever applies the chain.
create unique index if not exists sn_monitoring_runs_operation_uidx
  on public.structured_note_monitoring_runs ((metadata ->> 'operationId'))
  where run_type = 'backfill' and jsonb_exists(metadata, 'operationId');


-- =============================================================================
-- 3 · THE ATOMIC APPLY FUNCTION
-- =============================================================================

create or replace function public.nmi_apply_structured_note_reconciliation(p_packet jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_operation_id text;
  v_actor        text;
  v_reason_code  text;
  v_packet_hash  text;
  v_as_of        text;
  v_expected     jsonb;
  v_notes        jsonb;

  v_note         jsonb;
  v_obs          jsonb;
  v_note_row     public.structured_notes%rowtype;
  v_note_id      uuid;

  v_existing_id   uuid;
  v_existing_meta jsonb;

  v_started   timestamptz := clock_timestamp();
  v_run_id    uuid;
  v_n         int;
  v_dupes     int;
  v_audit_rows int;

  v_inserted        int := 0;
  v_autocalled      int := 0;
  v_cancelled       int := 0;
  v_notes_corrected int := 0;
  v_notes_unchanged int := 0;

  v_type   text;
  v_status text;
  v_key    text;
begin
  -- ── A · Packet shape ──────────────────────────────────────────────────────
  if p_packet is null or jsonb_typeof(p_packet) <> 'object' then
    raise exception 'reconciliation packet must be a JSON object';
  end if;

  v_operation_id := p_packet ->> 'operationId';
  v_actor        := p_packet ->> 'actor';
  v_reason_code  := p_packet ->> 'reasonCode';
  v_packet_hash  := p_packet ->> 'packetHash';
  v_as_of        := p_packet ->> 'asOf';
  v_expected     := p_packet -> 'expectedCounts';
  v_notes        := p_packet -> 'notes';

  if v_operation_id is null or length(btrim(v_operation_id)) = 0 then
    raise exception 'reconciliation packet requires a non-empty operationId';
  end if;
  if v_actor is null or length(btrim(v_actor)) = 0 then
    raise exception 'reconciliation packet requires a non-empty actor';
  end if;
  if v_reason_code is null or length(btrim(v_reason_code)) = 0 then
    raise exception 'reconciliation packet requires a non-empty reasonCode';
  end if;
  if v_packet_hash is null or length(btrim(v_packet_hash)) = 0 then
    raise exception 'reconciliation packet requires a non-empty packetHash';
  end if;
  if v_expected is null or jsonb_typeof(v_expected) <> 'object' then
    raise exception 'reconciliation packet requires an expectedCounts object';
  end if;
  if v_notes is null or jsonb_typeof(v_notes) <> 'array' then
    raise exception 'reconciliation packet requires a notes array';
  end if;
  if jsonb_array_length(v_notes) = 0 then
    raise exception 'reconciliation packet contains no notes';
  end if;

  -- ── B · Serialization, then idempotency (§ 6) ─────────────────────────────
  -- The advisory lock is transaction-scoped: it is released by COMMIT or
  -- ROLLBACK, never leaked. A concurrent duplicate blocks here, and once the
  -- winner commits, the loser proceeds and finds the operation already recorded
  -- below. The unique index from section 2 is the durable backstop if anything
  -- ever reaches the insert concurrently.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_operation_id, 0::bigint));

  select r.id, r.metadata
    into v_existing_id, v_existing_meta
  from public.structured_note_monitoring_runs r
  where r.run_type = 'backfill'
    and r.metadata ->> 'operationId' = v_operation_id
  limit 1;

  if v_existing_id is not null then
    -- Same id with different content is a mistake, not a retry: refuse rather
    -- than report a success that never happened for THIS packet.
    if coalesce(v_existing_meta ->> 'packetHash', '') <> v_packet_hash then
      raise exception
        'operation % was already applied with a different packet hash (stored %, supplied %)',
        v_operation_id, coalesce(v_existing_meta ->> 'packetHash', '<none>'), v_packet_hash;
    end if;

    return jsonb_build_object(
      'status', 'already_applied',
      'operationId', v_operation_id,
      'packetHash', v_packet_hash,
      'auditRunId', v_existing_id,
      'appliedAt', v_existing_meta ->> 'appliedAt',
      'counts', coalesce(v_existing_meta -> 'counts', '{}'::jsonb)
    );
  end if;

  -- ── C · Validate EVERY precondition before mutating anything (§ 4, § 9B) ──
  for v_note in select value from pg_catalog.jsonb_array_elements(v_notes)
  loop
    if v_note ->> 'noteId' is null then
      raise exception 'every packet note requires a noteId';
    end if;
    v_note_id := (v_note ->> 'noteId')::uuid;

    -- Row lock held to COMMIT: nothing can move this note underneath us between
    -- validation and mutation.
    select * into v_note_row
    from public.structured_notes
    where id = v_note_id
    for update;

    if not found then
      raise exception 'note % does not exist', v_note_id;
    end if;

    if v_note_row.status is distinct from (v_note ->> 'expectedStatus') then
      raise exception
        'stale packet: note % is in status %, packet expected %',
        coalesce(v_note_row.isin, v_note_id::text), v_note_row.status, v_note ->> 'expectedStatus';
    end if;

    if (v_note ->> 'expectedArchivedAt') is null then
      if v_note_row.archived_at is not null then
        raise exception
          'stale packet: note % is already archived at %, packet expected it live',
          coalesce(v_note_row.isin, v_note_id::text), v_note_row.archived_at;
      end if;
    elsif v_note_row.archived_at is distinct from (v_note ->> 'expectedArchivedAt')::timestamptz then
      raise exception
        'stale packet: note % archived_at is %, packet expected %',
        coalesce(v_note_row.isin, v_note_id::text), v_note_row.archived_at, v_note ->> 'expectedArchivedAt';
    end if;

    if (v_note ->> 'correctedStatus') is null then
      raise exception 'note % packet entry requires a correctedStatus', v_note_id;
    end if;

    -- The three mutation lists must be arrays if present. Checked explicitly so
    -- a malformed packet fails with a readable message rather than "cannot
    -- extract elements from a scalar" from somewhere deep in the loop below.
    for v_key in select unnest(array['insertObservations', 'cancelObservations', 'preserveObservations'])
    loop
      if pg_catalog.jsonb_exists(v_note, v_key) and jsonb_typeof(v_note -> v_key) <> 'array' then
        raise exception 'note % field "%" must be a JSON array, got %', v_note_id, v_key, jsonb_typeof(v_note -> v_key);
      end if;
    end loop;

    -- Rows to insert must be genuinely absent.
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'insertObservations', '[]'::jsonb))
    loop
      if coalesce(v_obs ->> 'observationType', 'autocall') <> 'autocall' then
        raise exception 'this mechanism only inserts autocall observations, got %', v_obs ->> 'observationType';
      end if;
      if v_obs ->> 'valuationDate' is null or v_obs ->> 'observationNumber' is null then
        raise exception 'an insertObservations entry for note % lacks valuationDate or observationNumber', v_note_id;
      end if;
      if exists (
        select 1 from public.structured_note_observations o
        where o.note_id = v_note_id
          and o.observation_type = 'autocall'
          and o.valuation_date = (v_obs ->> 'valuationDate')::date
      ) then
        raise exception
          'stale packet: an autocall observation already exists for note % on % — refusing to duplicate',
          coalesce(v_note_row.isin, v_note_id::text), v_obs ->> 'valuationDate';
      end if;
    end loop;

    -- Rows to cancel must exist in exactly the status the packet reviewed,
    -- unless they are rows this same packet is about to insert.
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'cancelObservations', '[]'::jsonb))
    loop
      v_type   := v_obs ->> 'observationType';
      v_status := v_obs ->> 'expectedStatus';
      if v_type is null or v_type not in ('coupon', 'autocall', 'final') then
        raise exception 'cancelObservations entry has an invalid observationType %', coalesce(v_type, '<null>');
      end if;
      if v_status is null then
        raise exception 'cancelObservations entry for note % lacks expectedStatus', v_note_id;
      end if;

      if not exists (
        select 1 from public.structured_note_observations o
        where o.note_id = v_note_id
          and o.observation_type = v_type
          and o.valuation_date = (v_obs ->> 'valuationDate')::date
          and o.status = v_status
      ) and not exists (
        select 1 from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'insertObservations', '[]'::jsonb)) ins
        where ins.value ->> 'valuationDate' = v_obs ->> 'valuationDate'
          and v_type = 'autocall'
          and v_status = 'scheduled'
      ) then
        raise exception
          'stale packet: note % has no % observation on % in status % to cancel',
          coalesce(v_note_row.isin, v_note_id::text), v_type, v_obs ->> 'valuationDate', v_status;
      end if;
    end loop;

    -- Rows the packet promises to leave alone must already be as reviewed.
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'preserveObservations', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.structured_note_observations o
        where o.note_id = v_note_id
          and o.observation_type = v_obs ->> 'observationType'
          and o.valuation_date = (v_obs ->> 'valuationDate')::date
          and o.status = v_obs ->> 'expectedStatus'
      ) then
        raise exception
          'stale packet: preserved % observation for note % on % is not in status %',
          v_obs ->> 'observationType', coalesce(v_note_row.isin, v_note_id::text),
          v_obs ->> 'valuationDate', v_obs ->> 'expectedStatus';
      end if;
    end loop;
  end loop;

  -- ── D–G · Mutate (§ 9) ────────────────────────────────────────────────────
  for v_note in select value from pg_catalog.jsonb_array_elements(v_notes)
  loop
    v_note_id := (v_note ->> 'noteId')::uuid;
    select * into v_note_row from public.structured_notes where id = v_note_id;

    -- D · missing autocall schedule rows
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'insertObservations', '[]'::jsonb))
    loop
      insert into public.structured_note_observations (
        note_id, user_id, observation_number, observation_type, valuation_date,
        payment_date, redemption_date, autocall_barrier_pct, coupon_barrier_pct,
        status, metadata
      ) values (
        v_note_id,
        v_note_row.user_id,
        (v_obs ->> 'observationNumber')::int,
        'autocall',
        (v_obs ->> 'valuationDate')::date,
        nullif(v_obs ->> 'paymentDate', '')::date,
        nullif(v_obs ->> 'redemptionDate', '')::date,
        nullif(v_obs ->> 'autocallBarrierPct', '')::numeric,
        nullif(v_obs ->> 'couponBarrierPct', '')::numeric,
        'scheduled',
        pg_catalog.jsonb_build_object(
          'source', 'r13_7_reconciliation',
          'operationId', v_operation_id,
          'synthesizedFromContract', true
        )
      );
      v_inserted := v_inserted + 1;
    end loop;

    -- E · the call-date autocall result
    if jsonb_typeof(v_note -> 'autocallResult') = 'object' then
      update public.structured_note_observations o
         set status                 = 'autocalled',
             autocall_eligible      = true,
             observed_at            = coalesce(o.observed_at, pg_catalog.now()),
             observed_source        = coalesce(v_note -> 'autocallResult' ->> 'observedSource', o.observed_source),
             worst_performer_ticker = coalesce(v_note -> 'autocallResult' ->> 'worstPerformerTicker', o.worst_performer_ticker),
             observed_levels        = coalesce(v_note -> 'autocallResult' -> 'observedLevels', o.observed_levels),
             review_required        = coalesce((v_note -> 'autocallResult' ->> 'reviewRequired')::boolean, o.review_required),
             review_reason          = coalesce(v_note -> 'autocallResult' ->> 'reviewReason', o.review_reason),
             metadata               = o.metadata || pg_catalog.jsonb_build_object(
                                        'operationId', v_operation_id,
                                        'historicalCorrection', true,
                                        'reasonCode', v_reason_code
                                      ),
             updated_at             = pg_catalog.now()
       where o.note_id = v_note_id
         and o.observation_type = 'autocall'
         and o.valuation_date = (v_note -> 'autocallResult' ->> 'valuationDate')::date;

      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception
          'expected exactly one call-date autocall row for note % on %, updated %',
          coalesce(v_note_row.isin, v_note_id::text), v_note -> 'autocallResult' ->> 'valuationDate', v_n;
      end if;
      v_autocalled := v_autocalled + 1;
    end if;

    -- F · void every post-call observation
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'cancelObservations', '[]'::jsonb))
    loop
      update public.structured_note_observations o
         set status     = 'cancelled',
             metadata   = o.metadata || pg_catalog.jsonb_build_object(
                            'operationId', v_operation_id,
                            'voidedReason', 'post_call_observation'
                          ),
             updated_at = pg_catalog.now()
       where o.note_id = v_note_id
         and o.observation_type = v_obs ->> 'observationType'
         and o.valuation_date = (v_obs ->> 'valuationDate')::date
         and o.status = v_obs ->> 'expectedStatus';

      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception
          'cancel target for note % (% on %) matched % rows in status %, expected exactly 1',
          coalesce(v_note_row.isin, v_note_id::text), v_obs ->> 'observationType',
          v_obs ->> 'valuationDate', v_n, v_obs ->> 'expectedStatus';
      end if;
      v_cancelled := v_cancelled + 1;
    end loop;

    -- G · the note's own contractual state
    if (v_note ->> 'correctedStatus') is distinct from v_note_row.status then
      update public.structured_notes n
         set status      = v_note ->> 'correctedStatus',
             archived_at = nullif(v_note ->> 'correctedArchivedAt', '')::timestamptz,
             updated_at  = pg_catalog.now()
       where n.id = v_note_id;

      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'expected to correct exactly one note row for %, updated %', v_note_id, v_n;
      end if;
      v_notes_corrected := v_notes_corrected + 1;
    else
      v_notes_unchanged := v_notes_unchanged + 1;
    end if;
  end loop;

  -- ── H · One durable audit record (§ 7) ────────────────────────────────────
  insert into public.structured_note_monitoring_runs (
    run_type, status, started_at, completed_at,
    active_note_count, observations_checked, observations_updated, notes_updated,
    warnings, errors, metadata
  ) values (
    'backfill',
    'success',
    v_started,
    pg_catalog.now(),
    jsonb_array_length(v_notes),
    v_inserted + v_autocalled + v_cancelled,
    v_inserted + v_autocalled + v_cancelled,
    v_notes_corrected,
    '[]'::jsonb,
    '[]'::jsonb,
    pg_catalog.jsonb_build_object(
      'operationId', v_operation_id,
      'packetHash', v_packet_hash,
      'actor', v_actor,
      'reasonCode', v_reason_code,
      'asOf', v_as_of,
      'appliedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'counts', pg_catalog.jsonb_build_object(
        'observationsInserted', v_inserted,
        'observationsAutocalled', v_autocalled,
        'observationsCancelled', v_cancelled,
        'notesCorrected', v_notes_corrected,
        'notesUnchanged', v_notes_unchanged
      ),
      'notes', v_notes
    )
  )
  returning id into v_run_id;

  -- ── I · Postconditions, still inside the transaction (§ 10) ───────────────
  if (v_expected ->> 'observationsInserted')::int is distinct from v_inserted then
    raise exception 'inserted % autocall observations, packet expected %',
      v_inserted, v_expected ->> 'observationsInserted';
  end if;
  if (v_expected ->> 'observationsAutocalled')::int is distinct from v_autocalled then
    raise exception 'set % call-date autocall results, packet expected %',
      v_autocalled, v_expected ->> 'observationsAutocalled';
  end if;
  if (v_expected ->> 'observationsCancelled')::int is distinct from v_cancelled then
    raise exception 'cancelled % observations, packet expected %',
      v_cancelled, v_expected ->> 'observationsCancelled';
  end if;
  if (v_expected ->> 'notesCorrected')::int is distinct from v_notes_corrected then
    raise exception 'corrected % notes, packet expected %',
      v_notes_corrected, v_expected ->> 'notesCorrected';
  end if;

  -- No duplicate contractual identity anywhere in the touched book. The unique
  -- index makes this unreachable; asserted so that dropping the index turns a
  -- silent duplication into a loud failure.
  select count(*) into v_dupes
  from (
    select 1
    from public.structured_note_observations o
    where o.note_id in (select (n.value ->> 'noteId')::uuid from pg_catalog.jsonb_array_elements(v_notes) n)
    group by o.note_id, o.observation_type, o.valuation_date
    having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'post-mutation duplicate contractual observation identities: %', v_dupes;
  end if;

  for v_note in select value from pg_catalog.jsonb_array_elements(v_notes)
  loop
    v_note_id := (v_note ->> 'noteId')::uuid;
    select * into v_note_row from public.structured_notes where id = v_note_id;

    -- The note ended in exactly the state the reviewed packet specified.
    if v_note_row.status is distinct from (v_note ->> 'correctedStatus') then
      raise exception 'note % ended in status %, packet specified %',
        coalesce(v_note_row.isin, v_note_id::text), v_note_row.status, v_note ->> 'correctedStatus';
    end if;

    -- A corrected note carries its earliest contractual call row, marked called.
    if jsonb_typeof(v_note -> 'autocallResult') = 'object' then
      if not exists (
        select 1 from public.structured_note_observations o
        where o.note_id = v_note_id
          and o.observation_type = 'autocall'
          and o.valuation_date = (v_note -> 'autocallResult' ->> 'valuationDate')::date
          and o.status = 'autocalled'
          and o.autocall_eligible is true
      ) then
        raise exception 'note % has no autocalled call-date row after apply', coalesce(v_note_row.isin, v_note_id::text);
      end if;
    end if;

    -- Rows the packet promised to leave alone are still exactly as reviewed —
    -- this is what proves a call-date coupon result was not collaterally voided.
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'preserveObservations', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.structured_note_observations o
        where o.note_id = v_note_id
          and o.observation_type = v_obs ->> 'observationType'
          and o.valuation_date = (v_obs ->> 'valuationDate')::date
          and o.status = v_obs ->> 'expectedStatus'
      ) then
        raise exception 'preserved % observation for note % on % changed during apply',
          v_obs ->> 'observationType', coalesce(v_note_row.isin, v_note_id::text), v_obs ->> 'valuationDate';
      end if;
    end loop;

    -- Every listed cancellation really is void.
    for v_obs in select value from pg_catalog.jsonb_array_elements(coalesce(v_note -> 'cancelObservations', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.structured_note_observations o
        where o.note_id = v_note_id
          and o.observation_type = v_obs ->> 'observationType'
          and o.valuation_date = (v_obs ->> 'valuationDate')::date
          and o.status = 'cancelled'
      ) then
        raise exception 'post-call % observation for note % on % is not cancelled',
          v_obs ->> 'observationType', coalesce(v_note_row.isin, v_note_id::text), v_obs ->> 'valuationDate';
      end if;
    end loop;
  end loop;

  -- Exactly one audit row exists for this operation.
  select count(*) into v_audit_rows
  from public.structured_note_monitoring_runs r
  where r.run_type = 'backfill' and r.metadata ->> 'operationId' = v_operation_id;
  if v_audit_rows <> 1 then
    raise exception 'expected exactly one backfill audit row for operation %, found %', v_operation_id, v_audit_rows;
  end if;

  -- ── J · Commit is the caller's; returning is the success signal ───────────
  return jsonb_build_object(
    'status', 'applied',
    'operationId', v_operation_id,
    'packetHash', v_packet_hash,
    'auditRunId', v_run_id,
    'appliedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'counts', pg_catalog.jsonb_build_object(
      'observationsInserted', v_inserted,
      'observationsAutocalled', v_autocalled,
      'observationsCancelled', v_cancelled,
      'notesCorrected', v_notes_corrected,
      'notesUnchanged', v_notes_unchanged
    )
  );
end;
$fn$;

comment on function public.nmi_apply_structured_note_reconciliation(jsonb) is
  'R13.7B3.1 — applies a reviewed Structured Notes reconciliation packet as ONE atomic transaction, '
  'or raises and rolls back entirely. SECURITY INVOKER; EXECUTE granted only to service_role. '
  'Verifies every precondition against locked rows before mutating, is idempotent per operationId, '
  'and never decides a contractual outcome itself.';


-- =============================================================================
-- 4 · EXECUTE PRIVILEGE — service_role ONLY
-- =============================================================================

revoke all on function public.nmi_apply_structured_note_reconciliation(jsonb) from public;
revoke all on function public.nmi_apply_structured_note_reconciliation(jsonb) from anon;
revoke all on function public.nmi_apply_structured_note_reconciliation(jsonb) from authenticated;
grant execute on function public.nmi_apply_structured_note_reconciliation(jsonb) to service_role;


-- =============================================================================
-- 5 · POSTCONDITIONS, executed in-database at apply time
-- =============================================================================

do $$
declare
  v_n int;
begin
  -- 1 · The function exists, is INVOKER, and pins search_path.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'nmi_apply_structured_note_reconciliation'
  ) then
    raise exception 'nmi_apply_structured_note_reconciliation was not created';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'nmi_apply_structured_note_reconciliation'
      and p.prosecdef
  ) then
    raise exception 'the reconciliation apply function must be SECURITY INVOKER, not DEFINER';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'nmi_apply_structured_note_reconciliation'
      and p.proconfig is not null
      and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    raise exception 'the reconciliation apply function does not pin search_path';
  end if;

  -- 2 · No ordinary session can execute it.
  if pg_catalog.has_function_privilege('anon',
       'public.nmi_apply_structured_note_reconciliation(jsonb)', 'EXECUTE') then
    raise exception 'anon can execute the reconciliation apply function';
  end if;
  if pg_catalog.has_function_privilege('authenticated',
       'public.nmi_apply_structured_note_reconciliation(jsonb)', 'EXECUTE') then
    raise exception 'authenticated can execute the reconciliation apply function';
  end if;
  if not pg_catalog.has_function_privilege('service_role',
       'public.nmi_apply_structured_note_reconciliation(jsonb)', 'EXECUTE') then
    raise exception 'service_role cannot execute the reconciliation apply function';
  end if;

  -- 3 · Both identity indexes exist.
  select count(*) into v_n from pg_catalog.pg_indexes
   where schemaname = 'public' and indexname = 'sn_observations_contract_identity_uidx';
  if v_n <> 1 then
    raise exception 'the contractual observation identity index is missing';
  end if;

  select count(*) into v_n from pg_catalog.pg_indexes
   where schemaname = 'public' and indexname = 'sn_monitoring_runs_operation_uidx';
  if v_n <> 1 then
    raise exception 'the reconciliation operation identity index is missing';
  end if;

  -- 4 · REGRESSION: 20260818000000's administrator-only posture is intact, so
  --     the audit sink this function writes to is still not member-readable.
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'structured_note_monitoring_runs'
      and coalesce(qual, '') not like '%nmi_is_administrator%'
  ) then
    raise exception 'structured_note_monitoring_runs no longer administrator-only';
  end if;
end $$;
