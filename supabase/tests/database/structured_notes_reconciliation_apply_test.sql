-- R13.7B3.1 — EXECUTABLE validation of the atomic reconciliation apply mechanism.
--
-- WHY THIS FILE EXISTS. The claim being made is "either every core financial
-- mutation succeeds or none of them persist". That is a statement about real
-- PostgreSQL transaction behaviour, and no TypeScript test can establish it: a
-- source scan can show the function calls one RPC, but only a database can show
-- that a failure half-way through leaves the book byte-identical.
--
-- HOW THE ROLLBACK PROOF IS MADE NON-VACUOUS. The failing case is deliberately
-- one that fails LATE — a packet whose expectedCounts are wrong, so the function
-- inserts rows, cancels rows, corrects a note and writes an audit record, and
-- only THEN raises on the postcondition. If the transaction were not atomic,
-- those mutations would still be there afterwards. The assertions after each
-- `throws_ok` re-read every table and prove they are not.
--
-- `throws_ok` runs its query inside a plpgsql exception block, which is a real
-- subtransaction: catching the error rolls back everything the function did,
-- exactly as a failed RPC call would.
--
-- All identities and records are throwaway rows created inside this transaction
-- and rolled back at the end. No production identity, ISIN, or financial value
-- appears anywhere in this file.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- ═══════════════════════════════════════════════════════════════════════════
-- 0 · Fixtures — the exact defective shape the reconciliation exists to fix
-- ═══════════════════════════════════════════════════════════════════════════
-- Both notes were imported by a parser that emitted NO autocall observations,
-- so each carries coupon rows plus a final row and nothing else.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('c1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'recon_owner@test.invalid', 'x', now(), now(), now()),
       ('c2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'recon_member@test.invalid', 'x', now(), now(), now()),
       ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'recon_ungranted@test.invalid', 'x', now(), now(), now());

insert into public.user_profiles (id, username, email, display_name, role, portfolio_principal) values
  ('c1111111-1111-1111-1111-111111111111', 'recon_admin',  'recon_owner@test.invalid',  'Recon Admin',  'administrator', null),
  ('c2222222-2222-2222-2222-222222222222', 'recon_member', 'recon_member@test.invalid', 'Recon Member', 'user',          'jaime'),
  ('c3333333-3333-3333-3333-333333333333', 'recon_nogrant','recon_ungranted@test.invalid','Recon NoGrant','user',        'andres');

update public.user_profiles set activated_at = now()
 where id in ('c1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222',
              'c3333333-3333-3333-3333-333333333333')
   and activated_at is null;

insert into public.user_module_grants (user_id, module_key) values
  ('c2222222-2222-2222-2222-222222222222', 'structured_notes'),
  -- Holds a DIFFERENT module, so a denial below proves the missing
  -- structured_notes grant is the reason, not simply holding no grants at all.
  ('c3333333-3333-3333-3333-333333333333', 'markets');

-- NOTE A — will be corrected: called on its second observation date.
insert into public.structured_notes (id, user_id, isin, product_name, structure_type, currency, status, autocall_barrier_pct)
values ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
        'XS0000000AAA', 'Fixture Note A', 'autocall', 'USD', 'active', 1.0);

-- NOTE B — will be examined and deliberately left unchanged.
insert into public.structured_notes (id, user_id, isin, product_name, structure_type, currency, status, autocall_barrier_pct)
values ('cccc0002-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111111',
        'XS0000000BBB', 'Fixture Note B', 'autocall', 'USD', 'active', 1.0);

insert into public.structured_note_observations
  (note_id, user_id, observation_number, observation_type, valuation_date, status)
values
  -- Note A: three coupon dates + a final. The middle one is the calling date,
  -- and its coupon already settled — it must survive the correction.
  ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 1, 'coupon', '2026-01-05', 'coupon_paid'),
  ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 2, 'coupon', '2026-04-06', 'coupon_paid'),
  ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 3, 'coupon', '2026-07-06', 'scheduled'),
  ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111', 4, 'final',  '2026-10-05', 'scheduled'),
  -- Note B: nothing has happened yet.
  ('cccc0002-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111111', 1, 'coupon', '2027-01-05', 'scheduled'),
  ('cccc0002-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111111', 2, 'coupon', '2027-04-05', 'scheduled'),
  ('cccc0002-0000-0000-0000-000000000002', 'c1111111-1111-1111-1111-111111111111', 3, 'final',  '2027-07-05', 'scheduled');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role postgres';
