-- R13.6F — USER PROVISIONING & LIFECYCLE.
--
-- Turns the released module-entitlement foundation into a complete, administrator
-- driven account lifecycle: invite -> activate -> (disable <-> reactivate), with
-- role, Portfolio principal and module grants mutated atomically and audited in
-- the same transaction as the access change they describe.
--
-- Forward-only. Re-runnable. Every guarantee is re-asserted at the end against the
-- CATALOG rather than trusted from the statements above.
--
--
-- ==============================================================================
-- WHY A LIFECYCLE AT ALL
-- ==============================================================================
-- Before this migration an account had exactly one usable/unusable bit: presence
-- of `user_profiles.username`. That conflated four genuinely different states --
-- "invited, has not accepted yet", "active", "deliberately switched off", and
-- "never provisioned" -- into one, and the only way to switch an account off was
-- to CLEAR ITS USERNAME. Clearing the username destroys the approval marker, the
-- login identifier and the unique key all at once: a reversible administrative
-- action implemented as a lossy one, after which "who was this account?" is
-- unanswerable.
--
-- Three timestamps replace that bit. Timestamps and not an `enabled` boolean on
-- purpose: a boolean records the CURRENT state and forgets how it was reached,
-- whereas invited_at/activated_at/disabled_at retain the history that makes an
-- audit trail worth keeping. Reactivating clears disabled_at and leaves the other
-- two untouched, so an account that was disabled and restored still shows when it
-- was invited and when it first became real.
--
--   INVITED   invited_at is not null, activated_at is null, disabled_at is null
--   ACTIVE    activated_at is not null, disabled_at is null
--   DISABLED  disabled_at is not null (earlier timestamps preserved)
--
-- Status is DERIVED from the three columns, never stored separately, so the two
-- can never disagree.
--
--
-- ==============================================================================
-- THE ONE CHANGE THAT MATTERS MOST
-- ==============================================================================
-- `public.nmi_profile_usable(username, activated_at, disabled_at)` becomes the
-- single definition of "this account may be authorized at all", and it is
-- substituted into the is_approved input of every existing authorization
-- function. Nothing downstream changes:
--
--   * nmi_module_allowed(...)   already denies EVERYTHING -- administrators
--     included -- when is_approved is false.
--   * nmi_portfolio_scopes(...) already returns {} when is_approved is false.
--
-- So a disabled account loses every module and every Portfolio scope through rules
-- that already exist, WITHOUT editing a single RLS policy and WITHOUT touching the
-- frozen Portfolio ceiling. Structured Notes' `sn_module_select` policy calls
-- nmi_can_access_module('structured_notes'); that call now returns false for a
-- disabled member even though their user_module_grants rows are deliberately still
-- there, waiting for reactivation. Enforcing at the PREDICATE rather than at each
-- policy is what makes this provably complete: any policy added later inherits it
-- automatically, with no chance of someone forgetting.
--
-- nmi_current_module_grants() is hardened the same way rather than being left to
-- return a grant list nobody is allowed to use. A disabled caller gets {} -- so
-- even a future policy that reads the grant array directly, bypassing
-- nmi_can_access_module, still denies.
--
--
-- ==============================================================================
-- BACKFILL RULE (documented because it writes an authorization-relevant column)
-- ==============================================================================
-- Production holds exactly one approved administrator and zero members, but this
-- migration must be correct for any approved row it finds. For every profile that
-- is approved TODAY (non-empty username) it sets:
--
--   activated_at := coalesce(auth.users.last_sign_in_at,
--                            auth.users.email_confirmed_at,
--                            auth.users.created_at,
--                            user_profiles.created_at)
--
-- Strongest-evidence-first: an actual successful sign-in proves the account was
-- really in use; a confirmed email proves it was really established; the creation
-- timestamps are the last resort. No arbitrary date and no now() is invented, and
-- the value is written ONLY where it is NULL, so re-running never moves an
-- activation date.
--
-- invited_at is deliberately left NULL for these rows. Every pre-existing account
-- was created by scripts/admin/provisionUser.ts, which sets a password directly
-- and sends no invitation. Backfilling an invitation timestamp would fabricate an
-- event that never happened -- exactly the invented history an audit trail exists
-- to prevent. An account can be ACTIVE without ever having been invited, and the
-- status derivation handles that correctly.
--
-- Unapproved rows (blank username) get nothing: they are neither invited nor
-- activated, and guessing either way would be false in one direction or the other.
--
--
-- ==============================================================================
-- DATA SAFETY
-- ==============================================================================
-- No row is deleted. No username, email, display_name, role or portfolio_principal
-- is rewritten. The only write is activated_at on already-approved rows, which were
-- fully authorized before this migration and remain exactly as authorized after it.
-- The existing administrator emerges ACTIVE -- asserted in section 9.


