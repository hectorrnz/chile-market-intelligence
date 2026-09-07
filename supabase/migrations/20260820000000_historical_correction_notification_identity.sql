-- R13.7B3.2 — DETERMINISTIC IDENTITY FOR HISTORICAL-CORRECTION NOTIFICATIONS.
--
-- The reconciliation apply function (20260819000000) commits the financial
-- correction atomically. Announcing it is a SEPARATE, retryable step, because a
-- notification failure must never roll back a correct book. That separation is
-- right, but it means the notification writer can be run twice — after a crash,
-- after a partial success, or by two operators at once — and "run it again"
-- must not produce a second copy of an announcement that eight people have
-- already read.
--
-- `notifications` has no uniqueness of any kind today: a primary key and two
-- non-unique indexes (20260713000000). There is therefore no existing natural
-- key to reuse, and this adds the narrowest one that solves it.
--
--
-- WHAT THE IDENTITY IS
-- ────────────────────
--   one reconciliation operation + one corrected note + this type = one row
--
-- carried as `metadata->>'correctionKey'` (`<operationId>:<noteId>`, built by
-- src/lib/structuredNotes/historicalCorrectionNotifications.ts).
--
-- Deliberately NOT the message text. Text is presentation: rewording a sentence
-- must never make an already-delivered correction look like a new event, and
-- hashing the body would do exactly that. Deliberately not `related_entity_id`
-- alone either — a note legitimately CAN be corrected by a later, different
-- reconciliation, and that second correction is a real notification.
--
-- SCOPED BY TYPE, so this constrains nothing else in the feed. Live alerts
-- ('structured_note_potential_autocall', 'structured_note_called') recur by
-- design — the same note warns on every observation — and must stay unique-free.
--
-- GENERIC: no ISIN, no note id, no operation id appears here. This migration
-- describes a shape; the rows are runtime data.
--
-- Idempotent. Apply via Supabase Dashboard → SQL Editor.

-- =============================================================================
-- 1 · GUARD — refuse to build the index over data that already violates it
-- =============================================================================
-- Production holds zero notifications today, so this cannot fire there; it
-- exists so a database that HAS duplicates fails with a readable message
-- instead of an opaque index-build error.

do $$
declare
  v_dupes int;
begin
  if to_regclass('public.notifications') is null then
    raise exception 'expected table public.notifications is missing';
  end if;

  select count(*) into v_dupes
  from (
    select 1
    from public.notifications
    where notification_type = 'structured_note_historical_correction'
      and jsonb_exists(metadata, 'correctionKey')
    group by metadata ->> 'correctionKey'
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'cannot enforce historical-correction identity: % correctionKey value(s) are already duplicated — resolve the data first',
      v_dupes;
  end if;
end $$;


-- =============================================================================
-- 2 · THE IDENTITY INDEX
-- =============================================================================
-- `jsonb_exists(...)` rather than the `?` operator: identical semantics, but `?`
-- is a parameter placeholder to several drivers, and this predicate has to
-- survive being replayed by whatever applies the chain.

create unique index if not exists notifications_historical_correction_identity_uidx
  on public.notifications ((metadata ->> 'correctionKey'))
  where notification_type = 'structured_note_historical_correction'
    and jsonb_exists(metadata, 'correctionKey');


-- =============================================================================
-- 3 · POSTCONDITIONS, executed in-database at apply time
-- =============================================================================

do $$
declare
  n int;
begin
  -- 1 · The index exists, is UNIQUE, and is PARTIAL (scoped to this one type).
  select count(*) into n from pg_catalog.pg_indexes
   where schemaname = 'public' and indexname = 'notifications_historical_correction_identity_uidx';
  if n <> 1 then
    raise exception 'the historical-correction identity index is missing';
  end if;

  select count(*) into n
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
   where c.relname = 'notifications_historical_correction_identity_uidx'
     and i.indisunique and i.indpred is not null;
  if n <> 1 then
    raise exception 'the historical-correction identity index must be UNIQUE and PARTIAL';
  end if;

  -- 2 · REGRESSION: the live alert types stay unconstrained. A note warns on
  --     every observation, and a second warning is a real event, not a duplicate.
  if exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_class t on t.oid = i.indrelid
    join pg_catalog.pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname = 'public' and t.relname = 'notifications' and i.indisunique
      and c.relname <> 'notifications_historical_correction_identity_uidx'
      and c.relname <> 'notifications_pkey'
  ) then
    raise exception 'an unexpected unique index exists on public.notifications';
  end if;

  -- 3 · REGRESSION: 20260818000000's administrator-only posture is untouched.
  --     This migration adds an identity, not an audience.
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'notifications';
  if n <> 1 then
    raise exception 'public.notifications must carry exactly one policy, found %', n;
  end if;

  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'notifications'
     and cmd = 'SELECT' and qual like '%nmi_is_administrator%';
  if n <> 1 then
    raise exception 'public.notifications lost its administrator-gated SELECT policy';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.notifications', 'SELECT') then
    raise exception 'anon can read public.notifications';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'DELETE') then
    raise exception 'authenticated holds a write privilege on public.notifications';
  end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.notifications', 'INSERT') then
    raise exception 'service_role cannot write public.notifications — the correction writer would fail';
  end if;

  -- 4 · REGRESSION: recipients (the EMAIL list) stay administrator-only, and a
  --     module grant still cannot make anyone a recipient.
  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'notification_recipients'
     and (coalesce(qual, '') like '%nmi_is_administrator%'
          or coalesce(with_check, '') like '%nmi_is_administrator%');
  if n < 4 then
    raise exception 'notification_recipients lost administrator-only coverage (% policies)', n;
  end if;
end $$;