end $$;

-- The reviewed packet, as the orchestrator would build it. `op` and the
-- expectedCounts are parameterised so the break tests can vary exactly one
-- thing and leave everything else identical.
create or replace function pg_temp.packet(
  op text,
  n_insert int default 5,
  n_autocall int default 1,
  n_cancel int default 3,
  n_corrected int default 1,
  a_expected_status text default 'active'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'operationId', op,
    'actor', 'pgTAP fixture operator',
    'reasonCode', 'r13_7_missed_autocall_detection',
    'asOf', '2026-09-07',
    'packetHash', 'fixturehash-' || op,
    'expectedCounts', jsonb_build_object(
      'observationsInserted', n_insert,
      'observationsAutocalled', n_autocall,
      'observationsCancelled', n_cancel,
      'notesCorrected', n_corrected,
      'notesUnchanged', 1
    ),
    'notes', jsonb_build_array(
      jsonb_build_object(
        'noteId', 'cccc0001-0000-0000-0000-000000000001',
        'isin', 'XS0000000AAA',
        'expectedStatus', a_expected_status,
        'expectedArchivedAt', null::text,
        'correctedStatus', 'autocalled',
        'correctedArchivedAt', '2026-04-06T00:00:00.000Z',
        'callDate', '2026-04-06',
        'redemptionDate', '2026-04-13',
        'settlement', 'settled',
        'classification', 'confirmed_missed_autocall',
        'insertObservations', jsonb_build_array(
          jsonb_build_object('observationType','autocall','observationNumber',1,'valuationDate','2026-01-05','autocallBarrierPct',1.0),
          jsonb_build_object('observationType','autocall','observationNumber',2,'valuationDate','2026-04-06','autocallBarrierPct',1.0,'redemptionDate','2026-04-13'),
          jsonb_build_object('observationType','autocall','observationNumber',3,'valuationDate','2026-07-06','autocallBarrierPct',1.0)
        ),
        'autocallResult', jsonb_build_object(
          'valuationDate','2026-04-06',
          'observedSource','persisted_snapshot',
          'worstPerformerTicker','FIX Index',
          'observedLevels', jsonb_build_object('FIX Index', 101.5),
          'reviewRequired', false
        ),
        'cancelObservations', jsonb_build_array(
          jsonb_build_object('observationType','autocall','valuationDate','2026-07-06','expectedStatus','scheduled'),
          jsonb_build_object('observationType','coupon','valuationDate','2026-07-06','expectedStatus','scheduled'),
          jsonb_build_object('observationType','final','valuationDate','2026-10-05','expectedStatus','scheduled')
        ),
        'preserveObservations', jsonb_build_array(
          jsonb_build_object('observationType','coupon','valuationDate','2026-04-06','expectedStatus','coupon_paid')
        ),
        'evidence', jsonb_build_array()
      ),
      jsonb_build_object(
        'noteId', 'cccc0002-0000-0000-0000-000000000002',
        'isin', 'XS0000000BBB',
        'expectedStatus', 'active',
        'expectedArchivedAt', null::text,
        'correctedStatus', 'active',
        'correctedArchivedAt', null::text,
        'callDate', null::text,
        'settlement', 'unknown',
        'classification', 'not_called',
        'insertObservations', jsonb_build_array(
          jsonb_build_object('observationType','autocall','observationNumber',1,'valuationDate','2027-01-05','autocallBarrierPct',1.0),
          jsonb_build_object('observationType','autocall','observationNumber',2,'valuationDate','2027-04-05','autocallBarrierPct',1.0)
        ),
        'autocallResult', null::jsonb,
        'cancelObservations', jsonb_build_array(),
        'preserveObservations', jsonb_build_array(),
        'evidence', jsonb_build_array()
      )
    )
  );