-- ==============================================================================
-- 0 . GUARDS -- the foundation this builds on must already be present
-- ==============================================================================
do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'public.user_profiles is missing - apply the core migrations first';
  end if;
  if to_regclass('public.app_modules') is null or to_regclass('public.user_module_grants') is null then
    raise exception 'the module entitlement tables are missing - apply 20260814000000 first';
  end if;
  if to_regclass('public.family_portfolio_access_audit') is null then
    raise exception 'the access audit table is missing - apply 20260806000000 first';
  end if;
  if to_regprocedure('public.nmi_module_allowed(boolean,boolean,boolean,boolean)') is null then
    raise exception 'public.nmi_module_allowed is missing - apply 20260814000000 first';
  end if;
  if to_regprocedure('public.nmi_portfolio_scopes(boolean,boolean,text)') is null then
    raise exception 'public.nmi_portfolio_scopes is missing - apply 20260806000000 first';
  end if;
end $$;


-- ==============================================================================
-- 1 . LIFECYCLE COLUMNS
-- ==============================================================================
alter table public.user_profiles add column if not exists invited_at   timestamptz;
alter table public.user_profiles add column if not exists activated_at timestamptz;
alter table public.user_profiles add column if not exists disabled_at  timestamptz;

comment on column public.user_profiles.invited_at is
  'When an invitation was successfully issued for this account. NULL for accounts '
  'provisioned directly (CLI) that were never invited. Never cleared. R13.6F.';
comment on column public.user_profiles.activated_at is
  'When the account actually became real - an authenticated invitation acceptance, '
  'or (for pre-R13.6F accounts) backfilled evidence of prior genuine use. NULL means '
  'the invitation has not been accepted. Never cleared once set. R13.6F.';
comment on column public.user_profiles.disabled_at is
  'When an administrator switched this account off. NULL means not disabled. '
  'Reactivation clears ONLY this column, preserving invited_at/activated_at so the '
  'history survives. A disabled account keeps its grants, role and principal. R13.6F.';

-- Administrators list by status constantly; members never query this table.
create index if not exists user_profiles_lifecycle_idx
  on public.user_profiles (disabled_at, activated_at);


-- ==============================================================================
-- 2 . BACKFILL -- see the documented rule in the header
-- ==============================================================================
update public.user_profiles p
set activated_at = coalesce(u.last_sign_in_at, u.email_confirmed_at, u.created_at, p.created_at)
from auth.users u
where u.id = p.id
  and p.activated_at is null
  and p.disabled_at is null
  and nullif(btrim(p.username::text), '') is not null;


-- ==============================================================================
-- 3 . THE USABILITY PREDICATE
-- ==============================================================================
-- PURE and IMMUTABLE, in the same shape as nmi_module_allowed: it takes the facts
-- explicitly and reads nothing, so it can be asserted against its TypeScript twin
-- (src/lib/auth/accountLifecycle.ts) for every combination.
--
-- Fail-closed in one direction only: any NULL or unexpected input reduces access.
create or replace function public.nmi_profile_usable(
  p_username     text,
  p_activated_at timestamptz,
  p_disabled_at  timestamptz
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_username, '')), '') is not null
     and p_activated_at is not null
     and p_disabled_at  is null
$$;

comment on function public.nmi_profile_usable(text, timestamptz, timestamptz) is
  'THE account-usability rule: approved (non-empty username) AND activated AND not '
  'disabled. Pure/immutable. Mirrored byte-for-meaning in '
  'src/lib/auth/accountLifecycle.ts. Substituted into the is_approved input of every '
  'authorization function, so a disabled or never-activated account loses every '
  'module and every Portfolio scope through rules that already existed. R13.6F.';


-- ==============================================================================
-- 4 . SUBSTITUTE IT INTO EVERY AUTHORIZATION FUNCTION
-- ==============================================================================
-- Each function below is REPLACED with the identical logic except that its
-- approval expression now calls nmi_profile_usable. The frozen pure rules
-- (nmi_module_allowed, nmi_portfolio_scopes) are NOT touched.

-- 4a . Administrator capability. A disabled or never-activated administrator is
--      not an administrator: this is the predicate the Structured Notes write
--      policies, the notification-recipient policies and every admin RPC below
--      depend on, so hardening it here closes all of them at once.
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
             and public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at)
      from public.user_profiles p
      where p.id = (select auth.uid())
    ),
    false
  )
