-- D0C - THE LAST-ADMINISTRATOR GUARD BECOMES CONCURRENCY-SAFE.
--
-- 20260817000000 made removing the last administrator unrepresentable through a
-- BEFORE UPDATE OR DELETE trigger that tests the RESULTING POPULATION rather than
-- the identity of the caller. That shape is right and is kept verbatim here. What
-- it lacked was serialisation, and the hole is a textbook write skew:
--
--   T1: update A -> guard counts other active administrators -> sees B -> allows
--   T2: update B -> guard counts other active administrators -> sees A -> allows
--   T1: commit
--   T2: commit                       -> ZERO active administrators
--
-- Under READ COMMITTED neither transaction can see the other's uncommitted
-- demotion, so both guards answer truthfully about a world that stops being true
-- the moment the other commits. Nothing in the trigger made the two decisions
-- take turns. The invariant held against every SEQUENTIAL path and against none
-- of the concurrent ones.
--
-- It was not reachable while Production held a single administrator - the first
-- removal has no second administrator to race with. It becomes reachable the
-- moment a second administrator exists, which is exactly what D0B creates. That
-- is why this lands BEFORE the real administrator is provisioned rather than
-- after.
--
--
-- WHY AN ADVISORY LOCK AND NOT `SELECT ... FOR UPDATE`
-- ---------------------------------------------------
-- The obvious mechanism - locking the other administrator rows before counting
-- them - has a hole precisely where this guard is load-bearing: it can only lock
-- rows the counting transaction can SEE. A row concurrently being promoted INTO
-- the administrator set, or one whose demotion is still uncommitted, is not a row
-- this transaction can lock, so `FOR UPDATE` would serialise some schedules and
-- silently miss others while reading as though it covered them all.
--
-- A transaction-scoped advisory lock is keyed on the POPULATION rather than on
-- rows, so it serialises the decision itself. Every mutation that could empty the
-- set takes the same key, therefore they take turns; and it is released on COMMIT
-- or ABORT alike, so a refused or failed mutation never strands it.
--
--
-- WHY THE COUNT IS NOT LEFT ON A STALE SNAPSHOT
-- --------------------------------------------
-- Taking a lock is only half of it. The decisive `select count(*)` must observe
-- the state the winner LEFT BEHIND, not the state the loser saw when its own
-- statement began.
--
-- It does, because `nmi_guard_last_administrator` is a VOLATILE PL/pgSQL function.
-- PostgreSQL gives STABLE and IMMUTABLE functions the snapshot of the calling
-- query, but a VOLATILE function takes a FRESH snapshot at the start of each
-- query it executes. The lock is acquired first and the count runs afterwards, so
-- by the time the loser's count executes, the winner has committed and released,
-- and the fresh snapshot sees the demotion. The loser then correctly finds zero
-- other active administrators and refuses.
--
-- This is asserted, not asserted-about: scripts/ci/lastAdminRaceProof.ts drives
-- two genuinely separate PostgreSQL backends through the interleaving above
-- against the isolated CI stack, and proves the pre-D0C function permits the
-- schedule that empties the set while this one refuses it.
--
--
-- WHY THE LOCK IS NOT TAKEN ON EVERY EDIT
-- --------------------------------------
-- The two early returns stay AHEAD of the lock, so it is acquired only on the
-- path that can actually shrink the population:
--
--   * a row that was not an active administrator returns before the lock;
--   * an active administrator that is STILL one afterwards returns before it too.
--
-- So renaming a member, editing a member's grants, promoting somebody INTO the
-- administrator set, or changing an administrator's own display name all pay
-- nothing. Only a demote, disable, un-approve, de-activate or delete of a current
-- active administrator serialises, and only against other mutations of the same
-- kind.
--
--
-- WHAT THIS MIGRATION DOES NOT CHANGE
-- -----------------------------------
-- Not the definition of an administrator, of approval, of activation, of the
-- disabled state, or of `nmi_profile_usable`. Not the refusal token, which is
-- still the bare `last_administrator` every caller already matches on. Not the
-- trigger's attachment, its timing, or which statements fire it. No RLS policy,
-- no table, no column, no grant to any role. This adds serialisation to a rule
-- that already existed and leaves the rule itself alone.

-- ==============================================================================
-- 0 . PRECONDITIONS
-- ==============================================================================
do $$
begin
  if to_regprocedure('public.nmi_profile_usable(text,timestamptz,timestamptz)') is null then
    raise exception 'public.nmi_profile_usable is missing - apply 20260817000000 first';
  end if;
  if to_regprocedure('public.nmi_guard_last_administrator()') is null then
    raise exception 'public.nmi_guard_last_administrator is missing - apply 20260817000000 first';
  end if;
end $$;


-- ==============================================================================
-- 1 . THE ONE KEY
-- ==============================================================================
-- Every caller MUST take the lock through this function. A hand-rolled key that
-- differed by so much as a separator would fail to serialise against the others
-- while looking correct - the same reasoning that gave the publication series
-- `nmi_lock_publication_series` in 20260810000000, applied to the one other
-- invariant in this schema that is about a POPULATION rather than a row.
--
-- The namespace is distinct from every other advisory key in this database, so
-- administrator mutations never contend with, or deadlock against, a portfolio
-- publication, an import operation or a structured-note reconciliation.
create or replace function public.nmi_lock_administrator_population()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nmi_administrator_population'),
    pg_catalog.hashtext('active'));
end $$;