$$;

select pg_temp.as_super();


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · BASELINE — the defect is present
-- ═══════════════════════════════════════════════════════════════════════════

select is((select count(*)::int from public.structured_note_observations
            where observation_type = 'autocall'
              and note_id in ('cccc0001-0000-0000-0000-000000000001','cccc0002-0000-0000-0000-000000000002')),
          0, 'baseline: the fixture notes carry NO autocall observations at all');

select is((select count(*)::int from public.structured_note_monitoring_runs where run_type = 'backfill'),
          0, 'baseline: no backfill audit record exists');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · § 15 O/P/Q · AUTHORIZATION — only service_role may execute
-- ═══════════════════════════════════════════════════════════════════════════

select ok(not has_function_privilege('anon',
            'public.nmi_apply_structured_note_reconciliation(jsonb)', 'EXECUTE'),
          'anon holds no EXECUTE on the apply function');

select ok(not has_function_privilege('authenticated',
            'public.nmi_apply_structured_note_reconciliation(jsonb)', 'EXECUTE'),
          'authenticated holds no EXECUTE on the apply function');

select ok(has_function_privilege('service_role',
            'public.nmi_apply_structured_note_reconciliation(jsonb)', 'EXECUTE'),
          'service_role CAN execute the apply function');

select pg_temp.as_anon();
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation('{}'::jsonb) $$,
  '42501', null, 'anon calling the apply function is refused outright');

select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation('{}'::jsonb) $$,
  '42501', null, 'a structured_notes-granted member cannot execute the apply function');

select pg_temp.as_super();

-- § 15 R — the function contains no dynamic SQL, so no packet value can ever
-- become an identifier. Asserted against the stored source, not the file.
select ok((select position('execute format' in lower(p.prosrc)) = 0
             from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'nmi_apply_structured_note_reconciliation'),
          'the apply function builds no dynamic SQL from packet input');

select ok(not (select prosecdef from pg_catalog.pg_proc p
                join pg_catalog.pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'nmi_apply_structured_note_reconciliation'),
          'the apply function is SECURITY INVOKER (no standing privilege escalation)');


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · § 15 N · MALFORMED PACKETS ARE REFUSED
-- ═══════════════════════════════════════════════════════════════════════════

select throws_ok($$ select public.nmi_apply_structured_note_reconciliation('[]'::jsonb) $$,
  'P0001', null, 'a non-object packet is refused');

select throws_ok($$ select public.nmi_apply_structured_note_reconciliation('{"operationId":""}'::jsonb) $$,
  'P0001', null, 'an empty operationId is refused');

select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(
       jsonb_build_object('operationId','x','actor','a','reasonCode','r','packetHash','h',
                          'expectedCounts', jsonb_build_object(), 'notes', jsonb_build_array())) $$,
  'P0001', null, 'a packet with no notes is refused');

select is((select count(*)::int from public.structured_note_observations where observation_type = 'autocall'),
          0, 'no malformed packet wrote anything');


-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · § 15 K/L/M · STALE PACKETS ARE REFUSED
-- ═══════════════════════════════════════════════════════════════════════════

-- K — the note is no longer in the status the packet reviewed.
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('stale-status', 5, 1, 3, 1, 'matured')) $$,
  'P0001', null, 'a packet whose expected note status no longer matches is refused');

-- L — a row the packet intends to cancel has moved on since review.
update public.structured_note_observations set status = 'coupon_missed'
 where note_id = 'cccc0001-0000-0000-0000-000000000001' and valuation_date = '2026-07-06';
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('stale-obs')) $$,
  'P0001', null, 'a packet whose cancel target changed status is refused');
update public.structured_note_observations set status = 'scheduled'
 where note_id = 'cccc0001-0000-0000-0000-000000000001' and valuation_date = '2026-07-06';

-- M — a row the packet promised to preserve is missing//changed.
update public.structured_note_observations set status = 'scheduled'
 where note_id = 'cccc0001-0000-0000-0000-000000000001' and valuation_date = '2026-04-06' and observation_type = 'coupon';
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('stale-preserve')) $$,
  'P0001', null, 'a packet whose preserved coupon row changed status is refused');