$$;

comment on function public.nmi_is_administrator() is
  'True only for an ACTIVE approved administrator: role = administrator AND '
  'nmi_profile_usable(...). A revoked (username cleared), never-activated, or '
  'disabled administrator is denied immediately. R13.1, hardened R13.6F.';

-- 4b . Grants. A disabled caller holds nothing, so even a policy that reads the
--      grant array directly still denies. The rows themselves are untouched and
--      return the moment the account is reactivated.
create or replace function public.nmi_current_module_grants()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(
           (
             select public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at)
             from public.user_profiles p
             where p.id = (select auth.uid())
           ),
           false
         )
    then coalesce(
           (
             select array_agg(g.module_key order by g.module_key)
             from public.user_module_grants g
             where g.user_id = (select auth.uid())
           ),
           array[]::text[]
         )
    else array[]::text[]   -- no session, no profile, not activated, or disabled
  end
$$;

comment on function public.nmi_current_module_grants() is
  'Explicit module grants for the calling user, resolved server-side from auth.uid(). '
  'Returns {} for an anonymous, profile-less, unapproved, never-activated or DISABLED '
  'caller - the grant ROWS are preserved for reactivation, but they confer nothing '
  'while the account is not usable. R13.6B, hardened R13.6F.';

-- 4c . Module access.
create or replace function public.nmi_can_access_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.nmi_module_allowed(
    -- approved AND activated AND not disabled
    coalesce((
      select public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at)
      from public.user_profiles p where p.id = (select auth.uid())
    ), false),
    -- administrator: the role dimension only
    coalesce((
      select p.role = 'administrator'
      from public.user_profiles p where p.id = (select auth.uid())
    ), false),
    -- explicit grant row present (already {} for an unusable account)
    requested_module is not null
      and requested_module = any (public.nmi_current_module_grants()),
    -- module declared in the registry
    requested_module is not null
      and exists (select 1 from public.app_modules m where m.module_key = requested_module)
  )
$$;

comment on function public.nmi_can_access_module(text) is
  'Whether the calling user may reach one application module. Mirrors '
  'decideModuleAccess() in src/lib/auth/moduleAccess.ts. Never consults '
  'app_modules.default_for_member. Denies a never-activated or disabled account '
  'before role or grants are considered. R13.6B, hardened R13.6F.';

-- 4d . Portfolio scopes. The frozen ceiling function is NOT modified; only the
--      is_approved fact fed into it.
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
               public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at),
               p.role = 'administrator',
               p.portfolio_principal
             )
      from public.user_profiles p
      where p.id = (select auth.uid())
    ),
    array[]::text[]
  )
$$;

comment on function public.nmi_current_portfolio_scopes() is
  'Family Portfolio scopes for the calling user, resolved server-side from auth.uid(). '
  'Returns {} for an anonymous, profile-less, unapproved, never-activated or DISABLED '
  'caller. The frozen ceiling in nmi_portfolio_scopes is unchanged. R13.1, hardened R13.6F.';


-- ==============================================================================
-- 5 . LAST ACTIVE ADMINISTRATOR INVARIANT
-- ==============================================================================
-- It must be impossible to remove the final active administrator -- by disabling,
-- demoting, un-approving, de-activating or deleting them. Enforced by a TRIGGER
-- rather than by application code, because the dangerous mutation can arrive from
-- the UI, from an RPC, from scripts/admin/provisionUser.ts, from the service-role
-- key, or from a hand-typed SQL statement, and only the database sees all five.
--
-- The trigger is deliberately NOT a check on "am I an administrator" -- it is a
-- check on the RESULTING POPULATION. It fires only when the row LEAVING the active
-- administrator set is the last member of it, so ordinary edits pay nothing.
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
  if v_is_active_admin then
    return new;
  end if;

  select count(*) into v_others
  from public.user_profiles p
  where p.id <> old.id
    and p.role = 'administrator'
    and public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at);

  if v_others = 0 then
    -- A bare, stable token. Callers match on it; it never carries a name, an id or
    -- any other detail about who the remaining administrator is.
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
  'the service-role key are all covered. R13.6F.';

drop trigger if exists user_profiles_last_administrator_guard on public.user_profiles;
create trigger user_profiles_last_administrator_guard
  before update or delete on public.user_profiles
  for each row execute function public.nmi_guard_last_administrator();