comment on function public.nmi_lock_administrator_population() is
  'Serialises every mutation that could empty the active-administrator set. '
  'Transaction-scoped, so COMMIT and ABORT both release it. Taken by '
  'nmi_guard_last_administrator on the population-reducing path only. D0C.';


-- ==============================================================================
-- 2 . THE GUARD, SERIALISED
-- ==============================================================================
-- Byte-for-meaning the 20260817000000 function with ONE statement added, on the
-- line between "this mutation removes an active administrator" and "count who
-- else is left".
create or replace function public.nmi_guard_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_active_admin boolean;
  v_is_active_admin  boolean;
  v_others           integer;
begin
  v_was_active_admin :=
    old.role = 'administrator'
    and public.nmi_profile_usable(old.username::text, old.activated_at, old.disabled_at);

  -- Nothing to protect: this row was not an active administrator to begin with.
  -- Returns BEFORE the lock, so ordinary member edits never serialise.
  if not v_was_active_admin then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    v_is_active_admin := false;
  else
    v_is_active_admin :=
      new.role = 'administrator'
      and public.nmi_profile_usable(new.username::text, new.activated_at, new.disabled_at);
  end if;

  -- Still an active administrator afterwards - the population cannot have shrunk.
  -- Also returns BEFORE the lock: editing an administrator's display name is not
  -- a population change and must not queue behind one.
  if v_is_active_admin then
    return new;
  end if;

  -- D0C - PAST THIS LINE THE MUTATION REMOVES AN ACTIVE ADMINISTRATOR.
  --
  -- Take the population lock BEFORE counting. A concurrent removal either has not
  -- started (it will queue behind this transaction and re-count afterwards) or has
  -- already committed (this count, taking a fresh snapshot inside a VOLATILE
  -- function, sees its result). Either way the two decisions are ordered, and the
  -- second one decides against a world that has stopped moving.
  perform public.nmi_lock_administrator_population();

  select count(*) into v_others
  from public.user_profiles p
  where p.id <> old.id
    and p.role = 'administrator'
    and public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at);

  if v_others = 0 then
    -- A bare, stable token. Callers match on it; it never carries a name, an id or
    -- any other detail about who the remaining administrator is. UNCHANGED by D0C:
    -- the loser of a race is refused with exactly the refusal a sequential caller
    -- already receives, so no client needs to learn a new code.
    raise exception 'last_administrator'
      using errcode = 'raise_exception',
            hint    = 'Promote and activate another administrator before changing this one.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

comment on function public.nmi_guard_last_administrator() is
  'Refuses any mutation that would empty the active-administrator set - disable, '
  'demote, un-approve, de-activate or delete. Raises the stable token '
  '"last_administrator". Enforced in the database so the UI, the RPCs, the CLI and '
  'the service-role key are all covered. R13.6F; serialised against concurrent '
  'removals by nmi_lock_administrator_population in D0C.';


-- ==============================================================================
-- 3 . PRIVILEGES
-- ==============================================================================
-- The lock helper is infrastructure for the trigger, which runs as the definer.
-- Nothing outside the database needs to call it, and a client that could take the
-- key at will could stall every administrator mutation, so no client role gets it.
revoke all on function public.nmi_lock_administrator_population() from public, anon, authenticated;

-- Restated from 20260817000000 rather than assumed. `create or replace` keeps an
-- existing function's ACL, so this is a no-op on a database that already applied
-- that migration - and it is the correct posture on any database where this file
-- is the first to create the function.
revoke all on function public.nmi_guard_last_administrator() from public, anon, authenticated;


-- ==============================================================================
-- 4 . POSTCONDITIONS - PROVEN IN THE DATABASE, AT APPLY TIME
-- ==============================================================================
do $$
declare
  src text;
begin
  -- 4a. The guard actually takes the lock. A future edit that reverted the body
  --     to the unserialised form would fail the migration rather than quietly
  --     reopen the race.
  select p.prosrc into src
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nmi_guard_last_administrator';

  if src is null or src not like '%nmi_lock_administrator_population%' then
    raise exception 'nmi_guard_last_administrator does not take the population lock';
  end if;

  -- 4b. The lock is taken BEFORE the count, not after it. Position is the whole
  --     correctness argument: a lock acquired after the decisive read would
  --     serialise nothing.
  if position('select count(*)' in src) = 0 then
    raise exception 'nmi_guard_last_administrator no longer counts the remaining population';
  end if;
  if position('nmi_lock_administrator_population' in src) > position('select count(*)' in src) then
    raise exception 'the population lock is taken AFTER the decisive count';
  end if;

  -- 4c. The lock is transaction-scoped. A session-scoped lock would survive a
  --     rollback and strand every later administrator mutation.
  select p.prosrc into src
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nmi_lock_administrator_population';

  if src is null or src not like '%pg_advisory_xact_lock%' then
    raise exception 'nmi_lock_administrator_population does not take a transaction-scoped lock';
  end if;
  if src like '%pg_advisory_lock(%' then
    raise exception 'nmi_lock_administrator_population takes a SESSION-scoped lock';
  end if;

  -- 4d. The trigger is still attached, for both statement kinds. This migration
  --     replaces a function body; it must not have disturbed the attachment.
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'user_profiles'
      and t.tgname  = 'user_profiles_last_administrator_guard'
      and not t.tgisinternal
  ) then
    raise exception 'the last-administrator guard trigger is no longer attached';
  end if;
end $$;