update public.structured_note_observations set status = 'coupon_paid'
 where note_id = 'cccc0001-0000-0000-0000-000000000001' and valuation_date = '2026-04-06' and observation_type = 'coupon';

-- J — an autocall row already exists for a date the packet wants to insert.
insert into public.structured_note_observations
  (note_id, user_id, observation_number, observation_type, valuation_date, status)
values ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
        99, 'autocall', '2026-01-05', 'scheduled');
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('dupe-insert')) $$,
  'P0001', null, 'a packet that would duplicate an existing autocall identity is refused');
delete from public.structured_note_observations
 where note_id = 'cccc0001-0000-0000-0000-000000000001' and observation_number = 99 and observation_type = 'autocall';

select is((select count(*)::int from public.structured_note_observations where observation_type = 'autocall'),
          0, 'no stale packet wrote an autocall row');
select is((select status from public.structured_notes where id = 'cccc0001-0000-0000-0000-000000000001'),
          'active', 'no stale packet changed the note status');
select is((select count(*)::int from public.structured_note_monitoring_runs where run_type = 'backfill'),
          0, 'no stale packet wrote an audit record');


-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · § 15 S / § 16 · LATE POSTCONDITION FAILURE ROLLS EVERYTHING BACK
-- ═══════════════════════════════════════════════════════════════════════════
-- The packet below is valid in every precondition and fails only at the final
-- count check — AFTER 5 inserts, 1 autocall update, 3 cancellations, a note
-- correction and an audit insert have all executed. This is the non-vacuous
-- rollback proof: if the mechanism were not atomic, all of that would persist.

select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('late-fail', 4)) $$,
  'P0001', null, 'a packet whose expected counts disagree with reality raises at the postcondition');

select is((select count(*)::int from public.structured_note_observations where observation_type = 'autocall'),
          0, 'ROLLBACK: not one of the 5 inserted autocall rows survived the late failure');
select is((select count(*)::int from public.structured_note_observations where status = 'cancelled'),
          0, 'ROLLBACK: not one of the 3 cancellations survived the late failure');
select is((select status from public.structured_notes where id = 'cccc0001-0000-0000-0000-000000000001'),
          'active', 'ROLLBACK: the note correction did not survive the late failure');
select is((select archived_at from public.structured_notes where id = 'cccc0001-0000-0000-0000-000000000001'),
          null, 'ROLLBACK: archived_at did not survive the late failure');
select is((select count(*)::int from public.structured_note_monitoring_runs where run_type = 'backfill'),
          0, 'ROLLBACK: the audit record did not survive the late failure');
select is((select status from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001'
              and observation_type = 'coupon' and valuation_date = '2026-04-06'),
          'coupon_paid', 'ROLLBACK: the call-date coupon result is untouched');


-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · § 15 A–G · THE SUCCESSFUL ATOMIC APPLY
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('op-success')) ->> 'status'),
  'applied', 'A: a well-formed packet applies and reports "applied"');

-- B · exact insert counts
select is((select count(*)::int from public.structured_note_observations
            where observation_type = 'autocall' and note_id = 'cccc0001-0000-0000-0000-000000000001'),
          3, 'B: note A received exactly 3 autocall rows');
select is((select count(*)::int from public.structured_note_observations
            where observation_type = 'autocall' and note_id = 'cccc0002-0000-0000-0000-000000000002'),
          2, 'B: note B received exactly 2 autocall rows');

-- C · exact cancellation counts
select is((select count(*)::int from public.structured_note_observations where status = 'cancelled'),
          3, 'C: exactly 3 post-call observations are cancelled');
select is((select count(*)::int from public.structured_note_observations
            where status = 'cancelled' and note_id = 'cccc0002-0000-0000-0000-000000000002'),
          0, 'C: the unchanged note had nothing cancelled');

-- D · exact note-state corrections
select is((select status from public.structured_notes where id = 'cccc0001-0000-0000-0000-000000000001'),
          'autocalled', 'D: note A is corrected to autocalled');