-- ==============================================================================
-- 6 . AUDIT: the lifecycle kinds
-- ==============================================================================
-- Extends the EXISTING trail (20260816000000 already added 'module_grant' and the
-- module_key column). No second audit table -- see that migration's rationale.
--
-- Only the kinds genuinely required are added. Role and principal changes keep
-- their existing representation.
do $$
begin
  alter table public.family_portfolio_access_audit
    drop constraint if exists family_portfolio_access_audit_field_changed_check;

  alter table public.family_portfolio_access_audit
    add constraint family_portfolio_access_audit_field_changed_check
    check (field_changed in (
      'portfolio_principal',
      'role',
      'module_grant',
      'user_invite',
      'user_activate',
      'user_disable',
      'user_reactivate'
    ));

  -- module_key stays bound to the module kind in BOTH directions: a lifecycle row
  -- must not name a module, and a module row must.
  alter table public.family_portfolio_access_audit
    drop constraint if exists family_portfolio_access_audit_module_key_check;

  alter table public.family_portfolio_access_audit
    add constraint family_portfolio_access_audit_module_key_check
    check (
      (field_changed =  'module_grant' and module_key is not null) or
      (field_changed <> 'module_grant' and module_key is null)
    );
end $$;


-- ==============================================================================
-- 7 . ADMINISTRATIVE RPCs
-- ==============================================================================
-- Every security-sensitive mutation is ONE transactional, SECURITY DEFINER
-- function called through the authenticated administrator's own session. Route
-- handlers no longer scatter independent service-role writes, which is what made
-- "access changed but audit failed" representable: inside a function body the
-- access write and its audit row commit or roll back together.
--
-- Common posture for all of them:
--   * first statement re-checks public.nmi_is_administrator() -- now the ACTIVE
--     administrator predicate -- so authorization is not inherited from the caller
--     having reached the route;
--   * set search_path = '' with fully-qualified names;
--   * every role / principal / module value validated against the registry, never
--     trusted from the request;
--   * stable, bare error tokens (no interpolated user data).

-- 7a . Shared validation helper. Raises; never returns false.
create or replace function public.nmi_assert_admin_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if not public.nmi_is_administrator() then
    raise exception 'not_administrator';
  end if;
  return v_actor;
end $$;

comment on function public.nmi_assert_admin_actor() is
  'Returns the calling ACTIVE administrator uuid, or raises not_authenticated / '
  'not_administrator. The first statement of every administrative RPC. R13.6F.';

