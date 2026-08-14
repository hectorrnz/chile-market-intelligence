-- R13.R2 §§ 14-15 — global Asset Allocation presentation settings.
--
-- FORWARD-ONLY. The R13 migrations through 20260811000000 are deployed and are
-- never edited; this is the next migration after them and it only adds.
--
-- WHY A TABLE AT ALL (§ 15 requires the justification). The requirement is that
-- an administrator's approved presentation is what AUTHORIZED MEMBERS SEE — a
-- product decision, not a personal preference. Nothing existing satisfies that:
--   * `localStorage` (the app's `usePersistentState` convention) is per-browser
--     and would show the choice only to the administrator who made it, on the
--     one machine they made it on — the precise misuse § 15 names.
--   * `user_profiles` is per-account and has the identical defect.
--   * Publication `metadata` is per-week and immutable once published; a
--     presentation choice is neither, and writing one there would mutate a
--     financial record for a cosmetic reason.
-- A single global row is therefore the smallest correct home.
--
-- WHY IT CANNOT CARRY ARBITRARY STYLE (§§ 14, 15). Every column is a CLOSED
-- ENUM guarded by a CHECK constraint whose members are the same members the
-- TypeScript module `src/lib/familyPortfolio/allocationSettings.ts` declares.
-- There is no hex column, no RGB column, no CSS column and no jsonb column: a
-- palette is chosen by NAME and resolves to design tokens declared once in
-- `globals.css`. A colour outside the approved token set is unrepresentable
-- here, not merely rejected.
--
-- POSTURE. Read = any caller who holds at least one Family Portfolio scope, so
-- the four members see the administrator's approved presentation. Write =
-- administrators only, through `public.nmi_is_administrator()` — the same
-- helper the upload policies use — enforced independently of the API route's
-- own `canAdminister` check. THIS TABLE HOLDS NO FINANCIAL DATA: it is
-- presentation configuration, so a member reading it learns nothing about any
-- portfolio, and the scope-filtered predicates used by the financial tables
-- would be the wrong instrument here.

-- ── Guard: the R13.1 entitlement helpers must already exist ───────────────────
do $$
begin
  if to_regprocedure('public.nmi_is_administrator()') is null then
    raise exception 'public.nmi_is_administrator() is missing — apply the R13.1 entitlement migration first';
  end if;
  if to_regprocedure('public.nmi_current_portfolio_scopes()') is null then
    raise exception 'public.nmi_current_portfolio_scopes() is missing — apply the R13.1 entitlement migration first';
  end if;
end $$;

-- ── 1. The settings row ───────────────────────────────────────────────────────
create table if not exists public.family_portfolio_presentation_settings (
  -- A SINGLETON, enforced by the primary key plus a CHECK that admits exactly
  -- one key. A second settings row cannot exist, so no reader ever has to
  -- decide which of several rows is authoritative.
  settings_key      text primary key
                      check (settings_key = 'allocation'),

  label_position    text not null default 'legend_only'
                      check (label_position in ('inside','outside','legend_only')),
  label_content     text not null default 'percentage'
                      check (label_content in ('percentage','value','percentage_value')),
  legend_visible    boolean not null default true,
  -- Two palettes, not three. The R13.7 `oceanic` preset was eight shades of
  -- blue (worst pair ΔE 0.037 in OKLab — indistinguishable without hovering)
  -- and every repair inside the approved palette converged on `spectrum`, so
  -- offering both would have been two presets a reader cannot tell apart.
  palette           text not null default 'institutional'
                      check (palette in ('institutional','spectrum')),
  donut_thickness   text not null default 'medium'
                      check (donut_thickness in ('thin','medium','thick')),
  -- The Portfolio Evolution High Water Market reference. `auto` is the
  -- owner-required behaviour (visible on the ALL single-series view, hidden in
  -- Compare and on windowed periods); `hidden` suppresses it everywhere. There
  -- is deliberately NO 'always' — it could only be used to contradict the
  -- owner's Compare rule, so it is not representable.
  reference_line    text not null default 'auto'
                      check (reference_line in ('auto','hidden')),

  -- Audit metadata (§ 15). `updated_by` is the acting administrator; on delete
  -- it becomes null rather than removing the settings row, because a departed
  -- administrator must not take the family's presentation with them.
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now()
);

comment on table public.family_portfolio_presentation_settings is
  'R13.R2 § 15 — GLOBAL Family Portfolio presentation configuration. Administrator-writable, member-readable, closed enums only. Holds no financial data.';
comment on column public.family_portfolio_presentation_settings.settings_key is
  'Singleton key; the CHECK admits only ''allocation'' so exactly one row can exist.';
comment on column public.family_portfolio_presentation_settings.palette is
  'Curated palette NAME. Resolves to --fp-* design tokens in globals.css; never a hex or RGB value.';

-- Seed the singleton with the documented defaults, which reproduce the R13.7
-- presentation exactly — adopting this feature changes nothing on screen until
-- an administrator chooses otherwise. Idempotent: a re-run never overwrites a
-- choice an administrator has already made.
insert into public.family_portfolio_presentation_settings (settings_key)
values ('allocation')
on conflict (settings_key) do nothing;

-- Keep `updated_at` honest even for a direct SQL write.
create or replace function public.nmi_touch_presentation_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_presentation_settings_touch
  on public.family_portfolio_presentation_settings;
create trigger trg_presentation_settings_touch
  before update on public.family_portfolio_presentation_settings
  for each row execute function public.nmi_touch_presentation_settings();

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
alter table public.family_portfolio_presentation_settings enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'family_portfolio_presentation_settings'
  loop
    execute format(
      'drop policy %I on public.family_portfolio_presentation_settings', pol.policyname);
  end loop;
end $$;

-- READ: any caller holding at least one Family Portfolio scope. That is exactly
-- the set of people who can see a surface these settings affect; a caller with
-- no scope sees no allocation chart, so it reads nothing.
create policy "family_portfolio_presentation_settings_member_select"
  on public.family_portfolio_presentation_settings
  for select to authenticated
  using (coalesce(array_length(public.nmi_current_portfolio_scopes(), 1), 0) > 0);

-- WRITE: administrators only. `with check` as well as `using` — without the
-- former an administrator check could be satisfied by the row being read while
-- the row being written escaped it.
create policy "family_portfolio_presentation_settings_admin_update"
  on public.family_portfolio_presentation_settings
  for update to authenticated
  using (public.nmi_is_administrator())
  with check (public.nmi_is_administrator());

create policy "family_portfolio_presentation_settings_admin_insert"
  on public.family_portfolio_presentation_settings
  for insert to authenticated
  with check (public.nmi_is_administrator());

-- No DELETE policy, deliberately: the singleton is never removed. "Reset" means
-- writing the defaults back, which leaves the audit trail intact.

revoke all privileges on table public.family_portfolio_presentation_settings
  from public, anon, authenticated;
grant select, insert, update on table public.family_portfolio_presentation_settings
  to authenticated;
grant all privileges on table public.family_portfolio_presentation_settings to service_role;

revoke all on function public.nmi_touch_presentation_settings() from public, anon;

-- ── 3. Postconditions — the migration verifies its own guarantees ─────────────

-- 3a. Exactly one row can exist, and it exists now.
do $$
declare
  n integer;
begin
  select count(*) into n from public.family_portfolio_presentation_settings;
  if n <> 1 then
    raise exception 'expected exactly 1 presentation-settings row, found %', n;
  end if;
end $$;

-- 3b. Every enum column is CHECK-constrained with the expected members, so the
-- database and the TypeScript vocabulary cannot drift apart silently.
do $$
declare
  expected text[][] := array[
    array['label_position',  'inside'],
    array['label_position',  'outside'],
    array['label_position',  'legend_only'],
    array['label_content',   'percentage'],
    array['label_content',   'value'],
    array['label_content',   'percentage_value'],
    array['palette',         'institutional'],
    array['palette',         'spectrum'],
    array['donut_thickness', 'thin'],
    array['donut_thickness', 'medium'],
    array['donut_thickness', 'thick'],
    array['reference_line',  'auto'],
    array['reference_line',  'hidden']
  ];
  i integer;
  defs text;
begin
  select string_agg(pg_get_constraintdef(c.oid), ' ') into defs
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
   where t.relname = 'family_portfolio_presentation_settings'
     and c.contype = 'c';

  for i in 1 .. array_length(expected, 1) loop
    if defs is null or position(quote_literal(expected[i][2]) in defs) = 0 then
      raise exception 'CHECK constraint for %.% does not admit %',
        'family_portfolio_presentation_settings', expected[i][1], expected[i][2];
    end if;
  end loop;

  -- And the withdrawn preset is genuinely unstorable, not merely unlisted in
  -- the UI: a palette a reader cannot distinguish must be impossible to set.
  if position(quote_literal('oceanic') in coalesce(defs, '')) > 0 then
    raise exception 'the withdrawn ''oceanic'' palette must not be storable';
  end if;
end $$;

-- 3c. There is no free-form style column anywhere on this table (§ 15).
do $$
declare
  bad text;
begin
  select string_agg(column_name || ':' || data_type, ', ') into bad
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'family_portfolio_presentation_settings'
     and (data_type in ('json','jsonb')
          or column_name ~ '(hex|rgb|css|style|color|colour)');
  if bad is not null then
    raise exception 'presentation settings must carry no free-form style payload, found: %', bad;
  end if;
end $$;

-- 3d. The write policies resolve through the administrator helper, and the read
-- policy does not — a member must be able to read what an administrator set.
do $$
declare
  v_upd text;
  v_ins text;
  v_sel text;
begin
  select qual into v_sel from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'family_portfolio_presentation_settings'
     and policyname = 'family_portfolio_presentation_settings_member_select';
  if v_sel is null or v_sel not like '%nmi_current_portfolio_scopes%' then
    raise exception 'the settings read policy does not resolve through nmi_current_portfolio_scopes';
  end if;

  select qual into v_upd from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'family_portfolio_presentation_settings'
     and policyname = 'family_portfolio_presentation_settings_admin_update';
  if v_upd is null or v_upd not like '%nmi_is_administrator%' then
    raise exception 'the settings update policy does not resolve through nmi_is_administrator';
  end if;

  select with_check into v_ins from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'family_portfolio_presentation_settings'
     and policyname = 'family_portfolio_presentation_settings_admin_insert';
  if v_ins is null or v_ins not like '%nmi_is_administrator%' then
    raise exception 'the settings insert policy does not resolve through nmi_is_administrator';
  end if;
end $$;

-- 3e. `anon` reaches nothing; `authenticated` holds no DELETE.
do $$
begin
  if has_table_privilege('anon', 'public.family_portfolio_presentation_settings', 'SELECT') then
    raise exception 'anon must not hold SELECT on family_portfolio_presentation_settings';
  end if;
  if has_table_privilege('authenticated', 'public.family_portfolio_presentation_settings', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on family_portfolio_presentation_settings';
  end if;
  if not has_table_privilege('authenticated', 'public.family_portfolio_presentation_settings', 'SELECT') then
    raise exception 'authenticated must hold SELECT on family_portfolio_presentation_settings';
  end if;
end $$;

-- 3f. No policy on this table may reference a financial table — presentation
-- configuration must never become a side channel into portfolio data.
do $$
declare
  refs text;
begin
  select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ') into refs
    from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'family_portfolio_presentation_settings';
  if refs is not null and refs ~ '(portfolio_snapshot_rows|portfolio_performance_rows|portfolio_publications|portfolio_evolution_observations)' then
    raise exception 'presentation-settings policies must not reference financial tables';
  end if;
end $$;