select is((select (archived_at at time zone 'UTC')::date from public.structured_notes
            where id = 'cccc0001-0000-0000-0000-000000000001'),
          '2026-04-06'::date, 'D: note A archived_at is the contractual call date');

-- E · the unchanged note is genuinely unchanged
select is((select status from public.structured_notes where id = 'cccc0002-0000-0000-0000-000000000002'),
          'active', 'E: note B remains active');
select is((select archived_at from public.structured_notes where id = 'cccc0002-0000-0000-0000-000000000002'),
          null, 'E: note B remains un-archived');

-- F · the call-date coupon result is preserved
select is((select status from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001'
              and observation_type = 'coupon' and valuation_date = '2026-04-06'),
          'coupon_paid', 'F: a coupon is not lost because the note also called');

-- the call-date autocall row carries the result and the evidence
select is((select status from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001'
              and observation_type = 'autocall' and valuation_date = '2026-04-06'),
          'autocalled', 'the call-date autocall row is marked autocalled');
select ok((select autocall_eligible from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001'
              and observation_type = 'autocall' and valuation_date = '2026-04-06'),
          'the call-date autocall row records autocall_eligible = true');
select is((select worst_performer_ticker from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001'
              and observation_type = 'autocall' and valuation_date = '2026-04-06'),
          'FIX Index', 'the binding leg supplied by the packet is recorded');

-- pre-call autocall rows stay scheduled: the packet claims nothing about them
select is((select status from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001'
              and observation_type = 'autocall' and valuation_date = '2026-01-05'),
          'scheduled', 'a pre-call autocall row is written but claims no outcome');

-- G · exactly one audit row, carrying the operation identity and counts
select is((select count(*)::int from public.structured_note_monitoring_runs where run_type = 'backfill'),
          1, 'G: exactly one backfill audit record was written');
select is((select metadata ->> 'operationId' from public.structured_note_monitoring_runs where run_type = 'backfill'),
          'op-success', 'G: the audit record carries the operation id');
select is((select metadata ->> 'actor' from public.structured_note_monitoring_runs where run_type = 'backfill'),
          'pgTAP fixture operator', 'G: the audit record names the acting operator');
select is((select metadata ->> 'packetHash' from public.structured_note_monitoring_runs where run_type = 'backfill'),
          'fixturehash-op-success', 'G: the audit record stores the packet hash');
select is((select (metadata -> 'counts' ->> 'observationsInserted')::int
             from public.structured_note_monitoring_runs where run_type = 'backfill'),
          5, 'G: the audit record records the exact insert count');
select is((select jsonb_array_length(metadata -> 'notes')
             from public.structured_note_monitoring_runs where run_type = 'backfill'),
          2, 'G: the audit record covers EVERY note examined, including the unchanged one');
select is((select metadata -> 'notes' -> 1 ->> 'settlement'
             from public.structured_note_monitoring_runs where run_type = 'backfill'),
          'unknown', 'G: settlement is recorded for audit but never persisted as note state');

-- § 11 — settlement is not a column, and nothing here invented one.
select hasnt_column('public', 'structured_notes', 'settlement_status',
  'settlement is still derived, not persisted as a second state model');


-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · § 15 H/I · IDEMPOTENCY AND CONCURRENT DUPLICATE PROTECTION
-- ═══════════════════════════════════════════════════════════════════════════

select is(
  (select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('op-success')) ->> 'status'),
  'already_applied', 'H: re-running the SAME operation reports already_applied');

select is((select count(*)::int from public.structured_note_observations where observation_type = 'autocall'),
          5, 'H: the retry inserted no duplicate autocall rows');
select is((select count(*)::int from public.structured_note_monitoring_runs where run_type = 'backfill'),
          1, 'H: the retry wrote no second audit record');
select is((select count(*)::int from public.structured_note_observations where status = 'cancelled'),
          3, 'H: the retry repeated no state transition');