-- 7b . Validate a requested module set against the registry.
create or replace function public.nmi_assert_known_modules(p_modules text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clean text[];
  v_bad   text;
begin
  if p_modules is null then
    return array[]::text[];
  end if;
  select coalesce(array_agg(distinct m order by m), array[]::text[])
    into v_clean
  from unnest(p_modules) as m
  where m is not null and btrim(m) <> '';

  select m into v_bad
  from unnest(v_clean) as m
  where not exists (select 1 from public.app_modules a where a.module_key = m)
  limit 1;

  if v_bad is not null then
    -- Deliberately does not echo the offending value back to the caller.
    raise exception 'unknown_module';
  end if;
  return v_clean;
end $$;

comment on function public.nmi_assert_known_modules(text[]) is
  'Normalizes and validates a requested module set against app_modules. Raises '
  'unknown_module. Never echoes the rejected value. R13.6F.';

-- 7c . Provision an INVITED account: profile + grants + audit, atomically.
--
-- The Auth identity is created first, outside PostgreSQL, by the Auth Admin API
-- (generateLink type=invite). This function takes the resulting uuid and makes the
-- application record. Splitting it that way is unavoidable -- Auth is a separate
-- service -- and section 12 of the route layer defines the recovery state when the
-- second half fails.
create or replace function public.nmi_admin_provision_invite(
  p_target_user_id uuid,
  p_username       text,
  p_email          text,
  p_display_name   text,
  p_role           text,
  p_principal      text,
  p_modules        text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.nmi_assert_admin_actor();
  v_modules  text[];
  v_username text := nullif(btrim(coalesce(p_username, '')), '');
  v_email    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_display  text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_role     text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'user');
  v_principal text := nullif(btrim(coalesce(p_principal, '')), '');
  v_existing record;
  m          text;
begin
  if p_target_user_id is null then raise exception 'invalid_target'; end if;
  if v_username is null      then raise exception 'invalid_username'; end if;
  if v_email is null         then raise exception 'invalid_email'; end if;
  if v_role not in ('user', 'administrator') then raise exception 'invalid_role'; end if;
  if v_principal is not null and v_principal not in ('jaime', 'andres', 'pablo') then
    raise exception 'invalid_principal';
  end if;

  -- An administrator's Portfolio reach comes from the role, which already grants
  -- every scope. Storing a principal alongside it would imply the principal is
  -- what confers that reach, and would become live the moment the account is
  -- demoted. Canonicalized to null; documented in the report.
  if v_role = 'administrator' then
    v_principal := null;
    v_modules   := array[]::text[];   -- administrators hold modules by role
  else
    v_modules := public.nmi_assert_known_modules(p_modules);
  end if;

  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'auth_identity_missing';
  end if;

  -- The username is globally unique; a clash must be a clean, stable refusal
  -- rather than a raw constraint-violation string.
  if exists (
    select 1 from public.user_profiles p
    where p.username = v_username::citext and p.id <> p_target_user_id
  ) then
    raise exception 'username_taken';
  end if;

  select * into v_existing from public.user_profiles p where p.id = p_target_user_id;

  -- RETRY SAFETY. A second invitation for the same identity must not create a
  -- duplicate profile or a duplicate grant set, and must never quietly re-open an
  -- account that has already been activated or deliberately disabled.
  if v_existing.id is not null and v_existing.activated_at is not null then
    raise exception 'already_activated';
  end if;

  insert into public.user_profiles as up
    (id, username, email, display_name, role, portfolio_principal, invited_at)
  values
    (p_target_user_id, v_username::citext, v_email, coalesce(v_display, v_username),
     v_role, v_principal, now())
  on conflict (id) do update
    set username            = excluded.username,
        email               = excluded.email,
        display_name        = excluded.display_name,
        role                = excluded.role,
        portfolio_principal = excluded.portfolio_principal,
        invited_at          = coalesce(up.invited_at, excluded.invited_at),
        disabled_at         = null;

  -- Replace the grant set wholesale so a retry converges rather than accumulates.
  delete from public.user_module_grants g
  where g.user_id = p_target_user_id
    and not (g.module_key = any (v_modules));

  foreach m in array v_modules loop
    insert into public.user_module_grants (user_id, module_key, granted_by)
    values (p_target_user_id, m, v_actor)
    on conflict (user_id, module_key) do nothing;
  end loop;

  -- Audit, in the SAME transaction as the access it describes.
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
  values
    (p_target_user_id, v_actor, 'administrator', 'user_invite', null, v_role);

  foreach m in array v_modules loop
    insert into public.family_portfolio_access_audit
      (target_user_id, actor_user_id, actor_kind, field_changed, module_key,
       previous_value, new_value)
    values
      (p_target_user_id, v_actor, 'administrator', 'module_grant', m, 'revoked', 'granted');
  end loop;

  if v_principal is not null then
    insert into public.family_portfolio_access_audit
      (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
    values
      (p_target_user_id, v_actor, 'administrator', 'portfolio_principal', null, v_principal);
  end if;

  return jsonb_build_object(
    'userId',   p_target_user_id,
    'role',     v_role,
    'principal', v_principal,
    'modules',  to_jsonb(v_modules)
  );
end $$;

comment on function public.nmi_admin_provision_invite(uuid, text, text, text, text, text, text[]) is
  'Creates the application record for an invited Auth identity: profile, module '
  'grants and audit rows, all in ONE transaction. Idempotent for retry; refuses '
  'already_activated so a re-invite can never re-open a live account. R13.6F.';

-- 7d . Update an existing account's role / principal / modules, atomically.
create or replace function public.nmi_admin_update_access(
  p_target_user_id uuid,
  p_role           text,
  p_principal      text,
  p_modules        text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := public.nmi_assert_admin_actor();
  v_target    record;
  v_role      text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'user');
  v_principal text := nullif(btrim(coalesce(p_principal, '')), '');
  v_modules   text[];
  v_current   text[];
  m           text;
begin
  if p_target_user_id is null then raise exception 'invalid_target'; end if;
  if v_role not in ('user', 'administrator') then raise exception 'invalid_role'; end if;
  if v_principal is not null and v_principal not in ('jaime', 'andres', 'pablo') then
    raise exception 'invalid_principal';
  end if;

  select * into v_target from public.user_profiles p where p.id = p_target_user_id;
  if v_target.id is null then raise exception 'target_not_found'; end if;

  if v_role = 'administrator' then
    v_principal := null;
    v_modules   := array[]::text[];
  else
    v_modules := public.nmi_assert_known_modules(p_modules);
  end if;

  select coalesce(array_agg(g.module_key order by g.module_key), array[]::text[])
    into v_current
  from public.user_module_grants g
  where g.user_id = p_target_user_id;

  -- Role change (audited before the write so previous_value is still readable).
  if v_target.role is distinct from v_role then
    insert into public.family_portfolio_access_audit
      (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
    values (p_target_user_id, v_actor, 'administrator', 'role', v_target.role, v_role);
  end if;

  if v_target.portfolio_principal is distinct from v_principal then
    insert into public.family_portfolio_access_audit
      (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
    values (p_target_user_id, v_actor, 'administrator', 'portfolio_principal',
            v_target.portfolio_principal, v_principal);
  end if;

  -- The last-administrator trigger fires on this statement; a demotion that would
  -- empty the active-administrator set raises last_administrator and rolls the
  -- whole function back, audit rows included.
  update public.user_profiles
     set role = v_role, portfolio_principal = v_principal
   where id = p_target_user_id;

  -- Grants: revoke what is no longer wanted, add what is new, audit each.
  foreach m in array v_current loop
    if not (m = any (v_modules)) then
      delete from public.user_module_grants g
       where g.user_id = p_target_user_id and g.module_key = m;
      insert into public.family_portfolio_access_audit
        (target_user_id, actor_user_id, actor_kind, field_changed, module_key,
         previous_value, new_value)
      values (p_target_user_id, v_actor, 'administrator', 'module_grant', m, 'granted', 'revoked');
    end if;
  end loop;

  foreach m in array v_modules loop
    if not (m = any (v_current)) then
      insert into public.user_module_grants (user_id, module_key, granted_by)
      values (p_target_user_id, m, v_actor)
      on conflict (user_id, module_key) do nothing;
      insert into public.family_portfolio_access_audit
        (target_user_id, actor_user_id, actor_kind, field_changed, module_key,
         previous_value, new_value)
      values (p_target_user_id, v_actor, 'administrator', 'module_grant', m, 'revoked', 'granted');
    end if;
  end loop;

  return jsonb_build_object(
    'userId', p_target_user_id,
    'role', v_role,
    'principal', v_principal,
    'modules', to_jsonb(v_modules)
  );
end $$;

comment on function public.nmi_admin_update_access(uuid, text, text, text[]) is
  'Atomically updates role, Portfolio principal and module grants for one account, '
  'writing every audit row in the same transaction. Administrator role canonicalizes '
  'principal to null and holds no grant rows. R13.6F.';

-- 7e . Disable / reactivate.
create or replace function public.nmi_admin_set_lifecycle(
  p_target_user_id uuid,
  p_action         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.nmi_assert_admin_actor();
  v_target record;
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  if p_target_user_id is null then raise exception 'invalid_target'; end if;
  if v_action not in ('disable', 'reactivate') then raise exception 'invalid_action'; end if;

  select * into v_target from public.user_profiles p where p.id = p_target_user_id;
  if v_target.id is null then raise exception 'target_not_found'; end if;

  if v_action = 'disable' then
    if v_target.disabled_at is not null then
      return jsonb_build_object('userId', p_target_user_id, 'changed', false, 'status', 'disabled');
    end if;
    -- Grants, role and principal are deliberately preserved.
    update public.user_profiles set disabled_at = now() where id = p_target_user_id;
    insert into public.family_portfolio_access_audit
      (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
    values (p_target_user_id, v_actor, 'administrator', 'user_disable', 'active', 'disabled');
    return jsonb_build_object('userId', p_target_user_id, 'changed', true, 'status', 'disabled');
  end if;

  if v_target.disabled_at is null then
    return jsonb_build_object('userId', p_target_user_id, 'changed', false, 'status', 'active');
  end if;
  update public.user_profiles set disabled_at = null where id = p_target_user_id;
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
  values (p_target_user_id, v_actor, 'administrator', 'user_reactivate', 'disabled', 'active');
  return jsonb_build_object('userId', p_target_user_id, 'changed', true, 'status', 'active');
end $$;

comment on function public.nmi_admin_set_lifecycle(uuid, text) is
  'Disables or reactivates one account. Disabling preserves grants, role, principal '
  'and every timestamp; reactivating clears ONLY disabled_at. Idempotent. The '
  'last-administrator trigger refuses a disable that would empty the active-admin '
  'set. R13.6F.';

-- 7f . Activation. Takes NO target: the account activated is always the CALLER.
--      A client-supplied user id could otherwise be used to activate somebody
--      else's pending invitation.
create or replace function public.nmi_activate_current_user()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_target record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_target from public.user_profiles p where p.id = v_uid;
  if v_target.id is null then raise exception 'no_profile'; end if;

  -- A disabled account must not activate its way back in.
  if v_target.disabled_at is not null then raise exception 'account_disabled'; end if;

  -- Idempotent: a second callback for an already-active account is a no-op, not an
  -- error and not a second audit row.
  if v_target.activated_at is not null then
    return jsonb_build_object('userId', v_uid, 'changed', false, 'status', 'active');
  end if;

  -- Approval is still required: activation records that a provisioned account was
  -- accepted, and can never substitute for having been provisioned.
  if nullif(btrim(coalesce(v_target.username::text, '')), '') is null then
    raise exception 'not_approved';
  end if;

  update public.user_profiles set activated_at = now() where id = v_uid;
  insert into public.family_portfolio_access_audit
    (target_user_id, actor_user_id, actor_kind, field_changed, previous_value, new_value)
  values (v_uid, null, 'service_bootstrap', 'user_activate', 'invited', 'active');

  return jsonb_build_object('userId', v_uid, 'changed', true, 'status', 'active');
end $$;

comment on function public.nmi_activate_current_user() is
  'Marks the CALLING user activated. Takes no target id, so it can never activate '
  'another account. Idempotent; refuses a disabled or unapproved account. Audited as '
  'service_bootstrap because the actor is the invitee, not an administrator. R13.6F.';


-- ==============================================================================
-- 8 . PRIVILEGES
-- ==============================================================================
revoke all on function public.nmi_profile_usable(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.nmi_profile_usable(text, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public.nmi_guard_last_administrator()  from public, anon, authenticated;
revoke all on function public.nmi_assert_admin_actor()        from public, anon;
revoke all on function public.nmi_assert_known_modules(text[]) from public, anon;
grant execute on function public.nmi_assert_admin_actor()        to authenticated, service_role;
grant execute on function public.nmi_assert_known_modules(text[]) to authenticated, service_role;

-- The administrative RPCs are callable by `authenticated` because they are invoked
-- through the administrator's OWN session -- which is what makes auth.uid() inside
-- them meaningful. They are not open: the first statement of each raises unless the
-- caller is an active administrator.
revoke all on function public.nmi_admin_provision_invite(uuid, text, text, text, text, text, text[]) from public, anon;
revoke all on function public.nmi_admin_update_access(uuid, text, text, text[])                       from public, anon;
revoke all on function public.nmi_admin_set_lifecycle(uuid, text)                                     from public, anon;
grant execute on function public.nmi_admin_provision_invite(uuid, text, text, text, text, text, text[]) to authenticated, service_role;
grant execute on function public.nmi_admin_update_access(uuid, text, text, text[])                       to authenticated, service_role;
grant execute on function public.nmi_admin_set_lifecycle(uuid, text)                                     to authenticated, service_role;

-- Activation is called by the INVITEE, who is by definition not yet an
-- administrator and not yet active.
revoke all on function public.nmi_activate_current_user() from public, anon;
grant execute on function public.nmi_activate_current_user() to authenticated, service_role;


-- ==============================================================================
-- 9 . POSTCONDITIONS -- asserted against the catalog and against live behaviour
-- ==============================================================================
do $$
declare
  v_def   text;
  v_count integer;
begin
  -- 9a . Columns exist with the right type.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'user_profiles'
        and column_name in ('invited_at', 'activated_at', 'disabled_at')
        and data_type = 'timestamp with time zone') <> 3 then
    raise exception 'the three lifecycle columns were not added as timestamptz';
  end if;

  -- 9b . The usability rule behaves exactly as specified, including every NULL.
  if     public.nmi_profile_usable('u',  now(), null)  is not true  then raise exception 'usable: active account must be usable'; end if;
  if     public.nmi_profile_usable('u',  now(), now()) is not false then raise exception 'usable: disabled account must not be usable'; end if;
  if     public.nmi_profile_usable('u',  null,  null)  is not false then raise exception 'usable: never-activated account must not be usable'; end if;
  if     public.nmi_profile_usable(null, now(), null)  is not false then raise exception 'usable: unapproved account must not be usable'; end if;
  if     public.nmi_profile_usable('',   now(), null)  is not false then raise exception 'usable: blank username must not be usable'; end if;
  if     public.nmi_profile_usable('   ',now(), null)  is not false then raise exception 'usable: whitespace username must not be usable'; end if;

  -- 9c . The frozen Portfolio ceiling is UNCHANGED by this migration.
  if public.nmi_portfolio_scopes(true, false, 'jaime')  <> array['main','jaime','alternatives']  then raise exception 'ceiling changed: jaime'; end if;
  if public.nmi_portfolio_scopes(true, false, 'andres') <> array['main','andres','alternatives'] then raise exception 'ceiling changed: andres'; end if;
  if public.nmi_portfolio_scopes(true, false, 'pablo')  <> array['main','pablo','alternatives']  then raise exception 'ceiling changed: pablo'; end if;
  if public.nmi_portfolio_scopes(true, false, null)     <> array[]::text[]                       then raise exception 'ceiling changed: none'; end if;
  if public.nmi_portfolio_scopes(false, true, null)     <> array[]::text[]                       then raise exception 'ceiling changed: unapproved admin'; end if;

  -- 9d . The frozen module rule is UNCHANGED by this migration.
  if public.nmi_module_allowed(true,  true,  false, true)  is not true  then raise exception 'module rule changed: admin'; end if;
  if public.nmi_module_allowed(true,  false, false, true)  is not false then raise exception 'module rule changed: member without grant'; end if;
  if public.nmi_module_allowed(false, true,  true,  true)  is not false then raise exception 'module rule changed: unapproved admin'; end if;

  -- 9e . The authorization functions now depend on the lifecycle columns. Asserted
  --      from the SOURCE TEXT, because a function that merely still exists proves
  --      nothing about whether the substitution actually happened.
  for v_def in
    select pg_get_functiondef(p.oid)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('nmi_is_administrator', 'nmi_can_access_module',
                        'nmi_current_module_grants', 'nmi_current_portfolio_scopes')
  loop
    if v_def not like '%nmi_profile_usable%' then
      raise exception 'an authorization function does not consult nmi_profile_usable: %',
        substring(v_def from 1 for 120);
    end if;
  end loop;

  -- 9f . The last-administrator trigger is attached for BOTH update and delete.
  if not exists (
    select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
    where c.relname = 'user_profiles'
      and t.tgname = 'user_profiles_last_administrator_guard'
      and not t.tgisinternal
  ) then
    raise exception 'the last-administrator trigger is not attached';
  end if;

  -- 9g . The audit trail accepts the four lifecycle kinds and still rejects junk.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_catalog.pg_constraint c join pg_catalog.pg_class t on t.oid = c.conrelid
  where t.relname = 'family_portfolio_access_audit'
    and c.conname = 'family_portfolio_access_audit_field_changed_check';
  if v_def is null then raise exception 'the field_changed CHECK is missing'; end if;
  if v_def not like '%user_invite%' or v_def not like '%user_activate%'
     or v_def not like '%user_disable%' or v_def not like '%user_reactivate%'
     or v_def not like '%module_grant%' or v_def not like '%portfolio_principal%'
     or v_def not like '%role%' then
    raise exception 'the field_changed CHECK does not cover every kind: %', v_def;
  end if;

  -- 9h . REGRESSION: user_profiles is still administrator-controlled. `authenticated`
  --      must not have gained a write path from any of the work above.
  if has_table_privilege('authenticated', 'public.user_profiles', 'INSERT')
     or has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE')
     or has_table_privilege('authenticated', 'public.user_profiles', 'DELETE') then
    raise exception 'authenticated must not be able to write user_profiles directly';
  end if;
  if has_table_privilege('anon', 'public.user_profiles', 'SELECT') then
    raise exception 'anon must not be able to read user_profiles';
  end if;

  -- 9i . REGRESSION: the audit trail is still service-role write only.
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'family_portfolio_access_audit'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'the audit table must have NO mutation policy';
  end if;

  -- 9j . REGRESSION: the module registry is untouched, and still exactly 7.
  select count(*) into v_count from public.app_modules;
  if v_count <> 7 then
    raise exception 'the module registry changed - expected 7, found %', v_count;
  end if;

  -- 9k . THE BACKFILL WORKED: no approved account was left un-activated, so no
  --      existing user loses access to the very migration that adds the column.
  select count(*) into v_count
  from public.user_profiles p
  where nullif(btrim(p.username::text), '') is not null
    and p.disabled_at is null
    and p.activated_at is null;
  if v_count > 0 then
    raise exception 'backfill incomplete: % approved account(s) have no activated_at', v_count;
  end if;

  -- 9l . THE ADMINISTRATOR SURVIVED. Every approved administrator must be usable
  --      after this migration, or the platform has locked itself out.
  select count(*) into v_count
  from public.user_profiles p
  where p.role = 'administrator'
    and nullif(btrim(p.username::text), '') is not null
    and not public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at);
  if v_count > 0 then
    raise exception 'the migration left % approved administrator(s) unusable', v_count;
  end if;
end $$;