-- Reusing an operation id for DIFFERENT content is a mistake, not a retry.
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(
       jsonb_set(pg_temp.packet('op-success'), '{packetHash}', '"a-different-hash"'::jsonb)) $$,
  'P0001', null, 'H: the same operation id with a different packet hash is refused');

-- I · The durable backstop that makes two concurrent applies impossible even if
--     the advisory lock were removed: the database itself refuses a second
--     audit row for one operation id.
select throws_ok(
  $$ insert into public.structured_note_monitoring_runs (run_type, status, metadata)
     values ('backfill', 'success', '{"operationId":"op-success"}'::jsonb) $$,
  '23505', null, 'I: a second audit row for the same operation id violates the unique index');

-- and the function does take a transaction-scoped advisory lock before deciding
select ok((select prosrc from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'nmi_apply_structured_note_reconciliation')
          like '%pg_advisory_xact_lock%',
          'I: the apply function serializes on a transaction-scoped advisory lock');

-- A genuinely different operation on an already-corrected book is refused by the
-- pre-state check rather than applied twice under a new id.
select throws_ok(
  $$ select public.nmi_apply_structured_note_reconciliation(pg_temp.packet('op-second')) $$,
  'P0001', null, 'a new operation id cannot re-apply an already-corrected note');


-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · § 5 · CONTRACTUAL IDENTITY IS ENFORCED BY THE DATABASE
-- ═══════════════════════════════════════════════════════════════════════════

select is((select count(*)::int from pg_catalog.pg_indexes
            where schemaname = 'public' and indexname = 'sn_observations_contract_identity_uidx'),
          1, 'the contractual observation identity index exists');

select throws_ok(
  $$ insert into public.structured_note_observations
       (note_id, user_id, observation_number, observation_type, valuation_date, status)
     values ('cccc0001-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
             98, 'autocall', '2026-04-06', 'scheduled') $$,
  '23505', null, 'a duplicate (note, type, valuation date) observation is impossible');

-- The index is scoped by TYPE, so a coupon and an autocall may share a date —
-- which is exactly what a reconciled schedule looks like.
select is((select count(*)::int from public.structured_note_observations
            where note_id = 'cccc0001-0000-0000-0000-000000000001' and valuation_date = '2026-04-06'),
          2, 'a coupon and an autocall legitimately coexist on one valuation date');


-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · § 12 · THE AUDIT SINK STAYS ADMINISTRATOR-ONLY
-- ═══════════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.structured_note_monitoring_runs), 0,
  'a structured_notes-granted member cannot read the reconciliation audit record');

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.structured_note_monitoring_runs where run_type = 'backfill'), 1,
  'an administrator CAN read the reconciliation audit record');

select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.structured_note_monitoring_runs $$,
  '42501', null, 'anon cannot read the reconciliation audit record at all');

select pg_temp.as_super();


-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · R13.7B3.2 · HISTORICAL-CORRECTION NOTIFICATION IDENTITY AND AUDIENCE
-- ═══════════════════════════════════════════════════════════════════════════
-- The announcement step runs AFTER the atomic financial transaction, so it can
-- be re-run — after a crash, after a partial success, or by two operators at
-- once. These assertions are what make "run it again" safe, and what keep the
-- announcement administrator-only.

select is((select count(*)::int from pg_catalog.pg_indexes
            where schemaname = 'public'
              and indexname = 'notifications_historical_correction_identity_uidx'),
          1, 'the historical-correction identity index exists');

select is((select count(*)::int
             from pg_catalog.pg_index i
             join pg_catalog.pg_class c on c.oid = i.indexrelid
            where c.relname = 'notifications_historical_correction_identity_uidx'
              and i.indisunique and i.indpred is not null),
          1, 'that index is UNIQUE and PARTIAL — it constrains only this one type');

-- One correction for the note this suite just corrected, exactly as the
-- orchestrator writes it: administrator-only, in-platform, no recipient.
insert into public.notifications
  (notification_type, title, body, link_url, related_entity_type, related_entity_id, metadata)
values (
  'structured_note_historical_correction',
  'Historical correction — XS0000000AAA',
  'XS0000000AAA was contractually called on 2026-04-06. This is a historical reconciliation, not a new call event.',
  '/structured-notes/cccc0001-0000-0000-0000-000000000001',
  'structured_note',
  'cccc0001-0000-0000-0000-000000000001',
  '{"correctionKey":"op-success:cccc0001-0000-0000-0000-000000000001","operationId":"op-success","historicalCorrection":true}'::jsonb
);

select is((select count(*)::int from public.notifications), 1, 'the correction was created');

-- A real email recipient exists throughout, so every "member sees zero" below is
-- a denial rather than an empty table. It is never used: a correction has no
-- code path that could reach it.
insert into public.notification_recipients (email, label, active)
values ('recon-fixture-recipient@test.invalid', 'Fixture', true);

-- G · A retry cannot duplicate it. This is the hard guarantee behind the
--     writer's "23505 means already-created" path.
select throws_ok(
  $$ insert into public.notifications
       (notification_type, title, related_entity_type, related_entity_id, metadata)
     values ('structured_note_historical_correction', 'Retry with different words',
             'structured_note', 'cccc0001-0000-0000-0000-000000000001',
             '{"correctionKey":"op-success:cccc0001-0000-0000-0000-000000000001","operationId":"op-success"}'::jsonb) $$,
  '23505', null, 'G: re-announcing the same operation+note is impossible, whatever the wording');

-- The SAME note corrected by a LATER, different reconciliation is a real second
-- announcement — the identity is per-operation, not per-note.
select lives_ok(
  $$ insert into public.notifications
       (notification_type, title, related_entity_type, related_entity_id, metadata)
     values ('structured_note_historical_correction', 'Historical correction — later operation',
             'structured_note', 'cccc0001-0000-0000-0000-000000000001',
             '{"correctionKey":"op-later:cccc0001-0000-0000-0000-000000000001","operationId":"op-later"}'::jsonb) $$,
  'the same note under a DIFFERENT operation is a distinct, allowed correction');

-- A live alert type is deliberately NOT constrained: a note warns on every
-- observation, and the second warning is a real event, not a duplicate.
select lives_ok(
  $$ insert into public.notifications (notification_type, title, related_entity_type, related_entity_id, metadata)
     values ('structured_note_potential_autocall', 'T-1 warning',
             'structured_note', 'cccc0001-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  'a live warning may repeat');
select lives_ok(
  $$ insert into public.notifications (notification_type, title, related_entity_type, related_entity_id, metadata)
     values ('structured_note_potential_autocall', 'T-1 warning again',
             'structured_note', 'cccc0001-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  'and again — the identity index does not touch the live types');

-- K–O · Who may read it.
select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.notifications
            where notification_type = 'structured_note_historical_correction'),
          2, 'K: an administrator CAN read historical corrections');

select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.notifications), 0,
  'L: a structured_notes-GRANTED member cannot read the correction feed at all');
select is((select count(*)::int from public.notifications
            where notification_type = 'structured_note_historical_correction'),
          0, 'O: and the badge/count query leaks nothing either — it reads the same RLS-filtered table');

select pg_temp.as_user('c3333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.notifications), 0,
  'M: an ungranted member cannot read the correction feed');

select pg_temp.as_anon();
select throws_ok($$ select count(*) from public.notifications $$,
  '42501', null, 'N: anon cannot read the correction feed at all');

-- A member cannot write one either — there is no user-facing insert path.
select pg_temp.as_user('c2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ insert into public.notifications (notification_type, title) values ('structured_note_historical_correction', 'forged') $$,
  '42501', null, 'a member cannot forge a historical correction');

-- Module grants are not an audience mechanism: the email recipient list stays
-- administrator-only, so a correction cannot acquire a recipient by a grant.
-- A real recipient row exists (inserted below as postgres), so "the member sees
-- zero" is a denial rather than an empty table.
select is((select count(*)::int from public.notification_recipients), 0,
  'a granted member still cannot read the email recipient list');

select pg_temp.as_user('c1111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.notification_recipients), 1,
  'an administrator CAN read it — so the member''s zero above is a denial, not an empty table');

select pg_temp.as_super();

select * from finish();
rollback;
